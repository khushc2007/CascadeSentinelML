# Frontend audit — baseline before the 3D workbench (2026-10-26)

Audited state: commit `0ff8da7` (Phase 13b web demo) on branch `master`, plus `bdece6f..0ff8da7` history. Evidence was gathered by running the
code, not by reading it alone. Screenshots of this baseline: `docs/screenshots/baseline/` (headless Chromium, 1440×900 and 390×860, taken on
2026-10-24 against the same code; fonts fell back to system faces because the sandbox cannot reach Google Fonts).

## How the frontend is built and served
| item | finding | evidence |
|---|---|---|
| Entry point | `app/index.html` (single page) → `app/js/main.js` (ES modules, no bundler, no framework) | file tree |
| Routes | one page with anchors `#hero #wall #lab #scan #hunt #oracle #proof #next`; `app/classic.html` is the Phase 13 view | `app/index.html` |
| Rendering stack | 2D `<canvas>` (network, scan matrix, Grover field) + inline SVG charts. **No 3D renderer.** | `app/js/ui/net.js`, `scan.js`, `hunt.js` |
| Backend | FastAPI `doomsday/api/app.py`: `/health /grids /grid/{id} /ranking /cascade /search /crossover /evidence`; serves `app/` statically | `tests/api/test_api.py` (5 pass) |
| Hosted copy | `scripts/export_demo_page.py` → `build/demo` → published page (no API there, so the page runs offline from `app/data`) | export run |
| Authoritative topology | `app/data/grid_<id>.json` (bus/branch tables from the official MATPOWER 8.1 cases via the Python loader) + `cascade_model_<id>.json` (engine inputs) | `doomsday/api/demo_data.py` |
| Layout | Kamada–Kawai (NetworkX), normalised to [0,1]², **not geographic**; labelled as such in grid JSON | `grid_ieee118.json: layout.method` |
| Cascade representation | per-round frames `{round, out_of_service, tripped, overloaded, load_served, islands, loading, flow, energized_buses}` | `app/js/core/cascade.js` |
| Simulation in the browser | JS port of the DC cascade engine; parity with Python on 520 cascades (S, S0 ≤ 1e-9; trips, islands, rounds identical) | `node --test app/test/cascade.test.mjs` → pass |
| Selection & camera | click a line to toggle it into the outage set; no bus/generator selection, no inspector, no camera (fixed 2D fit) | interaction in headless browser |

## Baseline test results (this audit)
| command | result |
|---|---|
| `python -m pytest -q` | 238 passed, 2 skipped (both: qiskit installed so NOT_RUN-path tests do not apply) |
| `node --test app/test/*.test.mjs` | 13 / 13 pass (8 resource/emulation/ranking parity + 5 cascade parity) |
| `python scripts/claims_lint.py` | 0 violations |
| headless browser, desktop + phone | no page errors after the Phase 13b fixes; no horizontal scroll at 390 px |

## Feature-evidence matrix (baseline)
| capability | class | evidence / gap |
|---|---|---|
| Topology from official data | Implemented and verified | loader regression test; JS parity uses the same arrays |
| DC cascade, browser | Implemented and verified | 520-case parity test |
| DC cascade, API (DC/AC) | Implemented but incompletely verified | API tests cover the endpoint; the page's use of it was never exercised in a browser |
| 3D scene | Proposed | does not exist |
| Camera modes (orbit/recon/focus/overview/event/follow/compare) | Proposed | does not exist |
| Entity types distinguished (bus, generator, load, transformer, branch) | Partially implemented | generators get a ring; loads and transformers are not drawn; transformers only in tooltip text |
| Selection + inspector | Partially implemented | hover tooltip for branches only; no bus/generator inspection; no persistent inspector |
| Explorer / search by id | Proposed | none (command palette searches actions, not entities) |
| Contingency construction | Implemented and verified | arm up to 6 lines, presets, rank lookup |
| Exact-k validation | Partially implemented | max 6 enforced; no notion of the k required by a table, rank silently unavailable |
| Event timeline | Partially implemented | round buttons + text log; no event objects, no focus-on-event, no step/pause/speed |
| Severity display (S, S0, C) | Implemented and verified | values from the engine; split bar + gauge |
| Islands / load shed | Partially implemented | de-energised buses greyed; islands not distinguished from each other; shed load per bus not shown |
| Layers / legend | Proposed | no layer toggles; no legend for the network view |
| Diagnostics (config, provenance, units) | Partially implemented | provenance in the Proof section only; units only in tooltips |
| Scenario save / compare | Proposed | none |
| Export findings | Proposed | none |
| Research results (E0–E16, crossover, Grover, scan) | Implemented and verified | numbers read from `headline.json` / results; scan self-checks against the table |
| Presentation mode | Implemented but incompletely verified | slide walk-through works; it is a scroll show, not a guided analysis |

## Most serious defects against the new brief
1. **No 3D environment** — the network is a flat 2D canvas; the brief's core experience is absent.
2. **Decorative effects without analytical meaning**: shock-wave rings on trips, additive glow on every line, a dotted backdrop grid,
   blinking dots, neon cyan/violet palette, glow-bordered cards. All conflict with `DESIGN_SYSTEM.md`.
3. **Marketing page, not a workbench**: the network shares the page with large hero typography and stacked cards; the viewport is a minority of the screen.
4. **Inspection is shallow**: no way to select a bus or generator, read its data, or find an entity by id.
5. **Cascade not explorable as events**: the timeline cannot focus the equipment involved, cannot step, pause or change speed.
6. **Initial outages vs secondary trips** are distinguished only by an X marker; islands are not separated visually.
7. **API path untested in the browser** — AC cross-check exists in code only.

## Discrepancies between documentation and implementation
- `docs/PHASES_7_14.md` describes Phase 13b accurately. No discrepancy found in the numbers shown (spot checks: S_max IEEE-118 k=3 22.8 % =
  `dist_ieee118_k3.top[0]`; ratio 33,116× = E15 headline; GA 387 evaluations at 12 % success = E7).
- `build/` was tracked in git although it is generated; fixed (now ignored).
