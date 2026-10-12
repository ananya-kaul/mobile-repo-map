/**
 * Yields text lines from a fetch Response body (a web ReadableStream), decoding UTF-8
 * across chunk boundaries. Used for both SSE (OpenAI) and NDJSON (Ollama) streams.
 */
export async function* readLines(body) {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let finished = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) { finished = true; break; }
      buf += typeof value === 'string' ? value : decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        yield line.endsWith('\r') ? line.slice(0, -1) : line;
      }
    }
    buf += decoder.decode();
    if (buf) yield buf.endsWith('\r') ? buf.slice(0, -1) : buf;
  } finally {
    // The consumer may stop early (e.g. at `data: [DONE]`); drop the rest of the body.
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Best-effort error text from a non-2xx response: JSON `error.message`, `error`, `message`, or the raw body. */
export async function errorDetail(res) {
  let text = '';
  try { text = await res.text(); } catch { /* ignore */ }
  try {
    const j = JSON.parse(text);
    const e = j && (j.error ?? j.message);
    if (typeof e === 'string') return e;
    if (e && typeof e.message === 'string') return e.message;
  } catch { /* not JSON */ }
  return text.trim().slice(0, 500) || res.statusText || `HTTP ${res.status}`;
}

/** Short description of a fetch() network failure (undici hides the useful part in `cause`). */
export function networkDetail(e) {
  const c = e && e.cause;
  return (c && (c.code || c.message)) || (e && e.message) || String(e);
}
