# Design system — Grid Doomsday Finder workbench

The product is an engineering investigation environment. The network is the subject; the interface around it is instrumentation.
Sophistication comes from geometry, light, composition and exact information, not from glow, gradients or animation volume.

## 1. Colour semantics
All colours are CSS custom properties in `app/index.html` and are mirrored for WebGL in `app/js/three/palette.js`. One dark world (deliberate;
the viewport is lit geometry on graphite), no light theme.

| role | token | value | used for |
|---|---|---|---|
| scene background / fog | `--bg-0` | `#0e0f10` | viewport clear colour, fog |
| chrome | `--bg-1` | `#141517` | header, panels' surroundings |
| panel | `--bg-2` | `#1a1c1f` | explorer, inspector, timeline |
| control / hover surface | `--bg-3` | `#232629` | inputs, hovered rows |
| rules | `--rule`, `--rule-2` | `#2b2e33`, `#3a3e44` | 1 px dividers only |
| text | `--ink-1..4` | `#e8e5de #b3afa6 #7d7a73 #5a5853` | primary → disabled |
| selection | `--sel` | `#f2efe8` | selected entity outline, focused row; neutral by design |
| hover | `--hover` | `#c9c5bb` | hovered entity |
| bus (equipment) | `--eq-bus` | `#a9b2bc` | bus hubs (steel) |
| generator | `--eq-gen` | `#b8955a` | generator housings (ochre) |
| load / demand | `--eq-load` | `#a08e74` | served demand columns (earth) |
| transformer | `--eq-xfmr` | `#6f7680` | transformer blocks (gunmetal) |
| conductor (neutral) | `--eq-line` | `#b4bcc5` | in-service branches when no analytical layer colours them |
| warning | `--warn` | `#e0a33a` | utilisation 0.8–1.0 (the engine's warning band) |
| overload / failure | `--fail` | `#d0473a` | utilisation > 1.0, initial outages, shed demand |
| secondary trip | `--trip` | `#a3483c` | branches tripped by the cascade (with round tag) |
| ok | `--ok` | `#7fa37a` | passed checks only |
| evidence: measured / simulated / emulated / modelled / not run | `--ev-*` | `#8fa8bf #7fa8a0 #a594bf #c2a46e #6f6d68` | evidence chips |

Rules: red and amber appear **only** for engine states (overload, warning band, outage, trip, shed load) or failed checks. Selection is never red.
Utilisation colours use the engine's own bands (≤ 0.8, 0.8–1.0, > 1.0) so the picture and the trip logic agree.

## 2. Typography
IBM Plex Sans (400/500/600) for UI, IBM Plex Mono (400/500) for identifiers and numbers, with system fallbacks. Scale: 11 (micro labels,
uppercase +0.08em), 12 (dense tables), 13 (body), 15 (panel titles), 18 (section titles), 24 (single headline values). No display type inside the
workbench; Research uses 18–28 px section titles. Numbers are tabular; units are always printed next to values (MW, MVA, p.u., %).

## 3. Spacing and panels
4 px base unit; panel padding 12; control height 28; gaps 8 / 12 / 16. Panels are flat (`--bg-2`, 1 px `--rule` border, 6 px radius), no blur, no
shadow glow, no gradient borders. Panels collapse to their header; on narrow screens explorer and inspector become drawers over the viewport.
The viewport takes the remaining space (≥ 60 % of the window at 1440 × 900).

## 4. Selection and hover
Hover: `--hover` outline + label; Selected: `--sel` outline (scaled shell for points, tube for branches) + label + inspector; Multi-selected
(contingency members): `--fail` dashed conductor with a cut marker, listed in the scenario panel. Keyboard and touch: every hover-only fact is also in
the inspector; explorer rows are focusable; Enter selects, `F` frames the selection.

## 5. Equipment representations (procedural, scene units)
| entity | geometry | size encodes | label |
|---|---|---|---|
| bus | hexagonal prism on a darker hexagonal plinth; buses on a raised voltage tier stand on a thin mast | number of connected branches (radius) | bus number from the case file |
| generator | lathe-turned housing (wide foot, waist, rolled rim) + cap, offset from its bus, joined by a stub | √Pmax | `G<index> @ bus` |
| load | square column beside the bus; solid = served, open red frame = shed | demand MW (height) | MW in inspector |
| transformer branch | conductor + gunmetal block at mid-span | — | `T` suffix |
| line branch | conductor arc between buses (arc height ∝ span, parallel circuits offset) | utilisation colour when the layer is on | branch index |
| flow direction | small chevrons moving along the conductor | direction = sign of DC flow; speed ∝ utilisation | — |
| voltage tier (IEEE-118) | bus elevation | 345 kV raised above 138 kV | legend |

Geometry is illustrative and the layout is synthetic (Kamada–Kawai). Both are stated in the legend and diagnostics; nothing is drawn as a map.

## 6. Warning and failure states
| state | conductor | bus |
|---|---|---|
| in service, ≤ 0.8 | neutral / utilisation ramp | lit steel |
| warning 0.8–1.0 | `--warn` | — |
| overloaded > 1.0 (this round) | `--fail`, thicker | — |
| initial outage | removed; `--fail` dashed ghost with cut markers at both ends | — |
| secondary trip (round r) | removed; `--trip` dashed ghost + `R r` tag | — |
| de-energised | ghost grey | unlit charcoal, ring in `--fail` |
| island (non-main component) | — | muted categorical ground disc per component |

## 7. Camera controls
Orbit (default): drag rotate, right-drag / Shift-drag pan, wheel zoom, damped. Recon: drag to look, W/A/S/D move, R/F rise/descend, Shift ×3,
speed presets, bounded box and minimum height; `Esc` returns to Orbit. Follow: orbit target locked to the selection. Focus (`F`), Overview (`O`),
Event framing (auto during playback, toggle). Schematic view: orthographic top-down, pan/zoom only. Bookmarks: up to 6 per grid.
Shortcuts are ignored while a text field has focus. A hideable guide lists them.

## 8. Animation principles
Motion explains state change and nothing else: camera transitions 700 ms ease-in-out; state transitions between cascade rounds 250 ms; flow
chevrons are the only continuous motion and carry direction and utilisation. No shock waves, pulses, particles without meaning, or idle animation.

## 9. Materials and lighting
`MeshStandardMaterial`, roughness 0.55–0.95, metalness 0.05–0.45; ground plane roughness 1. Hemisphere fill + warm key directional light with
soft shadows (PCF, 2048 map) + cool rim light; ACES filmic tone mapping; exponential fog matched to `--bg-0` for depth. A faint scene-relative
reference grid on the ground (major lines only) helps judge distance in Recon mode and can be turned off.

## 10. Responsive behaviour
≥ 1180 px: explorer | viewport | inspector, timeline below. 760–1180: inspector becomes a drawer. < 760: both side panels are drawers opened from
the header; the timeline collapses to controls + current event. Canvas resolution is capped at device-pixel-ratio 2.

## 11. Accessibility
Text contrast ≥ 4.5:1 on panels (ink-1/ink-2 on bg-2). All controls are buttons/inputs with labels; explorer lists are keyboard navigable;
state is never colour-only (dashes, tags, icons and text accompany colours); the scene has a text equivalent in the explorer and timeline.

## 12. Reduced motion
`prefers-reduced-motion: reduce` (or the toggle in Layers) makes camera moves instant, replaces moving chevrons with static ones, and disables
auto-playback; stepping works unchanged.
