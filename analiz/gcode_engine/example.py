"""Sample part: face, rough turn, cross drill (C index + clamp), front peck drill,
cutoff with pick-off, back drill on P2, eject. Writes both dialects to out/.

Run from kayar-cam:  python -m analiz.gcode_engine.example
"""
from __future__ import annotations

import pathlib

from .model import (Coolant, Cycle, Feed, MCode, PartParams, Rapid, Spindle, Tool,
                    ToolCall, ToolCancel, ToolUnit)
from .pickoff import build_cycle
from .post import post_shop, post_star
from .sync import timeline

T_TURN = Tool(1, ToolUnit.GANG, name="kaba torna")
T_CUTOFF = Tool(5, ToolUnit.GANG, name="kesme")
T_CROSS = Tool(31, ToolUnit.CROSS, name="radyal matkap D3")
T_FRONT = Tool(12, ToolUnit.FRONT, name="on matkap D4")
T_BACK = Tool(21, ToolUnit.BACK, name="arka matkap D3")


def build():
    p = PartParams(name="ODEMO1", bar_dia=12.0, part_length=20.0, cutoff_width=2.0,
                   cutoff_rpm=2500, grip_length=15.0, date="ORNEK")
    main = [
        # face + rough turn
        ToolCall(tool=T_TURN), Spindle(rpm=3500, mode="cw"),
        Rapid(axes={"X": 14.0, "Z": -0.5}, offset=T_TURN.off), Coolant(on=True),
        Feed(axes={"X": -0.8}, f=0.05, comment="ALIN"),
        Rapid(axes={"X": 10.5, "Z": -0.5}),
        Feed(axes={"Z": 18.0}, f=0.12, comment="KABA"),
        Feed(axes={"X": 13.0}, f=0.1),
        Coolant(on=False), ToolCancel(),
        # cross drill with C index, unclamp before / clamp after
        ToolCall(tool=T_CROSS), Spindle(mode="stop"),
        MCode(code=7), Rapid(axes={"C": 90.0}), MCode(code=6),
        Spindle(rpm=4000, mode="live_cross"),
        Rapid(axes={"X": 16.0, "Y": 0.0, "Z": 8.0}, offset=T_CROSS.off),
        Cycle(g=87, words={"X": 4.0, "R": 14.0, "Q": 800, "F": 0.04}),
        Spindle(mode="live_off"), ToolCancel(),
        # front peck drill
        ToolCall(tool=T_FRONT), Spindle(rpm=3000, mode="cw"),
        Rapid(axes={"X": 0.0, "Y": 0.0, "Z": -1.0}, offset=T_FRONT.off),
        Cycle(g=83, words={"Z": 10.0, "R": -0.5, "Q": 1500, "F": 0.06}),
        ToolCancel(),
    ]
    back = [  # on previous part held in sub spindle
        ToolCall(tool=T_BACK), Spindle(rpm=2000, mode="live_back"),
        Rapid(axes={"X": 0.0, "Z": -1.0}, offset=T_BACK.off),
        Cycle(g=83, words={"Z": 6.0, "R": -0.5, "Q": 1000, "F": 0.05}),
        Spindle(mode="live_off"), ToolCancel(),
    ]
    return build_cycle(p, main, back, T_CUTOFF)


def main() -> None:
    prog = build()
    out = pathlib.Path(__file__).parent / "out"
    out.mkdir(exist_ok=True)
    for name, text in post_shop(prog).items():
        (out / f"{name}.txt").write_text(text, encoding="ascii")
    (out / f"{prog.params.name}-STAR.txt").write_text(post_star(prog), encoding="ascii")
    print(timeline(prog).text())
    print("written to", out)


if __name__ == "__main__":
    main()
