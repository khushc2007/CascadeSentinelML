// APEX · landscape view: a canvas drawing of a k = 2 search landscape. One pixel-cell per pair of candidate branches (lower triangle),
// coloured by S from the simulator on a single-hue red ramp; optional upper triangle (ML: predicted S, same ramp, so the two halves are
// directly comparable); optional probe dots (Arena: which pairs each method evaluated, in evaluation order, up to a replay cursor).
// Everything drawn is a recorded value; unevaluated pairs are left at the background colour.
import { pairIndex, pairAt } from "../sci/landscape.js";
import { ramp, RAMPS } from "../sci/overlays.js";

const BG = [10, 13, 20], ZERO = [22, 27, 36], GRIDC = "#1b212b";
const rgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

export function createLandscape(host, { size = 520, onPick = null, describe = null } = {}) {
  host.innerHTML = `<div class="ls"><canvas class="ls-c" role="img"></canvas><div class="ls-tip" hidden></div></div>`;
  const cv = host.querySelector("canvas"), tip = host.querySelector(".ls-tip"), base = document.createElement("canvas");
  let D = null, px = 1, side = size, rows = 0, inv = null;

  function setData(d) {                                       // d: { universe, lower, upper?, rank, max?, aria }
    D = { ...d }; const m = d.universe.length; rows = m; inv = new Array(m); d.rank.forEach((r, p) => (inv[r] = p));
    D.max = d.max ?? Math.max(1e-9, ...[d.lower, d.upper].filter(Boolean).map((a) => a.reduce((x, v) => (Number.isFinite(v) && v > x ? v : x), 0)));
    cv.setAttribute("aria-label", d.aria || "search landscape"); D.reveal = null; paintBase(); draw();
  }
  const ERR = [0x7cc4e8, 0x2a313d, 0xa68cf2];                 // diverging: under-prediction (ice) ← 0 (graphite) → over-prediction (violet)
  const colErr = (v) => (!Number.isFinite(v) ? BG : rgb(ramp(ERR, 0.5 + 0.5 * Math.max(-1, Math.min(1, v / (D.errMax || D.max))))));
  const colOf = (v) => (!Number.isFinite(v) ? BG : v <= 0 ? ZERO : rgb(ramp(RAMPS.fault, 0.18 + 0.82 * Math.sqrt(Math.min(1, v / D.max)))));
  // base image: one pixel per pair; reveal (optional) limits the lower triangle to the first n pairs in lexicographic order
  function paintBase() {
    const m = rows; base.width = base.height = m; const g = base.getContext("2d"), im = g.createImageData(m, m), a = im.data;
    for (let r = 0; r < m; r++) for (let c = 0; c < m; c++) { if (r === c) continue; const pr = inv[r], pc = inv[c], idx = pairIndex(pr, pc, m);
      let v; if (r > c) v = D.reveal != null && idx >= D.reveal ? NaN : D.lower[idx]; else v = D.upper ? D.upper[idx] : NaN;
      const col = r < c && D.upperKind === "error" ? colErr(v) : colOf(v), o = 4 * (r * m + c); a[o] = col[0]; a[o + 1] = col[1]; a[o + 2] = col[2]; a[o + 3] = 255; }
    g.putImageData(im, 0, 0);
  }
  function layout() { const w = Math.min(size, host.clientWidth || size); side = Math.max(160, Math.floor(w)); const dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = Math.round(side * dpr); cv.height = Math.round(side * dpr); cv.style.width = cv.style.height = `${side}px`; px = (side / Math.max(1, rows)) * dpr; return dpr; }
  function draw() {
    if (!D) return; const dpr = layout(), g = cv.getContext("2d"); g.imageSmoothingEnabled = false; g.fillStyle = "#0a0d14"; g.fillRect(0, 0, cv.width, cv.height);
    g.drawImage(base, 0, 0, cv.width, cv.height);
    g.strokeStyle = GRIDC; g.lineWidth = dpr; g.beginPath(); g.moveTo(0, 0); g.lineTo(cv.width, cv.height); g.stroke();
    // probes: one dot per evaluated pair, per visible method, up to its cursor
    for (const P of D.probes || []) { if (P.hidden) continue; g.fillStyle = P.color; const n = Math.min(P.cursor ?? P.pairs.length, P.pairs.length), rad = Math.max(1.1 * dpr, px * 0.42);
      for (let i = 0; i < n; i++) { const [a, b] = P.pairs[i], ra = D.rank[a], rb = D.rank[b], r = Math.max(ra, rb), c = Math.min(ra, rb);
        g.globalAlpha = i >= n - 6 ? 1 : 0.8; g.beginPath(); g.arc((c + 0.5) * px, (r + 0.5) * px, i >= n - 6 ? rad * 1.9 : rad, 0, 6.283); g.fill(); } }
    g.globalAlpha = 1;
    if (D.mark) { const [a, b] = D.mark, ra = D.rank[a], rb = D.rank[b], r = Math.max(ra, rb), c = Math.min(ra, rb); g.strokeStyle = "#e8ecf1"; g.lineWidth = 1.5 * dpr;
      g.beginPath(); g.arc((c + 0.5) * px, (r + 0.5) * px, Math.max(5 * dpr, px * 1.8), 0, 6.283); g.stroke(); }
  }
  function cellAt(e) { if (!D) return null; const rc = cv.getBoundingClientRect(), x = e.clientX - rc.left, y = e.clientY - rc.top, s = rc.width / rows, c = Math.floor(x / s), r = Math.floor(y / s);
    if (r < 0 || c < 0 || r >= rows || c >= rows || r === c) return null; const a = inv[r], b = inv[c], upper = c > r; return { a: Math.min(a, b), b: Math.max(a, b), upper, x, y, idx: pairIndex(a, b, rows) }; }
  cv.addEventListener("pointermove", (e) => { const h = cellAt(e); if (!h) { tip.hidden = true; return; }
    tip.hidden = false; tip.innerHTML = describe ? describe(h) : `${h.a}, ${h.b}`; const w = tip.offsetWidth, rc = cv.getBoundingClientRect();
    tip.style.left = `${Math.min(rc.width - w - 4, h.x + 12)}px`; tip.style.top = `${Math.max(0, h.y - 34)}px`; });
  cv.addEventListener("pointerleave", () => (tip.hidden = true));
  cv.addEventListener("click", (e) => { const h = cellAt(e); if (h && onPick) onPick(h); });
  const ro = new ResizeObserver(() => draw()); ro.observe(host);
  return {
    setData, draw,
    setProbes(p) { if (D) { D.probes = p; draw(); } },
    setMark(pair) { if (D) { D.mark = pair; draw(); } },
    setReveal(n) { if (D) { D.reveal = n; paintBase(); draw(); } },
    pairAt: (i) => pairAt(i, rows),
  };
}
