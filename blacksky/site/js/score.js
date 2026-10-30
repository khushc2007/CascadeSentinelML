// Contingency Arena score. Defined calculation, no arbitrary points:
//   score = 100 × (1 − (rank − 1) / N)  for a DC result with S > 0 whose k has an exhaustive DC table, where rank = 1 + number of k-branch sets
//   in the table with strictly larger severity S (exact within the stored top 500, histogram-estimated below) and N = C(L, k);
//   score = 0 when no demand is lost; no score (null) when the result is AC, uses another trip policy than the tables, or no table exists.
// The score is the percentage of all k-branch sets that are no more damaging than yours. Pure; tested in blacksky/test/logic.test.mjs.
export function challengeScore({ rank, mode, k, tableKs, policy = "all_overloaded", ties = 1 }) {
  if (policy !== "all_overloaded") return { score: null, reason: "The exhaustive tables use the all-overloaded trip policy; a most-overloaded-first result is not ranked against them." };
  if (mode === "ac") return { score: null, reason: "AC results are not ranked against the exhaustive tables, which are DC." };
  if (!tableKs.includes(k)) return { score: null, reason: `No exhaustive table for k = ${k} on this network (tables exist for k ∈ {${tableKs.join(", ")}}).` };
  if (!rank) return { score: null, reason: "Rank unavailable." };
  if (rank.zero) return { score: 0, rank, tier: "no demand lost", reason: `No demand lost; ${rank.tiedZero.toLocaleString("en-US")} of ${rank.N.toLocaleString("en-US")} sets behave the same.` };
  const score = Math.round(1000 * (1 - (rank.rank - 1) / rank.N)) / 10;
  const tier = rank.exact && rank.rank === 1 ? (ties > 1 ? `tied most damaging, ${ties} sets (exact)` : "most damaging set (exact)") : rank.exact && rank.rank <= 10 ? "top 10 (exact)" : score >= 99 ? "top 1 %" : score >= 90 ? "top 10 %" : "below the top 10 %";
  return { score, rank, tier, reason: `${rank.exact ? "Exact" : "Histogram-estimated"} rank ${rank.rank.toLocaleString("en-US")} of ${rank.N.toLocaleString("en-US")} k-branch sets.` };
}
