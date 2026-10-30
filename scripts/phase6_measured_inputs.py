"""Collect the MEASURED inputs the resource model may use, from existing results/tables (IEEE-14 only). The resource package itself reads only the
JSON this writes. Every value is labelled with its provenance; IEEE-14 is tiny and its data are UNVERIFIED, so none of this transfers to IEEE-118."""
import glob, json, math, pathlib
import numpy as np
from doomsday.oracle.table_oracle import TableOracle
out = {"label": "measured inputs for the resource model: IEEE-14 (transcribed_from_memory_UNVERIFIED); NOT transferable to IEEE-118", "per_k": {}}
t5 = json.load(open("results/phase5/tierB_dh_ieee14.json")); p2 = json.load(open("results/phase2_cascade_diagnostics.json"))
for row in t5["rows"]:
    k, N, M = row["k"], row["N"], row["M_at_Smax"]; tab = TableOracle.load(sorted(glob.glob(f"results/tables/ieee14_dc_k[1-{k}]_*")), k)
    rounds = np.array(tab._tables[k].arrays["rounds"]); trips = np.array(tab._tables[k].arrays["n_trips"]); keff = k + trips
    q = lambda a: {"p50": float(np.percentile(a, 50)), "p95": float(np.percentile(a, 95)), "max": float(a.max()), "mean": float(a.mean())}
    d, tt = row["discovery_quantum_calls"]["mean"], row["total_quantum_calls_until_stop"]["mean"]; sq, sqm = math.sqrt(N), math.sqrt(N / M)
    out["per_k"][str(k)] = {"N": N, "M_at_Smax": M,
        "R_rounds_solved": q(rounds), "k_eff_final_outage_set_size": q(keff), "source_R_keff": "measured from the DC truth table (full records), IEEE-14, all N sets (E2-like diagnostic; not E2)",
        "c_q_discovery_over_sqrt_N_over_M": d / sqm, "c_q_to_certified_stop_over_sqrt_N_over_M": tt / sqm,
        "c_tail_over_sqrt_N": (tt - d) / sq, "verifications_per_quantum_call_at_discovery": row["classical_verifications_to_discovery"]["mean"] / d,
        "source_cq": "Tier B EMULATION, 200 seeds, ideal amplitude amplification (results/phase5/tierB_dh_ieee14.json); y0=0, patience=3, lambda=1.2",
        "t_classical_informal_ms": {r["mode"]: r["ms_per_set_informal"] for r in p2["runs"] if r["m"] == 0.05 and r["k"] == min(k, 3)},
        "source_tc": "INFORMAL diagnostic, unoptimised pure-Python engine on a 14-bus grid (NOT E1, not representative of 118 buses)"}
pathlib.Path("results/phase6").mkdir(parents=True, exist_ok=True); json.dump(out, open("results/phase6/measured_inputs_ieee14.json", "w"), indent=1)
for k, v in out["per_k"].items():
    print(f"k={k}: R p50/p95/max={v['R_rounds_solved']['p50']:.0f}/{v['R_rounds_solved']['p95']:.0f}/{v['R_rounds_solved']['max']:.0f}  keff p50/p95/max={v['k_eff_final_outage_set_size']['p50']:.0f}/{v['k_eff_final_outage_set_size']['p95']:.0f}/{v['k_eff_final_outage_set_size']['max']:.0f}  "
          f"cq_disc={v['c_q_discovery_over_sqrt_N_over_M']:.2f}  cq_stop={v['c_q_to_certified_stop_over_sqrt_N_over_M']:.2f}  c_tail={v['c_tail_over_sqrt_N']:.2f}  verif/qcall={v['verifications_per_quantum_call_at_discovery']:.2f}  tc_informal(ms)={ {m: round(x,2) for m,x in v['t_classical_informal_ms'].items()} }")
