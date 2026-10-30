"""Phase 9 (+13b cascade): generate parity fixtures for the JavaScript port (app/js/core/*.js) from the Python reference implementation.
  PYTHONPATH=. python scripts/make_js_fixtures.py            -> app/test/fixtures/parity.json and cascade.json (then: node --test app/test)
  PYTHONPATH=. python scripts/make_js_fixtures.py --cascade  -> only app/test/fixtures/cascade.json"""
import sys
import json, math, pathlib
import numpy as np
from doomsday.experiments.ranking_metrics import distinct_levels, jaccard, s_T, spearman, tie_expanded_topT
from doomsday.qsearch.dh_gas import dh_max
from doomsday.qsearch.emulation import collapsed_trajectory, full_vector_trajectory, optimal_r, p_closed
from doomsday.qsearch.predicate import PredicateTable
from doomsday.qsearch.topt import top_t_threshold
from doomsday.resource.components import SCENARIOS
from doomsday.resource.crossover import k_bracket
from doomsday.resource.params import ModelParams
from doomsday.resource.scenarios import evaluate, k_star, sweep_k

OUT = pathlib.Path("app/test/fixtures/parity.json")
num = lambda x: None if x is None else ("inf" if x == math.inf else float(x))
KAPPA = {"island_detection": 0.38, "multiplier_flow_update": 7.33, "comparators_trip": 29.5, "served_load_accumulation": 3.75, "qrom_sensitivity_lookup": 14.0}
PSETS = {"default": {}, "measured_like": {"t_classical_s": 7.2e-3, "R": 3, "k_eff_factor": 2.3333333333333335, "c_q": 2.6, "b": 20, "t_toffoli_s": 1e-6, "uncompute_factor": 1.0, "P": 1000}}

def main():
    fx = {"resource": [], "sweep": [], "kstar": [], "kbracket": [], "emulation": {}, "ranking": [], "stochastic": []}
    for (L, B) in ((20, 14), (41, 30), (186, 118)):
        for k in (2, 3, 4):
            for sc in SCENARIOS:
                for prep in ("v2_assumed", "tree_counted", "be_counted"):
                    if prep == "tree_counted" and L > 41 and k > 3: continue
                    for pname, over in PSETS.items():
                        for kap in (None, KAPPA):
                            p = ModelParams().with_(**over) if over else ModelParams(); r = evaluate(L, B, k, sc, prep, p, kappa=kap)
                            ph = r["physical_qubits_estimate"]["v2_volume_convention"]["physical_total"]
                            fx["resource"].append({"in": {"L": L, "B": B, "k": k, "scenario": sc, "prep": prep, "params": over, "kappa": kap},
                                                   "out": {"N": r["inputs"]["N"], "k_eff": r["inputs"]["k_eff"], "G": r["toffoli_per_grover_iteration"]["G"],
                                                           "E_f": r["toffoli_per_grover_iteration"]["oracle_compute_E_f"], "C_D": r["toffoli_per_grover_iteration"]["dicke_prep_C_D"],
                                                           "Q": r["separate_costs"]["quantum_oracle_calls_Q"], "Tq_s": r["totals"]["quantum_total_time_s"],
                                                           "Tc_s": r["separate_costs"]["classical_time_s"], "ratio_Tq_over_Tc": r["totals"]["ratio_Tq_over_Tc"],
                                                           "N_star": num(r["crossover"]["N_star"]), "k_bracket": list(r["crossover"]["k_bracket_at_N_star"]) if r["crossover"]["k_bracket_at_N_star"] else None,
                                                           "logical_qubits": r["logical_qubits"]["total"], "physical_qubits": ph, "calibrated": r["calibrated"]}})
    for sc in SCENARIOS:
        for prep in ("v2_assumed", "be_counted"):
            for kap in (None, KAPPA):
                fx["sweep"].append({"in": {"L": 186, "B": 118, "ks": list(range(3, 11)), "scenario": sc, "prep": prep, "kappa": kap},
                                    "out": [{k_: num(v) if isinstance(v, float) else v for k_, v in row.items()} for row in sweep_k(186, 118, range(3, 11), sc, prep, kappa=kap)]})
                fx["kstar"].append({"in": {"L": 186, "B": 118, "scenario": sc, "prep": prep, "kmax": 40, "kappa": kap}, "out": k_star(186, 118, sc, prep, kmax=40, kappa=kap)})
    for L, N in ((20, 1e3), (186, 1.6e13), (186, 2.6e26), (41, 101270.0), (41, 101269.999), (186, 5.0)):
        fx["kbracket"].append({"in": {"L": L, "N": N}, "out": list(k_bracket(L, N))})
    fx["emulation"]["p_closed"] = [{"r": r, "N": N, "M": M, "p": float(p_closed(r, N, M))} for N, M in ((15, 1), (56, 4), (1140, 3), (1055240, 1)) for r in (0, 1, 2, 5, 26, 806)]
    fx["emulation"]["optimal_r"] = [{"N": N, "M": M, "r": optimal_r(N, M)} for N, M in ((15, 1), (56, 4), (1140, 1), (1055240, 1), (100, 0), (100, 100))]
    a, b, p = collapsed_trajectory(1140, 3, 40); fx["emulation"]["collapsed"] = {"N": 1140, "M": 3, "rmax": 40, "p": p.tolist(), "alpha": a.tolist()}
    mk = np.zeros(56, bool); mk[[3, 9, 17, 40]] = True; R, pm = full_vector_trajectory(mk, 8); fx["emulation"]["full_vector"] = {"marked": mk.tolist(), "rmax": 8, "p": pm.tolist(), "last": R[-1].tolist()}
    rng = np.random.default_rng(0)
    for n, rnd in ((50, 1), (300, 2), (1000, 3)):
        Sa = np.round(rng.random(n), rnd); Sb = np.clip(Sa + rng.normal(0, 0.1, n), 0, 1).round(rnd)
        fx["ranking"].append({"Sa": Sa.tolist(), "Sb": Sb.tolist(), "sT10": s_T(Sa, 10), "top10": tie_expanded_topT(Sa, 10).tolist(),
                              "jaccard10": jaccard(tie_expanded_topT(Sa, 10), tie_expanded_topT(Sb, 10)), "spearman": spearman(Sa, Sb), "levels": distinct_levels(Sa)})
    for name, S in (("distinct_1140", np.random.default_rng(5).permutation(np.linspace(0, 1, 1140))), ("tied_1140", np.round(np.random.default_rng(6).random(1140) ** 3, 2))):
        pt = PredicateTable(S); runs = [dh_max(pt, np.random.default_rng(s)) for s in range(2000)]
        tq = [top_t_threshold(pt, 10, np.random.default_rng(s))["quantum_oracle_calls"] for s in range(500)]
        fx["stochastic"].append({"name": name, "S": S.tolist(), "dh_mean_total_calls": float(np.mean([r["counter"].quantum_oracle_calls for r in runs])),
                                 "dh_mean_discovery_calls": float(np.mean([r["discovery_quantum_calls"] for r in runs if r["discovery_quantum_calls"] is not None])),
                                 "dh_success": float(np.mean([r["found_Smax"] for r in runs])), "topT10_threshold_mean_calls": float(np.mean(tq)), "n_runs": 2000})
    OUT.parent.mkdir(parents=True, exist_ok=True); OUT.write_text(json.dumps(fx)); print("wrote", OUT, {k: len(v) for k, v in fx.items()})

CASCADE_OUT = pathlib.Path("app/test/fixtures/cascade.json")

def cascade_main():
    """DC cascade parity cases: the 20 worst sets per (grid, k) where a table exists, plus seeded random sets of size 1-5 per grid."""
    from doomsday.api.demo_data import GRIDS, KS, ranking
    from doomsday.experiments.common import bp_cached, cfg_for
    from doomsday.experiments.framework import Ctx
    from doomsday.gridtwin.cascade import CascadeEngine
    ctx = Ctx(results_root=pathlib.Path("results/phase7")); fx = {}
    for grid in GRIDS:
        cfg = cfg_for(grid); eng = CascadeEngine(bp_cached(grid, cfg), cfg); L = eng.g.n_branch; rng = np.random.default_rng(13)
        sets = [r["outage"] for k in KS[grid] for r in ((ranking(ctx, grid, k) or {}).get("rows") or [])]
        sets += [sorted(rng.choice(L, size=int(k), replace=False).tolist()) for k in rng.integers(1, 6, size=120)]
        cases = []
        runs = [(o, "all_overloaded") for o in sets] + [(o, "most_overloaded_first") for o in sets[-60:]]
        for o, pol in runs:
            r = eng.run(o, mode="dc", policy=pol)
            cases.append({"outage": [int(v) for v in o], "policy": pol, "S": r.S, "S0": r.S0, "C": r.C, "rounds": r.rounds, "status": r.status,
                          "trips_per_round": r.trips_per_round, "islands_per_round": r.islands_per_round, "final_out_of_service": r.final_out_of_service,
                          "served": r.served_fraction_by_round})
        fx[grid] = cases
    CASCADE_OUT.parent.mkdir(parents=True, exist_ok=True); CASCADE_OUT.write_text(json.dumps(fx)); print("wrote", CASCADE_OUT, {g: len(v) for g, v in fx.items()})

if __name__ == "__main__":
    if "--cascade" not in sys.argv: main()
    cascade_main()
