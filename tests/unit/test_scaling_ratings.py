import numpy as np
from doomsday.config import load_config
from doomsday.gridtwin.ac import solve_ac
from doomsday.gridtwin.base import BasePointError, build_base_point
from doomsday.gridtwin.loader import load_grid
from doomsday.gridtwin.scaling import apply_stress
from helpers import assert_close

def test_stress_identity_and_scaling():
    g = load_grid("ieee14")
    g1 = apply_stress(g, 1.0)
    assert np.array_equal(g1.Pd, g.Pd) and np.array_equal(g1.gen_Pg, g.gen_Pg)
    g2 = apply_stress(g, 1.1)
    assert_close(g2.Pd, 1.1 * g.Pd, 1e-12)
    assert_close(g2.Qd, 1.1 * g.Qd, 1e-12)
    assert abs(g2.gen_Pg[1] - 44.0) < 1e-12 and g2.gen_Pg[0] == g.gen_Pg[0]    # slack untouched
    assert np.all(g2.gen_Pg <= g2.gen_Pmax) and np.all(g2.gen_Pg >= g2.gen_Pmin)
    try:
        apply_stress(g, 0.9)
    except ValueError:
        pass
    else:
        raise AssertionError("lambda < 1 must be rejected")

def test_stress_clamps_to_generator_limits():
    g = load_grid("ieee14").with_(gen_Pg=np.array([232.4, 139.0, 0, 0, 0.0]))
    assert apply_stress(g, 1.3).gen_Pg[1] == 140.0

def test_base_point_default_config():
    cfg = load_config(); bp = build_base_point("ieee14", cfg)
    assert bp.ac.converged and bp.ac.mismatch_pu < 1e-8
    assert 0.90 <= bp.ac.Vm.min() and bp.ac.Vm.max() <= 1.10
    assert not bp.warnings and bp.grid.gen_Pg[0] < bp.grid.gen_Pmax[0]
    # solved slack generation is written back to the grid and reproduces the AC solution
    assert abs(bp.grid.gen_Pg[0] - bp.ac.bus_gen_p_mw[0]) < 1e-9
    assert abs(solve_ac(bp.grid).bus_gen_p_mw[0] - bp.grid.gen_Pg[0]) < 1e-6

def test_rating_rule_exact_formula():
    cfg = load_config(overrides={"rating": {"family": "proportional"}}); bp = build_base_point("ieee14", cfg); g = bp.grid
    s0 = bp.ac.apparent_mva
    p0 = np.maximum(np.abs(bp.ac.Sf_mva.real), np.abs(bp.ac.St_mva.real))
    f_ac, f_dc = 0.05 * s0.max(), 0.05 * p0.max()
    assert_close(g.rating_ac, np.maximum(1.25 * s0, f_ac), 1e-12)
    assert_close(g.rating_dc, np.maximum(1.25 * p0, f_dc), 1e-12)
    assert abs(bp.rating_info["floor_ac_mva"] - f_ac) < 1e-12
    assert np.all(g.rating_ac >= 1.25 * s0 - 1e-12)

def test_floor_binds_on_low_flow_branch():
    cfg = load_config(overrides={"rating": {"family": "proportional", "headroom_h": 0.15, "floor_frac": 0.30}})
    bp = build_base_point("ieee14", cfg)
    assert np.any(np.isclose(bp.grid.rating_ac, bp.rating_info["floor_ac_mva"]))   # floor active somewhere

def test_infeasible_base_point_raises():
    cfg = load_config()
    g = load_grid("ieee14").with_(Pd=load_grid("ieee14").Pd * 30, Qd=load_grid("ieee14").Qd * 30)
    try:
        build_base_point(g, cfg)
    except BasePointError:
        return
    raise AssertionError("expected BasePointError")

def test_dc_and_ac_base_flows_are_close_but_not_identical():
    bp = build_base_point("ieee14", load_config())
    ac_p = bp.ac.Sf_mva.real
    diff = np.abs(bp.dc.flow_mw - ac_p)
    assert diff.max() < 0.15 * np.abs(ac_p).max()       # sanity bound, not a fidelity claim (fidelity = E3)
    assert diff.max() > 1e-3
