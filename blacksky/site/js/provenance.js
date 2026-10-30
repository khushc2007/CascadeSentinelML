import { PROVENANCE } from "./sci/contracts.js";
// Every metric shown in BLACKSKY COMMAND: meaning, unit, source and scope. Rendered in the (i) popovers and the findings report.
export const METRICS = {
  S: { label: "Demand unserved (S)", unit: "fraction of base demand", definition: "1 − served demand / base demand at termination of the cascade.", source: "cascade engine frames (load_served of the last round)", scope: "quasi-steady-state DC (or AC where stated) model of the test case; not a blackout probability" },
  S0: { label: "Initial loss (S₀)", unit: "fraction of base demand", definition: "Demand unserved after the initial outage and island balancing, before any secondary trip.", source: "first frame of the run", scope: "same model" },
  C: { label: "Cascade-induced loss (C)", unit: "fraction of base demand", definition: "C = S − S₀: demand lost because of secondary trips.", source: "derived from S and S₀", scope: "same model" },
  rounds: { label: "Rounds", unit: "count", definition: "Number of power-flow solutions until no branch exceeds its rating (or all demand is lost).", source: "engine", scope: "max 30 rounds" },
  trips: { label: "Secondary trips", unit: "branches", definition: "Branches removed by the trip rule (loading > 100 % of rating) after the initial outage.", source: "trips_per_round", scope: "all-overloaded or most-overloaded-first policy as selected" },
  islands: { label: "Energised islands", unit: "count", definition: "Connected components that still contain an online generator at termination; buses without generation are counted separately as de-energised.", source: "frame component labels (browser engine)", scope: "unavailable for API/AC results, which report component counts only" },
  rank: { label: "Rank", unit: "position of N", definition: "1 + number of k-branch sets with strictly larger S in the exhaustive DC truth table.", source: "data/dist_<grid>_k<k>.json (exact top 500, 1000-bin histogram below)", scope: "DC results only; IEEE-14/30 k ≤ 4, IEEE-118 k ≤ 3" },
  score: { label: "Arena score", unit: "0–100", definition: "100 × (1 − (rank − 1) / N): share of all k-branch sets no more damaging than yours; 0 when no demand is lost.", source: "rank", scope: "DC results with an exhaustive table only" },
  loading: { label: "Loading", unit: "% of rating", definition: "|flow| / rating: DC MW over the synthetic DC rating, or AC MVA over the AC rating for AC results.", source: "frame loading", scope: "ratings are synthetic (n1_covering rule), not utility data" },
  flow: { label: "Flow", unit: "MW", definition: "Signed DC branch flow from the from-bus to the to-bus.", source: "browser engine frames", scope: "not recorded for stored or API results" },
  base: { label: "Base demand", unit: "MW", definition: "Total demand of the test case at the cascade model's stress level (initial_load_mw).", source: "cascade_model_<grid>.json", scope: "benchmark data, not a real load forecast" },
  maxload: { label: "Maximum observed loading", unit: "% of rating", definition: "Largest |flow| / rating over every branch and every round of the run.", source: "frame loading of all rounds", scope: "synthetic ratings" },
  wall: { label: "Wall-clock time", unit: "ms", definition: "Time this browser took to compute or retrieve the run (performance.now()).", source: "measured in this browser", scope: "device-dependent; not a benchmark" },
};
export const EVIDENCE = {
  "browser-dc": { cls: "computed live", text: "Computed live in this browser by the JavaScript port of the DC cascade engine (identical to the Python engine on 700 parity runs)." },
  "stored-dc": { cls: "precomputed reference", text: "Python engine run stored in the data files when the demo data was built." },
  "stored-ac": { cls: "stored AC verification", text: "Python AC (Newton–Raphson) run stored in the data files; not recomputed here." },
  "api-dc": { cls: "computed by API", text: "Python DC engine through the API." },
  "api-ac": { cls: "computed by API", text: "Python AC engine through the API." },
};

// result-class chip (shared vocabulary, sci/contracts.js): click for the definition
export const provChip = (k, extra = "") => { const p = PROVENANCE[k]; return p ? `<button class="prov" data-p="${k}" data-explain="prov:${k}" title="${p.label}${extra ? ` · ${extra.replace(/"/g, "&quot;")}` : ""}" aria-label="Result class: ${p.label}">${p.short}</button>` : ""; };
// result class of a cascade engine
export const ENGINE_PROV = { "browser-dc": "simulator", "stored-dc": "simulator", "stored-ac": "simulator", "api-dc": "simulator", "api-ac": "simulator" };
