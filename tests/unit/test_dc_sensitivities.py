import itertools
import networkx as nx
import numpy as np
from doomsday.config import load_config
from doomsday.gridtwin.base import build_base_point
from doomsday.gridtwin.dc import DCSensitivities, dc_power_flow
from doomsday.gridtwin.islanding import bridges, grid_components
from helpers import assert_close

def _setup():
    bp = build_base_point("ieee14", load_config())
    return bp, DCSensitivities(bp.grid, bp.dc_injections_mw)

def test_U3_lodf_matches_full_resolve_all_n1():
    bp, S = _setup(); g = bp.grid; br = set(bridges(g))
    for m in range(g.n_branch):
        if m in br: continue
        s = g.br_status.copy(); s[m] = 0
        direct = dc_power_flow(g, bp.dc_injections_mw, s).flow_mw
        lodf = S.flow0_mw + S.lodf(m) * S.flow0_mw[m]; lodf[m] = 0
        assert_close(lodf, direct, 1e-8, f"LODF outage {m}")
        assert_close(S.post_outage_flows([m]), direct, 1e-8, f"woodbury outage {m}")

def test_U4_woodbury_matches_resolve_k_up_to_6():
    bp, S = _setup(); g = bp.grid
    rng = np.random.default_rng(12345); n_ok = 0
    for trial in range(400):
        k = int(rng.integers(1, 7)); K = sorted(rng.choice(g.n_branch, k, replace=False).tolist())
        s = g.br_status.copy(); s[K] = 0
        if grid_components(g, s)[0] != 1: continue
        direct = dc_power_flow(g, bp.dc_injections_mw, s).flow_mw
        assert_close(S.post_outage_flows(K), direct, 1e-7, f"K={K}")
        n_ok += 1
    assert n_ok >= 100

def test_U5_singularity_coincides_with_disconnection():
    bp, S = _setup(); g = bp.grid
    rng = np.random.default_rng(7); n_dis = n_con = 0
    for trial in range(600):
        k = int(rng.integers(1, 7)); K = sorted(rng.choice(g.n_branch, k, replace=False).tolist())
        s = g.br_status.copy(); s[K] = 0
        G = nx.Graph(); G.add_nodes_from(range(g.n_bus))
        G.add_edges_from((int(g.br_from[l]), int(g.br_to[l])) for l in range(g.n_branch) if s[l] > 0)
        disconnected = not nx.is_connected(G)
        smin = np.linalg.svd(np.eye(k) - S.Phi[np.ix_(K, K)], compute_uv=False).min()
        assert disconnected == (smin < 1e-9), (K, smin, disconnected)
        assert (grid_components(g, s)[0] > 1) == disconnected
        n_dis += disconnected; n_con += (not disconnected)
    assert n_dis > 20 and n_con > 100          # both classes genuinely exercised

def test_woodbury_refuses_singular_instead_of_dividing():
    bp, S = _setup()
    try:
        S.post_outage_flows([13])            # bridge 7-8
    except np.linalg.LinAlgError:
        return
    raise AssertionError("expected LinAlgError for a disconnecting outage")
