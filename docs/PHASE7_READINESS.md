# Phase 7 readiness — baseline verification and E0–E16 matrix

**Date:** 2026-10-23 · **Session:** fresh continuation of the handoff `Grid_Doomsday_Finder_COMPLETE_HANDOFF.zip`
**Scope of this milestone:** verify the Phase 1–6 baseline, read V2, map E0–E16 to code/data. **No application logic was changed and no Phase 7 experiment was run.**

---

## 1. Baseline verification (reproduced, not copied)

| item | result | evidence |
|---|---|---|
| Archive integrity | all 214 listed files match `HANDOFF_CHECKSUMS.txt` (SHA-256); 215 files present | `sha256sum -c` exit 0 |
| Environment | Linux x86_64, 2 vCPU, Python 3.13.17, numpy 2.5.4, scipy 1.18.1, networkx 3.7, PyYAML 6.0.3, pytest 9.1.1, scikit-learn 1.9.1, matplotlib 3.11.2, ruff 0.17.2, import-linter 2.15 | clean venv, `pip install -e ".[dev,analysis]"` |
| **Full test suite** | **190 passed, 0 failed, 2 skipped** (192 collected), exit 0, 193 s | `python -m pytest -q -rs` → `results/phase7_readiness/baseline_pytest_log.txt` |
| Skips | `test_ieee30_load_base_point_and_oracle_smoke`, `test_ieee118_load_base_point_and_oracle_smoke` (official case files absent) | same log |
| Agreement with prior report | matches the reported Phase 6 count (190/0/2). The prior log ran the fallback runner in two halves (115 + 75); this run is one pytest invocation | `results/phase6_test_log.txt` |
| Phase 6 regeneration | `phase6_measured_inputs.py` → `measured_inputs_ieee14.json` **byte-identical**; `phase6_resource_model.py` → `resource_model.json` identical in every value except the `software` version strings; PNG figures differ at byte level (renderer/version), not checked visually | fresh copy, both scripts exit 0 |
| Resource model label | `[ESTIMATED] resource/crossover model; calibrated=False; no quantum advantage claimed` — **still NOT CALIBRATED** | `results/phase6/resource_model.json` |
| Git history | none (no `.git/` in the snapshot) | — |

---

## 2. What V2 actually says about phases (important correction)

The supplied PDF (`docs/reference/Grid_Doomsday_Finder_Solution_Design_V2_1.pdf`, sha256 `930fd786…8ec3`; its title page says "Version 2.0") **does not number Phases 1–14.** Its §26 roadmap is date-based:

| V2 §26 stage | dates | deliverables | done when |
|---|---|---|---|
| Round 1 | through 7 Oct | IEEE-14 twin + DC cascade; k=2,3 table; Tier B + Dürr–Høyer; Tier A1 toy on Aer; cost model + crossover figure; minimal animation; deck; video; README | four submission items uploaded |
| Round 2 sprint (a) | 10–17 Oct | IEEE-30/118 DC tables; ratings calibration; **E0–E3**; baselines (**E7**) | E2, E3 tables filled from runs |
| Round 2 sprint (b) | 18–25 Oct | **E4–E6, E10–E12, E14, E15**; A2 micro-oracle; noisy simulation; full web app | all experiments rerun from the Makefile |
| Freeze and rehearse | 26–29 Oct | final deck, video, README; claims lint passed; offline demo build; Q&A bank | dry run < 7 min, no network |
| Final / demo | 30–31 Oct | in-person demo, pitch, jury Q&A | — |

So the "Phase 1–14" numbering is the implementation team's own. "Phase 7 = E0–E16 pipeline" and "Phase 9 = JavaScript port" come from earlier phase reports, not from V2. **Titles for Phases 8 and 10–14 cannot be recovered from V2 either**; they must come from whoever defined that numbering. The V2 items not yet covered by Phases 1–6 are: the E0–E16 runs, the A2 micro-oracle, QAOA (§14), the FastAPI layer (§20.3), the D3 web demo (§21), the claims lint (R4) and the Makefile `truth`/`figs` targets.

**Schedule:** today is inside Round 2 sprint (b) (ends 25 Oct). The freeze starts 26 Oct.

---

## 3. Defects and findings from this verification

| # | finding | severity | status |
|---|---|---|---|
| D1 | `doomsday/gridtwin/loader.py::load_grid` only maps `ieee14 → case14.m`; for other names it looks for `ieee30.m`/`ieee118.m`. But `verify_case_files.py --install`, the README and `experiments/framework.py::GRID_FILES` all use `case30.m`/`case118.m`. **After installing the official files, `load_grid("ieee30"/"ieee118")` raises `FileNotFoundError`.** | blocks every IEEE-30/118 experiment | **not fixed in this repo** (logic change needs your approval). In a throwaway copy, adding `"ieee30": "case30.m", "ieee118": "case118.m"` to `_BUILTIN` made both smoke tests pass. |
| D2 | `tests/integration/test_case_files.py::test_provenance_of_bundled_case14_is_reported_as_unverified` asserts that case30/118 provenance is `ABSENT`, so it fails as soon as the official data is installed | test brittleness | not fixed; the test needs updating together with D1 |
| D3 | `doomsday/experiments/framework.py` and `common.py` are Phase 7 work in progress (status/provenance/manifest harness, `results/phase7/` root). `common.protocol_parts` imports `doomsday.experiments.specs`, **which is missing from the archive**. No test covers either module, and no E-script uses them | the Phase 7 WIP is incomplete | recorded only. `framework.py` imports cleanly; `specs.py` must be written or recovered |
| D4 | The docs say `results/phase7/` "exists but is empty". It does not exist in the archive (ZIP files don't store empty folders) | cosmetic | recorded |
| F1 | **Official MATPOWER is reachable from this environment** (GitHub). Cloned tag `8.1`, commit `1a828c7af590714499284e36ee9c81273388c594` | unblocks IEEE-30/118 data | **not installed into this repo** (needs approval; see §5) |
| F2 | The bundled `case14.m` was compared with official MATPOWER 8.1 `case14.m`. **Every shared bus/gen/branch/baseMVA cell is equal (exact float equality).** It differs only by omitted optional columns: gen columns 11–21 (all zero upstream) and branch ANGMIN/ANGMAX (−360/360 upstream, i.e. unconstrained). Status stays **UNVERIFIED** under the project's rule (only an `--install`ed byte copy counts as verified) | strong evidence that case14 is correct | report: `results/phase7_readiness/case_file_verification_matpower8.1.json` |
| F3 | `qiskit 2.6.1`, `qiskit-aer 0.18.0`, `qiskit-ibm-runtime 0.51.0`, `pandapower 3.5.6` are installable here (`pip index versions`). **None was installed and no Aer job ran** | can unblock E4 (Aer part), E5 and the pandapower part of E0 | Aer status stays NOT RUN |
| F4 | Informal timing on official data (throwaway copy with the D1 fix, n_1-covering ratings, single core, scalar `severity`, k=3): IEEE-30 L=41 DC 3.3 ms, AC 15.7 ms per set; IEEE-118 L=186 DC 7.2 ms, AC 72 ms per set; base point 3.7 s. **Not E1** (300 DC / 30 AC random sets only) | sizes compute budgets | see §4 footnote |

---

## 4. E0–E16 matrix

Status vocabulary (same as `framework.py`): **EXECUTED · PARTIAL · NOT_RUN · NOT_IMPLEMENTED**, plus **BLOCKED** where an external input is missing. "Can run now" means it can run on the *current* repo without new data or packages. Every IEEE-14 output is **EXPLORATORY — UNVERIFIED DATA** until official case14 is installed. Output path for every row: `results/phase7/<ID>/result.json` + `manifest.json` (the framework convention; manifest carries the config hash, dataset sha256, code sha, environment and evidence label).

| ID | Name · Pri | V2 protocol (§18 / §10.1 / §17) | What exists in code | Data / dependency needs | Current status | Can run now | Acceptance test (from V2 + §19) |
|---|---|---|---|---|---|---|---|
| **E0** | Simulator validation · M | toy 3/4/5-bus; pandapower base + N-1; hand-solved cascades; flow error, conservation residual, sequence match | hand-solved/analytic checks: DC (`tests/unit/test_dc.py`), U2 two-bus analytic AC (`test_ac.py`), U9/U11 cascades (`test_cascade_known.py`); no pandapower comparison exists; toy grids in `experiments/common.py` (2–4 bus) | `pandapower` (installable, F3) for U2/U7 base and N-1 comparison; a 5-bus toy | NOT_RUN (unit tests pass, but no E0 script/manifest) | **hand-solved part: yes**; pandapower part needs install | all flows match to 1e-8 (DC) / 1e-6 p.u. (AC vs pandapower); conservation residual ≈ 0; cascade sequences identical. **Failure voids every later result** |
| **E1** | Runtime profile · M | 1000 random + 1000 high-severity sets, DC & AC, IEEE-14/30/118; mean, p95, split by class | oracles + `CountedEvaluator`; informal t_c in `phase6_measured_inputs.py` | IEEE-30/118 official files **+ D1 fix** | NOT_RUN | IEEE-14 only (exploratory) | per-grid/fidelity mean & p95 by class written; replaces the t_c placeholder in the resource params with provenance `measured (E1)`. Targets DC ≲ 0.5 ms / AC ≲ 30 ms are hypotheses (F4 suggests DC is ~7–15× slower in this Python) |
| **E2** | Cascade phenomenology · M | full DC tables IEEE-14/30/118 k ≤ 4; S distribution, #high-severity, rounds/trips p50/p95/max, C(x), non-monotonicity fraction | `generate_truth_table.py`; IEEE-14 DC k1–4 tables already in `results/tables/`; Phase 2 diagnostics | IEEE-30/118 files + D1; **IEEE-118 k=4 ≈ 96 core-h DC** (F4) | PARTIAL-ready | IEEE-14 k ≤ 4: yes | tables complete (N rows = C(L,k)); metrics reported per (grid,k); measured R and k_eff feed the resource params. "Most severity is S0" → reported as the trivial-problem finding |
| **E3** | DC–AC agreement · M | E3a exhaustive AC+DC (14 k≤4, 30 k≤3, 118 k≤3); E3b 118 k=4 stratified AC sample; E3c decomposition (common vs per-engine ratings; AC ladder disabled) | IEEE-14 AC tables k2–4 present; `ranking_metrics.py` (tie-aware top-T, Spearman); `cascade.run(..., ladder="total_loss")` | IEEE-30/118 + D1; **IEEE-118 AC k=3 ≈ 21 core-h** (F4); E3c (ii) per-engine ratings: support not confirmed | NOT_RUN | E3a IEEE-14: yes | pre-registered rule **fixed before inspecting data**: "trustworthy" only if recall@τ ≥ 0.9 **and** top-10 overlap ≥ 0.5; else report "DC is a poor proxy here". Feeds F2 |
| **E4** | Oracle & circuit equivalence · M | Dicke fidelity L ≤ 10; reflection; phase-oracle diagonal; Aer vs Tier B; micro-oracle exhaustive check | NumPy statevector Dicke (multiplexed-RY tree, **not** Bärtschi–Eidenbenz), reflection, phase oracle, Tier B, all tested (Q1–Q5) | `qiskit`+`qiskit-aer` for the Aer leg (F3); **A2 micro-oracle not implemented** | NOT_RUN | NumPy legs: yes. Aer: after install. Micro-oracle: no | Dicke F ≥ 1−1e-10, support only on weight k; Aer P(marked) = Tier B to 1e-9 (ideal); micro-oracle leg stays **NOT_IMPLEMENTED** → E4 can be at most PARTIAL |
| **E5** | Grover dynamics, ideal & noisy · S (ideal M) | toy N = 15–56; r sweep on Aer ideal + noise model; P(marked) vs sin²; depth; 2-qubit gates; optimal r under noise | `scripts/aer_toy_grover.py`, `aer_noise_toy_grover.py`, `qsearch/aer_runner.py` (compare to NumPy per r; `EXECUTED_VERIFIED` only within 4σ) | `qiskit`, `qiskit-aer`, `qiskit-ibm-runtime` (FakeSherbrooke) — installable (F3); exporter conventions are **unverified against real Qiskit** | NOT_RUN (saved JSONs say NOT_RUN) | no (packages absent) | ideal matches sin²((2r+1)θ) within 4σ for every r (N=15, 56); noisy run reports peak and r* shift; failure to amplify = noise-limited finding. Status `[SIMULATED]` only with real Aer logs |
| **E6** | GAS / Dürr–Høyer scaling · M | Tier B on E2 tables, 200 seeds, y0 = 0 **and heuristic y0**; mean/p95 calls, success, log-log slope, fitted c with CI, discovery vs certified-stop | `dh_gas.py`, `bbht.py`, `emulation.py`; Phase 5 diagnostic did IEEE-14 k=2–4, y0=0, 200 seeds (slope 0.46, 3 points) | **heuristic-y0 run not implemented** (QUANTUM_TIERS deviation 4); IEEE-30/118 tables via E2 | NOT_RUN | IEEE-14, y0 = 0: yes | slope ≈ 0.5 and c < 22.5 (hypotheses), with CI; c_q measured feeds the resource params; label `[EMULATED]`, never "quantum run" |
| **E7** | Classical comparison · M | all §15 baselines; unique evals to S_max, success@budget, wall-clock, top-10 overlap, fitted α; tuned on held-out grid/k | all 10 methods (brute, random, hillclimb, beam, SA, GA, LODF pool, ML screen, MILP, heuristic BnB) + `benchmark.py`; Phase 4 diagnostic on IEEE-14 DC (untuned) | held-out tuning needs a second grid (IEEE-30 would do); ≥ 50 seeds; IEEE-30/118 tables | NOT_RUN (Phase 4 = diagnostic, explicitly "not E7") | IEEE-14, untuned: yes | protocol §15.2 followed; α fitted per baseline; **H-C1 reported unsoftened** whichever way it falls. Feeds F1 |
| **E8** | Threshold regime map · S | f_τ over a τ sweep: M/N vs BBHT calls vs random-sample calls | `bbht.py`, `predicate.py`, `random_search`, `counting.marked_count` | none beyond E2 tables | NOT_RUN (no script) | IEEE-14: yes | curve of BBHT vs random cost against M/N; expected: random wins at large M/N |
| **E9** | Top-T cost · N | T ∈ {1,5,10,50}: calls vs 2√(NT) | **top-T with exclusion list not implemented** | implementation | NOT_IMPLEMENTED | no | calls track ≈ 2√(NT) |
| **E10** | QAOA (a, b, c) · S | planted-quadratic; k=2 exact surrogate; k=3 gap; five mandatory metrics (§14.3) | **no `qaoa.py` / `surrogate.py`** | implementation (statevector QAOA feasible at L=20) | NOT_IMPLEMENTED | no | (a) recovers planted optimum; (b)/(c) surrogate R², tail R², approximation ratio, top-1/top-1% overlap reported |
| **E11** | Rating/trip/ladder robustness · M | §17 grid: h 0.10–0.50, λ 1.0–1.3, τ_trip {1.0…1.25}, rating families {proportional, nominal-MVA by voltage class, case-file, ±10% × 50}, trip policy, ladder, redispatch, max rounds, AC tol | config supports h, λ, trip factor, trip policy, redispatch, ladder step, max rounds; rating families: **only `proportional` and `n1_covering`** (`config.py` rejects others) | 2 of V2's 4 rating families not implemented; **case-file ratings exist only for IEEE-30** (official MATPOWER 8.1 RATE_A is 0 on all 20 case14 and all 186 case118 branches; 41/41 non-zero on case30) | NOT_RUN | factor sweeps on IEEE-14: yes; family comparison: partial | Jaccard/Spearman top-10/100, #high-severity, cascade-driven fraction per factor. Feeds F3 (top-10 Jaccard across families < 0.3 → artefact) |
| **E12** | Fixed-point & truncation · S | §17.1: Q-format DC cascade, b ∈ {12,16,20,24,32}, truncate to R rounds; flow/severity error, label agreement, top-10/100, ρ, borderline fraction, cond(I−Φ_KK), Toffolis | **no fixed-point emulation** (U12 absent); `resource/params.py` b = 16 placeholder | implementation | NOT_IMPLEMENTED | no | smallest b preserving labels + top-10 → replaces b in resource params |
| **E13** | Hardware · N [OPTIONAL] | A1 toy on an IBM device | none | IBM Quantum account/token + `qiskit-ibm-runtime` | NOT_RUN (OPTIONAL) | no | whatever happens is reported; **never claimed without job IDs/logs** |
| **E14** | Micro-oracle synthesis & calibration · S (high value) | A2: measured Toffoli/qubit counts vs formulas; κ_cal | `resource/calibration.py` returns UNAVAILABLE by design | **A2 micro-oracle not implemented** | NOT_IMPLEMENTED | no | κ_cal within ≈ 0.5–2; until then the resource model stays NOT CALIBRATED |
| **E15** | Resource & crossover sensitivity · M | scenarios × (t_T, k_eff, R, b, P, α); tornado; 2-D heat maps | Phase 6 model, tornado, heat map, both prep scenarios (`v2_assumed` vs `tree_counted`, kept separate) | measured inputs from E1/E2/E6/E7/E12 (IEEE-118) to replace placeholders | Phase 6 outputs exist (pre-Phase-7) | yes, but only re-labels placeholders | regenerated from measured JSON with provenance per parameter; `calibrated=False` unless E14 runs; both prep scenarios reported separately |
| **E16** | Falsification summary · M | apply F1 (E7), F2 (E3), F3 (E11) | `framework.py` aggregation helpers (untested) | E3, E7, E11 results | NOT_RUN | no (depends) | each criterion marked MET / NOT MET / NOT EVALUABLE with its source experiment; data status carried through |

**Compute footnote (F4 timings, single core, scalar path):** IEEE-30 DC k≤4 ≈ 0.1 core-h, AC k≤3 ≈ 0.05 core-h — easy. IEEE-118 DC k=3 ≈ 2.1 core-h (feasible); **AC k=3 ≈ 21 core-h, DC k=4 ≈ 96 core-h** — not feasible on this 2-core machine before 25 Oct unless the batched path is much faster. Options: run them on a bigger machine, or record them as NOT_RUN (compute) with the reason.

### Summary by readiness
* **Runnable now on IEEE-14 (exploratory):** E0 (hand-solved part), E1, E2, E3a, E4 (NumPy legs), E6 (y0=0), E7 (untuned), E8, E11 (factor sweeps), E15.
* **Unblocked by approvals in §5:** IEEE-30/118 legs of E1/E2/E3/E6/E7 (official data + D1 fix); E5 and E4-Aer (qiskit); E0-pandapower.
* **Need new implementation:** E9 top-T, E10 QAOA, E12 fixed-point, E14 A2 micro-oracle, E6 heuristic y0, E11 extra rating families, `experiments/specs.py`.
* **Optional / external:** E13 (IBM account).

---

## 5. Decisions needed before Phase 7 runs

1. **Install official MATPOWER 8.1 case14/30/118** with `verify_case_files.py --install` (changes `doomsday/gridtwin/data/` and `MANIFEST.json`). Consequence: case14 becomes `official_matpower`, so IEEE-14 results stop being "unverified". Existing `results/tables/` were built from the transcribed file; their namespace may change and they would be regenerated, not reused.
2. **Apply the D1 one-line loader fix and update the D2 test.** This is a logic change, so it needs your explicit approval.
3. **Install `qiskit`, `qiskit-aer`, `qiskit-ibm-runtime`, `pandapower`** to run E0-pandapower, E4-Aer and E5 for real.
4. **IEEE-118 heavy tables** (AC k=3, DC k=4): bigger machine, or NOT_RUN (compute).
5. **What to build before freeze (26 Oct)** from the NOT_IMPLEMENTED list. V2 sprint (b) names E10, E12, E14 and the A2 micro-oracle; at most one or two of these are realistic.
6. **Phase 8 / 10–14 definitions:** V2 has no such phases. Who owns that numbering, and does it include the API/web app (§20.3, §21)?
