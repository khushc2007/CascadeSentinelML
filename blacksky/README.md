# BLACKSKY COMMAND · OMEGA

A scientific command environment for one question: **which combinations of transmission-line failures produce the most severe cascades on
the IEEE test networks, how confidently can we find them, and what can classical, ML-guided and quantum search actually contribute?**

BLACKSKY is a separate website next to the original Grid Doomsday Finder workbench (`app/`): its own entry point, identity and deployment
target. It reuses the original project's parity-tested cascade engine and data as byte-for-byte copies and never modifies `app/` or
`doomsday/` (`git diff ba8d133 -- app doomsday` is empty; checked by `scripts/blacksky_validate.py`).

## Five workspaces, one state
| Route | Workspace | What it does |
|---|---|---|
| `#theater` (default; `#autopsy` maps here) | **Cascade Theater** | Choose network, k and an outage set (typed, picked in the scene, random with a seed, or the worst known); run the browser DC engine (or stored DC/AC runs, or the API when present); replay DETECT → TRACE → CASCADE → ISLAND → ASSESS on a 3-D, schematic or 2-D view; Inspector with Run / Entity / Events (with causes) / Islands / Compare A–B / Findings; pin, reproduce, export. |
| `#quantum` | **Quantum Lab** | Circuit composer (palette, drag-and-drop, keyboard, undo/redo, parameters, templates) on an exact statevector / density-matrix simulator (composer ≤ 8 qubits; engine limits 12 qubits statevector, 7 density matrix with noise; ≤ 4000 operations); probabilities, amplitudes and phases, Bloch vectors, sampled measurements, OpenQASM 2 export. Grover search (n ≤ 8; noisy decomposed circuit n ≤ 5) built from elementary gates and simulated; toy grid formulation with a lookup oracle built from simulator runs. Optional Qiskit transpile statistics through `/bsapi`. |
| `#arena` | **Algorithm Arena** | Experiment B: exhaustive enumeration, random sampling, genetic algorithm, simulated annealing, loading-ranked enumeration and an ML-guided surrogate search on the same objective and budget (unique simulator evaluations), seeded and repeated; best-so-far curves with IQR bands, per-repetition strip plot, ranked candidates → Theater / ML. Grover on the grid objective is shown as a proposed row with no number. Experiment A: Grover vs classical query counts on a toy search. |
| `#ml` | **ML Risk Observatory** | Dataset labelled by the cascade simulator; disjoint-branch split (test candidates share no branch with training candidates); random forest (regression + severe probability with per-tree spread), logistic regression and a no-training loading baseline; metrics, prediction-vs-simulator plot, ROC / PR, importance, candidate table with "verify in simulator", active learning. Predictions are labelled PRED and never shown as verified. |
| `#evidence` | **Evidence & Resource Lab** | Experiment registry (stable ids, parents, re-run with comparison, compare, import/export), validation (recorded test report + 14 live in-browser checks), resource estimates (project fault-tolerant model; classical cost from a per-evaluation time measured here), limitations register, result classes. |

**APEX additions** (see `APEX_DIRECTIVE.md`, `REVIEW_APEX.md`): an arrival screen with the headline result; trip fronts and darkening
during replay; Layers → Line colour: *flow surge* (flow added since the intact network, per rating) and *fault lines* (frequency in the
500 most damaging sets of the exhaustive table); a severity strip of all k-sets in the Inspector; a k = 2 *search landscape* in the Arena
with a replay of where each method looked; a *prediction landscape* in the ML Observatory (simulated below the diagonal, predicted above);
the Grover geometry drawn from the simulated state; an experiment *lineage* graph; and a 10-step *briefing* that drives the real interface
(command palette → "Start the briefing").

Shared across workspaces: network, scenario id (`SCN:<net>:k<k>:<set>:<engine>:<policy>`), experiment registry (`EXP-…`), selection,
command palette (Ctrl/⌘ K), sessions, exports with metadata. Every headline value carries a result-class chip: SIM (simulated by the
cascade model), EMU (classical emulation of a quantum circuit), EST (analytical estimate), PRED (ML prediction), MEAS (measured wall-clock
time here), PROP (proposed, not run), N/A.

**Not here, by design:** no quantum hardware runs; no quantum advantage claim (the Resource Lab shows Grover's query saving and why it is
not a time saving under the project's model); no AC validation of IEEE-118 results; no live or geographic grid data (layouts are synthetic,
ratings are synthetic); Grover on the real cascade objective is not run because no reversible oracle for the cascade exists.

## Layout
```
blacksky/
  site/                     deployable static site (hosting root)
    index.html              shell: bar, workspaces, dock, modals, CSS tokens
    js/main.js              orchestrator: state, routing, lazy workspace loading, registry, exports, render loop
    js/ws/                  workspaces: theater-scenario, theater-inspector, view2d, minimap, cmdk, quantum, arena, ml, evidence, checks, charts,
                            arrival, briefing, landscape-view (APEX)
    js/sci/                 pure science modules: rng, combin, stats, features, ml, search, contracts, registry, limitations, overlays, landscape (tsc-checked)
    js/q/                   quantum engine: gates, sim (statevector, density matrix, noise), circuit, grover (tsc-checked)
    js/workers/compute.worker.js   searches, enumeration, dataset generation, training, noisy circuits — off the main thread
    js/jobs.js              job manager: progress, cancellation, time limits
    shared/                 byte-for-byte copies of app/js/core/* and app/js/three/* (cascade engine, model, layout, camera)
    data/                   byte-for-byte copies of app/data + build.json + validation.json (recorded test report)
    vendor/ fonts/          three.js r160 (MIT); Archivo, JetBrains Mono, Instrument Serif (OFL)
  serve.py                  optional server: site at /, original API at /api, BLACKSKY API at /bsapi
  test/                     node unit tests (logic, quantum, sci)
  tools/                    dev-only TypeScript checker (not deployed)
  BLACKSKY_PROGRESS.md      build record   ·   REVIEW_OMEGA.md + review/omega/   review passes 1–4 with screenshots
  APEX_DIRECTIVE.md         review of OMEGA + next-level directive   ·   REVIEW_APEX.md + review/apex/   APEX passes A–C
  DESIGN.md                 design system
```
`scripts/build_blacksky.py` refreshes `shared/` and `data/` from `app/` and writes `data/build.json`; `--check` fails on drift.

## Run locally
```bash
# static only: every workspace works; the API chip says "API offline"; Qiskit transpile is unavailable
cd blacksky/site && python -m http.server 8010            # → http://127.0.0.1:8010/

# with the optional APIs (same origin): original engines at /api, Qiskit transpile at /bsapi
pip install -e ".[api]" qiskit                            # qiskit only needed for /bsapi/quantum/transpile
PYTHONPATH=. python -m uvicorn blacksky.serve:app --port 8010   # or: make blacksky-serve
```

## Deploy (independent of the original site)
**Vercel — a new, separate project** (do not reuse or edit any existing project):
| Setting | Value |
|---|---|
| Framework preset | Other |
| Root Directory | `blacksky/site` |
| Build command | *(none)* |
| Output directory | `.` |
| Install command | *(none)* |
| Environment variables | none |
| Config | `blacksky/site/vercel.json` (security and cache headers) |

Not deployed from this session (no hosting credentials). Any static host works: publish the contents of `blacksky/site/`.

A static deployment has no `/api` or `/bsapi`: the page detects this and says so; browser engines, stored runs, workers, ML, Arena and the
quantum simulator work fully. To offer the Python engines and Qiskit transpile, run `blacksky/serve.py` behind the same origin. To point the
page at APIs elsewhere, set `<meta name="blacksky-api">` and `<meta name="blacksky-bsapi">` in `index.html` to their base URLs (no
hard-coded localhost; the defaults are the relative paths `api/` and `bsapi/`). Cross-origin APIs need CORS or a proxy. No credentials are
sent or stored.

### Environment variables
| Variable | Used by | Default |
|---|---|---|
| `BLACKSKY_SITE_DIR` | `blacksky/serve.py` | `blacksky/site` |
| `GDF_APP_DIR`, `GDF_DATA_DIR` | the original API (unchanged) | `app/`, `app/data/` |
| `BLACKSKY_OMEGA_BASE` | `scripts/blacksky_validate.py` (isolation check base commit) | `ba8d133` |

The static site reads no environment variables.

### `/bsapi` bounds
`GET /bsapi/health`; `POST /bsapi/quantum/transpile` — inputs checked by pydantic schemas, whitelisted gate names, ≤ 12 qubits, ≤ 4000 operations,
transpiles to basis {cx, rz, sx, x} and returns statistics only. No arbitrary code is executed.

### Published page
`scripts/export_blacksky_page.py` builds `build/blacksky_page/` (document wrappers stripped, fonts inlined, embed flag set; js/ including
the worker, shared/, data/, vendor/ copied) for hosting as a private claude.ai artifact.

## Test
```bash
make blacksky-test        # sync check, node unit tests, pytest integration + Qiskit/Aer/sklearn cross-checks + e2e browser journeys
make blacksky-typecheck   # tsc --checkJs (strict) on js/sci and js/q
make blacksky-validate    # all of the above + claims lint + isolation → site/data/validation.json (shown in the Evidence Lab)
```
