import json, math, pathlib, re
from math import ceil, comb, inf, log2, sqrt
import numpy as np
from doomsday.resource import calibration
from doomsday.resource.components import SCENARIOS, grover_iteration_cost, once_only_cost, oracle_compute_cost, round_components, round_cost
from doomsday.resource.crossover import classical_time, crossover_N, crossover_numeric, k_bracket, quantum_time
from doomsday.resource.params import ModelParams, from_config_resource
from doomsday.resource.prep import dicke_prep_cost_tree, dicke_prep_cost_v2, dicke_tree_op_counts, tree_toffoli_equivalents
from doomsday.resource.qubits import code_distance, logical_qubits, physical_qubits
from doomsday.resource.scenarios import PREPS, evaluate, heatmap_N_star, k_star, sweep_k, tornado

L, B, b, m, R, D = 186, 118, 16, 9, 4, 20
def close(a, v, tol): assert abs(a - v) <= tol * abs(v), (a, v)

# ---- hand arithmetic, written independently of the library ----------------------------------------------------------------
H = {"island": 19 * L * D, "qrom": m * L, "cmp": L * b, "served": B * b, "flow": L * m * b * b, "inv": m ** 3 * b * b / 3, "inj": L * B * b * b, "ge": B ** 3 * b * b / 3}
H_ROUND = {"optimistic": H["island"] + H["qrom"] + H["cmp"] + H["served"] + H["flow"] + H["inv"],
           "realistic": H["island"] + H["qrom"] + H["cmp"] + H["served"] + H["flow"] + H["inv"] + H["inj"],
           "pessimistic": H["island"] + H["qrom"] + H["cmp"] + H["served"] + H["inj"] + H["ge"]}
ONCE = 3 * L * ceil(log2(L)) + b

def test_R1_components_match_v2_formulas_and_v2_printed_two_sig_fig_values():
    c = round_components(L, B, m, b, D, 19.0, "pessimistic"); o = round_components(L, B, m, b, D, 19.0, "optimistic"); r = round_components(L, B, m, b, D, 19.0, "realistic")
    assert o["rank_K_flow_update"] == H["flow"] == 428_544 and o["small_inverse"] == H["inv"] == 62_208 and o["phi_qrom_lookups"] == 1_674
    assert r["injection_update_PTDF_dP"] == H["inj"] == 5_618_688 and c["full_gaussian_elimination"] == H["ge"] and o["comparators_trip_update"] == 2_976 and o["served_load_accumulation"] == 1_888
    for got, printed in ((o["rank_K_flow_update"], 4.29e5), (o["small_inverse"], 6.2e4), (o["phi_qrom_lookups"], 1.7e3), (r["injection_update_PTDF_dP"], 5.62e6),
                         (o["comparators_trip_update"], 3.0e3), (o["served_load_accumulation"], 1.9e3), (c["full_gaussian_elimination"], 1.4e8), (o["island_detection"], 7e4)):
        close(got, printed, 0.025)                                                                    # V2 prints 2 significant figures
    assert set(o) == {"island_detection", "phi_qrom_lookups", "comparators_trip_update", "served_load_accumulation", "rank_K_flow_update", "small_inverse"}
    assert "injection_update_PTDF_dP" not in o and "rank_K_flow_update" not in c and "small_inverse" not in c and "full_gaussian_elimination" not in r        # scenario block membership (V2 16.2/16.3)
    for sc in SCENARIOS: assert round_cost(L, B, m, b, D, 19.0, sc) == H_ROUND[sc]
    for sc, printed in (("optimistic", 5.7e5), ("realistic", 6.2e6), ("pessimistic", 1.5e8)): close(H_ROUND[sc], printed, 0.03)
    close(ONCE, 5e3, 0.12); assert once_only_cost(L, 3, b) == ONCE

def test_R1_three_hand_computed_G_rows_and_times():
    N = comb(L, 3); assert N == 1_055_240
    for sc, tT, printed_G, printed_T, p1, p1000 in (("optimistic", 1e-6, 4.6e6, 5 * 3600, 1.4e9, 1.4e15), ("realistic", 10e-6, 5.0e7, 24 * 86400, 1.6e13, 1.6e19),
                                                   ("pessimistic", 100e-6, 1.2e9, 16 * 365.25 * 86400, 9e17, 9e23)):
        Ef = R * H_ROUND[sc] + ONCE; G = 2 * Ef + 2 * (3 * L * 20) + L                                  # hand: 2E_f + 2C_D + C_refl
        r = evaluate(L, B, 3, sc, "v2_assumed", ModelParams(t_toffoli_s=tT))
        assert r["toffoli_per_grover_iteration"]["G"] == G and r["toffoli_per_grover_iteration"]["oracle_compute_E_f"] == Ef            # exact
        close(G, printed_G, 0.03); Q = 4 * sqrt(N); assert r["separate_costs"]["quantum_oracle_calls_Q"] == Q and abs(Q - 4109) < 1
        Tq = Q * G * tT; assert r["separate_costs"]["quantum_oracle_time_s"] == Tq; close(Tq, printed_T, 0.06)
        assert abs(r["separate_costs"]["classical_time_s"] - N * 0.5e-3) < 1e-9 and abs(N * 0.5e-3 - 527.62) < 0.01                       # 8.8 min
        close(r["crossover"]["N_star"], p1, 0.05); close(evaluate(L, B, 3, sc, "v2_assumed", ModelParams(t_toffoli_s=tT, P=1000))["crossover"]["N_star"], p1000, 0.05)
        assert r["crossover"]["N_star"] == (4 * G * tT / 0.5e-3) ** 2                                                                  # closed form, by hand
    assert quantum_time(N, 1.0, 1.0, 4.0) == 4 * sqrt(N) and classical_time(N, 2.0, 4, 1.0, 1.0) == N * 0.5

def test_R1_crossover_equals_numerical_root_and_v2_scaling_statements():
    rng = np.random.default_rng(0)
    for _ in range(40):
        G, tT, tc, P, cq = 10 ** rng.uniform(5, 10), 10 ** rng.uniform(-6, -4), 10 ** rng.uniform(-4, -2), 10 ** rng.uniform(0, 5), rng.uniform(1, 20)
        Pq, kap, a, M = float(rng.choice([1, 4, 100])), rng.uniform(0.5, 3), float(rng.choice([1.0, 0.9, 0.75, 0.6])), float(rng.choice([1, 3, 10]))
        nf = crossover_N(G, tT, tc, P, cq, Pq, kap, a, M); nn = crossover_numeric(G, tT, tc, P, cq, Pq, kap, a, M)
        close(nf, nn, 1e-6)
        assert abs(quantum_time(nf, G, tT, cq, M, Pq) / classical_time(nf, tc, P, kap, a) - 1) < 1e-9          # T_q = T_c exactly at N*
    assert crossover_N(1e7, 1e-5, 1e-3, 1, 4, alpha=0.5) == inf and crossover_N(1e7, 1e-5, 1e-3, 1, 4, alpha=0.3) == inf       # no crossover for alpha <= 1/2
    assert crossover_numeric(1e7, 1e-5, 1e-3, 1, 4, alpha=0.5) == inf
    base = crossover_N(5e7, 1e-5, 5e-4, 1, 4)
    close(crossover_N(2.5e7, 1e-5, 5e-4, 1, 4), base / 4, 1e-12)                                        # halving the oracle cost: N*/4
    close(crossover_N(5e7, 1e-6, 5e-4, 1, 4), base / 100, 1e-12)                                        # 10x faster clock: N*/100
    close(crossover_N(5e7, 1e-5, 5e-4, 1000, 4), base * 1e6, 1e-12)                                     # 1000 cores: x1e6
    close(crossover_N(5e7, 1e-5, 5e-4, 1, 4, alpha=0.75), (4 * 5e7 * 1e-5 / 5e-4) ** 4, 1e-12)          # V2: alpha=3/4, kappa=1 -> (RHS)^4
    close((4 * 5e7 * 1e-5 / 5e-4) ** 4, 2.6e26, 0.03)
    close(crossover_N(5e7, 1e-5, 5e-4, 1, 4, M=4), base / 4, 1e-12)                                     # M marked: N* ∝ 1/M for alpha=1

def test_k_bracket_reproduces_the_v2_statements():
    assert k_bracket(186, 1.4e9) == (4, 5) and k_bracket(186, 1.6e13) == (7, 8) and k_bracket(186, 1.6e19)[0] in (12, 13)
    assert comb(186, 4) <= 1.4e9 < comb(186, 5) and comb(186, 7) < 1.6e13 < comb(186, 8)
    assert k_bracket(186, 0.5) == (0, 1) and k_bracket(20, 1140)[0] == 3

def test_monotonicity_of_N_star_in_every_parameter():
    f = lambda **kw: crossover_N(**{"G": 5e7, "t_T": 1e-5, "t_c": 5e-4, "P": 1, "c_q": 4, **kw})
    for k in ("G", "t_T", "P", "c_q"): assert f(**{k: {"G": 1e8, "t_T": 2e-5, "P": 10, "c_q": 8}[k]}) > f()
    # more classical work (larger t_c-inverse, kappa, alpha) or more quantum parallelism => the quantum side wins SOONER => N* falls
    assert f(t_c=1e-3) < f() and f(Pq=4) < f() and f(kappa=2) < f() and f(alpha=0.8) < f(alpha=0.75) and f(alpha=1.0) < f(alpha=0.8)
    close(f(kappa=2), f() / 4, 1e-12)

def test_logical_qubits_by_hand_and_tree_ancillas():
    for sc, want in (("optimistic", L + L + R * (L * b + L) + 4 * b), ("realistic", L + L + R * (L * b + L) + 4 * b + m * L * b), ("pessimistic", L + L + R * (L * b + L) + 4 * b + m * L * b + B * B * b)):
        assert logical_qubits(L, B, m, b, R, sc)["total"] == want, sc
    assert logical_qubits(L, B, m, b, R, "realistic")["total"] == 39_868 and abs(B * B * b - 2e5) < 3e4         # V2: ~4e4 realistic; ~2e5 for the dense matrix
    a = evaluate(L, B, 3, "realistic", "v2_assumed"); t = evaluate(L, B, 3, "realistic", "tree_counted")
    assert t["logical_qubits"]["total"] - a["logical_qubits"]["total"] == 184 == t["logical_qubits"]["parts"]["tree_and_ladder_ancillas"]    # c_max-1 AND-ladder ancillas

def test_physical_qubit_estimate_formula_and_monotonicity():
    d = code_distance(2e11, 0.1, 0.1); assert d % 2 == 1 and 2e11 * 0.1 * 0.1 ** ((d + 1) / 2) <= 0.1 < 2e11 * 0.1 * 0.1 ** ((d - 1) / 2)       # smallest odd d meeting the criterion
    p = physical_qubits(40_000, 2e11); assert p["physical_total"] == 40_000 * 2 * p["code_distance"] ** 2 * 1.5
    assert p["physical_per_logical"] == 2 * p["code_distance"] ** 2 and p["physical_total"] == 40_000 * p["physical_per_logical"] * 1.5      # reported field consistent with the total
    assert evaluate(L, B, 3, "realistic", "v2_assumed")["physical_qubits_estimate"]["v2_volume_convention"]["physical_per_logical"] == 2 * evaluate(L, B, 3, "realistic", "v2_assumed")["physical_qubits_estimate"]["v2_volume_convention"]["code_distance"] ** 2
    assert physical_qubits(40_000, 2e11, conservative=True)["code_distance"] > p["code_distance"] and code_distance(1e15) > code_distance(1e9) and code_distance(1e11, p_ratio=0.01) < code_distance(1e11, p_ratio=0.1)
    ev = evaluate(L, B, 3, "realistic", "v2_assumed")["physical_qubits_estimate"]
    assert 1e7 <= ev["v2_volume_convention"]["physical_total"] <= 1e8 and ev["conservative_volume_x_logical"]["physical_total"] >= ev["v2_volume_convention"]["physical_total"] and "bound only" in ev["quality"]

def test_tree_op_counts_equal_the_real_circuit_for_every_n_le_10_and_k():
    from doomsday.qsearch.dicke import dicke_prep_from_reference
    for n in range(1, 11):
        for k in range(0, n + 1):
            actual = {int(kk.split("[")[1].split("ctrl")[0]): v for kk, v in dicke_prep_from_reference(n, k).counts().items() if kk.startswith("mcry")}
            assert actual == dicke_tree_op_counts(n, k), (n, k)
    for bad in ((3, 4), (3, -1)):
        try: dicke_tree_op_counts(*bad)
        except ValueError: continue
        raise AssertionError

def test_both_preparation_scenarios_are_reported_separately_and_not_equivalent():
    a = evaluate(L, B, 3, "realistic", "v2_assumed"); t = evaluate(L, B, 3, "realistic", "tree_counted")
    CDa, CDt = a["toffoli_per_grover_iteration"]["dicke_prep_C_D"], t["toffoli_per_grover_iteration"]["dicke_prep_C_D"]
    assert CDa == 3 * L * 20 == dicke_prep_cost_v2(L, 3, 20) and CDt == dicke_prep_cost_tree(L, 3, 20)["toffoli_equivalents"] and CDt > 1000 * CDa
    assert "ASSUMPTION" in a["prep_scenario_note"] and "NOT been reproduced" in a["prep_scenario_note"] and "Not equivalent" in t["prep_scenario_note"]
    assert a["warnings"] == [] and "not reproduced" in t["warnings"][0] and t["toffoli_per_grover_iteration"]["G"] > a["toffoli_per_grover_iteration"]["G"]
    assert t["crossover"]["N_star"] > a["crossover"]["N_star"] and set(PREPS) == {"v2_assumed", "tree_counted"}
    # the implemented tree needs ~N rotations (exact amplitude loading ~ enumerating Omega_k): the structural reason it cannot be a Tier C path
    for kk in (3, 4):
        n = dicke_prep_cost_tree(L, kk, 20)["n_rotations"]; assert 1.0 <= n / comb(L, kk) <= 1.1, (kk, n / comb(L, kk))
    # hand check of the conversion: ops with c controls cost and_overhead*(c-1)+c_rot
    assert tree_toffoli_equivalents({0: 1, 1: 2, 3: 5}, 20.0, 2.0) == 1 * 20 + 2 * 20 + 5 * (2 * 2 + 20)
    assert k_star(L, B, "realistic", "tree_counted", ModelParams(t_toffoli_s=10e-6), kmax=30) is None            # never ahead for k<=30 with the implemented tree

def test_cost_classes_are_kept_distinct_and_never_merged():
    p = ModelParams(c_tail=9.7); r = evaluate(L, B, 3, "realistic", "v2_assumed", p); s = r["separate_costs"]; N = comb(L, 3)
    assert s["quantum_oracle_calls_Q"] == 4 * sqrt(N) and s["classical_verifications_V"] == p.verif_per_qcall * s["quantum_oracle_calls_Q"]
    assert s["classical_verification_time_s"] == s["classical_verifications_V"] * p.t_classical_s
    assert r["totals"]["quantum_total_time_s"] == s["quantum_oracle_time_s"] + s["classical_verification_time_s"] and 0 < r["totals"]["verification_fraction_of_quantum"] < 0.01
    pre = s["tier_B_emulation_preprocessing"]; assert pre["classical_evaluations"] == N and "never part of the quantum cost" in pre["note"] and "ONLY to emulate" in pre["note"]
    assert s["quantum_oracle_calls_to_certified_stop"] == s["quantum_oracle_calls_Q"] + 9.7 * sqrt(N)
    assert s["quantum_oracle_time_to_certified_stop_s"] == s["quantum_oracle_calls_to_certified_stop"] * r["toffoli_per_grover_iteration"]["G"] * p.t_toffoli_s
    assert evaluate(L, B, 3, "realistic", "v2_assumed")["separate_costs"]["quantum_oracle_calls_to_certified_stop"] is None      # V2 model has no stop-rule term
    assert s["classical_exhaustive_evaluations"] == N and s["classical_time_s"] == N * p.t_classical_s

def test_model_is_never_calibrated_and_says_so():
    st = calibration.status(); assert st["calibrated"] is False and st["kappa_cal"] is None and "micro-oracle" in st["reason"]
    for sc in SCENARIOS:
        for pr in PREPS:
            r = evaluate(L, B, 3, sc, pr); assert r["calibrated"] is False and r["calibration"]["kappa_cal"] is None and r["evidence"].startswith("[ESTIMATED]")

def test_parameter_provenance_is_explicit_and_overrides_are_recorded():
    p = ModelParams(); assert set(p.provenance) == {k for k in p.to_dict() if k != "provenance"} and all(len(v) > 10 for v in p.provenance.values())
    q = p.with_(t_toffoli_s=1e-6); assert q.provenance["t_toffoli_s"] != p.provenance["t_toffoli_s"] and q.t_toffoli_s == 1e-6 and p.t_toffoli_s == 10e-6 and "override" in q.provenance["t_toffoli_s"]
    assert "measured" in p.provenance["verif_per_qcall"] and "V2" in p.provenance["c_q"] and "placeholder" in p.provenance["R"]
    try: p.with_(nonsense=1)
    except KeyError: pass
    else: raise AssertionError
    c = from_config_resource({"b": 24, "R": 7, "t_toffoli_us": 3, "c_q": 5.0, "t_classical_ms": {"dc": 2.0, "ac": 10}, "k_eff": "4k"})
    assert (c.b, c.R, c.t_toffoli_s, c.c_q, c.t_classical_s, c.k_eff_factor) == (24, 7, 3e-6, 5.0, 2e-3, 4.0) and "configs/default.yaml" in c.provenance["b"]
    assert p.keff(3) == 9 and ModelParams(k_eff_factor=2.0).keff(5) == 10

def test_evaluate_validation_and_purity():
    for bad in (dict(scenario="x"), dict(prep="y")):
        try: evaluate(L, B, 3, **bad)
        except ValueError: continue
        raise AssertionError
    for kw in (dict(k=-1), dict(k=0), dict(k=187), dict(k=2.5), dict(k=True), dict(M=0), dict(M=10 ** 12)):
        try: evaluate(L, B, **{"k": 3, **kw})
        except ValueError: continue
        raise AssertionError(kw)
    for bad in ((0, 5, 1), (5, 0, 1)):
        try: evaluate(*bad)
        except ValueError: continue
        raise AssertionError(bad)
    assert evaluate(L, B, 3, "realistic", "v2_assumed") == evaluate(L, B, 3, "realistic", "v2_assumed")

def test_sweep_and_self_consistent_k_star_use_G_of_k():
    p = ModelParams(t_toffoli_s=10e-6); rows = sweep_k(L, B, range(3, 9), "realistic", "v2_assumed", p)
    assert [r["k"] for r in rows] == list(range(3, 9)) and all(rows[i]["G"] < rows[i + 1]["G"] for i in range(5))          # G grows with k (keff = 3k)
    ks = k_star(L, B, "realistic", "v2_assumed", p, kmax=20); assert ks is not None and 7 <= ks <= 12
    row = {r["k"]: r for r in sweep_k(L, B, range(1, ks + 1), "realistic", "v2_assumed", p)}
    assert row[ks]["ratio"] < 1 <= row[ks - 1]["ratio"]
    assert k_star(L, B, "realistic", "v2_assumed", p.with_(P=1000), kmax=40) > ks                                          # more classical cores push k* up
    lb = crossover_N(row[3]["G"] if 3 in row else sweep_k(L, B, [3], "realistic", "v2_assumed", p)[0]["G"], 10e-6, 0.5e-3, 1, 4)
    assert lb < row[ks]["N_star"]                                                                                           # using G(k=3) gives a LOWER bound on N* (V2 16.1)

def test_tornado_and_heatmap_are_consistent_with_the_model():
    base = ModelParams(); rg = {"t_toffoli_s": [1e-6, 1e-4], "P": [1, 1000], "scenario": ["optimistic", "pessimistic"], "prep": ["v2_assumed", "tree_counted"]}
    t = tornado(L, B, 3, "realistic", "v2_assumed", base, rg)
    assert t["baseline_N_star"] == evaluate(L, B, 3, "realistic", "v2_assumed", base)["crossover"]["N_star"]
    sw = [r["log10_swing"] for r in t["rows"]]; assert sw == sorted(sw, reverse=True)
    byp = {r["param"]: r for r in t["rows"]}; assert abs(byp["t_toffoli_s"]["log10_swing"] - 4.0) < 1e-9 and abs(byp["P"]["log10_swing"] - 6.0) < 1e-9
    h = heatmap_N_star(L, B, 3, "realistic", "v2_assumed", base, [1e-6, 1e-5, 1e-4], [1, 10, 100]); Z = np.array(h["N_star"])
    assert np.all(np.diff(Z, axis=0) > 0) and np.all(np.diff(Z, axis=1) > 0) and abs(Z[1, 0] / Z[0, 0] - 100) < 1e-6 and abs(Z[0, 1] / Z[0, 0] - 100) < 1e-6

# ---- saved outputs: regeneration check + claims lint -------------------------------------------------------------------------------
ROOT = pathlib.Path(__file__).resolve().parents[2]
NEG = ("no ", "not ", "never", "false", "n't", "without", "nor ", "neither", "cannot", "absence", "unavailable", "none", "un-", "unverified", "uncalibrated")
BANNED = ("quantum advantage", "speedup", "speed-up", "calibrated", "validated", "ground truth", "blackout prediction")
def lint(text: str) -> list:
    bad = []
    for ph in BANNED:
        for mt in re.finditer(re.escape(ph), text, re.I):
            win = text[max(0, mt.start() - 60): mt.end() + 25].lower()
            if not any(n in win for n in NEG): bad.append((ph, text[max(0, mt.start() - 50): mt.end() + 30].replace("\n", " ")))
    return bad

def test_R4_claims_lint_on_resource_outputs_and_docs():
    assert lint("a quantum advantage was demonstrated") and lint("the model is calibrated and validated") and not lint("no quantum advantage is claimed; calibrated=False")
    files = [ROOT / "docs" / "RESOURCE_MODEL.md", ROOT / "results" / "phase6" / "resource_model.json", ROOT / "doomsday" / "resource" / "__init__.py"]
    for f in files:
        if f.exists(): assert lint(f.read_text()) == [], (f.name, lint(f.read_text())[:3])
    assert all(f.exists() for f in files)

def test_saved_results_match_a_fresh_evaluation_and_every_figure_exists():
    d = json.loads((ROOT / "results" / "phase6" / "resource_model.json").read_text()); assert d["label"].startswith("[ESTIMATED]") and "calibrated=False" in d["label"]
    for sc, tT in (("optimistic", 1e-6), ("realistic", 10e-6), ("pessimistic", 100e-6)):
        for pr in PREPS:
            saved = d["IEEE118_V2_placeholder_parameters"][f"{sc}|{pr}"]["k3_full"]; fresh = evaluate(L, B, 3, sc, pr, from_config_resource({"b": 16, "R": 4, "t_toffoli_us": 10, "c_q": 4.0, "t_classical_ms": {"dc": 0.5, "ac": 10}, "k_eff": "3k"}).with_(t_toffoli_s=tT))
            assert saved["toffoli_per_grover_iteration"]["G"] == fresh["toffoli_per_grover_iteration"]["G"] and saved["crossover"]["N_star"] == fresh["crossover"]["N_star"]
            assert saved["calibrated"] is False
    for f in ("fig_time_vs_k.png", "fig_tornado.png", "fig_heatmap_Nstar.png"): assert (ROOT / "results" / "phase6" / f).stat().st_size > 5_000
    assert d["base_params"]["provenance"]["c_q"] and d["prep_comparison_warning"].startswith("The two preparation costs describe DIFFERENT")

def test_tornado_figure_labels_match_the_plotted_data_regression_for_shared_axis_bug():
    d = json.loads((ROOT / "results" / "phase6" / "resource_model.json").read_text()); rec = d["tornado_figure_as_plotted"]
    for prep in PREPS:
        rows = d["tornado_realistic_k3"][prep]["rows"]; plotted = rec[prep]                       # plotted is bottom->top, rows are top->bottom
        assert [r["label"] for r in plotted] == [r["param"] for r in rows[::-1]]
        for pl, r in zip(plotted, rows[::-1]):
            vals = [math.inf if v == "inf" else float(v) for v in r["N_star"]]
            assert abs(pl["log10_lo"] - math.log10(min(vals))) < 1e-9 and abs(pl["log10_hi"] - math.log10(max(vals))) < 1e-9, (prep, r["param"])
        sw = [r["log10_swing"] for r in rows]; assert sw == sorted(sw, reverse=True)
    byp = {r["param"]: r for r in d["tornado_realistic_k3"]["v2_assumed"]["rows"]}
    assert byp["c_rot"]["log10_swing"] < 0.01 and byp["uncompute_factor"]["log10_swing"] > 0.5      # the two bars that the shared-axis bug had swapped
    src = (ROOT / "scripts" / "phase6_resource_model.py").read_text(); assert "sharey=True" not in src and "tornado labels do not match" in src
