// Run adapters. One event model for all three experiences: every engine returns a result in the shared frame format, which
// shared/core/events.js turns into events. Engines: browser DC (shared/core/cascade.js), stored Python DC/AC runs (data files), and the
// optional API (blacksky/serve.py mounts the original FastAPI app at ./api). Failures are thrown, never replaced by another result.
import { DCCascade } from "../shared/core/cascade.js";
import { buildModel } from "../shared/core/model.js";

export const setKey = (o) => [...o].map(Number).sort((a, b) => a - b).join(",");
const cache = new Map();
export function getJSON(name) {
  if (!cache.has(name)) cache.set(name, fetch(`data/${name}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return cache.get(name);
}

// stored Python runs (DC and AC) keyed by outage set; pure so it can be tested on the real files
export function indexStored(topLists, exampleMaps) {
  const m = new Map();
  for (const t of topLists) for (const r of t || []) if (r && r.dc) m.set(setKey(r.dc.outage), { dc: r.dc, ac: r.ac || null });
  for (const e of exampleMaps) for (const r of Object.values(e || {})) if (r && r.dc) m.set(setKey(r.dc.outage), { dc: r.dc, ac: r.ac || null });
  return m;
}

export async function loadNetwork(id, index) {
  const [grid, cm] = await Promise.all([getJSON(`grid_${id}.json`), getJSON(`cascade_model_${id}.json`)]);
  if (!grid || !cm) throw new Error(`Network data for ${id} could not be loaded.`);
  const model = buildModel(grid, cm), engine = new DCCascade(cm);
  const tableKs = Object.entries(index?.grids?.find((g) => g.id === id)?.k || {}).filter(([, v]) => v.available).map(([k]) => +k);
  const dists = {}; await Promise.all(tableKs.map(async (k) => (dists[k] = await getJSON(`dist_${id}_k${k}.json`))));
  const tops = await Promise.all([2, 3].map((k) => getJSON(`top_cascades_${id}_k${k}.json`))), ex = await Promise.all([2, 3].map((k) => getJSON(`examples_${id}_k${k}.json`)));
  return { id, grid, model, engine, tableKs, dists, stored: indexStored(tops, ex) };
}

export const API_TIMEOUT_MS = 30000;
// API base URL: <meta name="blacksky-api"> (default "api/", i.e. same origin as served by blacksky/serve.py). No credentials are sent.
export function apiBase() { const m = typeof document !== "undefined" && document.querySelector('meta[name="blacksky-api"]'); const v = (m && m.content) || "api/"; return v.endsWith("/") ? v : `${v}/`; }
// BLACKSKY's own optional API (blacksky/serve.py /bsapi): Qiskit transpile statistics and an Aer cross-check. Same-origin, no credentials.
export function bsapiBase() { const m = typeof document !== "undefined" && document.querySelector('meta[name="blacksky-bsapi"]'); const v = (m && m.content) || "bsapi/"; return v.endsWith("/") ? v : `${v}/`; }
export async function bsapiAvailable() {
  try { const r = await fetch(`${bsapiBase()}health`, { cache: "no-store" }); if (!r.ok) return false; const h = await r.json(); return h && h.status === "ok" && h.qiskit; } catch { return false; }
}
export async function bsapiPost(path, body, timeoutMs = 30000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeoutMs);
  try { const r = await fetch(`${bsapiBase()}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`BLACKSKY API ${r.status}: ${typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail || j)}`); return j; }
  catch (e) { if (e.name === "AbortError") throw new Error(`BLACKSKY API timed out after ${timeoutMs / 1000} s`); throw e; } finally { clearTimeout(t); }
}
export async function apiAvailable() {
  try { const r = await fetch(`${apiBase()}health`, { cache: "no-store" }); if (!r.ok) return false; const h = await r.json(); return h && h.status === "ok"; } catch { return false; }
}

export async function runScenario(net, { engine, outage, policy = "all_overloaded", signal }) {
  const o = [...outage].map(Number).sort((a, b) => a - b), t0 = performance.now();
  if (engine === "browser-dc") { const result = net.engine.run(o, { policy }); return { result, engine, source: "computed in this browser", ms: performance.now() - t0 }; }
  if (engine === "stored-dc" || engine === "stored-ac") {
    const s = net.stored.get(setKey(o)), r = s && (engine === "stored-ac" ? s.ac : s.dc);
    if (!r) throw new Error(`No stored ${engine === "stored-ac" ? "AC" : "DC"} run for this set. Stored runs exist for the ten most damaging sets per table and the example sets.`);
    if (policy !== "all_overloaded") throw new Error("Stored runs use the all-overloaded trip policy.");
    return { result: r, engine, source: "stored Python run (data files)", ms: performance.now() - t0 };
  }
  if (engine === "api-dc" || engine === "api-ac") {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), API_TIMEOUT_MS); if (signal) signal.addEventListener("abort", () => ctl.abort());
    try {
      const r = await fetch(`${apiBase()}cascade`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.signal, body: JSON.stringify({ grid: net.id, outage: o, mode: engine === "api-ac" ? "ac" : "dc", policy }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`API ${r.status}: ${typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail || body)}`);
      return { result: body, engine, source: body.source === "precomputed" ? "API (precomputed run)" : "API (live Python run)", ms: performance.now() - t0 };
    } catch (e) { if (e.name === "AbortError") throw new Error(`API request cancelled or timed out after ${API_TIMEOUT_MS / 1000} s.`); throw e; } finally { clearTimeout(timer); }
  }
  throw new Error(`Unknown engine ${engine}`);
}
