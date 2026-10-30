"""Tier B Durr-Hoyer EMULATION on the IEEE-14 DC truth tables (E6-style, 200 seeds, y0 = 0). Label: [EMULATED] diagnostic -- NOT E6/E7:
only three sizes on one UNVERIFIED grid; ideal amplitude amplification emulated classically; no hardware, no oracle realizability, no speedup claim.
quantum_oracle_calls = sum(j+1) per attempt (conservative); classical verifications and the N-evaluation table construction are reported SEPARATELY."""
import glob, json, math, pathlib, platform
import numpy as np, scipy
from doomsday import __version__
from doomsday.oracle.hashing import code_version
from doomsday.oracle.table_oracle import TableOracle
from doomsday.qsearch.dh_gas import DH_BOUND, durr_hoyer
from doomsday.qsearch.predicate import PredicateTable

SEEDS = 200; rng = np.random.default_rng(12345)
def stats(a): a = np.asarray(a, float); return {"mean": float(a.mean()), "median": float(np.median(a)), "p95": float(np.percentile(a, 95)), "n": int(len(a))} if len(a) else None
def boot_ci(a, B=2000):
    a = np.asarray(a, float); m = [rng.choice(a, len(a)).mean() for _ in range(B)]; return [float(np.percentile(m, 2.5)), float(np.percentile(m, 97.5))]
out = {"label": "[EMULATED] Tier B diagnostic (not E6/E7); IEEE-14 transcribed_from_memory_UNVERIFIED; DC truth-table predicate", "seeds": SEEDS, "y0": 0.0, "patience": 3, "lambda": 1.2,
       "code_version": code_version(), "software": {"doomsday": __version__, "python": platform.python_version(), "numpy": np.__version__, "scipy": scipy.__version__}, "rows": []}
classical = json.load(open("results/phase4/summary_ieee14_dc.json"))["aggregate"]
for k in (2, 3, 4):
    tab = TableOracle.load(sorted(glob.glob(f"results/tables/ieee14_dc_k[1-{k}]_*")), k); pt = PredicateTable.from_oracle(tab); N = pt.N
    runs = [durr_hoyer(tab, seed=s, grid="ieee14", pt=pt) for s in range(SEEDS)]
    ok = [r for r in runs if r.found_target]; sq = math.sqrt(N)
    dq = [r.aux["discovery_quantum_calls"] for r in ok]; tq = [r.aux["accounting"]["quantum_oracle_calls"] for r in runs]
    ver = [r.aux["accounting"]["classical_verifications"] for r in runs]; dv = [r.discovery_calls for r in ok]
    best_cl = min((a["discovery_calls"]["mean"], key) for key, a in classical[str(k)].items() if a["discovery_calls"] and not key.startswith(("brute", "milp")))
    out["rows"].append({"k": k, "N": N, "Smax": pt.Smax, "M_at_Smax": int((pt.S >= pt.Smax - 1e-9).sum()), "sqrtN": sq, "success_rate": len(ok) / SEEDS,
        "discovery_quantum_calls": stats(dq), "discovery_quantum_calls_mean_CI95": boot_ci(dq) if dq else None, "c_hat_discovery_over_sqrtN": float(np.mean(dq) / sq),
        "total_quantum_calls_until_stop": stats(tq), "total_over_sqrtN_mean": float(np.mean(tq) / sq), "dh_proven_bound_22.5sqrtN+1.4lg2N": DH_BOUND(N),
        "classical_verifications_total": stats(ver), "classical_verifications_to_discovery": stats(dv), "table_construction_evals": N,
        "reference_only_NOT_A_COMPARISON": {"best_classical_mean_discovery_unique_evals_phase4": {"value": best_cl[0], "method": best_cl[1]},
            "units_differ": "quantum_oracle_calls (j+1 per attempt, ideal emulated) vs classical unique evaluations; the quantum side excludes the N-evaluation table construction and any oracle-circuit cost"}})
pts = [(r["N"], r["discovery_quantum_calls"]["mean"]) for r in out["rows"] if r["discovery_quantum_calls"]]
x = np.log([p[0] for p in pts]); y = np.log([p[1] for p in pts]); A = np.vstack([x, np.ones_like(x)]).T
out["log_log_slope_discovery_vs_N"] = {"slope": float(np.linalg.lstsq(A, y, rcond=None)[0][0]), "n_points": len(pts), "caveat": "3 points, one grid, ties present: indicative only; V2 hypothesis slope ~0.5"}
pathlib.Path("results/phase5").mkdir(parents=True, exist_ok=True); json.dump(out, open("results/phase5/tierB_dh_ieee14.json", "w"), indent=1)
print(f"{'k':>2}{'N':>6}{'M':>3}{'sqrtN':>7}{'succ%':>7}{'disc q-calls mean [CI95]':>30}{'c_hat':>7}{'total calls mean/p95':>22}{'total/sqrtN':>12}{'DH bound':>9}{'verifs(disc)':>13}")
for r in out["rows"]:
    d = r["discovery_quantum_calls"]; t = r["total_quantum_calls_until_stop"]
    print(f"{r['k']:>2}{r['N']:>6}{r['M_at_Smax']:>3}{r['sqrtN']:>7.1f}{100*r['success_rate']:>7.1f}{d['mean']:>14.1f} [{r['discovery_quantum_calls_mean_CI95'][0]:.1f},{r['discovery_quantum_calls_mean_CI95'][1]:.1f}]{r['c_hat_discovery_over_sqrtN']:>9.2f}"
          f"{t['mean']:>12.0f}/{t['p95']:<9.0f}{r['total_over_sqrtN_mean']:>8.2f}{r['dh_proven_bound_22.5sqrtN+1.4lg2N']:>9.0f}{r['classical_verifications_to_discovery']['mean']:>13.1f}")
print("log-log slope (indicative):", round(out["log_log_slope_discovery_vs_N"]["slope"], 2))
