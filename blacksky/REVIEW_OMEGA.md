# BLACKSKY COMMAND: OMEGA — review record (passes 1–4)

Screenshots: `blacksky/review/omega/` (WebP; Chromium with SwiftShader software WebGL, 2 vCPU container).
- `r1_before/` — first full capture of the five workspaces after Phases B–C (1440×900, 1024×768, 390×844).
- `r1_after/` — after the hierarchy / identity fixes of pass 1.
- `r4_final/` — final state after passes 2–4 (same journeys, same three sizes).

Every capture run also asserted "no page errors, no console errors (except deliberate 404 probes), no horizontal page scroll";
all three sizes passed in `r4_final` (`scrollWidth` 1440 / 1024 / 390).

No review was done on a GPU, on a physical phone, or with a screen reader; those remain unreviewed.

## Pass 1 — hierarchy and identity

| Finding | Fix |
|---|---|
| Top bar crowded at 1024–1280 px: scenario, engine and API chips collided with the network selector. | Responsive hiding: API and scenario chips go below 1280 px, the engine chip below 1100 px (status still in the Inspector and the command palette). |
| Workspace titles were plain sans; the Theater panel header did not match the other workspace heads. | One serif title treatment (`h1` + `.panel > header h2.serif`) for all five workspaces. |
| Workspace questions (`.ws-head .q`) ran to 3–4 lines at 1024 px and pushed content down. | Clamp to two lines, flexible width. |
| Left-pane tab rows (Evidence: Registry / Validation / Resources / Limits / Classes) overflowed at narrow widths. | Tabs wrap. |
| Phone: both Theater sheets could be open at once and overlapped. | One sheet at a time (`body[data-sheet]`). |
| Phone readout hid "demand served", the headline number. | Hide the third cell instead. |
| Arena header sentence was long and passive. | Rewritten as "One problem for every method — candidate / objective / budget". |

## Pass 2 — visualization fidelity and interaction

| Finding | Fix |
|---|---|
| 2-D view fitted the network to the whole canvas, so the floating panels covered part of it. | Fit to the free area between the panels (`insets()` in `view2d.js`); stroke widths scaled per screen pixel. |
| 3-D HTML labels stayed on screen over the 2-D view. | Hidden in 2-D; the 2-D view draws its own initial-outage (T0) and trip (R n) tags, de-overlapped. |
| Clicking a branch in 2-D did nothing after drag support was added (pointer capture retargeted the click). | Entity key read at `pointerdown`. |
| Line-chart reference lines (optimum, 1 day, 1 year) collided with the series' end labels in the right gutter. | Reference lines labelled inside the plot at the left; end labels de-overlapped 12 px apart with leader lines. |
| Arena strip-plot axis used arbitrary quarter ticks (e.g. 20.9 %). | `niceTicks`. |
| Evidence drawer covered the "Run checks" button at 1024 px and opened by itself when a record was selected. | Explicit "Actions" button; drawer closes on tab switch; no automatic opening. |
| Several scroll panes collapsed a child to zero height (flex item with `overflow:hidden`). | `flex-shrink: 0` on scroll-pane children. |
| Resource chart axis printed `10^10`. (pass 4) | Superscript powers (10¹⁰), axis titled "seconds (log scale)". |

## Pass 3 — scientific correctness and wording

Checks run (browser, scripted):
- Cross-workspace consistency: 40 Arena top candidates (IEEE-118, k = 2) re-run in the Theater engine and looked up in the ML
  labels — 40 / 40 identical S values. The in-browser exhaustive optimum equals the stored Python exhaustive table on IEEE-14,
  IEEE-30 and IEEE-118 (k = 2).
- Resource lab reproduces the project's headline figure (538,008 logical qubits, realistic scenario, IEEE-118, k = 3).
- 14 / 14 live checks in the Evidence Lab pass (≈ 144 ms).

| Finding | Fix |
|---|---|
| Evidence: "Classical time" was tagged MEAS when a per-evaluation time had been measured — but N × t_eval / P for 10⁶ sets is an extrapolation, not a measurement. | Tagged EST (analytical), with the formula in the label and the source of t_eval in the chip's tooltip. |
| Theater Inspector: every row carried the same SIM chip; "Base demand" (a benchmark input) looked like a result. | One chip for the section; a row carries its own chip only when its class differs (wall-clock = MEAS); base demand tagged "input". |
| Arena planning line said "at this machine's typical speed", implying a measurement. | "roughly X at ~0.8 ms per evaluation (a rough planning figure; the measured time is recorded after the run)", with per-network figures. |
| Quantum toy-grid button said "real grid candidate sets". | "outage sets of the current Theater network and k (lookup oracle built from simulator runs)". |
| Claims lint flagged two wordings that implied validation. | Rephrased; lint now also covers `blacksky/site/js/*/*.js`. |

## Pass 4 — performance, responsiveness, polish

Measured in this container (Chromium + SwiftShader, 2 vCPU; no GPU measurement exists):

| Measure | Result |
|---|---|
| Cold load to ready (IEEE-118 scene, first run computed) | 1.97 s; 53 requests; 0.92 MB JS + 0.92 MB data (uncompressed, local server) |
| Lazy loading | At boot only the Theater modules load; `ws/quantum.js`, `arena.js`, `ml.js`, `evidence.js` load on first visit |
| Workspace switch (script click → first frame), first visit incl. module load | Quantum 67 ms · Arena 33 ms · ML 26 ms · Evidence 29 ms · back to Theater 17 ms |
| Theater idle | ~5 drawn frames/s (only while flow arrows animate); 0 frames/s while another workspace is open |
| Frame time in Theater with software WebGL | ~100 ms per animation frame (SwiftShader; GPU not measured) |
| ML training, IEEE-118 all 17,205 pairs (worker) | 11.9 s wall; main thread: 1 long task, 70 ms |
| JS heap after ML training | 16 MB |

Note: Playwright's own `click()` reported 1.5 s for the first Quantum switch; that is its actionability wait over
~100 ms software-WebGL frames, not the switch itself (the module import started only after that wait).

| Finding | Fix |
|---|---|
| Checked: does the 3-D scene keep drawing while another workspace is open? | No — the loop pauses outside the Theater and in the 2-D view (measured 0 draws/s). No change needed. |
| Full-screen toggle left the 2-D view at the old fit. | Re-fit on toggle. |
| Remaining polish items seen in `r4_final`, not changed: Resources stat grid leaves empty cells on its second row; at 390 px the dock's camera controls scroll horizontally inside the dock. | Recorded here. |
