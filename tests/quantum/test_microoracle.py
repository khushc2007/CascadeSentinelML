"""Phase 11: A2 micro-oracle (V2 13.4, Test Q6) and per-primitive calibration hooks (Test R1 extension)."""
import numpy as np, pytest
from doomsday.qsearch import microoracle as mo
from doomsday.qsearch.reversible import RevCircuit, add_into, add_const, mul_acc_signed_unsigned, sign_of_plus_const, simulate, toffoli_equiv
from doomsday.resource import calibration
from doomsday.resource.prep import dicke_prep_cost_be
from doomsday.resource.scenarios import evaluate

def _run(c, assign):
    st = np.zeros((len(assign), c.n), np.uint8)
    for i, a in enumerate(assign):
        for reg, val in a.items():
            for j, q in enumerate(c.regs[reg]): st[i, q] = (val >> j) & 1
    return simulate(c.n, c.gates, st)

def _val(st, c, reg, signed=False):
    q = c.regs[reg]; v = sum(int(st[q[j]]) << j for j in range(len(q))); return v - (1 << len(q)) if signed and v >> (len(q) - 1) else v

@pytest.mark.parametrize("n", [1, 2, 3, 5])
def test_adders_plain_controlled_and_constant_exhaustive(n):
    c = RevCircuit(); a = c.register("a", n); b = c.register("b", n); t = c.register("t", 1); add_into(c, a, b, ctrl=t[0]); add_const(c, 3, b)
    ins = [{"a": x, "b": y, "t": z} for x in range(1 << n) for y in range(1 << n) for z in (0, 1)]; out = _run(c, ins); M = 1 << n
    for o, i in zip(out, ins):
        assert _val(o, c, "b") == (i["b"] + i["a"] * i["t"] + 3) % M and _val(o, c, "a") == i["a"] and o[2 * n + 1:].sum() == 0

def test_signed_unsigned_multiplier_and_comparator_exhaustive():
    c = RevCircuit(); a = c.register("a", 4); p = c.register("p", 3); acc = c.register("acc", 7); mul_acc_signed_unsigned(c, a, p, acc)
    ins = [{"a": x, "p": y} for x in range(16) for y in range(8)]; out = _run(c, ins)
    assert all(_val(o, c, "acc", True) == (i["a"] - 16 * (i["a"] >= 8)) * i["p"] and o[14:].sum() == 0 for o, i in zip(out, ins))
    for K in (-7, 0, 5):
        c = RevCircuit(); x = c.register("x", 5); o_ = c.register("o", 1); sign_of_plus_const(c, x, K, o_[0]); out = _run(c, [{"x": v} for v in range(32)])
        assert all(_val(o, c, "o") == int((v - 32 * (v >= 16)) + K < 0) and o[6:].sum() == 0 for v, o in zip(range(32), out))

def test_toffoli_equivalent_convention():
    assert [toffoli_equiv(c) for c in range(6)] == [0, 0, 1, 3, 5, 7]

def test_Q6_micro_oracle_all_V2_13_4_checks_pass_exhaustively():
    s = mo.exhaustive_check_summary()
    assert s["pass"] and s["n_inputs"] == 2 * (1 << mo.L) and s["n_marked"] == sum(mo.classical_oracle([(x >> l) & 1 for l in range(mo.L)])["flag"] for x in range(1 << mo.L))
    assert 0 < s["n_marked"] < (1 << mo.L)                                         # non-trivial predicate

def test_toy_is_n1_secure_and_has_cascade_driven_sets():
    single = [mo.classical_oracle([int(l == m) for l in range(mo.L)]) for m in range(mo.L)]
    assert all(r["served_int"] == mo.total_int() for r in single)                 # N-1 secure: no single outage sheds load
    casc = 0
    for x in range(1 << mo.L):
        bits = [(x >> l) & 1 for l in range(mo.L)]; s0 = np.array([not v for v in bits]); iso = sum(mo.loads_int()[b] for b in range(mo.B_BUS) if mo.reach(s0)[b])
        casc += mo.classical_oracle(bits)["served_int"] < iso
    assert casc > 0

def test_calibration_bennett_factor_and_small_inverse_flag():
    cal = mo.calibration()
    assert cal["bennett_factor_measured"] == 2.0 and cal["small_inverse"]["kappa_cal"] is None
    assert all(cal[k]["kappa_cal"] > 0 for k in mo.formula_counts())

def test_resource_default_stays_uncalibrated_and_kappa_is_opt_in():
    base = evaluate(186, 118, 3, "realistic", "v2_assumed")
    assert base["calibrated"] is False and base["calibration"]["calibrated"] is False
    kap = {"multiplier_flow_update": 2.0, "island_detection": 1.0, "comparators_trip": 1.0, "served_load_accumulation": 1.0, "qrom_sensitivity_lookup": 1.0}
    cal = evaluate(186, 118, 3, "realistic", "v2_assumed", kappa=kap, kappa_source="test")
    assert cal["calibrated"] == "partial" and cal["toffoli_per_grover_iteration"]["G"] > base["toffoli_per_grover_iteration"]["G"]
    assert "UNCALIBRATED" in cal["component_calibration"]["small_inverse"]
    ones = {k: 1.0 for k in kap}; same = evaluate(186, 118, 3, "realistic", "v2_assumed", kappa=ones)
    assert abs(same["toffoli_per_grover_iteration"]["G"] / base["toffoli_per_grover_iteration"]["G"] - 1) < 1e-12

def test_be_prep_cost_counts_match_the_verified_circuit_and_v2_order():
    from doomsday.qsearch.dicke import be_gate_counts
    for L, k in ((8, 3), (10, 4), (12, 2)):
        d = dicke_prep_cost_be(L, k, 20.0); g = be_gate_counts(L, k)
        assert d["one_control_rotations"] == g.get("mcry[1ctrl]", 0) and d["two_control_rotations"] == g.get("mcry[2ctrl]", 0)
    d = dicke_prep_cost_be(186, 3, 20.0); assert 0.9 < d["toffoli_equivalents"] / (3 * 186 * 20.0) < 1.2
    assert evaluate(186, 118, 3, "realistic", "be_counted")["toffoli_per_grover_iteration"]["dicke_prep_C_D"] == d["toffoli_equivalents"]
