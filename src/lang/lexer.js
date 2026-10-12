// Lightweight lexer shared by the Dart and Swift analyzers.
//
// It does not build an AST. It produces two views of a source file with
// identical length and line layout:
//   code   - comments blanked out, strings intact (for routes, URLs, imports)
//   masked - comments AND string contents blanked out (for braces, keywords)
// Because offsets line up, a match found in one view can be read in the other.

const isIdent = (ch) => ch !== undefined && /[A-Za-z0-9_$]/.test(ch);

/**
 * @param {string} src
 * @param {'dart'|'swift'} lang
 */
export function lex(src, lang) {
  const n = src.length;
  const code = src.split('');
  const masked = src.split('');
  const blankCode = (i) => { if (code[i] !== '\n') code[i] = ' '; };
  const blankMask = (i) => { if (masked[i] !== '\n') masked[i] = ' '; };

  // Context stack. A 'code' frame with interp=true is the inside of a string
  // interpolation (`${...}` in Dart, `\(...)` in Swift).
  const stack = [{ t: 'code', interp: false, depth: 0 }];
  let strDepth = 0; // number of string frames on the stack
  let i = 0;

  while (i < n) {
    const top = stack[stack.length - 1];
    const c = src[i];
    const c2 = src[i + 1];

    if (top.t === 'code') {
      if (strDepth > 0) blankMask(i);

      if (c === '/' && c2 === '/') {
        while (i < n && src[i] !== '\n') { blankCode(i); blankMask(i); i++; }
        continue;
      }
      if (c === '/' && c2 === '*') {
        let depth = 0;
        while (i < n) {
          if (src[i] === '/' && src[i + 1] === '*') {
            depth++; blankCode(i); blankMask(i); blankCode(i + 1); blankMask(i + 1); i += 2; continue;
          }
          if (src[i] === '*' && src[i + 1] === '/') {
            depth--; blankCode(i); blankMask(i); blankCode(i + 1); blankMask(i + 1); i += 2;
            if (depth === 0) break;
            continue;
          }
          blankCode(i); blankMask(i); i++;
        }
        continue;
      }

      if (top.interp) {
        const open = lang === 'dart' ? '{' : '(';
        const close = lang === 'dart' ? '}' : ')';
        if (c === open) top.depth++;
        else if (c === close) {
          if (top.depth === 0) { stack.pop(); blankMask(i); i++; continue; }
          top.depth--;
        }
      }

      // String openers
      if (lang === 'dart') {
        let raw = false;
        let j = i;
        if (c === 'r' && (c2 === '"' || c2 === "'") && !isIdent(src[i - 1])) { raw = true; j = i + 1; }
        const q = src[j];
        if (q === '"' || q === "'") {
          const triple = src[j + 1] === q && src[j + 2] === q;
          const len = j - i + (triple ? 3 : 1);
          stack.push({ t: 'str', quote: q, triple, raw, hashes: 0 });
          if (strDepth > 0) for (let m = 0; m < len; m++) blankMask(i + m);
          strDepth++;
          i += len;
          continue;
        }
      } else {
        let hashes = 0;
        while (src[i + hashes] === '#') hashes++;
        if (src[i + hashes] === '"' && (hashes === 0 || !isIdent(src[i - 1]))) {
          const j = i + hashes;
          const triple = src[j + 1] === '"' && src[j + 2] === '"';
          stack.push({ t: 'str', quote: '"', triple, raw: hashes > 0, hashes });
          if (strDepth > 0) for (let m = i; m < j + (triple ? 3 : 1); m++) blankMask(m);
          strDepth++;
          i = j + (triple ? 3 : 1);
          continue;
        }
      }
      i++;
      continue;
    }

    // Inside a string
    if (lang === 'dart') {
      if (!top.raw && c === '\\') { blankMask(i); blankMask(i + 1); i += 2; continue; }
      if (!top.raw && c === '$' && c2 === '{') {
        blankMask(i); blankMask(i + 1);
        stack.push({ t: 'code', interp: true, depth: 0 });
        i += 2;
        continue;
      }
    } else {
      // Swift: escapes and interpolation use `\` followed by the raw hashes
      if (c === '\\') {
        let k = 1;
        let h = 0;
        while (h < top.hashes && src[i + k] === '#') { h++; k++; }
        if (h === top.hashes) {
          if (src[i + k] === '(') {
            for (let m = 0; m <= k; m++) blankMask(i + m);
            stack.push({ t: 'code', interp: true, depth: 0 });
            i += k + 1;
            continue;
          }
          for (let m = 0; m <= k; m++) blankMask(i + m);
          i += k + 1;
          continue;
        }
      }
    }

    // Closing quote?
    if (c === top.quote) {
      const qlen = top.triple ? 3 : 1;
      let ok = true;
      for (let m = 1; m < qlen; m++) if (src[i + m] !== top.quote) ok = false;
      for (let m = 0; ok && m < top.hashes; m++) if (src[i + qlen + m] !== '#') ok = false;
      if (ok) {
        // Quotes of strings nested inside an interpolation are blanked too.
        if (strDepth > 1) for (let m = 0; m < qlen + top.hashes; m++) blankMask(i + m);
        stack.pop();
        strDepth--;
        i += qlen + top.hashes;
        continue;
      }
    }
    if (!top.triple && c === '\n') {
      // Unterminated single-line string: recover at end of line.
      stack.pop();
      strDepth--;
      i++;
      continue;
    }
    blankMask(i);
    i++;
  }

  return { code: code.join(''), masked: masked.join('') };
}

/** Returns a function mapping a character offset to a 1-based line number. */
export function lineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  return (pos) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}

const PAIRS = { '(': ')', '[': ']', '{': '}', '<': '>' };

/**
 * Given the offset of an opening bracket in `masked`, returns the offset of
 * its matching closer, or -1. Only the bracket type at `open` is counted.
 */
export function matchBracket(masked, open) {
  const o = masked[open];
  const cl = PAIRS[o];
  if (!cl) return -1;
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === o) depth++;
    else if (ch === cl) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Index of the next non-whitespace char at or after `from`, or -1. */
export function skipWs(text, from) {
  for (let i = from; i < text.length; i++) if (!/\s/.test(text[i])) return i;
  return -1;
}

/** Counts non-blank lines in `code` (comments already blanked). */
export function countLoc(code) {
  let loc = 0;
  for (const line of code.split('\n')) if (line.trim()) loc++;
  return loc;
}

const DECISION_RE = /\b(if|for|while|case|catch|guard)\b|&&|\|\||\?\?|\s\?\s/g;

/** Approximate cyclomatic complexity contribution of a text span. */
export function decisions(maskedSpan) {
  const m = maskedSpan.match(DECISION_RE);
  return m ? m.length : 0;
}

/** Deepest `{` nesting in the masked text. */
export function maxBraceDepth(masked) {
  let d = 0;
  let max = 0;
  for (const ch of masked) {
    if (ch === '{') { d++; if (d > max) max = d; } else if (ch === '}') d = Math.max(0, d - 1);
  }
  return max;
}

/**
 * Splits the top-level, comma-separated arguments of a call. `open` is the
 * offset of `(` in masked. Returns [{name, start, end}] with offsets into the
 * source, where `name` is the label for named arguments (`path: ...`).
 */
export function callArgs(masked, open) {
  const close = matchBracket(masked, open);
  if (close < 0) return { args: [], close: -1 };
  const args = [];
  let depth = 0;
  let start = open + 1;
  const push = (end) => {
    const raw = masked.slice(start, end);
    if (!raw.trim()) return;
    const lead = raw.length - raw.trimStart().length;
    const m = raw.trimStart().match(/^([A-Za-z_]\w*)\s*:(?!:)/);
    let s = start + lead;
    let name = null;
    if (m) { name = m[1]; s += m[0].length; }
    args.push({ name, start: s, end });
  };
  let generic = 0;
  for (let i = open + 1; i < close; i++) {
    const ch = masked[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    // `Map<String, dynamic>` - a generic opens when `<` hugs an identifier on both sides
    else if (ch === '<' && /\w/.test(masked[i - 1] || '') && /[\w(?]/.test(masked[i + 1] || '')) generic++;
    else if (ch === '>' && generic > 0 && masked[i - 1] !== '=') generic--;
    else if (ch === ',' && depth === 0 && generic === 0) { push(i); start = i + 1; }
  }
  push(close);
  return { args, close };
}
