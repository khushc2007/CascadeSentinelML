# Phase 4: classical baselines — what each method is, and where it departs from V2 §15
Common interface: `doomsday.classical.classical_search(oracle, method, budget, seed, target=...) -> SearchResult`
(algorithm, grid, k, objective, oracle_calls = UNIQUE (cardinality, set) evaluations, candidate_evaluations = requests incl. memoised repeats,
runtime/cpu seconds, best_severity, best_contingency, best_rank, discovery_calls, calls_to_within_1pct, certified_stop_calls, trace, aux).
Search code imports only `doomsday.oracle.interface` (enforced by `tests/unit/test_dependency_rules.py`).

| method | what is implemented | departures / honesty notes |
|---|---|---|
| brute | lexicographic enumeration of all N sets | certified stop = N |
| random | uniform sampling without replacement | expected discovery (N+1)/(M+1) verified statistically |
| hillclimb | steepest ascent, swap neighbourhood k(L-k), strict improvement, multi-start (5) | start 0 = top-k branches by structural stress. V2 says "top-k N-1 outages", but N-1 severity is identically 0 under the N-1-secure ratings, so the LODF/Woodbury pair stress is used. No sideways moves on plateaus. |
| beam | add one branch per level, scored by the TRUE oracle at cardinality j via `oracle.with_k(j)` | V2's oracle is defined on exactly-k sets only; partial-set queries are an interface extension and COUNT as oracle calls. Level-1 scores are all 0 (N-1 secure), so ties are broken by structural stress, then lexicographically. Needs truth tables for every j<=k. |
| sa | swap moves, geometric cooling 0.05→0.001, 4000 iterations, random start | untuned |
| ga | pop 40, tournament 3, union-sampling crossover, swap mutation (p=0.3), elitism 2, 100 generations | untuned |
| lodf_pool | rank branches by max pairwise LODF/Woodbury stress (structure only), exhaustively search top-m pool | V2's m ∈ {20,40,60} exceeds L=20 on IEEE-14; m ∈ {8,12,16} used. Ranking cost (L(L-1)/2 pair solves) is reported in `aux`, not in oracle calls. Islanding pairs: stress = 1 + stranded-load fraction (0 if none) — a heuristic proxy. |
| ml_screen | gradient-boosted trees (sklearn) on 14 structural features; cost = n_train + T | n_train = ceil(0.08N), T = ceil(0.04N): a-priori, untuned. Not E10 (no surrogate-quality study). |
| milp | single-level MILP from the LP dual of the defender's static DC min-load-shed problem, big-M linearisation (HiGHS via scipy) | DIFFERENT severity definition (static, no cascade). Verified against exhaustive enumeration of the defender LP (k=2,3, several dual-box bounds). The dual box can only lower the MILP value; the recomputed LP value of the returned set is stored (`static_lp_check`). Chosen sets are re-evaluated with the cascade oracle: those are its only oracle calls. |
| bnb | **[PROPOSED/stretch] heuristic**: best-first over partial sets, expand only if Woodbury stress ≥ θ | S is not monotone (V2 §4.4) and no valid LODF upper bound on cascade severity exists, so this is NOT an exact branch-and-bound and may prune the optimum. `exact=False`, `heuristic_bound_not_rigorous=True` in every result. |

**Hyper-parameters were not tuned.** V2 §15.2 requires tuning on a held-out grid/k pair; no second verified grid exists yet (IEEE-30/118 absent),
so a-priori defaults were fixed before any comparison and nothing was adjusted after seeing results.

**Evidence status.** Benchmark outputs are `[MEASURED]` *diagnostics* on the unverified IEEE-14 transcription, on a truth-table oracle; they are not E7.
`runtime_s` on a TableOracle excludes oracle cost and must not be compared with oracle-call counts.
