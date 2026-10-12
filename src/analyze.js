import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanFiles, gitChurn, readIfExists } from './scan.js';
import { detectProject, describeStack } from './detect.js';
import { analyzeDart } from './lang/dart.js';
import { analyzeSwift, analyzeStoryboard } from './lang/swift.js';
import { stronglyConnected, exampleCycles, reverseReach } from './graph.js';
import { evalExpr, constantTable, findConstantRef } from './resolve.js';

const pkg = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
export const VERSION = pkg.version;

const FLUTTER_WIDGET_BASES = new Set([
  'StatelessWidget', 'StatefulWidget', 'ConsumerWidget', 'ConsumerStatefulWidget', 'HookWidget',
  'HookConsumerWidget', 'StatefulHookWidget', 'StatefulHookConsumerWidget', 'GetView', 'GetWidget',
  'GetResponsiveView', 'StatelessObserverWidget', 'ObserverWidget', 'LeafRenderObjectWidget',
]);
const UIKIT_VC_BASES = new Set([
  'UIViewController', 'UITableViewController', 'UICollectionViewController', 'UITabBarController',
  'UIPageViewController', 'UISplitViewController', 'UIHostingController', 'UINavigationController',
  'UIDocumentBrowserViewController', 'UIReferenceLibraryViewController', 'NSViewController',
]);
const DART_STATE_BASE = /(Notifier|Cubit|Bloc|Controller|ChangeNotifier|Store|ViewModel|_\$\w+)$/;
const SCREEN_DIR = /(^|\/)(screens?|pages?|views?|scenes?|features?|presentation|ui)\//i;
const IGNORED_URL = /(w3\.org|schemas\.android\.com|apple\.com\/DTDs|schemas\.microsoft\.com|xmlns|purl\.org)/;
const ASSET_URL = /\.(png|jpe?g|gif|svg|webp|ico|ttf|otf|woff2?|mp4|mp3|wav|css|js)(\?|$)/i;

const last = (s) => (s ? s.split('.').pop() : s);
const isPrivate = (n) => n.startsWith('_');

/**
 * Analyzes a Flutter / iOS repository and returns the report model.
 * @param {string} rootArg
 * @param {{exclude?: string[], git?: boolean, editor?: string, moduleDepth?: number, onProgress?: (msg: string) => void}} opts
 */
export function analyze(rootArg, opts = {}) {
  const root = path.resolve(rootArg);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`Not a directory: ${rootArg}`);
  const progress = opts.onProgress || (() => {});
  const warnings = [];

  progress('Scanning files');
  const { sources, all } = scanFiles(root, { exclude: opts.exclude || [] });
  const project = detectProject(root, all);
  const stack = describeStack(project.dependencies, sources);

  progress(`Analyzing ${sources.length} source files`);
  const facts = sources.map((s) => {
    try {
      return s.lang === 'dart' ? analyzeDart(s) : analyzeSwift(s);
    } catch (e) {
      warnings.push(`${s.path}: ${e.message}`);
      return {
        path: s.path, lang: s.lang, loc: s.text.split('\n').length, complexity: 1, maxDepth: 0, functions: [], types: [],
        imports: [], constants: [], routes: [], entries: [], navigation: [], apis: [], bases: [], identifiers: [],
        isTest: false, isGenerated: false, hasMain: false,
      };
    }
  });
  const idOf = new Map(facts.map((f, i) => [f.path, i]));

  // ---------- Type registry ----------
  const typeFiles = new Map(); // name -> [fileId]
  const typeInfo = new Map(); // name -> type (first declaration)
  facts.forEach((f, id) => {
    for (const t of f.types) {
      if (t.kind === 'extension') continue;
      if (!typeFiles.has(t.name)) typeFiles.set(t.name, []);
      typeFiles.get(t.name).push(id);
      if (!typeInfo.has(t.name)) typeInfo.set(t.name, { ...t, lang: f.lang, file: id });
    }
  });

  // Flutter widgets (transitively), SwiftUI views, UIKit view controllers
  const widgets = new Set();
  const views = new Set();
  const vcs = new Set();
  const representables = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, t] of typeInfo) {
      if (t.lang === 'dart') {
        if (t.kind !== 'class' || widgets.has(name)) continue;
        const base = last(t.extends);
        if (base && (FLUTTER_WIDGET_BASES.has(base) || widgets.has(base))) { widgets.add(name); changed = true; }
      } else {
        const inh = (t.inherits || []).map(last);
        if (!views.has(name) && (inh.includes('View') || inh.some((x) => views.has(x) && t.kind === 'class'))) { views.add(name); changed = true; }
        if (!representables.has(name) && inh.includes('UIViewControllerRepresentable')) { representables.add(name); views.add(name); changed = true; }
        if (!vcs.has(name) && t.kind === 'class' && inh.length && (UIKIT_VC_BASES.has(inh[0]) || vcs.has(inh[0]))) { vcs.add(name); changed = true; }
      }
    }
  }
  const isUiClass = (n, lang) => (lang === 'dart' ? widgets.has(n) : views.has(n) || vcs.has(n));

  // ---------- Constants ----------
  const consts = { dart: constantTable(facts.filter((f) => f.lang === 'dart')), swift: constantTable(facts.filter((f) => f.lang === 'swift')) };
  const ev = (expr, lang, deep = false) => {
    const r = evalExpr(expr, consts[lang], lang);
    if (!r.resolved && deep) {
      const ref = findConstantRef(expr, consts[lang], lang);
      if (ref) return ref;
    }
    return r;
  };

  // ---------- Routes ----------
  progress('Resolving routes and navigation');
  const routes = [];
  const routePageNames = new Map(); // auto_route generated route class -> screen class
  facts.forEach((f) => {
    if (f.lang !== 'dart') return;
    for (const t of f.types) {
      if (!t.annotations || !t.annotations.includes('RoutePage')) continue;
      routePageNames.set(`${t.name.replace(/(Screen|Page|View)$/, '')}Route`, t.name);
    }
  });
  const pickScreenClass = (classes, lang) => {
    const ui = classes.filter((c) => isUiClass(c, lang));
    if (!ui.length) return null;
    const named = ui.filter((c) => /(Screen|Page|View|Scene|Controller)$/.test(c));
    return (named.length ? named[named.length - 1] : ui[ui.length - 1]);
  };

  facts.forEach((f, fileId) => {
    if (f.isTest) return;
    const goRoutes = f.routes.filter((r) => r.source === 'go_router');
    const full = new Map();
    const resolvePath = (r) => {
      if (full.has(r)) return full.get(r);
      const own = r.pathExpr ? ev(r.pathExpr, f.lang, true).value : null;
      let value = own;
      if (r.source === 'go_router' && own && !own.startsWith('/')) {
        const parent = goRoutes
          .filter((p) => p !== r && p._start < r._start && p._end > r._end)
          .sort((a, b) => b._start - a._start)[0];
        if (parent) {
          const pp = resolvePath(parent) || '';
          value = `${pp.replace(/\/$/, '')}/${own}`;
        }
      }
      full.set(r, value);
      return value;
    };
    for (const r of f.routes) {
      let screenClass = pickScreenClass(r.classes, f.lang);
      if (r.source === 'auto_route' && r.routeClass) screenClass = routePageNames.get(r.routeClass) || null;
      let name = null;
      if (r.nameExpr) {
        const nm = r.nameExpr.match(/^[\w]+\.(\w+)\.name$/);
        name = nm ? nm[1] : ev(r.nameExpr, f.lang).value;
      }
      routes.push({
        path: resolvePath(r) || (r.pathExpr ? `{${r.pathExpr}}` : null),
        name,
        screenClass,
        file: fileId,
        line: r.line,
        source: r.source,
      });
    }
  });

  // Storyboards
  const storyboards = all
    .filter((p) => p.endsWith('.storyboard'))
    .map((p) => {
      const xml = readIfExists(path.join(root, p));
      return xml ? analyzeStoryboard(p, xml) : null;
    })
    .filter(Boolean);
  const storyboardIds = new Map();
  for (const sb of storyboards) {
    for (const scene of sb.scenes.values()) if (scene.storyboardId) storyboardIds.set(scene.storyboardId, scene.className);
  }

  // ---------- Screens ----------
  const screenClasses = new Map(); // class name -> {kind}
  const promote = (name, lang) => {
    if (!name || screenClasses.has(name)) return;
    const t = typeInfo.get(name);
    if (!t) return;
    const kind = t.lang === 'dart' ? 'widget' : vcs.has(name) ? 'uikit' : 'swiftui';
    screenClasses.set(name, { kind });
  };
  for (const [name, t] of typeInfo) {
    if (t.lang === 'dart') {
      if (!widgets.has(name)) continue;
      if ((t.annotations || []).includes('RoutePage')) promote(name);
      else if (!isPrivate(name) && /(Screen|Page)$/.test(name)) promote(name);
    } else if (vcs.has(name)) {
      if (!['UINavigationController', 'UITabBarController'].includes(last((t.inherits || [])[0])) || /Screen|Controller$/.test(name)) promote(name);
    } else if (views.has(name)) {
      if (/(Screen|Page|Scene)$/.test(name) || t.navContainer) promote(name);
    }
  }
  for (const r of routes) promote(r.screenClass);

  // Entries
  const entryClasses = new Set();
  const entryExprs = [];
  facts.forEach((f) => {
    if (f.isTest) return;
    for (const e of f.entries) {
      if (e.classes) {
        const c = pickScreenClass(e.classes, f.lang);
        if (c) { promote(c); entryClasses.add(c); }
      }
      if (e.expr) entryExprs.push(ev(e.expr, f.lang, true).value);
    }
  });
  for (const sb of storyboards) {
    if (!sb.initial) continue;
    let scene = sb.scenes.get(sb.initial);
    if (scene && scene.isContainer) {
      const rel = sb.segues.find((s) => s.from === sb.initial && s.relationship === 'rootViewController');
      scene = rel ? sb.scenes.get(rel.to) : scene;
    }
    if (scene && typeInfo.has(scene.className)) { promote(scene.className); entryClasses.add(scene.className); }
  }

  // ---------- Navigation ----------
  const routeMatchers = routes
    .filter((r) => r.path)
    .map((r) => ({
      route: r,
      re: new RegExp(`^${r.path.replace(/\/+$/, '').split('/').map((seg) => (/^:|^\{.*\}$/.test(seg) ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/')}/?$`),
    }));
  const matchRoute = (value) => {
    if (!value) return null;
    const clean = value.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
    const exact = routes.find((r) => r.path === clean || r.path === value);
    if (exact) return exact;
    const wild = clean.replace(/\{[^}]*\}/g, 'x');
    for (const m of routeMatchers) if (m.re.test(clean) || m.re.test(wild)) return m.route;
    return null;
  };

  const rawEdges = [];
  facts.forEach((f, fileId) => {
    if (f.isTest) return;
    for (const n of f.navigation) {
      let target = null;
      let unresolved = null;
      if (n.classes && n.classes.length) {
        const ids = n.classes.map((c) => storyboardIds.get(c) || c);
        const c = pickScreenClass(ids, f.lang);
        if (c) {
          // Bottom sheets (Flutter) and window-level roots (UIKit) only count when the target is already a screen.
          const strict = (n.modal && f.lang === 'dart') || (n.kind === 'root' && !vcs.has(c));
          if (screenClasses.has(c)) target = c;
          else if (!strict) { promote(c); target = c; }
        }
      } else if (n.segue) {
        for (const sb of storyboards) {
          const seg = sb.segues.find((s) => s.identifier === n.segue);
          if (seg) {
            let scene = sb.scenes.get(seg.to);
            if (scene && scene.isContainer) {
              const rel = sb.segues.find((s) => s.from === seg.to && s.relationship === 'rootViewController');
              scene = rel ? sb.scenes.get(rel.to) : scene;
            }
            if (scene) { promote(scene.className); target = scene.className; }
          }
        }
        if (!target) unresolved = `segue:${n.segue}`;
      }
      if (!target && !unresolved && n.expr && !n.segue) {
        const r = ev(n.expr, f.lang, true);
        let route = null;
        if (n.byName) route = routes.find((x) => x.name === r.value) || matchRoute(r.value);
        else route = matchRoute(r.value) || routes.find((x) => x.name === r.value);
        if (route && route.screenClass) target = route.screenClass;
        else if (route) unresolved = route.path;
        else if (r.value && r.value.startsWith('/')) unresolved = r.value;
      }
      if (!target && !unresolved) continue;
      rawEdges.push({ fileId, fromType: n.fromType, target, unresolved, kind: n.kind, method: n.method, line: n.line, lang: f.lang });
    }
  });

  for (const sb of storyboards) {
    for (const seg of sb.segues) {
      if (seg.relationship) continue;
      const from = sb.scenes.get(seg.from);
      let to = sb.scenes.get(seg.to);
      if (to && to.isContainer) {
        const rel = sb.segues.find((s) => s.from === seg.to && s.relationship === 'rootViewController');
        to = rel ? sb.scenes.get(rel.to) : to;
      }
      if (!from || !to) continue;
      promote(from.className);
      promote(to.className);
      const fromFile = typeInfo.get(from.className);
      rawEdges.push({
        fileId: fromFile ? fromFile.file : null, fromType: from.className, target: to.className, unresolved: null,
        kind: /present|modal|popover/i.test(seg.kind) ? 'modal' : 'push', method: `segue (${seg.kind})`, line: null, storyboard: sb.path, lang: 'swift',
      });
    }
  }

  // Screen records
  const screens = [...screenClasses.entries()]
    .map(([name, s]) => {
      const t = typeInfo.get(name);
      return { name, kind: s.kind, file: t ? t.file : null, line: t ? t.line : null };
    })
    .filter((s) => s.file !== null && !facts[s.file].isTest)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s, id) => ({ id, ...s, routes: [], entry: false }));
  const screenByName = new Map(screens.map((s) => [s.name, s]));
  for (const r of routes) {
    const s = r.screenClass && screenByName.get(r.screenClass);
    r.screen = s ? s.id : null;
    if (s && r.path && !s.routes.includes(r.path)) s.routes.push(r.path);
  }
  for (const c of entryClasses) if (screenByName.has(c)) screenByName.get(c).entry = true;
  for (const v of entryExprs) {
    const r = matchRoute(v);
    if (r && r.screen !== null) screens[r.screen].entry = true;
  }
  if (!screens.some((s) => s.entry)) {
    const home = routes.find((r) => r.path === '/' && r.screen !== null);
    if (home) screens[home.screen].entry = true;
  }

  // Identifier index for attributing widget-level navigation to screens
  const screensUsing = (typeName) => screens.filter((s) => s.name !== typeName && facts[s.file].identifiers.includes(typeName));

  const navNodes = new Map();
  const nodeFor = (kind, key, extra) => {
    const id = `${kind}:${key}`;
    if (!navNodes.has(id)) navNodes.set(id, { id, kind, ...extra });
    return id;
  };
  const screenNode = (s) => nodeFor('screen', s.id, { label: s.name, screen: s.id, file: s.file, route: s.routes[0] || null });
  const navEdges = [];
  const seenEdge = new Set();
  const addEdge = (from, to, e, via) => {
    const key = `${from}|${to}|${e.kind}`;
    if (seenEdge.has(key) || from === to) return;
    seenEdge.add(key);
    navEdges.push({ from, to, kind: e.kind, method: e.method, file: e.fileId, line: e.line, via: via || null });
  };
  for (const e of rawEdges) {
    let to;
    if (e.target && screenByName.has(e.target)) to = screenNode(screenByName.get(e.target));
    else if (e.unresolved) to = nodeFor('route', e.unresolved, { label: e.unresolved, screen: null, file: null, route: e.unresolved });
    else continue;
    const sources = [];
    let via = null;
    if (e.fromType && screenByName.has(e.fromType)) {
      sources.push(screenNode(screenByName.get(e.fromType)));
    } else if (e.fromType && isUiClass(e.fromType, e.lang)) {
      via = e.fromType;
      for (const s of screensUsing(e.fromType).slice(0, 6)) sources.push(screenNode(s));
    } else if (e.fileId !== null && e.fileId !== undefined) {
      const inFile = screens.filter((s) => s.file === e.fileId);
      if (inFile.length === 1 && !e.fromType) sources.push(screenNode(inFile[0]));
    }
    if (!sources.length) {
      const label = e.fromType || (e.fileId !== null ? path.posix.basename(facts[e.fileId].path) : 'unknown');
      sources.push(nodeFor('source', label, { label, screen: null, file: e.fileId, route: null }));
    }
    for (const s of sources) addEdge(s, to, e, via);
  }
  for (const s of screens) screenNode(s); // every screen appears, even without edges
  const nav = {
    nodes: [...navNodes.values()],
    edges: navEdges,
    entries: screens.filter((s) => s.entry).map((s) => `screen:${s.id}`),
  };

  // ---------- File dependency graph ----------
  progress('Building dependency graph');
  const edgeSet = new Set();
  const addDep = (a, b) => { if (a !== b && b !== undefined) edgeSet.add(`${a}>${b}`); };
  const swiftTypeOwners = new Map();
  facts.forEach((f, id) => {
    if (f.lang !== 'swift') return;
    for (const t of f.types) {
      if (t.kind === 'extension') continue;
      if (!swiftTypeOwners.has(t.name)) swiftTypeOwners.set(t.name, []);
      swiftTypeOwners.get(t.name).push(id);
    }
  });
  facts.forEach((f, id) => {
    if (f.lang === 'dart') {
      for (const imp of f.imports) {
        let target = null;
        if (imp.uri.startsWith('package:')) {
          const m = imp.uri.match(/^package:([\w]+)\/(.+)$/);
          if (m && project.packages.has(m[1])) target = path.posix.normalize(`${project.packages.get(m[1])}/${m[2]}`);
        } else if (!imp.uri.startsWith('dart:')) {
          target = path.posix.normalize(path.posix.join(path.posix.dirname(f.path), imp.uri));
        }
        if (target && idOf.has(target)) addDep(id, idOf.get(target));
      }
    } else {
      const own = new Set(f.types.map((t) => t.name));
      for (const ident of f.identifiers) {
        if (own.has(ident)) continue;
        const owners = swiftTypeOwners.get(ident);
        if (owners && owners.length <= 3) owners.forEach((o) => addDep(id, o));
      }
    }
  });
  const edges = [...edgeSet].map((s) => s.split('>').map(Number));
  const n = facts.length;
  const adj = Array.from({ length: n }, () => []);
  const radj = Array.from({ length: n }, () => []);
  const prodAdj = Array.from({ length: n }, () => []);
  const prodRadj = Array.from({ length: n }, () => []);
  const isProd = (i) => !facts[i].isTest && !facts[i].isGenerated;
  for (const [a, b] of edges) {
    adj[a].push(b);
    radj[b].push(a);
    if (isProd(a) && isProd(b)) { prodAdj[a].push(b); prodRadj[b].push(a); }
  }

  // ---------- Roles & modules ----------
  const screensInFile = new Map();
  for (const s of screens) {
    if (!screensInFile.has(s.file)) screensInFile.set(s.file, []);
    screensInFile.get(s.file).push(s.id);
  }
  const libDirs = [...project.packages.entries()];
  const moduleDepth = opts.moduleDepth || 2;
  const moduleOf = (p, f, depth = moduleDepth) => {
    if (f.isTest) return 'tests';
    let rel = p;
    let prefix = '';
    for (const [pkgName, lib] of libDirs) {
      if (p.startsWith(`${lib}/`)) {
        rel = p.slice(lib.length + 1);
        prefix = libDirs.length > 1 ? `${pkgName}:` : '';
        break;
      }
    }
    let dirs = rel.split('/').slice(0, -1);
    if (dirs[0] === 'src') dirs = dirs.slice(1);
    return prefix + (dirs.length ? dirs.slice(0, depth).join('/') : '(root)');
  };
  // Folders that swallow a big share of the app (e.g. `ui/screens` with 300 files)
  // are split one or two levels deeper so the module map stays readable.
  const moduleNames = facts.map((f) => moduleOf(f.path, f));
  const prodCount = facts.filter((f) => !f.isTest && !f.isGenerated).length;
  for (let extra = 1; extra <= 2; extra++) {
    const counts = new Map();
    moduleNames.forEach((m) => counts.set(m, (counts.get(m) || 0) + 1));
    const limit = Math.max(40, Math.round(prodCount * 0.15));
    let split = false;
    facts.forEach((f, i) => {
      const m = moduleNames[i];
      if (m === 'tests' || counts.get(m) <= limit) return;
      const deeper = moduleOf(f.path, f, moduleDepth + extra);
      if (deeper !== m) { moduleNames[i] = deeper; split = true; }
    });
    if (!split) break;
  }
  const roleOf = (f, id) => {
    if (f.isTest) return 'test';
    if (f.isGenerated) return 'generated';
    const p = f.path.toLowerCase();
    const base = path.posix.basename(p);
    const swiftMainTypes = f.types.some((t) => (t.attributes || []).some((a) => a === 'main' || a === 'UIApplicationMain'));
    if ((f.lang === 'dart' && f.hasMain && /(^|\/)lib\/main[\w]*\.dart$/.test(p)) || swiftMainTypes || /^(appdelegate|scenedelegate)\.swift$/.test(base)) return 'entry';
    if (screensInFile.has(id)) return 'screen';
    if (f.routes.length || /(router|routes?|navigation|navigator|coordinator)[\w]*\.(dart|swift)$/.test(base)) return 'router';
    const stateType = f.types.some((t) => (f.lang === 'dart'
      ? DART_STATE_BASE.test(last(t.extends) || '') || (t.mixins || []).some((m) => /ChangeNotifier/.test(m))
      : (t.inherits || []).includes('ObservableObject') || (t.attributes || []).includes('Observable') || /ViewModel$/.test(t.name)));
    if (stateType || /(controller|bloc|cubit|notifier|view_?model|store|presenter|providers?|state)\.(dart|swift)$/.test(base) || /(^|\/)(providers|controllers|blocs?|cubits?|viewmodels|view_models|state|stores|application)\//.test(p)) return 'state';
    if (/repositor/.test(p)) return 'repository';
    if (/(service|api|client|datasource|data_source|gateway|network|http|socket|manager|engine)/.test(base) || /(^|\/)(services|network|networking|api|datasources|data_sources|clients)\//.test(p)) return 'service';
    if (/(model|entity|entities|dto|schema)/.test(p)) return 'model';
    if (f.types.some((t) => isUiClass(t.name, f.lang))) return 'widget';
    if (/(util|helper|extension|constant|theme|style|config|color|l10n|locali|strings|format)/.test(p)) return 'util';
    return 'other';
  };

  // ---------- Tests & coverage ----------
  const tested = new Array(n).fill(false);
  const coverage = new Array(n).fill(null);
  const baseIndex = new Map();
  facts.forEach((f, id) => {
    const b = path.posix.basename(f.path).replace(/\.(dart|swift)$/, '');
    if (!baseIndex.has(b)) baseIndex.set(b, []);
    baseIndex.get(b).push(id);
  });
  facts.forEach((f, id) => {
    if (!f.isTest) return;
    for (const b of adj[id]) tested[b] = true;
    const b = path.posix.basename(f.path).replace(/(_test|Tests?|Spec)\.(dart|swift)$/, '');
    for (const t of baseIndex.get(b) || []) if (!facts[t].isTest) tested[t] = true;
  });
  const lcov = readIfExists(path.join(root, 'coverage', 'lcov.info'));
  let hasCoverage = false;
  if (lcov) {
    let cur = null;
    let lf = 0;
    let lh = 0;
    for (const lineText of lcov.split('\n')) {
      if (lineText.startsWith('SF:')) { cur = lineText.slice(3).trim(); lf = 0; lh = 0; }
      else if (lineText.startsWith('LF:')) lf = Number(lineText.slice(3));
      else if (lineText.startsWith('LH:')) lh = Number(lineText.slice(3));
      else if (lineText.startsWith('end_of_record') && cur) {
        const rel = cur.startsWith(root) ? cur.slice(root.length + 1) : cur;
        const id = idOf.get(rel) ?? facts.findIndex((f) => cur.endsWith(`/${f.path}`));
        if (id !== undefined && id >= 0 && lf > 0) {
          coverage[id] = Math.round((lh / lf) * 100);
          if (lh > 0) tested[id] = true;
          hasCoverage = true;
        }
        cur = null;
      }
    }
  }

  // ---------- Churn ----------
  const churnMap = opts.git === false ? new Map() : gitChurn(root);
  const churn = facts.map((f) => churnMap.get(f.path) || 0);

  // ---------- APIs ----------
  progress('Mapping API calls');
  const baseUrls = [];
  facts.forEach((f, id) => {
    for (const b of f.bases) {
      const r = ev(b.expr, f.lang);
      if (r.resolved && /^(https?|wss?):\/\//.test(r.value) && !baseUrls.some((x) => x.url === r.value)) {
        baseUrls.push({ url: r.value, file: id, line: b.line });
      }
    }
  });
  const distinctBaseHosts = [...new Set(baseUrls.map((b) => hostOf(b.url)).filter(Boolean))];
  const apis = [];
  const apiSeen = new Set();
  const screenFileSet = new Set(screens.map((s) => s.file));
  const usedByCache = new Map();
  const usedBy = (fileId) => {
    if (usedByCache.has(fileId)) return usedByCache.get(fileId);
    const files = reverseReach(fileId, prodRadj, (v) => screenFileSet.has(v));
    if (screenFileSet.has(fileId)) files.add(fileId);
    const ids = [...files].flatMap((fid) => screensInFile.get(fid) || []);
    usedByCache.set(fileId, ids);
    return ids;
  };
  facts.forEach((f, id) => {
    if (f.isTest || f.isGenerated) return;
    const list = [...f.apis];
    for (const c of f.constants) {
      if (c.enumValue && c.owner && /(endpoint|api|path)/i.test(c.owner) && !/route/i.test(c.owner)) {
        const v = ev(c.expr, f.lang);
        if (v.resolved && v.value.startsWith('/')) list.push({ method: 'API', expr: c.expr, client: `${c.owner}.${c.name}`, line: null });
      }
    }
    for (const a of list) {
      const r = ev(a.expr, f.lang);
      let url = r.value || a.expr;
      if (a.method === 'URL' && (IGNORED_URL.test(url) || ASSET_URL.test(url))) continue;
      if (a.method === 'URL' && baseUrls.some((b) => b.url === url && b.file === id)) continue;
      const key = `${a.method}|${url}|${id}|${a.line}`;
      if (apiSeen.has(key)) continue;
      apiSeen.add(key);
      let host = hostOf(url);
      if (!host && ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'REQUEST', 'API'].includes(a.method)) {
        host = distinctBaseHosts.length === 1 ? distinctBaseHosts[0] : null;
      }
      if (['FIRESTORE', 'CALLABLE'].includes(a.method)) host = 'firebase';
      if (a.client === 'supabase') host = 'supabase';
      apis.push({
        id: apis.length, method: a.method, url, resolved: r.resolved, client: a.client, file: id, line: a.line, usedBy: usedBy(id), host,
      });
    }
  });

  // ---------- Files ----------
  const fanIn = new Array(n).fill(0);
  const fanOut = new Array(n).fill(0);
  for (let i = 0; i < n; i++) { fanOut[i] = prodAdj[i].length; fanIn[i] = prodRadj[i].length; }
  const apisByFile = new Map();
  for (const a of apis) {
    if (!apisByFile.has(a.file)) apisByFile.set(a.file, []);
    apisByFile.get(a.file).push(a.id);
  }
  const files = facts.map((f, id) => ({
    id,
    path: f.path,
    lang: f.lang,
    role: roleOf(f, id),
    module: moduleNames[id],
    loc: f.loc,
    complexity: f.complexity,
    maxDepth: f.maxDepth,
    fanIn: fanIn[id],
    fanOut: fanOut[id],
    tested: tested[id],
    coverage: coverage[id],
    churn: churn[id],
    hotspot: 0,
    isTest: f.isTest,
    isGenerated: f.isGenerated,
    types: f.types.filter((t) => t.kind !== 'extension').map((t) => t.name),
    functions: [...f.functions].sort((a, b) => b.complexity - a.complexity).slice(0, 5),
    imports: [...new Set(adj[id])],
    importedBy: [...new Set(radj[id])],
    apis: apisByFile.get(id) || [],
    screens: screensInFile.get(id) || [],
  }));

  // ---------- Modules ----------
  const moduleIds = new Map();
  const modules = [];
  for (const f of files) {
    if (!moduleIds.has(f.module)) {
      moduleIds.set(f.module, modules.length);
      modules.push({ id: modules.length, name: f.module, files: 0, loc: 0, roles: {} });
    }
    const m = modules[moduleIds.get(f.module)];
    m.files++;
    m.loc += f.loc;
    m.roles[f.role] = (m.roles[f.role] || 0) + 1;
  }
  const modEdgeMap = new Map();
  for (const [a, b] of edges) {
    const ma = moduleIds.get(files[a].module);
    const mb = moduleIds.get(files[b].module);
    if (ma === mb) continue;
    const k = `${ma}>${mb}`;
    modEdgeMap.set(k, (modEdgeMap.get(k) || 0) + 1);
  }
  const moduleEdges = [...modEdgeMap.entries()].map(([k, w]) => [...k.split('>').map(Number), w]);

  // ---------- Risks ----------
  progress('Scoring risks');
  const prodIds = files.filter((f) => !f.isTest && !f.isGenerated).map((f) => f.id);
  const cycles = stronglyConnected(n, prodAdj)
    .sort((a, b) => b.length - a.length)
    .slice(0, 25)
    .map((comp) => ({ size: comp.length, files: comp.sort((a, b) => a - b), examples: exampleCycles(comp, prodAdj, 4) }));

  const testModule = moduleIds.get('tests');
  const modAdj = Array.from({ length: modules.length }, () => []);
  for (const [a, b] of moduleEdges) {
    if (a === testModule || b === testModule) continue;
    modAdj[a].push(b);
  }
  const moduleCycles = stronglyConnected(modules.length, modAdj).map((c) => ({ modules: c.sort((a, b) => a - b) }));

  const complex = [];
  for (const id of prodIds) {
    const f = files[id];
    const topFn = f.functions[0];
    const reasons = [];
    if (f.loc > 500) reasons.push(`${f.loc} lines`);
    if (topFn && topFn.complexity > 20) reasons.push(`${topFn.name}() has complexity ${topFn.complexity}`);
    if (f.complexity > 100) reasons.push(`total complexity ${f.complexity}`);
    if (f.maxDepth > 8) reasons.push(`nesting depth ${f.maxDepth}`);
    if (!reasons.length) continue;
    const score = f.loc / 500 + (topFn ? topFn.complexity / 20 : 0) + f.complexity / 100 + f.maxDepth / 8;
    complex.push({ file: id, score: Math.round(score * 10) / 10, reasons });
  }
  complex.sort((a, b) => b.score - a.score);

  const maxChurn = Math.max(0, ...prodIds.map((i) => files[i].churn));
  const maxCx = Math.max(1, ...prodIds.map((i) => files[i].complexity));
  const hotspots = [];
  if (maxChurn > 0) {
    for (const id of prodIds) {
      const f = files[id];
      f.hotspot = Math.round((f.churn / maxChurn) * (f.complexity / maxCx) * 1000) / 1000;
      if (f.churn >= 2 && f.hotspot > 0.02) hotspots.push({ file: id, churn: f.churn, complexity: f.complexity, score: f.hotspot });
    }
    hotspots.sort((a, b) => b.score - a.score);
  }

  const testableRoles = ['screen', 'state', 'service', 'repository', 'router', 'model', 'widget'];
  const byRole = testableRoles
    .map((role) => {
      const list = prodIds.filter((i) => files[i].role === role);
      return { role, total: list.length, tested: list.filter((i) => files[i].tested).length };
    })
    .filter((r) => r.total > 0);
  const untestedFiles = prodIds
    .filter((i) => ['screen', 'state', 'service', 'repository'].includes(files[i].role) && !files[i].tested)
    .sort((a, b) => files[b].complexity - files[a].complexity)
    .slice(0, 40);

  const fanInSorted = prodIds.map((i) => files[i].fanIn).sort((a, b) => a - b);
  const fanOutSorted = prodIds.map((i) => files[i].fanOut).sort((a, b) => a - b);
  const p95 = (arr) => (arr.length ? arr[Math.floor(arr.length * 0.95)] : 0);
  const fanInLimit = Math.max(12, p95(fanInSorted));
  const fanOutLimit = Math.max(15, p95(fanOutSorted));
  const godFiles = prodIds
    .filter((i) => files[i].fanIn > fanInLimit || files[i].fanOut > fanOutLimit)
    .map((i) => ({ file: i, fanIn: files[i].fanIn, fanOut: files[i].fanOut }))
    .sort((a, b) => b.fanIn + b.fanOut - (a.fanIn + a.fanOut))
    .slice(0, 12);

  // ---------- Health ----------
  const breakdown = [];
  const penalize = (label, penalty, detail) => { if (penalty > 0) breakdown.push({ label, penalty, detail }); };
  const filesInCycles = cycles.reduce((s, c) => s + c.size, 0);
  penalize('Import cycles', Math.min(15, cycles.length * 3 + Math.floor(filesInCycles / 20)),
    `${cycles.length} cycle${cycles.length === 1 ? '' : 's'} involving ${filesInCycles} files`);
  penalize('Module cycles', Math.min(5, moduleCycles.length * 2), `${moduleCycles.length} folder-level cycle${moduleCycles.length === 1 ? '' : 's'}`);
  const complexPct = prodIds.length ? complex.length / prodIds.length : 0;
  penalize('Complexity', Math.min(20, Math.round(complexPct * 80)), `${complex.length} of ${prodIds.length} files exceed size/complexity thresholds`);
  const testable = byRole.filter((r) => ['screen', 'state', 'service', 'repository'].includes(r.role));
  const tTotal = testable.reduce((s, r) => s + r.total, 0);
  const tTested = testable.reduce((s, r) => s + r.tested, 0);
  if (tTotal) penalize('Test coverage', Math.round((1 - tTested / tTotal) * 25), `${tTested} of ${tTotal} screens/state/services/repositories have tests`);
  penalize('Coupling', Math.min(10, godFiles.length), `${godFiles.length} files with very high fan-in or fan-out`);
  const score = Math.max(0, 100 - breakdown.reduce((s, b) => s + b.penalty, 0));
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';

  // ---------- Assemble ----------
  const prodLoc = prodIds.reduce((s, i) => s + files[i].loc, 0);
  const model = {
    tool: { name: 'mobile-repo-map', version: VERSION },
    generatedAt: new Date().toISOString(),
    project: {
      name: project.name,
      platforms: project.platforms.length ? project.platforms : [...new Set(facts.map((f) => f.lang))],
      stack,
      dependencies: project.dependencies,
      editorRoot: opts.editor === 'none' ? null : root,
      editor: opts.editor && opts.editor !== 'none' ? opts.editor : opts.editor === 'none' ? null : 'vscode',
      hasCoverage,
    },
    stats: {
      files: files.length,
      sourceFiles: prodIds.length,
      testFiles: files.filter((f) => f.isTest).length,
      loc: prodLoc,
      screens: screens.length,
      routes: routes.length,
      navEdges: navEdges.length,
      apiEndpoints: apis.filter((a) => a.method !== 'URL').length,
      urls: apis.filter((a) => a.method === 'URL').length,
      cycles: cycles.length,
      avgComplexity: prodIds.length ? Math.round((prodIds.reduce((s, i) => s + files[i].complexity, 0) / prodIds.length) * 10) / 10 : 0,
    },
    health: { score, grade, breakdown },
    files,
    edges,
    modules,
    moduleEdges,
    screens,
    routes: routes.map(({ screenClass, ...r }) => r),
    nav,
    apis,
    bases: baseUrls,
    risks: {
      cycles,
      moduleCycles,
      complex: complex.slice(0, 30),
      hotspots: hotspots.slice(0, 20),
      untested: { byRole, files: untestedFiles },
      godFiles,
    },
    warnings,
  };
  return model;
}

function hostOf(url) {
  const m = /^(?:https?|wss?):\/\/([^/?#{]+)/.exec(url || '');
  return m ? m[1] : null;
}
