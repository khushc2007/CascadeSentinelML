"""Phase 7 engine options (all opt-in; defaults unchanged): E11 rating families, E3c per-engine DC rating basis,
seeded rating perturbation, E12 fixed-point DC emulation (V2 17.1, Test U12), BASE_KV parsing."""
import numpy as np, pytest
from doomsday.config import ConfigError, load_config
from doomsday.gridtwin.base import build_base_point
from doomsday.gridtwin.cascade import CascadeEngine, quantize_pu
from doomsday.gridtwin.dc import dc_power_flow
from doomsday.gridtwin.identity import grid_content_hash
from doomsday.gridtwin.loader import load_grid
from doomsday.gridtwin.ratings import RatingDataError, branch_voltage_class
from doomsday.gridtwin.contingency import space_for_grid

def _bp(grid="ieee14", **rating):
    return build_base_point(grid, load_config(overrides={"grid": grid, "rating": rating}))

def test_base_kv_parsed_and_excluded_from_content_hash():
    g = load_grid("ieee118")
    assert sorted(set(g.bus_base_kv.tolist())) == [138.0, 161.0, 345.0]
    assert grid_content_hash(g.with_(bus_base_kv=g.bus_base_kv * 0)) == grid_content_hash(g)
    # official MATPOWER case14 has exactly the content hash of the transcribed file it replaced
    assert grid_content_hash(load_grid("ieee14")) == "252b9b054db0bf75cc179b3f345be5238b0f156303ba493a5e4e5cf6c5de22bc"

def test_voltage_class_family_uniform_within_class_and_covers_own_base_flow():
    for grid, ncls in (("ieee14", 1), ("ieee30", 1), ("ieee118", 3)):
        bp = _bp(grid, family="voltage_class"); g = bp.grid; cls = branch_voltage_class(g)
        assert bp.rating_info["n_classes"] == ncls
        p0 = np.maximum(np.abs(bp.ac.Sf_mva.real), np.abs(bp.ac.St_mva.real))
        for c in np.unique(cls):
            sel = cls == c
            assert np.allclose(g.rating_dc[sel], max(1.25 * p0[sel].max(), 0.05 * p0.max()))
        assert np.all(g.rating_dc >= 1.25 * p0 - 1e-9) and np.all(g.rating_ac >= 1.25 * bp.ac.apparent_mva - 1e-9)

def test_case_file_family_uses_rate_a_and_fails_loudly_without_it():
    bp = _bp("ieee30", family="case_file")
    assert np.array_equal(bp.grid.rating_ac, bp.grid.rate_a_case) and np.array_equal(bp.grid.rating_dc, bp.grid.rate_a_case)
    for grid in ("ieee14", "ieee118"):
        with pytest.raises(RatingDataError):
            _bp(grid, family="case_file")

def test_perturbation_is_seeded_bounded_and_identity_at_zero():
    a, b, c = _bp(perturb_frac=0.1, perturb_seed=1), _bp(perturb_frac=0.1, perturb_seed=1), _bp(perturb_frac=0.1, perturb_seed=2)
    base = _bp()
    assert np.array_equal(a.grid.rating_dc, b.grid.rating_dc) and not np.array_equal(a.grid.rating_dc, c.grid.rating_dc)
    r = a.grid.rating_dc / base.grid.rating_dc
    assert np.all((r >= 0.9) & (r <= 1.1)) and np.allclose(a.grid.rating_ac / base.grid.rating_ac, r)
    assert np.array_equal(_bp(perturb_frac=0.0, perturb_seed=9).grid.rating_dc, base.grid.rating_dc)

def test_dc_flow_basis_changes_only_the_dc_rating_base():
    a, b = _bp(family="proportional"), _bp(family="proportional", dc_basis="dc_flow")
    assert np.array_equal(a.grid.rating_ac, b.grid.rating_ac)
    f = np.abs(dc_power_flow(b.grid, b.dc_injections_mw).flow_mw)
    assert np.allclose(b.grid.rating_dc, np.maximum(1.25 * f, 0.05 * f.max()))

def test_config_validation_of_new_options():
    for bad in ({"rating": {"family": "made_up"}}, {"rating": {"perturb_frac": 1.0}}, {"rating": {"dc_basis": "x"}},
                {"numerics": {"fixed_point_bits": 4}}, {"numerics": {"fixed_point_bits": 16.5}}):
        with pytest.raises(ConfigError):
            load_config(overrides=bad)

def test_U12_quantizer_rounding_saturation_and_error_scaling():
    x = np.array([0.1234567, -3.3333, 7.99, -8.5, 9.0]); fl = {}
    y = quantize_pu(x, 12, fl); lsb = 2.0 ** -8
    assert np.all(np.abs(y[:2] - x[:2]) <= lsb / 2 + 1e-15) and fl["fixed_point_saturations"] == 2
    assert y[3] == -8.0 and y[4] == 8.0 - lsb
    z = np.random.default_rng(0).uniform(-7, 7, 10000)
    errs = [np.abs(quantize_pu(z, b) - z).max() for b in (12, 16, 20, 24)]
    assert all(e <= 2.0 ** -(b - 4) / 2 + 1e-15 for e, b in zip(errs, (12, 16, 20, 24)))
    assert all(errs[i] / errs[i + 1] > 8 for i in range(3))            # error proportional to 2^-b (16x per 4 bits)

def test_fixed_point_cascade_converges_to_float_and_never_uses_fast_path():
    cfg0 = load_config(); bp = build_base_point("ieee14", cfg0); sp = space_for_grid(bp.grid, 2)
    e0 = CascadeEngine(bp, cfg0); e32 = CascadeEngine(bp, load_config(overrides={"numerics": {"fixed_point_bits": 32}}))
    S0 = np.array([e0.run(sp.unrank(r)).S for r in range(sp.N)]); S32 = np.array([e32.run(sp.unrank(r)).S for r in range(sp.N)])
    assert np.max(np.abs(S0 - S32)) < 1e-6
    e12 = CascadeEngine(bp, load_config(overrides={"numerics": {"fixed_point_bits": 12}}))
    a = e12.run([0, 1], fast=True); b = e12.run([0, 1], fast=False)
    assert a.S == b.S and a.trips_per_round == b.trips_per_round

def test_defaults_unchanged():
    cfg = load_config()
    assert cfg.rating.family == "n1_covering" and cfg.rating.perturb_frac == 0 and cfg.rating.dc_basis == "ac_active"
    assert cfg.numerics.fixed_point_bits is None
