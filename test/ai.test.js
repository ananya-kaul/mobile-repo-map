import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { retrieve, tokenize, splitWords } from '../src/ai/retrieve.js';
import { buildPrompt } from '../src/ai/prompt.js';
import { ask, detectProvider, PROVIDERS } from '../src/ai/ask.js';
import { AiError } from '../src/ai/errors.js';
import * as openai from '../src/ai/providers/openai.js';
import * as ollama from '../src/ai/providers/ollama.js';
import * as anthropic from '../src/ai/providers/anthropic.js';

// ---------------------------------------------------------------------------
// Fixtures and helpers (no real network anywhere in this file).
// ---------------------------------------------------------------------------

const SOURCES = [
  {
    path: 'lib/features/checkout/checkout_service.dart',
    text: [
      "import 'package:shop/api/api_client.dart';",
      '',
      'class CheckoutService {',
      '  CheckoutService(this._api);',
      '  final ApiClient _api;',
      '',
      '  Future<Order> placeOrder(Cart cart) async {',
      "    final res = await _api.post('/orders', body: cart.toJson());",
      '    return Order.fromJson(res);',
      '  }',
      '}',
    ].join('\n'),
  },
  {
    path: 'lib/features/profile/profile_screen.dart',
    text: [
      "import 'package:flutter/material.dart';",
      '',
      'class ProfileScreen extends StatelessWidget {',
      '  const ProfileScreen({super.key});',
      '  @override',
      "  Widget build(BuildContext context) => const Text('Profile');",
      '}',
    ].join('\n'),
  },
  {
    path: 'lib/api/api_client.dart',
    text: [
      "import 'package:dio/dio.dart';",
      '',
      'class ApiClient {',
      "  final Dio _dio = Dio(BaseOptions(baseUrl: 'https://api.shop.dev'));",
      '  Future<Map<String, dynamic>> post(String path, {Object? body}) async =>',
      '      (await _dio.post(path, data: body)).data;',
      '}',
    ].join('\n'),
  },
  {
    path: 'lib/router/app_router.dart',
    text: [
      "import 'package:go_router/go_router.dart';",
      '',
      'final router = GoRouter(routes: [',
      "  GoRoute(path: '/', builder: (c, s) => const HomeScreen()),",
      "  GoRoute(path: '/profile', builder: (c, s) => const ProfileScreen()),",
      ']);',
    ].join('\n'),
  },
  {
    path: 'lib/features/settings/settings_controller.dart',
    text: 'class SettingsController {\n  bool darkMode = false;\n}\n',
  },
];

function modelFor(sources) {
  const roleOf = (p) => (p.includes('screen') ? 'screen' : p.includes('router') ? 'router' : p.includes('service') || p.includes('api') ? 'service' : 'other');
  return {
    files: sources.map((s, i) => ({ id: i, path: s.path, role: roleOf(s.path), types: [], loc: s.text.split('\n').length })),
    screens: [{ name: 'ProfileScreen', file: 'lib/features/profile/profile_screen.dart' }],
    apis: [{ method: 'POST', url: '/orders', file: 'lib/api/api_client.dart' }],
  };
}

const MODEL = modelFor(SOURCES);

/** Minimal writable that records everything written to it. */
function sink() {
  const s = { text: '', write(chunk) { s.text += String(chunk); return true; } };
  return s;
}

/** A fetch Response whose body arrives in the given chunks (strings or bytes). */
function streamResponse(chunks, { status = 200, contentType = 'text/event-stream' } = {}) {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(typeof c === 'string' ? enc.encode(c) : c);
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}

const ENV_KEYS = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'MRM_ANTHROPIC_MODEL',
  'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'MRM_OPENAI_MODEL',
  'OLLAMA_HOST', 'MRM_OLLAMA_MODEL', 'MRM_OLLAMA_NUM_CTX',
];
let savedEnv;
let savedFetch;
let fetchCalls;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  savedFetch = globalThis.fetch;
  fetchCalls = [];
  // Default: any network use fails the test loudly.
  globalThis.fetch = async (url) => {
    fetchCalls.push(String(url));
    throw new Error(`unexpected network call to ${url}`);
  };
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  globalThis.fetch = savedFetch;
});

// ---------------------------------------------------------------------------
// retrieve()
// ---------------------------------------------------------------------------

describe('tokenize', () => {
  test('splits camelCase, PascalCase and snake_case, drops stopwords, folds plurals', () => {
    assert.deepEqual(splitWords('HTTPClient checkout_service placeOrder'), ['http', 'client', 'checkout', 'service', 'place', 'order']);
    assert.deepEqual(tokenize('How does the CheckoutService talk to the APIs?'), ['checkout', 'service', 'talk', 'api']);
  });
});

describe('retrieve', () => {
  test('ranks checkout_service.dart above profile_screen.dart for a checkout/api question', () => {
    const results = retrieve('how does checkout talk to the api', MODEL, SOURCES);
    const paths = results.map((r) => r.path);
    const checkout = paths.indexOf('lib/features/checkout/checkout_service.dart');
    const profile = paths.indexOf('lib/features/profile/profile_screen.dart');
    assert.ok(checkout !== -1 && checkout <= 1, `checkout service should be near the top: ${paths.join(', ')}`);
    assert.ok(profile === -1 || profile > checkout, `profile screen should rank lower: ${paths.join(', ')}`);
    assert.ok(!paths.includes('lib/features/settings/settings_controller.dart'), 'unrelated files are left out');
    for (let i = 1; i < results.length; i++) assert.ok(results[i - 1].score >= results[i].score, 'sorted by score');
  });

  test('uses declared type names from the analysis model', () => {
    const sources = [
      { path: 'lib/core/handlers.dart', text: 'part of core;\n\n// see model\n' },
      { path: 'lib/core/notes.dart', text: '// we might add payment options later\nconst x = 1;\n' },
    ];
    const model = { files: [
      { id: 'a', path: 'lib/core/handlers.dart', role: 'other', types: ['PaymentGateway'], loc: 3 },
      { id: 'b', path: 'lib/core/notes.dart', role: 'other', types: [], loc: 2 },
    ] };
    const results = retrieve('where is the payment gateway', model, sources);
    assert.equal(results[0].path, 'lib/core/handlers.dart');
  });

  test('navigation questions favour routers and screens', () => {
    const results = retrieve('how does navigation work in this app', MODEL, SOURCES);
    assert.equal(results[0].path, 'lib/router/app_router.dart');
    assert.ok(!results.some((r) => r.path.endsWith('settings_controller.dart')));
  });

  test('generated files rank below their hand-written source', () => {
    const body = 'class Order {\n  final String id;\n  Order.fromJson(Map json) : id = json["id"];\n}\n';
    const results = retrieve('order json model', null, [
      { path: 'lib/models/order.g.dart', text: body },
      { path: 'lib/models/order.dart', text: body },
    ]);
    assert.equal(results[0].path, 'lib/models/order.dart');
  });

  test('small files are included whole with original line numbers', () => {
    const [first] = retrieve('checkout service place order', MODEL, SOURCES);
    assert.equal(first.path, 'lib/features/checkout/checkout_service.dart');
    const lines = first.text.split('\n');
    assert.equal(lines[0], "   1| import 'package:shop/api/api_client.dart';");
    assert.equal(lines[2], '   3| class CheckoutService {');
    assert.equal(lines.length, 11);
    assert.ok(!first.text.includes('// …'));
  });

  test('large files keep the beginning plus windows around keyword hits, within budget', () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `  // filler line ${i + 1} nothing to see`);
    lines[1199] = '  final total = computeCheckoutTotal(cart);';
    lines[1799] = '  checkoutTotal += discount;';
    const [r] = retrieve('checkout total', null, [{ path: 'lib/big.dart', text: lines.join('\n') }], { maxChars: 3000 });
    assert.ok(r.text.length <= 3000, `excerpt is ${r.text.length} chars`);
    assert.ok(r.text.startsWith('   1| '), 'keeps the beginning of the file');
    assert.ok(r.text.includes('1200|   final total = computeCheckoutTotal(cart);'));
    assert.ok(r.text.includes('1800|   checkoutTotal += discount;'), 'second hit gets a window too');
    assert.ok(r.text.includes('1199| ') && r.text.includes('1201| '), 'context around the hit');
    assert.match(r.text, /^\/\/ … \(\d+ lines omitted\)$/m);
    assert.ok(!r.text.includes(' 600| '), 'far-away filler is omitted');
  });

  test('respects maxChars across files and maxFiles', () => {
    const sources = Array.from({ length: 20 }, (_, f) => ({
      path: `lib/feature_${f}/checkout_step_${f}.dart`,
      text: Array.from({ length: 400 }, (_, i) => `void checkoutStep${f}_${i}() => submitCheckout(${i});`).join('\n'),
    }));
    const results = retrieve('checkout submit', null, sources, { maxChars: 10000, maxFiles: 5 });
    assert.ok(results.length > 0 && results.length <= 5, `got ${results.length} files`);
    const total = results.reduce((s, r) => s + r.text.length, 0);
    assert.ok(total <= 10000, `total ${total} chars`);
    for (const r of results) assert.match(r.text, /^\s*\d+\| /);

    const tiny = retrieve('checkout submit', null, sources, { maxChars: 1500 });
    assert.ok(tiny.reduce((s, r) => s + r.text.length, 0) <= 1500);
  });

  test('returns nothing for empty input or unmatched questions', () => {
    assert.deepEqual(retrieve('checkout', MODEL, []), []);
    assert.deepEqual(retrieve('zzqx wvvy', null, SOURCES), []);
  });
});

// ---------------------------------------------------------------------------
// buildPrompt()
// ---------------------------------------------------------------------------

describe('buildPrompt', () => {
  test('returns system + user with context, labelled fenced snippets, then the question', () => {
    const snippets = [
      { path: 'lib/a.dart', text: '   1| void main() {}' },
      { path: 'ios/App/AppDelegate.swift', text: '   1| import UIKit' },
    ];
    const { system, user } = buildPrompt({ question: 'How does checkout work?', contextMd: '## Screens\n- CheckoutScreen', snippets });
    assert.equal(typeof system, 'string');
    assert.equal(typeof user, 'string');
    assert.match(system, /Flutter/);
    assert.match(system, /iOS/);
    assert.match(system, /path:line/);
    assert.match(system, /not visible/i);

    const ctx = user.indexOf('- CheckoutScreen');
    const a = user.indexOf('```dart lib/a.dart\n   1| void main() {}\n```');
    const b = user.indexOf('```swift ios/App/AppDelegate.swift\n');
    const q = user.indexOf('How does checkout work?');
    assert.ok(ctx !== -1 && a !== -1 && b !== -1 && q !== -1, user);
    assert.ok(ctx < a && a < b && b < q, 'context, then snippets in order, then the question');
    assert.ok(user.trimEnd().endsWith('How does checkout work?'));
  });

  test('uses a longer fence when a snippet itself contains backticks', () => {
    const { user } = buildPrompt({ question: 'q', contextMd: '', snippets: [{ path: 'lib/doc.dart', text: '   1| /// ```dart\n   2| /// x\n   3| /// ```' }] });
    assert.ok(user.includes('````dart lib/doc.dart\n'), user);
  });

  test('still produces a usable prompt with no context and no snippets', () => {
    const { user } = buildPrompt({ question: 'Where is login?' });
    assert.match(user, /No architecture summary/);
    assert.match(user, /No source files matched/);
    assert.ok(user.trimEnd().endsWith('Where is login?'));
  });
});

// ---------------------------------------------------------------------------
// ask()
// ---------------------------------------------------------------------------

describe('ask', () => {
  test('dry run with provider openai prints the prompt and never touches the network', async () => {
    const out = sink();
    const err = sink();
    const result = await ask({
      question: 'how does checkout talk to the api',
      model: MODEL,
      sources: SOURCES,
      contextMd: '# Shop app\n- 2 screens',
      provider: 'openai',
      dryRun: true,
      out,
      err,
    });
    assert.equal(fetchCalls.length, 0, 'no fetch');
    assert.equal(result.provider, 'openai');
    assert.equal(result.model, 'gpt-5-mini');
    assert.ok(result.files.includes('lib/features/checkout/checkout_service.dart'));
    assert.match(out.text, /===== SYSTEM =====/);
    assert.match(out.text, /===== USER =====/);
    assert.match(out.text, /# Shop app/);
    assert.match(out.text, /lib\/features\/checkout\/checkout_service\.dart/);
    assert.match(out.text, /how does checkout talk to the api/);
    assert.match(err.text, /Dry run/);
    assert.match(err.text, /openai/);
    assert.match(err.text, /gpt-5-mini/);
    assert.match(err.text, /\d+ file excerpts?/);
    assert.match(err.text, /\d+\.\d KB/);
  });

  test('dry run honours --model and works for every provider without network', async () => {
    for (const provider of PROVIDERS) {
      const out = sink();
      const err = sink();
      const res = await ask({ question: 'checkout', model: MODEL, sources: SOURCES, contextMd: '', provider, modelId: 'my-model', dryRun: true, out, err });
      assert.equal(res.model, 'my-model');
      assert.match(err.text, new RegExp(`${provider} \\(model: my-model\\)`));
    }
    assert.equal(fetchCalls.length, 0);
  });

  test('rejects unknown providers', async () => {
    await assert.rejects(
      ask({ question: 'q', model: MODEL, sources: SOURCES, contextMd: '', provider: 'gemini', dryRun: true, out: sink(), err: sink() }),
      (e) => e instanceof AiError && /anthropic, openai, ollama/.test(e.message),
    );
  });

  test('with nothing configured it explains the options, including the pbcopy route', async () => {
    globalThis.fetch = async (url) => { fetchCalls.push(String(url)); throw new TypeError('fetch failed'); };
    await assert.rejects(
      ask({ question: 'How does checkout work?', model: MODEL, sources: SOURCES, contextMd: '', out: sink(), err: sink() }),
      (e) => e instanceof Error
        && /ANTHROPIC_API_KEY/.test(e.message)
        && /OPENAI_API_KEY/.test(e.message)
        && /ollama pull qwen2\.5-coder/.test(e.message)
        && /mobile-repo-map context \. \| pbcopy/.test(e.message),
    );
    assert.deepEqual(fetchCalls, ['http://127.0.0.1:11434/api/tags'], 'only the local Ollama probe');
  });

  test('a dry run still works when no provider is configured', async () => {
    globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
    const out = sink();
    const res = await ask({ question: 'checkout', model: MODEL, sources: SOURCES, contextMd: '', dryRun: true, out, err: sink() });
    assert.equal(res.provider, null);
    assert.match(out.text, /===== USER =====/);
  });

  test('detectProvider order: anthropic key, then openai key, then a reachable Ollama', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.ANTHROPIC_API_KEY = 'test-key';
    assert.equal(await detectProvider(), 'anthropic');
    delete process.env.ANTHROPIC_API_KEY;
    assert.equal(await detectProvider(), 'openai');
    delete process.env.OPENAI_API_KEY;
    globalThis.fetch = async (url, init) => {
      assert.ok(init && init.signal, 'probe has a timeout signal');
      return jsonResponse({ models: [] });
    };
    assert.equal(await detectProvider(), 'ollama');
    globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
    assert.equal(await detectProvider(), null);
  });

  test('a real (stubbed) run announces provider, model and size on stderr before streaming', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.OPENAI_BASE_URL = 'http://openai.test/v1';
    const order = [];
    const err = { write(s) { order.push(['err', s]); } };
    const out = { write(s) { order.push(['out', s]); } };
    globalThis.fetch = async () => streamResponse(['data: {"choices":[{"delta":{"content":"Answer."}}]}\n\n', 'data: [DONE]\n\n']);
    const res = await ask({ question: 'how does checkout talk to the api', model: MODEL, sources: SOURCES, contextMd: 'ctx', provider: 'openai', out, err });
    assert.equal(res.provider, 'openai');
    assert.equal(order[0][0], 'err');
    assert.match(order[0][1], /Sending \d+ file excerpts? .* \(\d+\.\d KB in total\) to openai \(model: gpt-5-mini/);
    assert.equal(order.filter(([k]) => k === 'out').map(([, s]) => s).join(''), 'Answer.\n');
  });
});

// ---------------------------------------------------------------------------
// Providers (stubbed transports only)
// ---------------------------------------------------------------------------

describe('openai provider', () => {
  test('streams SSE deltas and sends max_completion_tokens without temperature', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.OPENAI_BASE_URL = 'http://openai.test/v1/';
    let request;
    globalThis.fetch = async (url, init) => {
      request = { url: String(url), init, body: JSON.parse(init.body) };
      const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"wörld"},"finish_reason":"stop"}]}\n\n');
      return streamResponse([
        ': keep-alive\n\n',
        'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Hello "}}]}\n',
        '\ndata: {"choices":[{"del',
        'ta":{"content":""}}]}\n\n',
        bytes.slice(0, 40), bytes.slice(40), // split inside the multi-byte character
        'data: [DONE]\n\n',
      ]);
    };
    const session = await openai.prepare({ modelId: 'gpt-test' });
    assert.equal(session.model, 'gpt-test');
    const out = sink();
    const err = sink();
    const res = await session.send({ system: 'SYS', user: 'USER', out, err });
    assert.equal(out.text, 'Hello wörld\n');
    assert.equal(res.stopReason, 'stop');
    assert.equal(request.url, 'http://openai.test/v1/chat/completions');
    assert.equal(request.init.headers.authorization, 'Bearer sk-test');
    assert.equal(request.body.stream, true);
    assert.equal(request.body.max_completion_tokens, 16000);
    assert.ok(!('max_tokens' in request.body));
    assert.ok(!('temperature' in request.body));
    assert.deepEqual(request.body.messages, [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'USER' }]);
  });

  test('model comes from --model, then MRM_OPENAI_MODEL, then gpt-5-mini', () => {
    assert.equal(openai.plannedModel('x'), 'x');
    process.env.MRM_OPENAI_MODEL = 'env-model';
    assert.equal(openai.plannedModel(undefined), 'env-model');
    delete process.env.MRM_OPENAI_MODEL;
    assert.equal(openai.plannedModel(undefined), 'gpt-5-mini');
  });

  test('friendly errors for a missing or rejected key and a truncation notice', async () => {
    await assert.rejects(openai.prepare({}), /OPENAI_API_KEY is not set/);
    process.env.OPENAI_API_KEY = 'sk-bad';
    globalThis.fetch = async () => jsonResponse({ error: { message: 'Incorrect API key' } }, 401);
    const session = await openai.prepare({});
    await assert.rejects(session.send({ system: 's', user: 'u', out: sink(), err: sink() }), (e) => e instanceof AiError && /401/.test(e.message));

    globalThis.fetch = async () => streamResponse(['data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n']);
    const err = sink();
    await session.send({ system: 's', user: 'u', out: sink(), err });
    assert.match(err.text, /cut off/);
  });

  test('falls back to max_tokens for servers that reject max_completion_tokens', async () => {
    process.env.OPENAI_BASE_URL = 'http://localhost:1234/v1'; // a keyless compatible server
    const bodies = [];
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      assert.ok(!('authorization' in init.headers));
      if ('max_completion_tokens' in body) return jsonResponse({ error: { message: 'Unrecognized request argument supplied: max_completion_tokens' } }, 400);
      return streamResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n']);
    };
    const session = await openai.prepare({});
    const out = sink();
    await session.send({ system: 's', user: 'u', out, err: sink() });
    assert.equal(out.text, 'ok\n');
    assert.equal(bodies.length, 2);
    assert.equal(bodies[1].max_tokens, 16000);
  });
});

describe('ollama provider', () => {
  test('normalizes OLLAMA_HOST like the Ollama CLI', () => {
    assert.equal(ollama.ollamaBaseUrl({}), 'http://127.0.0.1:11434');
    assert.equal(ollama.ollamaBaseUrl({ OLLAMA_HOST: '0.0.0.0' }), 'http://127.0.0.1:11434');
    assert.equal(ollama.ollamaBaseUrl({ OLLAMA_HOST: '0.0.0.0:9999' }), 'http://127.0.0.1:9999');
    assert.equal(ollama.ollamaBaseUrl({ OLLAMA_HOST: 'http://gpu-box:11434/' }), 'http://gpu-box:11434');
    assert.equal(ollama.ollamaBaseUrl({ OLLAMA_HOST: 'https://ollama.example.com' }), 'https://ollama.example.com');
  });

  test('picks the first installed model and streams NDJSON content', async () => {
    process.env.OLLAMA_HOST = '0.0.0.0:11434';
    const requests = [];
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith('/api/tags')) return jsonResponse({ models: [{ name: 'qwen2.5-coder:7b' }, { name: 'llama3:8b' }] });
      return streamResponse([
        '{"model":"qwen2.5-coder:7b","message":{"role":"assistant","content":"Local "},"done":false}\n',
        '{"model":"qwen2.5-coder:7b","message":{"role":"assistant","content":"answer"},"do',
        'ne":false}\n{"done":true,"done_reason":"stop"}\n',
      ], { contentType: 'application/x-ndjson' });
    };
    const session = await ollama.prepare({});
    assert.equal(session.model, 'qwen2.5-coder:7b');
    assert.equal(session.autoSelected, true);
    const out = sink();
    await session.send({ system: 'S', user: 'U', out, err: sink() });
    assert.equal(out.text, 'Local answer\n');
    const chat = requests.find((r) => r.url === 'http://127.0.0.1:11434/api/chat');
    const body = JSON.parse(chat.init.body);
    assert.equal(body.stream, true);
    assert.equal(body.model, 'qwen2.5-coder:7b');
    assert.ok(body.options.num_ctx >= 8192);
  });

  test('explains how to pull a model when none is installed', async () => {
    globalThis.fetch = async () => jsonResponse({ models: [] });
    await assert.rejects(ollama.prepare({}), /ollama pull qwen2\.5-coder/);
  });

  test('--model / MRM_OLLAMA_MODEL skip the tags lookup', async () => {
    process.env.MRM_OLLAMA_MODEL = 'mistral';
    const session = await ollama.prepare({});
    assert.equal(session.model, 'mistral');
    assert.equal(fetchCalls.length, 0);
  });
});

describe('anthropic provider', () => {
  function fakeClient({ ids = [], events = [], failures = [] } = {}) {
    const calls = [];
    return {
      calls,
      models: {
        list() {
          return (async function* list() { for (const id of ids) yield { id, type: 'model' }; }());
        },
      },
      beta: {
        messages: {
          stream(params) {
            calls.push(params);
            const failure = failures[calls.length - 1];
            return {
              async* [Symbol.asyncIterator]() {
                if (failure) throw failure;
                yield* events;
              },
              async finalMessage() {
                if (failure) throw failure;
                return { model: params.model, stop_reason: 'end_turn' };
              },
            };
          },
        },
      },
    };
  }
  const textEvents = (...parts) => parts.map((text) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }));

  test('auto-selects the newest "opus" model and enables server-side fallbacks', async () => {
    const client = fakeClient({ ids: ['test-sonnet-9', 'test-opus-8', 'test-opus-7'], events: textEvents('Hi ', 'there') });
    const session = await anthropic.prepare({ client });
    assert.equal(session.model, 'test-opus-8');
    assert.equal(session.autoSelected, true);
    const out = sink();
    await session.send({ system: 'SYS', user: 'USER', out, err: sink() });
    assert.equal(out.text, 'Hi there\n');
    const [params] = client.calls;
    assert.equal(params.model, 'test-opus-8');
    assert.equal(params.max_tokens, 16000);
    assert.equal(params.system, 'SYS');
    assert.deepEqual(params.messages, [{ role: 'user', content: 'USER' }]);
    assert.deepEqual(params.output_config, { effort: 'medium' });
    assert.deepEqual(params.betas, ['server-side-fallback-2026-07-01']);
    assert.equal(params.fallbacks, 'default');
    assert.ok(!('temperature' in params) && !('thinking' in params));
  });

  test('falls back to the first listed model when none matches', async () => {
    const session = await anthropic.prepare({ client: fakeClient({ ids: ['test-alpha-2', 'test-beta-1'] }) });
    assert.equal(session.model, 'test-alpha-2');
  });

  test('an explicit --model is used as-is, without fallbacks or a models lookup', async () => {
    const client = fakeClient({ ids: [], events: textEvents('ok\n') });
    client.models.list = () => { throw new Error('should not list models'); };
    const session = await anthropic.prepare({ client, modelId: 'pinned-model' });
    assert.equal(session.model, 'pinned-model');
    await session.send({ system: 's', user: 'u', out: sink(), err: sink() });
    assert.ok(!('fallbacks' in client.calls[0]) && !('betas' in client.calls[0]));
  });

  test('retries once without fallbacks when the server rejects them', async () => {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const rejection = new Anthropic.BadRequestError(
      400,
      { type: 'error', error: { type: 'invalid_request_error', message: 'fallbacks: Extra inputs are not permitted' } },
      'fallbacks: Extra inputs are not permitted',
      new Headers(),
    );
    const client = fakeClient({ ids: ['test-opus-1'], events: textEvents('second try'), failures: [rejection] });
    const session = await anthropic.prepare({ client });
    const out = sink();
    await session.send({ system: 's', user: 'u', out, err: sink() });
    assert.equal(out.text, 'second try\n');
    assert.equal(client.calls.length, 2);
    assert.equal(client.calls[0].fallbacks, 'default');
    assert.ok(!('fallbacks' in client.calls[1]) && !('betas' in client.calls[1]));
  });

  test('turns SDK errors into friendly messages', async () => {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const auth = new Anthropic.AuthenticationError(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'invalid x-api-key', new Headers());
    const authClient = fakeClient();
    authClient.models.list = () => (async function* fail() { throw auth; }());
    await assert.rejects(anthropic.prepare({ client: authClient }), (e) => e instanceof AiError && /ANTHROPIC_API_KEY/.test(e.message));

    const limited = new Anthropic.RateLimitError(429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, 'slow down', new Headers({ 'retry-after': '7' }));
    const session = await anthropic.prepare({ client: fakeClient({ failures: [limited] }), modelId: 'm' });
    await assert.rejects(session.send({ system: 's', user: 'u', out: sink(), err: sink() }), (e) => e instanceof AiError && /429/.test(e.message) && /7s/.test(e.message));

    const offline = new Anthropic.APIConnectionError({ message: 'Connection error.' });
    const session2 = await anthropic.prepare({ client: fakeClient({ failures: [offline] }), modelId: 'm' });
    await assert.rejects(session2.send({ system: 's', user: 'u', out: sink(), err: sink() }), (e) => e instanceof AiError && /Could not reach/.test(e.message));
  });

  test('reports refusals and truncation on stderr', async () => {
    for (const [reason, pattern] of [['refusal', /declined/], ['max_tokens', /cut off/]]) {
      const client = fakeClient({ events: textEvents('partial') });
      const original = client.beta.messages.stream;
      client.beta.messages.stream = (params) => {
        const s = original(params);
        s.finalMessage = async () => ({ model: params.model, stop_reason: reason });
        return s;
      };
      const session = await anthropic.prepare({ client, modelId: 'm' });
      const err = sink();
      await session.send({ system: 's', user: 'u', out: sink(), err });
      assert.match(err.text, pattern);
    }
  });
});
