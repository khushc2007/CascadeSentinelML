# Original application — benchmark scene, Inspector, timeline and Bengaluru explorer: reviews A, B, C

Target: the original Grid Doomsday Finder (`app/`). BLACKSKY COMMAND (`blacksky/`) was not modified; its shared copies of
`app/js/core/*` and `app/js/three/{layout,camera,loader}.js` remain byte-identical (`scripts/build_blacksky.py --check`), because none of
those eight shared files was changed — the new behaviour lives in new modules (`three/branchviz.js`, `three/context.js`, `geo/*`) and in
files BLACKSKY does not copy.

## Baseline (before any change, HEAD `1600a20`)
`node --test app/test/*.test.mjs` 20/20; `pytest tests/e2e/test_workbench_e2e.py` 3/3; full `pytest -q` 250 passed / 2 skipped (run at
the end of the previous session at the same code); claims lint 0; working tree clean.

## What was built
- Scene: decorative context city (deterministic, kept clear of every bus, generator, demand column and branch route; never pickable),
  view modes **Spatial / Grid focus / Grid only / Schematic** plus the existing Overview and Focus (inspection), round-aware branch
  encoding with non-colour cues (initial outage: bold dashes + cut markers + T0; tripped at this step: dashes + × marker + R n label;
  tripped earlier: fine dashes; overload: 2.2× width; warning: 1.5×; loading not recorded: neutral grey), switchyard detail (busbar +
  post insulators) at close range.
- Inspector: MATPOWER source values from new `app/data/params_*.json` (`scripts/build_case_params.py`, verified against the case files
  and the existing data) with an origin tag on every value (case / model / derived / synthetic); missing values say "Unavailable".
- Timeline: scrubber, clickable round headers, event → equipment chips (select + focus; the Inspector follows).
- Bengaluru Grid Explorer: see `docs/BENGALURU_EXPLORER.md`.

## Review A — engineering and data correctness (skeptical power-systems engineer)
| Finding | Evidence | Fix / result |
|---|---|---|
| IEEE-14 states `baseKV = 0` for every bus; the new Inspector printed "0 kV" as a voltage class. | `params_ieee14.json`: baseKV set {0.0} | 0 is treated as "not given"; Inspector shows Unavailable. Regression check in `tests/e2e/test_original_scene_geo_e2e.py`. |
| "Transformer" was tagged as a case value, but it is a heuristic: IEEE-30 transformers have tap = 0 and are flagged by r = b = 0 (7 of 7); IEEE-14: 3 by tap, 2 by r = b = 0; IEEE-118: 11 by tap. | script comparing `grid_*.json` flags with case taps | Type is now tagged *derived* and says how it was inferred. |
| IEEE-30 transformers have the same base kV (135) at both ends in the case file. | `params_ieee30.json` | Shown as "135 kV at both ends (as given in the case file)" rather than implying a voltage step. |
| OSM `power=line` was labelled "Transmission line" (a claim about the asset the source does not make). | `osm.js` KINDS | Display names follow the tag: "Power line (power=line)", "Minor power line", "Power cable". |
| "Distribution below 11 kV largely unmapped in OSM" was an unverified claim. | layer panel text | Replaced by "Distribution transformers, poles and towers (not queried)". |
| Topology, ids, generator/load mapping | `app/test/scene.test.mjs`: layout deterministic; one rendered position per bus/gen/load/branch; every route starts and ends at its own buses in case-file orientation; e2e: instance counts equal the data on all three networks | pass |
| Event fidelity | unit test over every frame of the IEEE-118 worst triple: a branch is "tripped now" only at the frame that applies its trip, "tripped" only when the frame lists it out of service; initial outages only for the contingency | pass |
| Source parameters | `tests/integration/test_case_params.py` re-derives `params_*.json` from the case files and checks endpoints and x against the demo data | pass |

## Review B — interaction and visual hierarchy (3-D interaction designer)
Screenshots: `docs/screenshots/original_review_b/before/` and `after/` (1440 × 900 Spatial, Grid focus, inspection of bus 69, round-2
trips, end state, geographic mode; 1024 and 390 px both modes).
| Finding | Fix | Verified |
|---|---|---|
| At close range the city blocks were lit grey boxes as large as generators and competed with the inspected bus (`before/1440_inspect_bus69.png`). | Unlit-looking dark material (Lambert), darker tones, and the city darkens further at the near level of detail. | `after/1440_inspect_bus69.png` |
| A bus without demand showed "served 0.0 MW (100.0%)". | "no demand at this bus". | `after/1440_inspect_bus69.png` |
| The × marker for branches tripped at the displayed step was ~3 px at overview. | Marker size scales with the network size (≥ 0.5 su, 1.1 % of the layout size). | `after/1440_trip_round2.png` |
| Geographic mode below 1180 px: data panel and asset inspector were hidden with no visible way to open them; selecting an asset showed nothing. | "Data & filters" and "Asset" buttons on the map at narrow widths; selecting an asset opens the asset sheet. | `after/1024_geo.png`, `after/390_geo.png` |
| Phone header overflowed with the geographic pill; attribution collided with the scale bar. | Shorter pill (hidden below 600 px; the mode name stays in the menu), compact attribution below 760 px. | `after/390_geo.png` |
No horizontal page scroll at 1024 or 390 px (`scrollWidth` equals the viewport in both modes).

## Review C — adversarial technical judge
| Attempt | Result | Fix |
|---|---|---|
| Leave the explorer while the Overpass query is running | Before: a "could not be loaded" error remained and no retry happened. | Leaving cancels silently and the query restarts on return; new e2e test holds the request in flight to prove it. |
| Repeated network switching (4 × IEEE-30 ↔ IEEE-118) | Selection and run cleared each time; GPU geometry count does not grow (e2e). | — |
| Picking: can a city block be selected? | A 23-px grid of screen probes returns only real entity ids (e2e). | — |
| Missing data and failures | Overpass 504 → listed per endpoint, nothing drawn in its place; tiles aborted → warning, layers still draw; a GeoJSON with no power features is rejected and the previous data kept (e2e). | — |
| Stale cross-mode state | Choosing a geographic asset never touches the benchmark contingency; returning restores network and selection (e2e). | — |
| Published copy of the page | The export linked a stylesheet and lacked the map library; hosts that allow only fixed stylesheet origins would break the map. | `scripts/export_demo_page.py` inlines the map stylesheet and ships `vendor/` (three.js, MapLibre). |
| Performance | City generation took 224 ms per scene build on IEEE-118 (brute force against 2 232 branch segments). | Spatial index: 34 ms in node, identical block set (1 275 blocks; every block still passes the brute-force clearance test). |

### Measurements (SwiftShader software WebGL, 2 vCPU Xeon, no GPU, 1440 × 900)
IEEE-118 benchmark: 18 draw calls, 105 k triangles (the city adds one draw call and ~10 k triangles), about 2.5 fps while flow arrows
animate (adaptive quality: pixel ratio 1, no shadows, flow at 15 fps); forced full redraw 469 ms/frame in Grid only vs 537 ms/frame in
Spatial. The page renders only on change when nothing animates. GPU frame rates were not measured (no GPU available).

## Remaining limitations
- No real Bengaluru data was loaded in this environment; live Overpass and tile behaviour is untested here.
- The KPTCL/BESCOM substation list is not used (no coordinates, no licence).
- The benchmark layout is synthetic (Kamada–Kawai); distances mean nothing electrically or geographically.
- Software-rendered frame rates are low; real-GPU performance unknown.
