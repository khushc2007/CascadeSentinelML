"""Phase 4 benchmark on IEEE-14 (DC truth-table oracle). One k per invocation (keeps runs short); `--summarize` merges.
Evidence label: [MEASURED] Phase 4 benchmark diagnostic -- NOT E7. Runtime = algorithm overhead on a lookup table, NOT oracle cost.
All hyper-parameters are untuned a-priori defaults. Tables must exist: scripts/generate_truth_table.py (see README)."""
import argparse, glob, json, math, pathlib, platform, sys, time
import numpy as np, scipy
import sklearn
from doomsday import __version__
from doomsday.config import config_hash, load_config
from doomsday.experiments import benchmark as bm
from doomsday.oracle.hashing import code_version
from doomsday.oracle.table_oracle import TableOracle

ap = argparse.ArgumentParser(); ap.add_argument("--k", type=int); ap.add_argument("--seeds", type=int, default=50)
ap.add_argument("--tables", default="results/tables"); ap.add_argument("--out", default="results/phase4"); ap.add_argument("--summarize", action="store_true")
a = ap.parse_args(); out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)

def tabs(fid, k):
    ds = sorted(glob.glob(f"{a.tables}/ieee14_{fid}_k[1-{k}]_*"))
    return TableOracle.load(ds, k)

if not a.summarize:
    k = a.k; dc = tabs("dc", k); ac = tabs("ac", k) if k >= 2 else None; ref = bm.reference(dc)
    t0 = time.perf_counter(); rows = bm.run_suite(dc, "ieee14", ref, seeds=range(a.seeds), ac_table=ac)
    agg = bm.aggregate(rows, ref)
    meta = {"label": bm.LABEL, "grid": "ieee14", "grid_provenance": "transcribed_from_memory_UNVERIFIED", "k": k, "N": ref["N"], "fidelity": "dc",
            "oracle_kind": "table", "table_namespace": dc.namespace, "ac_table_namespace": ac.namespace if ac else None, "code_version": code_version(),
            "config_hash": config_hash(load_config()), "n_seeds_stochastic": a.seeds, "budget_rule": "0.5*N unique evaluations for budgeted methods; brute/milp unbudgeted",
            "hyperparameters": "a-priori defaults, NOT tuned (no verified held-out grid available)", "suite": [[m, p] for m, p in bm.SUITE],
            "software": {"doomsday": __version__, "python": platform.python_version(), "numpy": np.__version__, "scipy": scipy.__version__, "sklearn": sklearn.__version__},
            "wall_seconds_informal": time.perf_counter() - t0,
            "note_runtime": "runtime_s on a TableOracle excludes oracle evaluation cost; it is NOT a measure of oracle work (that is oracle_calls)."}
    ref_out = {kk: v for kk, v in ref.items() if kk not in ("maximizer_ranks",)}
    for T in (10, 100):
        if f"top{T}" in ref_out: ref_out[f"top{T}"] = {kk: v for kk, v in ref_out[f"top{T}"].items() if kk != "ranks"}
    (out / f"bench_ieee14_dc_k{k}.json").write_text(json.dumps({"meta": meta, "reference": ref_out, "aggregate": agg, "runs": rows}, indent=1))
    print(f"k={k} N={ref['N']} Smax={ref['Smax']:.6f} M={ref['M_at_Smax']}  ({meta['wall_seconds_informal']:.0f}s)")
else:
    docs = {int(f.stem.split('_k')[-1]): json.loads(f.read_text()) for f in sorted(out.glob("bench_ieee14_dc_k*.json"))}
    alpha = {}
    keys = sorted({kk for d in docs.values() for kk in d["aggregate"]})
    for kk in keys:
        pts = [(d["reference"]["N"], d["aggregate"][kk]["discovery_calls"]["mean"]) for d in docs.values() if kk in d["aggregate"] and d["aggregate"][kk]["discovery_calls"]]
        alpha[kk] = bm.fit_alpha(pts)
    summ = {"label": bm.LABEL, "ks": sorted(docs), "alpha_fits": alpha, "reference": {k: d["reference"] for k, d in docs.items()},
            "aggregate": {k: d["aggregate"] for k, d in docs.items()}}
    (out / "summary_ieee14_dc.json").write_text(json.dumps(summ, indent=1))
    for k, d in sorted(docs.items()):
        r = d["reference"]; print(f"\n=== IEEE-14 DC  k={k}  N={r['N']}  Smax={r['Smax']:.4f}  #maximisers={r['M_at_Smax']}  sqrtN={math.sqrt(r['N']):.1f}  (stochastic: {d['meta']['n_seeds_stochastic']} seeds) ===")
        print(f"{'method':<28}{'succ%':>6}{'succ@5sqrtN':>12}{'succ@22.5sqrtN':>15}{'disc mean/median/p95':>26}{'disc/sqrtN':>11}{'calls':>8}{'cov10':>6}{'cov100':>7}{'ms':>8}")
        for kk, a_ in d["aggregate"].items():
            dc_ = a_["discovery_calls"]; ds = f"{dc_['mean']:.0f}/{dc_['median']:.0f}/{dc_['p95']:.0f}" if dc_ else "-"
            print(f"{kk.replace('|',' ')[:27]:<28}{100*a_['success_rate']:>6.0f}{100*a_['success_rate_at']['5*sqrtN']:>12.0f}{100*a_['success_rate_at']['22.5*sqrtN']:>15.0f}{ds:>26}"
                  f"{(a_['discovery_over_sqrtN_mean'] or float('nan')):>11.2f}{a_['oracle_calls_mean']:>8.0f}{a_.get('coverage_top10_mean',float('nan')):>6.2f}{a_.get('coverage_top100_mean',float('nan')):>7.2f}{1e3*a_['runtime_s_mean']:>8.1f}")
    print("\nfitted alpha (calls ~ kappa N^alpha; 3 points, one grid, INDICATIVE ONLY):")
    for kk, f in alpha.items():
        if f: print(f"  {kk.replace('|',' ')[:40]:<42} alpha={f['alpha']:.2f}")
