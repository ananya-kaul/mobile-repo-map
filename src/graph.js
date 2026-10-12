/**
 * Strongly connected components (iterative Tarjan).
 * @param {number} n node count
 * @param {number[][]} adj adjacency list
 * @returns {number[][]} components with more than one node, or a self-loop
 */
export function stronglyConnected(n, adj) {
  const index = new Array(n).fill(-1);
  const low = new Array(n).fill(0);
  const onStack = new Array(n).fill(false);
  const stack = [];
  const out = [];
  let counter = 0;

  for (let root = 0; root < n; root++) {
    if (index[root] !== -1) continue;
    const work = [[root, 0]];
    while (work.length) {
      const frame = work[work.length - 1];
      const [v, i] = frame;
      if (i === 0) {
        index[v] = low[v] = counter++;
        stack.push(v);
        onStack[v] = true;
      }
      if (i < adj[v].length) {
        frame[1]++;
        const w = adj[v][i];
        if (index[w] === -1) work.push([w, 0]);
        else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1][0];
        low[parent] = Math.min(low[parent], low[v]);
      }
      if (low[v] === index[v]) {
        const comp = [];
        let w;
        do {
          w = stack.pop();
          onStack[w] = false;
          comp.push(w);
        } while (w !== v);
        if (comp.length > 1 || adj[v].includes(v)) out.push(comp);
      }
    }
  }
  return out;
}

/** Shortest cycle through `start`, restricted to nodes in `allowed`. */
export function shortestCycle(start, adj, allowed) {
  const prev = new Map([[start, -1]]);
  const queue = [start];
  while (queue.length) {
    const v = queue.shift();
    for (const w of adj[v]) {
      if (!allowed.has(w)) continue;
      if (w === start) {
        const path = [];
        let x = v;
        while (x !== -1) { path.push(x); x = prev.get(x); }
        return path.reverse();
      }
      if (!prev.has(w)) { prev.set(w, v); queue.push(w); }
    }
  }
  return null;
}

/** A few distinct short cycles that illustrate a strongly connected component. */
export function exampleCycles(comp, adj, max = 5) {
  const allowed = new Set(comp);
  const degree = (v) => adj[v].filter((w) => allowed.has(w)).length;
  const order = [...comp].sort((a, b) => degree(b) - degree(a));
  const seen = new Set();
  const cycles = [];
  for (const v of order) {
    const c = shortestCycle(v, adj, allowed);
    if (!c) continue;
    const key = [...c].sort((a, b) => a - b).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    cycles.push(c);
    if (cycles.length >= max) break;
  }
  return cycles.sort((a, b) => a.length - b.length);
}

/**
 * Reverse BFS from `start`, collecting nodes where `stop(v)` is true without
 * walking past them. Only the nearest hits are kept: the search ends one
 * level after the first hit, so hub files don't make everything "use" an API.
 */
export function reverseReach(start, radj, stop, maxDepth = 6) {
  const hits = new Set();
  const seen = new Set([start]);
  let frontier = [start];
  let firstHitDepth = -1;
  for (let d = 0; d < maxDepth && frontier.length; d++) {
    if (firstHitDepth >= 0 && d > firstHitDepth + 1) break;
    const next = [];
    for (const v of frontier) {
      for (const w of radj[v]) {
        if (seen.has(w)) continue;
        seen.add(w);
        if (stop(w)) {
          hits.add(w);
          if (firstHitDepth < 0) firstHitDepth = d;
        } else next.push(w);
      }
    }
    frontier = next;
  }
  return hits;
}
