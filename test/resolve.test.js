import { test } from 'node:test';
import assert from 'node:assert/strict';
import { constantTable, evalExpr, findConstantRef } from '../src/resolve.js';
import { analyzeDart } from '../src/lang/dart.js';
import { analyzeSwift } from '../src/lang/swift.js';

// Constant tables are built from real analyzer facts so the tests exercise the
// same shapes analyze.js feeds into the resolver.

const DART_CONFIG = `
class ApiConfig {
  static const String baseUrl = 'https://api.x.dev';
  static const String host = 'api.x.dev';
}
class Endpoints {
  static String _api(String p) => '\${ApiConfig.baseUrl}/\$p';
  static String get users => _api('users');
  static String user(String id) => _api('users/\$id');
  static String post(String id, {String? lang}) => '\${ApiConfig.baseUrl}/posts/\$id';
}
enum AppRoute {
  cart('/cart'),
  callSummary('/call-summary');
  const AppRoute(this.path);
  final String path;
}
`;

const dartFacts = analyzeDart({ path: 'lib/config.dart', text: DART_CONFIG });
const dartTable = constantTable([dartFacts]);
const ev = (expr) => evalExpr(expr, dartTable, 'dart');

const SWIFT_CONFIG = String.raw`
enum API {
    static let baseURL = "https://api.notes.dev"
}
enum Endpoint: String {
    case notes = "/v1/notes"
}
`;
const swiftTable = constantTable([analyzeSwift({ path: 'App/API.swift', text: SWIFT_CONFIG })]);
const sev = (expr) => evalExpr(expr, swiftTable, 'swift');

// ---------------------------------------------------------------- constantTable

test('constantTable keys constants by Owner.name and bare name', () => {
  assert.equal(dartTable.get('ApiConfig.baseUrl'), "'https://api.x.dev'");
  assert.equal(dartTable.get('baseUrl'), "'https://api.x.dev'");
  assert.equal(dartTable.get('Endpoints.users'), "_api('users')");
});

test('constantTable keeps function parameters and skips bare keys for enum values', () => {
  assert.deepEqual(dartTable.get('Endpoints.user'), { expr: "_api('users/$id')", params: ['id'] });
  assert.equal(dartTable.get('AppRoute.cart'), "'/cart'");
  assert.equal(dartTable.has('cart'), false);
});

test('ambiguous duplicate constants are not used; identical duplicates are fine', () => {
  const fact = (owner, name, expr) => ({ constants: [{ owner, name, expr }] });
  const table = constantTable([
    fact('A', 'path', "'/a'"),
    fact('B', 'path', "'/b'"),
    fact('C', 'same', "'/s'"),
    fact('D', 'same', "'/s'"),
  ]);
  assert.deepEqual(evalExpr('path', table, 'dart'), { value: '{path}', resolved: false });
  assert.deepEqual(evalExpr('A.path', table, 'dart'), { value: '/a', resolved: true });
  assert.deepEqual(evalExpr('B.path', table, 'dart'), { value: '/b', resolved: true });
  assert.deepEqual(evalExpr('same', table, 'dart'), { value: '/s', resolved: true });
});

// ---------------------------------------------------------------- literals

test('string literals, raw strings and escapes', () => {
  assert.deepEqual(ev("'/plain'"), { value: '/plain', resolved: true });
  assert.deepEqual(ev('"/double"'), { value: '/double', resolved: true });
  assert.deepEqual(ev("r'/raw/$x'"), { value: '/raw/$x', resolved: true });
  assert.deepEqual(ev("'it\\'s'"), { value: "it's", resolved: true });
});

test('empty and missing expressions', () => {
  assert.deepEqual(ev(''), { value: null, resolved: false });
  assert.deepEqual(ev(null), { value: null, resolved: false });
  assert.deepEqual(ev(undefined), { value: null, resolved: false });
});

test('unknown identifiers become a {placeholder}', () => {
  assert.deepEqual(ev('unknownThing'), { value: '{unknownThing}', resolved: false });
  assert.deepEqual(ev('widget.productId'), { value: '{widget.productId}', resolved: false });
});

// ---------------------------------------------------------------- composition

test("concatenation ApiConfig.baseUrl + '/users'", () => {
  assert.deepEqual(ev("ApiConfig.baseUrl + '/users'"), { value: 'https://api.x.dev/users', resolved: true });
  assert.deepEqual(ev("baseUrl + '/a' + '/b'"), { value: 'https://api.x.dev/a/b', resolved: true });
  // unresolved parts poison the whole result
  assert.deepEqual(ev("baseUrl + missing"), { value: 'https://api.x.dev{missing}', resolved: false });
});

test("interpolation '\${ApiConfig.baseUrl}/users/$id' resolves the base and keeps {id}", () => {
  assert.deepEqual(ev(`'\${ApiConfig.baseUrl}/users/\$id'`), { value: 'https://api.x.dev/users/{id}', resolved: false });
});

test('interpolated member chains use the last identifier as placeholder', () => {
  assert.deepEqual(ev(`'/a/\${widget.item.id}'`), { value: '/a/{id}', resolved: false });
  assert.deepEqual(ev(`'\${unknown}/x'`), { value: '{unknown}/x', resolved: false });
});

test('Uri.parse(...) unwraps its argument', () => {
  assert.deepEqual(ev("Uri.parse('https://a.dev/x')"), { value: 'https://a.dev/x', resolved: true });
  assert.deepEqual(ev("Uri.parse(ApiConfig.baseUrl + '/v2')"), { value: 'https://api.x.dev/v2', resolved: true });
  assert.deepEqual(ev("Uri.tryParse('https://a.dev/t')"), { value: 'https://a.dev/t', resolved: true });
});

test("Uri.https('api.x.dev', '/v1/a') builds an absolute URL", () => {
  assert.deepEqual(ev("Uri.https('api.x.dev', '/v1/a')"), { value: 'https://api.x.dev/v1/a', resolved: true });
  assert.deepEqual(ev("Uri.https(ApiConfig.host, 'v1/b')"), { value: 'https://api.x.dev/v1/b', resolved: true });
  assert.deepEqual(ev("Uri.http('api.x.dev')"), { value: 'http://api.x.dev', resolved: true });
});

test('enhanced enum AppRoute.cart.path resolves to the enum value', () => {
  assert.deepEqual(ev('AppRoute.cart.path'), { value: '/cart', resolved: true });
  assert.deepEqual(ev('AppRoute.cart'), { value: '/cart', resolved: true });
  assert.deepEqual(ev('AppRoute.cart.name'), { value: '/cart', resolved: true }); // falls back to the owner prefix
});

test('getter helper Endpoints.users goes through _api()', () => {
  assert.deepEqual(ev('Endpoints.users'), { value: 'https://api.x.dev/users', resolved: true });
  assert.deepEqual(ev("_api('users')"), { value: 'https://api.x.dev/users', resolved: true });
});

test('helper binding Endpoints.user(userId) substitutes the base and leaves a path placeholder', () => {
  const r = ev('Endpoints.user(userId)');
  assert.equal(r.resolved, false);
  assert.match(r.value, /^https:\/\/api\.x\.dev\/users\/\{\w+\}$/);
  // The placeholder is named after the helper's parameter (`id`), not the
  // call-site argument (`userId`).
  assert.equal(r.value, 'https://api.x.dev/users/{id}');
});

test('helper binding with extra named arguments', () => {
  assert.deepEqual(ev("Endpoints.post(postId, lang: 'en')"), { value: 'https://api.x.dev/posts/{id}', resolved: false });
});

// When the call-site argument has the same name as the parameter, the binder
// substitutes the literal "'{id}'" (to avoid self-lookup), which flips
// `resolved` to true. The inline form `'${base}/users/$id'` is resolved:false,
// so the same URL gets two different verdicts.
test('Endpoints.user(id) is unresolved like the inline interpolation', () => {
  assert.deepEqual(ev('Endpoints.user(id)'), { value: 'https://api.x.dev/users/{id}', resolved: false });
});

test('an unknown helper with one literal argument is read as a path helper', () => {
  assert.deepEqual(ev("helper('orders')"), { value: '/orders', resolved: true });
  assert.deepEqual(ev("helper('https://abs.dev/x')"), { value: 'https://abs.dev/x', resolved: true });
});

test('.substring(n) slices resolved values and passes unresolved ones through', () => {
  assert.deepEqual(ev('AppRoute.cart.path.substring(1)'), { value: 'cart', resolved: true });
  assert.deepEqual(ev("'/abc'.substring(1)"), { value: 'abc', resolved: true });
  assert.equal(ev('missing.substring(1)').resolved, false);
});

test('trailing ! is ignored', () => {
  assert.deepEqual(ev('ApiConfig.baseUrl!'), { value: 'https://api.x.dev', resolved: true });
});

test('self-referential constants stop at the depth limit instead of looping', () => {
  const table = new Map([['a', 'b'], ['b', 'a']]);
  const r = evalExpr('a', table, 'dart');
  assert.equal(r.resolved, false);
  assert.match(r.value, /^\{[ab]\}$/);
});

// Regression: `Uri.parse(...)` followed by a chained call must not swallow the
// call into the argument and report source text as a resolved URL.
test('Uri.parse(...).replace(...) is not reported as a resolved garbage URL', () => {
  const r = ev("Uri.parse('https://x.dev').replace(path: '/y')");
  assert.ok(!(r.resolved && /['"()]/.test(r.value)), `got ${JSON.stringify(r)}`);
});

// ---------------------------------------------------------------- Swift

test('Swift URL(string: "\\(baseURL)/notes")! resolves the interpolation', () => {
  assert.deepEqual(sev(String.raw`URL(string: "\(baseURL)/notes")!`), { value: 'https://api.notes.dev/notes', resolved: true });
  assert.deepEqual(sev(String.raw`URL(string: "\(API.baseURL)/notes")!`), { value: 'https://api.notes.dev/notes', resolved: true });
  assert.deepEqual(sev(String.raw`URL(string: "\(API.baseURL)/n/\(id)")`), { value: 'https://api.notes.dev/n/{id}', resolved: false });
});

test('Swift baseURL.appendingPathComponent("notes") joins with one slash', () => {
  assert.deepEqual(sev('baseURL.appendingPathComponent("notes")'), { value: 'https://api.notes.dev/notes', resolved: true });
  assert.deepEqual(sev('API.baseURL.appendingPathComponent("/notes/")'), { value: 'https://api.notes.dev/notes/', resolved: true });
  assert.deepEqual(sev('baseURL.appending(path: "v2")'), { value: 'https://api.notes.dev/v2', resolved: true });
});

test('appending(...) path joining is Swift-only', () => {
  // In Dart mode there is no join: the call's prefix lookup falls back to the
  // receiver constant itself (same mechanism that maps AppRoute.cart.path).
  assert.deepEqual(evalExpr('baseURL.appending("x")', swiftTable, 'dart'), { value: 'https://api.notes.dev', resolved: true });
});

test('Swift enum raw values: Endpoint.notes.rawValue and .notes shorthand', () => {
  assert.deepEqual(sev('Endpoint.notes.rawValue'), { value: '/v1/notes', resolved: true });
  assert.deepEqual(sev('Endpoint.notes'), { value: '/v1/notes', resolved: true });
  assert.deepEqual(sev('.notes'), { value: '/v1/notes', resolved: true });
});

// Regression: `URL(string:)` followed by `.appendingPathComponent` resolves both parts.
test('Swift URL(string: base)!.appendingPathComponent("notes")', () => {
  assert.deepEqual(sev('URL(string: API.baseURL)!.appendingPathComponent("notes")'), { value: 'https://api.notes.dev/notes', resolved: true });
  const lit = sev('URL(string: "https://x.dev/a")!.appending(path: "b")');
  assert.ok(!(lit.resolved && /['"()]/.test(lit.value)), `got ${JSON.stringify(lit)}`);
});

// ---------------------------------------------------------------- findConstantRef

test('findConstantRef finds AppRoute.callSummary inside page(AppRoute.callSummary, id)', () => {
  assert.deepEqual(findConstantRef('page(AppRoute.callSummary, id)', dartTable, 'dart'), { value: '/call-summary', resolved: true });
});

test('findConstantRef falls back to a leading-slash literal, else null', () => {
  assert.deepEqual(findConstantRef("open(ctx, '/lit')", dartTable, 'dart'), { value: '/lit', resolved: true });
  assert.equal(findConstantRef("open('no-slash')", dartTable, 'dart'), null);
  assert.equal(findConstantRef('foo(bar)', dartTable, 'dart'), null);
});

test('findConstantRef works with Swift shorthand cases', () => {
  assert.deepEqual(findConstantRef('request(Endpoint.notes, body)', swiftTable, 'swift'), { value: '/v1/notes', resolved: true });
});
