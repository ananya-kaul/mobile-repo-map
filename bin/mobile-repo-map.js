#!/usr/bin/env node
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildModel, writeReports, VERSION, renderAiContext } from '../src/index.js';
import { scanFiles } from '../src/scan.js';

const HELP = `
mobile-repo-map v${VERSION}
Point it at any Flutter or iOS repo and get an interactive map of how the app works.

Usage
  mobile-repo-map [path] [options]            Analyze and write the report (default)
  mobile-repo-map ask "<question>" [path]     Ask an AI about the codebase (optional)
  mobile-repo-map context [path]              Print an AI-ready markdown summary

Options
  -o, --out <dir>        Output directory (default: ./mobile-repo-map-report)
  --format <list>        Comma list of html,md,json (default: all)
  --json                 Print the JSON model to stdout instead of writing files
  --open                 Open the HTML report when done
  --no-git               Skip git history (no hotspots)
  --exclude <prefix>     Skip paths starting with prefix (repeatable)
  --editor <name>        vscode | cursor | none - file links in the report (default: vscode)
  --fail-on-cycles       Exit 1 if import cycles are found (CI)
  --min-score <n>        Exit 1 if the health score is below n (CI)
  --provider <name>      ask: anthropic | openai | ollama (default: auto-detect)
  --model <id>           ask: override the model
  --dry-run              ask: print the prompt instead of sending it
  -q, --quiet            Less console output
  -h, --help             Show help
  -v, --version          Show version
`;

function parseArgs(argv) {
  const opts = { positional: [], exclude: [], format: 'html,md,json', git: true, editor: 'vscode' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    switch (a) {
      case '-o': case '--out': opts.out = next(); break;
      case '--format': opts.format = next(); break;
      case '--json': opts.json = true; break;
      case '--open': opts.open = true; break;
      case '--no-git': opts.git = false; break;
      case '--exclude': opts.exclude.push(next().replace(/^\.\//, '')); break;
      case '--editor': opts.editor = next(); break;
      case '--fail-on-cycles': opts.failOnCycles = true; break;
      case '--min-score': opts.minScore = Number(next()); break;
      case '--provider': opts.provider = next(); break;
      case '--model': opts.model = next(); break;
      case '--dry-run': opts.dryRun = true; break;
      case '-q': case '--quiet': opts.quiet = true; break;
      case '-h': case '--help': opts.help = true; break;
      case '-v': case '--version': opts.version = true; break;
      default:
        if (a.startsWith('-')) throw new Error(`Unknown option: ${a}`);
        opts.positional.push(a);
    }
  }
  return opts;
}

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = c('1');
const dim = c('2');
const red = c('31');
const green = c('32');
const yellow = c('33');
const cyan = c('36');
const fmt = (n) => Number(n).toLocaleString('en-US');

function gradeColor(grade) {
  return grade === 'A' || grade === 'B' ? green : grade === 'C' ? yellow : red;
}

function printSummary(model, written, elapsed) {
  const s = model.stats;
  const p = model.project;
  const out = [];
  out.push('');
  out.push(`${bold('MobileRepoMap')} ${dim(`v${model.tool.version}`)}  ${bold(p.name)} ${dim(`(${p.platforms.join(', ') || 'unknown'})`)}`);
  out.push('');
  out.push(`  ${fmt(s.sourceFiles)} files · ${fmt(s.loc)} LOC · ${bold(s.screens)} screens · ${s.routes} routes · ${s.navEdges} transitions · ${bold(s.apiEndpoints)} API calls · ${s.testFiles} test files`);
  const stackBits = Object.values(p.stack).flat();
  if (stackBits.length) out.push(`  ${dim('Stack')}  ${stackBits.slice(0, 10).join(' · ')}`);
  out.push('');
  const h = model.health;
  out.push(`  ${dim('Health')} ${gradeColor(h.grade)(bold(`${h.score}/100 (${h.grade})`))}`);
  for (const b of h.breakdown) out.push(`    ${red(`-${b.penalty}`.padEnd(4))} ${b.label.padEnd(18)} ${dim(b.detail)}`);

  const risks = [];
  const fp = (id) => model.files[id].path;
  for (const cyc of model.risks.cycles.slice(0, 2)) {
    const ex = cyc.examples[0];
    if (ex) risks.push(`${yellow('cycle  ')} ${[...ex, ex[0]].map((id) => path.posix.basename(fp(id))).join(' → ')}`);
  }
  for (const cx of model.risks.complex.slice(0, 3)) risks.push(`${yellow('complex')} ${fp(cx.file)} ${dim(`— ${cx.reasons[0]}`)}`);
  for (const hs of model.risks.hotspots.slice(0, 2)) risks.push(`${yellow('hotspot')} ${fp(hs.file)} ${dim(`— ${hs.churn} commits, complexity ${hs.complexity}`)}`);
  const scr = model.risks.untested.byRole.find((r) => r.role === 'screen');
  if (scr && scr.tested < scr.total) risks.push(`${yellow('tests  ')} ${scr.total - scr.tested} of ${scr.total} screens have no tests`);
  if (risks.length) {
    out.push('');
    out.push(`  ${dim('Top risks')}`);
    for (const r of risks) out.push(`    ${r}`);
  }
  if (model.warnings.length) out.push(`\n  ${yellow(`${model.warnings.length} file(s) could not be analyzed; see report.json "warnings"`)}`);
  out.push('');
  for (const w of written) {
    const rel = path.relative(process.cwd(), w.file) || w.file;
    out.push(`  ${dim(w.format.padEnd(5))} ${cyan(rel.startsWith('..') ? w.file : `./${rel}`)}`);
  }
  out.push(dim(`\n  Done in ${(elapsed / 1000).toFixed(1)}s. Nothing left your machine.`));
  out.push('');
  process.stdout.write(`${out.join('\n')}\n`);
}

function openFile(file) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '""', file] : [file];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    // opening is best-effort
  }
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${e.message}\n${HELP}`);
    process.exit(2);
  }
  if (opts.help) { process.stdout.write(HELP); return; }
  if (opts.version) { process.stdout.write(`${VERSION}\n`); return; }

  const [first, ...rest] = opts.positional;
  const progress = (msg) => { if (!opts.quiet && process.stderr.isTTY) process.stderr.write(`\r\x1b[2K${dim(`› ${msg}…`)}`); };
  const clearProgress = () => { if (!opts.quiet && process.stderr.isTTY) process.stderr.write('\r\x1b[2K'); };

  if (first === 'context') {
    const root = rest[0] || '.';
    const model = buildModel(root, { git: opts.git, exclude: opts.exclude, editor: 'none' });
    process.stdout.write(`${renderAiContext(model)}\n`);
    return;
  }

  if (first === 'ask') {
    const question = rest[0];
    if (!question) throw new Error('Usage: mobile-repo-map ask "<question>" [path]');
    const root = rest[1] || '.';
    const model = buildModel(root, { git: false, exclude: opts.exclude, editor: 'none', onProgress: progress });
    clearProgress();
    const { sources } = scanFiles(path.resolve(root), { exclude: opts.exclude });
    const { ask, AiError } = await import('../src/ai/ask.js');
    try {
      await ask({
        question,
        model,
        sources,
        contextMd: model.aiContext,
        provider: opts.provider,
        modelId: opts.model,
        dryRun: opts.dryRun,
      });
    } catch (e) {
      if (e instanceof AiError) {
        process.stderr.write(`${e.message}\n`);
        process.exit(1);
      }
      throw e;
    }
    process.stdout.write('\n');
    return;
  }

  const root = first || '.';
  const started = Date.now();
  const model = buildModel(root, {
    git: opts.git, exclude: opts.exclude, editor: opts.editor, onProgress: progress,
  });
  clearProgress();

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(model, null, 2)}\n`);
  } else {
    const formats = opts.format.split(',').map((f) => f.trim().toLowerCase()).filter(Boolean);
    const bad = formats.filter((f) => !['html', 'md', 'json'].includes(f));
    if (bad.length) throw new Error(`Unknown format: ${bad.join(', ')} (use html, md, json)`);
    const outDir = path.resolve(opts.out || 'mobile-repo-map-report');
    const written = writeReports(model, outDir, formats, { root });
    if (!opts.quiet) printSummary(model, written, Date.now() - started);
    const html = written.find((w) => w.format === 'html');
    if (opts.open && html) openFile(html.file);
  }

  let exit = 0;
  if (opts.failOnCycles && model.risks.cycles.length) {
    process.stderr.write(`${red('✖')} ${model.risks.cycles.length} import cycle(s) found (--fail-on-cycles)\n`);
    exit = 1;
  }
  if (Number.isFinite(opts.minScore) && model.health.score < opts.minScore) {
    process.stderr.write(`${red('✖')} Health score ${model.health.score} is below --min-score ${opts.minScore}\n`);
    exit = 1;
  }
  process.exitCode = exit;
}

main().catch((e) => {
  process.stderr.write(`\n${red('Error:')} ${e.message}\n`);
  if (process.env.MRM_DEBUG) process.stderr.write(`${e.stack}\n`);
  process.exit(1);
});
