// Cascade Theater · overview map: the whole network in plan view (same schematic layout), branch states, the camera target and the visible
// ground footprint. Click to centre the 3-D camera there. Drawn only when the scene redraws.
import { $ } from "../util.js";

const COL = { normal: "#4a525c", warning: "#a8742a", overload: "#f2a93b", deenergized: "#1d2128", unavailable: "#1d2128", initial_outage: "#e0443a", tripped: "#7a2c26" };

export function initMinimap(bx) {
  const { store, gs, rig } = bx, box = $("minimap"), cv = $("mm"), g = cv.getContext("2d");
  if (!gs) { box.hidden = true; bx.minimap = { draw() {} }; return; }
  let map = null;
  function draw() {
    const s = store.get(), L = gs.L, v = bx.view(); box.hidden = !s.layers.minimap || s.camera.view !== "3d"; if (box.hidden || !L || !v) return;
    const b = L.bounds, W = cv.width, H = cv.height, pad = 14, sc = Math.min((W - 2 * pad) / (b.maxX - b.minX || 1), (H - 2 * pad - 14) / (b.maxZ - b.minZ || 1));
    const ox = (W - sc * (b.maxX - b.minX)) / 2 - sc * b.minX, oz = 14 + (H - 14 - sc * (b.maxZ - b.minZ)) / 2 - sc * b.minZ; map = { sc, ox, oz };
    g.clearRect(0, 0, W, H); g.lineCap = "round";
    s.net.model.branches.forEach((br, l) => { const st = v.branches[l].state, p = L.branch[l].pts; g.strokeStyle = COL[st] || COL.normal; g.lineWidth = st === "overload" || st === "initial_outage" ? 3 : 1.4;
      g.setLineDash(st === "initial_outage" || st === "tripped" ? [4, 3] : []); g.beginPath(); g.moveTo(ox + sc * p[0][0], oz + sc * p[0][2]); for (const q of p) g.lineTo(ox + sc * q[0], oz + sc * q[2]); g.stroke(); });
    g.setLineDash([]); L.bus.forEach((p, i) => { g.fillStyle = v.buses[i].energized ? "#9aa4ae" : "#2a2f36"; g.fillRect(ox + sc * p.x - 1.5, oz + sc * p.z - 1.5, 3, 3); });
    if (s.selection) { const p = gs.entityPos(s.selection); g.strokeStyle = "#7cc4e8"; g.lineWidth = 2; g.beginPath(); g.arc(ox + sc * p[0], oz + sc * p[2], 6, 0, 2 * Math.PI); g.stroke(); }
    // camera footprint: intersections of the four frustum corner rays with the ground plane
    const T = gs.T, cam = gs.camera, pts = [];
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const o = new T.Vector3(x, y, -1).unproject(cam), e = new T.Vector3(x, y, 1).unproject(cam), d = e.sub(o); if (Math.abs(d.y) < 1e-9) continue; const t = -o.y / d.y; if (t > 0) pts.push([o.x + d.x * t, o.z + d.z * t]); }
    if (pts.length === 4) { g.strokeStyle = "rgba(124,196,232,.75)"; g.lineWidth = 1.2; g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo : g.moveTo).call(g, ox + sc * x, oz + sc * z)); g.closePath(); g.stroke(); }
    if (rig && rig.t) { g.fillStyle = "#7cc4e8"; g.beginPath(); g.arc(ox + sc * rig.t.x, oz + sc * rig.t.z, 2.5, 0, 2 * Math.PI); g.fill(); }
  }
  cv.addEventListener("click", (e) => { if (!map) return; const r = cv.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * cv.width, y = ((e.clientY - r.top) / r.height) * cv.height; bx.centerOn((x - map.ox) / map.sc, (y - map.oz) / map.sc); });
  store.sub((s, ch) => { if (ch.has("layers") || ch.has("camera") || ch.has("ws")) { gs.dirty = true; draw(); } });
  bx.minimap = { draw };
}
