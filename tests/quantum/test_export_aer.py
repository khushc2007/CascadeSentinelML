import json, math, pathlib, subprocess, sys, tempfile
import numpy as np
from doomsday.config import load_config
from doomsday.gridtwin.base import build_base_point
from doomsday.oracle.factory import make_oracle
from doomsday.qsearch import aer_runner as ar
from doomsday.qsearch.circuits import grover_circuit
from doomsday.qsearch.qiskit_export import RecordingBuilder, export
from doomsday.qsearch.statevec import Circuit, unitary
from doomsday.qsearch.toy import build_toy
from helpers import skip

class ReplayBuilder:
    """Decodes the exporter's calls back into a simulator Circuit using the ASSUMED Qiskit convention (ctrl_state bit i <-> i-th control)."""
    def __init__(self, n): self.c = Circuit(n)
    def x(self, q): self.c.x(q)
    def h(self, q): self.c.h(q)
    def ry(self, q, t): self.c.ry(q, t)
    def cx(self, a, b): self.c.cx(a, b)
    def mcry(self, controls, target, theta, cs): self.c.mcry([(q, (cs >> i) & 1) for i, q in enumerate(controls)], target, theta)
    def mcz(self, qs): self.c.mcz(qs)
    def finish(self): return self.c

def toy_circuit(m=6, k=2, r=2):
    cfg = load_config(); bp = build_base_point("ieee14", cfg); t = build_toy(make_oracle("dc", k, cfg, bp=bp), range(m)); return t, grover_circuit(m, k, t.marked_masks, r)

def test_exporter_emits_one_call_per_op_in_order_with_correct_ctrl_state_encoding():
    c = Circuit(4).x(0).h(1).ry(2, .5).cx(3, 0).mcry([(1, 1), (3, 0), (2, 1)], 0, .9).mcz([0, 1, 2, 3])
    calls = export(c, RecordingBuilder(4))
    assert [x[0] for x in calls] == ["x", "h", "ry", "cx", "mcry", "mcz"]
    assert calls[4] == ("mcry", (1, 3, 2), 0, .9, 0b101)             # values (1,0,1) -> bit0=1, bit1=0, bit2=1
    assert calls[5] == ("mcz", (0, 1, 2, 3))

def test_export_replay_roundtrip_preserves_the_unitary_for_real_toy_circuits():
    t, circ = toy_circuit(6, 2, 2); back = export(circ, ReplayBuilder(circ.n))
    assert len(back) == len(circ) and np.allclose(unitary(back), unitary(circ), atol=1e-12)
    t3, c3 = toy_circuit(5, 2, 1)
    assert np.allclose(unitary(export(c3, ReplayBuilder(5))), unitary(c3), atol=1e-12)
    try: export(Circuit(1).__class__(1, [__import__("doomsday.qsearch.statevec", fromlist=["Op"]).Op("bogus", (0,))]), RecordingBuilder(1))
    except ValueError: pass
    else: raise AssertionError("unknown op exported silently")

def test_wilson_interval_and_numpy_comparison_helpers():
    lo, hi = ar.wilson(50, 100); assert lo < 0.5 < hi and abs((lo + hi) / 2 - 0.5) < 0.01 and ar.wilson(0, 0) == (0.0, 1.0)
    lo, hi = ar.wilson(0, 1000); assert lo == 0.0 or lo < 1e-9; assert 0 < hi < 0.01
    assert ar.compare_to_numpy(2047, 4096, 0.5)["ok"] and not ar.compare_to_numpy(2400, 4096, 0.5)["ok"]
    c = ar.compare_to_numpy(3800, 4096, 0.93); assert abs(c["z_score"]) < 4 and ar.compare_to_numpy(4096, 4096, 1.0)["ok"] and ar.compare_to_numpy(0, 4096, 0.0)["ok"]

def test_status_is_NOT_RUN_without_qiskit_and_never_claims_execution():
    ok, env = ar.qiskit_available()
    if ok: skip("qiskit is installed here: the NOT_RUN path is not applicable (run the Aer scripts instead)")
    t, _ = toy_circuit(6, 2, 0)
    for fb in (None, "FakeSherbrooke"):
        r = ar.run_toy_on_aer(t, rmax=3, shots=100, fake_backend=fb)
        assert r["status"] == "NOT_RUN" and "no Aer execution took place" in r["reason"] and "rows" not in r and r["toy"]["N"] == 15
    # the status vocabulary can never contain a 'verified' claim without an executed run
    import inspect; src = inspect.getsource(ar.run_toy_on_aer); assert src.count("EXECUTED_VERIFIED") == 1 and "NOT_RUN" in src

def test_scripts_write_a_NOT_RUN_record_when_qiskit_is_absent():
    ok, _ = ar.qiskit_available()
    if ok: skip("qiskit installed: scripts would really execute")
    root = pathlib.Path(__file__).resolve().parents[2]
    with tempfile.TemporaryDirectory() as d:
        env = {**__import__("os").environ, "PYTHONPATH": str(root)}
        p = subprocess.run([sys.executable, str(root / "scripts" / "aer_toy_grover.py"), "--m", "6", "--k", "2"], cwd=d, env=env, capture_output=True, text=True)
        assert p.returncode == 0 and "STATUS: NOT_RUN" in p.stdout
        rec = json.loads((pathlib.Path(d) / "results/phase5/aer_toy_grover_6_2.json").read_text())
        assert rec["status"] == "NOT_RUN" and rec["toy"]["m"] == 6 and rec["mode"] == "ideal"


def test_ctrl_state_encoding_is_checked_on_ASYMMETRIC_patterns():
    # Dicke-tree circuits are symmetric under bit-order reversal (angles depend on prefix Hamming weight), so they cannot detect an
    # ordering bug; these hand-computed, non-palindromic cases can. Convention (UNVERIFIED against Qiskit): bit i <-> i-th control.
    for ctrls, want in ((((0, 1), (1, 0)), 0b01), (((0, 0), (1, 1)), 0b10), (((5, 1), (3, 0), (2, 0)), 0b001), (((5, 0), (3, 0), (2, 1)), 0b100),
                        (((0, 1), (1, 1), (2, 0), (3, 1)), 0b1011)):
        n = 6; c = Circuit(n).mcry(list(ctrls), 4, .3); call = export(c, RecordingBuilder(n))[0]
        assert call[1] == tuple(q for q, _ in ctrls) and call[4] == want, (ctrls, call)
    rng = np.random.default_rng(5)
    for _ in range(20):                                                    # random asymmetric circuits must round-trip exactly
        c = Circuit(5)
        for _ in range(6):
            q = rng.permutation(5); nc = int(rng.integers(1, 4)); c.mcry([(int(q[i]), int(rng.integers(2))) for i in range(nc)], int(q[4]), float(rng.normal()))
        assert np.allclose(unitary(export(c, ReplayBuilder(5))), unitary(c), atol=1e-12)
