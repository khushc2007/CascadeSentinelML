# BLACKSKY COMMAND · OMEGA — design system

**Idea.** Seen from above at night, a grid is the lights it keeps on. In the Theater every load bus is a small demand facility whose roof
plates are lit in proportion to the demand the engine says is still served; when the cascade sheds load those lights go out, where the
model says and nowhere else. The other four workspaces are instruments around that scene: dark, quiet panels in which a few colours carry
fixed meanings, and every number states what kind of result it is.

## Colour (tokens in `site/index.html` `:root`)
| token | value | meaning — used only for this |
|---|---|---|
| `--bg` … `--bg-3` | `#05070c` `#0a0d14` `#10141c` `#161b25` | navy-black scene, chrome, panels, raised panels |
| `--line` / `--line-2` | `#1b212b` / `#2a313d` | 1 px separators (graphite) |
| `--tx-1..3` | `#e8ecf1` / `#a8b1bd` / `#808a98` | values / secondary / helper text |
| `--ice` | `#7cc4e8` | instrumentation, selection, focus, navigation |
| `--violet` | `#a68cf2` | quantum states and algorithmic exploration (Quantum Lab, Grover rows, quantum estimates) |
| `--amber` | `#f2a93b` | warnings and stressed components (80–100 % loading; overloads) |
| `--red` | `#e0443a` | modelled faults: initial outages, trips, failed checks |
| `--green` | `#5fbf86` | generator online, checks passed |
| `--grey` | `#565e69` | inactive, de-energised, unavailable |
| `--lamp` | `#ffd39a` | served demand (roof plates, demand-served figure) |

Chart series (fixed per method, never re-assigned by rank; validated for CVD separation on `#0a0d14` with the dataviz validator):
random `#3987e5`, genetic `#d95926`, annealing `#199e70`, loading-ranked `#c98500`, ML surrogate `#d55181`, Grover `#9085e9`,
exhaustive `#e8ecf1`. Every chart with two or more series has a legend and direct end labels, so identity never depends on colour alone.

## Result-class chips (`js/provenance.js`)
SIM · EMU · EST · PRED · MEAS · PROP · N/A, each with a tooltip saying what it means. A section shows one chip for its class; a row shows its
own chip only when it differs (e.g. wall-clock MEAS inside a SIM section). Inputs are tagged "input", not given a result class.

## Type
Archivo for text, JetBrains Mono (tabular figures) for identifiers and numbers, Instrument Serif (roman + italic) for workspace titles only
(`Cascade <em>Theater</em>`, `Quantum <em>Lab</em>` …). All vendored, OFL. Scale 11 (section labels, uppercase + tracking) / 12.5 / 13 /
15 / 22 (titles) / 28 (headline figures).

## Layout
Bar (52 px): wordmark · five workspace tabs · scenario id · network · engine status · API status · command palette · help.
Three zones per workspace: left = configuration, centre = evidence (charts, scene, tables), right = inspector / candidates / notes.
Theater keeps the full-bleed scene with floating panels and a 96 px playback dock. Breakpoints 1760 / 1500 / 1280 / 1180 / 1100 / 900 /
600: chips drop in order of importance, side panes become drawers (≤ 1180) and bottom sheets (≤ 600; one open at a time).

## Visual grammar (Theater, procedural, instanced)
bus = octagonal pad with light (energised) or dark (de-energised) cap; generator = housing with green (online) or grey ring; demand facility
= three blocks with lamp plates; transformer = mid-span block; branch = graphite conductor arc, amber when ≥ 80 %, thicker above rating;
removed branches = red dashed ghosts (initial outages with cut markers and T0 tags; cascade trips thinner with R n tags); selection = ice
outline; island = faint ground disc. The 2-D view draws the same tags itself and fits the area no panel covers.

## Motion
Only state changes move: camera transitions (700 ms; none under reduced motion), round transitions, flow chevrons (static under reduced
motion). The 3-D loop draws only when something changed and pauses outside the Theater and in 2-D. No decorative pulses, flashing or countdowns: the only pulse is the trip front (APEX), and each one is a line the engine tripped at that step.

## APEX additions
- **Lit-cell motif:** a small square, lamp-coloured when demand is served, graphite when not. Brand mark (2×2, one dark), arrival
  cells (one per demand point), and the unit of the landscapes (one cell per pair of lines).
- **Sequential ramps** (`js/sci/overlays.js`): fault = dark maroon → red → pale coral (frequency in the most damaging sets, log scale; also S
  on landscapes); surge = slate → ice → near-white (flow added per rating). Error ramp for predictions: ice (under) ← graphite → violet (over).
- **Propagation:** a tripped line burns out (pale → red → gone, ~1.1 s) with two pulses running to its ends; lamps and buses fade between
  frames (0.5 s). Only on a forward step of the replay; never under reduced motion.
- **Briefing:** a card that avoids what it points at, an amber spotlight ring, progress cells in the lit-cell motif.
- **Motion grammar:** workspaces fade in (0.2 s); numbers count up only where they do not re-render (arrival).

