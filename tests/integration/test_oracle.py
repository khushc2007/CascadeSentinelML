import itertools, tempfile, pathlib
import numpy as np
from doomsday.config import load_config
from doomsday.gridtwin import contingency as ct
from doomsday.gridtwin.base import build_base_point
from doomsday.gridtwin.cascade import CascadeEngine
from doomsday.gridtwin.loader import load_grid
from doomsday.oracle import hashing
from doomsday.oracle.ac_oracle import ACOracle
from doomsday.oracle.cache import CacheNamespaceError, ResultCache
from doomsday.oracle.dc_oracle import DCOracle
from doomsday.oracle.factory import make_oracle
from doomsday.oracle.interface import Oracle, OracleRecord, Space
from helpers import permute_grid

CFG = load_config(); BP = build_base_point("ieee14", CFG); L = BP.grid.n_branch
def sets(k, step=1): return list(itertools.combinations(range(L), k))[::step]

def test_I3_protocol_conformance_and_types():
    for fid, cls in (("dc", DCOracle), ("ac", ACOracle)):
        o = make_oracle(fid, 3, CFG, bp=BP)
        assert isinstance(o, cls) and isinstance(o, Oracle) and isinstance(o.space, Space) and o.fidelity == fid
        assert o.space.N == 1140 and o.space.L == 20
        assert isinstance(o.severity([0, 1, 2]), float) and isinstance(o.evaluate([0, 1, 2]), OracleRecord)

def test_scalar_oracle_equals_direct_cascade_exactly():
    eng = CascadeEngine(BP, CFG)
    for fid, step in (("dc", 1), ("ac", 4)):
        for k in (2, 3):
            o = make_oracle(fid, k, CFG, bp=BP)
            for K in sets(k, step if k == 3 else max(1, step // 2)):
                r = eng.run(list(K), mode=fid)
                rec = o.evaluate(K)
                assert o.severity(K) == r.S == rec.S                                   # bitwise equal, not just close
                assert (rec.S0, rec.C, rec.A, rec.rounds, rec.status, rec.S_total) == (r.S0, r.C, r.A, r.rounds, r.status, r.S_total)
                assert rec.nonconv_flag == r.flags["nonconv_flag"] and rec.ladder_step == r.ladder_step
                assert rec.n_trips == sum(len(t) for t in r.trips_per_round)

def test_batch_equals_scalar_including_duplicates_and_order():
    rng = np.random.default_rng(5)
    for fid in ("dc", "ac"):
        o = make_oracle(fid, 3, CFG, bp=BP, use_cache=False); ref = make_oracle(fid, 3, CFG, bp=BP, use_cache=False)
        ranks = rng.integers(0, 1140, 60); ranks = np.concatenate([ranks, ranks[:10]])      # duplicates
        X = o.space.unrank_batch(ranks)
        b = o.severity_batch(X)
        assert b.dtype == np.float64 and b.shape == (70,)
        s = np.array([ref.severity(tuple(row)) for row in X])
        assert np.array_equal(b, s)
        assert np.array_equal(o.severity_ranks(ranks), b)
        assert np.array_equal(o.severity_batch(X[::-1]), b[::-1])                         # order of rows irrelevant
        assert np.array_equal(o.severity_batch(X[:, ::-1]), b)                            # order within a row irrelevant
    try:
        o.severity_batch(np.zeros((3, 2), dtype=int))
    except ValueError:
        return
    raise AssertionError("wrong k accepted")

def test_cache_hits_do_not_change_results_and_counter_semantics():
    for fid in ("dc", "ac"):
        cold = make_oracle(fid, 2, CFG, bp=BP, use_cache=False)
        o = make_oracle(fid, 2, CFG, bp=BP)
        X = ct.enumerate_all(L, 2)
        first = o.severity_batch(X); snap1 = o.cost_counter.snapshot()
        assert snap1 == {"unique_queried": 190, "queries": 190, "cache_hits": 0, "computed": 190}
        second = o.severity_batch(X); snap2 = o.cost_counter.snapshot()
        assert np.array_equal(first, second) and np.array_equal(first, cold.severity_batch(X))   # hits identical to cold/uncached
        assert snap2 == {"unique_queried": 190, "queries": 380, "cache_hits": 190, "computed": 190}
        assert cold.cost_counter.cache_hits == 0 and cold.cost_counter.computed == 190
        o.cost_counter.reset(); assert o.cost_counter.snapshot()["unique_queried"] == 0 and len(o.cache) == 190
        # a sibling oracle shares the cache: no recomputation, fresh counter
        sib = o.with_k(2); sib.severity([0, 1]); assert sib.cost_counter.computed == 0 and sib.cost_counter.cache_hits == 1

def test_disk_cache_roundtrip_and_namespace_protection():
    o = make_oracle("ac", 2, CFG, bp=BP)
    o.severity_batch(ct.enumerate_all(L, 2)[:40])
    with tempfile.TemporaryDirectory() as d:
        p = pathlib.Path(d) / "c.json"; o.cache.save(p)
        c2 = ResultCache.load(p, o.namespace)
        o2 = make_oracle("ac", 2, CFG, bp=BP, cache=c2)
        assert all(o2.evaluate(tuple(x)) == o.evaluate(tuple(x)) for x in ct.enumerate_all(L, 2)[:40])
        assert o2.cost_counter.computed == 0                                              # all served from disk, identical records
        for other in (make_oracle("dc", 2, CFG, bp=BP), make_oracle("ac", 2, load_config(overrides={"cascade": {"trip_factor": 1.1}}), bp=build_base_point("ieee14", load_config(overrides={"cascade": {"trip_factor": 1.1}})))):
            try:
                ResultCache.load(p, other.namespace)
            except CacheNamespaceError:
                pass
            else:
                raise AssertionError("foreign cache accepted")
            try:
                type(other)(other.bp, other.cfg, 2, cache=c2)
            except CacheNamespaceError:
                continue
            raise AssertionError("foreign cache attached")

def test_namespace_depends_on_exactly_the_severity_relevant_settings():
    base = hashing.make_namespace("g", "o", CFG, "dc")
    same = [load_config(overrides=o) for o in ({"severity": {"tau": 0.5}}, {"quantum": {"seeds": 5}}, {"resource": {"b": 24}}, {"k": 5}, {"grid": "ieee30"})]
    assert all(hashing.make_namespace("g", "o", c, "dc") == base for c in same)          # irrelevant settings: same key
    diff = [load_config(overrides=o) for o in ({"cascade": {"trip_factor": 1.1}}, {"cascade": {"trip_policy": "most_overloaded_first"}},
            {"cascade": {"max_rounds": 5}}, {"cascade": {"redispatch": "no_upward"}}, {"rating": {"n1_margin_m": 0.1}},
            {"rating": {"family": "proportional"}}, {"stress_lambda": 1.2}, {"numerics": {"ac_tol_pu": 1e-6}}, {"cascade": {"ladder_step": 0.1}})]
    keys = {hashing.make_namespace("g", "o", c, "dc") for c in diff}
    assert base not in keys and len(keys) == len(diff)
    assert hashing.make_namespace("g", "o", CFG, "ac") != base and hashing.make_namespace("g", "o", CFG, "dc", fast_path=True) != base
    assert hashing.make_namespace("g2", "o", CFG, "dc") != base and hashing.make_namespace("g", "o2", CFG, "dc") != base
    assert hashing.make_namespace("g", "o", CFG, "dc", code_ver="x") != hashing.make_namespace("g", "o", CFG, "dc", code_ver="y")

def test_code_version_is_content_sensitive_and_stable():
    with tempfile.TemporaryDirectory() as d:
        d = pathlib.Path(d); (d / "a.py").write_text("x=1\n")
        v1 = hashing.code_version([d]); assert v1 == hashing.code_version([d])
        (d / "a.py").write_text("x=2\n"); assert hashing.code_version([d]) != v1
    assert len(hashing.code_version()) == 64

def test_oracle_is_a_pure_deterministic_function():
    X = ct.enumerate_all(L, 3)[::7]
    for fid in ("dc", "ac"):
        a = make_oracle(fid, 3, CFG, bp=BP, use_cache=False)
        ref = a.severity_batch(X)
        rng = np.random.default_rng(1); perm = rng.permutation(len(X))
        b = make_oracle(fid, 3, load_config(), bp=build_base_point("ieee14", load_config()), use_cache=False)   # fresh everything
        out = np.empty(len(X)); out[perm] = b.severity_batch(X[perm])                                              # different evaluation order
        assert np.array_equal(ref, out) and a.namespace == b.namespace
        for _ in range(2): assert np.array_equal(a.severity_batch(X), ref)                                         # repeat: no hidden state

def test_branch_and_generator_order_cannot_silently_alter_identity_or_results():
    g0 = load_grid("ieee14"); rng = np.random.default_rng(11)
    perm = rng.permutation(L); gperm = rng.permutation(g0.n_gen)
    gp = permute_grid(g0, perm, gperm)
    bpp = build_base_point(gp, CFG)
    assert bpp.grid_hash == BP.grid_hash                          # content hash is row-order independent
    assert bpp.order_fingerprint != BP.order_fingerprint          # but the order fingerprint sees the change
    for fid in ("dc", "ac"):
        o1 = make_oracle(fid, 3, CFG, bp=BP, use_cache=False); o2 = make_oracle(fid, 3, CFG, bp=bpp, use_cache=False)
        assert o1.namespace != o2.namespace                       # caches can never be mixed across orderings
        for k, step in ((2, 1), (3, 6)):
            a, b = o1.with_k(k), o2.with_k(k)
            for K in sets(k, step):
                K2 = ct.translate_outage(K, a.space, b.space)
                assert a.space.identity(K) == b.space.identity(K2)       # public identity: same
                ra, rb = a.evaluate(K), b.evaluate(K2)
                assert abs(ra.S - rb.S) < 1e-9 and abs(ra.S0 - rb.S0) < 1e-9 and ra.status == rb.status, (fid, K, ra, rb)
        # raw index tuples are NOT portable between orderings: using the same indices describes a different physical set
        assert o1.severity([0, 7, 13]) != o2.severity([0, 7, 13]) or ct.translate_outage((0, 7, 13), o1.space, o2.space) != (0, 7, 13)
    # sequential policy with exact ties is also order independent (tie -> lowest branch KEY)
    c2 = load_config(overrides={"cascade": {"trip_policy": "most_overloaded_first"}})
    A = make_oracle("dc", 2, c2, bp=build_base_point("ieee14", c2), use_cache=False)
    B = make_oracle("dc", 2, c2, bp=build_base_point(gp, c2), use_cache=False)
    for K in sets(2, 3):
        assert abs(A.severity(K) - B.severity(ct.translate_outage(K, A.space, B.space))) < 1e-9

def test_predicates_and_tie_band():
    o = make_oracle("dc", 2, CFG, bp=BP)
    X = ct.enumerate_all(L, 2); S = o.severity_batch(X)
    i = int(np.argmax(S)); K, smax = tuple(X[i]), S[i]
    assert smax > 0.2
    assert o.is_high_severity(K, 0.20) and not o.is_high_severity(tuple(X[int(np.argmin(S))]), 0.20)
    assert o.is_high_severity(K, smax) and o.is_high_severity(K, smax + 5e-10) and not o.is_high_severity(K, smax + 5e-9)
    assert not o.exceeds(K, smax) and not o.exceeds(K, smax - 5e-10) and o.exceeds(K, smax - 5e-9)         # strict: ties never improve
    assert o.exceeds(K, 0.0) and not o.exceeds(tuple(X[int(np.argmin(S))]), 0.0)
    assert o.is_cascade_driven(K, 0.20, 0.10) == (o.evaluate(K).S >= 0.2 and o.evaluate(K).C >= 0.1)

def test_exactly_k_validation_at_the_oracle_boundary():
    o = make_oracle("dc", 3, CFG, bp=BP)
    for bad in ([1, 2], [1, 2, 3, 4], [1, 1, 2], [0, 1, 20], [-1, 2, 3], [0.5, 1, 2], "abc"):
        try:
            o.severity(bad)
        except ct.ContingencyError:
            continue
        raise AssertionError(bad)
    assert o.cost_counter.queries == 0                        # rejected inputs are never counted or cached
    z = o.with_k(0); assert z.severity([]) == 0.0 and make_oracle("ac", 0, CFG, bp=BP).severity(()) == 0.0   # S(empty) = 0

def test_full_cascade_for_display_bypasses_counter():
    o = make_oracle("ac", 2, CFG, bp=BP)
    r = o.cascade([0, 1]); assert r.frames and o.cost_counter.queries == 0
    assert r.S == o.severity([1, 0])

def test_structure_accessor_is_plain_numpy_and_consistent():
    o = make_oracle("dc", 3, CFG, bp=BP); f = o.structure()
    assert f is o.structure() and (f.L, f.B) == (20, 14) and f.phi.shape == (20, 20)
    assert all(isinstance(v, (np.ndarray, int, float, str, tuple)) for v in vars(f).values())
    assert f.is_bridge.sum() == 1 and f.base_loading_dc.max() < 1 / 1.05 + 1e-6 and f.base_loading_ac.max() < 1
    assert not f.phi.flags.writeable
    lodf = f.phi[:, 0] / (1 - f.phi[0, 0])                    # usable for structure-exploiting screens
    assert np.isfinite(lodf).all() and f.grid_hash == BP.grid_hash and f.order_fingerprint == BP.order_fingerprint
    import sys
    assert "doomsday.gridtwin" in sys.modules                 # (implementation side may import it; interface must not: see dependency test)

def test_oracle_shows_severity_ordering_matches_phase2_diagnostics_scale():
    d = make_oracle("dc", 3, CFG, bp=BP, fast_path=True)
    S = d.severity_ranks(np.arange(1140))
    assert abs(S.max() - 0.5321) < 1e-3 and abs(np.mean(S > 1e-12) - 0.66) < 0.02    # Phase 2 diagnostic: Smax 0.532, 66% S>0

# ---- forced exact ties: order-independence of the tie-breaks must hold when ties actually occur -------------------------
def _star(branch_rows, gen_rows=None):
    gens = gen_rows or ["1 100 0 200 -200 1.0 100 1 300 0;"]
    return f"""mpc.baseMVA = 100;
mpc.bus = [ 1 3 0 0 0 0 1 1.0 0 0 1 1.1 0.9; 2 1 50 0 0 0 1 1.0 0 0 1 1.1 0.9; 3 1 50 0 0 0 1 1.0 0 0 1 1.1 0.9; ];
mpc.gen = [ {' '.join(gens)} ];
mpc.branch = [ {' '.join(branch_rows)} ];"""

def test_sequential_trip_tie_is_broken_by_branch_key_not_row_order():
    from helpers import make_bp
    rows = ["1 2 0 0.1 0 0 0 0 0 0 1;", "1 3 0 0.1 0 0 0 0 0 0 1;"]
    cfg = load_config(overrides={"cascade": {"trip_policy": "most_overloaded_first"}})
    seqs = []
    for order in (rows, rows[::-1]):
        bp = make_bp(_star(order), 40.0)                 # both branches carry 50 MW, rating 40: exactly tied, overloaded
        keys = ct.branch_keys(bp.grid)
        r = CascadeEngine(bp, cfg).run([], mode="dc")
        assert r.frames[0]["overloaded"] and len(r.frames[0]["overloaded"]) == 2
        seqs.append([[keys[i] for i in t] for t in r.trips_per_round])
    assert seqs[0] == seqs[1] and seqs[0][0] == [(1, 2, 0)]            # lowest KEY first regardless of row order

def test_island_slack_tie_is_broken_by_bus_id_not_generator_table_order():
    from helpers import make_bp
    br = ["1 2 0.05 0.1 0 0 0 0 0 0 1;", "2 3 0.05 0.1 0 0 0 0 0 0 1;", "1 3 0.05 0.1 0 0 0 0 0 0 1;"]
    gA, gB = "1 50 0 200 -200 1.0 100 1 100 0;", "3 50 0 200 -200 1.0 100 1 100 0;"      # equal Pmax -> a real tie
    res = []
    for gens in ([gA, gB], [gB, gA]):
        bp = make_bp(_star(br, gens), 1e6)
        for mode in ("ac",):
            r = CascadeEngine(bp, load_config()).run([], mode=mode)
            res.append(np.array([r.frames[0]["loading"][str(i)] for i in range(3)]))
    assert np.max(np.abs(res[0] - res[1])) < 1e-9          # losses are picked up at the same bus whichever gen row comes first
