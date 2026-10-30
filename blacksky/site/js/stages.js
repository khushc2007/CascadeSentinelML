// Theater stages DETECT → TRACE → CASCADE → ISLAND → ASSESS, derived only from the recorded events and frames of a run. A stage that did not
// happen in this run is reported as "did not occur" rather than skipped silently. Pure; tested in blacksky/test/logic.test.mjs.
export const STAGE_IDS = ["detect", "trace", "cascade", "island", "assess"];
const pc = (x) => `${(100 * x).toFixed(1)}%`;

export function deriveStages(res, events, model, rank = null) {
  const fr = res.frames, f0 = fr[0], fe = fr[fr.length - 1], m = res.metrics, idx = (pred) => events.findIndex(pred), AC = res.mode === "ac", PF = AC ? "AC" : "DC";
  const br = (l) => `${l} (bus ${model.branches[l].fromId}–${model.branches[l].toId})`;
  const trips = events.filter((e) => e.type === "trip"), nTrips = trips.reduce((a, e) => a + e.entities.length, 0);
  const firstOver = events.find((e) => e.type === "overload");
  const liveEnd = events.filter((e) => e.type === "round").slice(-1)[0]?.values?.energisedIslands ?? null;
  const deadEnd = model.nBus - fe.energized_buses.length;
  // ISLAND = the separation the cascade causes; when nothing trips, the separation caused directly by the initial outage
  const firstTrip = events.findIndex((e) => e.type === "trip"), anyIsl = idx((e) => e.type === "islanding");
  const islandEv = firstTrip >= 0 ? (events.findIndex((e) => e.type === "islanding" && e.i > firstTrip) >= 0 ? events.findIndex((e) => e.type === "islanding" && e.i > firstTrip) : anyIsl) : anyIsl;
  const out = [];
  out.push({ id: "detect", title: "Detect", eventIndex: idx((e) => e.type === "initial_outage"), occurred: true,
    summary: `${res.outage.length} branch${res.outage.length > 1 ? "es" : ""} removed: ${res.outage.map(br).join(", ")}. The ${PF} power flow is re-solved on the remaining network.`,
    facts: { k: res.outage.length, overloadedRound1: f0.overloaded.length, servedRound1: f0.load_served } });
  if (firstOver) {
    const lv = firstOver.values.loading, peakL = Object.keys(lv).reduce((a, l) => (lv[l] > lv[a] ? l : a)), peak = lv[peakL];
    out.push({ id: "trace", title: "Trace", eventIndex: firstOver.i, occurred: true,
      summary: `Power redistributes: in round ${firstOver.round}, ${firstOver.entities.length} branch${firstOver.entities.length > 1 ? "es" : ""} exceed their rating. Peak: branch ${br(+peakL)} at ${pc(peak)} of its ${PF} rating.`,
      facts: { overloaded: firstOver.entities.length, peakBranch: +peakL, peakLoading: peak } });
  } else out.push({ id: "trace", title: "Trace", eventIndex: -1, occurred: false, summary: "No branch exceeded its rating after the initial outage, so nothing trips.", facts: {} });
  if (nTrips) out.push({ id: "cascade", title: "Cascade", eventIndex: trips[0].i, occurred: true,
    summary: `Overloaded branches trip and the flow is re-solved each round: ${nTrips} secondary trip${nTrips > 1 ? "s" : ""} over ${new Set(trips.map((t) => t.round)).size} round${trips.length > 1 ? "s" : ""} (largest round: ${Math.max(...trips.map((t) => t.entities.length))}).`,
    facts: { trips: nTrips, tripRounds: new Set(trips.map((t) => t.round)).size } });
  else out.push({ id: "cascade", title: "Cascade", eventIndex: -1, occurred: false, summary: "No secondary trips: the network absorbed the outage.", facts: { trips: 0 } });
  if (islandEv >= 0 || deadEnd > 0) out.push({ id: "island", title: "Island", eventIndex: islandEv >= 0 ? islandEv : idx((e) => e.type === "termination"), occurred: true,
    summary: `The network separates. At the end: ${liveEnd != null ? `${liveEnd} energised island${liveEnd > 1 ? "s" : ""}` : `${fe.islands} connected component${fe.islands > 1 ? "s" : ""} (per-island energisation not recorded for this result)`}${deadEnd ? ` and ${deadEnd} bus${deadEnd > 1 ? "es" : ""} with no generation (de-energised)` : ""}. Each island balances generation and demand on its own; shortfalls are shed.`,
    facts: { energisedIslands: liveEnd, deadBuses: deadEnd } });
  else out.push({ id: "island", title: "Island", eventIndex: -1, occurred: false, summary: "The network stayed connected.", facts: { deadBuses: 0 } });
  out.push({ id: "assess", title: "Assess", eventIndex: idx((e) => e.type === "termination"), occurred: true,
    summary: `${m.status}: ${pc(m.S)}${AC && m.S_total != null && Math.abs(m.S_total - m.S) > 1e-9 ? `–${pc(m.S_total)}` : ""} of base demand unserved at termination (S₀ = ${pc(m.S0)} from the initial islanding, C = ${pc(m.C)} added by the cascade), after ${m.rounds} round${m.rounds > 1 ? "s" : ""}.${rank && !rank.zero ? ` Rank ${rank.exact ? "#" : "≈ #"}${rank.rank.toLocaleString("en-US")} of ${rank.N.toLocaleString("en-US")} in the exhaustive DC table.` : ""}`,
    facts: { S: m.S, S0: m.S0, C: m.C, rounds: m.rounds, status: m.status } });
  return out;
}

// stage that event i belongs to: the occurred stage with the latest first event at or before i (later stage wins a tie)
export function stageAt(stages, i) {
  let cur = stages[0]; for (const s of stages) if (s.occurred && s.eventIndex >= 0 && s.eventIndex <= i && s.eventIndex >= cur.eventIndex) cur = s; return cur;
}
