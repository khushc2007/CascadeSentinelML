# UI review — cycle 1 (2026-10-26)

Reviewed build: commit `f395606` (first workbench), inspected in headless Chromium 1243 (SwiftShader WebGL) at 1440×900 and 390×844 by
scripted interaction (`window.__gdf` handle) plus screenshots. Reviewed as if another engineer had built it.

## Findings
| # | sev | perspective | finding | evidence | fix (commit `1c3b337`) | verified by |
|---|---|---|---|---|---|---|
| 1 | critical | first-time user (phone) | At 390 px the header overflowed: Explorer and Inspector toggles were off-screen, so a phone user could not inspect or set up a scenario. | phone screenshot: header ends at the Run button | icon buttons for Explorer/Inspector, compact segmented control and network select, Run icon-only below 760 px | phone screenshot: all controls visible; e2e `test_phone_layout_and_reduced_motion` opens and closes the explorer drawer |
| 2 | high | power engineer | “Network splits into 28 islands” counted every isolated de-energised bus as an island. | R3 event text vs scene | events now report energised islands and de-energised buses separately (`events.js`) | `workbench.test.mjs` event tests; screenshot R2: “3 isl.” instead of 7 |
| 3 | high | graphics / judge | At the end of the worst cascade 97 trip labels covered the scene; overload labels overlapped each other. | end-state screenshot | labels only for the current event's equipment (≤ 12), plus greedy de-overlap; “labels: all” layer restores tags for every trip | overload screenshot: 7 readable labels, none overlapping |
| 4 | high | graphics / performance | On software WebGL the scene re-rendered continuously with shadows and flow chevrons; a second page could not start (e2e timeout). | e2e: second test stuck at `data-ready` | adaptive quality on the measured frame interval (pixel ratio → shadows off → flow at 15 fps); render loop paused while the viewport is hidden; ghost/cut instances compacted | e2e run time 117 s → 59 s, both tests pass; diagnostics drawer shows the active quality level |
| 5 | medium | creative director | Legend permanently ~350 px tall over the scene. | start screenshot | state rows always visible; equipment symbols in a collapsed group; text no longer wraps away from its swatch | screenshots after fix |
| 6 | medium | first-time user | Nothing on first load says what the red branches are or what to do. | start screenshot | dismissible intro card (3 steps + limitation), with a link into the guided presentation; hidden after the first run | screenshot `r2m_start`; card gone after Run |
| 7 | medium | power engineer | AC results (API) still said “of DC rating”. | API check: IEEE-14 AC run | loading basis follows the result mode in inspector, explorer and legend | API check script re-run |
| 8 | medium | first-time user | Header label class clashed with the scene-label class (`.lbl`), so “Run” lost its text and a stray label appeared top-left. | desktop screenshot after fix 1 | renamed to `.bl` | screenshot |
| 9 | low | power engineer | Tripped branch inspector showed flow “Unavailable” (the value is known: 0 MW, open). | inspector screenshot | open branches show “0 MW (open)” | screenshot |
| 10 | low | creative director | Scene under-lit; steel equipment close to the background. | first screenshot | exposure, hemisphere and key intensities raised; lighter steel and conductor tokens | screenshots |

## Scorecard (1–10, before → after this cycle)
| dimension | before | after | evidence / main reason it is not higher |
|---|---|---|---|
| Visual coherence | 6 | 7 | one palette and type system across workbench and research; research charts still carry the previous layout language |
| 3-D scene quality | 6 | 7 | instanced procedural equipment, shadows, voltage tiers; arcs make dense regions busy; no level-of-detail labels for buses |
| Navigation | 6 | 7 | orbit / recon / follow / schematic / focus / overview / event framing all exercised; no collision with equipment (bounds only) |
| Interaction quality | 6 | 7 | scene ↔ explorer ↔ inspector ↔ timeline share ids; multi-select via Shift-click; hover is still mouse-only (touch uses tap-select) |
| Information architecture | 5 | 7 | header, explorer, inspector, timeline, diagnostics; scenario panel long on small screens |
| Scientific correctness | 8 | 8 | engine parity 700 runs, events from frames only, API sources labelled, AC/DC basis labelled; DC/AC comparison needs two saved runs |
| Performance | 4 | 6 | measured only on SwiftShader (2 vCPU): IEEE-118 ~5 fps at reduced quality; real-GPU numbers not measured here |
| Accessibility | 5 | 6 | keyboard paths for explorer/timeline/run; states carry text and dashes, not colour alone; the 3-D canvas itself is not screen-reader navigable (explorer is the equivalent) |
| Robustness | 6 | 7 | request ids, cancellation, timeouts, 409 shown as failure; no WebGL → research still works |
| Demonstration quality | 6 | 7 | intro card + guided presentation driving the real engine |

## Converted into the next cycle
Compare DC vs AC on the same set (the API run showed IEEE-14 {0,5}: DC 0 %, AC 47.3 %); keyboard-only journey; bookmarks/isolate/layers
exercised in e2e; research charts in the new design language; measured performance after the instance compaction.
