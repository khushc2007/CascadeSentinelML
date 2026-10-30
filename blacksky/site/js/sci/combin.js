// @ts-check
// Combinatorics of the outage search space: N = C(m, k) with exact integers, validation of k, canonical candidate identity, and
// enumeration / ranking of k-subsets in lexicographic order (used by exhaustive search and the search-space explorer).

/** Exact binomial coefficient as a BigInt. @param {number} n @param {number} k */
export function binomBig(n, k) {
  if (!Number.isInteger(n) || !Number.isInteger(k) || n < 0) return 0n;
  if (k < 0 || k > n) return 0n; k = Math.min(k, n - k); let r = 1n;
  for (let i = 1; i <= k; i++) r = (r * BigInt(n - k + i)) / BigInt(i);
  return r;
}
/** Binomial coefficient as a Number (exact up to 2^53). @param {number} n @param {number} k */
export const binom = (n, k) => Number(binomBig(n, k));

/** Group digits of a BigInt or number: 1055240 -> "1,055,240". @param {bigint|number} x */
export function groupDigits(x) { return String(x).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

/**
 * Validate the number of simultaneous outages against the eligible branches. k must be an integer with 0 <= k <= m.
 * @param {unknown} kRaw value typed by the user @param {number} m eligible branches
 * @returns {{ ok: boolean, k: number|null, N: bigint|null, error: string|null, note: string|null }}
 */
export function validateK(kRaw, m) {
  const s = typeof kRaw === "string" ? kRaw.trim() : kRaw;
  if (s === "" || s == null) return { ok: false, k: null, N: null, error: "Enter the number of simultaneous outages k.", note: null };
  const k = Number(s);
  if (!Number.isFinite(k) || !Number.isInteger(k)) return { ok: false, k: null, N: null, error: `k must be a whole number (got "${String(kRaw)}").`, note: null };
  if (k < 0) return { ok: false, k, N: null, error: "k cannot be negative.", note: null };
  if (k > m) return { ok: false, k, N: null, error: `k cannot exceed the ${m} eligible branches.`, note: null };
  const N = binomBig(m, k);
  const note = k === 0 ? "k = 0 is the base case: one (empty) outage set, nothing to simulate." : null;
  return { ok: true, k, N, error: null, note };
}

/** Canonical candidate: sorted, distinct, integer branch indices. @param {number[]} set */
export const canon = (set) => [...new Set(set.map(Number))].sort((a, b) => a - b);
/** Stable candidate identifier. @param {string} grid @param {number[]} set */
export const candidateId = (grid, set) => `CND:${grid}:${canon(set).join("-")}`;
/** @param {string} id @returns {{ grid: string, set: number[] } | null} */
export function parseCandidateId(id) { const m = /^CND:([a-z0-9_]+):([0-9-]*)$/.exec(id || ""); return m ? { grid: m[1], set: m[2] ? m[2].split("-").map(Number) : [] } : null; }

/** Lexicographic successor of a k-subset of {0..m-1} given as sorted positions (in place). Returns false after the last one. @param {number[]} c @param {number} m */
export function nextCombination(c, m) {
  const k = c.length; let i = k - 1;
  while (i >= 0 && c[i] === m - k + i) i--;
  if (i < 0) return false;
  c[i]++; for (let j = i + 1; j < k; j++) c[j] = c[j - 1] + 1;
  return true;
}
/** Lexicographic rank (0-based) of a sorted k-subset of {0..m-1}. @param {number[]} c @param {number} m */
export function rankCombination(c, m) {
  const k = c.length; let r = 0, prev = -1;
  for (let i = 0; i < k; i++) { for (let v = prev + 1; v < c[i]; v++) r += binom(m - v - 1, k - i - 1); prev = c[i]; }
  return r;
}
/** Inverse of rankCombination. @param {number} r @param {number} m @param {number} k */
export function unrankCombination(r, m, k) {
  const out = []; let v = 0;
  for (let i = 0; i < k; i++) { for (;;) { const c = binom(m - v - 1, k - i - 1); if (r < c) break; r -= c; v++; } out.push(v); v++; }
  return out;
}
