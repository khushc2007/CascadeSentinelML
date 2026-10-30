import numpy as np
from doomsday.config import load_config, config_hash
from doomsday.gridtwin.ac import solve_ac
from doomsday.gridtwin.base import build_base_point
from doomsday.gridtwin.dc import dc_power_flow
from doomsday.gridtwin.islanding import bridges
from doomsday.gridtwin.security import n1_report, base_overloads
from helpers import assert_close

def _bp(**rating):
    return build_base_point("ieee14", load_config(overrides={"rating": rating}))

def test_baseline_v2_rule_still_fails_n1_and_is_preserved():
    bp = _bp(family="proportional")
    for mode in ("dc", "ac"):
        rep = n1_report(bp, mode)
        assert rep["n1_violations"] == 18 and not rep["secure"] and rep["base_overloads"] == []
    assert bp.rating_info["family"] == "proportional"

def test_extension_is_n1_secure_both_engines_by_construction():
    bp = _bp(family="n1_covering", n1_margin_m=0.05)
    for mode in ("dc", "ac"):
        rep = n1_report(bp, mode)
        assert rep["secure"] and rep["n1_violations"] == 0 and rep["n_bridges"] == 1
        assert rep["base_overloads"] == []
        assert rep["rows"] and max(r["max_loading"] for r in rep["rows"] if not r["bridge"]) <= 1 / 1.05 + 1e-9

def test_extension_formula_independent_recomputation():
    m = 0.05
    bp = _bp(family="n1_covering", n1_margin_m=m); g = bp.grid
    br = set(bridges(g)); post_dc = np.zeros(g.n_branch); post_ac = np.zeros(g.n_branch)
    for l in range(g.n_branch):
        if l in br: continue
        s = g.br_status.copy(); s[l] = 0
        post_dc = np.maximum(post_dc, np.abs(dc_power_flow(g, bp.dc_injections_mw, s).flow_mw))
        post_ac = np.maximum(post_ac, solve_ac(g, s).apparent_mva)
    base_ac, base_dc = bp.rating_info["baseline_rating_ac"], bp.rating_info["baseline_rating_dc"]
    assert_close(g.rating_ac, np.maximum(base_ac, (1 + m) * post_ac), 1e-9)
    assert_close(g.rating_dc, np.maximum(base_dc, (1 + m) * post_dc), 1e-9)
    # baseline arrays are exactly the V2 5.3 baseline
    ref = _bp(family="proportional").grid
    assert_close(base_ac, ref.rating_ac, 1e-12); assert_close(base_dc, ref.rating_dc, 1e-12)
    assert np.all(g.rating_ac >= base_ac - 1e-12) and np.all(g.rating_dc >= base_dc - 1e-12)
    assert bp.rating_info["n_branches_covering_term_binds_dc"] >= 15      # measured: V2 rule fails for 17/20 branches

def test_margin_monotone_and_hash_distinguishes_families():
    r = [_bp(n1_margin_m=m).grid.rating_dc for m in (0.05, 0.10, 0.20)]
    assert np.all(r[1] >= r[0] - 1e-12) and np.all(r[2] >= r[1] - 1e-12) and np.any(r[2] > r[0] + 1e-9)
    assert config_hash(load_config(overrides={"rating": {"family": "proportional"}})) != config_hash(load_config())

def test_default_base_point_is_secure_and_ratings_documented():
    bp = build_base_point("ieee14", load_config())
    assert bp.rating_info["family"] == "n1_covering" and bp.rating_info["margin_m"] == 0.05
    assert base_overloads(bp, "dc")[0] == [] and base_overloads(bp, "ac")[0] == []
