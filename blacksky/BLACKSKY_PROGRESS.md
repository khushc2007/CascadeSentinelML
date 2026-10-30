# BLACKSKY COMMAND: OMEGA — progress record

Resume protocol: read this file, run `git status` / `git log -3`, then continue with the first unchecked item under "Plan".
Scope: `blacksky/` only (site, serve.py, tests, docs) plus BLACKSKY tooling (`scripts/build_blacksky.py`, `scripts/*blacksky*`,
`tests/**/test_blacksky*`, Makefile `blacksky-*` targets). `app/`, `doomsday/`, original data and tests are read-only for this work.

## Baseline (Phase A, 2026-10-29)
- Git: branch master, HEAD `ba8d133`, working tree clean.
- `python3 scripts/build_blacksky.py --check` → "blacksky shared files in sync".
- `node --test blacksky/test/*.test.mjs` → 12/12 pass.
- Last full `pytest -q` (same code, previous session): 255 passed, 2 skipped.
- BLACKSKY at baseline: static ES-module site, three modes (Theater / Autopsy / Arena), three.js r160 vendored, browser DC engine
  (byte-copy of `app/js/core/cascade.js`), stored Python DC/AC runs, optional API through `blacksky/serve.py`.
- Available locally: Node 22, Python venv with qiskit 2.6.1, qiskit-aer 0.18.0, scikit-learn 1.9.1, Playwright + Chromium (SwiftShader).
- Measured browser-engine cost (node, this container): 0.20 ms (IEEE-14), 0.31 ms (IEEE-30), 0.63 ms (IEEE-118) per k = 2 evaluation.

## Architecture decisions
- Keep the no-build static stack (ES modules, vanilla DOM, three.js). No framework added: the existing site has none and the
  deployment is "no build command". Typed contracts are JSDoc typedefs + runtime validators (`js/sci/contracts.js`), type-checked
  with `tsc --checkJs` on the new pure modules (dev-only tool under `blacksky/tools`).
- Shared science code lives in BLACKSKY-owned pure modules (`js/sci/*`, `js/q/*`), unit-tested in node and cross-checked against
  Qiskit/Aer and scikit-learn from pytest. The cascade engine stays the byte-copy of the parity-tested JS port (never re-implemented).
- Heavy work (searches, exhaustive enumeration, dataset generation, model training, noisy circuits) runs in a module Web Worker
  (`js/workers/compute.worker.js`) with progress, cancellation and time limits. Browser exhaustive enumeration is capped.
- Quantum: own statevector + density-matrix engine (little-endian qubit order, as in Qiskit); multi-controlled Z decomposed into
  CX + P (parity network, exact, ancilla-free) so Grover circuits are real elementary-gate circuits; OpenQASM 2 export.
- ML: models trained in the browser on labels produced by the cascade simulator; disjoint-branch group split by default.
- Registry: versioned experiment records (`bsx.experiment/1`), stable IDs, never overwritten; localStorage when available, memory
  otherwise. Validation page reads a recorded test report and can run in-browser checks live.
- Optional BLACKSKY API (`/bsapi`, in `blacksky/serve.py`): Qiskit transpile statistics and an Aer cross-check, bounded inputs.

## Risk register
| Risk | Mitigation |
|---|---|
| Breaking the original app | No edits under `app/`; `build_blacksky.py --check`; `git diff ba8d133 -- app doomsday` must stay empty. |
| Quantum engine bugs | Unit tests against closed forms + pytest comparison with Qiskit Statevector and Aer density matrix. |
| ML metric bugs / leakage | Metrics compared with scikit-learn; split checked for branch disjointness in tests and in-browser. |
| Main-thread freezes | Worker for all loops over candidates; size limits; e2e checks responsiveness during a job. |
| Overclaiming | Provenance status on every headline value; claims lint covers `blacksky/**`; limitations register. |
| Software WebGL slowness | Render on demand; quality adapts; 2-D SVG fallback. |
| Artifact sandbox (no downloads) | Exports also offered as copyable text. |

## Plan / status
- [x] Phase A — inspect, baseline, plan (this file)
- [x] Phase B — contracts (`js/sci/contracts.js`), registry (`js/sci/registry.js`), limitations, worker (`js/workers/compute.worker.js`) + jobs (`js/jobs.js`), five-workspace shell (`index.html`, `js/main.js`), palette + sessions + layers (`js/ws/cmdk.js`)
- [x] Phase C1 — Theater: scenario panel (`ws/theater-scenario.js`: k validation, N = C(m,k), random/worst sets, engine/policy, run/cancel/pin/reproduce/export), inspector (`ws/theater-inspector.js`: Run/Entity/Events with causes/Islands/Compare A–B/Findings), 2-D view (`ws/view2d.js`), minimap, camera presets, full screen
- [x] Phase C2 — Quantum Lab (`ws/quantum.js`, engine `js/q/*`): composer (palette, drag-drop, keyboard, undo/redo, params, templates, noise), probability/amplitude/Bloch/measurement/inspector views, Grover lab (worker), toy grid formulation, exports, transpile via /bsapi when available
- [x] Phase C3 — Arena (`ws/arena.js`): experiment B (6 methods + proposed quantum row, stats, traces, strip plot, explorer, ranked candidates → Theater/ML), experiment A (toy)
- [x] Phase C4 — ML Observatory (`ws/ml.js`): dataset from simulator, disjoint-branch split, forest + logistic + baseline, metrics, plots, importance, candidates, verify, active learning, provenance
- [x] Phase C5 — Evidence Lab (`ws/evidence.js`, `ws/checks.js`): registry (detail, re-run with comparison, compare, exports, import, delete), validation (recorded report + 14 live checks), resources (project resource model + measured t_eval), limitations, classes
- [x] Phase D — integration: scenario ids across workspaces, registry dedupe + parent links, Arena/ML/Evidence → Theater, compare, sessions, exports with metadata; cross-workspace consistency 40/40
- [x] Phase E — tests: node 29/29; pytest BLACKSKY integration 14 + e2e 15; `/bsapi` with bounds; `scripts/blacksky_validate.py` → `site/data/validation.json`; tsc strict on js/sci + js/q; isolation diff empty
- [x] Phase F — reviews 1–4 with screenshots → `REVIEW_OMEGA.md`, `review/omega/{r1_before,r1_after,r4_final}`
- [x] Phase G — docs (README, DESIGN, this file, hand-off status), commit, page export + artifact

## Verification so far
- node: `node --test blacksky/test/*.test.mjs` → 29/29 (logic 12, quantum 10, sci 7).
- pytest (2026-10-30): BLACKSKY integration + cross-library + e2e → 29 passed (`tests/integration/test_blacksky*.py`, `tests/e2e/test_blacksky_e2e.py`).
- Performance (pass 4, SwiftShader): cold load 1.97 s; workspace switch 17–67 ms incl. lazy module load; ML training 11.9 s in the worker with one 70 ms main-thread long task.
- pytest cross-checks: `tests/integration/test_blacksky_quantum.py` 4/4 (Qiskit Statevector on 60 random circuits, depth/count_ops/QASM round trip, Grover decomposition, Aer density matrix + readout); `tests/integration/test_blacksky_ml.py` 5/5 (sklearn metrics, logistic coefficients).
- Browser (SwiftShader): all five workspaces render with no console errors; Arena default run (IEEE-118 k=2, exhaustive + 5 methods × 5 reps) finishes in ~20 s in the worker and the in-browser exhaustive optimum equals the stored table; ML training on all 17,205 pairs works (test R² 0.653, ROC-AUC 0.990); 14/14 live checks pass.

## Next actions (for a later session)
1. Deploy `blacksky/site` as a new static project (needs a hosting account; nothing deployed from here).
2. Measure frame rate on a GPU and review on a physical phone and with a screen reader (not possible here).
3. Polish items recorded in `REVIEW_OMEGA.md` pass 4 (Resources stat grid empty cells; phone dock horizontal scroll).

## Log
- 2026-10-29: Phase A done. Phases B and C implemented (see checklist).
- 2026-10-29: Phases D–F: /bsapi, validation report, e2e rewrite, tsc, reviews 1–3 with fixes.
- 2026-10-30: Review pass 4 (performance), docs, validation report regenerated, commit, artifact republished.

---

# APEX (2026-10-30) — progress record
Directive: `APEX_DIRECTIVE.md` (review of OMEGA + prompt). Reviews: `REVIEW_APEX.md`, screenshots `review/apex/rA/`.
Base: `393b888`. Constraints unchanged (app/ and doomsday/ untouched, result classes on every value, worker for heavy loops, no new deps).

## Status
- [x] 1 Arrival (`js/ws/arrival.js`) — headline from the live run, demand-point cells per round, once per browser, skipped on deep links
- [x] 2 Cascade propagation (`js/scene.js` fx/tween) — trip fronts + darkening tied to the playback cursor; reduced motion off
- [x] 3 Flow surge layer (`js/sci/overlays.js`, scene, 2-D, legend)
- [x] 4 Fault-line atlas (overlay + Inspector counts, k toggle)
- [x] 5 Severity context strip (Inspector → Run; bars open stored sets)
- [x] 6 Search landscape (`js/sci/landscape.js`, `js/ws/landscape-view.js`, Arena; probes recorded by `runSearch({ probes })`; worker job `landscape.k2`)
- [x] 7 Prediction landscape (ML → Landscape tab; predicted / error, test pairs only by default)
- [x] 8 Briefing (`js/ws/briefing.js`; 10 steps; palette command; arrival button)
- [x] 9 Grover geometry from the simulated state (`planeProjection`, `stageAngle` in `js/q/grover.js`; animate stages)
- [~] 10 Phase wheels — not rebuilt: OMEGA's amplitude view already draws a phase dial per basis state when amplitudes are complex
- [x] 11 Evidence lineage graph (Evidence → Lineage)
- [x] 12 Brand + motion — lit-cell mark, arrival count-up, workspace fade; no count-ups on panels that re-render during playback (they would restart)
- [x] Verification — node 35/35 (incl. apex.test.mjs 6), e2e +3 journeys, review passes A–C, claims lint 0

## Not done / open
- Bar-chip sparklines (directive 12) — dropped: they would add motion without a decision they support.
- GPU frame rate, physical phone, screen reader: not available here.
- A 120–330 ms main-thread task sequence seen once during an Arena run after other workspaces; not reproduced in isolation (REVIEW_APEX pass C).

