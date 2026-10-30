"""Phase 1 diagnostic: does the V2 rating rule (5.3) yield an N-1-secure IEEE-14 base case (5.2 step 6)?
Applies the rule EXACTLY as specified; changes nothing. Output: results/phase1_rating_feasibility.json
Evidence label: [MEASURED] diagnostic (not an E-numbered experiment)."""
import json, platform, sys, pathlib
import numpy as np, scipy
from doomsday import __version__
from doomsday.config import config_hash, load_config
from doomsday.gridtwin.base import build_base_point
from doomsday.gridtwin.loader import load_grid
from doomsday.gridtwin.security import n1_report

def summarize(rep, grid):
    return {k: rep[k] for k in ("base_overloads", "base_max_loading", "n_branches", "n_bridges",
                                "n1_violations", "violating_outages", "secure")}

def run_point(h, lam, base_cfg):
    cfg = load_config(overrides={"rating": {"family": "proportional", "headroom_h": h}, "stress_lambda": lam})
    bp = build_base_point("ieee14", cfg)
    out = {"h": h, "lambda": lam}
    for mode in ("dc", "ac"):
        rep = n1_report(bp, mode)
        out[mode] = summarize(rep, bp.grid)
        out[mode]["base_overloads"] = [bp.grid.branch_label(l) for l in rep["base_overloads"]]
    return out, bp

def min_secure_h(lam, mode):
    lo, hi = 0.0, 20.0
    def ok(h):
        cfg = load_config(overrides={"rating": {"family": "proportional", "headroom_h": h}, "stress_lambda": lam})
        return n1_report(build_base_point("ieee14", cfg), mode)["secure"]
    if not ok(hi): return None
    for _ in range(40):
        mid = 0.5 * (lo + hi)
        lo, hi = (lo, mid) if ok(mid) else (mid, hi)
    return hi

cfg0 = load_config(overrides={"rating": {"family": "proportional"}})
res = {"label": "[MEASURED] diagnostic", "config_hash_default": config_hash(cfg0),
       "software": {"doomsday": __version__, "python": platform.python_version(),
                    "numpy": np.__version__, "scipy": scipy.__version__},
       "case": "ieee14 (transcribed MATPOWER case14)"}
d, bp = run_point(0.25, 1.10, cfg0)
res["default_h0.25_lambda1.10"] = d
# per-outage detail at the default point (DC): worst post-outage loading and what overloads
rep = n1_report(bp, "dc")
res["default_dc_rows"] = [{k: (r[k] if k != "overloads" else [bp.grid.branch_label(j) for j in r[k]])
                           for k in r} for r in rep["rows"]]
rep_ac = n1_report(bp, "ac")
res["default_ac_rows"] = [{k: (r[k] if k != "overloads" else [bp.grid.branch_label(j) for j in r[k]])
                           for k in r} for r in rep_ac["rows"]]
# required post-outage flow / base flow ratio per branch (DC engine, ignoring floor)
from doomsday.gridtwin.dc import dc_power_flow
g = bp.grid; base = np.abs(bp.dc.flow_mw)
need = np.zeros(g.n_branch); who = [""] * g.n_branch
for r in rep["rows"]:
    if r["bridge"]: continue
    s = g.br_status.copy(); s[r["branch"]] = 0
    f = np.abs(dc_power_flow(g, bp.dc_injections_mw, s).flow_mw)
    for j in range(g.n_branch):
        if j != r["branch"] and base[j] > 1e-9 and f[j] / base[j] > need[j]:
            need[j] = f[j] / base[j]; who[j] = r["label"]
res["dc_required_headroom_per_branch"] = [
    {"branch": g.branch_label(j), "base_mw": float(base[j]), "max_post_over_base": float(need[j]),
     "h_needed": float(need[j] - 1), "worst_outage": who[j], "exceeds_h_0.40": bool(need[j] - 1 > 0.40)}
    for j in range(g.n_branch)]
sweep = []
for lam in (1.0, 1.1, 1.2, 1.3):
    for h in (0.15, 0.20, 0.25, 0.30, 0.35, 0.40):
        try:
            p, _ = run_point(h, lam, cfg0)
            sweep.append({"h": h, "lambda": lam, "dc_n1_violations": p["dc"]["n1_violations"],
                          "ac_n1_violations": p["ac"]["n1_violations"],
                          "dc_base_overloads": len(p["dc"]["base_overloads"]), "ac_base_overloads": len(p["ac"]["base_overloads"]),
                          "dc_secure": p["dc"]["secure"], "ac_secure": p["ac"]["secure"]})
        except Exception as e:
            sweep.append({"h": h, "lambda": lam, "error": repr(e)})
res["sweep_h_lambda"] = sweep
res["smallest_uniform_h_for_n1_secure"] = {f"lambda_{lam}": {m: min_secure_h(lam, m) for m in ("dc", "ac")} for lam in (1.0, 1.1)}
pathlib.Path("results").mkdir(exist_ok=True)
json.dump(res, open("results/phase1_rating_feasibility.json", "w"), indent=1)

print("DEFAULT (h=0.25, lambda=1.10):")
for m in ("dc", "ac"):
    x = d[m]; print(f"  {m.upper()}: base overloads={x['base_overloads']}, base max loading={x['base_max_loading']:.3f}, "
                    f"non-bridge outages={x['n_branches']-x['n_bridges']}, N-1 violating outages={x['n1_violations']}, secure={x['secure']}")
    print("     violating:", x["violating_outages"])
print("\nSWEEP: any (h,lambda) in V2 ranges N-1 secure?  DC:", any(s.get("dc_secure") for s in sweep),
      " AC:", any(s.get("ac_secure") for s in sweep))
print("  min N-1 violations over sweep: DC", min(s["dc_n1_violations"] for s in sweep if "error" not in s),
      " AC", min(s["ac_n1_violations"] for s in sweep if "error" not in s))
print("errors in sweep:", [s for s in sweep if "error" in s])
print("\nSmallest UNIFORM h making the base N-1 secure:", json.dumps(res["smallest_uniform_h_for_n1_secure"]))
print("\nDC required headroom (post-outage flow / base flow - 1), worst branches:")
for r in sorted(res["dc_required_headroom_per_branch"], key=lambda r: -r["h_needed"])[:8]:
    print(f"  {r['branch']:>6} base {r['base_mw']:7.2f} MW  needs h={r['h_needed']:.2f}  (worst outage {r['worst_outage']})")
print("  branches needing h>0.40:", sum(r["exceeds_h_0.40"] for r in res["dc_required_headroom_per_branch"]), "of", g.n_branch)
