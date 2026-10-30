"""Phase 3 diagnostic (IEEE-14): tie-aware top-T stability across the margin m (E11-style) and DC vs AC (E3-style),
evaluated THROUGH THE ORACLE INTERFACE with lexicographic unranking. Evidence label: [MEASURED] diagnostic -- NOT E3/E11
(IEEE-14 only; single rating family; pre-registered E3/E11 protocols are not applied). Timings are informal, not E1."""
import json, pathlib, platform, time
import numpy as np, scipy
from doomsday import __version__
from doomsday.config import load_config
from doomsday.experiments.ranking_metrics import topT_stability
from doomsday.gridtwin.base import build_base_point
from doomsday.oracle.factory import make_oracle
from doomsday.oracle.hashing import code_version

MS = (0.05, 0.10, 0.20)
out = {"label": "[MEASURED] Phase 3 diagnostic (not E3/E11)", "case": "ieee14", "case_provenance": "transcribed_from_memory_UNVERIFIED",
       "code_version": code_version(), "software": {"doomsday": __version__, "python": platform.python_version(), "numpy": np.__version__, "scipy": scipy.__version__},
       "primary_metric": "tie-expanded top-T Jaccard (S >= s_T - 1e-9); deterministic overlap is secondary", "tables": {}}
S = {}; t0 = time.perf_counter()
for m in MS:
    cfg = load_config(overrides={"rating": {"n1_margin_m": m}}); bp = build_base_point("ieee14", cfg)
    for k in (2, 3):
        for fid in ("dc", "ac"):
            o = make_oracle(fid, k, cfg, bp=bp)
            S[(m, k, fid)] = o.severity_ranks(np.arange(o.space.N))              # all of Omega_k in LEXICOGRAPHIC order
            assert o.cost_counter.unique == o.space.N
out["seconds_total_informal"] = time.perf_counter() - t0

def add(name, Sa, Sb):
    out["tables"][name] = topT_stability(Sa, Sb, Ts=(10, 100))
for k in (2, 3):
    for fid in ("dc", "ac"):
        for m in MS[1:]:
            add(f"k{k}_{fid}: m=0.05 vs m={m}", S[(0.05, k, fid)], S[(m, k, fid)])
    for m in MS:
        add(f"k{k}_m{m}: DC vs AC", S[(m, k, "dc")], S[(m, k, "ac")])
pathlib.Path("results").mkdir(exist_ok=True)
json.dump(out, open("results/phase3_oracle_diagnostics.json", "w"), indent=1)
print(f"{'comparison':<28}{'rho':>6} | {'T=10: sT  |E|  J_tie  J_det  levels':<44}| T=100: sT  |E|  J_tie  J_det  levels")
for name, r in out["tables"].items():
    def cell(t):
        if not t["feasible"]: return f"n/a ({t['reason']})"
        return f"{t['s_T'][0]:.3f} {t['tie_expanded_size'][0]:>4d}/{t['tie_expanded_size'][1]:<4d} {t['tie_expanded_jaccard']:.2f}  {t['deterministic_jaccard_secondary']:.2f}  {t['distinct_levels_in_region'][0]:>2d}/{t['distinct_levels_in_region'][1]:<2d}" + ("" if t["informative"] else " *")
    print(f"{name:<28}{r['spearman']:>6.2f} | {cell(r['top10']):<43}| {cell(r['top100'])}")
print("(* = s_T <= 1e-9 in a variant: the top-T region is the all-zero plateau, not informative)")
