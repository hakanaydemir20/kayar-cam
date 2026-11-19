"""IR model: paths, axes, tools and operations for a 2-channel Swiss-type lathe."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Union


class Path(Enum):
    P1 = 1  # main spindle: gang / cross live / front drills
    P2 = 2  # sub spindle: back tool post


# Logical axis letters as written in the program for each path.
# P1 programs X Y Z C (+ U W incremental); P2 programs X Z C (no Y!).
PATH_AXES: Dict[Path, frozenset] = {
    Path.P1: frozenset({"X", "Y", "Z", "C", "U", "V", "W", "H"}),
    Path.P2: frozenset({"X", "Z", "C", "U", "W", "H"}),
}


class AxisError(ValueError):
    pass


class ToolUnit(Enum):
    GANG = "gang"      # P1 turning tools on gang slide
    CROSS = "cross"    # P1 radial live tools
    FRONT = "front"    # P1 front (axial) drills T11..T14
    BACK = "back"      # P2 back tool post


UNIT_PATH = {ToolUnit.GANG: Path.P1, ToolUnit.CROSS: Path.P1,
             ToolUnit.FRONT: Path.P1, ToolUnit.BACK: Path.P2}


@dataclass(frozen=True)
class Tool:
    number: int            # P1: 1..99 (T0200 -> 2), P2: 21..29 style (T2100 -> 21)
    unit: ToolUnit
    offset: Optional[int] = None  # defaults to number
    name: str = ""

    @property
    def path(self) -> Path:
        return UNIT_PATH[self.unit]

    @property
    def off(self) -> int:
        return self.offset if self.offset is not None else self.number

    @property
    def live(self) -> bool:
        return self.unit in (ToolUnit.CROSS, ToolUnit.BACK)


# ---------------------------------------------------------------- operations
@dataclass
class Op:
    tag: str = field(default="", kw_only=True)        # semantic tag ('approach', 'cut', ...)
    comment: str = field(default="", kw_only=True)
    est_time: Optional[float] = field(default=None, kw_only=True)  # seconds override

    def axis_words(self) -> Dict[str, float]:
        return {}


@dataclass
class Rapid(Op):
    axes: Dict[str, float] = field(default_factory=dict)
    offset: Optional[int] = None   # 'T2' word on the move (applies tool offset)

    def axis_words(self):
        return self.axes


@dataclass
class Feed(Op):
    axes: Dict[str, float] = field(default_factory=dict)
    f: Optional[float] = None
    per_rev: bool = True           # G99 (True) / G98

    def axis_words(self):
        return self.axes


@dataclass
class Arc(Op):
    axes: Dict[str, float] = field(default_factory=dict)
    r: float = 0.0
    cw: bool = True
    f: Optional[float] = None

    def axis_words(self):
        return self.axes


@dataclass
class Cycle(Op):
    """G83 drill, G84 tap, G87 radial peck, G92 thread, G80 cancel."""
    g: int = 83
    words: Dict[str, float] = field(default_factory=dict)       # Z/W/X/R/Q/F/P...
    extra_lines: List[Dict[str, float]] = field(default_factory=list)  # G92 continuation X..

    def axis_words(self):
        return {k: v for k, v in self.words.items() if k in "XYZCUVW"}


@dataclass
class Spindle(Op):
    rpm: Optional[int] = None
    mode: str = "cw"       # cw / ccw / stop / live_cross / live_back / live_off
    css: bool = False      # G96 vs G97


@dataclass
class Coolant(Op):
    on: bool = True


@dataclass
class ToolCall(Op):
    tool: Tool = None  # type: ignore[assignment]


@dataclass
class ToolCancel(Op):
    pass


@dataclass
class MCode(Op):
    code: int = 0
    words: Dict[str, float] = field(default_factory=dict)


@dataclass
class Dwell(Op):
    seconds: float = 0.5
    letter: str = "U"      # shop uses both G4U0.5 and G4X0.5


@dataclass
class Raw(Op):
    text: str = ""


@dataclass
class Label(Op):
    """Block label like N99 / N100."""
    n: int = 0


@dataclass
class Sync(Op):
    """Named sync point; code is assigned by the sync strategy."""
    event: str = ""


AnyOp = Union[Rapid, Feed, Arc, Cycle, Spindle, Coolant, ToolCall, ToolCancel,
              MCode, Dwell, Raw, Label, Sync]


@dataclass
class Channel:
    path: Path
    ops: List[Op] = field(default_factory=list)

    def add(self, *ops: Op) -> "Channel":
        for op in ops:
            validate_op(self.path, op)
            self.ops.append(op)
        return self

    def syncs(self) -> List[str]:
        return [o.event for o in self.ops if isinstance(o, Sync)]


def validate_op(path: Path, op: Op) -> None:
    allowed = PATH_AXES[path]
    for ax in op.axis_words():
        if ax not in allowed:
            raise AxisError(f"{path.name}: axis '{ax}' not available (op {type(op).__name__})")
    if isinstance(op, ToolCall) and op.tool.path != path:
        raise AxisError(f"{path.name}: tool T{op.tool.number} belongs to {op.tool.path.name}")
    if isinstance(op, Spindle) and op.mode == "live_cross" and path != Path.P1:
        raise AxisError("cross live tools only exist on P1")
    if isinstance(op, Spindle) and op.mode == "live_back" and path != Path.P2:
        raise AxisError("back live tools only exist on P2")


@dataclass
class PartParams:
    name: str = "O0001"
    bar_dia: float = 12.0
    part_length: float = 20.0
    cutoff_width: float = 2.0
    cutoff_rpm: int = 2500
    grip_length: float = 15.0   # P2 #530
    extra: float = 0.0          # #120
    date: str = ""


@dataclass
class Program:
    params: PartParams
    p1: Channel = field(default_factory=lambda: Channel(Path.P1))
    p2: Channel = field(default_factory=lambda: Channel(Path.P2))

    def channel(self, path: Path) -> Channel:
        return self.p1 if path == Path.P1 else self.p2
