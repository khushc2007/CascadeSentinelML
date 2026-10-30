import json, pathlib, tempfile, shutil
import numpy as np
from doomsday.config import load_config
from doomsday.gridtwin import contingency as ct
from doomsday.gridtwin.base import build_base_point
from doomsday.oracle.factory import make_oracle
from doomsday.oracle.interface import Oracle
from doomsday.oracle.table_oracle import TableError, TableOracle, generate_truth_table

CFG = load_config(); BP = build_base_point("ieee14", CFG); L = 20

def gen(fid, k, root, **kw):
    o = make_oracle(fid, k, CFG, bp=BP, use_cache=False)
    return o, generate_truth_table(o, root, grid_name="ieee14", chunk=kw.pop("chunk", 97), **kw)

def test_table_equals_source_oracle_for_every_set_dc_and_ac_full_records():
    with tempfile.TemporaryDirectory() as t:
        for fid, k in (("dc", 2), ("dc", 3), ("ac", 2), ("ac", 3)):
            src, d = gen(fid, k, t)
            tab = TableOracle.load(d, k, expect_namespace=src.namespace)
            assert isinstance(tab, Oracle) and tab.fidelity == fid and tab.space.N == src.space.N
            assert tab.verify_against(src) == {"checked": src.space.N, "mismatches": 0}       # records EXACTLY equal, incl. ladder flags
            X = ct.enumerate_all(L, k)
            fresh = make_oracle(fid, k, CFG, bp=BP, use_cache=False)
            assert np.array_equal(tab.severity_batch(X), fresh.severity_batch(X))             # independent re-computation
            assert np.array_equal(tab.all_severities(), tab.severity_ranks(np.arange(tab.space.N)))
        # AC table really contains non-trivial records (ladder events), so the equality above is not vacuous
        ac = TableOracle.load(d, 3); n_lad = sum(ac.evaluate(tuple(x)).nonconv_flag for x in X[::3])
        assert n_lad > 0 and any(ac.evaluate(tuple(x)).S_total is not None for x in X[::3])

def test_table_has_no_independent_severity_code_path():
    # A table whose stored values are tampered with must be DETECTED (integrity hash) -- the table cannot recompute anything.
    with tempfile.TemporaryDirectory() as t:
        src, d = gen("dc", 2, t)
        S = np.load(d / "S.npy", mmap_mode="r+"); S[5] = 0.123456; S.flush(); del S
        try:
            TableOracle.load(d, 2)
        except TableError as e:
            assert "integrity" in str(e)
        else:
            raise AssertionError("tampered table accepted")
        tab = TableOracle.load(d, 2, verify_integrity=False)
        assert tab.verify_against(src)["mismatches"] >= 1                                      # and verify_against also exposes it

def test_namespace_protection_foreign_config_rejected():
    with tempfile.TemporaryDirectory() as t:
        src, d = gen("dc", 2, t)
        other = make_oracle("dc", 2, load_config(overrides={"cascade": {"trip_factor": 1.1}}),
                            bp=build_base_point("ieee14", load_config(overrides={"cascade": {"trip_factor": 1.1}})))
        try:
            TableOracle.load(d, 2, expect_namespace=other.namespace)
        except TableError:
            pass
        else:
            raise AssertionError("foreign namespace accepted")
        tab = TableOracle.load(d, 2)
        try:
            tab.verify_against(other)
        except TableError:
            return
        raise AssertionError("verify_against accepted a foreign oracle")

def test_batch_scalar_predicates_counter_and_validation_match_the_oracle_contract():
    with tempfile.TemporaryDirectory() as t:
        src, d = gen("dc", 3, t); tab = TableOracle.load(d, 3)
        rng = np.random.default_rng(0); X = tab.space.unrank_batch(rng.integers(0, 1140, 80))
        b = tab.severity_batch(X)
        assert np.array_equal(b, np.array([tab.severity(tuple(r)) for r in X])) and np.array_equal(b, src.severity_batch(X))
        assert np.array_equal(tab.severity_batch(X[:, ::-1]), b)                              # within-row order irrelevant
        assert tab.cost_counter.unique <= 80 and tab.cost_counter.computed == 0
        S = tab.all_severities(); i = int(S.argmax()); K = tab.space.unrank(i)
        assert tab.is_high_severity(K, S[i]) and not tab.exceeds(K, S[i]) and tab.exceeds(K, S[i] - 5e-9)
        assert tab.is_cascade_driven(K, 0.2, 0.1) == src.is_cascade_driven(K, 0.2, 0.1)
        for bad in ([1, 2], [1, 1, 2], [0, 1, 20], [0.5, 1, 2]):
            try: tab.severity(bad)
            except ct.ContingencyError: continue
            raise AssertionError(bad)
        try: tab.severity_batch(np.array([[1, 1, 2]]))
        except ct.ContingencyError: pass
        else: raise AssertionError("duplicate row accepted in batch")
        s = tab.structure(); f = src.structure()
        assert s.L == f.L and np.array_equal(s.phi, f.phi) and s.branch_keys == f.branch_keys and np.array_equal(s.branch_x_pu, f.branch_x_pu)
        assert s.grid_hash == f.grid_hash and s.order_fingerprint == f.order_fingerprint

def test_with_k_requires_a_table_and_never_invents_values():
    with tempfile.TemporaryDirectory() as t:
        _, d2 = gen("dc", 2, t); _, d3 = gen("dc", 3, t)
        tab = TableOracle.load([d2, d3], 3)
        assert tab.with_k(2).space.N == 190 and tab.with_k(2).severity([0, 1]) == TableOracle.load(d2, 2).severity([0, 1])
        try: tab.with_k(1)
        except ValueError as e: assert "no table" in str(e)
        else: raise AssertionError
        try: tab.cascade([0, 1, 2])
        except NotImplementedError: pass
        else: raise AssertionError("table must not fabricate cascade frames")

def test_generation_resume_is_identical_to_uninterrupted_and_guards_large_spaces():
    with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
        o, d1 = gen("dc", 3, a)                                           # uninterrupted
        o2 = make_oracle("dc", 3, CFG, bp=BP, use_cache=False)
        d2 = generate_truth_table(o2, b, grid_name="ieee14", chunk=97, stop_after_chunks=3)          # "interrupted"
        m = json.loads((d2 / "meta.json").read_text()); assert not m["complete"] and m["completed_chunks"] == 3
        try: TableOracle.load(d2, 3)
        except TableError as e: assert "incomplete" in str(e)
        else: raise AssertionError("incomplete table loaded")
        d3 = generate_truth_table(make_oracle("dc", 3, CFG, bp=BP, use_cache=False), b, grid_name="ieee14", chunk=97)   # resume
        assert d3 == d2 and json.loads((d3 / "meta.json").read_text())["complete"]
        for n in ("S", "S0", "S_total", "rounds", "status", "flags", "ladder", "n_trips"):
            assert (d1 / f"{n}.npy").read_bytes() == (d3 / f"{n}.npy").read_bytes() or np.array_equal(np.load(d1 / f"{n}.npy"), np.load(d3 / f"{n}.npy"), equal_nan=True)
        assert json.loads((d1 / "meta.json").read_text())["sha256"]["S"] == json.loads((d3 / "meta.json").read_text())["sha256"]["S"]
        # resuming under a different chunk size or namespace is refused
        try: generate_truth_table(make_oracle("dc", 3, CFG, bp=BP, use_cache=False), b, grid_name="ieee14", chunk=50)
        except TableError: pass
        else: raise AssertionError
    # size guard: a huge space (V2 IEEE-118 k=4 is 48,277,230 sets) is refused BEFORE any work or file creation
    from doomsday.gridtwin.contingency import ContingencySpace
    class Huge:
        space = ContingencySpace(186, 4); fidelity = "dc"; namespace = "x"
    with tempfile.TemporaryDirectory() as t:
        try: generate_truth_table(Huge(), t, grid_name="ieee118")
        except TableError as e: assert "48277230" in str(e)
        else: raise AssertionError("large table generation not guarded")
        assert list(pathlib.Path(t).iterdir()) == []

def test_s_only_tables_work_but_refuse_record_queries():
    with tempfile.TemporaryDirectory() as t:
        src, d = gen("dc", 2, t, full_records=False)
        tab = TableOracle.load(d, 2)
        assert np.array_equal(tab.all_severities(), src.severity_ranks(np.arange(190)))
        try: tab.evaluate([0, 1])
        except NotImplementedError: return
        raise AssertionError("record query on an S-only table must fail loudly")


def test_parallel_generation_is_byte_identical_to_serial():
    """(Phase 7) workers > 1 must produce exactly the same files, including resumption from a partial serial table."""
    import tempfile, filecmp
    from doomsday.config import load_config
    from doomsday.gridtwin.base import build_base_point
    from doomsday.oracle.factory import make_oracle
    from doomsday.oracle.table_oracle import generate_truth_table
    cfg = load_config(); bp = build_base_point("ieee14", cfg)
    with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
        o = lambda: make_oracle("dc", 3, cfg, bp=bp, use_cache=False)
        da = generate_truth_table(o(), a, grid_name="ieee14", chunk=200)
        generate_truth_table(o(), b, grid_name="ieee14", chunk=200, stop_after_chunks=2)          # partial serial, then parallel resume
        db = generate_truth_table(o(), b, grid_name="ieee14", chunk=200, workers=2)
        for n in ("S", "S0", "S_total", "rounds", "status", "flags", "ladder", "n_trips"):
            assert filecmp.cmp(da / f"{n}.npy", db / f"{n}.npy", shallow=False), n


def test_one_writer_per_table_directory_and_stale_locks_are_cleared():
    """(Phase 7) A live writer's lock blocks a second writer; a stale lock (dead pid) is replaced; tables_for never writes into a partial table."""
    import os, tempfile, pathlib, pytest
    from doomsday.config import load_config
    from doomsday.gridtwin.base import build_base_point
    from doomsday.oracle.factory import make_oracle
    from doomsday.oracle.table_oracle import TableError, generate_truth_table, table_dir_name
    cfg = load_config(); bp = build_base_point("ieee14", cfg); o = make_oracle("dc", 2, cfg, bp=bp, use_cache=False)
    with tempfile.TemporaryDirectory() as t:
        d = pathlib.Path(t) / table_dir_name("ieee14", "dc", 2, o.namespace); d.mkdir()
        (d / ".lock").write_text(str(os.getppid()))                                   # a live process that is not us
        with pytest.raises(TableError): generate_truth_table(o, t, grid_name="ieee14")
        (d / ".lock").write_text("999999999")                                          # stale
        assert (generate_truth_table(o, t, grid_name="ieee14") / "meta.json").exists() and not (d / ".lock").exists()
    from doomsday.experiments.common import TableMissing, tables_for
    from doomsday.experiments.framework import Ctx
    with tempfile.TemporaryDirectory() as t:
        generate_truth_table(make_oracle("dc", 1, cfg, bp=bp, use_cache=False), t, grid_name="ieee14", chunk=5000)
        generate_truth_table(make_oracle("dc", 2, cfg, bp=bp, use_cache=False), t, grid_name="ieee14", chunk=50, stop_after_chunks=1)
        with pytest.raises(TableMissing): tables_for(Ctx(results_root=pathlib.Path(t), tables_dir=t), "ieee14", "dc", [2])
