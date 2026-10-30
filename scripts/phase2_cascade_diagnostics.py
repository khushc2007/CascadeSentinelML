"""Phase 2 diagnostic (IEEE-14 only): exhaustive N-2 / N-3 cascades, DC and AC, sweep of the N-1 covering margin m.
Evidence label: [MEASURED] diagnostic. NOT E2 (phenomenology), E3 (DC-AC fidelity) or E11 (robustness): those need
the Phase 3+ oracle/tables, IEEE-30/118, and the pre-registered protocols. Ties in S are broken by lexicographic outage set."""
import itertools, json, pathlib, platform, sys, time
import numpy as np, scipy
from doomsday import __version__
from doomsday.config import config_hash, load_config
from doomsday.gridtwin.base import build_base_point
from doomsday.gridtwin.cascade import CascadeEngine
from doomsday.gridtwin.severity import is_cascade_driven

def jaccard(a, b): return len(set(a) & set(b)) / len(set(a) | set(b))

out = {"label": "[MEASURED] Phase 2 diagnostic (not E2/E3/E11)", "case": "ieee14 (transcribed MATPOWER case14)",
       "software": {"doomsday": __version__, "python": platform.python_version(), "numpy": np.__version__, "scipy": scipy.__version__},
       "tie_break": "S descending, then lexicographic outage set", "runs": []}
tops = {}
for m in (0.05, 0.10, 0.20):
    cfg = load_config(overrides={"rating": {"n1_margin_m": m}})
    bp = build_base_point("ieee14", cfg); e = CascadeEngine(bp, cfg); L = bp.grid.n_branch
    tau, delta = cfg.severity.tau, cfg.severity.delta_cascade
    for k in (2, 3):
        sets = list(itertools.combinations(range(L), k))
        for mode in ("dc", "ac"):
            t0 = time.perf_counter(); res = [e.run(list(K), mode=mode, fast=(mode == "dc")) for K in sets]
            dt = time.perf_counter() - t0
            S = np.array([r.S for r in res]); S0 = np.array([r.S0 for r in res]); C = np.array([r.C for r in res])
            rounds = np.array([r.rounds for r in res])
            order = sorted(range(len(sets)), key=lambda i: (-S[i], sets[i]))
            top10 = [sets[i] for i in order[:10]]; tops[(m, k, mode)] = top10
            row = {"m": m, "k": k, "mode": mode, "N": len(sets), "seconds_total": dt, "ms_per_set_informal": 1e3 * dt / len(sets),
                   "frac_S_gt_0": float(np.mean(S > 1e-12)), "n_high_severity_S>=tau": int(np.sum(S >= tau)),
                   "n_cascade_driven(S>=tau&C>=delta)": int(sum(is_cascade_driven(r.S, r.C, tau, delta) for r in res)),
                   "n_with_trips(rounds>1)": int(np.sum(rounds > 1)), "n_C_gt_0": int(np.sum(C > 1e-9)),
                   "rounds_mean": float(rounds.mean()), "rounds_max": int(rounds.max()),
                   "n_total_loss": int(sum(r.status == "TOTAL_LOSS" for r in res)),
                   "n_exhausted": int(sum(r.status == "EXHAUSTED" for r in res)),
                   "n_ladder_flagged": int(sum(r.flags["nonconv_flag"] for r in res)),
                   "S_max": float(S.max()), "top10_sets_branch_labels": [[bp.grid.branch_label(l) for l in K] for K in top10],
                   "top10_S": [float(S[i]) for i in order[:10]]}
            out["runs"].append(row)
out["top10_jaccard_between_m"] = {f"k{k}_{mode}_m{a}_vs_m{b}": jaccard(tops[(a, k, mode)], tops[(b, k, mode)])
                                  for k in (2, 3) for mode in ("dc", "ac") for a, b in ((0.05, 0.10), (0.05, 0.20))}
out["top10_jaccard_dc_vs_ac_same_m"] = {f"k{k}_m{m}": jaccard(tops[(m, k, "dc")], tops[(m, k, "ac")]) for k in (2, 3) for m in (0.05, 0.10, 0.20)}
pathlib.Path("results").mkdir(exist_ok=True)
json.dump(out, open("results/phase2_cascade_diagnostics.json", "w"), indent=1)
hdr = f"{'m':>5} {'k':>2} {'mode':>4} {'N':>5} {'S>0':>6} {'S>=tau':>7} {'casc-drv':>8} {'trips':>6} {'rnd mean/max':>12} {'totalloss':>9} {'exh':>3} {'ladder':>6} {'Smax':>6} {'ms/set':>7}"
print(hdr)
for r in out["runs"]:
    print(f"{r['m']:>5} {r['k']:>2} {r['mode']:>4} {r['N']:>5} {r['frac_S_gt_0']:6.3f} {r['n_high_severity_S>=tau']:7d} {r['n_cascade_driven(S>=tau&C>=delta)']:8d} "
          f"{r['n_with_trips(rounds>1)']:6d} {r['rounds_mean']:6.2f}/{r['rounds_max']:<5d} {r['n_total_loss']:9d} {r['n_exhausted']:3d} {r['n_ladder_flagged']:6d} {r['S_max']:6.3f} {r['ms_per_set_informal']:7.2f}")
print("\ntop-10 Jaccard across m:", json.dumps({k: round(v, 2) for k, v in out["top10_jaccard_between_m"].items()}))
print("top-10 Jaccard DC vs AC:", json.dumps({k: round(v, 2) for k, v in out["top10_jaccard_dc_vs_ac_same_m"].items()}))
