import numpy as np
from doomsday.config import load_config
from doomsday.gridtwin.base import build_base_point
from doomsday.gridtwin.security import base_overloads, n1_report
from doomsday.gridtwin.ratings import synthesize_ratings
from doomsday.gridtwin.ac import solve_ac
from doomsday.gridtwin.dc import dc_base_injections, dc_power_flow
from doomsday.gridtwin.base import BasePoint
from helpers import triangle

def _triangle_bp(rating_mw):
    g = triangle(); ac = solve_ac(g)
    p, loss = dc_base_injections(g, ac)
    g = g.with_(rating_ac=np.full(3, rating_mw), rating_dc=np.full(3, rating_mw))
    return BasePoint(g, ac, dc_power_flow(g, p), p, loss, {}, [])

def test_n1_check_machinery_known_answer_triangle():
    # DC base: slack 100 MW. Outage of 1-3 (chain 1-2-3) puts ~100 MW on 1-2 (see test_dc). Outage of 2-3 puts 60 on 1-2 / 40 on 1-3.
    bp = _triangle_bp(rating_mw=90.0)
    rep = n1_report(bp, "dc")
    assert rep["n_bridges"] == 0 and rep["n_branches"] == 3
    by = {r["label"]: r for r in rep["rows"]}
    assert by["1-3"]["overloads"] == [0] and abs(by["1-3"]["max_loading"] - 100 / 90) < 1e-6   # 1-2 overloaded
    assert by["1-2"]["overloads"] == [1]                                                       # 1-3 carries ~100
    assert by["2-3"]["overloads"] == [] and abs(by["2-3"]["max_loading"] - 60 / 90) < 1e-6
    assert rep["n1_violations"] == 2 and not rep["secure"]
    assert base_overloads(bp, "dc")[0] == []

def test_n1_secure_when_ratings_large():
    rep = n1_report(_triangle_bp(rating_mw=500.0), "dc")
    assert rep["secure"] and rep["n1_violations"] == 0

def test_bridge_outages_are_tagged_not_counted():
    bp = build_base_point("ieee14", load_config())
    rep = n1_report(bp, "dc")
    assert rep["n_bridges"] == 1
    assert [r["label"] for r in rep["rows"] if r["bridge"]] == ["7-8"]
    assert rep["n_branches"] == 20
