"""BLACKSKY Quantum Lab engine (blacksky/site/js/q) against an established library: Qiskit 2.x Statevector, QuantumCircuit.depth() /
count_ops(), the OpenQASM 2 parser, and Qiskit Aer's density-matrix simulator with the same depolarizing / readout noise model.

The JavaScript engine runs through blacksky/test/tools/qsim_cli.mjs (node). Skips when node or qiskit is unavailable."""
from __future__ import annotations
import json, random, shutil, subprocess
from pathlib import Path
import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / "blacksky" / "test" / "tools" / "qsim_cli.mjs"
NODE = shutil.which("node") or ("/opt/node22/bin/node" if Path("/opt/node22/bin/node").exists() else None)
qiskit = pytest.importorskip("qiskit")
from qiskit import QuantumCircuit, qasm2  # noqa: E402
from qiskit.quantum_info import Statevector  # noqa: E402

pytestmark = pytest.mark.skipif(NODE is None, reason="node not available")

ONE = ["x", "y", "z", "h", "s", "sdg", "t", "tdg", "rx", "ry", "rz", "p"]
TWO = ["cx", "cz", "cp", "swap"]


def js(jobs):
    out = subprocess.run([NODE, str(CLI)], input=json.dumps({"jobs": jobs}), capture_output=True, text=True, timeout=120, check=True)
    return json.loads(out.stdout)["results"]


def random_ops(rng: random.Random, n: int, depth: int):
    ops = []
    for _ in range(depth):
        if n > 1 and rng.random() < 0.35:
            g = rng.choice(TWO); a, b = rng.sample(range(n), 2)
            ops.append({"g": g, "q": [a, b]} if g == "swap" else {"g": g, "c": [a], "q": [b], **({"p": [rng.uniform(-3.2, 3.2)]} if g == "cp" else {})})
        else:
            g = rng.choice(ONE); q = rng.randrange(n)
            ops.append({"g": g, "q": [q], **({"p": [rng.uniform(-3.2, 3.2)]} if g in ("rx", "ry", "rz", "p") else {})})
    return ops


def to_qiskit(n, ops, measure=False):
    qc = QuantumCircuit(n, n)
    for o in ops:
        g, q, c, p = o["g"], o["q"], o.get("c", []), o.get("p", [])
        if g == "barrier": qc.barrier(*(q or range(n)))
        elif g == "measure": qc.measure(q[0], q[0])
        elif g == "cx": qc.cx(c[0], q[0])
        elif g == "cz": qc.cz(c[0], q[0])
        elif g == "cp": qc.cp(p[0], c[0], q[0])
        elif g == "swap": qc.swap(q[0], q[1])
        elif g == "mcz": qc.h(q[0]); qc.mcx(c, q[0]); qc.h(q[0])
        else: getattr(qc, g)(*p, q[0])
    return qc


def test_statevectors_match_qiskit_on_random_circuits():
    rng = random.Random(20261029); jobs = []; refs = []
    for t in range(60):
        n = rng.randint(1, 6); ops = random_ops(rng, n, rng.randint(1, 30)); jobs.append({"kind": "sv", "n": n, "ops": ops}); refs.append((n, ops))
    for (n, ops), r in zip(refs, js(jobs)):
        sv = Statevector(to_qiskit(n, ops)).data
        np.testing.assert_allclose(np.array(r["re"]) + 1j * np.array(r["im"]), sv, atol=1e-10)


def test_depth_counts_and_qasm_roundtrip_match_qiskit():
    rng = random.Random(7); jobs = []; refs = []
    for t in range(25):
        n = rng.randint(2, 5); ops = random_ops(rng, n, rng.randint(3, 20))
        ops.insert(rng.randrange(len(ops)), {"g": "barrier", "q": []}); ops += [{"g": "measure", "q": [q]} for q in range(n)]
        jobs.append({"kind": "sv", "n": n, "ops": ops}); refs.append((n, ops))
    for (n, ops), r in zip(refs, js(jobs)):
        qc = to_qiskit(n, ops); st = r["stats"]
        assert st["depth"] == qc.depth(), (st["depth"], qc.depth())
        assert {k: v for k, v in st["counts"].items()} == {k: v for k, v in qc.count_ops().items()}
        assert st["measurements"] == n and st["twoQubit"] == sum(v for k, v in qc.count_ops().items() if k in ("cx", "cz", "cp", "swap"))
        parsed = qasm2.loads(r["qasm"]); parsed.remove_final_measurements()
        np.testing.assert_allclose(Statevector(parsed).data, Statevector(to_qiskit(n, [o for o in ops if o["g"] != "measure"])).data, atol=1e-10)


def test_grover_circuit_and_decomposition_match_qiskit():
    for n, marked, r in [(3, [5], 2), (4, [0, 9], 2), (5, [17], 4)]:
        res = js([{"kind": "grover", "n": n, "marked": marked, "r": r}])[0]
        qc = qasm2.loads(res["qasm"]); qc.remove_final_measurements()
        probs = Statevector(qc).probabilities()
        np.testing.assert_allclose(probs, res["probs"], atol=1e-10)
        theta = np.arcsin(np.sqrt(len(marked) / 2 ** n))
        assert abs(sum(probs[m] for m in marked) - np.sin((2 * r + 1) * theta) ** 2) < 1e-10
        assert res["statsCompiled"]["depth"] == qasm2.loads(res["qasm"]).depth()


def test_noisy_density_matrix_matches_aer():
    aer = pytest.importorskip("qiskit_aer")
    from qiskit_aer.noise import NoiseModel, depolarizing_error
    rng = random.Random(11); jobs = []; refs = []
    for t in range(8):
        n = rng.randint(1, 4); ops = random_ops(rng, n, rng.randint(4, 18)) + [{"g": "measure", "q": [q]} for q in range(n)]
        noise = {"p1": rng.choice([0.0, 0.003, 0.02]), "p2": rng.choice([0.0, 0.01, 0.08]), "readout": rng.choice([0.0, 0.02, 0.05]), "source": "test"}
        jobs.append({"kind": "noisy", "n": n, "ops": ops, "noise": noise}); refs.append((n, ops, noise))
    for (n, ops, noise), r in zip(refs, js(jobs)):
        qc = qasm2.loads(r["qasm"]); qc.remove_final_measurements()
        # keep the circuit's own gate names as the basis, so the transpiler does not split gates (and multiply error channels);
        # SWAP is left out on purpose: both sides execute it as three CX gates, each with its own two-qubit error channel
        nm = NoiseModel(basis_gates=["x", "y", "z", "h", "s", "sdg", "t", "tdg", "rx", "ry", "rz", "u1", "p", "cx", "cz", "cu1", "cp"])
        if noise["p1"]: nm.add_all_qubit_quantum_error(depolarizing_error(noise["p1"], 1), ["x", "y", "z", "h", "s", "sdg", "t", "tdg", "rx", "ry", "rz", "u1", "p"])
        if noise["p2"]: nm.add_all_qubit_quantum_error(depolarizing_error(noise["p2"], 2), ["cx", "cz", "cu1", "cp", "swap"])
        sim = aer.AerSimulator(method="density_matrix", noise_model=nm)
        from qiskit import transpile
        basis = ["x", "y", "z", "h", "s", "sdg", "t", "tdg", "rx", "ry", "rz", "u1", "p", "cx", "cz", "cu1", "cp"]
        tq = transpile(qc, basis_gates=basis, optimization_level=0); tq.save_probabilities()
        res = sim.run(tq).result()
        np.testing.assert_allclose(res.data()["probabilities"], r["probs"], atol=1e-9)
        # readout: JS applies the symmetric confusion matrix bit by bit; compare with the explicit tensor product in numpy
        e = noise["readout"]; Mro = np.array([[1 - e, e], [e, 1 - e]]); p = np.array(r["probs"])
        full = Mro
        for _ in range(n - 1): full = np.kron(full, Mro)
        expect = full @ p
        got = np.array([r["dist"].get(format(i, f"0{n}b"), 0.0) for i in range(2 ** n)])
        np.testing.assert_allclose(got, expect, atol=1e-12)
