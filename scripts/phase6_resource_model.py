"""Phase 6: resource / crossover model outputs. Label: [ESTIMATED] analytical model. NOT calibrated (no micro-oracle), NOT validated against any circuit,
no quantum advantage claimed. Two Dicke-preparation scenarios are always reported separately (V2 assumption vs counted multiplexed-RY tree).
Writes results/phase6/resource_model.json and figures (matplotlib Agg)."""
import hashlib, json, math, pathlib, platform
import numpy as np
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
from doomsday.config import config_hash, load_config
from doomsday.resource.params import ModelParams, from_config_resource, SRC_MEASURED_EMU, SRC_INFORMAL
from doomsday.resource.scenarios import PREPS, evaluate, heatmap_N_star, k_star, sweep_k, tornado
from doomsday.resource.crossover import crossover_N
from doomsday.resource.components import SCENARIOS
from doomsday.resource.prep import dicke_prep_cost_tree, dicke_prep_cost_v2

OUT = pathlib.Path("results/phase6"); OUT.mkdir(parents=True, exist_ok=True)
cfg = load_config(); base = from_config_resource(cfg.resource.__dict__)
TT = {"optimistic": 1e-6, "realistic": 10e-6, "pessimistic": 100e-6}
L118, B118 = 186, 118
res = {"label": "[ESTIMATED] resource/crossover model; calibrated=False; no quantum advantage claimed", "config_hash": config_hash(cfg),
       "resource_code_sha256": hashlib.sha256(b"".join(p.read_bytes() for p in sorted(pathlib.Path("doomsday/resource").glob("*.py")))).hexdigest(),
       "software": {"python": platform.python_version(), "numpy": np.__version__}, "base_params": base.to_dict()}

# 1. reproduction of V2 16.3 printed numbers (V2 placeholders, IEEE-118, k=3)
v2 = {"optimistic": {"G": 4.6e6, "Tq_s": 5 * 3600, "Nstar_P1": 1.4e9, "Nstar_P1000": 1.4e15}, "realistic": {"G": 5.0e7, "Tq_s": 24 * 86400, "Nstar_P1": 1.6e13, "Nstar_P1000": 1.6e19},
      "pessimistic": {"G": 1.2e9, "Tq_s": 16 * 365.25 * 86400, "Nstar_P1": 9e17, "Nstar_P1000": 9e23}}
rep = {}
for sc in SCENARIOS:
    p = base.with_(t_toffoli_s=TT[sc]); r = evaluate(L118, B118, 3, sc, "v2_assumed", p); r1000 = evaluate(L118, B118, 3, sc, "v2_assumed", p.with_(P=1000))
    mine = {"G": r["toffoli_per_grover_iteration"]["G"], "Tq_s": r["separate_costs"]["quantum_oracle_time_s"], "Nstar_P1": r["crossover"]["N_star"], "Nstar_P1000": r1000["crossover"]["N_star"]}
    rep[sc] = {kk: {"model": mine[kk], "v2_printed": v2[sc][kk], "rel_diff": mine[kk] / v2[sc][kk] - 1} for kk in mine}
res["v2_reproduction_IEEE118_k3_v2_assumed_prep"] = rep

# 2. both prep scenarios x three oracle scenarios, IEEE-118 k=3 .. 8  (V2 placeholder parameters)
tab = {}
for sc in SCENARIOS:
    for prep in PREPS:
        p = base.with_(t_toffoli_s=TT[sc]); tab[f"{sc}|{prep}"] = {"k3_full": evaluate(L118, B118, 3, sc, prep, p), "sweep_k3_to_8": sweep_k(L118, B118, range(3, 9), sc, prep, p),
                                                               "k_star_self_consistent": k_star(L118, B118, sc, prep, p, kmax=40),
                                                               "k_star_self_consistent_P1000": k_star(L118, B118, sc, prep, p.with_(P=1000), kmax=40)}
res["IEEE118_V2_placeholder_parameters"] = tab
res["prep_cost_comparison_NOT_EQUIVALENT"] = {f"L{L}_k{k}": {"v2_assumed_toffoli_eq": dicke_prep_cost_v2(L, k, 20.0), "tree_counted": dicke_prep_cost_tree(L, k, 20.0)}
                                              for L, k in ((20, 3), (41, 3), (186, 3), (186, 4), (186, 5), (186, 6))}
res["prep_comparison_warning"] = ("The two preparation costs describe DIFFERENT constructions. v2_assumed is V2's theoretical k*L*c_rot (Baertschi-Eidenbenz, not reproduced). "
                                 "tree_counted is the implemented multiplexed-RY tree with an estimated Toffoli-equivalent conversion. They must not be treated as equivalent.")

# 3. alpha sensitivity (structured classical exponent), realistic scenario
rl = evaluate(L118, B118, 3, "realistic", "v2_assumed", base); Gr = rl["toffoli_per_grover_iteration"]["G"]
res["alpha_sensitivity_realistic_k3_v2_assumed_prep"] = {str(a): crossover_N(Gr, base.t_toffoli_s, base.t_classical_s, 1, base.c_q, 1, 1.0, a) for a in (1.0, 0.9, 0.75, 0.6, 0.55, 0.5, 0.4)}
res["alpha_note"] = "alpha <= 0.5 => no asymptotic crossover (inf). alpha is a fitted exponent only for classical methods measured in E7; Phase 4 gives indicative fits on IEEE-14 only."

# 4. tornado
RANGES = {"t_toffoli_s": [1e-6, 100e-6], "c_q": [2.45, 19.4], "t_classical_s": [0.05e-3, 10e-3], "P": [1, 100000], "Pq": [1, 100], "b": [12, 32], "R": [2, 30],
          "k_eff_factor": [2.0, 10.0], "c_rot": [10, 30], "uncompute_factor": [1.0, 2.0], "alpha": [0.75, 1.0], "D": [10, 40], "scenario": ["optimistic", "pessimistic"], "prep": ["v2_assumed", "tree_counted"]}
res["tornado_realistic_k3"] = {prep: tornado(L118, B118, 3, "realistic", prep, base, RANGES) for prep in PREPS}
res["tornado_ranges_note"] = "c_q range 2.45-19.4 spans the measured IEEE-14 emulation values (discovery ~2.5 to certified-stop-per-sqrt(N/M) ~19); other ranges are V2 17."

# 5. heat map
tTv = [1e-6, 3e-6, 10e-6, 30e-6, 100e-6]; Pv = [1, 10, 100, 1000, 10000, 100000]
res["heatmap_realistic_k3"] = {prep: heatmap_N_star(L118, B118, 3, "realistic", prep, base, tTv, Pv) for prep in PREPS}

# 6. model at IEEE-14 scale with MEASURED inputs (separately labelled; tiny grid; unverified data)
mi = json.load(open("results/phase6/measured_inputs_ieee14.json")); t5 = {r["k"]: r for r in json.load(open("results/phase5/tierB_dh_ieee14.json"))["rows"]}
m14 = {}
for k in (2, 3, 4):
    v = mi["per_k"][str(k)]; q95 = t5[k]["discovery_quantum_calls"]["p95"] / math.sqrt(t5[k]["N"] / t5[k]["M_at_Smax"])
    for sc, (Rk, kf, cq, b) in {"optimistic": (v["R_rounds_solved"]["p50"], v["k_eff_final_outage_set_size"]["p50"], v["c_q_discovery_over_sqrt_N_over_M"], 16),
                                "realistic": (v["R_rounds_solved"]["p95"], v["k_eff_final_outage_set_size"]["p95"], v["c_q_discovery_over_sqrt_N_over_M"], 20),
                                "pessimistic": (v["R_rounds_solved"]["max"], v["k_eff_final_outage_set_size"]["max"], q95, 24)}.items():
        p = base.with_(source=SRC_MEASURED_EMU, R=int(Rk), c_q=cq, c_tail=v["c_tail_over_sqrt_N"], verif_per_qcall=v["verifications_per_quantum_call_at_discovery"]) \
                .with_(source=SRC_INFORMAL, t_classical_s=v["t_classical_informal_ms"]["dc"] * 1e-3).with_(b=b, t_toffoli_s=TT[sc], D=6, k_eff_factor=kf / k)
        for prep in PREPS: m14[f"k{k}|{sc}|{prep}"] = evaluate(20, 14, k, sc, prep, p, M=v["M_at_Smax"])
res["IEEE14_scale_with_measured_inputs"] = {"note": "L=20,B=14 (D=6 assumed); R, keff, c_q, c_tail, verifications measured on the IEEE-14 EMULATION (unverified data); t_c informal; tiny N: classical exhaustive search is trivially cheap", "runs": m14}
json.dump(res, open(OUT / "resource_model.json", "w"), indent=1, default=lambda x: "inf" if x == math.inf else str(x))

# ---- figures ----------------------------------------------------------------------------------------------------------
tag = "[ESTIMATED] analytical model - not calibrated - no quantum advantage claimed"
fig, ax = plt.subplots(figsize=(8, 5)); ks = list(range(3, 9)); col = {"optimistic": "tab:green", "realistic": "tab:blue", "pessimistic": "tab:red"}
for sc in SCENARIOS:
    for prep, ls in (("v2_assumed", "-"), ("tree_counted", "--")):
        ax.plot(ks, [r["Tq_s"] for r in tab[f"{sc}|{prep}"]["sweep_k3_to_8"]], ls, color=col[sc], label=f"T_q {sc}, prep={prep}")
ax.plot(ks, [r["Tc_s"] for r in tab["realistic|v2_assumed"]["sweep_k3_to_8"]], "k-", lw=2, label="T_c exhaustive, P=1 (t_c=0.5 ms)")
ax.plot(ks, [r["Tc_s"] / 1000 for r in tab["realistic|v2_assumed"]["sweep_k3_to_8"]], "0.5", lw=2, label="T_c exhaustive, P=1000")
ax.set_yscale("log"); ax.set_xlabel("k (IEEE-118, L=186; G evaluated at each k with keff=3k)"); ax.set_ylabel("time [s]"); ax.legend(fontsize=6); ax.set_title(tag, fontsize=8); fig.tight_layout(); fig.savefig(OUT / "fig_time_vs_k.png", dpi=130); plt.close(fig)
fig, axs = plt.subplots(1, 2, figsize=(13, 5))            # NOT sharey: each panel has its own row order (a shared axis once mislabelled the left panel)
panel_record = {}
for a_, prep in zip(axs, PREPS):
    rows = res["tornado_realistic_k3"][prep]["rows"]; n0 = res["tornado_realistic_k3"][prep]["baseline_N_star"]; labels = [r["param"] for r in rows[::-1]]
    for i, r in enumerate(rows[::-1]):
        lo, hi = min(r["N_star"]), max(r["N_star"]); a_.barh(i, math.log10(hi) - math.log10(lo), left=math.log10(lo), color="tab:blue")
    a_.axvline(math.log10(n0), color="k"); a_.set_yticks(range(len(rows))); a_.set_yticklabels(labels, fontsize=7); a_.set_xlabel("log10 N*"); a_.set_title(f"prep={prep}\n{tag}", fontsize=7)
    plotted = [t.get_text() for t in a_.get_yticklabels()]; assert plotted == labels, "tornado labels do not match the plotted rows"      # guard against the shared-axis bug
    bars = [(p_.get_y() + p_.get_height() / 2, p_.get_x(), p_.get_x() + p_.get_width()) for p_ in a_.patches]
    for (y, lo_, hi_), r in zip(bars, rows[::-1]):
        assert abs(lo_ - math.log10(min(r["N_star"]))) < 1e-9 and abs(hi_ - math.log10(max(r["N_star"]))) < 1e-9
    panel_record[prep] = [{"label": l, "log10_lo": b[1], "log10_hi": b[2]} for l, b in zip(plotted, bars)]
res["tornado_figure_as_plotted"] = panel_record
fig.tight_layout(); fig.savefig(OUT / "fig_tornado.png", dpi=130); plt.close(fig)
fig, ax = plt.subplots(figsize=(7, 5)); Z = np.log10(np.array(res["heatmap_realistic_k3"]["v2_assumed"]["N_star"], dtype=float))
im = ax.imshow(Z, origin="lower", aspect="auto"); ax.set_xticks(range(len(tTv))); ax.set_xticklabels([f"{t*1e6:g}" for t in tTv]); ax.set_yticks(range(len(Pv))); ax.set_yticklabels(Pv)
ax.set_xlabel("logical Toffoli time t_T [us]"); ax.set_ylabel("classical cores P"); plt.colorbar(im, label="log10 N*"); ax.set_title("realistic, prep=v2_assumed, IEEE-118 k=3\n" + tag, fontsize=7)
fig.tight_layout(); fig.savefig(OUT / "fig_heatmap_Nstar.png", dpi=130); plt.close(fig)

json.dump(res, open(OUT / "resource_model.json", "w"), indent=1, default=lambda x: "inf" if x == math.inf else str(x))

# ---- console summary --------------------------------------------------------------------------------------------------
print("V2 §16.3 reproduction (v2_assumed prep; relative difference model vs V2 printed):")
for sc in SCENARIOS: print(f"  {sc:11s} " + "  ".join(f"{kk}: {v['model']:.3g} vs {v['v2_printed']:.3g} ({100*v['rel_diff']:+.1f}%)" for kk, v in rep[sc].items()))
print("\nIEEE-118 k=3, V2 placeholders:  prep      G/iter    T_q          T_c(P=1)   ratio Tq/Tc   N*(P=1)    k* (P=1 / P=1000)")
for sc in SCENARIOS:
    for prep in PREPS:
        r = tab[f"{sc}|{prep}"]; f = r["k3_full"]; print(f"  {sc:11s}{prep:13s}{f['toffoli_per_grover_iteration']['G']:10.2e}{f['separate_costs']['quantum_oracle_time_s']:12.3e}s{f['separate_costs']['classical_time_s']:9.1f}s{f['totals']['ratio_Tq_over_Tc']:12.2e}{f['crossover']['N_star']:12.2e}   {r['k_star_self_consistent']} / {r['k_star_self_consistent_P1000']}")
print("\nprep costs (Toffoli-eq, c_rot=20) -- NOT equivalent constructions:")
for kk, v in res["prep_cost_comparison_NOT_EQUIVALENT"].items(): print(f"  {kk:10s} v2_assumed={v['v2_assumed_toffoli_eq']:.2e}  tree_counted={v['tree_counted']['toffoli_equivalents']:.2e} ({v['tree_counted']['n_rotations']:.2e} rotations)")
print("\nalpha sensitivity (realistic):", {a: f"{v:.1e}" for a, v in res["alpha_sensitivity_realistic_k3_v2_assumed_prep"].items()})
print("\ntornado top-5 by log10 swing of N* (realistic, k=3):")
for prep in PREPS: print("  ", prep, [(r["param"], round(r["log10_swing"], 1)) for r in res["tornado_realistic_k3"][prep]["rows"][:5]])
f = tab["realistic|v2_assumed"]["k3_full"]; print("\nrealistic/v2_assumed qubits: logical", f["logical_qubits"]["total"], " physical (V2 conv / conservative):", f"{f['physical_qubits_estimate']['v2_volume_convention']['physical_total']:.1e} (d={f['physical_qubits_estimate']['v2_volume_convention']['code_distance']}) / {f['physical_qubits_estimate']['conservative_volume_x_logical']['physical_total']:.1e} (d={f['physical_qubits_estimate']['conservative_volume_x_logical']['code_distance']})")
print("\nIEEE-14 scale, measured inputs, k=3 realistic v2_assumed: Tq=%.3gs  Tc=%.3gs  ratio=%.2g" % (m14['k3|realistic|v2_assumed']['totals']['quantum_total_time_s'], m14['k3|realistic|v2_assumed']['separate_costs']['classical_time_s'], m14['k3|realistic|v2_assumed']['totals']['ratio_Tq_over_Tc']))
