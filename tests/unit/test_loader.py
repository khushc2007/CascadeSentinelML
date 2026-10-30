import numpy as np
from doomsday.gridtwin.loader import load_grid, parse_matpower
from doomsday.gridtwin.islanding import bridges, grid_components
from helpers import TRIANGLE, triangle

def test_case14_tables():
    g = load_grid("ieee14")
    assert (g.n_bus, g.n_branch, g.n_gen) == (14, 20, 5) and g.base_mva == 100
    assert abs(g.total_load_mw - 259.0) < 1e-9 and abs(g.Qd.sum() - 73.5) < 1e-9
    assert g.slack_bus == 0 and (g.bus_type == 2).sum() == 4
    assert g.branch_label(7) == "4-7" and abs(g.tap[7] - 0.978) < 1e-12 and g.tap[0] == 1.0
    assert abs(g.gen_Pmax.sum() - 772.4) < 1e-9
    assert len(g.source["sha256"]) == 64

def test_case14_connectivity_and_bridges():
    g = load_grid("ieee14")
    assert grid_components(g)[0] == 1
    assert bridges(g) == [13]            # only 7-8 (radial bus 8)
    assert g.branch_label(13) == "7-8"

def test_parser_errors_and_comments():
    for bad in ("mpc.baseMVA = 100;", TRIANGLE.replace("mpc.gen", "mpc.zzz")):
        try:
            parse_matpower(bad)
        except ValueError:
            continue
        raise AssertionError("bad case accepted")
    g = parse_matpower("% header\n" + TRIANGLE.replace("mpc.baseMVA = 100;", "mpc.baseMVA = 100; % c"))
    assert g.n_branch == 3

def test_parallel_branches_are_not_bridges():
    t = TRIANGLE.replace("];\n\"\"\"", "")
    t = TRIANGLE.replace(" 2 3 0 0.1 0 0 0 0 0 0 1;\n];", " 2 3 0 0.1 0 0 0 0 0 0 1;\n 2 3 0 0.1 0 0 0 0 0 0 1;\n];")
    g = parse_matpower(t)
    assert g.n_branch == 4 and bridges(g) == []

def test_grid_is_immutable_but_with_copies():
    g = triangle(); g2 = g.with_(Pd=g.Pd * 2)
    assert g.Pd[1] == 60 and g2.Pd[1] == 120
    try:
        g.name = "x"
    except Exception:
        return
    raise AssertionError("Grid should be frozen")
