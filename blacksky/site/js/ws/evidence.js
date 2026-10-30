// Workspace 5 · Evidence & Resource Lab. Registry (every experiment of every workspace: stable id, configuration, result class, logs,
// limitations; re-run, compare, export), Validation (a recorded test report plus checks that run live in this browser), Resources &
// scaling (classical cost measured here vs the project's analytical fault-tolerant model), the versioned Limitations register and the
// result-class vocabulary.
import { $, esc, int, toast, GRID_NAME, storage } from "../util.js";
import { getJSON } from "../engine.js";
import { PROVENANCE, SCHEMAS, EXPERIMENT_TYPES, validateRecord, scenarioId, parseScenarioId, canonicalJSON, configHash } from "../sci/contracts.js";
import { LIMITATIONS } from "../sci/limitations.js";
import { compareRecords, recordCSV, recordReport, flatten } from "../sci/registry.js";
import { binom, binomBig, groupDigits, parseCandidateId, validateK } from "../sci/combin.js";
import { lineChart, bindTips } from "./charts.js";
import { runChecks } from "./checks.js";
import * as RM from "../../shared/core/resource.js";

const fmtT = (s) => { if (!Number.isFinite(s)) return "–"; const a = [[3.156e7 * 1e9, "Gyr"], [3.156e7, "years"], [86400, "days"], [3600, "h"], [60, "min"], [1, "s"], [1e-3, "ms"], [1e-6, "µs"]]; for (const [v, n] of a) if (s >= v) return `${(s / v) < 1000 ? +(s / v).toPrecision(3) : (s / v).toExponential(2)} ${n}`; return `${s.toExponential(2)} s`; };
const sci = (x) => (x == null || !Number.isFinite(x) ? "–" : Math.abs(x) >= 1e6 || (Math.abs(x) < 1e-3 && x !== 0) ? x.toExponential(2) : int(Math.round(x)));

export function init(bx, root) {
  const { store } = bx;
  const st = { tab: "registry", sel: null, cmp: null, ftype: "", fq: "", rerun: null, checks: null, checksRunning: false, val: undefined, confirmDel: null,
    res: { grid: "ieee118", k: 3, scenario: "realistic", tt: -5, P: 1, alpha: 1, cal: true, tEval: null, tEvalSrc: null } };
  root.innerHTML = `<div class="ws-head"><h1>Evidence &amp; <em>Resource Lab</em></h1><span class="q">Every number in BLACKSKY traces to a record: configuration, result class, execution log and the limitations that apply. Tests are shown as they actually ran; resource figures are estimates under stated assumptions.</span>
      <div class="acts"><button class="btn sm" id="e-import-btn">Import records</button><button class="btn sm" id="e-export-all">Export registry</button><button class="btn sm drawer-btn" id="e-insp-btn">Actions</button></div></div>
    <section class="pane left" aria-label="Sections"><div class="tabs" role="tablist" id="e-tabs"></div><div class="pane-b" id="e-left"></div></section>
    <section class="pane center" aria-label="Detail"><div class="pane-b" id="e-center"></div></section>
    <section class="pane right" aria-label="Actions"><div class="pane-h"><h2 id="e-right-h">Actions</h2><button class="btn sm ghost drawer-btn" id="e-insp-x">Close</button></div><div class="pane-b" id="e-right"></div></section>
    <input type="file" id="e-file" accept="application/json,.json" hidden>`;
  const L = $("e-left"), C = $("e-center"), R = $("e-right"), TB = $("e-tabs"); bindTips(root);
  $("e-insp-x").onclick = () => root.classList.remove("insp-open"); $("e-insp-btn").onclick = () => root.classList.toggle("insp-open");
  const TABS = [["registry", "Registry"], ["lineage", "Lineage"], ["validation", "Validation"], ["resources", "Resources"], ["limits", "Limits"], ["classes", "Classes"]];

  // ------------------------------------------------------------------ registry
  const filtered = () => bx.registry.list().filter((r) => (!st.ftype || r.type === st.ftype) && (!st.fq || `${r.id} ${r.name} ${r.scenarioIds.join(" ")}`.toLowerCase().includes(st.fq.toLowerCase())));
  function regLeft() {
    const all = bx.registry.list(), list = filtered();
    return `<div class="sec"><div class="row"><select class="ctl" id="e-ftype" aria-label="Type" style="flex:1"><option value="">All types (${all.length})</option>${EXPERIMENT_TYPES.map((t) => `<option value="${t}" ${st.ftype === t ? "selected" : ""}>${t} (${all.filter((r) => r.type === t).length})</option>`).join("")}</select></div>
      <input class="ctl" id="e-fq" placeholder="Search id, name, scenario" value="${esc(st.fq)}" aria-label="Search records"><p class="note">${bx.registry.persistent ? "Stored in this browser (localStorage)." : `<span style="color:var(--amber)">Browser storage unavailable: records are kept for this session only.</span>`} ${all.length} of at most 300 records.</p></div>
      <div class="list">${list.length ? list.slice(0, 150).map((r) => `<button data-sel="${r.id}" ${st.sel === r.id ? 'aria-current="true"' : ""} style="grid-template-columns:1fr"><span><span class="row" style="gap:6px;flex-wrap:nowrap"><span class="tag">${esc(r.type)}</span>${bx.prov(r.provenance)}<span class="${r.status === "completed" ? "" : r.status === "failed" ? "status-fail" : "status-skip"}" style="font-size:11px">${esc(r.status)}</span></span><span class="tt">${esc(r.name)}</span><span class="dd mono">${esc(r.id)} · ${esc(r.createdAt.slice(0, 19).replace("T", " "))}</span></span></button>`).join("") : `<div style="grid-template-columns:1fr;cursor:default"><span class="note">No records${st.ftype || st.fq ? " match" : " yet: run something in any workspace"}.</span></div>`}</div>`;
  }
  function recordView(r) {
    const errs = validateRecord(r), lims = r.limitations.map((id) => LIMITATIONS.items.find((l) => l.id === id)).filter(Boolean), res = flatten(r.results || {});
    const links = [...r.scenarioIds.map((s) => ({ kind: "scenario", id: s })), ...r.links];
    return `<div class="figure"><div class="fh"><h3>${esc(r.name)}</h3></div><div class="row">${bx.prov(r.provenance)}<span class="mono dim">${esc(r.id)}</span><span class="tag">${esc(r.type)}</span><span class="${r.status === "completed" ? "status-pass" : r.status === "failed" ? "status-fail" : "status-skip"}">${esc(r.status)}</span>${errs.length ? `<span class="status-fail">schema: ${esc(errs.join("; "))}</span>` : `<span class="faint">schema ${esc(r.schema)} ✓</span>`}</div>
        <dl class="kv"><dt>Created</dt><dd>${esc(r.createdAt)}</dd><dt>Configuration hash</dt><dd>${esc(r.configHash)}</dd><dt>Seed</dt><dd>${r.seed ?? "deterministic"}</dd><dt>Duration</dt><dd>${r.durationMs != null ? `${r.durationMs.toFixed(1)} ms ${bx.prov("measured")}` : "–"}</dd>
        <dt>Software</dt><dd>${esc(r.software.app)} ${esc(r.software.version)}${r.software.build?.commit ? ` @ ${esc(r.software.build.commit.slice(0, 10))}${r.software.build.dirty ? "+" : ""}` : ""}</dd><dt>Environment</dt><dd style="font-size:11px">${esc((r.environment.userAgent || "").replace(/^Mozilla\/5\.0 /, "").slice(0, 80))}${r.environment.cores ? ` · ${r.environment.cores} cores` : ""}</dd>
        <dt>Result class</dt><dd style="font-family:var(--sans)">${esc(PROVENANCE[r.provenance].label)}</dd>${r.parent ? `<dt>Re-run of</dt><dd><button class="btn sm" data-sel="${r.parent}" style="height:20px">${esc(r.parent)}</button></dd>` : ""}</dl>
        <p class="note">${esc(PROVENANCE[r.provenance].means)}</p></div>
      ${links.length ? `<div class="figure"><div class="fh"><h3>Linked scenarios and candidates</h3></div><div class="row">${links.slice(0, 20).map((l) => `<button class="btn sm" data-link="${esc(l.kind)}|${esc(l.id)}" title="${l.kind === "model" ? "model id (lives in the compute worker)" : "open in the Cascade Theater (re-runs the simulation)"}">${esc(l.id)}</button>`).join("")}</div></div>` : ""}
      <div class="figure"><div class="fh"><h3>Configuration</h3><span class="sub">exactly what was run</span></div><pre class="formula" style="max-height:260px;white-space:pre-wrap">${esc(JSON.stringify(r.config, null, 2))}</pre></div>
      <div class="figure"><div class="fh"><h3>Results</h3><span class="sub">${esc(PROVENANCE[r.provenance].label)}</span></div>${Object.keys(res).length ? `<div class="tablewrap"><table class="t"><tbody>${Object.entries(res).slice(0, 120).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(typeof v === "number" ? +v.toPrecision(8) : v)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="note">No results (${esc(r.status)}).</p>`}</div>
      ${r.warnings.length || r.errors.length ? `<div class="figure"><div class="fh"><h3>Warnings and errors</h3></div>${r.errors.map((e) => `<div class="m-err">${esc(e)}</div>`).join("")}${r.warnings.map((e) => `<div class="m-warn">${esc(e)}</div>`).join("")}</div>` : ""}
      <div class="figure"><div class="fh"><h3>Execution log</h3></div><div class="log">${r.log.length ? r.log.map((l) => `<div><span class="t">+${(l.t || 0).toFixed(1)} ms</span>${esc(l.msg)}</div>`).join("") : `<span class="faint">no log lines</span>`}</div></div>
      <div class="figure"><div class="fh"><h3>Limitations that apply</h3><span class="sub">register ${esc(LIMITATIONS.version)}</span></div>${lims.map((l) => `<div class="lim"><b>${l.id}</b><span>${esc(l.text)}</span></div>`).join("") || `<p class="note">None listed.</p>`}</div>`;
  }
  function compareView(a, b) {
    const d = compareRecords(a, b), diff = d.rows.filter((x) => !x.same);
    return `<div class="figure"><div class="fh"><h3>Compare records</h3><span class="sub">${d.sameConfig ? "same configuration hash" : "different configurations"} · ${diff.length} of ${d.rows.length} fields differ</span><button class="btn sm" id="e-cmp-x" style="margin-left:auto">Close comparison</button></div>
      <div class="tablewrap"><table class="t"><thead><tr><th>Field</th><th>${esc(a.id)}</th><th>${esc(b.id)}</th></tr></thead><tbody>${d.rows.slice(0, 200).map((x) => `<tr ${x.same ? 'class="faint"' : ""}><td>${esc(x.key)}${x.same ? "" : " ≠"}</td><td>${esc(typeof x.a === "number" ? +x.a.toPrecision(8) : x.a ?? "–")}</td><td>${esc(typeof x.b === "number" ? +x.b.toPrecision(8) : x.b ?? "–")}</td></tr>`).join("")}</tbody></table></div>
      <p class="note">Only fields both records contain are compared; nothing is inferred for fields that were not recorded.</p></div>`;
  }
  function regRight(r) {
    if (!r) return `<p class="note">Select a record to re-run, compare or export it.</p>`;
    const others = bx.registry.list().filter((x) => x.id !== r.id && x.type === r.type).slice(0, 40);
    const rerunnable = ["cascade", "quantum.circuit", "quantum.grover", "arena.grid", "arena.toy", "ml.train", "ml.active"].includes(r.type);
    return `<div class="sec"><span class="micro">Reproduce</span>${rerunnable ? `<button class="btn primary" id="e-rerun">Re-run this experiment</button><p class="note">Runs the recorded configuration again (same seed) as a new record linked to this one, then compares them.</p>` : `<p class="note">This record type is not re-runnable here.</p>`}
        ${st.rerun && st.rerun.from === r.id ? `<div class="${st.rerun.same ? "m-ok" : st.rerun.same === false ? "m-warn" : "m-info"}">${esc(st.rerun.msg)}</div>` : ""}
        <button class="btn sm" id="e-copycfg">Copy configuration</button></div>
      <div class="sec"><span class="micro">Export</span><div class="row"><button class="btn sm" id="e-json">JSON</button><button class="btn sm" id="e-csv">CSV</button><button class="btn sm" id="e-md">Report</button>${r.config?.circuit ? `<button class="btn sm" id="e-qasm">Circuit</button>` : ""}</div><p class="note">Exports carry the id, configuration, result class, seed, software version and limitations.</p></div>
      <div class="sec"><span class="micro">Compare with</span>${others.length ? `<select class="ctl" id="e-cmp" aria-label="Compare with"><option value="">Another ${esc(r.type)} record…</option>${others.map((x) => `<option value="${x.id}">${esc(x.id)} · ${esc(x.name.slice(0, 40))}</option>`).join("")}</select>` : `<p class="note">No other ${esc(r.type)} record yet.</p>`}</div>
      <div class="sec"><span class="micro">Remove</span>${st.confirmDel === r.id ? `<div class="row"><button class="btn sm danger" id="e-del-yes">Delete permanently</button><button class="btn sm ghost" id="e-del-no">Keep</button></div>` : `<button class="btn sm ghost" id="e-del">Delete this record</button>`}</div>`;
  }
  async function rerun(r) {
    st.rerun = { from: r.id, msg: "Running…", same: null }; render();
    try {
      let nr = null; const c = r.config;
      if (r.type === "cascade") { const run = await bx.openScenario({ grid: c.grid, set: c.outage, engine: c.engine, policy: c.policy, parent: r.id, forceNew: true, label: `${r.name} · re-run` }); nr = run && bx.registry.get(run.recordId); bx.setWorkspace("evidence"); }
      else { const mod = { "quantum.circuit": "quantum", "quantum.grover": "quantum", "arena.grid": "arena", "arena.toy": "arena", "ml.train": "ml", "ml.active": "ml" }[r.type]; await bx.ensureWs(mod); nr = await bx.rerunHooks[r.type](r); }
      if (!nr) { st.rerun = { from: r.id, msg: "The re-run did not produce a record (see the workspace for the error).", same: false }; render(); return; }
      const a = flatten(r.results || {}), b = flatten(nr.results || {}), keys = Object.keys(a).filter((k) => !/ms|Ms|wall|timing|simulatorMs|durationMs/i.test(k));
      const diff = keys.filter((k) => canonicalJSON(a[k]) !== canonicalJSON(b[k]));
      st.rerun = { from: r.id, same: !diff.length, msg: diff.length ? `Re-run ${nr.id}: ${diff.length} result field(s) differ (${diff.slice(0, 4).join(", ")}${diff.length > 4 ? "…" : ""}). Timing fields are excluded from the check.` : `Re-run ${nr.id} reproduced every recorded result field exactly (timings excluded, as they depend on the device).` };
      st.cmp = nr.id; st.sel = r.id;
    } catch (e) { st.rerun = { from: r.id, msg: `Re-run failed: ${e.message || e}`, same: false }; }
    bx.setWorkspace("evidence"); render();
  }

  // ------------------------------------------------------------------ validation
  async function loadValidation() { if (st.val === undefined) { st.val = (await getJSON("validation.json")) || null; render(); } }
  function validationView() {
    const v = st.val, ch = st.checks;
    const rec = v === undefined ? `<p class="note">Loading…</p>` : !v ? `<div class="m-warn">No recorded test report in this deployment (data/validation.json is missing). Run <code>make blacksky-validate</code> to produce one. ${bx.prov("unavailable")}</div>` : (() => {
      const tot = v.suites.reduce((a, s) => ({ p: a.p + (s.passed || 0), f: a.f + (s.failed || 0), s: a.s + (s.skipped || 0) }), { p: 0, f: 0, s: 0 }), stale = bx.build?.commit && v.commit && bx.build.commit !== v.commit;
      return `<div class="statrow"><div class="stat"><span class="k">Tests passed</span><span class="v status-pass">${tot.p}</span></div><div class="stat"><span class="k">Failed</span><span class="v ${tot.f ? "status-fail" : ""}">${tot.f}</span></div><div class="stat"><span class="k">Skipped</span><span class="v ${tot.s ? "status-skip" : ""}">${tot.s}</span></div><div class="stat"><span class="k">Recorded</span><span class="v" style="font-size:14px">${esc(v.generatedAt.slice(0, 16).replace("T", " "))} UTC</span></div></div>
        <p class="note">Report generated by <code>${esc(v.command)}</code> at commit <span class="mono">${esc((v.commit || "unknown").slice(0, 10))}${v.dirty ? " (+ uncommitted changes)" : ""}</span>. ${stale ? `<span style="color:var(--amber)">This page was built from ${esc(bx.build.commit.slice(0, 10))}: the report may not describe it exactly.</span>` : ""} Counts are copied from the test runners' own output; nothing is entered by hand.</p>
        <div class="tablewrap"><table class="t ledger"><thead><tr><th>Suite</th><th>Status</th><th>Passed</th><th>Failed</th><th>Skipped</th><th>Time</th><th>Covers</th></tr></thead><tbody>${v.suites.map((s) => `<tr><td>${esc(s.name)}<br><span class="faint" style="font-size:10.5px">${esc(s.command)}</span></td><td class="status-${s.status === "passed" ? "pass" : s.status === "failed" ? "fail" : s.status === "skipped" ? "skip" : "na"}">${esc(s.status)}</td><td>${s.passed ?? "–"}</td><td>${s.failed ?? "–"}</td><td>${s.skipped ?? "–"}</td><td>${s.durationS != null ? `${s.durationS.toFixed(1)} s` : "–"}</td><td style="font-family:var(--sans);font-size:11.5px">${esc((s.covers || []).join(", "))}</td></tr>`).join("")}</tbody></table></div>`; })();
    const live = ch ? `<div class="tablewrap"><table class="t ledger"><thead><tr><th>Check</th><th>Status</th><th>Evidence</th><th>Time</th></tr></thead><tbody>${ch.results.map((c) => `<tr><td>${esc(c.name)}<br><span class="faint" style="font-size:10.5px">${esc(c.covers)}</span></td><td class="status-${c.status === "passed" ? "pass" : c.status === "failed" ? "fail" : "na"}">${esc(c.status)}</td><td style="font-family:var(--sans);font-size:11.5px">${esc(c.detail)}</td><td>${c.ms.toFixed(1)} ms</td></tr>`).join("")}</tbody></table></div>
      <p class="note">${ch.results.filter((c) => c.status === "passed").length} of ${ch.results.length} passed in this browser at ${esc(ch.at.slice(11, 19))} UTC${ch.record ? ` · recorded as <button class="btn sm" data-sel="${ch.record.id}" style="height:20px">${esc(ch.record.id)}</button>` : ""}.</p>` : `<p class="note">Not run in this browser yet.</p>`;
    return `<div class="figure"><div class="fh"><h3>Recorded test run</h3><span class="sub">unit, integration, cross-library and end-to-end suites</span></div>${rec}</div>
      <div class="figure"><div class="fh"><h3>Live checks in this browser</h3><span class="sub">executed now, on this device, against the deployed data and code</span><button class="btn sm primary" id="e-checks" style="margin-left:auto" ${st.checksRunning ? "disabled" : ""}>${st.checksRunning ? "Running…" : ch ? "Run again" : "Run the checks"}</button></div>${live}</div>
      <div class="m-info">No badge here claims the project is “validated”: each line says which check ran, when, and what it compared. The checks test the implementation against definitions, hand calculations, stored reference results and independent libraries — not against a real power system.</div>`;
  }
  async function doChecks() {
    st.checksRunning = true; render(); await new Promise((r) => setTimeout(r, 30));
    try { const results = await runChecks(bx); const at = new Date().toISOString();
      const rec = bx.registry.add({ type: "validation", name: `In-browser checks · ${results.filter((c) => c.status === "passed").length}/${results.length} passed`, config: { checks: results.map((c) => c.id), userAgent: navigator.userAgent.slice(0, 120) }, provenance: "measured",
        status: "completed", results: Object.fromEntries(results.map((c) => [c.id, c.status])), errors: [], warnings: results.filter((c) => c.status === "failed").map((c) => `${c.name}: ${c.detail}`), durationMs: results.reduce((a, c) => a + c.ms, 0), limitations: ["L18"], log: results.map((c) => ({ t: c.ms, msg: `${c.id}: ${c.status}` })) });
      st.checks = { results, at, record: rec }; }
    catch (e) { toast(`Checks failed to run: ${e.message || e}`); }
    st.checksRunning = false; render();
  }

  // ------------------------------------------------------------------ resources & scaling
  async function measureEval() {
    const s = store.get(), g = st.res.grid; if (!s.net || s.net.id !== g) await bx.loadNet(g); const n = store.get().net, rng = (await import("../sci/rng.js")).makeRng(5), m = n.model.nBranch, k = Math.min(st.res.k, 4), times = [];
    for (let i = 0; i < 60; i++) { const set = new Set(); while (set.size < k) set.add(rng.int(m)); const t0 = performance.now(); n.engine.run([...set], { policy: "all_overloaded" }); times.push(performance.now() - t0); }
    times.sort((a, b) => a - b); st.res.tEval = times[30] / 1000; st.res.tEvalSrc = `median of 60 random ${k}-sets on ${GRID_NAME[g]}, measured in this browser (main thread) just now`; render();
  }
  function resourcesView() {
    const c = st.res, gi = bx.index.grids.find((x) => x.id === c.grid), Lb = gi.n_branch, B = gi.n_bus, XC = st.xc;
    if (!XC) return `<p class="note">Loading the resource model inputs…</p>`;
    const base = Object.fromEntries(Object.entries(XC.scenario_params_measured[c.scenario]).filter(([k]) => k !== "provenance")), prov = XC.scenario_params_measured[c.scenario].provenance;
    const tEval = c.tEval ?? base.t_classical_s, p = RM.params({ ...base, t_toffoli_s: 10 ** c.tt, P: c.P, alpha: c.alpha, t_classical_s: tEval }), kap = c.cal ? XC.kappa_cal : null;
    const ks = Array.from({ length: 10 }, (_, i) => i + 1).filter((k) => k <= Lb), rows = ks.map((k) => ({ k, ...RM.evaluate(Lb, B, k, c.scenario, "be_counted", p, 1, kap) })), r = rows.find((x) => x.k === c.k) || rows[0];
    const N = Number(binomBig(Lb, c.k)), qQ = Math.ceil((Math.PI / 4) * Math.sqrt(N));
    const series = [{ name: "classical exhaustive", color: "#3987e5", pts: rows.map((x) => [x.k, x.Tc_s]), marker: "circle", label: "classical" }, { name: "quantum (estimated)", color: "#9085e9", pts: rows.map((x) => [x.k, x.Tq_s]), marker: "diamond", label: "quantum (est.)" }];
    const logY = (v) => Math.log10(Math.max(v, 1e-12));
    return `<div class="figure"><div class="fh"><h3>Exhaustive search cost on ${GRID_NAME[c.grid]}</h3><span class="sub">classical: N evaluations × measured or recorded time per evaluation; quantum: the project's fault-tolerant resource model (JS port of doomsday/resource, parity-tested) ${bx.prov("analytical")}</span></div>
        <div class="statrow"><div class="stat"><span class="k">N = C(${Lb}, ${c.k})</span><span class="v">${groupDigits(binomBig(Lb, c.k))}</span></div><div class="stat"><span class="k">Classical evaluations</span><span class="v">${sci(N)}</span></div><div class="stat"><span class="k">Grover oracle queries ≈ ⌈π/4·√N⌉</span><span class="v">${sci(qQ)}</span></div><div class="stat"><span class="k">Query ratio N / queries</span><span class="v">${sci(N / qQ)}×</span></div>
          <div class="stat"><span class="k">Classical time = N × t_eval / P ${bx.prov("analytical", c.tEval ? "extrapolated from a per-evaluation time measured here" : "recorded default per-evaluation time")}</span><span class="v">${fmtT(r.Tc_s)}</span></div><div class="stat"><span class="k">Quantum time ${bx.prov("analytical")}</span><span class="v" style="color:var(--violet)">${fmtT(r.Tq_s)}</span></div><div class="stat"><span class="k">Time ratio Tq / Tc</span><span class="v">${sci(r.ratio_Tq_over_Tc)}×</span></div></div>
        <div class="m-q"><b>Fewer queries is not less time.</b> For k = ${c.k} Grover needs ${sci(N / qQ)}× fewer oracle queries than exhaustive search, yet under these assumptions it takes ${r.ratio_Tq_over_Tc >= 1 ? `${sci(r.ratio_Tq_over_Tc)}× longer` : `${sci(1 / r.ratio_Tq_over_Tc)}× less time`}: each query must evaluate the whole cascade reversibly (≈ ${sci(r.G)} logical Toffoli gates per Grover iteration in this model), on error-corrected hardware, plus classical verification.</div>
        ${lineChart(series.map((s) => ({ ...s, pts: s.pts.map(([x, y]) => [x, logY(y)]) })), { w: 760, h: 280, x: { min: 1, max: ks[ks.length - 1], label: "k, simultaneous outages", fmt: (v) => String(v) }, y: { label: "seconds (log scale)", fmt: (v) => `10${String(Math.round(v)).replace(/[-0-9]/g, (d) => "⁻⁰¹²³⁴⁵⁶⁷⁸⁹"["-0123456789".indexOf(d)])}` }, vlines: [{ x: c.k, label: `k = ${c.k}`, color: "#7cc4e8" }], hlines: [{ y: logY(86400), label: "1 day", color: "#f2a93b" }, { y: logY(3.156e7), label: "1 year", color: "#f2a93b" }], aria: "resource scaling" })}</div>
      <div class="cols2"><div class="figure"><div class="fh"><h3>Quantum resources at k = ${c.k}</h3><span class="sub">${esc(c.scenario)} scenario, Bravyi–Eggerton-counted Dicke preparation${c.cal ? ", κ-calibrated (partial)" : ", uncalibrated"} ${bx.prov("analytical")}</span></div>
          <dl class="kv"><dt>Logical qubits</dt><dd>${sci(r.logical_qubits)}</dd><dt>Physical qubits (surface code)</dt><dd>${sci(r.physical_qubits)}</dd><dt>Toffolis per Grover iteration G</dt><dd>${sci(r.G)}</dd><dt>Oracle compute cost E_f</dt><dd>${sci(r.E_f)}</dd><dt>Dicke-state preparation C_D</dt><dd>${sci(r.C_D)}</dd><dt>Iterations Q = c_q·√N</dt><dd>${sci(r.Q)}</dd><dt>Classical verification</dt><dd>${fmtT(r.Tverif_s)}</dd><dt>Crossover N*</dt><dd>${sci(r.N_star)}</dd></dl>
          <p class="note">Transpilation overhead, routing and factory layout are folded into the model's overhead parameters; no device was compiled for.</p></div>
        <div class="figure"><div class="fh"><h3>Assumptions</h3><span class="sub">change them and watch the conclusion move</span></div>
          <div class="grid2"><div class="field"><label for="r-grid">Network</label><select class="ctl" id="r-grid">${bx.index.grids.map((g) => `<option value="${g.id}" ${c.grid === g.id ? "selected" : ""}>${GRID_NAME[g.id]}</option>`).join("")}</select></div><div class="field"><label for="r-k">k</label><input class="ctl" id="r-k" type="number" min="1" max="10" value="${c.k}"></div></div>
          <div class="field"><label for="r-sc">Scenario</label><select class="ctl" id="r-sc">${RM.SCENARIOS.map((x) => `<option ${c.scenario === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
          <div class="field"><label for="r-tt">Logical Toffoli time: ${fmtT(10 ** c.tt)}</label><input type="range" id="r-tt" min="-8" max="-3" step="0.25" value="${c.tt}"></div>
          <div class="grid2"><div class="field"><label for="r-P">Classical workers P</label><input class="ctl" id="r-P" type="number" min="1" max="1000000" value="${c.P}"></div><div class="field"><label for="r-a">Classical exponent α</label><input class="ctl" id="r-a" type="number" step="0.05" min="0.5" max="1" value="${c.alpha}"></div></div>
          <label class="chk"><input type="checkbox" id="r-cal" ${c.cal ? "checked" : ""}>κ calibration from the project's measured primitives (partial)</label>
          <dl class="kv"><dt>Time per classical evaluation</dt><dd>${(tEval * 1000).toFixed(3)} ms ${c.tEval ? bx.prov("measured") : bx.prov("analytical")}</dd></dl><p class="note">${esc(c.tEvalSrc || `recorded default of the ${c.scenario} scenario (${prov.t_classical_s}) — measure it here instead:`)}</p><button class="btn sm" id="r-measure">Measure on this device</button>
          <p class="note">α = 1 is exhaustive enumeration; α = 0.5 models a classical method that already scales like √N, which removes any quadratic advantage.</p></div></div>
      <div class="figure"><div class="fh"><h3>Where the inputs come from</h3></div><div class="tablewrap"><table class="t"><thead><tr><th>Parameter</th><th>Value</th><th>Provenance (from data/crossover.json)</th></tr></thead><tbody>${Object.entries(base).slice(0, 22).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(typeof v === "number" ? +v.toPrecision(6) : v)}</td><td style="font-family:var(--sans);font-size:11.5px">${esc(prov[k] || "")}</td></tr>`).join("")}</tbody></table></div></div>`;
  }

  // ------------------------------------------------------------------ limitations, classes
  const limitsView = () => `<div class="figure"><div class="fh"><h3>Limitations register</h3><span class="sub">version ${esc(LIMITATIONS.version)} · ${LIMITATIONS.items.length} entries · each checked against the implementation</span></div>
      ${LIMITATIONS.items.map((l) => `<div class="lim"><b>${l.id}</b><span><span class="tag">${esc(l.area)}</span> ${esc(l.text)}</span><span class="v">Verified: ${esc(l.verified)} · applies to ${esc(l.applies.join(", "))}</span></div>`).join("")}
      <p class="note">Entries are added or reworded under a new version; none is removed to strengthen the presentation.</p></div>`;
  const classesView = () => `<div class="figure"><div class="fh"><h3>Result classes</h3><span class="sub">one vocabulary for all five workspaces (sci/contracts.js)</span></div><div class="tablewrap"><table class="t"><thead><tr><th>Chip</th><th>Class</th><th>Meaning</th><th>Records</th></tr></thead><tbody>${Object.entries(PROVENANCE).map(([k, p]) => `<tr><td>${bx.prov(k)}</td><td>${esc(p.label)}</td><td style="font-family:var(--sans)">${esc(p.means)}</td><td>${bx.registry.list().filter((r) => r.provenance === k).length}</td></tr>`).join("")}</tbody></table></div></div>`;

  // ------------------------------------------------------------------ APEX lineage: every record on a time axis, one lane per workspace;
  // grey links = records that name the same scenario, amber arcs = re-run of (parent). Built only from the registry.
  const LANES = [["scenario", "Scenarios", "#2a313d"], ["cascade", "Cascade Theater", "#ffd39a"], ["quantum", "Quantum Lab", "#a68cf2"], ["arena", "Algorithm Arena", "#3987e5"], ["ml", "ML Observatory", "#d55181"], ["other", "Evidence / checks", "#5fbf86"]];
  function lineageView() {
    const recs = [...bx.registry.list()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), n = recs.length;
    if (!n) return `<div class="empty">No records yet. Every run in any workspace adds one; their links appear here.</div>`;
    const lane = (t) => (t === "cascade" ? 1 : t.startsWith("quantum") ? 2 : t.startsWith("arena") ? 3 : t.startsWith("ml") ? 4 : 5), dx = Math.max(30, Math.min(72, 620 / Math.max(1, n))), x0 = 150, W = Math.max(780, x0 + n * dx + 60), H = 380, ly = (i) => 36 + i * 62;
    const pos = new Map(), sc = new Map(), out = [];
    recs.forEach((r, i) => pos.set(r.id, [x0 + i * dx + dx / 2, ly(lane(r.type))]));
    recs.forEach((r) => r.scenarioIds.forEach((sid) => { if (!sc.has(sid)) sc.set(sid, []); sc.get(sid).push(r.id); }));
    [...sc.entries()].forEach(([sid, ids], j) => { const xs = ids.map((id) => pos.get(id)[0]); sc.set(sid, { ids, x: xs.reduce((a, b) => a + b, 0) / xs.length, j }); });
    LANES.forEach(([, name, col], i) => out.push(`<line x1="${x0 - 8}" x2="${W - 10}" y1="${ly(i)}" y2="${ly(i)}" stroke="#141922"/><text x="0" y="${ly(i) + 4}" fill="#808a98" font-size="11.5" font-family="Archivo, sans-serif">${esc(name)}</text><rect x="${x0 - 20}" y="${ly(i) - 4}" width="8" height="8" rx="2" fill="${col}"/>`));
    sc.forEach((v, sid) => v.ids.forEach((id) => { const [x, y] = pos.get(id); out.push(`<path d="M${v.x},${ly(0) + 6} C${v.x},${(ly(0) + y) / 2} ${x},${(ly(0) + y) / 2} ${x},${y - 8}" fill="none" stroke="#3a4250" stroke-width="1"/>`); void sid; }));
    recs.forEach((r) => { if (!r.parent || !pos.has(r.parent)) return; const [x1, y1] = pos.get(r.parent), [x2, y2] = pos.get(r.id), h = Math.max(18, Math.abs(x2 - x1) * 0.35);
      out.push(`<path d="M${x1},${y1 - 8} C${x1},${y1 - h} ${x2},${y2 - h} ${x2},${y2 - 8}" fill="none" stroke="#f2a93b" stroke-width="1.4" stroke-dasharray="4 3"/>`); });
    sc.forEach((v, sid) => out.push(`<path d="M${v.x},${ly(0) - 6} l6,6 l-6,6 l-6,-6z" fill="#10141c" stroke="#7cc4e8" data-tip="${esc(sid)} · named by ${v.ids.length} record${v.ids.length > 1 ? "s" : ""}"/>`));
    recs.forEach((r) => { const [x, y] = pos.get(r.id), col = LANES[lane(r.type)][2], selc = st.sel === r.id;
      out.push(`<g class="ln-node" data-sel="${r.id}" tabindex="0" role="button" aria-label="${esc(r.name)}"><circle cx="${x}" cy="${y}" r="${selc ? 8.5 : 7}" fill="${r.status === "failed" ? "#10141c" : col}" stroke="${selc ? "#e8ecf1" : r.status === "failed" ? "#e0443a" : "#0a0d14"}" stroke-width="${selc ? 2 : 1.5}" data-tip="${esc(`${r.name} · ${r.id} · ${PROVENANCE[r.provenance]?.short || r.provenance} · ${r.status}`)}"/>
        <text x="${x}" y="${y + 20}" text-anchor="middle" fill="#5d6573" font-size="9" font-family="JetBrains Mono, monospace">${esc(r.id.slice(-4))}</text></g>`); });
    out.push(`<text x="${x0}" y="${H - 6}" fill="#5d6573" font-size="10.5" font-family="JetBrains Mono, monospace">older → newer (${n} records, ${sc.size} scenarios)</text>`);
    return `<div class="figure"><div class="fh"><h3>Lineage of every result in this browser</h3><span class="sub">one dot per experiment record (lane = workspace); diamonds = scenario ids; grey links = records naming the same scenario; dashed amber = re-run of</span></div>
      <div class="tablewrap"><svg viewBox="0 0 ${W} ${H}" width="${W}" style="max-width:none" role="img" aria-label="Experiment lineage graph">${out.join("")}</svg></div>
      <p class="note">Built from the registry only (configuration, parent and scenario ids). Click a dot to open its record.</p></div>`;
  }

  // ------------------------------------------------------------------ render
  function render() {
    TB.innerHTML = TABS.map(([k, n]) => `<button role="tab" data-tab="${k}" aria-selected="${st.tab === k}">${n}</button>`).join("");
    const a = document.activeElement && root.contains(document.activeElement) ? document.activeElement.id : null, ls = L.scrollTop, cs = C.scrollTop;
    const r = st.sel ? bx.registry.get(st.sel) : null;
    if (st.tab === "registry") { L.innerHTML = regLeft(); const cmp = st.cmp && bx.registry.get(st.cmp); C.innerHTML = r ? (cmp ? compareView(r, cmp) : "") + recordView(r) : `<div class="empty">Select a record. Every Theater run, Quantum Lab run, Arena comparison, ML training, verification and validation run creates one.</div>`; $("e-right-h").textContent = "Actions"; R.innerHTML = regRight(r); }
    else { L.innerHTML = `<p class="note">${{ lineage: "How the records connect: shared scenarios and re-runs.", validation: "Recorded test runs and live checks.", resources: "Classical cost (measured here) against the project's analytical fault-tolerant quantum model.", limits: "What the models and data cannot support.", classes: "How each value is classified." }[st.tab]}</p>`;
      C.innerHTML = st.tab === "lineage" ? lineageView() : st.tab === "validation" ? validationView() : st.tab === "resources" ? resourcesView() : st.tab === "limits" ? limitsView() : classesView(); $("e-right-h").textContent = "Notes";
      R.innerHTML = st.tab === "resources" ? `<p class="note">Every quantum number here is <b>analytically estimated</b> from a model with partly placeholder parameters (see the provenance column). No quantum hardware was used and no circuit for the cascade oracle exists.</p><p class="note">The classical figure uses the time per cascade evaluation measured in this browser when you press “Measure”; otherwise the recorded default.</p>` : `<p class="note">Records: ${bx.registry.list().length}. Limitations register ${esc(LIMITATIONS.version)}.</p>`; }
    L.scrollTop = ls; C.scrollTop = cs; if (a && $(a)) $(a).focus();
    if (st.tab === "validation") loadValidation();
    if (st.tab === "resources" && !st.xc) getJSON("crossover.json").then((x) => { st.xc = x; render(); });
  }
  root.addEventListener("keydown", (e) => { const g = e.target.closest && e.target.closest(".ln-node"); if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); g.dispatchEvent(new MouseEvent("click", { bubbles: true })); } });
  root.addEventListener("click", (e) => {
    const g = e.target.closest(".ln-node"); if (g) { st.sel = g.dataset.sel; st.cmp = null; st.tab = "registry"; render(); return; }
    const b = e.target.closest("button"); if (!b) return; const r = st.sel && bx.registry.get(st.sel);
    if (b.dataset.tab) { st.tab = b.dataset.tab; root.classList.remove("insp-open"); render(); return; }
    if (b.dataset.sel) { st.sel = b.dataset.sel; st.cmp = null; st.tab = "registry"; render(); if (innerWidth <= 900) C.scrollIntoView({ block: "start" }); return; }
    if (b.dataset.link) { const [kind, id] = b.dataset.link.split("|"); if (kind === "scenario") { const p = parseScenarioId(id); if (p) bx.openScenario({ grid: p.grid, set: p.set, engine: p.model === "ac" ? "stored-ac" : "browser-dc", policy: p.policy }); } else if (kind === "candidate") { const p = parseCandidateId(id); if (p) bx.openScenario({ grid: p.grid, set: p.set }); } else toast("Model ids refer to the model in this page's compute worker"); return; }
    const id = b.id;
    if (id === "e-rerun" && r) rerun(r);
    else if (id === "e-copycfg" && r) bx.copy(JSON.stringify(r.config, null, 2), "Configuration copied");
    else if (id === "e-json" && r) bx.exportText({ title: "Experiment record (JSON)", text: JSON.stringify(r, null, 2), filename: `${r.id}.json`, mime: "application/json" });
    else if (id === "e-csv" && r) bx.exportText({ title: "Experiment record (CSV)", text: recordCSV(r), filename: `${r.id}.csv`, mime: "text/csv" });
    else if (id === "e-md" && r) bx.exportText({ title: "Experiment report", text: recordReport(r), filename: `${r.id}.md`, mime: "text/markdown" });
    else if (id === "e-qasm" && r) import("../q/circuit.js").then((m) => bx.exportText({ title: "OpenQASM 2.0", text: m.toQasm2({ n: r.config.circuit.n, ops: r.config.circuit.ops }), filename: `${r.id}.qasm` }));
    else if (id === "e-del") { st.confirmDel = r.id; render(); } else if (id === "e-del-no") { st.confirmDel = null; render(); }
    else if (id === "e-del-yes" && r) { bx.registry.remove(r.id); st.sel = null; st.confirmDel = null; render(); }
    else if (id === "e-cmp-x") { st.cmp = null; render(); }
    else if (id === "e-checks") doChecks();
    else if (id === "r-measure") measureEval();
    else if (id === "e-export-all") bx.exportText({ title: "Experiment registry", text: JSON.stringify({ schema: "bsx.registry/1", exportedAt: new Date().toISOString(), records: bx.registry.list() }, null, 1), filename: "blacksky_registry.json", mime: "application/json" });
    else if (id === "e-import-btn") $("e-file").click();
  });
  root.addEventListener("change", async (e) => {
    const t = e.target, c = st.res;
    if (t.id === "e-ftype") { st.ftype = t.value; render(); } else if (t.id === "e-cmp") { st.cmp = t.value || null; render(); }
    else if (t.id === "e-file" && t.files[0]) { try { const j = JSON.parse(await t.files[0].text()), list = Array.isArray(j) ? j : j.records || [j]; const n = bx.registry.import(list); toast(`Imported ${n} valid new record(s) of ${list.length}`); render(); } catch (err) { toast(`Not a valid registry file: ${err.message}`); } t.value = ""; }
    else if (t.id === "r-grid") { c.grid = t.value; c.tEval = null; c.tEvalSrc = null; render(); } else if (t.id === "r-k") { const kv = validateK(t.value, 186); if (kv.ok && kv.k >= 1 && kv.k <= 10) { c.k = kv.k; render(); } else t.classList.add("bad"); }
    else if (t.id === "r-sc") { c.scenario = t.value; render(); } else if (t.id === "r-P") { c.P = Math.max(1, Math.round(+t.value || 1)); render(); } else if (t.id === "r-a") { c.alpha = Math.min(1, Math.max(0.5, +t.value || 1)); render(); } else if (t.id === "r-cal") { c.cal = t.checked; render(); }
  });
  root.addEventListener("input", (e) => { if (e.target.id === "e-fq") { st.fq = e.target.value; const a = e.target.selectionStart; L.innerHTML = regLeft(); const i = $("e-fq"); i.focus(); i.setSelectionRange(a, a); } else if (e.target.id === "r-tt") { st.res.tt = +e.target.value; render(); } });
  bx.registry.sub(() => { if (st.tab === "registry" && !root.hidden) { const a = document.activeElement?.id; L.innerHTML = regLeft(); if (a && $(a)) $(a).focus(); } });
  render();
  bx.evidence = { open(id) { st.tab = "registry"; st.sel = id; st.cmp = null; root.classList.remove("insp-open"); render(); }, state: st, render, runChecks: doChecks };
  void storage; void SCHEMAS; void scenarioId; void configHash; void binom;
}
