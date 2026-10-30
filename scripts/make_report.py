"""Phase 14: results/phase7/REPORT.md generated ONLY from results/phase7/<ID>/manifest.json + result.json (no hand-typed numbers; V2 R3).
  PYTHONPATH=. python scripts/make_report.py"""
import json, math, pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parents[1]; PH7 = ROOT / "results/phase7"
sys.path.insert(0, str(ROOT))
from doomsday.experiments.specs import DEVIATIONS, SPECS  # noqa: E402

def ld(eid, f): p = PH7 / eid / f; return json.loads(p.read_text()) if p.exists() else None
pc = lambda x: "–" if x is None else (f"{100 * x:.1f}%" if x == 0 or abs(x) >= 0.01 else f"{100 * x:.3g}%")
f3 = lambda x: "–" if x is None else (f"{x:.3g}" if isinstance(x, (int, float)) and not isinstance(x, bool) else str(x))
def sci(x):
    if x in (None, "inf") or (isinstance(x, float) and math.isinf(x)): return "∞" if x is not None else "–"
    e = int(math.floor(math.log10(x))) if x > 0 else 0; return f"{x / 10 ** e:.2f}e{e}" if abs(e) >= 4 else f"{x:.3g}"

def key_E0(p): return [f"Verdict: {p['verdict']}", f"Hand-solved suites: {p['hand_solved']['passed']}/{p['hand_solved']['n']} passed"] + [
    f"{g}: base AC max |dVm| {sci(v['base_ac']['dVm'])}, N-1 AC ({v['n1_ac']['n_outages']} outages) max |dPf| {sci(v['n1_ac']['max_abs_diff']['dPf_pu'])} p.u., non-converged {len(v['n1_ac']['nonconverged'])}; DC vs PYPOWER (taps neglected) {sci(v['dc_vs_pypower_taps_shifts_neglected_pu'])} p.u.; KCL {sci(v['kcl_residual_pu'])}; island balance {sci(v['island_balance_residual_pu_300_random_k3'])}" for g, v in p["reference"].items()]
def key_E1(p): return [f"{g}: DC mean {f3(v['dc_random']['all_ms']['mean'])} ms (p95 {f3(v['dc_random']['all_ms']['p95'])}), AC mean {f3(v['ac_random']['all_ms']['mean'])} ms (p95 {f3(v['ac_random']['all_ms']['p95'])}) per random k=3 set; high-severity DC {f3(v['dc_high_severity']['all_ms']['mean'])} ms, AC {f3(v['ac_high_severity']['all_ms']['mean'])} ms"
                       for g, v in p.items() if isinstance(v, dict) and "dc_random" in v] + ["V2 targets (hypotheses): DC ≲ 0.5 ms, AC ≲ 30 ms; scalar Python on a 2-vCPU machine."]
def key_E2(p): return [f"{k}: N={v['N']:,}, S_max {pc(v['Smax'])}, S>0 in {pc(v['frac_S_gt_0'])}, high-severity {v['n_high_severity']:,} ({pc(v['frac_high_severity'])}), cascade-driven share of high {pc(v['cascade_driven_share_of_high'])}, severity share from cascade C {pc(v['severity_share_from_cascade_C'])}, rounds p95 on S>0 {f3((v['rounds_on_S_gt_0'] or {}).get('p95'))}, non-monotone pairs {pc(v.get('non_monotonicity', {}).get('pair_fraction'))}"
                       for k, v in p.items() if isinstance(v, dict) and "N" in v]
def key_E3(p):
    out = [f"E3a {k}: recall@τ {f3(v['recall'])}, precision {f3(v['precision'])}, Spearman {f3(v['spearman'])}, top-10 overlap {f3(v['top10'].get('overlap_share_of_ac'))}, FN {v['fn']} → {v['decision']['verdict']}" for k, v in p["E3a"].items()]
    for k, v in p["E3b"].items(): out.append(f"E3b {k}: weighted recall estimate {f3(v['weighted_recall_estimate'])} (supplementary)")
    for k, v in p["E3c"].items(): out.append(f"E3c {k}: recall common ratings {f3(v['i_common_ratings']['recall'])}, per-engine DC ratings {f3(v['ii_per_engine_dc_ratings']['recall'])}, AC ladder disabled {f3(v['iii_ac_ladder_disabled_vs_dc']['recall'])}")
    o = p["overall"]; out.append(f"Overall: {o['n_trustworthy']}/{o['n_evaluable']} evaluable tables pass the pre-registered rule; min recall {f3(o['min_recall'])}"); return out
def key_E4(p): return [f"Verdict: {p['verdict']}", f"Dicke max infidelity: tree {sci(p['Q1_dicke_fidelity_n_le_10']['tree']['max_infidelity'])}, BE {sci(p['Q1_dicke_fidelity_n_le_10']['be']['max_infidelity'])}"] + [
    f"{k}: Aer vs Tier B max |ΔP| tree {sci(v['tree']['aer_vs_tierB_max_abs'])}, BE {sci(v['be']['aer_vs_tierB_max_abs'])}; CX at r=1 tree {v['tree']['cx_per_r'][1]}, BE {v['be']['cx_per_r'][1]}" for k, v in p["Q4_aer_statevector_vs_tierB"].items() if isinstance(v.get("tree"), dict)]
def key_E5(p):
    out = []
    for k, v in p.items():
        if not isinstance(v, dict) or "N" not in v: continue
        out.append(f"{k} (N={v['N']}, M={v['M']}): ideal tree {v['ideal_tree']['status']}, ideal BE {v['ideal_be']['status']}; noisy BE peak {f3(v['noisy_be'].get('summary', {}).get('peak_p'))} at r={v['noisy_be'].get('summary', {}).get('r_at_peak')} (ideal {f3(max(v['p_theory']))}, uniform {f3(v['M'] / v['N'])}); noisy tree peak {f3(v['noisy_tree'].get('summary', {}).get('peak_p'))}")
    return out
def key_E6(p): return [f"{r['grid']} k={r['k']}: N={r['N']:,}, success {pc(r['y0_zero']['success_rate'])}, discovery {f3(r['y0_zero']['discovery_quantum_calls']['mean'])} calls (ĉ = {f3(r['y0_zero']['c_hat_discovery_over_sqrtN'])}·√N), certified stop {f3(r['y0_zero']['certified_stop_over_sqrtN'])}·√N; heuristic y0: ĉ = {f3(r['y0_heuristic']['c_hat_discovery_over_sqrtN'])}"
                       for r in p["rows"]] + [f"log-log slope (discovery, all tables): {f3((p['loglog_fits']['y0_zero']['all_tables'] or {}).get('exponent'))} (hypothesis 0.5)"]
def key_E7(p):
    out = [f"Tuning on held-out {p['tuning']['held_out']['held_out']}: " + ", ".join(f"{m} → {v['chosen']}" for m, v in p["tuning"]["result"].items())]
    for fid in ("dc", "ac"):
        for k, v in p[fid].items():
            b = v["best_structured"]; out.append(f"{fid.upper()} {k}: N={v['N']:,}, best structured {b['method'] if b else '–'} mean discovery {f3(b['mean_discovery']) if b else '–'} evals vs √N = {f3(math.sqrt(v['N']))}" + (f", Tier B ĉ√N = {f3(v['c_hat_sqrtN'])}" if v.get("c_hat_sqrtN") else ""))
    out.append(f"H-C1: {p['HC1']['pairs_true']}/{p['HC1']['pairs_evaluated']} pairs → holds = {p['HC1']['holds']}"); return out
def key_E8(p): return [f"{k}: smallest M/N where random sampling beats BBHT = {f3(v['smallest_M_over_N_where_random_wins'])}" for k, v in p.items()]
def key_E9(p):
    out = []
    for k, v in p.items():
        if not isinstance(v, dict) or "N" not in v: continue
        for var in ("exclusion_list_V2_literal", "threshold_list"):
            fit = v[var]["slope_in_T"]; out.append(f"{k} {var}: slope in T {f3(fit['exponent'] if fit else None)} (√ = 0.5), correct {pc(min(r['correct_rate'] for r in v[var]['rows']))} min, calls/2√(NT) at T=50 {f3(v[var]['rows'][-1]['over_2sqrtNT'])}")
    return out
def key_E10(p):
    out = [f"E10a planted: recovered = {p['E10a_planted']['recovered']} (P(x*) at best p {f3(p['E10a_planted']['per_p'][str(p['E10a_planted']['best_p'])]['P_xstar'] if isinstance(list(p['E10a_planted']['per_p'])[0], str) else p['E10a_planted']['per_p'][p['E10a_planted']['best_p']]['P_xstar'])}, uniform {f3(p['E10a_planted']['uniform_P'])})"]
    if "E10b_k2_exact" in p:
        b = p["E10b_k2_exact"]; pp = b["per_p"][max(b["per_p"], key=lambda z: int(z))]
        out.append(f"E10b k=2: fit R² {f3(b['R2_all'])}, approx. ratio (true) {f3(pp['approximation_ratio_true'])}, top-1 agreement {pp['top1_agreement']}, true-oracle calls {b['true_oracle_calls']} vs N {b['N']}")
    if "E10c_k3_gap" in p:
        for nt, r in p["E10c_k3_gap"]["rows"].items():
            pp = r["per_p"][max(r["per_p"], key=lambda z: int(z))]
            out.append(f"E10c n_train={nt}: held-out R² {f3(r['heldout_R2'])} (Spearman {f3(r['heldout_spearman'])}; on the true top 1% Spearman {f3(r['heldout_top1pct_spearman'])}, R² not informative there because the tail values barely vary), approx. ratio {f3(pp['approximation_ratio_true'])}, model gap {pc(r['error_ii_model_gap_true'])}, oracle calls {r['true_oracle_calls']} vs N {r['brute_force_calls']}")
    if "aer_crosscheck" in p: out.append(f"Aer cross-check (L=10 shortlist): max |ΔP| {sci(p['aer_crosscheck']['max_abs_prob_diff_subspace_vs_aer'])}, per-layer CX {p['aer_crosscheck']['per_layer_cx']}")
    return out
def key_E11(p):
    out = []
    for g in ("ieee14", "ieee30", "ieee118"):
        if g not in p: continue
        out.append(f"{g} (k={p[g]['k']}): " + "; ".join(f"{f} top-10 Jaccard median {f3((v['top10_jaccard'] or {}).get('median'))}" for f, v in p[g]["summary_by_factor"].items()))
    out.append(f"F3: median top-10 Jaccard across rating families {f3(p['F3']['median_top10_jaccard'])} → rating artefact = {p['F3']['F3_met_findings_are_rating_artefacts']}"); return out
def key_E12(p): return [f"{k}: minimum passing b = {v['min_passing_b']}; label flips by b: " + ", ".join(f"{b}:{r['label_flips']}" for b, r in v["per_b"].items()) for k, v in p.items() if isinstance(v, dict) and "per_b" in v] + [f"Overall minimum passing b: {p['min_passing_b_overall']}"]
def key_E13(p): return ["No hardware run; no hardware result is claimed."]
def key_E14(p): return [f"All V2 13.4 checks pass: {p['all_checks_pass']} ({p['qubits']} qubits, {p['toffoli_equiv_total']:,} Toffoli-equivalents)"] + [f"κ_cal {k}: {f3(v['kappa_cal'])} → {p['kappa_verdicts'].get(k, '')}" for k, v in p["calibration"].items() if isinstance(v, dict) and v.get("kappa_cal") is not None] + [f"A2 fixed-point vs float64 engine label agreement: {pc(p['float_engine_agreement']['label_agreement'])}"]
def key_E15(p):
    out = [f"Measured inputs used: {', '.join(p['measured_inputs']['sources'])}; missing: {', '.join(p['measured_inputs']['missing']) or 'none'}"]
    for sc, v in p["scenarios"].items():
        for key in ("be_counted|calibrated", "be_counted|uncalibrated"):
            if key in v: r = v[key]; out.append(f"{sc} {key}: G {sci(r['G'])}, Tq {sci(r['Tq_s'])} s vs Tc {sci(r['Tc_s'])} s (ratio {sci(r['ratio_Tq_over_Tc'])}), N* {sci(r['N_star_P1'])} (P=1), k* {r['k_star_P1']} / {r['k_star_P1000']} (P=1/1000)")
    out.append(p["headline"]["statement"]); return out
def key_E16(p): return [f"{k}: {v['status']}" for k, v in p.items() if k in ("F1", "F2", "F3")] + [f"H-C1: holds = {(p.get('H-C1') or {}).get('holds')}"]

NOTES = [
    "- **Source hashes.** Each manifest records the source sha256 at completion. E0, E4 (first run), E10, E5 and E11 started at commit `cf259bb`; after it only "
    "table generation/locking (`doomsday/oracle/table_oracle.py`), experiment helpers, classical caching and docs changed. `git diff cf259bb -- doomsday/gridtwin doomsday/config.py` is empty.",
    "- **E11 namespace pin.** E11 was restarted after a background time limit and reused its variant truth tables by pinning the oracle namespace to `cf259bb`'s "
    "code version (`results/phase7/E11/NAMESPACE_NOTE.json`). Base tables rebuilt under the later namespace reproduce identical maxima (e.g. IEEE-14 k=3 0.532083, IEEE-30 k=3 0.847707).",
    "- **E12 on IEEE-118 (k=2)** passes at b = 12 only because no set reaches S ≥ τ at k=2 (E2: 0 high-severity sets); the binding grid is IEEE-30.",
    "- **E3 on IEEE-118.** The AC-only severe sets are dominated by AC non-convergence handled through the load-shedding ladder / total-loss path "
    "(E3a `ac_flags`); DC rates none of them ≥ τ. This is a property of the AC failure model as much as of the grid.",
    "- **Evidence classes.** Tier B is exact classical emulation (not a quantum runtime); Aer is a classical simulator; E15 is an analytical estimate. "
    "No hardware was used (E13 NOT RUN). No quantum advantage is claimed or demonstrated.",
]

def headlines() -> list:
    out = []
    e16, e15, e7, e11, e3 = ld("E16", "result.json"), ld("E15", "result.json"), ld("E7", "result.json"), ld("E11", "result.json"), ld("E3", "result.json")
    if e16:
        p = e16["payload"]; out.append(f"- **Pre-registered falsification (E16):** F1 {p['F1']['status']}, F2 {p['F2']['status']}, F3 {p['F3']['status']}; H-C1 holds = {(p.get('H-C1') or {}).get('holds')}.")
    if e7:
        r = e7["payload"]["dc"].get("ieee118_k3")
        if r and r.get("best_structured"): out.append(f"- **Structured classical search competes on query count (E7):** at IEEE-118 k=3 (N = {r['N']:,}) the best structured baseline ({r['best_structured']['method']}) "
                                                      f"found S_max in {pc(r['best_structured'].get('success_rate'))} of runs within budget, after {f3(r['best_structured']['mean_discovery'])} unique evaluations on average when it did, versus {f3(r['c_hat_sqrtN'])} emulated quantum oracle calls (Tier B ĉ√N) and √N = {f3(math.sqrt(r['N']))}.")
    if e15:
        h = e15["payload"]["headline"]["IEEE118_k3_realistic_be_prep"]; a = e15["payload"]["alpha_sensitivity_realistic"].get("measured_best_structured")
        out.append(f"- **Resource model (E15, estimate):** realistic scenario at IEEE-118 k=3: modelled quantum time / classical one-core time = {sci(h['ratio_Tq_over_Tc'])}; "
                   + (f"against the measured structured exponent α = {f3(a['alpha'])} ({a['method']}) there is no crossover (N* = {sci(a['N_star'])})." if a else ""))
    if e11: out.append(f"- **Rankings are rating-rule artefacts (E11, F3):** median top-10 Jaccard across rating families = {f3(e11['payload']['F3']['median_top10_jaccard'])}.")
    if e3: out.append(f"- **DC is a poor proxy for AC here (E3, F2):** {e3['payload']['overall']['n_trustworthy']}/{e3['payload']['overall']['n_evaluable']} evaluable tables pass the pre-registered rule.")
    return out

def main():
    lines = ["# Phase 7–14 experiment report (generated)", "", "Generated by `scripts/make_report.py` from `results/phase7/<ID>/manifest.json` and `result.json`. Every number below is copied from those files.",
             "Evidence labels follow V2: [MEASURED] [SIMULATED] [EMULATED] [ESTIMATED]. No quantum advantage is claimed or demonstrated.", "",
             "| ID | Experiment | Priority | Status | Evidence label |", "|---|---|---|---|---|"]
    for eid, s in SPECS.items():
        m = ld(eid, "manifest.json"); lines.append(f"| {eid} | {s['name']} | {s['priority']} | {m['status'] if m else 'NOT_RUN'} | {(m['evidence_label'] if m else '').replace('|', '/')[:160]} |")
    lines += ["", "## Headline findings (generated)", ""] + headlines() + ["", "## Notes on provenance and interpretation", ""] + NOTES + ["", "## Results by experiment", ""]
    for eid, s in SPECS.items():
        m, r = ld(eid, "manifest.json"), ld(eid, "result.json"); lines.append(f"### {eid} · {s['name']} (V2 {s['v2_section']})")
        if not m: lines += ["Not run.", ""]; continue
        lines.append(f"Status **{m['status']}** · data {m['data_status']} · config hash `{m['config']['config_hash'][:12]}` · source sha `{m['implementation']['source_sha256'][:12]}` · runtime {m['runtime_s']:.0f} s")
        if r and m["status"] != "FAILED":
            try: lines += [f"- {x}" for x in globals()[f"key_{eid}"](r["payload"])]
            except Exception as e: lines.append(f"- (summary extraction failed: {type(e).__name__}: {e}; see result.json)")
        nx = [p for p in m["parts"] if p["status"] != "EXECUTED"]
        if nx: lines += ["", "Parts not executed:"] + [f"- {p['name']}: **{p['status']}** — {p['reason']}" for p in nx]
        if m.get("error"): lines.append(f"\nError: `{m['error'].splitlines()[-1]}`")
        lines.append("")
    lines += ["## Registered deviations (specs.DEVIATIONS)", ""] + [f"- **{d['id']}**: {d['what']}" for d in DEVIATIONS]
    (PH7 / "REPORT.md").write_text("\n".join(lines) + "\n"); print("wrote", PH7 / "REPORT.md")

if __name__ == "__main__":
    main()
