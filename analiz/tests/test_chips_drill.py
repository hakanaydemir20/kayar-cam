import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import numpy as np
import pytest

from kayar_model import (oscillate, lfv_break_condition, interrupted_feed, interrupted_samples,
                         oscillation_effect, chip_form, generate_pass, analyze_samples,
                         BushSupport, drill_forces, peck_schedule, recommend_q, collet_slip_check,
                         gcode_peck_front, gcode_peck_back, gcode_interrupted_turning,
                         run_paths, DrillOp, TurnOp, SyncOp, SubPath)

F, N, D = 0.05, 3000, 10


@pytest.mark.parametrize("A,R,expect", [(0.6 * F, 1.5, True), (0.4 * F, 1.5, False),
                                        (2 * F, 2.0, False), (2 * F, 1.0, False)])
def test_oscillation_breaks_only_when_conditions(A, R, expect):
    assert lfv_break_condition(F, A, R) == expect
    o = oscillate(F, N, A, R, 1.0, D)
    assert o.breaks == expect
    assert (o.air_fraction > 0) == expect


def test_oscillation_chip_short_and_samples():
    o = oscillate(F, N, F, 1.5, 1.0, D)
    assert o.chip_length < np.pi * D
    assert (~o.samples.cutting).any() and np.all(o.samples.f[~o.samples.cutting] == 0)


def test_interrupt_chip_length_decreases():
    L = [interrupted_feed(10, e, F, N, D).chip_length for e in (5, 2, 1, 0.5)]
    assert all(a > b for a, b in zip(L, L[1:]))
    t = [interrupted_feed(10, e, F, N, D).extra_time for e in (5, 2, 1, 0.5)]
    assert all(a < b for a, b in zip(t, t[1:]))
    s = generate_pass(0, -4, F, N, 1, 1, 100)
    si = interrupted_samples(s, 1.0)
    assert si.t[-1] > s.t[-1] and (~si.cutting).sum() == 6
    assert np.all(np.diff(si.t) >= 0)


def test_chip_form():
    assert chip_form("free", 0.1, 1.0, "M").breaks
    assert not chip_form("ss", 0.03, 0.3, "M").breaks


def test_oscillation_raises_ra_and_error():
    e = oscillation_effect("c45", 10, 1.0, 0.08, 150, 0.4, 95, BushSupport(), A=0.06, ratio=1.5)
    assert e.oscillation.breaks
    assert e.ra_increase > 0 and e.dia_error_increase > 0 and e.fluct >= 0.5


def test_thrust_scales_with_f_and_D():
    assert drill_forces("c45", 5, 0.1).thrust > drill_forces("c45", 5, 0.05).thrust
    assert drill_forces("c45", 8, 0.05).thrust > drill_forces("c45", 5, 0.05).thrust
    assert drill_forces("c45", 8, 0.05).torque > drill_forces("c45", 5, 0.05).torque


def test_peck_count_time_monotonic():
    c = [peck_schedule(20, q, 0.05, 2000, "g83") for q in (5, 2, 1, 0.5)]
    assert all(a.count < b.count and a.total_time < b.total_time for a, b in zip(c, c[1:]))
    g73 = peck_schedule(20, 1, 0.05, 2000, "g73")
    assert g73.total_time < c[2].total_time
    dec = peck_schedule(20, 2, 0.05, 2000, "g83", decay=0.8)
    assert dec.count > c[1].count and dec.pecks[-1] == 20
    assert recommend_q("ss", 3, 15) < recommend_q("brass", 3, 15)


def test_collet_slip():
    F = drill_forces("ss", 8, 0.12)
    assert collet_slip_check(F.thrust, F.torque, 10, grip=3).slip
    assert not collet_slip_check(drill_forces("brass", 2, 0.03).thrust, 0, 10, grip=10).slip


def test_gcode():
    g = gcode_peck_front(12, 10, 1.5, 0.05, 3000)
    assert "G83Z10.000Q1500F0.05" in g and g.startswith("T1200")
    b = gcode_peck_back(22, 8, 1, 0.04, "g73")
    assert "G73W8.000Q1000" in b and "G28W0." in b
    assert gcode_interrupted_turning(3, 1, 0.05).count("G0W") == 2


def test_two_path_peck_concurrent():
    p1 = [TurnOp("c45", 10, 1, 0.1, 150), DrillOp("c45", 3, 15, 0.05, 60, peck=True, q=1.0), SyncOp("M82")]
    p2 = [DrillOp("ss", 8, 20, 0.12, 40, peck=True, cycle="g73", q=0.8), SyncOp("M82")]
    r = run_paths(p1, p2, sub=SubPath(20, grip=3), shared_dt=0.01)
    a, b = r.streams["path1"], r.streams["path2"]
    assert a.data["Ff"].max() > 0 and b.data["Ff"].max() > 0
    assert any("kayma" in w for w in b.warnings)
    assert np.all(np.diff(a.t) >= 0) and np.all(np.diff(b.t) >= 0)
    assert abs(a.events[0][0] - b.events[0][0]) < 1e-9
