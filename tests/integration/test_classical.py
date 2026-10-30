import itertools, json, tempfile
import numpy as np
import networkx as nx
from doomsday.config import load_config
from doomsday.gridtwin import contingency as ct
from doomsday.gridtwin.base import build_base_point
from doomsday.gridtwin.dc import dc_power_flow
from doomsday.oracle.factory import make_oracle
from doomsday.oracle.table_oracle import TableOracle, generate_truth_table
from doomsday.classical import METHODS, STOCHASTIC, classical_search
from doomsday.classical.structural import Struct
from doomsday.classical.methods_structural import solve_interdiction_milp, static_dc_shed

CFG = load_config(); BP = build_base_point("ieee14", CFG)
_ROOT = tempfile.mkdtemp(); _C = {}
def table(fid, k):
    """Table oracle with all lower-k tables (needed by beam search)."""
    if (fid, k) not in _C:
        ds = [generate_truth_table(make_oracle(fid, j, CFG, bp=BP, use_cache=False), _ROOT, grid_name="ieee14") for j in range(1, k + 1)]
        _C[(fid, k)] = TableOracle.load(ds, k)
    return _C[(fid, k)]
def truth(o):
    S = o.all_severities(); return S, S.max(), int((S >= S.max() - 1e-9).sum())

def test_brute_force_is_exact_certified_and_lexicographically_first():
    for k in (2, 3):
        o = table("dc", k); S, smax, M = truth(o)
        r = classical_search(o, "brute", target=smax, grid="ieee14")
        assert r.oracle_calls == o.space.N == r.certified_stop_calls and r.completed and r.exact is True
        assert abs(r.best_severity - smax) < 1e-12 and r.best_rank == int(np.argmax(S >= smax - 1e-9))   # first maximiser in lex order
        assert r.best_contingency == o.space.unrank(r.best_rank) and r.found_target is True
        assert r.discovery_calls == r.best_rank + 1 and r.candidate_evaluations == r.oracle_calls
        cut = classical_search(o, "brute", budget=50)
        assert cut.oracle_calls == 50 and not cut.completed and cut.certified_stop_calls is None

def test_random_search_unique_seeded_and_matches_the_N_over_M_plus_1_law():
    o = table("dc", 2); S, smax, M = truth(o); N = o.space.N
    disc = []
    for seed in range(300):
        r = classical_search(o, "random", seed=seed, target=smax, stop_on_target=True)
        assert r.oracle_calls == r.candidate_evaluations                      # without replacement: no repeats
        disc.append(r.discovery_calls)
    expected = (N + 1) / (M + 1); sd = np.std(disc) / np.sqrt(len(disc))
    assert abs(np.mean(disc) - expected) < 4 * sd + 1e-9, (np.mean(disc), expected)    # statistical check of the classical baseline law
    a = classical_search(o, "random", seed=5, budget=40); b = classical_search(o, "random", seed=5, budget=40); c = classical_search(o, "random", seed=6, budget=40)
    assert a.trace == b.trace and a.best_contingency == b.best_contingency and a.oracle_calls == 40
    assert a.trace != c.trace or a.best_contingency != c.best_contingency

def test_all_methods_are_reproducible_budget_respecting_and_return_valid_sets():
    o = table("dc", 3); S, smax, M = truth(o)
    kw = {"beam": {"width": 5}, "lodf_pool": {"m": 10}, "ml_screen": {"n_train": 60, "T": 30}, "bnb": {"theta": 0.5}, "milp": {}}
    for m in METHODS:
        if m == "milp": continue
        r1 = classical_search(o, m, seed=11, budget=400, **kw.get(m, {})); r2 = classical_search(o, m, seed=11, budget=400, **kw.get(m, {}))
        assert r1.oracle_calls <= 400 and r1.trace == r2.trace and r1.best_contingency == r2.best_contingency, m
        assert r1.oracle_calls == r2.oracle_calls and r1.candidate_evaluations >= r1.oracle_calls - 0, m
        assert len(r1.best_contingency) == 3 and o.severity(r1.best_contingency) == r1.best_severity, m          # reported best is genuinely that set's S
        assert r1.best_rank == o.space.rank(r1.best_contingency) and S[r1.best_rank] == r1.best_severity
        d = json.loads(json.dumps(r1.to_dict()))
        for key in ("algorithm", "grid", "k", "objective", "oracle_calls", "candidate_evaluations", "runtime_s", "best_severity", "best_contingency"):
            assert key in d, (m, key)
    # seeds matter for stochastic methods only
    for m in STOCHASTIC - {"ml_screen"}:
        assert classical_search(o, m, seed=1, budget=300).trace != classical_search(o, m, seed=2, budget=300).trace, m

def test_search_code_cannot_distinguish_table_from_live_oracle():
    # identical results (trace, best set, call counts) for EVERY method on the table oracle and the live cascade oracle
    tab = table("dc", 2); S, smax, M = truth(tab)
    kw = {"beam": {"width": 5}, "lodf_pool": {"m": 8}, "ml_screen": {"n_train": 40, "T": 20}, "milp": {}}
    for m in METHODS:
        live = make_oracle("dc", 2, CFG, bp=BP)
        a = classical_search(tab, m, seed=3, budget=150, target=smax, **kw.get(m, {})); b = classical_search(live, m, seed=3, budget=150, target=smax, **kw.get(m, {}))
        assert (a.trace, a.best_contingency, a.best_severity, a.oracle_calls, a.candidate_evaluations, a.discovery_calls) == \
               (b.trace, b.best_contingency, b.best_severity, b.oracle_calls, b.candidate_evaluations, b.discovery_calls), m
        assert a.oracle_kind == "table" and b.oracle_kind == "cascade"

def test_stop_on_target_and_found_flags():
    o = table("dc", 3); S, smax, _ = truth(o)
    r = classical_search(o, "sa", seed=0, target=smax, stop_on_target=True)
    assert r.found_target is True and r.discovery_calls == r.oracle_calls and r.trace[-1][1] >= smax - 1e-9 and not r.completed
    r = classical_search(o, "lodf_pool", m=6, target=smax)
    assert r.oracle_calls == 20 and r.found_target in (True, False) and r.completed

def test_hill_climb_returns_genuine_local_optima_with_stress_start():
    o = table("dc", 3); S, _, _ = truth(o); L = 20
    r = classical_search(o, "hillclimb", seed=4, n_starts=6)
    st = Struct(o.structure()); assert r.aux["local_optima"][0][0] != [] and r.aux["n_starts"] == 6
    for cur, Sc in r.aux["local_optima"]:
        cur = tuple(cur); assert abs(o.severity(cur) - Sc) < 1e-12
        for i in range(3):
            for c in range(L):
                if c in cur: continue
                nb = tuple(sorted(cur[:i] + cur[i + 1:] + (c,)))
                assert o.severity(nb) <= Sc + 1e-9, (cur, nb)               # no strictly better swap neighbour: true local optimum
    start = tuple(st.top_branches(3)); fresh = classical_search(o, "hillclimb", seed=99, n_starts=1)
    assert fresh.trace[0][0] == 1 and fresh.best_severity >= o.severity(start) - 1e-12      # first start = structural start, never worse

def test_beam_search_accounting_and_wide_beam_equals_brute_force():
    o = table("dc", 2); S, smax, _ = truth(o)
    from math import comb
    for width in (1, 3, 5, 10, 19, 20):                                  # EXACT count: L singles + pairs containing >=1 beam member
        r = classical_search(o, "beam", width=width)
        assert r.oracle_calls == 20 + (190 - comb(20 - width, 2)), (width, r.oracle_calls)
        assert r.candidate_evaluations == r.oracle_calls
    w = classical_search(o, "beam", width=20, target=smax)
    assert abs(w.best_severity - smax) < 1e-12 and w.oracle_calls == 20 + 190       # width >= L keeps every single -> exhaustive
    o3 = table("dc", 3); r3 = classical_search(o3, "beam", width=5)
    assert r3.oracle_calls <= 20 + 5 * 19 + 5 * 18 * 1 + 200 and o3.severity(r3.best_contingency) == r3.best_severity
    # with only a k=3 table (no k=1,2 tables) beam cannot silently invent partial values
    only3 = TableOracle.load([d for d in __import__("pathlib").Path(_ROOT).glob("ieee14_dc_k3_*")], 3)
    try: classical_search(only3, "beam", width=5)
    except ValueError as e: assert "no table" in str(e)
    else: raise AssertionError("beam on a k=3-only table must fail loudly")

def test_structural_stress_matches_full_dc_resolve_and_independent_island_logic():
    o = table("dc", 2); f = o.structure(); st = Struct(f); g = BP.grid; n_isl = n_ok = 0
    for K in itertools.combinations(range(20), 2):
        s = g.br_status.copy(); s[list(K)] = 0
        G = nx.Graph(); G.add_nodes_from(range(g.n_bus)); G.add_edges_from((int(g.br_from[l]), int(g.br_to[l])) for l in range(20) if s[l])
        if nx.is_connected(G):
            u = np.abs(dc_power_flow(g, BP.dc_injections_mw, s).flow_mw) / g.rating_dc
            assert abs(st.stress(K) - u.max()) < 1e-8, K; n_ok += 1
        else:
            gen_b = {int(b) for b in g.gen_bus[g.gen_Pmax > 0]}
            lost = sum(g.Pd[list(c)].sum() for c in nx.connected_components(G) if not (set(c) & gen_b)) / g.Pd.sum()
            assert abs(st.analyse(K)["iso"] - lost) < 1e-12 and st.analyse(K)["islanding"]
            assert abs(st.stress(K) - ((1 + lost) if lost > 0 else 0.0)) < 1e-12; n_isl += 1
    assert n_ok > 100 and n_isl > 10
    s, ops = st.branch_scores(); assert ops == 190 and s.shape == (20,) and np.all(s >= 0)

def test_lodf_pool_accounting_and_pool_definition():
    o = table("dc", 3); st = Struct(o.structure()); sc, _ = st.branch_scores()
    for m in (8, 12, 16):
        r = classical_search(o, "lodf_pool", m=m)
        assert r.oracle_calls == ct.n_sets(m, 3) and r.aux["structural_ops_ranking"] == 190 and r.aux["pool"] == st.top_branches(m)
        assert set(r.aux["pool"]) == set(np.argsort(-sc, kind="stable")[:m].tolist()) or sc[r.aux["pool"]].min() >= np.sort(sc)[::-1][m - 1] - 1e-12
        assert all(set(r.best_contingency) <= set(r.aux["pool"]) for _ in [0])
    try: classical_search(o, "lodf_pool", m=2)
    except ValueError: pass
    else: raise AssertionError("pool smaller than k accepted")

def test_ml_screen_cost_accounting_no_leakage_and_features():
    o = table("dc", 3)
    r = classical_search(o, "ml_screen", seed=2, n_train=80, T=40)
    assert r.oracle_calls == 120 == r.aux["cost_train_plus_T"] and r.aux["candidates_scored"] == 1140 - 80 and r.aux["n_features"] == 14
    st = Struct(o.structure()); X = o.space.unrank_batch(np.arange(0, 1140, 7)); F = st.features(X)
    assert F.shape == (len(X), 14) and np.isfinite(F).all()
    assert classical_search(o, "ml_screen", seed=2, n_train=80, T=40).trace == r.trace          # seeded
    assert classical_search(o, "ml_screen", seed=3, n_train=80, T=40).trace != r.trace

def test_milp_matches_enumeration_of_the_static_defender_lp_and_is_reevaluated_under_the_cascade_oracle():
    o = table("dc", 3); f = o.structure()
    for k in (2, 3):
        vals = {K: static_dc_shed(f, K) for K in itertools.combinations(range(20), k)}; best = max(vals.values())
        for lam in (3.0, 10.0):                                                                   # result must not depend on the dual box
            r = solve_interdiction_milp(f, k, lam_bound=lam)
            assert r["status"] == 0 and abs(r["obj"] - best) < 1e-6 and abs(vals[r["x"]] - best) < 1e-6
    ok = table("dc", 2); res = classical_search(ok, "milp", n_solutions=4)
    sols = res.aux["solutions"]; assert len(sols) == 4 and res.oracle_calls == 4                  # only the re-evaluations are oracle calls
    objs = [s["obj"] for s in sols]; assert objs == sorted(objs, reverse=True) and len({s["x"] for s in sols}) == 4      # no-good cuts
    fk = ok.structure(); allv = sorted((static_dc_shed(fk, K) for K in itertools.combinations(range(20), 2)), reverse=True)
    assert all(abs(a - b) < 1e-6 for a, b in zip(objs, allv[:4]))                                  # = the 4 best static values
    for s in sols: assert s["cascade_S"] == ok.severity(s["x"]) and abs(s["static_lp_check"] - s["obj"]) < 1e-6
    assert res.exact is None and "different severity" in res.label

def test_branch_and_bound_is_labelled_heuristic_and_theta_zero_equals_exhaustive():
    o = table("dc", 3); S, smax, _ = truth(o)
    r0 = classical_search(o, "bnb", theta=0.0, target=smax)
    assert r0.aux["leaves_evaluated"] == 1140 and abs(r0.best_severity - smax) < 1e-12 and r0.exact is False
    assert r0.aux["heuristic_bound_not_rigorous"] and "heuristic" in r0.label
    leaves = [classical_search(o, "bnb", theta=t).aux["leaves_evaluated"] for t in (0.0, 0.3, 0.5, 0.8)]
    assert leaves == sorted(leaves, reverse=True) and leaves[0] > leaves[-1]                       # stricter threshold prunes more

def test_methods_work_unchanged_on_the_ac_fidelity():
    o = table("ac", 2); S, smax, _ = truth(o)
    b = classical_search(o, "brute"); assert b.fidelity == "ac" and abs(b.best_severity - smax) < 1e-12
    live = make_oracle("ac", 2, CFG, bp=BP); assert live.severity(b.best_contingency) == b.best_severity
    assert classical_search(o, "hillclimb", seed=1, n_starts=3).best_severity <= smax + 1e-12

def test_unknown_method_and_invalid_params_fail_loudly():
    o = table("dc", 2)
    for call in (lambda: classical_search(o, "nope"), lambda: classical_search(o, "beam", width=0) if False else classical_search(o, "lodf_pool", m=1)):
        try: call()
        except (KeyError, ValueError): continue
        raise AssertionError


def test_genetic_algorithm_elitism_and_population_invariants():
    o = table("dc", 3)
    for seed in range(5):
        r = classical_search(o, "ga", seed=seed, pop=30, n_gen=25, elite=3)
        gb, ps = r.aux["gen_best"], r.aux["pop_sizes"]
        assert len(gb) == 25 and all(p == 30 for p in ps)                       # population size constant (elites + kids = pop)
        assert all(b >= a - 1e-15 for a, b in zip(gb, gb[1:]))                  # elitism: best-of-population never decreases
        assert r.best_severity >= gb[-1] - 1e-15

def test_lodf_pool_over_all_branches_is_exhaustive():
    # sanity that the pool LOGIC is right: m = L must reproduce brute force (so a weak pool result at small m is a finding, not a bug)
    for k in (2, 3):
        o = table("dc", k); S, smax, _ = truth(o)
        r = classical_search(o, "lodf_pool", m=20, target=smax)
        assert r.oracle_calls == o.space.N and r.found_target and abs(r.best_severity - smax) < 1e-12

def test_bnb_budget_cap_masks_theta_but_unbudgeted_runs_differ():
    o = table("dc", 3); S, smax, _ = truth(o)
    capped = [classical_search(o, "bnb", theta=t, budget=100, target=smax).oracle_calls for t in (0.5, 0.95)]
    assert capped[0] == capped[1] == 100                      # budget binds first: theta cannot matter
    free = [classical_search(o, "bnb", theta=t).aux["leaves_evaluated"] for t in (0.5, 0.95)]
    assert free[0] > free[1]
