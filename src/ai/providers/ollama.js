/**
 * Local models through Ollama (no key). Streams NDJSON from /api/chat.
 *
 * Env: OLLAMA_HOST (same formats Ollama accepts: `127.0.0.1:11434`, `0.0.0.0`,
 * `http://box:11434`), MRM_OLLAMA_MODEL, MRM_OLLAMA_NUM_CTX (context window override).
 */
import { AiError } from '../errors.js';
import { readLines, errorDetail, networkDetail } from './lines.js';

const SUGGESTED_MODEL = 'qwen2.5-coder';

/** Normalizes OLLAMA_HOST the way the Ollama CLI does (no scheme means port 11434; 0.0.0.0 means this machine). */
export function ollamaBaseUrl(env = process.env) {
  const raw = (env.OLLAMA_HOST || '').trim() || '127.0.0.1:11434';
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  let url;
  try {
    url = new URL(hasScheme ? raw : `http://${raw}`);
  } catch {
    return 'http://127.0.0.1:11434';
  }
  if (!hasScheme && !url.port) url.port = '11434';
  if (url.hostname === '0.0.0.0') url.hostname = '127.0.0.1';
  if (url.hostname === '[::]') url.hostname = '[::1]';
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** The model a run would use, without touching the network (null = first installed model). */
export function plannedModel(modelId, env = process.env) {
  return modelId || env.MRM_OLLAMA_MODEL || null;
}

/** Context window big enough for the prompt plus an answer; Ollama's default is too small for 20k+ token prompts. */
function contextWindow(system, user, env) {
  const override = Number.parseInt(env.MRM_OLLAMA_NUM_CTX || '', 10);
  if (Number.isFinite(override) && override > 0) return override;
  const estimate = Math.ceil((system.length + user.length) / 3) + 4096;
  return Math.min(32768, Math.max(8192, Math.ceil(estimate / 2048) * 2048));
}

async function call(base, path, init) {
  try {
    return await fetch(`${base}${path}`, init);
  } catch (e) {
    throw new AiError(
      `Could not reach Ollama at ${base} (${networkDetail(e)}). Start it with \`ollama serve\` (install from https://ollama.com), or set OLLAMA_HOST.`,
      { cause: e },
    );
  }
}

/**
 * @param {{ modelId?: string }} [options]
 */
export async function prepare({ modelId } = {}) {
  const env = process.env;
  const base = ollamaBaseUrl(env);
  let model = plannedModel(modelId, env);
  const autoSelected = !model;

  if (!model) {
    const res = await call(base, '/api/tags', { method: 'GET' });
    if (!res.ok) throw new AiError(`Ollama at ${base} answered /api/tags with HTTP ${res.status}: ${await errorDetail(res)}`);
    const tags = await res.json().catch(() => ({}));
    const first = Array.isArray(tags.models) && tags.models.find((m) => m && (m.name || m.model));
    if (!first) {
      throw new AiError(`Ollama is running at ${base} but has no models installed. Run \`ollama pull ${SUGGESTED_MODEL}\`, then try again (or pass --model).`);
    }
    model = first.name || first.model;
  }

  async function send({ system, user, out, err }) {
    const res = await call(base, '/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        options: { num_ctx: contextWindow(system, user, env) },
      }),
    });
    if (!res.ok) {
      const detail = await errorDetail(res);
      if (res.status === 404 || /not found|pull/i.test(detail)) {
        throw new AiError(`Ollama does not have the model "${model}" installed. Run \`ollama pull ${model}\` (or choose an installed one with --model).`);
      }
      throw new AiError(`Ollama returned HTTP ${res.status}: ${detail}`);
    }

    let wrote = false;
    let endsWithNewline = true;
    let doneReason = null;
    for await (const line of readLines(res.body)) {
      if (!line.trim()) continue;
      let j;
      try { j = JSON.parse(line); } catch { continue; }
      if (j.error) {
        if (wrote && !endsWithNewline) out.write('\n');
        throw new AiError(`Ollama reported an error: ${j.error}`);
      }
      const text = j.message && j.message.content;
      if (text) {
        out.write(text);
        wrote = true;
        endsWithNewline = text.endsWith('\n');
      }
      if (j.done) { doneReason = j.done_reason || 'stop'; break; }
    }

    if (wrote && !endsWithNewline) out.write('\n');
    if (!wrote) err.write('[mobile-repo-map] The model returned no text.\n');
    if (doneReason === 'length') {
      err.write('[mobile-repo-map] The answer was cut off by the model\'s length limit. Ask a narrower question, or raise MRM_OLLAMA_NUM_CTX.\n');
    }
    return { model, stopReason: doneReason };
  }

  return { provider: 'ollama', model, autoSelected, send };
}
