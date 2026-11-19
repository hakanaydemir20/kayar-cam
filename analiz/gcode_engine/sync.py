"""Sync points between P1/P2: code assignment strategies, validation, timeline."""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .model import (Arc, Channel, Cycle, Dwell, Feed, MCode, Op, Path, Program,
                    Rapid, Spindle, Sync, ToolCall, ToolCancel)


class SyncError(RuntimeError):
    pass


# Canonical events used by the shop template.
CYCLE_START = "cycle_start"      # M200
SPINDLE_SYNC = "spindle_sync"    # M82 (also turns on spindle sync)
PART_GRIPPED = "part_gripped"    # M40 (also Z-axis sync on)
CUT_DONE = "cut_done"            # M41 (also Z-axis sync off)


# ------------------------------------------------------------- strategies
class SyncStrategy:
    def assign(self, events: List[str]) -> Dict[int, List[str]]:
        """Return per-occurrence-index -> list of words for that sync op."""
        raise NotImplementedError


@dataclass
class ShopSyncStrategy(SyncStrategy):
    """Fixed shop vocabulary: sync codes ARE function codes (M82=spindle sync etc.)."""
    mapping: Dict[str, str] = field(default_factory=lambda: {
        CYCLE_START: "M200", SPINDLE_SYNC: "M82",
        PART_GRIPPED: "M40", CUT_DONE: "M41"})

    def assign(self, events):
        out = {}
        for i, ev in enumerate(events):
            if ev not in self.mapping:
                raise SyncError(f"shop dialect has no code for sync event '{ev}' "
                                f"(add it to ShopSyncStrategy.mapping)")
            out[i] = [self.mapping[ev]]
        return out


@dataclass
class NumberedWaitStrategy(SyncStrategy):
    """Star catalog style: every sync gets a unique M200+n (or M300+n) wait code.
    Events carrying a machine function also emit that function code after the wait.
    Function codes below come from the old (unverified) Star profile."""
    start: int = 200
    limit: int = 299
    second_series: Optional[int] = 300   # continue at M300 when M2xx exhausted
    actions: Dict[str, List[str]] = field(default_factory=lambda: {
        SPINDLE_SYNC: ["M77"], CUT_DONE: ["M78"]})

    def assign(self, events):
        out, n = {}, self.start
        for i, ev in enumerate(events):
            if n > self.limit:
                if self.second_series is None or n >= self.second_series + 100:
                    raise SyncError("ran out of wait codes")
                n = max(n, self.second_series)
            out[i] = [f"M{n}"] + self.actions.get(ev, [])
            n += 1
        return out


# ------------------------------------------------------------- validation
def validate_sync(prog: Program) -> List[str]:
    """Both channels must issue the identical ordered list of sync events.
    Any difference means one channel would wait forever (deadlock)."""
    a, b = prog.p1.syncs(), prog.p2.syncs()
    if a != b:
        for i, (x, y) in enumerate(zip(a, b)):
            if x != y:
                raise SyncError(f"sync mismatch at #{i}: P1 '{x}' vs P2 '{y}' -> deadlock")
        longer, extra = ("P1", a[len(b):]) if len(a) > len(b) else ("P2", b[len(a):])
        raise SyncError(f"{longer} has unmatched sync(s) {extra} -> deadlock")
    return a


def assign_codes(prog: Program, strategy: SyncStrategy) -> Dict[int, List[str]]:
    """Validate, then map sync occurrence index -> code words (same for both paths)."""
    return strategy.assign(validate_sync(prog))


# ------------------------------------------------------------- timeline
@dataclass
class MachineRates:
    rapid_mm_min: float = 24000.0
    tool_change_s: float = 0.6
    m_code_s: float = 0.2
    default_rpm: float = 3000.0


@dataclass
class Segment:
    index: int
    event: str                   # sync that closes this segment
    t_p1: float
    t_p2: float

    @property
    def idle_p1(self) -> float:
        return max(0.0, self.t_p2 - self.t_p1)

    @property
    def idle_p2(self) -> float:
        return max(0.0, self.t_p1 - self.t_p2)


@dataclass
class TimelineReport:
    segments: List[Segment]

    @property
    def cycle_time(self) -> float:
        return sum(max(s.t_p1, s.t_p2) for s in self.segments)

    @property
    def idle(self) -> Tuple[float, float]:
        return (sum(s.idle_p1 for s in self.segments), sum(s.idle_p2 for s in self.segments))

    def text(self) -> str:
        rows = ["seg  event          P1[s]   P2[s]  idleP1  idleP2"]
        for s in self.segments:
            rows.append(f"{s.index:>3}  {s.event:<13} {s.t_p1:6.2f}  {s.t_p2:6.2f}  "
                        f"{s.idle_p1:6.2f}  {s.idle_p2:6.2f}")
        i1, i2 = self.idle
        rows.append(f"cycle ~{self.cycle_time:.2f}s  idle P1 {i1:.2f}s  P2 {i2:.2f}s")
        return "\n".join(rows)


class _Estimator:
    def __init__(self, rates: MachineRates):
        self.r = rates
        self.pos: Dict[str, float] = {}
        self.rpm = rates.default_rpm

    def _dist(self, axes: Dict[str, float]) -> float:
        d2 = 0.0
        for k, v in axes.items():
            if k in "UVWH":   # incremental
                d = v / 2 if k == "U" else v
            else:
                old = self.pos.get(k, v)
                d = (v - old) / 2 if k == "X" else v - old
                if k == "C":
                    d = 0.0  # C index time folded into m-code time
                self.pos[k] = v
            d2 += d * d
        return math.sqrt(d2)

    def time(self, op: Op) -> float:
        if op.est_time is not None:
            if isinstance(op, (Rapid, Feed, Arc)):
                self._dist(op.axes)
            return op.est_time
        if isinstance(op, Spindle):
            if op.rpm:
                self.rpm = op.rpm
            return self.r.m_code_s
        if isinstance(op, Rapid):
            return self._dist(op.axes) / self.r.rapid_mm_min * 60
        if isinstance(op, (Feed, Arc)):
            d = self._dist(op.axes)
            f = op.f or 0.1
            per_rev = getattr(op, "per_rev", True)
            mm_min = f * self.rpm if per_rev else f
            return d / max(mm_min, 1e-6) * 60
        if isinstance(op, Cycle):
            depth = abs(op.words.get("Z", op.words.get("W", op.words.get("X", 0.0))))
            f = op.words.get("F", 0.05)
            return 2 * depth / max(f * self.rpm, 1e-6) * 60 + 0.5
        if isinstance(op, Dwell):
            return op.seconds
        if isinstance(op, (ToolCall, ToolCancel)):
            return self.r.tool_change_s
        if isinstance(op, MCode):
            return self.r.m_code_s
        return 0.0


def timeline(prog: Program, rates: Optional[MachineRates] = None) -> TimelineReport:
    """Per-path time between consecutive syncs; tail after last sync is a segment 'end'."""
    validate_sync(prog)
    rates = rates or MachineRates()

    def split(ch: Channel) -> List[Tuple[str, float]]:
        est, segs, t = _Estimator(rates), [], 0.0
        for op in ch.ops:
            if isinstance(op, Sync):
                segs.append((op.event, t))
                t = 0.0
            else:
                t += est.time(op)
        segs.append(("end", t))
        return segs

    s1, s2 = split(prog.p1), split(prog.p2)
    return TimelineReport([Segment(i, a[0], a[1], b[1]) for i, (a, b) in enumerate(zip(s1, s2))])
