import fs from 'node:fs';
import path from 'node:path';
import { analyze, VERSION } from './analyze.js';
import { renderHtml } from './report/html.js';
import { renderMarkdown, renderAiContext } from './report/markdown.js';

export { analyze, VERSION, renderHtml, renderMarkdown, renderAiContext };

/** Analyzes `root` and attaches the AI context summary. */
export function buildModel(root, opts = {}) {
  const model = analyze(root, opts);
  model.aiContext = renderAiContext(model);
  return model;
}

/**
 * Writes the requested report formats into `outDir`.
 * @returns {{format: string, file: string}[]}
 */
export function writeReports(model, outDir, formats = ['html', 'md', 'json'], { root } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  // ARCHITECTURE.md links are relative to wherever it is written, when that is inside the repo.
  let linkBase = null;
  if (root) {
    const inside = path.relative(path.resolve(root), outDir);
    if (!inside.startsWith('..') && !path.isAbsolute(inside)) {
      const back = path.relative(outDir, path.resolve(root));
      linkBase = back ? `${back.split(path.sep).join('/')}/` : '';
    }
  }
  const written = [];
  if (formats.includes('html')) {
    const file = path.join(outDir, 'index.html');
    fs.writeFileSync(file, renderHtml(model));
    written.push({ format: 'html', file });
  }
  if (formats.includes('md')) {
    const file = path.join(outDir, 'ARCHITECTURE.md');
    fs.writeFileSync(file, renderMarkdown(model, { linkBase }));
    written.push({ format: 'md', file });
  }
  if (formats.includes('json')) {
    const file = path.join(outDir, 'report.json');
    fs.writeFileSync(file, `${JSON.stringify(model, null, 2)}\n`);
    written.push({ format: 'json', file });
  }
  return written;
}
