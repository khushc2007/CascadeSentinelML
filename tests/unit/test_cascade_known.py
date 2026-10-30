"""U9 / U10 / U11 style tests with hand-derived expectations. See comments for the derivations."""
import numpy as np
from doomsday.config import load_config
from doomsday.gridtwin.cascade import CascadeEngine
from helpers import chain4, make_bp

def eng(case, rating, **cascade):
    cfg = load_config(overrides={"cascade": cascade} if cascade else None)
    return CascadeEngine(make_bp(case, rating), cfg)

R_CHAIN = [100.0, 40.0, 40.0]            # ratings of 1-2, 2-3, 3-4

# Hand derivation, outage {1-2}: island {1}: G1 surplus -> 0 MW. Island {2,3,4}: G4 30 MW vs load 100: deficit 70,
# headroom 20 -> G4 = 50, remaining 50 MW -> uniform curtailment factor 0.5 (bus2 20, bus3 30). Flows: 4->3 50, 3->2 20.
# u(3-4)=50/40=1.25 trips. Round 1: {2,3} has no generator (dead), {4} has no load: nothing served. S=1, S0=0.5, C=0.5.
def test_U9_two_round_cascade_with_redispatch_curtailment_trip_dead_island():
    for mode in ("dc", "ac"):
        r = eng(chain4(), R_CHAIN).run([0], mode=mode)
        assert r.status == "TOTAL_LOSS" and r.rounds == 2
        assert r.trips_per_round == [[2], []] and r.islands_per_round == [2, 3]
        assert abs(r.S0 - 0.5) < 1e-9 and abs(r.S - 1.0) < 1e-12 and abs(r.C - 0.5) < 1e-9
        assert abs(r.A - 1.0 / 0.5) < 1e-9
        assert abs(r.frames[0]["loading"]["2"] - (1.25 if mode == "dc" else r.frames[0]["loading"]["2"])) < 1e-9
        assert r.frames[0]["overloaded"] == [2] and r.frames[0]["energized_buses"] == [1, 2, 3, 4]
        assert abs(r.frames[0]["loading"]["1"] - 0.5) < 0.01       # 3->2 carries 20 MW of rating 40 (AC adds Q)
        assert r.final_out_of_service == [0, 2]

def test_dc_round0_loadings_exact_hand_values():
    r = eng(chain4(), R_CHAIN).run([0], mode="dc")
    assert abs(r.frames[0]["loading"]["2"] - 1.25) < 1e-9 and abs(r.frames[0]["loading"]["1"] - 0.5) < 1e-9
    assert abs(r.frames[0]["load_served"] - 0.5) < 1e-12

def test_no_upward_redispatch_variant():
    # Without upward redispatch G4 stays at 30 MW -> factor 0.3, flows 30 and 12 MW -> no overload. S = S0 = 0.7.
    r = eng(chain4(), R_CHAIN, redispatch="no_upward").run([0], mode="dc")
    assert r.status == "STABLE" and r.rounds == 1 and abs(r.S - 0.7) < 1e-9 and abs(r.C) < 1e-12

# rating(2-3)=15: u(2-3)=20/15=1.333 and u(3-4)=1.25. Simultaneous: both trip -> every load island dead -> S=1.
# Sequential (most overloaded first): only 2-3 trips; island {3,4} keeps G4 (pg 50 -> 30 for bus3's 30 MW), 20 MW at bus 2 lost.
# After round 1: loading 4->3 30/40 -> STABLE with S=0.7, S0=0.5, C=0.2.
def test_trip_policies_simultaneous_vs_sequential():
    rat = [100.0, 15.0, 40.0]
    a = eng(chain4(), rat).run([0], mode="dc", policy="all_overloaded")
    assert a.trips_per_round == [[1, 2], []] and a.status == "TOTAL_LOSS" and abs(a.S - 1.0) < 1e-12
    b = eng(chain4(), rat).run([0], mode="dc", policy="most_overloaded_first")
    assert b.trips_per_round == [[1], []] and b.status == "STABLE" and b.rounds == 2
    assert abs(b.S - 0.7) < 1e-9 and abs(b.S0 - 0.5) < 1e-9 and abs(b.C - 0.2) < 1e-9
    assert a.policy == "all_overloaded" and b.policy == "most_overloaded_first"

def test_exhausted_state_flagged_and_uses_last_solved_round():
    r = eng(chain4(), R_CHAIN, max_rounds=1).run([0], mode="dc")
    assert r.status == "EXHAUSTED" and r.flags["exhausted"] and r.rounds == 1
    assert abs(r.S - 0.5) < 1e-9                       # last SOLVED round (post-trip state never solved)

def test_parallel_lines_independent_trip_logic():
    case = """mpc.baseMVA = 100;
mpc.bus = [ 1 3 0 0 0 0 1 1.0 0 0 1 1.1 0.9; 2 1 100 0 0 0 1 1.0 0 0 1 1.1 0.9; ];
mpc.gen = [ 1 100 0 200 -200 1.0 100 1 300 0; ];
mpc.branch = [ 1 2 0 0.1 0 0 0 0 0 0 1; 1 2 0 0.1 0 0 0 0 0 0 1; ];"""
    e = eng(case, 60.0)
    base = e.run([], mode="dc")
    assert base.status == "STABLE" and abs(base.frames[0]["loading"]["0"] - 50 / 60) < 1e-9
    r = e.run([0], mode="dc")                          # other line must carry 100 MW > 60 -> trips -> bus 2 dead
    assert r.trips_per_round == [[1], []] and r.status == "TOTAL_LOSS" and abs(r.S - 1) < 1e-12 and r.S0 == 0.0
    both = e.run([0, 1], mode="dc")
    assert abs(both.S0 - 1.0) < 1e-12 and both.C == 0.0

def test_isolation_only_zero_cascade_loss_and_strict_overload_tolerance():
    # outage {3-4}: G1 raised 70->100 (its Pmax) serves all 100 MW; 1-2 carries exactly 100 = rating -> NOT an overload
    # (strict '>' with 1e-9 tolerance). 2-3 carries 60 MW; with rating 70 it is fine.
    r = eng(chain4(), [100.0, 70.0, 40.0]).run([2], mode="dc")
    assert r.status == "STABLE" and r.S == 0.0 and r.rounds == 1 and r.trips_per_round == [[]]
    assert abs(r.frames[0]["loading"]["0"] - 1.0) < 1e-9 and abs(r.frames[0]["loading"]["1"] - 60 / 70) < 1e-9

def test_cascade_driven_case_s0_zero_c_positive():
    # same outage, but rating(2-3)=40 < 60 MW: 2-3 trips in round 0 (u=1.5); bus 3 (60 MW) becomes a dead island.
    # Round 1: island {1,2}: G1 surplus scaled to 40 MW; bus 3 dead; bus 4 has no load. S = 0.6, S0 = 0, C = 0.6.
    r = eng(chain4(), R_CHAIN).run([2], mode="dc")
    assert r.status == "STABLE" and r.trips_per_round == [[1], []] and r.rounds == 2 and r.islands_per_round == [2, 3]
    assert abs(r.S - 0.6) < 1e-9 and r.S0 == 0.0 and abs(r.C - 0.6) < 1e-9 and abs(r.A - 0.6 / 0.01) < 1e-6
    from doomsday.gridtwin.severity import is_cascade_driven
    assert is_cascade_driven(r.S, r.C, 0.20, 0.10)

def test_pmin_violation_flagged():
    r = eng(chain4(pmin1=50.0), R_CHAIN).run([0], mode="dc")    # island {1}: surplus forces G1 to 0 < Pmin
    assert r.flags["pmin_violation"] is True
    assert eng(chain4(), R_CHAIN).run([0], mode="dc").flags["pmin_violation"] is False

def test_invalid_outage_rejected():
    e = eng(chain4(), R_CHAIN)
    for bad in ([0, 0], [5], [-1]):
        try:
            e.run(bad)
        except ValueError:
            continue
        raise AssertionError(bad)

# 2 buses, 2 parallel lines x=1.0 (r=0). Two lines: P_max = 100 MW; one line: P_max = V1^2/(2x) = 50 MW (analytic nose).
# Load 60 MW is feasible with both lines, infeasible after losing one -> NR fails -> ladder scales load by (1-0.05 j).
LADDER_CASE = """mpc.baseMVA = 100;
mpc.bus = [ 1 3 0 0 0 0 1 1.0 0 0 1 1.1 0.9; 2 1 60 0 0 0 1 1.0 0 0 1 1.1 0.9; ];
mpc.gen = [ 1 60 0 500 -500 1.0 100 1 500 0; ];
mpc.branch = [ 1 2 0 1.0 0 0 0 0 0 0 1; 1 2 0 1.0 0 0 0 0 0 0 1; ];"""

def test_U11_ac_ladder_constructed_infeasible_case_deterministic_and_flagged():
    e = eng(LADDER_CASE, 1.0e4)
    assert e.run([], mode="ac").status == "STABLE" and e.run([], mode="ac").S == 0.0     # base feasible
    r1 = e.run([0], mode="ac"); r2 = e.run([0], mode="ac")
    j = r1.ladder_step
    assert r1.flags["nonconv_flag"] and j is not None and 4 <= j <= 6      # 60(1-0.05j) must drop below the 50 MW nose
    assert abs(r1.S - 0.05 * j) < 1e-9 and abs(r1.S0 - r1.S) < 1e-12 and r1.status == "STABLE"
    assert abs(r1.S_total - 1.0) < 1e-12                                    # bound: failed island fully lost
    assert r1.S <= r1.S_total
    assert r1.flags["ladder_events"][0]["step"] == j
    assert (r1.S, r1.ladder_step, r1.S_total) == (r2.S, r2.ladder_step, r2.S_total)    # deterministic
    # same outage in DC has no voltage limit: no flag
    d = e.run([0], mode="dc"); assert d.S == 0.0 and not d.flags["nonconv_flag"]
    # ladder disabled (immediate total loss, a V2 8.7 variant)
    t = e.run([0], mode="ac", ladder="total_loss")
    assert abs(t.S - 1.0) < 1e-12 and t.flags["ladder_events"][0]["step"] == "deenergized" and t.status == "TOTAL_LOSS"

def test_overload_tolerance_band_1e9_is_honoured():
    # loading 1 + 5e-10 is inside the 1e-9 band (no trip); 1 + 5e-9 is outside (trips).
    inside = eng(chain4(), [100.0 / (1 + 5e-10), 70.0, 40.0]).run([2], mode="dc")
    assert inside.status == "STABLE" and inside.trips_per_round == [[]]
    outside = eng(chain4(), [100.0 / (1 + 5e-9), 70.0, 40.0]).run([2], mode="dc")
    assert outside.trips_per_round[0] == [0]

def test_sequential_policy_picks_argmax_not_lowest_index():
    # outage {1-2}: u(2-3)=20/18=1.111, u(3-4)=50/40=1.25 -> sequential trips 3-4 (index 2) first, not 2-3 (index 1).
    r = eng(chain4(), [100.0, 18.0, 40.0]).run([0], mode="dc", policy="most_overloaded_first")
    assert r.frames[0]["overloaded"] == [1, 2] and r.trips_per_round[0] == [2]

def test_sequential_ties_break_to_lowest_index():
    case = """mpc.baseMVA = 100;
mpc.bus = [ 1 3 0 0 0 0 1 1.0 0 0 1 1.1 0.9; 2 1 100 0 0 0 1 1.0 0 0 1 1.1 0.9; ];
mpc.gen = [ 1 100 0 200 -200 1.0 100 1 300 0; ];
mpc.branch = [ 1 2 0 0.1 0 0 0 0 0 0 1; 1 2 0 0.1 0 0 0 0 0 0 1; 1 2 0 0.1 0 0 0 0 0 0 1; ];"""
    # outage {0}: lines 1,2 each carry 50 MW (rating 40, equal loading 1.25): tie -> lowest index (1) trips first, then 2
    r = eng(case, 40.0).run([0], mode="dc", policy="most_overloaded_first")
    assert r.frames[0]["overloaded"] == [1, 2] and r.trips_per_round == [[1], [2], []] and r.status == "TOTAL_LOSS"
    assert eng(case, 40.0).run([0], mode="dc", policy="all_overloaded").trips_per_round == [[1, 2], []]
