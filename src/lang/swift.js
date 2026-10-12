import {
  lex, lineIndex, matchBracket, countLoc, decisions, maxBraceDepth, callArgs, skipWs,
} from './lexer.js';

const TYPE_KEYWORD_FOLLOWERS = new Set(['func', 'var', 'let', 'subscript', 'override', 'final', 'private', 'public', 'static', 'case', 'protocol']);
const INSTANTIATION = /\b([A-Z][A-Za-z0-9_]*)\s*(?:<[^<>()]*>)?\s*(?:\(|\{)/g;

function typeAt(types, pos) {
  let best = null;
  for (const t of types) {
    if (t.bodyStart <= pos && pos <= t.bodyEnd && (!best || t.bodyStart > best.bodyStart)) best = t;
  }
  return best;
}

export function instantiations(masked, start, end) {
  const out = [];
  const span = masked.slice(start, end);
  INSTANTIATION.lastIndex = 0;
  let m;
  while ((m = INSTANTIATION.exec(span))) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

function parseTypes(masked, code, line) {
  const types = [];
  const re = /\b(class|struct|enum|protocol|actor|extension)\s+([A-Za-z_][\w.]*)/g;
  let m;
  while ((m = re.exec(masked))) {
    const kind = m[1];
    const name = m[2];
    if (TYPE_KEYWORD_FOLLOWERS.has(name)) continue;
    let i = m.index + m[0].length;
    let header = '';
    let open = -1;
    let angle = 0;
    for (; i < masked.length; i++) {
      const ch = masked[i];
      if (ch === '<') angle++;
      else if (ch === '>') angle--;
      if (ch === '{' && angle <= 0) { open = i; break; }
      if (ch === '}' || ch === ';' || (ch === '=' && angle <= 0)) break;
      header += ch;
    }
    if (open < 0) continue;
    const close = matchBracket(masked, open);
    if (close < 0) continue;
    const inh = header.replace(/<[^>]*>/g, '').match(/:\s*([^{]+?)(?:\bwhere\b|$)/);
    const inherits = inh ? inh[1].split(',').map((s) => s.trim().replace(/^any\s+|^some\s+/, '')).filter(Boolean) : [];
    const before = code.slice(Math.max(0, m.index - 200), m.index);
    const cut = Math.max(before.lastIndexOf('}'), before.lastIndexOf('{'));
    const attributes = [...before.slice(cut + 1).matchAll(/@(\w+)/g)].map((a) => a[1]);
    types.push({
      name, kind, inherits, attributes, line: line(m.index), bodyStart: open, bodyEnd: close,
    });
  }
  return types;
}

function parseFunctions(masked, line) {
  const fns = [];
  const re = /\b(?:func\s+([^\s(<]+)|(init|deinit)\b[?!]?|var\s+(\w+)\s*:\s*[^={}\n]+(?=\{))/g;
  let m;
  while ((m = re.exec(masked))) {
    const name = m[1] || m[2] || m[3];
    let i = m.index + m[0].length;
    if (!m[3] && name !== 'deinit') {
      // skip generic params and the parameter list
      const p = masked.indexOf('(', i);
      if (p < 0) continue;
      const pc = matchBracket(masked, p);
      if (pc < 0) continue;
      i = pc + 1;
    }
    const rest = masked.slice(i, i + 400);
    const sig = rest.match(/^[^{}]*?\{/);
    if (!sig || /\b(func|var|let|case|init)\b/.test(sig[0])) continue; // protocol requirement, no body
    const open = i + sig[0].length - 1;
    const close = matchBracket(masked, open);
    if (close < 0) continue;
    fns.push({ name, start: open, end: close, line: line(m.index) });
  }
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
      name: f.name, line: f.line, start: f.start, end: f.end,
      loc: body.split('\n').filter((l) => l.trim()).length,
      complexity: 1 + decisions(body),
    };
  });
}

function parseConstants(code, types) {
  const constants = [];
  const re = /\b(?:static\s+)?let\s+(\w+)\s*(?::\s*String\s*)?=\s*("(?:[^"\\\n]|\\.)*")/g;
  let m;
  while ((m = re.exec(code))) {
    const owner = typeAt(types, m.index);
    constants.push({ owner: owner ? owner.name : null, name: m[1], expr: m[2] });
  }
  const getRe = /\bstatic\s+var\s+(\w+)\s*:\s*String\s*\{\s*(?:return\s+)?("(?:[^"\\\n]|\\.)*")\s*\}/g;
  while ((m = getRe.exec(code))) {
    const owner = typeAt(types, m.index);
    constants.push({ owner: owner ? owner.name : null, name: m[1], expr: m[2] });
  }
  const caseRe = /\bcase\s+(\w+)\s*=\s*("(?:[^"\\\n]|\\.)*")/g;
  while ((m = caseRe.exec(code))) {
    const owner = typeAt(types, m.index);
    if (owner && owner.kind === 'enum') constants.push({ owner: owner.name, name: m[1], expr: m[2], enumValue: true });
  }
  return constants;
}

const SWIFTUI_NAV = /\b(NavigationLink)\s*(?=[({])|\.(sheet|fullScreenCover|popover|navigationDestination|alert|confirmationDialog)\s*(?=\()/g;
const UIKIT_NAV = /\b(pushViewController|present|show|showDetailViewController|setViewControllers|presentFullScreen)\s*\(|\b(rootViewController)\s*(?:=|:)|\b(UINavigationController)\s*\(\s*rootViewController\s*:/g;

function parseNavigation(masked, code, line, functions) {
  const navs = [];
  let m;
  SWIFTUI_NAV.lastIndex = 0;
  while ((m = SWIFTUI_NAV.exec(masked))) {
    const word = m[1] || m[2];
    if (word === 'alert' || word === 'confirmationDialog') continue;
    let i = m.index + m[0].length;
    i = skipWs(masked, i);
    let end = i;
    if (masked[i] === '(') {
      end = matchBracket(masked, i);
      if (end < 0) continue;
      const after = skipWs(masked, end + 1);
      if (masked[after] === '{') {
        const c = matchBracket(masked, after);
        if (c > 0) end = c;
      }
    } else if (masked[i] === '{') {
      end = matchBracket(masked, i);
      if (end < 0) continue;
    }
    let classes = instantiations(masked, i, end).filter((c) => !['Text', 'Label', 'Image', 'HStack', 'VStack', 'ZStack', 'Button', 'Group'].includes(c));
    const kind = word === 'NavigationLink' || word === 'navigationDestination' ? 'push' : 'modal';
    if (classes.length) navs.push({ method: word, kind, line: line(m.index), pos: m.index, classes, expr: null });
  }

  UIKIT_NAV.lastIndex = 0;
  while ((m = UIKIT_NAV.exec(masked))) {
    const word = m[1] || m[2] || m[3];
    // Look for view controllers created in the surrounding function up to the call.
    const fn = functions.find((f) => f.start <= m.index && m.index <= f.end);
    const from = fn ? fn.start : Math.max(0, m.index - 600);
    let to = m.index + m[0].length;
    const paren = masked.indexOf('(', m.index);
    if (paren >= 0 && paren < to + 2) {
      const c = matchBracket(masked, paren);
      if (c > 0) to = c;
    }
    const classes = instantiations(masked, from, to);
    const span = code.slice(from, to);
    for (const s of span.matchAll(/instantiateViewController\s*\(\s*withIdentifier\s*:\s*"([^"]+)"/g)) classes.push(s[1]);
    for (const s of masked.slice(from, to).matchAll(/\bas[!?]\s+([A-Z]\w*)/g)) classes.push(s[1]);
    const kind = word === 'present' || word === 'presentFullScreen' ? 'modal' : word === 'rootViewController' || word === 'setViewControllers' ? 'root' : 'push';
    if (classes.length) navs.push({ method: word, kind, line: line(m.index), pos: m.index, classes: [...new Set(classes)], expr: null });
  }

  const segRe = /performSegue\s*\(\s*withIdentifier\s*:\s*"([^"]+)"/g;
  while ((m = segRe.exec(code))) {
    navs.push({ method: 'performSegue', kind: 'segue', line: line(m.index), pos: m.index, classes: [], expr: m[1], segue: m[1] });
  }
  return navs;
}

function parseApis(masked, code, line) {
  const apis = [];
  const consumed = [];
  let m;
  // Alamofire: AF.request("url", method: .post)
  const afRe = /\b(AF|Alamofire|Session\.default|session|sessionManager)\s*\.\s*(request|upload|download|streamRequest)\s*\(/g;
  while ((m = afRe.exec(masked))) {
    const open = m.index + m[0].length - 1;
    const { args, close } = callArgs(masked, open);
    if (close < 0 || !args.length) continue;
    const first = args.find((a) => !a.name) || args[0];
    const meth = code.slice(open, close).match(/method\s*:\s*\.(\w+)/);
    apis.push({
      method: meth ? meth[1].toUpperCase() : (m[2] === 'upload' ? 'POST' : 'GET'),
      expr: code.slice(first.start, first.end).trim(),
      client: 'Alamofire',
      line: line(m.index),
    });
    consumed.push([open, close]);
  }
  // URLRequest(url: ...) with httpMethod nearby
  const reqRe = /\bURLRequest\s*\(\s*url\s*:/g;
  while ((m = reqRe.exec(masked))) {
    const open = masked.indexOf('(', m.index);
    const { args, close } = callArgs(masked, open);
    if (close < 0 || !args.length) continue;
    // The method is set on the same variable, before the next function starts.
    const varName = (masked.slice(Math.max(0, m.index - 80), m.index).match(/\b(?:let|var)\s+(\w+)\s*(?::\s*URLRequest\s*)?=\s*$/) || [])[1];
    let near = code.slice(close, close + 800);
    const nextFn = near.search(/\bfunc\b/);
    if (nextFn >= 0) near = near.slice(0, nextFn);
    const target = varName ? `\\b${varName}\\.` : '';
    const hm = near.match(new RegExp(`${target}httpMethod\\s*=\\s*"(\\w+)"|${target}httpMethod\\s*=\\s*[\\w.]*?\\.(\\w+)(?:\\.rawValue)?\\b`));
    const verb = hm ? (hm[1] || hm[2]) : 'GET';
    apis.push({
      method: /^(get|post|put|patch|delete|head)$/i.test(verb) ? verb.toUpperCase() : 'REQUEST',
      expr: code.slice(args[0].start, args[0].end).trim(),
      client: 'URLSession',
      line: line(m.index),
    });
    consumed.push([open, close]);
  }
  // Moya TargetType: var path: String { switch self { case .x: return "/x" } }
  const pathRe = /\bvar\s+path\s*:\s*String\s*\{/g;
  while ((m = pathRe.exec(masked))) {
    const open = m.index + m[0].length - 1;
    const close = matchBracket(masked, open);
    if (close < 0) continue;
    const body = code.slice(open, close);
    for (const r of body.matchAll(/(?:case\s+([^:]+):\s*)?return\s+("(?:[^"\\\n]|\\.)*")/g)) {
      apis.push({ method: 'API', expr: r[2], client: 'Moya', line: line(open), label: r[1] ? r[1].trim() : null });
    }
    consumed.push([open, close]);
  }
  // Endpoint enums: enum Endpoint: String { case users = "/users" }
  const fsRe = /\.collection\s*\(\s*"([^"\n]+)"/g;
  while ((m = fsRe.exec(code))) {
    apis.push({ method: 'FIRESTORE', expr: `"${m[1]}"`, client: 'firestore', line: line(m.index) });
    consumed.push([m.index, m.index + m[0].length]);
  }
  const wsRe = /\bwebSocketTask\s*\(\s*with\s*:/g;
  while ((m = wsRe.exec(masked))) {
    const open = masked.indexOf('(', m.index);
    const { args, close } = callArgs(masked, open);
    if (close < 0 || !args.length) continue;
    apis.push({ method: 'WS', expr: code.slice(args[0].start, args[0].end).trim(), client: 'URLSession', line: line(m.index) });
    consumed.push([open, close]);
  }
  const bases = [];
  const baseRe = /\b(?:let|var)\s+(baseURL|baseUrl|apiBaseURL|host)\s*(?::\s*\w+\s*)?=\s*("(?:[^"\\\n]|\\.)*")/g;
  while ((m = baseRe.exec(code))) bases.push({ expr: m[2], line: line(m.index) });

  const urlRe = /"((?:https?|wss?):\/\/[^"\s\\]+)"/g;
  while ((m = urlRe.exec(code))) {
    if (consumed.some(([a, b]) => m.index >= a && m.index <= b)) continue;
    apis.push({ method: 'URL', expr: `"${m[1]}"`, client: 'literal', line: line(m.index) });
  }
  return { apis, bases };
}

/** Analyzes one Swift source file. */
export function analyzeSwift(file) {
  const { code, masked } = lex(file.text, 'swift');
  const line = lineIndex(file.text);
  const types = parseTypes(masked, code, line);
  const functionsRaw = parseFunctions(masked, line);
  const navigation = parseNavigation(masked, code, line, functionsRaw);
  for (const n of navigation) {
    const t = typeAt(types, n.pos);
    n.fromType = t ? t.name : null;
    delete n.pos;
  }
  const { apis, bases } = parseApis(masked, code, line);
  const imports = [...code.matchAll(/^\s*(@testable\s+)?import\s+(?:class\s+|struct\s+|enum\s+|func\s+|protocol\s+)?(\w+)/gm)]
    .map((m) => ({ kind: m[1] ? 'testable' : 'import', uri: m[2] }));
  const isTest = /(^|\/)[^/]*Tests?\//.test(file.path) || /(Tests?|Spec)\.swift$/.test(file.path)
    || imports.some((i) => i.uri === 'XCTest' || i.uri === 'Testing' || i.kind === 'testable');

  // Entry points: @main App { WindowGroup { RootView() } }
  const entries = [];
  for (const t of types) {
    if (!t.attributes.includes('main') && !t.attributes.includes('UIApplicationMain')) continue;
    const body = masked.slice(t.bodyStart, t.bodyEnd);
    const wg = body.search(/\b(WindowGroup|DocumentGroup|Window)\b/);
    if (wg >= 0) {
      const classes = instantiations(masked, t.bodyStart + wg, t.bodyEnd)
        .filter((c) => !['WindowGroup', 'DocumentGroup', 'Window', 'Group', 'Settings', 'MenuBarExtra'].includes(c));
      entries.push({ classes, line: t.line, app: t.name });
    } else {
      entries.push({ classes: [], line: t.line, app: t.name });
    }
  }
  const hasNavContainer = {};
  for (const t of types) {
    const body = masked.slice(t.bodyStart, t.bodyEnd);
    hasNavContainer[t.name] = hasNavContainer[t.name] || /\b(NavigationStack|NavigationView|NavigationSplitView|TabView)\b|\.navigationTitle\s*\(|\.toolbar\s*\{/.test(body);
  }

  return {
    path: file.path,
    lang: 'swift',
    loc: countLoc(code),
    complexity: 1 + decisions(masked),
    maxDepth: maxBraceDepth(masked),
    functions: functionsRaw.map(({ start, end, ...f }) => f),
    types: types.map(({ bodyStart, bodyEnd, ...t }) => ({ ...t, navContainer: hasNavContainer[t.name] || false })),
    imports,
    constants: parseConstants(code, types),
    routes: [],
    entries,
    navigation,
    apis,
    bases,
    hasMain: entries.length > 0 || /UIApplicationMain/.test(masked),
    isGenerated: /^\/\/ (Generated|This file was generated|swiftlint:disable all)/m.test(file.text.slice(0, 400)) || /\+Generated\.swift$|R\.generated\.swift$|\.pb\.swift$/.test(file.path),
    isTest,
    identifiers: [...new Set(masked.match(/\b[A-Z][A-Za-z0-9_]*\b/g) || [])],
  };
}

/** Parses an Interface Builder storyboard into scenes and segues. */
export function analyzeStoryboard(path, xml) {
  const scenes = new Map(); // id -> {className, storyboardId}
  const segues = [];
  let initial = (xml.match(/initialViewController="([^"]+)"/) || [])[1] || null;
  const sceneRe = /<scene\b[^>]*>([\s\S]*?)<\/scene>/g;
  let s;
  while ((s = sceneRe.exec(xml))) {
    const body = s[1];
    const vc = body.match(/<(\w*[cC]ontroller)\b([^>]*)>/);
    if (!vc) continue;
    const attrs = vc[2];
    const id = (attrs.match(/\bid="([^"]+)"/) || [])[1];
    const custom = (attrs.match(/customClass="([^"]+)"/) || [])[1];
    const sbId = (attrs.match(/storyboardIdentifier="([^"]+)"/) || [])[1];
    const tag = vc[1];
    const fallback = { navigationController: 'UINavigationController', tabBarController: 'UITabBarController' }[tag] || `UI${tag[0].toUpperCase()}${tag.slice(1)}`;
    scenes.set(id, { className: custom || fallback, storyboardId: sbId || null, isContainer: !custom && /navigation|tabBar/i.test(tag) });
    for (const g of body.matchAll(/<segue\b([^>]*)\/?>/g)) {
      const a = g[1];
      segues.push({
        from: id,
        to: (a.match(/destination="([^"]+)"/) || [])[1],
        kind: (a.match(/kind="([^"]+)"/) || [])[1] || 'show',
        relationship: (a.match(/relationship="([^"]+)"/) || [])[1] || null,
        identifier: (a.match(/identifier="([^"]+)"/) || [])[1] || null,
      });
    }
  }
  return { path, scenes, segues, initial };
}
