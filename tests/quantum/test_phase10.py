"""Phase 10: top-T with exclusion list (V2 Problem 5), quadratic surrogate (V2 14.1), weight-k-subspace QAOA (V2 14.2)."""
import importlib.util
from itertools import combinations
from math import comb
import numpy as np, pytest
from doomsday.qsearch.predicate import PredicateTable
from doomsday.qsearch.qaoa import SubspaceQAOA, qiskit_circuit, sample
from doomsday.qsearch.surrogate import QuadraticSurrogate, pair_set, r2
from doomsday.qsearch.topt import expected_topT_cost, exclusion_comparators, top_t, top_t_threshold

HAVE_QISKIT = importlib.util.find_spec("qiskit_aer") is not None

def test_topT_returns_the_T_largest_values_distinct_and_with_ties():
    rng = np.random.default_rng(0)
    for S in (rng.permutation(np.linspace(0, 1, 300)), np.round(rng.random(400), 1)):          # distinct; heavy ties
        pt = PredicateTable(S)
        for T in (1, 5, 10):
            ok = [top_t(pt, T, np.random.default_rng(s))["correct_topT_values"] for s in range(30)]
            assert np.mean(ok) >= 0.9
            r = top_t(pt, T, np.random.default_rng(1)); assert len(set(r["found"])) == len(r["found"])

def test_topT_cost_scales_like_sum_sqrt_N_over_j():
    S = np.random.default_rng(3).permutation(np.linspace(0, 1, 2000)); pt = PredicateTable(S)
    m = {T: np.mean([top_t(pt, T, np.random.default_rng(s))["quantum_oracle_calls"] for s in range(40)]) for T in (1, 4, 16)}
    # FINDING (documented in topt.py / E9): V2's literal exclusion-list scheme re-searches ~N sets per round -> ~linear in T
    assert m[1] < m[4] < m[16] and m[16] / m[1] > 8
    t = {T: np.mean([top_t_threshold(pt, T, np.random.default_rng(s))["quantum_oracle_calls"] for s in range(40)]) for T in (1, 16)}
    assert t[16] / t[1] < 4 and t[16] < m[16] / 3                     # threshold-list scheme: sub-linear (sqrt-like) growth in T
    assert all(top_t_threshold(pt, 10, np.random.default_rng(s))["correct_topT_values"] for s in range(10))
    assert abs(expected_topT_cost(10_000, 1) - 100) < 1e-9 and exclusion_comparators(10, 3) == 30

def test_topT_rejects_bad_T():
    with pytest.raises(ValueError):
        top_t(PredicateTable(np.arange(5.0)), 6, np.random.default_rng(0))

def test_surrogate_k2_full_quadratic_is_exact():
    L, k = 9, 2; X = np.array(list(combinations(range(L), k))); y = np.random.default_rng(0).random(len(X))
    s = QuadraticSurrogate(L, pair_set(L, mode="all"), ridge=1e-10).fit(X, y)
    assert np.abs(s.predict(X) - y).max() < 1e-6 and r2(y, s.predict(X)) > 1 - 1e-9 and s.fit_info["effective_rank"] < s.fit_info["n_params"]
    ising = s.ising(); x0 = X[3]; v = ising["c0"] + ising["h"][list(x0)].sum() + ising["J"].get(tuple(x0), 0.0)
    assert abs(v - s.predict(X[3:4])[0]) < 1e-9

def test_qaoa_mixer_is_unitary_and_preserves_weight_and_p0_is_uniform():
    L, k = 7, 3; cost = np.random.default_rng(1).random(comb(L, k)); qa = SubspaceQAOA(L, k, cost)
    psi = qa.state([0.4, 1.1], [0.3, 0.9]); assert abs(np.linalg.norm(psi) - 1) < 1e-12
    assert np.allclose(np.abs(qa.state([], [])) ** 2, 1 / comb(L, k))
    U = np.stack([qa.mixer(np.eye(qa.N, dtype=complex)[i].copy(), 0.37) for i in range(qa.N)], axis=1); assert np.allclose(U.conj().T @ U, np.eye(qa.N), atol=1e-12)

def test_qaoa_optimizer_improves_on_uniform_and_finds_planted_optimum():
    L, k = 10, 3; states = list(combinations(range(L), k)); rng = np.random.default_rng(4); cost = rng.normal(0, 0.1, len(states)); istar = 17; cost[istar] = 1.0
    qa = SubspaceQAOA(L, k, cost); res = qa.optimize(p_max=3, starts=4, seed=0)
    assert res[3]["expected_surrogate"] > cost.mean() + 0.05 and res[3]["prob"][istar] > 5 / len(states)
    assert np.isclose(res[3]["prob"].sum(), 1) and len(sample(res[3]["prob"], 100, np.random.default_rng(0))) == 100

@pytest.mark.skipif(not HAVE_QISKIT, reason="qiskit-aer not installed")
def test_qaoa_subspace_simulation_equals_qiskit_circuit():
    from qiskit.quantum_info import Statevector
    L, k = 6, 2; X = np.array(list(combinations(range(L), k))); y = np.random.default_rng(2).random(len(X))
    s = QuadraticSurrogate(L, pair_set(L, mode="all"), ridge=1e-10).fit(X, y); cost = s.predict(X)
    qa = SubspaceQAOA(L, k, cost); g, b = [0.7, 1.3], [0.4, 0.8]; p_sub = np.abs(qa.state(g, b)) ** 2
    sv = Statevector(qiskit_circuit(L, k, s.ising(), g, b)).data; masks = [sum(1 << q for q in st) for st in X]
    assert np.allclose(np.abs(sv[masks]) ** 2, p_sub, atol=1e-9) and abs(1 - np.sum(np.abs(sv[masks]) ** 2)) < 1e-9
