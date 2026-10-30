"""Generate (resumable) truth tables from the deterministic DC/AC oracle. NEVER run automatically by tests/CI.
  python scripts/generate_truth_table.py --grid ieee14 --fidelity dc --k 1 2 3 4 --out results/tables
  python scripts/generate_truth_table.py --grid ieee118 --fidelity dc --k 4 --out /big/disk/tables --force --no-full-records   # ~48M sets: hours; run separately
Spaces larger than --max-sets are refused without --force."""
import argparse, json, pathlib
from doomsday.config import load_config
from doomsday.gridtwin.base import build_base_point
from doomsday.oracle.factory import make_oracle
from doomsday.oracle.table_oracle import TableOracle, generate_truth_table

ap = argparse.ArgumentParser()
ap.add_argument("--grid", default="ieee14"); ap.add_argument("--fidelity", choices=["dc", "ac"], default="dc")
ap.add_argument("--k", type=int, nargs="+", required=True); ap.add_argument("--out", default="results/tables")
ap.add_argument("--chunk", type=int, default=20000); ap.add_argument("--max-sets", type=int, default=2_000_000)
ap.add_argument("--force", action="store_true"); ap.add_argument("--no-full-records", action="store_true")
ap.add_argument("--margin", type=float, default=None, help="override rating.n1_margin_m")
ap.add_argument("--workers", type=int, default=1, help="parallel worker processes (identical output; chunks written in order)")
a = ap.parse_args()
cfg = load_config(overrides={"grid": a.grid, **({"rating": {"n1_margin_m": a.margin}} if a.margin is not None else {})})
bp = build_base_point(a.grid, cfg)
for k in a.k:
    o = make_oracle(a.fidelity, k, cfg, bp=bp, use_cache=False)
    d = generate_truth_table(o, a.out, grid_name=a.grid, chunk=a.chunk, full_records=not a.no_full_records, max_sets=a.max_sets, force=a.force, workers=a.workers)
    t = TableOracle.load(d, k); m = t.meta
    print(f"{d}: N={m['N']} complete={m['complete']} S.max={t.all_severities().max():.6f} provenance={bp.grid.source.get('provenance',{}).get('status')}")
