"""The Inspector's source parameters (app/data/params_*.json) are exactly the official case files, in the index order used by the engine
and the scene (scripts/build_case_params.py --check re-derives them and verifies endpoints and reactances against the demo data)."""
import pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]


def test_case_params_match_case_files_and_demo_data():
    p = subprocess.run([sys.executable, "scripts/build_case_params.py", "--check"], cwd=ROOT, capture_output=True, text=True, timeout=300, env={"PYTHONPATH": str(ROOT), "PATH": ""})
    assert p.returncode == 0, p.stdout + p.stderr
