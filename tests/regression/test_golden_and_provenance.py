"""V2 Tests R2 (golden-file regression), R3 (figure/result provenance) and R4 (claims lint)."""
import hashlib, json, pathlib, sys, tempfile
import numpy as np, pytest
ROOT = pathlib.Path(__file__).resolve().parents[2]
GOLD = json.loads((ROOT / "tests/golden/ieee14_golden.json").read_text())

def test_R2_ieee14_dc_tables_match_golden_file():
    from doomsday.config import load_config
    from doomsday.gridtwin.base import build_base_point
    from doomsday.oracle.factory import make_oracle
    cfg = load_config(); bp = build_base_point("ieee14", cfg); assert bp.grid_hash == GOLD["grid_hash"]
    for k in (1, 2, 3):
        o = make_oracle("dc", k, cfg, bp=bp, use_cache=False); sp = o.space; S = o.severity_batch(sp.unrank_batch(np.arange(sp.N, dtype=np.int64))); g = GOLD[f"dc_k{k}"]
        assert sp.N == g["N"] and abs(S.max() - g["Smax"]) < 1e-12 and int((S >= 0.2 - 1e-9).sum()) == g["n_high"]
        assert np.lexsort((np.arange(sp.N), -S))[:10].tolist() == g["top10"]
        assert hashlib.sha256(np.round(S, 12).tobytes()).hexdigest() == g["S_round12_sha256"]

def test_R2_ieee14_ac_k2_top10_matches_golden_to_1e8():
    from doomsday.config import load_config
    from doomsday.gridtwin.base import build_base_point
    from doomsday.oracle.factory import make_oracle
    cfg = load_config(); bp = build_base_point("ieee14", cfg); o = make_oracle("ac", 2, cfg, bp=bp, use_cache=False); sp = o.space
    S = o.severity_batch(sp.unrank_batch(np.arange(sp.N, dtype=np.int64))); assert np.allclose(np.sort(S)[::-1][:10], GOLD["ac_k2"]["S_top10"], atol=1e-8)

PH7 = ROOT / "results/phase7"
@pytest.mark.skipif(not (PH7 / "E15" / "manifest.json").exists(), reason="E15 not run in this checkout")
def test_R3_every_recorded_output_matches_its_manifest_hash_and_figures_regenerate():
    for m in sorted(PH7.glob("E*/manifest.json")):
        man = json.loads(m.read_text())
        for path, sha in man["outputs"].items():
            p = ROOT / path if not pathlib.Path(path).is_absolute() else pathlib.Path(path)
            assert p.exists() and hashlib.sha256(p.read_bytes()).hexdigest() == sha, (m.parent.name, path)
    from doomsday.experiments.exp_resource import _fig
    res = json.loads((PH7 / "E15/result.json").read_text())
    with tempfile.TemporaryDirectory() as d:
        names = _fig(res["payload"], pathlib.Path(d))
        for n in names:
            assert (pathlib.Path(d) / n).read_bytes() == (PH7 / "E15" / n).read_bytes(), n

def test_R4_claims_lint_detects_violations_and_repo_is_clean():
    sys.path.insert(0, str(ROOT / "scripts")); import claims_lint as cl
    with tempfile.TemporaryDirectory() as d:
        p = pathlib.Path(d) / "x.md"
        p.write_text("We show quantum advantage.\nOur ground truth table.\nNo quantum advantage is claimed.\nThe engine was validated.\nAC cross-checked; validated against PYPOWER in E0.\n")
        v = cl.scan([p]); assert [x["line"] for x in v] == [1, 2, 4]
    assert cl.scan() == [], cl.scan()
