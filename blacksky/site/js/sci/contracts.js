// @ts-check
// Shared contracts of BLACKSKY OMEGA: schema versions, stable identifiers, the provenance vocabulary used in all five workspaces, and
// runtime validators for the records that cross workspace boundaries (scenario, experiment). JSDoc typedefs are type-checked with tsc.

export const APP = Object.freeze({ name: "BLACKSKY COMMAND", edition: "OMEGA", version: "1.0.0" });
export const SCHEMAS = Object.freeze({ experiment: "bsx.experiment/1", scenario: "bsx.scenario/1", circuit: "bsx.circuit/1", search: "bsx.search/1",
  model: "bsx.model/1", features: "bsx.features/1", session: "bsx.session/1", limitations: "bsx.limitations/1" });

/**
 * Provenance classes. Every headline value carries one; the same words are used everywhere.
 * @type {Record<string, { short: string, label: string, means: string }>}
 */
export const PROVENANCE = {
  measured: { short: "MEAS", label: "Measured", means: "Measured in this environment (for example wall-clock time of a run in this browser). Depends on the device." },
  simulator: { short: "SIM", label: "Simulator-generated", means: "Output of the cascade simulator (DC browser engine or a stored / API Python run) for the stated configuration." },
  emulated: { short: "EMU", label: "Emulated", means: "Classical simulation of a quantum circuit (statevector or density matrix) on this CPU. Not a quantum computer." },
  analytical: { short: "EST", label: "Analytically estimated", means: "Closed-form result or model estimate under the stated assumptions (for example sin²((2r+1)θ), resource estimates)." },
  predicted: { short: "PRED", label: "Model-predicted", means: "Output of a machine-learning model trained on simulator labels. Not verified until the simulator is run on it." },
  synthetic: { short: "SYN", label: "Synthetic demonstration", means: "Synthetic input chosen for a demonstration (for example noise parameters that are not device calibration data)." },
  proposed: { short: "PROP", label: "Proposed / not implemented", means: "Described but not implemented here; no result exists." },
  unavailable: { short: "N/A", label: "Unavailable", means: "Not available in this deployment or for this input; the reason is stated next to it." },
};
/** @param {string} k */ export const isProvenance = (k) => Object.prototype.hasOwnProperty.call(PROVENANCE, k);

/** FNV-1a 64-bit hash of a canonical JSON string (stable config hash, not cryptographic). @param {string} s */
export function fnv64(s) {
  let h = 0xcbf29ce484222325n; const p = 0x100000001b3n, M = 0xffffffffffffffffn;
  for (let i = 0; i < s.length; i++) { h ^= BigInt(s.charCodeAt(i)); h = (h * p) & M; }
  return h.toString(16).padStart(16, "0");
}
/** JSON with sorted object keys (so equal configurations hash equally). @param {any} v @returns {string} */
export function canonicalJSON(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJSON).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJSON(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
/** @param {any} config */ export const configHash = (config) => fnv64(canonicalJSON(config));

/**
 * @typedef {{ grid: string, set: number[], policy: string, engine: string }} Scenario
 */
/** Stable scenario id: SCN:<grid>:k<k>:<sorted set>:<engine model>:<policy>. @param {Scenario} s */
export function scenarioId(s) {
  const set = [...s.set].map(Number).sort((a, b) => a - b), model = s.engine.endsWith("ac") ? "ac" : "dc", pol = s.policy === "most_overloaded_first" ? "mof" : "all";
  return `SCN:${s.grid}:k${set.length}:${set.join("-")}:${model}:${pol}`;
}
/** @param {string} id */
export function parseScenarioId(id) {
  const m = /^SCN:([a-z0-9]+):k(\d+):([0-9-]*):(dc|ac):(all|mof)$/.exec(id || ""); if (!m) return null;
  const set = m[3] ? m[3].split("-").map(Number) : []; if (set.length !== +m[2]) return null;
  return { grid: m[1], k: +m[2], set, model: m[4], policy: m[5] === "mof" ? "most_overloaded_first" : "all_overloaded" };
}

/**
 * @typedef {{ schema: string, id: string, type: string, name: string, createdAt: string, configHash: string, config: any, seed: number|null,
 *   scenarioIds: string[], provenance: string, status: "completed"|"failed"|"cancelled", results: any, warnings: string[], errors: string[],
 *   log: { t: number, msg: string }[], limitations: string[], software: { app: string, version: string, build: any }, environment: any,
 *   durationMs: number|null, parent: string|null, links: { kind: string, id: string }[] }} ExperimentRecord
 */
export const EXPERIMENT_TYPES = ["cascade", "quantum.circuit", "quantum.grover", "arena.toy", "arena.grid", "ml.train", "ml.verify", "ml.active", "validation"];

/** Validate an experiment record (shape and vocabulary). @param {any} r @returns {string[]} errors */
export function validateRecord(r) {
  const e = [];
  if (!r || typeof r !== "object") return ["record is not an object"];
  if (r.schema !== SCHEMAS.experiment) e.push(`schema must be ${SCHEMAS.experiment}`);
  if (!/^EXP-[0-9]{8}-[0-9]{6}-[0-9a-z]{4,}$/.test(r.id || "")) e.push("id must look like EXP-YYYYMMDD-HHMMSS-xxxx");
  if (!EXPERIMENT_TYPES.includes(r.type)) e.push(`type must be one of ${EXPERIMENT_TYPES.join(", ")}`);
  if (!isProvenance(r.provenance)) e.push("provenance must be one of the PROVENANCE classes");
  if (!["completed", "failed", "cancelled"].includes(r.status)) e.push("status must be completed, failed or cancelled");
  if (typeof r.configHash !== "string" || r.configHash.length !== 16) e.push("configHash must be a 16-hex-digit hash");
  if (r.status === "failed" && !(r.errors && r.errors.length)) e.push("a failed record must carry its error");
  if (!Array.isArray(r.limitations)) e.push("limitations must be a list of limitation ids");
  return e;
}

let seqN = 0;
/** New experiment id: EXP-YYYYMMDD-HHMMSS-<counter + random, base 36>. @param {Date} [d] */
export function newExperimentId(d = new Date()) {
  const p = (/** @type {number} */ n, w = 2) => String(n).padStart(w, "0");
  const r = (Math.floor(Math.random() * 36 ** 3) + 36 ** 3 * (++seqN % 36)).toString(36).padStart(4, "0").slice(-4);
  return `EXP-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}-${r}`;
}
