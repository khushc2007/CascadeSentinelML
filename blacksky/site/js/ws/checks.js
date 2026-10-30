// Live validation checks for the Evidence & Resource Lab. Each check runs in the viewer's browser against the deployed code and data and
// reports exactly what it compared. Light enough for the main thread (well under a second in total on a laptop).
import { getJSON } from "../engine.js";
import { DCCascade, components } from "../../shared/core/cascade.js";
import { buildModel } from "../../shared/core/model.js";
import { rankOf } from "../../shared/core/scenario.js";
import { prepareNetwork, postOutageFlows } from "../sci/features.js";
import { disjointBranchSplit, branchOverlap } from "../sci/ml.js";
import { binom } from "../sci/combin.js";
import { validateRecord, configHash } from "../sci/contracts.js";
import { recordCSV } from "../sci/registry.js";
import { runSearch } from "../sci/search.js";
import { simulate, layoutColumns, mcPhaseDecomposition } from "../q/circuit.js";
import { StateVector } from "../q/sim.js";
import { oracleOps, runGroverCircuit, groverTheory } from "../q/grover.js";
import { makeRng } from "../sci/rng.js";

export async function runChecks(bx) {
  const out = [], check = async (id, name, covers, fn) => { const t0 = performance.now(); let status = "passed", detail = "";
    try { const r = await fn(); if (r === false || (r && r.ok === false)) { status = "failed"; detail = (r && r.detail) || "check returned false"; } else detail = (r && r.detail) || String(r ?? ""); }
    catch (e) { status = "failed"; detail = `error: ${e.message || e}`; }
    out.push({ id, name, covers, status, detail, ms: performance.now() - t0 }); };
  const nets = {}; for (const g of ["ieee14", "ieee30", "ieee118"]) { const [cm, grid] = await Promise.all([getJSON(`cascade_model_${g}.json`), getJSON(`grid_${g}.json`)]); nets[g] = { cm, grid, engine: new DCCascade(cm) }; }

  await check("topology", "Network topology", "network topology validation", () => {
    const d = []; for (const [g, n] of Object.entries(nets)) { const m = buildModel(n.grid, n.cm), c = components(n.cm.n_bus, n.cm.br_from, n.cm.br_to, n.cm.br_status);
      if (c.n !== 1) return { ok: false, detail: `${g}: base case has ${c.n} components` }; if (m.branches.some((b) => b.from === b.to)) return { ok: false, detail: `${g}: self-loop` };
      d.push(`${g}: ${m.nBus} buses, ${m.nBranch} branches, connected`); } return { detail: d.join("; ") }; });
  await check("toy3bus", "Hand-calculated 3-bus DC case", "hand-calculated toy case, power-flow solution", () => {
    // bus 0: 100 MW generation (slack); bus 2: 100 MW demand; three lines with equal x: flow 0→2 direct = 2/3·100, via bus 1 = 1/3·100
    const cm = { grid: "toy3", n_bus: 3, n_branch: 3, base_mva: 100, bus_id: [1, 2, 3], Pd: [0, 0, 100], br_from: [0, 0, 1], br_to: [2, 1, 2], x: [0.1, 0.1, 0.1], br_status: [1, 1, 1], rating_dc: [80, 80, 80],
      gen_bus: [0], gen_status: [1], gen_Pmax: [200], gen_Pmin: [0], pg0: [100], key_rank: [0, 1, 2], initial_load_mw: 100, cascade: { trip_factor: 1, trip_policy: "all_overloaded", max_rounds: 30, redispatch: "up_and_down", overload_tol: 1e-9, fixed_point_bits: null }, severity: { tau: 0.2, delta: 0.1 } };
    const fo = new DCCascade(cm).run([], {}).frames[0].flow, f = [0, 1, 2].map((l) => fo[l]), ok = Math.abs(f[0] - 200 / 3) < 1e-9 && Math.abs(f[1] - 100 / 3) < 1e-9 && Math.abs(f[2] - 100 / 3) < 1e-9;
    const r = new DCCascade(cm).run([1], {}); const ok2 = Math.abs(r.frames[0].flow[0] - 100) < 1e-9 && r.frames[0].overloaded.includes(0) && r.trips_per_round[0].includes(0) && r.metrics.status === "TOTAL_LOSS" && Math.abs(r.metrics.S - 1) < 1e-12;
    return ok && ok2 ? { detail: `flows ${f.map((v) => v.toFixed(4)).join(", ")} MW = 66.667, 33.333, 33.333 by hand; after removing line 2 the direct line carries 100 MW > 80 MW, trips in round 1 and leaves the load bus without generation (S = 100 %, TOTAL_LOSS), as worked out by hand` } : { ok: false, detail: `flows ${f.join(", ")}` }; });
  await check("ptdf", "Base-case DC flows: PTDF vs engine", "power-flow consistency", () => {
    let worst = 0; for (const n of Object.values(nets)) { const P = prepareNetwork(n.cm, n.grid), f = n.engine.run([], {}).frames[0].flow; for (let l = 0; l < n.cm.n_branch; l++) if (n.cm.br_status[l]) worst = Math.max(worst, Math.abs(P.f0[l] - f[l])); }
    return worst < 1e-6 ? { detail: `max |difference| ${worst.toExponential(2)} MW over all branches of the three networks` } : { ok: false, detail: `max difference ${worst} MW` }; });
  await check("glodf", "Post-outage flows: GLODF vs engine round 1", "simulation consistency", () => {
    const n = nets.ieee118, P = prepareNetwork(n.cm, n.grid), rng = makeRng(23); let worst = 0, cnt = 0;
    for (let t = 0; t < 25; t++) { const s = new Set(); while (s.size < 2) s.add(rng.int(186)); const O = [...s]; const post = postOutageFlows(P, O); if (!post) continue; const f = n.engine.run(O, { maxRounds: 1 }).frames[0].flow; cnt++;
      for (let l = 0; l < 186; l++) if (n.cm.br_status[l] && !O.includes(l)) worst = Math.max(worst, Math.abs(post[l] - f[l])); }
    return worst < 1e-6 ? { detail: `${cnt} non-islanding pairs on IEEE-118, max |difference| ${worst.toExponential(2)} MW` } : { ok: false, detail: `max difference ${worst} MW` }; });
  await check("known118", "Known result: IEEE-118 worst triple", "known-result test, candidate scoring", async () => {
    const d = await getJSON("dist_ieee118_k3.json"), top = await getJSON("top_cascades_ieee118_k3.json"), [S, set] = d.top[0], r = nets.ieee118.engine.run(set, { policy: "all_overloaded" }), rk = rankOf(d, r.metrics.S);
    const ok = Math.abs(r.metrics.S - S) < 1e-12 && Math.abs(top[0].dc.metrics.S - S) < 1e-12 && rk.rank === 1 && rk.exact && d.N === binom(186, 3);
    return ok ? { detail: `{${set.join(", ")}}: S = ${(100 * S).toFixed(4)} % in this browser = stored Python run = table; rank #1 of ${d.N.toLocaleString("en-US")} = C(186, 3)` } : { ok: false, detail: `browser ${r.metrics.S} vs table ${S}, rank ${rk.rank}` }; });
  await check("dcac", "DC vs AC comparison available", "DC-versus-AC comparison", async () => {
    const top = await getJSON("top_cascades_ieee30_k3.json"), x = top[0]; if (!x.ac) return { ok: false, detail: "no stored AC run" };
    return { detail: `IEEE-30 {${x.dc.outage.join(", ")}}: DC S = ${(100 * x.dc.metrics.S).toFixed(2)} %, stored AC S = ${(100 * x.ac.metrics.S).toFixed(2)} %${x.ac.metrics.S_total != null ? ` … ${(100 * x.ac.metrics.S_total).toFixed(2)} %` : ""} (models differ; AC is never ranked against DC)` }; });
  await check("bell", "Quantum circuits: Bell, interference, rotation", "quantum circuit correctness", () => {
    const b = simulate({ n: 2, ops: layoutColumns([{ g: "h", q: [0] }, { g: "cx", c: [0], q: [1] }], 2) }), i = simulate({ n: 1, ops: layoutColumns([{ g: "h", q: [0] }, { g: "z", q: [0] }, { g: "h", q: [0] }], 1) });
    const r = simulate({ n: 1, ops: layoutColumns([{ g: "ry", q: [0], p: [Math.PI / 3] }], 1) });
    const ok = Math.abs(b.probs[0] - 0.5) < 1e-12 && Math.abs(b.probs[3] - 0.5) < 1e-12 && Math.abs(i.probs[1] - 1) < 1e-12 && Math.abs(r.probs[1] - Math.sin(Math.PI / 6) ** 2) < 1e-12 && b.bloch.every((x) => x.r < 1e-12);
    return ok ? { detail: "Bell: P(00) = P(11) = 0.5 and reduced Bloch vectors of length 0; H·Z·H|0⟩ = |1⟩; Ry(π/3): P(1) = sin²(π/6)" } : false; });
  await check("mcz", "Multi-controlled Z decomposition", "quantum circuit correctness", () => {
    const rng = makeRng(4), n = 5, a = new StateVector(n), b = new StateVector(n); for (let i = 0; i < 32; i++) { a.re[i] = rng.normal(); a.im[i] = rng.normal(); } const nr = a.norm(); for (let i = 0; i < 32; i++) { a.re[i] /= nr; a.im[i] /= nr; } b.re.set(a.re); b.im.set(a.im);
    a.apply({ g: "mcz", q: [4], c: [0, 1, 2, 3] }); mcPhaseDecomposition([0, 1, 2, 3, 4], Math.PI).forEach((o) => b.apply(o)); let w = 0; for (let i = 0; i < 32; i++) w = Math.max(w, Math.abs(a.re[i] - b.re[i]), Math.abs(a.im[i] - b.im[i]));
    return w < 1e-12 ? { detail: `5-qubit random state: CX + P network equals the diagonal MCZ to ${w.toExponential(1)}` } : { ok: false, detail: `difference ${w}` }; });
  await check("oracle", "Oracle phase marking", "oracle phase-marking test", () => {
    const n = 4, marked = [3, 12], sv = new StateVector(n); for (let q = 0; q < n; q++) sv.apply({ g: "h", q: [q] }); const before = sv.re.slice();
    for (const op of oracleOps(n, marked)) sv.apply(op); let ok = true; for (let i = 0; i < 16; i++) { const want = marked.includes(i) ? -before[i] : before[i]; if (Math.abs(sv.re[i] - want) > 1e-12 || Math.abs(sv.im[i]) > 1e-12) ok = false; }
    return ok ? { detail: "uniform 4-qubit state: amplitudes of |0011⟩ and |1100⟩ flipped to −1/4, all others unchanged" } : false; });
  await check("grover", "Grover probabilities vs sin²((2r+1)θ)", "Grover probability check", () => {
    const th = groverTheory(32, 1); let w = 0; for (let r = 0; r <= 6; r++) w = Math.max(w, Math.abs(runGroverCircuit({ n: 5, marked: [19], r }).final.pMarked - th.P(r)));
    return w < 1e-10 ? { detail: `n = 5, M = 1, r = 0…6: elementary-gate circuit matches the formula to ${w.toExponential(1)}; r* = ${th.rStar}` } : { ok: false, detail: `max difference ${w}` }; });
  await check("leakage", "ML split leakage", "ML leakage check", () => {
    const sets = []; for (let i = 0; i < 186; i++) for (let j = i + 1; j < 186; j++) sets.push([i, j]); const sp = disjointBranchSplit(sets, 186, 0.3, 1), ov = branchOverlap(sets, sp.train, sp.test);
    return ov.length === 0 ? { detail: `IEEE-118 pairs: ${sp.train.length} train / ${sp.test.length} test / ${sp.excluded.length} excluded, 0 shared branches` } : { ok: false, detail: `${ov.length} shared branches` }; });
  await check("repro", "Reproducibility with fixed seeds", "reproducibility check", async () => {
    const n = nets.ieee14, u = [...Array(20).keys()], a = await runSearch("ga", { engine: n.engine, universe: u, k: 2, budget: 60, seed: 9 }), b = await runSearch("ga", { engine: n.engine, universe: u, k: 2, budget: 60, seed: 9 });
    const same = JSON.stringify(a.trace.map((t) => t[1])) === JSON.stringify(b.trace.map((t) => t[1])) && a.best.S === b.best.S;
    return same ? { detail: `genetic search, IEEE-14, seed 9: identical best-so-far traces (${a.trace.length} points) and best S ${(100 * a.best.S).toFixed(3)} % twice` } : false; });
  await check("export", "Export round trip", "result-export consistency", () => {
    const r = bx.registry.list()[0]; if (!r) return { detail: "no record to export yet (not a failure)" };
    const back = JSON.parse(JSON.stringify(r)), csv = recordCSV(r); const ok = !validateRecord(back).length && back.configHash === configHash(back.config) && csv.startsWith("key,value") && csv.includes(r.id);
    return ok ? { detail: `${r.id}: JSON round trip keeps a valid record with the same configuration hash; CSV carries the id` } : false; });
  await check("registry", "Registry schema", "data provenance", () => { const bad = bx.registry.list().filter((r) => validateRecord(r).length); return bad.length ? { ok: false, detail: `${bad.length} invalid records` } : { detail: `${bx.registry.list().length} records, all valid ${"bsx.experiment/1"}` }; });
  return out;
}
