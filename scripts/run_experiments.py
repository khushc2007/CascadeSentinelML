"""Run V2 E0-E16 experiments through the Phase 7 framework (results/phase7/<ID>/result.json + manifest.json).
  PYTHONPATH=. python scripts/run_experiments.py --only E0 E2           # selected experiments
  PYTHONPATH=. python scripts/run_experiments.py --list                  # registry and current status
  PYTHONPATH=. python scripts/run_experiments.py --all                   # everything registered, in dependency order
A failing experiment never stops the others; its manifest records FAILED with the traceback."""
import argparse, importlib, json, sys, time
from pathlib import Path
from doomsday.experiments import specs as SP
from doomsday.experiments.framework import Ctx, run_experiment

# experiment id -> (module, function, default params). Modules are imported lazily so optional dependencies (qiskit) only matter when used.
REGISTRY = {
    "E0": ("exp_grid", "e0", {"tol_pu": 1e-6}),
    "E1": ("exp_grid", "e1", {}),
    "E2": ("exp_grid", "e2", {}),
    "E3": ("exp_grid", "e3", {"e3b_per_stratum": 100}),
    "E4": ("exp_quantum", "e4", {}),
    "E5": ("exp_quantum", "e5", {"shots": 20000}),
    "E6": ("exp_search", "e6", {"seeds": SP.E6_SEEDS}),
    "E7": ("exp_search", "e7", {"seeds": SP.E7_SEEDS, "tuning_seeds": SP.E7_TUNING["seeds"], "ac_seeds": 20}),
    "E8": ("exp_search", "e8", {"seeds": 200}),
    "E9": ("exp_advanced", "e9", {"seeds": 50}),
    "E10": ("exp_advanced", "e10", {}),
    "E11": ("exp_robust", "e11", {}),
    "E12": ("exp_advanced", "e12", {}),
    "E13": ("exp_quantum", "e13", {}),
    "E14": ("exp_microoracle", "e14", {}),
    "E15": ("exp_resource", "e15", {}),
    "E16": ("exp_resource", "e16", {}),
}
ORDER = ["E0", "E1", "E2", "E3", "E11", "E6", "E7", "E8", "E4", "E5", "E13", "E9", "E10", "E12", "E14", "E15", "E16"]

def run(eid: str, ctx: Ctx, params: dict | None = None) -> dict:
    mod, fn, defaults = REGISTRY[eid]
    try:
        f = getattr(importlib.import_module(f"doomsday.experiments.{mod}"), fn)
    except (ImportError, AttributeError) as e:                       # not implemented yet -> manifest says so via the framework
        from doomsday.experiments.framework import ExpOutput, Part
        msg = f"{mod}.{fn} unavailable: {type(e).__name__}: {e}"
        f = lambda config, ctx, _m=msg: ExpOutput(parts=[Part(f"{eid}", "NOT_IMPLEMENTED", reason=_m)])
    cfg = SP.config_for(eid, **{**defaults, **(params or {})})
    return run_experiment(SP.SPECS[eid], f, cfg, ctx, config_file="doomsday/experiments/specs.py")

def main(argv=None):
    ap = argparse.ArgumentParser(); ap.add_argument("--only", nargs="*"); ap.add_argument("--all", action="store_true"); ap.add_argument("--list", action="store_true")
    ap.add_argument("--results", default="results/phase7"); ap.add_argument("--tables", default=None); ap.add_argument("--params", default=None, help="JSON {eid: {param: value}}")
    a = ap.parse_args(argv); ctx = Ctx(results_root=Path(a.results), tables_dir=a.tables)
    if a.list:
        for eid in ORDER:
            m = ctx.load_manifest(eid); print(f"{eid:4s} {SP.SPECS[eid]['name'][:45]:45s} {m['status'] if m else '-':16s} {m['evidence_label'][:90] if m else ''}")
        return 0
    ids = ORDER if a.all else (a.only or []); extra = json.loads(a.params) if a.params else {}
    for eid in ids:
        t0 = time.time(); m = run(eid, ctx, extra.get(eid))
        print(f"{eid}: {m['status']}  {m['evidence_label'][:140]}  ({time.time() - t0:.0f}s)", flush=True)
        if m.get("error"): print(m["error"][-1500:], file=sys.stderr)
    return 0

if __name__ == "__main__":
    sys.exit(main())
