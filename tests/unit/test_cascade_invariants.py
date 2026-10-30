import itertools
import numpy as np
from doomsday.config import load_config
from doomsday.gridtwin.base import build_base_point
from doomsday.gridtwin.cascade import CascadeEngine
from helpers import assert_close

def _eng():
    cfg = load_config(); bp = build_base_point("ieee14", cfg)
    return bp, CascadeEngine(bp, cfg)

def test_U10_invariants_n1_n2_dc():
    bp, e = _eng(); L = bp.grid.n_branch
    assert e.run([], mode="dc").S == 0.0
    sets = [(i,) for i in range(L)] + list(itertools.combinations(range(L), 2))
    for K in sets:
        r = e.run(list(K), mode="dc"); rr = e.run(list(reversed(K)), mode="dc")
        assert 0.0 <= r.S <= 1.0 and 0.0 <= r.S0 <= 1.0
        assert r.S0 <= r.S + 1e-12 and r.C >= -1e-12 and abs(r.C - (r.S - r.S0)) < 1e-12
        assert (r.S, r.S0, r.status, r.trips_per_round) == (rr.S, rr.S0, rr.status, rr.trips_per_round)   # order invariance
        sv = r.served_fraction_by_round
        assert all(sv[i + 1] <= sv[i] + 1e-12 for i in range(len(sv) - 1))                                 # no load restoration
        assert r.status in ("STABLE", "TOTAL_LOSS", "EXHAUSTED") and len(r.trips_per_round) == r.rounds

def test_n1_all_stable_zero_severity_both_engines():
    bp, e = _eng()
    for l in range(bp.grid.n_branch):
        for mode in ("dc", "ac"):
            r = e.run([l], mode=mode)
            assert r.status == "STABLE" and r.S == 0.0 and r.rounds == 1, (l, mode, r.status, r.S)

def test_no_outage_reproduces_base_flows_and_loadings():
    bp, e = _eng(); g = bp.grid
    f0 = e.run([], mode="dc").frames[0]["loading"]
    assert_close([f0[str(l)] for l in range(g.n_branch)], np.abs(bp.dc.flow_mw) / g.rating_dc, 1e-9)
    f1 = e.run([], mode="ac").frames[0]["loading"]
    assert_close([f1[str(l)] for l in range(g.n_branch)], bp.ac.apparent_mva / g.rating_ac, 1e-7)

def test_U6_island_balance_conservation_all_n2_dc_and_sample_ac():
    bp, e = _eng(); L = bp.grid.n_branch; n_isl = 0
    pairs = list(itertools.combinations(range(L), 2))
    for mode, subset in (("dc", pairs), ("ac", pairs[::7])):
        for K in subset:
            r = e.run(list(K), mode=mode, record_balance=True)
            for rec in r.balance_log:
                if rec["dead"]:
                    assert rec["gen_mw"] == 0.0; n_isl += 1
                else:
                    assert abs(rec["gen_mw"] - rec["load_mw"]) < 1e-8, (K, rec)
    assert n_isl > 0                                  # dead islands were genuinely exercised

def test_fast_woodbury_path_equals_reference_all_n2_and_samples_n3():
    bp, e = _eng(); L = bp.grid.n_branch
    sets = list(itertools.combinations(range(L), 2)) + list(itertools.combinations(range(L), 3))[::9]
    for K in sets:
        a = e.run(list(K), mode="dc", fast=False); b = e.run(list(K), mode="dc", fast=True)
        assert (a.status, a.rounds, a.trips_per_round) == (b.status, b.rounds, b.trips_per_round), K
        assert abs(a.S - b.S) < 1e-9 and abs(a.S0 - b.S0) < 1e-9

def test_determinism_repeat_runs_identical():
    bp, e = _eng()
    for mode in ("dc", "ac"):
        a = e.run([0, 4, 9], mode=mode); b = CascadeEngine(bp, load_config()).run([0, 4, 9], mode=mode)
        assert (a.S, a.S0, a.trips_per_round, a.status) == (b.S, b.S0, b.trips_per_round, b.status)
        assert a.frames == b.frames

def test_json_serialisable_result():
    import json
    bp, e = _eng()
    d = e.run([0, 1], mode="ac").to_dict()
    json.dumps(d)
    assert set(d["metrics"]) >= {"S", "S0", "C", "rounds", "status", "ladder_step", "S_total"}
