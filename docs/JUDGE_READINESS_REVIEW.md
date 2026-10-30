# Judge readiness review (2026-10-26)

Written from the position of a hackathon judge with ten minutes, a laptop and a sceptical attitude. No claims about competitors or winning odds.

## What is the most impressive thing a judge can actually do?
1. Open the page: IEEE-118 (official MATPOWER data) in 3-D, the worst 3-branch contingency already marked. Press **Run**: the cascade is computed in
   the browser (≈ 10–20 ms of engine time) and plays round by round — overloads, trips, islands, shed demand — with the camera following each event.
2. Read the result: **S = 22.8 %**, **#1 of 1,055,240** (exhaustive DC table). Click a tripped line: the inspector shows its rating, the
   round it tripped in, and the event in which it reached 612 % of rating.
3. Press **Compare DC vs AC** on an IEEE-30 or IEEE-14 set from the Scenarios tab: the DC and the stored AC result side by side, with the AC run
   explicitly not ranked against the DC table.
4. Fly the network in **Recon** mode (W/A/S/D), switch to **Schematic**, isolate an island, look at a bus's 2-hop neighbourhood.
5. **Research** → run the exhaustive pair scan (17,205 cascades in a worker; it checks itself against the offline table), watch ideal Grover on
   the million-entry table, drag the crossover model to see what hardware speed would be needed.

## Can the judge verify that it works?
| claim on screen | how to check |
|---|---|
| browser engine = Python engine | `node --test app/test/cascade.test.mjs` (700 runs, both trip policies); the pair scan re-derives the offline table maximum live |
| rank #1 of 1,055,240 | `app/data/dist_ieee118_k3.json` (generated from the exhaustive truth table); e2e test asserts it |
| DC vs AC differ | stored Python AC runs in `app/data/top_cascades_*`; with `make serve` the API recomputes them |
| events are not invented | `app/js/core/events.js` only reads frames; `app/test/workbench.test.mjs` checks every event against the frames on 180 runs |
| no hardware, no advantage | Research header, `results/phase7/REPORT.md`, E13 = NOT RUN, claims lint 0 violations |

## What would I challenge?
- **“Is this a real blackout?”** No: quasi-steady-state DC overload cascade on a test case with synthetic ratings; the page says so in the intro,
  legend, scenario panel and exported findings. F3 shows rankings depend on the rating rule.
- **“DC is a simplification.”** Yes, and our own pre-registered test (E3/F2) says DC is a poor proxy for AC here; the product shows the gap.
- **“Why is the quantum part emulated?”** Because no device was available (E13 not run) and the honest resource model puts fault-tolerant search
  ~33,000× slower than one core at IEEE-118 k = 3. The product's value is knowing *when* it could pay, not claiming it does.
- **“Is the 3-D layout a map?”** No. Kamada–Kawai layout, elevation = voltage class; stated in the legend and diagnostics.

## What would make it more memorable?
The DC-vs-AC moment and the self-checking exhaustive scan are the two moments where the audience sees the product test itself. The guided
presentation (header → Present) walks through both the cascade and the limitations in six steps.

## Weakest parts of the demonstration
1. Frame rate on weak hardware: measured here only on software WebGL (3–10 fps at reduced quality). On a GPU laptop it should be smooth but this
   was not measured in this environment — try it on the demo machine first; adaptive quality degrades gracefully.
2. The hosted page loads three.js and fonts from CDNs; the offline `make serve` path uses the vendored copy and needs no network.
3. Dense regions of IEEE-118 are busy at overview distance; use the neighbourhood view or isolate.
4. Saved runs live only for the session.
