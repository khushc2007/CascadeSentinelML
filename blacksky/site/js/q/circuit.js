// @ts-check
// Circuit model of the Quantum Lab: the diagram, the statistics, the exports and the simulation all read this one structure, so the
// drawn circuit is the simulated circuit. Schema "bsx.circuit/1": { n, ops: [{ g, q: [targets], c: [controls], p: [radians], col }] },
// explicit initial state |0…0⟩, measurement into classical bit c[q] of the measured qubit, measurements terminal (checked by validateCircuit).
import { GATES, isMulti } from "./gates.js";
import { StateVector, DensityMatrix, LIMITS, IDEAL, marginal, applyReadout, bloch } from "./sim.js";

export const CIRCUIT_SCHEMA = "bsx.circuit/1";
/** @typedef {import("./sim.js").Op} Op */
/** @typedef {{ schema?: string, n: number, ops: Op[], name?: string, init?: string }} Circuit */

/** wires an op touches (targets and controls) @param {Op} op @param {number} n */
export const opQubits = (op, n) => (op.g === "barrier" && !op.q.length ? Array.from({ length: n }, (_, i) => i) : [...(op.c || []), ...op.q]);
/** wires an op occupies in the diagram column (span between its extreme qubits) @param {Op} op @param {number} n */
export function opSpan(op, n) { const qs = opQubits(op, n); const lo = Math.min(...qs), hi = Math.max(...qs); return [lo, hi]; }

/**
 * Validate a circuit: qubit range, distinct wires per gate, parameter count and finiteness, no gate after a measurement on the same
 * qubit (terminal measurements only), at most one measurement per qubit, size limits.
 * @param {Circuit} C @param {{ maxQubits?: number }} [o] @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validateCircuit(C, { maxQubits = LIMITS.svQubits } = {}) {
  const errors = [], warnings = [];
  if (!C || !Number.isInteger(C.n) || C.n < 1) return { ok: false, errors: ["Circuit needs at least one qubit."], warnings };
  if (C.n > maxQubits) errors.push(`At most ${maxQubits} qubits here (got ${C.n}): a statevector holds 2^n complex amplitudes.`);
  if (!Array.isArray(C.ops)) return { ok: false, errors: ["Circuit has no operation list."], warnings };
  if (C.ops.length > LIMITS.maxOps) errors.push(`At most ${LIMITS.maxOps} operations (got ${C.ops.length}).`);
  const measured = new Set();
  C.ops.forEach((op, i) => {
    const def = GATES[op.g], where = `operation ${i + 1} (${op.g})`;
    if (!def) { errors.push(`${where}: unknown gate.`); return; }
    const qs = opQubits(op, C.n);
    if (qs.some((q) => !Number.isInteger(q) || q < 0 || q >= C.n)) { errors.push(`${where}: qubit index out of range 0–${C.n - 1}.`); return; }
    if (new Set(qs).size !== qs.length) errors.push(`${where}: a gate cannot use the same qubit twice.`);
    if (def.kind === "1q" && (op.q.length !== 1 || (op.c && op.c.length))) errors.push(`${where}: needs exactly one target and no control.`);
    if (def.kind === "c1q" && (op.q.length !== 1 || !op.c || op.c.length !== 1)) errors.push(`${where}: needs one control and one target.`);
    if (def.kind === "swap" && op.q.length !== 2) errors.push(`${where}: needs two qubits.`);
    if (def.kind === "mcp" && qs.length < 1) errors.push(`${where}: needs at least one qubit.`);
    if (def.params.length !== (op.p || []).length) errors.push(`${where}: needs ${def.params.length} parameter(s).`);
    if ((op.p || []).some((v) => !Number.isFinite(v))) errors.push(`${where}: parameters must be finite numbers (radians).`);
    if (op.g !== "barrier") {
      const hit = qs.filter((q) => measured.has(q));
      if (hit.length) errors.push(`${where}: acts on qubit ${hit[0]} after it was measured. Only terminal measurements are supported (the simulator keeps a pure state).`);
    }
    if (op.g === "measure") { if (measured.has(op.q[0])) errors.push(`${where}: qubit ${op.q[0]} is measured twice.`); measured.add(op.q[0]); }
  });
  if (!C.ops.some((o) => o.g === "measure")) warnings.push("No measurement: the measurement laboratory has nothing to sample (exact state views still work).");
  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Circuit statistics as Qiskit reports them for the same gates: depth = critical path length where a barrier synchronises its wires but
 * adds no layer (QuantumCircuit.depth()), gate counts by name (count_ops(), barriers included), multi-qubit gate count, measurements.
 * @param {Circuit} C
 */
export function circuitStats(C) {
  const level = new Array(C.n).fill(0), counts = /** @type {Record<string, number>} */ ({}); let twoQ = 0, meas = 0, gates = 0;
  for (const op of C.ops) {
    counts[op.g] = (counts[op.g] || 0) + 1;
    const qs = opQubits(op, C.n);
    if (op.g === "barrier") { const d = Math.max(...qs.map((q) => level[q])); qs.forEach((q) => (level[q] = d)); continue; }   // synchronises, adds no layer
    const d = Math.max(...qs.map((q) => level[q])) + 1; qs.forEach((q) => (level[q] = d));
    if (op.g === "measure") meas++; else { gates++; if (isMulti(op.g)) twoQ++; }
  }
  return { qubits: C.n, clbits: C.n, depth: Math.max(0, ...level), size: gates + meas, gates, twoQubit: twoQ, measurements: meas, counts };
}

/** Assign diagram columns ASAP (ops that share or cross wires never share a column; barriers occupy all their wires). @param {Op[]} ops @param {number} n */
export function layoutColumns(ops, n) {
  const next = new Array(n).fill(0);
  return ops.map((op) => { const [lo, hi] = opSpan(op, n); let c = 0; for (let q = lo; q <= hi; q++) c = Math.max(c, next[q]); for (let q = lo; q <= hi; q++) next[q] = c + 1; return { ...op, col: c }; });
}
/** Sort ops by column then lowest wire (stable), the order in which the composer's grid is simulated. @param {Op[]} ops @param {number} n */
export function orderedOps(ops, n) { return ops.map((o, i) => [o, i]).sort((a, b) => ((/** @type {Op} */ (a[0]).col ?? 0) - (/** @type {Op} */ (b[0]).col ?? 0)) || (opSpan(/** @type {Op} */ (a[0]), n)[0] - opSpan(/** @type {Op} */ (b[0]), n)[0]) || (/** @type {number} */ (a[1]) - /** @type {number} */ (b[1]))).map((x) => /** @type {Op} */ (x[0])); }

/** Measurement map: classical bit c[q] receives qubit q. @param {Circuit} C */
export const measurements = (C) => C.ops.filter((o) => o.g === "measure").map((o) => ({ q: o.q[0], c: o.q[0] }));

/**
 * Ideal statevector simulation with snapshots after every diagram column (gate-by-gate evolution).
 * @param {Circuit} C @param {{ snapshots?: boolean }} [o]
 */
export function simulate(C, { snapshots = true } = {}) {
  const v = validateCircuit(C); if (!v.ok) throw new Error(v.errors[0]);
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now(), ops = orderedOps(C.ops, C.n), sv = new StateVector(C.n);
  /** @type {{ col: number, re: Float64Array, im: Float64Array, ops: Op[] }[]} */ const snaps = [];
  if (snapshots) snaps.push({ col: -1, re: sv.re.slice(), im: sv.im.slice(), ops: [] });
  let cur = null, curOps = /** @type {Op[]} */ ([]);
  for (const op of ops) {
    if (snapshots && cur !== null && op.col !== cur) { snaps.push({ col: /** @type {number} */ (cur), re: sv.re.slice(), im: sv.im.slice(), ops: curOps }); curOps = []; }
    sv.apply(op); cur = op.col ?? 0; curOps.push(op);
  }
  if (snapshots && curOps.length) snaps.push({ col: /** @type {number} */ (cur), re: sv.re.slice(), im: sv.im.slice(), ops: curOps });
  const ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0, probs = sv.probs(), meas = measurements(C);
  return { n: C.n, state: sv, probs, dist: marginal(probs, meas, C.n), measured: meas, snapshots: snaps, ms, method: "statevector (ideal, classical simulation)", norm: sv.norm(),
    bloch: Array.from({ length: C.n }, (_, q) => bloch(sv.reduced(q))) };
}

/**
 * Noisy simulation with the density-matrix engine: depolarizing λ1 after each one-qubit gate, λ2 (two-qubit channel) after each two-qubit
 * gate, symmetric readout error on measured bits. Multi-controlled gates must be decomposed first (expandCircuit) so noise attaches to
 * elementary gates. @param {Circuit} C @param {import("./sim.js").Noise} noise
 */
export function simulateNoisy(C, noise = IDEAL) {
  const v = validateCircuit(C, { maxQubits: LIMITS.dmQubits }); if (!v.ok) throw new Error(v.errors[0]);
  if (C.ops.some((o) => o.g === "mcz")) throw new Error("Decompose multi-controlled gates before a noisy simulation (noise is defined per elementary gate).");
  if (![noise.p1, noise.p2, noise.readout].every((x) => Number.isFinite(x) && x >= 0 && x <= 0.5)) throw new Error("Noise parameters must be between 0 and 0.5.");
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now(), dm = new DensityMatrix(C.n);
  // a SWAP is executed as three CX gates, so it receives three two-qubit error channels (as a transpiler would produce)
  const elementary = orderedOps(C.ops, C.n).flatMap((op) => (op.g === "swap" ? [{ g: "cx", c: [op.q[0]], q: [op.q[1]] }, { g: "cx", c: [op.q[1]], q: [op.q[0]] }, { g: "cx", c: [op.q[0]], q: [op.q[1]] }] : [op]));
  for (const op of elementary) {
    if (op.g === "measure" || op.g === "barrier") continue; dm.apply(op); const qs = opQubits(op, C.n);
    if (qs.length === 1) dm.depolarize(qs, noise.p1); else if (qs.length === 2) dm.depolarize(qs, noise.p2);
  }
  const probs = dm.probs(), meas = measurements(C), exact = marginal(probs, meas, C.n);
  return { n: C.n, dm, probs, distBeforeReadout: exact, dist: applyReadout(exact, noise.readout), measured: meas, noise, purity: dm.purity(), trace: dm.trace(),
    ms: (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0, method: "density matrix with depolarizing and readout noise (classical simulation)",
    bloch: Array.from({ length: C.n }, (_, q) => bloch(dm.reduced(q))) };
}

/**
 * Exact decomposition of a multi-controlled phase e^{iλ} on |1…1⟩ of the qubits qs into CX and P gates (parity network, no ancilla):
 * λ·x1⋯xm = Σ_{S≠∅} λ(−1)^{|S|+1}/2^{m−1} · parity_S(x). Unoptimised: Σ_S 2(|S|−1) CX and 2^m − 1 P gates.
 * @param {number[]} qs @param {number} lam
 */
export function mcPhaseDecomposition(qs, lam = Math.PI) {
  const m = qs.length, out = /** @type {Op[]} */ ([]);
  for (let s = 1; s < (1 << m); s++) {
    const S = qs.filter((_, j) => s & (1 << j)), sign = S.length % 2 ? 1 : -1, ang = (sign * lam) / 2 ** (m - 1), last = S[S.length - 1];
    for (let j = 0; j < S.length - 1; j++) out.push({ g: "cx", c: [S[j]], q: [last] });
    out.push({ g: "p", q: [last], p: [ang] });
    for (let j = S.length - 2; j >= 0; j--) out.push({ g: "cx", c: [S[j]], q: [last] });
  }
  return out;
}
/** Replace every MCZ by its CX/P decomposition (same unitary, tested), keeping a tag of where it came from. @param {Circuit} C */
export function expandCircuit(C) {
  const ops = []; for (const op of C.ops) { if (op.g !== "mcz") { ops.push({ ...op }); continue; }
    const qs = [...(op.c || []), ...op.q]; if (qs.length === 1) ops.push({ g: "z", q: [qs[0]], tag: op.tag }); else mcPhaseDecomposition(qs, Math.PI).forEach((o) => ops.push({ ...o, tag: op.tag })); }
  return { ...C, ops: layoutColumns(ops, C.n) };
}

const fmt = (/** @type {number} */ x) => { const v = +x.toPrecision(15); return String(v); };
/** OpenQASM 2.0 text (qelib1.inc). MCZ is written as its CX/P (cx/u1) decomposition. @param {Circuit} C */
export function toQasm2(C) {
  const v = validateCircuit(C); if (!v.ok) throw new Error(v.errors[0]);
  const ops = orderedOps(expandCircuit(C).ops, C.n), L = ["OPENQASM 2.0;", 'include "qelib1.inc";'];
  if (ops.some((o) => o.g === "swap")) L.push("gate swap a,b { cx a,b; cx b,a; cx a,b; }");   // not in the original qelib1.inc
  L.push(`qreg q[${C.n}];`, `creg c[${C.n}];`);
  for (const op of ops) {
    const def = GATES[op.g], par = op.p && op.p.length ? `(${op.p.map(fmt).join(",")})` : "";
    if (op.g === "measure") L.push(`measure q[${op.q[0]}] -> c[${op.q[0]}];`);
    else if (op.g === "barrier") L.push(`barrier ${opQubits(op, C.n).map((q) => `q[${q}]`).join(",")};`);
    else L.push(`${def.qasm}${par} ${[...(op.c || []), ...op.q].map((q) => `q[${q}]`).join(",")};`);
  }
  return L.join("\n") + "\n";
}
/** JSON export with schema tag and statistics. @param {Circuit} C */
export const toJSON = (C) => ({ schema: CIRCUIT_SCHEMA, name: C.name || "circuit", n: C.n, init: "|0…0⟩", qubitOrder: "little-endian (qubit 0 = least significant bit, as in Qiskit)",
  ops: C.ops.map((o) => ({ g: o.g, q: o.q, ...(o.c && o.c.length ? { c: o.c } : {}), ...(o.p && o.p.length ? { p: o.p } : {}), col: o.col ?? 0 })), stats: circuitStats(C) });
/** Basis-state label |q_{n-1}…q_0⟩. @param {number} i @param {number} n */
export const basisLabel = (i, n) => i.toString(2).padStart(n, "0");
