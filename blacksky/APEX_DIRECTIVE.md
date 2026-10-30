# BLACKSKY APEX — review of OMEGA and the directive for the next level

Written 2026-10-30 against commit `393b888` (OMEGA complete). Part 1 is an honest review of what BLACKSKY is now and where it falls
short of being striking. Part 2 is the directive: a self-contained prompt for the build that follows. Progress is recorded in
`BLACKSKY_PROGRESS.md` (section "APEX").

A note on "10,000× more advanced": no honest metric measures that. What can be done is to make every workspace show something nobody
else's tool shows, from data BLACKSKY already computes, and to make the first ten seconds unforgettable. That is the target.

---

## Part 1 — Review of BLACKSKY OMEGA

### Scorecard (1 = absent, 10 = best in class)
| Dimension | Score | Why |
|---|---|---|
| Scientific integrity | 9 | Result-class chips everywhere, cross-checks against Qiskit / Aer / scikit-learn, exhaustive optimum reproduced, limitations register. Keep this. |
| Theater scene | 7 | The "lights the grid keeps on" idea is strong and honest. But trips snap on and off; the cascade has no felt propagation, and the dark spreads only as lamp colour. |
| First impression | 3 | The page opens straight into a dense tool: a scenario form, an inspector table, a dock. Nothing says in one glance *what happened and why it matters*. |
| Workspace identity | 4 | Quantum, Arena, ML and Evidence are well-built panel-and-chart pages, but they look like the same dashboard four times. None has a signature visual. |
| Use of the data we already have | 4 | Exhaustive tables, S distributions, top-500 sets, all-pairs labels (17,205 IEEE-118 pairs computed by the Arena and ML) — most of it is computed and then reduced to a line chart or discarded. |
| Quantum intuition | 5 | Correct amplitudes, Bloch vectors, success curve. Missing: the geometric picture of Grover (a rotation in a 2-D plane), and phase as something you can see. |
| Narrative / demo | 4 | Theater has a five-stage story. There is no cross-workspace narrative a judge can follow in three minutes. |
| Motion | 4 | Camera transitions and flow chevrons only. Numbers appear without arrival; workspace switches are instant cuts. |
| Charts | 6 | Correct, accessible palette, direct labels. Plain: no small multiples, no landscapes, no animated replays. |
| Brand | 4 | A spaced-out wordmark and serif titles. No mark, no motif repeated across workspaces. |
| Performance | 8 | Lazy workspaces, worker for heavy work, 0 draws while hidden. GPU never measured. |
| Mobile | 6 | Works; one sheet at a time. Dense. |

### Findings that matter most
1. **No arrival.** The most powerful fact in the project — *three lines out of 186 take down 22.8 % of demand, and that set is #1 of
   1,055,240* — is buried in a side panel. It should be the first thing on screen, over the dark grid, with one button: watch it happen.
2. **The cascade does not propagate.** Each event is a state snap. The engine knows, per round, which branches trip, how flows
   re-route and which buses go dark. That is enough to show a trip front moving out from the initial outages, flow surging onto the
   survivors, and darkness spreading — all as encodings of engine output, not decoration.
3. **The grid's fault lines are invisible.** The stored exhaustive tables list the 500 most damaging sets for every network and k.
   How often each branch appears in them is a real, striking map of where this grid is fragile (under this model). It is not shown.
4. **The search landscape is computed and thrown away.** For k = 2 every pair has an S value (the Arena's exhaustive run and the ML
   dataset both compute all 17,205 IEEE-118 pairs). As a triangular heat map, that is the *landscape* every search method is exploring;
   replaying each method's probes over it shows *why* some methods find the optimum and others don't. ML predictions can be drawn on
   the mirrored triangle: predicted vs simulated, side by side, the same picture.
5. **Grover has no picture.** Grover is exactly a rotation by 2θ in the plane spanned by |good⟩ and |bad⟩. Drawing that rotation,
   iteration by iteration, next to the simulated amplitudes is the clearest honest explanation of quadratic query savings — and of
   over-rotation.
6. **Phase is hidden.** Amplitudes are bars. A phase wheel per basis state (length = |a|, angle = arg a) makes interference visible.
7. **Evidence is a list.** The registry knows parents and linked scenarios. A lineage graph (scenario → runs → re-runs → Arena/ML →
   checks) would show traceability at a glance.
8. **No briefing.** A guided, cross-workspace briefing that drives the real UI (Theater replay → fault lines → landscape → Grover
   geometry → resource wall → evidence) is what a judge or a first-time visitor needs.
9. **Motion has no grammar.** Headline numbers should arrive (count up), workspace switches should transition, and every animation
   should mean a state change — and all of it must stop under reduced motion.

---

## Part 2 — The directive (prompt)

> **BLACKSKY APEX.** You are continuing BLACKSKY COMMAND (`blacksky/site`), a separate website beside the original Grid Doomsday
> Finder. OMEGA (five workspaces, shared state, workers, registry, cross-checks) is complete at `393b888`. Your job is to make
> BLACKSKY the most striking scientific instrument of its kind **without weakening a single scientific guarantee**. Work
> autonomously; do not stop for routine questions; record progress in `blacksky/BLACKSKY_PROGRESS.md` (section APEX) after every
> feature; resume from it if interrupted.

### Non-negotiable constraints (carried over, still in force)
- Never modify `app/`, `doomsday/`, the original API, simulator, benchmark data or tests. `git diff ba8d133 -- app doomsday` must stay
  empty. Shared files are byte copies refreshed only by `scripts/build_blacksky.py`.
- Every visual encodes real output: engine results, stored tables, simulator runs or stated analytical models. No decorative data, no
  invented values, no "AI-looking" fake telemetry. Glow, colour and motion are encodings with a legend entry, or they are not used.
- Result classes stay on every number (SIM, EMU, EST, PRED, MEAS, PROP, N/A). Rankings from stored tables are "under the DC model
  with synthetic ratings" — say so where the fault-line map is shown.
- No quantum-advantage claim, no hardware claim, no Grover-as-wall-clock speed-up, no ML-as-verified.
- Heavy loops in the worker. No main-thread task over 100 ms introduced by APEX. Lazy-load new modules.
- Reduced motion: every new animation has a static equivalent. Keyboard access and visible focus for every new control.
- No new runtime dependencies or CDNs; three.js r160 vendored is the only 3-D library. No build step.
- Commit locally with the session attribution lines; never push.

### Design language upgrades
- **Motif:** the *lit cell* — a small square that is lamp-coloured when demand is served and graphite when not. It is the brand mark
  (beside the wordmark), the loading state, and the unit of every landscape heat map.
- **Colour roles unchanged** (navy-black, graphite, ice instrumentation, violet quantum, amber stress, red faults, lamp = served demand).
  Add a sequential *severity* ramp (single red hue family, dark = low) for S on landscapes and the fault-line map, and a
  diverging *error* ramp (ice ← grey → violet) for prediction − simulation.
- **Type:** Instrument Serif for the one headline per screen (and the arrival headline at 56–72 px); Archivo for text; JetBrains Mono
  tabular for numbers.
- **Motion grammar:** arrive (numbers count up over 600 ms, ease-out), propagate (trip fronts 450 ms per round), settle (camera 700 ms),
  transition (workspace cross-fade 180 ms). Nothing loops forever except flow chevrons, which already encode flow.

### Features, in build order (each: data source → encoding → acceptance)
1. **Arrival.** On first load (and from the logo), a full-bleed overlay over the dimmed grid: the headline S as a counting lamp-coloured
   numeral, one sentence (k branches → share of demand unserved, rank of N, network, model), three actions: *Watch the cascade*,
   *Brief me* (feature 8), *Enter the command* (dismiss). Source: the stored worst-set run + exhaustive table rank. Dismissal remembered
   per browser (try/catch). Acceptance: shown once, never blocks deep links (#quantum etc.), keyboard dismissable, e2e-tested.
2. **Cascade propagation.** During playback, each trip event emits a *trip front*: a bright pulse travelling along the tripped branch
   from both ends and fading over the round; buses that de-energise in the round fade to dark over the same time; initial outages emit a
   ring at their midpoints. Source: events / frames from the engine. Static fallback under reduced motion = current snaps.
   Acceptance: tied to the playback cursor (scrubbing back undoes it), no per-frame allocation, frame cost on SwiftShader not worse than
   +15 %.
3. **Flow surge layer.** Branch colour/width by Δflow relative to the base case at the current frame (|Δ| on a single-hue sequential
   ramp, direction by chevrons). Shows where the lost lines' power went. Source: engine flows per frame + base flows. Toggle in Layers,
   legend entry, 2-D view equivalent.
4. **Fault-line atlas.** A Theater layer and a 2-D equivalent: each branch tinted and thickened by how often it appears in the stored
   top-500 most damaging k-sets for the current network and k (with the count in the Inspector). Toggle k = 2 / 3. Label: "frequency in
   the 500 most damaging sets of the exhaustive DC table — synthetic ratings". Acceptance: counts recomputed in a unit test from the JSON.
5. **Severity context strip.** In the Theater Run tab: the full S distribution of all k-sets (stored histogram) as a compact strip with
   the current set marked and its rank; click a bar to load a set from that band (from stored examples). Source: `dist_*`, `examples_*`.
6. **Search landscape (Arena).** For k = 2: a triangular heat map of S over all branch pairs (lit-cell motif, severity ramp), filled by
   the exhaustive run (or computed in the worker on demand, ~10 s on IEEE-118). Replay control animates each method's probes over the
   landscape in evaluation order (one colour per method, same as the charts), with the optimum ringed. Hover → pair, S, which methods
   probed it; click → open in Theater. Canvas, not SVG (17k cells). Acceptance: cell values equal the engine for 20 sampled pairs.
7. **Prediction landscape (ML).** The same triangle, mirrored: lower = simulated S, upper = predicted S (or the error ramp), test pairs
   outlined. Sorting by branch loading reveals structure. Acceptance: predicted values equal the model's predictions for sampled pairs.
8. **Briefing.** A guided tour (8–10 steps) that drives the real UI: arrival fact → cascade replay → fault lines → severity context →
   search landscape race → ML landscape → Grover geometry → resource wall ("fewer queries is not less time") → evidence lineage → limits.
   Each step: one sentence, one highlighted element, next/back/escape, progress dots. Every number in it is read live from state.
9. **Grover geometry (Quantum).** Beside the success curve: the 2-D plane (|bad⟩ horizontal, |good⟩ vertical), the state vector rotating
   by 2θ per iteration, with oracle reflection and diffusion drawn as the two reflections; scrubbing the iteration slider moves it;
   P(good) = sin² of the angle, cross-checked against the simulated amplitudes (shown side by side, EST vs EMU).
10. **Phase wheels (Quantum).** Amplitudes & phases tab gets a grid of wheels: radius = |a|, needle angle = arg a, colour by phase on a
   cyclic ramp with a legend; gate-by-gate scrubbing animates them.
11. **Evidence lineage graph.** Node-link graph of the registry (records, scenarios, parents, cross-workspace links) laid out left→right
   by time; click a node → record. Canvas or SVG; < 300 nodes.
12. **Brand + motion pass.** Lit-cell mark; count-up on headline numbers; workspace cross-fade; bar status chips get a tiny sparkline of
   the last runs' wall-clock; all off under reduced motion.

### Verification
- Unit tests for every new pure function (fault-line counts, landscape indexing, Grover geometry vs simulation, lineage graph build).
- E2E: arrival appears once and is dismissable; briefing reaches the last step; landscape renders and replays; layers toggle.
- Visual review passes A–C with screenshots at 1440 / 1024 / 390 into `blacksky/review/apex/`, findings in `blacksky/REVIEW_APEX.md`.
- Performance: boot, switch, landscape fill, replay frame time measured and recorded; long tasks listed.
- Re-run `scripts/blacksky_validate.py`; claims lint 0; isolation empty. Republish the page export.

### Definition of done
Every feature above either works end to end with tests and a review screenshot, or is listed as partial / not done with the reason.
No new claim exceeds its evidence. The first ten seconds show the headline fact; every workspace has a signature visual drawn from
real data.
