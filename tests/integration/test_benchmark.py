import json, math, tempfile
import numpy as np
from doomsday.config import load_config
from doomsday.experiments import benchmark as bm
from doomsday.gridtwin.base import build_base_point
from doomsday.oracle.factory import make_oracle
from doomsday.oracle.table_oracle import TableOracle, generate_truth_table

CFG = load_config(); BP = build_base_point("ieee14", CFG); _R = tempfile.mkdtemp()
def tab(fid, k):
    ds = [generate_truth_table(make_oracle(fid, j, CFG, bp=BP, use_cache=False), _R, grid_name="ieee14") for j in range(1, k + 1)]
    return TableOracle.load(ds, k)

def test_reference_matches_independent_computation():
    o = tab("dc", 3); ref = bm.reference(o); S = o.all_severities()
    assert ref["N"] == 1140 and ref["Smax"] == S.max() and ref["M_at_Smax"] == int(np.sum(S >= S.max() - 1e-9))
    assert ref["top10"]["tie_expanded_size"] == len(ref["top10"]["ranks"]) >= 10 and ref["top10"]["s_T"] == np.sort(S)[::-1][9]
    assert all(S[r] >= ref["top10"]["s_T"] - 1e-9 for r in ref["top10"]["ranks"]) and ref["top100"]["tie_expanded_size"] >= 100
    b = bm.budgets_for(1140); assert b["1*sqrtN"] == 34 and b["22.5*sqrtN"] == math.ceil(22.5 * math.sqrt(1140)) and b["0.5N"] == 570

def test_end_to_end_mini_suite_schema_reproducibility_and_internal_consistency():
    o = tab("dc", 2); ac = tab("ac", 2); ref = bm.reference(o)
    suite = [("brute", {}), ("random", {}), ("hillclimb", {"n_starts": 3}), ("beam", {"width": 5}), ("sa", {"n_iter": 500}), ("ga", {"n_gen": 20}),
             ("lodf_pool", {"m": 8}), ("ml_screen", {"n_train": 30, "T": 15}), ("milp", {"n_solutions": 2}), ("bnb", {"theta": 0.5})]
    rows = bm.run_suite(o, "ieee14", ref, seeds=range(3), suite=suite, ac_table=ac)
    rows2 = bm.run_suite(o, "ieee14", ref, seeds=range(3), suite=suite, ac_table=ac)
    need = {"algorithm", "grid", "k", "objective", "oracle_calls", "candidate_evaluations", "runtime_s", "best_severity", "best_contingency",
            "success", "success_at", "best_at", "discovery_calls", "calls_to_within_1pct", "seed", "oracle_kind", "fidelity", "coverage_top10", "ac_severity_of_best"}
    strip = lambda r: {k: v for k, v in r.items() if k not in ("runtime_s", "cpu_s", "aux")}
    for a, b in zip(rows, rows2):
        assert need <= set(a), need - set(a)
        assert strip(a) == strip(b)                                             # fully reproducible apart from wall-clock
        assert a["grid"] == "ieee14" and a["k"] == 2 and a["objective"] == "max_severity" and a["oracle_kind"] == "table"
        assert a["candidate_evaluations"] >= a["oracle_calls"] >= 1 and a["runtime_s"] >= 0
        assert a["success"] == (a["best_severity"] >= ref["Smax"] - 1e-9) == (a["gap_to_Smax"] <= 1e-9)
        if a["discovery_calls"] is not None:
            assert a["success"] and a["discovery_calls"] <= a["oracle_calls"] and a["success_at"]["0.5N"] == (a["discovery_calls"] <= 95)
            assert _trace_reaches(a["trace"], ref["Smax"]) == a["discovery_calls"]       # discovery recorded == first trace entry at Smax
        assert abs(a["ac_severity_of_best"] - ac.severity(tuple(a["best_contingency"]))) < 1e-15 and 0 <= a["coverage_top10"] <= 1
        json.dumps(a)
    b = [r for r in rows if r["algorithm"] == "brute"][0]
    assert b["oracle_calls"] == 190 and b["success"] and b["coverage_top10"] == 1.0 and b["coverage_top100"] == 1.0 and b["certified_stop_calls"] == 190
    agg = bm.aggregate(rows, ref); assert len(agg) == len(suite)
    for a in agg.values():
        assert a["n_runs"] in (1, 3) and 0 <= a["success_rate"] <= 1 and set(a["success_rate_at"]) == set(bm.budgets_for(190))

def _trace_reaches(trace, smax):
    for c, s in trace:
        if s >= smax - 1e-9: return c

def test_aggregate_statistics_on_hand_made_rows():
    ref = {"N": 100, "k": 2, "Smax": 1.0}
    mk = lambda d, calls: {"algorithm": "x", "params": {}, "discovery_calls": d, "success": d is not None, "oracle_calls": calls, "candidate_evaluations": calls,
                           "runtime_s": 1.0, "best_severity": 1.0 if d else 0.5, "completed": True, "certified_stop_calls": None, "exact": None, "label": "",
                           "success_at": {"b": d is not None and d <= 10}}
    a = list(bm.aggregate([mk(5, 5), mk(15, 15), mk(None, 40), mk(10, 10)], ref).values())[0]
    assert a["n_runs"] == 4 and a["n_success"] == 3 and a["success_rate"] == 0.75 and a["success_rate_at"]["b"] == 0.5
    assert a["discovery_calls"]["mean"] == 10.0 and a["discovery_calls"]["median"] == 10.0 and a["discovery_calls"]["n"] == 3     # failures excluded from discovery stats but counted
    assert abs(a["discovery_over_sqrtN_mean"] - 1.0) < 1e-12

def test_fit_alpha_recovers_known_power_law_and_refuses_few_points():
    pts = [(100, 3 * 100 ** 0.5), (1000, 3 * 1000 ** 0.5), (10000, 3 * 10000 ** 0.5)]
    f = bm.fit_alpha(pts); assert abs(f["alpha"] - 0.5) < 1e-9 and abs(f["kappa"] - 3) < 1e-9
    assert bm.fit_alpha(pts[:2]) is None and bm.fit_alpha([(1, 0), (2, 0), (3, 0)]) is None
