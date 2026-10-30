// BLACKSKY scientific cores on the real network data: combinatorics and k validation, seeded RNG, statistics, PTDF/GLODF features
// against the cascade engine's own first-round flows, splits without leakage, model determinism and attribution identities, and the
// Arena search methods (budgets, counters, determinism, exhaustive optimum = stored exhaustive table).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DCCascade } from "../site/shared/core/cascade.js";
import { binom, binomBig, validateK, rankCombination, unrankCombination, nextCombination, candidateId, parseCandidateId, groupDigits } from "../site/js/sci/combin.js";
import { makeRng } from "../site/js/sci/rng.js";
import { quantile, summary, bootstrapMeanCI, wilson, sd } from "../site/js/sci/stats.js";
import { prepareNetwork, postOutageFlows, featureVector, FEATURES } from "../site/js/sci/features.js";
import { disjointBranchSplit, randomRowSplit, branchOverlap, fitScaler, fitForest, fitLogistic, rocAuc, averagePrecision, ranking, regression, classification, calibration } from "../site/js/sci/ml.js";
import { runSearch, METHODS } from "../site/js/sci/search.js";

const D = new URL("../site/data/", import.meta.url), J = (f) => JSON.parse(readFileSync(new URL(f, D)));
const NET = Object.fromEntries(["ieee14", "ieee30", "ieee118"].map((g) => { const cm = J(`cascade_model_${g}.json`), grid = J(`grid_${g}.json`); return [g, { cm, grid, engine: new DCCascade(cm), prep: prepareNetwork(cm, grid) }]; }));
const close = (a, b, t, m = "") => assert.ok(Math.abs(a - b) <= t, `${m} ${a} vs ${b}`);

test("combinatorics: C(186,3) = 1,055,240, rank/unrank round trip, k validation edge cases", () => {
  assert.equal(binom(186, 3), 1055240); assert.equal(binomBig(186, 8), 30500612508015n); assert.equal(groupDigits(binomBig(186, 3)), "1,055,240");
  for (const [m, k] of [[7, 3], [20, 2], [10, 5]]) { const c = Array.from({ length: k }, (_, i) => i); let r = 0; do { assert.equal(rankCombination(c, m), r); assert.deepEqual(unrankCombination(r, m, k), c); r++; } while (nextCombination(c, m)); assert.equal(r, binom(m, k)); }
  assert.equal(validateK("3", 186).ok, true); assert.equal(validateK("3", 186).N, 1055240n);
  assert.equal(validateK("2.5", 186).ok, false); assert.equal(validateK("-1", 186).ok, false); assert.equal(validateK("187", 186).ok, false); assert.equal(validateK("", 186).ok, false); assert.equal(validateK("abc", 186).ok, false);
  assert.equal(validateK("0", 186).ok, true); assert.equal(validateK("0", 186).N, 1n); assert.ok(validateK(0, 186).note);
  assert.equal(candidateId("ieee118", [140, 6, 67]), "CND:ieee118:6-67-140"); assert.deepEqual(parseCandidateId("CND:ieee118:6-67-140"), { grid: "ieee118", set: [6, 67, 140] });
});

test("seeded RNG is reproducible and statistics follow their definitions", () => {
  const a = makeRng(99), b = makeRng(99); for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
  assert.notEqual(makeRng(1).next(), makeRng(2).next());
  const r = makeRng(5), cnt = new Array(6).fill(0); for (let i = 0; i < 60000; i++) cnt[r.int(6)]++; cnt.forEach((c) => close(c / 60000, 1 / 6, 0.01));
  close(quantile([1, 2, 3, 4], 0.25), 1.75, 1e-12); close(quantile([5, 1, 3], 0.5), 3, 1e-12); close(sd([2, 4, 4, 4, 5, 5, 7, 9]), 2.138089935299395, 1e-12);
  assert.equal(bootstrapMeanCI([1, 2, 3, 4]), null, "no interval from fewer than 5 runs");
  const ci = bootstrapMeanCI([1, 2, 3, 4, 5, 6, 7, 8], { seed: 3 }); assert.ok(ci.lo < 4.5 && ci.hi > 4.5); assert.deepEqual(bootstrapMeanCI([1, 2, 3, 4, 5, 6, 7, 8], { seed: 3 }), ci);
  const w = wilson(8, 10); close(w.lo, 0.4901624, 1e-6); close(w.hi, 0.9433178, 1e-6); assert.equal(wilson(0, 0), null);
  assert.equal(summary([]).n, 0); assert.equal(summary([3]).sd, null);
});

test("features: PTDF base flows equal the engine's base-case flows; GLODF post-outage flows equal the engine's first-round flows", () => {
  for (const g of ["ieee14", "ieee30", "ieee118"]) {
    const { engine, prep, cm } = NET[g], base = engine.run([], {}).frames[0];
    for (let l = 0; l < cm.n_branch; l++) if (cm.br_status[l]) close(prep.f0[l], base.flow[l], 1e-6, `${g} base flow ${l}`);
    const rng = makeRng(17); let checked = 0, islanding = 0;
    for (let t = 0; t < 60; t++) {
      const k = 2 + rng.int(2), s = new Set(); while (s.size < k) s.add(rng.int(cm.n_branch)); const O = [...s].sort((a, b) => a - b);
      const f1 = engine.run(O, { maxRounds: 1 }).frames[0], post = postOutageFlows(prep, O), fv = featureVector(prep, O);
      assert.equal(fv.length, FEATURES.length);
      if (f1.islands > 1) { islanding++; assert.equal(post, null); assert.equal(fv[5], 1); assert.ok(Number.isNaN(fv[3])); continue; }
      assert.equal(fv[5], 0); checked++;
      for (let l = 0; l < cm.n_branch; l++) if (cm.br_status[l] && !O.includes(l)) close(post[l], f1.flow[l], 1e-6, `${g} ${O} flow ${l}`);
      const umax = Math.max(...Object.entries(f1.loading).map(([, u]) => u)); close(fv[3], umax, 1e-7, "post_load_max = first-round max loading");
      assert.equal(fv[4], f1.overloaded.length, "post_n_over = first-round overload count");
    }
    assert.ok(checked > 20, `${g}: ${checked} non-islanding sets checked, ${islanding} islanding`);
  }
});

test("splits: the disjoint-branch split shares no branch between training and test; the random split does", () => {
  const sets = []; for (let i = 0; i < 41; i++) for (let j = i + 1; j < 41; j++) sets.push([i, j]);
  const s = disjointBranchSplit(sets, 41, 0.3, 4); assert.equal(branchOverlap(sets, s.train, s.test).length, 0); assert.equal(s.train.length + s.test.length + s.excluded.length, sets.length);
  assert.ok(s.test.length > 10 && s.train.length > 100);
  const r = randomRowSplit(sets.length, 0.3, 4); assert.ok(branchOverlap(sets, r.train, r.test).length > 30); assert.deepEqual(disjointBranchSplit(sets, 41, 0.3, 4), s);
});

test("models: logistic fit decreases loss and is deterministic; forest is seeded, attributions sum to the prediction", () => {
  const { prep, engine, cm } = NET.ieee30, sets = []; for (let i = 0; i < cm.n_branch; i++) for (let j = i + 1; j < cm.n_branch; j++) sets.push([i, j]);
  const X = sets.map((s) => featureVector(prep, s)), y = sets.map((s) => engine.run(s, {}).metrics.S), yb = y.map((v) => (v >= 0.05 ? 1 : 0));
  const sp = disjointBranchSplit(sets, cm.n_branch, 0.3, 11), sc = fitScaler(X, sp.train), Z = X.map(sc.z);
  const lr = fitLogistic(sp.train.map((i) => Z[i]), sp.train.map((i) => yb[i]), { C: 1 }), lr2 = fitLogistic(sp.train.map((i) => Z[i]), sp.train.map((i) => yb[i]), { C: 1 });
  assert.deepEqual(lr.coef, lr2.coef);
  const auc = rocAuc(sp.test.map((i) => yb[i]), sp.test.map((i) => lr.predict(Z[i]))); assert.ok(auc === null || (auc >= 0 && auc <= 1));
  const Xi = X.map(sc.impute), F = fitForest(sp.train.map((i) => Xi[i]), sp.train.map((i) => y[i]), 0.05, { trees: 20, seed: 3 }), F2 = fitForest(sp.train.map((i) => Xi[i]), sp.train.map((i) => y[i]), 0.05, { trees: 20, seed: 3 });
  for (const i of sp.test.slice(0, 20)) { const a = F.predict(Xi[i]), b = F2.predict(Xi[i]); assert.equal(a.mean, b.mean); const c = F.contributions(Xi[i]); close(c.bias + c.contrib.reduce((u, v) => u + v, 0), a.mean, 1e-12, "Saabas identity"); }
  close(F.importance.reduce((a, b) => a + b, 0), 1, 1e-9);
  const reg = regression(sp.test.map((i) => y[i]), sp.test.map((i) => F.predict(Xi[i]).mean)); assert.ok(reg.mae >= 0 && reg.rmse >= reg.mae);
});

test("metrics on hand-checked cases", () => {
  close(rocAuc([0, 0, 1, 1], [0.1, 0.4, 0.35, 0.8]), 0.75, 1e-12); assert.equal(rocAuc([1, 1], [0.2, 0.3]), null);
  close(averagePrecision([0, 0, 1, 1], [0.1, 0.4, 0.35, 0.8]), 0.8333333333333333, 1e-12);
  const c = classification([1, 0, 1, 0], [0.9, 0.6, 0.4, 0.1]); assert.deepEqual([c.tp, c.fp, c.tn, c.fn], [1, 1, 1, 1]); close(c.f1, 0.5, 1e-12);
  const cal = calibration([1, 0], [1, 0]); assert.equal(cal.brier, 0); assert.equal(cal.ece, 0);
  const rk = ranking([0.5, 0.1, 0.3, 0.0], [0.9, 0.2, 0.1, 0.0], 2); assert.equal(rk.precisionAtK, 0.5); close(rk.ndcgAtK, (0.5 + 0.1 / Math.log2(3)) / (0.5 + 0.3 / Math.log2(3)), 1e-12);
});

test("search: exhaustive finds the stored-table optimum; budgets, counters and seeds behave; quantum grid search is reported as not implemented", async () => {
  const { engine, prep, cm } = NET.ieee14, universe = [...Array(cm.n_branch).keys()].filter((l) => cm.br_status[l]), idx = J("index.json");
  const opt = idx.grids.find((g) => g.id === "ieee14").k["2"].Smax_dc;
  const ex = await runSearch("exhaustive", { engine, universe, k: 2, budget: 1e9, seed: 0, optimum: opt, prep });
  close(ex.best.S, opt, 1e-12, "exhaustive optimum = stored exhaustive table"); assert.equal(ex.sims, 190); assert.equal(ex.found, true); assert.equal(ex.coverage, 1);
  for (const m of ["random", "ga", "sa", "loading", "surrogate"]) {
    const a = await runSearch(m, { engine, universe, k: 2, budget: 60, seed: 5, optimum: opt, prep }), b = await runSearch(m, { engine, universe, k: 2, budget: 60, seed: 5, optimum: opt, prep });
    assert.ok(a.sims <= 60 && a.proposals >= a.sims, `${m} counters`); assert.equal(a.best.S, b.best.S, `${m} deterministic`); assert.deepEqual(a.trace.map((t) => t[1]), b.trace.map((t) => t[1]));
    assert.ok(a.best.S <= opt + 1e-12, `${m} cannot beat the exhaustive optimum`); assert.equal(a.gap, Math.max(0, opt - a.best.S));
    for (let i = 1; i < a.trace.length; i++) assert.ok(a.trace[i][1] >= a.trace[i - 1][1], "best-so-far is monotone");
  }
  const g = await runSearch("grover_grid", { engine, universe, k: 2, budget: 10, seed: 0 }); assert.equal(g.status, "not_implemented"); assert.ok(METHODS.grover_grid.note.includes("not implemented"));
  await assert.rejects(() => runSearch("exhaustive", { engine: NET.ieee118.engine, universe: [...Array(186).keys()], k: 3, budget: 1e9, seed: 0 }), /cap/);
});
