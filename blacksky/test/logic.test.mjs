// BLACKSKY COMMAND logic on real data: theater stages, arena score and validation, stored-run index, metric provenance, entity parsing.
// Every case runs the shared, parity-tested engine (site/shared/core/cascade.js) on the official case data copied into site/data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DCCascade } from "../site/shared/core/cascade.js";
import { buildModel } from "../site/shared/core/model.js";
import { buildEvents } from "../site/shared/core/events.js";
import { rankOf } from "../site/shared/core/scenario.js";
import { deriveStages, stageAt, STAGE_IDS } from "../site/js/stages.js";
import { challengeScore } from "../site/js/score.js";
import { METRICS, EVIDENCE } from "../site/js/provenance.js";
import { indexStored, setKey } from "../site/js/engine.js";
import { validateArena } from "../site/js/ws/theater-scenario.js";
import { parseEntity } from "../site/js/ws/theater-inspector.js";

const D = new URL("../site/data/", import.meta.url);
const J = (f) => JSON.parse(readFileSync(new URL(f, D)));
const index = J("index.json");
function net(id) {
  const grid = J(`grid_${id}.json`), cm = J(`cascade_model_${id}.json`), model = buildModel(grid, cm), engine = new DCCascade(cm);
  const tableKs = Object.entries(index.grids.find((g) => g.id === id).k).filter(([, v]) => v.available).map(([k]) => +k);
  const dists = Object.fromEntries(tableKs.map((k) => [k, J(`dist_${id}_k${k}.json`)]));
  const stored = indexStored([2, 3].map((k) => J(`top_cascades_${id}_k${k}.json`)), [2, 3].map((k) => J(`examples_${id}_k${k}.json`)));
  return { id, model, engine, tableKs, dists, stored };
}
const NETS = Object.fromEntries(["ieee14", "ieee30", "ieee118"].map((g) => [g, net(g)]));
const runAll = (n, o) => { const res = n.engine.run(o, { policy: "all_overloaded" }), events = buildEvents(res, n.model), k = o.length;
  const rank = n.dists[k] ? rankOf(n.dists[k], res.metrics.S) : null; return { res, events, rank, stages: deriveStages(res, events, n.model, rank) }; };

function checkStages(stages, events) {
  assert.deepEqual(stages.map((s) => s.id), STAGE_IDS);
  assert.equal(stages[0].eventIndex, 0); assert.equal(events[stages[0].eventIndex].type, "initial_outage");
  assert.equal(stages[4].eventIndex, events.length - 1); assert.equal(events[stages[4].eventIndex].type, "termination");
  for (const s of stages) {
    if (!s.occurred) { assert.equal(s.eventIndex, -1, `${s.id} did not occur but has an event`); continue; }
    assert.ok(s.eventIndex >= 0 && s.eventIndex < events.length, s.id);
    assert.ok(typeof s.summary === "string" && s.summary.length > 10);
  }
  const ty = (id) => events[stages.find((s) => s.id === id).eventIndex]?.type;
  if (stages[1].occurred) assert.equal(ty("trace"), "overload");
  if (stages[2].occurred) assert.equal(ty("cascade"), "trip");
  // stageAt: every event maps to an occurred stage whose first event is at or before it; the mapping never moves backwards in stage order of first events
  let prev = -1; events.forEach((e) => { const s = stageAt(stages, e.i); assert.ok(s.occurred && s.eventIndex <= e.i); assert.ok(s.eventIndex >= prev); prev = s.eventIndex; });
}

test("stages: worst IEEE-118 triple goes through all five stages, ranks #1 exactly, scores 100", () => {
  const n = NETS.ieee118, top = J("top_cascades_ieee118_k3.json")[0].dc, { res, events, rank, stages } = runAll(n, top.outage);
  assert.ok(Math.abs(res.metrics.S - top.metrics.S) < 1e-9, "browser engine reproduces the stored Python run");
  checkStages(stages, events); assert.ok(stages.every((s) => s.occurred));
  assert.equal(rank.rank, 1); assert.equal(rank.exact, true); assert.equal(rank.N, n.dists[3].N);
  // ISLAND is the separation the cascade causes, so it starts after the first trip
  assert.ok(stages[3].eventIndex > stages[2].eventIndex);
  const sc = challengeScore({ rank, mode: "dc", k: 3, tableKs: n.tableKs }); assert.equal(sc.score, 100); assert.match(sc.tier, /most damaging/);
  assert.match(stages[4].summary, /Rank #1 of 1,055,240/);
});

test("stages: an absorbed outage reports TRACE, CASCADE and ISLAND as did-not-occur, score 0", () => {
  const n = NETS.ieee14, ex = J("examples_ieee14_k2.json").benign.dc, { res, events, rank, stages } = runAll(n, ex.outage);
  checkStages(stages, events); assert.equal(res.metrics.S, 0);
  for (const id of ["trace", "cascade", "island"]) assert.equal(stages.find((s) => s.id === id).occurred, false, id);
  const sc = challengeScore({ rank, mode: "dc", k: 2, tableKs: n.tableKs }); assert.equal(sc.score, 0); assert.equal(rank.zero, true);
});

test("stages: isolation without cascade has ISLAND but no CASCADE; S equals S0", () => {
  const n = NETS.ieee30, ex = J("examples_ieee30_k3.json").isolation_only.dc, { res, events, stages } = runAll(n, ex.outage);
  checkStages(stages, events); assert.equal(stages[2].occurred, false); assert.equal(stages[3].occurred, true);
  assert.ok(res.metrics.S0 > 0 && Math.abs(res.metrics.S - res.metrics.S0) < 1e-12);
});

test("stages: invariants hold on every stored top set and example on all three networks", () => {
  let n0 = 0;
  for (const [g, n] of Object.entries(NETS)) for (const [key] of n.stored) { const o = key.split(",").map(Number), { events, stages } = runAll(n, o); checkStages(stages, events); n0++; void g; }
  assert.ok(n0 >= 60, `checked ${n0} sets`);
});

test("score: defined formula, monotone in rank, and no score where the tables cannot rank", () => {
  const n = NETS.ieee118, d = n.dists[3];
  const a = challengeScore({ rank: { rank: 1, exact: true, N: d.N }, mode: "dc", k: 3, tableKs: n.tableKs });
  const b = challengeScore({ rank: { rank: 1000, exact: false, N: d.N }, mode: "dc", k: 3, tableKs: n.tableKs });
  const c = challengeScore({ rank: { rank: d.N, exact: false, N: d.N }, mode: "dc", k: 3, tableKs: n.tableKs });
  assert.equal(a.score, 100); assert.ok(b.score < a.score && b.score > c.score); assert.equal(c.score, Math.round(1000 * (1 - (d.N - 1) / d.N)) / 10);
  assert.match(b.reason, /Histogram-estimated/);
  assert.equal(challengeScore({ rank: a.rank, mode: "ac", k: 3, tableKs: n.tableKs }).score, null);
  assert.equal(challengeScore({ rank: a.rank, mode: "dc", k: 4, tableKs: n.tableKs }).score, null);
  assert.equal(challengeScore({ rank: a.rank, mode: "dc", k: 3, tableKs: n.tableKs, policy: "most_overloaded_first" }).score, null);
  // a real mid-table set: rank comes from the histogram and the score sits strictly between 0 and 100
  const { rank } = runAll(n, [0, 1, 2]); const s = challengeScore({ rank, mode: "dc", k: 3, tableKs: n.tableKs });
  assert.ok(rank.zero || (s.score > 0 && s.score < 100));
});

test("stored runs: index covers top sets and examples; AC exists where the data says so", () => {
  const n = NETS.ieee30, top = J("top_cascades_ieee30_k3.json")[0], s = n.stored.get(setKey(top.dc.outage));
  assert.ok(s && s.dc && s.ac); assert.equal(s.ac.mode, "ac"); assert.equal(s.dc.metrics.S, top.dc.metrics.S);
  const ex118 = Object.values(J("examples_ieee118_k2.json")).filter((r) => r && r.ac).length;               // IEEE-118 AC: the k=2 examples only
  assert.ok(ex118 > 0); assert.equal([...NETS.ieee118.stored.values()].filter((x) => x.ac).length, ex118);
  assert.equal(setKey([140, 6, 67]), "6,67,140");
});

test("arena validation: engine availability, stored coverage, trip policy, k limits", () => {
  const n = NETS.ieee118, top = J("top_cascades_ieee118_k3.json")[0].dc.outage;
  assert.equal(validateArena({ net: n, draft: top, engine: "browser-dc", policy: "all_overloaded", apiOk: false }).ok, true);
  assert.equal(validateArena({ net: n, draft: top, engine: "stored-dc", policy: "all_overloaded", apiOk: false }).ok, true);
  assert.equal(validateArena({ net: n, draft: top, engine: "stored-ac", policy: "all_overloaded", apiOk: false }).ok, false);
  const notStored = [3, 4, 5]; assert.equal(n.stored.has(setKey(notStored)), false);
  assert.equal(validateArena({ net: n, draft: notStored, engine: "stored-dc", policy: "all_overloaded", apiOk: false }).ok, false);
  assert.equal(validateArena({ net: n, draft: top, engine: "stored-dc", policy: "most_overloaded_first", apiOk: false }).ok, false);
  const api = validateArena({ net: n, draft: top, engine: "api-dc", policy: "all_overloaded", apiOk: false }); assert.equal(api.ok, false); assert.match(api.errors[0], /API is not reachable/);
  assert.equal(validateArena({ net: n, draft: top, engine: "api-dc", policy: "all_overloaded", apiOk: true }).warnings.length, 1);
  assert.equal(validateArena({ net: n, draft: [], engine: "browser-dc", policy: "all_overloaded", apiOk: false }).ok, false);
  assert.equal(validateArena({ net: n, draft: [0, 1, 2, 3, 4, 5, 6, 7, 8], engine: "browser-dc", policy: "all_overloaded", apiOk: false }).ok, false);
  assert.equal(validateArena({ net: n, draft: [999], engine: "browser-dc", policy: "all_overloaded", apiOk: false }).ok, false);
  const pol = validateArena({ net: n, draft: top, engine: "browser-dc", policy: "most_overloaded_first", apiOk: false }); assert.ok(pol.ok && pol.info.some((x) => /not be ranked/.test(x)));
});

test("provenance: every metric has meaning, unit, source and scope; every engine has an evidence class", () => {
  for (const [k, m] of Object.entries(METRICS)) for (const f of ["label", "unit", "definition", "source", "scope"]) assert.ok(m[f] && m[f].length > 1, `${k}.${f}`);
  for (const e of ["browser-dc", "stored-dc", "stored-ac", "api-dc", "api-ac"]) assert.ok(EVIDENCE[e].cls && EVIDENCE[e].text);
  assert.match(METRICS.S.scope, /not a blackout probability/);
});

test("autopsy: entity search resolves ids on the active network only", () => {
  const m = NETS.ieee118.model;
  assert.equal(parseEntity("bus 69", m), "bus:69"); assert.equal(parseEntity("69", m), "bus:69"); assert.equal(parseEntity("branch 12", m), "branch:12");
  assert.equal(parseEntity("line 185", m), "branch:185"); assert.equal(parseEntity("gen 3", m), "gen:3"); assert.equal(parseEntity("load 59", m), "load:59");
  assert.equal(parseEntity("bus 500", m), null); assert.equal(parseEntity("branch 30", NETS.ieee14.model), null); assert.equal(parseEntity("nonsense", m), null);
});

test("site boundary: no file in blacksky/site references the original app's paths or private configuration", () => {
  const files = ["index.html", ...readdirSync(new URL("../site/js/", import.meta.url), { recursive: true }).filter((f) => f.endsWith(".js")).map((f) => `js/${f}`)];
  assert.ok(files.length > 20, "walks the workspace subfolders too");
  for (const f of files) { const t = readFileSync(new URL(`../site/${f}`, import.meta.url), "utf8");
    assert.ok(!/\.\.\/\.\.\/app\/|\/app\/js\//.test(t), `${f} reaches into app/`); assert.ok(!/api[_-]?key|secret|token=/i.test(t), `${f} mentions credentials`); }
});

test("stages on a stored AC run: AC wording, component counts not called energised islands, S interval shown", () => {
  const n = NETS.ieee30, ac = J("top_cascades_ieee30_k3.json")[0].ac, events = buildEvents(ac, n.model), stages = deriveStages(ac, events, n.model, null);
  checkStages(stages, events);
  assert.match(stages[0].summary, /AC power flow/); assert.doesNotMatch(stages[0].summary, /DC/);
  if (stages[1].occurred) assert.match(stages[1].summary, /AC rating/);
  const isl = stages.find((s) => s.id === "island"); if (isl.occurred) assert.match(isl.summary, /connected component/);
  if (ac.metrics.S_total != null && Math.abs(ac.metrics.S_total - ac.metrics.S) > 1e-9) assert.match(stages[4].summary, /–/);
});

test("score: tied rank 1 is reported as tied, not as a unique most damaging set", () => {
  const n = NETS.ieee118, d = n.dists[3], ties = d.top.filter(([v]) => Math.abs(v - d.top[0][0]) <= 1e-9).length;
  const sc = challengeScore({ rank: { rank: 1, exact: true, N: d.N }, mode: "dc", k: 3, tableKs: n.tableKs, ties });
  assert.equal(sc.score, 100); if (ties > 1) assert.match(sc.tier, /tied most damaging, \d+ sets/); else assert.match(sc.tier, /^most damaging set/);
});
