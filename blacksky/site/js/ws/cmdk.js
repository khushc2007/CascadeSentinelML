// Command palette (Ctrl/⌘ K or /), Theater layer menu, and saved investigation sessions. Every command calls a real application action.
// Sessions store the workspace, network, camera pose, view and layers, the outage set / scenario id and the experiment ids — never results:
// restoring re-runs the scenario with the engine.
import { $, esc, toast, storage, GRID_NAME } from "../util.js";
import { parseScenarioId, SCHEMAS } from "../sci/contracts.js";

const SKEY = "blacksky.sessions.v1";
const LAYERS = [["labels", "Labels"], ["flow", "Flow arrows (visual convention)"], ["grid", "Reference grid"], ["lights", "Light pools"], ["gens", "Generators"], ["loads", "Demand facilities"], ["minimap", "Overview map"]];

export function initPalette(bx) {
  const { store } = bx, dlg = $("cmdk"), inp = $("cmdk-in"), list = $("cmdk-list"); let items = [], sel = 0, lastFocus = null;

  // ------------------------------------------------------------------ sessions
  bx.sessions = {
    list: () => { const v = storage.get(SKEY, []); return Array.isArray(v) ? v : []; },
    save(name) {
      const s = store.get(), r = bx.runOnNet();
      const sess = { schema: SCHEMAS.session, name: name || `Session ${new Date().toISOString().slice(0, 16).replace("T", " ")}`, savedAt: new Date().toISOString(), ws: s.ws, grid: s.netId,
        camera: bx.rig ? bx.rig.pose() : null, view: s.camera.view, layers: s.layers, draft: s.draft, scenarioId: r ? r.scenarioId : null, pinnedScenarioId: s.pinned ? s.pinned.scenarioId : null,
        experimentIds: [r && r.recordId].filter(Boolean), playbackIndex: s.playback.i };
      const all = [sess, ...bx.sessions.list()].slice(0, 12); const ok = storage.set(SKEY, all); toast(ok ? `Saved “${sess.name}” in this browser` : "Browser storage unavailable: use Export session instead"); return sess;
    },
    async restore(sess) {
      if (!sess || sess.schema !== SCHEMAS.session) { toast("Not a BLACKSKY session"); return; }
      if (sess.grid) await bx.loadNet(sess.grid); if (sess.layers) { store.set({ layers: { ...store.get().layers, ...sess.layers } }); bx.gs && bx.gs.setLayers(store.get().layers); }
      if (sess.draft) bx.setDraft(sess.draft);
      const p = parseScenarioId(sess.scenarioId || "");
      if (p) await bx.openScenario({ grid: p.grid, set: p.set, engine: sess.draft?.engine && sess.draft.engine.endsWith(p.model) ? sess.draft.engine : p.model === "ac" ? "stored-ac" : "browser-dc", policy: p.policy });
      if (sess.view && sess.view !== store.get().camera.view) bx.setView(sess.view);
      if (sess.camera && bx.rig && sess.view !== "2d") bx.rig.restore(sess.camera);
      if (sess.playbackIndex) bx.goEvent(sess.playbackIndex, { frame: false });
      bx.setWorkspace(sess.ws || "theater"); toast(`Restored “${sess.name}” (scenario re-run with the engine)`);
    },
  };

  // ------------------------------------------------------------------ layers menu (Theater)
  const lb = $("layers-btn"), lm = $("layers-menu");
  const OVER = [["loading", "Loading (engine bands)"], ["surge", "Flow surge since the intact network"], ["faults", "Fault lines (exhaustive table)"]];
  const renderLayers = () => { const l = store.get().layers, ks = store.get().net?.tableKs || [];
    lm.innerHTML = `<span class="micro">Line colour</span>${OVER.map(([k, n]) => `<label class="chk"><input type="radio" name="ov" data-ov="${k}" ${(l.overlay || "loading") === k ? "checked" : ""}>${esc(n)}</label>`).join("")}${
      l.overlay === "faults" && ks.length > 1 ? `<div class="row" style="gap:4px;margin:2px 0 4px 22px">${ks.map((k) => `<button class="btn sm" data-fk="${k}" aria-pressed="${l.faultK === k}">k = ${k}</button>`).join("")}</div>` : ""}<span class="micro" style="margin-top:6px">Layers</span>${LAYERS.map(([k, n]) => `<label class="chk"><input type="checkbox" data-layer="${k}" ${l[k] !== false ? "checked" : ""}>${esc(n)}</label>`).join("")}<p class="note" style="max-width:220px">Layers change only the drawing, never the simulation.</p>`; };
  lb.onclick = () => { const open = lm.hidden; lm.hidden = !open; lb.setAttribute("aria-expanded", String(open)); if (open) renderLayers(); };
  lm.addEventListener("change", (e) => { const k = e.target.dataset.layer; if (k) bx.setLayer(k, e.target.checked); if (e.target.dataset.ov) { bx.setLayer("overlay", e.target.dataset.ov); renderLayers(); } });
  lm.addEventListener("click", (e) => { const b = e.target.closest("[data-fk]"); if (b) { e.stopPropagation(); bx.setLayer("faultK", +b.dataset.fk); renderLayers(); } });
  bx.renderLayersMenu = () => { if (!lm.hidden) renderLayers(); };
  document.addEventListener("click", (e) => { if (!lm.hidden && !e.target.closest("#layers")) { lm.hidden = true; lb.setAttribute("aria-expanded", "false"); } });

  // ------------------------------------------------------------------ commands
  function commands(q) {
    const s = store.get(), out = [], add = (label, hint, run, kw = "") => out.push({ label, hint, run, kw: `${label} ${kw}`.toLowerCase() });
    add("Start the briefing (guided tour of all five workspaces)", "tour", () => bx.briefing && bx.briefing.start(), "briefing tour demo guide present");
    add("Show the headline result", "", () => { bx.setWorkspace("theater"); bx.arrival && bx.arrival.show(); }, "arrival intro");
    bx.WS_NAME && Object.entries(bx.WS_NAME).forEach(([w, n], i) => add(`Open ${n}`, `${i + 1}`, () => bx.setWorkspace(w), "workspace go"));
    ["ieee118", "ieee30", "ieee14"].forEach((g) => add(`Select network: ${GRID_NAME[g]}`, g, () => bx.loadNet(g), "benchmark grid"));
    add("Run the configured scenario", "Theater", () => { bx.setWorkspace("theater"); document.getElementById("sc-run")?.click(); }, "simulate cascade");
    add("Play / pause the cascade", "Space", () => { bx.setWorkspace("theater"); bx.togglePlay(); });
    add("Reset scene (start of the run, overview camera)", "Home", () => { bx.setWorkspace("theater"); bx.reset(); }, "camera");
    add("View: 3-D", "", () => bx.setView("3d")); add("View: schematic (orthographic)", "", () => bx.setView("schematic")); add("View: 2-D drawing", "", () => bx.setView("2d"), "fallback svg");
    add("Camera: top view", "", () => bx.preset("top")); add("Camera: from the east", "", () => bx.preset("east")); add("Full screen", "", () => bx.fullscreen(true));
    OVER.forEach(([k, n]) => add(`Line colour: ${n}`, "layer", () => { bx.setWorkspace("theater"); bx.setLayer("overlay", k); }, "overlay fault lines surge"));
    LAYERS.forEach(([k, n]) => add(`${s.layers[k] === false ? "Show" : "Hide"} layer: ${n}`, "layer", () => bx.setLayer(k, s.layers[k] === false), "toggle"));
    add("Export findings report of the current run", "", () => { bx.setWorkspace("theater"); bx.inspectorTab("findings"); setTimeout(() => document.getElementById("au-export")?.click(), 50); }, "markdown");
    add("Export the experiment registry (JSON)", "", () => bx.exportText({ title: "Experiment registry", text: JSON.stringify({ schema: "bsx.registry/1", exportedAt: new Date().toISOString(), records: bx.registry.list() }, null, 1), filename: "blacksky_registry.json", mime: "application/json" }));
    add("Save investigation session", "", () => bx.sessions.save());
    bx.sessions.list().slice(0, 5).forEach((x) => add(`Restore session: ${x.name}`, x.savedAt.slice(0, 10), () => bx.sessions.restore(x)));
    add("Export current session (JSON)", "", () => { const x = bx.sessions.save(); bx.exportText({ title: "Session", text: JSON.stringify(x, null, 2), filename: "blacksky_session.json", mime: "application/json" }); });
    add("Help and keyboard shortcuts", "?", () => bx.help(true));
    // typed entities, scenario ids and experiment ids
    const t = q.trim();
    if (s.net && t) { const key = bx.parseEntity(t); if (key) out.unshift({ label: `Select and focus ${bx.label(key)}`, hint: "Theater", run: () => { bx.setWorkspace("theater"); bx.select(key, { focus: true }); }, kw: t.toLowerCase(), pin: true }); }
    const sp = parseScenarioId(t); if (sp) out.unshift({ label: `Open scenario ${t}`, hint: "re-run", run: () => bx.openScenario({ grid: sp.grid, set: sp.set, engine: sp.model === "ac" ? "stored-ac" : "browser-dc", policy: sp.policy }), kw: t.toLowerCase(), pin: true });
    if (/^EXP-/i.test(t)) bx.registry.list().filter((r) => r.id.toLowerCase().startsWith(t.toLowerCase())).slice(0, 6).forEach((r) => out.unshift({ label: `Open experiment ${r.id} · ${r.name}`, hint: r.type, run: () => bx.openRecord(r.id), kw: t.toLowerCase(), pin: true }));
    else if (t.length >= 2) bx.registry.list().filter((r) => r.name.toLowerCase().includes(t.toLowerCase())).slice(0, 4).forEach((r) => out.push({ label: `Open experiment: ${r.name}`, hint: r.id.slice(-8), run: () => bx.openRecord(r.id), kw: `${r.name} experiment`.toLowerCase() }));
    const words = t.toLowerCase().split(/\s+/).filter(Boolean);
    return out.filter((c) => c.pin || words.every((w) => c.kw.includes(w))).slice(0, 40);
  }
  function render() { list.innerHTML = items.length ? items.map((c, i) => `<li role="option" id="cmd-${i}" data-i="${i}" aria-selected="${i === sel}">${esc(c.label)}<small>${esc(c.hint || "")}</small></li>`).join("") : `<li aria-disabled="true">No matching command. Try “branch 12”, “bus 69”, “open quantum”, an EXP-… or SCN:… id.</li>`;
    inp.setAttribute("aria-activedescendant", items.length ? `cmd-${sel}` : ""); list.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }
  const refresh = () => { items = commands(inp.value); sel = 0; render(); };
  const exec = (i) => { const c = items[i]; if (!c) return; bx.palette(false); Promise.resolve().then(c.run); };
  bx.palette = (on) => { if (on) { lastFocus = document.activeElement; dlg.hidden = false; inp.value = ""; refresh(); inp.focus(); } else if (!dlg.hidden) { dlg.hidden = true; lastFocus && lastFocus.focus && lastFocus.focus(); } };
  inp.addEventListener("input", refresh);
  inp.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); render(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
    else if (e.key === "Enter") { e.preventDefault(); exec(sel); }
    else if (e.key === "Escape") { e.preventDefault(); bx.palette(false); }
  });
  list.addEventListener("click", (e) => { const li = e.target.closest("[data-i]"); if (li) exec(+li.dataset.i); });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) bx.palette(false); });
  $("cmdk-btn").onclick = () => bx.palette(true);
  bx.openRecord = (id) => { bx.setWorkspace("evidence"); bx.ensureWs("evidence").then(() => bx.evidence && bx.evidence.open(id)); };
}
