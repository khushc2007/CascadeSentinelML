// Cascade Theater · left panel. "Scenario": configure an outage experiment (network, k with N = C(m, k), the branch set, engine and trip
// policy), validate it, run it, pin it for comparison, reproduce it and export it. "Story": the guided five-stage replay of the current run
// (DETECT → TRACE → CASCADE → ISLAND → ASSESS), derived only from the run's recorded events (stages.js).
import { $, esc, pc, int, rankText, GRID_NAME, ENGINE_NAME, toast } from "../util.js";
import { validateScenario, rankOf, MAX_K } from "../../shared/core/scenario.js";
import { setKey } from "../engine.js";
import { EVIDENCE, ENGINE_PROV } from "../provenance.js";
import { validateK, binomBig, groupDigits } from "../sci/combin.js";
import { makeRng } from "../sci/rng.js";
import { scenarioId, SCHEMAS } from "../sci/contracts.js";
import { recordReport, recordCSV } from "../sci/registry.js";

const ENGINES = [["browser-dc", "Browser · DC engine (live)"], ["stored-dc", "Stored · DC Python run"], ["stored-ac", "Stored · AC Python run"], ["api-dc", "API · DC Python engine"], ["api-ac", "API · AC Python engine"]];

/** Validation of a scenario configuration against the engine and the stored runs (pure; tested in blacksky/test/logic.test.mjs). */
export function validateArena({ net, draft, engine, policy, apiOk }) {
  const model = net.model, stored = net.stored.get(setKey(draft));
  const base = { "browser-dc": "browser-dc", "stored-dc": "browser-dc", "stored-ac": "pre-ac", "api-dc": "api-dc", "api-ac": "api-ac" }[engine];
  const v = validateScenario({ model, outage: draft, engine: base, apiAvailable: apiOk, tableKs: net.tableKs, acPrecomputed: !!(stored && stored.ac), nPrecomputedAc: [...net.stored.values()].filter((x) => x.ac).length });
  if (engine === "stored-dc" && draft.length && !stored) v.errors.push("No stored DC run for this set. Stored runs cover the ten most damaging sets per table and the example sets; the browser engine runs any set.");
  if ((engine === "stored-dc" || engine === "stored-ac") && policy !== "all_overloaded") v.errors.push("Stored runs were made with the all-overloaded trip policy.");
  if (engine === "stored-dc") v.info = v.info.filter((x) => !/^Retrieved/.test(x)).concat("Retrieved from the data files: a Python DC run made when the demo data was built.");
  if (policy !== "all_overloaded" && draft.length) v.info.push("Most-overloaded-first is a different trip rule from the tables (all-overloaded): the result will run but will not be ranked.");
  if ((engine === "stored-ac" || engine === "api-ac") && draft.length) v.info.push("AC results are shown but never ranked against the DC tables.");
  v.ok = v.errors.length === 0; return v;
}
/** Configuration check of k against the selected set (k typed by the user is optional; when given it must match). */
export function checkK(kRaw, m, setLen) {
  if (kRaw === "" || kRaw == null) return { ok: true, k: setLen, N: binomBig(m, setLen), error: null, note: null, implicit: true };
  const v = validateK(kRaw, m); if (!v.ok) return v;
  if (v.k === 0) return { ...v, ok: false, error: "k = 0 is the base case: there is nothing to simulate. Choose k ≥ 1." };
  if (v.k > MAX_K) return { ...v, ok: false, error: `The cascade engines accept at most ${MAX_K} simultaneous outages.` };
  if (setLen !== v.k) return { ...v, ok: false, error: `k = ${v.k}, but ${setLen} branch${setLen === 1 ? " is" : "es are"} selected.` };
  return v;
}

export function initScenarioPanel(bx) {
  const { store } = bx, el = $("left"); let tab = "scenario", seed = 1;
  el.innerHTML = `<header><h2 class="serif">Cascade <em>Theater</em></h2><button class="btn sm ghost sheet-toggle" id="sc-sheet" aria-label="Collapse or expand panel" aria-expanded="true">▾</button></header>
    <div class="tabs" role="tablist"><button role="tab" id="sc-t-scenario" data-tab="scenario">Scenario</button><button role="tab" id="sc-t-story" data-tab="story">Story</button></div><div class="body" id="sc-body"></div>`;
  const body = $("sc-body");
  el.querySelector(".tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; render(true); } });
  $("sc-sheet").onclick = () => { el.classList.toggle("collapsed"); $("sc-sheet").setAttribute("aria-expanded", String(!el.classList.contains("collapsed"))); document.body.dataset.sheet = el.classList.contains("collapsed") ? "" : "left"; };
  bx.scenarioTab = (t) => { tab = t; render(true); };

  const current = () => { const s = store.get(), r = bx.runOnNet(); return r && bx.sameSet(r.result.outage, s.draft.set) && r.cfg.engine === s.draft.engine && (r.policy || "all_overloaded") === s.draft.policy ? r : null; };
  async function run() {
    const s = store.get(), d = s.draft, kc = checkK(d.k, eligible(s), d.set.length), v = validateArena({ net: s.net, draft: d.set, engine: d.engine, policy: d.policy, apiOk: s.api.state === "ok" });
    if (!kc.ok) { toast(kc.error); return; } if (!v.ok) { toast(v.errors[0]); return; }
    const r = await bx.run({ engine: d.engine, outage: d.set, policy: d.policy, origin: "theater", label: `${GRID_NAME[s.netId]} {${[...d.set].sort((a, b) => a - b).join(", ")}}` });
    if (r && !store.get().reduced) bx.play();
  }
  const eligible = (s) => s.net.model.branches.filter((b) => b.in_service).length;
  function randomSet() {
    const s = store.get(), kc = validateK(s.draft.k || "2", eligible(s)); if (!kc.ok || !kc.k) { toast(kc.error || "Set k first"); return; }
    const pool = s.net.model.branches.filter((b) => b.in_service).map((b) => b.l), rng = makeRng(seed);
    bx.setDraft({ set: rng.shuffle(pool).slice(0, kc.k).sort((a, b) => a - b) }); toast(`Random ${kc.k}-branch set from seed ${seed} (uniform over all C(${pool.length}, ${kc.k}) sets)`); seed++;
  }
  function worstKnown() {
    const s = store.get(), k = +(s.draft.k || s.draft.set.length || 3), d = s.net.dists[k];
    if (!d) { toast(`No exhaustive table for k = ${k} on ${GRID_NAME[s.netId]} (tables: k ∈ {${s.net.tableKs.join(", ")}})`); return; }
    bx.setDraft({ set: [...d.top[0][1]].sort((a, b) => a - b), k: String(k), engine: "browser-dc", policy: "all_overloaded" });
  }
  function exportRun(kind) {
    const r = bx.runOnNet(); if (!r) return; const rec = r.recordId && bx.registry.get(r.recordId);
    const cfg = { schema: SCHEMAS.scenario, scenarioId: r.scenarioId, grid: r.grid, outage: r.result.outage, k: r.k, engine: r.engine, policy: r.policy, model: store.get().net.model.config, experimentId: r.recordId };
    if (kind === "config") return bx.exportText({ title: "Scenario configuration", text: JSON.stringify(cfg, null, 2), filename: `${r.scenarioId.replace(/:/g, "_")}.json`, mime: "application/json", note: "Load it back with the command palette (“Open scenario id”) or by entering the set and k here." });
    if (kind === "json") return bx.exportText({ title: "Run results (JSON)", text: JSON.stringify({ ...cfg, summary: r.summary, rank: r.rank, events: r.events.map((e) => ({ i: e.i, round: e.round, type: e.type, title: e.title, detail: e.detail, entities: e.entities })), trips_per_round: r.result.trips_per_round || r.result.frames.map((f) => f.tripped), served_by_round: r.result.frames.map((f) => f.load_served), source: r.source, provenance: ENGINE_PROV[r.engine] }, null, 2), filename: `${r.scenarioId.replace(/:/g, "_")}_results.json`, mime: "application/json" });
    if (kind === "csv") { const rows = ["event,round,type,title,entities", ...r.events.map((e) => [e.i, e.round, e.type, `"${e.title.replace(/"/g, '""')}"`, `"${e.entities.join(" ")}"`].join(","))]; return bx.exportText({ title: "Event log (CSV)", text: rows.join("\n") + "\n", filename: `${r.scenarioId.replace(/:/g, "_")}_events.csv`, mime: "text/csv" }); }
    if (kind === "report" && rec) return bx.exportText({ title: "Experiment report", text: recordReport(rec), filename: `${rec.id}.md`, mime: "text/markdown" });
    if (kind === "recordcsv" && rec) return bx.exportText({ title: "Experiment record (CSV)", text: recordCSV(rec), filename: `${rec.id}.csv`, mime: "text/csv" });
  }
  async function reproduce() {
    const r = bx.runOnNet(); if (!r) return; const before = { S: r.result.metrics.S, trips: JSON.stringify(r.result.trips_per_round || r.result.frames.map((f) => f.tripped)), id: r.recordId };
    const r2 = await bx.run({ engine: r.engine, outage: r.result.outage, policy: r.policy, origin: "theater", label: `${r.label} · re-run`, parent: before.id, forceNew: true });
    if (!r2) return; const same = Math.abs(r2.result.metrics.S - before.S) <= 1e-12 && JSON.stringify(r2.result.trips_per_round || r2.result.frames.map((f) => f.tripped)) === before.trips;
    toast(same ? `Reproduced exactly: new record ${r2.recordId} (parent ${before.id})` : `Different result on re-run: see ${r2.recordId}`, 5000);
  }

  el.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || !body.contains(b)) return; const s = store.get();
    if (b.dataset.stage) bx.goStage(b.dataset.stage);
    else if (b.dataset.rm != null) bx.toggleDraft(+b.dataset.rm);
    else if (b.dataset.exp) exportRun(b.dataset.exp);
    else if (b.id === "sc-add-sel") bx.toggleDraft(+s.selection.split(":")[1]);
    else if (b.id === "sc-clear") bx.setDraft({ set: [] });
    else if (b.id === "sc-random") randomSet();
    else if (b.id === "sc-worst") worstKnown();
    else if (b.id === "sc-run") run();
    else if (b.id === "sc-cancel") bx.cancel();
    else if (b.id === "sc-play") { if (s.run.status === "done") bx.togglePlay(); }
    else if (b.id === "sc-pin") { const r = bx.runOnNet(); if (r) { store.set({ pinned: r }); toast("Pinned as A. Run another scenario and open Inspector → Compare."); bx.inspectorTab && bx.inspectorTab("compare"); } }
    else if (b.id === "sc-repro") reproduce();
    else if (b.id === "sc-retry") { const f = s.featuredId; if (f) bx.playFeatured(f); }
    else if (b.id === "sc-evidence") { const r = bx.runOnNet(); if (r && r.recordId) bx.openRecord ? bx.openRecord(r.recordId) : (bx.setWorkspace("evidence")); }
  });
  el.addEventListener("change", (e) => {
    const t = e.target, s = store.get();
    if (t.id === "sc-scn" && t.value) bx.playFeatured(t.value, { autoplay: true });
    else if (t.id === "sc-net") bx.loadNet(t.value);
    else if (t.id === "sc-engine") bx.setDraft({ engine: t.value });
    else if (t.id === "sc-policy") bx.setDraft({ policy: t.value });
    void s;
  });
  el.addEventListener("input", (e) => { if (e.target.id === "sc-k") { bx.setDraft({ k: e.target.value }); } });
  el.addEventListener("keydown", (e) => {
    if (e.target.id !== "sc-add" || e.key !== "Enter") return; e.preventDefault();
    const m = store.get().net.model, txt = e.target.value.trim(); if (!txt) return;
    const ids = txt.split(/[\s,]+/).filter(Boolean).map(Number), bad = ids.filter((x) => !Number.isInteger(x) || x < 0 || x >= m.nBranch);
    if (bad.length) { toast(`Unknown branch index ${bad[0]} (valid: 0–${m.nBranch - 1})`); return; }
    ids.forEach((l) => { if (!store.get().draft.set.includes(l)) bx.toggleDraft(l); }); e.target.value = "";
  });

  // ------------------------------------------------------------------ scenario tab
  function scenarioTab(s) {
    const m = s.net.model, d = s.draft, apiOk = s.api.state === "ok", mElig = eligible(s), kc = checkK(d.k, mElig, d.set.length);
    const v = validateArena({ net: s.net, draft: d.set, engine: d.engine, policy: d.policy, apiOk }), r = current(), anyRun = bx.runOnNet();
    const running = s.run.status === "running", err = s.run.status === "error" ? s.run.error : null, stored = s.net.stored.get(setKey(d.set));
    const selBranch = s.selection && s.selection.startsWith("branch:") ? +s.selection.split(":")[1] : null, fe = s.featured;
    const engOpt = ENGINES.map(([k, n]) => { const why = k.startsWith("api") && !apiOk ? " — API offline" : k === "stored-ac" && !(stored && stored.ac) && d.set.length ? " — none for this set" : k === "stored-dc" && !stored && d.set.length ? " — none for this set" : "";
      return `<option value="${k}" ${d.engine === k ? "selected" : ""}>${esc(n + why)}</option>`; }).join("");
    const kShown = kc.k ?? d.set.length, N = kc.N != null ? kc.N : binomBig(mElig, d.set.length);
    const formula = kShown > 0 ? `N = C(m, k) = m! / (k! (m − k)!) = C(${mElig}, ${kShown}) = ${groupDigits(N)}` : `N = C(${mElig}, 0) = 1 (the base case)`;
    const msgs = [...(kc.ok ? [] : [`<div class="m-err">${esc(kc.error)}</div>`]), ...v.errors.map((x) => `<div class="m-err">${esc(x)}</div>`), ...v.warnings.map((x) => `<div class="m-warn">${esc(x)}</div>`), ...v.info.map((x) => `<div class="m-info">${esc(x)}</div>`)];
    const ok = kc.ok && v.ok && d.set.length > 0;
    return `<div class="sec"><label class="micro" for="sc-scn">Quick start</label><select class="ctl" id="sc-scn"><option value="">Featured scenarios…</option>${fe.map((f) => `<option value="${f.id}" ${s.featuredId === f.id && anyRun && anyRun.cfg.origin === "featured" ? "selected" : ""}>${esc(f.title)}</option>`).join("")}</select></div>
      <div class="sec"><span class="micro">1 · Network and search space</span>
        <div class="grid2"><div class="field"><label for="sc-net">Benchmark</label><select class="ctl" id="sc-net">${["ieee118", "ieee30", "ieee14"].map((g) => `<option value="${g}" ${s.netId === g ? "selected" : ""}>${GRID_NAME[g]}</option>`).join("")}</select></div>
        <div class="field"><label for="sc-k">Outages k</label><input class="ctl ${kc.ok ? "" : "bad"}" id="sc-k" type="number" inputmode="numeric" min="1" max="${MAX_K}" step="1" placeholder="${d.set.length || "k"}" value="${esc(d.k)}" aria-describedby="sc-n"></div></div>
        <div class="formula" id="sc-n">${esc(formula)}<br><span class="faint">m = ${mElig} in-service branches (eligible); each unordered set counted once</span></div></div>
      <div class="sec"><span class="micro">2 · Outage set (${d.set.length} selected)</span>
        ${d.set.length ? `<div class="setchips">${d.set.map((l) => `<span>${l}<button data-rm="${l}" aria-label="Remove branch ${l}">×</button></span>`).join("")}</div><span class="note mono" style="font-size:11px">${d.set.map((l) => `${l} = bus ${m.branches[l].fromId}–${m.branches[l].toId}`).join(" · ")}</span>` : `<span class="note">Shift+click or double-click lines in the scene, type indices below, or use a generator.</span>`}
        <div class="row"><input class="ctl" id="sc-add" style="flex:1;min-width:110px" placeholder="e.g. 6, 67, 140 ⏎" aria-label="Add branch indices">${selBranch != null ? `<button class="btn sm" id="sc-add-sel">${d.set.includes(selBranch) ? "Remove" : "Add"} ${selBranch}</button>` : ""}</div>
        <div class="row"><button class="btn sm" id="sc-random" title="Uniformly random set of k in-service branches (seeded)">Random k-set</button><button class="btn sm" id="sc-worst" title="Most damaging set in the stored exhaustive DC table for this k">Worst known</button>${d.set.length ? `<button class="btn sm ghost" id="sc-clear">Clear</button>` : ""}</div></div>
      <div class="sec"><span class="micro">3 · Model</span><select class="ctl" id="sc-engine" aria-label="Engine">${engOpt}</select>
        <select class="ctl" id="sc-policy" aria-label="Trip policy"><option value="all_overloaded" ${d.policy === "all_overloaded" ? "selected" : ""}>Trip every overloaded branch each round</option><option value="most_overloaded_first" ${d.policy !== "all_overloaded" ? "selected" : ""}>Trip only the most overloaded branch</option></select>
        <p class="note">Quasi-steady-state DC cascade: islands balanced (generation up to Pmax, then uniform shedding), branches trip above 100 % of a synthetic rating. AC only as stored or API runs.</p></div>
      <div class="sec"><span class="micro">4 · Validate and run</span>${d.set.length ? (ok && !v.warnings.length ? `<div class="m-ok">Valid: k = ${d.set.length}, ${esc(ENGINE_NAME[d.engine])}.</div>` : "") + msgs.join("") : `<span class="note">Waiting for an outage set.</span>`}
        <div class="row"><button class="btn primary" id="sc-run" ${!ok || running ? "disabled" : ""}>${running ? "Running…" : r ? "Run again" : "Run scenario"}</button>${running ? `<button class="btn" id="sc-cancel">Cancel</button>` : ""}</div>${err ? `<div class="m-err">Run failed: ${esc(err)}${s.run.recordId ? ` <span class="mono">(${esc(s.run.recordId)})</span>` : ""}</div><button class="btn sm" id="sc-retry">Retry the featured scenario</button>` : ""}</div>
      ${anyRun ? `<div class="sec"><span class="micro">Current run</span><dl class="kv"><dt>Scenario</dt><dd style="font-size:11px">${esc(anyRun.scenarioId)}</dd><dt>Experiment</dt><dd style="font-size:11px">${anyRun.recordId ? `${esc(anyRun.recordId)}${anyRun.reproduced ? " (identical earlier run)" : ""}` : "not recorded"}</dd><dt>Result class</dt><dd>${bx.prov(ENGINE_PROV[anyRun.engine], anyRun.source)} <span class="dim" style="font-family:var(--sans)">${esc(anyRun.source)}</span></dd></dl>
        <div class="row"><button class="btn sm" id="sc-pin" title="Keep this run as A and compare the next one against it">Pin as A</button><button class="btn sm" id="sc-repro" title="Run the same configuration again as a new experiment record and compare">Reproduce</button><button class="btn sm" id="sc-evidence">Open record</button></div>
        <div class="row"><span class="micro" style="margin-right:2px">Export</span><button class="btn sm" data-exp="config">Config</button><button class="btn sm" data-exp="json">JSON</button><button class="btn sm" data-exp="csv">Events CSV</button><button class="btn sm" data-exp="report">Report</button></div>
        ${s.pinned && s.pinned !== anyRun ? `<div class="m-info">Pinned A: ${esc(s.pinned.label)}. Inspector → Compare.</div>` : ""}</div>` : ""}`;
  }

  // ------------------------------------------------------------------ story tab
  function storyTab(s) {
    const r = bx.runOnNet(); if (!r) return `<p class="note">${s.run.status === "running" ? "Running the cascade engine…" : s.loading ? "Loading network…" : "Run a scenario (Scenario tab) to replay it here."}</p>`;
    const ev = bx.currentEvent(), stg = bx.currentStage(), v = bx.view(), M = r.result.metrics;
    const kWord = ["", "one-branch", "two-branch", "three-branch", "four-branch"][r.k] || `${r.k}-branch`;
    const brief = `<div class="brief"><div class="big mono">${pc(M.S)}${r.mode === "ac" && M.S_total != null && Math.abs(M.S_total - M.S) > 1e-9 ? `<span style="font-size:22px"> – ${pc(M.S_total)}</span>` : ""}</div><p>${r.rank && !r.rank.zero
      ? `of the demand on the ${GRID_NAME[r.grid]} test case is left unserved under the DC cascade model when these ${r.k} branches are removed${r.rank.exact ? "" : " (rank estimated from the histogram)"}: rank <b>${r.rank.exact ? "#" : "≈ #"}${int(r.rank.rank)}</b>${r.ties > 1 ? ` (tied with ${int(r.ties - 1)} other set${r.ties > 2 ? "s" : ""})` : ""} of <b>${int(r.rank.N)}</b> ${kWord} outage sets in the exhaustive DC table, after ${M.rounds} rounds of overload trips.`
      : r.rank && r.rank.zero ? `of the demand on the ${GRID_NAME[r.grid]} test case is lost under the DC cascade model: the network absorbs these ${r.k} outages, like ${int(r.rank.tiedZero)} of the ${int(r.rank.N)} ${kWord} sets in the table.`
      : `of the demand on the ${GRID_NAME[r.grid]} test case left unserved (${r.mode === "ac" ? "AC run, not ranked against the DC tables" : "no exhaustive table for this k or policy"}), after ${M.rounds} rounds.`} ${bx.prov(ENGINE_PROV[r.engine], r.source)}</p></div>`;
    const play = `<div class="row"><button class="btn primary cta" id="sc-play"><svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="${s.playback.playing ? "M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z" : "M4 2.5v11l9.5-5.5z"}" fill="currentColor"/></svg>${s.playback.playing ? "Pause" : s.playback.i >= r.events.length - 1 ? "Replay the cascade" : s.playback.i ? "Resume" : "Play the cascade"}</button><span class="ev-badge" title="${esc(EVIDENCE[r.engine]?.text || "")}">${esc(EVIDENCE[r.engine]?.cls || r.engine)}</span></div>`;
    const rail = `<div class="stages" role="group" aria-label="Stages">${r.stages.map((st, j) => { const cls = !st.occurred ? "none" : stg && st.eventIndex >= 0 && st.eventIndex < (stg.eventIndex ?? 0) ? "done" : "";
      return `<button data-stage="${st.id}" class="${cls}" ${stg && stg.id === st.id ? 'aria-current="step"' : ""} ${st.occurred ? "" : 'aria-disabled="true"'} title="${esc(st.occurred ? st.title : `${st.title}: did not occur in this run`)}"><span class="n">0${j + 1}</span><span class="t">${st.title}</span><span class="bar2"></span></button>`; }).join("")}</div>`;
    const idx = r.stages.indexOf(stg) + 1, notOcc = r.stages.filter((x) => !x.occurred);
    const card = `<div class="sec stagecard"><span class="micro">Stage 0${idx} / 05 · round ${ev.frame + 1} of ${r.result.frames.length}</span><h3>${stg.title}</h3><p class="lede">${esc(stg.summary)}</p>
      ${notOcc.length ? `<div class="note">Did not occur in this run: ${notOcc.map((x) => `<b>${x.title}</b>`).join(", ")}.</div>` : ""}
      ${ev.i === stg.eventIndex && (stg.id === "detect" || stg.id === "assess") ? "" : `<div class="evline ${ev.type}"><span class="micro">Event ${ev.i + 1} of ${r.events.length}</span><b>${esc(ev.title)}</b>${esc(ev.detail || "")}</div>`}</div>`;
    const tripsSoFar = v.branches.filter((b) => b.state === "tripped").length, dark = v.buses.filter((b) => !b.energized).length;
    const now = `<div class="sec"><span class="micro">At this frame</span><div class="metrics">
      <div><div class="k">Demand unserved ${bx.ib("S")}</div><div class="v">${pc(1 - v.loadServed)}</div></div><div><div class="k">Secondary trips ${bx.ib("trips")}</div><div class="v">${tripsSoFar}</div></div>
      <div><div class="k">Buses de-energised</div><div class="v">${dark}</div></div><div><div class="k">Overloaded now ${bx.ib("loading")}</div><div class="v">${v.branches.filter((b) => b.overloaded).length}</div></div></div></div>`;
    const lim = `<div class="sec"><p class="note">${r.mode === "ac" ? "AC (Newton–Raphson) quasi-steady-state model" : "DC quasi-steady-state model: active power only, no reactive power or voltage magnitudes"} on an IEEE test case with synthetic ratings and a schematic, non-geographic layout. S is a share of the test case's demand, not a blackout probability. Playback speed changes only the display, not any simulated time.</p></div>`;
    return brief + play + rail + card + now + lim;
  }

  function render(tabChanged = false) {
    const s = store.get(); if (!s.net) { body.innerHTML = `<p class="note">Loading network…</p>`; return; }
    ["scenario", "story"].forEach((k) => $(`sc-t-${k}`).setAttribute("aria-selected", String(k === tab)));
    const keep = tabChanged ? 0 : body.scrollTop, act = document.activeElement?.id, sel = act && $(act) && $(act).selectionStart;
    body.innerHTML = tab === "scenario" ? scenarioTab(s) : storyTab(s);
    body.scrollTop = keep; if (act && $(act) && body.contains($(act))) { const a = $(act); a.focus(); try { if (sel != null && a.setSelectionRange) a.setSelectionRange(sel, sel); } catch { /* number inputs */ } }
  }
  store.sub((s, ch) => {
    if (ch.has("run") && s.run.status === "done" && s.run.cfg && s.run.cfg.origin === "featured" && tab === "scenario" && !ch.has("ws")) { /* keep tab */ }
    if (tab === "story" ? ["run", "playback", "net", "loading", "selection", "reduced"].some((k) => ch.has(k)) : ["run", "net", "draft", "api", "selection", "featured", "loading", "pinned", "records"].some((k) => ch.has(k))) render();
  });
  render(true);
  void rankOf; void rankText; void scenarioId;
}
