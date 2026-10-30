> **Superseded (2026-10-23).** This guide describes the Phase-6 snapshot it was written for. Phases 7–14 are now implemented; current state is in
> `PROJECT_STATUS.md`, `phase_status.json`, `docs/PHASES_7_14.md` and `results/phase7/REPORT.md`. Statements below such as "no API or frontend",
> "official IEEE-30/118 data absent" and "Aer NOT RUN" no longer hold.

# Claude Handoff Guide — Grid Doomsday Finder

**Team:** Cascade Sentinel  
**Project:** Grid Doomsday Finder  
**Snapshot supplied:** `grid-doomsday-finder-phase7-wip (1).zip`  
**Repository status declared by its own README:** Phases 1–6; no API or frontend yet.  
**Latest reported milestone:** Phase 6 resource model completed provisionally; report says 190 passed, 0 failed, 2 skipped. Resource model is **not calibrated**. The test claim is reported evidence, not independently re-run during packaging.

## A. Project overview

Grid Doomsday Finder studies the worst sets of exactly `k` simultaneous transmission-branch outages in a deterministic, quasi-steady-state cascade model. It is intended for power-systems researchers, quantum-algorithm researchers, and engineers evaluating search complexity—not for operational blackout prediction.

The design compares:
- a classical grid digital twin and cascade evaluation;
- classical ranking/search baselines;
- ideal quantum-search dynamics represented by **classical emulation** and small toy statevector circuits;
- analytical resource/crossover estimates.

The authoritative design is **Grid Doomsday Finder — Solution Design & Architecture V2.0**, which supersedes V1. The PDF is not present in the supplied ZIP. Obtain the original V2 PDF separately and add it to `docs/reference/` before claiming it is bundled. The repository does contain implementation notes in `docs/`.

### Core definitions
- Branch count: `L`; initiating outage set `x` contains exactly `k` branches.
- Search space: `Ω_k = {x ∈ {0,1}^L : ||x||₀ = k}`, size `N = C(L,k)`.
- `S`: fraction of base-case load unserved at cascade termination.
- `S0`: fraction unserved immediately after initial outage/island balancing.
- `C = S - S0`: cascade contribution.
- `A = S / max(S0, ε)`: diagnostic only.
- Cascade loop: apply initial outages → identify islands → balance generation/load → solve flows → identify/trip overloaded branches → repeat until termination.
- DC flow is the screening/search model; AC is a higher-fidelity classical check. The simulator is quasi-steady-state, not a dynamic protection/relay simulation.
- Quantum resource model uses analytical assumptions and placeholders; a √N query bound is not a claim of practical wall-clock advantage.

## B. Phase-by-phase status

**Important status rule:** This ZIP only contains implementation evidence through Phase 6. The exact phase names and acceptance criteria for Phases 7–14 must be checked against the original V2 PDF/roadmap. Do not infer completion from the presence of a directory or a design description.

| Phase | Snapshot status | Evidence and unfinished work | Next action |
|---|---|---|---|
| 1 | Implemented with qualifications | Grid/data/rating foundations; `results/phase1_rating_feasibility.json`, `results/phase1_test_log.txt`. IEEE-14 is transcribed/unverified. README calls the rating-feasibility diagnostic measured; it does not validate real-grid accuracy. | Verify environment/tests; obtain official MATPOWER files and compare case14. |
| 2 | Implemented with qualifications | Cascade engine and diagnostics; `results/phase2_cascade_diagnostics.json`, `results/phase2_test_log.txt`; known-cascade and invariant tests. IEEE-14 data remains unverified. | Re-run unit/integration tests and document any differences with official data. |
| 3 | Implemented with qualifications | Oracle layer and tie-aware ranking diagnostic; `results/phase3_oracle_diagnostics.json`, `results/phase3_test_log.txt`. | Verify oracle contracts, cache/ordering invariants, and saved diagnostic reproducibility. |
| 4 | Implemented/partially verified | Classical baselines and benchmark artifacts under `results/phase4/`; test log present. Scope includes DC tables/benchmarking; official IEEE-30/118 data absent. | Re-run supported IEEE-14 jobs and confirm saved outputs; label timing results as machine-specific. |
| 5 | Implemented with qualifications | Tier B ideal classical emulation and toy statevector circuits; `docs/QUANTUM_TIERS.md`, `results/phase5/`, `results/phase5_test_log.txt`. Phase report says 172 passed, 0 failed, 2 skipped. Qiskit/Aer scripts were written but NOT RUN according to reports. Dicke preparation is not the V2 Bärtschi–Eidenbenz construction. | Verify existing tests; do not describe emulation as quantum hardware execution. |
| 6 | Provisionally completed; uncalibrated | `doomsday/resource/`, `docs/RESOURCE_MODEL.md`, `scripts/phase6_measured_inputs.py`, `scripts/phase6_resource_model.py`, `results/phase6/`, `tests/resource/test_resource_model.py`. Phase 6 report says 190 passed, 0 failed, 2 skipped. | Reproduce the reported tests and outputs; retain the explicit NOT CALIBRATED status. |
| 7 | Not evidenced as complete; next milestone | The supplied ZIP has an empty `results/phase7/`; README still says Phases 1–6. Prior phase report frames Phase 7 as experiment pipeline E0–E16, but the original V2 roadmap must be checked for exact definitions. | Read V2 experiment table and scripts, map each E0–E16 to code/config/data, run only supported experiments, label unverified-grid results exploratory, and mark blocked experiments NOT RUN. |
| 8 | Status not established from this ZIP | No authoritative Phase 8 completion report was found in the archive. Do not invent a phase title. | Consult V2 roadmap and previous phase reports; record explicit deliverables and blockers before work. |
| 9 | Planned/identified, not completed | Phase 6 report explicitly identifies the JavaScript port as Phase 9. No frontend/backend is included in this ZIP. | Verify the V2 specification for the exact port scope; implement only after prior dependencies are satisfied and add parity tests against Python. |
| 10 | Status not established from this ZIP | No Phase 10 completion report. V2 design discusses an injection update after island rebalancing (PTDF × ΔP); verify whether this is the phase assigned to it in the actual roadmap before scheduling. | Read V2 phase table and map its deliverables to modules/tests. |
| 11 | Status not established from this ZIP | No Phase 11 completion report in the supplied archive. | Verify original roadmap; implement only the named V2 deliverable and its acceptance tests. |
| 12 | Status not established from this ZIP | No Phase 12 completion report. | Verify original roadmap; do not infer that optional quantum methods are required or completed. |
| 13 | Status not established from this ZIP | No Phase 13 completion report. No IBM hardware evidence is bundled. | Verify original roadmap; hardware execution must remain NOT RUN unless actual provider/job evidence exists. |
| 14 | Status not established from this ZIP | No Phase 14 completion report. No web dashboard, API, or end-to-end app is included in this snapshot. | Verify original roadmap and complete the specified integration, end-to-end tests, and deployment steps only when supported. |

### Test-count provenance
- Phase 5 report: 172 passed, 0 failed, 2 skipped (174 total); skips are official IEEE-30/118 smoke tests.
- Phase 6 report: 190 passed, 0 failed, 2 skipped (192 total); same official-grid blockers.
- These are **reported counts** from the prior session. The packaging process has not independently reproduced the full suite. A fresh machine must run the commands below and record the actual result.

## C. Implemented vs emulated vs estimated

### Present in source
- Grid twin: DC/AC flow-related modules, case loader, contingency handling, cascade simulation, severity, islanding, ratings/security.
- Classical methods and oracle/table-oracle abstractions.
- Quantum Tier B ideal algorithm emulation and toy statevector/circuit utilities.
- Resource-model formulas, parameter provenance, preparation scenarios, plots, and regression tests.
- Phase 1–6 diagnostics, saved result tables, test logs, and documentation.

### Must not be overstated
- `case14.m` is transcribed from memory and explicitly unverified.
- Official IEEE-30 and IEEE-118 MATPOWER cases are not bundled.
- No frontend/dashboard or API/backend is included in this ZIP.
- Qiskit/Aer scripts exist but reports say they were not run; saved JSON names alone are not proof that Aer ran.
- No IBM Quantum hardware execution evidence is present.
- No quantum advantage is demonstrated.
- Resource/crossover/qubit estimates are analytical estimates with placeholder assumptions and are not calibrated.
- Bärtschi–Eidenbenz state preparation has not been reproduced. Keep the `v2_assumed` cost scenario separate from the `tree_counted` multiplexed-RY tree count; the latter's Toffoli-equivalent conversion is itself an estimate.
- No validated IEEE-118 result is present.

## D. Environment and reproducibility

### Requirements
- README specifies Python >= 3.10.
- `pyproject.toml` is the dependency authority. Core dependencies include NumPy/SciPy/NetworkX/PyYAML; dev extras include pytest. Resource figures require Matplotlib.
- No Node.js version is applicable to this ZIP because no frontend is present.

### Suggested clean setup (commands are source-supported; not independently verified during packaging)
From the extracted `gdf/` directory:

```bash
python --version
python -m venv .venv
# Linux/macOS:
source .venv/bin/activate
# Windows PowerShell:
# .venv\Scripts\Activate.ps1

python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
python -m pytest -q
```

Fallback runner (does not require pytest):
```bash
PYTHONPATH=. python scripts/run_tests.py
```

Resource model:
```bash
PYTHONPATH=. python scripts/phase6_measured_inputs.py
PYTHONPATH=. python scripts/phase6_resource_model.py
PYTHONPATH=. python scripts/run_tests.py test_resource_model
```

Phase diagnostics:
```bash
PYTHONPATH=. python scripts/rating_feasibility.py
PYTHONPATH=. python scripts/phase2_cascade_diagnostics.py
PYTHONPATH=. python scripts/phase3_oracle_diagnostics.py
PYTHONPATH=. python scripts/phase5_tierB_diagnostic.py
PYTHONPATH=. python scripts/phase5_worked_examples.py
```

Optional Qiskit/Aer, only with network access and compatible dependencies:
```bash
python -m pip install ".[quantum]" qiskit-ibm-runtime
PYTHONPATH=. python scripts/aer_toy_grover.py --m 6 --k 2
PYTHONPATH=. python scripts/aer_toy_grover.py --m 8 --k 3
PYTHONPATH=. python scripts/aer_noise_toy_grover.py --m 6 --k 2 --backend FakeSherbrooke
```
These are proposed execution commands from the README, not a statement that the runs have succeeded. Record whether dependencies are installed and whether each job actually executes.

### Official MATPOWER data
The README directs users to place `case30.m` and `case118.m` into `doomsday/gridtwin/data/` and use:
```bash
PYTHONPATH=. python scripts/verify_case_files.py --matpower-dir <matpower checkout> [--install]
```
Do not silently substitute generated or synthetic cases for official files.

### API/frontend
There are no backend/API start commands and no frontend start commands in this snapshot. Do not claim full-app local execution is supported until these components are implemented and included.

## E. Architecture/file map

- `doomsday/gridtwin/`: grid models, loading, DC/AC solvers, contingency representation, cascade, severity, islanding, ratings/security/scaling.
- `doomsday/gridtwin/data/case14.m`: transcribed IEEE-14 case; unverified.
- `doomsday/oracle/`: oracle implementations used by search/evaluation.
- `doomsday/classical/`: classical baseline methods and structural methods.
- `doomsday/qsearch/`: quantum-search algorithm emulation, toy statevector/circuit implementation and exporters (inspect actual files before changing).
- `doomsday/resource/`: parameters, component counts, crossover arithmetic, qubit estimates, preparation scenarios, calibration/provenance logic.
- `doomsday/experiments/`: experiment utilities/definitions present in source; inspect scripts and V2 E0–E16 table before asserting experiment completion.
- `configs/default.yaml`: default configuration.
- `scripts/`: runnable diagnostics, benchmark/table generation, quantum/Aer scripts, resource model, test runner.
- `tests/unit/`: DC/AC, cascade invariants/known cases, configuration, contingencies, ratings, security, ranking and loader tests.
- `tests/integration/`: benchmarks, case files, classical methods, interface extensions, oracle and table oracle.
- `tests/quantum/`: toy circuits, statevector Dicke, Tier B, Aer exporter tests.
- `tests/resource/test_resource_model.py`: resource-model tests.
- `results/`: logs, diagnostic JSON, Phase 4 benchmark outputs, Phase 5 emulation outputs, Phase 6 model outputs/figures, and saved truth tables.
- `docs/`: provenance, decisions, ordering, classical methods, interface, quantum tiers, worked examples and resource model.
- `docs/PROTECTED_BASELINE.json`: baseline protection metadata.
- `pyproject.toml`, `Makefile`: packaging/developer configuration and tasks.
- `README.md`: project's current authoritative run instructions/status statement.

## F. Non-negotiable decisions

1. V2 supersedes V1.
2. Preserve all evidence labels and distinguish IMPLEMENTED, MEASURED, SIMULATED, EMULATED, ESTIMATED, DESIGN-STAGE, PROPOSED, OPTIONAL.
3. Do not claim quantum advantage, hardware execution, validated IEEE-118 outcomes, or calibrated estimates without reproducible evidence.
4. Keep unverified case14 and missing official case30/case118 data explicit.
5. Keep the V2 assumed preparation cost and counted tree implementation as separate scenarios.
6. Micro-oracle, QAOA, ranked-index encoding, quantum counting, and top-T work are deferred/not implemented unless repository evidence proves otherwise.
7. The dashboard's UI/UX must not be redesigned without explicit permission. If frontend files are introduced later, preserve them and connect real data; do not disguise mock data as actual simulation output.
8. Do not modify application logic merely to prepare the handoff.
9. Preserve existing phase numbering. Verify Phase 7–14 names in the original V2 roadmap before coding.

## G. Roadmap for Phases 7–14

This is a **dependency-aware continuation checklist**, not a substitute for the V2 roadmap. The ZIP does not contain the V2 PDF or reports for Phases 7–14, so exact phase titles/requirements must be transcribed from V2 before each phase is accepted.

### Phase 7 — experiment pipeline (identified by Phase 6 report)
- **Scope:** E0–E16 experiment pipeline as described in V2. Map every experiment ID to its protocol, script, configuration, data requirement, output schema, and status.
- **Likely files:** `doomsday/experiments/`, `scripts/`, `configs/`, `results/`, tests, `docs/RESOURCE_MODEL.md`.
- **Work:** Run only experiments supported by implemented code and verified-enough inputs. IEEE-14 outputs must be labelled exploratory because the case is unverified. Prepare official-grid-dependent configurations as `NOT RUN`, not as fabricated results.
- **Tests/exit:** experiment schema validation; deterministic rerun checks where applicable; configuration hashes/provenance; no overwritten historical results; a table listing every E0–E16 status and reason.
- **Blockers:** official MATPOWER data for IEEE-30/118; unrun Aer/noise paths; missing micro-oracle for calibration.
- **Type:** experiments/model evaluation.

### Phase 8 — verify exact V2 scope before work
- Phase title and acceptance criteria are **not recoverable from this ZIP alone**. Read V2 §26 roadmap and relevant sections, then write an explicit task plan without changing phase numbering.
- Likely work depends on Phase 7 artifacts; determine exact files only after source review.
- **Exit:** deliverables and tests match V2 and are recorded in a phase report.

### Phase 9 — JavaScript port (explicitly identified in Phase 6 report)
- **Scope:** port the V2-designated logic to JavaScript; verify the exact subset from V2.
- **Likely files:** new JS module/package and cross-language fixtures; do not replace Python reference implementation.
- **Tests/exit:** same inputs yield matching outputs within defined tolerances; edge cases, ordering, ties, invalid inputs and determinism covered; Python baseline unchanged.
- **Blocker:** exact V2 port scope and test vectors need confirmation.
- **Type:** model/implementation, possibly integration prerequisite.

### Phases 10–14 — do not invent titles
- Consult the original V2 roadmap and any prior reports before assigning deliverables. V2's overall architecture includes a power-grid twin, DC/AC verification, cascade model, search algorithms, quantum/resource analysis, experiments, API and web demonstration; that overall list is not enough to assign exact phase numbers.
- For each phase, record: verbatim/faithful V2 goal, source modules, dependencies, tests, acceptance criteria, evidence label, and remaining blockers.
- If a phase includes API/backend: define API contract, validation/error semantics, state management, and integration tests.
- If a phase includes frontend: preserve existing UI/UX, use real API responses, visibly label simulations/mocks, handle loading/errors, and test all workflows.
- If a phase includes deployment: document environment variables in `.env.example`, never commit secrets, include health checks, build/test commands, and a deployment verification checklist.
- **End-to-end completion:** user can start supported services, run a defined simulation, see actual backend results in the existing dashboard, inspect provenance/evidence labels, and reproduce tests. This is not true in this ZIP.

## H. Immediate next steps for the fresh Claude

1. Read `README.md`, this guide, `PROJECT_STATUS.md`, `docs/RESOURCE_MODEL.md`, `docs/DATA_PROVENANCE.md`, `docs/QUANTUM_TIERS.md`, `docs/INTERFACE.md`, and `docs/CLASSICAL_METHODS.md`.
2. Inspect `pyproject.toml`, `scripts/run_tests.py`, and the saved Phase 1–6 logs. Confirm whether Git history exists (`.git/` is not included in this archive).
3. Create a clean environment and run the baseline suite. Record actual pass/fail/skip counts and any timeout/dependency issue; do not copy the reported count as if freshly verified.
4. Inspect `results/phase6/resource_model.json`, `results/phase6/measured_inputs_ieee14.json`, and `docs/RESOURCE_MODEL.md`; confirm the never-calibrated flag and parameter provenance.
5. Obtain the original V2 PDF and extract §18 experiment plan and §26 roadmap. Add it to `docs/reference/` only if licensed/available and update the manifest.
6. Produce an E0–E16 experiment status matrix from the V2 plan and actual code. Start Phase 7 only after that review.
7. Do not restart Phases 1–6 absent a reproducible defect. Do not build/rewrite a dashboard during the handoff step.

## I. Known blockers and risks

### Block specific experiments/features
- Official MATPOWER IEEE-30 and IEEE-118 files are absent.
- IEEE-14 is transcribed/unverified.
- Qiskit/Aer ideal/noise runs are reported NOT RUN; package availability/network may block them.
- Micro-oracle A2 is missing; resource model remains uncalibrated.
- V2's Bärtschi–Eidenbenz preparation has not been reproduced.
- `pytest`, `pandapower`, import-linter and Aer were unavailable in the earlier sandbox report; availability on the new laptop must be checked.
- V2 resource parameters at IEEE-118 remain placeholders according to Phase 6 report.

### Block full product integration
- No frontend/dashboard or backend/API source exists in this archive.
- No UI-to-backend integration or complete application launch is supported by this snapshot.
- The V2 PDF is absent from this ZIP and must be supplied separately to verify exact Phase 7–14 definitions.

### Risks
- Transcribed network data can produce misleading results if presented as official validated benchmark results.
- Model outputs depend strongly on assumptions, especially classical scaling exponent `α`, oracle cost, preparation costs and placeholder inputs.
- Tier B is ideal classical emulation, not a quantum runtime.
- Test reports from the prior environment are not the same as fresh reproducibility evidence.

## J. Reproducibility and handoff checklist

- [ ] Record Python version and OS.
- [ ] Install `.[dev]` in a clean virtual environment.
- [ ] Run `python -m pytest -q`; if unavailable, run the fallback test runner.
- [ ] Record actual tests passed/failed/skipped and command exit status.
- [ ] Run resource input/model scripts and compare regenerated JSON/figures to saved outputs.
- [ ] Confirm `resource_model.json` is labelled uncalibrated/estimated.
- [ ] Confirm IEEE-14 provenance warning remains visible.
- [ ] Confirm official IEEE-30/118 files are absent or verify newly supplied copies.
- [ ] Do not run or report Aer/hardware jobs without actual completion logs.
- [ ] Inspect V2 §18 and §26 before defining Phases 7–14.
- [ ] Keep every experiment status explicit: RUN, NOT RUN, BLOCKED, or NOT APPLICABLE.
- [ ] Confirm no frontend/backend is present before promising an integrated demo.
- [ ] Preserve UI/UX if frontend is added later.
- [ ] Update the phase report and manifest with evidence, commands, hashes and limitations.
