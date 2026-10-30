// Playback dock: transport, scrubber over the recorded events with stage markers and typed ticks, the current event, and camera controls.
import { $, esc } from "./util.js";

const PLAY = `<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9.5-5.5z" fill="currentColor"/></svg>`, PAUSE = `<svg viewBox="0 0 16 16"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z" fill="currentColor"/></svg>`;
const SHORT = { detect: "Detect", trace: "Trace", cascade: "Cascade", island: "Island", assess: "Assess" };

export function initTimeline(bx) {
  const { store } = bx, sc = $("scrub");
  $("tp-play").onclick = () => bx.togglePlay(); $("tp-back").onclick = () => bx.step(-1); $("tp-fwd").onclick = () => bx.step(1);
  $("tp-reset").onclick = () => bx.reset(); $("tp-replay").onclick = () => bx.replay();
  $("tp-speed").onchange = (e) => bx.setSpeed(+e.target.value);
  sc.addEventListener("input", () => { bx.pause(); bx.goEvent(+sc.value, { frame: false }); });
  sc.addEventListener("change", () => bx.goEvent(+sc.value));
  $("cam-follow").onclick = () => store.set({ follow: !store.get().follow });
  $("cam-mode").querySelectorAll("button").forEach((b) => (b.onclick = () => bx.setCameraMode(b.dataset.m)));
  $("cam-view").querySelectorAll("button").forEach((b) => (b.onclick = () => bx.setView(b.dataset.v === "spatial" ? "3d" : b.dataset.v)));
  $("cam-over").onclick = () => bx.overview(); $("cam-top").onclick = () => bx.preset("top"); $("cam-east").onclick = () => bx.preset("east");
  $("cam-fs").onclick = () => bx.fullscreen(!document.body.classList.contains("fs"));
  $("cam-zin").onclick = () => bx.zoom(-1); $("cam-zout").onclick = () => bx.zoom(1);
  if (!bx.gs) document.querySelector(".camctl").querySelectorAll("#cam-mode button, #cam-view button[data-v='spatial'], #cam-view button[data-v='schematic'], #cam-top, #cam-east").forEach((b) => (b.disabled = true));

  let marksFor = null, lastStage = null;
  // stage labels in pixels: full names when they fit, initials when the scrubber is narrow; never overlapping
  function renderMarks(run) {
    const mk = $("marks"); marksFor = run; if (!run) { mk.innerHTML = ""; return; }
    const n = run.events.length, W = mk.getBoundingClientRect().width || 600, x = (i) => (n > 1 ? (W * i) / (n - 1) : 0);
    const occ = run.stages.filter((s) => s.occurred && s.eventIndex >= 0).sort((a, b) => a.eventIndex - b.eventIndex);
    const fits = (txt) => { let last = -1e9; return occ.every((s) => { const w = txt(s).length * 7 + 8, px = Math.max(w / 2, Math.min(W - w / 2, x(s.eventIndex))); const ok = px - w / 2 >= last; last = px + w / 2; return ok; }); };
    const cur = bx.currentStage(), full = (s) => SHORT[s.id], init = (s) => (cur && s.id === cur.id ? SHORT[s.id] : SHORT[s.id][0]), txt = fits(full) ? full : init;
    let last = -1e9; const st = occ.map((s) => { const w = txt(s).length * 7 + 8; let px = Math.max(w / 2, Math.min(W - w / 2, x(s.eventIndex))); if (px - w / 2 < last) px = last + w / 2; last = px + w / 2;
      return `<span class="st" data-st="${s.id}" style="left:${px.toFixed(0)}px" title="${SHORT[s.id]}">${txt(s)}</span>`; });
    mk.innerHTML = st.join("") + run.events.map((e, i) => `<span class="tk ${e.type}" style="left:${(100 * i) / Math.max(n - 1, 1)}%"></span>`).join("");
  }
  addEventListener("resize", () => { const s = store.get(); if (s.run.status === "done") { renderMarks(s.run); render(s, new Set(["playback"])); } });
  function render(s, ch) {
    const r = s.run.status === "done" ? s.run : null, n = r ? r.events.length : 0, i = s.playback.i;
    if (ch.has("run")) { renderMarks(r); sc.max = String(Math.max(n - 1, 0)); sc.disabled = !r; ["tp-play", "tp-back", "tp-fwd", "tp-reset", "tp-replay"].forEach((id) => ($(id).disabled = !r)); }
    if (ch.has("run") || ch.has("playback")) {
      sc.value = String(i); $("fill").style.width = n > 1 ? `calc(${(100 * i) / (n - 1)}% )` : "0";
      const playing = s.playback.playing; $("tp-play").innerHTML = playing ? PAUSE : PLAY; $("tp-play").setAttribute("aria-label", playing ? "Pause (Space)" : "Play (Space)");
      const ev = r && r.events[i], stg = bx.currentStage();
      sc.setAttribute("aria-valuetext", ev ? `Event ${i + 1} of ${n}, round ${ev.round}: ${ev.title}` : "No run");
      $("nowline").innerHTML = ev ? `<span class="r">${String(i + 1).padStart(2, "0")}/${n} · round ${ev.frame + 1}${stg ? ` · ${SHORT[stg.id].toUpperCase()}` : ""}</span><span class="tt">${esc(ev.title)}</span>`
        : `<span class="r">—</span><span class="tt faint">${s.run.status === "running" ? "Running…" : s.run.status === "error" ? "Run failed (see panel)" : "No run loaded"}</span>`;
      if (r && stg && stg.id !== lastStage) { lastStage = stg.id; renderMarks(r); }
      document.querySelectorAll("#marks .st").forEach((el) => el.classList.toggle("cur", stg && el.dataset.st === stg.id));
      $("tp-speed").value = String(s.playback.speed);
    }
    if (ch.has("follow")) { $("cam-follow").setAttribute("aria-pressed", String(s.follow)); }
    if (ch.has("camera")) {
      const v = s.camera.view, two = v === "2d";
      $("cam-mode").querySelectorAll("button").forEach((b) => { b.setAttribute("aria-pressed", String(b.dataset.m === s.camera.mode && !two)); b.disabled = !bx.gs || two || (s.camera.schematic && b.dataset.m === "recon"); });
      $("cam-view").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.v === "spatial" ? "3d" : b.dataset.v) === v)));
      ["cam-top", "cam-east"].forEach((id) => ($(id).disabled = !bx.gs || v !== "3d"));
    }
    void marksFor;
  }
  store.sub(render); render(store.get(), new Set(["run", "playback", "follow", "camera"]));
}
