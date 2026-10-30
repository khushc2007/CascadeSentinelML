// APEX pure functions on the real data: fault-line counts against the stored exhaustive tables, flow surge against two engine solutions,
// landscape indexing (pair order = the enumeration order of nextCombination) and values from a recorded exhaustive search, and the Grover
// plane projection against the analytical rotation for every stage of simulated elementary-gate circuits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DCCascade } from "../site/shared/core/cascade.js";
import { faultCounts, flowSurge, branchOverlay, ramp, RAMPS } from "../site/js/sci/overlays.js";
import { pairIndex, pairAt, landscapeFromProbes, displayOrder, landscapeStats } from "../site/js/sci/landscape.js";
import { nextCombination, binom } from "../site/js/sci/combin.js";
import { runSearch } from "../site/js/sci/search.js";
import { runGroverCircuit, planeProjection, stageAngle, groverTheory } from "../site/js/q/grover.js";

const D = new URL("../site/data/", import.meta.url), J = (f) => JSON.parse(readFileSync(new URL(f, D)));

test("fault lines: counts equal a direct tally of the stored top-500 sets; overlay is monotone in the count", () => {
  for (const [g, k] of [["ieee118", 2], ["ieee118", 3], ["ieee30", 3], ["ieee14", 2]]) {
    const d = J(`dist_${g}_k${k}.json`), nB = J(`cascade_model_${g}.json`).n_branch, fc = faultCounts(d.top, nB), tally = new Array(nB).fill(0);
    for (const [, set] of d.top) for (const l of set) tally[l]++;
    assert.deepEqual(fc.counts, tally); assert.equal(fc.sets, d.top.length); assert.equal(fc.max, Math.max(...tally));
    assert.equal(fc.counts.reduce((a, b) => a + b, 0), k * d.top.length);
    const ov = branchOverlay("faults", fc), idx = [...fc.counts.keys()].filter((l) => fc.counts[l] > 0).sort((a, b) => fc.counts[a] - fc.counts[b]);
    for (let i = 1; i < idx.length; i++) assert.ok(ov.width[idx[i]] >= ov.width[idx[i - 1]] - 1e-12);
  }
  assert.equal(branchOverlay("loading", {}), null);
});

test("flow surge: zero for the intact network, equals (|f| − |f0|)/rating from two engine runs, null for removed lines", () => {
  const cm = J("cascade_model_ieee118.json"), grid = J("grid_ieee118.json"), e = new DCCascade(cm), base = e.run([]).frames[0].flow, rating = grid.branches.map((b) => b.rating_dc_mw);
  const s0 = flowSurge(base, base, rating); assert.ok(s0.every((v) => v == null || Math.abs(v) < 1e-12));
  const r = e.run([6, 67, 140]), f = r.frames[0].flow, s = flowSurge(f, base, rating);
  for (const l of [6, 67, 140]) assert.equal(s[l], null);
  for (let l = 0; l < rating.length; l++) if (s[l] != null) assert.ok(Math.abs(s[l] - (Math.abs(f[l]) - Math.abs(base[l])) / rating[l]) < 1e-12);
  assert.ok(s.some((v) => v != null && v > 0.1), "some line takes on more than 10 % of its rating");
});

test("ramps: endpoints are the first and last stops", () => {
  assert.equal(ramp(RAMPS.fault, 0), RAMPS.fault[0]); assert.equal(ramp(RAMPS.fault, 1), RAMPS.fault.at(-1)); assert.equal(ramp(RAMPS.surge, 2), RAMPS.surge.at(-1));
});

test("landscape indexing: pairIndex enumerates pairs in nextCombination order and pairAt inverts it", () => {
  for (const m of [2, 3, 7, 41]) { const c = [0, 1]; let i = 0; do { assert.equal(pairIndex(c[0], c[1], m), i); assert.equal(pairIndex(c[1], c[0], m), i); assert.deepEqual(pairAt(i, m), [c[0], c[1]]); i++; } while (nextCombination(c, m)); assert.equal(i, binom(m, 2)); }
  assert.throws(() => pairAt(binom(5, 2), 5));
  const rank = displayOrder([10, 20, 30], "loading", { 10: 0.2, 20: 0.9, 30: 0.5 }); assert.deepEqual(rank, [2, 0, 1]);
});

test("landscape from a recorded exhaustive search equals the engine pair by pair, and its maximum is the stored optimum (IEEE-30, k = 2)", async () => {
  const cm = J("cascade_model_ieee30.json"), e = new DCCascade(cm), U = [...Array(cm.n_branch).keys()].filter((l) => cm.br_status[l] > 0), m = U.length;
  const res = await runSearch("exhaustive", { engine: e, universe: U, k: 2, budget: binom(m, 2), seed: 1, probes: true });
  assert.equal(res.probeS.length, binom(m, 2)); const L = landscapeFromProbes(U, res.probes, res.probeS), st = landscapeStats(L, m);
  assert.equal(st.evaluated, binom(m, 2));
  for (let t = 0; t < 25; t++) { const i = (t * 7) % L.length, [a, b] = pairAt(i, m); assert.ok(Math.abs(L[i] - e.run([U[a], U[b]], { policy: "all_overloaded" }).metrics.S) < 1e-6); }
  assert.ok(Math.abs(st.max - J("dist_ieee30_k2.json").top[0][0]) < 1e-6);
  const r2 = await runSearch("random", { engine: e, universe: U, k: 2, budget: 50, seed: 3, probes: true }); assert.equal(r2.probes.length, 2 * r2.sims);
  const r3 = await runSearch("random", { engine: e, universe: U, k: 2, budget: 50, seed: 3 }); assert.equal(r3.probes, undefined);
});

test("Grover geometry: the simulated state stays in the good/bad plane at the analytical angle after every oracle and diffusion", () => {
  for (const [n, marked] of [[3, [5]], [4, [11]], [5, [3, 17, 30]], [6, [0, 63]], [7, [100]]]) {
    const th = groverTheory(2 ** n, marked.length), res = runGroverCircuit({ n, marked, r: th.rStar + 2 });
    for (const s of res.stages) { const ref = stageAngle(th.theta, s.label, s.iter), p = planeProjection(s.amps, s.ampsIm, marked, ref);
      let d = Math.abs(p.angle - ref); d = Math.min(d, 2 * Math.PI - d); assert.ok(d < 1e-9, `${n} ${s.label}: ${p.angle} vs ${ref}`); assert.ok(p.outOfPlane < 1e-9);
      assert.ok(Math.abs(p.good ** 2 - s.pMarked) < 1e-9); }
  }
});
