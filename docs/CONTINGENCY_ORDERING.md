# Contingency ordering: lexicographic is the public order; V2 §5.4's printed formula is colexicographic

V2 §5.4 says outage sets are enumerated "in lexicographic order of sorted branch indices" and then prints the
combinatorial-number-system formula `r = Σ C(c_i, i)` (c_k > … > c_1). That formula is a bijection onto [0, N) but it
enumerates sets in **colexicographic** order, so the text and the formula describe different orderings.

**Decision (approved):** the public ordering is lexicographic (`doomsday/gridtwin/contingency.py`):
`rank(x) = Σ_i [ C(L-prev_i-1, k-i+1) - C(L-c_i, k-i+1) ]`, `unrank` by slot-wise descent, vectorised `unrank_batch`.
`colex_rank/colex_unrank` are kept only as a reference for the printed formula and are tested to be a *different*
bijection (hand values for L=6,k=3, x=(0,1,5): lex rank 3, colex rank 10).
Both orderings have identical Grover/query-complexity properties; only the labelling r ↔ set differs.

Tests: rank(unrank(r))==r and unrank(rank(x))==x exhaustively for small (L,k) incl. k=0 and k=L, and on random ranks
for (L,k) up to (186,6) and (2896,4); batch == scalar; chunked enumeration == itertools.combinations order.

## Public identity under branch reordering
Rank and index tuples are relative to the case-file branch order. The *public identity* of an outage set is the sorted
tuple of branch keys `(lo_bus_id, hi_bus_id, ordinal)` (`ContingencySpace.identity`), independent of row order; parallel
branches are ordered by their electrical parameters. `translate_outage` converts between orderings. Every oracle
namespace includes the grid content hash (row-order independent) AND the branch-order fingerprint, so cached values
can never be reused across different orderings. Known limitation: generators sharing one bus are not distinguished by key
(the first in the table takes the slack residual / Vset).
