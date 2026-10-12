import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from '../src/analyze.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const example = (name) => path.join(here, '..', 'examples', name);

const screenName = (model, id) => model.screens[id].name;
const nodeLabel = (model, id) => model.nav.nodes.find((n) => n.id === id).label;
const hasEdge = (model, from, to, kind) => model.nav.edges.some((e) => nodeLabel(model, e.from) === from
  && nodeLabel(model, e.to) === to && (!kind || e.kind === kind));

test('flutter_shop: stack, routes and screens', () => {
  const m = analyze(example('flutter_shop'), { git: false, editor: 'none' });
  assert.deepEqual(m.project.platforms, ['flutter']);
  assert.equal(m.project.name, 'flutter_shop');
  assert.ok(m.project.stack.stateManagement.includes('Riverpod'));
  assert.ok(m.project.stack.navigation.includes('go_router'));
  assert.ok(m.project.stack.networking.includes('dio'));

  const routes = Object.fromEntries(m.routes.map((r) => [r.path, r.screen === null ? null : screenName(m, r.screen)]));
  assert.equal(routes['/cart'], 'CartScreen');
  assert.equal(routes['/product/:id'], 'ProductDetailScreen');
  assert.equal(routes['/product/:id/reviews'], 'ProductReviewsScreen', 'nested route path is joined to its parent');
  assert.equal(routes['/orders'], 'OrdersScreen', 'wrapper widgets are skipped in favour of the screen');

  const entry = m.screens.filter((s) => s.entry).map((s) => s.name);
  assert.deepEqual(entry, ['SplashScreen']);
  assert.ok(!m.screens.some((s) => s.name === 'FilterSheet'), 'bottom sheets are not promoted to screens');
});

test('flutter_shop: navigation edges', () => {
  const m = analyze(example('flutter_shop'), { git: false, editor: 'none' });
  assert.ok(hasEdge(m, 'CartScreen', 'CheckoutScreen'), 'pushNamed by route name');
  assert.ok(hasEdge(m, 'ProductDetailScreen', 'ImageViewerScreen'), 'Navigator.push(MaterialPageRoute)');
  assert.ok(hasEdge(m, 'SplashScreen', 'HomeScreen', 'go'), 'context.go with enum path');
  assert.ok(hasEdge(m, 'AuthController', 'LoginScreen'), 'navigation from a notifier becomes a source node');
  // ProductCard (a reusable widget) pushes /product/:id; it is attributed to the screens that use it
  const viaCard = m.nav.edges.filter((e) => e.via === 'ProductCard');
  assert.ok(viaCard.length > 0);
  assert.ok(viaCard.every((e) => nodeLabel(m, e.to) === 'ProductDetailScreen'));
});

test('flutter_shop: API calls resolve constants', () => {
  const m = analyze(example('flutter_shop'), { git: false, editor: 'none' });
  const calls = m.apis.map((a) => `${a.method} ${a.url}`);
  for (const c of ['GET /products', 'GET /products/{id}', 'POST /cart/items', 'DELETE /cart/items/{itemId}', 'POST /checkout', 'POST /auth/login', 'FIRESTORE orders']) {
    assert.ok(calls.includes(c), `missing ${c}`);
  }
  assert.deepEqual(m.bases.map((b) => b.url), ['https://api.flutter-shop.dev/v1']);
  const products = m.apis.find((a) => a.method === 'GET' && a.url === '/products');
  assert.equal(products.host, 'api.flutter-shop.dev');
  assert.ok(products.usedBy.map((id) => screenName(m, id)).includes('HomeScreen'));
  assert.ok(!m.apis.some((a) => m.files[a.file].isTest), 'test files never contribute API calls');
});

test('flutter_shop: risks', () => {
  const m = analyze(example('flutter_shop'), { git: false, editor: 'none' });
  assert.equal(m.risks.cycles.length, 1);
  const cyclePaths = m.risks.cycles[0].files.map((id) => path.posix.basename(m.files[id].path)).sort();
  assert.deepEqual(cyclePaths, ['cart_repository.dart', 'checkout_service.dart']);
  assert.equal(m.files[m.risks.complex[0].file].path, 'lib/features/checkout/presentation/checkout_screen.dart');
  const screens = m.risks.untested.byRole.find((r) => r.role === 'screen');
  assert.equal(screens.tested, 0);
  const cartRepo = m.files.find((f) => f.path.endsWith('cart_repository.dart'));
  assert.equal(cartRepo.tested, true);
  assert.equal(cartRepo.role, 'repository');
  assert.ok(m.health.score > 0 && m.health.score <= 100);
});

test('swiftui_notes: screens, entry and navigation', () => {
  const m = analyze(example('swiftui_notes'), { git: false, editor: 'none' });
  assert.ok(m.project.platforms.includes('ios'));
  assert.ok(m.project.stack.networking.includes('URLSession'));
  assert.ok(m.project.stack.networking.includes('Alamofire'));
  const names = m.screens.map((s) => s.name);
  for (const s of ['RootTabView', 'NotesListScreen', 'NoteDetailScreen', 'ScannerViewController', 'ScanResultViewController']) {
    assert.ok(names.includes(s), `missing screen ${s}`);
  }
  assert.ok(!names.includes('NoteRow'), 'row views are not screens');
  assert.deepEqual(m.screens.filter((s) => s.entry).map((s) => s.name), ['RootTabView']);
  assert.ok(hasEdge(m, 'NotesListScreen', 'NoteDetailScreen', 'push'), 'navigationDestination');
  assert.ok(hasEdge(m, 'NoteDetailScreen', 'NoteEditorScreen', 'modal'), 'sheet');
  assert.ok(hasEdge(m, 'SettingsScreen', 'PaywallScreen', 'modal'), 'fullScreenCover');
  assert.ok(hasEdge(m, 'ScannerViewController', 'ScanResultViewController', 'push'), 'UIKit pushViewController');
  assert.ok(m.nav.edges.some((e) => e.via === 'NoteRow'), 'NavigationLink inside a row is attributed to a screen');
});

test('swiftui_notes: APIs and risks', () => {
  const m = analyze(example('swiftui_notes'), { git: false, editor: 'none' });
  const calls = m.apis.map((a) => `${a.method} ${a.url}`);
  assert.ok(calls.includes('POST https://api.notesapp.dev/v1/sync'), 'Alamofire');
  assert.ok(calls.includes('WS wss://realtime.notesapp.dev/socket'), 'web socket');
  assert.ok(calls.includes('API /v1/notes'), 'endpoint enum');
  assert.equal(m.files[m.risks.complex[0].file].path, 'NotesApp/Sync/SyncEngine.swift');
  const store = m.files.find((f) => f.path.endsWith('NotesStore.swift'));
  assert.equal(store.tested, true);
  assert.equal(store.role, 'state');
  assert.equal(m.risks.cycles.length, 0);
});

test('model is JSON-serializable and ids are consistent', () => {
  for (const name of ['flutter_shop', 'swiftui_notes']) {
    const m = analyze(example(name), { git: false, editor: 'none' });
    const round = JSON.parse(JSON.stringify(m));
    assert.equal(round.files.length, m.files.length);
    m.files.forEach((f, i) => assert.equal(f.id, i));
    for (const [a, b] of m.edges) assert.ok(m.files[a] && m.files[b]);
    const nodeIds = new Set(m.nav.nodes.map((n) => n.id));
    for (const e of m.nav.edges) assert.ok(nodeIds.has(e.from) && nodeIds.has(e.to));
    for (const a of m.apis) for (const s of a.usedBy) assert.ok(m.screens[s]);
    assert.equal(m.project.editorRoot, null);
  }
});
