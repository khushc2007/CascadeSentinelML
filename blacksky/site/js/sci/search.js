// @ts-check
// Algorithm Arena search methods on one common problem definition:
//   candidate  = an unordered set of k distinct branches drawn from the candidate universe (in-service branches, optionally filtered),
//   objective  = S, the fraction of base demand unserved at termination of the DC cascade (browser engine, all-overloaded policy),
//   budget     = number of unique simulator evaluations (cached repeats are counted as proposals, not as evaluations).
// Every method is deterministic given its seed. Methods report what they measured; the optimum is only called an optimum when an
// exhaustive enumeration (stored table or in-browser) supports it.
import { makeRng } from "./rng.js";
import { binom, nextCombination, canon, unrankCombination } from "./combin.js";
import { featureVector } from "./features.js";
import { fitScaler, fitForest } from "./ml.js";

export const SEARCH_SCHEMA = "bsx.search/1";
export const BROWSER_EXHAUSTIVE_CAP = 250000;
/** @type {Record<string, { label: string, kind: string, randomized: boolean, note: string }>} */
export const METHODS = {
  exhaustive: { label: "Exhaustive enumeration", kind: "classical", randomized: false, note: "Every candidate in lexicographic order; certifies the optimum when it completes." },
  random: { label: "Random sampling", kind: "classical", randomized: true, note: "Uniform k-sets without repetition." },
  ga: { label: "Genetic algorithm", kind: "classical heuristic", randomized: true, note: "Population 24, tournament 3, union crossover, single-branch mutation, 2 elites." },
  sa: { label: "Simulated annealing", kind: "classical heuristic", randomized: true, note: "Swap-one-branch moves, geometric cooling 0.05 → 1e-4 over the budget." },
  loading: { label: "Loading-ranked enumeration", kind: "structural heuristic", randomized: false, note: "Branches ranked by base-case loading; k-sets of the top branches enumerated in rank order." },
  surrogate: { label: "ML-guided (surrogate)", kind: "ML-guided", randomized: true, note: "Random-forest surrogate on simulator labels; batches chosen by mean + β·spread (UCB) from an unevaluated pool." },
  grover_grid: { label: "Grover search on the grid objective", kind: "quantum", randomized: false, note: "Proposed / not implemented: no quantum oracle for the cascade objective exists here." },
};

/**
 * Objective with a cache and honest counters.
 * @param {{ run: (o: number[], c: any) => any }} engine DCCascade @param {string} policy
 */
export function makeObjective(engine, policy = "all_overloaded") {
  const cache = new Map(); const st = { proposals: 0, sims: 0, cacheHits: 0, failures: 0, simMs: 0 };
  /** @param {number[]} set */
  const evaluate = (set) => {
    const c = canon(set), key = c.join(","); st.proposals++;
    if (cache.has(key)) { st.cacheHits++; return { S: cache.get(key), cached: true, set: c }; }
    const t0 = performance.now(); let S;
    try { S = engine.run(c, { policy }).metrics.S; } catch (e) { st.failures++; S = null; }
    st.simMs += performance.now() - t0; st.sims++; cache.set(key, S); return { S, cached: false, set: c };
  };
  return { evaluate, stats: st, cache };
}

/**
 * Run one method. @param {string} method
 * @param {{ engine: any, universe: number[], k: number, budget: number, seed: number, optimum?: number|null, prep?: any, policy?: string,
 *   onProgress?: (p: { done: number, total: number, best: number }) => void, shouldStop?: () => boolean, tick?: () => Promise<void>, beta?: number, probes?: boolean }} cfg
 */
export async function runSearch(method, cfg) {
  const { engine, universe, k, seed, optimum = null, policy = "all_overloaded" } = cfg, m = universe.length, N = binom(m, k);
  if (!METHODS[method]) throw new Error(`unknown method ${method}`);
  if (method === "grover_grid") return { method, status: "not_implemented", note: METHODS.grover_grid.note };
  if (!(k >= 1 && k <= m)) throw new Error(`k must be in 1–${m}`);
  const budget = Math.min(cfg.budget, N), obj = makeObjective(engine, policy), rng = makeRng(seed), t0 = performance.now();
  const trace = [[0, 0, 0]], top = new Map(); let best = { S: -1, set: /** @type {number[]} */ ([]) }, hitAt = null, firstAt = null, lastTick = performance.now(), stopped = false;
  /** @type {number[]} */ const probes = [], probeS = [];                // evaluation order (APEX landscape replay), only when cfg.probes
  const record = (/** @type {{ S: number|null, cached: boolean, set: number[] }} */ r) => {
    if (r.cached || r.S == null) return;
    if (cfg.probes) { for (const l of r.set) probes.push(l); probeS.push(r.S); }
    top.set(r.set.join(","), r.S); if (top.size > 400) { const keep = [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 200); top.clear(); keep.forEach(([a, b]) => top.set(a, b)); }
    if (r.S > best.S + 1e-15) { best = { S: r.S, set: r.set }; trace.push([obj.stats.sims, r.S, performance.now() - t0]); if (firstAt == null && r.S > 0) firstAt = obj.stats.sims; }
    if (optimum != null && hitAt == null && r.S >= optimum - 1e-9) hitAt = obj.stats.sims;
  };
  const done = () => obj.stats.sims >= budget || stopped;
  const step = async () => { if (cfg.shouldStop && cfg.shouldStop()) stopped = true; if (performance.now() - lastTick > 40) { lastTick = performance.now(); cfg.onProgress && cfg.onProgress({ done: obj.stats.sims, total: budget, best: best.S }); if (cfg.tick) await cfg.tick(); } };
  const pick = (/** @type {number[]} */ pos) => pos.map((i) => universe[i]);
  const randomSet = () => { const s = new Set(); while (s.size < k) s.add(rng.int(m)); return pick([...s]); };

  if (method === "exhaustive") {
    if (N > BROWSER_EXHAUSTIVE_CAP) throw new Error(`Exhaustive enumeration of ${N.toLocaleString("en-US")} candidates exceeds the in-browser cap of ${BROWSER_EXHAUSTIVE_CAP.toLocaleString("en-US")}.`);
    const c = Array.from({ length: k }, (_, i) => i); do { record(obj.evaluate(pick(c))); await step(); } while (!done() && nextCombination(c, m));
  } else if (method === "random") {
    if (budget > N / 3) { const order = rng.shuffle([...Array(N).keys()]); for (const r of order) { record(obj.evaluate(pick(unrankCombination(r, m, k)))); await step(); if (done()) break; } }
    else while (!done()) { const r = obj.evaluate(randomSet()); if (!r.cached) record(r); await step(); if (obj.stats.proposals > 50 * budget) break; }
  } else if (method === "loading") {
    const order = [...universe.keys()].sort((a, b) => (cfg.prep ? cfg.prep.load0[universe[b]] - cfg.prep.load0[universe[a]] : 0) || a - b);
    let L = k; while (L < m && binom(L, k) < budget) L++;
    const c = Array.from({ length: k }, (_, i) => i); do { record(obj.evaluate(c.map((i) => universe[order[i]]))); await step(); } while (!done() && nextCombination(c, L));
  } else if (method === "ga") {
    const P = 24, evalSet = (/** @type {number[]} */ s) => { const r = obj.evaluate(s); record(r); return { set: r.set, S: r.S ?? 0 }; };
    let pop = Array.from({ length: P }, () => evalSet(randomSet()));
    while (!done()) {
      pop.sort((a, b) => b.S - a.S); const next = pop.slice(0, 2);
      const tour = () => { let b = pop[rng.int(P)]; for (let t = 0; t < 2; t++) { const c = pop[rng.int(P)]; if (c.S > b.S) b = c; } return b; };
      while (next.length < P && !done()) {
        const a = tour(), b = tour(); let child = rng.next() < 0.9 ? rng.shuffle([...new Set([...a.set, ...b.set])]).slice(0, k) : [...a.set];
        child = child.map((l) => (rng.next() < 1 / k ? universe[rng.int(m)] : l)); const cs = new Set(child); while (cs.size < k) cs.add(universe[rng.int(m)]);
        next.push(evalSet([...cs])); await step(); if (obj.stats.proposals > 50 * budget) { stopped = true; break; }
      }
      pop = next.length === P ? next : pop;
    }
  } else if (method === "sa") {
    let cur = randomSet(), curS = obj.evaluate(cur).S ?? 0; record({ S: curS, cached: false, set: canon(cur) }); const T0 = 0.05, T1 = 1e-4;
    while (!done()) {
      const T = T0 * (T1 / T0) ** (obj.stats.sims / budget), nb = cur.slice(); let add; do add = universe[rng.int(m)]; while (nb.includes(add)); nb[rng.int(k)] = add;
      const r = obj.evaluate(nb); record(r); const S = r.S ?? 0;
      if (S >= curS || rng.next() < Math.exp((S - curS) / T)) { cur = nb; curS = S; }
      await step(); if (obj.stats.proposals > 50 * budget) break;
    }
  } else if (method === "surrogate") {
    if (!cfg.prep) throw new Error("ML-guided search needs the network feature model");
    const beta = cfg.beta ?? 1.0, pool = []; const seen = new Set();
    if (N <= 60000) { const c = Array.from({ length: k }, (_, i) => i); do pool.push(pick(c)); while (nextCombination(c, m)); }
    else { while (pool.length < 30000) { const s = canon(randomSet()), key = s.join(","); if (!seen.has(key)) { seen.add(key); pool.push(s); } } }
    const feats = pool.map((s) => featureVector(cfg.prep, s)), evaluated = new Set(), Xtr = [], ytr = [];
    const n0 = Math.min(budget, Math.max(20, Math.round(0.1 * budget))), batch = Math.max(5, Math.round(budget / 10));
    const take = (/** @type {number} */ i) => { evaluated.add(i); const r = obj.evaluate(pool[i]); record(r); Xtr.push(feats[i]); ytr.push(r.S ?? 0); };
    for (const i of rng.shuffle([...pool.keys()]).slice(0, n0)) { take(i); await step(); }
    let round = 0;
    while (!done() && evaluated.size < pool.length) {
      const sc = fitScaler(Xtr, [...Xtr.keys()]), F = fitForest(Xtr.map(sc.impute), ytr, 0.2, { trees: 30, maxDepth: 8, seed: seed * 31 + round++ });
      const cand = []; for (let i = 0; i < pool.length; i++) if (!evaluated.has(i)) { const p = F.predict(sc.impute(feats[i])); cand.push([i, p.mean + beta * p.sd]); }
      cand.sort((a, b) => b[1] - a[1] || a[0] - b[0]); for (const [i] of cand.slice(0, Math.min(batch, budget - obj.stats.sims))) { take(i); await step(); if (done()) break; }
    }
  }
  const ms = performance.now() - t0; trace.push([obj.stats.sims, Math.max(best.S, 0), ms]);
  const topList = [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([key, S]) => ({ set: key.split(",").map(Number), S }));
  return { method, status: stopped ? "stopped" : "completed", seed, k, m, N, budget, best, top: topList, trace, ms, ...obj.stats, hitAt, firstNonzeroAt: firstAt,
    ...(cfg.probes ? { probes, probeS } : {}),
    found: optimum != null ? best.S >= optimum - 1e-9 : null, gap: optimum != null ? Math.max(0, optimum - best.S) : null, coverage: obj.stats.sims / N };
}
