// @ts-check
// Machine-learning pipeline of the ML Risk Observatory, in plain JavaScript so it runs in a Web Worker on the user's machine:
// group-aware splits, median imputation + standardisation, L2 logistic regression (same objective as scikit-learn's
// LogisticRegression(C)), a random-forest regressor with histogram splits (per-tree spread as an uncertainty indicator, Saabas path
// attributions), and evaluation metrics written to match scikit-learn (checked in tests/integration/test_blacksky_ml.py).
// Labels come from the cascade simulator; the models learn to approximate that simulator, nothing more.
import { makeRng } from "./rng.js";

export const MODEL_SCHEMA = "bsx.model/1";

// ------------------------------------------------------------------ splits
/**
 * Disjoint-branch split: branches are assigned at random (seeded) to a test group with probability testFrac; a candidate is a test
 * example only if all its branches are test branches, a training example only if none is; mixed candidates are excluded, so no
 * branch seen in training appears in any test candidate. @param {number[][]} sets @param {number} m @param {number} testFrac @param {number} seed
 */
export function disjointBranchSplit(sets, m, testFrac, seed) {
  const rng = makeRng(seed), test = new Uint8Array(m); for (let l = 0; l < m; l++) test[l] = rng.next() < testFrac ? 1 : 0;
  const tr = [], te = [], ex = [];
  sets.forEach((s, i) => { const t = s.filter((l) => test[l]).length; if (t === 0) tr.push(i); else if (t === s.length) te.push(i); else ex.push(i); });
  return { train: tr, test: te, excluded: ex, testBranches: [...test.keys()].filter((l) => test[l]), strategy: "disjoint-branch group split", seed, testFrac };
}
/** Plain random row split (leaky for this problem: test candidates share branches with training candidates). @param {number} n @param {number} testFrac @param {number} seed */
export function randomRowSplit(n, testFrac, seed) {
  const idx = makeRng(seed).shuffle([...Array(n).keys()]), cut = Math.round(n * (1 - testFrac));
  return { train: idx.slice(0, cut).sort((a, b) => a - b), test: idx.slice(cut).sort((a, b) => a - b), excluded: [], testBranches: [], strategy: "random row split (leaky)", seed, testFrac };
}
/** Branch overlap between the training and test candidates (0 for a valid disjoint split). @param {number[][]} sets @param {number[]} tr @param {number[]} te */
export function branchOverlap(sets, tr, te) { const a = new Set(tr.flatMap((i) => sets[i])); return [...new Set(te.flatMap((i) => sets[i]))].filter((l) => a.has(l)); }

// ------------------------------------------------------------------ preprocessing
/** Median imputation + standardisation fitted on training rows only. @param {number[][]} X @param {number[]} rows */
export function fitScaler(X, rows) {
  const p = X[0].length, med = [], mu = [], sd = [], lo = [], hi = [];
  for (let j = 0; j < p; j++) {
    const v = rows.map((i) => X[i][j]).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    const md = v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : 0; med.push(md);
    const f = rows.map((i) => (Number.isFinite(X[i][j]) ? X[i][j] : md)), m = f.reduce((a, b) => a + b, 0) / f.length;
    mu.push(m); sd.push(Math.sqrt(f.reduce((a, b) => a + (b - m) ** 2, 0) / f.length) || 1); lo.push(Math.min(...f)); hi.push(Math.max(...f));
  }
  return { med, mu, sd, lo, hi, impute: (/** @type {number[]} */ x) => x.map((v, j) => (Number.isFinite(v) ? v : med[j])), z: (/** @type {number[]} */ x) => x.map((v, j) => ((Number.isFinite(v) ? v : med[j]) - mu[j]) / sd[j]) };
}
/** Features outside the training range (out-of-distribution warning). @param {ReturnType<typeof fitScaler>} sc @param {number[]} x */
export const outOfRange = (sc, x) => x.map((v, j) => (Number.isFinite(v) && (v < sc.lo[j] - 1e-12 || v > sc.hi[j] + 1e-12) ? j : -1)).filter((j) => j >= 0);

// ------------------------------------------------------------------ logistic regression (Newton / IRLS)
/**
 * Minimises C · Σ logloss + ½‖w‖² (intercept unpenalised), the scikit-learn LogisticRegression(penalty="l2", C) objective.
 * @param {number[][]} Z standardised rows @param {number[]} y 0/1 @param {{ C?: number, iters?: number }} [o]
 */
export function fitLogistic(Z, y, { C = 1.0, iters = 50 } = {}) {
  const n = Z.length, p = Z[0].length, w = new Float64Array(p + 1);   // w[p] = intercept
  for (let it = 0; it < iters; it++) {
    const g = new Float64Array(p + 1), H = Array.from({ length: p + 1 }, () => new Float64Array(p + 1));
    for (let j = 0; j < p; j++) { g[j] = w[j]; H[j][j] = 1; }
    for (let i = 0; i < n; i++) {
      const zi = Z[i]; let s = w[p]; for (let j = 0; j < p; j++) s += w[j] * zi[j];
      const pr = 1 / (1 + Math.exp(-s)), r = C * (pr - y[i]), q = C * pr * (1 - pr);
      for (let a = 0; a <= p; a++) { const xa = a < p ? zi[a] : 1; g[a] += r * xa; for (let b = a; b <= p; b++) H[a][b] += q * xa * (b < p ? zi[b] : 1); }
    }
    for (let a = 0; a <= p; a++) for (let b = 0; b < a; b++) H[a][b] = H[b][a];
    const step = solveSym(H, g); let mx = 0; for (let a = 0; a <= p; a++) { w[a] -= step[a]; mx = Math.max(mx, Math.abs(step[a])); }
    if (mx < 1e-10) break;
  }
  const coef = Array.from(w.slice(0, p)), intercept = w[p];
  return { coef, intercept, predict: (/** @type {number[]} */ z) => { let s = intercept; for (let j = 0; j < p; j++) s += coef[j] * z[j]; return 1 / (1 + Math.exp(-s)); },
    contributions: (/** @type {number[]} */ z) => z.map((v, j) => coef[j] * v) };
}
/** @param {Float64Array[]} A @param {Float64Array} b */
function solveSym(A, b) {
  const n = b.length, M = A.map((r) => Float64Array.from(r)), x = Float64Array.from(b);
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[p], M[c]] = [M[c], M[p]]; [x[p], x[c]] = [x[c], x[p]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; if (!f) continue; for (let j = c; j < n; j++) M[r][j] -= f * M[c][j]; x[r] -= f * x[c]; } }
  for (let r = n - 1; r >= 0; r--) { let s = x[r]; for (let j = r + 1; j < n; j++) s -= M[r][j] * x[j]; x[r] = s / M[r][r]; }
  return x;
}

// ------------------------------------------------------------------ random forest (regression on S; leaves also store the severe fraction)
/**
 * @typedef {{ f: number, t: number, l: Node, r: Node, mean: number, sev: number, n: number } | { leaf: true, mean: number, sev: number, n: number }} Node
 */
/**
 * Bagged regression trees with histogram (quantile-bin) split candidates. Uncertainty = standard deviation of the per-tree predictions
 * (an ensemble-spread indicator, not a calibrated interval).
 * @param {number[][]} X imputed rows @param {number[]} y targets (S) @param {number} tau severe threshold
 * @param {{ trees?: number, maxDepth?: number, minLeaf?: number, mtry?: number, bins?: number, seed?: number }} [o]
 */
export function fitForest(X, y, tau, { trees = 60, maxDepth = 10, minLeaf = 4, mtry = 0, bins = 48, seed = 1 } = {}) {
  const n = X.length, p = X[0].length, rng = makeRng(seed), mt = mtry || Math.max(1, Math.ceil(p / 3));
  const edges = []; for (let j = 0; j < p; j++) { const v = X.map((r) => r[j]).sort((a, b) => a - b), e = new Set(); for (let b = 1; b < bins; b++) e.add(v[Math.min(n - 1, Math.floor((b * n) / bins))]); edges.push([...e].sort((a, b) => a - b)); }
  const imp = new Float64Array(p), forest = [];
  for (let t = 0; t < trees; t++) {
    const idx = Array.from({ length: n }, () => rng.int(n));
    /** @returns {Node} */
    const grow = (/** @type {number[]} */ rows, /** @type {number} */ depth) => {
      let s = 0, sv = 0; for (const i of rows) { s += y[i]; if (y[i] >= tau - 1e-12) sv++; } const mean = s / rows.length, sev = sv / rows.length;
      if (depth >= maxDepth || rows.length < 2 * minLeaf) return { leaf: true, mean, sev, n: rows.length };
      let sse = 0; for (const i of rows) sse += (y[i] - mean) ** 2; if (sse < 1e-14) return { leaf: true, mean, sev, n: rows.length };
      const feats = rng.shuffle([...Array(p).keys()]).slice(0, mt); let best = null;
      for (const f of feats) {
        const E = edges[f]; if (!E.length) continue; const cnt = new Float64Array(E.length + 1), sum = new Float64Array(E.length + 1);
        for (const i of rows) { const v = X[i][f]; let lo = 0, hi = E.length; while (lo < hi) { const md = (lo + hi) >> 1; if (v <= E[md]) hi = md; else lo = md + 1; } cnt[lo]++; sum[lo] += y[i]; }
        let cL = 0, sL = 0; const N = rows.length;
        for (let b = 0; b < E.length; b++) { cL += cnt[b]; sL += sum[b]; const cR = N - cL; if (cL < minLeaf || cR < minLeaf) continue;
          const sR = s - sL;                                                  // variance reduction = SSE(parent) − SSE(left) − SSE(right)
          const gain = (sL * sL) / cL + (sR * sR) / cR - (s * s) / N; if (!best || gain > best.gain + 1e-15) best = { f, t: E[b], gain }; }
      }
      if (!best || best.gain <= 1e-15) return { leaf: true, mean, sev, n: rows.length };
      const L = [], R = []; for (const i of rows) (X[i][best.f] <= best.t ? L : R).push(i);
      imp[best.f] += best.gain;
      return { f: best.f, t: best.t, l: grow(L, depth + 1), r: grow(R, depth + 1), mean, sev, n: rows.length };
    };
    forest.push(grow(idx, 0));
  }
  const tot = imp.reduce((a, b) => a + b, 0) || 1;
  /** @param {Node} nd @param {number[]} x */
  const leafOf = (nd, x) => { while (!("leaf" in nd)) nd = x[nd.f] <= nd.t ? nd.l : nd.r; return nd; };
  return {
    trees: forest.length, tau, importance: Array.from(imp, (v) => v / tot),
    /** mean S, spread across trees, P(severe) */
    predict(/** @type {number[]} */ x) { const v = forest.map((tr) => leafOf(tr, x)), m = v.reduce((a, b) => a + b.mean, 0) / v.length; const sd = Math.sqrt(v.reduce((a, b) => a + (b.mean - m) ** 2, 0) / v.length);
      return { mean: m, sd, pSevere: v.reduce((a, b) => a + b.sev, 0) / v.length }; },
    /** Saabas path attribution: root mean + Σ per-feature changes along each tree's decision path, averaged over trees (exactly sums to the prediction). */
    contributions(/** @type {number[]} */ x) { const c = new Float64Array(p); let bias = 0;
      for (const tr of forest) { let nd = tr; bias += nd.mean; while (!("leaf" in nd)) { const nx = x[nd.f] <= nd.t ? nd.l : nd.r; c[nd.f] += nx.mean - nd.mean; nd = nx; } }
      return { bias: bias / forest.length, contrib: Array.from(c, (v) => v / forest.length) }; },
  };
}

// ------------------------------------------------------------------ metrics (definitions follow scikit-learn)
/** ROC AUC with tied scores averaged (Mann–Whitney). Returns null when only one class is present. @param {number[]} y @param {number[]} s */
export function rocAuc(y, s) {
  const n = y.length, pos = y.filter((v) => v === 1).length, neg = n - pos; if (!pos || !neg) return null;
  const o = [...Array(n).keys()].sort((a, b) => s[a] - s[b]), rank = new Float64Array(n);
  for (let i = 0; i < n;) { let j = i; while (j + 1 < n && s[o[j + 1]] === s[o[i]]) j++; const r = (i + j) / 2 + 1; for (let t = i; t <= j; t++) rank[o[t]] = r; i = j + 1; }
  let sr = 0; for (let i = 0; i < n; i++) if (y[i] === 1) sr += rank[i];
  return (sr - (pos * (pos + 1)) / 2) / (pos * neg);
}
/** Average precision = Σ_n (R_n − R_{n−1}) P_n over distinct score thresholds (sklearn.metrics.average_precision_score). @param {number[]} y @param {number[]} s */
export function averagePrecision(y, s) {
  const pos = y.filter((v) => v === 1).length; if (!pos) return null;
  const o = [...y.keys()].sort((a, b) => s[b] - s[a]); let tp = 0, fp = 0, ap = 0, prevR = 0;
  for (let i = 0; i < o.length;) { let j = i; while (j + 1 < o.length && s[o[j + 1]] === s[o[i]]) j++; for (let t = i; t <= j; t++) (y[o[t]] === 1 ? tp++ : fp++);
    const R = tp / pos, P = tp / (tp + fp); ap += (R - prevR) * P; prevR = R; i = j + 1; }
  return ap;
}
/** Precision, recall, F1 and confusion matrix at a probability threshold (≥). @param {number[]} y @param {number[]} p @param {number} [thr] */
export function classification(y, p, thr = 0.5) {
  let tp = 0, fp = 0, tn = 0, fn = 0; y.forEach((v, i) => { const h = p[i] >= thr ? 1 : 0; if (h && v) tp++; else if (h) fp++; else if (v) fn++; else tn++; });
  const precision = tp + fp ? tp / (tp + fp) : null, recall = tp + fn ? tp / (tp + fn) : null;
  return { tp, fp, tn, fn, precision, recall, f1: precision != null && recall != null && precision + recall ? (2 * precision * recall) / (precision + recall) : precision === 0 || recall === 0 ? 0 : null, threshold: thr };
}
/** Brier score and reliability curve (equal-width bins) with expected calibration error. @param {number[]} y @param {number[]} p @param {number} [bins] */
export function calibration(y, p, bins = 10) {
  const n = y.length, B = Array.from({ length: bins }, () => ({ n: 0, p: 0, y: 0 })); let brier = 0;
  y.forEach((v, i) => { brier += (p[i] - v) ** 2; const b = B[Math.min(bins - 1, Math.floor(p[i] * bins))]; b.n++; b.p += p[i]; b.y += v; });
  const curve = B.map((b, i) => ({ lo: i / bins, hi: (i + 1) / bins, n: b.n, meanPred: b.n ? b.p / b.n : null, fracPos: b.n ? b.y / b.n : null }));
  const ece = curve.reduce((a, c) => a + (c.n ? (c.n / n) * Math.abs(/** @type {number} */ (c.meanPred) - /** @type {number} */ (c.fracPos)) : 0), 0);
  return { brier: brier / n, ece, curve, bins };
}
/** MAE, RMSE, R² (sklearn r2_score). @param {number[]} y @param {number[]} yh */
export function regression(y, yh) {
  const n = y.length, m = y.reduce((a, b) => a + b, 0) / n; let ae = 0, se = 0, st = 0;
  y.forEach((v, i) => { ae += Math.abs(v - yh[i]); se += (v - yh[i]) ** 2; st += (v - m) ** 2; });
  return { mae: ae / n, rmse: Math.sqrt(se / n), r2: st > 0 ? 1 - se / st : null, n };
}
/**
 * Ranking quality of the predicted order against simulator S: precision@k = recall@k with respect to the true top-k set (same size),
 * NDCG@k with linear gains = S (sklearn ndcg_score(..., k, ignore_ties=True)), ties in predicted score broken by index.
 * @param {number[]} y true S @param {number[]} s predicted score @param {number} k
 */
export function ranking(y, s, k) {
  const n = y.length; k = Math.min(k, n); const byPred = [...y.keys()].sort((a, b) => s[b] - s[a] || a - b), byTrue = [...y.keys()].sort((a, b) => y[b] - y[a] || a - b);
  const thr = y[byTrue[k - 1]], rel = new Set(byTrue.filter((i) => y[i] >= thr - 1e-15));          // true top-k (ties at the boundary included)
  const hits = byPred.slice(0, k).filter((i) => rel.has(i)).length;
  const dcg = (/** @type {number[]} */ order) => order.slice(0, k).reduce((a, i, r) => a + y[i] / Math.log2(r + 2), 0), ideal = dcg(byTrue);
  return { k, precisionAtK: hits / k, recallAtK: hits / Math.min(k, rel.size), ndcgAtK: ideal > 0 ? dcg(byPred) / ideal : null, trueTopSize: rel.size };
}

/** Permutation importance (seeded): mean and sd of the metric drop when one feature column is shuffled. @param {(rows: number[][]) => number} score @param {number[][]} X @param {number} repeats @param {number} seed */
export function permutationImportance(score, X, repeats = 5, seed = 7) {
  const base = score(X), p = X[0].length, rng = makeRng(seed), out = [];
  for (let j = 0; j < p; j++) { const drops = []; for (let r = 0; r < repeats; r++) { const col = rng.shuffle(X.map((x) => x[j])); drops.push(base - score(X.map((x, i) => { const z = x.slice(); z[j] = col[i]; return z; }))); }
    const m = drops.reduce((a, b) => a + b, 0) / repeats; out.push({ j, mean: m, sd: Math.sqrt(drops.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, repeats - 1)) }); }
  return { base, items: out, repeats, seed, method: "permutation importance on held-out rows (approximate; not causal)" };
}

/** ROC curve points (FPR, TPR) over distinct thresholds, from high to low. @param {number[]} y @param {number[]} s */
export function rocCurve(y, s) {
  const pos = y.filter((v) => v === 1).length, neg = y.length - pos; if (!pos || !neg) return null;
  const o = [...y.keys()].sort((a, b) => s[b] - s[a]), pts = [[0, 0]]; let tp = 0, fp = 0;
  for (let i = 0; i < o.length;) { let j = i; while (j + 1 < o.length && s[o[j + 1]] === s[o[i]]) j++; for (let t = i; t <= j; t++) (y[o[t]] === 1 ? tp++ : fp++); pts.push([fp / neg, tp / pos]); i = j + 1; }
  return pts;
}
/** Precision–recall curve points (recall, precision) over distinct thresholds. @param {number[]} y @param {number[]} s */
export function prCurve(y, s) {
  const pos = y.filter((v) => v === 1).length; if (!pos) return null;
  const o = [...y.keys()].sort((a, b) => s[b] - s[a]), pts = []; let tp = 0, fp = 0;
  for (let i = 0; i < o.length;) { let j = i; while (j + 1 < o.length && s[o[j + 1]] === s[o[i]]) j++; for (let t = i; t <= j; t++) (y[o[t]] === 1 ? tp++ : fp++); pts.push([tp / pos, tp / (tp + fp)]); i = j + 1; }
  return pts;
}
