# Rating extension: N-1 covering rating (implementation / calibration extension — NOT V2 §5.3)

## Baseline (V2 §5.3, preserved as `rating.family: proportional`)
`R_l = max((1+h)·|flow⁰_l|, s_floor)`, h ∈ [0.15, 0.40], per engine, from one AC base point.
Code: `doomsday/gridtwin/ratings.py::synthesize_ratings`. Still selectable and still tested.

## Why an extension was necessary  [MEASURED — results/phase1_rating_feasibility.json]
V2 §5.2 step 6 requires a secure base: no base overload, and every non-bridge single outage settles with zero
trips, per engine. Applying the baseline rule exactly to IEEE-14 (λ = 1.10, h = 0.25): 18 of 19 non-bridge
single outages violate (DC and AC). No (h, λ) in the V2 ranges (h 0.15–0.40, λ 1.0–1.3; 24 points) is
N-1 secure (minimum 15 DC / 14 AC violations). The smallest *uniform* h that is N-1 secure is ≈6.5–6.8, far outside
the V2 range; 17 of 20 branches would need h > 0.40. Cause: proportional headroom cannot cover rerouted flow onto
branches with small base flow (e.g. 12-13 base 1.6 MW would need h ≈ 7.7; 1-5 needs h ≈ 2.1 after losing 1-2).

## Extension (`rating.family: n1_covering`, default, margin `rating.n1_margin_m`, default m = 0.05)
`R_l = max( (1+h)·|flow⁰_l| , (1+m)·max_{non-bridge single outages j} |f′_{l|j}| , s_floor )`, per engine
(DC: MW from DC post-outage flows with the base DC injections; AC: MVA from AC post-outage solves, injections fixed,
slack absorbs losses). Bridge outages are excluded (they island; S0 > 0 by definition, V2 §5.2 step 6).
The first and third terms are exactly the V2 baseline, which is stored in `bp.rating_info["baseline_rating_*"]`.
Consequence: no single outage can trip anything, so every cascade needs k ≥ 2 (as the V2 secure-base definition intends).
Step order: DC base injections (step 5) are computed before ratings (step 4) because the DC covering term needs them;
both derive only from the one AC base solution.

## What is and is not claimed
* The extension is a *calibration choice made by this implementation*, introduced to satisfy V2's stated requirement.
  V2's own text says calibration selects parameters satisfying the secure-base definition; it does not print this formula.
* The default m = 0.05 is an initial choice. m ∈ {0.05, 0.10, 0.20} is swept in Phase 2/E11.
* `results/phase1_n2_round0_proxy` (the one-round N-2 overload proxy quoted in the Phase 1 chat) is an implementation
  diagnostic, **not cascade evidence**. Cascade behaviour is measured via the cascade engine (Phase 2 diagnostics are
  also only diagnostics; E2/E11 will be the evidence).
