"""Phase 8: Baertschi-Eidenbenz Dicke preparation (V2 11.3, Test Q1/Q2) and Qiskit exporter conventions verified against real Qiskit."""
import importlib.util
import numpy as np, pytest
from math import comb
from doomsday.qsearch.circuits import grover_circuit, reflection_about_dicke
from doomsday.qsearch.dicke import be_block_count, be_dicke_circuit, be_gate_counts, be_unitary_from_reference, dicke_state
from doomsday.qsearch.emulation import p_closed
from doomsday.qsearch.statevec import basis_state, run, unitary

HAVE_QISKIT = importlib.util.find_spec("qiskit") is not None

def test_Q1_be_dicke_exact_for_all_n_le_10_and_support_on_weight_k():
    for n in range(1, 11):
        for k in range(n + 1):
            st = run(be_dicke_circuit(n, k)); assert abs(abs(np.vdot(dicke_state(n, k), st)) ** 2 - 1) < 1e-14, (n, k)
            w = np.array([bin(b).count("1") for b in range(1 << n)]); assert np.sum(np.abs(st[w != k]) ** 2) < 1e-28

def test_be_maps_v2_reference_to_dicke():
    for n, k in ((6, 2), (8, 3), (10, 5)):
        st = run(be_unitary_from_reference(n, k), basis_state(n, range(k)))
        assert abs(abs(np.vdot(dicke_state(n, k), st)) - 1) < 1e-13

def test_be_gate_count_is_O_kn_and_matches_formula():
    for n in range(2, 13):
        for k in range(1, n):
            c = be_gate_counts(n, k); nb = be_block_count(n, k)
            assert c.get("cx", 0) == 2 * nb and c.get("mcry[1ctrl]", 0) + c.get("mcry[2ctrl]", 0) == nb and c.get("x", 0) == k
            assert nb <= k * n
    assert be_block_count(186, 3) == 183 * 3 + 3      # IEEE-118, k=3: 552 blocks (vs ~1e6 rotations for the amplitude tree)

def test_Q2_be_reflection_equals_I_minus_2DD_on_weight_k_subspace():
    for n, k in ((5, 2), (6, 3), (7, 2)):
        U = unitary(reflection_about_dicke(n, k, prep="be")); D = dicke_state(n, k)
        idx = [b for b in range(1 << n) if bin(b).count("1") == k]
        target = np.eye(1 << n) - 2 * np.outer(D, D)
        assert np.allclose(U[np.ix_(idx, idx)], target[np.ix_(idx, idx)], atol=1e-12)

def test_be_grover_equals_tree_grover_and_closed_form():
    for n, k, M in ((6, 2, 1), (8, 3, 2)):
        masks = sorted(b for b in range(1 << n) if bin(b).count("1") == k)[:M]; N = comb(n, k)
        for r in range(5):
            a = np.abs(run(grover_circuit(n, k, masks, r, prep="be"))) ** 2; b = np.abs(run(grover_circuit(n, k, masks, r))) ** 2
            assert np.allclose(a, b, atol=1e-12) and abs(sum(a[m] for m in masks) - p_closed(r, N, M)) < 1e-12

def test_bad_prep_rejected():
    with pytest.raises(ValueError):
        reflection_about_dicke(4, 2, prep="nope")

@pytest.mark.skipif(not HAVE_QISKIT, reason="qiskit not installed")
def test_qiskit_export_conventions_verified_against_real_qiskit_statevector():
    """Resolves the Phase 5 'UNVERIFIED against Qiskit' caveat: ctrl_state ordering and little-endian bit order, on circuits with
    asymmetric open/closed control patterns (tree Dicke prep) and on the BE construction."""
    from qiskit.quantum_info import Statevector
    from doomsday.qsearch.dicke import dicke_tree_circuit
    from doomsday.qsearch.qiskit_export import to_qiskit
    from doomsday.qsearch.statevec import Circuit
    rng = np.random.default_rng(0)
    for _ in range(25):                                                       # random asymmetric multi-controlled rotations
        n = 5; c = Circuit(n)
        for q in range(n): c.ry(q, float(rng.uniform(0, 3)))
        for _ in range(6):
            t = int(rng.integers(n)); others = [q for q in range(n) if q != t]; cs = rng.choice(others, int(rng.integers(1, 4)), replace=False)
            c.mcry([(int(q), int(rng.integers(2))) for q in cs], t, float(rng.uniform(-3, 3)))
        assert np.allclose(Statevector(to_qiskit(c)).data, run(c), atol=1e-10)
    for c in (dicke_tree_circuit(6, 2), be_dicke_circuit(8, 3), grover_circuit(6, 2, [3, 5], 2, prep="be")):
        assert np.allclose(Statevector(to_qiskit(c)).data, run(c), atol=1e-10)
