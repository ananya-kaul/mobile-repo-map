/**
 * OpenAI (or any OpenAI-compatible server) via raw fetch to /chat/completions with SSE streaming.
 *
 * Env: OPENAI_API_KEY (required for api.openai.com), OPENAI_BASE_URL (point at any
 * compatible server, e.g. a local LM Studio / vLLM / llama.cpp), MRM_OPENAI_MODEL.
 */
import { AiError } from '../errors.js';
import { readLines, errorDetail, networkDetail } from './lines.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-5-mini';
const MAX_TOKENS = 16000;

export function baseUrl(env = process.env) {
  return (env.OPENAI_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
}

/** The model a run would use, without touching the network. */
export function plannedModel(modelId, env = process.env) {
  return modelId || env.MRM_OPENAI_MODEL || DEFAULT_MODEL;
}

function httpError(res, detail, model, base) {
  switch (res.status) {
    case 401:
      return new AiError(`${base} rejected the API key (401). Check OPENAI_API_KEY.`);
    case 403:
      return new AiError(`This key may not use "${model}" (403): ${detail}`);
    case 404:
      return new AiError(`"${model}" was not found at ${base}/chat/completions (404): ${detail}. Pick another model with --model or MRM_OPENAI_MODEL, and check OPENAI_BASE_URL.`);
    case 429:
      return new AiError(`Rate limit or quota exceeded at ${base} (429): ${detail}. Wait a moment, or check your plan and billing.`);
    default:
      return new AiError(`${base} returned HTTP ${res.status}: ${detail}`);
  }
}

/**
 * @param {{ modelId?: string }} [options]
 */
export async function prepare({ modelId } = {}) {
  const env = process.env;
  const base = baseUrl(env);
  const key = env.OPENAI_API_KEY;
  if (!key && !env.OPENAI_BASE_URL) {
    throw new AiError('OPENAI_API_KEY is not set. Export it, or set OPENAI_BASE_URL to a compatible server that needs no key.');
  }
  const model = plannedModel(modelId, env);
  const autoSelected = !modelId && !env.MRM_OPENAI_MODEL;

  async function post(body) {
    try {
      return await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new AiError(`Could not reach ${base} (${networkDetail(e)}). Check your network, or OPENAI_BASE_URL.`, { cause: e });
    }
  }

  async function send({ system, user, out, err }) {
    const body = {
      model,
      stream: true,
      max_completion_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    };
    let res = await post(body);
    if (res.status === 400) {
      const detail = await errorDetail(res);
      // Some older compatible servers only understand `max_tokens`.
      if (!/max_completion_tokens/.test(detail)) throw httpError(res, detail, model, base);
      const { max_completion_tokens: limit, ...rest } = body;
      res = await post({ ...rest, max_tokens: limit });
    }
    if (!res.ok) throw httpError(res, await errorDetail(res), model, base);

    let wrote = false;
    let endsWithNewline = true;
    let finish = null;
    const write = (text) => {
      if (!text) return;
      out.write(text);
      wrote = true;
      endsWithNewline = text.endsWith('\n');
    };

    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (type.includes('application/json')) {
      // The server ignored `stream: true` and answered in one piece.
      const j = await res.json();
      const choice = j.choices && j.choices[0];
      write(choice && choice.message && choice.message.content);
      finish = (choice && choice.finish_reason) || null;
    } else {
      for await (const line of readLines(res.body)) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        if (data === '[DONE]') break;
        let j;
        try { j = JSON.parse(data); } catch { continue; }
        if (j.error) {
          if (wrote && !endsWithNewline) out.write('\n');
          throw new AiError(`${base} reported an error mid-stream: ${j.error.message || JSON.stringify(j.error)}`);
        }
        const choice = j.choices && j.choices[0];
        if (!choice) continue;
        write(choice.delta && choice.delta.content);
        if (choice.finish_reason) finish = choice.finish_reason;
      }
    }

    if (wrote && !endsWithNewline) out.write('\n');
    if (!wrote) err.write('[mobile-repo-map] The model returned no text.\n');
    if (finish === 'length') {
      err.write(`[mobile-repo-map] The answer was cut off at the ${MAX_TOKENS}-token output limit. Ask a narrower question for the rest.\n`);
    } else if (finish === 'content_filter') {
      err.write('[mobile-repo-map] The provider filtered this answer. Try rephrasing the question.\n');
    }
    return { model, stopReason: finish };
  }

  return { provider: 'openai', model, autoSelected, send };
}
