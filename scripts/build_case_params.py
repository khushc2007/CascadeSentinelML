"""Export the MATPOWER source parameters the workbench Inspector shows (app/data/params_<grid>.json): branch r, x, b, rateA/B/C, tap ratio,
phase shift, status; bus type, Pd, Qd, Gs, Bs, Vm, Va, baseKV, Vmin, Vmax, area, zone; generator Pg, Qg, Qmax, Qmin, Vg, Pmax, Pmin, status.
Values are copied from the official case files in doomsday/gridtwin/data (unscaled: the cascade model applies λ = 1.10 on top). Row order
is the case-file order, which is the branch/bus/generator index used everywhere else; the script checks that against app/data/grid_*.json and
cascade_model_*.json and fails on any mismatch. Existing data files are not modified.
  PYTHONPATH=. python scripts/build_case_params.py [--check]"""
from __future__ import annotations
import hashlib, json, sys
from pathlib import Path
import numpy as np
from doomsday.gridtwin.loader import DATA_DIR, _BUILTIN, _matrix, _strip_comments, provenance

ROOT = Path(__file__).resolve().parents[1]
APPDATA = ROOT / "app" / "data"
BUS_TYPE = {1: "PQ", 2: "PV", 3: "slack (ref)", 4: "isolated"}


def build(grid_id: str) -> dict:
    path = DATA_DIR / _BUILTIN[grid_id]; text = path.read_text(); t = _strip_comments(text)
    bus, gen, br = _matrix(t, "bus"), _matrix(t, "gen"), _matrix(t, "branch")
    g = json.loads((APPDATA / f"grid_{grid_id}.json").read_text()); cm = json.loads((APPDATA / f"cascade_model_{grid_id}.json").read_text())
    ids = bus[:, 0].astype(int).tolist()
    # consistency with the existing demo data: same order, same endpoints, same reactance
    assert len(br) == g["n_branch"] == cm["n_branch"] and len(bus) == g["n_bus"], grid_id
    for l, row in enumerate(g["branches"]):
        assert ids[row["from"]] == int(br[l, 0]) and ids[row["to"]] == int(br[l, 1]), (grid_id, l)
        assert abs(cm["x"][l] - br[l, 3]) < 1e-12, (grid_id, l, "x")
    assert [b["id"] for b in g["buses"]] == ids
    assert [ids[i] for i in cm["gen_bus"]] == gen[:, 0].astype(int).tolist()
    r6 = lambda v: float(round(float(v), 6))
    return {
        "grid": grid_id, "source": f"MATPOWER case file {path.name} (doomsday/gridtwin/data)", "file_sha256": hashlib.sha256(text.encode()).hexdigest(),
        "provenance": provenance(path),
        "units": {"r": "p.u.", "x": "p.u.", "b": "p.u. (total line charging)", "rate": "MVA (case file; 0 = unlimited)", "tap": "ratio (0 = line)", "shift": "degrees",
                  "Pd": "MW", "Qd": "MVAr", "Gs": "MW at V = 1 p.u.", "Bs": "MVAr at V = 1 p.u.", "Vm": "p.u.", "Va": "degrees", "baseKV": "kV", "Pg": "MW", "Qg": "MVAr", "Vg": "p.u."},
        "note": "Raw case-file values. Vm/Va are the operating point stored in the case file, not values computed by the cascade engine. Demands are unscaled (the cascade model uses λ = 1.10).",
        "branches": [{"l": l, "from": int(r[0]), "to": int(r[1]), "r": r6(r[2]), "x": r6(r[3]), "b": r6(r[4]), "rateA": r6(r[5]), "rateB": r6(r[6]), "rateC": r6(r[7]),
                      "tap": r6(r[8]), "shift": r6(r[9]), "status": int(r[10])} for l, r in enumerate(br)],
        "buses": [{"id": int(r[0]), "type": BUS_TYPE.get(int(r[1]), str(int(r[1]))), "Pd": r6(r[2]), "Qd": r6(r[3]), "Gs": r6(r[4]), "Bs": r6(r[5]), "area": int(r[6]),
                   "Vm": r6(r[7]), "Va": r6(r[8]), "baseKV": r6(r[9]), "zone": int(r[10]), "Vmax": r6(r[11]), "Vmin": r6(r[12])} for r in bus],
        "gens": [{"g": k, "bus": int(r[0]), "Pg": r6(r[1]), "Qg": r6(r[2]), "Qmax": r6(r[3]), "Qmin": r6(r[4]), "Vg": r6(r[5]), "status": int(r[7]), "Pmax": r6(r[8]), "Pmin": r6(r[9])}
                 for k, r in enumerate(gen)],
    }


def main():
    check = "--check" in sys.argv; bad = 0
    for gid in ("ieee14", "ieee30", "ieee118"):
        d = build(gid); out = APPDATA / f"params_{gid}.json"; txt = json.dumps(d, separators=(",", ":")) + "\n"
        if check:
            if not out.exists() or out.read_text() != txt: print("out of date:", out); bad += 1
        else:
            out.write_text(txt); print("wrote", out.relative_to(ROOT), len(txt) // 1024, "KB")
    if check: print("case params up to date" if not bad else f"{bad} file(s) out of date"); sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
