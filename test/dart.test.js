import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDart } from '../src/lang/dart.js';

const dart = (text, path = 'lib/main.dart') => analyzeDart({ path, text });
const type = (facts, name) => facts.types.find((t) => t.name === name);
const constant = (facts, owner, name) => facts.constants.find((c) => c.owner === owner && c.name === name);
const navTo = (facts, cls) => facts.navigation.filter((n) => n.classes.includes(cls));
const navExpr = (facts, expr) => facts.navigation.find((n) => n.expr === expr);
const api = (facts, expr) => facts.apis.find((a) => a.expr === expr);

// ---------------------------------------------------------------- types

const WIDGETS = `
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
export 'src/widgets.dart';
part 'main.g.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});
  @override
  Widget build(BuildContext context) => const Text('hi');
}

@RoutePage()
class CartScreen extends ConsumerStatefulWidget {
  const CartScreen({super.key});
  @override
  ConsumerState<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends ConsumerState<CartScreen> {
  @override
  Widget build(BuildContext context) {
    return const SizedBox();
  }
}

class _ClockState extends State<Clock> with TickerProviderStateMixin implements Ticker, Listenable<int> {}
abstract class Repo {}
mixin Logs on Object {}
extension StringX on String {}
`;

test('detects StatelessWidget and ConsumerStatefulWidget classes', () => {
  const f = dart(WIDGETS);
  assert.equal(type(f, 'HomeScreen').kind, 'class');
  assert.equal(type(f, 'HomeScreen').extends, 'StatelessWidget');
  assert.equal(type(f, 'HomeScreen').stateOf, null);
  assert.equal(type(f, 'CartScreen').extends, 'ConsumerStatefulWidget');
  assert.equal(type(f, 'HomeScreen').line, 7);
});

test('_FooState extends ConsumerState<Foo> maps stateOf to the widget', () => {
  const f = dart(WIDGETS);
  assert.equal(type(f, '_CartScreenState').extends, 'ConsumerState');
  assert.equal(type(f, '_CartScreenState').stateOf, 'CartScreen');
  const clock = type(f, '_ClockState');
  assert.equal(clock.stateOf, 'Clock');
  assert.deepEqual(clock.mixins, ['TickerProviderStateMixin']);
  assert.deepEqual(clock.implements, ['Ticker', 'Listenable']);
});

test('@RoutePage() annotation is attached to the following class only', () => {
  const f = dart(WIDGETS);
  assert.deepEqual(type(f, 'CartScreen').annotations, ['RoutePage']);
  assert.deepEqual(type(f, 'HomeScreen').annotations, []);
  assert.deepEqual(type(f, '_CartScreenState').annotations, []);
});

test('abstract classes, mixins and extensions are recognized', () => {
  const f = dart(WIDGETS);
  assert.equal(type(f, 'Repo').kind, 'class');
  assert.equal(type(f, 'Logs').kind, 'mixin');
  assert.equal(type(f, 'Logs').on, 'Object');
  assert.equal(type(f, 'StringX').kind, 'extension');
  assert.equal(type(f, 'StringX').on, 'String');
  // internal offsets are stripped from the public shape
  assert.equal(type(f, 'Repo').bodyStart, undefined);
});

test('collects import, export and part directives', () => {
  assert.deepEqual(dart(WIDGETS).imports, [
    { kind: 'import', uri: 'package:flutter/material.dart' },
    { kind: 'import', uri: 'package:flutter_riverpod/flutter_riverpod.dart' },
    { kind: 'export', uri: 'src/widgets.dart' },
    { kind: 'part', uri: 'main.g.dart' },
  ]);
});

// ---------------------------------------------------------------- go_router + enums

const GO_ROUTER = `
enum AppRoute {
  cart('/cart'),
  checkout('/checkout', title: 'Pay'),
  @Deprecated('use cart') legacy(path: '/legacy'),
  home(r'/home');

  const AppRoute(this.path, {this.title});
  final String path;
  final String? title;
}

final router = GoRouter(
  initialLocation: AppRoute.cart.path,
  routes: [
    GoRoute(
      path: AppRoute.cart.path,
      name: 'cart',
      builder: (c, s) => const AppScaffold(child: CartScreen()),
      routes: [
        GoRoute(path: 'item/:id', builder: (c, s) => ItemScreen(id: s.pathParameters['id']!)),
      ],
    ),
    GoRoute(path: '/login', pageBuilder: (c, s) => const NoTransitionPage(child: LoginScreen())),
  ],
);
`;

test('go_router GoRoute: path/name expressions and builder classes', () => {
  const f = dart(GO_ROUTER);
  const cart = f.routes.find((r) => r.pathExpr === 'AppRoute.cart.path');
  assert.ok(cart);
  assert.equal(cart.source, 'go_router');
  assert.equal(cart.nameExpr, "'cart'");
  assert.ok(cart.classes.includes('CartScreen'));
  assert.ok(cart.classes.includes('AppScaffold'));
  assert.equal(cart.line, 16);
});

test('nested GoRoute is its own route and lies inside its parent range', () => {
  const f = dart(GO_ROUTER);
  const parent = f.routes.find((r) => r.pathExpr === 'AppRoute.cart.path');
  const child = f.routes.find((r) => r.pathExpr === "'item/:id'");
  assert.deepEqual(child.classes, ['ItemScreen']);
  assert.ok(parent._start < child._start && child._end < parent._end);
  // the parent's builder classes do not absorb the nested route's screen
  assert.ok(!parent.classes.includes('ItemScreen'));
});

test('GoRoute pageBuilder classes are collected too', () => {
  const login = dart(GO_ROUTER).routes.find((r) => r.pathExpr === "'/login'");
  assert.ok(login.classes.includes('LoginScreen'));
});

test('initialLocation becomes an entry expression', () => {
  assert.deepEqual(dart(GO_ROUTER).entries, [{ expr: 'AppRoute.cart.path', line: 14 }]);
});

test('enhanced enum values become enum constants', () => {
  const f = dart(GO_ROUTER);
  assert.deepEqual(constant(f, 'AppRoute', 'cart'), { owner: 'AppRoute', name: 'cart', expr: "'/cart'", enumValue: true });
  assert.equal(constant(f, 'AppRoute', 'checkout').expr, "'/checkout'");
  assert.equal(constant(f, 'AppRoute', 'legacy').expr, "'/legacy'"); // annotated + named first arg
  assert.equal(constant(f, 'AppRoute', 'home').expr, "r'/home'");
  // constructor/field declarations after `;` are not enum values
  assert.equal(f.constants.filter((c) => c.owner === 'AppRoute').length, 4);
});

// ---------------------------------------------------------------- other routers

const OTHER_ROUTERS = `
@AutoRouterConfig()
class AppRouter extends RootStackRouter {
  @override
  List<AutoRoute> get routes => [
    AutoRoute(page: HomeRoute.page, path: '/home', initial: true),
    CustomRoute<void>(page: ProfileRoute.page, path: '/profile'),
  ];
}
final pages = [
  GetPage(name: '/getx', page: () => const GetxScreen()),
];
void main() => runApp(MaterialApp(
  home: const SplashScreen(),
  initialRoute: '/start',
  routes: {
    '/start': (context) => const StartScreen(),
    Routes.about: (_) => AboutScreen(),
  },
  onGenerateRoute: (RouteSettings settings) {
    switch (settings.name) {
      case '/gen':
        return MaterialPageRoute(builder: (_) => const GenScreen());
      default:
        return null;
    }
  },
));
`;

test('auto_route, GetX, routes map and onGenerateRoute routes', () => {
  const f = dart(OTHER_ROUTERS);
  const by = (source) => f.routes.filter((r) => r.source === source);
  assert.deepEqual(by('auto_route').map((r) => [r.pathExpr, r.routeClass]), [["'/home'", 'HomeRoute'], ["'/profile'", 'ProfileRoute']]);
  assert.deepEqual(by('getx').map((r) => [r.pathExpr, r.classes]), [["'/getx'", ['GetxScreen']]]);
  assert.deepEqual(by('routes map').map((r) => [r.pathExpr, r.classes]), [["'/start'", ['StartScreen']], ['Routes.about', ['AboutScreen']]]);
  assert.deepEqual(by('onGenerateRoute').map((r) => [r.pathExpr, r.classes]), [["'/gen'", ['GenScreen']]]);
});

test('MaterialApp home and initialRoute become entries; main is detected', () => {
  const f = dart(OTHER_ROUTERS);
  assert.deepEqual(f.entries.find((e) => e.classes), { classes: ['SplashScreen'], line: 14 });
  assert.equal(f.entries.find((e) => e.expr).expr, "'/start'");
  assert.equal(f.hasMain, true);
  assert.equal(dart('Future<void> main() async {}').hasMain, true);
  assert.equal(dart('void notMain() {}').hasMain, false);
});

// ---------------------------------------------------------------- constants

const CONFIG = `
class ApiConfig {
  static const String baseUrl = 'https://x.dev';
  static const checkout = "/checkout";
  static final timeoutLabel = '30s';
}

class Endpoints {
  static String _api(String p) => '\${ApiConfig.baseUrl}/\$p';
  static String get users => _api('users');
  static String user(String id) => _api('users/\$id');
  static String page(int id, {String? lang, int n = 1}) => '/p/\$id';
  static String list([int page = 1]) => '/l';
}
`;

test('static const / final string constants with owner', () => {
  const f = dart(CONFIG);
  assert.deepEqual(constant(f, 'ApiConfig', 'baseUrl'), { owner: 'ApiConfig', name: 'baseUrl', expr: "'https://x.dev'" });
  assert.equal(constant(f, 'ApiConfig', 'checkout').expr, '"/checkout"');
  assert.equal(constant(f, 'ApiConfig', 'timeoutLabel').expr, "'30s'");
});

test('getter and method constants keep their expression and parameter names', () => {
  const f = dart(CONFIG);
  const users = constant(f, 'Endpoints', 'users');
  assert.equal(users.expr, "_api('users')");
  assert.equal(users.params, undefined); // getters take no arguments
  assert.deepEqual(constant(f, 'Endpoints', 'user'), {
    owner: 'Endpoints', name: 'user', expr: "_api('users/$id')", params: ['id'],
  });
  assert.deepEqual(constant(f, 'Endpoints', '_api').params, ['p']);
  assert.deepEqual(constant(f, 'Endpoints', 'page').params, ['id', 'lang', 'n']);
  assert.deepEqual(constant(f, 'Endpoints', 'list').params, ['page']);
});

test('baseUrl assignments are reported as bases', () => {
  const f = dart(`${CONFIG}\nfinal dio = Dio(BaseOptions(baseUrl: ApiConfig.baseUrl));\n`);
  assert.deepEqual(f.bases.map((b) => b.expr), ["'https://x.dev'", 'ApiConfig.baseUrl']);
});

// ---------------------------------------------------------------- navigation

const NAV = `
class ProductScreen extends StatefulWidget {
  const ProductScreen({super.key});
  @override
  State<ProductScreen> createState() => _ProductScreenState();
}

class _ProductScreenState extends State<ProductScreen> {
  void _open(BuildContext context) {
    context.push('/cart');
    context.goNamed('checkout');
    context.go(AppRoute.cart.path);
    Navigator.pushNamed(context, '/x');
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => const DetailScreen()));
    Navigator.of(context).pushReplacementNamed('/home');
    showModalBottomSheet(context: context, builder: (_) => const FilterSheet());
    showDialog<bool>(context: context, builder: (ctx) => ConfirmDialog(title: 'x'));
    Get.toNamed('/getx');
    Get.to(() => const GetScreen());
    context.router.push(const SettingsRoute());
    final route = MaterialPageRoute(builder: (_) => const StoredScreen());
    items.add(1);
    stack.push(2);
    controller.to('/nope');
  }
  @override
  Widget build(BuildContext context) => const SizedBox();
}

void openProfile(BuildContext context) {
  context.pushNamed('profile');
}
`;

test("context.push('/cart') is a path push", () => {
  const n = navExpr(dart(NAV), "'/cart'");
  assert.equal(n.method, 'push');
  assert.equal(n.kind, 'push');
  assert.equal(n.byName, false);
  assert.equal(n.line, 10);
});

test("context.goNamed('checkout') navigates by route name", () => {
  const n = navExpr(dart(NAV), "'checkout'");
  assert.equal(n.method, 'goNamed');
  assert.equal(n.kind, 'go');
  assert.equal(n.byName, true);
});

test('context.go(AppRoute.cart.path) keeps the constant expression', () => {
  const n = navExpr(dart(NAV), 'AppRoute.cart.path');
  assert.equal(n.kind, 'go');
  assert.deepEqual(n.classes, []);
});

test("Navigator.pushNamed(context, '/x') skips the context and is path based", () => {
  const n = navExpr(dart(NAV), "'/x'");
  assert.equal(n.method, 'pushNamed');
  assert.equal(n.byName, false);
  const r = navExpr(dart(NAV), "'/home'");
  assert.equal(r.kind, 'replace');
  assert.equal(r.byName, false);
});

test('Navigator.of(context).push(MaterialPageRoute(...)) yields the built screen once', () => {
  const hits = navTo(dart(NAV), 'DetailScreen');
  assert.equal(hits.length, 1, 'route inside a navigator call is not reported twice');
  assert.equal(hits[0].method, 'push');
  // The raw argument is kept as a fallback for route helpers like `AppRoutes.detail(id)`.
  assert.match(hits[0].expr, /^MaterialPageRoute\(/);
});

test('a page route stored in a variable is still reported', () => {
  const [n] = navTo(dart(NAV), 'StoredScreen');
  assert.equal(n.method, 'MaterialPageRoute');
  assert.equal(n.kind, 'push');
});

test('showModalBottomSheet / showDialog are modal presentations', () => {
  const f = dart(NAV);
  const [sheet] = navTo(f, 'FilterSheet');
  assert.equal(sheet.method, 'showModalBottomSheet');
  assert.equal(sheet.kind, 'modal');
  assert.equal(sheet.modal, true);
  assert.equal(navTo(f, 'ConfirmDialog')[0].modal, true);
});

test('GetX: Get.toNamed is path based, Get.to builds a screen', () => {
  const f = dart(NAV);
  const named = navExpr(f, "'/getx'");
  assert.equal(named.method, 'toNamed');
  assert.equal(named.byName, false);
  assert.equal(navTo(f, 'GetScreen')[0].method, 'to');
  // `.to(...)` on anything other than Get is ignored
  assert.equal(navExpr(f, "'/nope'"), undefined);
});

test('auto_route context.router.push(const SettingsRoute())', () => {
  assert.equal(navTo(dart(NAV), 'SettingsRoute')[0].method, 'push');
});

test('push/add/to on non-navigator receivers is not navigation', () => {
  const f = dart(NAV);
  // items.add(1), stack.push(2), controller.to('/nope') sit on lines 22-24
  assert.ok(f.navigation.every((n) => n.line < 22 || n.line > 24));
});

test('fromType inside a State class is attributed to its widget', () => {
  const f = dart(NAV);
  const inState = f.navigation.filter((n) => n.line >= 9 && n.line <= 25);
  assert.ok(inState.length >= 10);
  assert.ok(inState.every((n) => n.fromType === 'ProductScreen'));
  assert.equal(navExpr(f, "'profile'").fromType, null); // top-level function
  assert.ok(f.navigation.every((n) => !('pos' in n)));
});

// A static route helper call reads like a named constructor (`Foo.bar(...)`),
// so the argument is treated as an instantiation of `AppRoutes` and the path
// expression is dropped. analyze.js then finds no UI class and no expression,
// and the navigation edge is lost.
test('context.push(AppRoutes.productDetail(id)) keeps the route helper expression', () => {
  const f = dart('class A {\n  void f(BuildContext context) {\n    context.push(AppRoutes.productDetail(id));\n  }\n}\n');
  assert.equal(f.navigation.length, 1);
  assert.equal(f.navigation[0].expr, 'AppRoutes.productDetail(id)');
});

// ---------------------------------------------------------------- APIs

const APIS = `
import 'package:http/http.dart' as http;
abstract class UserApi {
  @GET('/users/{id}')
  Future<User> getUser(@Path('id') String id);
  @POST("/users")
  Future<void> create(@Body() User u);
}
class Repo {
  final Dio _dio;
  final ApiClient _client;
  Future<void> load() async {
    await _dio.get('/products');
    await _dio.post(ApiConfig.checkout, data: x);
    await http.get(Uri.parse('https://api.x.dev/v1/items'));
    await _client.request(httpMethod: HttpMethod.post, endpoint: Endpoints.items);
    await _dio.get<Map<String, dynamic>>('/typed');
    await _dio.request('/r', options: Options(method: 'PUT'));
    await FirebaseFirestore.instance.collection('orders').get();
    final req = http.Request('POST', Uri.parse('https://x.dev/upload'));
    final ch = WebSocketChannel.connect(Uri.parse('wss://ws.x.dev/live'));
    await supabase.from('notes').select();
    await FirebaseFunctions.instance.httpsCallable('doThing').call();
    launchUrl(Uri.parse(link), fallback: 'https://cdn.x.dev/help');
    await PermissionRequestQueue.request(Permission.microphone);
    final v = prefs.get('key');
    final w = cache.get('k');
  }
}
`;

test('dio get/post: method, expression and client', () => {
  const f = dart(APIS);
  assert.deepEqual(api(f, "'/products'"), { method: 'GET', expr: "'/products'", client: 'dio', line: 13 });
  assert.equal(api(f, 'ApiConfig.checkout').method, 'POST');
  assert.equal(api(f, "'/typed'").method, 'GET'); // generic type arguments on the call
});

test("http.get(Uri.parse('https://api.x.dev/v1/items'))", () => {
  const a = api(dart(APIS), "Uri.parse('https://api.x.dev/v1/items')");
  assert.equal(a.method, 'GET');
  assert.equal(a.client, 'http');
});

test('_client.request(httpMethod: HttpMethod.post, endpoint: ...) uses the named verb and endpoint', () => {
  const a = api(dart(APIS), 'Endpoints.items');
  assert.equal(a.method, 'POST');
  assert.equal(a.client, '_client');
});

test('dio.request with Options(method:) picks up the verb', () => {
  assert.equal(api(dart(APIS), "'/r'").method, 'PUT');
});

test('retrofit annotations', () => {
  const f = dart(APIS);
  assert.deepEqual(api(f, "'/users/{id}'"), { method: 'GET', expr: "'/users/{id}'", client: 'retrofit', line: 4 });
  assert.equal(api(f, '"/users"').method, 'POST');
});

test('Firestore collection, http.Request, WebSocket, Supabase and callable functions', () => {
  const f = dart(APIS);
  assert.deepEqual(api(f, "'orders'"), { method: 'FIRESTORE', expr: "'orders'", client: 'firestore', line: 19 });
  const req = api(f, "Uri.parse('https://x.dev/upload')");
  assert.equal(req.method, 'POST');
  const ws = api(f, "Uri.parse('wss://ws.x.dev/live')");
  assert.equal(ws.method, 'WS');
  assert.equal(ws.client, 'WebSocketChannel');
  assert.equal(api(f, "'notes'").method, 'SELECT');
  assert.equal(api(f, "'doThing'").method, 'CALLABLE');
});

test('a bare absolute URL literal is reported once as a URL', () => {
  const f = dart(APIS);
  assert.deepEqual(api(f, "'https://cdn.x.dev/help'"), { method: 'URL', expr: "'https://cdn.x.dev/help'", client: 'literal', line: 24 });
  // URLs already consumed by a call are not reported again as literals
  assert.ok(!f.apis.some((a) => a.method === 'URL' && /api\.x\.dev|upload|ws\.x\.dev/.test(a.expr)));
});

test('permission requests and SharedPreferences reads are not APIs', () => {
  const f = dart(APIS);
  assert.ok(!f.apis.some((a) => /Permission|'key'|'k'/.test(a.expr)));
  assert.equal(f.apis.length, 14);
});

// HTTP_RECEIVER_TOKEN accepts any receiver ending in `dio` (case-insensitive),
// so `_audio`, `radio`, `studio` are classified as Dio clients.
test('receivers that merely end in "dio" (audio, radio) are not HTTP clients', () => {
  const f = dart("class P {\n  Future<void> f() async {\n    await _audio.fetch('assets/beep.mp3');\n    await radio.get(1);\n  }\n}\n");
  assert.deepEqual(f.apis, []);
});

// ---------------------------------------------------------------- functions

test('function complexity counts if/for/case/&&/||/?? but not comments or strings', () => {
  const f = dart(`
int score(List<int> xs, String? s) {
  var t = 0;
  if (xs.isEmpty) return 0;
  for (final x in xs) {
    if (x > 0 && x < 10 || x == 42) t += x;
  }
  switch (t) {
    case 1:
      break;
    case 2:
      break;
  }
  final n = s ?? 'none';
  // if for while && || ?? in a comment
  final str = 'if for && || ?? case';
  return t;
}
`);
  // 1 + if + for + if + && + || + case + case + ??
  assert.deepEqual(f.functions, [{ name: 'score', line: 2, loc: 16, complexity: 9 }]);
});

test('getters, named constructors, async* bodies and nested closures', () => {
  const f = dart(`
class A {
  String get label {
    return 'a';
  }
  Future<void> load() async {
    if (a) {}
  }
  A.named(int x) {
    while (x > 0) {}
  }
  Stream<int> gen() async* {
    yield 1;
  }
  void outer() {
    void inner() { if (x) {} }
    final cb = () { if (y) {} };
  }
  Widget build(BuildContext context) => const Text('arrow bodies are not block functions');
}
`);
  assert.deepEqual(f.functions.map((fn) => [fn.name, fn.complexity]), [
    ['label', 1], ['load', 2], ['A.named', 2], ['gen', 1], ['outer', 3],
  ]);
});

// ---------------------------------------------------------------- file flags

test('generated file detection', () => {
  assert.equal(dart('', 'lib/models/user.g.dart').isGenerated, true);
  assert.equal(dart('', 'lib/models/user.freezed.dart').isGenerated, true);
  assert.equal(dart('', 'lib/router.gr.dart').isGenerated, true);
  assert.equal(dart('// GENERATED CODE - DO NOT MODIFY BY HAND\nclass X {}', 'lib/x.dart').isGenerated, true);
  assert.equal(dart('class X {}', 'lib/x.dart').isGenerated, false);
});

test('test file detection', () => {
  assert.equal(dart('', 'test/foo_test.dart').isTest, true);
  assert.equal(dart('', 'integration_test/app_test.dart').isTest, true);
  assert.equal(dart('', 'packages/core/test/helpers.dart').isTest, true);
  assert.equal(dart('', 'lib/foo_test.dart').isTest, true);
  assert.equal(dart('', 'lib/contest/entry.dart').isTest, false);
  assert.equal(dart('', 'lib/test_utils.dart').isTest, false);
});

test('identifiers lists capitalized names outside strings and comments', () => {
  const f = dart("class A { void f() { final x = Foo(); Bar.baz(); final s = 'Hidden'; } } // Gone");
  assert.deepEqual(f.identifiers, ['A', 'Foo', 'Bar']);
  assert.equal(f.lang, 'dart');
  assert.equal(f.path, 'lib/main.dart');
});
