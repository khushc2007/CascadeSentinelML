"""Phase 12: API contract tests (V2 20.3) against a freshly built IEEE-14 demo bundle in a temp dir."""
import importlib, os, tempfile
import pytest
pytest.importorskip("fastapi"); pytest.importorskip("httpx")
from fastapi.testclient import TestClient

@pytest.fixture(scope="module")
def client():
    d = tempfile.mkdtemp()
    from doomsday.api.demo_data import build
    build(d, grids=["ieee14"], log=lambda *a: None)
    os.environ["GDF_DATA_DIR"] = d
    import doomsday.api.app as m
    m = importlib.reload(m); m._load.cache_clear()
    yield TestClient(m.app)
    os.environ.pop("GDF_DATA_DIR", None)

def test_health_grids_grid(client):
    assert client.get("/health").json()["data_present"]
    g = client.get("/grids").json(); assert g["grids"][0]["id"] == "ieee14" and "evidence" in g
    gj = client.get("/grid/ieee14").json(); assert gj["n_branch"] == 20 and len(gj["layout"]["x"]) == 14 and gj["provenance"] == "official_matpower"
    assert client.get("/grid/nope").status_code == 404

def test_ranking_and_bounds(client):
    r = client.get("/ranking", params={"grid": "ieee14", "k": 3, "T": 5}).json()
    assert len(r["rows"]) == 5 and r["N"] == 1140 and r["rows"][0]["S_dc"] >= r["rows"][-1]["S_dc"]
    # AC columns appear only when a complete AC truth table already exists (the API never builds AC tables inline);
    # a fresh checkout without the tables archive reports ac_available = False.
    assert isinstance(r["ac_available"], bool)
    assert client.get("/ranking", params={"grid": "ieee14", "k": 3, "T": 50}).status_code == 422

def test_cascade_precomputed_live_and_validation(client):
    top = client.get("/ranking", params={"grid": "ieee14", "k": 3, "T": 1}).json()["rows"][0]
    a = client.post("/cascade", json={"grid": "ieee14", "outage": top["outage"]}).json()
    assert a["source"] == "precomputed" and abs(a["metrics"]["S"] - top["S_dc"]) < 1e-12 and a["frames"][0]["round"] == 0
    b = client.post("/cascade", json={"grid": "ieee14", "outage": [5, 0], "mode": "ac"}).json()
    assert b["source"] == "live" and b["outage"] == [0, 5] and set(b["metrics"]) >= {"S", "S0", "C", "status", "S_total"}
    for bad in ({"grid": "ieee14", "outage": [1, 1]}, {"grid": "ieee14", "outage": [99]}, {"grid": "ieee14", "outage": []}, {"grid": "ieee14", "outage": [1], "mode": "xx"}):
        assert client.post("/cascade", json=bad).status_code == 422, bad
    assert client.post("/cascade", json={"grid": "ieee118", "outage": [0, 1, 2]}).status_code == 409

def test_search_and_crossover(client):
    s = client.post("/search", json={"grid": "ieee14", "k": 3}).json()
    assert s["source"] == "precomputed" and "EMULATED" in s["evidence"]["bars_and_curve"] and len(s["bars"]["states"]) == 20
    c = client.post("/crossover", json={"grid": "ieee118", "k": 3, "scenario": "realistic", "prep": "be_counted"}).json()
    assert c["Tq_s"] > 0 and c["Tc_s"] > 0 and "MODELLED" in c["evidence"]
    u = client.post("/crossover", json={"grid": "ieee118", "k": 3, "calibrated": False, "alpha": 0.5}).json()
    assert u["calibrated"] is False and u["N_star"] == "inf"
    assert client.post("/crossover", json={"grid": "ieee14", "k": 25}).status_code == 422
    assert client.post("/crossover", json={"t_toffoli_s": -1}).status_code == 422

def test_evidence_ledger_lists_all_experiments(client):
    e = client.get("/evidence").json(); assert set(e["experiments"]) == {f"E{i}" for i in range(17)} and len(e["legend"]) == 4
