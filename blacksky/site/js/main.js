// BLACKSKY COMMAND · OMEGA — application shell. One shared scientific state (network, active scenario, current cascade run, experiment
// registry) and five workspaces that read it: Cascade Theater (3-D twin + causal timeline), Quantum Lab, Algorithm Arena, ML Risk
// Observatory and Evidence & Resource Lab. Workspaces 2–5 are loaded on first use. Heavy computations run in the compute worker (jobs.js).
// The cascade model itself is the byte-copied, parity-tested engine in ./shared; nothing here re-implements it.
import { createStore } from "./state.js";
import { $, esc, pc, int, RM, GRID_NAME, ENGINE_NAME, toast, storage } from "./util.js";
import { loadThree, webglAvailable } from "../shared/three/loader.js";
import { CameraRig } from "../shared/three/camera.js";
import { buildEvents, tripRounds } from "../shared/core/events.js";
import { viewState } from "../shared/core/encoding.js";
import { rankOf } from "../shared/core/scenario.js";
import { entityLabel } from "../shared/core/model.js";
import { getJSON, loadNetwork, runScenario, apiAvailable, apiBase, bsapiAvailable } from "./engine.js";
import { deriveStages, stageAt } from "./stages.js";
import { BlackskyScene } from "./scene.js";
import { METRICS, EVIDENCE, provChip } from "./provenance.js";
import { CSS } from "./palette.js";
import { initLabels } from "./labels.js";
import { initTimeline } from "./timeline.js";
import { initScenarioPanel } from "./ws/theater-scenario.js";
import { initInspector, parseEntity } from "./ws/theater-inspector.js";
import { initView2D } from "./ws/view2d.js";
import { initMinimap } from "./ws/minimap.js";
import { initPalette } from "./ws/cmdk.js";
import { initArrival } from "./ws/arrival.js";
import { initBriefing } from "./ws/briefing.js";
import { createRegistry } from "./sci/registry.js";
import { scenarioId, APP, PROVENANCE, configHash } from "./sci/contracts.js";
import { limitationsFor } from "./sci/limitations.js";
import { runJob } from "./jobs.js";
import { faultCounts, flowSurge, branchOverlay, RAMPS, css } from "./sci/overlays.js";

export const WORKSPACES = ["theater", "quantum", "arena", "ml", "evidence"];
export const WS_NAME = { theater: "Cascade Theater", quantum: "Quantum Lab", arena: "Algorithm Arena", ml: "ML Risk Observatory", evidence: "Evidence & Resource Lab" };
const LEGACY = { autopsy: "theater" };                       // old BLACKSKY routes keep working
const DWELL = { initial_outage: 1900, round: 650, islanding: 1500, load_shed: 1300, overload: 1700, trip: 1700, termination: 0 };
export const TABLE_POLICY = "all_overloaded";                 // the exhaustive DC tables were computed with this trip policy

const routeOf = (h) => { const w = h.replace(/^#/, ""); return WORKSPACES.includes(w) ? w : LEGACY[w] || null; };

async function boot() {
  const store = createStore({
    ws: routeOf(location.hash) || "theater",
    netId: null, net: null, loading: true, run: { status: "idle" }, playback: { i: 0, playing: false, speed: 1 },
    selection: null, hover: null, follow: true, camera: { mode: "orbit", schematic: false, view: "3d" }, reduced: RM,
    api: { state: "checking" }, bsapi: { state: "checking" }, draft: { set: [], k: "", engine: "browser-dc", policy: TABLE_POLICY }, featured: [], featuredId: null,
    pinned: null, layers: { labels: true, flow: true, grid: true, lights: true, minimap: true, context: true, overlay: "loading", faultK: 3 }, job: null, records: 0,
  });
  const bx = { store, toast, WS_NAME, TABLE_POLICY };
  window.__blacksky = bx;                                       // test hook (read-only use in e2e tests)

  // ------------------------------------------------------------------ build info, registry (persistent where the browser allows)
  bx.build = await getJSON("build.json");
  bx.registry = createRegistry(storage, bx.build);
  bx.registry.sub(() => store.set({ records: bx.registry.list().length }));
  store.set({ records: bx.registry.list().length });
  bx.jobs = { run: runJob };
  bx.rerunHooks = {};                                           // experiment type → (record) => Promise<new record>, registered by each workspace

  // ------------------------------------------------------------------ renderer
  const canvas = $("gl"); let T = null, gs = null, rig = null;
  const fatal = (msg) => { const f = $("fatal"); f.hidden = false; f.textContent = msg; $("boot").hidden = true; };
  if (!webglAvailable()) fatal("WebGL is not available in this browser: the 2-D view is used instead. Panels, timeline and the other workspaces work normally.");
  else {
    try { T = await loadThree(); } catch { fatal("three.js could not be loaded: the 2-D view is used instead."); }
    if (T) { gs = new BlackskyScene(T, canvas); rig = new CameraRig(T, gs, canvas, { onChange: () => {} }); rig.reduced = RM; gs.reduced = RM; }
  }
  bx.gs = gs; bx.rig = rig;
  if (!gs) { $("fatal").hidden = true; store.set({ camera: { ...store.get().camera, view: "2d" } }); }

  // ------------------------------------------------------------------ data
  const index = await getJSON("index.json");
  if (!index) { fatal("The network index (data/index.json) could not be loaded. Check that the data folder was deployed with the site."); document.body.dataset.ready = "error"; return; }
  bx.index = index;

  let seq = 0, inflight = null;
  bx.loadNet = async (id) => {
    const s0 = store.get(); if (s0.netId === id && s0.net) return s0.net;
    stopPlayback(); if (inflight) inflight.abort(); ++seq;
    store.set({ loading: true });
    let net; try { net = await loadNetwork(id, index); } catch (e) { store.set({ loading: false }); toast(String(e.message || e)); return null; }
    try { net.baseFlow = net.engine.run([]).frames[0].flow; } catch { net.baseFlow = null; }     // intact network (no outage): reference for the flow-surge overlay
    if (gs) { gs.build(net.model, { schematic: store.get().camera.schematic }); gs.setLayers(store.get().layers); rig.setScene(gs.L); panelOffset(); bx.overview(true); }
    $("net-sel").value = id;
    store.set({ netId: id, net, loading: false, run: { status: "idle" }, selection: null, hover: null, pinned: null, playback: { ...store.get().playback, i: 0, playing: false }, draft: { ...store.get().draft, set: [] } });
    return net;
  };

  // ------------------------------------------------------------------ cascade runs: one event model for all engines, every run registered
  bx.run = async (cfg) => {
    const net = store.get().net; if (!net) return null;
    stopPlayback(); if (inflight) inflight.abort(); const id = ++seq, ctl = new AbortController(); inflight = ctl;
    store.set({ run: { status: "running", id, cfg } });
    await new Promise((r) => setTimeout(r, 0));
    let out;
    try { out = await runScenario(net, { ...cfg, signal: ctl.signal }); }
    catch (e) {
      if (id !== seq) return null; const err = String(e.message || e);
      const rec = record({ grid: net.id, set: cfg.outage, engine: cfg.engine, policy: cfg.policy || TABLE_POLICY }, null, { error: err, label: cfg.label, parent: cfg.parent });
      store.set({ run: { status: "error", id, cfg, error: err, recordId: rec && rec.id } }); return null;
    } finally { if (inflight === ctl) inflight = null; }
    if (id !== seq) return null;
    const res = out.result, mode = res.mode === "ac" ? "ac" : "dc", k = res.outage.length;
    const events = buildEvents(res, net.model), trips = tripRounds(res), policy = res.policy || cfg.policy || TABLE_POLICY;
    const rank = mode === "dc" && policy === TABLE_POLICY && net.dists[k] ? rankOf(net.dists[k], res.metrics.S) : null;
    const ties = rank && rank.exact && !rank.zero ? net.dists[k].top.filter(([v]) => Math.abs(v - res.metrics.S) <= 1e-9).length : null;
    const sid = scenarioId({ grid: net.id, set: res.outage, engine: out.engine, policy });
    const run = { status: "done", id, cfg, grid: net.id, engine: out.engine, source: out.source, ms: out.ms, result: res, events, trips, rank, ties, mode, policy, k, scenarioId: sid,
      stages: deriveStages(res, events, net.model, rank), label: cfg.label || `${GRID_NAME[net.id]} · {${res.outage.join(", ")}}`, summary: runSummary(net, res, out.ms) };
    const rec = record({ grid: net.id, set: res.outage, engine: out.engine, policy }, run, { label: cfg.label, parent: cfg.parent, forceNew: cfg.forceNew });
    run.recordId = rec ? rec.id : null; run.reproduced = rec ? rec.__reused : false;
    store.set({ run, playback: { ...store.get().playback, i: 0, playing: false } });
    goEvent(0);
    return run;
  };
  bx.cancel = () => { if (inflight) inflight.abort(); };
  bx.sameSet = (a, b) => a.length === b.length && [...a].sort((x, y) => x - y).every((v, i) => v === [...b].sort((x, y) => x - y)[i]);

  // measured quantities of one run (units explicit); max loading over all rounds of the run, base / initial / final unserved demand
  function runSummary(net, res, ms) {
    const base = net.model.totalLoadMw, F = res.frames || [], m = res.metrics;
    let maxU = null, maxL = null; for (const f of F) for (const [l, u] of Object.entries(f.loading || {})) if (maxU == null || u > maxU) { maxU = u; maxL = +l; }
    const trips = (res.trips_per_round || F.map((f) => f.tripped)).flat().length, last = F[F.length - 1] || {};
    return { baseDemandMW: base, initialUnservedMW: m.S0 * base, finalUnservedMW: m.S * base, S: m.S, S0: m.S0, C: m.C, rounds: m.rounds, status: m.status, trips,
      componentsFinal: last.islands ?? null, deEnergisedFinal: last.energized_buses ? net.model.nBus - last.energized_buses.length : null, maxLoading: maxU, maxLoadingBranch: maxL,
      S_total: m.S_total ?? null, wallMs: ms, solver: res.mode === "ac" ? "AC Newton–Raphson (Python); convergence handled by the load-shedding ladder" : "DC: direct LU solve per island (no iteration; a singular matrix would stop the run with an error)" };
  }
  // experiment record for a cascade run (identical repeat of an identical configuration reuses the record; see registry policy)
  function record(sc, run, { error = null, label = null, parent = null, forceNew = false } = {}) {
    const net = store.get().net; if (!net) return null;
    const config = { grid: sc.grid, outage: [...sc.set].map(Number).sort((a, b) => a - b), engine: sc.engine, policy: sc.policy, model: net.model.config, ratingFamily: net.model.ratingFamily,
      dataSha256: net.model.provenance.file_sha256, matpowerCommit: net.model.provenance.matpower_commit };
    const sid = scenarioId({ grid: sc.grid, set: config.outage, engine: sc.engine, policy: sc.policy });
    const results = run ? { ...run.summary, rank: run.rank ? { rank: run.rank.rank, N: run.rank.N, exact: run.rank.exact, zero: !!run.rank.zero } : null, trips_per_round: (run.result.trips_per_round || run.result.frames.map((f) => f.tripped)), events: run.events.length, source: run.source } : null;
    const reg = bx.registry, hash = configHash(config);
    // dedupe: an identical configuration with an identical outcome (S and trips per round) reuses its existing record; any difference makes a new one
    if (!forceNew && run) {
      const same = reg.list().find((r) => r.type === "cascade" && r.status === "completed" && r.configHash === hash && r.results &&
        Math.abs(r.results.S - results.S) <= 1e-12 && JSON.stringify(r.results.trips_per_round) === JSON.stringify(results.trips_per_round));
      if (same) return { ...same, __reused: true };
    }
    try {
      return reg.add({ type: "cascade", name: label || `Cascade ${GRID_NAME[sc.grid]} {${config.outage.join(", ")}} · ${ENGINE_NAME[sc.engine] || sc.engine}`, config, seed: null, scenarioIds: [sid],
        provenance: run ? "simulator" : "unavailable", status: error ? "failed" : "completed", results, errors: error ? [error] : [], durationMs: run ? run.ms : null, parent,
        limitations: limitationsFor("cascade"), log: run ? [{ t: 0, msg: `${run.events.length} events, ${run.summary.rounds} rounds, ${run.summary.status}` }, { t: run.ms, msg: `source: ${run.source}` }] : [{ t: 0, msg: `failed: ${error}` }] });
    } catch (e) { toast(`Record not stored: ${e.message}`); return null; }
  }

  // ------------------------------------------------------------------ playback
  let ptimer = 0;
  function stopPlayback() { clearTimeout(ptimer); ptimer = 0; const p = store.get().playback; if (p.playing) store.set({ playback: { ...p, playing: false } }); }
  function frameEvent(ev) {
    if (!gs || !rig || store.get().camera.view === "2d") return; const s = store.get();
    if (ev.type === "termination") { bx.overview(); return; }
    const keys = ev.entities.length ? ev.entities : ev.type === "round" ? null : s.run.result.outage.map((l) => `branch:${l}`);
    if (keys) rig.frame(keys.filter((k) => s.net.model.byKey.has(k)).flatMap((k) => gs.entityPoints(k)), { minRadius: 10, ms: 800 });
  }
  function goEvent(i, { frame = true } = {}) {
    const s = store.get(); if (s.run.status !== "done") return; const n = s.run.events.length; i = Math.max(0, Math.min(n - 1, i));
    store.set({ playback: { ...s.playback, i } });
    if (frame && s.follow) frameEvent(s.run.events[i]);
  }
  function play() {
    const s = store.get(); if (s.run.status !== "done") return;
    const start = s.playback.i >= s.run.events.length - 1 ? 0 : s.playback.i;
    store.set({ playback: { ...s.playback, playing: true } }); goEvent(start);
    const tick = () => { const st = store.get(); if (!st.playback.playing) return;
      if (st.playback.i >= st.run.events.length - 1) { store.set({ playback: { ...st.playback, playing: false } }); return; }
      const ev = st.run.events[st.playback.i];
      ptimer = setTimeout(() => { if (!store.get().playback.playing) return; goEvent(store.get().playback.i + 1); tick(); }, (DWELL[ev.type] ?? 1000) / st.playback.speed); };
    tick();
  }
  Object.assign(bx, {
    goEvent, play, pause: stopPlayback, togglePlay: () => (store.get().playback.playing ? stopPlayback() : play()),
    step: (d) => { stopPlayback(); goEvent(store.get().playback.i + d); },
    reset: () => { stopPlayback(); goEvent(0, { frame: false }); bx.overview(); },
    replay: () => { stopPlayback(); goEvent(0, { frame: false }); play(); },
    setSpeed: (v) => store.set({ playback: { ...store.get().playback, speed: v } }),
    goStage: (id) => { const st = store.get().run.stages?.find((x) => x.id === id); if (st && st.occurred && st.eventIndex >= 0) { stopPlayback(); goEvent(st.eventIndex); } },
  });
  bx.currentEvent = () => { const s = store.get(); return s.run.status === "done" ? s.run.events[s.playback.i] : null; };
  bx.currentStage = () => { const s = store.get(); return s.run.status === "done" ? stageAt(s.run.stages, s.playback.i) : null; };

  // ------------------------------------------------------------------ view state (shared encoding) → scene
  let view = null;
  bx.frameIndex = () => { const ev = bx.currentEvent(); return ev ? ev.frame : null; };
  bx.view = () => view;
  bx.runOnNet = () => { const s = store.get(); return s.run.status === "done" && s.run.grid === s.netId ? s.run : null; };
  function computeView() {
    const s = store.get(); if (!s.net) return (view = null); const r = bx.runOnNet();
    view = r ? viewState(s.net.model, r.result, bx.frameIndex(), r.trips) : viewState(s.net.model, null, 0); return view;
  }
  // APEX branch overlays (Layers → line colour): fault lines from the stored exhaustive table, flow surge from two engine solutions
  let ovCache = null;
  bx.overlay = () => {
    const s = store.get(), mode = s.layers.overlay || "loading"; if (!s.net || mode === "loading" || !view) return null;
    const m = s.net.model;
    if (mode === "faults") { const k = s.net.dists[s.layers.faultK] ? s.layers.faultK : s.net.tableKs[s.net.tableKs.length - 1], d = s.net.dists[k]; if (!d) return null;
      const key = `${s.netId}:${k}`; if (!ovCache || ovCache.key !== key) ovCache = { key, k, ...faultCounts(d.top, m.nBranch) };
      return { mode, k, sets: ovCache.sets, counts: ovCache.counts, max: ovCache.max, ...branchOverlay("faults", ovCache) }; }
    if (mode === "surge") { if (!s.net.baseFlow) return null; const r = bx.runOnNet(); const f = r ? view.frame?.flow : s.net.baseFlow;
      const surge = flowSurge(f, s.net.baseFlow, m.branches.map((b) => b.rating_dc_mw)); return { mode, surge, ...branchOverlay("surge", { surge }) }; }
    return null;
  };
  bx.overlayRamp = (mode) => (mode === "faults" ? RAMPS.fault : RAMPS.surge).map(css);
  let tweenNext = false, lastEvent = -1, lastRunId = null;
  function syncScene() {
    computeView(); if (!view) return; const s = store.get(); bx.view2d && bx.view2d.render();
    const tween = tweenNext; tweenNext = false;
    if (!gs) return; gs.reduced = s.reduced; rig.reduced = s.reduced; gs.setView(view, { flow: s.layers.flow, tween, overlay: bx.overlay() });
    const r = bx.runOnNet(), i = s.playback.i;
    if (r && r.id === lastRunId && i === lastEvent + 1) gs.fx(r.events[i]);       // forward by one event: propagate; jumps and rewinds just show the state
    lastEvent = r ? i : -1; lastRunId = r ? r.id : null;
    gs.highlight("sel", s.selection); gs.highlight("hov", s.hover && s.hover !== s.selection ? s.hover : null); syncArm();
  }
  bx.draftArmed = () => { const s = store.get(), r = bx.runOnNet(); return s.draft.set.length && !(r && bx.sameSet(r.result.outage, s.draft.set)) ? s.draft.set : []; };
  function syncArm() { if (gs) gs.arm(bx.draftArmed()); bx.view2d && bx.view2d.render(); }

  // ------------------------------------------------------------------ selection
  bx.label = (key) => entityLabel(store.get().net.model, key);
  bx.select = (key, { focus = false } = {}) => { const m = store.get().net?.model; const k = key && m && m.byKey.has(key) ? key : null; store.set({ selection: k }); if (focus && k) bx.focus(k); };
  bx.focus = (key) => { if (gs && key && store.get().camera.view !== "2d") rig.frame(gs.entityPoints(key), { minRadius: 16 }); };
  bx.frameKeys = (keys, minRadius = 8) => { if (gs && keys.length && store.get().camera.view !== "2d") rig.frame(keys.flatMap((k) => gs.entityPoints(k)), { minRadius }); };
  bx.parseEntity = (t) => parseEntity(t, store.get().net.model);

  // ------------------------------------------------------------------ outage draft (configuration of the next scenario)
  bx.setDraft = (p) => store.set({ draft: { ...store.get().draft, ...p } });
  bx.toggleDraft = (l) => {
    const s = store.get(), m = s.net.model, d = s.draft.set; if (!m.branches[l]) return;
    if (d.includes(l)) { bx.setDraft({ set: d.filter((x) => x !== l) }); return; }
    if (d.length >= 8) { toast("At most 8 branches in one contingency"); return; }
    if (!m.branches[l].in_service) { toast(`Branch ${l} is out of service in the base case`); return; }
    bx.setDraft({ set: [...d, l] });
  };

  // ------------------------------------------------------------------ cross-workspace scenario opening (Arena / ML / Evidence → Theater)
  bx.openScenario = async ({ grid, set, engine = "browser-dc", policy = TABLE_POLICY, label = null, play: autoplay = false, parent = null, forceNew = false }) => {
    bx.setWorkspace("theater"); if (store.get().netId !== grid) await bx.loadNet(grid);
    bx.setDraft({ set: [...set], k: String(set.length), engine, policy });
    const r = await bx.run({ engine, outage: set, policy, origin: "open", label, parent, forceNew });
    if (r) { if (autoplay && !store.get().reduced) play(); else bx.overview(); }
    return r;
  };

  // ------------------------------------------------------------------ workspaces and routing (#theater #quantum #arena #ml #evidence)
  const loaded = new Map();
  const MODS = { quantum: () => import("./ws/quantum.js"), arena: () => import("./ws/arena.js"), ml: () => import("./ws/ml.js"), evidence: () => import("./ws/evidence.js") };
  async function ensureWs(w) {
    if (w === "theater" || loaded.has(w)) return loaded.get(w);
    const p = MODS[w]().then((m) => m.init(bx, $(`ws-${w}`))).catch((e) => { $(`ws-${w}`).innerHTML = `<div class="ws-head"><h1>${esc(WS_NAME[w])}</h1></div><div class="pane center" style="grid-column:1/-1"><div class="pane-b"><div class="m-err">This workspace could not be loaded: ${esc(e.message || e)}</div></div></div>`; console.error(e); });
    loaded.set(w, p); return p;
  }
  bx.ensureWs = ensureWs;
  bx.setWorkspace = (w) => { if (!WORKSPACES.includes(w)) return; store.set({ ws: w }); if (location.hash.slice(1) !== w) history.replaceState(null, "", `#${w}`); };
  window.addEventListener("hashchange", () => { const w = routeOf(location.hash); if (w) store.set({ ws: w }); });
  document.querySelectorAll(".ws-nav a").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); bx.setWorkspace(a.dataset.ws); }));
  $("net-sel").onchange = async (e) => { await bx.loadNet(e.target.value); };

  // ------------------------------------------------------------------ camera, views and layers
  bx.setCameraMode = (m) => { if (!rig) return; if (m === "follow" && !store.get().selection) { toast("Select an entity to track it"); return; } rig.setMode(m); store.set({ camera: { ...store.get().camera, mode: m } }); };
  bx.setView = (v) => {
    const c = store.get().camera; if (v !== "2d" && !gs) { toast("WebGL is unavailable here; only the 2-D view can be shown."); return; }
    if (v === "2d") { store.set({ camera: { ...c, view: "2d" } }); return; }
    const sch = v === "schematic"; if (gs && sch !== c.schematic) { gs.build(store.get().net.model, { schematic: sch }); gs.setLayers(store.get().layers); rig.setSchematic(sch); rig.setScene(gs.L); gs.resize(); }
    store.set({ camera: { ...c, view: v === "schematic" ? "schematic" : "3d", schematic: sch, mode: sch ? "orbit" : c.mode } }); if (!sch) bx.overview(true); syncScene();
  };
  bx.setSchematic = (on) => bx.setView(on ? "schematic" : "3d");
  bx.setLayer = (k, on) => { const l = { ...store.get().layers, [k]: on }; store.set({ layers: l }); if (gs) gs.setLayers(l); syncScene(); if (k === "overlay" || k === "faultK") { renderLegend(); bx.onOverlay && bx.onOverlay(); } };
  bx.zoom = (dir) => { if (rig && store.get().camera.view !== "2d") { rig.anim = null; rig._zoom(dir * 320); } else bx.view2d && bx.view2d.zoom(dir); };
  bx.overview = (instant = false) => {
    if (store.get().camera.view === "2d") { bx.view2d && bx.view2d.reset(); return; }
    if (!gs || !gs.L) return; const b = gs.L.bounds, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, sx = b.maxX - b.minX, sz = b.maxZ - b.minZ;
    if (store.get().camera.schematic) { rig.frame(gs.L.bus.map((p) => [p.x, p.top, p.z]), { ms: instant ? 0 : 800 }); return; }
    if (rig.mode === "recon") bx.setCameraMode("orbit");
    const r = canvas.getBoundingClientRect(), asp = Math.max(200, r.width - 2 * Math.abs(gs.offsetX || 0)) / Math.max(1, r.height), t = Math.tan((gs.persp.fov / 2) * Math.PI / 180), el = (52 * Math.PI) / 180;
    const dist = (across, deep) => Math.max(across / 2 / (t * asp * 0.82), (deep / 2 * Math.sin(el) + 1.5) / (t * 0.86), 8);
    const dS = dist(sx, sz), dE = dist(sz, sx);
    if (dE < dS * 0.85) rig.to([cx + dE * Math.cos(el), dE * Math.sin(el), cz], [cx, 0, cz], instant ? 0 : 800);
    else rig.to([cx, dS * Math.sin(el), cz + dS * Math.cos(el)], [cx, 0, cz], instant ? 0 : 800);
  };
  bx.preset = (name) => {
    if (!gs || !gs.L || store.get().camera.view !== "3d") { bx.overview(); return; }
    const b = gs.L.bounds, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    if (rig.mode === "recon") bx.setCameraMode("orbit");
    if (name === "top") rig.to([cx, span * 1.25 + 8, cz + 0.01], [cx, 0, cz], 800);
    else if (name === "east") rig.to([cx + span * 0.95, span * 0.55, cz], [cx, 0, cz], 800);
    else bx.overview();
  };
  bx.centerOn = (x, z) => { if (!gs || !rig || store.get().camera.view !== "3d") return; const d = [rig.p.x - rig.t.x, rig.p.y - rig.t.y, rig.p.z - rig.t.z]; rig.to([x + d[0], rig.t.y + d[1], z + d[2]], [x, rig.t.y, z], 500); };
  bx.fullscreen = (on) => { document.body.classList.toggle("fs", on); if (on) document.documentElement.requestFullscreen?.().catch(() => {}); else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); setTimeout(() => { panelOffset(); gs && gs.resize(); bx.view2d && bx.view2d.reset(); }, 60); };
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && document.body.classList.contains("fs")) bx.fullscreen(false); });
  $("fs-exit").onclick = () => bx.fullscreen(false);
  function panelOffset() {
    if (!gs) return; const s = store.get(), wide = innerWidth > 900 && !document.body.classList.contains("fs");
    const lw = wide ? $("left").offsetWidth + 12 : 0, rw = wide && !$("right").hidden ? $("right").offsetWidth + 12 : 0, dx = (lw - rw) / 2;
    document.documentElement.style.setProperty("--offx", `${dx}px`); if (dx !== gs.offsetX) { gs.setOffset(dx); rig._apply(); }
    void s;
  }
  bx.panelOffset = panelOffset; addEventListener("resize", panelOffset);

  // ------------------------------------------------------------------ pointer picking (3-D)
  if (gs) {
    let raf = 0, xy = null;
    canvas.addEventListener("pointermove", (e) => { if (rig.drag) return; xy = [e.offsetX, e.offsetY, e.pointerType]; if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (!xy) return;
      const k = gs.pick(xy[0], xy[1], xy[2] === "touch" ? 16 : 9); if (k !== store.get().hover) store.set({ hover: k }); canvas.classList.toggle("pointing", !!k); }); });
    canvas.addEventListener("pointerleave", () => { xy = null; if (store.get().hover) store.set({ hover: null }); });
    canvas.addEventListener("click", (e) => {
      if ((rig.lastDragMoved || 0) > 4) return;
      const k = gs.pick(e.offsetX, e.offsetY, e.pointerType === "touch" ? 16 : 10);
      if (k && k.startsWith("branch:") && (e.shiftKey || e.altKey)) { bx.toggleDraft(+k.split(":")[1]); return; }
      bx.select(k);
    });
    canvas.addEventListener("dblclick", (e) => { const k = gs.pick(e.offsetX, e.offsetY, 10); if (k && k.startsWith("branch:")) bx.toggleDraft(+k.split(":")[1]); else if (k) bx.focus(k); });
  }

  // ------------------------------------------------------------------ keyboard
  window.addEventListener("keydown", (e) => {
    if (document.body.classList.contains("arrival-on")) { if (e.key === "Escape") bx.arrival.close(); return; }
    if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); bx.palette(true); return; }
    if (e.target.closest && e.target.closest("input:not([type=range]), textarea, select, [contenteditable]")) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return; const s = store.get(), k = e.key;
    if (!$("cmdk").hidden || !$("textout").hidden) { if (k === "Escape") { bx.palette(false); bx.closeText(); } return; }
    if (!$("help").hidden) { if (k === "Escape" || k === "?") bx.help(false); return; }
    if (k >= "1" && k <= "5") { bx.setWorkspace(WORKSPACES[+k - 1]); return; }
    if (k === "?") { bx.help(true); return; }
    if (k === "/") { e.preventDefault(); bx.palette(true); return; }
    if (s.ws !== "theater") return;                                       // the remaining keys drive the Theater
    if (s.camera.mode === "recon" && "wasdrfWASDRF".includes(k) && k.length === 1) return;
    if (e.target.type === "range" && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(k)) return;
    if (k === " " && !(e.target.closest && e.target.closest("button, a"))) { e.preventDefault(); bx.togglePlay(); }
    else if (k === "ArrowRight" || k === "]") { e.preventDefault(); bx.step(1); }
    else if (k === "ArrowLeft" || k === "[") { e.preventDefault(); bx.step(-1); }
    else if (k === "Home") bx.reset();
    else if (k === "f" || k === "F") { if (s.selection) bx.focus(s.selection); }
    else if (k === "o" || k === "O") bx.overview();
    else if (k === "+" || k === "=") bx.zoom(-1);
    else if (k === "-" || k === "_") bx.zoom(1);
    else if (k === "Escape") { if (document.body.classList.contains("fs")) bx.fullscreen(false); else if (!$("pop").hidden) bx.explain(null); else if (s.camera.mode === "recon") bx.setCameraMode("orbit"); else if (s.selection) bx.select(null); }
  });

  // ------------------------------------------------------------------ metric and provenance popovers
  const pop = $("pop");
  bx.explain = (key, anchor) => {
    const m = key && (METRICS[key] || (key.startsWith("prov:") && PROVENANCE[key.slice(5)] ? { label: PROVENANCE[key.slice(5)].label, definition: PROVENANCE[key.slice(5)].means, unit: "result classification", source: "sci/contracts.js PROVENANCE", scope: "same meaning in all five workspaces" } : null));
    if (!m) { pop.hidden = true; return; }
    pop.innerHTML = `<h5>${esc(m.label)}</h5><dl><dt>Means</dt><dd>${esc(m.definition)}</dd><dt>Unit</dt><dd>${esc(m.unit)}</dd><dt>Source</dt><dd>${esc(m.source)}</dd><dt>Scope</dt><dd>${esc(m.scope)}</dd></dl>`;
    pop.hidden = false; const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = `${Math.max(12, Math.min(innerWidth - w - 12, r.left - 8))}px`; pop.style.top = `${r.bottom + h + 8 < innerHeight ? r.bottom + 6 : Math.max(12, r.top - h - 6)}px`;
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-explain]");
    if (b) { e.stopPropagation(); bx.explain(pop.hidden || pop.dataset.k !== b.dataset.explain ? b.dataset.explain : null, b); pop.dataset.k = pop.hidden ? "" : b.dataset.explain; return; }
    if (!pop.hidden && !e.target.closest("#pop")) { pop.hidden = true; pop.dataset.k = ""; }
  });
  bx.ib = (key) => `<button class="ib" data-explain="${key}" aria-label="What is ${esc(METRICS[key].label)}?">i</button>`;
  bx.prov = provChip;

  // ------------------------------------------------------------------ text export modal (works where downloads are blocked) + download
  let textFile = null;
  bx.exportText = ({ title, text, filename, mime = "text/plain", note = "" }) => {
    textFile = { text, filename, mime }; $("textout-h").textContent = title; $("textout-note").textContent = note || `${filename} · ${int(text.length)} characters`;
    $("textout-ta").value = text; $("textout").hidden = false; $("textout-copy").focus();
  };
  bx.closeText = () => { $("textout").hidden = true; };
  bx.download = (text, filename, mime = "text/plain") => {
    try { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); return true; }
    catch { return false; }
  };
  $("textout-x").onclick = bx.closeText; $("textout").addEventListener("click", (e) => { if (e.target.id === "textout") bx.closeText(); });
  $("textout-copy").onclick = () => { const t = $("textout-ta"); navigator.clipboard?.writeText(t.value).then(() => toast("Copied"), () => { t.select(); toast("Copy blocked: text selected, press Ctrl/⌘ C"); }) ?? (t.select(), toast("Text selected: press Ctrl/⌘ C")); };
  $("textout-dl").onclick = () => { if (textFile) { bx.download(textFile.text, textFile.filename, textFile.mime); toast("Download started (if this page is sandboxed, use Copy instead)"); } };
  bx.copy = (text, what = "Copied") => { navigator.clipboard?.writeText(text).then(() => toast(what), () => bx.exportText({ title: "Copy", text, filename: "copy.txt" })) ?? bx.exportText({ title: "Copy", text, filename: "copy.txt" }); };

  // ------------------------------------------------------------------ help
  bx.help = (on) => {
    const h = $("help"); h.hidden = !on; if (!on) { $("help-btn").focus(); return; }
    $("help-card").innerHTML = `<div class="row" style="justify-content:space-between"><h3 id="help-h">BLACKSKY Command · Omega</h3><button class="btn sm" id="help-x">Close</button></div>
      <p class="note" style="margin:4px 0 10px">Which combinations of transmission-line failures produce the most severe cascades on the IEEE test networks, how confidently can we find them, and what can classical, ML-guided and quantum search contribute? Five workspaces share one network, one scenario id and one experiment registry.</p>
      <table>${[["1 – 5", "Cascade Theater · Quantum Lab · Algorithm Arena · ML Observatory · Evidence Lab"], ["Ctrl/⌘ K or /", "command palette: workspaces, networks, branches, buses, experiments, exports"],
        ["Space", "play / pause the cascade"], ["← → or [ ]", "previous / next event"], ["Home", "reset to the start"], ["drag · right-drag · wheel", "orbit · pan · zoom (Schematic and 2-D: drag pans)"],
        ["Recon: W A S D R F", "fly; Esc returns to Orbit"], ["click", "select an entity"], ["Shift+click, double-click", "add / remove a branch in the outage set"], ["F / O", "focus selection / overview"],
        ["+ / −", "zoom"], ["Esc", "close, leave Recon or full screen, clear selection"], ["?", "this help"]].map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("")}</table>
      <h4 style="margin:14px 0 6px;font-size:13px">Result classes</h4><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:6px 14px">${Object.keys(PROVENANCE).map((k) => `<div class="row" style="flex-wrap:nowrap;align-items:flex-start">${provChip(k)}<span class="note">${esc(PROVENANCE[k].means)}</span></div>`).join("")}</div>
      <h4 style="margin:14px 0 6px;font-size:13px">Scene legend</h4><div id="help-legend" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px 14px;font-size:12px;color:var(--tx-2)">${legendItems().join("")}</div>
      <p class="note" style="margin-top:10px">${esc(APP.name)} ${esc(APP.edition)} ${esc(APP.version)}${bx.build?.commit ? ` · built from commit ${esc(bx.build.commit.slice(0, 10))}${bx.build.dirty ? " (with uncommitted changes)" : ""}` : ""}. No live grid data; no quantum hardware. ${gs ? `Renderer: ${esc(gs.qualityLabel())} · ${gs.info().calls} draw calls.` : "Renderer: 2-D (no WebGL)."}</p>`;
    $("help-x").onclick = () => bx.help(false); $("help-x").focus();
  };
  $("help-btn").onclick = () => bx.help(true);
  $("help").addEventListener("click", (e) => { if (e.target.id === "help") bx.help(false); });

  // ------------------------------------------------------------------ chrome: workspaces, status chips, readout, legend
  function renderChrome(s, ch) {
    if (ch.has("ws")) {
      document.querySelectorAll(".ws-nav a").forEach((a) => (a.dataset.ws === s.ws ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
      const th = s.ws === "theater"; $("stage").hidden = !th; document.querySelector(".dock").hidden = !th;
      WORKSPACES.slice(1).forEach((w) => ($(`ws-${w}`).hidden = w !== s.ws));
      document.title = `BLACKSKY Command · ${WS_NAME[s.ws]}`; if (!th) ensureWs(s.ws);
      if (th && gs) { gs.dirty = true; setTimeout(() => { gs.resize(); panelOffset(); }, 0); }
    }
    if (ch.has("api") || ch.has("bsapi")) { const a = s.api.state; $("api-dot").className = `dot ${a === "ok" ? "ok" : a === "checking" ? "wait" : ""}`;
      $("api-txt").textContent = a === "ok" ? `API online${s.bsapi.state === "ok" ? " · Qiskit" : ""}` : a === "checking" ? "API: checking" : "API offline";
      $("api-chip").title = a === "ok" ? `Python API at ${apiBase()}: API DC/AC engines are available.${s.bsapi.state === "ok" ? " BLACKSKY API with Qiskit (transpile, Aer cross-check) is available." : ""}` : `No API at ${apiBase()} (static deployment, or blacksky/serve.py not running). Browser engines, stored runs and the worker still work.`; }
    if (ch.has("run") || ch.has("loading") || ch.has("net")) {
      const r = s.run, dot = $("eng-dot"), tx = $("eng-txt");
      if (s.loading) { dot.className = "dot wait"; tx.textContent = "loading network"; }
      else if (r.status === "running") { dot.className = "dot wait"; tx.textContent = `running · ${ENGINE_NAME[r.cfg.engine]}`; }
      else if (r.status === "error") { dot.className = "dot bad"; tx.textContent = "run failed"; }
      else if (r.status === "done") { dot.className = "dot ok"; tx.textContent = `${ENGINE_NAME[r.engine]} · ${r.ms < 1000 ? `${r.ms.toFixed(0)} ms` : `${(r.ms / 1000).toFixed(1)} s`}`; }
      else { dot.className = s.net ? "dot ok" : "dot"; tx.textContent = s.net ? "browser engine ready" : "engine loading"; }
      $("boot").hidden = !!s.net || !s.loading;
      const sid = r.status === "done" ? r.scenarioId : null; $("scn-txt").textContent = sid || "no scenario"; $("scn-dot").className = `dot ${sid ? "ok" : ""}`;
      $("scn-chip").title = sid ? `Active scenario ${sid}${r.recordId ? ` · experiment ${r.recordId}` : ""}. Click to inspect.` : "No scenario has been run yet";
      $("model-chip").firstElementChild.textContent = `${r.status === "done" && r.mode === "ac" ? "AC" : "DC"} · ${(r.status === "done" ? r.policy : s.draft.policy) === "most_overloaded_first" ? "most-overloaded-first" : "all-overloaded"}`;
    }
    if (ch.has("job")) { const j = s.job; $("job-chip").hidden = !j; if (j) $("job-txt").textContent = `${j.label}${j.pct != null ? ` ${Math.round(j.pct)}%` : "…"}`; }
  }
  bx.setJob = (j) => store.set({ job: j });
  $("scn-chip").onclick = () => { const r = bx.runOnNet(); if (!r) { toast("No scenario yet: run one in the Cascade Theater"); return; } bx.setWorkspace("theater"); bx.inspectorTab && bx.inspectorTab("run"); };

  function renderReadout() {
    const s = store.get(), el = $("readout"); if (!s.net || !view) { el.innerHTML = ""; return; }
    const r = bx.runOnNet(), f = view.frame, m = s.net.model, served = r ? view.loadServed : 1, dark = view.buses.filter((b) => !b.energized).length;
    const out = view.branches.filter((b) => b.state === "initial_outage" || b.state === "tripped").length, R = r ? r.result.frames.length : 0;
    const live = r ? r.events.filter((e) => e.type === "round" && e.frame === (f ? bx.frameIndex() : 0)).map((e) => e.values.energisedIslands)[0] : null;
    const src = r ? r.label : "Base case (no run)";
    el.innerHTML = `<div class="cell src"><div class="k">Showing</div><div class="v" title="${esc(src)}">${esc(src)}</div></div><div class="cell"><div class="k">Demand served ${bx.ib("S")}</div><div class="v" style="color:var(--lamp)">${pc(served)}</div><div class="lamp-bar"><i style="width:${(100 * served).toFixed(1)}%"></i></div></div>
      <div class="cell"><div class="k">Buses dark</div><div class="v">${dark}<span class="faint" style="font-size:12px"> / ${m.nBus}</span></div></div>
      <div class="cell opt"><div class="k">Branches out</div><div class="v">${out}<span class="faint" style="font-size:12px"> / ${m.nBranch}</span></div></div>
      <div class="cell opt"><div class="k">${live == null && f ? "Components" : "Islands"} ${bx.ib("islands")}</div><div class="v">${live ?? (f ? f.islands : 1)}</div></div>
      <div class="cell"><div class="k">Round ${bx.ib("rounds")}</div><div class="v">${r ? `${(bx.frameIndex() ?? 0) + 1}<span class="faint" style="font-size:12px"> / ${R}</span>` : "base"}</div></div>`;
  }
  function legendItems() {
    const s = store.get(), r = bx.runOnNet(), ac = r && r.mode === "ac", unknown = gs && gs.lampUnknown, ov = bx.overlay();
    const ovItem = !ov ? [] : [`<span class="it ov"><span class="sw grad" style="background:linear-gradient(90deg,${bx.overlayRamp(ov.mode).join(",")});width:46px;height:5px"></span><span>${ov.mode === "faults"
      ? `line colour = how often the line is in the ${ov.sets} most damaging ${ov.k}-line sets (exhaustive DC table, synthetic ratings; log scale, max ${ov.max})`
      : "line colour = flow added since the intact network, as a share of the line's DC rating (bright = +50 % or more); dim = flow fell"}</span></span>`];
    return [...ovItem,
      `<span class="it"><span class="sw" style="background:${CSS.lamp}"></span><span>${unknown ? "lit = energised (per-bus curtailment not recorded)" : "lamp = demand served"}</span></span>`,
      `<span class="it"><span class="sw" style="background:${CSS.green}"></span><span>generator online</span></span>`,
      `<span class="it"><span class="sw" style="background:#a8742a"></span><span>80–100% of ${ac ? "AC" : "DC"} rating</span></span>`,
      `<span class="it"><span class="sw" style="background:${CSS.amber};height:5px"></span><span>above rating</span></span>`,
      `<span class="it"><span class="sw dash"></span><span>initial outage (T0)</span></span>`,
      `<span class="it"><span class="sw dash" style="opacity:.55;height:2px"></span><span>tripped by the cascade (R<i>n</i>)</span></span>`,
      `<span class="it"><span class="sw" style="background:linear-gradient(90deg,#ffd2c4,${CSS.red});height:4px"></span><span>line burning out: tripped at this step of the replay</span></span>`,
      `<span class="it"><span class="sw" style="background:${CSS.red};opacity:.85;height:4px"></span><span>outage set being configured</span></span>`,
      `<span class="it"><span class="sw" style="background:${CSS.ice}"></span><span>selection</span></span>`,
      `<span class="it faint">schematic, non-geographic layout${s.net && s.net.model.kvs.length > 1 ? "; height = voltage class" : ""}</span>`];
  }
  let legendOpen = innerWidth >= 1700;
  function renderLegend() {
    const s = store.get(), el = $("legend"); if (!s.net) return; el.classList.toggle("closed", !legendOpen);
    el.innerHTML = `<div class="lg-h"><span class="micro">Legend</span><button id="lg-t" aria-expanded="${legendOpen}">${legendOpen ? "Hide" : "Show"}</button></div>${legendOpen ? legendItems().join("") : ""}`;
    $("lg-t").onclick = () => { legendOpen = !legendOpen; renderLegend(); };
  }
  bx.legendItems = legendItems;

  // ------------------------------------------------------------------ store → everything
  store.sub((s, ch) => {
    renderChrome(s, ch);
    if (ch.has("playback") && !ch.has("run") && !ch.has("net")) tweenNext = true;
    if (["net", "run", "playback", "reduced"].some((k) => ch.has(k))) { syncScene(); renderReadout(); renderLegend(); }
    else {
      if (ch.has("selection") || ch.has("hover")) { if (gs) { gs.highlight("sel", s.selection); gs.highlight("hov", s.hover && s.hover !== s.selection ? s.hover : null); } bx.view2d && bx.view2d.render(); }
      if (ch.has("draft")) syncArm();
    }
    if (ch.has("camera")) { const two = s.camera.view === "2d"; $("svg2d").toggleAttribute("hidden", !two); canvas.style.visibility = two ? "hidden" : "visible"; $("labels").hidden = two; if (two) bx.view2d && bx.view2d.reset(); else if (gs) gs.dirty = true; }
    if (ch.has("selection") && s.camera.mode === "follow" && !s.selection) bx.setCameraMode("orbit");
  });

  // ------------------------------------------------------------------ render loop (draws only on change or while flow animates; paused outside the Theater)
  if (gs) {
    new ResizeObserver(() => { gs.resize(); rig._apply && rig.L && rig._apply(); }).observe($("stage"));
    let last = performance.now();
    const loop = (t) => { const dt = Math.min((t - last) / 1000, 0.05); last = t; const s = store.get();
      if (!document.hidden && gs.model && s.ws === "theater" && s.camera.view !== "2d") { rig.update(dt, s.camera.mode === "follow" && s.selection ? gs.entityPos(s.selection) : null); if (gs.render(dt)) { bx.onFrame && bx.onFrame(); bx.minimap && bx.minimap.draw(); } }
      requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------ Theater panels, 2-D view, minimap, palette
  initLabels(bx); initTimeline(bx); initScenarioPanel(bx); initInspector(bx); initView2D(bx); initMinimap(bx); initPalette(bx);
  if (innerWidth <= 900) { $("left").classList.add("collapsed"); $("right").classList.add("collapsed"); document.querySelectorAll(".sheet-toggle").forEach((b) => b.setAttribute("aria-expanded", "false")); }
  renderChrome(store.get(), new Set(["ws", "api", "run", "job"]));

  // optional APIs (never required)
  apiAvailable().then((ok) => store.set({ api: { state: ok ? "ok" : "off" } }));
  bsapiAvailable().then((ok) => store.set({ bsapi: { state: ok ? "ok" : "off" } }));

  // featured scenarios (from the stored data files; numbers are recomputed when they run)
  const feat = []; const add = async (grid, file, pick, title, sub) => { const d = await getJSON(file); const r = d && pick(d); if (r && r.dc) feat.push({ id: `${grid}:${r.dc.outage.join("-")}`, grid, outage: r.dc.outage, title, sub, hasAc: !!r.ac }); };
  await add("ieee118", "top_cascades_ieee118_k3.json", (d) => d[0], "Worst triple · IEEE 118", "Top of the exhaustive table of all 3-branch sets");
  await add("ieee118", "top_cascades_ieee118_k2.json", (d) => d[0], "Worst pair · IEEE 118", "Top of the exhaustive table of all 2-branch sets");
  await add("ieee30", "top_cascades_ieee30_k3.json", (d) => d[0], "Worst triple · IEEE 30", "Stored AC run available: Inspector → Compare");
  await add("ieee30", "examples_ieee30_k3.json", (d) => d.isolation_only, "Isolation without cascade · IEEE 30", "Demand is lost at once; nothing trips");
  await add("ieee14", "examples_ieee14_k2.json", (d) => d.benign, "Absorbed outage · IEEE 14", "The network rides through: no trips, no lost demand");
  store.set({ featured: feat });
  bx.playFeatured = async (id, { autoplay = false } = {}) => {
    const f = store.get().featured.find((x) => x.id === id); if (!f) return;
    store.set({ featuredId: id }); await bx.loadNet(f.grid); bx.setDraft({ set: [...f.outage], k: String(f.outage.length), engine: "browser-dc", policy: TABLE_POLICY });
    const r = await bx.run({ engine: "browser-dc", outage: f.outage, policy: TABLE_POLICY, label: f.title, origin: "featured" });
    if (r) { if (autoplay && !store.get().reduced) play(); else bx.overview(); }
  };
  await bx.loadNet("ieee118");
  if (feat.length) await bx.playFeatured(feat[0].id);
  if (store.get().ws !== "theater") await ensureWs(store.get().ws);
  initBriefing(bx); initArrival(bx);
  document.body.dataset.ready = "1";
}

boot().catch((e) => { document.body.dataset.ready = "error"; const f = document.getElementById("fatal"); f.hidden = false; f.textContent = `BLACKSKY could not start: ${e && e.message ? e.message : e}`; console.error(e); });
