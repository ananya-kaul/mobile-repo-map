import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lex, lineIndex, matchBracket, callArgs, decisions, countLoc, maxBraceDepth, skipWs,
} from '../src/lang/lexer.js';

// Swift snippets use String.raw so `\(`, `\#(` and `\"` reach the lexer unchanged.
// Dart snippets use normal template literals with `\${` for interpolation.

const newlines = (s) => [...s].flatMap((c, i) => (c === '\n' ? [i] : []));

/** Both views must keep the exact length and newline layout of the source. */
function assertAligned(src, out) {
  assert.equal(out.code.length, src.length, 'code length');
  assert.equal(out.masked.length, src.length, 'masked length');
  assert.deepEqual(newlines(out.code), newlines(src), 'code newlines');
  assert.deepEqual(newlines(out.masked), newlines(src), 'masked newlines');
}

/** The slice of `view` lined up with the first occurrence of `needle` in `src`. */
function at(view, src, needle) {
  const i = src.indexOf(needle);
  assert.ok(i >= 0, `needle not found: ${needle}`);
  return view.slice(i, i + needle.length);
}

const isBlank = (s) => /^[ \n]*$/.test(s);

/** Text and name of each argument returned by callArgs for the first `(`. */
function args(src, lang = 'dart') {
  const { masked } = lex(src, lang);
  const { args: list, close } = callArgs(masked, src.indexOf('('));
  return { close, list: list.map((a) => ({ name: a.name, text: src.slice(a.start, a.end).trim() })) };
}

// ---------------------------------------------------------------- comments

test('dart: line comments are blanked in both views', () => {
  const src = 'a(); // call b() here\nc();';
  const out = lex(src, 'dart');
  assertAligned(src, out);
  for (const view of [out.code, out.masked]) {
    assert.ok(isBlank(at(view, src, '// call b() here')));
    assert.ok(view.startsWith('a();'));
    assert.ok(view.endsWith('\nc();'));
  }
});

test('dart: nested block comments /* /* */ */ are blanked as one comment', () => {
  const src = 'x(); /* outer /* inner */ still {comment} */ after();\n/* a\n b */ y();';
  const out = lex(src, 'dart');
  assertAligned(src, out);
  for (const view of [out.code, out.masked]) {
    assert.ok(isBlank(at(view, src, '/* outer /* inner */ still {comment} */')));
    assert.equal(at(view, src, 'after();'), 'after();');
    assert.ok(isBlank(at(view, src, '/* a\n b */')));
    assert.equal(at(view, src, 'y();'), 'y();');
  }
  assert.equal(maxBraceDepth(out.masked), 0);
});

test('swift: line and nested block comments are blanked', () => {
  const src = 'a() // x { y\n/* /* n */ } */ b()';
  const out = lex(src, 'swift');
  assertAligned(src, out);
  const comment1 = '// x { y';
  const comment2 = '/* /* n */ } */';
  assert.equal(out.code, `a() ${' '.repeat(comment1.length)}\n${' '.repeat(comment2.length)} b()`);
  assert.equal(out.masked, out.code);
});

test('comment markers inside strings are not comments', () => {
  const src = "var u = 'https://x.dev/*'; f(); // real";
  const { code, masked } = lex(src, 'dart');
  assert.equal(at(code, src, "'https://x.dev/*'"), "'https://x.dev/*'");
  assert.equal(at(masked, src, 'f();'), 'f();');
  assert.ok(isBlank(at(code, src, '// real')));
});

// ---------------------------------------------------------------- dart strings

test('dart: strings stay in code but their contents are blanked in masked', () => {
  const src = `var s = 'he{llo'; var t = "w(o)rld"; f();`;
  const out = lex(src, 'dart');
  assertAligned(src, out);
  assert.equal(out.code, src);
  // quotes survive, contents do not
  assert.equal(at(out.masked, src, `'he{llo'`), `'      '`);
  assert.equal(at(out.masked, src, `"w(o)rld"`), `"       "`);
  assert.equal(at(out.masked, src, 'f();'), 'f();');
  assert.equal(maxBraceDepth(out.masked), 0);
});

test('dart: raw strings do not treat backslash as an escape', () => {
  // r'a\' is a complete string in Dart; a non-raw reading would swallow f(1).
  const src = `var p = r'a\\'; f(1);`;
  assert.equal(src, "var p = r'a\\'; f(1);");
  const out = lex(src, 'dart');
  assertAligned(src, out);
  assert.equal(out.code, src);
  assert.equal(at(out.masked, src, 'f(1);'), 'f(1);');
});

test('dart: raw strings do not interpolate', () => {
  const src = `var q = r'\${a} {'; g() {}`;
  const out = lex(src, 'dart');
  assert.equal(out.code, src);
  assert.equal(at(out.masked, src, `r'\${a} {'`), "r'      '");
  assert.equal(maxBraceDepth(out.masked), 1); // only g's body
});

test('dart: escaped quotes do not end the string', () => {
  const src = `var a = 'it\\'s {'; g() {}`;
  const out = lex(src, 'dart');
  assertAligned(src, out);
  assert.equal(at(out.masked, src, 'g() {}'), 'g() {}');
  assert.equal(maxBraceDepth(out.masked), 1);
});

test('dart: triple-quoted strings span lines and may contain quotes', () => {
  const src = `var t = '''line1\n'quoted' {\nline3'''; y();\nz();`;
  const out = lex(src, 'dart');
  assertAligned(src, out);
  assert.equal(out.code, src);
  assert.ok(isBlank(at(out.masked, src, `line1\n'quoted' {\nline3`)));
  assert.equal(at(out.masked, src, 'y();'), 'y();');
  assert.equal(at(out.masked, src, 'z();'), 'z();');
  assert.equal(src.split('\n').length, out.masked.split('\n').length);
  assert.equal(maxBraceDepth(out.masked), 0);
});

test(`dart: '\${map['k']}' interpolation with nested quotes does not break lexing`, () => {
  const src = `var u = '\${map['k']}/x'; z();\nvoid f() { }`;
  const out = lex(src, 'dart');
  assertAligned(src, out);
  assert.equal(out.code, src);
  assert.equal(at(out.masked, src, 'z();'), 'z();');
  assert.equal(at(out.masked, src, 'void f() { }'), 'void f() { }');
  // the interpolation braces and the identifiers inside are hidden from masked
  assert.equal(maxBraceDepth(out.masked), 1);
  assert.ok(!/map|k|\/x/.test(at(out.masked, src, `'\${map['k']}/x'`)));
});

test('dart: interpolation containing a closure with braces', () => {
  const src = `var a = '\${list.map((e) { return e; }).join()} {'; h() {}`;
  const out = lex(src, 'dart');
  assertAligned(src, out);
  assert.equal(at(out.masked, src, 'h() {}'), 'h() {}');
  assert.equal(maxBraceDepth(out.masked), 1);
});

test('dart: an unterminated single-line string recovers at end of line', () => {
  const src = `var a = 'oops {\nvoid f() { }`;
  const out = lex(src, 'dart');
  assertAligned(src, out);
  assert.equal(out.masked.split('\n')[1], 'void f() { }');
});

// Strict form of the masked contract ("string contents blanked"). The closing
// quote of a string nested inside an interpolation is left visible in masked
// while its opening quote is blanked. Harmless for brace counting, but the
// masked view is not fully blank between the outer quotes.
test('dart: masked hides every character between the outer quotes of an interpolated string', () => {
  const src = `var u = '\${map['k']}/x'; z();`;
  const { masked } = lex(src, 'dart');
  assert.equal(masked, `var u = '${' '.repeat(13)}'; z();`);
});

// ---------------------------------------------------------------- swift strings

test('swift: strings stay in code, contents blanked in masked', () => {
  const src = String.raw`let s = "a{b}"; f()`;
  const out = lex(src, 'swift');
  assertAligned(src, out);
  assert.equal(out.code, src);
  assert.equal(at(out.masked, src, '"a{b}"'), '"    "');
});

test('swift: "\\(a["k"])" interpolation with nested quotes', () => {
  const src = String.raw`let s = "\(a["k"])/x"; f() { }`;
  const out = lex(src, 'swift');
  assertAligned(src, out);
  assert.equal(out.code, src);
  assert.equal(at(out.masked, src, 'f() { }'), 'f() { }');
  assert.ok(!/a|k|\/x/.test(at(out.masked, src, String.raw`"\(a["k"])/x"`)));
  assert.equal(maxBraceDepth(out.masked), 1);
});

test('swift: interpolation whose argument contains a string with ")"', () => {
  const src = String.raw`let s = "\(f(a, ")"))"; g()`;
  const out = lex(src, 'swift');
  assertAligned(src, out);
  assert.equal(at(out.masked, src, 'g()'), 'g()');
});

test('swift: escaped quote does not end the string', () => {
  const src = String.raw`let s = "a\"b{"; g() {}`;
  const out = lex(src, 'swift');
  assert.equal(at(out.masked, src, 'g() {}'), 'g() {}');
  assert.equal(maxBraceDepth(out.masked), 1);
});

test('swift: #"raw "quoted""# strings end only at "#', () => {
  const src = String.raw`let r = #"raw "quoted""#; g() { }`;
  const out = lex(src, 'swift');
  assertAligned(src, out);
  assert.equal(out.code, src);
  assert.equal(at(out.masked, src, String.raw`#"raw "quoted""#`), '#"            "#');
  assert.equal(at(out.masked, src, 'g() { }'), 'g() { }');
});

test('swift: raw string interpolation uses \\#( and plain \\( is literal', () => {
  const src = String.raw`let r = #"a \#(b) \(c)"#; g()`;
  const out = lex(src, 'swift');
  assertAligned(src, out);
  assert.equal(at(out.masked, src, 'g()'), 'g()');
  assert.ok(isBlank(at(out.masked, src, String.raw`a \#(b) \(c)`)));
});

test('swift: """ multi-line strings keep newlines and hide quotes/braces', () => {
  const src = 'let m = """\nline "one" {\n  two\n"""\nh() { }';
  const out = lex(src, 'swift');
  assertAligned(src, out);
  assert.equal(out.code, src);
  assert.ok(isBlank(at(out.masked, src, '\nline "one" {\n  two\n')));
  assert.equal(at(out.masked, src, 'h() { }'), 'h() { }');
  assert.equal(maxBraceDepth(out.masked), 1);
});

test('swift: #available / #selector are not raw-string openers', () => {
  const src = 'if #available(iOS 17, *) { x(#selector(tap)) }';
  const out = lex(src, 'swift');
  assert.equal(out.code, src);
  assert.equal(out.masked, src);
});

// ---------------------------------------------------------------- offsets

test('views keep the same length and line count on a mixed file', () => {
  const dartSrc = [
    "import 'package:a/a.dart'; // c",
    '/* block',
    '   /* nested */ */',
    `final u = '\${base}/x/\$id';`,
    "final t = '''",
    "multi 'line'",
    "''';",
    "final r = r'\\d+';",
  ].join('\n');
  assertAligned(dartSrc, lex(dartSrc, 'dart'));

  const swiftSrc = [
    'import SwiftUI // c',
    '/* a /* b */ c */',
    String.raw`let u = "\(base)/x/\(id)"`,
    'let m = """',
    '  "quoted"',
    '"""',
    String.raw`let r = ##"a"#b"##`,
  ].join('\n');
  assertAligned(swiftSrc, lex(swiftSrc, 'swift'));
});

test('lineIndex maps offsets to 1-based lines', () => {
  const line = lineIndex('ab\ncd\n\nef');
  assert.equal(line(0), 1);
  assert.equal(line(2), 1); // the newline belongs to its line
  assert.equal(line(3), 2);
  assert.equal(line(6), 3);
  assert.equal(line(7), 4);
  assert.equal(line(999), 4);
});

test('matchBracket finds the matching closer for the bracket kind at open', () => {
  assert.equal(matchBracket('(a(b)c)', 0), 6);
  assert.equal(matchBracket('(a(b)c)', 2), 4);
  assert.equal(matchBracket('{ [ } ]', 0), 4); // only `{` is counted
  assert.equal(matchBracket('<a<b>>', 0), 5);
  assert.equal(matchBracket('(a', 0), -1);
  assert.equal(matchBracket('x', 0), -1);
});

test('skipWs returns the next non-whitespace offset or -1', () => {
  assert.equal(skipWs('a  \n b', 1), 5);
  assert.equal(skipWs('a   ', 1), -1);
});

// ---------------------------------------------------------------- callArgs

test('callArgs splits f(a, b: c, Map<String, dynamic> x) into three args', () => {
  const { list, close } = args('f(a, b: c, Map<String, dynamic> x)');
  assert.equal(close, 33);
  assert.deepEqual(list, [
    { name: null, text: 'a' },
    { name: 'b', text: 'c' },
    { name: null, text: 'Map<String, dynamic> x' },
  ]);
});

test('callArgs handles nested generics and nullable generic types', () => {
  const { list } = args('f(Map<String, List<int>>? m, n)');
  assert.deepEqual(list.map((a) => a.text), ['Map<String, List<int>>? m', 'n']);
});

test('callArgs ignores commas inside strings, lists, maps, closures and calls', () => {
  const { list } = args("f(x, 'a, b', [1, 2], {k: 1, j: 2}, (p, q) => p, g(1, 2))");
  assert.deepEqual(list.map((a) => a.text), ['x', "'a, b'", '[1, 2]', '{k: 1, j: 2}', '(p, q) => p', 'g(1, 2)']);
  assert.ok(list.every((a) => a.name === null));
});

test('callArgs: arrows, >= and leading type arguments do not confuse generic tracking', () => {
  const { list } = args('f(<int>[1, 2], (e) => e > 1, x >= 2)');
  assert.deepEqual(list.map((a) => a.text), ['<int>[1, 2]', '(e) => e > 1', 'x >= 2']);
});

test('callArgs does not treat spaced comparisons a < b, c > d as generics', () => {
  const { list } = args('f(a < b, c > d)');
  assert.deepEqual(list.map((a) => a.text), ['a < b', 'c > d']);
});

// The generic heuristic opens on `<` that hugs identifiers on both sides, so
// unspaced comparisons are merged into one argument. Dart parses `a<b, c>d`
// as two relational expressions (type arguments need a following `(`, `.`,
// `,`, `)` etc.). dart format always spaces these, so this is rare in practice.
test('callArgs splits unspaced comparisons f(a<b, c>d)', {
  todo: 'LIMITATION: unspaced a<b, c>d is read as a generic and merged into one argument',
}, () => {
  const { list } = args('f(a<b, c>d)');
  assert.deepEqual(list.map((a) => a.text), ['a<b', 'c>d']);
});

test('callArgs: named ternary argument and a :: label are handled', () => {
  const { list } = args('f(a: b ? c : d, e)');
  assert.deepEqual(list, [{ name: 'a', text: 'b ? c : d' }, { name: null, text: 'e' }]);
});

test('callArgs ignores commas inside string literals via the masked view', () => {
  const { list } = args('f("x, y", z)', 'swift');
  assert.deepEqual(list.map((a) => a.text), ['"x, y"', 'z']);
});

test('callArgs returns no args for an unmatched paren or an empty call', () => {
  assert.deepEqual(callArgs('f(a, b', 1), { args: [], close: -1 });
  assert.deepEqual(callArgs('f( )', 1), { args: [], close: 3 });
});

// ---------------------------------------------------------------- metrics

test('decisions counts if/for/while/case/catch/guard/&&/||/??/ternary', () => {
  const src = [
    'if (a && b || c ?? d) {',
    '  for (x in y) {}',
    '} while (z) {}',
    'switch (q) { case 1: case 2: }',
    'try {} catch (e) {}',
    'guard let v else { return }',
    'x ? y : z',
  ].join('\n');
  // if, &&, ||, ??, for, while, case, case, catch, guard, ternary
  assert.equal(decisions(src), 11);
});

test('decisions ignores nullable types, optional chaining and masked strings/comments', () => {
  const src = "String? a = b?.c; // if for && ||\nvar s = 'if (x) ?? y';";
  assert.equal(decisions(lex(src, 'dart').masked), 0);
  assert.equal(decisions('elif fortune whiles'), 0); // word boundaries
});

test('countLoc counts non-blank lines after comments are blanked', () => {
  const src = 'a();\n// only a comment\n\n/* x\n y */\nb();\n';
  assert.equal(countLoc(lex(src, 'dart').code), 2);
});

test('maxBraceDepth tracks the deepest { nesting and ignores stray closers', () => {
  assert.equal(maxBraceDepth('{ { } { { } } }'), 3);
  assert.equal(maxBraceDepth('} } {'), 1);
  assert.equal(maxBraceDepth(''), 0);
});
