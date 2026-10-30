// @ts-check
// Classical simulation of small quantum circuits: an ideal statevector engine and a density-matrix engine with documented noise
// channels. Qubit q is bit q of the basis index (little-endian, as in Qiskit), so |q_{n-1} … q_1 q_0⟩ is printed most significant first.
// This is a classical simulation on the user's CPU. Memory grows as 2^n (statevector) and 4^n (density matrix), hence the size limits.
import { MATRIX, GATES } from "./gates.js";

export const LIMITS = Object.freeze({ svQubits: 12, dmQubits: 7, composerQubits: 8, maxOps: 4000, maxShots: 100000 });

/** @typedef {{ g: string, q: number[], c?: number[], p?: number[], col?: number, tag?: string }} Op */

/**
 * Apply a 2×2 complex matrix to every amplitude pair (i0, i1 = i0 | bit) of a strided complex vector, optionally only where all
 * control bits are set. Index space 0..dim-1 maps to array position off + idx*stride.
 * @param {Float64Array} re @param {Float64Array} im @param {number} dim @param {number} off @param {number} stride
 * @param {number} bit target bit mask @param {number} cmask control mask (0 = none) @param {number[]} m matrix
 */
function apply2(re, im, dim, off, stride, bit, cmask, m) {
  const [a, ai, b, bi, c, ci, d, di] = m;
  for (let i = 0; i < dim; i++) {
    if (i & bit || (i & cmask) !== cmask) continue;
    const p0 = off + i * stride, p1 = off + (i | bit) * stride;
    const xr = re[p0], xi = im[p0], yr = re[p1], yi = im[p1];
    re[p0] = a * xr - ai * xi + b * yr - bi * yi; im[p0] = a * xi + ai * xr + b * yi + bi * yr;
    re[p1] = c * xr - ci * xi + d * yr - di * yi; im[p1] = c * xi + ci * xr + d * yi + di * yr;
  }
}
/** @param {Float64Array} re @param {Float64Array} im @param {number} dim @param {number} off @param {number} stride @param {number} a @param {number} b */
function swapBits(re, im, dim, off, stride, a, b) {
  for (let i = 0; i < dim; i++) {
    if (!(i & a) || (i & b)) continue;                                    // i has bit a = 1, bit b = 0; partner has a = 0, b = 1
    const j = (i & ~a) | b, p = off + i * stride, q = off + j * stride;
    let t = re[p]; re[p] = re[q]; re[q] = t; t = im[p]; im[p] = im[q]; im[q] = t;
  }
}
/** phase e^{iλ} on indices with all bits of mask set @param {Float64Array} re @param {Float64Array} im @param {number} dim @param {number} off @param {number} stride @param {number} mask @param {number} l */
function phaseMask(re, im, dim, off, stride, mask, l) {
  const c = Math.cos(l), s = Math.sin(l);
  for (let i = 0; i < dim; i++) if ((i & mask) === mask) { const p = off + i * stride, xr = re[p], xi = im[p]; re[p] = c * xr - s * xi; im[p] = c * xi + s * xr; }
}
/** complex conjugate of a 2×2 matrix @param {number[]} m */
const conj = (m) => m.map((v, i) => (i % 2 ? -v : v));
const maskOf = (/** @type {number[]} */ qs) => qs.reduce((a, q) => a | (1 << q), 0);

/** Apply one unitary operation to a strided complex vector. @param {Float64Array} re @param {Float64Array} im @param {number} dim @param {number} off @param {number} stride @param {Op} op @param {boolean} [conjugate] */
function applyOpVec(re, im, dim, off, stride, op, conjugate = false) {
  const def = GATES[op.g]; if (!def) throw new Error(`unknown gate ${op.g}`);
  if (def.kind === "1q") { const m = MATRIX[op.g](op.p || []); apply2(re, im, dim, off, stride, 1 << op.q[0], 0, conjugate ? conj(m) : m); }
  else if (def.kind === "c1q") { const m = MATRIX[/** @type {string} */ (def.base)](op.p || []); apply2(re, im, dim, off, stride, 1 << op.q[0], maskOf(op.c || []), conjugate ? conj(m) : m); }
  else if (def.kind === "swap") swapBits(re, im, dim, off, stride, 1 << op.q[0], 1 << op.q[1]);
  else if (def.kind === "mcp") phaseMask(re, im, dim, off, stride, maskOf([...(op.c || []), ...op.q]), conjugate ? -Math.PI : Math.PI);
}

// ------------------------------------------------------------------ statevector
export class StateVector {
  /** @param {number} n */
  constructor(n) {
    if (!Number.isInteger(n) || n < 1 || n > LIMITS.svQubits) throw new Error(`statevector simulation supports 1–${LIMITS.svQubits} qubits (got ${n})`);
    this.n = n; this.dim = 1 << n; this.re = new Float64Array(this.dim); this.im = new Float64Array(this.dim); this.re[0] = 1;   // |0…0⟩
  }
  clone() { const s = new StateVector(this.n); s.re.set(this.re); s.im.set(this.im); return s; }
  /** @param {Op} op */
  apply(op) { if (op.g === "measure" || op.g === "barrier") return this; applyOpVec(this.re, this.im, this.dim, 0, 1, op); return this; }
  probs() { const p = new Float64Array(this.dim); for (let i = 0; i < this.dim; i++) p[i] = this.re[i] ** 2 + this.im[i] ** 2; return p; }
  norm() { let s = 0; for (let i = 0; i < this.dim; i++) s += this.re[i] ** 2 + this.im[i] ** 2; return Math.sqrt(s); }
  /** reduced single-qubit density matrix of qubit q: [ρ00, ρ11, Re ρ01, Im ρ01] @param {number} q */
  reduced(q) {
    const b = 1 << q; let r00 = 0, r11 = 0, xr = 0, xi = 0;
    for (let i = 0; i < this.dim; i++) { if (i & b) continue; const j = i | b, ar = this.re[i], ai = this.im[i], br = this.re[j], bi = this.im[j];
      r00 += ar * ar + ai * ai; r11 += br * br + bi * bi; xr += ar * br + ai * bi; xi += ai * br - ar * bi; }      // a · conj(b)
    return [r00, r11, xr, xi];
  }
}

// ------------------------------------------------------------------ density matrix
/** Noise model (all parameters explicit; synthetic unless stated otherwise): depolarizing λ after every one- and two-qubit gate, symmetric readout flip probability. */
/** @typedef {{ p1: number, p2: number, readout: number, source: string }} Noise */
export const IDEAL = Object.freeze({ p1: 0, p2: 0, readout: 0, source: "ideal (no noise)" });

export class DensityMatrix {
  /** @param {number} n */
  constructor(n) {
    if (!Number.isInteger(n) || n < 1 || n > LIMITS.dmQubits) throw new Error(`density-matrix simulation supports 1–${LIMITS.dmQubits} qubits (got ${n})`);
    this.n = n; this.dim = 1 << n; this.re = new Float64Array(this.dim * this.dim); this.im = new Float64Array(this.dim * this.dim); this.re[0] = 1;
  }
  /** ρ → U ρ U† @param {Op} op */
  apply(op) {
    if (op.g === "measure" || op.g === "barrier") return this; const D = this.dim;
    for (let j = 0; j < D; j++) applyOpVec(this.re, this.im, D, j, D, op);          // U ρ   (columns: stride D)
    for (let i = 0; i < D; i++) applyOpVec(this.re, this.im, D, i * D, 1, op, true); // (Uρ) U†  (rows: conj(U) acting on the column index)
    return this;
  }
  /** Depolarizing channel on the qubits qs: ρ → (1 − λ) ρ + λ (I/2^|qs|) ⊗ Tr_qs ρ (Qiskit depolarizing_error(λ, |qs|)). @param {number[]} qs @param {number} lam */
  depolarize(qs, lam) {
    if (!(lam > 0)) return this; const D = this.dim, mask = maskOf(qs), k = qs.length, f = lam / (1 << k);
    const subs = []; for (let s = 0; s < (1 << k); s++) { let m = 0; qs.forEach((q, j) => { if (s & (1 << j)) m |= 1 << q; }); subs.push(m); }
    const nr = new Float64Array(D * D), ni = new Float64Array(D * D);
    for (let i = 0; i < D; i++) for (let j = 0; j < D; j++) {
      const p = i * D + j; nr[p] = (1 - lam) * this.re[p]; ni[p] = (1 - lam) * this.im[p];
      if ((i & mask) !== (j & mask)) continue;
      const i0 = i & ~mask, j0 = j & ~mask; let tr = 0, ti = 0;
      for (const s of subs) { const q = (i0 | s) * D + (j0 | s); tr += this.re[q]; ti += this.im[q]; }
      nr[p] += f * tr; ni[p] += f * ti;
    }
    this.re = nr; this.im = ni; return this;
  }
  probs() { const p = new Float64Array(this.dim); for (let i = 0; i < this.dim; i++) p[i] = this.re[i * this.dim + i]; return p; }
  trace() { let t = 0; for (let i = 0; i < this.dim; i++) t += this.re[i * this.dim + i]; return t; }
  purity() { let s = 0; for (let k = 0; k < this.re.length; k++) s += this.re[k] ** 2 + this.im[k] ** 2; return s; }   // Tr ρ² for Hermitian ρ
  /** @param {number} q */
  reduced(q) {
    const b = 1 << q, D = this.dim; let r00 = 0, r11 = 0, xr = 0, xi = 0;
    for (let i = 0; i < D; i++) { if (i & b) continue; const j = i | b; r00 += this.re[i * D + i]; r11 += this.re[j * D + j]; xr += this.re[i * D + j]; xi += this.im[i * D + j]; }
    return [r00, r11, xr, xi];
  }
}

/** Bloch vector of a reduced single-qubit state [ρ00, ρ11, Re ρ01, Im ρ01]: x = 2 Re ρ01, y = −2 Im ρ01, z = ρ00 − ρ11; |r| = 1 only for a pure qubit state. @param {number[]} r */
export function bloch([r00, r11, xr, xi]) { const x = 2 * xr, y = -2 * xi, z = r00 - r11; return { x, y, z, r: Math.hypot(x, y, z) }; }

/** Distribution over classical bits (bitstring c_{k-1}…c_0) from basis probabilities. @param {Float64Array|number[]} p @param {{ q: number, c: number }[]} meas @param {number} nClbits */
export function marginal(p, meas, nClbits) {
  /** @type {Map<string, number>} */ const out = new Map();
  for (let i = 0; i < p.length; i++) {
    if (p[i] < 1e-15) continue; const bits = new Array(nClbits).fill("0");
    for (const { q, c } of meas) if (i & (1 << q)) bits[nClbits - 1 - c] = "1";
    const key = bits.join(""); out.set(key, (out.get(key) || 0) + p[i]);
  }
  return out;
}
/** Symmetric readout error: each classical bit flips independently with probability e (Qiskit ReadoutError([[1-e, e], [e, 1-e]])). @param {Map<string, number>} dist @param {number} e */
export function applyReadout(dist, e) {
  if (!(e > 0)) return dist; let cur = new Map(dist); const nb = [...dist.keys()][0]?.length || 0;
  for (let b = 0; b < nb; b++) { const nxt = new Map();
    for (const [k, v] of cur) { const f = k.slice(0, b) + (k[b] === "0" ? "1" : "0") + k.slice(b + 1); nxt.set(k, (nxt.get(k) || 0) + (1 - e) * v); nxt.set(f, (nxt.get(f) || 0) + e * v); }
    cur = nxt; }
  return cur;
}
/** Sample shots from a distribution with a seeded generator. @param {Map<string, number>} dist @param {number} shots @param {() => number} rand */
export function sample(dist, shots, rand) {
  if (!Number.isInteger(shots) || shots < 1 || shots > LIMITS.maxShots) throw new Error(`shots must be an integer in 1–${LIMITS.maxShots}`);
  const keys = [...dist.keys()].sort(), cum = []; let s = 0; for (const k of keys) { s += dist.get(k) || 0; cum.push(s); }
  /** @type {Map<string, number>} */ const counts = new Map();
  for (let t = 0; t < shots; t++) { const u = rand() * s; let lo = 0, hi = cum.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] > u) hi = mid; else lo = mid + 1; }
    counts.set(keys[lo], (counts.get(keys[lo]) || 0) + 1); }
  return counts;
}
/** Total-variation distance between an exact distribution and empirical counts. @param {Map<string, number>} p @param {Map<string, number>} counts @param {number} shots */
export function tvDistance(p, counts, shots) {
  const keys = new Set([...p.keys(), ...counts.keys()]); let d = 0;
  for (const k of keys) d += Math.abs((p.get(k) || 0) - (counts.get(k) || 0) / shots);
  return d / 2;
}
