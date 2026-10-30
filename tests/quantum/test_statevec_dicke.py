import itertools
import numpy as np
from doomsday.qsearch.dicke import amplitude_tree_circuit, dicke_prep_from_reference, dicke_state, dicke_tree_circuit, gate_counts
from doomsday.qsearch.statevec import Circuit, basis_state, run, unitary, ascii_diagram

I2 = np.eye(2); X = np.array([[0, 1], [1, 0]]); H = np.array([[1, 1], [1, -1]]) / np.sqrt(2)
def RY(t): c, s = np.cos(t / 2), np.sin(t / 2); return np.array([[c, -s], [s, c]])
def embed(n, ops):                      # ops: {qubit: 2x2}; little-endian (qubit 0 = least significant)
    M = np.array([[1.0]])
    for q in range(n - 1, -1, -1): M = np.kron(M, ops.get(q, I2))
    return M
def controlled(n, controls, target, U):
    """Explicit matrix: apply U on target iff every (qubit,value) control matches. Independent of the simulator."""
    D = 1 << n; M = np.zeros((D, D), dtype=complex)
    for b in range(D):
        if all(((b >> q) & 1) == v for q, v in controls):
            for out in (0, 1):
                tb = (b & ~(1 << target)) | (out << target); M[tb, b] += U[out, (b >> target) & 1]
        else: M[b, b] = 1
    return M

def test_gates_match_explicit_matrices():
    n = 3
    cases = [(Circuit(n).x(1), embed(n, {1: X})), (Circuit(n).h(2), embed(n, {2: H})), (Circuit(n).ry(0, 0.7), embed(n, {0: RY(0.7)})),
             (Circuit(n).cx(2, 0), controlled(n, [(2, 1)], 0, X)), (Circuit(n).mcry([(0, 1), (2, 0)], 1, 1.1), controlled(n, [(0, 1), (2, 0)], 1, RY(1.1))),
             (Circuit(n).mcz([0, 1, 2]), np.diag([1, 1, 1, 1, 1, 1, 1, -1]).astype(complex))]
    for c, M in cases: assert np.allclose(unitary(c), M, atol=1e-14), c.ops
    assert np.allclose(unitary(Circuit(3).h(0).cx(0, 1).ry(2, .3)), embed(3, {2: RY(.3)}) @ controlled(3, [(0, 1)], 1, X) @ embed(3, {0: H}))   # composition order

def test_unitarity_inverse_and_validation():
    rng = np.random.default_rng(0); c = Circuit(4)
    for _ in range(25):
        q = rng.permutation(4); t = int(rng.integers(5))
        [c.x(q[0]), c.h(q[0]), c.ry(q[0], rng.normal()), c.cx(q[0], q[1]), c.mcry([(q[1], int(rng.integers(2))), (q[2], 1)], q[0], rng.normal())][t]
    U = unitary(c); assert np.allclose(U.conj().T @ U, np.eye(16), atol=1e-12) and np.allclose(unitary(c.inverse()) @ U, np.eye(16), atol=1e-12)
    for bad in (lambda: Circuit(2).x(2), lambda: Circuit(2).cx(0, 0), lambda: Circuit(2).mcry([(0, 2)], 1, .1), lambda: Circuit(2).mcz([0, 0]), lambda: Circuit(2).extend(Circuit(3))):
        try: bad()
        except ValueError: continue
        raise AssertionError

def test_Q1_dicke_exact_for_all_L_up_to_10_and_all_k():
    worst = 0.0
    for n in range(1, 11):
        for k in range(0, n + 1):
            d = dicke_state(n, k)
            st0 = run(dicke_tree_circuit(n, k)); st1 = run(dicke_prep_from_reference(n, k), basis_state(n, range(k)))      # from |0^n> and from |1^k 0^(n-k)>
            for st in (st0, st1):
                fid = abs(np.vdot(d, st)) ** 2; worst = max(worst, 1 - fid)
                assert fid >= 1 - 1e-10 and np.allclose(st, d, atol=1e-10)             # also fixes the global phase: amplitudes are +1/sqrt(C)
                w = np.array([bin(b).count("1") for b in range(1 << n)]); assert np.abs(st[w != k]).max() < 1e-12     # support only on weight k
    assert worst < 1e-13

def test_dicke_analytic_state_properties_and_invalid_inputs():
    for n, k in ((4, 2), (6, 3), (7, 1)):
        d = dicke_state(n, k); assert abs(np.linalg.norm(d) - 1) < 1e-14 and (d > 0).sum() == __import__("math").comb(n, k)
    for bad in ((3, 4), (3, -1)):
        try: dicke_state(*bad)
        except ValueError: continue
        raise AssertionError
    for amps in (np.array([1.0, 1.0, 0, 0]), np.array([-1.0, 0, 0, 0]), np.ones(3) / np.sqrt(3)):
        try: amplitude_tree_circuit(amps, 2)
        except ValueError: continue
        raise AssertionError
    # a generic non-Dicke real state is also prepared exactly (the tree is a general real-amplitude preparation)
    a = np.abs(np.random.default_rng(3).normal(size=16)); a /= np.linalg.norm(a)
    assert np.allclose(run(amplitude_tree_circuit(a, 4)).real, a, atol=1e-12)

def test_dicke_circuit_is_unitary_reference_mapping_and_gate_counts_reported_not_assumed():
    for n, k in ((4, 2), (5, 2), (6, 3)):
        U = unitary(dicke_prep_from_reference(n, k)); assert np.allclose(U.conj().T @ U, np.eye(1 << n), atol=1e-12)
        ref = sum(1 << q for q in range(k)); assert np.allclose(U[:, ref], dicke_state(n, k), atol=1e-12)
    c = gate_counts(8, 3); assert c["total"] == sum(v for kk, v in c.items() if kk != "total") and c["x"] == 3
    # DEVIATION GUARD: gate count is exponential-like, NOT O(kL); this test pins the honesty of the documentation
    assert gate_counts(10, 5)["total"] > 10 * 5 * 3

def test_ascii_diagram_smoke():
    s = ascii_diagram(dicke_prep_from_reference(4, 2)); assert s.count("\n") == 3 and "Ry" in s and "@" in s
