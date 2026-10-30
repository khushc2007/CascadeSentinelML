# Frontend validation report (2026-10-26)

Environment: Linux container, 2 vCPU Intel Xeon @ 2.30 GHz, no GPU; Chromium 1243 headless with SwiftShader (software WebGL); Node 22.22;
Python 3.13. The page was served by `python -m http.server` (static) and by `uvicorn doomsday.api.app:app` (API) during the checks.
Google Fonts and the CDN are unreachable from this sandbox, so screenshots use fallback fonts and the vendored three.js.

## Commands and results (final run)
| command | result |
|---|---|
| `python -m pytest -q` (whole suite, includes `tests/e2e` and the JS suite via node) | **241 passed, 2 skipped** (skips: qiskit installed, so the NOT_RUN-path tests do not apply) |
| `node --test app/test/*.test.mjs` | **20 / 20** (resource + emulation + ranking parity 8; DC cascade parity 5 = 700 runs incl. both trip policies; workbench logic 7) |
| `python -m pytest tests/e2e` | **3 / 3**: critical journey; phone + reduced motion; compare / layers / views / keyboard |
| `python scripts/claims_lint.py` (now also scans `app/js/**`) | 0 violations (it caught one wording issue in a new doc during this work, which was fixed) |

## End-to-end journeys verified (browser, scripted, asserted)
| journey | verified values |
|---|---|
| open → worst 3-set preloaded → Run (browser DC) | S equals the exhaustive-table maximum to 1e-9; rank #1 exact; header shows 22.8 % |
| search “bus 59” → Enter → inspector; 2-hop neighbourhood → restore | selection id `bus:59`; neighbourhood contains bus 59 and 6 < n < 118 buses |
| explorer “+” on branch 37 → contingency → remove | store and scenario panel and header agree |
| empty contingency | Run disabled; API engines disabled with reason when no API |
| timeline: click a trip event, `]` / `[` | playback index follows; tripped branch inspector says “tripped in round 1” |
| Islands tab at termination; Save; Export findings | “main island” listed; one saved run; Markdown contains “#1 of 1,055,240” and the limitation sentence |
| Schematic ↔ Spatial; Recon W key; Esc | camera position changes in Recon; Esc returns to Orbit |
| DC vs AC (IEEE-30, offline) | DC S = table maximum, rank 1; AC S = stored Python AC run to 1e-12, **not ranked**; comparison table shows both |
| AC result → Islands tab | explicit “component membership unavailable” message |
| A/B switch → isolate island → restore | scene shows the DC run, camera unchanged; isolate toggles |
| Views: save → move → restore; Esc closes menu | restored pose within 1e-3 scene units |
| keyboard only: search, Enter, `C`, Run via focused button, `]` | contingency contains the selected branch; run completes; event advances |
| phone 390 px + reduced motion | no horizontal overflow; explorer drawer opens/closes; no auto-playback |
| Research workspace | 17 ledger tiles from `evidence.json`; pair scan on IEEE-118 matched the offline table (18.53 %, 1,654 pairs) |

API path (checked with the FastAPI server, `api_check.py`, not part of pytest because it needs the server): precomputed and live sources
labelled; IEEE-118 live → 409 shown as failure; API DC on the worst IEEE-118 set reproduces the browser engine exactly.

## Performance (measured; software WebGL only)
| network | page ready | renderer | draw calls | triangles | select → inspector | engine run | run incl. UI | event step |
|---|---|---|---|---|---|---|---|---|
| IEEE-14 | 3.4 s | adaptive level 3, ~8 drawn fps | 16 | 10,965 | 21 ms | 0.7 ms | 179 ms | 3.9 ms |
| IEEE-30 | 2.4 s | adaptive level 3, ~7 drawn fps | 16 | 19,304 | 18 ms | 0.8 ms | 239 ms | 5.5 ms |
| IEEE-118 | 2.5 s | adaptive level 3, ~5 drawn fps | 17 | 95,539 | 7 ms | 7.2 ms | 311 ms | 15 ms |

Conditions: 1440 × 900, headless, SwiftShader on 2 vCPU. “Adaptive level 3” = pixel ratio 1, no shadows, flow chevrons updated at 15 fps: the
renderer stepped down automatically because frames took > 45 ms. **These numbers are not representative of a GPU machine and no GPU frame rate
was measured.** Geometry is built once per network (instanced meshes, ~16 draw calls); state changes rewrite instance buffers only (event
step 4–15 ms); hover/selection changes touch only the highlight meshes. Geometries are disposed on network change (`GridScene.dispose`).

## Feature classification
| class | features |
|---|---|
| Implemented and verified | 3-D scene from official topology; instanced procedural equipment (bus, generator, demand, transformer, conductor); orbit / recon / follow / schematic / focus / overview / event framing; saved views; selection sync across scene, explorer, inspector, timeline; search; contingency building; validation; browser DC engine; precomputed AC; event timeline with step/play/speed; rank lookup; islands + isolate; 2-hop neighbourhood; layers; legend; DC vs AC comparison; saved runs + A/B; findings export; intro card; guided presentation; Research workspace; reduced motion; phone layout |
| Implemented but not fully verified | API DC/AC engines (verified manually with the server, not in CI); cancellation of an in-flight API request (code path only); WebGL-unavailable fallback (not exercised); hosted page CDN import of three.js and fonts (sandbox cannot reach the CDN) |
| Partially implemented | camera collision (bounds and minimum height only, no per-object collision); touch hover (tap selects, no hover); screen-reader access to the 3-D canvas (explorer is the text equivalent) |
| Proposed future work | see `docs/FUTURE_ROADMAP.md` (browser AC engine, persisted scenarios, route bundling, GPU profile, utility ratings, hardware run) |

## Screenshots
`docs/screenshots/final/` — start, trip event, end-state inspection, low angle, schematic, phone, DC-vs-AC comparison, neighbourhood, research
scan, crossover model, presentation. Baseline before this work: `docs/screenshots/baseline/`.
