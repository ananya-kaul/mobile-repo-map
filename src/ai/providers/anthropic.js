/**
 * Anthropic provider, via the official SDK (loaded lazily so nothing else in the CLI
 * depends on it). The SDK reads ANTHROPIC_API_KEY (and ANTHROPIC_BASE_URL) itself.
 *
 * Model choice happens at runtime: `--model` (or MRM_ANTHROPIC_MODEL) wins; otherwise
 * the newest listed model whose id contains "opus", else the newest model listed.
 */
import { AiError } from '../errors.js';

const MAX_TOKENS = 16000;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

async function loadSdk() {
  try {
    const mod = await import('@anthropic-ai/sdk');
    return mod.default;
  } catch (e) {
    throw new AiError(
      'The anthropic provider needs the @anthropic-ai/sdk package. Run `npm install @anthropic-ai/sdk` next to mobile-repo-map, or pick another provider with --provider openai|ollama.',
      { cause: e },
    );
  }
}

/** The model a run would use, without touching the network (null = chosen at runtime from the models list). */
export function plannedModel(modelId, env = process.env) {
  return modelId || env.MRM_ANTHROPIC_MODEL || null;
}

/** Newest model whose id contains "opus"; otherwise the newest model the key can see. */
async function pickModel(client) {
  let first = null;
  for await (const info of client.models.list()) {
    if (!first) first = info.id;
    if (typeof info.id === 'string' && info.id.includes('opus')) return info.id;
  }
  if (!first) throw new AiError('The Anthropic API returned no models for this key. Pass one explicitly with --model <id>.');
  return first;
}

function toFriendly(Anthropic, e, model) {
  if (e instanceof AiError) return e;
  const detail = (e && e.error && e.error.error && e.error.error.message) || (e && e.message) || String(e);
  if (e instanceof Anthropic.AuthenticationError) {
    return new AiError('Anthropic rejected the API key (401). Check that ANTHROPIC_API_KEY is set to a valid, active key.', { cause: e });
  }
  if (e instanceof Anthropic.RateLimitError) {
    const retry = e.headers && typeof e.headers.get === 'function' ? e.headers.get('retry-after') : null;
    return new AiError(
      `Anthropic rate limit reached (429)${retry ? `; retry after ${retry}s` : ''}. Wait a moment and try again, or ask a narrower question.`,
      { cause: e },
    );
  }
  if (e instanceof Anthropic.APIConnectionError) {
    const where = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
    return new AiError(`Could not reach the Anthropic API at ${where} (${detail}). Check your network or proxy settings.`, { cause: e });
  }
  if (e instanceof Anthropic.APIError) {
    if (e.status === 404) {
      return new AiError(`Anthropic does not know the model "${model}" (404). Pass a valid id with --model, or omit --model to pick one automatically.`, { cause: e });
    }
    if (e.status === 403) {
      return new AiError(`This API key is not allowed to use "${model}" (403): ${detail}`, { cause: e });
    }
    return new AiError(`Anthropic API error${e.status ? ` ${e.status}` : ''}: ${detail}`, { cause: e });
  }
  if (Anthropic.AnthropicError && e instanceof Anthropic.AnthropicError) {
    return new AiError(`Anthropic client error: ${detail}. Is ANTHROPIC_API_KEY set?`, { cause: e });
  }
  return e;
}

/**
 * Resolves the model (may call the models endpoint) and returns a sender.
 *
 * @param {{ modelId?: string, client?: object }} [options] `client` is a test hook.
 * @returns {Promise<{ provider: 'anthropic', model: string, autoSelected: boolean,
 *   send: (args: { system: string, user: string, out: { write(s: string): any }, err: { write(s: string): any } }) => Promise<{ model: string, stopReason: string|null }> }>}
 */
export async function prepare({ modelId, client: injected } = {}) {
  const Anthropic = await loadSdk();
  const client = injected || new Anthropic();
  const pinned = plannedModel(modelId);

  let model = pinned;
  const autoSelected = !pinned;
  if (!model) {
    try {
      model = await pickModel(client);
    } catch (e) {
      throw toFriendly(Anthropic, e, '(auto)');
    }
  }

  async function send({ system, user, out, err }) {
    let useFallbacks = autoSelected;
    for (;;) {
      let wrote = false;
      let endsWithNewline = true;
      try {
        const stream = client.beta.messages.stream({
          model,
          max_tokens: MAX_TOKENS,
          system,
          messages: [{ role: 'user', content: user }],
          output_config: { effort: 'medium' },
          ...(useFallbacks ? { betas: [FALLBACK_BETA], fallbacks: 'default' } : {}),
        });
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            const text = event.delta.text;
            if (!text) continue;
            out.write(text);
            wrote = true;
            endsWithNewline = text.endsWith('\n');
          } else if (event.type === 'content_block_start' && event.content_block && event.content_block.type === 'fallback') {
            const block = event.content_block;
            const from = (block.from && block.from.model) || model;
            const to = (block.to && block.to.model) || 'a fallback model';
            err.write(`\n[mobile-repo-map] ${from} declined to continue; the server switched to ${to}.\n`);
          }
        }
        const final = await stream.finalMessage();
        if (wrote && !endsWithNewline) out.write('\n');

        if (final.stop_reason === 'refusal') {
          err.write('[mobile-repo-map] The model declined to answer this request. Try rephrasing the question.\n');
        } else if (final.stop_reason === 'max_tokens') {
          err.write(`[mobile-repo-map] The answer was cut off at the ${MAX_TOKENS}-token output limit. Ask a narrower question for the rest.\n`);
        } else if (final.stop_reason === 'model_context_window_exceeded') {
          err.write('[mobile-repo-map] The answer stopped because the context window filled up. Ask a narrower question.\n');
        }
        return { model: final.model || model, stopReason: final.stop_reason || null };
      } catch (e) {
        if (
          useFallbacks && !wrote
          && e instanceof Anthropic.BadRequestError
          && /fallback/i.test(`${e.message} ${JSON.stringify(e.error || '')}`)
        ) {
          useFallbacks = false; // this server does not accept fallbacks; retry once without them
          continue;
        }
        if (wrote && !endsWithNewline) out.write('\n');
        throw toFriendly(Anthropic, e, model);
      }
    }
  }

  return { provider: 'anthropic', model, autoSelected, send };
}
