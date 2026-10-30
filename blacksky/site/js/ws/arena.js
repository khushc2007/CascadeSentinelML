// Workspace 3 · Algorithm Arena. Two experiments with recorded seeds and repetitions, run in the compute worker:
//   A · controlled toy search — classical query counts vs Grover on a fully specified problem (query complexity, not wall-clock);
//   B · grid-candidate search — exhaustive, random, genetic, annealing, loading-ranked and ML-guided search on the real DC cascade objective,
//       compared against the exhaustive optimum where one exists. Grover on the grid objective is listed as proposed / not implemented.
import { $, esc, int, toast, GRID_NAME } from "../util.js";
import { getJSON } from "../engine.js";
import { binom, binomBig, groupDigits, validateK, candidateId } from "../sci/combin.js";
import { summary, bootstrapMeanCI, wilson, median, quantile, histogram } from "../sci/stats.js";
import { METHODS, BROWSER_EXHAUSTIVE_CAP } from "../sci/search.js";
import { limitationsFor } from "../sci/limitations.js";
import { lineChart, barChart, scatter, bindTips, SERIES, niceTicks } from "./charts.js";
import { landscapeFromProbes, displayOrder, landscapeStats, pairIndex } from "../sci/landscape.js";
import { createLandscape } from "./landscape-view.js";
import { RAMPS, css } from "../sci/overlays.js";

const ORDER = ["exhaustive", "random", "ga", "sa", "loading", "surrogate"];
const pc = (x, d = 2) => (x == null || Number.isNaN(x) ? "–" : `${(100 * x).toFixed(d)}%`);
const fmtMs = (ms) => (ms == null ? "–" : ms < 1000 ? `${ms.toFixed(0)} ms` : `${(ms / 1000).toFixed(2)} s`);

export function init(bx, root) {
  const { store } = bx;
  const st = { exp: "B", cfg: { grid: store.get().netId || "ieee118", k: "2", minLoad: 0, budget: 400, reps: 5, seed: 1, methods: { exhaustive: true, random: true, ga: true, sa: true, loading: true, surrogate: true }, beta: 1.0 },
    toy: { n: 6, M: 1, reps: 2000, seed: 3, res: null, record: null }, res: null, job: null, prog: null, record: null, err: null, sel: null, logX: true,
    land: null, ls: { order: "loading", rep: 0, u: 1, hide: new Set(), playing: false }, landJob: null };
  root.innerHTML = `<div class="ws-head"><h1>Algorithm <em>Arena</em></h1><span class="q">One problem for every method — candidate: a k-branch set; objective: S from the DC cascade simulator; budget: unique simulator evaluations. Seeded, repeated, and an optimum only when exhaustive enumeration certifies it.</span>
      <div class="acts"><div class="seg" role="group" aria-label="Experiment"><button data-exp="B" aria-pressed="true">B · Grid-candidate search</button><button data-exp="A">A · Toy search: Grover vs classical</button></div><button class="btn sm drawer-btn" id="a-insp-btn">Candidates</button></div></div>
    <section class="pane left" aria-label="Experiment configuration"><div class="pane-h"><h2 id="a-left-h">Configuration</h2></div><div class="pane-b" id="a-left"></div></section>
    <section class="pane center" aria-label="Results"><div class="pane-b" id="a-center"></div></section>
    <section class="pane right" aria-label="Ranked candidates"><div class="pane-h"><h2>Ranked candidates</h2><button class="btn sm ghost drawer-btn" id="a-insp-x">Close</button></div><div class="pane-b" id="a-right"></div></section>`;
  const L = $("a-left"), C = $("a-center"), R = $("a-right"); bindTips(root);
  $("a-insp-btn").onclick = () => root.classList.toggle("insp-open"); $("a-insp-x").onclick = () => root.classList.remove("insp-open");
  root.querySelector(".acts .seg").addEventListener("click", (e) => { const b = e.target.closest("[data-exp]"); if (!b) return; st.exp = b.dataset.exp; root.querySelectorAll("[data-exp]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); render(); });

  // ------------------------------------------------------------------ configuration and validation (experiment B)
  const gridInfo = (g) => bx.index.grids.find((x) => x.id === g);
  function eligible(g) { const n = store.get().net; if (n && n.id === g) return n.model.branches.filter((b) => b.in_service && (!st.cfg.minLoad || b.base_loading_dc >= st.cfg.minLoad)).length; return null; }
  function validate() {
    const c = st.cfg, errors = [], warnings = [], info = [], gi = gridInfo(c.grid), m = eligible(c.grid) ?? gi.n_branch, kv = validateK(c.k, m);
    if (!kv.ok) errors.push(kv.error); else if (kv.k < 1) errors.push("k must be at least 1."); else if (kv.k > 4) errors.push("This arena supports k ≤ 4 (the cascade engine accepts up to 8, but larger spaces are far beyond any budget here).");
    const N = kv.ok ? binom(m, kv.k) : 0;
    if (!Number.isInteger(c.budget) || c.budget < 10 || c.budget > 20000) errors.push("Budget must be an integer number of unique simulator evaluations in 10–20,000.");
    if (!Number.isInteger(c.reps) || c.reps < 1 || c.reps > 30) errors.push("Repetitions must be an integer in 1–30.");
    if (!Number.isInteger(c.seed)) errors.push("Seed must be an integer.");
    const ms = ORDER.filter((x) => c.methods[x]); if (!ms.length) errors.push("Choose at least one method.");
    if (c.methods.exhaustive && N > BROWSER_EXHAUSTIVE_CAP) errors.push(`Exhaustive enumeration of ${groupDigits(N)} candidates exceeds the in-browser cap of ${groupDigits(BROWSER_EXHAUSTIVE_CAP)}; untick it.${tableOpt(c) != null ? " The stored exhaustive table still provides the optimum." : ""}`);
    if (kv.ok && c.budget >= N) warnings.push(`The budget (${int(c.budget)}) covers the whole space (${groupDigits(N)}): every method will be cut to N.`);
    if (c.minLoad) info.push(`Universe restricted to branches with base loading ≥ ${(100 * c.minLoad).toFixed(0)} %: the stored optimum (all branches) no longer applies; only an in-browser exhaustive run can certify this universe.`);
    const sims = ms.reduce((a, x) => a + (METHODS[x].randomized ? c.reps : 1) * (x === "exhaustive" ? N : Math.min(c.budget, N)), 0);
    const per = c.grid === "ieee118" ? 0.8 : c.grid === "ieee30" ? 0.35 : 0.2;
    info.push(`About ${groupDigits(sims)} simulator evaluations in total — roughly ${fmtMs(sims * per)} at ~${per} ms per evaluation (a rough planning figure; the measured time is recorded after the run). Runs in the background.`);
    return { ok: !errors.length, errors, warnings, info, N, m, k: kv.k };
  }
  function tableOpt(c) { const gi = gridInfo(c.grid); const t = gi && gi.k[String(c.k)]; return !c.minLoad && t && t.available ? t.Smax_dc : null; }
  async function run() {
    const v = validate(); if (!v.ok) { toast(v.errors[0]); return; } const c = st.cfg, methods = ORDER.filter((x) => c.methods[x]);
    let optimum = tableOpt(c), optSrc = optimum != null ? `stored exhaustive DC table (Python, all C(${gridInfo(c.grid).n_branch}, ${v.k}) sets)` : null;
    st.res = null; st.err = null; st.record = null; st.prog = { run: 0, runs: 1 }; render();
    const t0 = performance.now();
    const job = bx.jobs.run("arena.grid", { grid: c.grid, k: v.k, minLoad: c.minLoad, methods, reps: c.reps, budget: c.budget, seed: c.seed, optimum, beta: c.beta },
      { family: "arena", timeoutMs: 20 * 60 * 1000, onProgress: (p) => { st.prog = p; bx.setJob({ label: `Arena ${p.method}`, pct: (100 * (p.run - 1 + p.done / Math.max(1, p.total))) / p.runs }); renderProgress(); } });
    st.job = job; render();
    try {
      const res = await job.promise; const wall = performance.now() - t0;
      const ex = res.runs.find((r) => r.method === "exhaustive" && r.status === "completed");
      if (ex) { if (optimum != null && Math.abs(ex.best.S - optimum) > 1e-9) res.warnings = [`In-browser exhaustive optimum ${ex.best.S} differs from the stored table ${optimum}.`]; if (optimum == null) { optimum = ex.best.S; optSrc = "in-browser exhaustive enumeration of this universe"; } }
      // recompute success / gap against the certified optimum when it came from the in-browser exhaustive run
      if (optimum != null) res.runs.forEach((r) => { if (r.best) { r.found = r.best.S >= optimum - 1e-9; r.gap = Math.max(0, optimum - r.best.S); if (r.hitAt == null && r.found) r.hitAt = r.trace.find((t) => t[1] >= optimum - 1e-9)?.[0] ?? null; } });
      st.res = { ...res, optimum, optSrc, cfg: { ...c, k: v.k }, wall, cancelled: res.status === "cancelled" || job.cancelReason != null };
      st.ls.u = 1; st.ls.playing = false;
      if (v.k === 2 && ex && ex.probes && res.universeList) st.land = { grid: c.grid, universe: res.universeList, lower: landscapeFromProbes(res.universeList, ex.probes, ex.probeS), source: "the in-browser exhaustive run of this comparison" };
      else if (st.land && st.land.grid !== c.grid) st.land = null;
      st.record = bx.registry.add({ parent: st.parent || null, type: "arena.grid", name: `Arena B · ${GRID_NAME[c.grid]} k=${v.k} · ${methods.length} methods × ${c.reps} reps · budget ${c.budget}`, config: { grid: c.grid, k: v.k, universe: c.minLoad ? `in-service branches with base loading ≥ ${c.minLoad}` : "all in-service branches", m: res.universe, N: res.N,
          objective: "S: fraction of base demand unserved at termination (DC cascade, all-overloaded policy)", budget: c.budget, reps: c.reps, seed: c.seed, methods, beta: c.beta, environment: { parallelism: "1 Web Worker, sequential runs", cores: navigator.hardwareConcurrency || null } },
        seed: c.seed, provenance: "simulator", status: st.res.cancelled ? "cancelled" : "completed", scenarioIds: [], results: summarize(st.res), warnings: res.warnings || [], durationMs: wall, limitations: limitationsFor("arena.grid"),
        links: topCandidates(st.res).slice(0, 10).map((x) => ({ kind: "candidate", id: candidateId(c.grid, x.set) })), log: res.runs.map((r) => ({ t: r.ms || 0, msg: `${r.method} seed ${r.seed}: ${r.status}${r.best ? `, best S ${r.best.S.toFixed(6)} after ${r.sims} sims` : r.error ? `, ${r.error}` : ""}` })) });
    } catch (e) { st.err = String(e.message || e); }
    st.job = null; st.prog = null; bx.setJob(null); render();
  }
  function byMethod(res) { const g = {}; for (const r of res.runs) (g[r.method] = g[r.method] || []).push(r); return g; }
  function summarize(res) {
    const out = { optimum: res.optimum, optimumSource: res.optSrc, N: res.N, perMethod: {} };
    for (const [m, rs] of Object.entries(byMethod(res))) { const ok = rs.filter((r) => r.best); const best = ok.map((r) => r.best.S);
      out.perMethod[m] = { runs: rs.length, failed: rs.filter((r) => r.status === "failed").length, bestS: summary(best), meanCI: bootstrapMeanCI(best, { seed: 99 }), success: res.optimum != null ? wilson(ok.filter((r) => r.found).length, ok.length) : null,
        evalsToOptimum: summary(ok.filter((r) => r.hitAt != null).map((r) => r.hitAt)), sims: summary(ok.map((r) => r.sims)), proposals: summary(ok.map((r) => r.proposals)), cacheHits: summary(ok.map((r) => r.cacheHits)), wallMs: summary(ok.map((r) => r.ms)), simMs: summary(ok.map((r) => r.simMs)) }; }
    return out;
  }
  function topCandidates(res) {
    const m = new Map(); for (const r of res.runs) for (const t of r.top || []) { const k = t.set.join(","); const e = m.get(k) || { set: t.set, S: t.S, methods: new Set(), runs: 0 }; e.methods.add(r.method); e.runs++; m.set(k, e); }
    return [...m.values()].sort((a, b) => b.S - a.S || a.set.join(",").localeCompare(b.set.join(","))).slice(0, 60);
  }

  // ------------------------------------------------------------------ experiment A (toy)
  async function runToy() {
    const t = st.toy; if (!(t.n >= 2 && t.n <= 8) || !(t.M >= 1 && t.M < 2 ** t.n) || !(t.reps >= 10 && t.reps <= 20000)) { toast("n in 2–8, 1 ≤ M < 2^n, repetitions 10–20,000"); return; }
    const marked = [], rng = (await import("../sci/rng.js")).makeRng(t.seed), N = 2 ** t.n; while (marked.length < t.M) { const x = rng.int(N); if (!marked.includes(x)) marked.push(x); }
    t.res = null; t.record = null; render(); const t0 = performance.now();
    const job = bx.jobs.run("arena.toy", { n: t.n, marked, reps: t.reps, seed: t.seed }, { family: "arena", timeoutMs: 120000 }); st.job = job; render();
    try { const res = await job.promise; t.res = { ...res, marked, wall: performance.now() - t0 };
      const rq = summary(res.randomQueries), gq = summary(res.groverQueries);
      t.record = bx.registry.add({ parent: st.parent || null, type: "arena.toy", name: `Arena A · toy N=${N}, M=${t.M}: classical vs Grover (${t.reps} reps)`, config: { n: t.n, N, marked, reps: t.reps, seed: t.seed, oracle: "lookup (marked set known to the experimenter)", groverIterations: res.rStar },
        seed: t.seed, provenance: "emulated", results: { classicalExpected: res.classicalExpected, classicalRandom: rq, classicalScanFirstHit: res.scanQueries[0], groverRStar: res.rStar, groverPExact: res.pExact, groverPTheory: res.pTheory, groverQueriesRepeatUntilSuccess: gq, simulatorMs: res.simMs, compiled: res.stats },
        durationMs: t.res.wall, limitations: limitationsFor("arena.toy"), log: [{ t: 0, msg: `classical: ${t.reps} seeded random orders` }, { t: res.simMs, msg: `Grover: elementary-gate statevector, r* = ${res.rStar}` }] });
    } catch (e) { st.err = String(e.message || e); }
    st.job = null; render();
  }

  // ------------------------------------------------------------------ rendering
  function renderLeft() {
    if (st.exp === "A") { const t = st.toy, N = 2 ** t.n;
      L.innerHTML = `<div class="sec"><p class="note">A fully specified unstructured search: N = 2ⁿ items, M of them marked, the oracle answers “is item i marked?”. Classical random search and Grover are compared by <b>oracle queries</b>; the Grover circuit is simulated classically.</p>
        <div class="grid2"><div class="field"><label for="t-n">n (2–8)</label><input class="ctl" id="t-n" type="number" min="2" max="8" value="${t.n}"></div><div class="field"><label for="t-m">Marked M</label><input class="ctl" id="t-m" type="number" min="1" max="${N - 1}" value="${t.M}"></div></div>
        <div class="grid2"><div class="field"><label for="t-reps">Repetitions</label><input class="ctl" id="t-reps" type="number" min="10" max="20000" value="${t.reps}"></div><div class="field"><label for="t-seed">Seed</label><input class="ctl" id="t-seed" type="number" value="${t.seed}"></div></div>
        <button class="btn primary" id="t-run" ${st.job ? "disabled" : ""}>${st.job ? "Running…" : "Run experiment A"}</button></div>
        <div class="sec"><span class="micro">What this does not show</span><p class="note">It does not establish any quantum advantage for the power-grid problem: the oracle here is a free lookup, the circuit is simulated, and wall-clock time on hardware is not modelled. See Experiment B and the Evidence &amp; Resource Lab.</p></div>`; return; }
    const c = st.cfg, v = validate(), gi = gridInfo(c.grid), opt = tableOpt(c);
    L.innerHTML = `<div class="sec"><span class="micro">Problem</span>
        <div class="grid2"><div class="field"><label for="a-grid">Network</label><select class="ctl" id="a-grid">${bx.index.grids.map((g) => `<option value="${g.id}" ${c.grid === g.id ? "selected" : ""}>${GRID_NAME[g.id]}</option>`).join("")}</select></div>
        <div class="field"><label for="a-k">Outages k</label><input class="ctl ${v.errors.some((e) => /^k /.test(e)) ? "bad" : ""}" id="a-k" type="number" min="1" max="4" value="${esc(c.k)}"></div></div>
        <div class="field"><label for="a-min">Candidate universe</label><select class="ctl" id="a-min"><option value="0" ${!c.minLoad ? "selected" : ""}>All in-service branches</option>${[0.3, 0.5].map((x) => `<option value="${x}" ${c.minLoad === x ? "selected" : ""}>Base loading ≥ ${x * 100} %${store.get().netId !== c.grid ? " (needs this network loaded in the Theater)" : ""}</option>`).join("")}</select></div>
        <div class="formula">N = C(${v.m}, ${v.k ?? "k"}) = ${v.k != null ? groupDigits(binomBig(v.m, v.k)) : "–"}<br><span class="faint">objective: S = final unserved demand / base demand (DC cascade, all-overloaded trips)</span></div>
        <dl class="kv"><dt>Known optimum</dt><dd>${opt != null ? `${pc(opt)} ${bx.prov("simulator", "stored exhaustive table")}` : `none ${bx.prov("unavailable", "no exhaustive table for this setting")}`}</dd></dl></div>
      <div class="sec"><span class="micro">Methods</span>${ORDER.map((x) => `<label class="chk" title="${esc(METHODS[x].note)}"><input type="checkbox" data-m="${x}" ${c.methods[x] ? "checked" : ""}><i style="display:inline-block;width:10px;height:3px;background:${SERIES[x]};border-radius:2px"></i>${esc(METHODS[x].label)} <span class="faint">· ${esc(METHODS[x].kind)}</span></label>`).join("")}
        <label class="chk" title="${esc(METHODS.grover_grid.note)}"><input type="checkbox" disabled><i style="display:inline-block;width:10px;height:3px;background:${SERIES.quantum};border-radius:2px"></i>Grover on the grid objective ${bx.prov("proposed")}</label>
        <p class="note">Grover on the cascade objective would need a reversible quantum circuit of the whole cascade simulation as its oracle; none exists here, so it is not run and no number is shown for it.</p></div>
      <div class="sec"><span class="micro">Budget and repetitions</span><div class="grid3"><div class="field"><label for="a-budget">Budget</label><input class="ctl" id="a-budget" type="number" min="10" max="20000" value="${c.budget}"></div><div class="field"><label for="a-reps">Reps</label><input class="ctl" id="a-reps" type="number" min="1" max="30" value="${c.reps}"></div><div class="field"><label for="a-seed">Seed</label><input class="ctl" id="a-seed" type="number" value="${c.seed}"></div></div>
        <p class="note">Budget = unique simulator evaluations per run. Randomised methods run once per seed (seed, seed+1, …); deterministic ones once. Stopping: budget reached (or the whole space evaluated). Compute: 1 Web Worker, sequential, ${navigator.hardwareConcurrency || "?"} logical cores reported.</p></div>
      <div class="sec"><span class="micro">Validate and run</span>${v.errors.map((e) => `<div class="m-err">${esc(e)}</div>`).join("")}${v.warnings.map((e) => `<div class="m-warn">${esc(e)}</div>`).join("")}${v.info.map((e) => `<div class="m-info">${esc(e)}</div>`).join("")}
        <div class="row"><button class="btn primary" id="a-run" ${v.ok && !st.job ? "" : "disabled"}>${st.job ? "Running…" : "Run comparison"}</button>${st.job ? `<button class="btn" id="a-cancel">Cancel</button>` : ""}</div><div id="a-prog"></div>
        ${st.err ? `<div class="m-err">${esc(st.err)}</div>` : ""}</div>`;
    renderProgress();
  }
  function renderProgress() { const el = $("a-prog"), p = st.prog; if (!el) return; if (!p || !st.job) { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="prog"><i style="width:${((100 * ((p.run || 1) - 1 + (p.done || 0) / Math.max(1, p.total || 1))) / Math.max(1, p.runs || 1)).toFixed(1)}%"></i></div><p class="note mono" style="font-size:11px">run ${p.run || 0}/${p.runs || "?"} · ${esc(p.method || "")} seed ${p.seed ?? ""} · ${int(p.done || 0)}/${int(p.total || 0)} sims · best ${p.best >= 0 ? pc(p.best) : "–"}</p>`; }

  function renderCenter() {
    if (st.exp === "A") { C.innerHTML = toyView(); return; }
    const res = st.res; if (!res) { C.innerHTML = `<div class="empty">${st.job ? "Running in the background — the page stays responsive. Results appear when the runs finish (no animation is shown for computations that have not run)." : "Configure the comparison and run it. Every curve shown afterwards is a recorded run."}</div>`; return; }
    const g = byMethod(res), opt = res.optimum, ms = ORDER.filter((m) => g[m]);
    // best-so-far traces: median across repetitions with interquartile band, at common evaluation counts
    const series = ms.map((m) => { const rs = g[m].filter((r) => r.trace), B = Math.max(...rs.map((r) => r.sims)), xs = [];
      for (let x = 1; x <= B; x = Math.max(x + 1, Math.round(x * 1.12))) xs.push(x); if (xs[xs.length - 1] !== B) xs.push(B);
      const at = (r, x) => { let v = 0; for (const t of r.trace) if (t[0] <= x) v = t[1]; else break; return v; };
      const pts = xs.map((x) => { const vals = rs.map((r) => at(r, Math.min(x, r.sims))); return [x, median(vals), quantile(vals, 0.25), quantile(vals, 0.75)]; });
      return { name: METHODS[m].label, color: SERIES[m], pts: pts.map((p) => [p[0], p[1]]), band: rs.length > 1 ? pts.map((p) => [p[0], p[2], p[3]]) : null, step: true, label: METHODS[m].label.split(" ")[0] }; });
    const traceFig = `<div class="figure"><div class="fh"><h3>Best-so-far objective vs unique simulator evaluations</h3><span class="sub">median over repetitions (line) and interquartile range (band) ${bx.prov("simulator")}</span><span style="margin-left:auto"><label class="chk"><input type="checkbox" id="a-logx" ${st.logX ? "checked" : ""}>log x</label></span></div>
      ${lineChart(series, { w: 780, h: 290, x: { min: 1, log: st.logX, label: "unique simulator evaluations" }, y: { min: 0, pct: true, max: Math.max(opt ?? 0, ...res.runs.filter((r) => r.best).map((r) => r.best.S)) * 1.08 || 0.1 }, hlines: opt != null ? [{ y: opt, label: "optimum", color: "#e8ecf1" }] : [], aria: "best so far" })}
      <div class="legend">${ms.map((m) => `<span><i style="background:${SERIES[m]}"></i>${esc(METHODS[m].label)}</span>`).join("")}${opt != null ? `<span><i style="background:#e8ecf1"></i>exhaustive optimum (${esc(res.optSrc)})</span>` : ""}</div></div>`;
    // distribution of the best value across repetitions
    const W = 780, rowH = 30, H = 34 + ms.length * rowH, x0 = 0, x1 = Math.max(opt ?? 0, ...res.runs.filter((r) => r.best).map((r) => r.best.S)) * 1.05 || 0.1, sx = (v) => 150 + ((v - x0) / (x1 - x0)) * (W - 170);
    const strip = [`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="best value per repetition">`];
    ms.forEach((m, i) => { const y = 20 + i * rowH + rowH / 2, vals = g[m].filter((r) => r.best).map((r) => r.best.S); strip.push(`<text x="0" y="${y + 4}" fill="#a8b1bd" font-size="11.5" font-family="Archivo, sans-serif">${esc(METHODS[m].label)}</text><line x1="150" x2="${W - 20}" y1="${y}" y2="${y}" stroke="#161b24"/>`);
      vals.forEach((v, j) => strip.push(`<circle cx="${sx(v)}" cy="${y + ((j % 5) - 2) * 3}" r="4" fill="${SERIES[m]}" fill-opacity=".85" data-tip="${esc(`${METHODS[m].label}, seed ${g[m].filter((r) => r.best)[j].seed}: best S ${pc(v, 3)}`)}"/>`));
      if (vals.length > 1) strip.push(`<line x1="${sx(median(vals))}" x2="${sx(median(vals))}" y1="${y - 10}" y2="${y + 10}" stroke="#e8ecf1" stroke-width="2"/>`); });
    if (opt != null) strip.push(`<line x1="${sx(opt)}" x2="${sx(opt)}" y1="10" y2="${H - 4}" stroke="#e8ecf1" stroke-dasharray="4 4"/><text x="${sx(opt) - 4}" y="10" text-anchor="end" fill="#e8ecf1" font-size="10.5" font-family="JetBrains Mono, monospace">optimum ${pc(opt)}</text>`);
    strip.push(`<g class="ax">${niceTicks(x0, x1, 5).filter((v) => v <= x1).map((v) => `<text x="${sx(v)}" y="${H}" text-anchor="middle">${pc(v, 0)}</text>`).join("")}</g></svg>`);
    const distFig = `<div class="figure"><div class="fh"><h3>Best value found, per repetition</h3><span class="sub">each dot is one recorded run; white tick = median</span></div>${strip.join("")}</div>`;
    // table of measurements
    const sm = summarize(res).perMethod;
    const rows = ms.map((m) => { const s = sm[m]; return `<tr><td><i style="display:inline-block;width:10px;height:3px;background:${SERIES[m]};border-radius:2px;margin-right:6px;vertical-align:3px"></i>${esc(METHODS[m].label)}</td><td>${s.runs}${s.failed ? ` (${s.failed} failed)` : ""}</td><td>${int(Math.round(s.sims.mean))}</td><td>${int(Math.round(s.proposals.mean))}</td>
      <td>${s.runs > 1 ? `${pc(s.bestS.median)} [${pc(s.bestS.q1)}, ${pc(s.bestS.q3)}]` : pc(s.bestS.mean)}</td><td>${s.meanCI ? `${pc(s.meanCI.lo)} – ${pc(s.meanCI.hi)}` : `<span class="faint" title="needs ≥ 5 repetitions">–</span>`}</td>
      <td>${s.success ? `${(100 * s.success.p).toFixed(0)}% <span class="faint">[${(100 * s.success.lo).toFixed(0)}, ${(100 * s.success.hi).toFixed(0)}]</span>` : "–"}</td><td>${s.evalsToOptimum.n ? `${int(Math.round(s.evalsToOptimum.median))}${s.evalsToOptimum.n < s.runs ? ` <span class="faint">(${s.evalsToOptimum.n}/${s.runs})</span>` : ""}` : "–"}</td><td>${fmtMs(s.wallMs.median)}</td><td>${fmtMs(s.simMs.median)}</td></tr>`; }).join("");
    const table = `<div class="figure"><div class="fh"><h3>Measurements per method</h3><span class="sub">${opt != null ? `success = run found the optimum (Wilson 95 % interval)` : "no certified optimum: values are best observed"} · CI of the mean: percentile bootstrap, only with ≥ 5 repetitions ${bx.prov("measured", "times")} ${bx.prov("simulator", "objective values")}</span></div>
      <div class="tablewrap"><table class="t"><thead><tr><th>Method</th><th>Runs</th><th>Unique sims</th><th>Proposals</th><th>Best S median [IQR]</th><th>95% CI mean</th><th>Found optimum</th><th>Sims to optimum</th><th>Wall time</th><th>of which simulating</th></tr></thead><tbody>${rows}
      <tr><td><i style="display:inline-block;width:10px;height:3px;background:${SERIES.quantum};border-radius:2px;margin-right:6px;vertical-align:3px"></i>Grover on the grid objective</td><td colspan="9">${bx.prov("proposed")} not implemented — no quantum oracle for the cascade objective; nothing measured</td></tr></tbody></table></div>
      <p class="note">“Proposals” counts candidates a method generated (including repeats it had already evaluated); only unique simulations consume the budget. Proposal cost is negligible here next to evaluation cost (≈ ${fmtMs(sm[ms[0]]?.simMs.median / Math.max(1, sm[ms[0]]?.sims.mean || 1))} per simulation).</p></div>`;
    C.innerHTML = `<div class="statrow"><div class="stat"><span class="k">Search space N</span><span class="v">${groupDigits(res.N)}</span></div><div class="stat"><span class="k">Budget per run</span><span class="v">${int(res.cfg.budget)}</span></div><div class="stat"><span class="k">Repetitions</span><span class="v">${res.cfg.reps}</span></div>
        <div class="stat"><span class="k">Optimum ${opt != null ? bx.prov("simulator") : bx.prov("unavailable")}</span><span class="v">${opt != null ? pc(opt) : "unknown"}</span></div><div class="stat"><span class="k">Wall time ${bx.prov("measured")}</span><span class="v">${fmtMs(res.wall)}</span></div></div>
      ${res.cancelled ? `<div class="m-warn">Cancelled: only the runs that finished are shown and recorded.</div>` : ""}${(res.warnings || []).map((w) => `<div class="m-warn">${esc(w)}</div>`).join("")}
      ${st.record ? `<p class="note">Experiment <button class="btn sm" data-rec="${st.record.id}" style="height:20px">${esc(st.record.id)}</button> · export: <button class="btn sm" id="a-json" style="height:20px">JSON</button> <button class="btn sm" id="a-csv" style="height:20px">CSV</button> <button class="btn sm" id="a-report" style="height:20px">Report</button></p>` : ""}
      ${traceFig}${landscapeFig(res)}${distFig}${table}${explorer(res)}`;
    mountLandscape();
  }

  // ------------------------------------------------------------------ APEX search landscape (k = 2): where each method looked
  let LV = null, raf = 0;
  function landscapeFig(res) {
    if (res.cfg.k !== 2) return `<div class="figure"><div class="fh"><h3>Search landscape</h3><span class="sub">drawn for k = 2 (every pair is one cell); this comparison used k = ${res.cfg.k}</span></div></div>`;
    const ok = st.land && st.land.grid === res.cfg.grid && (!res.cfg.minLoad), m = res.universe, N = res.N, onNet = store.get().netId === res.cfg.grid;
    const reps = Math.max(...res.runs.map((r) => (METHODS[r.method]?.randomized ? 1 : 0)).concat(0)) ? res.cfg.reps : 1, seeds = Array.from({ length: reps }, (_, i) => res.cfg.seed + i);
    const ms = ORDER.filter((x) => res.runs.some((r) => r.method === x && r.probes));
    const stats = ok ? landscapeStats(st.land.lower, m) : null;
    return `<div class="figure" id="a-land-fig"><div class="fh"><h3>Search landscape · all ${groupDigits(N)} pairs</h3><span class="sub">one cell per pair of lines (lower triangle), colour = S from the simulator; dots = the pairs a method evaluated, in order ${bx.prov("simulator")}</span></div>
      ${ok ? `<div class="ls-row"><div class="ls-host" id="a-land"></div><div class="ls-side">
        <div class="row" style="gap:6px"><button class="btn sm primary" id="a-ls-play">${st.ls.playing ? "Pause" : "Replay the search"}</button><span class="mono faint" id="a-ls-n" style="font-size:11px"></span></div>
        <input type="range" id="a-ls-u" min="0" max="1000" value="${Math.round(st.ls.u * 1000)}" aria-label="Replay position (log scale of evaluations)" style="width:100%">
        <div class="ls-chips">${ms.map((x) => `<button class="btn sm" data-lsm="${x}" aria-pressed="${!st.ls.hide.has(x)}"><i style="background:${SERIES[x]}"></i>${esc(METHODS[x].label.split(" ")[0])}</button>`).join("")}</div>
        <div class="grid2"><div class="field"><label for="a-ls-order">Order lines by</label><select class="ctl" id="a-ls-order"><option value="loading" ${st.ls.order === "loading" ? "selected" : ""} ${onNet ? "" : "disabled"}>base-case loading (high → low)</option><option value="branch" ${st.ls.order === "branch" || !onNet ? "selected" : ""}>branch number</option></select></div>
          <div class="field"><label for="a-ls-rep">Repetition</label><select class="ctl" id="a-ls-rep">${seeds.map((sd, i) => `<option value="${i}" ${st.ls.rep === i ? "selected" : ""}>seed ${sd}</option>`).join("")}</select></div></div>
        <div class="ls-key"><span class="ls-ramp" style="background:linear-gradient(90deg,${RAMPS.fault.map(css).join(",")})"></span><span class="mono">S 0 → ${pc(stats.max, 1)}</span></div>
        <div class="ls-key"><i style="background:rgb(22,27,36)"></i>S = 0 (no demand lost) <i style="background:#0a0d14;border:1px solid #2a313d"></i>not evaluated</div>
        <dl class="kv"><dt>Pairs evaluated</dt><dd>${groupDigits(stats.evaluated)}</dd><dt>Lose any demand</dt><dd>${pc(stats.positive / Math.max(1, stats.evaluated), 1)}</dd><dt>Most damaging</dt><dd>{${stats.argmax.map((i) => st.land.universe[i]).join(", ")}} · ${pc(stats.max, 2)}</dd></dl>
        <p class="note">Values from ${esc(st.land.source)}. Ordering by base-case loading shows whether damage concentrates among heavily loaded lines; it is a display order, not a model. Hover a cell for its pair; click to open it in the Theater.</p></div></div>`
      : `<div class="empty" style="min-height:120px">${st.landJob ? `Computing all ${groupDigits(N)} pairs in the background…` : `The landscape needs S for every pair. Tick “Exhaustive enumeration” and run, or <button class="btn sm" id="a-ls-compute">compute the full landscape</button> (${groupDigits(N)} simulations, ≈ ${fmtMs(N * (res.cfg.grid === "ieee118" ? 0.6 : 0.3))} in the background).`}</div>`}</div>`;
  }
  function probeSets(res) {
    const pos = new Map(st.land.universe.map((l, i) => [l, i])), out = [];
    for (const x of ORDER) { if (x === "exhaustive") continue; const rs = res.runs.filter((r) => r.method === x && r.probes); if (!rs.length) continue; const r = rs[Math.min(st.ls.rep, rs.length - 1)];
      const pairs = []; for (let i = 0; i + 1 < r.probes.length; i += 2) { const a = pos.get(r.probes[i]), b = pos.get(r.probes[i + 1]); if (a != null && b != null) pairs.push([a, b]); }
      out.push({ method: x, color: SERIES[x], pairs, hidden: st.ls.hide.has(x) }); }
    return out;
  }
  function mountLandscape() {
    const host = $("a-land"); if (!host || !st.land || !st.res) { LV = null; return; } const res = st.res, U = st.land.universe, m = U.length, net = store.get().net;
    const rank = displayOrder(U, st.ls.order === "loading" && net && net.id === res.cfg.grid ? "loading" : "branch", net && net.id === res.cfg.grid ? net.model.branches.map((b) => b.base_loading_dc) : undefined);
    const probesFor = probeSets(res), hasEx = res.runs.some((r) => r.method === "exhaustive" && r.probes), exN = hasEx ? res.N : 0;
    LV = createLandscape(host, { size: 470,
      describe: (h) => { const v = st.land.lower[h.idx], ab = `{${U[h.a]}, ${U[h.b]}}`, by = probesFor.filter((P) => P.pairs.some(([a, b]) => (a === h.a && b === h.b) || (a === h.b && b === h.a))).map((P) => METHODS[P.method].label.split(" ")[0]);
        return `<b class="mono">${ab}</b> · S ${Number.isFinite(v) ? pc(v, 2) : "not evaluated"}${by.length ? `<br><span class="faint">evaluated by ${esc(by.join(", "))}</span>` : ""}`; },
      onPick: (h) => { const set = [U[h.a], U[h.b]]; bx.openScenario({ grid: res.cfg.grid, set, label: `Landscape pair {${set.join(", ")}}`, play: true }); } });
    LV.setData({ universe: U, lower: st.land.lower, rank, aria: `S for all ${m * (m - 1) / 2} pairs of ${m} lines` });
    const ex = res.runs.find((r) => r.method === "exhaustive" && r.best); const best = ex ? ex.best.set : landscapeStats(st.land.lower, m).argmax?.map((i) => U[i]);
    const pos = new Map(U.map((l, i) => [l, i])); if (best) LV.setMark([pos.get(best[0]), pos.get(best[1])]);
    const maxEval = Math.max(exN, ...probesFor.map((P) => P.pairs.length), 1);
    const apply = () => { const n = st.ls.u >= 0.999 ? maxEval : Math.round(10 ** (st.ls.u * Math.log10(maxEval + 1)) - 1);
      probesFor.forEach((P) => (P.cursor = n)); LV.setProbes(probesFor); if (hasEx) LV.setReveal(st.ls.hide.has("exhaustive") ? null : Math.min(exN, n));
      const el = $("a-ls-n"); if (el) el.textContent = `${groupDigits(n)} evaluations${n < maxEval ? "" : " (end)"}`; const sl = $("a-ls-u"); if (sl && document.activeElement !== sl) sl.value = String(Math.round(st.ls.u * 1000)); };
    st.ls.apply = apply; apply();
  }
  function playLandscape() {
    cancelAnimationFrame(raf); if (st.ls.playing) { st.ls.playing = false; const b = $("a-ls-play"); if (b) b.textContent = "Replay the search"; return; }
    if (store.get().reduced) { st.ls.u = 1; st.ls.apply && st.ls.apply(); return; }
    st.ls.playing = true; st.ls.u = 0; const b = $("a-ls-play"); if (b) b.textContent = "Pause"; const t0 = performance.now(), D = 9000;
    const step = (t) => { if (!st.ls.playing || !$("a-land")) return; st.ls.u = Math.min(1, (t - t0) / D); st.ls.apply && st.ls.apply();
      if (st.ls.u < 1) raf = requestAnimationFrame(step); else { st.ls.playing = false; const bb = $("a-ls-play"); if (bb) bb.textContent = "Replay the search"; } };
    raf = requestAnimationFrame(step);
  }
  async function computeLandscape() {
    const res = st.res; if (!res) return; st.landJob = bx.jobs.run("landscape.k2", { grid: res.cfg.grid }, { family: "landscape", timeoutMs: 10 * 60 * 1000, onProgress: (p) => bx.setJob({ label: "Landscape", pct: (100 * p.done) / Math.max(1, p.total) }) });
    renderCenter();
    try { const r = await st.landJob.promise; if (r.status === "completed") st.land = { grid: r.grid, universe: r.universe, lower: r.S, source: `a landscape run in this browser (${groupDigits(r.S.length)} simulations, ${fmtMs(r.ms)})` }; }
    catch (e) { toast(String(e.message || e)); }
    st.landJob = null; bx.setJob(null); renderCenter();
  }
  bx.landscape = { compute: (grid) => (bx.jobs.run("landscape.k2", { grid }, { family: "landscape", timeoutMs: 10 * 60 * 1000 }).promise) };
  void pairIndex;
  function explorer(res) {
    const g = res.cfg.grid, k = res.cfg.k, ex = res.runs.find((r) => r.method === "exhaustive" && r.status === "completed");
    const pts = new Map(); for (const r of res.runs) for (const t of r.top || []) pts.set(t.set.join(","), t);
    const net = store.get().net, onNet = net && net.id === g;
    const list = [...pts.values()].map((t) => ({ x: onNet ? t.set.reduce((a, l) => a + net.model.branches[l].base_loading_dc, 0) : t.set[0], y: t.S, color: "#7cc4e8", r: 3, key: t.set.join("-"), tip: `{${t.set.join(", ")}}: S ${pc(t.S, 3)}` }));
    return `<div class="figure"><div class="fh"><h3>Search-space explorer</h3><span class="sub">${ex ? `the in-browser exhaustive run evaluated all ${groupDigits(res.N)} candidates; shown: the ${list.length} best-scoring candidates kept by the runs` : `evaluated candidates only (the best ${list.length} kept across runs) — not the whole space of ${groupDigits(res.N)}`}</span></div>
      ${list.length ? scatter(list, { w: 760, h: 280, x: { label: onNet ? "sum of base-case loading of the k branches (fraction of rating)" : "lowest branch index", fmt: onNet ? (v) => v.toFixed(1) : undefined }, y: { label: "S", pct: true, min: 0 }, aria: "candidates" }) : `<div class="empty">No candidates kept.</div>`}
      <p class="note">Axes are measured quantities, not a projection: no distance in this plot means similarity between outage sets. Click a point to inspect it.</p></div>`;
  }
  function toyView() {
    const t = st.toy, r = t.res; if (!r) return `<div class="empty">${st.job ? "Running…" : "Run experiment A to compare query counts on a toy problem."}</div>`;
    const N = r.N, M = r.M, qmax = Math.min(N, Math.max(r.rStar * 4 + 4, Math.ceil(r.classicalExpected * 3))), cls = [], grv = [];
    for (let q = 0; q <= qmax; q++) { let pnone = 1; for (let i = 0; i < q; i++) pnone *= (N - M - i) / (N - i); cls.push([q, 1 - Math.max(0, pnone)]); }
    const th = Math.asin(Math.sqrt(M / N)); for (let q = 0; q <= Math.min(qmax, 2 * r.rStar + 2); q++) grv.push([q, Math.sin((2 * q + 1) * th) ** 2]);
    const rq = summary(r.randomQueries), gq = summary(r.groverQueries), hmax = Math.max(...r.randomQueries, ...r.groverQueries), bins = Math.min(40, hmax);
    const hr = histogram(r.randomQueries, 0.5, hmax + 0.5, bins), hg = histogram(r.groverQueries, 0.5, hmax + 0.5, bins);
    const bars = hr.counts.map((c, i) => ({ label: String(Math.round((hr.edges[i] + hr.edges[i + 1]) / 2)), v: c / r.randomQueries.length, v2: hg.counts[i] / r.groverQueries.length, color: SERIES.random, color2: SERIES.grover, tip: `classical random: ${c} runs`, tip2: `Grover repeat-until-success: ${hg.counts[i]} runs` }));
    return `<div class="statrow"><div class="stat"><span class="k">N · M</span><span class="v">${N} · ${M}</span></div><div class="stat"><span class="k">Classical E[queries] ${bx.prov("analytical")}</span><span class="v">${r.classicalExpected.toFixed(2)}</span></div>
        <div class="stat"><span class="k">Classical, median of ${int(rq.n)} ${bx.prov("simulator", "seeded random orders")}</span><span class="v">${rq.median}</span></div><div class="stat"><span class="k">Grover r* ${bx.prov("analytical")}</span><span class="v">${r.rStar}</span></div>
        <div class="stat"><span class="k">Grover P(r*) ${bx.prov("emulated")}</span><span class="v">${pc(r.pExact, 2)}</span></div><div class="stat"><span class="k">Grover queries until success, median ${bx.prov("emulated", "repeat-until-success with seeded sampling")}</span><span class="v">${gq.median}</span></div></div>
      ${t.record ? `<p class="note">Experiment <button class="btn sm" data-rec="${t.record.id}" style="height:20px">${esc(t.record.id)}</button></p>` : ""}
      <div class="figure"><div class="fh"><h3>Probability of having found a marked item vs oracle queries</h3><span class="sub">classical random search without replacement: 1 − C(N−M, q)/C(N, q); Grover: sin²((2q+1)θ) after q iterations, single shot</span></div>
        ${lineChart([{ name: "classical random", color: SERIES.random, pts: cls, step: true, label: "classical" }, { name: "Grover (one shot after q iterations)", color: SERIES.grover, pts: grv, marker: "circle", label: "Grover" }], { w: 780, h: 260, x: { min: 0, max: qmax, label: "oracle queries q" }, y: { min: 0, max: 1, pct: true }, vlines: [{ x: r.rStar, label: `r* = ${r.rStar}`, color: SERIES.grover }], aria: "success vs queries" })}
        <div class="legend"><span><i style="background:${SERIES.random}"></i>classical random search ${bx.prov("analytical")}</span><span><i style="background:${SERIES.grover}"></i>Grover ${bx.prov("analytical")} (the simulated circuit matches it: P(r*) = ${pc(r.pExact, 3)})</span></div></div>
      <div class="figure"><div class="fh"><h3>Queries until a marked item is confirmed, ${int(rq.n)} repetitions</h3><span class="sub">classical: position of the first marked item in a seeded random order; Grover: r* + 1 (classical check) per attempt, repeated until a measurement hits</span></div>
        <div class="legend"><span><i style="background:${SERIES.random}"></i>classical random (median ${rq.median}, mean ${rq.mean.toFixed(1)})</span><span><i style="background:${SERIES.grover}"></i>Grover repeat-until-success (median ${gq.median}, mean ${gq.mean.toFixed(1)})</span></div>
        ${barChart(bars, { w: 780, h: 220, pair: true, y: { pct: true, label: "share of repetitions" }, aria: "query distribution" })}</div>
      <div class="m-q"><b>Reading this honestly.</b> Grover needs about √N oracle queries where classical random search needs about N/(M+1) — a statement about <b>query counts</b> on a problem whose oracle is a free lookup. The circuit took ${r.simMs.toFixed(1)} ms to simulate classically; on hardware every query would cost a circuit of depth ${int(r.stats.depth)} in this unoptimised compilation, plus error correction and repetitions. Nothing here measures a wall-clock speed-up, and nothing transfers to the grid objective (see Experiment B: Grover there is not implemented).</div>`;
  }
  function renderRight() {
    if (st.exp === "A" || !st.res) { R.innerHTML = `<p class="note">${st.exp === "A" ? "Experiment A has no grid candidates: its items are abstract indices." : "The best candidates of the last comparison appear here, with the methods that found them and a link to their simulation."}</p>`; return; }
    const top = topCandidates(st.res), g = st.res.cfg.grid, k = st.res.cfg.k, sel = st.sel && top.find((x) => x.set.join("-") === st.sel);
    R.innerHTML = `${sel ? `<div class="sec"><span class="micro">Candidate</span><b class="mono" style="font-size:13px">${esc(candidateId(g, sel.set))}</b><dl class="kv"><dt>S ${bx.ib("S")}</dt><dd>${pc(sel.S, 3)} ${bx.prov("simulator")}</dd><dt>Found by</dt><dd style="font-family:var(--sans)">${[...sel.methods].map((m) => METHODS[m].label).join(", ")}</dd><dt>Runs that kept it</dt><dd>${sel.runs}</dd>
        ${st.res.optimum != null ? `<dt>Gap to optimum</dt><dd>${(100 * Math.max(0, st.res.optimum - sel.S)).toFixed(3)} pp</dd>` : ""}</dl><div class="row"><button class="btn sm primary" data-theater="${sel.set.join("-")}">Open its simulation in the Theater</button><button class="btn sm" data-ml="${sel.set.join("-")}">ML prediction</button></div></div>` : ""}
      <div class="sec"><span class="micro">Top ${top.length} (union over all runs)</span><div class="tablewrap"><table class="t"><thead><tr><th>#</th><th>Set</th><th>S</th><th>Methods</th></tr></thead><tbody>${top.map((x, i) => `<tr class="click" data-cand="${x.set.join("-")}" ${st.sel === x.set.join("-") ? 'aria-current="true"' : ""}><td>${i + 1}</td><td>{${x.set.join(", ")}}</td><td>${pc(x.S)}</td><td>${[...x.methods].map((m) => `<i title="${esc(METHODS[m].label)}" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${SERIES[m]};margin-right:2px"></i>`).join("")}</td></tr>`).join("")}</tbody></table></div>
        <p class="note">${st.res.optimum != null ? "Ranked against a certified optimum." : "Best observed candidates: no exhaustive result certifies an optimum here."}</p></div>`;
    void k;
  }
  function render() {
    $("a-left-h").textContent = st.exp === "A" ? "Experiment A · toy search" : "Experiment B · grid-candidate search";
    const a = document.activeElement && root.contains(document.activeElement) ? document.activeElement.id : null, ls = L.scrollTop;
    renderLeft(); renderCenter(); renderRight(); L.scrollTop = ls; if (a && $(a)) $(a).focus();
  }

  root.addEventListener("click", (e) => {
    const b = e.target.closest("button, tr[data-cand], [data-key]"); if (!b) return;
    if (b.dataset.rec) return bx.openRecord(b.dataset.rec);
    if (b.dataset.cand || (b.dataset.key && st.res)) { st.sel = b.dataset.cand || b.dataset.key; renderRight(); if (innerWidth <= 1180) root.classList.add("insp-open"); return; }
    if (b.dataset.theater) { const set = b.dataset.theater.split("-").map(Number); bx.openScenario({ grid: st.res.cfg.grid, set, label: `Arena candidate {${set.join(", ")}}`, play: true }); return; }
    if (b.dataset.ml) { bx.setWorkspace("ml"); bx.ensureWs("ml").then(() => bx.ml && bx.ml.focusCandidate(st.res.cfg.grid, b.dataset.ml.split("-").map(Number))); return; }
    if (b.id === "a-ls-play") { playLandscape(); return; }
    if (b.id === "a-ls-compute") { computeLandscape(); return; }
    if (b.dataset.lsm) { const x = b.dataset.lsm; st.ls.hide.has(x) ? st.ls.hide.delete(x) : st.ls.hide.add(x); b.setAttribute("aria-pressed", String(!st.ls.hide.has(x))); mountLandscape(); return; }
    if (b.id === "a-run") run(); else if (b.id === "a-cancel") st.job && st.job.cancel(); else if (b.id === "t-run") runToy();
    else if (b.id === "a-json" && st.record) bx.exportText({ title: "Arena results (JSON)", text: JSON.stringify(st.record, null, 1), filename: `${st.record.id}.json`, mime: "application/json" });
    else if (b.id === "a-csv" && st.res) bx.exportText({ title: "Arena runs (CSV)", text: ["method,seed,status,unique_sims,proposals,cache_hits,best_S,best_set,sims_to_optimum,wall_ms,sim_ms", ...st.res.runs.map((r) => [r.method, r.seed, r.status, r.sims ?? "", r.proposals ?? "", r.cacheHits ?? "", r.best ? r.best.S : "", r.best ? `"${r.best.set.join(" ")}"` : "", r.hitAt ?? "", r.ms != null ? r.ms.toFixed(1) : "", r.simMs != null ? r.simMs.toFixed(1) : ""].join(","))].join("\n") + "\n", filename: `${st.record ? st.record.id : "arena"}_runs.csv`, mime: "text/csv" });
    else if (b.id === "a-report" && st.record) bx.openRecord(st.record.id);
  });
  root.addEventListener("input", (e) => { if (e.target.id === "a-ls-u") { cancelAnimationFrame(raf); st.ls.playing = false; const b = $("a-ls-play"); if (b) b.textContent = "Replay the search"; st.ls.u = +e.target.value / 1000; st.ls.apply && st.ls.apply(); } });
  root.addEventListener("change", (e) => {
    const t = e.target, c = st.cfg, num = (v, d) => (Number.isFinite(+v) && String(v).trim() !== "" ? +v : d);
    if (t.dataset.m) c.methods[t.dataset.m] = t.checked; else if (t.id === "a-grid") { c.grid = t.value; c.minLoad = 0; } else if (t.id === "a-k") c.k = t.value; else if (t.id === "a-min") c.minLoad = +t.value;
    else if (t.id === "a-budget") c.budget = Math.round(num(t.value, NaN)); else if (t.id === "a-reps") c.reps = Math.round(num(t.value, NaN)); else if (t.id === "a-seed") c.seed = Math.round(num(t.value, NaN));
    else if (t.id === "a-logx") { st.logX = t.checked; renderCenter(); return; }
    else if (t.id === "a-ls-order") { st.ls.order = t.value; mountLandscape(); return; }
    else if (t.id === "a-ls-rep") { st.ls.rep = +t.value; mountLandscape(); return; }
    else if (t.id === "t-n") st.toy.n = Math.round(num(t.value, 6)); else if (t.id === "t-m") st.toy.M = Math.round(num(t.value, 1)); else if (t.id === "t-reps") st.toy.reps = Math.round(num(t.value, 2000)); else if (t.id === "t-seed") st.toy.seed = Math.round(num(t.value, 3));
    else return;
    if (c.methods.exhaustive && !(st.cfg.grid === "ieee118" && +c.k >= 2) ) { /* keep */ }
    renderLeft();
  });
  // exhaustive is off by default when the space exceeds the browser cap
  if (binom(186, 2) > BROWSER_EXHAUSTIVE_CAP) st.cfg.methods.exhaustive = false;
  render();
  bx.rerunHooks["arena.grid"] = async (rec) => { const c = rec.config; bx.setWorkspace("arena"); st.exp = "B"; Object.assign(st.cfg, { grid: c.grid, k: String(c.k), minLoad: /≥ ([0-9.]+)/.exec(c.universe || "")?.[1] ? +/≥ ([0-9.]+)/.exec(c.universe)[1] : 0, budget: c.budget, reps: c.reps, seed: c.seed, beta: c.beta ?? 1,
      methods: Object.fromEntries(ORDER.map((m) => [m, c.methods.includes(m)])) }); root.querySelectorAll("[data-exp]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.exp === "B"))); st.parent = rec.id; await run(); st.parent = null; return st.record; };
  bx.rerunHooks["arena.toy"] = async (rec) => { const c = rec.config; bx.setWorkspace("arena"); st.exp = "A"; Object.assign(st.toy, { n: c.n, M: c.marked.length, reps: c.reps, seed: c.seed }); root.querySelectorAll("[data-exp]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.exp === "A"))); st.parent = rec.id; await runToy(); st.parent = null; return st.toy.record; };
  bx.arena = { state: st, run, runToy, render, setConfig: (p) => { Object.assign(st.cfg, p); render(); } };
}
