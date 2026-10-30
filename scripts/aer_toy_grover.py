"""Tier A1 toy Grover on Qiskit Aer, IDEAL. EXECUTION STATUS is written to results/phase5/aer_toy_grover_<m>_<k>.json.
In the authoring sandbox qiskit is not installed => status NOT_RUN. To run for real:  pip install ".[quantum]" && python scripts/aer_toy_grover.py --m 6 --k 2"""
import argparse, json, pathlib
from doomsday.config import load_config
from doomsday.gridtwin.base import build_base_point
from doomsday.oracle.factory import make_oracle
from doomsday.qsearch.aer_runner import run_toy_on_aer
from doomsday.qsearch.toy import build_toy
ap = argparse.ArgumentParser(); ap.add_argument("--m", type=int, default=6); ap.add_argument("--k", type=int, default=2)
ap.add_argument("--shots", type=int, default=4096); ap.add_argument("--rmax", type=int, default=6); a = ap.parse_args()
cfg = load_config(); bp = build_base_point("ieee14", cfg)
toy = build_toy(make_oracle("dc", a.k, cfg, bp=bp), range(a.m))
res = run_toy_on_aer(toy, a.rmax, a.shots); res["grid_provenance"] = "ieee14 transcribed_from_memory_UNVERIFIED"
out = pathlib.Path("results/phase5"); out.mkdir(parents=True, exist_ok=True); p = out / f"aer_toy_grover_{a.m}_{a.k}.json"; p.write_text(json.dumps(res, indent=1))
print(f"STATUS: {res['status']}" + (f" -- {res.get('reason')}" if res['status'] in ('NOT_RUN', 'ERROR') else "")); print("written", p)
