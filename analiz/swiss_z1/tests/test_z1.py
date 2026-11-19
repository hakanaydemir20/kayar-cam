import numpy as np
import pytest
from shapely.geometry import LineString
from analiz.swiss_z1.offsets import Setup, Tool, MachineState
from analiz.swiss_z1.toolpath import convert, validate, segment, cycle, StrokeError

S = Setup(L=20, cutoff_width=2.0, extra=0.1)


def test_roundtrip():
    st, t = MachineState(bar_offset=-3.7), Tool(dz=0.15, dx=1.0)
    for d in np.linspace(-1, 50, 13):
        assert S.z_part(S.z1(d, t, st), t, st) == pytest.approx(d)
    assert S.z1(5, Tool(), MachineState()) == pytest.approx(5)  # G125 sonrası program Z = Z1


def test_overhang_monotonic():
    c = convert(np.c_[np.linspace(0, 30, 31), np.full(31, 8)], S, Tool(), MachineState())
    assert np.all(np.diff(c.overhang) > 0)
    assert c.overhang[0] == pytest.approx(3.2) and c.cut_to_bush == pytest.approx(3.2)


def test_blade_ref_difference():
    b, f = Tool(width=2.0, ref="back"), Tool(width=2.0, ref="front")
    assert S.cutoff_z(b) - S.cutoff_z(f) == pytest.approx(2.0)
    assert S.cutoff_z(b) == pytest.approx(22.1)


def test_rechuck_preserves_part_coord():
    st, t = MachineState(z1=15.0), Tool()
    d0 = S.z_part(st.z1, t, st)
    st.rechuck(-12.0)
    assert S.z_part(st.z1, t, st) == pytest.approx(d0)
    assert st.bar_offset == pytest.approx(12.0)
    assert S.z1(40, t, st) == pytest.approx(28.0)


def test_zero_set_cycle():
    traj, ev, st = cycle(S, [np.array([[0, 6], [20, 6]])], Tool(), Tool(width=2, ref="back"))
    assert st.bar_offset == pytest.approx(0.0)
    assert ev[-1].Z1 == pytest.approx(22.1)
    _, ev2, st2 = cycle(S, [np.array([[0, 6], [20, 6]])], Tool(), Tool(width=2, ref="back"), rechuck_at=10)
    assert st2.bar_offset == pytest.approx(12.0) and ev2[-1].Z1 == pytest.approx(10.1)


def test_cycle_stroke_safe_rechuck():
    p = [np.array([[0, 6], [20, 6]])]
    _, ev, st = cycle(S, p, Tool(), Tool(width=2, ref="back"), rechuck_at=10)
    z = [e.Z1 for e in ev]
    assert min(z) >= S.z1_min - 1e-9
    assert sum(e.kind == "rechuck" for e in ev) == 2      # 7.8 + 4.2 = 12
    assert st.bar_offset == pytest.approx(12.0)
    with pytest.raises(StrokeError):
        cycle(Setup(L=250), [np.array([[0, 6], [240, 6]])], Tool(), Tool(width=2, ref="back"))
    _, ev2, _ = cycle(Setup(L=250), [np.array([[0, 6], [240, 6]])], Tool(), Tool(width=2, ref="back"),
                      strict=False)
    assert any(e.kind == "stroke" for e in ev2)


def test_segmentation_overhang():
    s = Setup(max_overhang=20)
    path = np.c_[np.linspace(0, 50, 51), np.full(51, 5)]
    segs = segment(path, s, Tool(), MachineState())
    assert sum(1 for _, e in segs if e and e[0] == "segment") == 2
    assert any(i.kind == "overhang" for i in validate(convert(path, s, Tool(), MachineState()), s))


def test_stroke_limit():
    s = Setup(max_overhang=1e9)
    assert any(i.kind == "stroke" for i in
               validate(convert(np.array([[0, 5], [210, 5]]), s, Tool(), MachineState()), s))
    st = MachineState()
    segs = segment(np.c_[np.linspace(0, 300, 301), np.full(301, 5)], s, Tool(), st)
    assert any(e and e[0] == "rechuck" for _, e in segs)
    assert st.bar_offset > 0


def test_bush_pullback():
    path = np.array([[0, 6], [10, 6], [2, 6]])  # d=10'a kadar işle, sonra geri çek
    iss = validate(convert(path, S, Tool(), MachineState()), S, stock_d=10)
    assert any(i.kind == "bush_pullback" for i in iss)


def test_shapely_equals_numpy():
    pts = [(0, 6), (5, 6), (5, 8), (20, 8)]
    t, st = Tool(dz=0.1, dx=0.5), MachineState(bar_offset=2)
    a, b = convert(np.array(pts), S, t, st), convert(LineString(pts), S, t, st)
    for k in ("Z1", "X1", "overhang"):
        assert np.allclose(getattr(a, k), getattr(b, k))
