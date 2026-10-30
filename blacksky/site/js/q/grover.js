// @ts-check
// Grover search on a small, fully specified unstructured-search problem: N = 2^n basis states, a set of M marked states, a phase oracle
// (X-conjugated multi-controlled Z per marked state) and the diffusion operator H^n X^n MCZ X^n H^n (= −(2|s⟩⟨s| − I), a global phase
// −1 per iteration that changes no probability). Two simulations of the same algorithm are provided and must agree (tested):
//   circuit level  — the elementary-gate circuit (MCZ decomposed into CX + P) on the statevector or density-matrix engine;
//   abstract query — the oracle as a diagonal sign flip and the diffusion as inversion about the mean (2⟨a⟩ − a_i).
// Ideal theory (M marked of N): θ = arcsin √(M/N), P_r = sin²((2r + 1)θ), r* = ⌊π / (4θ)⌋.
import { layoutColumns, expandCircuit, simulateNoisy, circuitStats } from "./circuit.js";
import { StateVector, LIMITS } from "./sim.js";

export const GROVER_LIMITS = Object.freeze({ minQubits: 2, maxQubits: 8, maxNoisyQubits: 5, maxIterations: 40 });

/** @param {number} N @param {number} M */
export function groverTheory(N, M) {
  if (!(M >= 1 && M < N)) throw new Error("need 1 ≤ M < N marked states");
  const theta = Math.asin(Math.sqrt(M / N)), rStar = Math.floor(Math.PI / (4 * theta));
  return { N, M, theta, rStar, P: (/** @type {number} */ r) => Math.sin((2 * r + 1) * theta) ** 2, classicalExpectedQueries: (N + 1) / (M + 1), pMax: Math.sin((2 * rStar + 1) * theta) ** 2 };
}

/**
 * Validate a Grover configuration. @param {{ n: number, marked: number[], r: number, shots?: number, noisy?: boolean }} c
 */
export function validateGrover({ n, marked, r, shots = 1024, noisy = false }) {
  const errors = []; const N = 2 ** n;
  if (!Number.isInteger(n) || n < GROVER_LIMITS.minQubits || n > GROVER_LIMITS.maxQubits) errors.push(`Qubits must be an integer in ${GROVER_LIMITS.minQubits}–${GROVER_LIMITS.maxQubits}.`);
  if (noisy && n > GROVER_LIMITS.maxNoisyQubits) errors.push(`Noisy (density-matrix) runs are limited to ${GROVER_LIMITS.maxNoisyQubits} qubits here: memory grows as 4^n and the decomposed oracle has ~n·2^n gates.`);
  if (!Array.isArray(marked) || !marked.length) errors.push("Mark at least one state.");
  else {
    if (marked.some((m) => !Number.isInteger(m) || m < 0 || m >= N)) errors.push(`Marked states must be integers in 0–${N - 1}.`);
    if (new Set(marked).size !== marked.length) errors.push("Marked states must be distinct.");
    if (marked.length >= N) errors.push("At least one state must be unmarked.");
  }
  if (!Number.isInteger(r) || r < 0 || r > GROVER_LIMITS.maxIterations) errors.push(`Iterations must be an integer in 0–${GROVER_LIMITS.maxIterations}.`);
  if (!Number.isInteger(shots) || shots < 1 || shots > LIMITS.maxShots) errors.push(`Shots must be an integer in 1–${LIMITS.maxShots}.`);
  return { ok: !errors.length, errors };
}

const all = (/** @type {number} */ n) => Array.from({ length: n }, (_, i) => i);
/** Oracle block: phase −1 on each marked basis state. @param {number} n @param {number[]} marked */
export function oracleOps(n, marked) {
  const ops = /** @type {import("./sim.js").Op[]} */ ([]);
  for (const m of marked) {
    const zeros = all(n).filter((q) => !(m & (1 << q)));
    zeros.forEach((q) => ops.push({ g: "x", q: [q], tag: "oracle" }));
    ops.push({ g: "mcz", q: [n - 1], c: all(n - 1), tag: "oracle" });
    zeros.forEach((q) => ops.push({ g: "x", q: [q], tag: "oracle" }));
  }
  return ops;
}
/** Diffusion block H X MCZ X H. @param {number} n */
export function diffusionOps(n) {
  const ops = /** @type {import("./sim.js").Op[]} */ ([]);
  all(n).forEach((q) => ops.push({ g: "h", q: [q], tag: "diffusion" })); all(n).forEach((q) => ops.push({ g: "x", q: [q], tag: "diffusion" }));
  ops.push({ g: "mcz", q: [n - 1], c: all(n - 1), tag: "diffusion" });
  all(n).forEach((q) => ops.push({ g: "x", q: [q], tag: "diffusion" })); all(n).forEach((q) => ops.push({ g: "h", q: [q], tag: "diffusion" }));
  return ops;
}
/** Full Grover circuit with barriers between stages and terminal measurement of every qubit. @param {{ n: number, marked: number[], r: number, measure?: boolean }} c */
export function groverCircuit({ n, marked, r, measure = true }) {
  const ops = /** @type {import("./sim.js").Op[]} */ ([]);
  all(n).forEach((q) => ops.push({ g: "h", q: [q], tag: "init" }));
  for (let it = 0; it < r; it++) { ops.push({ g: "barrier", q: [], tag: `iter${it + 1}` }); ops.push(...oracleOps(n, marked)); ops.push({ g: "barrier", q: [], tag: `iter${it + 1}` }); ops.push(...diffusionOps(n)); }
  if (measure) { ops.push({ g: "barrier", q: [], tag: "measure" }); all(n).forEach((q) => ops.push({ g: "measure", q: [q], tag: "measure" })); }
  return { schema: "bsx.circuit/1", name: `grover_n${n}_M${marked.length}_r${r}`, n, ops: layoutColumns(ops, n) };
}

/**
 * Circuit-level ideal simulation, recording the state after initialisation and after every oracle and diffusion step.
 * Uses the decomposed (CX + P) circuit, i.e. the gates that are counted in the resource panel.
 * @param {{ n: number, marked: number[], r: number }} c
 */
export function runGroverCircuit({ n, marked, r }) {
  const v = validateGrover({ n, marked, r }); if (!v.ok) throw new Error(v.errors[0]);
  const t0 = performance.now(), sv = new StateVector(n), mk = new Set(marked), stages = [];
  const rec = (/** @type {string} */ label, /** @type {number} */ iter) => { const p = sv.probs(); let pm = 0; mk.forEach((m) => (pm += p[m]));
    stages.push({ label, iter, pMarked: pm, probs: n <= 10 ? Array.from(p) : null, amps: n <= 10 ? Array.from(sv.re) : null, ampsIm: n <= 10 ? Array.from(sv.im) : null }); };
  const run = (/** @type {import("./sim.js").Op[]} */ ops) => expandCircuit({ n, ops }).ops.forEach((o) => sv.apply(o));
  run(all(n).map((q) => ({ g: "h", q: [q] }))); rec("uniform superposition", 0);
  const orc = oracleOps(n, marked), dif = diffusionOps(n);
  for (let it = 1; it <= r; it++) { run(orc); rec(`oracle ${it}`, it); run(dif); rec(`diffusion ${it}`, it); }
  const C = groverCircuit({ n, marked, r }), E = expandCircuit(C);
  return { stages, final: stages[stages.length - 1], ms: performance.now() - t0, circuit: C, expanded: E, statsAbstract: circuitStats(C), statsCompiled: circuitStats(E), oracleQueries: r,
    method: "statevector, elementary-gate circuit (classical simulation)" };
}

/** Abstract-query simulation: real amplitudes, sign flip on marked states, inversion about the mean. @param {{ n: number, marked: number[], r: number }} c */
export function runGroverAbstract({ n, marked, r }) {
  const N = 2 ** n, a = new Float64Array(N).fill(1 / Math.sqrt(N)), mk = new Set(marked), trace = [];
  const pm = () => { let s = 0; mk.forEach((m) => (s += a[m] ** 2)); return s; };
  trace.push({ iter: 0, pMarked: pm() });
  for (let it = 1; it <= r; it++) { mk.forEach((m) => (a[m] = -a[m])); let mean = 0; for (let i = 0; i < N; i++) mean += a[i]; mean /= N; for (let i = 0; i < N; i++) a[i] = 2 * mean - a[i]; trace.push({ iter: it, pMarked: pm() }); }
  return { amps: Array.from(a), trace };
}

/** Noisy Grover (density matrix on the decomposed circuit). @param {{ n: number, marked: number[], r: number, noise: import("./sim.js").Noise }} c */
export function runGroverNoisy({ n, marked, r, noise }) {
  const v = validateGrover({ n, marked, r, noisy: true }); if (!v.ok) throw new Error(v.errors[0]);
  const E = expandCircuit(groverCircuit({ n, marked, r })), res = simulateNoisy(E, noise);
  const key = (/** @type {number} */ m) => m.toString(2).padStart(n, "0");
  let pm = 0, pmBefore = 0; marked.forEach((m) => { pm += res.dist.get(key(m)) || 0; pmBefore += res.distBeforeReadout.get(key(m)) || 0; });
  return { ...res, pMarked: pm, pMarkedBeforeReadout: pmBefore, stats: circuitStats(E) };
}

/** Projection of a Grover state onto the plane of |good⟩ (uniform over marked) and |bad⟩ (uniform over unmarked).
 * Global phase is unobservable, so the sign is chosen to be nearest the analytical direction `refAngle` (radians) when given.
 * Returns the in-plane coordinates, the angle from |bad⟩ and the norm left outside the plane (0 for an exact Grover state).
 * @param {ArrayLike<number>} re @param {ArrayLike<number>} im @param {number[]} marked @param {number} [refAngle] */
export function planeProjection(re, im, marked, refAngle) {
  const N = re.length, mk = new Set(marked), M = mk.size; let gr = 0, gi = 0, br = 0, bi = 0, tot = 0;
  for (let i = 0; i < N; i++) { tot += re[i] * re[i] + im[i] * im[i]; if (mk.has(i)) { gr += re[i]; gi += im[i]; } else { br += re[i]; bi += im[i]; } }
  gr /= Math.sqrt(M); gi /= Math.sqrt(M); br /= Math.sqrt(N - M); bi /= Math.sqrt(N - M);
  // remove the global phase: rotate so that the larger of the two components is real
  const ph = Math.hypot(gr, gi) >= Math.hypot(br, bi) ? Math.atan2(gi, gr) : Math.atan2(bi, br), c = Math.cos(-ph), s2 = Math.sin(-ph);
  let good = gr * c - gi * s2, bad = br * c - bi * s2;
  if (refAngle != null) { const d1 = Math.hypot(bad - Math.cos(refAngle), good - Math.sin(refAngle)), d2 = Math.hypot(-bad - Math.cos(refAngle), -good - Math.sin(refAngle)); if (d2 < d1) { good = -good; bad = -bad; } }
  const inPlane = good * good + bad * bad + (gr * s2 + gi * c) ** 2 + (br * s2 + bi * c) ** 2;
  return { good, bad, angle: Math.atan2(good, bad), outOfPlane: Math.max(0, tot - inPlane) };
}

/** Analytical angle from |bad⟩ after a Grover stage: uniform θ, oracle k: −(2k−1)θ, diffusion k: (2k+1)θ.
 * @param {number} theta @param {string} label @param {number} iter */
export function stageAngle(theta, label, iter) { return label.startsWith("oracle") ? -(2 * iter - 1) * theta : label.startsWith("diffusion") ? (2 * iter + 1) * theta : theta; }

