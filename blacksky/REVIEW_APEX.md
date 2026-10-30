# BLACKSKY APEX — review record

Directive and the review of OMEGA that motivated it: `APEX_DIRECTIVE.md`. Screenshots: `review/apex/rA/` (WebP; 1440×900,
1024×768, 390×844; Chromium with SwiftShader software WebGL). Every capture run asserted no page errors, no console errors (except
deliberate 404 probes) and no horizontal page scroll; all three sizes passed after the fixes below.

Not reviewed: GPU rendering, physical phones, screen readers.

## What APEX added (each from data BLACKSKY already computes)
| Feature | Data → encoding | Check |
|---|---|---|
| Arrival | worst stored set, re-simulated at load → headline S (count-up), one cell per demand point (brightness = served share per round) | e2e: headline = stored table S; cell count = demand points; shown once; deep links skip it |
| Trip fronts and darkening | engine events → burning line + pulses per tripped line; lamp/bus colours tween between frames | e2e: forward step starts fronts, jumps do not |
| Flow surge layer | (abs(flow now) − abs(flow, intact network)) / DC rating, two engine solutions | unit: formula on IEEE-118; zero for the intact network |
| Fault lines layer | frequency of each line in the 500 most damaging k-sets of the stored exhaustive table (log scale) | unit: equals a direct tally of the JSON for 4 tables; e2e: 3-D overlay = tally, 2-D draws it |
| Severity strip | stored histogram of S over all k-sets, current set marked, bars open stored sets | e2e: 44 bands, note on zero-loss share |
| Search landscape (Arena) | S for every pair (exhaustive run or a dedicated worker job); probes in evaluation order, replay on a log time axis | unit: pair indexing, values = engine, max = stored optimum (IEEE-30); e2e: 15 sampled cells = engine |
| Prediction landscape (ML) | simulated S below the diagonal, forest prediction or error above (test pairs only by default) | e2e: tab renders, PRED labelled, error mode |
| Grover geometry | simulated state projected onto the good/bad plane at every oracle and diffusion stage | unit: angle = analytical to < 1e-9, out-of-plane norm < 1e-9, n = 3–7 |
| Lineage graph | registry records by time and workspace; shared scenario ids; re-run arcs | e2e: one node per record, click opens it |
| Briefing | 10 steps driving the real UI; every number read live; steps whose computation has not run say so | e2e: walks all steps to the end |

## Pass A — hierarchy, identity, layout
| Finding | Fix |
|---|---|
| Phones and tablets ≤ 900 px: the Quantum Lab's Composer / Grover switch was hidden. The rule hiding the header question (`.ws-head .q`) also matched the switch (`.seg.q`); on desktop the same rule gave the switch line-clamp styling. **OMEGA bug.** | Scoped to `.ws-head > .q`. Grover is reachable on phones again. |
| Phones: stacked panes had equal fixed heights (grid rows stretched, pane bodies with `flex: 1; min-height: 0` contributed no height), so tall content (landscapes, long forms) overlapped the next pane. **OMEGA bug, made visible by APEX.** | At ≤ 900 px: `grid-auto-rows: max-content`, pane bodies `flex: none`. The workspace scrolls instead. |
| Briefing card covered what it was pointing at. | The card takes the screen position (bottom or top, centre or corners) that overlaps the highlighted element least. |
| Spotlight did not appear for fixed or SVG targets (`offsetParent` is null for both). | Visibility from the bounding box. |
| Grover geometry: the readout was SVG text beside the circle, tiny on phones and colliding with axis labels. | Circle in SVG, readout in HTML beside it (wraps below on narrow screens). |
| Fault lines hard to see at overview zoom. | Width grows to 5.5× the base radius for the most frequent lines. |
| Wordmark had no mark. | The lit-cell mark (four cells, one dark) beside the wordmark and on the arrival screen. |

## Pass B — scientific correctness and wording
- Every new value is checked against its source by a unit or e2e test (table above). New tests: `blacksky/test/apex.test.mjs` (6) and
  three e2e journeys (arrival; overlays/severity/propagation; landscapes/lineage/briefing).
- The fault-line map and the briefing say "synthetic ratings … a property of this model, not of a real grid".
- Flow surge is labelled as a difference of two engine flow solutions; the intact-network reference is computed in the browser.
- Grover geometry: the global phase is removed explicitly and the caption says so; the simulated angle and the analytical angle are shown
  side by side with the out-of-plane norm.
- Prediction landscape defaults to held-out pairs only; training pairs are in-sample and hidden unless asked for.
- Claims lint: two phrases in the directive that implied validation were rephrased.

## Pass C — performance (SwiftShader, 2 vCPU; no GPU measured)
| Measure | Result |
|---|---|
| Boot to ready, side by side with the OMEGA commit (3 runs each) | OMEGA 3.32 / 3.38 / 3.58 s; APEX 3.18 / 3.11 / 2.95 s (this run was slower than the 1.97 s recorded in REVIEW_OMEGA for both versions) |
| `setView` with an overlay | 2.7 ms |
| `gs.render()` JS time during trip fronts | 2.9 ms mean, 5.4 ms max (the frame cost on SwiftShader is the software rasteriser: ~4 drawn frames/s while fronts run) |
| Landscape replay step (17,205 cells + probes) | 3.3 ms |
| Arena run (25,605 simulations in the worker), opened directly on #arena | one main-thread long task, 91 ms, when the results render (a full re-render measures 90 ms; re-ordering the landscape 13 ms). A first measurement that followed the Theater and ML steps in the same page showed four 120–330 ms tasks; not reproduced in isolation and not profiled |
| Lineage tab open | 0.26 s |

Open: profile the 120–330 ms tasks seen once when the Arena ran after other workspaces in the same page; GPU frame rates are unmeasured.
