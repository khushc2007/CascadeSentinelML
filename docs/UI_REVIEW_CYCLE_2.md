# UI review — cycle 2 (2026-10-26)

Reviewed build: commit `1c3b337` (after cycle-1 fixes) with the FastAPI server running (`uvicorn doomsday.api.app:app`) and without it
(static hosting). Evidence: scripted browser sessions (`api_check.py`, e2e suite), screenshots of every workspace, source greps.

## Findings
| # | sev | perspective | finding | evidence | fix | verified by |
|---|---|---|---|---|---|---|
| 1 | high | power engineer / judge | The DC-vs-AC disagreement (the project's F2 finding) could not be seen in the product; AC existed only through the API, which the hosted page does not have. | API session: IEEE-14 {0,5} DC 0 % vs AC 47.3 %; hosted page has no API | new engine **Precomputed · AC** reads the stored Python AC runs from the data files (worst ten per table + examples, IEEE-14/30, IEEE-118 k=2 examples); **Compare DC vs AC** runs both and opens the comparison | e2e `test_compare_layers_views_keyboard`: DC S = table maximum, AC S = stored run (1e-12), comparison shows both |
| 2 | high | power engineer | An AC result would have been ranked against the exhaustive **DC** table — a misleading number. | code review of `wb.run` | AC results are never ranked (“not ranked” in comparison and header) | same e2e test asserts `rank is None` for AC |
| 3 | medium | power engineer | Islands tab for an AC/API result: the engine returns no per-bus component labels. | Islands tab after AC run | explicit “component membership unavailable … counts only” message instead of an inferred grouping; timeline says “comp.” not “isl.” for such results | e2e asserts the message |
| 4 | medium | accessibility | Layers / Views menus could not be closed from the keyboard. | keyboard session | `Esc` closes menus and resets `aria-expanded` | e2e (`Esc` then assert hidden) |
| 5 | medium | creative director | Research charts kept glow filters (`url(#glow)`, `drop-shadow`) from the previous design. | `grep` in `app/js/research` | removed; Grover bloom radius reduced to what the probability supports | grep count 0; screenshots |
| 6 | medium | creative / graphics | Buses on raised voltage tiers floated without a ground reference; generators were plain cylinders. | low-angle screenshot | lathe-turned generator housing, bus plinths, thin masts for raised tiers | screenshot `a4_low` |
| 7 | low | power engineer | Legend said flows were “not provided by the API” for stored runs. | legend after precomputed AC | “not recorded for this result” | screenshot |
| 8 | low | graphics | Comparison table engine column wrapped into 6 lines. | `c2_dcac` screenshot | short engine labels in the table | screenshot |

## Verified in this cycle (no change needed)
- API path, browser → FastAPI: precomputed source labelled “retrieved from the API (precomputed run)”; live runs labelled “computed by the API
  (live Python run)”; IEEE-118 live request → `409` shown as **Run failed**, no substitute result; API DC on the worst IEEE-118 set reproduces the
  browser engine exactly (S = 0.22804423299472798 both).
- Follow mode keeps the selection centred while orbiting; Event framing moves the camera to each event's equipment; A/B switching keeps the
  camera pose (coordinated comparison view).

## Scorecard (after cycle 2)
| dimension | score | evidence / main reason it is not higher |
|---|---|---|
| Visual coherence | 8 | one palette, type scale and panel language across Investigate and Research; Research still uses the earlier chart layouts |
| 3-D scene quality | 7 | procedural assets with distinct silhouettes, plinths/masts, shadows, tone mapping; arcs crowd dense regions of IEEE-118; no LOD for labels |
| Navigation | 7 | six camera behaviours + bookmarks + bounds; no collision with equipment (bounding box and minimum height only) |
| Interaction quality | 8 | ids shared across scene, explorer, inspector, timeline; multi-select, isolate, compare, export; touch has tap-select but no hover |
| Information architecture | 7 | compact header, collapsible panes, diagnostics drawer; scenario panel is long on phones |
| Scientific correctness | 9 | 700-run engine parity; events derived only from frames; AC/DC basis and sources labelled; AC never ranked against DC tables |
| Performance | 6 | instancing, ~16 draw calls, adaptive quality; measured only on software WebGL (no GPU here) |
| Accessibility | 6 | keyboard journey covered by e2e; colour never the only cue; 3-D canvas not screen-reader navigable (explorer is the text equivalent) |
| Robustness | 8 | request ids, cancel, 30 s timeout, error states, no-WebGL fallback for Research; saved runs are session-only |
| Demonstration quality | 8 | intro card, guided presentation, DC-vs-AC in one click; depends on the audience reading the S definition |

## Carried forward
Hosted-page font loading and CDN import must be checked on the published page (sandbox cannot reach either); real-GPU frame rate;
scenario persistence across sessions; dense-region decluttering for IEEE-118 (route bundling or a “selected neighbourhood only” mode).
