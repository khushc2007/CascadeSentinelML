// APEX 8 · Briefing: a guided walk through the five workspaces that drives the real interface (no slides, no recorded video). Every
// number in a step is read from the current state when the step opens; a step whose computation has not been run says so and offers the
// button that runs it, instead of showing a number. Esc or Close ends it; ← → move between steps.
import { $, esc, pc, int, GRID_NAME } from "../util.js";
import { faultCounts } from "../sci/overlays.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) { const t0 = performance.now(); while (performance.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(80); } return null; }

export function initBriefing(bx) {
  const { store } = bx, card = $("brief"), ring = $("brief-ring"); let i = 0, target = null, token = 0;
  const run = () => bx.runOnNet();
  const ws = async (w) => { bx.setWorkspace(w); await bx.ensureWs(w); await wait(120); };

  const STEPS = [
    { title: "The headline", ws: "theater", target: "#readout", async go() { if (!run()) await bx.playFeatured(store.get().featured[0]?.id); bx.reset(); },
      text() { const r = run(); if (!r) return "No run is loaded."; const S = r.summary;
        return `${GRID_NAME[r.grid]} test network, DC cascade model. Removing lines {${r.result.outage.join(", ")}} leaves <b>${pc(S.S)}</b> of the demand unserved${r.rank && r.rank.exact ? ` — rank <b>#${r.rank.rank}</b> of ${int(r.rank.N)} ${r.k}-line sets in the exhaustive table` : ""}. The readout tracks the replay.`; } },
    { title: "Watch it propagate", ws: "theater", target: ".dock", async go() { bx.setLayer("overlay", "loading"); bx.replay(); },
      text() { const r = run(); if (!r) return ""; return `The replay steps through the engine's own rounds: each tripped line flashes and burns out, amber lines are overloaded, and lamps dim as demand is shed. <b>${int(r.summary.trips)}</b> lines trip over <b>${r.summary.rounds}</b> rounds.`; } },
    { title: "Where the power went", ws: "theater", target: "#stage", async go() { bx.pause(); bx.goEvent(store.get().run.events.length - 1, { frame: false }); bx.setLayer("overlay", "surge"); bx.overview(); },
      text() { return "Line colour now shows the flow each surviving line gained relative to the intact network, as a share of its rating: two DC flow solutions from the engine, subtracted. Bright lines took the load the lost lines carried."; } },
    { title: "The grid's fault lines", ws: "theater", target: "#stage", async go() { bx.goEvent(0, { frame: false }); bx.setLayer("overlay", "faults"); bx.overview(); },
      text() { const s = store.get(), k = s.net.dists[s.layers.faultK] ? s.layers.faultK : s.net.tableKs.at(-1), d = s.net.dists[k]; if (!d) return "No exhaustive table for this network.";
        const fc = faultCounts(d.top, s.net.model.nBranch), top = fc.counts.map((c, l) => [c, l]).sort((a, b) => b[0] - a[0]).slice(0, 3);
        return `How often each line appears in the ${fc.sets} most damaging ${k}-line sets of the exhaustive DC table. The hottest: ${top.map(([c, l]) => `line <b>${l}</b> (${c})`).join(", ")}. Under synthetic ratings, so a property of this model, not of a real grid.`; } },
    { title: "One set among a million", ws: "theater", target: "#au-body .sv", async go() { bx.setLayer("overlay", "loading"); bx.inspectorTab("run"); await wait(80); document.querySelector("#au-body .sv")?.scrollIntoView({ block: "center" }); },
      text() { const r = run(), d = r && store.get().net.dists[r.k]; if (!d) return ""; return `The stored histogram of S over all ${int(d.N)} ${r.k}-line sets: <b>${pc(d.n_zero / d.N)}</b> lose no demand at all. Severe cascades are a thin tail — which is why searching for them is the problem.`; } },
    { title: "Six searches, one landscape", ws: "arena", target: "#a-land-fig", fallback: "#a-run", async go() { const A = bx.arena?.state; if (A && A.exp !== "B") { A.exp = "B"; bx.arena.render(); } await wait(60); document.querySelector("#a-land-fig, #a-run")?.scrollIntoView({ block: "center" }); },
      text() { const A = bx.arena?.state; if (!A?.res) return "The Arena races exhaustive, random, genetic, annealing, loading-ranked and ML-guided search on the same budget. It has not been run in this session: press <b>Run comparison</b> (about half a minute, in the background) and this step will show the landscape of every pair and where each method looked.";
        const ex = A.res.runs.find((r) => r.method === "exhaustive" && r.best); return `Every pair of lines is one cell, coloured by S from the simulator. Press <b>Replay the search</b> to watch where each method looked.${ex ? ` The certified optimum is {${ex.best.set.join(", ")}} at ${pc(ex.best.S)}.` : ""}`; } },
    { title: "Can a model see it coming?", ws: "ml", target: "#m-land", fallback: "#m-train", async go() { const M = bx.ml?.state; if (M?.res && M.res.cfg.k === 2) { M.tab = "land"; bx.ml.render(); } await wait(60); document.querySelector("#m-land, #m-train")?.scrollIntoView({ block: "center" }); },
      text() { const M = bx.ml?.state; if (!M?.res) return "The ML Observatory trains on simulator labels and tests on lines it has never seen. Not trained in this session yet: press <b>Label, split and train</b> (about 10 s in the background).";
        const t = M.res.metrics.test; return `Below the diagonal: what the simulator says. Above: what the forest predicts for held-out pairs (labelled PRED, never treated as verified). Test ROC-AUC <b>${t.forest.auc != null ? t.forest.auc.toFixed(3) : "–"}</b>, R² <b>${t.regression.r2 != null ? t.regression.r2.toFixed(3) : "–"}</b> on ${int(t.n)} pairs.`; } },
    { title: "Grover, geometrically", ws: "quantum", target: "#g-geom", async go() { document.querySelector("[data-mode='grover']")?.click(); await wait(60); const Q = bx.quantum?.state?.g;
        if (Q && !Q.res) { document.getElementById("g-run")?.click(); await until(() => bx.quantum.state.g.res, 10000); } document.querySelector("[data-gviz='geom']")?.click(); await wait(80); if (!store.get().reduced) document.getElementById("g-anim")?.click(); },
      text() { const Q = bx.quantum?.state?.g, res = Q?.res; if (!res) return "Run Grover in the Quantum Lab to see this step.";
        const fin = res.main.stages.at(-1); return `Grover rotates the state toward the marked answer by a fixed angle per oracle query. The thick vector is the simulated circuit's state (classical emulation, ${2 ** Q.n} amplitudes); after r* = ${res.theory.rStar} queries P(marked) = <b>${pc(fin.pMarked)}</b>, exactly on the analytical circle.`; } },
    { title: "Fewer queries is not less time", ws: "evidence", target: "#e-center .m-q", async go() { const E = bx.evidence?.state; if (E) { E.tab = "resources"; bx.evidence.render(); } await wait(120); document.querySelector("#e-center .m-q")?.scrollIntoView({ block: "center" }); },
      text() { return "The project's fault-tolerant resource model: on the grid problem, Grover's query saving is overwhelmed by the cost of running the whole cascade reversibly inside every query. These are estimates under stated assumptions (EST), not measurements; no quantum hardware was used."; } },
    { title: "Every number has a record", ws: "evidence", target: "#e-left", async go() { const E = bx.evidence?.state; if (E) { E.tab = "registry"; bx.evidence.render(); } },
      text() { return `${int(bx.registry.list().length)} experiment records in this browser — configuration, seed, result class, timings and limitations for every run above, re-runnable and exportable. The Limits tab lists what this instrument does not show.`; } },
  ];

  function place() {
    if (card.hidden) return; const el = target && document.querySelector(target), r = el && el.getBoundingClientRect(); if (!r || (!r.width && !r.height)) { ring.hidden = true; return; }
    const p = 6; ring.hidden = false;
    Object.assign(ring.style, { left: `${r.left - p}px`, top: `${r.top - p}px`, width: `${r.width + 2 * p}px`, height: `${r.height + 2 * p}px` });
    // put the card where it covers the least of the highlighted element: bottom or top, centre or corners
    const cw = card.offsetWidth, ch = card.offsetHeight, W = innerWidth, H = innerHeight, m = 16, top = 64;
    const spots = [[(W - cw) / 2, H - ch - m], [(W - cw) / 2, top], [m, H - ch - m], [W - cw - m, H - ch - m], [m, top], [W - cw - m, top]];
    const ov = ([x, y]) => Math.max(0, Math.min(x + cw, r.right) - Math.max(x, r.left)) * Math.max(0, Math.min(y + ch, r.bottom) - Math.max(y, r.top));
    const best = spots.reduce((a, b) => (ov(b) < ov(a) - 1 ? b : a));
    Object.assign(card.style, { left: `${Math.max(m, best[0])}px`, top: `${Math.max(top, best[1])}px`, bottom: "auto", transform: "none" });
  }
  async function show(n) {
    i = Math.max(0, Math.min(STEPS.length - 1, n)); const s = STEPS[i], my = ++token;
    card.hidden = false; document.body.classList.add("brief-on"); ring.hidden = true;
    card.innerHTML = `<div class="br-h"><span class="micro">Briefing · ${i + 1} / ${STEPS.length}</span><button class="btn sm ghost" id="br-x" aria-label="Close the briefing">Close</button></div><h3>${esc(s.title)}</h3><p class="br-t">Preparing…</p>`;
    try { if (store.get().ws !== s.ws) await ws(s.ws); await s.go(); } catch (e) { console.warn("briefing step", e); }
    if (my !== token) return;
    await wait(150); target = document.querySelector(s.target) ? s.target : s.fallback || s.target;
    card.innerHTML = `<div class="br-h"><span class="micro">Briefing · ${i + 1} / ${STEPS.length}</span><button class="btn sm ghost" id="br-x" aria-label="Close the briefing">Close</button></div>
      <h3>${esc(s.title)}</h3><p class="br-t">${s.text()}</p>
      <div class="br-f"><div class="br-dots">${STEPS.map((_, j) => `<i class="${j === i ? "on" : j < i ? "done" : ""}"></i>`).join("")}</div><button class="btn sm" id="br-back" ${i ? "" : "disabled"}>Back</button><button class="btn sm primary" id="br-next">${i === STEPS.length - 1 ? "Finish" : "Next"}</button></div>`;
    $("br-next").focus({ preventScroll: true }); place();
  }
  function close() { token++; card.hidden = true; ring.hidden = true; document.body.classList.remove("brief-on"); }
  card.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; if (b.id === "br-x") close(); else if (b.id === "br-back") show(i - 1); else if (b.id === "br-next") (i === STEPS.length - 1 ? close() : show(i + 1)); });
  addEventListener("keydown", (e) => { if (card.hidden) return; if (e.key === "Escape") { e.stopPropagation(); close(); } else if (e.key === "ArrowRight" && !e.target.closest("input, select, textarea")) { e.preventDefault(); e.stopPropagation(); show(i + 1); } else if (e.key === "ArrowLeft" && !e.target.closest("input, select, textarea")) { e.preventDefault(); e.stopPropagation(); show(i - 1); } }, true);
  addEventListener("resize", place); addEventListener("scroll", place, true); setInterval(() => !card.hidden && place(), 500);
  bx.briefing = { start: () => show(0), show, close, get step() { return i; }, steps: STEPS.length };
}
