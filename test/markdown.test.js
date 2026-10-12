import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, renderAiContext } from '../src/report/markdown.js';

function sampleModel() {
  return {
    tool: { name: 'mobile-repo-map', version: '0.1.0' },
    generatedAt: '2026-10-12T09:30:00.000Z',
    project: {
      name: 'Shop App',
      platforms: ['flutter'],
      stack: {
        stateManagement: ['riverpod'],
        navigation: ['go_router'],
        networking: ['dio'],
        storage: [],
        backend: ['firebase'],
      },
      dependencies: ['dio', 'go_router', 'flutter_riverpod'],
      editorRoot: '/tmp/shop',
    },
    stats: {
      files: 5, sourceFiles: 4, testFiles: 1, loc: 760, screens: 2, routes: 2,
      navEdges: 3, apiEndpoints: 1, urls: 1, cycles: 1, avgComplexity: 4.25,
    },
    health: {
      score: 82,
      grade: 'B',
      breakdown: [
        { label: 'Import cycles', penalty: 6, detail: '1 cycle | 2 files' },
        { label: 'Complexity', penalty: 0, detail: 'fine' },
      ],
    },
    files: [
      { id: 0, path: 'lib/main.dart', lang: 'dart', role: 'entry', module: 0, loc: 40, complexity: 2, fanIn: 0, fanOut: 2, tested: false, churn: 3, isTest: false, isGenerated: false, types: ['App'] },
      { id: 1, path: 'lib/ui/home_screen.dart', lang: 'dart', role: 'screen', module: 1, loc: 300, complexity: 12, fanIn: 2, fanOut: 2, tested: true, churn: 9, isTest: false, isGenerated: false, types: ['HomeScreen', '_HomeState'] },
      { id: 2, path: 'lib/ui/cart [old].dart', lang: 'dart', role: 'screen', module: 1, loc: 200, complexity: 8, fanIn: 1, fanOut: 1, tested: false, churn: 1, isTest: false, isGenerated: false, types: ['CartScreen'] },
      { id: 3, path: 'lib/data/api.dart', lang: 'dart', role: 'service', module: 2, loc: 120, complexity: 30, fanIn: 2, fanOut: 0, tested: false, churn: 2, isTest: false, isGenerated: false, types: ['Api'] },
      { id: 4, path: 'test/home_test.dart', lang: 'dart', role: 'test', module: 3, loc: 100, complexity: 1, fanIn: 0, fanOut: 1, tested: false, churn: 1, isTest: true, isGenerated: false, types: [] },
    ],
    edges: [[0, 1], [1, 2], [2, 1], [1, 3], [2, 3]],
    modules: [
      { id: 0, name: 'app', files: 1, loc: 40, roles: { entry: 1 } },
      { id: 1, name: 'ui "core"', files: 2, loc: 500, roles: { screen: 2 } },
      { id: 2, name: 'data', files: 1, loc: 120, roles: { service: 1 } },
      { id: 3, name: 'test', files: 1, loc: 100, roles: { test: 1 } },
    ],
    moduleEdges: [[0, 1, 1], [1, 2, 2], [3, 1, 1]],
    screens: [
      { id: 0, name: 'HomeScreen', file: 1, line: 10, kind: 'widget', routes: ['/'], entry: true },
      { id: 1, name: 'Cart<Item>', file: 2, line: 5, kind: 'widget', routes: ['/cart|x'], entry: false },
    ],
    routes: [
      { path: '/', name: 'home', screen: 0, file: 0, line: 20, source: 'go_router' },
      { path: '/cart|x', name: 'cart', screen: 1, file: 0, line: 24, source: 'go_router' },
    ],
    nav: {
      nodes: [
        { id: 'app', label: 'App', kind: 'app' },
        { id: 's:0', label: 'HomeScreen', kind: 'screen', screen: 0, file: 1 },
        { id: 's:1', label: 'Cart [beta] "x"', kind: 'screen', screen: 1, file: 2 },
      ],
      edges: [
        { from: 'app', to: 's:0', kind: 'root', method: 'MaterialApp', file: 0, line: 12 },
        { from: 's:0', to: 's:1', kind: 'push', method: 'push', file: 1, line: 40 },
        { from: 's:0', to: 's:1', kind: 'push', method: 'push', file: 1, line: 55 },
        { from: 's:1', to: 's:0', kind: 'modal', method: 'showDialog', file: 2, line: 22 },
      ],
      entries: ['app'],
    },
    apis: [
      { id: 0, method: 'GET', url: '/products', resolved: 'https://api.shop.dev/products', client: 'dio', file: 3, line: 12, usedBy: [0, 1], host: 'api.shop.dev' },
      { id: 1, method: 'URL', url: 'https://shop.dev/terms', resolved: 'https://shop.dev/terms', client: null, file: 1, line: 30, usedBy: [], host: 'shop.dev' },
    ],
    bases: [{ url: 'https://api.shop.dev', file: 3, line: 3 }],
    risks: {
      cycles: [{ size: 2, files: [1, 2], examples: [[1, 2]] }],
      moduleCycles: [{ modules: [1, 2] }],
      complex: [{ file: 3, score: 30, reasons: ['deep nesting', 'long function'] }],
      hotspots: [{ file: 1, churn: 9, complexity: 12, score: 108 }],
      untested: { byRole: [{ role: 'screen', total: 2, tested: 1 }, { role: 'service', total: 1, tested: 0 }], files: [2, 3] },
      godFiles: [{ file: 1, fanIn: 2, fanOut: 2 }],
    },
  };
}

/** Large model: many modules and a long navigation chain to exercise truncation. */
function bigModel() {
  const model = sampleModel();
  model.modules = Array.from({ length: 30 }, (_, i) => ({
    id: i, name: `mod${i}`, files: 2, loc: 1000 - i, roles: { widget: 2 },
  }));
  model.moduleEdges = [];
  for (let i = 0; i < 30; i++) {
    for (let j = 0; j < 30; j++) if (i !== j && (i + j) % 3 === 0) model.moduleEdges.push([i, j, (i * j) % 7 + 1]);
  }
  const nodes = [{ id: 'app', label: 'App', kind: 'app' }];
  const edges = [];
  for (let i = 0; i < 100; i++) {
    nodes.push({ id: `s${i}`, label: `Screen${i}`, kind: 'screen' });
    edges.push({ from: i === 0 ? 'app' : `s${i - 1}`, to: `s${i}`, kind: i % 5 === 0 ? 'modal' : 'push' });
  }
  edges.push({ from: 's99', to: 'app', kind: 'go' });
  model.nav = { nodes, edges, entries: ['app'] };
  model.files = [];
  model.apis = [];
  for (let i = 0; i < 200; i++) {
    model.files.push({ id: i, path: `lib/feature${i}/file_${i}.dart`, role: 'widget', module: i % 30, loc: 50 + i, fanIn: i % 9, fanOut: i % 4 });
    model.apis.push({ id: i, method: 'POST', url: `https://api.big.dev/v1/resource/${i}`, client: 'http', file: i, line: i + 1, usedBy: [], host: 'api.big.dev' });
  }
  return model;
}

function mermaidBlocks(md) {
  return [...md.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]);
}

test('renders title, generated note and section headings', () => {
  const md = renderMarkdown(sampleModel());
  assert.match(md, /^# Shop App — Architecture\n/);
  assert.ok(md.includes('_Generated by [MobileRepoMap](https://github.com/ananya-kaul/mobile-repo-map) v0.1.0 on 2026-10-12. Static analysis — verify before relying on it._'));
  for (const h of ['## At a glance', '## Module map', '## Navigation', '### Routes', '## Screens', '## API surface', '## Risks', '## Health score']) {
    assert.ok(md.includes(`\n${h}\n`), `missing heading ${h}`);
  }
  assert.ok(md.includes('| Health score | **82/100** (grade B) |'));
  assert.ok(md.includes('- **Navigation:** go_router'));
  assert.ok(md.includes('- **Storage:** _none detected_'));
  assert.ok(!/undefined|NaN|\[object Object\]/.test(md));
});

test('emits mermaid flowcharts with sanitized ids and escaped labels', () => {
  const md = renderMarkdown(sampleModel());
  const blocks = mermaidBlocks(md);
  assert.equal(blocks.length, 2);
  for (const block of blocks) {
    assert.ok(block.startsWith('flowchart LR\n'));
    for (const line of block.trim().split('\n').slice(1)) {
      const node = /^ {2}([mn]\d+)(\["|\(\["|\[\["|\(\(")(.*?)("\]|"\]\)|"\]\]|"\)\))$/.exec(line);
      const edge = /^ {2}[mn]\d+ (-->|-\.->)(\|[\w .:/-]+\|)? [mn]\d+$/.exec(line);
      const style = /^ {2}(classDef|class) [\w,]+( \S+)?$/.exec(line);
      assert.ok(node || edge || style, `unexpected mermaid line: ${line}`);
      if (node) {
        const label = node[3].replace(/<br\/>/g, '');
        assert.ok(!/["[\]()<>{}|`]/.test(label), `unescaped label: ${line}`);
      }
    }
  }
  const [modules, nav] = blocks;
  assert.ok(modules.includes('["ui #quot;core#quot;<br/>2 files"]'));
  assert.ok(modules.includes('classDef role_screen'));
  assert.ok(modules.includes('classDef role_service'));
  assert.ok(nav.includes('Cart #91;beta#93; #quot;x#quot;'));
  // app -> home is a labelled root edge, home -> cart a plain (deduplicated) push, cart -> home a modal.
  assert.ok(nav.includes('n0 -->|root| n1'));
  assert.equal(nav.split('\n').filter((l) => l === '  n1 --> n2').length, 1);
  assert.ok(nav.includes('n2 -.->|modal| n1'));
  assert.ok(nav.includes('classDef entry'));
  assert.ok(nav.includes('class n0 entry'));
});

test('tables escape pipes and link to files relative to linkBase', () => {
  const model = sampleModel();
  const md = renderMarkdown(model);
  assert.ok(md.includes('`/cart\\|x`'), 'pipe in route path must be escaped');
  assert.ok(md.includes('1 cycle \\| 2 files'), 'pipe in health detail must be escaped');
  assert.ok(md.includes('Cart\\<Item\\>'), 'angle brackets in screen name must be escaped');
  assert.ok(md.includes('[`lib/ui/home_screen.dart:10`](lib/ui/home_screen.dart#L10)'));
  assert.ok(md.includes('(lib/ui/cart%20%5Bold%5D.dart#L5)'), 'path with spaces/brackets must be URL-encoded');

  const nested = renderMarkdown(model, { linkBase: '../' });
  assert.ok(nested.includes('](../lib/ui/home_screen.dart#L10)'));
  const remote = renderMarkdown(model, { linkBase: 'https://github.com/o/r/blob/main' });
  assert.ok(remote.includes('](https://github.com/o/r/blob/main/lib/data/api.dart#L12)'));
  const plain = renderMarkdown(model, { linkBase: null });
  assert.ok(plain.includes('| `lib/data/api.dart:12` |'));
  assert.ok(!plain.includes('](lib/'));
});

test('API surface groups by host, lists bases first and hides URL literals in details', () => {
  const md = renderMarkdown(sampleModel());
  const api = md.slice(md.indexOf('## API surface'), md.indexOf('## Risks'));
  assert.ok(api.indexOf('**Base URLs**') < api.indexOf('### api.shop.dev (1)'));
  assert.ok(api.includes('| `GET` | `https://api.shop.dev/products` | dio | [`lib/data/api.dart:12`](lib/data/api.dart#L12) | Cart\\<Item\\>, HomeScreen |'));
  const detailsStart = api.indexOf('<details>');
  assert.ok(detailsStart > 0);
  assert.ok(api.includes('<summary>1 plain URL literal</summary>'));
  assert.equal(api.indexOf('https://shop.dev/terms') > detailsStart, true, 'URL literal only inside <details>');
  assert.ok(!api.includes('`URL`'));
});

test('risks show cycle chains, complex files, hotspots, coverage and god files', () => {
  const md = renderMarkdown(sampleModel());
  assert.ok(md.includes('  - `lib/ui/home_screen.dart` → `lib/ui/cart [old].dart` → `lib/ui/home_screen.dart`'));
  assert.ok(md.includes('- `ui "core"` ↔ `data`'));
  assert.ok(md.includes('deep nesting; long function'));
  assert.ok(md.includes('| Commits (12 mo) |'));
  assert.ok(md.includes('| screen | 2 | 1 | 50% |'));
  assert.ok(md.includes('<summary>2 untested source files</summary>'));
  assert.ok(md.includes('| Import cycles | -6 | 1 cycle \\| 2 files |'));
});

test('large models are truncated with explicit notes', () => {
  const md = renderMarkdown(bigModel());
  const [modules, nav] = mermaidBlocks(md);
  const moduleNodes = modules.split('\n').filter((l) => /^ {2}m\d+\["/.test(l));
  const moduleEdges = modules.split('\n').filter((l) => /^ {2}m\d+ -->/.test(l));
  assert.equal(moduleNodes.length, 25);
  assert.ok(moduleEdges.length <= 60);
  assert.ok(md.includes('the 25 largest of 30 modules (by lines of code)'));
  assert.match(md, /the 60 heaviest of \d+ module dependencies \(\d+ omitted\)/);

  const navEdges = nav.split('\n').filter((l) => /^ {2}n\d+ (-->|-\.->)/.test(l));
  assert.equal(navEdges.length, 80);
  assert.ok(md.includes('showing 80 of 101 distinct navigation edges (21 omitted)'));
  // BFS from the entry: the first edge drawn leaves the entry node.
  assert.match(navEdges[0], /^ {2}n0 /);
});

test('empty and missing models render empty states without throwing', () => {
  for (const model of [{}, null, undefined, { files: [], modules: [], nav: { nodes: [], edges: [], entries: [] }, apis: [], risks: {} }]) {
    const md = renderMarkdown(model);
    assert.match(md, /^# Project — Architecture/);
    assert.ok(md.includes('on an unknown date'));
    for (const empty of [
      '_No modules detected._', '_No navigation detected._', '_No routes detected._', '_No screens detected._',
      '_No API calls detected._', '_No import cycles detected._', '_No module cycles detected._',
      '_No git history available — hotspot analysis skipped._', '_No god files detected._', '_No health score computed._',
    ]) {
      assert.ok(md.includes(empty), `missing empty state ${empty}`);
    }
    assert.ok(!md.includes('```mermaid'));
    assert.ok(!/undefined|NaN|\[object Object\]/.test(md));
    const ai = renderAiContext(model);
    assert.ok(ai.includes('# Project — codebase context'));
    assert.ok(!/undefined|NaN|\[object Object\]/.test(ai));
  }
});

test('output is deterministic', () => {
  assert.equal(renderMarkdown(bigModel()), renderMarkdown(bigModel()));
  assert.equal(renderAiContext(bigModel()), renderAiContext(bigModel()));
});

test('ai context lists stack, screens, navigation, APIs, risks and key files', () => {
  const ai = renderAiContext(sampleModel());
  assert.ok(ai.includes('- Stack: State management: riverpod; Navigation: go_router; Networking: dio; Backend: firebase'));
  assert.ok(ai.includes('- HomeScreen [widget, entry] routes: / — lib/ui/home_screen.dart:10'));
  assert.ok(ai.includes('- ui "core" — 2 files, 500 LOC; roles: screen 2'));
  assert.ok(ai.includes('- data — 1 file, 120 LOC; roles: service 1'));
  assert.ok(ai.includes('3 navigation edges, 1 API endpoint\n'));
  assert.ok(ai.includes('App -> HomeScreen (root)'));
  assert.ok(ai.includes('HomeScreen -> Cart [beta] "x" (push)'));
  assert.ok(ai.includes('Cart [beta] "x" -> HomeScreen (modal)'));
  assert.ok(ai.includes('BASE https://api.shop.dev (lib/data/api.dart:3)'));
  assert.ok(ai.includes('GET https://api.shop.dev/products (lib/data/api.dart:12) used by Cart<Item>, HomeScreen'));
  assert.ok(!ai.includes('URL https://shop.dev/terms'));
  assert.ok(ai.includes('- Cycle: lib/ui/home_screen.dart -> lib/ui/cart [old].dart -> lib/ui/home_screen.dart'));
  assert.ok(ai.includes('- Module cycle: ui "core" <-> data'));
  assert.ok(ai.includes('- lib/ui/home_screen.dart [screen] 300 LOC'));
  assert.ok(!ai.includes('test/home_test.dart ['), 'test files are not key files');
  assert.ok(!ai.includes('truncated'));
});

test('ai context respects maxChars and drops lower-priority lists first', () => {
  const model = bigModel();
  const full = renderAiContext(model, { maxChars: Infinity });
  assert.ok(!full.includes('truncated'));
  assert.ok(full.length > 8000);

  for (const maxChars of [8000, 4000, 1500, 600, 200, 50, 1]) {
    const ai = renderAiContext(model, { maxChars });
    assert.ok(ai.length <= maxChars, `length ${ai.length} > ${maxChars}`);
    if (maxChars >= 200) assert.ok(ai.includes('…truncated'), `missing truncation note at ${maxChars}`);
  }

  const mid = renderAiContext(model, { maxChars: 4000 });
  // Key files and navigation go before screens and risks.
  assert.ok(mid.includes('## Risks\n- Import cycles: 1'));
  assert.match(mid, /## Key files[^\n]*\n_\d+ files omitted for length\._/);
  assert.match(mid, /## Navigation[^\n]*\n[^\n]*\n_\d+ edges omitted for length\._/);
  assert.ok(mid.includes('- HomeScreen [widget, entry]'));

  const tiny = renderAiContext(sampleModel(), { maxChars: 24000 });
  assert.equal(tiny, renderAiContext(sampleModel()));
});
