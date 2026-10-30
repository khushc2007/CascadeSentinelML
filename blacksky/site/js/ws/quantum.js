// Workspace 2 · Quantum Lab. A circuit composer and a Grover search laboratory on an exact classical simulator (js/q/*, checked against
// Qiskit and Aer). Every view — circuit, probability field, amplitudes and phases, Bloch spheres of reduced single-qubit states, measurement
// laboratory, state inspector, Grover iterations and geometry — is drawn from the same simulation result. No quantum hardware is involved.
import { $, esc, int, toast, GRID_NAME } from "../util.js";
import { GATES, PALETTE } from "../q/gates.js";
import { simulate, simulateNoisy, validateCircuit, circuitStats, layoutColumns, opQubits, opSpan, toQasm2, toJSON, basisLabel, orderedOps } from "../q/circuit.js";
import { LIMITS, sample, tvDistance, marginal, applyReadout, bloch } from "../q/sim.js";
import { groverTheory, validateGrover, GROVER_LIMITS, groverCircuit, planeProjection, stageAngle } from "../q/grover.js";
import { makeRng } from "../sci/rng.js";
import { binom, nextCombination, canon, candidateId } from "../sci/combin.js";
import { limitationsFor } from "../sci/limitations.js";
import { lineChart, barChart, bindTips } from "./charts.js";
import { bsapiPost } from "../engine.js";

const CW = 46, RH = 44, LM = 54;                                     // circuit cell width, row height, label margin
const VIOLET = "#a68cf2", ICE = "#7cc4e8", AMBER = "#f2a93b";
const TEMPLATES = {
  bell: { name: "Bell state", n: 2, ops: [{ g: "h", q: [0] }, { g: "cx", c: [0], q: [1] }, { g: "measure", q: [0] }, { g: "measure", q: [1] }] },
  ghz: { name: "GHZ (3 qubits)", n: 3, ops: [{ g: "h", q: [0] }, { g: "cx", c: [0], q: [1] }, { g: "cx", c: [1], q: [2] }, { g: "measure", q: [0] }, { g: "measure", q: [1] }, { g: "measure", q: [2] }] },
  interf: { name: "Interference H·Z·H", n: 1, ops: [{ g: "h", q: [0] }, { g: "z", q: [0] }, { g: "h", q: [0] }, { g: "measure", q: [0] }] },
  kick: { name: "Phase kickback", n: 2, ops: [{ g: "x", q: [1] }, { g: "h", q: [0] }, { g: "h", q: [1] }, { g: "cx", c: [0], q: [1] }, { g: "h", q: [0] }, { g: "measure", q: [0] }] },
  rot: { name: "Rotation Ry(π/3)·Rz(π/4)", n: 1, ops: [{ g: "ry", q: [0], p: [Math.PI / 3] }, { g: "rz", q: [0], p: [Math.PI / 4] }, { g: "measure", q: [0] }] },
  qft3: { name: "QFT on |101⟩ (3 qubits)", n: 3, ops: [{ g: "x", q: [0] }, { g: "x", q: [2] }, { g: "h", q: [2] }, { g: "cp", c: [1], q: [2], p: [Math.PI / 2] }, { g: "cp", c: [0], q: [2], p: [Math.PI / 4] }, { g: "h", q: [1] }, { g: "cp", c: [0], q: [1], p: [Math.PI / 2] }, { g: "h", q: [0] }, { g: "swap", q: [0, 2] }] },
};

/** Safe angle parser: numbers, pi / π, + − * / and parentheses (no eval). @param {string} s */
export function parseAngle(s) {
  const t = String(s).replace(/π/g, "pi").replace(/\s+/g, "").toLowerCase(); let i = 0;
  const num = () => { if (t.startsWith("pi", i)) { i += 2; return Math.PI; } if (t[i] === "(") { i++; const v = expr(); if (t[i] !== ")") throw new Error("missing )"); i++; return v; }
    if (t[i] === "-") { i++; return -num(); } const m = /^[0-9]*\.?[0-9]+(e[-+]?[0-9]+)?/.exec(t.slice(i)); if (!m) throw new Error(`cannot read "${s}"`); i += m[0].length; return +m[0]; };
  const term = () => { let v = num(); for (;;) { if (t[i] === "*") { i++; v *= num(); } else if (t[i] === "/") { i++; const d = num(); if (!d) throw new Error("division by zero"); v /= d; } else if (t.startsWith("pi", i)) { v *= num(); } else return v; } };
  const expr = () => { let v = term(); for (;;) { if (t[i] === "+") { i++; v += term(); } else if (t[i] === "-") { i++; v -= term(); } else return v; } };
  const v = expr(); if (i !== t.length) throw new Error(`cannot read "${s}"`); if (!Number.isFinite(v)) throw new Error("angle must be finite"); return v;
}
const fmtAng = (v) => { const r = v / Math.PI; for (const d of [1, 2, 3, 4, 6, 8, 12, 16]) { const nn = r * d; if (Math.abs(nn - Math.round(nn)) < 1e-9) { const k = Math.round(nn); if (k === 0) return "0"; return `${k === 1 ? "" : k === -1 ? "−" : k}π${d === 1 ? "" : `/${d}`}`; } } return v.toFixed(4); };
const pct = (x, d = 1) => (x == null ? "–" : `${(100 * x).toFixed(d)}%`);
const parseMarked = (txt, n) => txt.split(/[\s,;]+/).filter(Boolean).map((t) => (/^[01]+$/.test(t) && t.length === n ? parseInt(t, 2) : /^\d+$/.test(t) ? +t : NaN));

export function init(bx, root) {
  const { store } = bx;
  const st = { mode: "composer", n: 2, ops: layoutColumns(TEMPLATES.bell.ops, 2), undo: [], redo: [], brush: "h", pending: null, sel: null, cursor: { col: 0, q: 0 }, shots: 1024, seed: 7, step: null, viz: "probs", basis: 3,
    noisy: false, noise: { p1: 0.001, p2: 0.01, readout: 0.02 }, sim: null, noisySim: null, counts: null, record: null, err: null, transp: null,
    g: { n: 4, markedTxt: "1011", r: null, shots: 1024, seed: 11, view: "circuit", stage: null, res: null, job: null, prog: null, counts: null, record: null, err: null, toy: null } };
  root.innerHTML = `<div class="ws-head"><h1>Quantum <em>Lab</em></h1><span class="q">Exact classical simulation of small quantum circuits — amplitudes, phases, reduced Bloch vectors and sampled measurements — and Grover search on a fully specified toy problem. ${bx.prov("emulated", "classical statevector / density-matrix simulation")} <span class="prov" data-p="unavailable" data-explain="prov:unavailable" title="No quantum hardware is connected">HW N/A</span></span>
      <div class="acts"><div class="seg q" role="group" aria-label="Laboratory"><button data-mode="composer" aria-pressed="true">Circuit composer</button><button data-mode="grover">Grover search</button></div><button class="btn sm drawer-btn" id="q-insp-btn">Inspector</button></div></div>
    <section class="pane left" aria-label="Configuration"><div class="pane-h"><h2 id="q-left-h">Circuit</h2></div><div class="pane-b" id="q-left"></div></section>
    <section class="pane center" aria-label="Circuit and state"><div class="pane-b" id="q-center"></div></section>
    <section class="pane right" aria-label="Resources and exports"><div class="pane-h"><h2>Resources · exports</h2><button class="btn sm ghost drawer-btn" id="q-insp-x">Close</button></div><div class="pane-b" id="q-right"></div></section>`;
  const L = $("q-left"), Cn = $("q-center"), R = $("q-right"); bindTips(root);
  root.querySelector(".acts .seg").addEventListener("click", (e) => { const b = e.target.closest("[data-mode]"); if (!b) return; st.mode = b.dataset.mode; root.querySelectorAll("[data-mode]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); renderAll(); });
  $("q-insp-btn").onclick = () => root.classList.toggle("insp-open"); $("q-insp-x").onclick = () => root.classList.remove("insp-open");

  // ================================================================== composer: model operations with undo/redo
  const C = () => ({ n: st.n, ops: st.ops });
  const commit = (ops, n = st.n) => { st.undo.push({ n: st.n, ops: st.ops }); if (st.undo.length > 200) st.undo.shift(); st.redo = []; st.n = n; st.ops = ops; st.sel = null; st.pending = null; st.counts = null; st.record = null; st.step = null; recompute(); };
  const undo = () => { const u = st.undo.pop(); if (!u) return; st.redo.push({ n: st.n, ops: st.ops }); st.n = u.n; st.ops = u.ops; st.sel = null; st.counts = null; recompute(); };
  const redo = () => { const r = st.redo.pop(); if (!r) return; st.undo.push({ n: st.n, ops: st.ops }); st.n = r.n; st.ops = r.ops; st.sel = null; st.counts = null; recompute(); };
  const occupied = (col, q, except = -1) => st.ops.some((o, i) => i !== except && (o.col ?? 0) === col && (() => { const [a, b] = opSpan(o, st.n); return q >= a && q <= b; })());
  const colFree = (col) => !st.ops.some((o) => (o.col ?? 0) === col);
  function place(col, q) {
    const g = st.brush, def = GATES[g]; if (!def) return;
    if (def.kind === "c1q") {
      if (!st.pending) { if (occupied(col, q)) { toast("That cell is occupied"); return; } st.pending = { col, q }; renderLeftAndCenter(); return; }
      const c = st.pending.q, cc = st.pending.col; if (q === c) { st.pending = null; renderLeftAndCenter(); return; }
      const [a, b] = [Math.min(c, q), Math.max(c, q)]; for (let w = a; w <= b; w++) if (occupied(cc, w)) { toast("The vertical span of that gate is occupied in this column"); st.pending = null; renderLeftAndCenter(); return; }
      commit([...st.ops, { g, c: [c], q: [q], p: def.params.map(() => Math.PI / 2), col: cc }]); st.sel = st.ops.length - 1; renderAll(); return;
    }
    if (g === "barrier") { if (!colFree(col)) { toast("A barrier needs an empty column"); return; } commit([...st.ops, { g, q: [], col }]); renderAll(); return; }
    if (occupied(col, q)) { const i = st.ops.findIndex((o) => (o.col ?? 0) === col && (() => { const [a, b] = opSpan(o, st.n); return q >= a && q <= b; })()); st.sel = i; renderAll(); return; }
    commit([...st.ops, { g, q: [q], p: def.params.map(() => Math.PI / 2), col }]); st.sel = st.ops.length - 1; renderAll();
  }
  const remove = (i) => { if (i == null || !st.ops[i]) return; commit(st.ops.filter((_, j) => j !== i)); renderAll(); };
  function setQubits(n) {
    n = Math.max(1, Math.min(LIMITS.composerQubits, n | 0)); if (n === st.n) return;
    const kept = st.ops.filter((o) => opQubits(o, n).every((q) => q < n) && !(o.g === "barrier" && false)); if (kept.length < st.ops.length) toast(`${st.ops.length - kept.length} gate(s) on removed qubits were deleted (undo restores them)`);
    commit(kept.map((o) => ({ ...o })), n); renderAll();
  }
  function recompute() {
    st.err = null; st.sim = null; st.noisySim = null; const v = validateCircuit(C(), { maxQubits: LIMITS.composerQubits });
    if (!v.ok) { st.err = v.errors; return; }
    try { st.sim = simulate(C()); if (st.noisy) { if (st.n > LIMITS.dmQubits) st.err = [`Noisy simulation is limited to ${LIMITS.dmQubits} qubits.`]; else st.noisySim = simulateNoisy(C(), { ...st.noise, source: "synthetic (user-set)" }); } }
    catch (e) { st.err = [String(e.message || e)]; }
    st.warn = v.warnings;
  }
  function runAndRecord() {
    if (!st.sim) { toast(st.err ? st.err[0] : "Nothing to run"); return; }
    const dist = st.noisySim ? st.noisySim.dist : st.sim.dist, t0 = performance.now(); if (!st.ops.some((o) => o.g === "measure")) { toast("Add a measurement to sample shots"); return; }
    if (!Number.isInteger(st.shots) || st.shots < 1 || st.shots > LIMITS.maxShots) { toast(`Shots must be 1–${LIMITS.maxShots}`); return; }
    st.counts = sample(dist, st.shots, makeRng(st.seed).next); const ms = performance.now() - t0 + (st.noisySim ? st.noisySim.ms : st.sim.ms);
    const top = [...dist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16);
    st.record = bx.registry.add({ parent: st.parent || null, type: "quantum.circuit", name: `Circuit ${st.n}q · ${circuitStats(C()).gates} gates${st.noisy ? " · noisy" : ""}`, config: { circuit: toJSON(C()), shots: st.shots, seed: st.seed, noise: st.noisy ? { ...st.noise, source: "synthetic (user-set)" } : null, method: st.noisy ? "density matrix" : "statevector" },
      seed: st.seed, provenance: "emulated", results: { exact: Object.fromEntries(top), counts: Object.fromEntries([...st.counts.entries()].sort()), tvDistance: tvDistance(dist, st.counts, st.shots), stats: circuitStats(C()), simulatorMs: ms, purity: st.noisySim ? st.noisySim.purity : 1 },
      durationMs: ms, limitations: limitationsFor("quantum.circuit"), log: [{ t: 0, msg: `${st.noisy ? "density-matrix" : "statevector"} simulation of ${st.n} qubits` }, { t: ms, msg: `${st.shots} shots sampled with seed ${st.seed}` }] });
    st.viz = "meas"; renderAll(); toast(`Recorded ${st.record.id}`);
  }

  // ================================================================== circuit drawing (shared by composer and Grover)
  function circuitSVG(circ, { interactive = false, highlightCol = null, maxCols = null } = {}) {
    const n = circ.n, cols = Math.max(interactive ? 10 : 1, ...circ.ops.map((o) => (o.col ?? 0) + 1)) + (interactive ? 2 : 0), nc = maxCols ? Math.min(cols, maxCols) : cols;
    const W = LM + nc * CW + 16, H = n * RH + 26, y = (q) => 20 + q * RH + RH / 2, x = (c) => LM + c * CW + CW / 2, out = [`<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${interactive ? 'tabindex="0" aria-label="Circuit grid: arrow keys move, Enter places the selected gate or selects a gate, Delete removes" role="application"' : `role="img" aria-label="Circuit diagram"`} id="${interactive ? "qc-svg" : "qc-ro"}">`];
    for (let c = 0; c < nc; c++) out.push(`<text class="colnum" x="${x(c)}" y="12">${c}</text>`);
    if (highlightCol != null && highlightCol >= 0) out.push(`<rect class="colmark" x="${LM + highlightCol * CW}" y="16" width="${CW}" height="${n * RH + 4}"/>`);
    for (let q = 0; q < n; q++) out.push(`<text class="lab" x="8" y="${y(q) + 4}">q${q}</text><line class="wire" x1="${LM - 8}" x2="${W - 8}" y1="${y(q)}" y2="${y(q)}"/>`);
    if (interactive) for (let c = 0; c < nc; c++) for (let q = 0; q < n; q++) out.push(`<rect class="cell${st.cursor.col === c && st.cursor.q === q ? " cur" : ""}" data-cell="${c},${q}" x="${LM + c * CW + 1}" y="${y(q) - RH / 2 + 1}" width="${CW - 2}" height="${RH - 2}" rx="3"/>`);
    circ.ops.forEach((o, i) => {
      const c = o.col ?? 0; if (maxCols && c >= maxCols) return; const def = GATES[o.g], sel = interactive && st.sel === i, cls = `gate${sel ? " sel" : ""}${o.tag === "oracle" ? " oracle" : ""}${o.g === "measure" ? " measure" : ""}`;
      const tip = `${def.title}${o.p && o.p.length ? ` (${o.p.map(fmtAng).join(", ")})` : ""}${o.tag ? ` · ${o.tag}` : ""}`;
      if (o.g === "barrier") { out.push(`<line class="bar" x1="${x(c)}" x2="${x(c)}" y1="${y(0) - RH / 2 + 4}" y2="${y(n - 1) + RH / 2 - 4}" data-op="${i}" data-tip="${esc(tip)}"/>`); return; }
      if (def.kind === "c1q") { const ct = o.c[0], tg = o.q[0]; out.push(`<g data-op="${i}" class="${cls}" data-tip="${esc(tip)}"><line class="link" x1="${x(c)}" x2="${x(c)}" y1="${y(ct)}" y2="${y(tg)}"/><circle class="ctrl" cx="${x(c)}" cy="${y(ct)}" r="5"/>`);
        if (o.g === "cx") out.push(`<circle cx="${x(c)}" cy="${y(tg)}" r="11" fill="#151126" stroke="${VIOLET}" stroke-width="1.4"/><line x1="${x(c) - 11}" x2="${x(c) + 11}" y1="${y(tg)}" y2="${y(tg)}" stroke="${VIOLET}" stroke-width="1.4"/><line x1="${x(c)}" x2="${x(c)}" y1="${y(tg) - 11}" y2="${y(tg) + 11}" stroke="${VIOLET}" stroke-width="1.4"/>`);
        else if (o.g === "cz") out.push(`<circle class="ctrl" cx="${x(c)}" cy="${y(tg)}" r="5"/>`);
        else out.push(`<rect x="${x(c) - 17}" y="${y(tg) - 14}" width="34" height="28" rx="3"/><text x="${x(c)}" y="${y(tg) - 3}" style="font-size:10px">P</text><text x="${x(c)}" y="${y(tg) + 8}" style="font-size:8.5px">${esc(fmtAng(o.p[0]))}</text>`);
        if (sel) out.push(`<rect x="${x(c) - 20}" y="${Math.min(y(ct), y(tg)) - 16}" width="40" height="${Math.abs(y(ct) - y(tg)) + 32}" fill="none" stroke="#d7ccff" stroke-dasharray="3 3"/>`);
        out.push(`</g>`); return; }
      if (o.g === "swap") { const [a, b] = o.q; out.push(`<g data-op="${i}" class="${cls}" data-tip="${esc(tip)}"><line class="link" x1="${x(c)}" x2="${x(c)}" y1="${y(a)}" y2="${y(b)}"/>${[a, b].map((w) => `<path d="M${x(c) - 7},${y(w) - 7}L${x(c) + 7},${y(w) + 7}M${x(c) + 7},${y(w) - 7}L${x(c) - 7},${y(w) + 7}" stroke="${VIOLET}" stroke-width="1.8"/>`).join("")}</g>`); return; }
      if (o.g === "mcz") { const qs = [...(o.c || []), ...o.q], lo = Math.min(...qs), hi = Math.max(...qs); out.push(`<g data-op="${i}" class="${cls}" data-tip="${esc(tip)}"><line class="link" x1="${x(c)}" x2="${x(c)}" y1="${y(lo)}" y2="${y(hi)}" ${o.tag === "oracle" ? `style="stroke:${AMBER}"` : ""}/>${qs.map((w) => `<circle cx="${x(c)}" cy="${y(w)}" r="5" fill="${o.tag === "oracle" ? AMBER : VIOLET}"/>`).join("")}</g>`); return; }
      const q = o.q[0]; out.push(`<g data-op="${i}" class="${cls}" data-tip="${esc(tip)}"><rect x="${x(c) - 17}" y="${y(q) - 15}" width="34" height="30" rx="3"/>`);
      if (o.g === "measure") out.push(`<path d="M${x(c) - 10},${y(q) + 6} A11,11 0 0 1 ${x(c) + 10},${y(q) + 6}" fill="none" stroke="#a8b1bd" stroke-width="1.3"/><line x1="${x(c)}" y1="${y(q) + 6}" x2="${x(c) + 7}" y2="${y(q) - 7}" stroke="#a8b1bd" stroke-width="1.3"/>`);
      else if (def.params.length) out.push(`<text x="${x(c)}" y="${y(q) - 4}">${esc(def.label)}</text><text x="${x(c)}" y="${y(q) + 8}" style="font-size:8.5px;font-weight:500">${esc(fmtAng(o.p[0]))}</text>`);
      else out.push(`<text x="${x(c)}" y="${y(q)}">${esc(def.label)}</text>`);
      out.push(`</g>`);
    });
    if (interactive && st.pending) out.push(`<circle cx="${x(st.pending.col)}" cy="${y(st.pending.q)}" r="6" fill="none" stroke="${VIOLET}" stroke-width="2" stroke-dasharray="2 2"/>`);
    if (maxCols && cols > maxCols) out.push(`<text x="${W - 12}" y="${H - 4}" text-anchor="end" fill="#808a98" font-size="10.5" font-family="JetBrains Mono, monospace">… ${cols - maxCols} more columns</text>`);
    out.push("</svg>"); return out.join("");
  }

  // ================================================================== state visualisations (from one simulation result)
  function stateAt(sim) { if (!sim) return null; const sn = st.step == null || st.step >= sim.snapshots.length ? sim.snapshots[sim.snapshots.length - 1] : sim.snapshots[st.step]; return sn; }
  const probsOf = (sn) => Array.from(sn.re, (r, i) => r * r + sn.im[i] * sn.im[i]);
  function probField(probs, n, { marked = null, counts = null, shots = 0, title = "Probability field" } = {}) {
    const N = probs.length, bars = probs.map((p, i) => ({ label: basisLabel(i, n), v: p, key: i, color: marked && marked.has(i) ? VIOLET : ICE, tip: `|${basisLabel(i, n)}⟩ (${i}): P = ${p.toFixed(6)}${marked && marked.has(i) ? " · marked" : ""}` }));
    return `<div class="figure"><div class="fh"><h3>${esc(title)}</h3><span class="sub">exact probabilities |aᵢ|² over all ${N} basis states, labelled |q${n - 1}…q0⟩ ${bx.prov("emulated")}</span></div>${barChart(bars, { w: 760, h: 210, rotate: N > 16, y: { pct: true, max: Math.max(...probs, 1e-9) }, aria: "probabilities" })}</div>`;
  }
  function ampView(sn, n, marked = null) {
    const N = sn.re.length, rows = [], W = 760, H = 210, M = { l: 46, r: 10, t: 14, b: N > 16 ? 50 : 30 }, bw = (W - M.l - M.r) / N, amax = Math.max(1e-9, ...Array.from(sn.re, (r, i) => Math.hypot(r, sn.im[i])));
    const mid = (H - M.b + M.t) / 2, sy = (v) => mid - (v / amax) * ((H - M.b - M.t) / 2 - 4); let mean = 0; for (let i = 0; i < N; i++) mean += sn.re[i]; mean /= N;
    const realOnly = Array.from(sn.im).every((v) => Math.abs(v) < 1e-12);
    rows.push(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="amplitudes"><line x1="${M.l}" x2="${W - M.r}" y1="${mid}" y2="${mid}" stroke="#2a313d"/>`);
    for (let i = 0; i < N; i++) {
      const re = sn.re[i], im = sn.im[i], mag = Math.hypot(re, im), ph = Math.atan2(im, re), x = M.l + i * bw + bw / 2, col = marked && marked.has(i) ? VIOLET : ICE, tip = `|${basisLabel(i, n)}⟩: a = ${re.toFixed(4)} ${im < 0 ? "−" : "+"} ${Math.abs(im).toFixed(4)}i, |a| = ${mag.toFixed(4)}, phase ${(ph * 180 / Math.PI).toFixed(1)}°`;
      if (realOnly) rows.push(`<rect x="${x - Math.max(0.6, bw * 0.4)}" y="${Math.min(sy(re), mid)}" width="${Math.max(1.2, bw * 0.8)}" height="${Math.abs(sy(re) - mid)}" fill="${col}" data-tip="${esc(tip)}" data-key="${i}"/>`);
      else { const len = (mag / amax) * ((H - M.b - M.t) / 2 - 6), r0 = Math.min(bw * 0.42, 12); rows.push(`<line x1="${x}" x2="${x}" y1="${mid}" y2="${mid - len}" stroke="${col}" stroke-width="${Math.max(1, Math.min(4, bw * 0.4))}" data-tip="${esc(tip)}" data-key="${i}"/>`);
        if (mag > 1e-9 && bw > 9) rows.push(`<circle cx="${x}" cy="${H - M.b + 2 - r0 - 4}" r="${r0}" fill="none" stroke="#3a4250"/><line x1="${x}" y1="${H - M.b + 2 - r0 - 4}" x2="${x + r0 * Math.cos(ph)}" y2="${H - M.b + 2 - r0 - 4 - r0 * Math.sin(ph)}" stroke="${col}" stroke-width="1.6" data-tip="${esc(tip)}"/>`); }
    }
    if (realOnly) rows.push(`<line x1="${M.l}" x2="${W - M.r}" y1="${sy(mean)}" y2="${sy(mean)}" stroke="${AMBER}" stroke-dasharray="4 4"/><text x="${W - M.r}" y="${sy(mean) - 4}" text-anchor="end" fill="${AMBER}" font-size="10.5" font-family="JetBrains Mono, monospace">mean amplitude ${mean.toFixed(4)}</text>`);
    rows.push(`</svg>`);
    return `<div class="figure"><div class="fh"><h3>Amplitudes and phases</h3><span class="sub">${realOnly ? "all amplitudes are real here: bar = signed amplitude (a sign flip is a phase of π); dashed line = mean (diffusion inverts about it)" : "line length = |a|; dial needle = phase arg(a) (0° to the right, counter-clockwise)"} ${bx.prov("emulated")}</span></div>${rows.join("")}</div>`;
  }
  function blochSVG(b, q) {
    const S = 132, c = S / 2, R = 50, tilt = 0.32, px = (x, y, z) => [c + R * (y * 0.94 - x * 0.34), c - R * (z * Math.cos(tilt) - (x * 0.5) * Math.sin(tilt))];
    const [vx, vy] = px(b.x, b.y, b.z), pure = b.r > 1 - 1e-9;
    return `<figure><svg viewBox="0 0 ${S} ${S}" width="100%" role="img" aria-label="Bloch vector of qubit ${q}"><circle cx="${c}" cy="${c}" r="${R}" fill="none" stroke="#2a313d"/><ellipse cx="${c}" cy="${c}" rx="${R}" ry="${R * Math.sin(tilt) + 6}" fill="none" stroke="#1d232e" stroke-dasharray="3 3"/>
      <line x1="${c}" y1="${c - R - 6}" x2="${c}" y2="${c + R + 6}" stroke="#1d232e"/><text x="${c + 3}" y="${c - R - 8}" fill="#808a98" font-size="9" font-family="JetBrains Mono, monospace">|0⟩</text><text x="${c + 3}" y="${c + R + 14}" fill="#808a98" font-size="9" font-family="JetBrains Mono, monospace">|1⟩</text>
      <line x1="${c}" y1="${c}" x2="${vx}" y2="${vy}" stroke="${VIOLET}" stroke-width="2.4"/><circle cx="${vx}" cy="${vy}" r="4" fill="${pure ? VIOLET : "#0a0d14"}" stroke="${VIOLET}" stroke-width="1.6"/></svg>
      <figcaption>q${q} · |r| = ${b.r.toFixed(3)}<br>x ${b.x.toFixed(2)} · y ${b.y.toFixed(2)} · z ${b.z.toFixed(2)}<br><span style="color:${pure ? "var(--tx-3)" : "#d6cbfb"}">${pure ? "pure single-qubit state" : "mixed reduced state"}</span></figcaption></figure>`;
  }
  function blochView(bl, mixedWhy) {
    return `<div class="figure"><div class="fh"><h3>Bloch spheres of the reduced single-qubit states</h3><span class="sub">ρ_q = Tr_others |ψ⟩⟨ψ| ${bx.prov("emulated")}</span></div><div class="bloch">${bl.map((b, q) => blochSVG(b, q)).join("")}</div>
      <p class="note">Each sphere shows one qubit's reduced state. |r| &lt; 1 means that qubit is ${mixedWhy}: the spheres together do <b>not</b> describe the full multi-qubit state (correlations are not shown).</p></div>`;
  }
  function measView(dist, counts, shots, seed, n, marked = null) {
    if (!counts) return `<div class="figure"><div class="fh"><h3>Measurement laboratory</h3></div><p class="note">Run & record to sample ${int(shots)} shots with seed ${seed}. Exact probabilities are shown next to the sampled frequencies.</p></div>`;
    const keys = [...new Set([...dist.keys(), ...counts.keys()])].sort(), tv = tvDistance(dist, counts, shots);
    const bars = keys.slice(0, 64).map((k) => { const p = dist.get(k) || 0, f = (counts.get(k) || 0) / shots, i = parseInt(k, 2); return { label: k, v: p, v2: f, color: marked && marked.has(i) ? VIOLET : ICE, color2: "#808a98", tip: `${k}: exact ${p.toFixed(4)}`, tip2: `${k}: ${counts.get(k) || 0} of ${shots} shots (${f.toFixed(4)}), expected ±${Math.sqrt(p * (1 - p) / shots).toFixed(4)} (1 s.d.)` }; });
    return `<div class="figure"><div class="fh"><h3>Measurement laboratory</h3><span class="sub">${int(shots)} shots, seed ${seed} · total-variation distance from exact ${tv.toFixed(4)} ${bx.prov("emulated", "samples drawn from the exact distribution with a seeded generator")}</span></div>
      <div class="legend"><span><i style="background:${ICE}"></i>exact probability</span><span><i style="background:#808a98"></i>sampled frequency</span></div>${barChart(bars, { w: 760, h: 210, pair: true, rotate: bars.length > 16, y: { pct: true }, aria: "exact vs sampled" })}
      <p class="note">Finite-shot frequencies scatter around the exact values with standard deviation √(p(1−p)/shots). Classical bits read c${n - 1}…c0; unmeasured qubits read 0.</p></div>`;
  }
  function inspectorView(sim, n) {
    const i = Math.min(st.basis, (1 << n) - 1), hist = sim.snapshots.map((sn, j) => [j, sn.re[i] ** 2 + sn.im[i] ** 2]), sn = stateAt(sim), re = sn.re[i], im = sn.im[i];
    return `<div class="figure"><div class="fh"><h3>State inspector</h3><span class="sub">click a bar in the probability field, or type a basis state</span></div>
      <div class="row"><input class="ctl" id="q-basis" style="width:140px" value="${basisLabel(i, n)}" aria-label="Basis state (bitstring)"><span class="mono dim">index ${i}</span></div>
      <dl class="kv"><dt>Amplitude</dt><dd>${re.toFixed(6)} ${im < 0 ? "−" : "+"} ${Math.abs(im).toFixed(6)} i</dd><dt>Probability</dt><dd>${(re * re + im * im).toFixed(6)}</dd><dt>Magnitude · phase</dt><dd>${Math.hypot(re, im).toFixed(6)} · ${(Math.atan2(im, re) * 180 / Math.PI).toFixed(2)}°</dd><dt>At step</dt><dd>${st.step == null ? "final" : st.step === 0 ? "initial |0…0⟩" : `after column ${sim.snapshots[st.step].col}`}</dd></dl>
      ${lineChart([{ name: `P(|${basisLabel(i, n)}⟩)`, color: VIOLET, pts: hist, marker: "circle", step: false }], { w: 760, h: 150, x: { min: 0, max: Math.max(1, hist.length - 1), label: "step (0 = initial state, then after each column)" }, y: { min: 0, max: 1, pct: true }, rightPad: 110, aria: "probability history" })}</div>`;
  }

  // ================================================================== composer render
  function renderComposerLeft() {
    const c = C(), sel = st.sel != null ? st.ops[st.sel] : null, def = sel && GATES[sel.g];
    L.innerHTML = `<div class="sec"><div class="field"><span class="lab">Qubits (1–${LIMITS.composerQubits}) · initial state |0…0⟩</span><div class="row"><button class="btn sm" id="q-nm" aria-label="Remove a qubit">−</button><span class="mono" style="min-width:24px;text-align:center">${st.n}</span><button class="btn sm" id="q-np" aria-label="Add a qubit">+</button><span class="note">statevector: 2^${st.n} = ${1 << st.n} amplitudes</span></div></div>
        <div class="field"><label for="q-tpl">Start from</label><select class="ctl" id="q-tpl"><option value="">Template…</option>${Object.entries(TEMPLATES).map(([k, t]) => `<option value="${k}">${esc(t.name)}</option>`).join("")}</select></div></div>
      <div class="sec"><span class="micro">Gate palette</span><div class="gpal" role="toolbar" aria-label="Gates">${PALETTE.map((g) => `<button draggable="true" data-gate="${g}" class="${g === "measure" ? "meas" : ""}" aria-pressed="${st.brush === g}" title="${esc(GATES[g].title)}">${esc(GATES[g].label)}</button>`).join("")}</div>
        <p class="note">${GATES[st.brush].kind === "c1q" ? (st.pending ? `<b>${GATES[st.brush].label}</b>: control on q${st.pending.q} (column ${st.pending.col}) — now click the target qubit in the same column.` : `<b>${GATES[st.brush].label}</b>: click the control qubit, then the target.`) : `Click a cell (or drag a gate onto it) to place <b>${esc(GATES[st.brush].label)}</b>. Keyboard: arrows, Enter, Delete.`}</p>
        <div class="row"><button class="btn sm" id="q-undo" ${st.undo.length ? "" : "disabled"}>Undo</button><button class="btn sm" id="q-redo" ${st.redo.length ? "" : "disabled"}>Redo</button><button class="btn sm ghost" id="q-clear" ${st.ops.length ? "" : "disabled"}>Clear</button><button class="btn sm ghost" id="q-measall">Measure all</button></div></div>
      <div class="sec"><span class="micro">Selected gate</span>${sel ? `<dl class="kv"><dt>Gate</dt><dd>${esc(def.title)}</dd><dt>Column</dt><dd>${sel.col ?? 0}</dd><dt>${sel.c && sel.c.length ? "Control → target" : "Qubit(s)"}</dt><dd>${sel.c && sel.c.length ? `q${sel.c[0]} → q${sel.q[0]}` : sel.q.length ? sel.q.map((q) => `q${q}`).join(", ") : "all"}</dd></dl>
        ${def.params.map((p, j) => `<div class="field"><label for="q-par-${j}">${esc(p)} (radians; e.g. pi/2, 3*pi/4, 0.5)</label><input class="ctl" id="q-par-${j}" data-par="${j}" value="${esc(fmtAng(sel.p[j]).replace("π", "pi").replace("−", "-"))}"><span class="help mono">= ${sel.p[j].toFixed(6)} rad</span></div>`).join("")}
        <div class="row"><button class="btn sm danger" id="q-del">Delete gate</button></div>` : `<p class="note">Click a placed gate to edit its parameters or delete it.</p>`}</div>
      <div class="sec"><span class="micro">Simulation</span><div class="grid2"><div class="field"><label for="q-shots">Shots</label><input class="ctl" id="q-shots" type="number" min="1" max="${LIMITS.maxShots}" value="${st.shots}"></div><div class="field"><label for="q-seed">Seed</label><input class="ctl" id="q-seed" type="number" value="${st.seed}"></div></div>
        <label class="chk"><input type="checkbox" id="q-noisy" ${st.noisy ? "checked" : ""}>Noise (density matrix, ≤ ${LIMITS.dmQubits} qubits)</label>${st.noisy ? noiseFields(st.noise, "q") : ""}
        ${st.err ? st.err.map((e) => `<div class="m-err">${esc(e)}</div>`).join("") : ""}${(st.warn || []).map((w) => `<div class="m-info">${esc(w)}</div>`).join("")}
        <button class="btn qprimary" id="q-run" ${st.sim ? "" : "disabled"}>Run &amp; record</button><p class="note">The exact state updates as you edit; Run samples shots and stores an experiment record.</p></div>`;
  }
  const noiseFields = (nz, p) => `<div class="grid3"><div class="field"><label for="${p}-p1">1-qubit λ</label><input class="ctl" id="${p}-p1" type="number" step="0.001" min="0" max="0.5" value="${nz.p1}"></div><div class="field"><label for="${p}-p2">2-qubit λ</label><input class="ctl" id="${p}-p2" type="number" step="0.001" min="0" max="0.5" value="${nz.p2}"></div><div class="field"><label for="${p}-ro">Readout</label><input class="ctl" id="${p}-ro" type="number" step="0.001" min="0" max="0.5" value="${nz.readout}"></div></div>
    <p class="note">${bx.prov("synthetic")} Depolarizing channel (1−λ)ρ + λ·I/2ᵏ ⊗ Tr_k ρ after each gate, symmetric readout flips. Synthetic assumptions, not device calibration data.</p>`;
  function renderComposerCenter() {
    const sim = st.sim, nsim = st.noisySim, steps = sim ? sim.snapshots.length : 0, sn = sim ? stateAt(sim) : null;
    const tabs = [["probs", "Probability field"], ["amps", "Amplitudes & phases"], ["bloch", "Bloch spheres"], ["meas", "Measurement lab"], ["insp", "State inspector"]];
    let viz = `<div class="empty">Fix the circuit to see its state.</div>`;
    if (sim) {
      const probs = nsim && (st.step == null) ? Array.from(nsim.probs) : probsOf(sn), dist = nsim ? nsim.dist : sim.dist;
      if (st.viz === "probs") viz = probField(probs, st.n, { title: nsim && st.step == null ? "Probability field (noisy, before readout error)" : "Probability field" });
      else if (st.viz === "amps") viz = nsim && st.step == null ? `<div class="m-info">A noisy state is a mixed state (density matrix, purity Tr ρ² = ${nsim.purity.toFixed(4)}); it has no single set of amplitudes. Turn noise off or step back to see the ideal amplitudes.</div>` : ampView(sn, st.n);
      else if (st.viz === "bloch") { const bl = nsim && st.step == null ? nsim.bloch : Array.from({ length: st.n }, (_, q) => { const s2 = { re: sn.re, im: sn.im, dim: sn.re.length }; let r00 = 0, r11 = 0, xr = 0, xi = 0; const b = 1 << q; for (let i = 0; i < s2.dim; i++) { if (i & b) continue; const j = i | b; r00 += s2.re[i] ** 2 + s2.im[i] ** 2; r11 += s2.re[j] ** 2 + s2.im[j] ** 2; xr += s2.re[i] * s2.re[j] + s2.im[i] * s2.im[j]; xi += s2.im[i] * s2.re[j] - s2.re[i] * s2.im[j]; } return bloch([r00, r11, xr, xi]); });
        viz = blochView(bl, nsim && st.step == null ? "entangled with other qubits and/or affected by noise" : "entangled with the other qubits"); }
      else if (st.viz === "meas") viz = measView(dist, st.counts, st.shots, st.seed, st.n);
      else viz = inspectorView(sim, st.n);
    }
    Cn.innerHTML = `<div class="figure" style="gap:6px"><div class="fh"><h3>Circuit</h3><span class="sub">${st.n} qubit${st.n > 1 ? "s" : ""}, initialised to |0…0⟩; the diagram is the simulated circuit</span></div><div class="qc" id="qc-wrap">${circuitSVG(C(), { interactive: true, highlightCol: sim && st.step != null && st.step > 0 ? sim.snapshots[st.step].col : null })}</div>
        ${sim ? `<div class="row"><span class="micro">Gate-by-gate evolution</span><input type="range" id="q-step" min="0" max="${steps - 1}" value="${st.step ?? steps - 1}" style="flex:1;min-width:160px" aria-label="Step through the circuit"><span class="mono dim" style="min-width:150px">${st.step == null || st.step === steps - 1 ? "final state" : st.step === 0 ? "initial |0…0⟩" : `after column ${sim.snapshots[st.step].col}`}</span></div>` : ""}</div>
      <div class="tabs q" role="tablist">${tabs.map(([k, n]) => `<button role="tab" data-viz="${k}" aria-selected="${st.viz === k}">${n}</button>`).join("")}</div>${viz}`;
  }
  function renderComposerRight() {
    const c = C(), s = circuitStats(c), sim = st.sim;
    R.innerHTML = `<div class="sec"><span class="micro">Circuit statistics</span><dl class="kv"><dt>Qubits · classical bits</dt><dd>${s.qubits} · ${s.clbits}</dd><dt>Depth (barriers sync, no layer)</dt><dd>${s.depth}</dd><dt>Gates (excl. measure)</dt><dd>${s.gates}</dd><dt>Two-qubit gates</dt><dd>${s.twoQubit}</dd><dt>Measurements</dt><dd>${s.measurements}</dd>
        ${Object.entries(s.counts).sort().map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl><p class="note">Counts follow Qiskit's depth() and count_ops() conventions (checked in the test suite).</p></div>
      <div class="sec"><span class="micro">Transpiled circuit</span>${transpileBlock(c)}</div>
      <div class="sec"><span class="micro">Execution</span><dl class="kv"><dt>Method</dt><dd style="font-family:var(--sans)">${st.noisySim ? "density matrix (classical)" : "statevector (classical)"}</dd><dt>Simulator runtime</dt><dd>${sim ? `${(st.noisySim ? st.noisySim.ms : sim.ms).toFixed(2)} ms ${bx.prov("measured")}` : "–"}</dd><dt>Norm ⟨ψ|ψ⟩</dt><dd>${sim ? sim.norm.toFixed(12) : "–"}</dd>${st.noisySim ? `<dt>Purity Tr ρ²</dt><dd>${st.noisySim.purity.toFixed(6)}</dd>` : ""}
        <dt>Quantum hardware</dt><dd>${bx.prov("unavailable")} not connected</dd></dl></div>
      <div class="sec"><span class="micro">Export</span><div class="row"><button class="btn sm" id="q-qasm">OpenQASM 2</button><button class="btn sm" id="q-json">Circuit JSON</button><button class="btn sm" id="q-csv" ${sim ? "" : "disabled"}>Results CSV</button></div>
        ${st.record ? `<div class="m-ok">Recorded <button class="btn sm" data-rec="${st.record.id}" style="height:20px">${esc(st.record.id)}</button></div>` : `<p class="note">Run &amp; record stores the circuit, seed, shots, exact and sampled results.</p>`}</div>`;
  }
  function transpileBlock(c) {
    const ok = store.get().bsapi.state === "ok";
    if (st.transp && st.transp.key === JSON.stringify(c.ops) + c.n) { const t = st.transp.res; return `<dl class="kv"><dt>Basis</dt><dd>${esc(t.basis.join(", "))}</dd><dt>Optimisation level</dt><dd>${t.optimization_level}</dd><dt>Depth</dt><dd>${t.depth}</dd><dt>Size</dt><dd>${t.size}</dd><dt>Two-qubit gates</dt><dd>${t.two_qubit}</dd>${Object.entries(t.counts).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl><p class="note">From Qiskit ${esc(t.qiskit)} transpile() via the BLACKSKY API ${bx.prov("analytical", "compiler output")}; no device coupling map.</p>`; }
    return ok ? `<button class="btn sm" id="q-transpile">Transpile with Qiskit</button><p class="note">Uses the optional BLACKSKY API (blacksky/serve.py).</p>` : `<p class="note">${bx.prov("unavailable")} Needs the optional BLACKSKY API with Qiskit (run blacksky/serve.py); not available on a static deployment.</p>`;
  }

  // ================================================================== Grover
  const G = st.g;
  const gMarked = () => parseMarked(G.markedTxt, G.n), gValid = () => validateGrover({ n: G.n, marked: gMarked(), r: G.r ?? 0, shots: G.shots, noisy: G.noisy });
  function gTheory() { const mk = gMarked(); try { return groverTheory(2 ** G.n, mk.filter((x) => Number.isInteger(x)).length || 1); } catch { return null; } }
  async function runGrover() {
    const v = gValid(); if (!v.ok) { G.err = v.errors; renderAll(); return; } G.err = null;
    const mk = gMarked(), th = groverTheory(2 ** G.n, mk.length), r = G.r ?? th.rStar, noise = G.noisy ? { ...G.noiseP, source: "synthetic (user-set)" } : null;
    G.res = null; G.counts = null; G.record = null; G.prog = 0; renderAll();
    const job = bx.jobs.run("quantum.grover", { n: G.n, marked: mk, r, noise }, { onProgress: (p) => { G.prog = p.done / p.total; bx.setJob({ label: "Grover", pct: 100 * G.prog }); renderLeftOnly(); }, timeoutMs: 120000, family: "quantum" });
    G.job = job; bx.setJob({ label: "Grover", pct: 0 }); const t0 = performance.now();
    try {
      const res = await job.promise; if (res.status === "cancelled") { toast("Grover run cancelled"); G.job = null; bx.setJob(null); renderAll(); return; }
      G.res = res; G.stage = res.main.stages.length - 1;
      const fin = res.main.stages[res.main.stages.length - 1], exact = new Map(fin.probs.map((p, i) => [basisLabel(i, G.n), p]).filter(([, p]) => p > 1e-15));
      const dist = noise ? new Map(res.noisy.dist) : exact; G.counts = sample(dist, G.shots, makeRng(G.seed).next);
      const succ = mk.reduce((a, m) => a + (G.counts.get(basisLabel(m, G.n)) || 0), 0) / G.shots, wall = performance.now() - t0;
      G.record = bx.registry.add({ parent: G.parent || null, type: "quantum.grover", name: `Grover n=${G.n}, M=${mk.length}, r=${r}${noise ? " · noisy" : ""}${G.toy ? ` · toy grid ${G.toy.grid}` : ""}`, config: { n: G.n, N: 2 ** G.n, marked: mk, r, shots: G.shots, seed: G.seed, noise, oracle: G.toy ? `lookup of ${2 ** G.n} precomputed ${G.toy.grid} k=${G.toy.k} cascade results (S ≥ ${G.toy.tau.toFixed(4)})` : "phase oracle: X-conjugated multi-controlled Z per marked state", diffusion: "H X MCZ X H", decomposition: "MCZ → CX + P parity network" },
        seed: G.seed, provenance: "emulated", scenarioIds: [], results: { pMarkedExact: fin.pMarked, pMarkedTheory: th.P(r), pMarkedNoisy: res.noisy ? res.noisy.pMarked : null, sampledSuccess: succ, rStar: th.rStar, oracleQueries: r, statsAbstract: res.main.statsAbstract, statsCompiled: res.main.statsCompiled, simulatorMs: res.main.ms, wallMs: wall,
          sweep: res.sweep.map((x) => [x.r, +x.pMarked.toFixed(10)]) }, durationMs: wall, limitations: limitationsFor("quantum.grover"), links: G.toy ? G.toy.cands.map((c) => ({ kind: "candidate", id: candidateId(G.toy.grid, c.set) })) : [],
        log: [{ t: 0, msg: `circuit-level statevector simulation, ${res.main.statsCompiled.gates} elementary gates` }, { t: res.main.ms, msg: `sweep r = 0…${res.rMax}` }, ...(res.noisy ? [{ t: res.noisy.ms, msg: `density matrix with λ1=${noise.p1}, λ2=${noise.p2}, readout=${noise.readout}` }] : [])] });
    } catch (e) { G.err = [String(e.message || e)]; }
    G.job = null; bx.setJob(null); renderAll();
  }
  // closest meaningful grid connection: Grover over 2^n real candidate sets with a lookup oracle built from classical simulator runs
  function toyGrid() {
    const s = store.get(); if (!s.net) return; const r = bx.runOnNet(), k = r ? r.k : 2, m = s.net.model, n = Math.min(G.n, 6), want = 2 ** n;
    const order = m.branches.filter((b) => b.in_service).sort((a, b) => b.base_loading_dc - a.base_loading_dc || a.l - b.l).map((b) => b.l);
    let Lm = k; while (Lm < order.length && binom(Lm, k) < want) Lm++;
    const cands = [], c = Array.from({ length: k }, (_, i) => i); const t0 = performance.now();
    do { const set = canon(c.map((i) => order[i])); cands.push({ set, S: s.net.engine.run(set, { policy: "all_overloaded" }).metrics.S }); } while (cands.length < want && nextCombination(c, Lm));
    const ms = performance.now() - t0, Smax = Math.max(...cands.map((x) => x.S)); if (!(Smax > 0)) { toast("None of these candidate sets loses demand; pick another network or k"); return; }
    const marked = cands.map((x, i) => [x, i]).filter(([x]) => x.S >= Smax - 1e-12).map(([, i]) => i); if (marked.length >= want) { toast("All candidates tie; no search problem"); return; }
    G.n = n; G.markedTxt = marked.map((i) => basisLabel(i, n)).join(", "); G.r = null; G.res = null; G.toy = { grid: s.netId, k, cands, tau: Smax, ms, marked };
    toast(`${want} candidate sets simulated classically in ${ms.toFixed(0)} ms; ${marked.length} marked`); renderAll();
  }
  function renderGroverLeft() {
    const th = gTheory(), mk = gMarked(), v = gValid(), running = !!G.job, rmax = th ? Math.min(GROVER_LIMITS.maxIterations, 2 * th.rStar + 2) : 8, r = G.r ?? (th ? th.rStar : 1);
    L.innerHTML = `<div class="sec"><div class="grid2"><div class="field"><label for="g-n">Qubits n (${GROVER_LIMITS.minQubits}–${GROVER_LIMITS.maxQubits})</label><input class="ctl" id="g-n" type="number" min="${GROVER_LIMITS.minQubits}" max="${GROVER_LIMITS.maxQubits}" value="${G.n}"></div><div class="field"><span class="lab">Search space</span><div class="mono" style="padding-top:6px">N = 2^${G.n} = ${2 ** G.n}</div></div></div>
        <div class="field"><label for="g-mk">Marked states (bitstrings of length ${G.n} or indices)</label><input class="ctl" id="g-mk" value="${esc(G.markedTxt)}" autocomplete="off"><span class="help">${mk.every(Number.isInteger) ? `M = ${mk.length} · indices ${mk.join(", ")}` : "unreadable entry"}</span></div>
        <div class="row"><button class="btn sm" id="g-rand">Random marked state (seed ${G.seed})</button></div>
        <div class="field"><label for="g-r">Grover iterations r = oracle queries</label><div class="row"><input type="range" id="g-r" min="0" max="${rmax}" value="${Math.min(r, rmax)}" style="flex:1"><span class="mono" style="min-width:30px">${r}</span></div>
          <span class="help">${th ? `θ = arcsin √(M/N) = ${th.theta.toFixed(4)} rad · r* = ⌊π/(4θ)⌋ = ${th.rStar} · P(r) = sin²((2r+1)θ) = ${pct(th.P(r), 2)} ${bx.prov("analytical")}` : ""}</span></div>
        <div class="grid2"><div class="field"><label for="g-shots">Shots</label><input class="ctl" id="g-shots" type="number" min="1" max="${LIMITS.maxShots}" value="${G.shots}"></div><div class="field"><label for="g-seed">Seed</label><input class="ctl" id="g-seed" type="number" value="${G.seed}"></div></div>
        <label class="chk"><input type="checkbox" id="g-noisy" ${G.noisy ? "checked" : ""}>Noise on the decomposed circuit (n ≤ ${GROVER_LIMITS.maxNoisyQubits})</label>${G.noisy ? noiseFields(G.noiseP, "g") : ""}
        ${(G.err || []).map((e) => `<div class="m-err">${esc(e)}</div>`).join("")}${!v.ok && !G.err ? v.errors.map((e) => `<div class="m-warn">${esc(e)}</div>`).join("") : ""}
        <div class="row"><button class="btn qprimary" id="g-run" ${v.ok && !running ? "" : "disabled"}>${running ? "Simulating…" : "Run Grover & record"}</button>${running ? `<button class="btn" id="g-cancel">Cancel</button>` : ""}</div>
        ${running ? `<div class="prog q"><i style="width:${(100 * (G.prog || 0)).toFixed(0)}%"></i></div>` : ""}</div>
      <div class="sec"><span class="micro">Oracle</span><p class="note">${G.toy ? `<b>Toy grid formulation</b>: index i ↔ the i-th ${G.toy.k}-branch set of the most loaded ${GRID_NAME[G.toy.grid]} branches. The oracle marks the set(s) with the largest S among these ${2 ** G.n} — a <b>lookup table built by running the cascade simulator on every one of them classically</b> (${G.toy.ms.toFixed(0)} ms). That classical work already solves this search, so this shows amplitude amplification, not a speed-up. ${bx.prov("proposed", "a quantum oracle for the cascade objective is not implemented")} A real oracle would have to evaluate the cascade reversibly.` : `Phase oracle: for each marked state m, X on the qubits where m has a 0, a multi-controlled Z, X again — a phase of −1 on |m⟩ only. The circuit is decomposed into CX + P gates for counting and noise.`}</p>
        <div class="row"><button class="btn sm" id="g-toy" title="Grover over outage sets of the current Theater network and k (lookup oracle built from simulator runs)">${G.toy ? "Rebuild toy grid formulation" : "Toy grid formulation"}</button>${G.toy ? `<button class="btn sm ghost" id="g-toy-x">Plain toy problem</button>` : ""}</div></div>`;
  }
  const renderLeftOnly = () => { if (st.mode === "grover") { const a = document.activeElement?.id; renderGroverLeft(); if (a && $(a)) $(a).focus(); } };
  function renderGroverCenter() {
    const th = gTheory(), mk = new Set(gMarked()), res = G.res, r = G.r ?? (th ? th.rStar : 0);
    const abstract = groverCircuit({ n: G.n, marked: [...mk].filter((x) => Number.isInteger(x) && x < 2 ** G.n), r: Math.min(r, 3) });
    const tabs = [["iter", "Iterations"], ["geom", "Geometry"], ["probs", "Probability field"], ["amps", "Amplitudes"], ["meas", "Measurement lab"], ...(G.toy ? [["toy", "Candidates"]] : [])];
    if (!tabs.some(([k]) => k === G.viz)) G.viz = "iter";
    let viz = "";
    if (!res) viz = `<div class="empty">${G.job ? "Simulating the elementary-gate circuit in the background…" : "Run Grover to simulate the circuit. The theory curve below is analytical; simulated points appear after a run."}</div>`;
    const sweepFig = () => { if (!th) return ""; const rmax = res ? res.rMax : 2 * th.rStar + 2, curve = []; for (let x = 0; x <= rmax; x += rmax / 160) curve.push([x, Math.sin((2 * x + 1) * th.theta) ** 2]);
      const series = [{ name: "theory sin²((2r+1)θ)", color: "#808a98", pts: curve, width: 1.4, dash: "4 3", label: "theory" }];
      if (res) series.push({ name: "simulated circuit", color: VIOLET, pts: res.sweep.map((x) => [x.r, x.pMarked]), marker: "circle", label: "simulated", width: 0.01 });
      if (res && res.noisy) series.push({ name: "noisy (density matrix)", color: AMBER, pts: [[r, res.noisy.pMarked]], marker: "diamond", label: "noisy" });
      return `<div class="figure"><div class="fh"><h3>Success probability vs iterations</h3><span class="sub">P(marked) after r oracle queries; r* = ${th.rStar} maximises it — past r* the state over-rotates and P falls again</span></div>
        ${lineChart(series, { w: 760, h: 240, x: { min: 0, max: rmax, label: "Grover iterations r (= oracle queries)" }, y: { min: 0, max: 1, pct: true }, vlines: [{ x: th.rStar, label: `r* = ${th.rStar}`, color: VIOLET }, { x: r, label: r === th.rStar ? "" : `chosen r = ${r}`, color: ICE }], aria: "Grover success probability" })}
        <div class="legend"><span><i style="background:#808a98"></i>analytical ${bx.prov("analytical")}</span><span><i style="background:${VIOLET}"></i>simulated elementary-gate circuit ${bx.prov("emulated")}</span>${res && res.noisy ? `<span><i style="background:${AMBER}"></i>noisy simulation ${bx.prov("emulated")} ${bx.prov("synthetic", "noise parameters")}</span>` : ""}</div></div>`; };
    if (res) {
      const stg = res.main.stages[Math.min(G.stage ?? 0, res.main.stages.length - 1)], probs = stg.probs, sn = { re: Float64Array.from(stg.amps), im: Float64Array.from(stg.ampsIm) };
      if (G.viz === "iter") viz = sweepFig();
      else if (G.viz === "geom") viz = geomView(th, res);
      else if (G.viz === "probs") viz = probField(probs, G.n, { marked: mk, title: `Probability field · ${stg.label}` });
      else if (G.viz === "amps") viz = ampView(sn, G.n, mk);
      else if (G.viz === "meas") { const fin = res.main.stages[res.main.stages.length - 1], exact = new Map(fin.probs.map((p, i) => [basisLabel(i, G.n), p]).filter(([, p]) => p > 1e-15)); viz = measView(res.noisy ? new Map(res.noisy.dist) : exact, G.counts, G.shots, G.seed, G.n, mk) + (res.noisy ? `<p class="note">Exact distribution includes the synthetic noise and readout error.</p>` : ""); }
      else if (G.viz === "toy" && G.toy) viz = `<div class="figure"><div class="fh"><h3>Candidate register</h3><span class="sub">basis state i ↔ candidate outage set; S from the classical cascade simulator ${bx.prov("simulator")}</span></div><div class="tablewrap"><table class="t"><thead><tr><th>|i⟩</th><th>Outage set</th><th>S</th><th>P after r = ${r}</th><th></th></tr></thead><tbody>${G.toy.cands.map((c, i) => `<tr ${mk.has(i) ? 'style="color:#d6cbfb"' : ""}><td>${basisLabel(i, G.n)}</td><td>{${c.set.join(", ")}}</td><td>${pct(c.S, 2)}</td><td>${pct(res.main.stages[res.main.stages.length - 1].probs[i], 2)}</td><td><button class="btn sm" data-open="${c.set.join("-")}" style="height:20px">Theater</button></td></tr>`).join("")}</tbody></table></div></div>`;
    } else if (th) viz += sweepFig();
    const stages = res ? res.main.stages : null;
    Cn.innerHTML = `<div class="figure" style="gap:6px"><div class="fh"><h3>Circuit (abstract view${r > 3 ? `, first 3 of ${r} iterations` : ""})</h3><span class="sub">H on every qubit, then r × [oracle (amber controls) · diffusion]. Multi-controlled Z gates are simulated as their CX + P decomposition.</span></div><div class="qc">${circuitSVG(abstract, { maxCols: 64 })}</div>
        ${stages ? `<div class="row"><span class="micro">Step through</span><input type="range" id="g-stage" min="0" max="${stages.length - 1}" value="${G.stage}" style="flex:1;min-width:160px" aria-label="Grover stage"><span class="mono dim" style="min-width:180px">${esc(stages[G.stage].label)} · P(marked) ${pct(stages[G.stage].pMarked, 2)}</span></div>` : ""}</div>
      <div class="tabs q" role="tablist">${tabs.map(([k, n]) => `<button role="tab" data-gviz="${k}" aria-selected="${G.viz === k}">${n}</button>`).join("")}</div>${viz}`;
  }
  let animT = 0;
  function animGrover() {                                         // steps the recorded stages (oracle, diffusion, …); nothing is computed here
    clearTimeout(animT); if (G.anim) { G.anim = false; renderCenterOnly(); return; } const res = G.res; if (!res) return;
    if (store.get().reduced) { G.stage = res.main.stages.length - 1; renderCenterOnly(); return; }
    G.anim = true; G.stage = 0; renderCenterOnly();
    const tick = () => { if (!G.anim || !G.res) return; if (G.stage >= G.res.main.stages.length - 1) { G.anim = false; renderCenterOnly(); return; } G.stage++; renderCenterOnly(); animT = setTimeout(tick, 650); };
    animT = setTimeout(tick, 650);
  }
  function geomView(th, res) {
    // the state never leaves the plane of |bad⟩ and |good⟩: oracle = reflection about |bad⟩, diffusion = reflection about |s⟩ (the start state).
    // Analytical points: (2r+1)θ after r iterations. The thick vector is the SIMULATED state at the step-through position, projected onto the plane.
    const cx = 200, cy = 200, R = 160, si = Math.min(G.stage ?? 0, res.main.stages.length - 1), stg = res.main.stages[si], prev = si > 0 ? res.main.stages[si - 1] : null;
    const ref = stageAngle(th.theta, stg.label, stg.iter), pr = planeProjection(stg.amps, stg.ampsIm, gMarked(), ref);
    const xy = (a, rr = R) => [cx + rr * Math.cos(a), cy - rr * Math.sin(a)], deg = (a) => `${(a * 180 / Math.PI).toFixed(1)}°`, out = [];
    out.push(`<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#1d232e"/><line x1="${cx - R - 12}" y1="${cy}" x2="${cx + R + 12}" y2="${cy}" stroke="#2a313d"/><line x1="${cx}" y1="${cy + R + 12}" x2="${cx}" y2="${cy - R - 12}" stroke="#2a313d"/>`);
    out.push(`<text x="${cx + R + 2}" y="${cy + 16}" text-anchor="end" fill="#808a98" font-size="11" font-family="JetBrains Mono, monospace">|bad⟩</text><text x="${cx + 6}" y="${cy - R - 14}" fill="#808a98" font-size="11" font-family="JetBrains Mono, monospace">|good⟩</text>`);
    const [sx, sy] = xy(th.theta, R + 14), [sx2, sy2] = xy(th.theta + Math.PI, R + 4);
    out.push(`<line x1="${sx2}" y1="${sy2}" x2="${sx}" y2="${sy}" stroke="${AMBER}" stroke-dasharray="3 4" stroke-opacity=".7"/><text x="${sx - 4}" y="${sy - 6}" text-anchor="end" fill="${AMBER}" font-size="10.5" font-family="JetBrains Mono, monospace">|s⟩ mirror</text>`);
    for (let r2 = 0; r2 <= Math.min(res.rMax, 2 * th.rStar + 2); r2++) { const a = (2 * r2 + 1) * th.theta, [x, y] = xy(a);
      out.push(`<circle cx="${x}" cy="${y}" r="3" fill="#3a3158" data-tip="analytical, r = ${r2}: ${deg(a)}, P = ${(Math.sin(a) ** 2).toFixed(4)}"/><text x="${x + 6}" y="${y - 4}" fill="#5d5579" font-size="9.5" font-family="JetBrains Mono, monospace">${r2}</text>`); }
    if (prev) { const pp = planeProjection(prev.amps, prev.ampsIm, gMarked(), stageAngle(th.theta, prev.label, prev.iter)), [px, py] = xy(pp.angle);
      out.push(`<line x1="${cx}" y1="${cy}" x2="${px}" y2="${py}" stroke="#5d5579" stroke-width="1.5" stroke-dasharray="4 3"/>`); }
    const [vx, vy] = xy(pr.angle, R * Math.hypot(pr.good, pr.bad));
    out.push(`<line x1="${cx}" y1="${cy}" x2="${vx}" y2="${vy}" stroke="${VIOLET}" stroke-width="3" stroke-linecap="round"/><circle cx="${vx}" cy="${vy}" r="5" fill="${VIOLET}"/>`);
    out.push(`<line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - R * Math.abs(pr.good) * Math.sign(pr.good)}" stroke="${VIOLET}" stroke-opacity=".35" stroke-width="6"/>`);
    const txt = [`<p class="mono" style="color:#d6cbfb;font-size:13px;margin:0">${esc(stg.label)}</p>`,
      `<p>${stg.label.startsWith("oracle") ? "Oracle: reflection about |bad⟩ (the marked amplitudes flip sign)." : stg.label.startsWith("diffusion") ? "Diffusion: reflection about the |s⟩ mirror." : "Start: uniform superposition |s⟩, at angle θ."}</p>`,
      `<dl class="kv"><dt>Angle, simulated</dt><dd>${deg(pr.angle)}</dd><dt>Angle, analytical</dt><dd>${deg(ref)}</dd><dt>P(good), simulated</dt><dd>${(pr.good * pr.good).toFixed(6)}</dd><dt>sin² (analytical)</dt><dd>${(Math.sin(ref) ** 2).toFixed(6)}</dd><dt>Norm outside the plane</dt><dd>${pr.outOfPlane.toExponential(1)}</dd></dl>`,
      `<p class="note">One iteration = two reflections = a rotation by 2θ = ${deg(2 * th.theta)}. Past 90° the vector moves away from |good⟩ again (over-rotation). Global phase is unobservable, so the vector's sign is taken nearest the analytical direction.</p>`];
    return `<div class="figure" id="g-geom"><div class="fh"><h3>Geometry of amplitude amplification</h3><span class="sub">thick vector: the simulated state at the step-through position, projected onto the |bad⟩–|good⟩ plane ${bx.prov("emulated")} · dots: analytical angles ${bx.prov("analytical")}</span>
      <span style="margin-left:auto"><button class="btn sm" id="g-anim">${G.anim ? "Pause" : "Animate the iterations"}</button></span></div>
      <div class="geo-row"><svg viewBox="0 0 400 400" role="img" aria-label="Grover rotation, simulated state vs analytical angles">${out.join("")}</svg><div class="geo-txt">${txt.join("")}</div></div></div>`;
  }
  function renderGroverRight() {
    const th = gTheory(), res = G.res, r = G.r ?? (th ? th.rStar : 0), mk = gMarked(), N = 2 ** G.n, ab = res ? res.main.statsAbstract : null, cp = res ? res.main.statsCompiled : null;
    R.innerHTML = `<div class="sec"><span class="micro">Problem</span><dl class="kv"><dt>Search space N</dt><dd>${N}</dd><dt>Marked M</dt><dd>${mk.length}</dd><dt>Iterations r</dt><dd>${r}</dd><dt>Oracle queries</dt><dd>${r}</dd></dl></div>
      <div class="sec"><span class="micro">Analytical ${bx.prov("analytical")}</span><dl class="kv"><dt>θ = arcsin √(M/N)</dt><dd>${th ? th.theta.toFixed(5) : "–"}</dd><dt>r* = ⌊π/(4θ)⌋</dt><dd>${th ? th.rStar : "–"}</dd><dt>P(r) ideal</dt><dd>${th ? pct(th.P(r), 3) : "–"}</dd><dt>Classical, random order: E[queries]</dt><dd>${th ? ((N + 1) / (mk.length + 1)).toFixed(2) : "–"}</dd></dl>
        <p class="note">Query counts compare oracle calls only. They say nothing about wall-clock time: on real hardware each query costs the oracle circuit's depth, error correction and repetitions.</p></div>
      <div class="sec"><span class="micro">Simulated ${bx.prov("emulated")}</span><dl class="kv"><dt>P(marked), circuit</dt><dd>${res ? pct(res.main.stages[res.main.stages.length - 1].pMarked, 3) : "–"}</dd>${res && res.noisy ? `<dt>P(marked), noisy</dt><dd>${pct(res.noisy.pMarked, 3)}</dd><dt>Purity Tr ρ²</dt><dd>${res.noisy.purity.toFixed(4)}</dd>` : ""}
        <dt>Sampled success</dt><dd>${G.counts ? `${pct(mk.reduce((a, m) => a + (G.counts.get(basisLabel(m, G.n)) || 0), 0) / G.shots, 2)} of ${int(G.shots)}` : "–"}</dd><dt>Simulator runtime</dt><dd>${res ? `${res.main.ms.toFixed(1)} ms ${bx.prov("measured")}` : "–"}</dd></dl></div>
      <div class="sec"><span class="micro">Resources of this circuit</span><dl class="kv"><dt>Logical qubits</dt><dd>${G.n}</dd><dt>Ancilla qubits</dt><dd>0 (parity-network MCZ)</dd>
        <dt>Abstract: depth · gates</dt><dd>${ab ? `${ab.depth} · ${ab.gates}` : "–"}</dd><dt>Abstract: MCZ gates</dt><dd>${ab ? ab.counts.mcz || 0 : "–"}</dd>
        <dt>Compiled: depth</dt><dd>${cp ? int(cp.depth) : "–"}</dd><dt>Compiled: CX</dt><dd>${cp ? int(cp.counts.cx || 0) : "–"}</dd><dt>Compiled: P</dt><dd>${cp ? int(cp.counts.p || 0) : "–"}</dd><dt>Compiled: 1-qubit H/X</dt><dd>${cp ? int((cp.counts.h || 0) + (cp.counts.x || 0)) : "–"}</dd></dl>
        <p class="note">The CX + P decomposition is exact but unoptimised (its size grows as n·2ⁿ); this is why even weak two-qubit noise destroys the amplification here. Transpilation to a device, error correction and physical-qubit estimates are in the Evidence &amp; Resource Lab.</p>
        <dl class="kv"><dt>Quantum hardware</dt><dd>${bx.prov("unavailable")} not connected</dd></dl></div>
      <div class="sec"><span class="micro">Export</span><div class="row"><button class="btn sm" id="g-qasm" ${res ? "" : "disabled"}>OpenQASM 2 (compiled)</button><button class="btn sm" id="g-json" ${res ? "" : "disabled"}>Circuit JSON</button><button class="btn sm" id="g-csv" ${res ? "" : "disabled"}>Sweep CSV</button></div>
        ${G.record ? `<div class="m-ok">Recorded <button class="btn sm" data-rec="${G.record.id}" style="height:20px">${esc(G.record.id)}</button></div>` : ""}</div>`;
  }

  // ================================================================== events
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button, rect.cell, [data-op], [data-key]"); if (!b) return;
    if (b.dataset.rec) { bx.openRecord(b.dataset.rec); return; }
    if (b.dataset.open) { const set = b.dataset.open.split("-").map(Number); bx.openScenario({ grid: G.toy.grid, set, label: `Toy-grid candidate {${set.join(", ")}}` }); return; }
    if (b.dataset.viz) { st.viz = b.dataset.viz; renderCenterOnly(); return; }
    if (b.dataset.gviz) { G.viz = b.dataset.gviz; renderCenterOnly(); return; }
    if (b.id === "g-anim") { animGrover(); return; }
    if (b.dataset.gate) { st.brush = b.dataset.gate; st.pending = null; renderLeftAndCenter(); return; }
    if (b.dataset.cell) { const [c, q] = b.dataset.cell.split(",").map(Number); st.cursor = { col: c, q }; place(c, q); return; }
    if (b.dataset.op != null && st.mode === "composer") { st.sel = +b.dataset.op; renderAll(); return; }
    if (b.dataset.key != null && st.mode === "composer") { st.basis = +b.dataset.key; if (st.viz !== "insp") st.viz = "insp"; renderCenterOnly(); return; }
    const id = b.id;
    if (id === "q-nm") setQubits(st.n - 1); else if (id === "q-np") setQubits(st.n + 1);
    else if (id === "q-undo") { undo(); renderAll(); } else if (id === "q-redo") { redo(); renderAll(); }
    else if (id === "q-clear") { commit([]); renderAll(); } else if (id === "q-del") remove(st.sel);
    else if (id === "q-measall") { const col = Math.max(0, ...st.ops.map((o) => (o.col ?? 0) + 1)); commit([...st.ops.filter((o) => o.g !== "measure"), ...Array.from({ length: st.n }, (_, q) => ({ g: "measure", q: [q], col }))]); renderAll(); }
    else if (id === "q-run") runAndRecord();
    else if (id === "q-qasm") bx.exportText({ title: "OpenQASM 2.0", text: toQasm2(C()), filename: "blacksky_circuit.qasm", note: "Loads in Qiskit with qiskit.qasm2.loads(); multi-controlled gates are written as their CX/u1 decomposition." });
    else if (id === "q-json") bx.exportText({ title: "Circuit JSON (bsx.circuit/1)", text: JSON.stringify(toJSON(C()), null, 2), filename: "blacksky_circuit.json", mime: "application/json" });
    else if (id === "q-csv") { const p = st.noisySim ? st.noisySim.probs : st.sim.probs; bx.exportText({ title: "Results CSV", text: ["basis_state,index,exact_probability,amplitude_re,amplitude_im,sampled_count", ...Array.from(p, (v, i) => `${basisLabel(i, st.n)},${i},${v},${st.noisySim ? "" : st.sim.state.re[i]},${st.noisySim ? "" : st.sim.state.im[i]},${st.counts ? st.counts.get(basisLabel(i, st.n)) || 0 : ""}`)].join("\n") + "\n", filename: "blacksky_circuit_results.csv", mime: "text/csv", note: `seed ${st.seed}, ${st.shots} shots${st.noisy ? `, noise λ1=${st.noise.p1} λ2=${st.noise.p2} readout=${st.noise.readout} (synthetic)` : ""}` }); }
    else if (id === "q-transpile") transpile();
    else if (id === "g-run") runGrover(); else if (id === "g-cancel") G.job && G.job.cancel();
    else if (id === "g-rand") { const N = 2 ** G.n, m = makeRng(G.seed).int(N); G.markedTxt = basisLabel(m, G.n); G.toy = null; G.res = null; renderAll(); }
    else if (id === "g-toy") toyGrid(); else if (id === "g-toy-x") { G.toy = null; renderAll(); }
    else if (id === "g-qasm" && G.res) { const mk = gMarked(); bx.exportText({ title: "OpenQASM 2.0 (Grover, compiled)", text: toQasm2(groverCircuit({ n: G.n, marked: mk, r: G.r ?? gTheory().rStar })), filename: `grover_n${G.n}.qasm` }); }
    else if (id === "g-json" && G.res) bx.exportText({ title: "Grover circuit JSON", text: JSON.stringify(toJSON(G.res.main.circuit), null, 2), filename: `grover_n${G.n}.json`, mime: "application/json" });
    else if (id === "g-csv" && G.res) bx.exportText({ title: "Grover sweep CSV", text: ["r,p_marked_simulated,p_marked_theory", ...G.res.sweep.map((x) => `${x.r},${x.pMarked},${x.theory}`)].join("\n") + "\n", filename: `grover_n${G.n}_sweep.csv`, mime: "text/csv" });
  });
  root.addEventListener("input", (e) => {
    const t = e.target, id = t.id;
    if (id === "q-step") { st.step = +t.value; renderCenterOnly(); }
    else if (id === "g-stage") { G.stage = +t.value; renderCenterOnly(); }
    else if (id === "g-r") { G.r = +t.value; G.res = G.res && G.res.main && G.res; renderAll(); }
    else if (t.dataset.par != null) { try { const v = parseAngle(t.value); const ops = st.ops.map((o, i) => (i === st.sel ? { ...o, p: o.p.map((x, j) => (j === +t.dataset.par ? v : x)) } : o)); const sel = st.sel; commit(ops); st.sel = sel; t.classList.remove("bad"); renderCenterOnly(); renderComposerRight(); const help = t.parentElement.querySelector(".help"); if (help) help.textContent = `= ${v.toFixed(6)} rad`; } catch (err) { t.classList.add("bad"); } }
  });
  root.addEventListener("change", (e) => {
    const t = e.target, id = t.id, num = (v, d) => (Number.isFinite(+v) ? +v : d);
    if (id === "q-tpl" && t.value) { const T = TEMPLATES[t.value]; commit(layoutColumns(T.ops.map((o) => ({ ...o })), T.n), T.n); renderAll(); }
    else if (id === "q-shots") { st.shots = Math.round(num(t.value, 1024)); st.counts = null; renderAll(); } else if (id === "q-seed") { st.seed = Math.round(num(t.value, 7)); st.counts = null; renderAll(); }
    else if (id === "q-noisy") { st.noisy = t.checked; recompute(); renderAll(); }
    else if (["q-p1", "q-p2", "q-ro"].includes(id)) { st.noise = { ...st.noise, [id === "q-p1" ? "p1" : id === "q-p2" ? "p2" : "readout"]: Math.min(0.5, Math.max(0, num(t.value, 0))) }; recompute(); renderAll(); }
    else if (id === "g-n") { G.n = Math.max(GROVER_LIMITS.minQubits, Math.min(GROVER_LIMITS.maxQubits, Math.round(num(t.value, 4)))); G.markedTxt = basisLabel((2 ** G.n) - 1 - 2, G.n); G.r = null; G.res = null; G.toy = null; renderAll(); }
    else if (id === "g-mk") { G.markedTxt = t.value; G.r = null; G.res = null; G.toy = null; renderAll(); }
    else if (id === "g-shots") { G.shots = Math.round(num(t.value, 1024)); renderAll(); } else if (id === "g-seed") { G.seed = Math.round(num(t.value, 11)); renderAll(); }
    else if (id === "g-noisy") { G.noisy = t.checked; G.res = null; renderAll(); }
    else if (["g-p1", "g-p2", "g-ro"].includes(id)) { G.noiseP = { ...G.noiseP, [id === "g-p1" ? "p1" : id === "g-p2" ? "p2" : "readout"]: Math.min(0.5, Math.max(0, num(t.value, 0))) }; G.res = null; renderAll(); }
  });
  root.addEventListener("keydown", (e) => {
    if (e.target.id === "q-basis" && e.key === "Enter") { const v = e.target.value.trim(); const i = /^[01]+$/.test(v) && v.length === st.n ? parseInt(v, 2) : +v; if (Number.isInteger(i) && i >= 0 && i < 1 << st.n) { st.basis = i; renderCenterOnly(); } else toast(`Enter a ${st.n}-bit string or an index 0–${(1 << st.n) - 1}`); return; }
    if (e.target.id !== "qc-svg") return; const k = e.key, cols = Math.max(10, ...st.ops.map((o) => (o.col ?? 0) + 1)) + 2;
    if ((e.ctrlKey || e.metaKey) && (k === "z" || k === "Z")) { e.preventDefault(); e.shiftKey ? redo() : undo(); renderAll(); refocus(); return; }
    if ((e.ctrlKey || e.metaKey) && (k === "y" || k === "Y")) { e.preventDefault(); redo(); renderAll(); refocus(); return; }
    const mv = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[k];
    if (mv) { e.preventDefault(); st.cursor = { col: Math.max(0, Math.min(cols - 1, st.cursor.col + mv[0])), q: Math.max(0, Math.min(st.n - 1, st.cursor.q + mv[1])) }; renderCenterOnly(); refocus(); return; }
    if (k === "Enter" || k === " ") { e.preventDefault(); place(st.cursor.col, st.cursor.q); refocus(); return; }
    if (k === "Delete" || k === "Backspace") { e.preventDefault(); remove(st.sel); refocus(); return; }
    const hot = { h: "h", x: "x", y: "y", z: "z", s: "s", t: "t", m: "measure", c: "cx", b: "barrier" }[k.toLowerCase()]; if (hot) { st.brush = hot; st.pending = null; renderLeftAndCenter(); refocus(); }
  });
  const refocus = () => { const s2 = $("qc-svg"); if (s2) s2.focus(); };
  // drag-and-drop from the palette onto a cell
  root.addEventListener("dragstart", (e) => { const b = e.target.closest && e.target.closest("[data-gate]"); if (b) { e.dataTransfer.setData("text/plain", b.dataset.gate); e.dataTransfer.effectAllowed = "copy"; } });
  root.addEventListener("dragover", (e) => { const c = e.target.closest && e.target.closest("rect.cell"); if (c) { e.preventDefault(); root.querySelectorAll("rect.cell.drop").forEach((x) => x.classList.remove("drop")); c.classList.add("drop"); } });
  root.addEventListener("drop", (e) => { const c = e.target.closest && e.target.closest("rect.cell"); if (!c) return; e.preventDefault(); const g = e.dataTransfer.getData("text/plain"); if (!GATES[g]) return; st.brush = g; const [col, q] = c.dataset.cell.split(",").map(Number); st.pending = null; place(col, q); });

  async function transpile() {
    const c = C(); try { const res = await bsapiPost("quantum/transpile", { n: c.n, ops: orderedOps(c.ops, c.n).map((o) => ({ g: o.g, q: o.q, c: o.c || [], p: o.p || [] })), optimization_level: 1 }); st.transp = { key: JSON.stringify(c.ops) + c.n, res }; renderComposerRight(); }
    catch (e) { toast(String(e.message || e)); }
  }

  // ================================================================== render plumbing
  function renderCenterOnly() { const sc = Cn.scrollTop, qs = $("qc-wrap")?.scrollLeft || 0; st.mode === "composer" ? renderComposerCenter() : renderGroverCenter(); Cn.scrollTop = sc; if ($("qc-wrap")) $("qc-wrap").scrollLeft = qs; }
  function renderLeftAndCenter() { const sc = L.scrollTop; st.mode === "composer" ? renderComposerLeft() : renderGroverLeft(); L.scrollTop = sc; renderCenterOnly(); }
  function renderAll() {
    $("q-left-h").textContent = st.mode === "composer" ? "Circuit composer" : "Grover search";
    const a = document.activeElement && root.contains(document.activeElement) ? document.activeElement.id : null, sl = L.scrollTop;
    if (st.mode === "composer") { renderComposerLeft(); renderComposerCenter(); renderComposerRight(); } else { renderGroverLeft(); renderGroverCenter(); renderGroverRight(); }
    L.scrollTop = sl; if (a && $(a)) { $(a).focus(); }
  }
  G.noiseP = { p1: 0.001, p2: 0.01, readout: 0.02 };
  recompute(); renderAll();
  bx.rerunHooks["quantum.circuit"] = async (rec) => { const c = rec.config; bx.setWorkspace("quantum"); bx.quantum.setMode("composer"); st.n = c.circuit.n; st.ops = layoutColumns(c.circuit.ops.map((o) => ({ ...o })), c.circuit.n); st.shots = c.shots; st.seed = c.seed;
    st.noisy = !!c.noise; if (c.noise) st.noise = { p1: c.noise.p1, p2: c.noise.p2, readout: c.noise.readout }; recompute(); st.parent = rec.id; runAndRecord(); st.parent = null; return st.record; };
  bx.rerunHooks["quantum.grover"] = async (rec) => { const c = rec.config; bx.setWorkspace("quantum"); bx.quantum.setMode("grover"); G.n = c.n; G.markedTxt = c.marked.map((m) => basisLabel(m, c.n)).join(", "); G.r = c.r; G.shots = c.shots; G.seed = c.seed; G.noisy = !!c.noise;
    if (c.noise) G.noiseP = { p1: c.noise.p1, p2: c.noise.p2, readout: c.noise.readout }; G.parent = rec.id; await runGrover(); G.parent = null; return G.record; };
  store.sub((s, ch) => { if (ch.has("bsapi") && st.mode === "composer") renderComposerRight(); });
  bx.quantum = { state: st, parseAngle, renderAll, setMode: (m) => { st.mode = m; root.querySelectorAll("[data-mode]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.mode === m))); renderAll(); }, runGrover, toyGrid };
}
