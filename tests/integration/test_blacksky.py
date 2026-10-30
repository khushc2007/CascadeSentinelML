"""BLACKSKY COMMAND: shared modules and data in blacksky/site are byte-identical to app/ (scripts/build_blacksky.py --check), the BLACKSKY
node suite passes, and the site stays an independent application (own entry point and deploy config; original app files untouched by it)."""
import glob, json, pathlib, shutil, subprocess, sys
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]


def test_shared_copies_in_sync_with_original_app():
    p = subprocess.run([sys.executable, "scripts/build_blacksky.py", "--check"], cwd=ROOT, capture_output=True, text=True, timeout=120)
    assert p.returncode == 0, p.stdout + p.stderr


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_blacksky_node_suite():
    files = sorted(glob.glob(str(ROOT / "blacksky" / "test" / "*.test.mjs")))
    assert files
    p = subprocess.run(["node", "--test", *files], cwd=ROOT, capture_output=True, text=True, timeout=600)
    assert p.returncode == 0, p.stdout[-4000:] + p.stderr[-2000:]


def test_independent_entry_point_and_deploy_config():
    site = ROOT / "blacksky" / "site"
    html = (site / "index.html").read_text()
    assert "<title>BLACKSKY Command</title>" in html and 'src="js/main.js"' in html
    assert json.loads((site / "vercel.json").read_text())                      # valid JSON, inside the BLACKSKY root only
    assert not (ROOT / "vercel.json").exists(), "BLACKSKY must not add a repository-root deploy config"
    # the original entry point is still the workbench, not BLACKSKY
    assert "BLACKSKY" not in (ROOT / "app" / "index.html").read_text()
    assert "blacksky" not in (ROOT / "doomsday" / "api" / "app.py").read_text().lower()


# ---- BLACKSKY's own optional API (blacksky/serve.py /bsapi) -------------------------------------------------------------------------
fastapi = pytest.importorskip("fastapi")


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient
    from blacksky.serve import app
    return TestClient(app)


def test_bsapi_health_and_original_api_still_mounted(client):
    h = client.get("/bsapi/health").json()
    assert h["status"] == "ok" and h["limits"] == {"qubits": 12, "operations": 4000}
    assert client.get("/api/health").json()["status"] == "ok"                      # original API, unchanged, at /api
    assert client.get("/").status_code == 200 and "BLACKSKY" in client.get("/").text


def test_bsapi_transpile_bounds_and_whitelist(client):
    pytest.importorskip("qiskit")
    bell = {"n": 2, "ops": [{"g": "h", "q": [0]}, {"g": "cx", "c": [0], "q": [1]}, {"g": "measure", "q": [0]}, {"g": "measure", "q": [1]}], "optimization_level": 1}
    r = client.post("/bsapi/quantum/transpile", json=bell).json()
    assert r["two_qubit"] == 1 and r["counts"]["measure"] == 2 and set(r["counts"]) <= {"cx", "rz", "sx", "x", "measure"} and r["coupling_map"] is None
    assert client.post("/bsapi/quantum/transpile", json={"n": 13, "ops": []}).status_code == 422                       # too many qubits
    assert client.post("/bsapi/quantum/transpile", json={"n": 2, "ops": [{"g": "x", "q": [5]}]}).status_code == 422     # index out of range
    assert client.post("/bsapi/quantum/transpile", json={"n": 2, "ops": [{"g": "__import__", "q": [0]}]}).status_code == 422  # not a gate
    assert client.post("/bsapi/quantum/transpile", json={"n": 2, "ops": [{"g": "x", "q": [0]}] * 4001}).status_code == 422  # too many ops
