import math
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from cs_contour import transforms as T  # noqa: E402
from cs_contour import gcode as G  # noqa: E402
from cs_contour.selection import Feature, choose_method  # noqa: E402


def test_unroll_wrap_roundtrip():
    th = np.linspace(-3, 9, 50)
    z = np.linspace(0, 10, 50)
    u, zz = T.unroll(th, z, 6.0)
    th2, z2 = T.wrap(u, zz, 6.0)
    assert np.allclose(th, th2) and np.allclose(z, z2)
    assert T.cyl_c_mm_to_deg(T.cyl_c_deg_to_mm(123.4, 5), 5) == pytest.approx(123.4)
    assert T.cyl_c_mm_to_deg(math.pi * 5, 5) == pytest.approx(180)


def test_polar_roundtrip_and_part_sign():
    for x, y in [(3, 4), (-2, 1), (0.5, -7), (-3, -3)]:
        X, C = T.polar_to_machine(x, y)
        assert T.machine_to_polar(X, C) == pytest.approx((x, y))
    # C = -θ: part point at θ=+90° → C=-90
    X, C = T.part_face_to_machine(0, 5)
    assert X == pytest.approx(10) and C == pytest.approx(-90)


def test_part_machine_point_roundtrip_with_y():
    for xp, yp, Y in [(4, 1, 0), (3, -2, 1.5), (-1, 4, -2)]:
        m = T.part_point_to_machine(xp, yp, 7.0, Y)
        assert T.machine_to_part_point(m["X"], m["Y"], m["Z"], m["C"]) == pytest.approx((xp, yp, 7.0))


def test_c_continuity_across_360():
    cs = T.unwrap_deg([350, 355, 2, 10, -170, 175])
    assert all(abs(b - a) <= 180 for a, b in zip(cs, cs[1:]))
    assert cs[2] == pytest.approx(362)
    # full polygon loop around center: C monotone, total 360
    n = 6
    pts = [(5 * math.cos(2 * math.pi * k / n), 5 * math.sin(2 * math.pi * k / n)) for k in range(n + 1)]
    out = T.densify_polar(pts, 0.005)
    c = [o[1] for o in out]
    assert all(abs(b - a) <= 30 + 1e-9 for a, b in zip(c, c[1:]))
    assert c[-1] - c[0] == pytest.approx(360)


def test_polar_densification_tolerance():
    tol = 0.003
    pts = [(6, -4), (6, 4), (1.0, 4.0), (1.0, -3.0)]
    out = T.densify_polar(pts, tol)
    # each densified piece executed X/C-linear deviates ≤ tol from the target line
    for a, b in zip(out, out[1:]):
        dev = T._linear_machine_deviation(np.array(a[2:]), np.array(b[2:]), a[1], b[1], 64)
        assert dev <= tol * 1.05
    # all points lie on the original polyline
    assert len(out) > len(pts)
    with pytest.raises(ValueError):
        T.densify_polar([(-3, 0), (3, 0)], tol)


def test_polar_c_speed():
    r = T.polar_c_speed([(0.5, -5), (0.5, 5)], 300, c_max_rpm=100)
    assert r["rho_min"] == pytest.approx(0.5)
    assert r["c_rpm_peak"] == pytest.approx(300 / 0.5 / (2 * math.pi))
    assert r["ok"] is True
    r2 = T.polar_c_speed([(0.1, -5), (0.1, 5)], 300, c_max_rpm=100)
    assert r2["ok"] is False and r2["f_allow"] == pytest.approx(100 * 2 * math.pi * 0.1)


def test_keyway_wall_correction_parallel():
    R, w, d, rt = 6.0, 4.0, 2.0, 1.5
    dev_rot = T.keyway_wall_deviation_max(R, w, d, rt, ref="exact")
    assert dev_rot > 0.02          # C-rotated offset: wall not parallel
    rho = np.linspace(R - d, R, 30)
    ys = T.keyway_y_offsets(w, rt)
    assert ys[0] == pytest.approx(-(w / 2 - rt)) and ys[-1] == pytest.approx(w / 2 - rt)
    right = T.wall_y_yoffset(rho, rt, ys[-1], +1)
    left = T.wall_y_yoffset(rho, rt, ys[0], -1)
    assert np.max(np.abs(right - w / 2)) < 1e-9 and np.max(np.abs(left + w / 2)) < 1e-9
    # G7.1 surface-offset also shows deviation; exact top → zero at surface
    rho2, dev, _ = T.keyway_wall_deviation(R, w, d, rt, "exact")
    assert abs(dev[-1]) < 1e-9 and dev[0] < 0
    assert T.check_y_stroke(ys)


def test_keyway_and_helix_paths():
    p = T.keyway_path(5, 0, 10, 90, 1.0, 0.4)
    xs = [q.X for q in p if q.feed]
    assert min(xs) == pytest.approx(8.0)
    h = T.helical_groove_path(5, 0, 8, 1.5, 0, 0.5, 0.5)
    cut = [q for q in h if q.feed]
    assert cut[-1].Z == pytest.approx(12) and cut[-1].C == pytest.approx(-540)
    assert T.helix_angle_deg(5, 2 * math.pi * 5) == pytest.approx(45)


def test_cross_holes():
    m = T.cross_hole_machine(T.CrossHole(z=5, theta_deg=30, R=5, depth=2, y_off=3))
    assert m["C"] == -30 and m["X_entry"] == pytest.approx(8) and m["X_bottom"] == pytest.approx(4)
    f = T.hole_on_flat(3, 120, 4, 1, lateral=1.2)
    assert f["X_entry"] == 8 and f["Y"] == 1.2 and f["C"] == -120


def test_feed_conversion():
    # pure C at r=5: 360° move, surface 100 mm/min
    F = T.feed_g98_cz(0, 360, 5, 100)
    t = T.move_time_g98(0, 360, F)
    assert t == pytest.approx(2 * math.pi * 5 / 100)
    assert T.feed_c_only(5, 100) == pytest.approx(F)
    # Z only unchanged
    assert T.feed_g98_cz(10, 0, 5, 100) == pytest.approx(100)
    # mixed: time equals true surface length / f
    dz, dc, r = 4, 30, 6
    F = T.feed_g98_cz(dz, dc, r, 120)
    assert T.move_time_g98(dz, dc, F) == pytest.approx(math.hypot(dz, r * dc * T.DEG) / 120)
    assert T.feed_g71(100, 6, 4) == pytest.approx(150)


def test_gcode_snippets():
    s = G.fanuc_cyl_keyway(5, 0, 10, 0, 90, 1, 0.5, 200)
    assert "G7.1C5." in s and s.count("G7.1C0") == 2
    p = G.fanuc_polar([(3, -2), (3, 2)], 0.5, 150, 14)
    assert p[1] == "G12.1" and p[-1] == "G13.1" and "G1X6.C2." in p
    k = G.shop_keyway_y(5, 0, 10, 45, 4, 1.5, 1, 0.5, 200)
    for blk in ("T3100", "M36S2800", "G0C45.", "M6", "M7", "M38"):
        assert blk in k
    assert any(b.endswith("T31") and b.startswith("G0X") for b in k)
    g = G.shop_g19_slot(5, 11.5, 2.75, -5.75, [4.75, 4.0], 350)
    assert "G19" in g and "G2Y-11.5Z2.75J-5.75K0" in g and "G1G98X4.75F350." in g
    assert G.shop_full_turns(2, 1500) == ["M7", "H365F1500", "H365F1500"]
    h = G.shop_index_holes([T.CrossHole(5, 90, 5, 2)], 80)
    assert "G0C-90." in h and "M6" in h


def test_choose_method():
    assert choose_method(Feature("helix", R=5, width=3, depth=1, tool_dia=3, lead=10)).method == "cylindrical"
    c = choose_method(Feature("keyway", R=6, width=4, depth=2, tool_dia=3))
    assert c.method == "y_axis" and c.reasons
    assert choose_method(Feature("keyway", R=6, width=3, depth=2, tool_dia=3)).method == "index"
    assert choose_method(Feature("face_polygon", face_extent=5)).method == "polar"
    assert choose_method(Feature("face_slot", face_extent=5, through_center=True)).method == "y_axis"
    assert choose_method(Feature("face_flat", face_extent=30)).method == "polar"
