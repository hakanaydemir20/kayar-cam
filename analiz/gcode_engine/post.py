"""Emitters: shop dialect (two files -P1/-P2) and Star catalog style ($1/$2, M200+n)."""
from __future__ import annotations

from typing import Dict, List, Optional

from .model import (Arc, Coolant, Cycle, Dwell, Feed, Label, MCode, Op, Path,
                    Program, Rapid, Raw, Spindle, Sync, ToolCall, ToolCancel)
from .sync import NumberedWaitStrategy, ShopSyncStrategy, SyncStrategy, assign_codes

INT_WORDS = set("STMPQDLHN")   # written without decimal point
AXIS_ORDER = "XYZCUVWHRIKQPF"


def fnum(v: float) -> str:
    """Shop style: whole numbers get trailing dot (15. / 0.), others trimmed (0.5, -1.25)."""
    v = round(float(v), 4)
    if v == int(v):
        return f"{int(v)}."
    s = f"{v:.4f}".rstrip("0")
    return s


def word(letter: str, v: float) -> str:
    if letter in INT_WORDS:
        return f"{letter}{int(round(v))}"
    return f"{letter}{fnum(v)}"


def words(d: Dict[str, float]) -> str:
    keys = sorted(d, key=lambda k: AXIS_ORDER.index(k) if k in AXIS_ORDER else 99)
    return "".join(word(k, d[k]) for k in keys)


def _cmt(op: Op) -> str:
    return f"({op.comment})" if op.comment else ""


class ChannelEmitter:
    def __init__(self, path: Path, sync_codes: Dict[int, List[str]]):
        self.path = path
        self.codes = sync_codes
        self.sync_i = 0
        self.feed_mode: Optional[int] = None   # 98 / 99

    def _home(self) -> str:
        return "G28U0" if self.path == Path.P1 else "G28W0."

    def emit(self, op: Op) -> List[str]:
        c = _cmt(op)
        if isinstance(op, Raw):
            return [op.text + c]
        if isinstance(op, Label):
            return [f"N{op.n}{c}"]
        if isinstance(op, Sync):
            out = self.codes[self.sync_i]
            self.sync_i += 1
            return [w + (c if i == 0 else "") for i, w in enumerate(out)]
        if isinstance(op, ToolCall):
            return [f"T{op.tool.number:02d}00{c}"]
        if isinstance(op, ToolCancel):
            return ["G0T0" + c, self._home()]
        if isinstance(op, Rapid):
            t = f"T{op.offset}" if op.offset is not None else ""
            return [f"G0{words(op.axes)}{t}{c}"]
        if isinstance(op, Feed):
            g = 99 if op.per_rev else 98
            mode = f"G{g}" if g != self.feed_mode else ""
            self.feed_mode = g
            f = word("F", op.f) if op.f is not None else ""
            return [f"G1{mode}{words(op.axes)}{f}{c}"]
        if isinstance(op, Arc):
            f = word("F", op.f) if op.f is not None else ""
            return [f"G{2 if op.cw else 3}{words(op.axes)}R{fnum(op.r)}{f}{c}"]
        if isinstance(op, Cycle):
            lines = [f"G{op.g}{words(op.words)}{c}"]
            lines += [words(x) for x in op.extra_lines]
            if op.g in (83, 84, 87):
                lines.append("G80")
            return lines
        if isinstance(op, Spindle):
            s = word("S", op.rpm) if op.rpm else ""
            pre = ("G96" if op.css else "G97") if op.mode in ("cw", "ccw") and op.rpm else ""
            m = {"cw": "M3", "ccw": "M4", "stop": "M5", "live_cross": "M36",
                 "live_back": "M56",
                 "live_off": "M38" if self.path == Path.P1 else "M58"}[op.mode]
            return [f"{pre}{m}{s}{c}"]
        if isinstance(op, Coolant):
            return [("M8" if op.on else "M9") + c]
        if isinstance(op, MCode):
            return [f"M{op.code}{words(op.words)}{c}"]
        if isinstance(op, Dwell):
            return [f"G4{op.letter}{fnum(op.seconds)}{c}"]
        raise TypeError(f"no emitter for {type(op).__name__}")

    def emit_all(self, ops: List[Op]) -> List[str]:
        out: List[str] = []
        for op in ops:
            out += self.emit(op)
        return out


def post_shop(prog: Program, strategy: Optional[SyncStrategy] = None) -> Dict[str, str]:
    """Shop dialect: {'<name>-P1': text, '<name>-P2': text}."""
    codes = assign_codes(prog, strategy or ShopSyncStrategy())
    name = prog.params.name
    out = {}
    for path, ch, title in ((Path.P1, prog.p1, "MAIN TARAFI"), (Path.P2, prog.p2, "SUB TARAFI")):
        fname = f"{name}-{path.name}"
        lines = ["%", f"<{fname}>", f"({title} BASLANGIC)"]
        if prog.params.date:
            lines.append(f"({prog.params.date})")
        lines += ChannelEmitter(path, codes).emit_all(ch.ops)
        lines.append("%")
        out[fname] = "\n".join(lines) + "\n"
    return out


def post_star(prog: Program, strategy: Optional[SyncStrategy] = None) -> str:
    """Star catalog style single file: $1 block, $2 block, numbered M2xx waits."""
    codes = assign_codes(prog, strategy or NumberedWaitStrategy())
    lines = ["%"]
    for path, ch in ((Path.P1, prog.p1), (Path.P2, prog.p2)):
        lines.append(f"${path.value}")
        lines.append(f"{prog.params.name}")
        lines += ChannelEmitter(path, codes).emit_all(ch.ops)
    lines.append("%")
    return "\n".join(lines) + "\n"
