// Cascade Theater · contextual inspector (right panel). Run: the measured outcome of the current run with units, result classes, solver
// status, experiment id and the related records in other workspaces. Entity: a bus / branch / generator / load with case-file values,
// solver outputs at the current frame, history across the run and its events. Events: filterable causal timeline. Islands. Compare: pinned
// run A vs current B (outages, trips by round, load shed, S) and DC vs stored AC. Findings: exportable report.
import { $, esc, pc, int, rankText, GRID_NAME, ENGINE_NAME, toast } from "../util.js";
import { findingsMarkdown } from "../../shared/core/scenario.js";
import { METRICS, EVIDENCE, ENGINE_PROV } from "../provenance.js";
import { getJSON } from "../engine.js";
import { faultCounts } from "../sci/overlays.js";

const TABS = [["run", "Run"], ["entity", "Entity"], ["events", "Events"], ["islands", "Islands"], ["compare", "Compare"], ["findings", "Findings"]];
const TYPES = [["initial_outage", "outage"], ["overload", "overload"], ["trip", "trip"], ["islanding", "islanding"], ["load_shed", "load shed"], ["round", "round"], ["termination", "end"]];
const STATE_TXT = { initial_outage: "initial outage (T0)", tripped: "tripped by the cascade", unavailable: "out of service in the base case", deenergized: "de-energised", overload: "above rating", warning: "80–100% of rating", normal: "in service" };
const KEYRE = /^\s*(bus|b|branch|line|transformer|l|br|gen|generator|g|load|ld)?\s*#?\s*(\d+)\s*$/i;

/** "bus 69", "branch 12", "gen 3", "load 59", "12" (bus) → entity key, or null. */
export function parseEntity(text, model) {
  const m = KEYRE.exec(text || ""); if (!m) return null; const kind = (m[1] || "bus").toLowerCase(), n = +m[2];
  const key = /^(branch|line|transformer|l|br)$/.test(kind) ? `branch:${n}` : /^(gen|generator|g)$/.test(kind) ? `gen:${n}` : /^(load|ld)$/.test(kind) ? `load:${n}` : `bus:${n}`;
  return model.byKey.has(key) ? key : null;
}
// cause of an event, derived from the frames (only facts the engine recorded)
export function eventCause(e, r) {
  const F = r.result.frames;
  if (e.type === "initial_outage") return "Configured contingency (input).";
  if (e.type === "round") return e.frame === 0 ? "Topology after the initial outage." : `Topology after the trips of round ${e.round - 1}.`;
  if (e.type === "islanding") return e.frame === 0 ? "The initial outage separated the network." : `Trips in round ${e.round - 1} separated the network.`;
  if (e.type === "load_shed") return "Island without generation, or generation short of demand after redispatch to Pmax (uniform curtailment).";
  if (e.type === "overload") return `DC power flow of round ${e.round}: loading above 100 % of the synthetic rating.`;
  if (e.type === "trip") { const f = F[e.frame - (e.applied ? 1 : 0)] || F[e.frame]; const l = e.entities.map((k) => +k.split(":")[1]); const u = l.map((x) => f.loading[x]).filter((x) => x != null);
    return `Trip rule (${r.policy === "most_overloaded_first" ? "most overloaded first" : "all overloaded"}): loading ${u.length ? `${Math.round(100 * Math.min(...u))}–${Math.round(100 * Math.max(...u))} %` : "above"} of rating in round ${e.round}.`; }
  if (e.type === "termination") return r.result.metrics.status === "STABLE" ? "No branch above its rating: the cascade stopped." : r.result.metrics.status === "TOTAL_LOSS" ? "All demand lost." : "Round limit reached.";
  return "";
}

export function initInspector(bx) {
  const { store } = bx, el = $("right"); let tab = "run", filt = new Set(TYPES.map((t) => t[0]).filter((t) => t !== "round")), q = "", params = {};
  el.innerHTML = `<header><h2>Inspector</h2><button class="btn sm ghost sheet-toggle" id="au-sheet" aria-label="Collapse or expand panel">▾</button></header>
    <div class="tabs" role="tablist">${TABS.map(([k, n]) => `<button role="tab" id="au-t-${k}" data-tab="${k}" aria-controls="au-body">${n}</button>`).join("")}</div><div class="body" id="au-body" role="tabpanel"></div>`;
  const body = $("au-body");
  const loadParams = async (g) => { if (!params[g]) params[g] = await getJSON(`params_${g}.json`); return params[g]; };
  el.querySelector(".tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; render(true); } });
  el.querySelector(".tabs").addEventListener("keydown", (e) => { if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return; const i = TABS.findIndex((t) => t[0] === tab); tab = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length][0]; render(true); $(`au-t-${tab}`).focus(); });
  $("au-sheet").onclick = () => { el.classList.toggle("collapsed"); $("au-sheet").setAttribute("aria-expanded", String(!el.classList.contains("collapsed"))); document.body.dataset.sheet = el.classList.contains("collapsed") ? "" : "right"; };
  body.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || b.closest("[data-explain]") && !b.dataset.key) return;
    if (b.dataset.key) bx.select(b.dataset.key, { focus: true });
    else if (b.dataset.ev != null) { bx.pause(); bx.goEvent(+b.dataset.ev); const ev = store.get().run.events[+b.dataset.ev]; if (ev && ev.entities.length) bx.frameKeys(ev.entities, 10); }
    else if (b.dataset.type) { filt.has(b.dataset.type) ? filt.delete(b.dataset.type) : filt.add(b.dataset.type); render(); }
    else if (b.dataset.frame) bx.frameKeys(b.dataset.frame.split(" "), 12);
    else if (b.dataset.rec) bx.openRecord && bx.openRecord(b.dataset.rec);
    else if (b.dataset.ws) bx.setWorkspace(b.dataset.ws);
    else if (b.dataset.band) { const [lo, hi] = b.dataset.band.split(",").map(Number), d = store.get().net.dists[+b.dataset.k], hit = d && d.top.filter(([v]) => v >= lo && v < hi);
      if (hit && hit.length) { const [v, set] = hit[0]; bx.openScenario({ grid: store.get().netId, set, label: `${GRID_NAME[store.get().netId]} · {${set.join(", ")}} · S ${pc(v)} band` }); }
      else toast("No individual set is stored in this band: only the 500 most damaging sets are listed; the rest are counted in the histogram"); }
    else if (b.id === "au-focus") bx.focus(store.get().selection);
    else if (b.id === "au-clear") bx.select(null);
    else if (b.id === "au-first") { bx.pause(); bx.goEvent(0); }
    else if (b.id === "au-last") { bx.pause(); bx.goEvent(store.get().run.events.length - 1); }
    else if (b.id === "au-ac") { const r = bx.runOnNet(); bx.run({ engine: "stored-ac", outage: r.result.outage, policy: "all_overloaded", label: `${r.label} · stored AC` }); }
    else if (b.id === "au-dc") { const r = bx.runOnNet(); bx.run({ engine: "browser-dc", outage: r.result.outage, policy: "all_overloaded", label: r.label.replace(" · stored AC", "") }); }
    else if (b.id === "au-viewA") { const p = store.get().pinned; if (p) bx.openScenario({ grid: p.grid, set: p.result.outage, engine: p.engine, policy: p.policy, label: p.label }); }
    else if (b.id === "au-unpin") store.set({ pinned: null });
    else if (b.id === "au-copy") { bx.copy($("au-md").value, "Findings copied"); }
    else if (b.id === "au-export") { const r = bx.runOnNet(); bx.exportText({ title: "Findings report", text: $("au-md").value, filename: `blacksky_${r.grid}_${r.result.outage.join("-")}.md`, mime: "text/markdown" }); }
    else if (b.id === "au-branch-q") { const k = store.get().selection; if (k && k.startsWith("branch:")) { const l = +k.split(":")[1]; bx.toggleDraft(l); } }
  });
  body.addEventListener("input", (e) => { if (e.target.id === "au-q") { q = e.target.value; renderList(); } });
  body.addEventListener("keydown", (e) => { if (e.target.id === "au-find" && e.key === "Enter") { const k = parseEntity(e.target.value, store.get().net.model); if (k) { bx.select(k, { focus: true }); tab = "entity"; render(); } else toast("No such entity. Try: bus 69, branch 12, gen 3, load 59"); } });
  const openSheet = () => { if (innerWidth > 900) return; el.classList.remove("collapsed"); $("left").classList.add("collapsed"); document.body.dataset.sheet = "right"; $("au-sheet").setAttribute("aria-expanded", "true"); };
  bx.inspectorTab = (t) => { tab = t; openSheet(); render(true); };

  // ------------------------------------------------------------------ run
  function runTab(s) {
    const r = bx.runOnNet(); if (!r) return noRun(s); const M = r.summary, m = s.net.model, rec = r.recordId && bx.registry.get(r.recordId);
    const related = bx.registry.byScenario(r.scenarioId).filter((x) => x.id !== r.recordId);
    const cand = bx.registry.list().filter((x) => (x.type === "arena.grid" || x.type === "ml.train" || x.type === "ml.active") && x.config && x.config.grid === r.grid && x.config.k === r.k).slice(0, 4);
    // one result class for the section; a row carries its own chip only when its class differs (measured time, unavailable values)
    const P = ENGINE_PROV[r.engine], row = (k, v, p = P, ex = "") => `<dt>${k}${ex}</dt><dd>${v}${p && p !== P ? ` ${bx.prov(p)}` : ""}</dd>`;
    return `<div class="sec"><div class="row" style="justify-content:space-between"><b style="font-size:14px">${esc(r.label)}</b>${bx.prov(P, r.source)}</div>
        <dl class="kv"><dt>Scenario id</dt><dd style="font-size:11px">${esc(r.scenarioId)}</dd><dt>Experiment</dt><dd style="font-size:11px">${rec ? `<button class="btn sm" data-rec="${rec.id}" style="height:20px">${esc(rec.id)}</button>` : "not recorded"}</dd>
        <dt>Engine</dt><dd>${esc(ENGINE_NAME[r.engine])}</dd><dt>Trip policy</dt><dd>${esc(r.policy)}</dd><dt>Source</dt><dd style="font-family:var(--sans)">${esc(r.source)}</dd></dl></div>
      <div class="sec"><span class="micro" style="display:flex;gap:6px;align-items:center">Measurements of this run ${bx.prov(P, r.source)}</span><dl class="kv">
        ${row("Base demand", `${M.baseDemandMW.toFixed(1)} MW <span class="tag" title="benchmark input, not a result">input</span>`, null, bx.ib("base"))}${row("Initial unserved", `${M.initialUnservedMW.toFixed(1)} MW`)}${row("Final unserved", `${M.finalUnservedMW.toFixed(1)} MW`)}
        ${row("S, fraction unserved", pc(M.S, 2), P, bx.ib("S"))}${row("S₀, initial", pc(M.S0, 2), P, bx.ib("S0"))}${row("C = S − S₀", pc(M.C, 2), P, bx.ib("C"))}
        ${M.S_total != null && Math.abs(M.S_total - M.S) > 1e-9 ? row("S_total (AC upper)", pc(M.S_total, 2)) : ""}
        ${row("Branches tripped", int(M.trips), P, bx.ib("trips"))}${row("Rounds", M.rounds, P, bx.ib("rounds"))}${row("Final components", M.componentsFinal ?? "–")}${row("Buses de-energised", M.deEnergisedFinal ?? "–")}
        ${row("Max loading", M.maxLoading == null ? "not recorded" : `${pc(M.maxLoading, 0)} (branch ${M.maxLoadingBranch})`, M.maxLoading == null ? "unavailable" : P, bx.ib("maxload"))}
        ${row("Termination", M.status)}${row("Wall-clock", `${M.wallMs < 1000 ? M.wallMs.toFixed(1) + " ms" : (M.wallMs / 1000).toFixed(2) + " s"}`, "measured", bx.ib("wall"))}
        ${row("Rank", r.rank ? rankText(r.rank) : r.mode === "ac" ? "AC: not ranked" : "no table for this k / policy", r.rank ? "simulator" : "unavailable", bx.ib("rank"))}</dl>
        <p class="note">Solver: ${esc(M.solver)}. ${r.mode === "ac" ? "" : "Reactive power and voltage magnitudes are not part of the DC model and are not shown as results."}</p></div>
      ${r.mode === "dc" && r.policy === bx.TABLE_POLICY && s.net.dists[r.k] ? severityStrip(s.net.dists[r.k], M.S, r.k) : ""}
      <div class="sec"><span class="micro">Traced across workspaces</span>
        ${related.length ? `<div class="list">${related.slice(0, 6).map((x) => `<button data-rec="${x.id}"><span class="r">${esc(x.type.split(".")[0])}</span><span><span class="tt">${esc(x.name)}</span><span class="dd">${esc(x.id)} · ${esc(x.createdAt.slice(0, 19).replace("T", " "))}</span></span></button>`).join("")}</div>` : `<p class="note">No other record names this exact scenario yet.</p>`}
        ${cand.length ? `<p class="note">Related searches on ${GRID_NAME[r.grid]}, k = ${r.k}: ${cand.map((x) => `<button class="btn sm" data-rec="${x.id}" style="height:20px">${esc(x.type)} ${esc(x.id.slice(-4))}</button>`).join(" ")}</p>` : ""}
        <div class="row"><button class="btn sm" data-ws="arena">How do search methods find it? → ${esc(bx.WS_NAME.arena)}</button><button class="btn sm" data-ws="ml">What does a model predict? → ${esc(bx.WS_NAME.ml)}</button><button class="btn sm" data-ws="quantum">Closest quantum formulation → ${esc(bx.WS_NAME.quantum)}</button></div></div>`;
  }

  // ------------------------------------------------------------------ severity context: the stored histogram of S over every k-set
  function severityStrip(d, S, k) {
    const top = d.top[0][0], xmax = Math.min(1, Math.ceil(top * 105) / 100), NB = 44, w = 300, h = 74, nz = d.N - d.n_zero, counts = new Array(NB).fill(0);
    for (let i = 0; i < d.bins; i++) { const lo = i / d.bins; if (lo >= xmax) break; let c = d.hist[i]; if (i === 0) c -= d.n_zero; counts[Math.min(NB - 1, Math.floor((lo / xmax) * NB))] += Math.max(0, c); }
    const ly = (c) => (c > 0 ? Math.log10(c + 1) : 0), mx = Math.max(...counts.map(ly), 1), bw = w / NB, x = (v) => (v / xmax) * w, cur = x(Math.min(S, xmax));
    const bars = counts.map((c, i) => { const bh = (ly(c) / mx) * (h - 14), lo = (i / NB) * xmax, hi = ((i + 1) / NB) * xmax, me = S >= lo && S < hi;
      return `<rect x="${(i * bw + 0.5).toFixed(1)}" y="${(h - 12 - bh).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${Math.max(c > 0 ? 1 : 0, bh).toFixed(1)}" rx="1" fill="${me ? "var(--lamp)" : c > 0 ? "#4a5462" : "transparent"}"><title>S ${pc(lo, 1)}–${pc(hi, 1)}: ${int(c)} sets</title></rect>`; }).join("");
    const hits = counts.map((c, i) => `<button class="sv-hit" data-band="${((i / NB) * xmax).toFixed(5)},${(((i + 1) / NB) * xmax).toFixed(5)}" data-k="${k}" style="left:${((i / NB) * 100).toFixed(2)}%;width:${(100 / NB).toFixed(2)}%" aria-label="Open a stored set with S ${pc((i / NB) * xmax, 1)} to ${pc(((i + 1) / NB) * xmax, 1)}" ${c ? "" : "tabindex=-1"}></button>`).join("");
    return `<div class="sec"><span class="micro" style="display:flex;gap:6px;align-items:center">Where this set sits among all ${int(d.N)} ${k}-line sets ${bx.prov("simulator", "stored exhaustive DC table")}</span>
      <div class="sv-wrap"><svg viewBox="0 0 ${w} ${h}" class="sv" role="img" aria-label="Histogram of S over all ${k}-line sets, log count; this set marked">${bars}
        <line x1="${cur}" x2="${cur}" y1="2" y2="${h - 12}" stroke="var(--lamp)" stroke-width="1.5"/><text x="${Math.min(cur, w - 4)}" y="9" text-anchor="${cur > w - 60 ? "end" : "start"}" dx="${cur > w - 60 ? -4 : 4}" fill="var(--lamp)" font-size="9.5" font-family="JetBrains Mono, monospace">this set ${pc(S, 1)}</text>
        <text x="0" y="${h - 1}" fill="#808a98" font-size="9" font-family="JetBrains Mono, monospace">0%</text><text x="${w}" y="${h - 1}" text-anchor="end" fill="#808a98" font-size="9" font-family="JetBrains Mono, monospace">S ${pc(xmax, 0)}</text></svg>${hits}</div>
      <p class="note">${pc(d.n_zero / d.N, 1)} of all sets lose no demand (not drawn); bar height = log count of the other ${int(nz)}. Click a bar to open a stored set from that band (only the ${d.top.length} most damaging sets are stored individually).</p></div>`;
  }

  // ------------------------------------------------------------------ entity
  function entity(s) {
    const m = s.net.model, r = bx.runOnNet(), v = bx.view(), key = s.selection, P = params[s.netId];
    if (!P) loadParams(s.netId).then(() => store.get().selection && tab === "entity" && render());
    const find = `<div class="sec"><label class="micro" for="au-find">Find an entity</label><div class="row"><input class="ctl" id="au-find" style="flex:1" placeholder="bus 69 · branch 12 · gen 3 · load 59" autocomplete="off"></div>
      ${key ? "" : `<p class="note">Or click any bus, line, generator or demand facility in the scene. Values are read from the run's frames at the current timeline position; case-file values are marked as such.</p>`}</div>`;
    if (!key) return find;
    const e = m.byKey.get(key), fi = bx.frameIndex(), frames = r ? r.result.frames : [];
    const evs = r ? r.events.filter((x) => x.entities.includes(key) || (e.kind === "load" && x.entities.includes(`bus:${e.busId}`))) : [];
    let attrs = [], state = [], hist = "", nb = [], act = "";
    const btn = (k, t) => `<button class="btn sm" data-key="${k}">${esc(t)}</button>`, cs = (v2) => `${v2} <span class="tag" title="MATPOWER case-file value, not a solver output">case</span>`;
    const syn = (v2) => `${v2} <span class="tag" title="Synthetic parameter of this study">synthetic</span>`, sol = (v2) => `${v2} <span class="tag" title="Output of the cascade engine at this frame">solver</span>`;
    if (e.kind === "branch") {
      const st = v.branches[e.l], pb = P && P.branches[e.l];
      attrs = [["Type", e.transformer ? "transformer (derived)" : "line"], ["From → to", `bus ${e.fromId} → bus ${e.toId}`], ["Reactance x", cs(`${e.x_pu.toFixed(4)} pu`)], ...(pb ? [["Resistance r", cs(`${pb.r} pu`)], ["Charging b", cs(`${pb.b} pu`)], ...(pb.tap ? [["Tap ratio", cs(pb.tap)]] : [])] : []),
        ...s.net.tableKs.filter((k) => s.net.dists[k]).map((k) => { const fc = faultCounts(s.net.dists[k].top, m.nBranch); return [`In the ${fc.sets} worst ${k}-sets`, `${fc.counts[e.l]} <span class="tag" title="Count from the stored exhaustive DC table (synthetic ratings). Layers → Line colour → Fault lines draws this for every line.">table</span>`]; }),
        ["DC rating", syn(`${e.rating_dc_mw.toFixed(1)} MW`)], ["AC rating", syn(`${e.rating_ac_mva.toFixed(1)} MVA`)], ["Base-case loading", sol(pc(e.base_loading_dc))], ["Base case", e.in_service ? "in service" : "out of service"], ...(e.parallel_count > 1 ? [["Parallel circuit", `${e.parallel_index + 1} of ${e.parallel_count}`]] : [])];
      state = [["State", STATE_TXT[st.state]], ["Loading", st.u == null ? "–" : sol(pc(st.u))], ["Active flow", st.flow_mw == null ? (r ? "not recorded" : "–") : sol(`${st.flow_mw.toFixed(1)} MW`)], ["Reactive flow", "not modelled (DC)"]];
      if (r) { const tr = r.result.outage.includes(e.l) ? "initial outage (T0)" : r.trips.has(e.l) ? `tripped in round ${r.trips.get(e.l)}` : "never removed";
        state.push(["History", tr]);
        hist = `<div class="sec"><span class="micro">Loading by round ${bx.ib("loading")}</span><div class="spark" aria-label="Loading by round">${frames.map((f, j) => { const u = f.out_of_service.includes(e.l) ? null : f.loading[e.l]; const h = u == null ? 0 : Math.min(100, (u / 1.4) * 100);
          return `<i class="${u == null ? "x" : u > 1 ? "o" : u > 0.8 ? "w" : ""}" style="height:${h.toFixed(0)}%" title="Round ${j + 1}: ${u == null ? "out of service" : pc(u)}"></i>`; }).join("")}</div>
          <div class="note mono" style="font-size:11px">${frames.map((f, j) => `R${j + 1} ${f.out_of_service.includes(e.l) ? "out" : pc(f.loading[e.l], 0)}`).join(" · ")}</div></div>`; }
      nb = [btn(`bus:${e.fromId}`, `bus ${e.fromId}`), btn(`bus:${e.toId}`, `bus ${e.toId}`), ...m.branches.filter((b) => b.l !== e.l && ((b.from === e.from && b.to === e.to) || (b.from === e.to && b.to === e.from))).map((b) => btn(b.key, `parallel ${b.l}`))];
      act = `<button class="btn sm" id="au-branch-q">${s.draft.set.includes(e.l) ? "Remove from" : "Add to"} outage set</button>`;
    } else if (e.kind === "bus") {
      const st = v.buses[e.i], pb = P && P.buses.find((x) => x.id === e.id);
      attrs = [["Bus number", e.id], ["Base voltage", e.base_kv ? cs(`${e.base_kv} kV`) : "not given in the case"], ...(pb ? [["Type", cs(pb.type)], ["Vm (case)", cs(`${pb.Vm} pu`)], ["Va (case)", cs(`${pb.Va}°`)], ["Qd (case)", cs(`${pb.Qd} MVAr`)]] : []),
        ["Demand (model)", `${e.load_mw.toFixed(1)} MW`], ["Generators", e.gens.length || "none"], ["Branches", e.branches.length], ...(e.is_slack ? [["Role", "slack bus"]] : [])];
      state = [["Energised", st.energized ? "yes" : "no (no generation in its island)"], ["Island", st.component == null ? (r ? "not recorded" : "–") : st.mainIsland ? "main island" : `component ${st.component}`], ["Demand served", st.served_fraction == null ? (st.energized ? "energised; curtailment not recorded" : "0%") : sol(pc(st.served_fraction))], ["Voltage / angle", "not solver outputs here (DC model)"]];
      if (r) hist = `<div class="sec"><span class="micro">Energised by round</span><div class="note mono" style="font-size:11px">${frames.map((f, j) => `R${j + 1} ${f.energized_buses.includes(e.id) ? (f.factor ? pc(f.factor[e.i], 0) : "on") : "dark"}`).join(" · ")}</div></div>`;
      const adj = new Map(); e.branches.forEach((l) => { const b = m.branches[l], o = b.from === e.i ? b.toId : b.fromId; adj.set(o, (adj.get(o) || []).concat(l)); });
      nb = [...[...adj.keys()].sort((a, b) => a - b).map((id) => btn(`bus:${id}`, `bus ${id}`)), ...e.branches.map((l) => btn(`branch:${l}`, `${m.branches[l].transformer ? "xfmr" : "line"} ${l}`)), ...e.gens.map((g) => btn(`gen:${g}`, `gen ${g}`)), ...(e.load_mw > 0 ? [btn(`load:${e.id}`, "demand")] : [])];
    } else if (e.kind === "gen") {
      const st = v.gens[e.g], pg = P && P.gens[e.g];
      attrs = [["Bus", e.busId], ["Pmax", cs(`${e.pmax_mw.toFixed(1)} MW`)], ["Pmin", cs(`${e.pmin_mw.toFixed(1)} MW`)], ["Base dispatch (model)", `${e.pg0_mw.toFixed(1)} MW`], ...(pg ? [["Qmin / Qmax", cs(`${pg.Qmin} / ${pg.Qmax} MVAr`)], ["Vg setpoint", cs(`${pg.Vg} pu`)]] : []), ["Base case", e.in_service ? "in service" : "out of service"]];
      state = [["Online", st.energized && e.in_service ? "yes" : "no (isolated)"], ["Dispatch", st.pg_mw == null ? (r ? "not recorded" : "–") : sol(`${st.pg_mw.toFixed(1)} MW`)], ["Reactive output", "not modelled (DC)"]];
      nb = [btn(`bus:${e.busId}`, `bus ${e.busId}`)];
    } else {
      const bs = v.buses[e.bus], f = bs.served_fraction;
      attrs = [["Bus", e.busId], ["Base demand", `${e.demand_mw.toFixed(1)} MW`]];
      state = [["Served", f == null ? (bs.energized ? "energised; curtailment not recorded" : "0 MW") : sol(`${(e.demand_mw * f).toFixed(1)} MW (${pc(f)})`)], ["Shed", f == null ? (bs.energized ? "not recorded" : `${e.demand_mw.toFixed(1)} MW`) : sol(`${(e.demand_mw * (1 - f)).toFixed(1)} MW`)]];
      nb = [btn(`bus:${e.busId}`, `bus ${e.busId}`)];
    }
    const kv = (rows) => `<dl class="kv">${rows.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${String(b).includes("<span") ? b : esc(b)}</dd>`).join("")}</dl>`;
    return `${find}<div class="sec"><div class="row"><b style="font-size:15px;font-weight:600;flex:1;min-width:0;color:var(--ice)">${esc(bx.label(key))}</b><button class="btn sm" id="au-focus">Focus</button><button class="btn sm ghost" id="au-clear" aria-label="Clear selection">×</button></div>${kv(attrs)}${act ? `<div class="row">${act}</div>` : ""}</div>
      <div class="sec"><span class="micro">${r ? `State at round ${fi + 1}` : "Base case"}</span>${kv(state)}</div>${hist}
      ${r ? `<div class="sec"><span class="micro">Events involving it (${evs.length})</span>${evs.length ? `<div class="list">${evs.map(evRow).join("")}</div>` : `<p class="note">None: the cascade did not touch it directly.</p>`}</div>` : ""}
      <div class="sec"><span class="micro">Neighbours</span><div class="row">${nb.join("")}</div></div>`;
  }
  const evRow = (x) => { const cur = store.get().playback.i === x.i, r = bx.runOnNet(); return `<button data-ev="${x.i}" ${cur ? 'aria-current="true"' : ""}><span class="r">#${x.i + 1}<br>R${x.round}</span><span><span class="tag ${x.type}">${x.type.replace("_", " ")}</span> <span class="tt">${esc(x.title)}</span>${x.detail ? `<span class="dd">${esc(x.detail.length > 160 ? `${x.detail.slice(0, 160)}…` : x.detail)}</span>` : ""}<span class="dd">Cause: ${esc(eventCause(x, r))}</span></span></button>`; };

  // ------------------------------------------------------------------ events
  function eventsTab(s) {
    const r = bx.runOnNet(); if (!r) return noRun(s);
    const counts = {}; r.events.forEach((e) => (counts[e.type] = (counts[e.type] || 0) + 1));
    return `<div class="sec"><div class="chips" role="group" aria-label="Event types">${TYPES.filter(([t]) => counts[t]).map(([t, n]) => `<button data-type="${t}" aria-pressed="${filt.has(t)}">${n} · ${counts[t]}</button>`).join("")}</div>
      <input class="ctl" id="au-q" placeholder="Search events: branch, bus, text" value="${esc(q)}" autocomplete="off" aria-label="Search events">
      <p class="note">Every event is a fact recorded by the engine (index, round, type, components, cause). Solver: ${esc(r.summary.solver.split(";")[0])}. Elapsed compute for the whole run: ${r.ms.toFixed(1)} ms ${bx.prov("measured")}.</p></div><div class="sec" id="au-list"></div>`;
  }
  function renderList() {
    const box = $("au-list"), r = bx.runOnNet(); if (!box || !r) return; const qq = q.trim().toLowerCase();
    const hits = r.events.filter((e) => filt.has(e.type) && (!qq || `${e.title} ${e.detail || ""} ${e.entities.join(" ")} r${e.round}`.toLowerCase().includes(qq)));
    box.innerHTML = `<span class="micro">${hits.length} of ${r.events.length} events</span>${hits.length ? `<div class="list">${hits.map(evRow).join("")}</div>` : `<p class="note">No event matches.</p>`}`;
  }

  // ------------------------------------------------------------------ islands
  function islandsTab(s) {
    const r = bx.runOnNet(), v = bx.view(); if (!r) return noRun(s); const m = s.net.model, f = v.frame;
    if (!f.component) return `<div class="m-info">Island membership per bus is recorded only by the browser engine. This ${esc(ENGINE_NAME[r.engine])} result reports ${f.islands} connected component${f.islands > 1 ? "s" : ""} and ${m.nBus - f.energized_buses.length} de-energised buses at this round.</div>`;
    const groups = new Map(); m.buses.forEach((b, i) => { const st = v.buses[i]; const g = st.energized ? st.component : "dark"; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(b); });
    const rows = [...groups.entries()].filter(([g]) => g !== "dark").sort((a, b) => b[1].length - a[1].length).map(([g, bs], j) => {
      const dem = bs.reduce((a, b) => a + b.load_mw, 0), srv = bs.reduce((a, b) => a + b.load_mw * (f.factor ? f.factor[b.i] : 1), 0), gens = bs.flatMap((b) => b.gens), cap = gens.reduce((a, g2) => a + m.gens[g2].pmax_mw, 0);
      return `<div style="display:block"><div class="row" style="justify-content:space-between"><b style="color:var(--tx-1);font-weight:500">${j === 0 ? "Main island" : `Island ${j + 1}`}</b><button class="btn sm" data-frame="${bs.map((b) => b.key).join(" ")}">Frame</button></div>
        <dl class="kv"><dt>Buses</dt><dd>${bs.length}</dd><dt>Demand</dt><dd>${dem.toFixed(1)} MW</dd><dt>Served</dt><dd>${srv.toFixed(1)} MW (${dem ? pc(srv / dem) : "–"})</dd><dt>Generators</dt><dd>${gens.length} · ${cap.toFixed(0)} MW Pmax</dd></dl>
        ${bs.length <= 24 ? `<div class="note mono" style="font-size:11px">buses ${bs.map((b) => b.id).join(", ")}</div>` : ""}</div>`; });
    const dark = groups.get("dark") || [];
    return `<div class="sec"><span class="micro">Round ${bx.frameIndex() + 1}: ${rows.length} energised island${rows.length > 1 ? "s" : ""} ${bx.ib("islands")}</span><div class="list">${rows.join("")}</div></div>
      <div class="sec"><span class="micro">De-energised: ${dark.length} bus${dark.length === 1 ? "" : "es"}</span>${dark.length ? `<div class="note mono" style="font-size:11px">${dark.map((b) => b.id).join(", ")}</div><div class="row"><button class="btn sm" data-frame="${dark.map((b) => b.key).join(" ")}">Frame the dark buses</button></div>` : `<p class="note">Every bus still has generation in its island.</p>`}</div>`;
  }

  // ------------------------------------------------------------------ compare (pinned A vs current B; DC vs stored AC)
  function compareTab(s) {
    const r = bx.runOnNet(); if (!r) return noRun(s); const m = s.net.model, F = r.result.frames, a = F[0], b = F[F.length - 1], A = s.pinned;
    const row = (k, x, y, d = null) => `<tr><td>${k}</td><td>${x}</td><td>${y}</td>${d === null ? "" : `<td>${d}</td>`}</tr>`;
    let ab = "";
    if (A && A !== r && A.grid === r.grid) {
      const ta = A.trips, tb = r.trips, onlyA = [...ta.keys()].filter((l) => !tb.has(l)), onlyB = [...tb.keys()].filter((l) => !ta.has(l)), both = [...ta.keys()].filter((l) => tb.has(l));
      const darkA = new Set(m.buses.map((x) => x.id).filter((id) => !A.result.frames[A.result.frames.length - 1].energized_buses.includes(id))), darkB = new Set(m.buses.map((x) => x.id).filter((id) => !b.energized_buses.includes(id)));
      const dS = r.summary.S - A.summary.S;
      ab = `<div class="sec"><div class="row" style="justify-content:space-between"><span class="micro">A (pinned) vs B (current)</span><span class="row"><button class="btn sm" id="au-viewA">View A</button><button class="btn sm ghost" id="au-unpin">Unpin</button></span></div>
        <table class="t"><thead><tr><th></th><th>A</th><th>B</th><th>B − A</th></tr></thead><tbody>
        ${row("Outage set", `{${A.result.outage.join(", ")}}`, `{${r.result.outage.join(", ")}}`, "")}${row("Engine · policy", `${A.engine} · ${A.policy === "all_overloaded" ? "all" : "mof"}`, `${r.engine} · ${r.policy === "all_overloaded" ? "all" : "mof"}`, "")}
        ${row("S", pc(A.summary.S, 2), pc(r.summary.S, 2), `${dS >= 0 ? "+" : ""}${(100 * dS).toFixed(2)} pp`)}${row("S₀", pc(A.summary.S0, 2), pc(r.summary.S0, 2), `${(100 * (r.summary.S0 - A.summary.S0)).toFixed(2)} pp`)}
        ${row("Final unserved", `${A.summary.finalUnservedMW.toFixed(1)} MW`, `${r.summary.finalUnservedMW.toFixed(1)} MW`, `${(r.summary.finalUnservedMW - A.summary.finalUnservedMW).toFixed(1)} MW`)}
        ${row("Trips", A.summary.trips, r.summary.trips, r.summary.trips - A.summary.trips)}${row("Rounds", A.summary.rounds, r.summary.rounds, r.summary.rounds - A.summary.rounds)}
        ${row("Buses dark at end", darkA.size, darkB.size, darkB.size - darkA.size)}${row("Events", A.events.length, r.events.length, r.events.length - A.events.length)}</tbody></table>
        <dl class="kv"><dt>Tripped only in A</dt><dd>${onlyA.join(", ") || "none"}</dd><dt>Tripped only in B</dt><dd>${onlyB.join(", ") || "none"}</dd><dt>Tripped in both</dt><dd>${both.join(", ") || "none"}</dd>
        <dt>Dark only in A</dt><dd>${[...darkA].filter((x) => !darkB.has(x)).join(", ") || "none"}</dd><dt>Dark only in B</dt><dd>${[...darkB].filter((x) => !darkA.has(x)).join(", ") || "none"}</dd></dl>
        <p class="note">Differences are computed from both runs' recorded frames; the camera and timeline stay on B (same network, same layout).</p></div>`;
    } else ab = `<div class="sec"><p class="note">${A && A.grid !== r.grid ? "The pinned run is on another network; compare runs on the same network." : "Pin a run (Scenario → Pin as A), run another configuration, and the differences appear here."}</p></div>`;
    const live = (fi) => r.events.find((e) => e.type === "round" && e.frame === fi)?.values?.energisedIslands;
    const lost = a.energized_buses.filter((id) => !b.energized_buses.includes(id)), byRound = new Map(); r.trips.forEach((rd, l) => byRound.set(rd, (byRound.get(rd) || []).concat(l)));
    const tbl = `<table class="t"><thead><tr><th></th><th>Round 1</th><th>Final (R${F.length})</th></tr></thead><tbody>
      ${row("Demand served", pc(a.load_served), pc(b.load_served))}${row("Branches out of service", a.out_of_service.length, b.out_of_service.length)}
      ${row("Buses de-energised", m.nBus - a.energized_buses.length, m.nBus - b.energized_buses.length)}${live(0) == null ? row("Connected components", a.islands, b.islands) : row("Energised islands", live(0), live(F.length - 1))}
      ${row("Branches above rating", a.overloaded.length, b.overloaded.length)}</tbody></table>`;
    const stored = s.net.stored.get(r.result.outage.slice().sort((x, y) => x - y).join(",")); let acSec = "";
    if (stored && stored.ac) {
      const d = r.mode === "ac" ? stored.dc : r.result, ac = r.mode === "ac" ? r.result : stored.ac, tr = (x) => (x.trips_per_round || x.frames.map((f) => f.tripped)).flat().length;
      acSec = `<div class="sec"><span class="micro">Same set, DC vs AC</span><table class="t"><thead><tr><th></th><th>DC</th><th>AC (stored)</th></tr></thead><tbody>
        ${row("S, final unserved", pc(d.metrics.S, 2), `${pc(ac.metrics.S, 2)}${ac.metrics.S_total != null && Math.abs(ac.metrics.S_total - ac.metrics.S) > 1e-9 ? ` … ${pc(ac.metrics.S_total, 2)}` : ""}`)}
        ${row("S₀, initial", pc(d.metrics.S0, 2), pc(ac.metrics.S0, 2))}${row("Rounds", d.metrics.rounds, ac.metrics.rounds)}${row("Secondary trips", tr(d), tr(ac))}${row("Status", d.metrics.status, ac.metrics.status)}</tbody></table>
        <p class="note">The AC run is a stored Python Newton–Raphson result (an interval S … S_total where island solutions fail). AC results are not ranked against the DC tables.</p>
        <div class="row">${r.mode === "ac" ? `<button class="btn sm" id="au-dc">Replay the DC run</button>` : `<button class="btn sm" id="au-ac">Replay the AC run</button>`}</div></div>`;
    } else acSec = `<div class="sec"><p class="note">No stored AC run exists for this set (stored AC covers the ten most damaging sets per table and the example sets). With the API online, IEEE-14/30 AC runs can be requested from the Scenario tab.</p></div>`;
    return `${ab}<div class="sec"><span class="micro">Initial vs final (current run)</span>${tbl}<div class="row"><button class="btn sm" id="au-first">View initial</button><button class="btn sm" id="au-last">View final</button></div></div>
      <div class="sec"><span class="micro">What changed</span><dl class="kv"><dt>Buses that went dark</dt><dd>${lost.length ? lost.join(", ") : "none"}</dd>
      ${[...byRound.keys()].sort((x, y) => x - y).map((rd) => `<dt>Tripped in round ${rd}</dt><dd>${byRound.get(rd).join(", ")}</dd>`).join("") || "<dt>Trips</dt><dd>none</dd>"}</dl></div>${acSec}`;
  }

  // ------------------------------------------------------------------ findings
  function findingsTab(s) {
    const r = bx.runOnNet(); if (!r) return noRun(s); const m = s.net.model;
    let md = findingsMarkdown({ model: m, scenario: { result: r.result, engineLabel: ENGINE_NAME[r.engine], source: r.source }, events: r.events, rank: r.rank, evidence: EVIDENCE[r.engine]?.cls });
    md += `\n- Scenario id: ${r.scenarioId}${r.recordId ? `; experiment ${r.recordId}` : ""}`;
    md += `\n\n## Stages\n\n${r.stages.map((x) => `- ${x.title}: ${x.occurred ? x.summary : `did not occur. ${x.summary}`}`).join("\n")}`;
    md += `\n\n## Metric definitions\n\n${["S", "S0", "C", "rounds", "trips", "rank", "loading"].map((k) => `- ${METRICS[k].label} [${METRICS[k].unit}]: ${METRICS[k].definition} Source: ${METRICS[k].source}. Scope: ${METRICS[k].scope}.`).join("\n")}`;
    md += `\n\nGenerated by BLACKSKY Command · Omega (${GRID_NAME[r.grid]}).`;
    return `<div class="sec"><p class="note">Plain-text report of this run: outage set, result, event sequence, stages, model provenance and metric definitions.</p>
      <div class="row"><button class="btn" id="au-copy">Copy report</button><button class="btn" id="au-export">Export…</button></div><textarea class="md" id="au-md" readonly aria-label="Findings report">${esc(md)}</textarea></div>`;
  }
  const noRun = (s) => `<p class="note">${s.run.status === "running" ? "Running…" : s.run.status === "error" ? `The last run failed: ${esc(s.run.error)}` : "No run on this network yet. Configure and run one in the Scenario panel."}</p>`;

  function render(tabChanged = false) {
    const s = store.get(); if (!s.net) return;
    TABS.forEach(([k]) => $(`au-t-${k}`).setAttribute("aria-selected", String(k === tab)));
    const keepScroll = tabChanged ? 0 : body.scrollTop, act = document.activeElement?.id;
    body.innerHTML = tab === "run" ? runTab(s) : tab === "entity" ? entity(s) : tab === "events" ? eventsTab(s) : tab === "islands" ? islandsTab(s) : tab === "compare" ? compareTab(s) : findingsTab(s);
    if (tab === "events") renderList();
    body.scrollTop = keepScroll; if (act && $(act) && body.contains($(act))) { const a = $(act); a.focus(); if (a.setSelectionRange && a.value) a.setSelectionRange(a.value.length, a.value.length); }
  }
  bx.autopsyTab = bx.inspectorTab;
  store.sub((s, ch) => {
    if (ch.has("selection") && s.selection && tab !== "entity") { tab = "entity"; openSheet(); }
    if (["run", "net", "selection", "pinned", "records", "draft"].some((k) => ch.has(k))) render(ch.has("net"));
    else if (ch.has("playback")) { if (tab === "events") { document.querySelectorAll("#au-list [data-ev]").forEach((b) => { if (+b.dataset.ev === s.playback.i) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current"); }); } else if (tab !== "findings" && tab !== "run") render(); }
  });
  render(true);
}
