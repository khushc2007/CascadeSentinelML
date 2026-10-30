"""Run every BLACKSKY test suite and record the outcome in blacksky/site/data/validation.json, which the Evidence & Resource Lab shows.

The report contains only what the runners printed (pass / fail / skip counts parsed from their own summaries), the exact commands, the
commit, and the time. Suites that cannot run here are recorded as "not-run" with the reason, never as passed.

  PYTHONPATH=. python scripts/blacksky_validate.py            # all suites, including the browser end-to-end suite (~3 min)
  PYTHONPATH=. python scripts/blacksky_validate.py --no-e2e   # skip the browser suite (recorded as not-run)
"""
from __future__ import annotations
import datetime as dt, json, os, re, shutil, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "blacksky" / "site" / "data" / "validation.json"
OMEGA_BASE = os.environ.get("BLACKSKY_OMEGA_BASE", "ba8d133")          # commit before the OMEGA work; app/ and doomsday/ must not differ from it
NODE = shutil.which("node") or ("/opt/node22/bin/node" if Path("/opt/node22/bin/node").exists() else None)
PY = sys.executable


def run(cmd, timeout=3600, env=None):
    t0 = time.time()
    e = {**os.environ, "PYTHONPATH": str(ROOT), **(env or {})}
    if NODE: e["PATH"] = f"{Path(NODE).parent}:{e.get('PATH', '')}"
    p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=timeout, env=e)
    return p.returncode, p.stdout + p.stderr, time.time() - t0


def node_suite(sid, name, pattern, covers):
    files = sorted(str(p.relative_to(ROOT)) for p in ROOT.glob(pattern))
    if not NODE: return {"id": sid, "name": name, "command": f"node --test {pattern}", "status": "not-run", "reason": "node not installed", "covers": covers}
    code, out, t = run([NODE, "--test", *files])
    g = lambda k: int(m.group(1)) if (m := re.search(rf"^# {k} (\d+)", out, re.M)) else None
    p, f, s = g("pass"), g("fail"), g("skipped")
    return {"id": sid, "name": name, "command": f"node --test {pattern}", "status": "passed" if code == 0 and f == 0 else "failed", "passed": p, "failed": f, "skipped": s, "durationS": t, "covers": covers}


def pytest_suite(sid, name, paths, covers):
    code, out, t = run([PY, "-m", "pytest", "-q", "-p", "no:cacheprovider", *paths])
    last = [l for l in out.strip().splitlines() if re.search(r"\d+ (passed|failed|skipped|error)", l)]
    summ = last[-1] if last else ""
    num = lambda k: int(m.group(1)) if (m := re.search(rf"(\d+) {k}", summ)) else 0
    return {"id": sid, "name": name, "command": f"pytest -q {' '.join(paths)}", "status": "passed" if code == 0 else "failed", "passed": num("passed"),
            "failed": num("failed") + num("error"), "skipped": num("skipped"), "durationS": t, "summary": summ, "covers": covers}


def simple(sid, name, cmd, covers, ok_text=None):
    code, out, t = run(cmd)
    return {"id": sid, "name": name, "command": " ".join(str(c) for c in cmd).replace(str(ROOT) + "/", "").replace(PY, "python"),
            "status": "passed" if code == 0 else "failed", "passed": 1 if code == 0 else 0, "failed": 0 if code == 0 else 1, "skipped": 0, "durationS": t,
            "output": out.strip().splitlines()[-1][:300] if out.strip() else "", "covers": covers}


def main():
    e2e = "--no-e2e" not in sys.argv
    suites = [
        simple("sync", "Shared copies byte-identical to app/", [PY, "scripts/build_blacksky.py", "--check"], ["original project isolation", "data provenance"]),
        node_suite("node-blacksky", "BLACKSKY unit tests (node)", "blacksky/test/*.test.mjs", ["cascade stages and scoring", "quantum engine closed forms", "combinatorics, statistics, features vs engine, splits, search methods"]),
        node_suite("node-app", "Original application unit tests (node, unchanged)", "app/test/*.test.mjs", ["original project still passes"]),
        pytest_suite("py-integration", "BLACKSKY integration and cross-library checks", ["tests/integration/test_blacksky.py", "tests/integration/test_blacksky_quantum.py", "tests/integration/test_blacksky_ml.py"],
                     ["Qiskit Statevector / depth / QASM", "Aer density matrix with noise", "scikit-learn metrics and logistic regression", "BLACKSKY API bounds", "deployment config"]),
    ]
    if e2e:
        suites.append(pytest_suite("e2e", "End-to-end browser journeys (Chromium, software WebGL)", ["tests/e2e/test_blacksky_e2e.py"],
                                   ["five workspaces", "workers keep the page responsive", "registry and re-run", "phone layout", "API failure handling"]))
    else:
        suites.append({"id": "e2e", "name": "End-to-end browser journeys", "command": "pytest -q tests/e2e/test_blacksky_e2e.py", "status": "not-run", "reason": "--no-e2e", "covers": ["five workspaces"]})
    suites.append(simple("lint", "Claims lint (banned phrases)", [PY, "scripts/claims_lint.py"], ["no unsupported claims in text"]))
    tsc = ROOT / "blacksky" / "tools" / "node_modules" / ".bin" / "tsc"
    suites.append(simple("types", "Type check of js/sci and js/q (tsc, @ts-check, strict)", [str(tsc), "-p", "blacksky/tools/tsconfig.json"], ["typed contracts"]) if tsc.exists()
                  else {"id": "types", "name": "Type check (tsc)", "command": "npm --prefix blacksky/tools run typecheck", "status": "not-run", "reason": "run `npm --prefix blacksky/tools install` first", "covers": ["typed contracts"]})
    diff = subprocess.run(["git", "diff", "--stat", OMEGA_BASE, "--", "app", "doomsday"], cwd=ROOT, capture_output=True, text=True)
    suites.append({"id": "isolation", "name": f"Original app/ and doomsday/ unchanged since {OMEGA_BASE}", "command": f"git diff --stat {OMEGA_BASE} -- app doomsday",
                   "status": "passed" if diff.returncode == 0 and not diff.stdout.strip() else "failed", "passed": int(diff.returncode == 0 and not diff.stdout.strip()),
                   "failed": int(not (diff.returncode == 0 and not diff.stdout.strip())), "skipped": 0, "output": diff.stdout.strip()[-300:] or diff.stderr.strip()[-300:], "covers": ["original project isolation"]})
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip() or None
    dirty = bool(subprocess.run(["git", "status", "--porcelain", "--", "blacksky", "app", "doomsday", "scripts", "tests", ":!blacksky/site/data/validation.json", ":!blacksky/site/data/build.json"],
                                cwd=ROOT, capture_output=True, text=True).stdout.strip())
    vers = {"python": sys.version.split()[0], "node": subprocess.run([NODE, "--version"], capture_output=True, text=True).stdout.strip() if NODE else None}
    for mod in ("qiskit", "qiskit_aer", "sklearn", "playwright"):
        try: vers[mod] = __import__(mod).__version__
        except Exception: vers[mod] = None  # noqa: E701
    rep = {"schema": "bsx.validation/1", "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"), "commit": head, "dirty": dirty,
           "command": "python scripts/blacksky_validate.py" + ("" if e2e else " --no-e2e"), "environment": vers, "suites": suites}
    OUT.write_text(json.dumps(rep, indent=1) + "\n")
    for s in suites: print(f"{s['status']:8} {s['name']}  {s.get('passed', '')}/{s.get('failed', '')}/{s.get('skipped', '')}  {s.get('summary', s.get('reason', ''))}")
    print(f"wrote {OUT.relative_to(ROOT)}"); return 0 if all(s["status"] in ("passed", "not-run") for s in suites) else 1


if __name__ == "__main__":
    sys.exit(main())
