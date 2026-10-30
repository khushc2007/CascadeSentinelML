import numpy as np
from doomsday.experiments import ranking_metrics as rm

def test_tie_expanded_topT_definition():
    S = np.array([0.9, 0.5, 0.5, 0.5, 0.5, 0.1, 0.0])
    assert rm.s_T(S, 3) == 0.5
    assert rm.tie_expanded_topT(S, 3).tolist() == [0, 1, 2, 3, 4]              # all ties at s_T are included
    assert rm.tie_expanded_topT(S, 1).tolist() == [0]
    S2 = np.array([0.5, 0.5 - 5e-10, 0.5 - 2e-9]); assert rm.tie_expanded_topT(S2, 1).tolist() == [0, 1]   # 1e-9 band
    assert rm.deterministic_topT(S, 3).tolist() == [0, 1, 2]                    # ties by index

def test_primary_metric_is_tie_robust_while_deterministic_overlap_is_not():
    # Variant b is a permutation of tied candidates: same severities -> tie-expanded Jaccard must be exactly 1.
    rng = np.random.default_rng(0)
    S = np.concatenate([[0.9], np.full(40, 0.5), rng.uniform(0, 0.3, 59)])
    Sb = S.copy(); Sb[1:41] = 0.5                                              # identical values ...
    Sb2 = S.copy(); Sb2[[1, 2, 3]], Sb2[[60, 61, 62]] = Sb2[[60, 61, 62]], Sb2[[1, 2, 3]]   # swap 3 tied members with 3 low ones
    r = rm.topT_stability(S, Sb, Ts=(10,))["top10"]
    assert r["tie_expanded_jaccard"] == 1.0 and r["tie_expanded_size"] == [41, 41] and r["distinct_levels_in_region"] == [2, 2]
    r2 = rm.topT_stability(S, Sb2, Ts=(10,))["top10"]
    assert r2["tie_expanded_jaccard"] < 1.0                                    # a real change is detected
    # deterministic overlap alone would call b2 "different" for an arbitrary reason (tie-break): secondary only
    assert r["deterministic_overlap_secondary"] == 1.0

def test_distinct_levels_and_spearman_ties():
    assert rm.distinct_levels([0.5, 0.5 + 5e-10, 0.3, 0.3, 0.0]) == 3 and rm.distinct_levels([]) == 0
    a = np.array([1, 2, 2, 3.0]); assert abs(rm.spearman(a, a) - 1) < 1e-12 and abs(rm.spearman(a, -a) + 1) < 1e-12
    assert np.isnan(rm.spearman(np.ones(4), a))
    from scipy.stats import spearmanr
    b = np.array([4, 4, 1, 2.0]); assert abs(rm.spearman(a, b) - spearmanr(a, b)[0]) < 1e-12

def test_feasibility_and_informative_flags():
    S = np.zeros(50); S[:3] = [0.9, 0.5, 0.2]
    r = rm.topT_stability(S, S, Ts=(10, 100))
    assert r["top100"]["feasible"] is False and r["top10"]["informative"] is False and r["top10"]["tie_expanded_size"] == [50, 50]
    assert r["spearman"] == 1.0
    try:
        rm.topT_stability(S, S[:-1])
    except ValueError:
        return
    raise AssertionError("misaligned vectors accepted")
