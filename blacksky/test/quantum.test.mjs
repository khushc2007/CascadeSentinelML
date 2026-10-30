// Quantum Lab engine: closed-form checks (Bell, GHZ, rotations, Bloch vectors), MCZ decomposition = diagonal MCZ, density matrix =
// statevector when noise is zero, channel properties, Grover circuit = abstract simulation = sin²((2r+1)θ), validation, QASM text.
// The comparison with Qiskit/Aer lives in tests/integration/test_blacksky_quantum.py.
import { test } from "node:test";
import assert from "node:assert/strict";
import { StateVector, DensityMatrix, bloch, marginal, applyReadout, sample, tvDistance, LIMITS } from "../site/js/q/sim.js";
import { simulate, simulateNoisy, validateCircuit, circuitStats, expandCircuit, mcPhaseDecomposition, toQasm2, layoutColumns, toJSON } from "../site/js/q/circuit.js";
import { groverTheory, runGroverCircuit, runGroverAbstract, runGroverNoisy, validateGrover, groverCircuit } from "../site/js/q/grover.js";
import { makeRng } from "../site/js/sci/rng.js";

const close = (a, b, t = 1e-12, msg = "") => assert.ok(Math.abs(a - b) <= t, `${msg} ${a} vs ${b}`);
const C = (n, ops) => ({ n, ops: layoutColumns(ops, n) });

test("Bell state: amplitudes 1/√2 on |00⟩ and |11⟩, reduced qubits maximally mixed (Bloch length 0)", () => {
  const r = simulate(C(2, [{ g: "h", q: [0] }, { g: "cx", c: [0], q: [1] }, { g: "measure", q: [0] }, { g: "measure", q: [1] }]));
  close(r.state.re[0], Math.SQRT1_2); close(r.state.re[3], Math.SQRT1_2); close(r.probs[1], 0); close(r.probs[2], 0); close(r.norm, 1);
  close(r.dist.get("00"), 0.5); close(r.dist.get("11"), 0.5); assert.equal(r.dist.size, 2);
  r.bloch.forEach((b) => close(b.r, 0, 1e-12, "entangled qubit has a mixed reduced state"));
  assert.equal(r.snapshots.length, 1 + 3);   // initial + 3 columns (h, cx, measures)
});

test("single-qubit rotations and Bloch vectors match closed forms", () => {
  const th = 0.731, ph = 1.234;
  const a = simulate(C(1, [{ g: "ry", q: [0], p: [th] }, { g: "rz", q: [0], p: [ph] }]));
  const b = a.bloch[0]; close(b.x, Math.sin(th) * Math.cos(ph), 1e-12); close(b.y, Math.sin(th) * Math.sin(ph), 1e-12); close(b.z, Math.cos(th), 1e-12); close(b.r, 1, 1e-12);
  const h = simulate(C(1, [{ g: "h", q: [0] }, { g: "s", q: [0] }])).bloch[0]; close(h.x, 0); close(h.y, 1); close(h.z, 0);
  const rx = simulate(C(1, [{ g: "rx", q: [0], p: [Math.PI] }])); close(rx.probs[1], 1); close(rx.state.im[1], -1);   // RX(π)|0⟩ = −i|1⟩
  const t = simulate(C(1, [{ g: "h", q: [0] }, { g: "t", q: [0] }, { g: "t", q: [0] }, { g: "sdg", q: [0] }])).bloch[0]; close(t.x, 1); close(t.y, 0, 1e-12);
});

test("GHZ on 5 qubits and SWAP / CP / CZ semantics", () => {
  const ops = [{ g: "h", q: [0] }, ...[1, 2, 3, 4].map((q) => ({ g: "cx", c: [q - 1], q: [q] }))];
  const r = simulate(C(5, ops)); close(r.probs[0], 0.5); close(r.probs[31], 0.5);
  const s = simulate(C(2, [{ g: "x", q: [0] }, { g: "swap", q: [0, 1] }])); close(s.probs[2], 1);
  const cp = simulate(C(2, [{ g: "x", q: [0] }, { g: "x", q: [1] }, { g: "cp", c: [0], q: [1], p: [0.7] }])); close(cp.state.re[3], Math.cos(0.7)); close(cp.state.im[3], Math.sin(0.7));
  const cz = simulate(C(2, [{ g: "h", q: [0] }, { g: "h", q: [1] }, { g: "cz", c: [0], q: [1] }])); close(cz.state.re[3], -0.5); close(cz.state.re[1], 0.5);
});

test("MCZ decomposition (CX + P parity network) equals the diagonal MCZ on random states, m = 2…6", () => {
  const rng = makeRng(7);
  for (let m = 2; m <= 6; m++) {
    const n = m, a = new StateVector(n), b = new StateVector(n);
    for (let i = 0; i < a.dim; i++) { a.re[i] = rng.normal(); a.im[i] = rng.normal(); } const nr = a.norm(); for (let i = 0; i < a.dim; i++) { a.re[i] /= nr; a.im[i] /= nr; }
    b.re.set(a.re); b.im.set(a.im);
    const qs = Array.from({ length: m }, (_, i) => i); a.apply({ g: "mcz", q: [m - 1], c: qs.slice(0, -1) }); mcPhaseDecomposition(qs, Math.PI).forEach((o) => b.apply(o));
    for (let i = 0; i < a.dim; i++) { close(a.re[i], b.re[i], 1e-12, `m=${m} re[${i}]`); close(a.im[i], b.im[i], 1e-12, `m=${m} im[${i}]`); }
    const ops = mcPhaseDecomposition(qs, Math.PI); assert.equal(ops.filter((o) => o.g === "p").length, 2 ** m - 1);
  }
});

test("density matrix with zero noise reproduces the statevector; depolarizing preserves trace and lowers purity", () => {
  const rng = makeRng(3), n = 3, ops = [];
  for (let i = 0; i < 25; i++) { const g = rng.pick(["h", "x", "ry", "rz", "cx", "cp", "s", "t"]);
    if (g === "cx" || g === "cp") { const a = rng.int(n); let b = rng.int(n); while (b === a) b = rng.int(n); ops.push({ g, c: [a], q: [b], ...(g === "cp" ? { p: [rng.next() * 6] } : {}) }); }
    else ops.push({ g, q: [rng.int(n)], ...(g === "ry" || g === "rz" ? { p: [rng.next() * 6] } : {}) }); }
  const circ = C(n, ops), sv = simulate(circ), dm = simulateNoisy(circ, { p1: 0, p2: 0, readout: 0, source: "ideal" });
  for (let i = 0; i < 8; i++) close(sv.probs[i], dm.probs[i], 1e-12); close(dm.purity, 1, 1e-12);
  sv.bloch.forEach((b, q) => { close(b.x, dm.bloch[q].x, 1e-12); close(b.z, dm.bloch[q].z, 1e-12); });
  const noisy = simulateNoisy(circ, { p1: 0.01, p2: 0.05, readout: 0.02, source: "test" });
  close(noisy.trace, 1, 1e-12); assert.ok(noisy.purity < 1 - 1e-6 && noisy.purity >= 1 / 8 - 1e-12);
  const d = new DensityMatrix(1); d.depolarize([0], 1); close(d.re[0], 0.5); close(d.re[3], 0.5);          // λ = 1 → maximally mixed
  let s = 0; for (const v of noisy.dist.values()) s += v; close(s, 1, 1e-12);
});

test("readout error, marginal and seeded sampling", () => {
  const dist = new Map([["00", 1]]), ro = applyReadout(dist, 0.1);
  close(ro.get("00"), 0.81); close(ro.get("01"), 0.09); close(ro.get("10"), 0.09); close(ro.get("11"), 0.01);
  const m = marginal([0.5, 0, 0, 0.5], [{ q: 1, c: 1 }], 2); close(m.get("10"), 0.5); close(m.get("00"), 0.5);
  const c1 = sample(new Map([["0", 0.3], ["1", 0.7]]), 20000, makeRng(42).next), c2 = sample(new Map([["0", 0.3], ["1", 0.7]]), 20000, makeRng(42).next);
  assert.deepEqual([...c1], [...c2], "same seed, same counts"); assert.ok(tvDistance(new Map([["0", 0.3], ["1", 0.7]]), c1, 20000) < 0.02);
  assert.throws(() => sample(dist, 0, Math.random)); assert.throws(() => sample(dist, LIMITS.maxShots + 1, Math.random));
});

test("validation: terminal measurements only, ranges, parameters, size limits", () => {
  assert.ok(validateCircuit(C(2, [{ g: "h", q: [0] }, { g: "measure", q: [0] }])).ok);
  assert.ok(!validateCircuit({ n: 2, ops: [{ g: "measure", q: [0], col: 0 }, { g: "x", q: [0], col: 1 }] }).ok);
  assert.ok(!validateCircuit({ n: 2, ops: [{ g: "cx", c: [0], q: [0], col: 0 }] }).ok);
  assert.ok(!validateCircuit({ n: 2, ops: [{ g: "rx", q: [0], col: 0 }] }).ok);
  assert.ok(!validateCircuit({ n: 2, ops: [{ g: "rx", q: [0], p: [NaN], col: 0 }] }).ok);
  assert.ok(!validateCircuit({ n: 2, ops: [{ g: "x", q: [2], col: 0 }] }).ok);
  assert.ok(!validateCircuit({ n: 13, ops: [] }).ok);
  assert.ok(!validateCircuit({ n: 2, ops: [{ g: "nope", q: [0], col: 0 }] }).ok);
  assert.throws(() => simulateNoisy({ n: 8, ops: [] }, { p1: 0, p2: 0, readout: 0, source: "" }));
});

test("statistics follow Qiskit conventions (barriers ignored for depth)", () => {
  const c = C(3, [{ g: "h", q: [0] }, { g: "barrier", q: [] }, { g: "cx", c: [0], q: [1] }, { g: "cx", c: [1], q: [2] }, { g: "rz", q: [0], p: [1] }, { g: "measure", q: [0] }, { g: "measure", q: [1] }, { g: "measure", q: [2] }]);
  const s = circuitStats(c); assert.equal(s.depth, 4); assert.equal(s.twoQubit, 2); assert.equal(s.measurements, 3); assert.equal(s.counts.barrier, 1); assert.equal(s.gates, 4);
  const q = toQasm2(c); assert.match(q, /^OPENQASM 2\.0;/); assert.match(q, /cx q\[0\],q\[1\];/); assert.match(q, /measure q\[2\] -> c\[2\];/); assert.match(q, /rz\(1\) q\[0\];/);
  assert.equal(toJSON(c).schema, "bsx.circuit/1");
});

test("Grover: circuit-level = abstract = sin²((2r+1)θ) for n = 2…8, several M, r up to 2r*+1 (over-rotation)", () => {
  for (const [n, marked] of [[2, [3]], [3, [5]], [4, [0, 9]], [5, [7]], [6, [1, 2, 40]], [8, [200]]]) {
    const th = groverTheory(2 ** n, marked.length);
    for (let r = 0; r <= Math.min(2 * th.rStar + 1, 6); r++) {
      const c = runGroverCircuit({ n, marked, r }), a = runGroverAbstract({ n, marked, r });
      close(c.final.pMarked, th.P(r), 1e-10, `circuit n=${n} r=${r}`); close(a.trace[r].pMarked, th.P(r), 1e-10, `abstract n=${n} r=${r}`);
      // same probabilities on every basis state (amplitudes equal up to the global phase (−1)^r of the diffusion)
      c.final.probs.forEach((p, i) => close(p, a.amps[i] ** 2, 1e-10));
    }
    if (n === 4) close(groverTheory(16, 2).rStar, 2);
  }
  const t = groverTheory(8, 1); close(t.rStar, 2); assert.ok(t.P(2) > 0.94 && t.P(4) < t.P(2), "more iterations past r* lower the success probability");
});

test("Grover noisy: zero noise equals ideal; depolarizing noise lowers the marked probability; readout lowers it further", () => {
  const ideal = runGroverNoisy({ n: 3, marked: [5], r: 2, noise: { p1: 0, p2: 0, readout: 0, source: "" } }); close(ideal.pMarked, groverTheory(8, 1).P(2), 1e-10);
  const noisy = runGroverNoisy({ n: 3, marked: [5], r: 2, noise: { p1: 0.002, p2: 0.02, readout: 0, source: "" } }); assert.ok(noisy.pMarked < ideal.pMarked - 0.01 && noisy.pMarked > 1 / 8);
  const ro = runGroverNoisy({ n: 3, marked: [5], r: 2, noise: { p1: 0.002, p2: 0.02, readout: 0.03, source: "" } }); assert.ok(ro.pMarked < noisy.pMarked); close(ro.pMarkedBeforeReadout, noisy.pMarked, 1e-12);
  assert.ok(!validateGrover({ n: 6, marked: [1], r: 1, noisy: true }).ok, "noisy runs are size-limited");
  assert.ok(!validateGrover({ n: 3, marked: [8], r: 1 }).ok); assert.ok(!validateGrover({ n: 3, marked: [1, 1], r: 1 }).ok);
  const gc = groverCircuit({ n: 3, marked: [5], r: 2 }), ex = expandCircuit(gc); assert.ok(!ex.ops.some((o) => o.g === "mcz")); assert.ok(validateCircuit(ex).ok);
});
