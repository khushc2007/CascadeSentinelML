"""V2 Test R4 -- claims lint. Scans the README, docs, the web demo and generated reports for phrases V2 22 classes as UNSUPPORTED or
CONDITIONALLY SAFE, and fails on any use that is not negated, scoped, or explicitly marked as a quotation of the banned list.
  PYTHONPATH=. python scripts/claims_lint.py            # exit 1 on violations
A line passes if it contains a negation/scoping cue (see NEGATIONS) or the marker 'claims-lint: allow'."""
from __future__ import annotations
import re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BANNED = {
    "quantum advantage": "V2 22: UNSUPPORTED. Say: we estimate under which conditions a sqrt(N) query reduction could become a wall-clock advantage; none is demonstrated.",
    "quantum speedup": "UNSUPPORTED: no speedup is demonstrated.",
    "ground truth": "V2 22: say 'exhaustive DC reference table' / 'exact for the DC predicate'.",
    "blackout prediction": "V2 22: say 'ranking of high-severity outage sets under a quasi-steady-state cascade model'.",
    "predicts blackouts": "V2 22: UNSUPPORTED.",
    "realistic cascade": "V2 22: say 'quasi-steady-state overload cascade'.",
    "real-world deployment": "V2 22: UNSUPPORTED.",
    "grover finds the worst blackout faster": "V2 22: UNSUPPORTED.",
    "validated": "V2 22: CONDITIONALLY SAFE only as 'cross-checked against <reference> (E0) / measured in E3'.",
    "outperforms classical": "UNSUPPORTED unless an experiment shows it (E7 shows the opposite).",
    "practical quantum": "V2 22: 'not practical on current hardware'.",
    "executed on ibm": "Hardware: only with job IDs (E13 not run).",
    "ran on quantum hardware": "Hardware: only with job IDs (E13 not run).",
    "blackout probability": "S is a fraction of test-case demand under a model, never a probability of blackout.",
    "probability of blackout": "S is a fraction of test-case demand under a model, never a probability of blackout.",
    "real-time grid": "No live or real-time grid data is used anywhere.",
    "live grid data": "No live or real-time grid data is used anywhere.",
}
NEGATIONS = re.compile(r"\b(no|not|never|none|without|cannot|isn't|aren't|wasn't|nor|avoid|unsupported|banned|instead of|rather than|is not|are not|does not|do not|"
                       r"cross-checked|claims-lint: allow|NOT)\b", re.I)
SCOPED_VALIDATED = re.compile(r"(cross-checked|against|E0|E3|verified|not validated|unvalidated)", re.I)
FILES = ["README.md", "docs/*.md", "app/*.html", "app/js/*.js", "app/js/*/*.js", "PROJECT_STATUS.md", "results/phase7/REPORT.md",
         "blacksky/*.md", "blacksky/site/*.html", "blacksky/site/js/*.js", "blacksky/site/js/*/*.js"]
SKIP = {"docs/reference"}

def scan(paths=None) -> list:
    out = []
    files = paths or [p for pat in FILES for p in sorted(ROOT.glob(pat)) if not any(s in str(p) for s in SKIP)]
    for f in files:
        f = Path(f)
        for n, line in enumerate(f.read_text(errors="ignore").splitlines(), 1):
            low = line.lower()
            for phrase, why in BANNED.items():
                if phrase not in low: continue
                if phrase == "validated" and (SCOPED_VALIDATED.search(line) or NEGATIONS.search(line)): continue
                if phrase != "validated" and NEGATIONS.search(line): continue
                out.append({"file": str(f.relative_to(ROOT)) if f.is_absolute() and ROOT in f.parents else str(f), "line": n, "phrase": phrase, "text": line.strip()[:160], "fix": why})
    return out

if __name__ == "__main__":
    v = scan()
    for x in v: print(f"{x['file']}:{x['line']}: '{x['phrase']}' -> {x['fix']}\n    {x['text']}")
    print(f"claims lint: {len(v)} violation(s)"); sys.exit(1 if v else 0)
