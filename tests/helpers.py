import numpy as np
from doomsday.gridtwin.loader import parse_matpower

# Hand-solvable triangle: bus1 slack gen, loads 0.6 pu (bus2) and 0.4 pu (bus3), all x = 0.1 pu, r=0, base 100 MVA.
TRIANGLE = """
mpc.baseMVA = 100;
mpc.bus = [
 1 3 0 0 0 0 1 1.0 0 0 1 1.1 0.9;
 2 1 60 0 0 0 1 1.0 0 0 1 1.1 0.9;
 3 1 40 0 0 0 1 1.0 0 0 1 1.1 0.9;
];
mpc.gen = [ 1 100 0 100 -100 1.0 100 1 300 0; ];
mpc.branch = [
 1 2 0 0.1 0 0 0 0 0 0 1;
 1 3 0 0.1 0 0 0 0 0 0 1;
 2 3 0 0.1 0 0 0 0 0 0 1;
];
"""

def triangle():
    return parse_matpower(TRIANGLE, "triangle")

def assert_close(a, b, tol, msg=""):
    a, b = np.asarray(a, float), np.asarray(b, float)
    err = float(np.max(np.abs(a - b)))
    assert err <= tol, f"{msg} max abs error {err:.3e} > {tol:.1e}"


from doomsday.gridtwin.ac import solve_ac
from doomsday.gridtwin.base import BasePoint
from doomsday.gridtwin.dc import dc_base_injections, dc_power_flow

def make_bp(case_text, rating_mw, name="toy"):
    """BasePoint for a hand-made case with explicit ratings (scalar or per-branch list), same for DC (MW) and AC (MVA)."""
    g = parse_matpower(case_text, name)
    ac = solve_ac(g, tol=1e-12)
    assert ac.converged
    p, loss = dc_base_injections(g, ac)
    r = np.broadcast_to(np.asarray(rating_mw, float), (g.n_branch,)).copy()
    g = g.with_(rating_ac=r, rating_dc=r.copy())
    from doomsday.gridtwin.identity import grid_content_hash, order_fingerprint
    g0 = parse_matpower(case_text, name)
    return BasePoint(g, ac, dc_power_flow(g, p), p, loss, {"family": "manual"}, [], grid_content_hash(g0), order_fingerprint(g0))

def chain4(pmin1=0.0, pmax1=100.0):
    """1-2-3-4 chain, x=0.1, r=0. Gens: bus1 (slack) Pg=70, bus4 Pg=30/Pmax=50. Loads: bus2 40, bus3 60 (MW)."""
    return f"""mpc.baseMVA = 100;
mpc.bus = [ 1 3 0 0 0 0 1 1.0 0 0 1 1.1 0.9; 2 1 40 0 0 0 1 1.0 0 0 1 1.1 0.9;
            3 1 60 0 0 0 1 1.0 0 0 1 1.1 0.9; 4 2 0 0 0 0 1 1.0 0 0 1 1.1 0.9; ];
mpc.gen = [ 1 70 0 100 -100 1.0 100 1 {pmax1} {pmin1}; 4 30 0 100 -100 1.0 100 1 50 0; ];
mpc.branch = [ 1 2 0 0.1 0 0 0 0 0 0 1; 2 3 0 0.1 0 0 0 0 0 0 1; 3 4 0 0.1 0 0 0 0 0 0 1; ];"""


class Skipped(Exception):
    pass

def skip(msg):
    try:
        import pytest
        pytest.skip(msg)
    except ImportError:
        raise Skipped(msg)


def permute_grid(grid, branch_perm, gen_perm=None):
    """Same physical grid with branch rows (and optionally generator rows) in a different order."""
    bp_ = np.asarray(branch_perm)
    ch = {n: getattr(grid, n)[bp_] for n in ("br_from", "br_to", "r", "x", "b", "tap", "shift", "br_status",
                                             "br_is_transformer", "rate_a_case", "rating_ac", "rating_dc")}
    if gen_perm is not None:
        gp = np.asarray(gen_perm)
        ch.update({n: getattr(grid, n)[gp] for n in ("gen_bus", "gen_Pg", "gen_Qg", "gen_Pmax", "gen_Pmin",
                                                     "gen_Qmax", "gen_Qmin", "gen_Vset", "gen_status")})
    return grid.with_(**ch)
