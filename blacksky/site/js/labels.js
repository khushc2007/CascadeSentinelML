// Scene labels: screen-projected HTML tags, greedy de-overlap in priority order. Only what the current event or selection makes relevant is
// labelled: initial outages carry T0 tags, cascade trips R n tags, overloads their loading, island events an island tag at the island centroid.
import { $ } from "./util.js";

export function initLabels(bx) {
  const { store, gs } = bx; if (!gs) return;
  const box = $("labels"), pool = new Map();
  function wanted() {
    const s = store.get(), m = s.net?.model, out = []; if (!m || !gs.L) return out; const seen = new Set();
    const add = (key, text, cls, pos) => { if (seen.has(key) || (!pos && !m.byKey.has(key))) return; seen.add(key); out.push({ key, text, cls, pos: pos || gs.entityPos(key) }); };
    if (s.selection) add(s.selection, bx.label(s.selection), "sel");
    if (s.hover && s.hover !== s.selection) add(s.hover, bx.label(s.hover), "hov");
    const r = bx.runOnNet(), v = bx.view();
    if (r && v) {
      r.result.outage.forEach((l) => add(`branch:${l}`, `T0 · ${l}`, "out"));
      const ev = bx.currentEvent();
      if (ev && ev.type === "trip") ev.entities.slice(0, 14).forEach((k) => add(k, `R${ev.round} · ${k.split(":")[1]}`, "trip"));
      if (ev && ev.type === "overload") ev.entities.slice(0, 14).forEach((k) => { const l = k.split(":")[1]; add(k, `${l} · ${Math.round(100 * (ev.values.loading[l] ?? 0))}%`, "over"); });
      if (ev && (ev.type === "islanding" || ev.type === "termination" || ev.type === "load_shed")) {
        // tag the largest separated islands (by bus count, at most five, two or more buses), named by size order after the main island
        const groups = new Map(); v.buses.forEach((b, i) => { if (b.energized && b.component != null && !b.mainIsland) { if (!groups.has(b.component)) groups.set(b.component, []); groups.get(b.component).push(i); } });
        [...groups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 5).forEach(([c, idx], j) => { if (idx.length < 2) return;
          const p = idx.reduce((a, i) => [a[0] + gs.L.bus[i].x, a[1] + gs.L.bus[i].top, a[2] + gs.L.bus[i].z], [0, 0, 0]).map((x) => x / idx.length);
          add(`isl:${c}`, `Island ${j + 2} · ${idx.length} buses`, "isl", [p[0], p[1] + 0.6, p[2]]); });
        if (ev.type === "islanding") ev.entities.slice(0, 6).forEach((k) => add(k, `dark · ${k.split(":")[1]}`, "dark"));
      }
    }
    bx.draftArmed().forEach((l) => add(`branch:${l}`, `× ${l}`, "out"));
    return out;
  }
  bx.onFrame = () => {
    if (!gs.model) return; const want = store.get().layers.labels ? wanted() : [], keep = new Set(), r = box.getBoundingClientRect(), placed = [];
    for (const { key, text, cls, pos } of want) {
      const p = gs.project(pos); if (p[2] > 1 || p[0] < -40 || p[1] < -20 || p[0] > r.width + 40 || p[1] > r.height + 20) continue;
      const w = text.length * 6.9 + 12, h = 18, x0 = p[0] - w / 2, y0 = p[1] - 10 - h;
      if (cls !== "sel" && cls !== "hov" && placed.some((q) => x0 < q[2] && x0 + w > q[0] && y0 < q[3] && y0 + h > q[1])) continue;
      placed.push([x0, y0, x0 + w, y0 + h]);
      let el = pool.get(key); if (!el) { el = document.createElement("div"); pool.set(key, el); box.appendChild(el); }
      el.className = `lbl ${cls}`; if (el.textContent !== text) el.textContent = text;
      el.style.transform = `translate(${Math.round(p[0])}px, ${Math.round(p[1] - 10)}px) translate(-50%, -100%)`; keep.add(key);
    }
    for (const [k, el] of pool) if (!keep.has(k)) { el.remove(); pool.delete(k); }
  };
  store.sub((s, ch) => { if (["selection", "hover", "run", "playback", "draft", "ws", "net", "layers"].some((k) => ch.has(k))) gs.dirty = true; });
}
