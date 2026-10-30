# Phase 5 — quantum components: what exists, what it proves, what it does not

## Evidence classes (never mixed)
| class | modules / scripts | what it is |
|---|---|---|
| **NumPy statevector SIMULATION** | `qsearch/statevec.py`, `dicke.py`, `circuits.py`, `toy.py` | a classical program that applies the gates of toy circuits (≤ 10 qubits). Not a quantum device, not Aer. |
| **Tier B EXACT CLASSICAL EMULATION** | `emulation.py`, `grover.py`, `bbht.py`, `dh_gas.py`, `predicate.py` | exact classical computation of the dynamics of *ideal* amplitude amplification inside the weight-k subspace. Not a quantum runtime. |
| **Aer / noise-model runs** | `scripts/aer_toy_grover.py`, `aer_noise_toy_grover.py`, `qsearch/aer_runner.py` | scripts written; **status NOT_RUN** (no qiskit in the build sandbox). Records in `results/phase5/aer_*.json` say so. |
| **Hardware (E13)** | — | not implemented. |
| **Resource model / Tier C / micro-oracle (A2) / QAOA** | — | **not part of Phase 5 as delivered** (Phase 6 / deferred). |

**No quantum speedup or advantage is claimed or demonstrated.** In Tiers A1 and B the marked set is computed classically (a lookup), and the Tier B predicate table costs N classical evaluations to build.

## Algorithms and their mathematical assumptions
**Search space.** Ω_k = weight-k bit strings (qubit q ↔ branch q, x_q = 1 iff the branch is out; little-endian: qubit q = bit q of the basis index). |D⟩ = C(m,k)^{-1/2} Σ_{|x|=k}|x⟩ is uniform on H_k = span{|x⟩ : |x| = k}. Assumptions: a diagonal ±1 phase oracle and the reflection about |D⟩ both preserve H_k (tested: leakage ≤ 1e-12).

**Grover, known M** (`grover.py`, `emulation.py`). sin θ = √(M/N); after r iterations P = sin²((2r+1)θ); r* = ⌊π/(4θ)⌋ (continuous optimum π/(4θ) − ½). Assumes ideal noiseless gates and an exact oracle.
*Tier B forms (all tested equal):* closed form; class-collapsed recursion (α_{r+1}, β_{r+1}) with oracle (−α, β), μ = (−Mα+(N−M)β)/N, diffuser 2μ − ·; full N-vector inversion about the mean.

**BBHT, unknown M** (`bbht.py`). Schedule m = 1, λ, λ², … ≤ m_cap (default √N), λ = 6/5; each attempt draws j uniform in {0..⌈m⌉−1}, applies j ideal iterations, measures, verifies classically. A schedule ending without success is one failure; `patience` (3) consecutive failures end the search. This is V2 §12.2's variant (cap + restarts), not the original open-ended BBHT. Failure probability is *estimated* (tests: ≥ 98% success over 300 runs in the tested regimes), not asserted. Tested: mean Σj ≤ (9/2)√(N/M) (BBHT theorem) within 3σ for (N,M) ∈ {(190,1),(1000,1),(1000,10)}.

**Dürr–Høyer / GAS-style maximum finding** (`dh_gas.py`), exactly V2 §12.2: mark S > y (strict, 1e-9 tie band), raise y on success, restart the schedule, stop after `patience` exhausted schedules without improvement. Assumptions/resolutions: `verifications` initialised to 0; M = 0 (S_max = y₀) leaves the uniform state untouched, so attempts simply fail; strict `>` guarantees termination with ties; `max_attempts` is only a safety valve. Tested: mean total calls ≤ 22.5√N + 1.4 lg²N (proven bound) on distinct-valued synthetic tables for N ∈ {15,190,1140}, success ≥ 98%; ties and edge cases terminate.

**Accounting** (`accounting.py`; identities tested). Per attempt with j iterations: **quantum oracle calls += j+1**, Grover iterations += j, one measurement, one classical verification. Reported separately: classical verifications (requests and unique), and `table_construction_evals = N` (never part of the quantum count). In `SearchResult`, `oracle_calls` = unique classical verifications; the headline quantum cost is `aux["accounting"]["quantum_oracle_calls"]`; discovery in quantum calls is `aux["discovery_quantum_calls"]`.

**Toy circuits** (Tier A1; `circuits.py`, `toy.py`). Dicke preparation; phase oracle = for each marked x, X on its zero bits, multi-controlled Z on all qubits, X again (a compiled lookup, cost O(|M|·m)); reflection I − 2|D⟩⟨D| = Tree† · Xⁿ · MCZ · Xⁿ · Tree (equals U(I−2|ref⟩⟨ref|)U† for any U with U|1^k0^{m−k}⟩ = |D⟩; tested). It equals −R_D (V2's 2|D⟩⟨D|−I) on H_k: a global sign, irrelevant to probabilities. Grover circuit = Tree, then r × (oracle, reflection). Verified against Tier B and sin²((2r+1)θ) to < 1e-9 for the real N=15 (m=6,k=2) and N=56 (m=8,k=3) toys.

## Deviations from V2 (all documented, none silent)
1. **Dicke preparation is NOT the Bärtschi–Eidenbenz O(kL) circuit.** My reconstruction of its gate list from memory failed numerical verification under 24 convention variants (and 8 more for the literal two-product form), so it is not used. The V2-named exact fallback (explicit amplitude vector → binary tree of multiplexed RY) is used: exact (infidelity ≤ 4.4e-16 for all 0 ≤ k ≤ n ≤ 10), but its gate count is exponential-like (e.g. 466 multiplexed rotations for n=10, k=5). **Consequently V2's resource-model term C_D ≈ k·L·c_rot is NOT supported by this implementation.** Reproducing BE needs the original paper.
2. Reference convention: V2 writes |1^k0^{L−k}⟩; BE writes |0^{L−k}1^k⟩. Used: ones on qubits 0..k−1 (V2's), little-endian.
3. Reflection carries a global sign relative to V2's R_D (no effect on probabilities).
4. Not implemented in Phase 5: ranked-index encoding (§11.4), quantum counting, top-T ranking (Problem 5), the secondary DH run with a heuristic y₀, the A2 micro-oracle, QAOA.

## V2 discrepancies found
* §12.1 worked number: for N = 15, M = 1, r = 2, V2 prints P = 0.933; exact arithmetic gives **0.931399** (r = 3: 0.935242 matches). A small arithmetic slip in V2; the tests assert the exact value.
* §12.2 pseudocode: `verifications` is used uninitialised; behaviour at S_max = y₀ unspecified (resolved above).
* All other worked numbers checked (θ = 0.02962, r* = 26 for N = 1140; r* = 806 for N = 1,055,240; θ = 0.2612) agree.

## Qiskit export caveats (UNVERIFIED against Qiskit)
`qiskit_export.py` assumes (i) `ctrl_state` bit i ↔ i-th control qubit and (ii) little-endian measured bitstrings. The exporter is tested against a recording/replay builder only (including asymmetric control patterns: Dicke-tree circuits are invariant under control-order reversal and therefore cannot detect that bug). These assumptions are checked at run time by the Aer scripts, which compare measured P(marked) with the NumPy simulation for every r (`EXECUTED_VERIFIED` only if all agree within 4σ).

## Phase 8 addendum (supersedes deviation 1 and the "UNVERIFIED against Qiskit" caveat above)
* **Bärtschi–Eidenbenz Dicke preparation is now implemented and verified** (`qsearch/dicke.py: be_dicke_circuit`, `be_unitary_from_reference`):
  infidelity ≤ 1e-14 for every 0 ≤ k ≤ n ≤ 10, support only on weight k, (n−k)k + k(k−1)/2 split-and-cyclic-shift blocks (O(kn)); tests in
  `tests/quantum/test_be_dicke.py`. The Grover circuit takes `prep="be"`; the tree remains the default for backward compatibility.
* **Qiskit export conventions are verified against real Qiskit** (`Statevector` of exported circuits equals the NumPy simulator on random asymmetric
  multi-controlled rotations, the tree, the BE circuit and BE Grover).
* **Aer runs executed** (E4 statevector equivalence, E5 ideal sampling and FakeSherbrooke noise model): see `results/phase7/REPORT.md`. Aer is a classical
  simulator; E13 (IBM device) is NOT RUN.
* Implemented in Phase 10–11: top-T (`qsearch/topt.py`), QAOA on the weight-k subspace (`qsearch/qaoa.py`, `surrogate.py`), A2 micro-oracle
  (`qsearch/microoracle.py`). Quantum counting remains not implemented (M is table-derived).
