import itertools, math
import numpy as np
from doomsday.config import load_config
from doomsday.gridtwin.base import build_base_point
from doomsday.oracle.factory import make_oracle
from doomsday.oracle.table_oracle import TableOracle, generate_truth_table
from doomsday.qsearch import circuits as qc
from doomsday.qsearch.dicke import dicke_prep_from_reference, dicke_state, dicke_tree_circuit
from doomsday.qsearch.emulation import full_vector_trajectory, optimal_r, p_closed
from doomsday.qsearch.statevec import unitary
from doomsday.qsearch.toy import build_toy, circuit_probabilities, emulation_probabilities

CFG = load_config(); BP = build_base_point("ieee14", CFG)
def oracle(k): return make_oracle("dc", k, CFG, bp=BP)

def test_Q2_reflection_is_I_minus_2DD_exactly_and_2DD_minus_I_on_weight_k_up_to_global_sign():
    for n in range(2, 8):
        for k in range(1, n):
            D = dicke_state(n, k); R = unitary(qc.reflection_about_dicke(n, k))
            assert np.allclose(R, np.eye(1 << n) - 2 * np.outer(D, D), atol=1e-12), (n, k)          # exact on the FULL 2^n space
            wk = [b for b in range(1 << n) if bin(b).count("1") == k]
            assert np.allclose(-R[np.ix_(wk, wk)], 2 * np.outer(D[wk], D[wk]) - np.eye(len(wk)), atol=1e-12)    # V2's R_D = -circuit on H_k
            # V2 form: U (I - 2|ref><ref|) U^dagger with U|ref> = |D>
            U = unitary(dicke_prep_from_reference(n, k)); ref = sum(1 << q for q in range(k)); E = np.zeros((1 << n,) * 2); E[ref, ref] = 1
            assert np.allclose(U @ (np.eye(1 << n) - 2 * E) @ U.conj().T, R, atol=1e-12)

def test_Q3_phase_oracle_is_the_diagonal_of_the_mask_and_touches_nothing_else():
    rng = np.random.default_rng(4)
    for n, k in ((5, 2), (6, 3), (7, 2)):
        wk = [b for b in range(1 << n) if bin(b).count("1") == k]
        for M in (1, 3, len(wk)):
            marked = sorted(rng.choice(wk, M, replace=False).tolist()); U = unitary(qc.phase_oracle(n, k, marked))
            expected = np.ones(1 << n); expected[marked] = -1
            assert np.allclose(U, np.diag(expected), atol=1e-13), (n, k, M)                          # diagonal, -1 exactly on marked, +1 elsewhere
    for bad in ([0b111], [0b11, 0b11], [1 << 6], [-1]):
        try: qc.phase_oracle(5, 2, bad)
        except ValueError: continue
        raise AssertionError(bad)                                                                     # only weight-k strings may be marked

def test_weight_k_subspace_is_closed_under_the_grover_iteration():
    for n, k, marked in ((6, 2, [0b000011]), (6, 2, [0b000011, 0b110000]), (7, 3, [0b0000111])):
        G = unitary(qc.grover_iteration(n, k, marked)); wk = [b for b in range(1 << n) if bin(b).count("1") == k]; out = [b for b in range(1 << n) if b not in wk]
        assert np.abs(G[np.ix_(out, wk)]).max() < 1e-12                                               # H_k -> H_k: nothing leaks to other weights
        assert np.allclose(G.conj().T @ G, np.eye(1 << n), atol=1e-12)

def test_Q4_circuit_equals_tierB_for_the_real_toy_problems_N15_and_N56():
    for m, k, rmax in ((6, 2, 8), (8, 3, 8)):
        t = build_toy(oracle(k), range(m)); assert t.N == math.comb(m, k) and t.N in (15, 56)
        c = circuit_probabilities(t, rmax); e = emulation_probabilities(t, rmax)
        assert np.abs(c["p_marked"] - e["p_marked"]).max() < 1e-9 and np.abs(c["per_state"] - e["per_state"]).max() < 1e-9
        assert np.abs(c["p_marked"] - p_closed(np.arange(rmax + 1), t.N, t.M)).max() < 1e-9                  # = sin^2((2r+1)theta)
        assert c["leak_outside_weight_k"].max() < 1e-12
        r = optimal_r(t.N, t.M); assert c["p_marked"][r] >= 0.9

def test_toy_problem_marked_set_and_oracle_equivalence_chain_O1():
    o = oracle(3); tab_root = __import__("tempfile").mkdtemp()
    tab = TableOracle.load(generate_truth_table(make_oracle("dc", 3, CFG, bp=BP, use_cache=False), tab_root, grid_name="ieee14"), 3)
    for cand in (range(8), (0, 2, 4, 6, 8, 10, 12, 14), (19, 3, 11, 5, 7, 1, 15, 9)):
        t = build_toy(o, cand)
        # (1) DC scalar oracle, (2) DC batch, (3) truth table -> three independent routes to S on the toy sets
        S1 = np.array([o.severity(g) for g in t.global_sets]); S2 = o.severity_batch(np.array(t.global_sets)); S3 = tab.severity_batch(np.array(t.global_sets))
        assert np.array_equal(S1, S2) and np.array_equal(S2, S3) and np.array_equal(t.S, S1)
        mask_independent = {mk for mk, s in zip(t.masks, S1) if s >= S1.max() - 1e-9}
        diag = np.diag(unitary(qc.phase_oracle(t.m, t.k, t.marked_masks)))                              # Tier A circuit mask
        circ_mask = {b for b in range(1 << t.m) if diag[b].real < 0}
        tierB_mask = {t.masks[i] for i in np.flatnonzero(t.marked_mask_bool())}                         # Tier B mask
        assert set(t.marked_masks) == mask_independent == circ_mask == tierB_mask
        assert all(bin(mk).count("1") == 3 for mk in t.masks) and len(set(t.masks)) == 56
        assert all(t.global_sets[i] == tuple(sorted(t.candidates[q] for q in range(t.m) if (t.masks[i] >> q) & 1)) for i in range(0, 56, 7))
    t2 = build_toy(o, range(8), rule="threshold", tau=0.3); assert t2.M == int((t2.S >= 0.3 - 1e-9).sum()) and t2.rule == "threshold"
    for bad in (lambda: build_toy(o, [0, 0, 1]), lambda: build_toy(o, [0, 1]), lambda: build_toy(o, range(8), rule="threshold"), lambda: build_toy(o, range(8), rule="x")):
        try: bad()
        except ValueError: continue
        raise AssertionError

def test_toy_marked_branches_map_to_real_branch_labels():
    t = build_toy(oracle(2), range(6)); labels = [oracle(2).structure().branch_keys[b][:2] for b in t.global_sets[t.masks.index(t.marked_masks[0])]]
    assert len(labels) == 2 and all(isinstance(x, tuple) for x in labels)
