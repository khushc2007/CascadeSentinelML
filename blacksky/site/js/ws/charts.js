// Small SVG chart kit shared by the Quantum Lab, Algorithm Arena, ML Observatory and Evidence Lab. Charts are built from the data they are
// given (nothing is drawn that was not computed), with hairline grids, one y axis, direct labels at line ends, a legend for two or more
// series, and hover tooltips through data-tip attributes (one delegated handler on the page).
import { esc } from "../util.js";

export const SERIES = { exhaustive: "#e8ecf1", random: "#3987e5", ga: "#d95926", sa: "#199e70", loading: "#c98500", surrogate: "#d55181", grover: "#9085e9", quantum: "#a68cf2" };
const fmtTick = (v) => { const a = Math.abs(v); if (a === 0) return "0"; if (a >= 1e5 || a < 1e-3) return v.toExponential(0); if (a >= 100) return v.toFixed(0); if (a >= 10) return v.toFixed(0); if (a >= 1) return +v.toFixed(2) + ""; return +v.toPrecision(2) + ""; };
export function niceTicks(lo, hi, n = 5) {
  if (!(hi > lo)) return [lo]; const span = hi - lo, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0)), r = step0 / mag, step = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(12)); return out;
}
const logTicks = (lo, hi) => { const out = []; for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) { const v = 10 ** e; if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v); } return out; };

/**
 * Line / step chart. series: [{ name, color, pts: [[x, y], ...], step?, dash?, band?: [[x, lo, hi], ...], marker?: "circle"|"square"|"diamond"|"none", label? }]
 * opts: { w, h, x: { min, max, label, log, fmt }, y: { min, max, label, fmt, pct }, vlines: [{ x, label, color, dash }], hlines: [...], points?: true }
 */
export function lineChart(series, o) {
  const W = o.w || 640, H = o.h || 260, M = { l: 52, r: o.rightPad ?? 96, t: 12, b: 38 }, X = o.x || {}, Y = o.y || {};
  const allX = series.flatMap((s) => s.pts.map((p) => p[0]).concat((s.band || []).map((b) => b[0]))), allY = series.flatMap((s) => s.pts.map((p) => p[1]).concat((s.band || []).flatMap((b) => [b[1], b[2]])));
  let x0 = X.min ?? Math.min(...allX), x1 = X.max ?? Math.max(...allX), y0 = Y.min ?? Math.min(0, ...allY), y1 = Y.max ?? Math.max(...allY);
  if (!(x1 > x0)) x1 = x0 + 1; if (!(y1 > y0)) y1 = y0 + 1; if (X.log) { x0 = Math.max(x0, 1e-12); }
  const sx = (v) => M.l + (X.log ? (Math.log10(Math.max(v, x0)) - Math.log10(x0)) / (Math.log10(x1) - Math.log10(x0)) : (v - x0) / (x1 - x0)) * (W - M.l - M.r);
  const sy = (v) => H - M.b - ((v - y0) / (y1 - y0)) * (H - M.t - M.b);
  const fx = X.fmt || fmtTick, fy = Y.fmt || (Y.pct ? (v) => `${+(100 * v).toFixed(1)}%` : fmtTick);
  const out = [`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || "chart")}">`];
  const yt = niceTicks(y0, y1, 4), xt = X.log ? logTicks(x0, x1) : niceTicks(x0, x1, 6);
  out.push(`<g class="gridl">${yt.map((v) => `<line x1="${M.l}" x2="${W - M.r}" y1="${sy(v)}" y2="${sy(v)}"/>`).join("")}</g>`);
  out.push(`<g class="ax"><line x1="${M.l}" x2="${W - M.r}" y1="${H - M.b}" y2="${H - M.b}"/>${yt.map((v) => `<text x="${M.l - 6}" y="${sy(v) + 3.5}" text-anchor="end">${esc(fy(v))}</text>`).join("")}
    ${xt.map((v) => `<line x1="${sx(v)}" x2="${sx(v)}" y1="${H - M.b}" y2="${H - M.b + 4}"/><text x="${sx(v)}" y="${H - M.b + 16}" text-anchor="middle">${esc(fx(v))}</text>`).join("")}
    ${X.label ? `<text x="${(M.l + W - M.r) / 2}" y="${H - 4}" text-anchor="middle">${esc(X.label)}</text>` : ""}${Y.label ? `<text x="${M.l}" y="${M.t - 2}" text-anchor="start" transform="translate(0,0)">${esc(Y.label)}</text>` : ""}</g>`);
  // reference lines are labelled inside the plot, at the left, so the right gutter stays free for the series' direct labels
  for (const h of o.hlines || []) out.push(`<line x1="${M.l}" x2="${W - M.r}" y1="${sy(h.y)}" y2="${sy(h.y)}" stroke="${h.color || "#808a98"}" stroke-dasharray="${h.dash || "4 4"}" stroke-width="1"/><text x="${M.l + 4}" y="${sy(h.y) - 4}" fill="${h.color || "#808a98"}" font-size="10.5" font-family="JetBrains Mono, monospace">${esc(h.label || "")}</text>`);
  for (const v of o.vlines || []) out.push(`<line x1="${sx(v.x)}" x2="${sx(v.x)}" y1="${M.t}" y2="${H - M.b}" stroke="${v.color || "#808a98"}" stroke-dasharray="${v.dash || "3 4"}" stroke-width="1"/>${v.label ? `<text x="${sx(v.x) + 4}" y="${M.t + 10}" fill="${v.color || "#808a98"}" font-size="10.5" font-family="JetBrains Mono, monospace">${esc(v.label)}</text>` : ""}`);
  const ends = [];
  for (const s of series) {
    if (s.band && s.band.length) out.push(`<path d="${s.band.map((b, i) => `${i ? "L" : "M"}${sx(b[0])},${sy(b[2])}`).join("")}${[...s.band].reverse().map((b) => `L${sx(b[0])},${sy(b[1])}`).join("")}Z" fill="${s.color}" fill-opacity=".14" stroke="none"/>`);
    if (!s.pts.length) continue;
    const d = s.step ? s.pts.map((p, i) => (i ? `H${sx(p[0])}V${sy(p[1])}` : `M${sx(p[0])},${sy(p[1])}`)).join("") : s.pts.map((p, i) => `${i ? "L" : "M"}${sx(p[0])},${sy(p[1])}`).join("");
    if (s.marker !== "only") out.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""} stroke-linejoin="round"/>`);
    if (s.marker && s.marker !== "none") for (const p of s.pts) { const cx = sx(p[0]), cy = sy(p[1]), tip = `${s.name}: ${fx(p[0])}, ${fy(p[1])}${p[2] ? ` · ${p[2]}` : ""}`;
      out.push(s.marker === "square" ? `<rect x="${cx - 3.5}" y="${cy - 3.5}" width="7" height="7" fill="${s.color}" data-tip="${esc(tip)}"/>` : s.marker === "diamond" ? `<path d="M${cx},${cy - 4.5}L${cx + 4.5},${cy}L${cx},${cy + 4.5}L${cx - 4.5},${cy}Z" fill="${s.color}" data-tip="${esc(tip)}"/>` : `<circle cx="${cx}" cy="${cy}" r="${s.r || 3.5}" fill="${s.color}" stroke="#0a0d14" stroke-width="1.5" data-tip="${esc(tip)}"/>`); }
    if (s.label !== false) { const p = s.pts[s.pts.length - 1]; ends.push({ y: sy(p[1]), x: sx(p[0]), text: s.label || s.name, color: s.color }); }
  }
  // direct labels in the right gutter, de-overlapped vertically (12 px apart), each with a short leader to its line end
  ends.sort((a, b) => a.y - b.y); let last = -1e9; for (const e of ends) { const y0 = e.y; e.y = Math.max(e.y, last + 12); last = e.y; const gx = W - M.r + 8;
    out.push(`<line x1="${e.x}" y1="${y0}" x2="${gx - 2}" y2="${e.y}" stroke="${e.color}" stroke-opacity=".35"/><text x="${gx}" y="${e.y + 3.5}" fill="${e.color}" font-size="11" font-family="Archivo, sans-serif">${esc(e.text)}</text>`); }
  // invisible hover column for x-crosshair tooltips (when the caller supplies o.crosshair)
  if (o.crosshair) out.push(`<rect x="${M.l}" y="${M.t}" width="${W - M.l - M.r}" height="${H - M.t - M.b}" fill="transparent" data-cross="1"/>`);
  out.push("</svg>"); return out.join("");
}

/** Vertical bars. bars: [{ label, v, color?, tip?, key? }], opts: { w, h, y: { max, pct, label }, overlay?: [{ v, color }] per bar (second series drawn as a tick) } */
export function barChart(bars, o = {}) {
  const W = o.w || 640, H = o.h || 220, M = { l: 46, r: 10, t: 12, b: o.rotate ? 52 : 30 }, n = Math.max(bars.length, 1), y1 = o.y?.max ?? Math.max(1e-12, ...bars.map((b) => Math.max(b.v, b.v2 ?? 0)));
  const bw = (W - M.l - M.r) / n, sy = (v) => H - M.b - (v / y1) * (H - M.t - M.b), fy = o.y?.pct ? (v) => `${+(100 * v).toFixed(1)}%` : fmtTick, yt = niceTicks(0, y1, 4);
  const out = [`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || "bar chart")}">`, `<g class="gridl">${yt.map((v) => `<line x1="${M.l}" x2="${W - M.r}" y1="${sy(v)}" y2="${sy(v)}"/>`).join("")}</g>`,
    `<g class="ax"><line x1="${M.l}" x2="${W - M.r}" y1="${H - M.b}" y2="${H - M.b}"/>${yt.map((v) => `<text x="${M.l - 6}" y="${sy(v) + 3.5}" text-anchor="end">${esc(fy(v))}</text>`).join("")}${o.y?.label ? `<text x="${M.l}" y="${M.t - 2}">${esc(o.y.label)}</text>` : ""}</g>`];
  const every = Math.ceil(n / Math.max(1, Math.floor((W - M.l - M.r) / (o.rotate ? 14 : 34))));
  bars.forEach((b, i) => {
    const x = M.l + i * bw, gap = bw > 6 ? Math.min(2, bw * 0.15) : 0, w = Math.max(0.6, bw - gap), h2 = o.pair ? w / 2 : w;
    out.push(`<rect x="${x + gap / 2}" y="${sy(Math.max(0, b.v))}" width="${h2}" height="${Math.max(0, H - M.b - sy(Math.max(0, b.v)))}" fill="${b.color || "#7cc4e8"}" ${b.key != null ? `data-key="${esc(String(b.key))}"` : ""} data-tip="${esc(b.tip || `${b.label}: ${fy(b.v)}`)}" rx="${Math.min(2, h2 / 3)}"/>`);
    if (o.pair && b.v2 != null) out.push(`<rect x="${x + gap / 2 + h2}" y="${sy(b.v2)}" width="${h2}" height="${Math.max(0, H - M.b - sy(b.v2))}" fill="${b.color2 || "#808a98"}" ${b.key != null ? `data-key="${esc(String(b.key))}"` : ""} data-tip="${esc(b.tip2 || `${b.label}: ${fy(b.v2)}`)}" rx="${Math.min(2, h2 / 3)}"/>`);
    if (b.mark) out.push(`<line x1="${x + gap / 2}" x2="${x + gap / 2 + w}" y1="${sy(b.mark)}" y2="${sy(b.mark)}" stroke="${b.markColor || "#e8ecf1"}" stroke-width="2"/>`);
    if (i % every === 0) out.push(o.rotate ? `<text x="${x + bw / 2}" y="${H - M.b + 8}" transform="rotate(60 ${x + bw / 2} ${H - M.b + 8})" fill="#808a98" font-size="10" font-family="JetBrains Mono, monospace">${esc(b.label)}</text>` : `<text x="${x + bw / 2}" y="${H - M.b + 14}" text-anchor="middle" fill="#808a98" font-size="10" font-family="JetBrains Mono, monospace">${esc(b.label)}</text>`);
  });
  out.push("</svg>"); return out.join("");
}

/** Scatter. pts: [{ x, y, color?, r?, tip?, key? }], opts as lineChart (+ diag: true draws y = x). */
export function scatter(pts, o = {}) {
  const W = o.w || 520, H = o.h || 320, M = { l: 52, r: 16, t: 12, b: 38 }, X = o.x || {}, Y = o.y || {};
  const x0 = X.min ?? Math.min(...pts.map((p) => p.x)), x1 = X.max ?? Math.max(...pts.map((p) => p.x)), y0 = Y.min ?? Math.min(...pts.map((p) => p.y)), y1 = Y.max ?? Math.max(...pts.map((p) => p.y));
  const sx = (v) => M.l + ((v - x0) / ((x1 - x0) || 1)) * (W - M.l - M.r), sy = (v) => H - M.b - ((v - y0) / ((y1 - y0) || 1)) * (H - M.t - M.b);
  const fx = X.fmt || (X.pct ? (v) => `${+(100 * v).toFixed(0)}%` : fmtTick), fy = Y.fmt || (Y.pct ? (v) => `${+(100 * v).toFixed(0)}%` : fmtTick), xt = niceTicks(x0, x1, 5), yt = niceTicks(y0, y1, 5);
  const out = [`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || "scatter plot")}">`, `<g class="gridl">${yt.map((v) => `<line x1="${M.l}" x2="${W - M.r}" y1="${sy(v)}" y2="${sy(v)}"/>`).join("")}${xt.map((v) => `<line x1="${sx(v)}" x2="${sx(v)}" y1="${M.t}" y2="${H - M.b}"/>`).join("")}</g>`,
    `<g class="ax"><line x1="${M.l}" x2="${W - M.r}" y1="${H - M.b}" y2="${H - M.b}"/><line x1="${M.l}" x2="${M.l}" y1="${M.t}" y2="${H - M.b}"/>${yt.map((v) => `<text x="${M.l - 6}" y="${sy(v) + 3.5}" text-anchor="end">${esc(fy(v))}</text>`).join("")}${xt.map((v) => `<text x="${sx(v)}" y="${H - M.b + 16}" text-anchor="middle">${esc(fx(v))}</text>`).join("")}
    ${X.label ? `<text x="${(M.l + W - M.r) / 2}" y="${H - 4}" text-anchor="middle">${esc(X.label)}</text>` : ""}${Y.label ? `<text x="${M.l + 4}" y="${M.t + 10}">${esc(Y.label)}</text>` : ""}</g>`];
  if (o.diag) out.push(`<line x1="${sx(Math.max(x0, y0))}" y1="${sy(Math.max(x0, y0))}" x2="${sx(Math.min(x1, y1))}" y2="${sy(Math.min(x1, y1))}" stroke="#808a98" stroke-dasharray="4 4"/>`);
  for (const p of pts) out.push(`<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="${p.r || 3}" fill="${p.color || "#7cc4e8"}" fill-opacity="${p.op ?? 0.75}" stroke="${p.stroke || "none"}" ${p.key != null ? `data-key="${esc(String(p.key))}"` : ""} ${p.tip ? `data-tip="${esc(p.tip)}"` : ""}/>`);
  out.push("</svg>"); return out.join("");
}

/** Delegated tooltip for [data-tip] (pointer and keyboard focus). */
export function bindTips(root) {
  const tip = document.getElementById("tip"); if (!tip || root.__tips) return; root.__tips = true;
  root.addEventListener("pointermove", (e) => { const t = e.target.closest && e.target.closest("[data-tip]"); if (!t) { tip.hidden = true; return; } tip.textContent = t.getAttribute("data-tip"); tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight; tip.style.left = `${Math.min(innerWidth - w - 8, e.clientX + 12)}px`; tip.style.top = `${Math.max(8, e.clientY - h - 10)}px`; });
  root.addEventListener("pointerleave", () => (tip.hidden = true));
}
