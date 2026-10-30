// BLACKSKY compute worker: every loop over many candidates or many circuit runs happens here, off the page's main thread.
// Protocol: { id, type, payload } → { id, progress } … → { id, result } | { id, error }; { type: "cancel", id } stops a job at its next
// checkpoint (the result then has status "cancelled"). Data files are read from ../../data relative to this script.
import { DCCascade } from "../../shared/core/cascade.js";
import { binom, nextCombination, canon } from "../sci/combin.js";
import { makeRng } from "../sci/rng.js";
import { prepareNetwork, featureVector, FEATURES } from "../sci/features.js";
import { runSearch, METHODS } from "../sci/search.js";
import { disjointBranchSplit, randomRowSplit, branchOverlap, fitScaler, fitForest, fitLogistic, rocAuc, averagePrecision, classification, calibration, regression, ranking, permutationImportance } from "../sci/ml.js";
import { runGroverCircuit, runGroverNoisy, groverTheory } from "../q/grover.js";

const cancelled = new Set(), nets = new Map(), models = new Map();
const tick = () => new Promise((r) => setTimeout(r, 0));
async function net(grid) {
  if (!nets.has(grid)) nets.set(grid, (async () => {
    const get = async (f) => { const r = await fetch(new URL(`../../data/${f}`, import.meta.url)); if (!r.ok) throw new Error(`data/${f} could not be loaded (${r.status})`); return r.json(); };
    const [cm, g] = await Promise.all([get(`cascade_model_${grid}.json`), get(`grid_${grid}.json`)]);
    return { cm, grid: g, engine: new DCCascade(cm), prep: prepareNetwork(cm, g) };
  })());
  return nets.get(grid);
}
const universeOf = (cm, minLoad, prep) => [...Array(cm.n_branch).keys()].filter((l) => cm.br_status[l] > 0 && (!minLoad || prep.load0[l] >= minLoad));

const JOBS = {
  // Algorithm Arena, experiment B: methods × repetitions on the real cascade objective
  async "arena.grid"(p, ctx) {
    const N0 = await net(p.grid), universe = universeOf(N0.cm, p.minLoad, N0.prep), N = binom(universe.length, p.k), runs = [];
    const plan = p.methods.flatMap((m) => (METHODS[m].randomized ? Array.from({ length: p.reps }, (_, r) => [m, p.seed + r]) : [[m, p.seed]]));
    let doneRuns = 0;
    for (const [m, seed] of plan) {
      if (ctx.stop()) break;
      try {
        const res = await runSearch(m, { engine: N0.engine, universe, k: p.k, budget: m === "exhaustive" ? N : p.budget, seed, optimum: p.optimum, prep: N0.prep, beta: p.beta, probes: p.k === 2,
          shouldStop: ctx.stop, tick, onProgress: (q) => ctx.progress({ run: doneRuns + 1, runs: plan.length, method: m, seed, done: q.done, total: q.total, best: q.best }) });
        runs.push(res);
      } catch (e) { runs.push({ method: m, seed, status: "failed", error: String(e.message || e) }); }
      doneRuns++;
    }
    return { universe: universe.length, universeList: universe, N, runs, status: ctx.stop() ? "cancelled" : "completed" };
  },
  // APEX search landscape: S for every pair of in-service branches (k = 2), in lexicographic pair order of the universe
  async "landscape.k2"(p, ctx) {
    const N0 = await net(p.grid), universe = universeOf(N0.cm, 0, N0.prep), m = universe.length, N = binom(m, 2), S = new Float32Array(N).fill(NaN), t0 = performance.now(); let i = 0, fails = 0;
    const c = [0, 1]; do { if (i % 300 === 0) { if (ctx.stop()) return { status: "cancelled" }; ctx.progress({ done: i, total: N }); await tick(); }
      try { S[i] = N0.engine.run([universe[c[0]], universe[c[1]]], { policy: "all_overloaded" }).metrics.S; } catch { fails++; } i++; } while (nextCombination(c, m));
    return { status: "completed", grid: p.grid, universe, S, failures: fails, ms: performance.now() - t0 };
  },
  // ML Risk Observatory: dataset (simulator labels), split, models, metrics, importance
  async "ml.train"(p, ctx) {
    const N0 = await net(p.grid), universe = universeOf(N0.cm, 0, N0.prep), m = universe.length, Nall = binom(m, p.k), rng = makeRng(p.seed);
    let sets = [];
    if (p.sample >= Nall) { const c = Array.from({ length: p.k }, (_, i) => i); do sets.push(c.map((i) => universe[i])); while (nextCombination(c, m)); }
    else { const seen = new Set(); while (sets.length < p.sample) { const s = new Set(); while (s.size < p.k) s.add(universe[rng.int(m)]); const c = canon([...s]), key = c.join(","); if (!seen.has(key)) { seen.add(key); sets.push(c); } } }
    const X = [], y = [], tSim0 = performance.now(); let fails = 0;
    for (let i = 0; i < sets.length; i++) {
      if (ctx.stop()) return { status: "cancelled" };
      X.push(featureVector(N0.prep, sets[i]));
      try { y.push(N0.engine.run(sets[i], { policy: "all_overloaded" }).metrics.S); } catch { y.push(NaN); fails++; }
      if (i % 200 === 0) { ctx.progress({ stage: "labelling with the simulator", done: i, total: sets.length }); await tick(); }
    }
    const simMs = performance.now() - tSim0, ok = new Set(y.map((v, i) => (Number.isFinite(v) ? i : -1)).filter((i) => i >= 0));
    const sp = p.split === "random" ? randomRowSplit(sets.length, p.testFrac, p.seed) : disjointBranchSplit(sets, N0.cm.n_branch, p.testFrac, p.seed);
    const tr = sp.train.filter((i) => ok.has(i)), te = sp.test.filter((i) => ok.has(i));
    if (tr.length < 20 || te.length < 10) throw new Error(`Too few examples after the split (train ${tr.length}, test ${te.length}). Use more candidates or a different test fraction.`);
    ctx.progress({ stage: "training", done: 0, total: 1 }); await tick();
    const t0 = performance.now(), sc = fitScaler(X, tr), Xi = X.map(sc.impute), Z = X.map(sc.z), yb = y.map((v) => (v >= p.tau - 1e-12 ? 1 : 0));
    const F = fitForest(tr.map((i) => Xi[i]), tr.map((i) => y[i]), p.tau, { trees: p.trees, maxDepth: p.depth, seed: p.seed });
    const pos = tr.filter((i) => yb[i]).length, LR = pos && pos < tr.length ? fitLogistic(tr.map((i) => Z[i]), tr.map((i) => yb[i]), { C: p.C }) : null;
    const trainMs = performance.now() - t0;
    const pred = X.map((x, i) => { const q = F.predict(Xi[i]); return { mean: q.mean, sd: q.sd, pSevere: q.pSevere, pLR: LR ? LR.predict(Z[i]) : null }; });
    const evalOn = (rows) => { const ys = rows.map((i) => y[i]), yh = rows.map((i) => pred[i].mean), yc = rows.map((i) => yb[i]), pf = rows.map((i) => pred[i].pSevere), pl = LR ? rows.map((i) => /** @type {number} */ (pred[i].pLR)) : null, base = rows.map((i) => X[i][3]);
      const kk = Math.max(5, Math.min(50, Math.round(rows.length * 0.05)));
      return { n: rows.length, positives: yc.reduce((a, b) => a + b, 0), regression: regression(ys, yh), rankingForest: ranking(ys, yh, kk),
        rankingBaseline: ranking(ys, base.map((v) => (Number.isFinite(v) ? v : sc.med[3])), kk),
        forest: { auc: rocAuc(yc, pf), ap: averagePrecision(yc, pf), cls: classification(yc, pf, 0.5), cal: calibration(yc, pf, 10) },
        logistic: pl ? { auc: rocAuc(yc, pl), ap: averagePrecision(yc, pl), cls: classification(yc, pl, 0.5), cal: calibration(yc, pl, 10) } : null,
        baseline: { auc: rocAuc(yc, base.map((v) => (Number.isFinite(v) ? v : sc.med[3]))), ap: averagePrecision(yc, base.map((v) => (Number.isFinite(v) ? v : sc.med[3]))) } }; };
    ctx.progress({ stage: "permutation importance", done: 0, total: 1 }); await tick();
    const pimp = permutationImportance((rows) => { const r = regression(te.map((i) => y[i]), rows.map((x) => F.predict(x).mean)); return r.r2 ?? 0; }, te.map((i) => Xi[i]), 4, p.seed);
    const modelId = `MDL-${p.grid}-k${p.k}-s${p.seed}-${Date.now().toString(36)}`; models.clear(); models.set(modelId, { F, LR, sc, grid: p.grid, k: p.k, tau: p.tau });
    return { status: "completed", modelId, sets, X, y, pred, split: { ...sp, train: tr, test: te, overlap: branchOverlap(sets, tr, te).length }, failures: fails, simMs, trainMs, Nall,
      metrics: { train: evalOn(tr), test: evalOn(te) }, importance: { impurity: F.importance, permutation: pimp },
      logistic: LR ? { coef: LR.coef, intercept: LR.intercept } : null, scaler: { med: sc.med, mu: sc.mu, sd: sc.sd, lo: sc.lo, hi: sc.hi }, features: FEATURES.map((f) => f.key),
      contributions: te.slice(0, 4000).map((i) => [i, F.contributions(Xi[i])]) };
  },
  // predictions of the model held in this worker for arbitrary candidate sets (features computed here; no simulation)
  async "ml.predict"(p) {
    const M = models.get(p.modelId); if (!M) throw new Error("The trained model is no longer in memory (the worker was restarted). Train it again.");
    const N0 = await net(M.grid);
    return { status: "completed", items: p.sets.map((set) => { const x = featureVector(N0.prep, set), xi = M.sc.impute(x), q = M.F.predict(xi);
      return { set, x, pred: q, pLR: M.LR ? M.LR.predict(M.sc.z(x)) : null, contrib: M.F.contributions(xi), lrContrib: M.LR ? M.LR.contributions(M.sc.z(x)) : null }; }) };
  },
  // Active learning: surrogate-guided vs random search with the same budget and seeds
  async "ml.active"(p, ctx) {
    const N0 = await net(p.grid), universe = universeOf(N0.cm, 0, N0.prep), out = {};
    for (const m of ["surrogate", "random"]) {
      out[m] = [];
      for (let r = 0; r < p.reps; r++) { if (ctx.stop()) return { status: "cancelled" };
        out[m].push(await runSearch(m, { engine: N0.engine, universe, k: p.k, budget: p.budget, seed: p.seed + r, optimum: p.optimum, prep: N0.prep, beta: p.beta, shouldStop: ctx.stop, tick,
          onProgress: (q) => ctx.progress({ method: m, rep: r + 1, reps: p.reps, done: q.done, total: q.total }) })); }
    }
    return { status: "completed", ...out };
  },
  // Quantum: Grover sweep over iterations (circuit level) and optional noisy run
  async "quantum.grover"(p, ctx) {
    const th = groverTheory(2 ** p.n, p.marked.length), rMax = Math.min(Math.max(2 * th.rStar + 2, p.r), 40);
    ctx.progress({ done: 0, total: 2 }); await tick();
    const t0 = performance.now(), main = runGroverCircuit({ n: p.n, marked: p.marked, r: p.r }), mainMs = performance.now() - t0;
    if (ctx.stop()) return { status: "cancelled" }; ctx.progress({ done: 1, total: 2 }); await tick();
    // one circuit-level pass to rMax iterations; the marked probability after each diffusion step is P(r)
    const long = runGroverCircuit({ n: p.n, marked: p.marked, r: rMax });
    const sweep = long.stages.filter((s) => s.label === "uniform superposition" || s.label.startsWith("diffusion")).map((s) => ({ r: s.iter, pMarked: s.pMarked, theory: th.P(s.iter) }));
    let noisy = null; if (p.noise) { const tn = performance.now(); const nr = runGroverNoisy({ n: p.n, marked: p.marked, r: p.r, noise: p.noise }); noisy = { pMarked: nr.pMarked, pMarkedBeforeReadout: nr.pMarkedBeforeReadout, dist: [...nr.dist], purity: nr.purity, ms: performance.now() - tn, stats: nr.stats }; }
    return { status: "completed", main: { stages: main.stages, ms: mainMs, statsAbstract: main.statsAbstract, statsCompiled: main.statsCompiled, circuit: main.circuit }, sweep, rMax, noisy, theory: { theta: th.theta, rStar: th.rStar, pMax: th.pMax } };
  },
  // Algorithm Arena, experiment A: classical query distributions vs Grover on the same toy problem
  async "arena.toy"(p, ctx) {
    const N = 2 ** p.n, M = p.marked.length, th = groverTheory(N, M), rng = makeRng(p.seed), mk = new Set(p.marked), rand = [], seq = [];
    for (let r = 0; r < p.reps; r++) {                                    // classical random search without replacement: queries until the first marked item
      const order = rng.shuffle([...Array(N).keys()]); rand.push(order.findIndex((i) => mk.has(i)) + 1);
      seq.push([...Array(N).keys()].findIndex((i) => mk.has(i)) + 1);     // deterministic scan in index order (same every repetition)
      if (r % 500 === 0) { if (ctx.stop()) return { status: "cancelled" }; await tick(); }
    }
    const t0 = performance.now(), g = runGroverCircuit({ n: p.n, marked: p.marked, r: th.rStar }), simMs = performance.now() - t0;
    // Grover as a randomized algorithm: repeat (r* oracle calls + 1 classical check) until a marked state is measured; shots are sampled from the exact distribution
    const P = g.final.pMarked, gq = [];
    for (let r = 0; r < p.reps; r++) { let q = 0, tries = 0; for (;;) { tries++; q += th.rStar + 1; if (rng.next() < P || tries > 1000) break; } gq.push(q); }
    return { status: "completed", N, M, rStar: th.rStar, pExact: P, pTheory: th.P(th.rStar), classicalExpected: (N + 1) / (M + 1), randomQueries: rand, scanQueries: seq, groverQueries: gq, simMs, stats: g.statsCompiled };
  },
};

self.onmessage = async (e) => {
  const { id, type, payload } = e.data || {};
  if (type === "cancel") { cancelled.add(id); return; }
  const job = JOBS[type]; if (!job) { self.postMessage({ id, error: `unknown job type ${type}` }); return; }
  const ctx = { stop: () => cancelled.has(id), progress: (q) => self.postMessage({ id, progress: q }) };
  try { const result = await job(payload, ctx); self.postMessage({ id, result }); }
  catch (err) { self.postMessage({ id, error: String((err && err.message) || err) }); }
  finally { cancelled.delete(id); }
};
