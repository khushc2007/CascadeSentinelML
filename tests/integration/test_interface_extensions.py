import tempfile
import numpy as np
from doomsday.config import load_config
from doomsday.gridtwin import contingency as ct
from doomsday.gridtwin.base import build_base_point
from doomsday.classical import classical_search
from doomsday.oracle.factory import make_oracle
from doomsday.oracle.interface import GridFeatures, Oracle
from doomsday.oracle.table_oracle import TableOracle, generate_truth_table, load_features, save_features

CFG = load_config(); BP = build_base_point("ieee14", CFG); L = 20
_R = tempfile.mkdtemp()
def tab(k):
    ds = [generate_truth_table(make_oracle("dc", j, CFG, bp=BP, use_cache=False), _R, grid_name="ieee14") for j in range(1, k + 1)]
    return TableOracle.load(ds, k)

def test_with_k_valid_cardinalities_and_original_semantics_preserved():
    for fid in ("dc", "ac"):
        o = make_oracle(fid, 3, CFG, bp=BP)
        for k in (0, 1, 2, 3, 4, 20):
            s = o.with_k(k)
            assert isinstance(s, Oracle) and s.space.k == k and s.space.L == L and s.fidelity == fid and s.namespace == o.namespace
            assert s.space.N == ct.n_sets(L, k) and s.space.keys == o.space.keys
        assert o.space.k == 3 and o.with_k(2).with_k(3).space.k == 3
        # the ORIGINAL oracle is untouched and still exactly-k
        for bad in ([0, 1], [0, 1, 2, 3]):
            try: o.severity(bad)
            except ct.ContingencyError: continue
            raise AssertionError("exactly-k semantics were weakened")
        # each sibling enforces ITS cardinality
        s2 = o.with_k(2)
        try: s2.severity([0, 1, 2])
        except ct.ContingencyError: pass
        else: raise AssertionError
        assert o.with_k(0).severity([]) == 0.0
        # same predicate: a k-set evaluated through a sibling equals the direct oracle value
        assert o.with_k(3).severity([1, 5, 9]) == o.severity([1, 5, 9])

def test_with_k_invalid_inputs_rejected():
    o = make_oracle("dc", 3, CFG, bp=BP)
    for bad in (-1, 21, 100, 1.5, True, "2", None):
        try: o.with_k(bad)
        except (ct.ContingencyError, TypeError): continue
        raise AssertionError(f"with_k({bad!r}) accepted")

def test_with_k_shares_cache_and_values_with_parent_family():
    o = make_oracle("dc", 3, CFG, bp=BP); a = o.with_k(2); b = o.with_k(2)
    v = a.severity([0, 1])
    assert b.severity([0, 1]) == v and b.cost_counter.cache_hits == 1 and b.cost_counter.computed == 0       # shared cache
    assert a.cache is o.cache and a.family_counter is o.family_counter

def test_partial_set_evaluations_are_counted_consistently():
    o = make_oracle("dc", 3, CFG, bp=BP, use_cache=False)
    o.severity([0, 1, 2]); o.with_k(1).severity([4]); o.with_k(2).severity([4, 5]); o.with_k(2).severity([4, 5]); o.with_k(2).severity([5, 4])
    fc = o.family_counter
    assert fc.unique == 3 and fc.queries == 5                                   # {(3,012),(1,4),(2,45)}; repeats don't add unique cost
    assert o.cost_counter.unique == 1 and o.cost_counter.queries == 1           # per-instance behaviour unchanged (k=3 only)
    # same SET INDICES at different cardinalities are different (k,set) keys
    o2 = make_oracle("dc", 2, CFG, bp=BP); o2.with_k(1).severity([3]); o2.severity([3, 4]); assert o2.family_counter.unique == 2

def test_search_oracle_calls_equal_family_counter_for_every_method_using_partial_sets():
    t = tab(3)
    for method, kw in (("beam", {"width": 5}), ("brute", {}), ("hillclimb", {"n_starts": 2})):
        t.family_counter.reset()
        r = classical_search(t, method, seed=1, **kw)
        assert t.family_counter.unique == r.oracle_calls, (method, t.family_counter.unique, r.oracle_calls)
    # beam really used cardinalities 1,2,3
    t.family_counter.reset(); classical_search(t, "beam", width=5)
    assert {k for k, _ in t.family_counter._unique} == {1, 2, 3}

def test_table_with_k_missing_table_and_family_sharing():
    t = tab(3)
    s = t.with_k(2); assert s.family_counter is t.family_counter and s.space.N == 190
    try: t.with_k(4)
    except ValueError as e: assert "no table" in str(e)
    else: raise AssertionError

def test_branch_x_pu_present_optional_and_old_files_still_load():
    f = make_oracle("dc", 2, CFG, bp=BP).structure()
    assert f.branch_x_pu is not None and f.branch_x_pu.shape == (20,) and np.all(f.branch_x_pu > 0)
    import dataclasses
    kw = {fld.name: getattr(f, fld.name) for fld in dataclasses.fields(f) if fld.name != "branch_x_pu"}
    old = GridFeatures(**kw)                                                    # a pre-Phase-4 caller that doesn't know the field
    assert old.branch_x_pu is None
    with tempfile.TemporaryDirectory() as d:
        import pathlib
        p = pathlib.Path(d) / "f.npz"; save_features(old, p); back = load_features(p)
        assert back.branch_x_pu is None and np.array_equal(back.phi, f.phi)
        save_features(f, p); assert np.array_equal(load_features(p).branch_x_pu, f.branch_x_pu)
    from doomsday.classical.methods_structural import solve_interdiction_milp, static_dc_shed
    for fn in (lambda: static_dc_shed(old, (0, 1)), lambda: solve_interdiction_milp(old, 2)):
        try: fn()
        except ValueError as e: assert "branch_x_pu" in str(e)
        else: raise AssertionError("MILP must refuse features without reactances")

def test_contingency_space_validation_is_new_but_valid_use_unchanged():
    for bad in ((20, -1), (20, 21), (-1, 0), (20, 1.5), (20, True), ("a", 1)):
        try: ct.ContingencySpace(*bad)
        except ct.ContingencyError: continue
        raise AssertionError(bad)
    s = ct.ContingencySpace(20, 3); assert s.N == 1140 and s.rank((0, 1, 2)) == 0 and s.with_k(0).N == 1
    try: ct.ContingencySpace(20, 2, keys=((1, 2, 0),))
    except ct.ContingencyError: pass
    else: raise AssertionError("wrong-length keys accepted")

def test_all_three_oracle_kinds_satisfy_the_protocol_including_with_k():
    for o in (make_oracle("dc", 2, CFG, bp=BP), make_oracle("ac", 2, CFG, bp=BP), tab(2)):
        assert isinstance(o, Oracle) and callable(o.with_k) and o.with_k(2).space.k == 2
