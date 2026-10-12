/**
 * Markdown renderers for the analysis model.
 *
 *   renderMarkdown(model, { linkBase })  -> ARCHITECTURE.md (GitHub-flavoured, Mermaid diagrams)
 *   renderAiContext(model, { maxChars }) -> compact plain-markdown summary for pasting into an LLM chat
 *
 * Both are pure: no I/O, no clock, no randomness. The date comes from `model.generatedAt`.
 * Every field of the model is treated as optional so a partial or empty model still renders.
 */

const TOOL_URL = 'https://github.com/ananya-kaul/mobile-repo-map';

const MODULE_NODE_LIMIT = 25;
const MODULE_EDGE_LIMIT = 60;
const NAV_EDGE_LIMIT = 80;
const TOP_RISK_ROWS = 10;
const MAX_CYCLES_LISTED = 10;
const MAX_CYCLE_EXAMPLES = 3;
const MAX_UNTESTED_LISTED = 50;
const AI_KEY_FILES = 30;
const AI_DEFAULT_MAX_CHARS = 24000;

const ROLE_ORDER = [
  'entry', 'screen', 'widget', 'state', 'router', 'service',
  'repository', 'model', 'util', 'test', 'generated', 'other',
];

const ROLE_STYLE = {
  entry: 'fill:#fee2e2,stroke:#dc2626,color:#7f1d1d',
  screen: 'fill:#dbeafe,stroke:#2563eb,color:#1e3a8a',
  widget: 'fill:#e0e7ff,stroke:#6366f1,color:#312e81',
  state: 'fill:#fce7f3,stroke:#db2777,color:#831843',
  router: 'fill:#ffedd5,stroke:#ea580c,color:#7c2d12',
  service: 'fill:#dcfce7,stroke:#16a34a,color:#14532d',
  repository: 'fill:#ccfbf1,stroke:#0d9488,color:#134e4a',
  model: 'fill:#fef9c3,stroke:#ca8a04,color:#713f12',
  util: 'fill:#f1f5f9,stroke:#64748b,color:#0f172a',
  test: 'fill:#ecfccb,stroke:#65a30d,color:#365314',
  generated: 'fill:#f5f5f4,stroke:#a8a29e,color:#44403c',
  other: 'fill:#f3f4f6,stroke:#9ca3af,color:#111827',
};

const NAV_SHAPES = {
  screen: ['["', '"]'],
  route: ['(["', '"])'],
  source: ['[["', '"]]'],
  app: ['(("', '"))'],
};

const NAV_KIND_STYLE = {
  route: 'fill:#fff7ed,stroke:#ea580c,color:#7c2d12',
  source: 'fill:#f1f5f9,stroke:#64748b,color:#0f172a',
  app: 'fill:#ede9fe,stroke:#7c3aed,color:#4c1d95',
};

const NAV_ENTRY_STYLE = 'fill:#dcfce7,stroke:#16a34a,stroke-width:3px,color:#14532d';

const STACK_LABELS = [
  ['stateManagement', 'State management'],
  ['navigation', 'Navigation'],
  ['networking', 'Networking'],
  ['storage', 'Storage'],
  ['backend', 'Backend'],
];

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

const arr = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) =>
  (typeof v === 'number' && Number.isFinite(v)) ||
  (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));
const num = (v) => (isNum(v) ? Number(v) : 0);
const plural = (n, word, many = `${word}s`) => (Number(n) === 1 ? word : many);
const count = (n, word, many) => `${fmtInt(n)} ${plural(n, word, many)}`;

/** Locale-independent, deterministic string comparison (case-insensitive first). */
function cmpStr(a, b) {
  const x = String(a ?? '');
  const y = String(b ?? '');
  const lx = x.toLowerCase();
  const ly = y.toLowerCase();
  if (lx !== ly) return lx < ly ? -1 : 1;
  if (x !== y) return x < y ? -1 : 1;
  return 0;
}

function groupDigits(s) {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtInt(v) {
  if (!isNum(v)) return '—';
  return groupDigits(String(Math.round(Number(v))));
}

function fmtNum(v) {
  if (!isNum(v)) return '—';
  const n = Number(v);
  if (Number.isInteger(n)) return groupDigits(String(n));
  const [int, dec] = n.toFixed(1).split('.');
  return dec === '0' ? groupDigits(int) : `${groupDigits(int)}.${dec}`;
}

function oneLine(v) {
  return String(v ?? '').replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

/** Escape text for inline markdown. `|` is left alone; table() escapes it per cell. */
function esc(v) {
  const s = oneLine(v).replace(/[\\`[\]<>]/g, '\\$&');
  // `_` between two word characters never starts emphasis in GFM, so keep identifiers readable.
  return s.replace(/[*_]+/g, (run, i, str) => {
    const before = str[i - 1];
    const after = str[i + run.length];
    const intraword = /[A-Za-z0-9]/.test(before ?? '') && /[A-Za-z0-9]/.test(after ?? '');
    if (intraword && !run.includes('*')) return run;
    return run.replace(/[*_]/g, '\\$&');
  });
}

/** Inline code span that survives embedded backticks. */
function code(v) {
  const s = oneLine(v);
  if (!s) return '';
  const runs = s.match(/`+/g);
  if (!runs) return `\`${s}\``;
  const fence = '`'.repeat(Math.max(...runs.map((r) => r.length)) + 1);
  return `${fence} ${s} ${fence}`;
}

function table(headers, rows, align = []) {
  const cell = (c) => {
    const s = String(c ?? '').replace(/\|/g, '\\|');
    return s === '' ? '—' : s;
  };
  const out = [
    `| ${headers.map(cell).join(' | ')} |`,
    `| ${headers.map((_, i) => (align[i] === 'r' ? '---:' : '---')).join(' | ')} |`,
  ];
  for (const row of rows) out.push(`| ${row.map(cell).join(' | ')} |`);
  return out.join('\n');
}

function details(summary, body) {
  return `<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`;
}

const MERMAID_ENTITIES = {
  '#': '#35;', '"': '#quot;', '&': '#amp;', '<': '#lt;', '>': '#gt;',
  '[': '#91;', ']': '#93;', '(': '#40;', ')': '#41;', '{': '#123;', '}': '#125;',
  '|': '#124;', '`': '#96;', '\\': '#92;',
};

/** Escape text for use inside a quoted Mermaid label. Single pass, so entities are never double-escaped. */
function mm(v) {
  return oneLine(v).replace(/[#"&<>[\](){}|`\\]/g, (c) => MERMAID_ENTITIES[c]);
}

/** Edge labels sit between pipes unquoted; keep only harmless characters. */
function mmEdgeLabel(v) {
  return oneLine(v).replace(/[^\w .:/-]/g, '').trim();
}

function dateOf(iso) {
  if (typeof iso === 'string') {
    const m = /^\d{4}-\d{2}-\d{2}/.exec(iso);
    if (m) return m[0];
  }
  if (iso !== undefined && iso !== null && iso !== '') {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return 'an unknown date';
}

function hostOf(url) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#\s]+)/i.exec(String(url ?? ''));
  return m ? m[1].replace(/^[^@]*@/, '').toLowerCase() : '';
}

function encodePath(p) {
  let out;
  try {
    out = encodeURI(p);
  } catch {
    out = String(p).replace(/[^\w./-]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  }
  return out.replace(/[()#?]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function normalizeLinkBase(linkBase) {
  if (linkBase === null || linkBase === false) return null;
  let base = String(linkBase ?? '').replace(/ /g, '%20');
  if (base && !base.endsWith('/')) base += '/';
  return base;
}

// ---------------------------------------------------------------------------
// Model indexing
// ---------------------------------------------------------------------------

function lookupBy(list) {
  const byId = new Map();
  list.forEach((x, i) => {
    if (isObj(x)) byId.set(String(x.id ?? i), x);
  });
  return (ref) => (ref === null || ref === undefined ? undefined : byId.get(String(ref)));
}

function indexModel(model) {
  const m = isObj(model) ? model : {};
  const files = arr(m.files).filter(isObj);
  const screens = arr(m.screens).filter(isObj);
  const modules = arr(m.modules).filter(isObj);
  const apis = arr(m.apis).filter(isObj);
  const routes = arr(m.routes).filter(isObj);
  const fileById = lookupBy(arr(m.files));
  const byPath = new Map(files.filter((f) => f.path).map((f) => [String(f.path), f]));
  const screenById = lookupBy(arr(m.screens));
  const moduleById = lookupBy(arr(m.modules));

  /** Resolve a file reference that may be a file id or a literal path. */
  const fileOf = (ref) => {
    if (ref === null || ref === undefined || ref === '') return undefined;
    const f = fileById(ref) ?? byPath.get(String(ref));
    if (f) return f;
    return typeof ref === 'string' ? { path: ref } : undefined;
  };
  const pathOf = (ref) => fileOf(ref)?.path ?? '';
  const screenName = (ref) => {
    const s = screenById(ref);
    if (s?.name) return String(s.name);
    return typeof ref === 'string' && ref ? ref : '';
  };
  const moduleName = (ref) => {
    const mod = moduleById(ref);
    if (mod?.name) return String(mod.name);
    return ref === null || ref === undefined ? '' : `module ${ref}`;
  };

  return { m, files, screens, modules, apis, routes, fileOf, pathOf, screenName, moduleName, moduleById };
}

const isUrlLiteral = (api) => String(api.method ?? '').toUpperCase() === 'URL';

function apiHost(api) {
  return String(api.host || hostOf(api.resolved) || hostOf(api.url) || '').toLowerCase();
}

function moduleFileCount(mod) {
  return Array.isArray(mod.files) ? mod.files.length : num(mod.files);
}

function dominantRole(mod) {
  const roles = isObj(mod.roles) ? mod.roles : {};
  let best = null;
  let bestCount = 0;
  for (const [role, count] of Object.entries(roles)) {
    const c = num(count);
    if (c <= 0) continue;
    const better = c > bestCount ||
      (c === bestCount && roleRank(role) < roleRank(best));
    if (better) {
      best = role;
      bestCount = c;
    }
  }
  return best ?? 'other';
}

function roleRank(role) {
  const i = ROLE_ORDER.indexOf(role);
  return i === -1 ? ROLE_ORDER.length : i;
}

function roleBreakdown(mod) {
  const roles = isObj(mod.roles) ? mod.roles : {};
  return Object.entries(roles)
    .filter(([, c]) => num(c) > 0)
    .sort((a, b) => num(b[1]) - num(a[1]) || roleRank(a[0]) - roleRank(b[0]) || cmpStr(a[0], b[0]))
    .map(([role, c]) => `${role} ${fmtInt(c)}`);
}

/**
 * Distinct navigation edges in breadth-first order from the entry points, then any remaining
 * components in their original order. Duplicate (from, to, kind) triples collapse into one.
 */
function orderNavEdges(nav) {
  const nodes = arr(nav?.nodes).filter(isObj);
  const seen = new Set();
  const edges = [];
  for (const e of arr(nav?.edges)) {
    if (!isObj(e) || e.from === undefined || e.from === null || e.to === undefined || e.to === null) continue;
    const kind = e.kind ? String(e.kind) : 'push';
    const from = String(e.from);
    const to = String(e.to);
    const key = `${from}\u0000${to}\u0000${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ ...e, from, to, kind });
  }

  const known = new Set(nodes.map((n) => String(n.id)));
  for (const e of edges) {
    known.add(e.from);
    known.add(e.to);
  }
  const declaredEntries = [...new Set(arr(nav?.entries).map(String))].filter((id) => known.has(id));

  let roots = declaredEntries;
  if (!roots.length) {
    const incoming = new Set(edges.map((e) => e.to));
    roots = nodes.filter((n) => n.kind === 'app').map((n) => String(n.id));
    if (!roots.length) roots = [...new Set(edges.map((e) => e.from).filter((id) => !incoming.has(id)))];
  }

  const outgoing = new Map();
  edges.forEach((e, i) => {
    if (!outgoing.has(e.from)) outgoing.set(e.from, []);
    outgoing.get(e.from).push(i);
  });
  const taken = new Array(edges.length).fill(false);
  const visited = new Set();
  const ordered = [];
  const bfs = (starts) => {
    const queue = [];
    for (const s of starts) {
      if (!visited.has(s)) {
        visited.add(s);
        queue.push(s);
      }
    }
    for (let qi = 0; qi < queue.length; qi++) {
      for (const i of outgoing.get(queue[qi]) ?? []) {
        if (taken[i]) continue;
        taken[i] = true;
        ordered.push(edges[i]);
        const next = edges[i].to;
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
  };
  bfs(roots);
  for (let i = 0; i < edges.length; i++) {
    if (taken[i]) continue;
    if (visited.has(edges[i].from)) {
      taken[i] = true;
      ordered.push(edges[i]);
    } else {
      bfs([edges[i].from]);
    }
  }

  const nodeById = new Map(nodes.map((n) => [String(n.id), n]));
  return { edges: ordered, declaredEntries, nodeById };
}

function navLabel(node, id) {
  return String(node?.label ?? node?.route ?? id);
}

// ---------------------------------------------------------------------------
// ARCHITECTURE.md
// ---------------------------------------------------------------------------

/**
 * Render an ARCHITECTURE.md for the analysed repo.
 *
 * @param {object} model analysis model
 * @param {object} [options]
 * @param {string|null|false} [options.linkBase=''] prefix for file links. '' assumes the markdown
 *   sits at the repo root; use e.g. '../' for a sub-folder or a blob URL for absolute links.
 *   Pass null/false to render file references as plain code without links.
 * @returns {string}
 */
export function renderMarkdown(model, { linkBase = '' } = {}) {
  const ctx = { ...indexModel(model), linkBase: normalizeLinkBase(linkBase) };
  const blocks = [
    ...headerBlocks(ctx),
    ...glanceBlocks(ctx),
    ...moduleBlocks(ctx),
    ...navigationBlocks(ctx),
    ...screenBlocks(ctx),
    ...apiBlocks(ctx),
    ...riskBlocks(ctx),
    ...healthBlocks(ctx),
  ];
  return `${blocks.filter((b) => b !== '').join('\n\n')}\n`;
}

function fileLink(ctx, ref, line) {
  const file = ctx.fileOf(ref);
  if (!file?.path) return '—';
  const ln = isNum(line) && Number(line) > 0 ? Math.trunc(Number(line)) : null;
  const text = code(ln ? `${file.path}:${ln}` : file.path);
  if (ctx.linkBase === null) return text;
  return `[${text}](${ctx.linkBase}${encodePath(String(file.path))}${ln ? `#L${ln}` : ''})`;
}

function headerBlocks(ctx) {
  const name = ctx.m.project?.name || 'Project';
  const version = ctx.m.tool?.version || '0.0.0';
  return [
    `# ${esc(name)} — Architecture`,
    `_Generated by [MobileRepoMap](${TOOL_URL}) v${esc(version)} on ${dateOf(ctx.m.generatedAt)}. ` +
      'Static analysis — verify before relying on it._',
  ];
}

function statsOf(ctx) {
  const s = isObj(ctx.m.stats) ? ctx.m.stats : {};
  const pick = (key, fallback) => (isNum(s[key]) ? Number(s[key]) : fallback);
  const { files, apis } = ctx;
  return {
    files: pick('files', files.length),
    sourceFiles: pick('sourceFiles', files.filter((f) => !f.isTest).length),
    testFiles: pick('testFiles', files.filter((f) => f.isTest).length),
    loc: pick('loc', files.reduce((sum, f) => sum + num(f.loc), 0)),
    screens: pick('screens', ctx.screens.length),
    routes: pick('routes', ctx.routes.length),
    navEdges: pick('navEdges', arr(ctx.m.nav?.edges).length),
    apiEndpoints: pick('apiEndpoints', apis.filter((a) => !isUrlLiteral(a)).length),
    urls: pick('urls', apis.filter(isUrlLiteral).length),
    cycles: pick('cycles', arr(ctx.m.risks?.cycles).length),
    avgComplexity: pick('avgComplexity', null),
  };
}

function healthText(health, { bold = false } = {}) {
  if (!isObj(health) || !isNum(health.score)) return null;
  const score = `${fmtNum(health.score)}/100`;
  const grade = health.grade ? ` (grade ${esc(health.grade)})` : '';
  return `${bold ? `**${score}**` : score}${grade}`;
}

function glanceBlocks(ctx) {
  const st = statsOf(ctx);
  const sourceFiles = ctx.files.filter((f) => !f.isTest && !f.isGenerated && f.role !== 'test' && f.role !== 'generated');
  const tested = sourceFiles.filter((f) => f.tested).length;
  let tests = `${fmtInt(st.testFiles)} test ${plural(st.testFiles, 'file')}`;
  if (sourceFiles.length) {
    tests += ` · ${fmtInt(tested)}/${fmtInt(sourceFiles.length)} source files have a test ` +
      `(${Math.round((tested / sourceFiles.length) * 100)}%)`;
  }
  let api = fmtInt(st.apiEndpoints);
  if (st.urls) api += ` (+${fmtInt(st.urls)} plain URL ${plural(st.urls, 'literal')})`;

  const rows = [
    ['Files', `${fmtInt(st.files)} (${fmtInt(st.sourceFiles)} source, ${fmtInt(st.testFiles)} test)`],
    ['Lines of code', fmtInt(st.loc)],
    ['Modules', fmtInt(ctx.modules.length)],
    ['Screens', fmtInt(st.screens)],
    ['Routes', fmtInt(st.routes)],
    ['Navigation edges', fmtInt(st.navEdges)],
    ['API endpoints', api],
    ['Tests', tests],
    ['Import cycles', fmtInt(st.cycles)],
    ['Average complexity', fmtNum(st.avgComplexity)],
    ['Health score', healthText(ctx.m.health, { bold: true }) ?? '—'],
  ];

  const project = isObj(ctx.m.project) ? ctx.m.project : {};
  const stack = isObj(project.stack) ? project.stack : {};
  const list = (values) => {
    const items = arr(values).map(oneLine).filter(Boolean);
    return items.length ? items.map(esc).join(', ') : '_none detected_';
  };
  const stackLines = [
    `- **Platforms:** ${list(project.platforms)}`,
    ...STACK_LABELS.map(([key, label]) => `- **${label}:** ${list(stack[key])}`),
  ];

  const blocks = ['## At a glance', table(['Metric', 'Value'], rows), '**Stack**', stackLines.join('\n')];
  const deps = arr(project.dependencies).map(oneLine).filter(Boolean);
  if (deps.length) {
    blocks.push(details(`${deps.length} declared ${plural(deps.length, 'dependency', 'dependencies')}`,
      deps.map(code).join(', ')));
  }
  return blocks;
}

function moduleBlocks(ctx) {
  const blocks = ['## Module map'];
  const mods = arr(ctx.m.modules)
    .map((mod, i) => (isObj(mod) ? { mod, key: String(mod.id ?? i) } : null))
    .filter(Boolean);
  if (!mods.length) {
    blocks.push('_No modules detected._');
    return blocks;
  }

  const ranked = [...mods].sort((a, b) =>
    num(b.mod.loc) - num(a.mod.loc) || cmpStr(a.mod.name, b.mod.name) || cmpStr(a.key, b.key));
  const shown = ranked.slice(0, MODULE_NODE_LIMIT);
  const nodeId = new Map(shown.map((x, i) => [x.key, `m${i}`]));

  const pairs = new Set();
  const agg = new Map();
  for (const e of arr(ctx.m.moduleEdges)) {
    const [from, to, weight] = Array.isArray(e) ? e : [e?.from, e?.to, e?.weight];
    if (from === undefined || from === null || to === undefined || to === null) continue;
    if (String(from) === String(to)) continue;
    pairs.add(`${from}\u0000${to}`);
    const a = nodeId.get(String(from));
    const b = nodeId.get(String(to));
    if (!a || !b) continue;
    const key = `${a}>${b}`;
    const w = isNum(weight) ? Number(weight) : 1;
    agg.set(key, { a, b, w: (agg.get(key)?.w ?? 0) + w });
  }
  const idx = (id) => Number(id.slice(1));
  const edges = [...agg.values()]
    .sort((x, y) => y.w - x.w || idx(x.a) - idx(y.a) || idx(x.b) - idx(y.b))
    .slice(0, MODULE_EDGE_LIMIT);

  const lines = ['```mermaid', 'flowchart LR'];
  const byRole = new Map();
  shown.forEach((x, i) => {
    const count = moduleFileCount(x.mod);
    const name = x.mod.name ?? `module ${x.key}`;
    lines.push(`  m${i}["${mm(name)}<br/>${fmtInt(count)} ${plural(count, 'file')}"]`);
    const role = dominantRole(x.mod);
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role).push(`m${i}`);
  });
  for (const e of edges) lines.push(`  ${e.a} -->|${Math.round(e.w)}| ${e.b}`);
  const roles = [...byRole.keys()].sort((a, b) => roleRank(a) - roleRank(b) || cmpStr(a, b));
  for (const role of roles) {
    const cls = `role_${role.replace(/\W/g, '_')}`;
    lines.push(`  classDef ${cls} ${ROLE_STYLE[role] ?? ROLE_STYLE.other}`);
    lines.push(`  class ${byRole.get(role).join(',')} ${cls}`);
  }
  lines.push('```');
  blocks.push(lines.join('\n'));

  blocks.push(`Node color = dominant file role (${roles.map(esc).join(', ')}). ` +
    'Edge labels = number of imports from one module into the other.');

  const notes = [];
  if (mods.length > shown.length) {
    notes.push(`the ${shown.length} largest of ${mods.length} modules (by lines of code)`);
  }
  if (pairs.size > edges.length) {
    notes.push(`the ${edges.length} heaviest of ${pairs.size} module dependencies ` +
      `(${pairs.size - edges.length} omitted)`);
  }
  if (notes.length) blocks.push(`_Diagram truncated: showing ${notes.join(' and ')}._`);

  const rows = shown.map((x) => [
    code(x.mod.name ?? `module ${x.key}`),
    fmtInt(moduleFileCount(x.mod)),
    fmtInt(x.mod.loc),
    esc(dominantRole(x.mod)),
    esc(roleBreakdown(x.mod).join(', ')) || '—',
  ]);
  blocks.push(table(['Module', 'Files', 'LOC', 'Dominant role', 'Roles'], rows, ['', 'r', 'r']));
  if (mods.length > shown.length) {
    blocks.push(`_…and ${mods.length - shown.length} smaller ${plural(mods.length - shown.length, 'module')}._`);
  }
  return blocks;
}

function navigationBlocks(ctx) {
  const blocks = ['## Navigation'];
  const nav = isObj(ctx.m.nav) ? ctx.m.nav : {};
  const { edges, declaredEntries, nodeById } = orderNavEdges(nav);

  if (!edges.length) {
    blocks.push('_No navigation detected._');
  } else {
    const shown = edges.slice(0, NAV_EDGE_LIMIT);
    const ids = new Map();
    const touch = (id) => {
      if (!ids.has(id)) ids.set(id, `n${ids.size}`);
      return ids.get(id);
    };
    for (const id of declaredEntries) touch(id);
    for (const e of shown) {
      touch(e.from);
      touch(e.to);
    }

    const lines = ['```mermaid', 'flowchart LR'];
    const byKind = new Map();
    for (const [id, nid] of ids) {
      const node = nodeById.get(id);
      const kind = node?.kind && NAV_SHAPES[node.kind] ? node.kind : 'screen';
      const [open, close] = NAV_SHAPES[kind];
      lines.push(`  ${nid}${open}${mm(navLabel(node, id))}${close}`);
      if (NAV_KIND_STYLE[kind]) {
        if (!byKind.has(kind)) byKind.set(kind, []);
        byKind.get(kind).push(nid);
      }
    }
    for (const e of shown) {
      const arrow = e.kind === 'modal' ? '-.->' : '-->';
      const text = e.kind !== 'push' ? mmEdgeLabel(e.kind) : '';
      lines.push(`  ${ids.get(e.from)} ${arrow}${text ? `|${text}|` : ''} ${ids.get(e.to)}`);
    }
    for (const kind of Object.keys(NAV_KIND_STYLE)) {
      if (!byKind.has(kind)) continue;
      lines.push(`  classDef nav_${kind} ${NAV_KIND_STYLE[kind]}`);
      lines.push(`  class ${byKind.get(kind).join(',')} nav_${kind}`);
    }
    if (declaredEntries.length) {
      lines.push(`  classDef entry ${NAV_ENTRY_STYLE}`);
      lines.push(`  class ${declaredEntries.map((id) => ids.get(id)).join(',')} entry`);
    }
    lines.push('```');
    blocks.push(lines.join('\n'));

    const legend = [];
    if (declaredEntries.length) legend.push('Green, thick-bordered nodes are entry points.');
    legend.push('Dotted arrows are modal presentations; arrow labels name the transition when it is not a plain push.');
    blocks.push(legend.join(' '));
    if (edges.length > shown.length) {
      blocks.push(`_Diagram truncated: showing ${shown.length} of ${edges.length} distinct navigation edges ` +
        `(${edges.length - shown.length} omitted), in breadth-first order from the entry points._`);
    }
  }

  blocks.push('### Routes');
  if (!ctx.routes.length) {
    blocks.push('_No routes detected._');
  } else {
    const rows = ctx.routes.map((r) => [
      code(r.path) || '—',
      esc(ctx.screenName(r.screen)) || '—',
      fileLink(ctx, r.file, r.line),
      esc(r.source) || '—',
    ]);
    blocks.push(table(['Path', 'Screen', 'File', 'Source'], rows));
  }
  return blocks;
}

function screenBlocks(ctx) {
  const blocks = ['## Screens'];
  if (!ctx.screens.length) {
    blocks.push('_No screens detected._');
    return blocks;
  }
  const list = [...ctx.screens].sort((a, b) =>
    cmpStr(a.name, b.name) || cmpStr(ctx.pathOf(a.file), ctx.pathOf(b.file)) || num(a.line) - num(b.line));
  const rows = list.map((s) => [
    `${esc(s.name || '(unnamed)')}${s.entry ? ' _(entry)_' : ''}`,
    esc(s.kind) || '—',
    arr(s.routes).map(code).filter(Boolean).join(', ') || '—',
    fileLink(ctx, s.file, s.line),
  ]);
  blocks.push(table(['Screen', 'Kind', 'Routes', 'File'], rows));
  return blocks;
}

function apiBlocks(ctx) {
  const blocks = ['## API surface'];
  const calls = ctx.apis.filter((a) => !isUrlLiteral(a));
  const urls = ctx.apis.filter(isUrlLiteral);
  const baseSeen = new Set();
  const bases = arr(ctx.m.bases).filter(isObj).filter((b) => {
    const key = `${b.url}\u0000${ctx.pathOf(b.file)}\u0000${b.line}`;
    if (!b.url || baseSeen.has(key)) return false;
    baseSeen.add(key);
    return true;
  });

  if (!calls.length && !urls.length && !bases.length) {
    blocks.push('_No API calls detected._');
    return blocks;
  }

  if (bases.length) {
    blocks.push('**Base URLs**');
    blocks.push(bases.map((b) => `- ${code(b.url)} — ${fileLink(ctx, b.file, b.line)}`).join('\n'));
  }

  const endpointOf = (a) => oneLine(a.resolved || a.url);
  const sortRows = (list) => [...list].sort((a, b) =>
    cmpStr(endpointOf(a), endpointOf(b)) || cmpStr(a.method, b.method) ||
    cmpStr(ctx.pathOf(a.file), ctx.pathOf(b.file)) || num(a.line) - num(b.line));
  const usedBy = (a) => [...new Set(arr(a.usedBy).map(ctx.screenName).filter(Boolean))]
    .sort(cmpStr).map(esc).join(', ') || '—';

  if (!calls.length) {
    blocks.push('_No API calls detected._');
  } else {
    const groups = new Map();
    for (const a of calls) {
      const host = apiHost(a);
      if (!groups.has(host)) groups.set(host, []);
      groups.get(host).push(a);
    }
    const hosts = [...groups.keys()].sort((x, y) => {
      if (!x !== !y) return x ? -1 : 1; // unknown host last
      return groups.get(y).length - groups.get(x).length || cmpStr(x, y);
    });
    for (const host of hosts) {
      const list = sortRows(groups.get(host));
      blocks.push(`### ${host ? esc(host) : 'Relative or unresolved host'} (${list.length})`);
      blocks.push(table(['Method', 'Endpoint', 'Client', 'File', 'Used by'], list.map((a) => [
        code(String(a.method ?? '').toUpperCase()) || '—',
        code(endpointOf(a)) || '—',
        esc(a.client) || '—',
        fileLink(ctx, a.file, a.line),
        usedBy(a),
      ])));
    }
  }

  if (urls.length) {
    const rows = sortRows(urls).map((a) => [code(endpointOf(a)) || '—', fileLink(ctx, a.file, a.line), usedBy(a)]);
    blocks.push(details(`${urls.length} plain URL ${plural(urls.length, 'literal')}`,
      table(['URL', 'File', 'Used by'], rows)));
  }
  return blocks;
}

function cycleChain(ctx, ids, render) {
  const list = arr(ids);
  if (!list.length) return '';
  const closed = list.length > 1 && String(list[0]) === String(list[list.length - 1]) ? list : [...list, list[0]];
  return closed.map((id) => render(ctx.pathOf(id) || String(id))).join(' → ');
}

function riskBlocks(ctx) {
  const r = isObj(ctx.m.risks) ? ctx.m.risks : {};
  const blocks = ['## Risks'];

  // Import cycles
  blocks.push('### Import cycles');
  const cycles = arr(r.cycles).filter(isObj);
  if (!cycles.length) {
    blocks.push('_No import cycles detected._');
  } else {
    blocks.push(`${cycles.length} import ${plural(cycles.length, 'cycle')} — groups of files that ` +
      'import each other directly or indirectly:');
    const items = cycles.slice(0, MAX_CYCLES_LISTED).map((c, i) => {
      const size = num(c.size) || arr(c.files).length;
      const examples = arr(c.examples).filter(Array.isArray).slice(0, MAX_CYCLE_EXAMPLES)
        .map((ex) => cycleChain(ctx, ex, code)).filter(Boolean);
      return [`- **Cycle ${i + 1}** — ${fmtInt(size)} ${plural(size, 'file')}`,
        ...examples.map((ex) => `  - ${ex}`)].join('\n');
    });
    if (cycles.length > MAX_CYCLES_LISTED) items.push(`- _…and ${cycles.length - MAX_CYCLES_LISTED} more._`);
    blocks.push(items.join('\n'));
  }

  // Module cycles
  blocks.push('### Module cycles');
  const moduleCycles = arr(r.moduleCycles).filter(isObj).filter((c) => arr(c.modules).length);
  if (!moduleCycles.length) {
    blocks.push('_No module cycles detected._');
  } else {
    const items = moduleCycles.slice(0, MAX_CYCLES_LISTED)
      .map((c) => `- ${arr(c.modules).map((id) => code(ctx.moduleName(id))).join(' ↔ ')}`);
    if (moduleCycles.length > MAX_CYCLES_LISTED) {
      items.push(`- _…and ${moduleCycles.length - MAX_CYCLES_LISTED} more._`);
    }
    blocks.push(items.join('\n'));
  }

  // Complex files
  blocks.push('### Most complex files');
  const complex = arr(r.complex).filter(isObj)
    .sort((a, b) => num(b.score) - num(a.score) || cmpStr(ctx.pathOf(a.file), ctx.pathOf(b.file)))
    .slice(0, TOP_RISK_ROWS);
  if (!complex.length) {
    blocks.push('_No unusually complex files detected._');
  } else {
    blocks.push(table(['File', 'Score', 'Reasons'], complex.map((c) => [
      fileLink(ctx, c.file),
      fmtNum(c.score),
      arr(c.reasons).map(esc).filter(Boolean).join('; ') || '—',
    ]), ['', 'r']));
  }

  // Hotspots
  blocks.push('### Hotspots');
  const hotspots = arr(r.hotspots).filter(isObj).filter((h) => num(h.churn) > 0)
    .sort((a, b) => num(b.score) - num(a.score) || cmpStr(ctx.pathOf(a.file), ctx.pathOf(b.file)))
    .slice(0, TOP_RISK_ROWS);
  if (hotspots.length) {
    blocks.push('Files that change often _and_ are complex — the likeliest places for regressions.');
    blocks.push(table(['File', 'Commits (12 mo)', 'Complexity', 'Score'], hotspots.map((h) => [
      fileLink(ctx, h.file), fmtInt(h.churn), fmtNum(h.complexity), fmtNum(h.score),
    ]), ['', 'r', 'r', 'r']));
  } else if (ctx.files.some((f) => num(f.churn) > 0)) {
    blocks.push('_No hotspots detected._');
  } else {
    blocks.push('_No git history available — hotspot analysis skipped._');
  }

  // Test coverage
  blocks.push('### Test coverage by role');
  const untested = isObj(r.untested) ? r.untested : {};
  const byRole = arr(untested.byRole).filter(isObj).filter((x) => num(x.total) > 0)
    .sort((a, b) => roleRank(a.role) - roleRank(b.role) || cmpStr(a.role, b.role));
  const untestedFiles = arr(untested.files).map((id) => ctx.fileOf(id)).filter((f) => f?.path);
  if (!byRole.length && !untestedFiles.length) {
    blocks.push('_No test coverage data._');
  } else {
    if (byRole.length) {
      blocks.push(table(['Role', 'Files', 'Tested', 'Coverage'], byRole.map((x) => [
        esc(x.role) || '—',
        fmtInt(x.total),
        fmtInt(x.tested),
        `${Math.round((num(x.tested) / num(x.total)) * 100)}%`,
      ]), ['', 'r', 'r', 'r']));
    }
    if (untestedFiles.length) {
      const sorted = [...untestedFiles].sort((a, b) => cmpStr(a.path, b.path));
      const items = sorted.slice(0, MAX_UNTESTED_LISTED).map((f) => `- ${fileLink(ctx, f.path)}`);
      if (sorted.length > MAX_UNTESTED_LISTED) items.push(`- _…and ${sorted.length - MAX_UNTESTED_LISTED} more._`);
      blocks.push(details(`${sorted.length} untested source ${plural(sorted.length, 'file')}`, items.join('\n')));
    }
  }

  // God files
  blocks.push('### God files');
  const god = arr(r.godFiles).filter(isObj)
    .sort((a, b) => (num(b.fanIn) + num(b.fanOut)) - (num(a.fanIn) + num(a.fanOut)) ||
      cmpStr(ctx.pathOf(a.file), ctx.pathOf(b.file)))
    .slice(0, TOP_RISK_ROWS);
  if (!god.length) {
    blocks.push('_No god files detected._');
  } else {
    blocks.push('Files with unusually many dependents (fan-in) and dependencies (fan-out).');
    blocks.push(table(['File', 'Fan-in', 'Fan-out'], god.map((g) => [
      fileLink(ctx, g.file), fmtInt(g.fanIn), fmtInt(g.fanOut),
    ]), ['', 'r', 'r']));
  }
  return blocks;
}

function healthBlocks(ctx) {
  const blocks = ['## Health score'];
  const health = isObj(ctx.m.health) ? ctx.m.health : {};
  const score = healthText(health, { bold: true });
  if (!score) {
    blocks.push('_No health score computed._');
    return blocks;
  }
  blocks.push(`Overall: ${score}`);
  const breakdown = arr(health.breakdown).filter(isObj);
  if (!breakdown.length) {
    blocks.push('_No penalties applied._');
  } else {
    blocks.push(table(['Factor', 'Penalty', 'Detail'], breakdown.map((b) => {
      const p = num(b.penalty);
      return [esc(b.label) || '—', p > 0 ? `-${fmtNum(p)}` : fmtNum(p), esc(b.detail) || '—'];
    }), ['', 'r']));
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// AI context
// ---------------------------------------------------------------------------

/**
 * Compact markdown summary of the model for use as LLM context.
 * Lists are trimmed lowest-priority first (dependencies, key files, navigation, APIs, modules,
 * screens, risks) until the output fits `maxChars`; a truncation note is appended when that happens.
 *
 * @param {object} model analysis model
 * @param {object} [options]
 * @param {number} [options.maxChars=24000] hard upper bound on the returned string length
 * @returns {string}
 */
export function renderAiContext(model, { maxChars = AI_DEFAULT_MAX_CHARS } = {}) {
  let limit = maxChars === undefined || maxChars === null ? AI_DEFAULT_MAX_CHARS : Number(maxChars);
  if (Number.isNaN(limit)) limit = AI_DEFAULT_MAX_CHARS;
  limit = Math.floor(limit);
  if (limit <= 0) return '';
  const ctx = indexModel(model);
  return fitSections(aiSections(ctx), limit);
}

function fileWithLine(ctx, ref, line) {
  const p = ctx.pathOf(ref);
  if (!p) return '';
  return isNum(line) && Number(line) > 0 ? `${p}:${Math.trunc(Number(line))}` : p;
}

function aiSections(ctx) {
  const { m } = ctx;
  const project = isObj(m.project) ? m.project : {};
  const stack = isObj(project.stack) ? project.stack : {};
  const st = statsOf(ctx);
  const sections = [];
  const add = (s) => sections.push({ pre: [], items: [], priority: 0, noun: 'items', ...s });
  const csv = (values) => arr(values).map(oneLine).filter(Boolean).join(', ');

  // Header + project (never trimmed)
  add({
    title: `# ${oneLine(project.name || 'Project')} — codebase context`,
    pre: [`Static analysis by mobile-repo-map v${oneLine(m.tool?.version || '0.0.0')} on ${dateOf(m.generatedAt)}. ` +
      'Heuristic and possibly incomplete; paths are relative to the repo root.'],
  });
  const stackParts = STACK_LABELS.map(([key, label]) => (csv(stack[key]) ? `${label}: ${csv(stack[key])}` : ''))
    .filter(Boolean);
  const projectLines = [
    `- Platforms: ${csv(project.platforms) || 'unknown'}`,
    `- Stack: ${stackParts.join('; ') || 'none detected'}`,
    `- Size: ${count(st.files, 'file')} (${fmtInt(st.sourceFiles)} source, ${fmtInt(st.testFiles)} test), ` +
      `${fmtInt(st.loc)} LOC, ${count(ctx.modules.length, 'module')}, ${count(st.screens, 'screen')}, ` +
      `${count(st.routes, 'route')}, ${count(st.navEdges, 'navigation edge')}, ${count(st.apiEndpoints, 'API endpoint')}`,
  ];
  const health = isObj(m.health) ? m.health : {};
  if (isNum(health.score)) {
    const penalties = arr(health.breakdown).filter(isObj).filter((b) => num(b.penalty) !== 0)
      .map((b) => `${oneLine(b.label)} -${fmtNum(Math.abs(num(b.penalty)))}`);
    projectLines.push(`- Health: ${fmtNum(health.score)}/100${health.grade ? ` (${oneLine(health.grade)})` : ''}` +
      (penalties.length ? `; penalties: ${penalties.join(', ')}` : ''));
  }
  const entryFiles = ctx.files.filter((f) => f.role === 'entry' && f.path).map((f) => f.path).sort(cmpStr);
  if (entryFiles.length) projectLines.push(`- Entry files: ${entryFiles.join(', ')}`);
  add({ title: '## Project', pre: projectLines });

  // Dependencies
  const deps = arr(project.dependencies).map(oneLine).filter(Boolean);
  if (deps.length) {
    add({ title: `## Dependencies (${deps.length})`, items: deps, inline: true, priority: 7, noun: 'dependencies' });
  }

  // Modules
  const modules = [...ctx.modules].sort((a, b) => num(b.loc) - num(a.loc) || cmpStr(a.name, b.name));
  add({
    title: `## Modules (${modules.length})`,
    empty: 'None detected.',
    priority: 3,
    noun: 'modules',
    items: modules.map((mod) => {
      const roles = roleBreakdown(mod);
      return `- ${oneLine(mod.name ?? `module ${mod.id}`)} — ${count(moduleFileCount(mod), 'file')}, ` +
        `${fmtInt(mod.loc)} LOC${roles.length ? `; roles: ${roles.join(', ')}` : ''}`;
    }),
  });

  // Screens
  const screens = [...ctx.screens].sort((a, b) =>
    (b.entry ? 1 : 0) - (a.entry ? 1 : 0) || cmpStr(a.name, b.name) || cmpStr(ctx.pathOf(a.file), ctx.pathOf(b.file)));
  add({
    title: `## Screens (${screens.length})`,
    empty: 'None detected.',
    priority: 2,
    noun: 'screens',
    items: screens.map((s) => {
      const tags = [oneLine(s.kind), s.entry ? 'entry' : ''].filter(Boolean).join(', ');
      const routes = csv(s.routes);
      const where = fileWithLine(ctx, s.file, s.line);
      return `- ${oneLine(s.name || '(unnamed)')}${tags ? ` [${tags}]` : ''}` +
        `${routes ? ` routes: ${routes}` : ''}${where ? ` — ${where}` : ''}`;
    }),
  });

  // Navigation
  const nav = isObj(m.nav) ? m.nav : {};
  const { edges, declaredEntries, nodeById } = orderNavEdges(nav);
  const label = (id) => oneLine(navLabel(nodeById.get(id), id));
  add({
    title: `## Navigation (${count(edges.length, 'edge')})`,
    pre: declaredEntries.length ? [`Entry points: ${declaredEntries.map(label).join(', ')}`] : [],
    empty: 'None detected.',
    priority: 5,
    noun: 'edges',
    fence: true,
    items: edges.map((e) => `${label(e.from)} -> ${label(e.to)} (${e.kind})`),
  });

  // API endpoints
  const calls = ctx.apis.filter((a) => !isUrlLiteral(a)).sort((a, b) =>
    cmpStr(apiHost(a), apiHost(b)) || cmpStr(a.resolved || a.url, b.resolved || b.url) || cmpStr(a.method, b.method));
  const urlCount = ctx.apis.length - calls.length;
  const bases = arr(m.bases).filter(isObj).filter((b) => b.url);
  const apiItems = [
    ...bases.map((b) => {
      const where = fileWithLine(ctx, b.file, b.line);
      return `BASE ${oneLine(b.url)}${where ? ` (${where})` : ''}`;
    }),
    ...calls.map((a) => {
      const where = fileWithLine(ctx, a.file, a.line);
      const users = [...new Set(arr(a.usedBy).map(ctx.screenName).filter(Boolean))].sort(cmpStr);
      return `${String(a.method || '?').toUpperCase()} ${oneLine(a.resolved || a.url)}` +
        `${where ? ` (${where})` : ''}${users.length ? ` used by ${users.join(', ')}` : ''}`;
    }),
  ];
  add({
    title: `## API endpoints (${calls.length})`,
    pre: urlCount ? [`${urlCount} plain URL ${plural(urlCount, 'literal')} not listed.`] : [],
    empty: 'None detected.',
    priority: 4,
    noun: 'entries',
    fence: true,
    items: apiItems,
  });

  // Risks
  add({ title: '## Risks', empty: 'None detected.', priority: 1, noun: 'risk notes', items: aiRiskItems(ctx) });

  // Key files
  const candidates = ctx.files.filter((f) => f.path && !f.isTest && !f.isGenerated &&
    f.role !== 'test' && f.role !== 'generated');
  const maxLoc = Math.max(1, ...candidates.map((f) => num(f.loc)));
  const degree = (f) => num(f.fanIn) + num(f.fanOut);
  const maxDeg = Math.max(1, ...candidates.map(degree));
  const keyFiles = candidates
    .map((f) => ({ f, score: num(f.loc) / maxLoc + degree(f) / maxDeg }))
    .sort((a, b) => b.score - a.score || cmpStr(a.f.path, b.f.path))
    .slice(0, AI_KEY_FILES)
    .map(({ f }) => f);
  add({
    title: `## Key files (largest / most connected, top ${keyFiles.length})`,
    empty: 'None detected.',
    priority: 6,
    noun: 'files',
    items: keyFiles.map((f) => {
      const types = arr(f.types).map(oneLine).filter(Boolean);
      const parts = [
        `${fmtInt(f.loc)} LOC`,
        `fan-in ${fmtInt(num(f.fanIn))}`,
        `fan-out ${fmtInt(num(f.fanOut))}`,
      ];
      if (isNum(f.complexity)) parts.push(`complexity ${fmtNum(f.complexity)}`);
      if (f.module !== undefined && f.module !== null) parts.push(`module ${ctx.moduleName(f.module)}`);
      return `- ${f.path} [${oneLine(f.role || 'other')}] ${parts.join(', ')}` +
        `${types.length ? `; defines ${types.slice(0, 4).join(', ')}${types.length > 4 ? ', …' : ''}` : ''}`;
    }),
  });

  return sections;
}

function aiRiskItems(ctx) {
  const r = isObj(ctx.m.risks) ? ctx.m.risks : {};
  const items = [];
  const cycles = arr(r.cycles).filter(isObj);
  if (cycles.length) {
    const largest = Math.max(...cycles.map((c) => num(c.size) || arr(c.files).length));
    items.push(`- Import cycles: ${cycles.length} (largest ${count(largest, 'file')})`);
    for (const c of cycles.slice(0, 5)) {
      const ex = arr(c.examples).find(Array.isArray);
      const chain = ex ? cycleChain(ctx, ex, (p) => p).replace(/ → /g, ' -> ') : '';
      if (chain) items.push(`- Cycle: ${chain}`);
    }
  } else {
    items.push('- Import cycles: none');
  }
  for (const c of arr(r.moduleCycles).filter(isObj).slice(0, 5)) {
    const names = arr(c.modules).map((id) => ctx.moduleName(id));
    if (names.length) items.push(`- Module cycle: ${names.join(' <-> ')}`);
  }
  const complex = arr(r.complex).filter(isObj).sort((a, b) => num(b.score) - num(a.score)).slice(0, 5);
  for (const c of complex) {
    const reasons = arr(c.reasons).map(oneLine).filter(Boolean).join('; ');
    items.push(`- Complex: ${ctx.pathOf(c.file) || c.file} (score ${fmtNum(c.score)}${reasons ? `; ${reasons}` : ''})`);
  }
  const god = arr(r.godFiles).filter(isObj)
    .sort((a, b) => (num(b.fanIn) + num(b.fanOut)) - (num(a.fanIn) + num(a.fanOut))).slice(0, 5);
  for (const g of god) {
    items.push(`- God file: ${ctx.pathOf(g.file) || g.file} (fan-in ${fmtInt(num(g.fanIn))}, fan-out ${fmtInt(num(g.fanOut))})`);
  }
  const hotspots = arr(r.hotspots).filter(isObj).filter((h) => num(h.churn) > 0)
    .sort((a, b) => num(b.score) - num(a.score)).slice(0, 5);
  for (const h of hotspots) {
    items.push(`- Hotspot: ${ctx.pathOf(h.file) || h.file} (${fmtInt(h.churn)} commits, complexity ${fmtNum(h.complexity)})`);
  }
  const byRole = arr(r.untested?.byRole).filter(isObj).filter((x) => num(x.total) > 0)
    .sort((a, b) => roleRank(a.role) - roleRank(b.role));
  if (byRole.length) {
    items.push(`- Tested files by role: ${byRole.map((x) => `${oneLine(x.role)} ${fmtInt(x.tested)}/${fmtInt(x.total)}`).join(', ')}`);
  }
  return items;
}

function sectionText(s, keep) {
  const lines = [s.title, ...s.pre];
  const n = s.items.length;
  if (!n) {
    if (s.empty) lines.push(s.empty);
    return lines.join('\n');
  }
  if (keep <= 0) {
    lines.push(`_${n} ${s.noun} omitted for length._`);
    return lines.join('\n');
  }
  const shown = keep >= n ? s.items : s.items.slice(0, keep);
  const omitted = n - shown.length;
  if (s.inline) {
    lines.push(shown.join(', ') + (omitted ? `, … ${omitted} more omitted` : ''));
  } else {
    const body = omitted ? [...shown, `${s.fence ? '' : '- '}… ${omitted} more ${s.noun} omitted`] : shown;
    if (s.fence) lines.push('```text', ...body, '```');
    else lines.push(...body);
  }
  return lines.join('\n');
}

function fitSections(sections, limit) {
  for (const s of sections) s.keep = s.items.length;
  const render = () => `${sections.map((s) => sectionText(s, s.keep)).join('\n\n')}\n`;
  let out = render();
  if (out.length <= limit) return out;

  const note = `\n_…truncated to fit ${limit} characters; lower-priority lists were shortened or dropped._\n`;
  const budget = limit - note.length;
  if (budget <= 0) return out.slice(0, limit);

  let total = out.length;
  const order = sections.filter((s) => s.priority > 0 && s.items.length)
    .sort((a, b) => b.priority - a.priority);
  for (const s of order) {
    if (total <= budget) break;
    const others = total - sectionText(s, s.keep).length;
    // keep === items.length is known to be too long; search the largest smaller count that fits.
    let lo = 0;
    let hi = s.items.length - 1;
    let best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (others + sectionText(s, mid).length <= budget) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    s.keep = best;
    total = others + sectionText(s, best).length;
  }

  out = render();
  if (out.length > budget) {
    // Even the fixed sections overflow: hard cut at a line boundary, closing any open code fence.
    const room = budget - 4;
    if (room <= 0) return out.slice(0, limit);
    let cut = out.slice(0, room);
    const nl = cut.lastIndexOf('\n');
    if (nl > 0) cut = cut.slice(0, nl + 1);
    if (!cut.endsWith('\n')) cut += '\n';
    if (cut.length > room) cut = cut.slice(0, room);
    if ((cut.match(/^```/gm) || []).length % 2 === 1) cut += '```\n';
    out = cut;
  }
  return out + note;
}
