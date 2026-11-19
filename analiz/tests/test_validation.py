"""Literatür doğrulaması, kenar durumlar ve realcheck ayrıştırıcısı."""
import math
import os
import sys

import numpy as np
import pytest

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, os.path.join(HERE, "..", "tools"))
from kayar_model import *  # noqa
from kayar_model import MATERIALS
import realcheck  # noqa: E402


# ---------------------------------------------------------------- literatür
# Sandvik Coromant (kc1 @ hm=1 mm, mc) yaklaşık değerleri — ±%30 içinde olmalı
SANDVIK_KC1 = {"free": 1500, "c45": 1600, "alloy": 1950, "ss": 2000, "brass": 700,
               "alu": 650, "ti": 1400}


@pytest.mark.parametrize("key,ref", SANDVIK_KC1.items())
def test_kc11_vs_sandvik(key, ref):
    assert abs(MATERIALS[key].kc11 / ref - 1) < 0.30


def test_turning_power_vs_sandvik_formula():
    # Sandvik: Pc = vc·ap·fn·kc/60e3, kc = kc1·hm^-mc (κ=90°). C45, vc200 ap3 fn0.3 → ~6.5 kW
    kc = 1600 * 0.3 ** -0.25
    ref = 200 * 3 * 0.3 * kc / 60e3
    p = float(cutting_forces("c45", 3.0, 0.3, 90, 0.0, vc=200).power_kw)
    assert p == pytest.approx(ref, rel=0.05)


def test_force_ratios_typical():
    # König/Klocke: κ≈90°, ap>>rn → Ff/Fc ≈ 0.3–0.5, Fp/Fc ≈ 0.1–0.35
    F = cutting_forces("c45", 2.0, 0.2, 95, 0.4)
    assert 0.3 <= float(F.Ff / F.Fc) <= 0.55
    assert 0.1 <= float(F.Fp / F.Fc) <= 0.35


def test_ra_kinematic_textbook():
    # f=0.2, rn=0.8 → Ra = 0.04/(32·0.8)·1000 = 1.5625 µm (Sandvik ≈ 1.6)
    assert float(ra_kinematic(0.2, 0.8)) == pytest.approx(1.5625)


def test_drill_torque_and_thrust_vs_sandvik():
    D, f, vc = 10.0, 0.2, 80.0
    kr = math.radians(59)
    kc = 1600 * (f * math.sin(kr) / 2) ** -0.25
    pc = f * vc * D * kc / 240e3
    n = 1000 * vc / (math.pi * D)
    M_ref = pc * 30e3 / (math.pi * n) * 1000       # N·mm
    Ff_ref = 0.5 * kc * (D / 2) * f * math.sin(kr)  # N
    F = drill_forces("c45", D, f, vc)
    assert F.torque == pytest.approx(M_ref, rel=0.05)
    assert abs(F.thrust / Ff_ref - 1) < 0.30
    # klasik (inceltilmemiş) uç belirgin şekilde daha fazla iter
    assert drill_forces("c45", D, f, vc, point="conventional").thrust > 1.3 * F.thrust


def test_swiss_finish_ra_realistic():
    # Kayar otomat finiş f0.02 rn0.2: tipik Ra 0.2–0.8 µm
    r = analyze_pass("c45", 6, 0.5, 0.02, 60, 0.2, overhang_start=1, overhang_end=2)
    assert 0.1 < r.ra_max < 0.8


def test_swiss_deep_low_feed_not_flagged():
    # atölye: ap 4 mm @ f 0.02 (C45) çalışıyor → ap uyarısı olmamalı
    r = analyze_pass("c45", 12, 4.0, 0.02, 80, 0.2)
    assert not any("kesit" in w for w in r.warnings)
    r = analyze_pass("c45", 12, 3.0, 0.15, 80, 0.2)
    assert any("kesit" in w for w in r.warnings)


# ---------------------------------------------------------------- kenar durumlar
def test_invalid_inputs_raise():
    with pytest.raises(ValueError):
        analyze_pass("c45", 10, 0.0, 0.1, 100, 0.2)
    with pytest.raises(ValueError):
        analyze_pass("c45", 10, 1.0, -0.1, 100, 0.2)
    with pytest.raises(ValueError):
        analyze_pass("c45", 0, 1.0, 0.1, 100, 0.2)
    with pytest.raises(ValueError):
        drill_forces("c45", 0, 0.05)
    with pytest.raises(ValueError):
        drill_forces("c45", 3, -0.05)
    with pytest.raises(KeyError):
        analyze_pass("unobtanium", 10, 1.0, 0.1, 100, 0.2)


def test_zero_vc_gives_zero_duration_no_crash():
    r = analyze_pass("c45", 10, 0.5, 0.05, 0.0, 0.2)
    assert np.all(r.samples.t == 0)
    assert np.isfinite(r.ra_max)


def test_tiny_diameter_finite_and_limited_rpm():
    r = analyze_pass("free", 1.0, 0.2, 0.01, 60, 0.05)
    assert r.samples.n[0] == pytest.approx(10000)   # makine limiti
    assert np.isfinite(r.dia_error_max) and r.dia_error_max > 0
    F = drill_forces("free", 1.0, 0.01)
    assert 0 < F.thrust < 50


def test_stainless_long_overhang_warns_and_grows():
    short = analyze_pass("ss", 6, 1.0, 0.05, 100, 0.2, overhang_start=1, overhang_end=2)
    long_ = analyze_pass("ss", 6, 1.0, 0.05, 100, 0.2, overhang_start=10, overhang_end=25,
                         it_grade=7)
    assert long_.dia_error_max > 3 * short.dia_error_max
    assert any("Çıkıntı" in w for w in long_.warnings)
    assert any("Çap hatası" in w for w in long_.warnings)


def test_mismatched_sync_warns():
    res = run_paths([TurnOp("c45", 10, 0.5, 0.05, 100), SyncOp("M82")],
                    [DrillOp("c45", 3, 5, 0.05, 50), SyncOp("M40")])
    w = res.streams["path1"].warnings + res.streams["path2"].warnings
    assert any("M82" in x and "eşi yok" in x for x in w)
    assert any("M40" in x and "eşi yok" in x for x in w)


def test_sync_order_mismatch_warns():
    res = run_paths([SyncOp("M82"), TurnOp("c45", 10, 0.5, 0.05, 100), SyncOp("M40")],
                    [SyncOp("M40"), DrillOp("c45", 3, 5, 0.05, 50), SyncOp("M82")])
    assert any("sırası" in x for x in res.streams["path1"].warnings)


def test_shared_axis_consistent():
    p1 = [TurnOp("c45", 10, 0.5, 0.05, 100), SyncOp("M82"), TurnOp("c45", 10, 0.3, 0.05, 100)]
    p2 = [DrillOp("c45", 3, 6, 0.05, 50, peck=True, q=1.0), SyncOp("M82")]
    res = run_paths(p1, p2, shared_dt=0.01)
    a, b = res.shared["path1"], res.shared["path2"]
    assert np.array_equal(a["t"], b["t"])
    assert len(a["Fc"]) == len(b["Ff"]) == len(a["t"])
    assert np.all(np.diff(a["t"]) > 0)
    assert a["t"][-1] >= res.cycle_time - 0.01
    # senkron sonrası olaylar aynı anda
    ta = dict((c, t) for t, c in res.streams["path1"].events)["M82"]
    tb = dict((c, t) for t, c in res.streams["path2"].events)["M82"]
    assert ta == pytest.approx(tb)
    # yeniden örnekleme orijinal akışın tepe kuvvetini aşmaz
    assert a["Fc"].max() <= res.streams["path1"]["Fc"].max() + 1e-9


# ---------------------------------------------------------------- realcheck ayrıştırıcı
SAMPLE = """%
<O1-P1>
#531=10(MALZEME CAPI +1MM)
T0200
M03S3000
G0X11Z0T2
G99G1X5F0.02
Z10
X3
Z5
G28U0
(Q2.4 MAT)
T1200
M3S3000
G99G0
G1Z-0.5F0.5
Z0F0.04
G83Z2Q250F0.015
G80
"""


def test_realcheck_parser():
    pr = realcheck.parse_text(SAMPLE, "X-P1")
    assert pr.bar == 9
    assert 3000 in pr.rpms
    t = pr.turns
    assert t[0].dia == 5 and t[0].ap == pytest.approx(2.0) and t[0].f == 0.02
    # ikinci paso X3, Z10→5: stok önceki Ø5 → ap 1
    assert t[1].dia == 3 and t[1].ap == pytest.approx(1.0)
    d = pr.drills[0]
    assert d.D == 2.4 and d.depth == pytest.approx(2.0) and d.q == pytest.approx(0.25)
    rows, flags = realcheck.check(pr, "c45")
    assert not flags
