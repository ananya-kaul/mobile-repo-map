import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TEMPLATE_PATH = fileURLToPath(new URL('./template.html', import.meta.url));

/** @type {string | null} */
let template = null;

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape text for use in HTML text or attribute context. */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/**
 * Serialize `value` as JSON that is inert inside `<script type="application/json">`.
 * `<`, `>` and `&` can only occur inside JSON strings, so their \u escapes keep
 * the JSON valid while making `</script>` and `<!--` impossible. U+2028/U+2029
 * are escaped for older JavaScript parsers.
 */
function scriptSafeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Render the self-contained interactive HTML report.
 * @param {object} model analysis model (see docs for the shape)
 * @returns {string} complete HTML document
 */
export function renderHtml(model) {
  if (template === null) template = readFileSync(TEMPLATE_PATH, 'utf8');
  const data = model ?? {};
  const name = data.project?.name || 'Project';
  const title = escapeHtml(`${name} — MobileRepoMap`);
  const json = scriptSafeJson(data);
  // One pass over the template with a replacer function: inserted content is never
  // rescanned, and `$` sequences in the data are not treated as replacement patterns.
  return template.replace(/__MRM_(TITLE|DATA)__/g, (_, key) => (key === 'TITLE' ? title : json));
}
