// @ts-check
// APEX search landscape (k = 2): every pair of candidate branches is one cell of a triangular matrix; its value is S from the cascade
// simulator. Pure indexing helpers shared by the Arena, the ML Observatory, the worker and the tests.

/** Lexicographic index of the pair (i, j), i < j, among all pairs of m items (the order nextCombination enumerates).
 * @param {number} i @param {number} j @param {number} m */
export function pairIndex(i, j, m) { if (i > j) [i, j] = [j, i]; return i * m - (i * (i + 1)) / 2 + (j - i - 1); }

/** Inverse of pairIndex. @param {number} idx @param {number} m @returns {[number, number]} */
export function pairAt(idx, m) {
  let i = 0, base = 0; while (i < m - 1) { const row = m - i - 1; if (idx < base + row) return [i, i + 1 + (idx - base)]; base += row; i++; }
  throw new RangeError(`pair index ${idx} out of range for m = ${m}`);
}

/** Landscape values from probes recorded by an exhaustive k = 2 run: probes = [a0, b0, a1, b1, …] (branch numbers), probeS = [S0, S1, …].
 * Returns S per pair of universe positions (NaN where a pair was not evaluated or failed).
 * @param {number[]} universe @param {ArrayLike<number>} probes @param {ArrayLike<number|null>} probeS */
export function landscapeFromProbes(universe, probes, probeS) {
  const m = universe.length, pos = new Map(universe.map((l, i) => [l, i])), out = new Float32Array((m * (m - 1)) / 2).fill(NaN);
  for (let p = 0; p < probeS.length; p++) { const a = pos.get(probes[2 * p]), b = pos.get(probes[2 * p + 1]), s = probeS[p]; if (a == null || b == null || s == null) continue; out[pairIndex(a, b, m)] = s; }
  return out;
}

/** Display order of the universe: "branch" (as numbered) or "loading" (descending base-case loading, ties by number).
 * Returns rank[pos] = display row of universe position pos. @param {number[]} universe @param {"branch"|"loading"} by @param {number[]} [load0] */
export function displayOrder(universe, by, load0) {
  const idx = universe.map((_, i) => i);
  if (by === "loading" && load0) idx.sort((a, b) => (load0[universe[b]] ?? 0) - (load0[universe[a]] ?? 0) || universe[a] - universe[b]);
  const rank = new Array(universe.length); idx.forEach((p, r) => (rank[p] = r)); return rank;
}

/** Summary of a landscape: evaluated pairs, pairs with S > 0, maximum and its pair. @param {Float32Array} L @param {number} m */
export function landscapeStats(L, m) {
  let n = 0, pos = 0, max = -1, at = -1; for (let i = 0; i < L.length; i++) { const v = L[i]; if (Number.isNaN(v)) continue; n++; if (v > 0) pos++; if (v > max) { max = v; at = i; } }
  return { evaluated: n, positive: pos, max: max < 0 ? null : max, argmax: at < 0 ? null : pairAt(at, m) };
}
