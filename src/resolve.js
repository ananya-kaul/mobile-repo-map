// Best-effort evaluation of string expressions used for routes and URLs.
// Resolves literals, interpolation, `+` concatenation, `Uri.parse(...)`,
// `URL(string:)`, static constants and enhanced-enum values.

const AMBIGUOUS = Symbol('ambiguous');

/** Builds a lookup table: `Owner.name` and bare `name` -> source expression. */
export function constantTable(facts) {
  const table = new Map();
  const put = (key, value) => {
    if (!table.has(key)) table.set(key, value);
    else if (JSON.stringify(table.get(key)) !== JSON.stringify(value)) table.set(key, AMBIGUOUS);
  };
  for (const f of facts) {
    for (const c of f.constants) {
      // Functions keep their parameter names so call sites can bind arguments.
      const value = c.params ? { expr: c.expr, params: c.params } : c.expr;
      if (c.owner) put(`${c.owner}.${c.name}`, value);
      if (!c.enumValue) put(c.name, value);
    }
  }
  return table;
}

function splitTopLevel(expr, sep) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === sep && depth === 0) { parts.push(expr.slice(start, i)); start = i + 1; }
  }
  parts.push(expr.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

function lookup(name, table) {
  const key = name.replace(/^(this|self|widget)\./, '').replace(/[!?]+$/, '').replace(/\.rawValue$/, '');
  const tries = [key];
  const segs = key.split('.');
  for (let i = segs.length - 1; i >= 1; i--) tries.push(segs.slice(0, i).join('.'));
  if (segs.length > 2) tries.push(segs.slice(-2).join('.'));
  for (const k of tries) {
    const v = table.get(k);
    if (v && v !== AMBIGUOUS) return v;
  }
  // Swift `.users` shorthand for an enum case
  if (/^\.\w+$/.test(name)) {
    const hits = [...table.keys()].filter((k) => k.endsWith(name));
    if (hits.length === 1 && table.get(hits[0]) !== AMBIGUOUS) return table.get(hits[0]);
  }
  return null;
}

// `_id(user.id)` -> `id`, `widget.productId` -> `productId`
const placeholder = (inner) => {
  const ids = inner.match(/[A-Za-z_]\w*/g) || ['param'];
  return ids[ids.length - 1];
};

const short = (s) => (s.length > 40 ? `${s.slice(0, 37)}…` : s);

/**
 * @returns {{value: string|null, resolved: boolean}}
 */
export function evalExpr(expr, table, lang, depth = 0) {
  if (!expr) return { value: null, resolved: false };
  const e = expr.trim().replace(/[!]+$/, '');
  if (depth > 8) return { value: `{${short(e)}}`, resolved: false };
  const unresolved = { value: `{${short(e)}}`, resolved: false };
  const ev = (x) => evalExpr(x, table, lang, depth + 1);

  // Uri.parse(x) / URL(string: x), optionally followed by .appending(...)
  let m = e.match(/^(?:Uri|URL)\.(?:parse|tryParse)\s*\(|^URL\s*\(\s*(?=string\s*:)/);
  if (m) {
    const open = e.indexOf('(');
    const close = closeOf(e, open);
    if (close < 0) return unresolved;
    const base = ev(e.slice(open + 1, close).replace(/^\s*string\s*:/, ''));
    const rest = e.slice(close + 1).replace(/^[!?]+/, '').trim();
    if (!rest) return base;
    const app = appendingCall(rest);
    return app !== null ? join(base, ev(app)) : unresolved;
  }
  m = e.match(/^Uri\.(https?)\s*\(/);
  if (m) {
    const open = e.indexOf('(');
    const close = closeOf(e, open);
    if (close !== e.length - 1) return unresolved;
    const [host, p] = splitTopLevel(e.slice(open + 1, close), ',');
    const h = ev(host);
    const pv = p ? ev(p) : { value: '', resolved: true };
    const pathPart = pv.value && !pv.value.startsWith('/') ? `/${pv.value}` : pv.value || '';
    return { value: `${m[1]}://${h.value}${pathPart}`, resolved: h.resolved && pv.resolved };
  }
  if (lang === 'swift') {
    const split = splitAppending(e);
    if (split) return join(ev(split.receiver), ev(split.arg));
  }
  m = e.match(/^([\s\S]+)\.substring\(\s*(\d+)\s*\)$/);
  if (m) {
    const inner = ev(m[1]);
    return inner.resolved ? { value: inner.value.slice(Number(m[2])), resolved: true } : inner;
  }

  // Dart adjacent string literals: 'https://x.dev' '/a'
  const lits = adjacentLiterals(e);
  if (lits && lits.length > 1) {
    const vals = lits.map(ev);
    return { value: vals.map((v) => v.value ?? '').join(''), resolved: vals.every((v) => v.resolved) };
  }

  const parts = splitTopLevel(e, '+');
  if (parts.length > 1) {
    const vals = parts.map((p) => evalExpr(p, table, lang, depth + 1));
    return { value: vals.map((v) => v.value ?? '').join(''), resolved: vals.every((v) => v.resolved) };
  }

  // String literal (possibly with interpolation)
  m = lits && lits.length === 1 ? (e.match(/^r?('''|""")([\s\S]*)\1$/) || e.match(/^r?(['"])([\s\S]*)\1$/)) : null;
  if (m) {
    const raw = e.startsWith('r');
    let ok = true;
    let s = m[2];
    if (!raw) {
      if (lang === 'dart') {
        s = s.replace(/\$\{([^}]*)\}|\$([A-Za-z_]\w*)/g, (_, a, b) => {
          const inner = (a || b).trim();
          const v = evalExpr(inner, table, lang, depth + 1);
          if (v.resolved) return v.value;
          ok = false;
          if (v.value && !/^\{[^}]*\}$/.test(v.value)) return v.value; // partially resolved
          return `{${placeholder(inner)}}`;
        });
      } else {
        s = s.replace(/\\\(([^)]*)\)/g, (_, a) => {
          const v = evalExpr(a.trim(), table, lang, depth + 1);
          if (v.resolved) return v.value;
          ok = false;
          if (v.value && !/^\{[^}]*\}$/.test(v.value)) return v.value; // partially resolved
          return `{${placeholder(a.trim())}}`;
        });
      }
      s = s.replace(/\\(.)/g, '$1');
    }
    return { value: s, resolved: ok };
  }

  if (/^\.?[A-Za-z_][\w.]*[!?]?$/.test(e)) {
    const found = lookup(e, table);
    if (found) return evalExpr(typeof found === 'string' ? found : found.expr, table, lang, depth + 1);
  }

  // Calls: a known endpoint function `Endpoints.user(id)`, or a path helper `_api('users')`
  m = e.match(/^(\.?[A-Za-z_][\w.]*)\s*\(([\s\S]*)\)$/);
  if (m) {
    const fn = lookup(m[1], table);
    const args = splitTopLevel(m[2], ',');
    if (fn && typeof fn === 'string') return evalExpr(fn, table, lang, depth + 1);
    if (fn) {
      const scope = new Map(table);
      fn.params.forEach((p, i) => {
        const arg = args[i] !== undefined ? args[i] : "''";
        // `user(id)` called with its own parameter name stays a placeholder.
        if (arg === p) scope.delete(p);
        else scope.set(p, arg);
      });
      return evalExpr(fn.expr, scope, lang, depth + 1);
    }
    if (args.length === 1 && /^r?['"]/.test(args[0])) {
      const inner = evalExpr(args[0], table, lang, depth + 1);
      if (inner.value !== null && !/^(https?|wss?):/.test(inner.value)) {
        return { value: inner.value.startsWith('/') ? inner.value : `/${inner.value}`, resolved: inner.resolved };
      }
      return inner;
    }
  }
  return { value: `{${short(e)}}`, resolved: false };
}

/** Finds the first constant reference inside an arbitrary expression (e.g. `page(AppRoute.cart, id)`). */
export function findConstantRef(expr, table, lang) {
  const refs = expr.match(/\.?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+/g) || [];
  for (const r of refs) {
    const found = lookup(r, table);
    if (found) {
      const v = evalExpr(typeof found === 'string' ? found : found.expr, table, lang, 1);
      if (v.value) return v;
    }
  }
  const lit = expr.match(/r?'[^']*'|"[^"]*"/);
  if (lit) {
    const v = evalExpr(lit[0], table, lang, 1);
    if (v.value && v.value.startsWith('/')) return v;
  }
  return null;
}

/** Quote-aware index of the bracket that closes the one at `open`, or -1. */
function closeOf(s, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** End index of the string literal starting at `i` (handles r'', triple quotes, escapes), or -1. */
function literalEnd(s, i) {
  let k = i;
  const raw = s[k] === 'r';
  if (raw) k++;
  const q = s[k];
  if (q !== '"' && q !== "'") return -1;
  const triple = s[k + 1] === q && s[k + 2] === q;
  const closer = triple ? q.repeat(3) : q;
  for (let j = k + closer.length; j < s.length; j++) {
    if (!raw && s[j] === '\\') { j++; continue; }
    if (s.startsWith(closer, j)) return j + closer.length - 1;
  }
  return -1;
}

/** Splits `'a' 'b'` into its literals; null if the expression is not purely literals. */
function adjacentLiterals(e) {
  const out = [];
  let i = 0;
  while (i < e.length) {
    while (i < e.length && /\s/.test(e[i])) i++;
    if (i >= e.length) break;
    const end = literalEnd(e, i);
    if (end < 0) return null;
    out.push(e.slice(i, end + 1));
    i = end + 1;
  }
  return out.length ? out : null;
}

/** For `.appending(path: x)` / `.appendingPathComponent(x)` spanning the whole string, returns x. */
function appendingCall(rest) {
  const m = rest.match(/^\.appending(?:PathComponent)?\s*\(/);
  if (!m) return null;
  const open = m[0].length - 1;
  if (closeOf(rest, open) !== rest.length - 1) return null;
  return rest.slice(open + 1, -1).replace(/^\s*(?:path|component)\s*:/, '');
}

/** Finds a top-level trailing `.appending...(x)` call: `base.appendingPathComponent("a")`. */
function splitAppending(e) {
  const re = /\.appending(?:PathComponent)?\s*\(/g;
  let m;
  while ((m = re.exec(e))) {
    const receiver = e.slice(0, m.index).replace(/[!?]+$/, '');
    if (!receiver || closeOf(`(${receiver})`, 0) !== receiver.length + 1) continue; // must be balanced
    const arg = appendingCall(e.slice(m.index));
    if (arg !== null) return { receiver, arg };
  }
  return null;
}

function join(a, b) {
  const joined = `${(a.value || '').replace(/\/$/, '')}/${(b.value || '').replace(/^\//, '')}`;
  return { value: joined, resolved: a.resolved && b.resolved };
}
