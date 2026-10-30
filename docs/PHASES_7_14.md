# Phases 7–14: what each phase delivered

**Numbering.** V2 §26 has no Phases 1–14; it schedules work as Round 1, Round 2 sprints (a)/(b), Freeze and Final. Phases 1–6 were named by the earlier
implementation sessions. Phases 7–14 below were **assigned in this session** to cover every V2 deliverable not built in Phases 1–6, and the same mapping
is recorded in `doomsday/experiments/specs.py` (`SPECS[...]["phase"]`). Results (all numbers) are in **`results/phase7/REPORT.md`**, generated from the
experiment manifests; this file deliberately contains no result numbers.

| Phase | Scope (V2 section) | Main files | Tests |
|---|---|---|---|
| 7 | Experiment pipeline; official data; E0–E3, E6–E8, E11 (§10.1, §15, §17, §18) | `experiments/{framework,specs,common,exp_grid,exp_search,exp_robust}.py`, `scripts/run_experiments.py`, `scripts/generate_truth_table.py --workers` | `tests/unit/test_phase7_engine_options.py`, `tests/integration/test_case_files.py`, `tests/integration/test_table_oracle.py` |
| 8 | Circuit tier: E4, E5, E13; Bärtschi–Eidenbenz Dicke preparation (§11.3, §13.1) | `qsearch/{dicke,circuits,aer_runner,qiskit_export}.py`, `experiments/exp_quantum.py` | `tests/quantum/test_be_dicke.py` |
| 9 | JavaScript port of the cost model, Tier B emulation and ranking metrics (§21, Test R1) | `app/js/core/{resource,emulation,ranking}.js`, `scripts/make_js_fixtures.py` | `app/test/parity.test.mjs`, `tests/integration/test_js_parity.py` |
| 10 | Top-T (E9), QAOA surrogate (E10), fixed-point precision (E12) (§12 Problem 5, §14, §17.1) | `qsearch/{topt,surrogate,qaoa}.py`, `experiments/exp_advanced.py`, `gridtwin/cascade.py` (`quantize_pu`) | `tests/quantum/test_phase10.py` |
| 11 | A2 micro-oracle (E14) and the calibrated resource re-estimate (E15) (§13.4, §16) | `qsearch/{reversible,microoracle}.py`, `resource/{calibration,prep,scenarios}.py`, `experiments/{exp_microoracle,exp_resource}.py` | `tests/quantum/test_microoracle.py`, `tests/resource/*` |
| 12 | API (§20.3) | `api/{app,demo_data}.py`, `scripts/build_demo_data.py` | `tests/api/test_api.py` |
| 13 | Web demonstration (§21); redesigned in 13b (see below) | `app/index.html`, `app/js/main.js`, `app/js/ui/*.js`, `app/js/core/cascade.js`, `app/data/*.json`; previous view kept as `app/classic.html` | `app/test/cascade.test.mjs` (JS DC cascade = Python on 520 cases); rendered in a headless browser at desktop and phone width |
| 14 | E16, claims lint (R4), golden regression (R2), provenance (R3), Makefile, report, release | `scripts/{claims_lint,make_report}.py`, `Makefile`, `results/phase7/REPORT.md` | `tests/regression/test_golden_and_provenance.py` |

## Decisions taken in this session (each recorded where it applies)
1. **Official data.** MATPOWER 8.1 (commit `1a828c7`) `case14/30/118.m` installed unmodified by `scripts/verify_case_files.py --install`. The earlier
   transcribed case14 had identical electrical values (only optional columns were missing); its content hash is unchanged.
2. **Loader defect D1** fixed (`ieee30/118` → `case30/118.m`) with a regression test; the provenance test became state-aware.
3. **Pre-registration.** Every threshold, decision rule and deviation is in `experiments/specs.py`, committed to git before the experiment it governs ran
   (see `git log -- doomsday/experiments/specs.py`). Deviations are listed in `specs.DEVIATIONS` and reproduced at the end of the report.
4. **Compute limits.** IEEE-118 exhaustive AC at k=3 (~21 core-hours here) and DC at k=4 (~96 core-hours) are NOT RUN; nothing smaller is substituted
   for a pre-registered dataset. Supplementary analyses are labelled SUPPLEMENTARY.
5. **Engine options are opt-in.** Rating families, perturbation, per-engine DC rating basis, fixed-point arithmetic and the `workers` option change
   nothing at their defaults (Phase 1–6 tests and the R2 golden file guard this).
6. **Reference solver.** pandapower 3.5.6's MATPOWER converter rejects case14 (no BASE_KV), so E0 uses PYPOWER 5.1 (the MATPOWER port pandapower's solver
   derives from) on the identical official case data (`specs.DEVIATIONS: E0-reference`).
7. **Bärtschi–Eidenbenz Dicke.** Reconstructed and verified numerically for every n ≤ 10; it backs V2's `C_D ≈ kLc_rot`. Reported as `be_counted`
   next to the unchanged `v2_assumed` and `tree_counted` scenarios (never merged).
8. **Top-T.** V2's literal exclusion-list scheme was found to cost ~T·√N during development; E9 reports it next to the threshold-list scheme
   (`specs.DEVIATIONS: E9-variants`).
9. **A2 micro-oracle.** Uses a per-topology sensitivity lookup in place of V2's reversible small inverse, so the small-inverse primitive stays
   UNCALIBRATED; κ calibrates a textbook (unoptimised) synthesis and is applied to the resource model only when requested (`calibrated: "partial"`).
10. **Hardware (E13).** No IBM Quantum credentials exist in this environment; NOT RUN, nothing claimed.

## How to reproduce
```
make install && make data          # packages; official MATPOWER files (network once)
make truth                         # exhaustive tables (hours for IEEE-118 k=3)
make experiments                   # E0..E16 -> results/phase7/<ID>/{result,manifest}.json (+ figures)
make demo-data report              # app/data bundle; results/phase7/REPORT.md
make test test-js lint             # Python + JS suites; claims lint
make serve                         # API + offline demo on http://127.0.0.1:8000
```

## Phase 13b — advanced web demonstration (2026-10-24, redesign approved by the team)

The demo was rebuilt as a presentation-grade product page. The earlier interface is kept unchanged as `app/classic.html` (+ `app/js/classic.js`).
- **In-browser DC cascade.** `app/js/core/cascade.js` ports `gridtwin/cascade.py` (mode `dc`, float64). Inputs: `data/cascade_model_<grid>.json`,
  exported from the same engine object the truth tables use. Parity: `app/test/cascade.test.mjs` checks S, S0, rounds, status, trips per round, islands
  and the final out-of-service set on 520 cascades (worst 20 per table + 360 seeded random sets of size 1-5); fixtures by `scripts/make_js_fixtures.py --cascade`.
- **Sections.** Live hero (IEEE-118 base flow + the worst exhaustive-table sets cascading), combinatorial wall (exact C(L,k), one-core time at the E1 mean),
  live cascade lab (pick lines, trigger, round log, rank against the exhaustive table via `data/dist_<grid>_k<k>.json`), live exhaustive pair scan in a Web
  Worker (self-checked against the table maximum and positive count), quantum hunt (closed-form ideal Grover on the real table + race of the recorded
  traces), crossover oracle (JS resource model with E15 inputs; break-even logical Toffoli time), proof (E16 falsifiers, E0-E16 ledger, provenance),
  pitch mode (full-screen slides, speaker notes, clock) and a command palette (Ctrl/Cmd-K).
- **Data added by `doomsday/api/demo_data.py`:** `cascade_model_<grid>.json`, `dist_<grid>_k<k>.json` (exact top-500 + 1000-bin histogram), `headline.json`
  (numbers copied from E1, E3, E5, E6, E7, E11, E12, E14, E15, E16 results).
- **Claims lint** now scans `app/*.html` and `app/js/**` too.
