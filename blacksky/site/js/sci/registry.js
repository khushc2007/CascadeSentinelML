// @ts-check
// Experiment registry: every run in every workspace becomes an immutable record with a stable id (never overwritten; a re-run is a new
// record whose `parent` points at the original). Persistence is the browser's localStorage when available (per viewer, per browser),
// otherwise memory for this session; the UI says which. Exports: JSON, CSV (flattened results), Markdown report.
import { APP, SCHEMAS, PROVENANCE, configHash, newExperimentId, validateRecord, canonicalJSON } from "./contracts.js";
import { LIMITATIONS } from "./limitations.js";

const KEY = "blacksky.registry.v1", CAP = 300;

/** @typedef {import("./contracts.js").ExperimentRecord} ExperimentRecord */

/** @param {{ get: (k: string, d: any) => any, set: (k: string, v: any) => boolean } | null} storage */
export function createRegistry(storage, build = null) {
  /** @type {ExperimentRecord[]} */ let recs = [];
  let persistent = false;
  if (storage) { const v = storage.get(KEY, null); if (Array.isArray(v)) recs = v.filter((r) => !validateRecord(r).length); persistent = storage.set(KEY, recs); }
  /** @type {Set<(r: ExperimentRecord[]) => void>} */ const subs = new Set();
  const save = () => { if (storage) persistent = storage.set(KEY, recs); subs.forEach((f) => f(recs)); };
  return {
    get persistent() { return persistent; },
    list: () => recs,
    get: (/** @type {string} */ id) => recs.find((r) => r.id === id) || null,
    byScenario: (/** @type {string} */ sid) => recs.filter((r) => r.scenarioIds.includes(sid)),
    byHash: (/** @type {string} */ h) => recs.filter((r) => r.configHash === h),
    sub: (/** @type {(r: ExperimentRecord[]) => void} */ f) => { subs.add(f); return () => subs.delete(f); },
    /**
     * Create and store a record. @param {{ type: string, name: string, config: any, seed?: number|null, scenarioIds?: string[], provenance: string,
     *   status?: "completed"|"failed"|"cancelled", results?: any, warnings?: string[], errors?: string[], log?: {t:number,msg:string}[], limitations?: string[],
     *   durationMs?: number|null, parent?: string|null, links?: {kind:string,id:string}[] }} p
     */
    add(p) {
      /** @type {ExperimentRecord} */
      const r = { schema: SCHEMAS.experiment, id: newExperimentId(), type: p.type, name: p.name, createdAt: new Date().toISOString(), configHash: configHash(p.config), config: p.config,
        seed: p.seed ?? null, scenarioIds: p.scenarioIds || [], provenance: p.provenance, status: p.status || "completed", results: p.results ?? null, warnings: p.warnings || [],
        errors: p.errors || [], log: p.log || [], limitations: p.limitations || [], software: { app: `${APP.name} ${APP.edition}`, version: APP.version, build },
        environment: typeof navigator !== "undefined" ? { userAgent: navigator.userAgent, cores: navigator.hardwareConcurrency || null } : { userAgent: "node", cores: null },
        durationMs: p.durationMs ?? null, parent: p.parent ?? null, links: p.links || [] };
      while (recs.some((x) => x.id === r.id)) r.id = newExperimentId();
      const errs = validateRecord(r); if (errs.length) throw new Error(`invalid experiment record: ${errs.join("; ")}`);
      recs = [r, ...recs].slice(0, CAP); save(); return r;
    },
    remove(/** @type {string} */ id) { recs = recs.filter((r) => r.id !== id); save(); },
    clear() { recs = []; save(); },
    import(/** @type {any[]} */ list) { const ok = list.filter((r) => !validateRecord(r).length && !recs.some((x) => x.id === r.id)); recs = [...ok, ...recs].slice(0, CAP); save(); return ok.length; },
  };
}

/** Field-by-field comparison of two records (configuration and flat results). @param {ExperimentRecord} a @param {ExperimentRecord} b */
export function compareRecords(a, b) {
  const fa = flatten({ config: a.config, results: a.results }), fb = flatten({ config: b.config, results: b.results }), keys = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].sort();
  return { sameConfig: a.configHash === b.configHash, rows: keys.map((k) => ({ key: k, a: fa[k], b: fb[k], same: canonicalJSON(fa[k]) === canonicalJSON(fb[k]) })) };
}
/** Flatten nested objects to dotted keys; arrays longer than 12 become a length note. @param {any} o @param {string} [pre] @param {Record<string, any>} [out] */
export function flatten(o, pre = "", out = {}) {
  if (o == null || typeof o !== "object") { out[pre || "value"] = o; return out; }
  if (Array.isArray(o)) { if (o.length > 12 || o.some((x) => x && typeof x === "object")) out[pre] = `[${o.length} items]`; else out[pre] = o.join(" "); return out; }
  for (const [k, v] of Object.entries(o)) flatten(v, pre ? `${pre}.${k}` : k, out);
  return out;
}
/** CSV of the flattened record (key,value), RFC 4180 quoting. @param {ExperimentRecord} r */
export function recordCSV(r) {
  const q = (/** @type {any} */ v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const f = flatten({ id: r.id, type: r.type, name: r.name, createdAt: r.createdAt, status: r.status, provenance: PROVENANCE[r.provenance].label, configHash: r.configHash, seed: r.seed, config: r.config, results: r.results });
  return ["key,value", ...Object.entries(f).map(([k, v]) => `${q(k)},${q(v)}`)].join("\n") + "\n";
}
/** Human-readable report: objective, configuration, metrics, classification, limitations, reproducibility. @param {ExperimentRecord} r */
export function recordReport(r) {
  const L = [`# ${r.name}`, "", `- Experiment id: ${r.id}`, `- Type: ${r.type}`, `- Created: ${r.createdAt}`, `- Status: ${r.status}`,
    `- Result classification: ${PROVENANCE[r.provenance].label} — ${PROVENANCE[r.provenance].means}`, `- Configuration hash: ${r.configHash} (equal hashes = equal configurations)`,
    `- Seed: ${r.seed ?? "not applicable (deterministic)"}`, `- Software: ${r.software.app} ${r.software.version}${r.software.build?.commit ? `, built from commit ${r.software.build.commit}` : ""}`];
  if (r.scenarioIds.length) L.push(`- Scenarios: ${r.scenarioIds.join(", ")}`);
  if (r.parent) L.push(`- Re-run of: ${r.parent}`);
  L.push("", "## Configuration", "", "```json", JSON.stringify(r.config, null, 2), "```", "", "## Results", "");
  const f = flatten(r.results || {}); for (const [k, v] of Object.entries(f)) L.push(`- ${k}: ${typeof v === "number" ? +v.toPrecision(8) : v}`);
  if (r.warnings.length) L.push("", "## Warnings", "", ...r.warnings.map((w) => `- ${w}`));
  if (r.errors.length) L.push("", "## Errors", "", ...r.errors.map((w) => `- ${w}`));
  L.push("", "## Limitations that apply", "", ...r.limitations.map((id) => { const l = LIMITATIONS.items.find((x) => x.id === id); return `- ${id}: ${l ? l.text : "(unknown id)"}`; }));
  L.push("", `Limitations register version ${LIMITATIONS.version}. Generated by ${r.software.app}.`);
  return L.join("\n") + "\n";
}
