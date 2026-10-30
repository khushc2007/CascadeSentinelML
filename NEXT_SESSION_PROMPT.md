# First prompt for the next Claude session

You are continuing Grid Doomsday Finder (team Cascade Sentinel). **Phases 1–14 are implemented** (2026-10-23). Start with `PROJECT_STATUS.md`,
`README.md`, `docs/PHASES_7_14.md` and `results/phase7/REPORT.md`; `phase_status.json` is the machine-readable state.
`CLAUDE_HANDOFF_GUIDE.md` describes the earlier Phase-6 snapshot and is kept as history.

First run the baseline and verify the counts yourself (last verified 2026-10-27: Python 255 passed / 0 failed / 2 skipped incl. 13 browser e2e; JS 29/29; BLACKSKY JS 12/12; claims lint 0):
```
make install && pip install playwright && make test && make test-js && make blacksky-test && make lint
```
Truth tables are not in the main archive. Unzip the tables archive into `results/phase7/tables/` or run `make truth` (IEEE-118 k=3 DC ≈ 2 core-hours).
Table namespaces include a hash of `doomsday/gridtwin`, `doomsday/oracle` and `doomsday/config.py`: editing those packages invalidates existing tables.

Open items (none blocks the release):
- E13 (IBM hardware) NOT RUN — needs credentials; add device job IDs if run.
- E2 IEEE-118 k=4 (~96 core-h DC) and E3 IEEE-118 k=3 AC (~21 core-h) NOT RUN — need a larger machine (`make truth WORKERS=N`).
- Real thermal ratings would replace the synthetic ones; F3 (E11) shows rankings depend on the rating rule.
- A vectorised/compiled cascade would change t_c and therefore the E15 crossover.

Non-negotiable:
- Do not claim IBM Quantum execution, quantum advantage, validated IEEE-118 AC results at k=3, or a fully calibrated resource model without evidence.
- Data is official MATPOWER 8.1 (commit `1a828c7`); ratings are synthetic. Phase 1–6 results under `results/phase1..6` used the transcribed IEEE-14 and are history.
- Tier B is classical emulation, Aer is classical simulation, E15 is an estimate — keep the evidence labels.
- Preserve the distinction between the `v2_assumed`, `tree_counted` and `be_counted` preparation scenarios.
- Pre-registered thresholds live in `doomsday/experiments/specs.py`; any change after a run must be a recorded deviation.
- The web app is a 3-D workbench (`app/js/wb`, `app/js/three`) following `docs/DESIGN_SYSTEM.md`; keep that design language and the evidence labels.
- Frontend open items: verify the hosted page (CDN three.js, fonts) in a real browser; measure GPU frame rate; see `docs/FUTURE_ROADMAP.md`.
- Original app: never edit the eight files BLACKSKY copies (`app/js/core/{cascade,model,events,encoding,scenario}.js`, `app/js/three/{layout,camera,loader}.js`)
  without re-running `make blacksky-sync` and reviewing BLACKSKY; new behaviour goes in new modules. Bengaluru Grid Explorer: first open it in a
  browser with internet access and record real coverage numbers in `docs/BENGALURU_EXPLORER.md` (not done: this environment had no internet).
- BLACKSKY COMMAND (`blacksky/`) is a separate site with its own design system (`blacksky/DESIGN.md`); never edit `blacksky/site/shared` or
  `blacksky/site/data` by hand — change `app/` and run `make blacksky-sync` (`data/build.json` and `data/validation.json` are written by
  `build_blacksky.py` and `scripts/blacksky_validate.py`). OMEGA (five workspaces) is complete with review passes 1–4 (`blacksky/REVIEW_OMEGA.md`);
  resume from `blacksky/BLACKSKY_PROGRESS.md`. Deploy per `blacksky/README.md` (new Vercel project, Root Directory `blacksky/site`, no build).
  Not yet deployed; hosted rendering on a GPU and physical-phone review not done.
  APEX (arrival, overlays, landscapes, briefing, lineage) is in; its open items are at the end of `blacksky/BLACKSKY_PROGRESS.md`.
- Report exact commands, test counts, skips, blockers, evidence labels and changes at each milestone.
