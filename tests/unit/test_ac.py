import numpy as np
from doomsday.gridtwin.ac import ac_jacobian, build_ybus, solve_ac, scheduled
from doomsday.gridtwin.dc import dc_power_flow, incidence
from doomsday.gridtwin.loader import load_grid, parse_matpower
from helpers import assert_close, triangle

def test_U2_two_bus_analytic_round_trip():
    # Pick V2, delta2, compute the load that produces them with a closed-form lossy line, then recover them.
    r_, x_, V1, V2, d2 = 0.02, 0.10, 1.0, 0.97, -0.08
    z = r_ + 1j * x_
    v1, v2 = V1 + 0j, V2 * np.exp(1j * d2)
    s_abs = v2 * np.conj((v1 - v2) / z)           # complex power absorbed at bus 2 (closed form, independent of Ybus)
    P, Q = float(100 * s_abs.real), float(100 * s_abs.imag)
    case = f"""mpc.baseMVA = 100;
mpc.bus = [ 1 3 0 0 0 0 1 1.0 0 0 1 1.1 0.9; 2 1 {P!r} {Q!r} 0 0 1 1.0 0 0 1 1.1 0.9; ];
mpc.gen = [ 1 0 0 100 -100 {V1} 100 1 500 0; ];
mpc.branch = [ 1 2 {r_} {x_} 0 0 0 0 0 0 1; ];"""
    g = parse_matpower(case)
    res = solve_ac(g, tol=1e-12)
    assert res.converged
    assert abs(res.Vm[1] - V2) < 1e-9 and abs(np.angle(res.V[1]) - d2) < 1e-9

def test_case14_matches_published_solution():
    # Reference values: published MATPOWER case14 power-flow results (recalled; 4-digit / 2-digit rounding).
    g = load_grid("ieee14"); r = solve_ac(g, tol=1e-8, max_iter=30)
    assert r.converged and r.iterations <= 10 and r.mismatch_pu < 1e-8
    vm = [1.060, 1.045, 1.010, 1.0177, 1.0195, 1.070, 1.0615, 1.090, 1.0559, 1.0510, 1.0569, 1.0552, 1.0504, 1.0355]
    va = [0, -4.98, -12.72, -10.31, -8.77, -14.22, -13.36, -13.36, -14.94, -15.10, -14.79, -15.07, -15.16, -16.04]
    assert_close(r.Vm, vm, 2e-4, "Vm")
    assert_close(r.Va_deg, va, 0.03, "Va")
    assert abs(r.bus_gen_p_mw[0] - 232.39) < 0.01
    assert_close(r.bus_gen_q_mvar[[0, 1, 2, 5, 7]], [-16.55, 43.56, 25.08, 12.73, 17.62], 0.02, "Qg")
    assert abs(r.losses_mw - 13.39) < 0.01

def test_case14_internal_consistency_bus_balance():
    g = load_grid("ieee14"); r = solve_ac(g)
    pf = r.Sf_mva.real; pt = r.St_mva.real
    out_p = np.zeros(14); out_q = np.zeros(14)
    np.add.at(out_p, g.br_from, r.Sf_mva.real); np.add.at(out_p, g.br_to, r.St_mva.real)
    np.add.at(out_q, g.br_from, r.Sf_mva.imag); np.add.at(out_q, g.br_to, r.St_mva.imag)
    out_p += g.Gs * r.Vm ** 2; out_q -= g.Bs * r.Vm ** 2     # shunt: S = V^2 conj(Gs+jBs) -> Q = -Bs V^2 absorbed negative
    assert_close(out_p, r.P_inj_mw, 1e-6, "P balance from branch flows")
    assert_close(out_q, r.Q_inj_mvar, 1e-6, "Q balance from branch flows")
    assert abs((pf + pt).sum() - r.losses_mw) < 1e-6

def test_jacobian_matches_finite_difference():
    g = load_grid("ieee14"); Y = build_ybus(g)
    pv = np.flatnonzero(g.bus_type == 2); pq = np.flatnonzero(g.bus_type == 1)
    pvpq = np.concatenate([pv, pq])
    rng = np.random.default_rng(0)
    V = (1 + 0.03 * rng.standard_normal(14)) * np.exp(1j * 0.1 * rng.standard_normal(14))
    J = ac_jacobian(Y, V, pv, pq)
    def f(x):
        Va, Vm = np.angle(V).copy(), np.abs(V).copy()
        Va[pvpq] = x[:len(pvpq)]; Vm[pq] = x[len(pvpq):]
        S = (Vm * np.exp(1j * Va)) * np.conj(Y @ (Vm * np.exp(1j * Va)))
        return np.concatenate([S[pvpq].real, S[pq].imag])
    x0 = np.concatenate([np.angle(V)[pvpq], np.abs(V)[pq]]); h = 1e-6
    Jn = np.column_stack([(f(x0 + h * e) - f(x0 - h * e)) / (2 * h) for e in np.eye(len(x0))])
    assert_close(J, Jn, 1e-5, "Jacobian")

def test_non_convergence_reported_not_raised():
    g = load_grid("ieee14").with_(Pd=load_grid("ieee14").Pd * 40, Qd=load_grid("ieee14").Qd * 40)
    r = solve_ac(g)
    assert r.converged is False

def test_ac_vs_dc_agree_roughly_on_lightly_loaded_triangle():
    g = triangle().with_(r=np.zeros(3))
    ac = solve_ac(g, tol=1e-12); dc = dc_power_flow(g, [100.0, -60.0, -40.0])
    # angle/flow agreement to a few percent: DC is an approximation (not a tolerance for equality)
    assert_close(ac.Sf_mva.real, dc.flow_mw, 0.05 * np.abs(dc.flow_mw).max())

def test_deterministic_repeat():
    g = load_grid("ieee14")
    a, b = solve_ac(g), solve_ac(g)
    assert np.array_equal(a.V, b.V)

def test_islanded_ac_rejected():
    g = load_grid("ieee14"); s = g.br_status.copy(); s[13] = 0
    try:
        solve_ac(g, s)
    except ValueError:
        return
    raise AssertionError("should reject islands in Phase 1")

def test_phase_shifter_and_tap_against_closed_form():
    # Lossless 2-bus branch with ratio and phase shift: Pf = Vf*Vt/(ratio*x) * sin(df - dt - phi); Pf + Pt = 0.
    for ratio, phi_deg in ((1.0, 10.0), (0.95, -7.0), (1.05, 4.0)):
        case = f"""mpc.baseMVA = 100;
mpc.bus = [ 1 3 0 0 0 0 1 1.0 0 0 1 1.1 0.9; 2 1 50 0 0 0 1 1.0 0 0 1 1.1 0.9; ];
mpc.gen = [ 1 0 0 100 -100 1.0 100 1 500 0; ];
mpc.branch = [ 1 2 0 0.2 0 0 0 0 {ratio} {phi_deg} 1; ];"""
        g = parse_matpower(case); r = solve_ac(g, tol=1e-12)
        assert r.converged
        phi = np.deg2rad(phi_deg); df, dt = np.angle(r.V)
        pf_formula = abs(r.V[0]) * abs(r.V[1]) / (ratio * 0.2) * np.sin(df - dt - phi) * 100
        assert abs(r.Sf_mva.real[0] - pf_formula) < 1e-6, (ratio, phi_deg)
        assert abs(r.Sf_mva.real[0] + r.St_mva.real[0]) < 1e-9          # lossless
        assert abs(r.St_mva.real[0] + 50.0) < 1e-6                      # delivers the 50 MW load
