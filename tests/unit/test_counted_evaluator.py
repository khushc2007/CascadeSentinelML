import numpy as np
from doomsday.oracle.interface import BudgetExhausted, CountedEvaluator, TargetReached
from doomsday.gridtwin.contingency import ContingencySpace, rank_batch, unrank_batch
import itertools

class ToyOracle:
    """Pure toy oracle: S = (sum of indices)/max, so results are known without any grid."""
    def __init__(self, L=8, k=2): self.space = ContingencySpace(L, k); self.fidelity = "dc"; self.calls = 0
    def severity_batch(self, X): self.calls += len(X); return np.array([sum(r) / 100.0 for r in X])
    def with_k(self, k): o = ToyOracle(self.space.L, k); return o

def test_unique_cost_memoisation_and_request_counts():
    ev = CountedEvaluator(ToyOracle())
    ev([0, 1]); ev([1, 0]); ev([0, 2])
    ev.batch(np.array([[0, 1], [0, 2], [3, 4], [3, 4]]))
    assert ev.unique == 3 and ev.requests == 7 and ev.oracle.calls == 3
    assert ev.best_set == (3, 4) and abs(ev.best - 0.07) < 1e-12

def test_trace_and_discovery_use_the_unique_count_at_evaluation_time():
    ev = CountedEvaluator(ToyOracle(), target=0.13, band=1e-9)
    ev.batch(np.array([[0, 1], [0, 2], [6, 7], [5, 7]]))                 # S = .01 .02 .13 .12
    assert ev.trace == [[1, 0.01], [2, 0.02], [3, 0.13]]                   # NOT stamped with the batch-end count (4)
    assert ev.discovery_calls == 3 and ev.within1pct_calls == 3

def test_budget_is_a_hard_cap_on_unique_evaluations():
    ev = CountedEvaluator(ToyOracle(), budget=3)
    ev.batch(np.array([[0, 1], [0, 2]]))
    try:
        ev.batch(np.array([[0, 1], [1, 2], [2, 3]]))                       # 1 new fits, the second new does not
    except BudgetExhausted:
        pass
    else:
        raise AssertionError("budget not enforced")
    assert ev.unique == 3 and ev.oracle.calls == 3
    ev([0, 1])                                                             # memoised repeats stay free after exhaustion

def test_stop_on_target_stops_at_the_discovering_evaluation():
    ev = CountedEvaluator(ToyOracle(), target=0.13, stop_on_target=True)
    try:
        ev.batch(np.array([[0, 1], [6, 7], [5, 7], [4, 7]]))
    except TargetReached:
        pass
    else:
        raise AssertionError
    assert ev.unique == 2 and ev.discovery_calls == 2

def test_partial_cardinality_evaluations_count_but_do_not_touch_best():
    ev = CountedEvaluator(ToyOracle(L=8, k=3))
    ev.batch(np.array([[1], [2]]), j=1)
    assert ev.unique == 2 and ev.best_set is None and ev.trace == []
    ev([0, 1, 2]); assert ev.unique == 3 and ev.best_set == (0, 1, 2)

def test_rank_batch_matches_scalar_rank_and_inverts_unrank_batch():
    from doomsday.gridtwin import contingency as ct
    for L, k in ((12, 3), (20, 4), (186, 3), (186, 5)):
        r = np.random.default_rng(1).integers(0, ct.n_sets(L, k), 500)
        X = unrank_batch(r, L, k)
        assert np.array_equal(rank_batch(X, L, k), r)
        assert all(ct.rank(tuple(row), L, k) == int(v) for row, v in zip(X[:50], r[:50]))
    for bad in (np.array([[1, 1, 2]]), np.array([[2, 1, 3]]), np.array([[0, 1, 99]])):
        try:
            rank_batch(bad, 20, 3)
        except ct.ContingencyError:
            continue
        raise AssertionError(bad)


def test_requests_count_only_served_requests_when_stopped_or_refused():
    ev = CountedEvaluator(ToyOracle(), target=0.13, stop_on_target=True)
    try: ev.batch(np.array([[0, 1], [6, 7], [5, 7], [4, 7]]))
    except TargetReached: pass
    assert ev.requests == 2 and ev.unique == 2                      # the two requests after the discovery were never served
    ev = CountedEvaluator(ToyOracle(), budget=2)
    try: ev.batch(np.array([[0, 1], [0, 2], [0, 3], [0, 4]]))
    except BudgetExhausted: pass
    assert ev.requests == 2 and ev.unique == 2
