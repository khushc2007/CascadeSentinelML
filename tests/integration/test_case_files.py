import json, pathlib, shutil, sys, tempfile
import numpy as np
from doomsday.config import load_config
from doomsday.gridtwin import loader
from doomsday.gridtwin.base import build_base_point
from doomsday.gridtwin.loader import DATA_DIR, load_grid
from helpers import skip
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "scripts"))
import verify_case_files as vcf

def _fake_matpower(tmp, modify=None):
    d = pathlib.Path(tmp) / "matpower" / "data"; d.mkdir(parents=True)
    txt = (DATA_DIR / "case14.m").read_text()
    if modify: txt = modify(txt)
    (d / "case14.m").write_text(txt)
    return d.parent

def test_provenance_matches_manifest_for_every_case_whatever_is_installed():
    """State-aware (Phase 7): before installation case14 is transcribed/UNVERIFIED and case30/118 ABSENT; after
    `verify_case_files.py --install` each installed file must report official_matpower WITH a recorded commit and sha256."""
    man = json.loads((DATA_DIR / "MANIFEST.json").read_text())
    for case, grid in (("case14", "ieee14"), ("case30", "ieee30"), ("case118", "ieee118")):
        ent = man[case]
        if ent["status"] == "ABSENT":
            assert not (DATA_DIR / f"{case}.m").exists(); continue
        st = load_grid(grid).source["provenance"]["status"]
        assert st == ent["status"], (case, st, ent["status"])
        if st == "official_matpower":
            assert ent["matpower_commit"] and len(ent["sha256"]) == 64
        else:
            assert st.startswith("transcribed") and ent["matpower_commit"] is None
    assert build_base_point("ieee14", load_config()).grid.source["provenance"]["status"] == man["case14"]["status"]

def test_load_grid_maps_ieee_names_to_official_case_files():
    """Regression for defect D1: installed files are named caseNN.m; load_grid('ieeeNN') must find them."""
    for grid, case in (("ieee30", "case30.m"), ("ieee118", "case118.m")):
        assert loader._BUILTIN[grid] == case

def test_provenance_detects_modified_or_unknown_files():
    with tempfile.TemporaryDirectory() as d:
        p = pathlib.Path(d) / "case14.m"; p.write_text((DATA_DIR / "case14.m").read_text().replace("0.05917", "0.05918"))
        assert loader.provenance(p)["status"] == "UNVERIFIED_file_differs_from_manifest"
        q = pathlib.Path(d) / "mystery.m"; q.write_text((DATA_DIR / "case14.m").read_text())
        assert loader.provenance(q)["status"] == "UNVERIFIED_not_in_manifest"

def test_missing_official_cases_fail_loudly_not_silently(monkeypatch=None):
    """Point the loader at an empty data dir: every case must fail loudly (never substituted)."""
    with tempfile.TemporaryDirectory() as d:
        saved = loader.DATA_DIR; loader.DATA_DIR = pathlib.Path(d)
        try:
            for name in ("ieee30", "ieee118", "case30"):
                try:
                    loader.load_grid(name)
                except FileNotFoundError as e:
                    assert "MATPOWER" in str(e); continue
                raise AssertionError(name)
        finally:
            loader.DATA_DIR = saved

def test_verify_tool_identical_differing_and_missing():
    with tempfile.TemporaryDirectory() as t:
        out = pathlib.Path(t) / "rep.json"
        mp = _fake_matpower(t)
        r = vcf.main(["--matpower-dir", str(mp), "--commit", "deadbeef", "--cases", "case14", "case30"], out_path=out)
        assert r["cases"]["case14"]["status"] == "DATA_IDENTICAL" and r["cases"]["case14"]["byte_identical"] is True
        assert r["cases"]["case30"]["status"] == "OFFICIAL_MISSING" and r["matpower_commit"] == "deadbeef"
        assert json.loads(out.read_text())["cases"]["case14"]["tables"]["branch"]["n_differing_cells"] == 0
    with tempfile.TemporaryDirectory() as t:                      # one branch reactance differs in the "official" copy
        mp = _fake_matpower(t, lambda s: s.replace("0.05917", "0.05918"))
        r = vcf.main(["--matpower-dir", str(mp), "--cases", "case14"], out_path=pathlib.Path(t) / "r.json")
        e = r["cases"]["case14"]; assert e["status"] == "DATA_DIFFERS" and e["byte_identical"] is False
        d = e["tables"]["branch"]["first_differences"][0]
        assert (d["row"], d["col"], d["local"], d["official"]) == (0, 3, 0.05917, 0.05918) and e["tables"]["bus"]["match"]
    with tempfile.TemporaryDirectory() as t:                      # comment-only difference: data identical, bytes differ
        mp = _fake_matpower(t, lambda s: "% extra comment\n" + s)
        e = vcf.main(["--matpower-dir", str(mp), "--cases", "case14"], out_path=pathlib.Path(t) / "r.json")["cases"]["case14"]
        assert e["status"] == "DATA_IDENTICAL" and e["byte_identical"] is False

def test_install_copies_unmodified_and_records_commit_in_manifest():
    with tempfile.TemporaryDirectory() as t:
        data = pathlib.Path(t) / "data"; data.mkdir(); shutil.copy(DATA_DIR / "MANIFEST.json", data)
        mp = _fake_matpower(t, lambda s: s.replace("0.05917", "0.05918"))
        r = vcf.main(["--matpower-dir", str(mp), "--commit", "abc123", "--install", "--cases", "case14"], data_dir=data, out_path=pathlib.Path(t) / "r.json")
        assert (data / "case14.m").read_bytes() == (mp / "data" / "case14.m").read_bytes()
        ent = json.loads((data / "MANIFEST.json").read_text())["case14"]
        assert ent["status"] == "official_matpower" and ent["matpower_commit"] == "abc123" and ent["sha256"] == r["cases"]["case14"]["official_sha256"]

# ---- IEEE-30 / IEEE-118 smoke tests (V2 2.3: L=41 and L=186). They need the OFFICIAL files; without them they SKIP. -------
def _need(case):
    if not (DATA_DIR / f"{case}.m").exists():
        skip(f"official MATPOWER {case}.m not present in {DATA_DIR} (not obtainable in the offline build sandbox)")
    st = json.loads((DATA_DIR / "MANIFEST.json").read_text()).get(case, {}).get("status")
    if st != "official_matpower":
        skip(f"{case}.m present but not installed/verified via scripts/verify_case_files.py --install (status={st})")

def _smoke(case, name, n_bus, n_branch, k):
    from doomsday.oracle.factory import make_oracle
    from doomsday.gridtwin import contingency as ct
    g = load_grid(name)
    assert (g.n_bus, g.n_branch) == (n_bus, n_branch)                      # V2 2.3: L = 41 / 186
    cfg = load_config(overrides={"grid": name}); bp = build_base_point(g, cfg)
    assert bp.ac.converged and bp.warnings == []
    rng = np.random.default_rng(0)
    for fid in ("dc", "ac"):
        o = make_oracle(fid, k, cfg, bp=bp)
        X = o.space.unrank_batch(rng.integers(0, o.space.N, 15))
        S = o.severity_batch(X)
        assert np.all((S >= 0) & (S <= 1)) and np.array_equal(S, o.severity_batch(X[:, ::-1]))
        assert o.evaluate(tuple(X[0])).S == o.cascade(tuple(X[0])).S

def test_ieee30_load_base_point_and_oracle_smoke():
    _need("case30"); _smoke("case30", "ieee30", 30, 41, 3)

def test_ieee118_load_base_point_and_oracle_smoke():
    _need("case118"); _smoke("case118", "ieee118", 118, 186, 3)
