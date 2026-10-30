"""Compare bundled MATPOWER case files with an OFFICIAL MATPOWER checkout; optionally install the official files.
  git clone https://github.com/MATPOWER/matpower && git -C matpower checkout <tag-or-commit>
  python scripts/verify_case_files.py --matpower-dir matpower            # writes results/case_file_verification.json
  python scripts/verify_case_files.py --matpower-dir matpower --install  # copies official files, updates MANIFEST.json
Numeric comparison is done on the parsed bus/gen/branch/baseMVA tables (no tolerance: exact float equality) and on file sha256."""
import argparse, hashlib, json, pathlib, shutil, subprocess, sys
import numpy as np
from doomsday.gridtwin import loader

CASES = ("case14", "case30", "case118")

def tables(path):
    t = loader._strip_comments(pathlib.Path(path).read_text())
    import re
    base = float(re.search(r"mpc\.baseMVA\s*=\s*([0-9.eE+\-]+)\s*;", t).group(1))
    return {"baseMVA": np.array([base]), **{n: loader._matrix(t, n) for n in ("bus", "gen", "branch")}}

def compare(local, official):
    a, b = tables(local), tables(official); rep = {}
    for n in a:
        if a[n].shape != b[n].shape:
            rep[n] = {"match": False, "reason": f"shape {a[n].shape} vs {b[n].shape}"}; continue
        diff = np.argwhere(a[n] != b[n])
        rep[n] = {"match": len(diff) == 0, "n_cells": int(a[n].size), "n_differing_cells": int(len(diff)),
                  "max_abs_diff": float(np.max(np.abs(a[n] - b[n]))) if a[n].size else 0.0,
                  "first_differences": [{"row": int(r), "col": int(c), "local": float(a[n][r, c]), "official": float(b[n][r, c])} for r, c in diff[:5]]}
    return rep

def git_commit(d, override=None):
    if override: return override
    try:
        return subprocess.check_output(["git", "-C", str(d), "rev-parse", "HEAD"], text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        return None

def main(argv=None, data_dir=None, out_path=None):
    ap = argparse.ArgumentParser(); ap.add_argument("--matpower-dir", required=True); ap.add_argument("--commit")
    ap.add_argument("--install", action="store_true"); ap.add_argument("--cases", nargs="*", default=list(CASES))
    a = ap.parse_args(argv)
    data_dir = pathlib.Path(data_dir or loader.DATA_DIR); mp = pathlib.Path(a.matpower_dir)
    commit = git_commit(mp, a.commit)
    report = {"matpower_dir": str(mp), "matpower_commit": commit, "commit_recorded": commit is not None, "cases": {}}
    man_path = data_dir / "MANIFEST.json"; man = json.loads(man_path.read_text()) if man_path.exists() else {}
    for c in a.cases:
        off = mp / "data" / f"{c}.m"; loc = data_dir / f"{c}.m"; ent = {"official_file": str(off), "local_file": str(loc)}
        if not off.exists():
            ent["status"] = "OFFICIAL_MISSING"
        else:
            ent["official_sha256"] = hashlib.sha256(off.read_bytes()).hexdigest()
            if not loc.exists():
                ent["status"] = "LOCAL_MISSING"
            else:
                ent["local_sha256"] = hashlib.sha256(loc.read_bytes()).hexdigest()
                ent["byte_identical"] = ent["local_sha256"] == ent["official_sha256"]
                ent["tables"] = compare(loc, off)
                ent["status"] = "DATA_IDENTICAL" if all(v["match"] for v in ent["tables"].values()) else "DATA_DIFFERS"
            if a.install:
                shutil.copyfile(off, loc)
                man[c] = {"file": f"{c}.m", "sha256": ent["official_sha256"], "status": "official_matpower",
                          "matpower_commit": commit, "upstream_path": f"data/{c}.m", "note": "copied unmodified by verify_case_files.py --install"}
                ent["installed"] = True
        report["cases"][c] = ent
    if a.install:
        man_path.write_text(json.dumps(man, indent=1))
    out = pathlib.Path(out_path or "results/case_file_verification.json"); out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(report, indent=1))
    return report

if __name__ == "__main__":
    r = main()
    for c, e in r["cases"].items(): print(f"{c}: {e['status']}")
    print("commit:", r["matpower_commit"])
