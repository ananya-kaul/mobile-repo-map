import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const IGNORED_DIRS = new Set([
  '.git', '.hg', '.svn', 'build', '.dart_tool', '.idea', '.vscode', '.fvm', '.pub-cache',
  'Pods', 'DerivedData', '.build', '.swiftpm', 'SourcePackages', 'Carthage', 'node_modules',
  'ephemeral', '.symlinks', '.gradle', 'vendor', '.bundle', 'fastlane', 'xcuserdata',
  'mobile-repo-map-report',
]);

const SOURCE_EXT = new Set(['.dart', '.swift']);
const MAX_FILE_BYTES = 1_500_000;

/** Files tracked or untracked-but-not-ignored by git, relative to `root`. */
function gitFiles(root) {
  const r = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0 || !r.stdout) return null;
  return r.stdout.split('\0').filter(Boolean);
}

function walk(root) {
  const out = [];
  const visit = (dir, rel) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (IGNORED_DIRS.has(e.name) || e.name.endsWith('.xcassets')) continue;
        visit(path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name);
      } else if (e.isFile()) {
        out.push(rel ? `${rel}/${e.name}` : e.name);
      }
    }
  };
  visit(root, '');
  return out;
}

function isIgnoredPath(rel) {
  return rel.split('/').some((seg) => IGNORED_DIRS.has(seg));
}

/**
 * Lists every file of interest under `root`.
 * Returns { sources: [{path, lang, text}], all: [relative paths] }.
 */
export function scanFiles(root, { exclude = [] } = {}) {
  let all = gitFiles(root);
  const viaGit = Boolean(all);
  if (!all) all = walk(root);
  all = all.filter((p) => !isIgnoredPath(p) && !exclude.some((x) => p.startsWith(x)));

  const sources = [];
  for (const rel of all) {
    const ext = path.extname(rel);
    if (!SOURCE_EXT.has(ext)) continue;
    const abs = path.join(root, rel);
    let stat;
    try { stat = fs.statSync(abs); } catch { continue; }
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
    const text = fs.readFileSync(abs, 'utf8');
    sources.push({ path: rel, lang: ext === '.dart' ? 'dart' : 'swift', text });
  }
  return { sources, all, viaGit };
}

/** Commit counts per file over the last year (hotspot input). Empty map if not a git repo. */
export function gitChurn(root, { maxCommits = 3000 } = {}) {
  const churn = new Map();
  const r = spawnSync(
    'git',
    ['log', '--since=12.months', '--no-merges', `-n${maxCommits}`, '--format=', '--name-only', '--relative'],
    { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  if (r.status !== 0 || !r.stdout) return churn;
  for (const line of r.stdout.split('\n')) {
    const p = line.trim();
    if (p) churn.set(p, (churn.get(p) || 0) + 1);
  }
  return churn;
}

export function readIfExists(abs) {
  try { return fs.readFileSync(abs, 'utf8'); } catch { return null; }
}
