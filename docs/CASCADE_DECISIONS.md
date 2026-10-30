# Cascade engine: decisions where V2 §8 is silent or ambiguous
1. **State carried across rounds**: per-bus load factor (monotone non-increasing; curtailed/lost load is never
   restored) and per-generator set-points. Balance is applied per island every round.
2. **Lossless dispatch** (resolution C): base slack generation is reduced by AC losses; a no-outage AC cascade
   reproduces the base AC state (tested). In AC the island slack absorbs losses.
3. **Redispatch**: surplus → generation scaled down pro-rata to current output (flag `pmin_violation` if below Pmin,
   value kept); deficit → raised pro-rata to headroom up to Pmax, then uniform pro-rata load curtailment (P and Q).
   Variant `no_upward` skips the raise.
4. **Island slack**: bus of the largest-Pmax in-service generator in the island (ties → lowest generator index);
   the original base slack has no priority. A generator with Pmax = 0 does not count as a generator.
   Phase 3: Pmax ties -> lowest *bus id* (not generator-table index), so the result cannot depend on generator row order.
5. **Rounds**: `rounds` = number of solved power-flow rounds. EXHAUSTED: S is taken from the last *solved* round.
6. **STATIC_INFEASIBLE** is a flag (`nonconv_flag`, `ladder_step`, `ladder_events`), not a stopping state.
   Ladder: j = 1 … 1/step − 1 (scale 1 − step·j, P and Q together), first converging j accepted; none → island
   de-energized. NR from flat start, one retry from DC-angle initialisation. `S_total` is obtained by re-running the
   whole cascade with immediate total loss of any non-convergent island (a V2 §8.7 ladder variant).
7. **Overload**: u = |flow| / rating (DC: MW/MW; AC: max terminal MVA / MVA); overloaded iff u > τ_trip + 1e-9.
   `most_overloaded_first` picks the argmax of u; exact ties → lowest branch *key* (Phase 3; was lowest index), so file row order cannot change results.
8. **Woodbury fast path** (DC, `fast=True`): only when the in-service graph is one island and balance left the base
   dispatch untouched; otherwise the per-island reference solve is used. Equality with the reference is tested.
9. **Contingency ordering**: RESOLVED in Phase 3 — lexicographic is public; see docs/CONTINGENCY_ORDERING.md.
