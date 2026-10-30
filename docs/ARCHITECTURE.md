# Architecture — web workbench

```
 MATPOWER case files ─► Python grid twin (doomsday/gridtwin) ─► truth tables, experiments (results/phase7)
                                   │                                         │
                                   ▼ scripts/build_demo_data.py              ▼
                    app/data/grid_<id>.json, cascade_model_<id>.json, dist_*, search_*, headline, evidence, crossover
                                   │
 ┌─────────────────────────────────┼───────────────────────────────────────────────────────────────┐
 │ browser                         ▼                                                               │
 │  1 electrical graph   app/js/core/model.js     buses, branches, generators, loads (ids, units)   │
 │  2 simulation         app/js/core/cascade.js   DC cascade (port of gridtwin/cascade.py, parity)  │
 │                       app/js/core/events.js    frames → ordered event list (no invented events)  │
 │                       app/js/core/scenario.js  validation, rank lookup, findings, comparison     │
 │                       app/js/core/encoding.js  data → visual state (pure, tested)                │
 │  3 layout model       app/js/three/layout.js   2-D Kamada–Kawai (from data) → 3-D scene coords  │
 │                       app/js/three/loader.js   three.js r160: vendored copy, else pinned CDN    │
 │  4 rendered scene     app/js/three/scene.js    instanced meshes; updates per state, no rebuild   │
 │                       app/js/three/camera.js   orbit / recon / follow / focus / overview / event │
 │  5 UI state           app/js/wb/store.js       selection | contingency | run | playback | camera │
 │  6 panels             app/js/wb/*.js           explorer, inspector, setup, timeline, overlays    │
 │  7 research           app/js/research/*.js     E0–E16 results, crossover, Grover, live scan      │
 └─────────────────────────────────────────────────────────────────────────────────────────────────┘
                                   │ optional (when served by `make serve`)
                                   ▼
                       FastAPI doomsday/api/app.py: POST /cascade (DC/AC, precomputed-first; live for IEEE-14/30)
```

## Separation rules
- **Electrical graph is read-only.** `model.js` builds immutable arrays from the two JSON files; the renderer reads it, never writes it.
  Connectivity used for islands comes from the engine's frames, not from geometry.
- **Layout ≠ geography.** `layout.js` maps the stored Kamada–Kawai coordinates to scene units and adds voltage-tier elevation when the case
  has more than one kV class. The legend says so.
- **Scene updates are incremental.** `GridScene.setState(view)` rewrites per-instance colours/matrices of existing `InstancedMesh`es; geometry is
  built once per grid and disposed on grid change (`GridScene.dispose`).
- **Stable entity ids**: `branch:<index>` (0-based index in the case branch table = the index the engine and truth tables use), `bus:<case bus number>`,
  `gen:<index>`, `load:<case bus number>`. The same id string is used by the scene, explorer, inspector, timeline and URL-free state.
- **Independent state slices** in `store.js`: `selection`, `contingency`, `config`, `run` (request id, status, source, result, error),
  `playback` (event index, playing, speed), `camera` (mode, bookmarks), `layers`, `ui`. Panels subscribe to the slices they render.

## Execution paths
| mode | where | evidence | availability |
|---|---|---|---|
| Browser DC | `core/cascade.js` | same model as the truth tables; parity-tested on 520 + policy cases | always |
| Precomputed AC | `app/data/top_cascades_*`, `examples_*` | stored Python AC runs made when the data was built | the ten worst sets per table and the example sets (IEEE-14/30; IEEE-118 k = 2 examples) |
| API DC / AC | `POST /cascade` | `source: precomputed | live` returned by the server | only when `/health` answers (local `make serve`); live runs limited to IEEE-14/30 by the API |
AC results are never ranked against the exhaustive tables (those are DC).
Each run carries a request id; a newer request supersedes an older one (late responses are dropped), API calls time out after 30 s and can be
cancelled; failures are shown as failures — no fallback result is substituted.

## Data contracts used by the workbench
- `grid_<id>.json`: `buses[{i,id,load_mw,base_kv,has_gen}]`, `branches[{l,from,to,rating_dc_mw,rating_ac_mva,base_loading_dc,base_loading_ac,transformer}]`, `layout{x,y,method}`.
- `cascade_model_<id>.json`: engine inputs (`Pd`, `x`, `rating_dc`, generators, `pg0`, cascade/severity config).
- Cascade result (browser and API): `{outage, mode, policy, metrics{S,S0,C,rounds,status}, frames[{round,out_of_service,tripped,overloaded,load_served,islands,loading,energized_buses}]}`;
  the browser engine additionally returns per-frame `flow` (signed MW), `factor` (served fraction per bus) and `pg` (generator dispatch, MW).
  When a field is absent (API results), the inspector shows *Unavailable*.
