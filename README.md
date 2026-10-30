# Grid Doomsday Finder (implementation of design V2.0)

Constrained quantum-search benchmark for worst-case exactly-k (N-k) cascading outages. Team Cascade Sentinel, Q-Hack India 2026.

**Status: Phases 1–14 implemented.** Results of every V2 experiment (E0–E16), with what ran, what did not and why, are in
**[`results/phase7/REPORT.md`](results/phase7/REPORT.md)** (generated from the experiment manifests). Phase-by-phase deliverables and the decisions taken
are in [`docs/PHASES_7_14.md`](docs/PHASES_7_14.md).

**No quantum advantage is claimed or demonstrated.** Tier B is an exact classical emulation of ideal quantum dynamics; Aer runs are classical simulations;
no IBM hardware was used (E13 NOT RUN); the resource/crossover model is an estimate, partially calibrated by a toy-scale micro-oracle only when asked.
Rankings describe a quasi-steady-state DC/AC cascade model with synthetic ratings; they are not blackout predictions.

## Data
Official MATPOWER 8.1 `case14/30/118.m` (commit `1a828c7`), installed unmodified by `scripts/verify_case_files.py --install`; provenance (commit +
sha256) in `doomsday/gridtwin/data/MANIFEST.json` and in every experiment manifest. Ratings are synthetic (V2 5.3 baseline or the documented N-1
covering extension, `docs/RATING_EXTENSION.md`). See `docs/DATA_PROVENANCE.md`.

## Layout
| path | what |
|---|---|
| `doomsday/gridtwin` | grid model, DC/AC power flow, islanding, cascade engine (L0–L2; no quantum imports) |
| `doomsday/oracle` | the only interface search code sees; DC/AC oracles, truth tables (`generate_truth_table --workers`) |
| `doomsday/classical` | 10 classical baselines (brute, random, hill climb, beam, SA, GA, LODF pool, ML screen, MILP, heuristic B&B) |
| `doomsday/qsearch` | Tier B emulation (Grover, BBHT, Dürr–Høyer, top-T), toy circuits, Bärtschi–Eidenbenz Dicke, QAOA, reversible A2 micro-oracle |
| `doomsday/resource` | fault-tolerant resource and crossover model (three Dicke-prep scenarios, optional κ calibration) |
| `doomsday/experiments` | E0–E16: pre-registered rules (`specs.py`), framework (status/provenance/manifests), experiment modules |
| `doomsday/api` | FastAPI layer (precomputed-first) and the demo-data builder |
| `app/` | web workbench: **Investigate** (3-D network, Three.js r160 vendored + CDN; explorer, inspector, scenario, event timeline, DC/AC comparison) and **Research** (E0–E16 results). JS ports in `app/js/core` with parity tests in `app/test`; browser journey tests in `tests/e2e`. Earlier views: `app/classic.html`. View modes Spatial / Grid focus / Grid only / Schematic (the city is decoration, never data); Inspector values tagged by origin (MATPOWER case / model / derived / synthetic). **Bengaluru Grid Explorer** in the network menu: OpenStreetMap power infrastructure on a map (MapLibre GL vendored), queried from the browser; not a simulation. Docs: `docs/ARCHITECTURE.md`, `docs/DESIGN_SYSTEM.md`, `docs/BENGALURU_EXPLORER.md`, `docs/ORIGINAL_REVIEWS_ABC.md` |
| `results/phase7/` | one folder per experiment: `result.json`, `manifest.json`, figures; `REPORT.md` |

## Run (Python ≥ 3.10; Node ≥ 18 for the JS tests)
```
make install                 # pip install -e ".[dev,analysis,quantum,reference,api]" qiskit-ibm-runtime
make data                    # official MATPOWER files (network once)
make test                    # Python suite (runs the JS parity suite too when node is present)
make truth                   # exhaustive truth tables (IEEE-118 k=3 DC: ~2 core-hours; WORKERS=2 by default)
make experiments             # E0..E16 -> results/phase7/<ID>/
make experiment E=E7         # one experiment
make demo-data report lint   # demo bundle, REPORT.md, claims lint (V2 R4)
make serve                   # API + offline workbench at http://127.0.0.1:8000 (API DC/AC engines enabled)
make test-js                 # JS parity + workbench logic (node --test)
python -m pytest tests/e2e   # browser journey (needs `pip install playwright` and Chromium)
```
Without make: `PYTHONPATH=. python scripts/run_experiments.py --all`, `PYTHONPATH=. python -m uvicorn doomsday.api.app:app`.

## Evidence labels (V2)
`[MEASURED]` produced by an experiment script with a recorded config hash · `[SIMULATED]` model of a device run on a classical computer (NumPy, Aer) ·
`[EMULATED]` exact classical computation of ideal quantum dynamics (Tier B) · `[ESTIMATED]`/`[MODELLED]` analytical model · `[PROPOSED]` not built or not run.
Experiment statuses are derived from their parts (`EXECUTED`, `PARTIAL`, `NOT_RUN`, `NOT_IMPLEMENTED`, `FAILED`); nothing can be reported as executed
unless a part executed, and a missing pre-registered dataset is never substituted.

## Earlier documentation (Phases 1–6, still valid)
`docs/CASCADE_DECISIONS.md`, `docs/CLASSICAL_METHODS.md`, `docs/CONTINGENCY_ORDERING.md`, `docs/INTERFACE.md`, `docs/QUANTUM_TIERS.md` (Phase 8 supersedes
its Bärtschi–Eidenbenz and Qiskit-export caveats: both are now verified), `docs/RESOURCE_MODEL.md` (Phase 11 adds `be_counted` and optional κ),
`docs/WORKED_EXAMPLES.md`, `docs/RATING_EXTENSION.md`. Phase 1–6 result files under `results/phase1..6` were produced with the transcribed IEEE-14 and
are kept unchanged as history.
