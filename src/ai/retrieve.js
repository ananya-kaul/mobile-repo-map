/**
 * Picks the source files most relevant to a question and cuts each one down to a
 * character budget. Pure and synchronous: no network, no file system.
 *
 * Scoring is a small BM25F: question tokens are matched against three fields per
 * file (path segments x3, declared type names x2, file content x1), then nudged by
 * the file's architectural role when the question is about navigation, APIs or flows.
 */

const STOPWORDS = new Set(`
a an the and or but if then else of to in on at by for with from into onto about as
is are was were be been being am do does did doing done have has had having
how what where which who whom whose why when this that these those there here
it its i me my mine we us our you your they them their he she him her
can could should would will shall may might must
any all some each every both either neither so than too very just also only even
not no yes please
explain tell show describe walk through give find see look know understand mean means
work works working worked happen happens happening handle handles handled handling
use uses used using implement implements implemented implementation
code codebase app application repo repository project file files part parts piece
thing things stuff way ways like between via up out over under across within
get gets got make makes made go goes going let lets need needs want wants
`.split(/\s+/).filter(Boolean));

const FIELD_WEIGHT = { path: 3, types: 2, content: 1 };
const FIELD_B = { path: 0.3, types: 0.3, content: 0.75 };
const K1 = 1.2;
const FUZZY_WEIGHT = 0.5;
const RELATIVE_CUTOFF = 0.1;
const MIN_FILE_BUDGET = 600;
const MAX_LINE_CHARS = 300;
const WINDOW_RADIUS = 25;
const MAX_WINDOWS = 8;

const NAV_INTENT = /\b(navigat\w*|routes?|router|routing|screens?|pages?|deep ?links?|tabs?|redirects?|go_?router|coordinators?|segues?|storyboards?|back stack|push(es|ed)?)\b/i;
const API_INTENT = /\b(apis?|endpoints?|requests?|https?|rest|graphql|grpc|backend|servers?|network(ing)?|fetch(es|ing)?|socket|websockets?|dio|urlsession|services?|repositor(y|ies)|clients?|talks? to|sync(s|ing)?)\b/i;
const FLOW_INTENT = /\b(flows?|works?|happens?|process(es)?|journey|steps?|lifecycle|sequence|end[- ]to[- ]end)\b/i;
const TEST_INTENT = /\b(tests?|testing|specs?|mocks?|fixtures?)\b/i;

const SCREEN_PATH = /(^|[/_.-])(screens?|pages?|views?|view_?controllers?|scenes?)([/_.-]|$)|(Screen|Page|View|ViewController)\.(dart|swift)$/;
const ROUTER_PATH = /(^|[/_.-])(router|routes?|routing|navigation|navigator|coordinators?|app_route)([/_.-]|$)|(Router|Routes|Coordinator|Navigation)\.(dart|swift)$/i;
const SERVICE_PATH = /(^|[/_.-])(services?|api|apis|clients?|repositor(y|ies)|repos?|data_?sources?|network(ing)?|remote|gateways?|endpoints?)([/_.-]|$)|(Service|Api|API|Client|Repository|DataSource|Gateway)\.(dart|swift)$/;
const GENERATED_PATH = /\.(g|freezed|gr|mocks|pb|pbenum|pbjson|pbserver|config|chopper|mapper)\.dart$|\.generated\.swift$|(^|\/)generated\/|(^|\/)(GeneratedPluginRegistrant\.\w+|generated_plugin_registrant\.dart)$/;
const TEST_PATH = /(^|\/)(test|tests|integration_test|[A-Za-z]+Tests|[A-Za-z]+UITests)\/|_test\.dart$|Tests?\.swift$/;

/** Splits camelCase / PascalCase / snake_case / kebab-case text into lowercase words. */
export function splitWords(text) {
  return String(text)
    .replace(/([A-Z]{2,})s(?![a-z])/g, '$1') // acronym plurals: APIs, URLs, IDs
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Light plural folding so `screens`/`screen` and `categories`/`category` meet. */
function normalize(word) {
  if (word.length <= 3) return word;
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith('sses')) return word.slice(0, -2);
  if (word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

/** Tokens used for matching: split, lowercased, plural-folded, stopwords and noise removed. */
export function tokenize(text) {
  const out = [];
  for (const w of splitWords(text)) {
    if (w.length < 2 || /^\d+$/.test(w) || STOPWORDS.has(w)) continue;
    out.push(normalize(w));
  }
  return out;
}

function counts(tokens) {
  const m = new Map();
  for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

function commonPrefix(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

/** Vocabulary tokens a query term matches: itself (1.0) and near-stems such as navigation/navigator (0.5). */
function expandTerm(term, vocabulary) {
  const matches = new Map();
  if (vocabulary.has(term)) matches.set(term, 1);
  if (term.length < 5) return matches;
  for (const tok of vocabulary) {
    if (tok === term || tok.length < 5) continue;
    const lcp = commonPrefix(term, tok);
    if (lcp >= 5 && lcp >= Math.max(term.length, tok.length) - 5) matches.set(tok, FUZZY_WEIGHT);
  }
  return matches;
}

function typeNames(entry) {
  if (!entry || !Array.isArray(entry.types)) return [];
  return entry.types.map((t) => (typeof t === 'string' ? t : t && t.name)).filter(Boolean);
}

function stripExtension(p) {
  return p.replace(/\.[A-Za-z0-9]+$/, '');
}

/** Maps a screen/api `file` reference (path, id or index) back to a path. */
function resolveFileRef(ref, files, byId) {
  if (ref == null) return null;
  if (typeof ref === 'number' && files[ref]) return files[ref].path;
  if (typeof ref === 'object') return ref.path || null;
  return byId.get(ref) || String(ref);
}

function roleFlags(path, entry, screenFiles, apiFiles) {
  const role = String((entry && entry.role) || '').toLowerCase();
  return {
    screen: screenFiles.has(path) || /screen|page|view|scene/.test(role) || SCREEN_PATH.test(path),
    router: /rout|navigat|coordinator/.test(role) || ROUTER_PATH.test(path),
    service: apiFiles.has(path) || /service|api|client|repositor|network|data/.test(role) || SERVICE_PATH.test(path),
    api: apiFiles.has(path),
  };
}

function intentBoost(intent, flags) {
  let boost = 0;
  if (intent.nav) boost += (flags.router ? 0.6 : 0) + (flags.screen ? 0.3 : 0);
  if (intent.api) boost += (flags.service ? 0.5 : 0) + (flags.api ? 0.3 : 0);
  if (intent.flow && (flags.screen || flags.router || flags.service)) boost += 0.2;
  return boost;
}

/**
 * Ranks `sources` against `question` and returns budgeted excerpts.
 *
 * @param {string} question
 * @param {{ files?: Array<{ id?: any, path: string, role?: string, types?: Array<string|{name:string}> }>,
 *           screens?: Array<{ name?: string, file?: any }>, apis?: Array<{ file?: any }> } | null} model
 * @param {Array<{ path: string, text: string }>} sources full file contents
 * @param {{ maxChars?: number, maxFiles?: number }} [options]
 * @returns {Array<{ path: string, text: string, score: number }>} best first; total text length <= maxChars
 */
export function retrieve(question, model, sources, { maxChars = 60000, maxFiles = 12 } = {}) {
  if (!Array.isArray(sources) || sources.length === 0 || maxChars <= 0 || maxFiles <= 0) return [];

  const files = (model && Array.isArray(model.files)) ? model.files : [];
  const byPath = new Map(files.map((f) => [f.path, f]));
  const byId = new Map(files.filter((f) => f.id != null).map((f) => [f.id, f.path]));
  const screenFiles = new Set(((model && model.screens) || []).map((s) => resolveFileRef(s.file, files, byId)).filter(Boolean));
  const apiFiles = new Set(((model && model.apis) || []).map((a) => resolveFileRef(a.file, files, byId)).filter(Boolean));

  const q = String(question || '');
  const intent = {
    nav: NAV_INTENT.test(q),
    api: API_INTENT.test(q),
    flow: FLOW_INTENT.test(q),
    tests: TEST_INTENT.test(q),
  };
  const queryTerms = [...new Set(tokenize(q))];

  // Field statistics for every document.
  const docs = sources.map((src) => {
    const entry = byPath.get(src.path);
    const text = typeof src.text === 'string' ? src.text : '';
    const fields = {
      path: counts(tokenize(stripExtension(src.path))),
      types: counts(typeNames(entry).flatMap((n) => tokenize(n))),
      content: counts(tokenize(text)),
    };
    const lengths = {};
    for (const f of Object.keys(fields)) {
      let n = 0;
      for (const c of fields[f].values()) n += c;
      lengths[f] = n;
    }
    return { src, entry, text, fields, lengths };
  });

  const avg = {};
  for (const f of Object.keys(FIELD_WEIGHT)) {
    avg[f] = Math.max(1, docs.reduce((s, d) => s + d.lengths[f], 0) / docs.length);
  }

  const vocabulary = new Set();
  for (const d of docs) for (const f of Object.keys(FIELD_WEIGHT)) for (const t of d.fields[f].keys()) vocabulary.add(t);

  // Per query term: matching vocabulary tokens and an IDF over documents containing any of them.
  const N = docs.length;
  const terms = [];
  for (const term of queryTerms) {
    const matches = expandTerm(term, vocabulary);
    if (matches.size === 0) continue;
    let df = 0;
    for (const d of docs) {
      let hit = false;
      for (const tok of matches.keys()) {
        if (d.fields.path.has(tok) || d.fields.types.has(tok) || d.fields.content.has(tok)) { hit = true; break; }
      }
      if (hit) df++;
    }
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    terms.push({ term, matches, idf });
  }

  // Exact type names spelled in the question (e.g. "CartBloc") are a very strong signal.
  const questionIdents = new Set(
    (q.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []).filter((s) => /[a-z0-9][A-Z]/.test(s)).map((s) => s.toLowerCase()),
  );

  const scored = docs.map((d) => {
    // Each field saturates on its own, then fields are weighted, so a name match in the
    // path cannot be drowned out by a word that merely repeats a lot in the content.
    let base = 0;
    for (const { matches, idf } of terms) {
      let s = 0;
      for (const f of Object.keys(FIELD_WEIGHT)) {
        let tf = 0;
        for (const [tok, w] of matches) tf += (d.fields[f].get(tok) || 0) * w;
        if (!tf) continue;
        const norm = 1 - FIELD_B[f] + FIELD_B[f] * (d.lengths[f] / avg[f]);
        s += FIELD_WEIGHT[f] * ((tf * (K1 + 1)) / (tf + K1 * norm));
      }
      base += idf * s;
    }
    if (typeNames(d.entry).some((n) => questionIdents.has(n.toLowerCase()))) base *= 1.5;

    const flags = roleFlags(d.src.path, d.entry, screenFiles, apiFiles);
    const boost = intentBoost(intent, flags);
    let score = base * (1 + boost) + boost * 0.25;
    if (GENERATED_PATH.test(d.src.path)) score *= 0.3;
    if (!intent.tests && TEST_PATH.test(d.src.path)) score *= 0.5;
    return { d, score };
  });

  scored.sort((a, b) => b.score - a.score || a.d.src.path.length - b.d.src.path.length || (a.d.src.path < b.d.src.path ? -1 : 1));
  const top = scored.length ? scored[0].score : 0;
  if (top <= 0) return [];
  const picked = scored.filter((s) => s.score > 0 && s.score >= top * RELATIVE_CUTOFF).slice(0, maxFiles);

  // Per-line weights used to find the best windows inside each file.
  const lineTerms = new Map();
  for (const { matches, idf } of terms) {
    for (const [tok, w] of matches) lineTerms.set(tok, Math.max(lineTerms.get(tok) || 0, idf * w));
  }

  const prepared = picked.map(({ d, score }) => {
    const lines = d.text.split(/\r?\n/);
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    const width = Math.max(4, String(lines.length).length);
    const numbered = lines.map((l, i) => `${String(i + 1).padStart(width)}| ${l.length > MAX_LINE_CHARS ? `${l.slice(0, MAX_LINE_CHARS)} …` : l}`);
    const full = numbered.join('\n');
    return { path: d.src.path, score, lines, numbered, full };
  });

  // Water-fill the budget: files that fit their score-weighted share are kept whole and
  // hand the rest back; files that would get less than a useful minimum are dropped.
  let alloc;
  let pool = prepared;
  for (;;) {
    alloc = allocate(pool, maxChars);
    const tooSmall = pool.findIndex((f, i) => alloc[i] < Math.min(MIN_FILE_BUDGET, f.full.length));
    if (tooSmall === -1 || pool.length === 1) break;
    pool = pool.slice(0, pool.length - 1);
  }

  const out = [];
  let used = 0;
  pool.forEach((f, i) => {
    const budget = Math.min(alloc[i], maxChars - used);
    if (budget <= 0) return;
    const text = f.full.length <= budget ? f.full : excerpt(f, lineTerms, budget);
    if (!text) return;
    used += text.length;
    out.push({ path: f.path, text, score: Math.round(f.score * 1000) / 1000 });
  });
  return out;
}

function allocate(files, maxChars) {
  const alloc = new Array(files.length).fill(0);
  let open = files.map((_, i) => i);
  let remaining = maxChars;
  while (open.length) {
    const weight = open.reduce((s, i) => s + files[i].score, 0) || open.length;
    const fits = open.filter((i) => files[i].full.length <= Math.floor((remaining * (files[i].score || 1)) / weight));
    if (fits.length === 0) {
      for (const i of open) alloc[i] = Math.floor((remaining * (files[i].score || 1)) / weight);
      break;
    }
    for (const i of fits) { alloc[i] = files[i].full.length; remaining -= files[i].full.length; }
    open = open.filter((i) => !fits.includes(i));
  }
  return alloc;
}

/**
 * Keeps the start of the file plus windows around the lines with the best keyword hits,
 * then grows every kept region evenly until the budget is used. Omitted runs become `// …`.
 */
function excerpt(file, lineTerms, budget) {
  const { lines, numbered } = file;
  const n = lines.length;

  const render = (ranges) => {
    const parts = [];
    let next = 0;
    for (const [a, b] of ranges) {
      if (a > next) parts.push(`// … (${a - next} line${a - next === 1 ? '' : 's'} omitted)`);
      for (let i = a; i <= b; i++) parts.push(numbered[i]);
      next = b + 1;
    }
    if (next < n) parts.push(`// … (${n - next} line${n - next === 1 ? '' : 's'} omitted)`);
    return parts.join('\n');
  };
  const merge = (ranges) => {
    const sorted = ranges
      .map(([a, b]) => [Math.max(0, a), Math.min(n - 1, b)])
      .filter(([a, b]) => a <= b)
      .sort((x, y) => x[0] - y[0]);
    const outRanges = [];
    for (const r of sorted) {
      const last = outRanges[outRanges.length - 1];
      if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
      else outRanges.push([r[0], r[1]]);
    }
    return outRanges;
  };
  const fits = (ranges) => render(ranges).length <= budget;

  // Largest k in [lo, hi] for which make(k) still fits (make is monotone in k).
  const largest = (lo, hi, make) => {
    if (!fits(make(lo))) return -1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(make(mid))) lo = mid; else hi = mid - 1;
    }
    return lo;
  };

  // 1. The beginning of the file (imports, first declarations), capped at a quarter of the budget.
  const headMax = Math.max(1, Math.min(30, Math.floor(n * 0.2)));
  const headBudget = Math.floor(budget * 0.25);
  let headLen = 0;
  let headCost = 40; // room for the trailing `// …` line
  while (headLen < headMax && headCost + numbered[headLen].length + 1 <= headBudget) {
    headCost += numbered[headLen].length + 1;
    headLen++;
  }
  let ranges = headLen > 0 ? [[0, headLen - 1]] : [];

  // 2. Windows around the best keyword hits.
  const hitScores = [];
  for (let i = 0; i < n; i++) {
    let s = 0;
    const seen = new Set();
    for (const t of tokenize(lines[i])) {
      if (seen.has(t)) continue;
      seen.add(t);
      s += lineTerms.get(t) || 0;
    }
    if (s > 0) hitScores.push([i, s]);
  }
  hitScores.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  // Best hit lines first (spread out, at most MAX_WINDOWS), so every hit gets a share of the
  // budget before any window is widened.
  const centers = [];
  for (const [line] of hitScores) {
    if (centers.length >= MAX_WINDOWS) break;
    if (line < headLen || centers.some((c) => Math.abs(c - line) <= 3)) continue;
    if (!fits(merge([...ranges, ...centers.map((c) => [c, c]), [line, line]]))) continue;
    centers.push(line);
  }
  const withWindows = (k) => merge([...ranges, ...centers.map((c) => [c - k, c + k])]);
  const radius = centers.length ? largest(0, WINDOW_RADIUS, withWindows) : 0;
  ranges = withWindows(Math.max(0, radius));

  if (ranges.length === 0) {
    // Not even one line fits: hard cut the first line(s).
    return numbered.join('\n').slice(0, Math.max(0, budget));
  }

  // 3. Spend what is left by growing every kept region evenly.
  const base = ranges;
  const grow = largest(0, n, (k) => merge(base.map(([a, b]) => [a - k, b + k])));
  if (grow > 0) ranges = merge(base.map(([a, b]) => [a - grow, b + grow]));

  return render(ranges);
}
