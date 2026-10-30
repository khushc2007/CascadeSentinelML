# Future roadmap (not implemented — proposed work)

Each item states the problem, its prerequisite, the data it needs, how it would be tested and what evidence would show it works.

| feature | problem it solves | depends on | data | test | evidence of success |
|---|---|---|---|---|---|
| Utility thermal ratings | rankings depend on the synthetic rating rule (F3) | rating loader in `gridtwin/ratings.py` | real or public ratings for a test system | E11 re-run with the new family | top-10 Jaccard vs synthetic families reported; workbench shows rating provenance per branch |
| Exhaustive AC at IEEE-118 k = 3 | DC is a poor proxy (F2); AC only for top sets | `make truth` on many cores (~21 core-h) | none new | E3 re-run; AC dist file; workbench “AC table” ranking | E3 table for IEEE-118 k = 3 and AC ranks in the inspector |
| Browser AC engine (Newton–Raphson port) | AC needs the API today | JS sparse LU or dense NR for ≤ 118 buses | `grid` with r, b, tap, shift, Q limits | parity fixtures against `gridtwin/ac.py` | AC S within 1e-6 of Python on the parity sets |
| Persisted scenarios and share links | saved runs vanish with the session | artifact storage capability or the API | scenario JSON | e2e: save, reload, restore | same outage set and result after reload |
| Route bundling / neighbourhood-first overview | dense IEEE-118 regions are busy | layout model | none | screenshot review + label-overlap metric | fewer than N overlapping conductors in screen space at overview distance |
| Real-GPU performance profile | frame rate only measured on software WebGL | demo hardware | — | `scripts`-driven fps sampling on the demo laptop | ≥ 50 fps at IEEE-118 full quality, or the adaptive level reported |
| Mitigation analysis (e.g. which single reinforcement lowers S most) | users ask “what would help?” | utility-provided rating data and an agreed mitigation model | candidate actions | pre-registered experiment with held-out sets | measured ΔS with confidence on held-out contingencies |
| IBM Quantum device run (E13) | hardware evidence absent | account and credentials | toy circuits from E4/E5 | job IDs + comparison with Aer noise model | E13 status EXECUTED with job IDs; still no advantage claim at toy scale |
| Larger cases (e.g. 300-bus) | scale of the combinatorial wall | MATPOWER case files; table build time | official cases | engine parity + scene performance | parity pass and measured fps at that size |
