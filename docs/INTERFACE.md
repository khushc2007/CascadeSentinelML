# Oracle interface (`doomsday/oracle/interface.py`) — contract and the two extensions

## Original contract (unchanged, V2 §4.5 / §20)
An oracle is a pure deterministic function **S: Ω_k → [0,1]** over EXACTLY-k outage sets, with `severity`, `severity_batch`,
`evaluate`, `is_high_severity` (`S ≥ τ`), `exceeds` (strict `S > y`), `structure()`, `space`, `cost_counter`, `fidelity`, `namespace`.
An oracle object is bound to one cardinality k: **a set of any other size is rejected** (`ContingencyError`), never silently accepted.
Nothing about this changed in Phases 4–5.

## Extension 1 — `Oracle.with_k(k)`  (added in Phase 4)
*Why necessary.* V2 §15.1 specifies beam search as "add the branch maximising S", which requires S of PARTIAL sets (size 1..k-1).
The exactly-k contract cannot express that, and S of a singleton is not defined by Ω_k.
*What it is.* A sibling oracle for **the same predicate on another cardinality** (0 ≤ k ≤ L), sharing grid, config, engine, cache and namespace.
It is a new method; the original object keeps its own k and still rejects other sizes. `k` must be a true integer in [0, L].
*Accounting.* Every evaluation by any sibling is counted: per-instance `cost_counter` (unique SETS at that cardinality; unchanged
behaviour) AND the shared `family_counter` (unique `(k, set)` pairs across the whole family). `CountedEvaluator` counts `(j, set)`
the same way, so a search's `oracle_calls` equals `family_counter.unique` when it is the only user (tested).
*Table oracles.* `TableOracle.with_k(j)` works only if a truth table for `j` was loaded; otherwise it raises (no values are invented).

## Extension 2 — `GridFeatures.branch_x_pu`  (added in Phase 4)
*Why necessary.* The MILP interdiction baseline needs branch susceptances 1/x, which the structure accessor did not expose.
*Compatibility.* It is the LAST field and optional (default `None`); feature files/tables written before Phase 4 still load
(`branch_x_pu=None`), and only the MILP method refuses (with an explicit message). No other consumer reads it.

## Related hardening (Phase 5)
`ContingencySpace` now validates `0 ≤ k ≤ L` and integer types (previously ill-defined inputs such as negative k failed late/obscurely).
Valid inputs behave exactly as before.

## Search plumbing in the interface
`CountedEvaluator` (budgeted unique-evaluation counting, memoisation, discovery tracking), `SearchResult`, `BudgetExhausted`, `TargetReached`.
`qsearch` and `classical` import ONLY this module (enforced by `tests/unit/test_dependency_rules.py`).
