// APEX 1 · Arrival. The first thing a visitor sees: the project's headline fact, read live from the run the Theater has just computed
// (the worst set of the exhaustive table on the default network). One cell per demand point; its brightness is the share of that point's
// demand still served, round by round, so the darkening is the engine's own output. Shown on a plain landing (no #route) until dismissed
// once in this browser; deep links never see it. Reduced motion: no count-up, cells show the final state.
import { $, esc, int, storage, GRID_NAME } from "../util.js";

const KEY = "blacksky.arrival.v1";
const seen = () => { try { return storage.get(KEY) === "seen"; } catch { return false; } };
const markSeen = () => { try { storage.set(KEY, "seen"); } catch { /* storage unavailable: show again next time */ } };

export function initArrival(bx) {
  const el = $("arrival"); if (!el) return;
  let timers = [];
  const clear = () => { timers.forEach((t) => clearTimeout(t)); timers = []; };

  function content(run, net) {
    const m = net.model, sum = run.summary, k = run.k, R = run.rank;
    const loads = m.loads.map((ld) => ({ bus: ld.bus, mw: ld.demand_mw })).filter((x) => x.mw > 0);
    const rankTxt = R && R.exact && R.rank === 1 ? `the most damaging of ${int(R.N)} possible ${k}-line combinations${run.ties > 1 ? ` (tied with ${run.ties - 1} other${run.ties > 2 ? "s" : ""})` : ""}, found by exhaustive search`
      : R && R.exact ? `rank ${int(R.rank)} of ${int(R.N)} ${k}-line combinations in the exhaustive table` : "under the DC cascade model";
    const cells = loads.map((x, i) => `<i data-c="${i}" title="Bus ${m.buses[x.bus].id} · ${x.mw.toFixed(0)} MW"></i>`).join("");
    el.innerHTML = `<div class="ar-in" role="document">
      <div class="ar-kicker"><span class="lit-mark" aria-hidden="true"><i></i><i></i><i class="off"></i><i></i></span>BLACKSKY Command · ${esc(GRID_NAME[run.grid] || "")} · DC cascade model, synthetic ratings</div>
      <div class="ar-num" aria-live="off"><span id="ar-s">${(100 * sum.S).toFixed(1)}</span><small>%</small></div>
      <p class="ar-lede">of the demand on the IEEE ${esc(String(m.nBus))}-bus test network is left unserved when just <b>${k} of its ${m.nBranch} transmission lines</b> are removed — ${rankTxt}.</p>
      <div class="ar-stats"><div><b>${int(sum.trips)}</b><span>lines trip in the cascade that follows</span></div><div><b>${sum.rounds}</b><span>rounds of overload trips</span></div><div><b>${sum.deEnergisedFinal ?? "–"}</b><span>buses left without power</span></div></div>
      <div class="ar-cells" aria-label="One cell per demand point; brightness is the share of its demand still served">${cells}</div>
      <div class="ar-cap"><span id="ar-round">before the outage</span><span>one cell per demand point · brightness = share of its demand still served</span>${bx.prov("simulator")}</div>
      <div class="ar-acts"><button class="btn primary ar-go" id="ar-watch">Watch the cascade</button>${bx.briefing ? `<button class="btn" id="ar-brief">Brief me (2 min)</button>` : ""}<button class="btn ghost" id="ar-enter">Enter the command</button></div>
      <p class="ar-foot">IEEE test case (MATPOWER), not a real grid. Line ratings are synthetic; the ranking is a property of this model. Lines: {${run.result.outage.join(", ")}}.</p>
    </div>`;
    return loads;
  }

  function animate(run, loads) {
    const F = run.result.frames, cells = [...el.querySelectorAll(".ar-cells i")], reduced = bx.store.get().reduced;
    const paint = (fi) => { const f = F[fi]; cells.forEach((c, i) => { const v = f && f.factor ? f.factor[loads[i].bus] : 1; c.style.setProperty("--v", Math.max(0, Math.min(1, v)).toFixed(3)); }); };
    const sEl = $("ar-s"), roundEl = $("ar-round"), S = run.summary.S;
    if (reduced) { paint(F.length - 1); roundEl.textContent = `after round ${F.length}`; return; }
    cells.forEach((c) => c.style.setProperty("--v", "1")); sEl.textContent = "0.0";
    const t0 = 500, per = Math.max(260, Math.min(520, 2600 / Math.max(F.length, 1)));
    F.forEach((f, i) => timers.push(setTimeout(() => { paint(i); roundEl.textContent = `round ${i + 1} of ${F.length}`; sEl.textContent = (100 * (1 - f.load_served)).toFixed(1); }, t0 + i * per)));
    timers.push(setTimeout(() => { sEl.textContent = (100 * S).toFixed(1); }, t0 + F.length * per));
  }

  function show() {
    const s = bx.store.get(), run = bx.runOnNet(); if (!run || !s.net) return false;
    const loads = content(run, s.net); el.hidden = false; document.body.classList.add("arrival-on");
    $("ar-watch").onclick = () => { close(); bx.setWorkspace("theater"); bx.replay(); };
    $("ar-enter").onclick = () => close();
    if ($("ar-brief")) $("ar-brief").onclick = () => { close(); bx.briefing.start(); };
    $("ar-watch").focus({ preventScroll: true }); animate(run, loads); return true;
  }
  function close() { clear(); el.hidden = true; document.body.classList.remove("arrival-on"); markSeen(); }
  el.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  bx.arrival = { show, close, seen };
  document.querySelector(".bar .mark").addEventListener("click", (e) => { if (bx.runOnNet() && bx.store.get().ws === "theater") { e.preventDefault(); show(); } });
  if (!location.hash && !seen()) show();
}
