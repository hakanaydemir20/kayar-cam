import os, sys
import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from kayar_model import *  # noqa


def base(**kw):
    p = dict(material="c45", bar_dia=10, ap=1.0, f=0.1, vc=150, rn=0.4, kappa_deg=95,
             bush_clearance=0.01, overhang_start=1, overhang_end=3)
    p.update(kw)
    return analyze_pass(**p)


def test_feed_velocity():
    s = generate_pass(0, -10, 0.1, 1000, 1, 3, 11)
    assert s.vf[0] == pytest.approx(100)
    assert s.t[-1] == pytest.approx(6.0)
    assert s.overhang[0] == 1 and s.overhang[-1] == 3


def test_force_scales_with_ap():
    a = cutting_forces("c45", 1.0, 0.1, 95, 0.4).Fc
    b = cutting_forces("c45", 2.0, 0.1, 95, 0.4).Fc
    assert 1.8 < b / a < 2.2


def test_force_magnitude_reasonable():
    Fc = float(cutting_forces("c45", 1.0, 0.1, 90, 0.0).Fc)
    # κ=90°, rn=0 → saf Kienzle: 1600·1·0.1^0.75 ≈ 284.5 N (f/2 kirişi κeq'i hafif düşürür)
    assert Fc == pytest.approx(1600 * 0.1 ** 0.75, rel=0.02)


def test_small_ap_nose_radius_raises_radial_share():
    big = cutting_forces("c45", 2.0, 0.1, 95, 0.8)
    small = cutting_forces("c45", 0.2, 0.1, 95, 0.8)
    assert small.Fp / small.Fc > big.Fp / big.Fc
    assert small.kappa_eq_deg < 60


def test_ra_scales_with_f_squared():
    assert ra_kinematic(0.2, 0.4) / ra_kinematic(0.1, 0.4) == pytest.approx(4)
    assert rz_kinematic(0.1, 0.4) == pytest.approx(0.01 / 3.2 * 1000)


def test_overhang_increases_deflection():
    r = base()
    assert np.all(np.diff(r.deflection.total) > 0)
    assert base(overhang_start=10, overhang_end=10).dia_error_max > base(overhang_start=1, overhang_end=1).dia_error_max


def test_clearance_increases_error():
    assert base(bush_clearance=0.02).dia_error_max > base(bush_clearance=0.005).dia_error_max


def test_tolerance_warning():
    r = base(it_grade=6, overhang_start=20, overhang_end=30)
    assert any("tolerans" in w for w in r.warnings)


def test_it_tolerance():
    assert it_tolerance(10, 7) == pytest.approx(0.0154, abs=0.002)


def test_all_materials_run():
    for k in MATERIALS:
        r = base(material=k, ap=0.5)
        assert r.ra_max > 0 and np.isfinite(r.dia_error_max)


# ---------------- iki yol
def test_subpath_no_clearance_and_grip():
    op = TurnOp("c45", 10, 0.5, 0.1, 150)
    long_grip = SubPath(part_length=20, grip=15).run([op])
    short_grip = SubPath(part_length=20, grip=5).run([op])
    assert short_grip["deflection"].max() > long_grip["deflection"].max()
    assert isinstance(SubPath().support, ColletSupport)
    assert isinstance(MainPath().support, BushSupport)


def test_run_paths_concurrent_and_sync():
    p1 = [TurnOp("c45", 10, 1.0, 0.1, 150, z1=-20), SyncOp("M82"),
          TurnOp("c45", 8, 0.5, 0.05, 190, z1=-5)]
    p2 = [DrillOp("c45", 3, 5, 0.05, 50), SyncOp("M82"),
          TurnOp("c45", 10, 0.3, 0.05, 150, z1=-3)]
    res = run_paths(p1, p2, shared_dt=0.01)
    a, b = res.streams["path1"], res.streams["path2"]
    assert a.events[0][0] == pytest.approx(b.events[0][0])
    assert np.all(np.diff(a.t) >= 0) and np.all(np.diff(b.t) >= 0)
    assert b["Ff"].max() > 0
    sh = res.shared
    assert len(sh["path1"]["t"]) == len(sh["path2"]["t"])
    assert res.cycle_time >= max(a.duration, b.duration) - 1e-9


def test_run_paths_no_sync_independent():
    p1 = [TurnOp("c45", 10, 1.0, 0.1, 150), SyncOp("M82")]
    p2 = [SyncOp("M82")]
    res = run_paths(p1, p2, sync=False)
    assert res.streams["path1"].events[0][0] > 0
    assert res.streams["path2"].events[0][0] == 0
