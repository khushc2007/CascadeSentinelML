# BLACKSKY COMMAND — Review 1 of 3: visual and product identity

**Scope.** Does the site read as its own product, with one visual idea carried through the scene, the chrome and the three experiences,
at desktop, laptop and phone widths? Inspection was visual: screenshots taken with Playwright/Chromium (SwiftShader software WebGL, no GPU)
by `bsrev.py` (scratch script) against `python -m http.server` serving `blacksky/site`.

- Before: `blacksky/review/r1_before/` (11 screenshots: 1440 × 900 Theater DETECT/TRACE/ISLAND/ASSESS, Schematic, Autopsy, Help; 1024 × 768
  Arena validate/score; 390 × 844 Theater/Arena).
- After: `blacksky/review/r1_after/` (same journeys, same viewports).

## What already held up
- Distinct identity from the original workbench (graphite + IBM Plex): near-black night palette, Archivo + JetBrains Mono, one accent per
  meaning (ice = selection/navigation, amber = loading, red = outage/trip, green = generator online, lamp = served demand).
- The concept is legible: every demand facility carries lamp plates and a light pool scaled by the served fraction the engine reports, so
  de-energised regions literally go dark.
- No decorative gradients, glows, pulses, particles, fake loading percentages or countdowns. Motion is limited to camera moves, round
  changes and flow chevrons.

## Top five problems found
| # | Problem (evidence) | Fix | Verified |
|---|---|---|---|
| R1-1 | At close range and late rounds the red dashed ghosts of ~100 tripped lines read as scattered red debris and drown the three initial outages (`1440_autopsy_load.png`, `1440_theater_island.png`). | Cascade-trip ghosts are now thin, short-dashed and a darker red (`redTrip`); initial outages keep the bright, thick red dashes and cut markers. Legend lists both separately. | `r1_after/1440_autopsy_load.png`, `1440_theater_island.png`: initial outages dominate; trips read as a quiet trace. |
| R1-2 | The "lights out" idea was weak at overview: light pools were faint and small; dark facilities barely differed from lit ones. | Larger light pools (radius 2.8 + 3.0·√(demand/max)), stronger lamp colour, darker de-energised blocks and plates. | `r1_after/1440_theater_*`: lit areas read as warm patches; ASSESS shows clear dark regions. |
| R1-3 | At ≤ 1280 px the readout strip sat under the left panel ("Demand served" hidden at 1024 px, `1024_arena_score.png`). | Readout is centred in the free area through a `--offx` variable set together with the projection offset. | `r1_after/1024_arena_valid.png`. |
| R1-4 | Stage labels on the scrubber collapsed to cryptic initials "D T C I A" whenever stages start close together (always on the featured run). | The current stage is spelled out; other stages keep initials with tooltips; layout is computed in pixels so labels never overlap. | `r1_after/1440_theater_island.png` ("ISLAND" spelled out). |
| R1-5 | The wordmark wrapped onto two lines at 1024 px ("BLACKSKY / COMMAND"). | `white-space: nowrap`; "COMMAND" hidden below 1180 px; phone header is two rows (wordmark + network; full-width mode tabs). | `r1_after/1024_*`, `390_*`. |

Also fixed while inspecting (smaller): the legend is hidden below 1180 px, so the Help dialog now carries the same legend; legend text that
contained italics was broken by flex gaps (now wrapped); phone panels start collapsed so the scene is visible first.

## Left for later reviews
- Schematic view: equipment is small at overview and light pools are off by design (top-down analysis view). Not changed.
- Phone: the 118-bus network is necessarily small at 390 px; zoom requires a two-finger gesture the shared camera rig does not implement.
  Carried to Review 2 (functionality).
