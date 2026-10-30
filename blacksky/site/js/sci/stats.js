// @ts-check
// Descriptive statistics for repeated runs. Every interval says how it was computed; nothing is computed from fewer samples than its
// method needs (the functions return null and the caller shows "not computed").
import { makeRng } from "./rng.js";

/** @param {number[]} x */ export const mean = (x) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN);
/** Sample standard deviation (n − 1). @param {number[]} x */
export function sd(x) { if (x.length < 2) return NaN; const m = mean(x); return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1)); }
/** Quantile with linear interpolation between order statistics (numpy default, "linear"). @param {number[]} x @param {number} q */
export function quantile(x, q) {
  if (!x.length) return NaN; const s = [...x].sort((a, b) => a - b), h = (s.length - 1) * q, lo = Math.floor(h), hi = Math.ceil(h);
  return s[lo] + (h - lo) * (s[hi] - s[lo]);
}
/** @param {number[]} x */ export const median = (x) => quantile(x, 0.5);
/** @param {number[]} x */ export const iqr = (x) => [quantile(x, 0.25), quantile(x, 0.75)];

/** Summary of repeated measurements. @param {number[]} x */
export function summary(x) {
  const n = x.length; if (!n) return { n: 0, mean: null, median: null, sd: null, q1: null, q3: null, min: null, max: null };
  const [q1, q3] = iqr(x); return { n, mean: mean(x), median: median(x), sd: n >= 2 ? sd(x) : null, q1, q3, min: Math.min(...x), max: Math.max(...x) };
}

export const BOOT_MIN_N = 5;
/**
 * Percentile bootstrap interval for the mean (seeded). Returns null when n < BOOT_MIN_N: no interval is invented from a few runs.
 * @param {number[]} x @param {{ level?: number, B?: number, seed?: number }} [o]
 */
export function bootstrapMeanCI(x, { level = 0.95, B = 2000, seed = 12345 } = {}) {
  if (x.length < BOOT_MIN_N) return null;
  const rng = makeRng(seed), n = x.length, means = new Float64Array(B);
  for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < n; i++) s += x[rng.int(n)]; means[b] = s / n; }
  const a = (1 - level) / 2, arr = Array.from(means);
  return { lo: quantile(arr, a), hi: quantile(arr, 1 - a), level, method: `percentile bootstrap of the mean, ${B} resamples, seed ${seed}`, n };
}

/** Wilson score interval for a proportion k/n (no interval for n = 0). @param {number} k @param {number} n @param {number} [z] */
export function wilson(k, n, z = 1.959963984540054) {
  if (!n) return null; const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return { p, lo: (c - h) / d, hi: (c + h) / d, level: 0.95, method: "Wilson score interval, 95 %", n };
}

/** Histogram with fixed bin edges. @param {number[]} x @param {number} lo @param {number} hi @param {number} bins */
export function histogram(x, lo, hi, bins) {
  const c = new Array(bins).fill(0), w = (hi - lo) / bins;
  for (const v of x) { if (!(v >= lo && v <= hi)) continue; c[Math.min(bins - 1, Math.floor((v - lo) / w))]++; }
  return { counts: c, edges: Array.from({ length: bins + 1 }, (_, i) => lo + i * w) };
}
