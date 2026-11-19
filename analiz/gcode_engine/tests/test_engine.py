import re

import pytest

from analiz.gcode_engine.example import T_CUTOFF, build
from analiz.gcode_engine.model import AxisError, Channel, Path, Rapid, Sync, Tool, ToolCall, ToolUnit
from analiz.gcode_engine.pickoff import check_pickoff, T_APPROACH, T_CUT, T_RETRACT
from analiz.gcode_engine.post import fnum, post_shop, post_star
from analiz.gcode_engine.sync import (NumberedWaitStrategy, ShopSyncStrategy, SyncError,
                                      assign_codes, timeline, validate_sync)


def test_sync_sequences_equal():
    prog = build()
    assert prog.p1.syncs() == prog.p2.syncs()
    assert validate_sync(prog) == ["cycle_start", "spindle_sync", "part_gripped", "cut_done"]


def test_mismatch_detected():
    prog = build()
    prog.p2.ops.append(Sync(event="extra"))
    with pytest.raises(SyncError, match="deadlock"):
        validate_sync(prog)
    prog = build()
    i = next(i for i, o in enumerate(prog.p1.ops) if isinstance(o, Sync) and o.event == "part_gripped")
    j = next(i for i, o in enumerate(prog.p1.ops) if isinstance(o, Sync) and o.event == "cut_done")
    prog.p1.ops[i], prog.p1.ops[j] = prog.p1.ops[j], prog.p1.ops[i]
    with pytest.raises(SyncError, match="mismatch"):
        post_shop(prog)


def test_shop_rejects_unknown_event():
    prog = build()
    prog.p1.ops.insert(5, Sync(event="custom"))
    prog.p2.ops.insert(5, Sync(event="custom"))
    with pytest.raises(SyncError):
        assign_codes(prog, ShopSyncStrategy())
    assert assign_codes(prog, NumberedWaitStrategy())  # numbered handles anything


def _move_tag(ops, tag, delta):
    i = next(i for i, o in enumerate(ops) if o.tag == tag)
    op = ops.pop(i)
    ops.insert(i + delta, op)


@pytest.mark.parametrize("path,tag,delta", [
    ("p2", T_APPROACH, -3),   # approach before spindle sync
    ("p1", T_CUT, -2),        # cut before grip
    ("p2", T_RETRACT, -2),    # retract before cut done
])
def test_pickoff_invariants(path, tag, delta):
    prog = build()
    check_pickoff(prog)
    _move_tag(getattr(prog, path).ops, tag, delta)
    with pytest.raises(SyncError, match="pick-off safety"):
        check_pickoff(prog)


def test_p2_rejects_y():
    ch = Channel(Path.P2)
    with pytest.raises(AxisError):
        ch.add(Rapid(axes={"Y": 1.0}))
    with pytest.raises(AxisError):
        ch.add(ToolCall(tool=Tool(1, ToolUnit.GANG)))
    Channel(Path.P1).add(Rapid(axes={"Y": 1.0}))


def _order(text, items):
    lines = text.splitlines()
    pos, last = [], -1
    for it in items:
        idx = next(i for i, l in enumerate(lines) if i > last and l.startswith(it))
        pos.append(idx)
        last = idx
    return pos


def test_shop_template_order():
    files = post_shop(build())
    p1, p2 = files["ODEMO1-P1"], files["ODEMO1-P2"]
    _order(p1, ["#531=13.", "#530=20.", "#529=", "#528=2.", "#120=", "G28U0", "T200",
                "M98P9012", "N99", "M11", "G0Z-0.2T0", "G125Z-0.2", "M10", "M200", "M20",
                "N100", "T0500", "M3S#529", "G0G99X[#531+1.]Z[#530+#528+#120]T5",
                "M82", "M40", "G1", "G1X-1.", "M41", "M83", "M99P99"])
    _order(p2, ["#530=15.", "G130", "G28W0.", "T2000", "M200", "T2100", "T2900", "G0Z40.",
                "N100", "G99M4S50", "M11", "M82", "G131", "G0Z-30.", "M14", "M68", "G1G99Z#530F1.5",
                "M69", "M10", "G4U0.5", "M15", "M40", "M41", "M68", "G0W-20.", "M69", "M83",
                "G28W0.", "M99"])
    assert "Y" not in re.sub(r"\(.*?\)", "", p2)


def test_numbered_waits_paired():
    text = post_star(build())
    p1, p2 = text.split("$2")
    w = lambda s: re.findall(r"^M(2\d\d)", s, re.M)
    assert w(p1) == w(p2) == ["200", "201", "202", "203"]
    assert "$1" in p1


def test_fnum_and_timeline():
    assert fnum(15) == "15." and fnum(0.5) == "0.5" and fnum(-1.25) == "-1.25" and fnum(0) == "0."
    rep = timeline(build())
    assert len(rep.segments) == 5 and rep.cycle_time > 0


# ---- pickoff_cycle + ordering validator
from analiz.gcode_engine.model import PartParams, MCode
from analiz.gcode_engine.pickoff import pickoff_cycle, T_MAIN_OPEN


def test_pickoff_cycle_shop():
    p1, p2, steps = pickoff_cycle(PartParams(), "shop")
    assert [l for l in p1 if l in ("M82", "M40", "M41")] == ["M82", "M40", "M41"]
    assert [l for l in p2 if l in ("M82", "M40", "M41")] == ["M82", "M40", "M41"]
    assert "M11" not in p1          # main collet stays closed in transfer
    assert p2.index("M41") < p2.index("G0W-20.")
    assert [s[0] for s in steps] == [1, 2, 3, 4, 6, 5]


def test_pickoff_cycle_star():
    p1, p2, _ = pickoff_cycle(PartParams(), "star")
    w = lambda ls: [l for l in ls if re.fullmatch(r"M2\d\d", l)]
    assert w(p1) == w(p2) == ["M200", "M201", "M202"]
    assert "M77" in p1 and "M77" in p2


def test_reject_main_open_before_cut():
    with pytest.raises(SyncError, match="main collet"):
        pickoff_cycle(PartParams(), "shop", main_open="after_grip")
    p1, _, _ = pickoff_cycle(PartParams(), "shop", main_open="after_cut")
    assert p1.index("M41") < p1.index("M11(MAIN PENS ACIK)")


def test_reject_main_open_injected_before_cut():
    prog = build()
    i = next(i for i, o in enumerate(prog.p1.ops) if o.tag == T_CUT)
    prog.p1.ops.insert(i, MCode(code=11, tag=T_MAIN_OPEN))
    with pytest.raises(SyncError, match="main collet"):
        check_pickoff(prog)
