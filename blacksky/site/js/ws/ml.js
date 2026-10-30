// Workspace 4 · ML Risk Observatory. Pipeline: candidate → features (base case and topology only) → model prediction → ranking →
// simulator verification → comparison and error. Labels come from the cascade simulator, so the models learn to approximate that
// simulator; a prediction is never shown as a verified outcome. Training, metrics and importance run in the compute worker.
import { $, esc, int, toast, GRID_NAME } from "../util.js";
import { FEATURES, FEATURE_SCHEMA } from "../sci/features.js";
import { binom, binomBig, groupDigits, candidateId, canon } from "../sci/combin.js";
import { rocCurve, prCurve, MODEL_SCHEMA } from "../sci/ml.js";
import { configHash, APP } from "../sci/contracts.js";
import { limitationsFor } from "../sci/limitations.js";
import { summary } from "../sci/stats.js";
import { lineChart, barChart, scatter, bindTips, SERIES } from "./charts.js";
import { pairIndex, displayOrder } from "../sci/landscape.js";
import { createLandscape } from "./landscape-view.js";
import { RAMPS, css } from "../sci/overlays.js";

const pc = (x, d = 1) => (x == null || Number.isNaN(x) ? "–" : `${(100 * x).toFixed(d)}%`);
const f3 = (x) => (x == null || Number.isNaN(x) ? "–" : x.toFixed(3));
const FKEY = FEATURES.map((f) => f.key);

export function init(bx, root) {
  const { store } = bx;
  const st = { cfg: { grid: "ieee118", k: 2, sample: 20000, tau: 0.05, split: "disjoint", testFrac: 0.3, seed: 1, trees: 60, depth: 10, C: 1 }, res: null, job: null, prog: null, err: null, tab: "perf", sel: null, filter: "all", sort: "pred", record: null, al: { budget: 300, reps: 3, beta: 1, seed: 1, res: null, record: null }, extra: null };
  root.innerHTML = `<div class="ws-head"><h1>ML Risk <em>Observatory</em></h1><span class="q">Can a model trained on simulator outcomes rank outage sets before they are simulated? Predictions are labelled as predictions; the cascade simulator is the only source of verified outcomes; test candidates share no branch with training candidates by default.</span>
      <div class="acts"><button class="btn sm drawer-btn" id="m-insp-btn">Candidate</button></div></div>
    <section class="pane left" aria-label="Dataset and model"><div class="pane-h"><h2>Dataset · split · model</h2></div><div class="pane-b" id="m-left"></div></section>
    <section class="pane center" aria-label="Evaluation"><div class="tabs" role="tablist" id="m-tabs"></div><div class="pane-b" id="m-center"></div></section>
    <section class="pane right" aria-label="Candidate inspector"><div class="pane-h"><h2>Candidate</h2><button class="btn sm ghost drawer-btn" id="m-insp-x">Close</button></div><div class="pane-b" id="m-right"></div></section>`;
  const L = $("m-left"), C = $("m-center"), R = $("m-right"), TB = $("m-tabs"); bindTips(root);
  $("m-insp-btn").onclick = () => root.classList.toggle("insp-open"); $("m-insp-x").onclick = () => root.classList.remove("insp-open");
  const TABS = [["perf", "Performance"], ["plots", "Plots"], ["land", "Landscape"], ["imp", "Importance"], ["cands", "Candidates"], ["al", "Active learning"], ["prov", "Provenance"]];

  const gi = (g) => bx.index.grids.find((x) => x.id === g);
  function validate() {
    const c = st.cfg, e = [], m = gi(c.grid).n_branch, N = binom(m, c.k);
    if (![2, 3].includes(c.k)) e.push("k must be 2 or 3.");
    if (!(c.tau > 0 && c.tau < 1)) e.push("The severity threshold τ must be between 0 and 1.");
    if (!(c.testFrac >= 0.1 && c.testFrac <= 0.6)) e.push("Test fraction must be between 0.1 and 0.6.");
    if (!(Number.isInteger(c.sample) && c.sample >= 200 && c.sample <= 20000)) e.push("Candidates must be an integer in 200–20,000.");
    if (!(Number.isInteger(c.trees) && c.trees >= 5 && c.trees <= 200) || !(Number.isInteger(c.depth) && c.depth >= 2 && c.depth <= 16)) e.push("Forest: 5–200 trees, depth 2–16.");
    if (!(c.C > 0)) e.push("Logistic C must be positive.");
    return { ok: !e.length, errors: e, N, all: c.sample >= N, n: Math.min(c.sample, N) };
  }
  async function train() {
    const v = validate(); if (!v.ok) { toast(v.errors[0]); return; } const c = { ...st.cfg }; st.res = null; st.err = null; st.record = null; st.sel = null; st.prog = { stage: "starting", done: 0, total: 1 }; render();
    const t0 = performance.now(), started = new Date().toISOString();
    const job = bx.jobs.run("ml.train", c, { family: "ml", timeoutMs: 15 * 60 * 1000, onProgress: (p) => { st.prog = p; bx.setJob({ label: `ML ${p.stage}`, pct: p.total ? (100 * p.done) / p.total : null }); renderProgress(); } });
    st.job = job; render();
    try {
      const res = await job.promise; if (res.status === "cancelled") { st.job = null; bx.setJob(null); render(); toast("Training cancelled"); return; }
      const wall = performance.now() - t0, finished = new Date().toISOString();
      const ds = { grid: c.grid, k: c.k, candidates: v.all ? `all C(${gi(c.grid).n_branch}, ${c.k}) = ${groupDigits(binomBig(gi(c.grid).n_branch, c.k))}` : `${int(res.sets.length)} uniform random sets (seed ${c.seed})`, label: `S from the DC cascade simulator (all-overloaded); severe ⇔ S ≥ ${c.tau}`, dataSha256: store.get().net?.id === c.grid ? store.get().net.model.provenance.file_sha256 : null };
      res.provenance = { datasetVersion: `DS-${configHash({ ...ds, sets: configHash(res.sets) })}`, dataset: ds, featureVersion: FEATURE_SCHEMA, features: FKEY, labelDefinition: ds.label, split: { strategy: res.split.strategy, seed: c.seed, testFrac: c.testFrac, train: res.split.train.length, test: res.split.test.length, excluded: res.split.excluded.length, branchOverlap: res.split.overlap },
        model: { schema: MODEL_SCHEMA, forest: { trees: c.trees, maxDepth: c.depth, minLeaf: 4, mtry: "ceil(p/3)", splits: "48 quantile bins", seed: c.seed }, logistic: { penalty: "L2", C: c.C, solver: "Newton" } }, startedAt: started, finishedAt: finished,
        software: `${APP.name} ${APP.edition} ${APP.version}${bx.build?.commit ? ` @ ${bx.build.commit.slice(0, 10)}` : ""}`, timing: { labellingMs: res.simMs, trainingMs: res.trainMs, wallMs: wall }, failures: res.failures, modelId: res.modelId };
      st.res = res; st.res.cfg = c;
      const T = res.metrics.test;
      st.record = bx.registry.add({ parent: st.parent || null, type: "ml.train", name: `ML · ${GRID_NAME[c.grid]} k=${c.k} · ${res.split.strategy} · forest ${c.trees}×${c.depth}`, config: { ...c, featureVersion: FEATURE_SCHEMA, datasetVersion: res.provenance.datasetVersion }, seed: c.seed, provenance: "predicted",
        results: { test: { n: T.n, positives: T.positives, mae: T.regression.mae, rmse: T.regression.rmse, r2: T.regression.r2, aucForest: T.forest.auc, apForest: T.forest.ap, aucLogistic: T.logistic?.auc ?? null, aucBaseline: T.baseline.auc, ndcgForest: T.rankingForest.ndcgAtK, ndcgBaseline: T.rankingBaseline.ndcgAtK, precisionAtK: T.rankingForest.precisionAtK, k: T.rankingForest.k, brier: T.forest.cal.brier, ece: T.forest.cal.ece },
          train: { n: res.metrics.train.n, r2: res.metrics.train.regression.r2, aucForest: res.metrics.train.forest.auc }, split: res.provenance.split, timing: res.provenance.timing },
        durationMs: wall, limitations: limitationsFor("ml.train"), links: [{ kind: "model", id: res.modelId }], log: [{ t: res.simMs, msg: `${res.sets.length} labels from the simulator` }, { t: res.simMs + res.trainMs, msg: "forest + logistic trained" }] });
      st.tab = "perf";
    } catch (e) { st.err = String(e.message || e); }
    st.job = null; st.prog = null; bx.setJob(null); render();
  }
  async function predictSets(sets) { if (!st.res) throw new Error("Train a model first"); const j = bx.jobs.run("ml.predict", { modelId: st.res.modelId, sets }, { family: "mlpredict", timeoutMs: 60000 }); const r = await j.promise; return r.items; }
  async function verify(set) {
    const s = store.get(); if (!s.net || s.net.id !== st.cfg.grid) { await bx.loadNet(st.cfg.grid); }
    const t0 = performance.now(), res = store.get().net.engine.run(set, { policy: "all_overloaded" }), ms = performance.now() - t0, item = st.extra && st.extra.set.join() === set.join() ? st.extra : null;
    const pred = item ? item.pred : null; st.extra = { ...(item || { set }), actual: res.metrics.S, verifiedMs: ms };
    const rec = bx.registry.add({ type: "ml.verify", name: `Verify prediction · ${candidateId(st.cfg.grid, set)}`, config: { grid: st.cfg.grid, set, modelId: st.res?.modelId, engine: "browser-dc", policy: "all_overloaded" }, provenance: "simulator",
      scenarioIds: [`SCN:${st.cfg.grid}:k${set.length}:${canon(set).join("-")}:dc:all`], results: { predictedMean: pred?.mean ?? null, predictedSpread: pred?.sd ?? null, pSevere: pred?.pSevere ?? null, simulatedS: res.metrics.S, error: pred ? res.metrics.S - pred.mean : null, simulatorMs: ms }, durationMs: ms, limitations: limitationsFor("ml.verify") });
    st.extra.record = rec; renderRight(); toast(`Simulated: S = ${pc(res.metrics.S, 2)} (${rec.id})`);
  }
  async function runAL() {
    const a = st.al, c = st.cfg; if (!(a.budget >= 50 && a.budget <= 3000) || !(a.reps >= 1 && a.reps <= 10)) { toast("Budget 50–3000, repetitions 1–10"); return; }
    const t = gi(c.grid).k[String(c.k)], optimum = t && t.available ? t.Smax_dc : null; a.res = null; a.record = null; renderCenter(); const t0 = performance.now();
    const job = bx.jobs.run("ml.active", { grid: c.grid, k: c.k, budget: a.budget, reps: a.reps, seed: a.seed, beta: a.beta, optimum }, { family: "ml", timeoutMs: 15 * 60 * 1000, onProgress: (p) => { bx.setJob({ label: `Active learning ${p.method}`, pct: (100 * p.done) / p.total }); } });
    st.job = job; renderLeft();
    try { const res = await job.promise; if (res.status !== "cancelled") { a.res = { ...res, optimum, wall: performance.now() - t0 };
      const sum = (m) => ({ bestS: summary(res[m].map((r) => r.best.S)), sims: summary(res[m].map((r) => r.sims)), hitAt: summary(res[m].filter((r) => r.hitAt != null).map((r) => r.hitAt)), found: res[m].filter((r) => r.found).length });
      a.record = bx.registry.add({ parent: st.parent || null, type: "ml.active", name: `Active learning · ${GRID_NAME[c.grid]} k=${c.k} · budget ${a.budget} × ${a.reps}`, config: { grid: c.grid, k: c.k, budget: a.budget, reps: a.reps, seed: a.seed, beta: a.beta, acquisition: "UCB: mean + β·spread", initialSample: "max(20, 10 % of budget) uniform random", model: "random forest 30×8, retrained per batch" },
        seed: a.seed, provenance: "simulator", results: { optimum, surrogate: sum("surrogate"), random: sum("random") }, durationMs: a.res.wall, limitations: limitationsFor("ml.active") }); } }
    catch (e) { toast(String(e.message || e)); }
    st.job = null; bx.setJob(null); render();
  }

  // ------------------------------------------------------------------ rendering
  function renderLeft() {
    const c = st.cfg, v = validate();
    L.innerHTML = `<div class="sec"><span class="micro">1 · Dataset (labels from the simulator)</span><div class="grid2"><div class="field"><label for="m-grid">Network</label><select class="ctl" id="m-grid">${bx.index.grids.map((g) => `<option value="${g.id}" ${c.grid === g.id ? "selected" : ""}>${GRID_NAME[g.id]}</option>`).join("")}</select></div>
        <div class="field"><label for="m-k">Outages k</label><select class="ctl" id="m-k"><option value="2" ${c.k === 2 ? "selected" : ""}>2</option><option value="3" ${c.k === 3 ? "selected" : ""}>3</option></select></div></div>
        <div class="grid2"><div class="field"><label for="m-sample">Candidates</label><input class="ctl" id="m-sample" type="number" min="200" max="20000" value="${c.sample}"></div><div class="field"><span class="lab">Space</span><div class="mono" style="padding-top:6px;font-size:12px">N = ${groupDigits(binomBig(gi(c.grid).n_branch, c.k))}</div></div></div>
        <p class="note">${v.all ? "All candidates of the space are labelled." : `${int(v.n)} uniformly random candidates (seed ${c.seed}).`} Each label is one run of the DC cascade simulator (~${(v.n * (c.grid === "ieee118" ? 0.75 : 0.35) / 1000).toFixed(0)} s here).</p>
        <div class="field"><label for="m-tau">Severe if S ≥ τ</label><input class="ctl" id="m-tau" type="number" step="0.01" min="0.01" max="0.9" value="${c.tau}"></div></div>
      <div class="sec"><span class="micro">2 · Split (leakage control)</span><div class="field"><label for="m-split">Strategy</label><select class="ctl" id="m-split"><option value="disjoint" ${c.split === "disjoint" ? "selected" : ""}>Disjoint-branch groups (no shared branch)</option><option value="random" ${c.split === "random" ? "selected" : ""}>Random rows (leaky — for comparison)</option></select></div>
        <div class="grid2"><div class="field"><label for="m-tf">Test fraction</label><input class="ctl" id="m-tf" type="number" step="0.05" min="0.1" max="0.6" value="${c.testFrac}"></div><div class="field"><label for="m-seed">Seed</label><input class="ctl" id="m-seed" type="number" value="${c.seed}"></div></div>
        ${c.split === "disjoint" ? (() => { const n = v.n, te = n * c.testFrac ** c.k, tr = n * (1 - c.testFrac) ** c.k; return `<div class="${te < 60 ? "m-warn" : "m-info"}">Expected ≈ ${int(Math.round(te))} test and ≈ ${int(Math.round(tr))} training candidates (test-branch probability ${c.testFrac}, k = ${c.k}); ≈ ${int(Math.round(n - te - tr))} mixed candidates are excluded.${te < 60 ? " Too few test candidates for stable metrics: raise the test fraction or use more candidates." : ""}</div>`; })() : ""}
        <p class="note">${c.split === "disjoint" ? "Branches are drawn into a test group with probability = test fraction; test candidates use only test branches, training candidates none of them; mixed candidates are excluded." : "<b>Leaky:</b> a test pair usually shares a branch with many training pairs, so the model can memorise per-branch effects. Use it only to see how much a naive split inflates scores."}</p></div>
      <div class="sec"><span class="micro">3 · Models</span><div class="grid3"><div class="field"><label for="m-trees">Trees</label><input class="ctl" id="m-trees" type="number" min="5" max="200" value="${c.trees}"></div><div class="field"><label for="m-depth">Depth</label><input class="ctl" id="m-depth" type="number" min="2" max="16" value="${c.depth}"></div><div class="field"><label for="m-C">Logistic C</label><input class="ctl" id="m-C" type="number" step="0.1" min="0.01" value="${c.C}"></div></div>
        <p class="note">Random forest regressor on S (its leaves also give P(severe)); L2 logistic regression on the severe label; and a no-training baseline that ranks by max post-outage loading. No neural network: the data are a few thousand tabular rows.</p>
        ${v.errors.map((e) => `<div class="m-err">${esc(e)}</div>`).join("")}${st.err ? `<div class="m-err">${esc(st.err)}</div>` : ""}
        <div class="row"><button class="btn primary" id="m-train" ${v.ok && !st.job ? "" : "disabled"}>${st.job ? "Working…" : "Label, split and train"}</button>${st.job ? `<button class="btn" id="m-cancel">Cancel</button>` : ""}</div><div id="m-prog"></div></div>
      <div class="sec"><span class="micro">Features (${FEATURE_SCHEMA})</span><p class="note">Computed from the base case and topology only — no cascade simulation.</p><div class="list">${FEATURES.map((f) => `<div style="grid-template-columns:1fr;cursor:default"><span><span class="tt">${esc(f.label)}</span> <span class="faint mono" style="font-size:10.5px">${esc(f.key)} · ${esc(f.unit)}</span><span class="dd">${esc(f.def)}</span></span></div>`).join("")}</div></div>`;
    renderProgress();
  }
  function renderProgress() { const el = $("m-prog"), p = st.prog; if (!el) return; if (!p || !st.job) { el.innerHTML = ""; return; } el.innerHTML = `<div class="prog"><i style="width:${p.total ? (100 * p.done / p.total).toFixed(0) : 5}%"></i></div><p class="note mono" style="font-size:11px">${esc(p.stage || "")} ${p.total > 1 ? `${int(p.done)}/${int(p.total)}` : ""}</p>`; }

  const testRows = () => { const r = st.res; return r.split.test.map((i) => ({ i, set: r.sets[i], y: r.y[i], p: r.pred[i], x: r.X[i], sev: r.y[i] >= r.cfg.tau - 1e-12, psev: r.pred[i].pSevere >= 0.5 })); };
  function perfView() {
    const r = st.res, T = r.metrics.test, Tr = r.metrics.train, c = r.cfg;
    const cls = (m, name) => m ? `<tr><td>${name}</td><td>${f3(m.auc)}</td><td>${f3(m.ap)}</td>${m.cls ? `<td>${f3(m.cls.precision)}</td><td>${f3(m.cls.recall)}</td><td>${f3(m.cls.f1)}</td><td>${f3(m.cal.brier)}</td><td>${f3(m.cal.ece)}</td>` : `<td colspan="5" class="faint">ranking score only (no probability)</td>`}</tr>` : "";
    const cm = T.forest.cls;
    return `<div class="statrow"><div class="stat"><span class="k">Held-out candidates</span><span class="v">${int(T.n)}</span></div><div class="stat"><span class="k">Severe in test (S ≥ ${c.tau})</span><span class="v">${int(T.positives)} <span class="faint" style="font-size:13px">(${pc(T.positives / T.n)})</span></span></div>
        <div class="stat"><span class="k">Training candidates</span><span class="v">${int(Tr.n)}</span></div><div class="stat"><span class="k">Excluded (mixed)</span><span class="v">${int(r.split.excluded.length)}</span></div><div class="stat"><span class="k">Branch overlap train/test</span><span class="v" style="color:${r.split.overlap ? "var(--amber)" : "var(--green)"}">${r.split.overlap}</span></div></div>
      ${r.cfg.split === "random" ? `<div class="m-warn">Random row split: ${r.split.overlap} branches appear in both training and test candidates. Expect these scores to be optimistic compared with the disjoint-branch split.</div>` : ""}
      ${T.positives < 10 ? `<div class="m-warn">Only ${T.positives} severe test candidates: classification metrics are very uncertain. Lower τ or use more candidates.</div>` : ""}
      <div class="figure"><div class="fh"><h3>Held-out performance</h3><span class="sub">computed on test candidates only ${bx.prov("predicted", "model outputs scored against simulator labels")}</span></div>
        <span class="micro">Regression of S (random forest)</span><dl class="kv" style="max-width:420px"><dt>MAE</dt><dd>${pc(T.regression.mae, 2)} of base demand</dd><dt>RMSE</dt><dd>${pc(T.regression.rmse, 2)}</dd><dt>R²</dt><dd>${f3(T.regression.r2)}</dd></dl>
        <span class="micro">Severe-or-not (S ≥ ${c.tau}); threshold 0.5 for precision / recall</span>
        <div class="tablewrap"><table class="t"><thead><tr><th>Model</th><th>ROC-AUC</th><th>PR-AUC (AP)</th><th>Precision</th><th>Recall</th><th>F1</th><th>Brier</th><th>ECE</th></tr></thead><tbody>${cls(T.forest, "Random forest P(severe)")}${cls(T.logistic, "Logistic regression")}${cls(T.baseline, "Baseline: max post-outage loading")}</tbody></table></div>
        <span class="micro">Ranking: does the model put the truly worst candidates first? (k = ${T.rankingForest.k})</span>
        <div class="tablewrap"><table class="t"><thead><tr><th>Ranking by</th><th>Precision@k</th><th>Recall@k</th><th>NDCG@k</th></tr></thead><tbody><tr><td>Random forest mean S</td><td>${f3(T.rankingForest.precisionAtK)}</td><td>${f3(T.rankingForest.recallAtK)}</td><td>${f3(T.rankingForest.ndcgAtK)}</td></tr><tr><td>Baseline (max post-outage loading)</td><td>${f3(T.rankingBaseline.precisionAtK)}</td><td>${f3(T.rankingBaseline.recallAtK)}</td><td>${f3(T.rankingBaseline.ndcgAtK)}</td></tr></tbody></table></div>
        <span class="micro">Confusion matrix, forest at 0.5</span><table class="t" style="max-width:420px"><thead><tr><th></th><th>predicted severe</th><th>predicted not</th></tr></thead><tbody><tr><td>simulated severe</td><td>${cm.tp} (TP)</td><td style="color:var(--amber)">${cm.fn} (FN)</td></tr><tr><td>simulated not severe</td><td>${cm.fp} (FP)</td><td>${cm.tn} (TN)</td></tr></tbody></table>
        <p class="note">False negatives are the costly error here: a severe outage set ranked low would be simulated late or never. Metric definitions follow scikit-learn and are checked against it in the test suite.</p></div>
      <details class="figure"><summary class="micro" style="cursor:pointer">Training set (in-sample) — optimistic, not a performance estimate</summary><dl class="kv" style="max-width:420px"><dt>R²</dt><dd>${f3(Tr.regression.r2)}</dd><dt>MAE</dt><dd>${pc(Tr.regression.mae, 2)}</dd><dt>Forest ROC-AUC</dt><dd>${f3(Tr.forest.auc)}</dd><dt>Severe</dt><dd>${Tr.positives} of ${Tr.n}</dd></dl></details>`;
  }
  function plotsView() {
    const r = st.res, rows = testRows(), c = r.cfg, yb = rows.map((x) => (x.sev ? 1 : 0)), pf = rows.map((x) => x.p.pSevere);
    const pts = rows.map((x) => ({ x: x.y, y: x.p.mean, color: x.sev && !x.psev ? "#f2a93b" : !x.sev && x.psev ? "#d55181" : "#7cc4e8", r: x.sev !== x.psev ? 3.6 : 2.4, key: x.i, tip: `{${x.set.join(", ")}}: simulated ${pc(x.y, 2)}, predicted ${pc(x.p.mean, 2)} ± ${pc(x.p.sd, 2)}` }));
    const roc = rocCurve(yb, pf), pr = prCurve(yb, pf), rocB = rocCurve(yb, rows.map((x) => (Number.isFinite(x.x[3]) ? x.x[3] : r.scaler.med[3]))), cal = r.metrics.test.forest.cal.curve.filter((b) => b.n);
    const errs = rows.map((x) => x.p.mean - x.y), lo = Math.min(...errs), hi = Math.max(...errs), nb = 30, hist = new Array(nb).fill(0); errs.forEach((e) => hist[Math.min(nb - 1, Math.floor(((e - lo) / ((hi - lo) || 1)) * nb))]++);
    return `<div class="figure"><div class="fh"><h3>Prediction vs simulator outcome (test candidates)</h3><span class="sub">x = S from the simulator ${bx.prov("simulator")}, y = predicted mean ${bx.prov("predicted")}; amber = missed severe (FN), magenta = false alarm (FP); dashed = perfect agreement</span></div>${scatter(pts, { w: 760, h: 320, x: { label: "simulated S", pct: true, min: 0 }, y: { label: "predicted S", pct: true, min: 0 }, diag: true, aria: "prediction vs actual" })}</div>
      <div class="cols2"><div class="figure"><div class="fh"><h3>ROC</h3><span class="sub">forest vs baseline</span></div>${roc ? lineChart([{ name: "forest", color: SERIES.surrogate, pts: roc, label: `forest ${f3(r.metrics.test.forest.auc)}` }, { name: "baseline", color: "#808a98", pts: rocB, dash: "4 3", label: `baseline ${f3(r.metrics.test.baseline.auc)}` }], { w: 380, h: 260, x: { min: 0, max: 1, label: "false-positive rate" }, y: { min: 0, max: 1 }, rightPad: 90, aria: "ROC" }) : `<p class="note">Needs both classes in the test set.</p>`}</div>
        <div class="figure"><div class="fh"><h3>Precision–recall</h3><span class="sub">AP ${f3(r.metrics.test.forest.ap)}; base rate ${pc(r.metrics.test.positives / r.metrics.test.n)}</span></div>${pr ? lineChart([{ name: "forest", color: SERIES.surrogate, pts: pr, step: true, label: "forest" }], { w: 380, h: 260, x: { min: 0, max: 1, label: "recall" }, y: { min: 0, max: 1 }, rightPad: 60, hlines: [{ y: r.metrics.test.positives / r.metrics.test.n, label: "base", color: "#808a98" }], aria: "precision recall" }) : `<p class="note">No severe test candidates.</p>`}</div></div>
      <div class="cols2"><div class="figure"><div class="fh"><h3>Calibration of P(severe)</h3><span class="sub">fraction severe vs mean predicted, 10 bins (ECE ${f3(r.metrics.test.forest.cal.ece)})</span></div>${lineChart([{ name: "forest", color: SERIES.surrogate, pts: cal.map((b) => [b.meanPred, b.fracPos, `${b.n} candidates`]), marker: "circle", label: "forest" }], { w: 380, h: 260, x: { min: 0, max: 1, label: "mean predicted P(severe)" }, y: { min: 0, max: 1 }, rightPad: 60, hlines: [], aria: "calibration" })}<p class="note">Perfect calibration lies on the diagonal. The forest's leaf fractions are not calibrated by construction.</p></div>
        <div class="figure"><div class="fh"><h3>Prediction error</h3><span class="sub">predicted − simulated S, test candidates</span></div>${barChart(hist.map((n, i) => ({ label: `${(100 * (lo + (i + 0.5) * (hi - lo) / nb)).toFixed(1)}`, v: n, tip: `${n} candidates with error ≈ ${(100 * (lo + (i + 0.5) * (hi - lo) / nb)).toFixed(2)} pp` })), { w: 380, h: 260, rotate: true, y: { label: "candidates" }, aria: "error histogram" })}</div></div>`;
  }
  function impView() {
    const r = st.res, pi = r.importance.permutation, order = pi.items.map((x) => x.j).sort((a, b) => pi.items[b].mean - pi.items[a].mean);
    return `<div class="figure"><div class="fh"><h3>Permutation importance on held-out candidates</h3><span class="sub">drop in test R² when one feature is shuffled (${pi.repeats} repeats, seed ${pi.seed}); approximate, associative — not causal</span></div>
        ${barChart(order.map((j) => ({ label: FEATURES[j].key, v: Math.max(0, pi.items[j].mean), color: SERIES.surrogate, tip: `${FEATURES[j].label}: −${pi.items[j].mean.toFixed(4)} R² (± ${pi.items[j].sd.toFixed(4)})` })), { w: 760, h: 240, rotate: true, y: { label: "R² drop" }, aria: "permutation importance" })}
        <p class="note">Baseline test R² = ${f3(pi.base)}. Correlated features share importance: shuffling one leaves its correlates in place, so a low value does not mean a feature is irrelevant.</p></div>
      <div class="figure"><div class="fh"><h3>Impurity importance (training)</h3><span class="sub">share of variance reduction by splits on each feature; biased towards features with many split points</span></div>
        ${barChart(FEATURES.map((f, j) => ({ label: f.key, v: r.importance.impurity[j], color: "#808a98", tip: `${f.label}: ${pc(r.importance.impurity[j])}` })).sort((a, b) => b.v - a.v), { w: 760, h: 220, rotate: true, y: { pct: true }, aria: "impurity importance" })}</div>
      ${r.logistic ? `<div class="figure"><div class="fh"><h3>Logistic regression coefficients</h3><span class="sub">per standard deviation of each feature (standardised inputs)</span></div><div class="tablewrap"><table class="t"><thead><tr><th>Feature</th><th>Coefficient</th></tr></thead><tbody>${FEATURES.map((f, j) => `<tr><td>${esc(f.label)}</td><td>${r.logistic.coef[j].toFixed(4)}</td></tr>`).join("")}<tr><td>Intercept</td><td>${r.logistic.intercept.toFixed(4)}</td></tr></tbody></table></div></div>` : ""}`;
  }
  function candsView() {
    let rows = testRows(); const tau = st.res.cfg.tau;
    if (st.filter === "fn") rows = rows.filter((x) => x.sev && !x.psev); else if (st.filter === "fp") rows = rows.filter((x) => !x.sev && x.psev); else if (st.filter === "sev") rows = rows.filter((x) => x.sev);
    rows.sort(st.sort === "pred" ? (a, b) => b.p.mean - a.p.mean : st.sort === "actual" ? (a, b) => b.y - a.y : (a, b) => Math.abs(b.p.mean - b.y) - Math.abs(a.p.mean - a.y));
    const shown = rows.slice(0, 200);
    return `<div class="figure"><div class="fh"><h3>Test candidates</h3><span class="sub">${int(rows.length)} match · showing ${shown.length} (sorted)</span></div>
      <div class="row"><div class="chips" role="group" aria-label="Filter">${[["all", "all"], ["sev", `severe (S ≥ ${tau})`], ["fn", "missed severe (FN)"], ["fp", "false alarms (FP)"]].map(([k, n]) => `<button data-filter="${k}" aria-pressed="${st.filter === k}">${esc(n)}</button>`).join("")}</div>
        <select class="ctl" id="m-sort" aria-label="Sort"><option value="pred" ${st.sort === "pred" ? "selected" : ""}>by predicted S</option><option value="actual" ${st.sort === "actual" ? "selected" : ""}>by simulated S</option><option value="err" ${st.sort === "err" ? "selected" : ""}>by |error|</option></select></div>
      <div class="tablewrap"><table class="t"><thead><tr><th>Set</th><th>Predicted S ${bx.prov("predicted")}</th><th>Spread</th><th>P(severe)</th><th>Simulated S ${bx.prov("simulator")}</th><th>Error</th></tr></thead><tbody>
      ${shown.map((x) => `<tr class="click" data-cand="${x.i}" ${st.sel === x.i ? 'aria-current="true"' : ""}><td>{${x.set.join(", ")}}</td><td>${pc(x.p.mean, 2)}</td><td>± ${pc(x.p.sd, 2)}</td><td>${f3(x.p.pSevere)}</td><td>${pc(x.y, 2)}</td><td style="color:${x.sev && !x.psev ? "var(--amber)" : !x.sev && x.psev ? "#e27aa2" : "inherit"}">${(100 * (x.p.mean - x.y)).toFixed(2)} pp</td></tr>`).join("")}</tbody></table></div></div>`;
  }
  function alView() {
    const a = st.al, c = st.cfg, opt = (gi(c.grid).k[String(c.k)] || {}).Smax_dc;
    let fig = `<div class="empty">${st.job ? "Running…" : "Compare surrogate-guided search with random search at the same budget and seeds."}</div>`;
    if (a.res) {
      const series = ["surrogate", "random"].map((m) => { const rs = a.res[m], B = Math.max(...rs.map((r) => r.sims)), xs = []; for (let x = 1; x <= B; x = Math.max(x + 1, Math.round(x * 1.1))) xs.push(x); xs.push(B);
        const at = (r, x) => { let v = 0; for (const t of r.trace) if (t[0] <= x) v = t[1]; else break; return v; };
        return { name: m === "surrogate" ? "surrogate (UCB)" : "random", color: SERIES[m], pts: xs.map((x) => [x, rs.map((r) => at(r, x)).sort((p, q) => p - q)[Math.floor(rs.length / 2)]]), band: rs.length > 1 ? xs.map((x) => { const v = rs.map((r) => at(r, x)); return [x, Math.min(...v), Math.max(...v)]; }) : null, step: true }; });
      const s = (m) => summary(a.res[m].map((r) => r.best.S)), h = (m) => a.res[m].filter((r) => r.found).length;
      fig = `<div class="figure"><div class="fh"><h3>Best simulated S vs unique simulator evaluations</h3><span class="sub">median over ${a.reps} seeds (band: min–max) ${bx.prov("simulator")}</span></div>${lineChart(series, { w: 760, h: 280, x: { min: 1, log: true, label: "unique simulator evaluations" }, y: { min: 0, pct: true }, hlines: a.res.optimum != null ? [{ y: a.res.optimum, label: "optimum", color: "#e8ecf1" }] : [], aria: "active learning" })}
        <div class="tablewrap"><table class="t"><thead><tr><th>Strategy</th><th>Best S median</th><th>Found optimum</th><th>Unique sims (mean)</th></tr></thead><tbody>${["surrogate", "random"].map((m) => `<tr><td>${m === "surrogate" ? "Surrogate-guided (UCB)" : "Random"}</td><td>${pc(s(m).median, 2)}</td><td>${a.res.optimum != null ? `${h(m)} / ${a.reps}` : "no certified optimum"}</td><td>${int(Math.round(summary(a.res[m].map((r) => r.sims)).mean))}</td></tr>`).join("")}</tbody></table></div>
        ${a.record ? `<p class="note">Experiment <button class="btn sm" data-rec="${a.record.id}" style="height:20px">${esc(a.record.id)}</button>. Every point is a real simulator evaluation; the surrogate only chooses which candidate to evaluate next.</p>` : ""}</div>`;
    }
    return `<div class="figure"><div class="fh"><h3>Surrogate-assisted search</h3><span class="sub">start from a random sample → train a forest → score untested candidates → evaluate the top batch by mean + β·spread with the simulator → append labels → retrain</span></div>
      <div class="row"><div class="field"><label for="al-b">Budget</label><input class="ctl" id="al-b" type="number" min="50" max="3000" value="${a.budget}" style="width:100px"></div><div class="field"><label for="al-r">Seeds</label><input class="ctl" id="al-r" type="number" min="1" max="10" value="${a.reps}" style="width:80px"></div><div class="field"><label for="al-beta">β</label><input class="ctl" id="al-beta" type="number" step="0.5" min="0" max="5" value="${a.beta}" style="width:80px"></div><div class="field"><label for="al-s">Seed</label><input class="ctl" id="al-s" type="number" value="${a.seed}" style="width:80px"></div>
        <button class="btn primary" id="al-run" ${st.job ? "disabled" : ""} style="align-self:flex-end">Run on ${GRID_NAME[c.grid]}, k = ${c.k}</button></div>
      <p class="note">${opt != null ? `The exhaustive optimum S = ${pc(opt, 2)} is known from the stored table, so “found optimum” is certified.` : "No exhaustive table: results are best observed."} β = 0 is pure exploitation; larger β favours candidates the trees disagree on.</p></div>${fig}`;
  }
  function provView() {
    const p = st.res.provenance;
    return `<div class="figure"><div class="fh"><h3>Model provenance</h3><span class="sub">everything needed to reproduce these numbers</span></div><dl class="kv">
      <dt>Dataset version</dt><dd>${esc(p.datasetVersion)}</dd><dt>Network · k</dt><dd>${esc(GRID_NAME[p.dataset.grid])} · ${p.dataset.k}</dd><dt>Candidates</dt><dd style="font-family:var(--sans)">${esc(p.dataset.candidates)}</dd><dt>Label</dt><dd style="font-family:var(--sans)">${esc(p.labelDefinition)}</dd>
      <dt>Feature version</dt><dd>${esc(p.featureVersion)} (${p.features.length} features)</dd><dt>Split</dt><dd style="font-family:var(--sans)">${esc(p.split.strategy)}, seed ${p.split.seed}, test fraction ${p.split.testFrac}: ${p.split.train} train / ${p.split.test} test / ${p.split.excluded} excluded; branch overlap ${p.split.branchOverlap}</dd>
      <dt>Forest</dt><dd style="font-family:var(--sans)">${p.model.forest.trees} trees, depth ≤ ${p.model.forest.maxDepth}, min leaf ${p.model.forest.minLeaf}, mtry ${p.model.forest.mtry}, ${p.model.forest.splits}, seed ${p.model.forest.seed}</dd><dt>Logistic</dt><dd style="font-family:var(--sans)">L2, C = ${p.model.logistic.C}, Newton</dd>
      <dt>Started · finished</dt><dd>${esc(p.startedAt.slice(0, 19))} · ${esc(p.finishedAt.slice(11, 19))}</dd><dt>Labelling · training</dt><dd>${(p.timing.labellingMs / 1000).toFixed(1)} s · ${(p.timing.trainingMs / 1000).toFixed(1)} s ${bx.prov("measured")}</dd><dt>Simulator failures</dt><dd>${p.failures}</dd>
      <dt>Software</dt><dd>${esc(p.software)}</dd><dt>Model id</dt><dd>${esc(p.modelId)}</dd><dt>Experiment</dt><dd>${st.record ? `<button class="btn sm" data-rec="${st.record.id}" style="height:20px">${esc(st.record.id)}</button>` : "–"}</dd></dl>
      <p class="note">The model lives in this page's compute worker; reloading the page discards it (the record keeps its configuration and metrics, and re-training with the same seed reproduces them).</p></div>`;
  }
  function renderCenter() {
    TB.innerHTML = TABS.map(([k, n]) => `<button role="tab" data-tab="${k}" aria-selected="${st.tab === k}">${n}</button>`).join("");
    const keep = C.scrollTop;
    if (st.tab === "al") C.innerHTML = alView();
    else if (!st.res) C.innerHTML = `<div class="empty">${st.job ? "Labelling candidates with the simulator and training in the background…" : "Label a dataset with the simulator and train the models. Metrics appear only after training on held-out candidates."}</div>`;
    else if (st.tab === "land") { C.innerHTML = landView(); mountLand(); }
    else C.innerHTML = st.tab === "perf" ? perfView() : st.tab === "plots" ? plotsView() : st.tab === "imp" ? impView() : st.tab === "cands" ? candsView() : provView();
    C.scrollTop = keep;
  }
  // ------------------------------------------------------------------ APEX prediction landscape (k = 2): simulated below, predicted above
  st.land = { upper: "pred", testOnly: true, order: "loading" };
  function landData() {
    const r = st.res; if (!r || r.cfg.k !== 2) return null; const U = [...new Set(r.sets.flat())].sort((a, b) => a - b), m = U.length, pos = new Map(U.map((l, i) => [l, i]));
    const N = (m * (m - 1)) / 2, lower = new Float32Array(N).fill(NaN), upper = new Float32Array(N).fill(NaN), test = new Set(r.split.test), err = [];
    r.sets.forEach((s2, i) => { const a = pos.get(s2[0]), b = pos.get(s2[1]), idx = pairIndex(a, b, m); lower[idx] = r.y[i]; if (st.land.testOnly && !test.has(i)) return;
      const e = r.pred[i].mean - r.y[i]; upper[idx] = st.land.upper === "error" ? e : r.pred[i].mean; if (test.has(i) && Number.isFinite(e)) err.push(Math.abs(e)); });
    err.sort((a, b) => a - b); return { U, m, lower, upper, cover: r.sets.length / N, errMax: err.length ? err[Math.floor(0.98 * (err.length - 1))] : 0.1 };
  }
  function landView() {
    const r = st.res, d = landData(); if (!d) return `<div class="empty">The landscape is drawn for k = 2 (every pair is one cell). This model was trained with k = ${r.cfg.k}.</div>`;
    const onNet = store.get().netId === r.cfg.grid;
    return `<div class="figure"><div class="fh"><h3>Prediction landscape · simulated vs predicted, pair by pair</h3><span class="sub">lower triangle: S from the simulator ${bx.prov("simulator")} · upper triangle: ${st.land.upper === "error" ? "prediction − simulation" : "forest prediction"} ${bx.prov("predicted")} ${st.land.testOnly ? "for held-out test pairs only" : "for every pair (training pairs are in-sample)"}</span></div>
      <div class="ls-row"><div class="ls-host" id="m-land"></div><div class="ls-side">
        <div class="seg" role="group" aria-label="Upper triangle"><button data-lu="pred" aria-pressed="${st.land.upper === "pred"}">Predicted S</button><button data-lu="error" aria-pressed="${st.land.upper === "error"}">Error</button></div>
        <label class="chk"><input type="checkbox" id="m-land-test" ${st.land.testOnly ? "checked" : ""}>Held-out test pairs only</label>
        <div class="field"><label for="m-land-order">Order lines by</label><select class="ctl" id="m-land-order"><option value="loading" ${st.land.order === "loading" && onNet ? "selected" : ""} ${onNet ? "" : "disabled"}>base-case loading (high → low)</option><option value="branch" ${st.land.order === "branch" || !onNet ? "selected" : ""}>branch number</option></select></div>
        <div class="ls-key"><span class="ls-ramp" style="background:linear-gradient(90deg,${RAMPS.fault.map(css).join(",")})"></span><span class="mono">S (both triangles, same scale)</span></div>
        ${st.land.upper === "error" ? `<div class="ls-key"><span class="ls-ramp" style="background:linear-gradient(90deg,#7cc4e8,#2a313d,#a68cf2)"></span><span class="mono">−${pc(d.errMax, 0)} under · over +${pc(d.errMax, 0)}</span></div>` : ""}
        <div class="ls-key"><i style="background:#0a0d14;border:1px solid #2a313d"></i>not in the dataset${st.land.testOnly ? " / training pair" : ""}</div>
        <p class="note">${pc(d.cover, 0)} of all pairs were labelled by the simulator. If the model has learned the simulator, the two triangles mirror each other across the diagonal; where they differ, the model is wrong. Features use only the base case and topology (no cascade). Hover a cell; click to inspect the pair.</p></div></div></div>`;
  }
  function mountLand() {
    const host = $("m-land"), d = landData(); if (!host || !d) return; const r = st.res, net = store.get().net, onNet = net && net.id === r.cfg.grid;
    const rank = displayOrder(d.U, st.land.order === "loading" && onNet ? "loading" : "branch", onNet ? net.model.branches.map((b) => b.base_loading_dc) : undefined);
    const idxOf = new Map(r.sets.map((s2, i) => [`${s2[0]},${s2[1]}`, i]));
    const LV = createLandscape(host, { size: 470,
      describe: (h) => { const i = idxOf.get(`${d.U[h.a]},${d.U[h.b]}`); if (i == null) return `<b class="mono">{${d.U[h.a]}, ${d.U[h.b]}}</b> · not in the dataset`;
        return `<b class="mono">{${d.U[h.a]}, ${d.U[h.b]}}</b> · ${r.split.test.includes(i) ? "test" : "train"}<br>simulated ${pc(r.y[i], 2)} · predicted ${pc(r.pred[i].mean, 2)}`; },
      onPick: (h) => { const i = idxOf.get(`${d.U[h.a]},${d.U[h.b]}`); if (i == null) return; st.extra = null; st.sel = i; renderRight(); if (innerWidth <= 1180) root.classList.add("insp-open"); } });
    LV.setData({ universe: d.U, lower: d.lower, upper: d.upper, upperKind: st.land.upper, errMax: d.errMax, rank, aria: "simulated S below the diagonal, predicted above" });
  }

  function renderRight() {
    const r = st.res; let item = null;
    if (st.extra) item = st.extra; else if (r && st.sel != null) { const i = st.sel; item = { set: r.sets[i], x: r.X[i], pred: r.pred[i], actual: r.y[i], inTest: r.split.test.includes(i), inTrain: r.split.train.includes(i), contrib: (r.contributions.find((c) => c[0] === i) || [])[1] }; }
    const ask = r ? `<div class="sec"><div class="field"><label for="m-q">Predict any ${r.cfg.k}-branch set (indices)</label><div class="row"><input class="ctl" id="m-q" placeholder="e.g. ${r.cfg.k === 3 ? "6, 67, 140" : "35, 47"}" style="flex:1"><button class="btn sm" id="m-q-go">Predict</button></div></div></div>` : "";
    if (!item) { R.innerHTML = `<p class="note">${r ? "Click a test candidate (Candidates tab or a point in Plots), or open one from the Arena or the Theater." : "Train a model to inspect candidates."}</p>${ask}`; return; }
    const sc = r && r.scaler, ood = sc ? item.x.map((v, j) => (Number.isFinite(v) && (v < sc.lo[j] - 1e-12 || v > sc.hi[j] + 1e-12) ? j : -1)).filter((j) => j >= 0) : [];
    const contrib = item.contrib, sevPred = item.pred && item.pred.pSevere;
    const ranked = contrib ? contrib.contrib.map((v, j) => [j, v]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 8) : [];
    R.innerHTML = `<div class="sec"><b class="mono" style="font-size:12.5px">${esc(candidateId(r ? r.cfg.grid : st.cfg.grid, item.set))}</b>${item.inTrain ? `<div class="m-info">This candidate was in the training set: its prediction is in-sample.</div>` : ""}${ood.length ? `<div class="m-warn">Out of the training range on: ${ood.map((j) => FEATURES[j].label).join(", ")}. Treat the prediction with extra caution.</div>` : ""}</div>
      <div class="sec"><span class="micro">Prediction ${bx.prov("predicted")}</span>${item.pred ? `<dl class="kv"><dt>Predicted S (forest mean)</dt><dd>${pc(item.pred.mean, 2)}</dd><dt>Spread across trees</dt><dd>± ${pc(item.pred.sd, 2)}</dd><dt>P(severe) forest</dt><dd>${f3(sevPred)}</dd>${item.pLR != null ? `<dt>P(severe) logistic</dt><dd>${f3(item.pLR)}</dd>` : ""}</dl><p class="note">The spread is the disagreement between trees, not a calibrated interval.</p>` : `<p class="note">No prediction.</p>`}</div>
      <div class="sec"><span class="micro">Simulator outcome ${item.actual != null ? bx.prov("simulator") : bx.prov("unavailable", "not simulated yet")}</span>${item.actual != null ? `<dl class="kv"><dt>Simulated S</dt><dd>${pc(item.actual, 2)}</dd>${item.pred ? `<dt>Error (pred − sim)</dt><dd>${(100 * (item.pred.mean - item.actual)).toFixed(2)} pp</dd>` : ""}${item.verifiedMs ? `<dt>Simulated just now</dt><dd>${item.verifiedMs.toFixed(1)} ms</dd>` : ""}</dl>${item.record ? `<p class="note">Recorded <button class="btn sm" data-rec="${item.record.id}" style="height:20px">${esc(item.record.id)}</button></p>` : ""}` : `<p class="note">Not verified: this is only a prediction.</p><button class="btn sm primary" id="m-verify">Verify with the simulator</button>`}
        <div class="row"><button class="btn sm" id="m-theater">Open in the Theater</button></div></div>
      ${ranked.length ? `<div class="sec"><span class="micro">Why this prediction (approximate)</span><p class="note">Saabas path attribution: forest mean ${pc(contrib.bias, 2)} plus per-feature changes along the decision paths (sums exactly to the prediction). Associative, not causal.</p>
        <div class="list">${ranked.map(([j, v]) => `<div style="grid-template-columns:1fr auto;cursor:default"><span><span class="tt">${esc(FEATURES[j].label)}</span><span class="dd">value ${Number.isFinite(item.x[j]) ? +item.x[j].toPrecision(4) : "n/a (imputed)"} ${esc(FEATURES[j].unit)}</span></span><span class="mono" style="color:${v >= 0 ? "var(--amber)" : "var(--ice)"}">${v >= 0 ? "+" : ""}${(100 * v).toFixed(2)} pp</span></div>`).join("")}</div></div>` : ""}
      <div class="sec"><span class="micro">Features</span><dl class="kv">${FEATURES.map((f, j) => `<dt>${esc(f.label)}</dt><dd style="${ood.includes(j) ? "color:var(--amber)" : ""}">${Number.isFinite(item.x[j]) ? +item.x[j].toPrecision(4) : "n/a"}</dd>`).join("")}</dl></div>${ask}`;
  }
  function render() { const a = document.activeElement && root.contains(document.activeElement) ? document.activeElement.id : null, ls = L.scrollTop; renderLeft(); renderCenter(); renderRight(); L.scrollTop = ls; if (a && $(a)) $(a).focus(); }

  async function predictTyped(set) {
    if (!st.res) return; const m = gi(st.res.cfg.grid).n_branch; set = canon(set);
    if (set.length !== st.res.cfg.k || set.some((l) => !Number.isInteger(l) || l < 0 || l >= m)) { toast(`Enter ${st.res.cfg.k} distinct branch indices in 0–${m - 1}`); return; }
    const idx = st.res.sets.findIndex((s) => s.join() === set.join());
    if (idx >= 0) { st.extra = null; st.sel = idx; renderRight(); return; }
    try { const [it] = await predictSets([set]); st.sel = null; st.extra = { set, x: it.x, pred: it.pred, pLR: it.pLR, contrib: it.contrib, actual: null }; renderRight(); if (innerWidth <= 1180) root.classList.add("insp-open"); }
    catch (e) { toast(String(e.message || e)); }
  }
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button, tr[data-cand], [data-key]"); if (!b) return;
    if (b.dataset.tab) { st.tab = b.dataset.tab; renderCenter(); return; }
    if (b.dataset.lu) { st.land.upper = b.dataset.lu; renderCenter(); return; }
    if (b.dataset.rec) return bx.openRecord(b.dataset.rec);
    if (b.dataset.filter) { st.filter = b.dataset.filter; renderCenter(); return; }
    if (b.dataset.cand != null || b.dataset.key != null) { st.extra = null; st.sel = +(b.dataset.cand ?? b.dataset.key); renderRight(); if (st.tab === "cands") renderCenter(); if (innerWidth <= 1180) root.classList.add("insp-open"); return; }
    if (b.id === "m-train") train(); else if (b.id === "m-cancel") st.job && st.job.cancel(); else if (b.id === "al-run") runAL();
    else if (b.id === "m-verify") { const it = st.extra || (st.sel != null && { set: st.res.sets[st.sel] }); if (it) verify(it.set); }
    else if (b.id === "m-theater") { const it = st.extra || { set: st.res.sets[st.sel] }; bx.openScenario({ grid: (st.res ? st.res.cfg.grid : st.cfg.grid), set: it.set, label: `ML candidate {${it.set.join(", ")}}` }); }
    else if (b.id === "m-q-go") predictTyped(($("m-q").value || "").split(/[\s,]+/).filter(Boolean).map(Number));
  });
  root.addEventListener("change", (e) => {
    const t = e.target, c = st.cfg, num = (v) => (String(v).trim() === "" ? NaN : +v);
    if (t.id === "m-land-test") { st.land.testOnly = t.checked; renderCenter(); return; }
    if (t.id === "m-land-order") { st.land.order = t.value; renderCenter(); return; }
    if (t.id === "m-grid") c.grid = t.value; else if (t.id === "m-k") c.k = +t.value; else if (t.id === "m-sample") c.sample = Math.round(num(t.value)); else if (t.id === "m-tau") c.tau = num(t.value);
    else if (t.id === "m-split") c.split = t.value; else if (t.id === "m-tf") c.testFrac = num(t.value); else if (t.id === "m-seed") c.seed = Math.round(num(t.value));
    else if (t.id === "m-trees") c.trees = Math.round(num(t.value)); else if (t.id === "m-depth") c.depth = Math.round(num(t.value)); else if (t.id === "m-C") c.C = num(t.value);
    else if (t.id === "m-sort") { st.sort = t.value; renderCenter(); return; }
    else if (t.id === "al-b") st.al.budget = Math.round(num(t.value)); else if (t.id === "al-r") st.al.reps = Math.round(num(t.value)); else if (t.id === "al-beta") st.al.beta = num(t.value); else if (t.id === "al-s") st.al.seed = Math.round(num(t.value));
    else return;
    if (t.id.startsWith("al-")) return; renderLeft();
  });
  root.addEventListener("keydown", (e) => { if (e.target.id === "m-q" && e.key === "Enter") predictTyped(e.target.value.split(/[\s,]+/).filter(Boolean).map(Number)); });
  render();
  bx.rerunHooks["ml.train"] = async (rec) => { const c = rec.config; bx.setWorkspace("ml"); Object.assign(st.cfg, { grid: c.grid, k: c.k, sample: c.sample, tau: c.tau, split: c.split, testFrac: c.testFrac, seed: c.seed, trees: c.trees, depth: c.depth, C: c.C }); st.parent = rec.id; await train(); st.parent = null; return st.record; };
  bx.rerunHooks["ml.active"] = async (rec) => { const c = rec.config; bx.setWorkspace("ml"); Object.assign(st.cfg, { grid: c.grid, k: c.k }); Object.assign(st.al, { budget: c.budget, reps: c.reps, seed: c.seed, beta: c.beta }); st.tab = "al"; st.parent = rec.id; await runAL(); st.parent = null; return st.al.record; };
  bx.ml = { state: st, train, render,
    focusCandidate(grid, set) { if (!st.res || st.res.cfg.grid !== grid || st.res.cfg.k !== set.length) { st.cfg.grid = grid; st.cfg.k = set.length === 3 ? 3 : 2; render(); toast(`Train a model on ${GRID_NAME[grid]}, k = ${set.length} to see a prediction for {${set.join(", ")}}`); return; } predictTyped(set); } };
}
