"""Phase 9: run the JavaScript parity suite (app/test/*.test.mjs) from pytest when Node.js is available."""
import glob, pathlib, shutil, subprocess
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]

@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_javascript_port_matches_python_fixtures():
    files = sorted(glob.glob(str(ROOT / "app" / "test" / "*.test.mjs")))
    assert files, "no JS test files found"
    p = subprocess.run(["node", "--test", *files], cwd=ROOT, capture_output=True, text=True, timeout=900)
    assert p.returncode == 0, p.stdout[-4000:] + p.stderr[-2000:]
