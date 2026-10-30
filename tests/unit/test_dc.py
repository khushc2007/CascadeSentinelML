import numpy as np
from doomsday.gridtwin.dc import dc_power_flow, dc_base_injections
from doomsday.gridtwin.loader import load_grid
from helpers import assert_close, triangle

def test_U1_hand_solved_triangle():
    g = triangle()
    r = dc_power_flow(g, [100.0, -60.0, -40.0])
    # hand solution (b=10 pu each): theta2=-0.053333, theta3=-0.046667; flows 53.333, 46.667, -6.6667 MW
    assert_close(r.theta, [0, -0.16 / 3, -0.14 / 3], 1e-12)
    assert_close(r.flow_mw, [160 / 3, 140 / 3, -20 / 3], 1e-9)
    assert abs(r.slack_pickup_mw - 100.0) < 1e-9

def test_dc_outage_chain_hand_solved():
    g = triangle()
    s = g.br_status.copy(); s[1] = 0                   # lose 1-3: chain 1-2-3
    r = dc_power_flow(g, [100.0, -60.0, -40.0], s)
    assert_close(r.flow_mw, [100.0, 0.0, 40.0], 1e-9)  # 1->2 carries all 100, 2->3 carries 40

def test_nodal_balance_case14():
    g = load_grid("ieee14")
    p = -g.Pd.copy(); p[0] = g.Pd.sum()
    r = dc_power_flow(g, p)
    from doomsday.gridtwin.dc import incidence
    net = incidence(g).T @ r.flow_mw                    # outflow per bus
    assert_close(net, p, 1e-9)

def test_islanded_network_rejected():
    g = load_grid("ieee14"); s = g.br_status.copy(); s[13] = 0
    try:
        dc_power_flow(g, np.zeros(14), s)
    except ValueError:
        return
    raise AssertionError("islanded DC solve should be rejected in Phase 1")

def test_dc_slack_loss_handling_resolution_C():
    from doomsday.config import load_config
    from doomsday.gridtwin.base import build_base_point
    bp = build_base_point("ieee14", load_config())
    assert abs(bp.dc_injections_mw.sum()) < 1e-9        # lossless DC balance
    assert abs(bp.dc_loss_pickup_mw - bp.ac.losses_mw) < 1e-12
    slack_ac = bp.ac.P_inj_mw[0]
    assert abs((slack_ac - bp.dc_injections_mw[0]) - bp.ac.losses_mw) < 1e-9
    nonslack = np.arange(1, 14)
    assert_close(bp.dc_injections_mw[nonslack], bp.ac.P_inj_mw[nonslack], 1e-12)
