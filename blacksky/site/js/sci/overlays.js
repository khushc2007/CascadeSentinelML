// @ts-check
// APEX branch overlays: pure functions that turn engine output and stored tables into one value per branch, plus the colour ramps that
// draw them. Shared by the 3-D scene, the 2-D view, the Inspector and the tests. Nothing here is decorative: every value is either a count
// from the exhaustive DC table or a difference of two engine flow solutions.

/** How often each branch appears in the stored list of most damaging k-sets (dist_<grid>_k<k>.json → top: [[S, set], …]).
 * @param {Array<[number, number[]]>} top @param {number} nBranch */
export function faultCounts(top, nBranch) {
  const c = new Array(nBranch).fill(0); for (const [, set] of top || []) for (const l of set) if (l >= 0 && l < nBranch) c[l]++;
  return { counts: c, max: Math.max(0, ...c), sets: (top || []).length };
}

/** Flow surge per branch: (|flow now| − |flow in the intact base case|) / DC rating. null where the branch carries no flow now
 * (out of service, de-energised) or has no rating.
 * @param {Record<string, number>|null|undefined} flowNow signed MW by branch index (engine frame.flow)
 * @param {Record<string, number>|ArrayLike<number>} flowBase signed MW by branch index (engine run of the empty set, round 0)
 * @param {number[]} ratingMw @returns {(number|null)[]} */
export function flowSurge(flowNow, flowBase, ratingMw) {
  return ratingMw.map((r, l) => { const f = flowNow ? flowNow[l] : undefined, f0 = /** @type {any} */ (flowBase)[l];
    if (f == null || f0 == null || !(r > 0)) return null; return (Math.abs(f) - Math.abs(f0)) / r; });
}

/** @param {number} a @param {number} b @param {number} t */ const lerp = (a, b, t) => a + (b - a) * t;
/** Piecewise-linear ramp through hex stops (sRGB). @param {number[]} stops @param {number} t 0..1 @returns {number} */
export function ramp(stops, t) {
  const x = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0)) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i, a = stops[i], b = stops[i + 1];
  const ch = (/** @type {number} */ v, /** @type {number} */ s) => (v >> s) & 255;
  return (Math.round(lerp(ch(a, 16), ch(b, 16), f)) << 16) | (Math.round(lerp(ch(a, 8), ch(b, 8), f)) << 8) | Math.round(lerp(ch(a, 0), ch(b, 0), f));
}
/** Single-hue sequential ramps on the dark surface (dark = low, bright = high). */
export const RAMPS = Object.freeze({
  fault: [0x2a1d1f, 0x6e2a24, 0xb8392e, 0xf0604a, 0xffb39e],      // red family: frequency in the most damaging sets
  surge: [0x232a33, 0x2f5f7a, 0x58a6cf, 0xa9dcf5, 0xeef9ff],      // ice family: added flow relative to the rating
});
/** @param {number} hex */ export const css = (hex) => `#${hex.toString(16).padStart(6, "0")}`;

/** Per-branch overlay for drawing. mode "faults": t = log(1 + count) / log(1 + max); mode "surge": t = surge / 0.5 (half a rating added = full scale),
 * shed flow (negative surge) is drawn dim. Returns null for mode "loading" (the default engine bands).
 * @param {"loading"|"faults"|"surge"} mode
 * @param {{ counts?: number[], max?: number, surge?: (number|null)[] }} d
 * @returns {null | { t: (number|null)[], color: number[], width: number[] }} */
export function branchOverlay(mode, d) {
  if (mode === "faults" && d.counts) { const mx = Math.log1p(Math.max(1, d.max || 0));          // counts are long-tailed: log scale
    const t = d.counts.map((c) => (c > 0 ? Math.log1p(c) / mx : null));
    return { t, color: t.map((v) => (v == null ? 0x1b2028 : ramp(RAMPS.fault, 0.1 + 0.9 * v))), width: t.map((v) => (v == null ? 0.7 : 1 + 4.5 * v ** 1.6)) }; }
  if (mode === "surge" && d.surge) {
    const t = d.surge.map((s) => (s == null ? null : s / 0.5));
    return { t, color: t.map((v) => (v == null ? 0x1b2028 : v <= 0.02 ? 0x262d37 : ramp(RAMPS.surge, 0.15 + 0.85 * Math.min(1, v)))), width: t.map((v) => (v == null || v <= 0.02 ? 0.8 : 1 + 2 * Math.min(1, v))) };
  }
  return null;
}
