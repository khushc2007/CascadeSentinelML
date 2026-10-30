# Project Status — Grid Doomsday Finder

**Team:** Cascade Sentinel · **Status date:** 2026-10-27 · **Phases 1–14 implemented** (numbering for 7–14 assigned in this session; see `docs/PHASES_7_14.md`).
All experiment numbers: **`results/phase7/REPORT.md`** (generated from manifests). Phase 1–6 history: `results/phase1..6`, unchanged.

## State
- **Data:** official MATPOWER 8.1 case14/30/118 (commit `1a828c7`), installed unmodified; provenance recorded in every manifest.
- **Tests (verified 2026-10-27, after the original-app work; re-run 2026-10-30 after BLACKSKY OMEGA: 275 passed, 0 failed, 2 skipped — 274 in the full run plus the claims-lint regression test re-run after a doc wording fix):** `python -m pytest -q` → 255 passed, 0 failed, 2 skipped (includes 3 workbench,
  4 scene/Bengaluru and 6 BLACKSKY browser journeys, BLACKSKY integration checks and the case-parameter check; both skips: qiskit is installed,
  so the NOT_RUN-path tests do not apply); `node --test app/test/*.test.mjs` → 29/29; `node --test blacksky/test/*.test.mjs` → 12/12;
  `python scripts/claims_lint.py` → 0 violations.
- **Experiment status:** 14 EXECUTED (E0, E1, E4–E12, E14–E16), 2 PARTIAL (E2, E3), 1 NOT_RUN (E13).
- **Experiments:** E0–E16 run through `scripts/run_experiments.py`; every result has `result.json` + `manifest.json` (config hash, dataset sha256, source sha,
  environment, evidence label). Status per experiment is in the report table.
- **Not run (stated, never substituted):** IEEE-118 exhaustive AC at k=3 (~21 core-h here) and DC at k=4 (~96 core-h); E3b at k=4 (needs the k=4
  table); E13 IBM hardware (no credentials). E11/E12 on IEEE-118 use k=2 (registered deviations).
- **Web demo + API:** `make serve` → http://127.0.0.1:8000 (offline, precomputed-first). `app/data` is built by `scripts/build_demo_data.py`.
  **3-D workbench (2026-10-26)**: Investigate (Three.js scene of the official topology; orbit/recon/follow/schematic; explorer, inspector,
  scenario, event timeline, DC vs AC, saved runs, findings export, guided presentation) + Research. See `docs/ARCHITECTURE.md`,
  `docs/FRONTEND_VALIDATION_REPORT.md`. Earlier: Phase 13b redesign (2026-10-24): live in-browser DC cascades (JS port, parity-tested on 520 cascades), live exhaustive pair scan, Grover hunt,
  crossover oracle, proof ledger, pitch mode. Previous interface kept as `app/classic.html`. Details: `docs/PHASES_7_14.md`.

- **Original app upgrade (2026-10-27):** view modes Spatial / Grid focus / Grid only / Schematic with a decorative context city that is
  kept clear of all equipment and never selectable; round-aware branch states with non-colour cues; switchyard detail at close range;
  Inspector values tagged case / model / derived / synthetic from new `app/data/params_*.json`; timeline scrubber, round selection and
  event-to-equipment chips; **Bengaluru Grid Explorer** (network menu → Geographic exploration): OpenStreetMap power features via the
  Overpass API from the browser, MapLibre GL map, provenance, search, filters, layers, file import. No real Bengaluru data could be loaded in
  this environment (no internet); tested with a synthetic fixture. See `docs/BENGALURU_EXPLORER.md`, `docs/ORIGINAL_REVIEWS_ABC.md`.
- **BLACKSKY COMMAND (2026-10-27):** a second, independent website in `blacksky/` (entry `blacksky/site/index.html`, routes `#theater`,
  `#autopsy`, `#arena`; own design system, deploy config `blacksky/site/vercel.json`, local server `blacksky/serve.py` with the unchanged API at
  `/api`). It reuses the parity-tested engine, event, encoding, scenario and camera modules through byte-for-byte copies
  (`scripts/build_blacksky.py --check`). Three formal reviews with fixes: `blacksky/REVIEW_1.md`..`REVIEW_3.md`. Deployment steps: `blacksky/README.md`.
  Not deployed to Vercel (no credentials in this environment); published as a separate private claude.ai artifact. The original `app/` and
  `doomsday/api` are unchanged (`git diff 1590c68 -- app doomsday` is empty).
- **BLACKSKY COMMAND · OMEGA (2026-10-29/30):** BLACKSKY rebuilt into five workspaces sharing one state (scenario ids, experiment
  registry, command palette): Cascade Theater, Quantum Lab (own statevector/density-matrix engine, cross-checked against Qiskit and Aer;
  Grover from elementary gates), Algorithm Arena (six search methods on one budget, seeded and repeated; exhaustive optimum = stored table),
  ML Risk Observatory (simulator-labelled data, disjoint-branch split, metrics cross-checked against scikit-learn; predictions labelled PRED),
  Evidence & Resource Lab (registry, recorded test report + 14 live checks, resource estimates, limitations). Heavy work runs in a Web Worker.
  Optional `/bsapi` (Qiskit transpile, bounded). Reviews: `blacksky/REVIEW_OMEGA.md`; build record: `blacksky/BLACKSKY_PROGRESS.md`;
  test report: `python scripts/blacksky_validate.py` → `blacksky/site/data/validation.json`. `git diff ba8d133 -- app doomsday` is empty.
  Not deployed (no credentials); no quantum hardware; GPU performance not measured.
- **BLACKSKY APEX (2026-10-30):** review of OMEGA and the next-level directive in `blacksky/APEX_DIRECTIVE.md`; built: arrival screen,
  trip fronts during replay, flow-surge and fault-line line colours, severity strip, k = 2 search landscape (Arena) and prediction landscape
  (ML), Grover geometry from the simulated state, lineage graph, 10-step briefing. Two OMEGA layout bugs fixed (Quantum mode switch hidden
  ≤ 900 px; stacked phone panes overlapping). Review: `blacksky/REVIEW_APEX.md`. Full suite 2026-10-30: `python -m pytest -q` → 278 passed,
  0 failed, 2 skipped; BLACKSKY node 35/35; `scripts/blacksky_validate.py` all suites passed.

## Findings that change the V2 narrative (details and numbers in the report)
1. **F3 met (E11):** the top-10 worst sets do not survive a change of synthetic rating family (and are unstable under ±10% rating perturbation).
   Per V2 18.1 the specific rankings are artefacts of the rating rule; they characterise the model, not the grids.
2. **F2 met (E3):** DC screening fails the pre-registered trustworthiness rule (recall ≥ 0.9 and top-10 overlap ≥ 0.5) on every evaluable table;
   on IEEE-118 the AC-only severe sets are driven by AC non-convergence handling. The DC–AC fidelity gap is a result, not an assumption.
3. **Fixed-point precision (E12):** b = 24 bits is the minimum passing width (V2 assumed 16); the resource model uses it.
4. **Micro-oracle calibration (E14):** κ ≫ 1 for multipliers/comparators with textbook synthesis — V2's oracle formulas undercount.
5. **Top-T (E9):** V2's literal exclusion-list scheme scales linearly in T; a threshold-list scheme gives the sub-linear behaviour V2 quoted.
6. **Noise (E5):** the toy Grover circuits verify ideally on Aer; with the FakeSherbrooke noise model no amplification survives.
7. **Search scaling (E6):** Tier B Dürr–Høyer discovery calls scale as N^0.49 with a constant far below the proven bound.
8. **Bärtschi–Eidenbenz Dicke (Phase 8):** reconstructed and verified; it supports V2's O(kL) preparation cost.

## Continuing
- Real ratings (utility data) are the single most important input for meaningful rankings (F3).
- An optimised classical cascade (vectorised / compiled) would change t_c and therefore the crossover (E1, E15).
- Larger AC verification (IEEE-118 k=3) needs a bigger machine: `make truth` on N cores with `WORKERS=N`.
