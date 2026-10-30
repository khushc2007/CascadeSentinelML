# BLACKSKY COMMAND — Review 2 of 3: functionality and credibility

**Scope.** Does every control work; do the three experiences stay synchronised; are failures visible; does every number say what it is
and nothing more; is it usable by keyboard, with reduced motion and on a phone; how fast is it? Evidence: automated journeys
(`tests/e2e/test_blacksky_e2e.py`, `tests/integration/test_blacksky.py`, `blacksky/test/logic.test.mjs`), the claims lint, measurements
(`bsperf.py`, scratch), and screenshots in `blacksky/review/r2/`.

## Checks run
| Area | How | Result |
|---|---|---|
| Theater stages and transport | e2e: stage rail → cursor, scene frame index and scrubber agree for every stage; back/forward/reset/scrub/speed/play/pause/replay; arrow keys | pass |
| Autopsy | e2e: entity search, trip history equals the engine's trip map, event → timeline sync, neighbours, event filter + search counts, islands, initial vs final, findings report | pass |
| Network switch | e2e: selection and run cleared; an id that only exists on the old network is not resolvable | pass |
| Arena | e2e: build by typing ids, invalid id rejected with a message, API engine refused when the API is absent, run, rank and score equal the data-file table and the defined formula, stored AC shown but unranked, save → reload → replay | pass |
| API | e2e: real FastAPI app through `blacksky/serve.py` (IEEE-14 {0,5} AC ≈ 47 % unserved; IEEE-118 non-stored set → HTTP 409 shown), intercepted HTTP 500 shown as "API 500: …" and "run failed" | pass |
| Reduced motion, phone | e2e at 390 × 844 with `reduced_motion=reduce`: no autoplay, camera moves instant, no horizontal scroll, sheets collapse and expand | pass |
| Claims | `scripts/claims_lint.py` extended to `blacksky/*.md`, `blacksky/site/*.html`, `blacksky/site/js/*.js` and all of `app/js/*/*.js`; new rules for "blackout probability", "probability of blackout", "real-time grid", "live grid data" | 0 violations (70 files) <!-- claims-lint: allow (quotes the banned list) --> |

## Problems found and fixed
| # | Problem (evidence) | Fix | Verified by |
|---|---|---|---|
| R2-1 | Stage text said "The DC power flow is re-solved" and "of its DC rating" for AC runs; the Theater footnote said "DC model" for AC runs (`r2/theater_stored_ac_assess.png` before fix). | Stage wording and the footnote follow the run's mode; ASSESS shows the AC interval S … S_total. | new unit test "stages on a stored AC run"; screenshot after fix |
| R2-2 | For stored/API results (no per-bus component labels) the ISLAND stage and the readout called connected-component counts "energised islands". | Those results now say "connected components (per-island energisation not recorded)"; readout label switches to "Components". | unit test; `r2/theater_stored_ac_assess.png` ("COMPONENTS 18") |
| R2-3 | The worst IEEE-118 triple was badged "most damaging set" although two sets share that exact S in the exhaustive table. | Tier reads "tied most damaging, 2 sets (exact)"; the Theater notes the tie. | unit test "tied rank 1"; `r2/arena_tied_score.png` |
| R2-4 | Accessibility: stage buttons carried `role="listitem"` (lost button semantics); helper text `#6c747d` on `#0d0f12` was 4.05 : 1. | Group with `aria-label="Stages"`, buttons keep their role and `aria-current="step"`; helper text `#808892` (5.35 : 1 on panels, 5.01 : 1 on inputs; computed with the WCAG formula). | DOM check; `r2/keyboard_focus.png` |
| R2-5 | On a software renderer the animated flow chevrons kept the main thread busy at ~300 ms per frame, so every control lagged. Also: no zoom on touch screens (no wheel, no pinch in the shared rig). | New adaptive level: when animated frames stay above 110 ms, the arrows freeze (still drawn, still showing direction) and the scene renders only on change; the quality level is shown in Help. Zoom buttons (+ / −) in the dock and +/− keys. | `bsperf.py`: quality "flow arrows static (slow renderer)"; e2e zoom check |

Also fixed: the IEEE-30 featured scenario now says where its AC comparison is ("Autopsy → Compare"); the Arena's comparison row "Final
islands" (connected components) is labelled "Final connected components".

## Performance (measured, not representative of GPU hardware)
Headless Chromium 153, **SwiftShader software WebGL, no GPU**, 2 vCPU Intel Xeon 2.8 GHz, 1440 × 900, adaptive quality active.

| Network | Page ready | Engine run (median of 7, k = 3) | Animated frame interval | Draw calls | Triangles |
|---|---|---|---|---|---|
| IEEE-118 | 2.9 s | 7.7 ms (5.4 ms in an earlier run) | 284 ms (≈ 3 fps) | 17 | 60 376 |
| IEEE-30 | 2.9 s | 0.7 ms | 184 ms (≈ 7 fps) | 16 | 13 596 |
| IEEE-14 | 2.7 s | 0.3 ms | 142 ms (≈ 9 fps) | 16 | 7 037 |

The only HTTP error in these sessions is the expected `404 /api/health` probe on a static server, which the page reports as "API offline".
No measurement was possible on a GPU in this environment; frame rates on real graphics hardware are not known from this work.
