import math, tempfile
import numpy as np
from doomsday.config import load_config
from doomsday.gridtwin.base import build_base_point
from doomsday.oracle.factory import make_oracle
from doomsday.oracle.interface import SearchResult
from doomsday.oracle.table_oracle import TableOracle, generate_truth_table
from doomsday.qsearch.accounting import QuantumCounter
from doomsday.qsearch.bbht import bbht_search
from doomsday.qsearch.counting import expected_grover_calls, marked_count
from doomsday.qsearch.dh_gas import DH_BOUND, dh_max, durr_hoyer
from doomsday.qsearch.emulation import MarkedSet, collapsed_trajectory, full_vector_trajectory, optimal_r, p_closed, theta_of
from doomsday.qsearch.grover import grover_known_M
from doomsday.qsearch.predicate import PredicateTable

def test_Q5_collapsed_equals_full_vector_equals_closed_form():
    rng = np.random.default_rng(0)
    for N, M in ((15, 1), (56, 4), (190, 1), (1140, 3), (1140, 100), (4845, 7), (2000, 1000), (50, 49)):
        mask = np.zeros(N, bool); mask[rng.choice(N, M, replace=False)] = True; r_max = 60
        a, b, pm = collapsed_trajectory(N, M, r_max); R, pf = full_vector_trajectory(mask, r_max); pc = p_closed(np.arange(r_max + 1), N, M)
        assert np.abs(pm - pf).max() < 1e-12 and np.abs(pm - pc).max() < 1e-12, (N, M)
        assert np.abs(R[:, mask] - a[:, None]).max() < 1e-12 and np.abs(R[:, ~mask] - b[:, None]).max() < 1e-12          # amplitudes, not only probabilities
        assert np.abs((R ** 2).sum(axis=1) - 1).max() < 1e-12                                                          # norm preserved

def test_v2_worked_numbers_by_exact_arithmetic_and_one_documented_v2_discrepancy():
    assert abs(theta_of(1140, 1) - 0.02962) < 5e-6 and optimal_r(1140, 1) == 26                    # V2: theta=0.02962, r*~26
    assert abs(theta_of(15, 1) - 0.2612) < 1e-4                                                     # V2: theta = 0.2612
    assert abs(float(p_closed(3, 15, 1)) - 0.935) < 5e-4                                            # V2: r=3 -> 0.935  (matches)
    assert abs(float(p_closed(2, 15, 1)) - 0.931399) < 1e-6                                         # exact value; V2 prints 0.933 (small arithmetic slip in V2)
    assert abs(float(p_closed(2, 15, 1)) - 0.933) > 1e-3
    N = 1_055_240; th = theta_of(N, 1); assert optimal_r(N, 1) == 806 and abs(math.pi / (4 * th) - 806.80) < 0.01          # V2: r* ~ 806 (matches)
    P = p_closed(np.arange(800, 813), N, 1); assert 800 + int(np.argmax(P)) == 806 and float(P[6]) > 0.999999            # 806 is the true integer maximiser
    for N, M in ((15, 1), (1140, 3), (5000, 40), (100, 20)):
        assert float(p_closed(optimal_r(N, M), N, M)) >= 0.5 - 1e-12

def test_marked_set_sampling_is_correct_and_exhaustively_consistent():
    ms = MarkedSet(50, [3, 4, 17, 49]); un = [ms.unmarked_rank(u) for u in range(46)]
    assert un == [x for x in range(50) if x not in (3, 4, 17, 49)]                                    # u-th unmarked rank mapping is exact
    rng = np.random.default_rng(1); j = 3; p = ms.p_success(j); n = 20000
    out = np.array([ms.sample(j, rng) for _ in range(n)]); hit = np.isin(out, ms.ranks).mean()
    assert abs(hit - p) < 4 * math.sqrt(p * (1 - p) / n)                                              # outcome statistics follow sin^2((2j+1)theta)
    assert set(np.unique(out[np.isin(out, ms.ranks)])) == {3, 4, 17, 49}
    e, f = MarkedSet(10, []), MarkedSet(10, range(10))                                                 # M=0: uniform; M=N: always marked
    assert e.p_success(5) == 0.0 and f.p_success(5) == 1.0 and 0 <= e.sample(2, rng) < 10
    for bad in ([10], [-1]):
        try: MarkedSet(10, bad)
        except ValueError: continue
        raise AssertionError

def test_accounting_identities_and_worked_attempt_log():
    N = 15; S = np.arange(N) / N; pt = PredicateTable(S, construction_evals=N)
    r = dh_max(pt, np.random.default_rng(3), record_log=True); c = r["counter"]; log = c.log
    assert c.attempts == len(log) == c.measurements == c.verifications
    assert c.quantum_oracle_calls == sum(a["j"] + 1 for a in log) and c.grover_iterations == sum(a["j"] for a in log)
    assert c.unique_verifications == len({a["x"] for a in log}) <= c.attempts and c.total_conservative == c.quantum_oracle_calls + c.verifications
    assert c.table_construction_evals == N and c.to_dict()["table_construction_evals"] == N
    ys = [a["y"] for a in log]; assert ys == sorted(ys)                                                # thresholds only ever rise
    assert all((a["success"] is True) == (S[a["x"]] > a["y"] + 1e-9) for a in log)                    # success flag == strict predicate on the sampled x
    assert all(0 <= a["j"] < math.ceil(a["m"]) for a in log)                                          # j drawn from {0..ceil(m)-1}
    assert r["best"] == N - 1 and r["terminated_by"] == "patience"

def test_Q8_dh_termination_ties_and_edge_cases():
    rng = np.random.default_rng
    for S in (np.zeros(40), np.full(40, 0.3), np.array([0.5]), np.array([0.2, 0.2]), np.array([0.0, 0.0, 1.0])):
        pt = PredicateTable(S); r = dh_max(pt, rng(0))
        assert r["terminated_by"] == "patience" and r["counter"].attempts < 10_000                        # always terminates (strict '>' => ties cannot loop)
        if S.max() > 1e-9: assert pt.S[r["best"]] == S.max() or r["best"] is not None
    pt = PredicateTable(np.zeros(40)); r = dh_max(pt, rng(0)); assert r["best"] is None and r["y"] == 0.0 and not r["found_Smax"]    # M=0 from the start
    tied = PredicateTable(np.array([0.1, 0.9, 0.9, 0.9, 0.2] * 20)); ok = sum(dh_max(tied, rng(s))["found_Smax"] for s in range(200))
    assert ok / 200 >= 0.98                                                                              # success defined against Smax (any tied maximiser)
    r = dh_max(PredicateTable(np.linspace(0, 1, 500)), rng(1), budget=30); assert r["terminated_by"] == "budget" and r["counter"].quantum_oracle_calls >= 30
    a, b = dh_max(PredicateTable(np.linspace(0, 1, 500)), rng(7)), dh_max(PredicateTable(np.linspace(0, 1, 500)), rng(7))
    assert a["best"] == b["best"] and a["counter"].to_dict() == b["counter"].to_dict()                    # seeded determinism
    c = dh_max(PredicateTable(np.linspace(0, 1, 500)), rng(7), y0=0.9); assert c["y"] >= 0.9                # heuristic y0: only improvements above it are marked

def test_Q8_statistical_bounds_bbht_and_durr_hoyer_with_stated_theory():
    R = 300
    for N, M in ((190, 1), (1000, 1), (1000, 10)):                 # BBHT (lam=6/5): expected Grover iterations <= 9/2 sqrt(N/M)  (BBHT theorem)
        rng0 = np.random.default_rng(N + M); S = MarkedSet(N, rng0.choice(N, M, replace=False)); ranks = set(S.ranks.tolist()); its = []; ok = 0
        for s in range(R):
            r = bbht_search(S, lambda x: x in ranks, np.random.default_rng(s)); ok += r["found"]; its.append(r["counter"].grover_iterations)
            assert (r["x"] in ranks) if r["found"] else True
        mean, sd = np.mean(its), np.std(its) / math.sqrt(R)
        assert mean - 3 * sd <= 4.5 * math.sqrt(N / M) and ok / R >= 0.98, (N, M, mean, ok / R)
    for N in (15, 190, 1140):                                      # Durr-Hoyer on distinct values: mean calls <= 22.5 sqrtN + 1.4 lg^2 N ; success >= 1 - delta
        calls, ok = [], 0
        for s in range(R):
            S = np.random.default_rng(10_000 + s).permutation(N) / N; r = dh_max(PredicateTable(S), np.random.default_rng(s)); calls.append(r["counter"].quantum_oracle_calls); ok += r["found_Smax"]
        assert np.mean(calls) - 3 * np.std(calls) / math.sqrt(R) <= DH_BOUND(N) and ok / R >= 0.98, (N, np.mean(calls), DH_BOUND(N), ok / R)

def test_bbht_threshold_search_and_grover_known_M_accounting():
    S = MarkedSet(1140, [5, 600, 1000]); r = bbht_search(S, lambda x: x in (5, 600, 1000), np.random.default_rng(0), record_log=True)
    c = r["counter"]; assert r["found"] and c.quantum_oracle_calls == sum(a["j"] + 1 for a in c.log) and r["terminated_by"] == "found"
    e = bbht_search(MarkedSet(100, []), lambda x: False, np.random.default_rng(0)); assert not e["found"] and e["terminated_by"] == "patience"      # M=0 -> not found
    g = grover_known_M(MarkedSet(15, [7]), np.random.default_rng(0)); assert g["r"] == optimal_r(15, 1) == 3 and g["counter"].quantum_oracle_calls == 4 and abs(g["p_success"] - 0.935242) < 1e-6
    hits = sum(grover_known_M(MarkedSet(15, [7]), np.random.default_rng(s))["is_marked"] for s in range(2000)); assert abs(hits / 2000 - 0.935242) < 4 * math.sqrt(.065 * .935 / 2000)
    assert abs(expected_grover_calls(1140, 1) - math.pi / 4 * math.sqrt(1140)) < 1e-12 and expected_grover_calls(10, 0) == float("inf")

def test_durr_hoyer_through_the_oracle_interface_searchresult_schema_and_honest_labels():
    cfg = load_config(); bp = build_base_point("ieee14", cfg); root = tempfile.mkdtemp()
    tab = TableOracle.load(generate_truth_table(make_oracle("dc", 3, cfg, bp=bp, use_cache=False), root, grid_name="ieee14"), 3)
    live = make_oracle("dc", 3, cfg, bp=bp)
    r = durr_hoyer(tab, seed=1, grid="ieee14", record_log=True); r2 = durr_hoyer(live, seed=1, grid="ieee14")
    assert isinstance(r, SearchResult) and r.algorithm == "durr_hoyer_tierB" and "EMULATED" in r.oracle_kind and "EMULATED" in r.label and "NOT a quantum" in r.label
    assert (r.best_contingency, r.best_severity, r.aux["accounting"]["quantum_oracle_calls"]) == (r2.best_contingency, r2.best_severity, r2.aux["accounting"]["quantum_oracle_calls"])
    assert r.aux["accounting"]["table_construction_evals"] == 1140 == r.N and r.oracle_calls == r.aux["accounting"]["unique_verifications"]
    assert r.candidate_evaluations == r.aux["accounting"]["classical_verifications"] and r.best_severity == tab.severity(r.best_contingency)
    assert "speedup" not in r.label.lower() or "no speedup" in r.label.lower()
    S = tab.all_severities(); ok = sum(durr_hoyer(tab, seed=s, pt=PredicateTable.from_oracle(tab)).found_target for s in range(40)); assert ok >= 38
    assert marked_count(PredicateTable(S), 0.3) == int((S >= 0.3 - 1e-9).sum())


def test_dh_safety_valve_fails_loudly_instead_of_hanging():
    try: dh_max(PredicateTable(np.linspace(0, 1, 5000)), np.random.default_rng(0), max_attempts=20)
    except RuntimeError as e: assert "max_attempts" in str(e)
    else: raise AssertionError("attempt cap not enforced")
    r = dh_max(PredicateTable(np.linspace(0, 1, 5000)), np.random.default_rng(0)); assert r["counter"].attempts < 10_000      # correct runs never approach the cap
