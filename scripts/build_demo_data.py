"""Phase 12: build the precomputed demo data bundle (app/data/*.json) from truth tables, cascades and experiment results.
  PYTHONPATH=. python scripts/build_demo_data.py [--grids ieee14 ieee30 ieee118]"""
import argparse
from doomsday.api.demo_data import GRIDS, build
ap = argparse.ArgumentParser(); ap.add_argument("--grids", nargs="*", default=list(GRIDS)); ap.add_argument("--out", default="app/data"); a = ap.parse_args()
build(a.out, grids=a.grids)
