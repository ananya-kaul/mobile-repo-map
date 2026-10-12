/**
 * `mobile-repo-map ask` — answers a question about the analyzed repo with an optional
 * LLM provider. Loaded lazily by the CLI; static analysis never needs any of this.
 *
 * Flow: pick provider -> retrieve relevant excerpts -> build prompt -> announce what will
 * be sent (stderr) -> stream the answer (stdout). `dryRun` prints the prompt instead.
 */
import { retrieve } from './retrieve.js';
import { buildPrompt } from './prompt.js';
import { AiError } from './errors.js';
import { ollamaBaseUrl } from './providers/ollama.js';

export { AiError } from './errors.js';

export const PROVIDERS = ['anthropic', 'openai', 'ollama'];

/** Retrieval budgets per provider; local models get a smaller prompt. */
const LIMITS = {
  anthropic: { maxChars: 60000, maxFiles: 12 },
  openai: { maxChars: 60000, maxFiles: 12 },
  ollama: { maxChars: 24000, maxFiles: 8 },
};

export const NO_PROVIDER_MESSAGE = [
  'No AI provider is configured, so `ask` has nothing to send the question to. Pick one:',
  '  - Anthropic:  export ANTHROPIC_API_KEY=...   (optional: --model <id>)',
  '  - OpenAI or any OpenAI-compatible server:  export OPENAI_API_KEY=...   (optional: OPENAI_BASE_URL, --model / MRM_OPENAI_MODEL)',
  '  - Ollama, local and free, no key:  install from https://ollama.com, run `ollama pull qwen2.5-coder`, keep `ollama serve` running (optional: OLLAMA_HOST)',
  'Then re-run, or force one with --provider anthropic|openai|ollama. Add --dry-run to see exactly what would be sent.',
  '',
  'No key at all? Copy the architecture summary and paste it into any chat assistant:',
  '  mobile-repo-map context . | pbcopy',
].join('\n');

async function ollamaReachable(env) {
  try {
    const res = await fetch(`${ollamaBaseUrl(env)}/api/tags`, { signal: AbortSignal.timeout(800) });
    if (res.body) await res.body.cancel().catch(() => {});
    return res.ok;
  } catch {
    return false;
  }
}

/** First available provider: ANTHROPIC_API_KEY, then OPENAI_API_KEY, then a reachable Ollama; else null. */
export async function detectProvider(env = process.env) {
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  if (env.OPENAI_API_KEY) return 'openai';
  if (await ollamaReachable(env)) return 'ollama';
  return null;
}

async function loadProvider(name) {
  switch (name) {
    case 'anthropic': return import('./providers/anthropic.js');
    case 'openai': return import('./providers/openai.js');
    case 'ollama': return import('./providers/ollama.js');
    default: throw new AiError(`Unknown provider "${name}".`);
  }
}

const AUTO_LABEL = {
  anthropic: 'auto: newest "opus" model in the account\'s models list',
  openai: null,
  ollama: 'auto: first installed model',
};

function formatKB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function renderPrompt(system, user) {
  return `===== SYSTEM =====\n${system}\n\n===== USER =====\n${user}`;
}

/**
 * @param {object} args
 * @param {string} args.question
 * @param {object} [args.model] analysis result ({ files, screens, apis, ... })
 * @param {Array<{ path: string, text: string }>} [args.sources] full source files
 * @param {string} [args.contextMd] markdown architecture summary
 * @param {'anthropic'|'openai'|'ollama'} [args.provider] auto-detected when omitted
 * @param {string} [args.modelId] `--model`
 * @param {boolean} [args.dryRun] print the prompt to `out` instead of sending it
 * @param {{ write(s: string): any }} [args.out] answer stream (stdout)
 * @param {{ write(s: string): any }} [args.err] notices (stderr)
 * @param {number} [args.maxChars] retrieval budget override
 * @param {number} [args.maxFiles] retrieval file-count override
 * @returns {Promise<{ provider: string|null, model: string|null, files: string[] }>}
 */
export async function ask({
  question, model, sources, contextMd, provider, modelId,
  dryRun = false, out = process.stdout, err = process.stderr, maxChars, maxFiles,
}) {
  const q = String(question || '').trim();
  if (!q) throw new AiError('Ask a question, for example: mobile-repo-map ask "How does checkout work?" .');

  let name = provider ? String(provider).trim().toLowerCase() : null;
  if (name && !PROVIDERS.includes(name)) {
    throw new AiError(`Unknown provider "${provider}". Use one of: ${PROVIDERS.join(', ')}.`);
  }
  if (!name) {
    name = await detectProvider();
    // A dry run sends nothing, so it is still useful without any provider.
    if (!name && !dryRun) throw new AiError(NO_PROVIDER_MESSAGE);
  }

  const limits = LIMITS[name || 'anthropic'];
  const snippets = retrieve(q, model, Array.isArray(sources) ? sources : [], {
    maxChars: maxChars ?? limits.maxChars,
    maxFiles: maxFiles ?? limits.maxFiles,
  });
  const { system, user } = buildPrompt({ question: q, contextMd, snippets });
  const files = snippets.map((s) => s.path);
  const payload = `${files.length} file excerpt${files.length === 1 ? '' : 's'} + the architecture summary `
    + `(${formatKB(Buffer.byteLength(system) + Buffer.byteLength(user))} in total)`;
  const fileList = files.length ? `\n  files: ${files.join(', ')}` : '';

  if (dryRun) {
    let plannedModel = null;
    let target = 'no provider (none is configured yet)';
    if (name) {
      const impl = await loadProvider(name);
      plannedModel = impl.plannedModel(modelId) || null;
      target = `${name} (model: ${plannedModel || AUTO_LABEL[name]})`;
    }
    err.write(`[mobile-repo-map] Dry run, nothing was sent. A real run would send ${payload} to ${target}.${fileList}\n`);
    out.write(renderPrompt(system, user));
    return { provider: name, model: plannedModel, files };
  }

  const impl = await loadProvider(name);
  const session = await impl.prepare({ modelId });
  err.write(
    `[mobile-repo-map] Sending ${payload} to ${name} (model: ${session.model}${session.autoSelected ? ', auto-selected' : ''}). `
    + `Use --dry-run to see exactly what is sent.${fileList}\n`,
  );
  await session.send({ system, user, out, err });
  return { provider: name, model: session.model, files };
}
