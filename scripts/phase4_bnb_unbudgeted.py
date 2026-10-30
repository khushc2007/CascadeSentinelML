"""Heuristic branch-and-bound WITHOUT a budget (shows the effect of theta, which a 0.5N budget cap masks). [MEASURED] diagnostic."""
import glob, json, pathlib
from doomsday.oracle.table_oracle import TableOracle
from doomsday.classical import classical_search
out = {"label": "[PROPOSED/stretch] heuristic branch-and-bound, unbudgeted, IEEE-14 DC tables; bound is NOT rigorous (see methods_structural.branch_and_bound)", "rows": []}
for k in (2, 3, 4):
    o = TableOracle.load(sorted(glob.glob(f"results/tables/ieee14_dc_k[1-{k}]_*")), k); smax = o.all_severities().max()
    for th in (0.0, 0.5, 0.8, 0.95):
        r = classical_search(o, "bnb", theta=th, target=smax, grid="ieee14"); a = r.aux
        out["rows"].append({"k": k, "N": o.space.N, "theta": th, "leaves_evaluated": a["leaves_evaluated"], "nodes_expanded": a["nodes_expanded"],
                            "nodes_pruned": a["nodes_pruned"], "oracle_calls": r.oracle_calls, "found_Smax": r.found_target, "discovery_calls": r.discovery_calls,
                            "best_severity": r.best_severity, "Smax": float(smax), "exact": r.exact})
pathlib.Path("results/phase4").mkdir(parents=True, exist_ok=True)
json.dump(out, open("results/phase4/bnb_unbudgeted_ieee14.json", "w"), indent=1)
for r in out["rows"]: print(f"k={r['k']} theta={r['theta']:<4} leaves={r['leaves_evaluated']:>5}/{r['N']:<5} expanded={r['nodes_expanded']:>5} pruned={r['nodes_pruned']:>4} found={r['found_Smax']} disc={r['discovery_calls']}")
