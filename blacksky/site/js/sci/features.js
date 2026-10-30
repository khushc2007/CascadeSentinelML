// @ts-check
// Candidate features for the ML Risk Observatory and the ML-guided search. Every feature is computed from the base case and the topology
// only (no cascade simulation), so it is cheaper than the label it helps to predict. Schema "bsx.features/1" (FEATURES below documents
// each one). Post-outage flows use the DC PTDF and the generalised line-outage distribution factors (GLODF) with fixed injections; when
// the outage set does not split the network this equals the simulator's first-round DC flow (tested in blacksky/test/ml.test.mjs).
import { components } from "../../shared/core/cascade.js";

export const FEATURE_SCHEMA = "bsx.features/1";
/** @type {{ key: string, label: string, unit: string, def: string }[]} */
export const FEATURES = [
  { key: "base_load_max", label: "Max base loading", unit: "fraction of rating", def: "max over the outaged branches of |base-case DC flow| / synthetic DC rating" },
  { key: "base_load_sum", label: "Sum base loading", unit: "fraction of rating", def: "sum of base-case loadings of the outaged branches" },
  { key: "base_flow_mw", label: "Interrupted flow", unit: "MW", def: "sum of |base-case DC flow| on the outaged branches" },
  { key: "post_load_max", label: "Max post-outage loading", unit: "fraction of rating", def: "max loading of any surviving branch after removing the set (PTDF/GLODF, fixed injections); median-imputed when the set splits the network" },
  { key: "post_n_over", label: "Post-outage overloads", unit: "branches", def: "surviving branches above 100 % after removing the set (same linear estimate); 0 when the set splits the network" },
  { key: "islanding", label: "Splits the network", unit: "0/1", def: "1 if removing the set disconnects the branch graph" },
  { key: "isolated_load", label: "Load without generation", unit: "fraction of demand", def: "demand in components that have no in-service generator after removing the set (before any balancing)" },
  { key: "btw_max", label: "Max edge betweenness", unit: "normalised", def: "max unweighted edge betweenness centrality (Brandes) of the outaged branches in the base graph" },
  { key: "deg_min", label: "Min endpoint degree", unit: "branches", def: "smallest number of in-service branches at any endpoint bus of the set" },
  { key: "adjacent", label: "Shared buses", unit: "fraction of pairs", def: "fraction of branch pairs in the set that share an endpoint bus" },
  { key: "hop_mean", label: "Mean separation", unit: "hops", def: "mean over branch pairs of the shortest bus-to-bus hop distance between their endpoints" },
  { key: "end_load_mw", label: "Endpoint demand", unit: "MW", def: "total demand at the endpoint buses of the set" },
  { key: "end_gen_mw", label: "Endpoint generation", unit: "MW Pmax", def: "total generator Pmax at the endpoint buses of the set" },
  { key: "xfmr", label: "Transformers", unit: "count", def: "number of transformers in the set" },
];

/** Solve A x = b for many right-hand sides by inverting A (small dense, partial pivoting). @param {Float64Array[]} A */
function invert(A) {
  const n = A.length, M = A.map((r) => Float64Array.from(r)), I = Array.from({ length: n }, (_, i) => { const r = new Float64Array(n); r[i] = 1; return r; });
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) throw new Error("singular susceptance matrix (network not connected?)");
    [M[p], M[c]] = [M[c], M[p]]; [I[p], I[c]] = [I[c], I[p]];
    const d = M[c][c]; for (let j = 0; j < n; j++) { M[c][j] /= d; I[c][j] /= d; }
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c]; if (!f) continue; for (let j = 0; j < n; j++) { M[r][j] -= f * M[c][j]; I[r][j] -= f * I[c][j]; } }
  }
  return I;
}

/**
 * Precompute everything per network: PTDF (branch × bus), base flows, betweenness, hop distances.
 * @param {any} cm cascade_model_<grid>.json @param {any} [grid] grid_<grid>.json (transformer flags)
 */
export function prepareNetwork(cm, grid = null) {
  const nb = cm.n_bus, m = cm.n_branch, inS = (/** @type {number} */ l) => cm.br_status[l] > 0;
  // slack: bus of the generator with the largest Pmax (the engine's island-slack rule for a connected network)
  let best = -1; cm.gen_bus.forEach((b, i) => { if (cm.gen_status[i] > 0 && cm.gen_Pmax[i] > 0 && (best < 0 || cm.gen_Pmax[i] > cm.gen_Pmax[best] || (cm.gen_Pmax[i] === cm.gen_Pmax[best] && cm.bus_id[b] < cm.bus_id[cm.gen_bus[best]]))) best = i; });
  const slack = cm.gen_bus[best], keep = []; const pos = new Int32Array(nb).fill(-1);
  for (let b = 0; b < nb; b++) if (b !== slack) { pos[b] = keep.length; keep.push(b); }
  const B = keep.map(() => new Float64Array(keep.length));
  for (let l = 0; l < m; l++) { if (!inS(l)) continue; const y = 1 / cm.x[l], f = pos[cm.br_from[l]], t = pos[cm.br_to[l]];
    if (f >= 0) B[f][f] += y; if (t >= 0) B[t][t] += y; if (f >= 0 && t >= 0) { B[f][t] -= y; B[t][f] -= y; } }
  const X = invert(B), Xat = (/** @type {number} */ i, /** @type {number} */ j) => (pos[i] < 0 || pos[j] < 0 ? 0 : X[pos[i]][pos[j]]);
  // PTDF[l][b]: flow on l (per unit injection at b, withdrawn at the slack) = (X[f][b] − X[t][b]) / x_l
  const ptdf = Array.from({ length: m }, (_, l) => { const r = new Float64Array(nb); if (!inS(l)) return r; for (let b = 0; b < nb; b++) r[b] = (Xat(cm.br_from[l], b) - Xat(cm.br_to[l], b)) / cm.x[l]; return r; });
  const inj = new Float64Array(nb); cm.gen_bus.forEach((b, i) => { if (cm.gen_status[i] > 0) inj[b] += cm.pg0[i]; }); for (let b = 0; b < nb; b++) inj[b] -= cm.Pd[b];
  const f0 = new Float64Array(m); for (let l = 0; l < m; l++) { if (!inS(l)) continue; let s = 0; for (let b = 0; b < nb; b++) s += ptdf[l][b] * inj[b]; f0[l] = s; }
  // graph analytics on the in-service branch graph
  const adj = Array.from({ length: nb }, () => /** @type {number[][]} */ ([])); for (let l = 0; l < m; l++) if (inS(l)) { adj[cm.br_from[l]].push([cm.br_to[l], l]); adj[cm.br_to[l]].push([cm.br_from[l], l]); }
  const hop = Array.from({ length: nb }, (_, s) => { const d = new Int32Array(nb).fill(-1); d[s] = 0; const q = [s]; for (let h = 0; h < q.length; h++) for (const [v] of adj[q[h]]) if (d[v] < 0) { d[v] = d[q[h]] + 1; q.push(v); } return d; });
  const btw = new Float64Array(m);                                         // Brandes edge betweenness (unweighted, undirected)
  for (let s = 0; s < nb; s++) {
    const S = [], P = Array.from({ length: nb }, () => /** @type {number[][]} */ ([])), sig = new Float64Array(nb), d = new Int32Array(nb).fill(-1); sig[s] = 1; d[s] = 0; const Q = [s];
    for (let h = 0; h < Q.length; h++) { const v = Q[h]; S.push(v); for (const [w, l] of adj[v]) { if (d[w] < 0) { d[w] = d[v] + 1; Q.push(w); } if (d[w] === d[v] + 1) { sig[w] += sig[v]; P[w].push([v, l]); } } }
    const dl = new Float64Array(nb); while (S.length) { const w = /** @type {number} */ (S.pop()); for (const [v, l] of P[w]) { const c = (sig[v] / sig[w]) * (1 + dl[w]); btw[l] += c; dl[v] += c; } }
  }
  const norm = (nb * (nb - 1)) / 2 * 2; for (let l = 0; l < m; l++) btw[l] /= norm;   // each pair counted twice (from both ends)
  const deg = adj.map((a) => a.length), genCap = new Float64Array(nb); cm.gen_bus.forEach((b, i) => { if (cm.gen_status[i] > 0) genCap[b] += cm.gen_Pmax[i]; });
  const xfmr = grid ? grid.branches.map((/** @type {any} */ b) => !!b.transformer) : null;
  return { cm, nb, m, slack, ptdf, f0, load0: Array.from(f0, (v, l) => (inS(l) ? Math.abs(v) / cm.rating_dc[l] : 0)), btw, hop, deg, genCap, xfmr, inS };
}

/**
 * Post-outage DC flows with fixed injections for an outage set O (GLODF): (I − H) z = f0_O, f_l = f0_l + Σ_j PTDF_l(from_j, to_j) z_j.
 * Returns null when the set splits the network (I − H singular). @param {ReturnType<typeof prepareNetwork>} P @param {number[]} O
 */
export function postOutageFlows(P, O) {
  const k = O.length, cm = P.cm, dPt = (/** @type {number} */ l, /** @type {number} */ o) => P.ptdf[l][cm.br_from[o]] - P.ptdf[l][cm.br_to[o]];
  const A = Array.from({ length: k }, (_, i) => Float64Array.from({ length: k }, (_, j) => (i === j ? 1 : 0) - dPt(O[i], O[j]))), b = Float64Array.from(O, (o) => P.f0[o]);
  // Gaussian elimination with a singularity check (relative)
  for (let c = 0; c < k; c++) { let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-9) return null; [A[p], A[c]] = [A[c], A[p]]; [b[p], b[c]] = [b[c], b[p]];
    for (let r = c + 1; r < k; r++) { const f = A[r][c] / A[c][c]; for (let j = c; j < k; j++) A[r][j] -= f * A[c][j]; b[r] -= f * b[c]; } }
  const z = new Float64Array(k); for (let r = k - 1; r >= 0; r--) { let s = b[r]; for (let j = r + 1; j < k; j++) s -= A[r][j] * z[j]; z[r] = s / A[r][r]; }
  const out = new Float64Array(P.m), Os = new Set(O);
  for (let l = 0; l < P.m; l++) { if (!P.inS(l) || Os.has(l)) continue; let s = P.f0[l]; for (let j = 0; j < k; j++) s += dPt(l, O[j]) * z[j]; out[l] = s; }
  return out;
}

/** Feature vector (FEATURES order) for one canonical outage set. Missing post-outage values are NaN (imputed by the model pipeline). @param {ReturnType<typeof prepareNetwork>} P @param {number[]} O */
export function featureVector(P, O) {
  const cm = P.cm, k = O.length, st = Int32Array.from(cm.br_status); O.forEach((l) => (st[l] = 0));
  const { n: nc, label } = components(P.nb, cm.br_from, cm.br_to, st);
  let isolated = 0; if (nc > 1) { const hasGen = new Uint8Array(nc); cm.gen_bus.forEach((b, i) => { if (cm.gen_status[i] > 0 && cm.gen_Pmax[i] > 0) hasGen[label[b]] = 1; }); for (let b = 0; b < P.nb; b++) if (!hasGen[label[b]]) isolated += cm.Pd[b]; }
  const post = nc > 1 ? null : postOutageFlows(P, O); let pmax = NaN, nover = 0;
  if (post) { pmax = 0; for (let l = 0; l < P.m; l++) { if (!P.inS(l) || O.includes(l)) continue; const u = Math.abs(post[l]) / cm.rating_dc[l]; if (u > pmax) pmax = u; if (u > 1 + 1e-9) nover++; } }
  const ends = [...new Set(O.flatMap((l) => [cm.br_from[l], cm.br_to[l]]))]; let adjPairs = 0, hopSum = 0, pairs = 0;
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) { pairs++; const a = [cm.br_from[O[i]], cm.br_to[O[i]]], b = [cm.br_from[O[j]], cm.br_to[O[j]]];
    if (a.some((x) => b.includes(x))) adjPairs++; let h = Infinity; for (const x of a) for (const y of b) { const d = P.hop[x][y]; if (d >= 0 && d < h) h = d; } hopSum += Number.isFinite(h) ? h : P.nb; }
  return [Math.max(...O.map((l) => P.load0[l])), O.reduce((a, l) => a + P.load0[l], 0), O.reduce((a, l) => a + Math.abs(P.f0[l]), 0), pmax, nover, nc > 1 ? 1 : 0,
    isolated / cm.initial_load_mw, Math.max(...O.map((l) => P.btw[l])), Math.min(...ends.map((b) => P.deg[b])), pairs ? adjPairs / pairs : 0, pairs ? hopSum / pairs : 0,
    ends.reduce((a, b) => a + cm.Pd[b], 0), ends.reduce((a, b) => a + P.genCap[b], 0), P.xfmr ? O.filter((l) => P.xfmr[l]).length : 0];
}
