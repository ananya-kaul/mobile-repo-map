import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stronglyConnected, shortestCycle, exampleCycles, reverseReach,
} from '../src/graph.js';

/** Components as sorted node lists, sorted by first node, for order-free comparison. */
const normalize = (comps) => comps.map((c) => [...c].sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);

// 0 -> 1 -> 2 -> 0   (3-cycle)
// 2 -> 3, 3 <-> 4    (2-cycle reachable from the first)
// 5 -> 5             (self loop)
// 6                  (isolated)
// 7 -> 0             (feeds a cycle but is not part of one)
const GRAPH = [[1], [2], [0, 3], [4], [3], [5], [], [0]];

// ---------------------------------------------------------------- stronglyConnected

test('stronglyConnected finds two cycles and a self loop', () => {
  assert.deepEqual(normalize(stronglyConnected(GRAPH.length, GRAPH)), [[0, 1, 2], [3, 4], [5]]);
});

test('stronglyConnected omits single nodes without a self loop', () => {
  const comps = stronglyConnected(GRAPH.length, GRAPH).flat();
  assert.ok(!comps.includes(6));
  assert.ok(!comps.includes(7));
});

test('stronglyConnected returns nothing for a DAG or an empty graph', () => {
  assert.deepEqual(stronglyConnected(4, [[1, 2], [3], [3], []]), []);
  assert.deepEqual(stronglyConnected(0, []), []);
});

test('stronglyConnected merges overlapping cycles into one component', () => {
  // 0 -> 1 -> 0 and 1 -> 2 -> 3 -> 1
  assert.deepEqual(normalize(stronglyConnected(4, [[1], [0, 2], [3], [1]])), [[0, 1, 2, 3]]);
});

test('stronglyConnected is iterative: a 100k-node ring does not overflow the stack', () => {
  const n = 100000;
  const ring = Array.from({ length: n }, (_, i) => [(i + 1) % n]);
  const comps = stronglyConnected(n, ring);
  assert.equal(comps.length, 1);
  assert.equal(comps[0].length, n);
});

// ---------------------------------------------------------------- shortestCycle / exampleCycles

// One component with a 2-cycle (0 <-> 1) and a 4-cycle (0 -> 1 -> 2 -> 3 -> 0).
const TWO_LOOPS = [[1], [2, 0], [3], [0]];

test('shortestCycle returns the shortest cycle starting at start', () => {
  const all = new Set([0, 1, 2, 3]);
  assert.deepEqual(shortestCycle(0, TWO_LOOPS, all), [0, 1]);
  assert.deepEqual(shortestCycle(2, TWO_LOOPS, all), [2, 3, 0, 1]);
});

test('shortestCycle stays inside the allowed set and returns null when no cycle remains', () => {
  assert.deepEqual(shortestCycle(0, TWO_LOOPS, new Set([0, 1])), [0, 1]);
  assert.equal(shortestCycle(2, TWO_LOOPS, new Set([2])), null);
  assert.equal(shortestCycle(0, [[1], []], new Set([0, 1])), null);
});

test('shortestCycle on a self loop is the node itself', () => {
  assert.deepEqual(shortestCycle(5, GRAPH, new Set([5])), [5]);
});

test('exampleCycles returns distinct cycles, shortest first', () => {
  const [comp] = stronglyConnected(TWO_LOOPS.length, TWO_LOOPS);
  const cycles = exampleCycles(comp, TWO_LOOPS);
  assert.equal(cycles.length, 2);
  assert.deepEqual([...cycles[0]].sort(), [0, 1]);
  assert.deepEqual([...cycles[1]].sort(), [0, 1, 2, 3]);
  for (let i = 1; i < cycles.length; i++) assert.ok(cycles[i - 1].length <= cycles[i].length);
});

test('exampleCycles dedupes rotations of the same cycle', () => {
  // a single 3-cycle: every node yields a rotation of it
  const tri = [[1], [2], [0]];
  assert.equal(exampleCycles([0, 1, 2], tri).length, 1);
});

test('exampleCycles respects max and handles self loops', () => {
  const [comp] = stronglyConnected(TWO_LOOPS.length, TWO_LOOPS);
  const one = exampleCycles(comp, TWO_LOOPS, 1);
  assert.equal(one.length, 1);
  assert.equal(one[0].length, 2); // the highest-degree node's cycle is the 2-cycle
  assert.deepEqual(exampleCycles([5], GRAPH), [[5]]);
});

// ---------------------------------------------------------------- reverseReach

test('reverseReach stops at hits and does not walk past them', () => {
  // radj[v] = nodes that depend on v. 0 is the API file.
  // 0 <- 1 <- 3 (hit) <- 6 (hit, but behind 3)
  // 0 <- 2 <- 4 <- 5 (hit)
  const radj = [[1, 2], [3], [4], [6], [5], [], []];
  const hits = reverseReach(0, radj, (v) => [3, 5, 6].includes(v));
  assert.deepEqual([...hits].sort(), [3, 5]);
});

test('reverseReach keeps only the nearest hits (one level past the first hit)', () => {
  // 0 <- 1 (hit at depth 0)
  // 0 <- 2 <- 3 <- 4 (hit at depth 2, too far)
  const radj = [[1, 2], [], [3], [4], []];
  const hits = reverseReach(0, radj, (v) => v === 1 || v === 4);
  assert.deepEqual([...hits], [1]);
});

test('reverseReach allows a hit exactly one level after the first hit', () => {
  // 0 <- 1 (hit, depth 0); 0 <- 2 <- 3 (hit, depth 1)
  const radj = [[1, 2], [], [3], []];
  assert.deepEqual([...reverseReach(0, radj, (v) => v === 1 || v === 3)].sort(), [1, 3]);
});

test('reverseReach never reports the start node and terminates on cycles', () => {
  assert.deepEqual([...reverseReach(0, [[0, 1], [0]], () => true)], [1]);
  assert.deepEqual([...reverseReach(0, [[1], [2], [0]], () => false)], []);
});

test('reverseReach honours maxDepth', () => {
  const chain = [[1], [2], [3], [4], []];
  assert.deepEqual([...reverseReach(0, chain, (v) => v === 4, 3)], []);
  assert.deepEqual([...reverseReach(0, chain, (v) => v === 4, 4)], [4]);
  assert.deepEqual([...reverseReach(0, chain, (v) => v === 4)], [4]); // default depth 6
});
