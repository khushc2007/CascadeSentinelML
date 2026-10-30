from doomsday.config import ConfigError, config_hash, load_config

def test_defaults_match_v2_appendix_a():
    c = load_config()
    assert c.rating.headroom_h == 0.25 and c.rating.floor_frac == 0.05
    assert c.rating.family == "n1_covering" and c.rating.n1_margin_m == 0.05   # extension default (not V2 5.3)
    assert c.stress_lambda == 1.10 and c.cascade.max_rounds == 30 and c.cascade.trip_factor == 1.0
    assert c.severity.tau == 0.20 and c.severity.delta_cascade == 0.10
    assert c.numerics.tie_band == 1e-9 and c.numerics.overload_tol == 1e-9 and c.numerics.ac_tol_pu == 1e-8
    assert c.cascade.ladder_step == 0.05 and c.quantum.patience == 3 and c.resource.c_q == 4.0

def test_overrides_and_hash_are_deterministic():
    a, b = load_config(), load_config()
    assert config_hash(a) == config_hash(b) and len(config_hash(a)) == 64
    c = load_config(overrides={"rating": {"headroom_h": 0.30}})
    assert c.rating.headroom_h == 0.30 and c.rating.floor_frac == 0.05
    assert config_hash(c) != config_hash(a)

def test_invalid_configs_rejected():
    for bad in ({"stress_lambda": 0.9}, {"nonsense": 1}, {"rating": {"bogus": 1}},
                {"cascade": {"max_rounds": 0}}, {"numerics": {"float_dtype": "float32"}},
                {"rating": {"family": "other"}}):
        try:
            load_config(overrides=bad)
        except ConfigError:
            continue
        raise AssertionError(f"accepted invalid config {bad}")
