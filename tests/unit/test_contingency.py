import itertools
from math import comb
import numpy as np
from doomsday.gridtwin import contingency as ct
from doomsday.gridtwin.loader import load_grid
from helpers import permute_grid

def test_enumeration_is_lexicographic_and_rank_equals_position():
    for L in range(1, 9):
        for k in range(0, L + 1):
            ref = list(itertools.combinations(range(L), k))          # itertools yields lexicographic order
            assert len(ref) == ct.n_sets(L, k)
            assert [ct.rank(x, L, k) for x in ref] == list(range(len(ref)))
            assert [ct.unrank(r, L, k) for r in range(len(ref))] == ref
            if ref:
                assert np.array_equal(ct.unrank_batch(np.arange(len(ref)), L, k).reshape(len(ref), k), np.array(ref, dtype=np.int64).reshape(len(ref), k))

def test_round_trips_exhaustive_small():
    for L, k in ((10, 3), (12, 4), (14, 5), (9, 9), (9, 0), (20, 2)):
        for r in range(comb(L, k)):
            x = ct.unrank(r, L, k)
            assert ct.rank(x, L, k) == r                                       # rank(unrank(r)) == r
            assert ct.unrank(ct.rank(x, L, k), L, k) == x                      # unrank(rank(x)) == x
        arr = ct.unrank_batch(np.arange(comb(L, k)), L, k)
        assert all(ct.rank(tuple(row), L, k) == i for i, row in enumerate(arr))

def test_round_trips_randomized_large_spaces():
    rng = np.random.default_rng(2026)
    for L, k in ((41, 3), (41, 5), (186, 3), (186, 4), (186, 5), (186, 6), (2896, 3), (2896, 4)):
        N = comb(L, k); assert N < 2 ** 62
        ranks = np.concatenate([rng.integers(0, N, 300), [0, 1, N - 2, N - 1]]).astype(np.int64)
        arr = ct.unrank_batch(ranks, L, k)
        assert np.all(arr[:, 1:] > arr[:, :-1]) and arr.min() >= 0 and arr.max() < L     # sorted, in range, distinct
        for r, row in zip(ranks.tolist(), arr):
            x = tuple(int(v) for v in row)
            assert ct.rank(x, L, k) == r and ct.unrank(r, L, k) == x                     # scalar == batch, both directions
        # random sets -> rank -> unrank
        for _ in range(100):
            x = tuple(sorted(rng.choice(L, k, replace=False).tolist()))
            assert ct.unrank(ct.rank(x, L, k), L, k) == x
    assert ct.rank((0, 1, 2), 186, 3) == 0 and ct.rank((183, 184, 185), 186, 3) == comb(186, 3) - 1

def test_lexicographic_order_differs_from_printed_colex_formula():
    # V2 5.4 prints r = sum C(c_i, i): a bijection onto [0,N) but in COLEX order. Document + prove the discrepancy.
    L, k = 6, 3
    sets = list(itertools.combinations(range(L), k))
    colex = sorted(sets, key=lambda s: tuple(reversed(s)))
    assert [ct.colex_rank(s) for s in colex] == list(range(len(sets)))                   # formula = colex order
    assert [ct.colex_unrank(r, k) for r in range(len(sets))] == colex
    assert sets != colex and sum(ct.rank(s, L, k) != ct.colex_rank(s) for s in sets) > 0
    # hand values for (0,1,5): lex -> 4th set starting (0,1,.) = 3 ; colex -> C(0,1)+C(1,2)+C(5,3) = 10
    assert ct.rank((0, 1, 5), L, k) == 3 and ct.colex_rank((0, 1, 5)) == 10

def test_exactly_k_validation():
    L = 20
    for bad, k in (([1, 1], 2), ([1], 2), ([1, 2, 3], 2), ([-1, 4], 2), ([3, 20], 2), ([1.0, 2], 2), ([True, 2], 2), ("ab", 2), (5, 2)):
        try:
            ct.validate_outage(bad, L, k)
        except ct.ContingencyError:
            continue
        raise AssertionError(bad)
    assert ct.validate_outage([5, 2, 9], L, 3) == (2, 5, 9) and ct.validate_outage(np.array([7, 1]), L, 2) == (1, 7)
    for bad_rank in (-1, comb(L, 2), 1.5, True):
        try:
            ct.unrank(bad_rank, L, 2)
        except ct.ContingencyError:
            continue
        raise AssertionError(bad_rank)
    try:
        ct.unrank_batch([0, comb(L, 2)], L, 2)
    except ct.ContingencyError:
        pass
    else:
        raise AssertionError("batch out-of-range rank accepted")

def test_chunked_enumeration_covers_space_in_order():
    L, k = 20, 3
    chunks = list(ct.iter_chunks(L, k, chunk=333))
    allr = np.concatenate([c for _, c in chunks])
    assert np.array_equal(allr, np.array(list(itertools.combinations(range(L), k))))
    assert [s for s, _ in chunks][:3] == [0, 333, 666]

def test_branch_identity_is_file_order_independent_but_rank_is_not():
    g = load_grid("ieee14"); rng = np.random.default_rng(3)
    perm = rng.permutation(g.n_branch); gp = permute_grid(g, perm)
    s1, s2 = ct.space_for_grid(g, 3), ct.space_for_grid(gp, 3)
    assert s1.keys != s2.keys and sorted(s1.keys) == sorted(s2.keys)
    x = (0, 7, 13); x2 = ct.translate_outage(x, s1, s2)
    assert s1.identity(x) == s2.identity(x2)                                   # same physical set, same public identity
    assert x2 != x and s1.rank(x) != s2.rank(x2)                               # but index tuple and rank are order-specific
    assert ct.translate_outage(x2, s2, s1) == x
    for r in rng.integers(0, s1.N, 50):
        y = s1.unrank(int(r)); assert ct.translate_outage(ct.translate_outage(y, s1, s2), s2, s1) == y
    try:
        s1.from_identity([(99, 100, 0)])
    except ct.ContingencyError:
        return
    raise AssertionError("unknown key accepted")

def test_parallel_branch_keys_distinguish_parallel_lines():
    from doomsday.gridtwin.loader import parse_matpower
    from helpers import TRIANGLE
    g = parse_matpower(TRIANGLE.replace(" 2 3 0 0.1 0 0 0 0 0 0 1;\n];", " 2 3 0 0.1 0 0 0 0 0 0 1;\n 2 3 0 0.2 0 0 0 0 0 0 1;\n];"))
    k = ct.branch_keys(g)
    assert len(set(k)) == 4 and sorted(x[2] for x in k if x[:2] == (2, 3)) == [0, 1]
    gp = permute_grid(g, [3, 2, 1, 0])
    kp = ct.branch_keys(gp)
    assert {kk: g.x[i] for i, kk in enumerate(k)} == {kk: gp.x[i] for i, kk in enumerate(kp)}      # keys follow electrics, not rows
