import {
  lex, lineIndex, matchBracket, countLoc, decisions, maxBraceDepth, callArgs, skipWs,
} from './lexer.js';

const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'on', 'return', 'await', 'assert', 'super', 'this',
  'new', 'const', 'final', 'var', 'else', 'do', 'try', 'throw', 'in', 'is', 'as', 'sync', 'async',
  'yield', 'when', 'with', 'late', 'required', 'get', 'set', 'Function',
]);

const HTTP_METHODS = {
  get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH', delete: 'DELETE', head: 'HEAD',
  getUri: 'GET', postUri: 'POST', putUri: 'PUT', patchUri: 'PATCH', deleteUri: 'DELETE',
  download: 'GET', fetch: 'GET', request: 'REQUEST', send: 'REQUEST',
};

const NAV_METHODS = new Set([
  'go', 'push', 'pushReplacement', 'replace', 'goNamed', 'pushNamed', 'pushReplacementNamed',
  'replaceNamed', 'pushNamedAndRemoveUntil', 'popAndPushNamed', 'pushAndRemoveUntil',
  'restorablePush', 'restorablePushNamed',
  // auto_route
  'pushRoute', 'replaceRoute', 'navigateTo', 'navigate', 'pushAndPopUntil', 'replaceAll', 'pushAll',
  // GetX
  'to', 'off', 'offAll', 'toNamed', 'offNamed', 'offAllNamed', 'offAndToNamed',
]);

const NAV_RECEIVER = /(context|ctx|router|Router|navigator|Navigator|Navigator\.of\([^()]*\)|GoRouter\.of\([^()]*\)|AutoRouter\.of\([^()]*\)|navigatorKey\.currentState!?|navigatorKey\.currentState\?|Get|_nav|nav|navigation|Nav)\s*$/;
const CONTEXT_ARG = /^(context|ctx|_context|c|buildContext|navigatorKey\.currentContext!?|\w+\.context)$/;
// `_dio`, `http`, `apiClient`, `restApi` - but not `_audio` or `radio`
const HTTP_RECEIVER_TOKEN = /^_*(dio|http|https|api|client|session|rest|network|httpclient|apiclient)$|(Dio|Client|Api|API|Http|HTTP|Session)$/;
const receiverToken = (text) => (text.match(/(\w+)\s*(?:\(\s*\))?\s*$/) || [])[1] || '';
const INSTANTIATION = /\b([A-Z][A-Za-z0-9_]*)\s*(?:<[^<>()]*(?:<[^<>()]*>[^<>()]*)*>)?\s*(?:\.\s*[a-z]\w*\s*)?\(/g;

function typeAt(types, pos) {
  let best = null;
  for (const t of types) {
    if (t.bodyStart <= pos && pos <= t.bodyEnd && (!best || t.bodyStart > best.bodyStart)) best = t;
  }
  return best;
}

/** Capitalized identifiers that are being constructed inside [start, end). */
export function instantiations(masked, start, end) {
  const out = [];
  const span = masked.slice(start, end);
  INSTANTIATION.lastIndex = 0;
  let m;
  while ((m = INSTANTIATION.exec(span))) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

function parseTypes(masked, code, line) {
  const types = [];
  const re = /\b(?:(?:abstract|base|final|sealed|interface|mixin)\s+)*(class|mixin|enum|extension)\b(?:\s+([A-Za-z_]\w*))?/g;
  let m;
  while ((m = re.exec(masked))) {
    const kind = m[1];
    const name = m[2] || null;
    if (kind === 'extension' && name === 'on') continue;
    if (!name && kind !== 'extension') continue;
    // Header runs to the next `{`; a `;` first means a mixin application or similar.
    let i = m.index + m[0].length;
    let header = '';
    let open = -1;
    for (; i < masked.length; i++) {
      const ch = masked[i];
      if (ch === '{') { open = i; break; }
      if (ch === ';' || ch === '}') break;
      header += ch;
    }
    if (open < 0) continue;
    const close = matchBracket(masked, open);
    if (close < 0) continue;
    const ext = header.match(/\bextends\s+([\w.]+)\s*(?:<\s*([\w.]+))?/);
    const withM = header.match(/\bwith\s+([\s\S]+?)(?=\bimplements\b|$)/);
    const impl = header.match(/\bimplements\s+([\s\S]+)$/);
    const on = header.match(/\bon\s+([\w.]+)/);
    const names = (s) => (s ? s.replace(/<[^>]*>/g, '').split(',').map((x) => x.trim()).filter(Boolean) : []);
    // Annotations directly above the declaration
    const before = code.slice(Math.max(0, m.index - 300), m.index);
    const cut = Math.max(before.lastIndexOf('}'), before.lastIndexOf(';'));
    const annotations = [...before.slice(cut + 1).matchAll(/@(\w+)/g)].map((a) => a[1]);
    types.push({
      name: name || `extension on ${on ? on[1] : '?'}`,
      kind,
      extends: ext ? ext[1] : null,
      stateOf: ext && /State$/.test(ext[1]) && ext[2] ? ext[2] : null,
      mixins: names(withM && withM[1]),
      implements: names(impl && impl[1]),
      on: on ? on[1] : null,
      annotations,
      line: line(m.index),
      start: m.index,
      bodyStart: open,
      bodyEnd: close,
    });
    // Continue scanning inside the body (nested types are not legal in Dart,
    // but enums/classes are often adjacent).
  }
  return types;
}

function parseFunctions(masked, line) {
  const fns = [];
  for (let p = masked.indexOf('{'); p >= 0; p = masked.indexOf('{', p + 1)) {
    let k = p - 1;
    while (k >= 0 && /\s/.test(masked[k])) k--;
    // optional async / async* / sync*
    const tail = masked.slice(Math.max(0, k - 7), k + 1);
    const mod = tail.match(/(async\*?|sync\*)$/);
    if (mod) {
      k -= mod[1].length;
      while (k >= 0 && /\s/.test(masked[k])) k--;
    }
    let name = null;
    if (masked[k] === ')') {
      // find matching '(' backwards
      let depth = 0;
      let j = k;
      for (; j >= 0; j--) {
        if (masked[j] === ')') depth++;
        else if (masked[j] === '(') { depth--; if (depth === 0) break; }
      }
      if (j < 0) continue;
      let q = j - 1;
      while (q >= 0 && /\s/.test(masked[q])) q--;
      if (masked[q] === '>') { // generic method foo<T>(...)
        let d = 0;
        for (; q >= 0; q--) {
          if (masked[q] === '>') d++;
          else if (masked[q] === '<') { d--; if (d === 0) { q--; break; } }
        }
        while (q >= 0 && /\s/.test(masked[q])) q--;
      }
      let e = q + 1;
      while (q >= 0 && /[\w$]/.test(masked[q])) q--;
      name = masked.slice(q + 1, e);
      if (!name || KEYWORDS.has(name) || /^\d/.test(name)) continue;
      // `foo.bar() {` is never a declaration in Dart
      if (masked[q] === '.') {
        // allow named constructors: Foo.named(...) {
        const prev = masked.slice(0, q).match(/([A-Z]\w*)$/);
        if (!prev) continue;
        name = `${prev[1]}.${name}`;
      }
    } else {
      const g = masked.slice(Math.max(0, k - 80), k + 1).match(/\b(get|set)\s+([A-Za-z_]\w*)$/);
      if (!g) continue;
      name = g[2];
    }
    const close = matchBracket(masked, p);
    if (close < 0) continue;
    fns.push({ name, start: p, end: close, line: line(p) });
  }
  // Keep only outermost functions; nested closures/local functions roll up.
  fns.sort((a, b) => a.start - b.start);
  const top = [];
  let lastEnd = -1;
  for (const f of fns) {
    if (f.start < lastEnd) continue;
    top.push(f);
    lastEnd = f.end;
  }
  return top.map((f) => {
    const body = masked.slice(f.start, f.end + 1);
    return {
      name: f.name,
      line: f.line,
      loc: body.split('\n').filter((l) => l.trim()).length,
      complexity: 1 + decisions(body),
    };
  });
}

function parseConstants(code, masked, types) {
  const constants = [];
  const re = /\b(?:static\s+)?(?:const|final)\s+(?:String\s+)?([A-Za-z_]\w*)\s*=\s*(r?'(?:[^'\\\n]|\\.)*'|r?"(?:[^"\\\n]|\\.)*")\s*;/g;
  let m;
  while ((m = re.exec(code))) {
    const owner = typeAt(types, m.index);
    constants.push({ owner: owner && owner.kind !== 'extension' ? owner.name : null, name: m[1], expr: m[2] });
  }
  // `static String get users => '/users';`, `static String user(id) => _api('users/$id');`
  const getRe = /\b(?:static\s+)?String\??\s+(?:get\s+([A-Za-z_]\w*)|([A-Za-z_]\w*)\s*\(([^()]*)\))\s*=>\s*([^;]+?)\s*;/g;
  while ((m = getRe.exec(code))) {
    const owner = typeAt(types, m.index);
    const params = m[2]
      ? m[3].replace(/[{}[\]]/g, '').split(',').map((p) => (p.split('=')[0].trim().match(/(\w+)$/) || [])[1]).filter(Boolean)
      : undefined;
    constants.push({ owner: owner ? owner.name : null, name: m[1] || m[2], expr: m[4].trim(), params });
  }
  // Enhanced enums: `home('/home', ...)` -> AppRoute.home => '/home'
  for (const t of types) {
    if (t.kind !== 'enum') continue;
    let end = t.bodyEnd;
    let depth = 0;
    for (let i = t.bodyStart + 1; i < t.bodyEnd; i++) {
      const ch = masked[i];
      if (ch === '(' || ch === '{' || ch === '[') depth++;
      else if (ch === ')' || ch === '}' || ch === ']') depth--;
      else if (ch === ';' && depth === 0) { end = i; break; }
    }
    const body = code.slice(t.bodyStart + 1, end);
    const entryRe = /(?:^|,)\s*(?:@\w+(?:\([^)]*\))?\s*)*([a-z_]\w*)\s*(?:<[^>]*>)?\s*\(\s*(?:\w+\s*:\s*)?(r?'(?:[^'\\\n]|\\.)*'|r?"(?:[^"\\\n]|\\.)*")/g;
    let e;
    while ((e = entryRe.exec(body))) constants.push({ owner: t.name, name: e[1], expr: e[2], enumValue: true });
  }
  return constants;
}

function firstPositional(args, masked, code) {
  const pos = args.filter((a) => !a.name);
  if (!pos.length) return null;
  let idx = 0;
  const first = code.slice(pos[0].start, pos[0].end).trim();
  if (CONTEXT_ARG.test(first) && pos.length > 1) idx = 1;
  return pos[idx];
}

function parseNavigation(masked, code, line) {
  const navs = [];
  const covered = [];
  const callRe = /\.\s*([A-Za-z_]\w*)\s*(?:<[^<>()]*>)?\s*\(/g;
  let m;
  while ((m = callRe.exec(masked))) {
    const method = m[1];
    if (!NAV_METHODS.has(method)) continue;
    const receiver = masked.slice(Math.max(0, m.index - 60), m.index);
    if (!NAV_RECEIVER.test(receiver)) continue;
    const isGet = /\bGet\s*$/.test(receiver);
    if (['to', 'off', 'offAll', 'toNamed', 'offNamed', 'offAllNamed', 'offAndToNamed'].includes(method) && !isGet) continue;
    const open = m.index + m[0].length - 1;
    const { args, close } = callArgs(masked, open);
    if (close < 0) continue;
    covered.push([open, close]);
    const arg = firstPositional(args, masked, code);
    const named = /Named|^toNamed|^offNamed|^offAllNamed|^offAndToNamed/.test(method);
    const nav = {
      method, line: line(m.index), pos: m.index, kind: 'push', expr: null, classes: [],
    };
    if (/replace|Replacement|off|go$|^go|navigate/.test(method)) nav.kind = method.startsWith('go') ? 'go' : 'replace';
    if (arg) {
      const exprCode = code.slice(arg.start, arg.end).trim();
      const cls = instantiations(masked, arg.start, arg.end);
      if (cls.length && !/^['"]|^r['"]/.test(exprCode)) nav.classes = cls;
      // Keep the expression too: `AppRoutes.productDetail(id)` looks like a constructor call.
      nav.expr = exprCode;
      // Navigator.pushNamed and Get.toNamed take a route *path*; go_router's goNamed takes a route *name*.
      nav.byName = named && !isGet && !/Navigator|navigator|currentState/.test(receiver);
    }
    if (nav.expr || nav.classes.length) navs.push(nav);
  }

  // Page routes built outside a recognized navigator call (e.g. stored in a variable)
  const routeRe = /\b(MaterialPageRoute|CupertinoPageRoute|PageRouteBuilder|MaterialWithModalsPageRoute|[A-Z]\w*PageRoute)\s*(?:<[^<>()]*>)?\s*\(/g;
  while ((m = routeRe.exec(masked))) {
    const open = m.index + m[0].length - 1;
    if (covered.some(([a, b]) => open > a && open < b)) continue;
    const close = matchBracket(masked, open);
    if (close < 0) continue;
    const cls = instantiations(masked, open + 1, close);
    if (cls.length) navs.push({ method: m[1], line: line(m.index), pos: m.index, kind: 'push', expr: null, classes: cls });
  }

  // Modal presentations
  const modalRe = /\b(showModalBottomSheet|showDialog|showCupertinoModalPopup|showGeneralDialog|showCupertinoDialog|showBarModalBottomSheet|showMaterialModalBottomSheet)\s*(?:<[^<>()]*>)?\s*\(/g;
  while ((m = modalRe.exec(masked))) {
    const open = m.index + m[0].length - 1;
    const close = matchBracket(masked, open);
    if (close < 0) continue;
    const cls = instantiations(masked, open + 1, close);
    if (cls.length) navs.push({ method: m[1], line: line(m.index), pos: m.index, kind: 'modal', expr: null, classes: cls, modal: true });
  }
  return navs;
}

function argExpr(code, args, name) {
  const a = args.find((x) => x.name === name);
  return a ? code.slice(a.start, a.end).trim() : null;
}

function parseRoutes(masked, code, line) {
  const routes = [];
  let m;
  // go_router
  const goRe = /\bGoRoute\s*\(/g;
  while ((m = goRe.exec(masked))) {
    const open = m.index + m[0].length - 1;
    const { args, close } = callArgs(masked, open);
    if (close < 0) continue;
    const builder = args.find((a) => a.name === 'builder' || a.name === 'pageBuilder');
    routes.push({
      source: 'go_router',
      pathExpr: argExpr(code, args, 'path'),
      nameExpr: argExpr(code, args, 'name'),
      classes: builder ? instantiations(masked, builder.start, builder.end) : [],
      start: open,
      end: close,
      line: line(m.index),
    });
  }
  // auto_route
  const autoRe = /\b(AutoRoute|CustomRoute|AdaptiveRoute|MaterialRoute|CupertinoRoute|RedirectRoute)\s*(?:<[^<>()]*>)?\s*\(/g;
  while ((m = autoRe.exec(masked))) {
    const open = m.index + m[0].length - 1;
    const { args, close } = callArgs(masked, open);
    if (close < 0) continue;
    const page = argExpr(code, args, 'page') || '';
    const pm = page.match(/^([A-Z]\w*)\.page$/);
    routes.push({
      source: 'auto_route',
      pathExpr: argExpr(code, args, 'path'),
      nameExpr: null,
      routeClass: pm ? pm[1] : null,
      classes: [],
      start: open,
      end: close,
      line: line(m.index),
    });
  }
  // GetX
  const getRe = /\bGetPage\s*(?:<[^<>()]*>)?\s*\(/g;
  while ((m = getRe.exec(masked))) {
    const open = m.index + m[0].length - 1;
    const { args, close } = callArgs(masked, open);
    if (close < 0) continue;
    const page = args.find((a) => a.name === 'page');
    routes.push({
      source: 'getx',
      pathExpr: argExpr(code, args, 'name'),
      nameExpr: null,
      classes: page ? instantiations(masked, page.start, page.end) : [],
      start: open,
      end: close,
      line: line(m.index),
    });
  }
  // MaterialApp(routes: { '/x': (context) => X() })
  const mapRe = /\broutes\s*:\s*(?:<[^<>{}]*>\s*)?\{/g;
  while ((m = mapRe.exec(masked))) {
    const open = m.index + m[0].length - 1;
    const { args, close } = callArgs(masked, open);
    if (close < 0) continue;
    for (const a of args) {
      const text = code.slice(a.start, a.end);
      const e = text.match(/^\s*((?:r?'[^']*'|r?"[^"]*")|[\w.]+)\s*:\s*/);
      if (!e) continue;
      const valueStart = a.start + e[0].length;
      routes.push({
        source: 'routes map',
        pathExpr: e[1],
        nameExpr: null,
        classes: instantiations(masked, valueStart, a.end),
        start: a.start,
        end: a.end,
        line: line(a.start),
      });
    }
  }
  // onGenerateRoute switch: case '/x': return MaterialPageRoute(builder: (_) => X());
  if (/onGenerateRoute|RouteSettings/.test(masked)) {
    const caseRe = /\bcase\s+((?:r?'[^'\n]*'|r?"[^"\n]*")|[\w.]+)\s*:/g;
    const matches = [...code.matchAll(caseRe)];
    for (let i = 0; i < matches.length; i++) {
      const c = matches[i];
      const start = c.index + c[0].length;
      const tail = masked.slice(start);
      const stop = tail.search(/\bcase\b|\bdefault\b/);
      const end = stop < 0 ? Math.min(masked.length, start + 600) : start + stop;
      const classes = instantiations(masked, start, end).filter((x) => !/PageRoute|RouteSettings/.test(x));
      if (!classes.length) continue;
      routes.push({
        source: 'onGenerateRoute', pathExpr: c[1], nameExpr: null, classes, start, end, line: line(c.index),
      });
    }
  }
  // Entry: MaterialApp(home: X()) and runApp(X())
  const entries = [];
  const homeRe = /\b(?:MaterialApp|CupertinoApp|GetMaterialApp|WidgetsApp)(?:\.router)?\s*\(/g;
  while ((m = homeRe.exec(masked))) {
    const open = m.index + m[0].length - 1;
    const { args, close } = callArgs(masked, open);
    if (close < 0) continue;
    const home = args.find((a) => a.name === 'home');
    if (home) entries.push({ classes: instantiations(masked, home.start, home.end), line: line(home.start) });
    const initial = argExpr(code, args, 'initialRoute');
    if (initial) entries.push({ expr: initial, line: line(m.index) });
  }
  const initLoc = /\binitialLocation\s*:\s*/g;
  while ((m = initLoc.exec(masked))) {
    const start = m.index + m[0].length;
    const rest = code.slice(start, start + 200);
    const e = rest.match(/^((?:r?'[^']*'|r?"[^"]*")|[\w.]+)/);
    if (e) entries.push({ expr: e[1], line: line(m.index) });
  }
  return { routes, entries };
}

function parseApis(masked, code, line) {
  const apis = [];
  const consumed = [];
  let m;
  // Retrofit / Chopper annotations
  const annRe = /@(GET|POST|PUT|PATCH|DELETE|HEAD|Get|Post|Put|Patch|Delete|Head)\s*\(\s*(?:path\s*:\s*)?(r?'(?:[^'\\\n]|\\.)*'|r?"(?:[^"\\\n]|\\.)*")?/g;
  while ((m = annRe.exec(code))) {
    apis.push({ method: m[1].toUpperCase(), expr: m[2] || "''", client: 'retrofit', line: line(m.index) });
    consumed.push([m.index, m.index + m[0].length]);
  }
  // http / dio style calls
  const callRe = /\.\s*(get|post|put|patch|delete|head|getUri|postUri|putUri|patchUri|deleteUri|download|fetch|request)\s*(?:<[^<>()]*(?:<[^<>()]*>[^<>()]*)*>)?\s*\(/g;
  while ((m = callRe.exec(masked))) {
    const receiver = masked.slice(Math.max(0, m.index - 60), m.index);
    const client = receiverToken(receiver);
    if (!HTTP_RECEIVER_TOKEN.test(client)) continue;
    const open = m.index + m[0].length - 1;
    const { args, close } = callArgs(masked, open);
    if (close < 0 || !args.length) continue;
    const first = args.find((a) => !a.name)
      || args.find((a) => /^(url|uri|path|endpoint|route|location)$/i.test(a.name || ''));
    if (!first) continue;
    const expr = code.slice(first.start, first.end).trim();
    let method = HTTP_METHODS[m[1]];
    if (method === 'REQUEST') {
      const named = args.find((a) => /^(method|httpMethod|verb)$/.test(a.name || ''));
      const opt = named ? code.slice(named.start, named.end) : (code.slice(open, close).match(/method\s*:\s*(['"]\w+['"]|[\w.]+)/) || [])[1];
      const verb = opt && opt.replace(/['"]/g, '').split('.').pop();
      if (verb && /^(get|post|put|patch|delete|head)$/i.test(verb)) method = verb.toUpperCase();
    }
    apis.push({ method, expr, client: /dio/i.test(client) ? 'dio' : /^http$/.test(client) ? 'http' : client || 'http', line: line(m.index) });
    consumed.push([open, close]);
  }
  // http.Request('POST', uri) / MultipartRequest
  const reqRe = /\b(?:http\.)?(Request|MultipartRequest|StreamedRequest)\s*\(\s*(['"])(\w+)\2\s*,/g;
  while ((m = reqRe.exec(code))) {
    const open = code.indexOf('(', m.index);
    const { args, close } = callArgs(masked, open);
    if (close < 0 || args.length < 2) continue;
    apis.push({ method: m[3].toUpperCase(), expr: code.slice(args[1].start, args[1].end).trim(), client: 'http', line: line(m.index) });
    consumed.push([open, close]);
  }
  // WebSockets / socket.io
  const wsRe = /\b(WebSocketChannel\.connect|IOWebSocketChannel\.connect|WebSocket\.connect|IO\.io|io\.io)\s*\(/g;
  while ((m = wsRe.exec(masked))) {
    const open = m.index + m[0].length - 1;
    const { args, close } = callArgs(masked, open);
    if (close < 0 || !args.length) continue;
    apis.push({ method: 'WS', expr: code.slice(args[0].start, args[0].end).trim(), client: m[1].split('.')[0], line: line(m.index) });
    consumed.push([open, close]);
  }
  // Firebase / Supabase
  const fsRe = /\.collection\s*\(\s*(['"])([^'"\n]+)\1/g;
  while ((m = fsRe.exec(code))) {
    apis.push({ method: 'FIRESTORE', expr: `'${m[2]}'`, client: 'firestore', line: line(m.index) });
    consumed.push([m.index, m.index + m[0].length]);
  }
  const callableRe = /\.httpsCallable\s*\(\s*(['"])([^'"\n]+)\1/g;
  while ((m = callableRe.exec(code))) {
    apis.push({ method: 'CALLABLE', expr: `'${m[2]}'`, client: 'cloud_functions', line: line(m.index) });
    consumed.push([m.index, m.index + m[0].length]);
  }
  const supaRe = /\.from\s*\(\s*(['"])([\w-]+)\1\s*\)\s*\.\s*(select|insert|update|delete|upsert)\b/g;
  while ((m = supaRe.exec(code))) {
    apis.push({ method: m[3].toUpperCase(), expr: `'${m[2]}'`, client: 'supabase', line: line(m.index) });
    consumed.push([m.index, m.index + m[0].length]);
  }
  // Base URLs
  const bases = [];
  const baseRe = /\bbaseUrl\s*[:=]\s*((?:r?'[^'\n]*'|r?"[^"\n]*")|[\w.]+)/g;
  while ((m = baseRe.exec(code))) bases.push({ expr: m[1], line: line(m.index) });

  // Any other absolute URL literal
  const urlRe = /(['"])((?:https?|wss?):\/\/[^'"\s]+)\1/g;
  while ((m = urlRe.exec(code))) {
    if (consumed.some(([a, b]) => m.index >= a && m.index <= b)) continue;
    apis.push({ method: 'URL', expr: `'${m[2]}'`, client: 'literal', line: line(m.index) });
  }
  return { apis, bases };
}

function parseImports(code) {
  const imports = [];
  const re = /^\s*(import|export|part)\s+(['"])([^'"]+)\2/gm;
  let m;
  while ((m = re.exec(code))) imports.push({ kind: m[1], uri: m[3] });
  return imports;
}

/** Analyzes one Dart source file. Returns per-file facts. */
export function analyzeDart(file) {
  const { code, masked } = lex(file.text, 'dart');
  const line = lineIndex(file.text);
  const types = parseTypes(masked, code, line);
  const functions = parseFunctions(masked, line);
  const { routes, entries } = parseRoutes(masked, code, line);
  const navigation = parseNavigation(masked, code, line);
  for (const n of navigation) {
    const t = typeAt(types, n.pos);
    n.fromType = t ? (t.stateOf || t.name) : null;
    delete n.pos;
  }
  const { apis, bases } = parseApis(masked, code, line);
  const isGenerated = /\.(g|freezed|gr|config|mocks|chopper|mapper|pb|pbenum|pbjson|pbserver)\.dart$/.test(file.path)
    || /^\/\/ GENERATED CODE - DO NOT MODIFY BY HAND/m.test(file.text.slice(0, 500));
  const isTest = /(^|\/)(test|integration_test|test_driver)\//.test(file.path) || /_test\.dart$/.test(file.path);
  const fileComplexity = 1 + decisions(masked);
  return {
    path: file.path,
    lang: 'dart',
    loc: countLoc(code),
    complexity: fileComplexity,
    maxDepth: maxBraceDepth(masked),
    functions,
    types: types.map(({ bodyStart, bodyEnd, start, ...t }) => t),
    imports: parseImports(code),
    constants: parseConstants(code, masked, types),
    routes: routes.map(({ start, end, ...r }) => ({ ...r, _start: start, _end: end })),
    entries,
    navigation,
    apis,
    bases,
    hasMain: /\bvoid\s+main\s*\(|^\s*main\s*\(/m.test(masked) || /\bFuture<void>\s+main\s*\(/.test(masked),
    isGenerated,
    isTest,
    // identifiers used, for widget-to-screen attribution
    identifiers: [...new Set(masked.match(/\b[A-Z][A-Za-z0-9_]*\b/g) || [])],
  };
}

export { skipWs };
