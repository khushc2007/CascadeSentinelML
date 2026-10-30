// Cascade Theater · 2-D view: an SVG drawing of the same schematic layout and the same view state as the 3-D scene (shared/core/encoding.js).
// It is the fallback when WebGL is unavailable and an accessible, non-animated alternative everywhere: pan by dragging, zoom with the wheel
// or the dock buttons, click to select, Shift+click a line to add it to the outage set.
import { sceneLayout } from "../../shared/three/layout.js";
import { $, esc } from "../util.js";
import { css } from "../sci/overlays.js";

const COL = { normal: "#6b7580", warning: "#a8742a", overload: "#f2a93b", deenergized: "#252a31", unavailable: "#252a31", initial_outage: "#e0443a", tripped: "#7a2c26" };

export function initView2D(bx) {
  const { store } = bx, svg = $("svg2d"); let L = null, forModel = null, vb = null, drag = null, raf = 0;
  const layout = () => { const m = store.get().net?.model; if (m && m !== forModel) { forModel = m; L = sceneLayout(m, { schematic: true }); vb = null; } return L; };
  // fit the drawing into the part of the canvas no side panel covers (the panels float over the stage on wide screens)
  const insets = () => { const r = svg.getBoundingClientRect(), wide = innerWidth > 900 && !document.body.classList.contains("fs"), lp = $("left"), rp = $("right");
    return { r, l: wide && lp && !lp.hidden ? lp.offsetWidth + 24 : 12, rr: wide && rp && !rp.hidden ? rp.offsetWidth + 24 : 12, t: 70, b: 28 }; };
  function fit() {
    const b = L.bounds, pad = 1.5, { r, l, rr, t, b: bb } = insets(), fw = Math.max(80, r.width - l - rr), fh = Math.max(80, r.height - t - bb);
    const w = b.maxX - b.minX + 2 * pad, h = b.maxZ - b.minZ + 2 * pad, k = Math.max(w / fw, h / fh);   // scene units per pixel
    vb = { x: (b.minX + b.maxX) / 2 - (l + fw / 2) * k, y: (b.minZ + b.maxZ) / 2 - (t + fh / 2) * k, w: r.width * k, h: r.height * k };
  }
  function draw() {
    raf = 0; const s = store.get(); if (svg.hasAttribute("hidden") || !s.net || !layout()) return; if (!vb) fit();
    const m = s.net.model, v = bx.view(); if (!v) return; const arm = new Set(bx.draftArmed()), ov = bx.overlay ? bx.overlay() : null;
    svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    const sw = vb.w / Math.max(1, svg.getBoundingClientRect().width), out = [];   // scene units per screen pixel
    out.push(`<rect x="${vb.x - vb.w}" y="${vb.y - vb.h}" width="${vb.w * 3}" height="${vb.h * 3}" fill="#05070c"/>`);
    m.branches.forEach((br, l) => { const st = v.branches[l], s2 = st.state, pts = L.branch[l].pts.map((p) => `${p[0].toFixed(3)},${p[2].toFixed(3)}`).join(" ");
      const gone = s2 === "initial_outage" || s2 === "tripped", useOv = ov && !gone, w = (useOv ? 1.4 * ov.width[l] : s2 === "overload" ? 3.2 : s2 === "warning" ? 2.2 : gone && s2 === "initial_outage" ? 2.4 : 1.4) * sw;
      const ovTxt = !useOv ? "" : ov.mode === "faults" ? `, in ${ov.counts[l]} of the ${ov.sets} most damaging ${ov.k}-line sets` : ov.surge[l] == null ? "" : `, flow ${ov.surge[l] >= 0 ? "+" : "−"}${Math.abs(Math.round(100 * ov.surge[l]))} % of rating vs intact network`;
      out.push(`<polyline data-key="branch:${l}" points="${pts}" fill="none" stroke="${useOv ? css(ov.color[l]) : COL[s2] || COL.normal}" stroke-width="${w}" ${gone ? `stroke-dasharray="${(s2 === "initial_outage" ? 5 : 2) * sw} ${3 * sw}"` : ""} stroke-linecap="round"><title>${esc(bx.label(`branch:${l}`))}: ${s2.replace("_", " ")}${st.u != null ? `, ${Math.round(100 * st.u)} %` : ""}${ovTxt}</title></polyline>`);
      if (arm.has(l)) out.push(`<polyline points="${pts}" fill="none" stroke="#e0443a" stroke-opacity=".85" stroke-width="${4 * sw}" pointer-events="none"/>`);
      if (s.selection === `branch:${l}` || s.hover === `branch:${l}`) out.push(`<polyline points="${pts}" fill="none" stroke="#7cc4e8" stroke-opacity="${s.selection === `branch:${l}` ? 1 : 0.6}" stroke-width="${3.4 * sw}" pointer-events="none"/>`);
    });
    m.loads.forEach((ld, i) => { const p = L.load[i], f = v.buses[ld.bus].served_fraction, lit = f == null ? (v.buses[ld.bus].energized ? 1 : 0) : f, a = 0.25 + 0.75 * lit;
      out.push(`<rect data-key="${ld.key}" x="${p.x - 0.32}" y="${p.z - 0.32}" width=".64" height=".64" fill="rgba(255,211,154,${(a * lit).toFixed(2)})" stroke="#3a3328" stroke-width="${sw}"><title>Demand at bus ${ld.busId}: ${(ld.demand_mw).toFixed(0)} MW${f != null ? `, ${Math.round(100 * f)} % served` : ""}</title></rect>`); });
    m.gens.forEach((g, i) => { const p = L.gen[i], on = v.gens[i].energized && g.in_service;
      out.push(`<rect data-key="${g.key}" x="${p.x - p.s}" y="${p.z - p.s}" width="${2 * p.s}" height="${2 * p.s}" fill="#141a22" stroke="${on ? "#5fbf86" : "#565e69"}" stroke-width="${1.6 * sw}"><title>Generator ${g.g} at bus ${g.busId}: ${on ? "online" : "isolated"}</title></rect>`); });
    m.buses.forEach((b, i) => { const p = L.bus[i], st = v.buses[i], sel = s.selection === b.key, hov = s.hover === b.key;
      out.push(`<circle data-key="${b.key}" cx="${p.x}" cy="${p.z}" r="${p.r}" fill="${st.energized ? "#c9d1d9" : "#1d2025"}" stroke="${sel ? "#7cc4e8" : hov ? "#9fb3c2" : st.energized ? "#262b31" : "#3a3f46"}" stroke-width="${(sel ? 3 : 1.2) * sw}"><title>Bus ${b.id}${st.energized ? "" : " (de-energised)"}</title></circle>`); });
    if (m.nBus <= 40 || vb.w < (L.bounds.maxX - L.bounds.minX) * 0.5) m.buses.forEach((b, i) => { const p = L.bus[i]; out.push(`<text x="${p.x + p.r + 0.2}" y="${p.z - p.r}" font-size="${11 * sw}" fill="#808a98" font-family="JetBrains Mono, monospace" pointer-events="none">${b.id}</text>`); });
    // outage and trip tags (the 3-D labels are hidden in this view because they follow the 3-D projection)
    const r = bx.runOnNet(), ev = bx.currentEvent(), tags = [];
    if (r) { r.result.outage.forEach((l) => tags.push([l, `T0 · ${l}`, "#e0443a"])); if (ev && ev.type === "trip") ev.entities.slice(0, 14).forEach((k) => { const l = +k.split(":")[1]; tags.push([l, `R${ev.round} · ${l}`, "#f08a80"]); }); }
    arm.forEach((l) => tags.push([l, `× ${l}`, "#e0443a"]));
    const placed = [];
    for (const [l, t, c] of tags) { const m = L.branch[l].mid, fs = 10.5 * sw, w = t.length * fs * 0.62 + 6 * sw, bx0 = m[0] - w / 2, by0 = m[2] - fs * 2.1, bh = fs * 1.5;
      if (placed.some((q) => bx0 < q[2] && bx0 + w > q[0] && by0 < q[3] && by0 + bh > q[1])) continue; placed.push([bx0, by0, bx0 + w, by0 + bh]);
      out.push(`<g pointer-events="none"><rect x="${m[0] - w / 2}" y="${m[2] - fs * 2.1}" width="${w}" height="${fs * 1.5}" rx="${2 * sw}" fill="#0a0d14" stroke="${c}" stroke-width="${sw}"/><text x="${m[0]}" y="${m[2] - fs * 1.0}" text-anchor="middle" font-size="${fs}" fill="${c}" font-family="JetBrains Mono, monospace">${esc(t)}</text></g>`); }
    const ins = insets();
    out.push(`<text x="${vb.x + (ins.l + 4) * (vb.w / Math.max(1, ins.r.width))}" y="${vb.y + vb.h - 10 * sw}" font-size="${11 * sw}" fill="#808a98" font-family="Archivo, sans-serif" pointer-events="none">2-D schematic · non-geographic · drag pans · wheel zooms · click selects</text>`);
    svg.innerHTML = out.join("");
  }
  const render = () => { if (!raf) raf = requestAnimationFrame(draw); };
  const toSvg = (cx, cy) => { const r = svg.getBoundingClientRect(); return [vb.x + ((cx - r.left) / r.width) * vb.w, vb.y + ((cy - r.top) / r.height) * vb.h]; };
  const zoom = (dir, cx, cy) => { if (!vb) return; const r = svg.getBoundingClientRect(), f = dir < 0 ? 0.8 : 1.25, [px, py] = cx == null ? [vb.x + vb.w / 2, vb.y + vb.h / 2] : toSvg(cx, cy);
    vb = { x: px - (px - vb.x) * f, y: py - (py - vb.y) * f, w: vb.w * f, h: vb.h * f }; void r; render(); };
  svg.addEventListener("wheel", (e) => { e.preventDefault(); zoom(e.deltaY < 0 ? -1 : 1, e.clientX, e.clientY); }, { passive: false });
  // the key under the pointer is read at pointerdown: after setPointerCapture every later event targets the svg itself
  svg.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, vb: { ...vb }, moved: 0, key: (e.target.closest && e.target.closest("[data-key]")?.dataset.key) || null }; svg.setPointerCapture(e.pointerId); });
  svg.addEventListener("pointermove", (e) => {
    if (drag) { const r = svg.getBoundingClientRect(), dx = ((e.clientX - drag.x) / r.width) * drag.vb.w, dy = ((e.clientY - drag.y) / r.height) * drag.vb.h; drag.moved = Math.hypot(e.clientX - drag.x, e.clientY - drag.y); if (drag.moved > 3) { vb = { ...drag.vb, x: drag.vb.x - dx, y: drag.vb.y - dy }; render(); } return; }
    const k = e.target.closest && e.target.closest("[data-key]")?.dataset.key || null; if (k !== store.get().hover) store.set({ hover: k });
  });
  svg.addEventListener("pointerup", (e) => { const d = drag; drag = null; if (d && d.moved > 3) return; const k = d ? d.key : null;
    if (k && k.startsWith("branch:") && (e.shiftKey || e.altKey)) { bx.toggleDraft(+k.split(":")[1]); return; } bx.select(k); });
  svg.addEventListener("pointerleave", () => { if (store.get().hover) store.set({ hover: null }); });
  addEventListener("resize", () => { vb = null; render(); });
  bx.view2d = { render, zoom: (d) => zoom(d), reset: () => { vb = null; render(); } };
}
