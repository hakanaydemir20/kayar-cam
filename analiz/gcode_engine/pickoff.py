"""Part-transfer (pick-off) choreography and the overlapped shop cycle."""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

from .model import (Dwell, Feed, Label, MCode, Op, Path, PartParams, Program, Rapid,
                    Raw, Spindle, Sync, Tool, ToolCall, ToolCancel, ToolUnit)
from .sync import CUT_DONE, CYCLE_START, PART_GRIPPED, SPINDLE_SYNC, SyncError, validate_sync

# semantic tags checked by check_pickoff
T_CUT_POS = "cut_position"   # P1 cutoff tool at X above the part, ready
T_CUT = "cut"                # P1 cutting feed
T_APPROACH = "approach"      # P2 move toward main spindle
T_GRIP = "grip"              # P2 chuck close
T_RETRACT = "retract"        # P2 pull part away
T_MAIN_OPEN = "main_open"    # P1 main collet open (M11)
T_PHASE = "phase_sync"       # optional C phase-sync code


def p1_header(p: PartParams) -> List[Op]:
    return [
        Raw(text=f"#531={_n(p.bar_dia + 1)}", comment="BAR CAPI+1"),
        Raw(text=f"#530={_n(p.part_length)}", comment="PARCA BOYU"),
        Raw(text=f"#529={p.cutoff_rpm}", comment="KESME DEVRI"),
        Raw(text=f"#528={_n(p.cutoff_width)}", comment="KESME GENISLIGI"),
        Raw(text=f"#120={_n(p.extra)}"),
        Raw(text="G28U0"), Raw(text="T200"), Raw(text="M98P9012"),
        Label(n=99),
        # bar feed: open collet, push to Z-0.2, set zero, close collet.
        # This is where the main collet opens in the real shop cycle (not in N100).
        MCode(code=11), Raw(text="G0Z-0.2T0"), Raw(text="G125Z-0.2"), MCode(code=10),
        Sync(event=CYCLE_START),
        MCode(code=20, comment="ONE CYCLE"),
    ]


def p2_header(p: PartParams) -> List[Op]:
    return [
        Raw(text=f"#530={_n(p.grip_length)}", comment="PARCA YAKALAMA"),
        Raw(text="G130"), Raw(text="G99M5"), Raw(text="G40"), ToolCancel(),
        Raw(text="T2000"),
        Sync(event=CYCLE_START),
    ]


def p2_eject() -> List[Op]:
    return [Raw(text="T2900", comment="PARCA ATMA"), Rapid(axes={"Z": 40.0}),
            MCode(code=5), MCode(code=10), MCode(code=14), MCode(code=11),
            Dwell(seconds=0.5, letter="X"), MCode(code=15), Raw(text="G28W0")]


# ------------------------------------------------------------------ transfer
@dataclass
class TransferCodes:
    """Transfer M codes, parametrised per dialect.
    Shop: the sync points themselves (M82/M40/M41) carry the function, so
    spindle_sync_on is None; M83 (sync off) is a plain M code, NOT a sync point.
    Star catalog: codes from the old unverified profile (M77/M78)."""
    spindle_sync_on: Optional[int] = None
    spindle_sync_off: Optional[int] = 83
    phase_sync: Optional[int] = None       # C phase sync (unknown on real machine)
    main_collet_open: int = 11
    sub_chuck_close: int = 10
    air_on: int = 14
    air_off: int = 15
    torque_limit_on: int = 68
    torque_limit_off: int = 69


SHOP_CODES = TransferCodes()
STAR_CODES = TransferCodes(spindle_sync_on=77, spindle_sync_off=78)

# where the main collet opens:
#   'next_cycle' (default, real shop): never in N100; opens at N99 for the bar feed
#   'after_cut'  : opens in N100 after CUT_DONE (allowed)
#   'after_grip' : literal "grip -> open main -> retract -> cut" order -> REJECTED
MAIN_OPEN_MODES = ("next_cycle", "after_cut", "after_grip")


def build_pickoff(p: PartParams, cutoff: Tool, approach_z: float = -30.0,
                  retract_w: float = -20.0, macros: bool = True,
                  codes: TransferCodes = SHOP_CODES,
                  main_open: str = "next_cycle") -> Tuple[List[Op], List[Op]]:
    """Return (p1_ops, p2_ops) for the N100 transfer block (shop-proven order):

      P1 0. cutoff tool to cut position (before sync, so the sub can come safely)
      both 2. SPINDLE_SYNC  (shop M82: speed sync; optional C phase code)
      P2 1. G131, G0 Z safe gap, air + torque limit, G1 to grip Z (#530)
      P2 3. sub chuck close + dwell, air off   -> PART_GRIPPED (shop M40, Z sync on)
      P1 4. main collet stays CLOSED (opens at next N99 for bar feed)
      P1 6. cutoff while both spindles hold the part -> CUT_DONE (shop M41, Z sync off)
      P2 5. retract W-20, G28W0.  -- only after CUT_DONE
    In the real shop file the sub approach comes right after M82 (step 2 before 1).
    """
    if cutoff.path != Path.P1:
        raise ValueError("cutoff tool must be a P1 gang tool")
    if main_open not in MAIN_OPEN_MODES:
        raise ValueError(f"main_open must be one of {MAIN_OPEN_MODES}")
    x_safe = p.bar_dia + 1
    if macros:
        spin: Op = Raw(text="M3S#529")
        pos: Op = Raw(text=f"G0G99X[#531+1.]Z[#530+#528+#120]T{cutoff.off}", tag=T_CUT_POS)
        grip_feed: Op = Raw(text="G1G99Z#530F1.5", tag=T_APPROACH, est_time=0.5)
    else:
        spin = Spindle(rpm=p.cutoff_rpm, mode="cw")
        pos = Rapid(axes={"X": x_safe + 1, "Z": p.part_length + p.cutoff_width + p.extra},
                    offset=cutoff.off, tag=T_CUT_POS)
        # spindles run synced at main rpm, so time is not f*S50
        grip_feed = Feed(axes={"Z": p.grip_length}, f=1.5, tag=T_APPROACH, est_time=0.5)

    def m(c: Optional[int], **kw) -> List[Op]:
        return [MCode(code=c, **kw)] if c is not None else []

    open_main = MCode(code=codes.main_collet_open, tag=T_MAIN_OPEN, comment="MAIN PENS ACIK")
    p1: List[Op] = [
        Label(n=100), ToolCall(tool=cutoff), spin, pos,
        *m(codes.spindle_sync_on),
        Sync(event=SPINDLE_SYNC),
        *m(codes.phase_sync, tag=T_PHASE),
        Sync(event=PART_GRIPPED),
        *([open_main] if main_open == "after_grip" else []),
        Feed(axes={"X": 0.5}, f=0.03, tag=T_CUT),
        Feed(axes={"X": -1.0}, tag=T_CUT),
        Sync(event=CUT_DONE),
        *([open_main] if main_open == "after_cut" else []),
        *m(codes.spindle_sync_off),
        Rapid(axes={"X": x_safe}), ToolCancel(),
        Raw(text="M99P99"),
    ]
    p2: List[Op] = [
        Label(n=100), Raw(text="G0G98"), Raw(text="T2000"), Raw(text="G28W0."),
        Raw(text="G99M4S50"), MCode(code=11), Dwell(seconds=0.4),
        *m(codes.spindle_sync_on),
        Sync(event=SPINDLE_SYNC),
        Raw(text="G131", comment="MAIN SIFIRI SUBTA"),
        Rapid(axes={"Z": approach_z}, tag=T_APPROACH, comment="GUVENLI YAKLASMA"),
        MCode(code=codes.air_on), MCode(code=codes.torque_limit_on),
        grip_feed,
        MCode(code=codes.torque_limit_off),
        MCode(code=codes.sub_chuck_close, tag=T_GRIP, comment="AYNA KAPAT"),
        Dwell(seconds=0.5), MCode(code=codes.air_off),
        Sync(event=PART_GRIPPED),
        Sync(event=CUT_DONE),
        MCode(code=codes.torque_limit_on), Rapid(axes={"W": retract_w}, tag=T_RETRACT),
        MCode(code=codes.torque_limit_off),
        *m(codes.spindle_sync_off),
        Raw(text="G28W0."), Raw(text="M99"),
    ]
    return p1, p2


def pickoff_cycle(params: PartParams, dialect: str = "shop", cutoff: Optional[Tool] = None,
                  codes: Optional[TransferCodes] = None, main_open: str = "next_cycle",
                  macros: Optional[bool] = None):
    """Build the transfer for both channels and emit ISO G-code.

    Returns (p1_lines, p2_lines, steps); steps = [(step_no, text, sync_words|None)].
    Raises SyncError for unsafe orders (main collet open or sub retract before
    cut done, approach before spindle sync, cut before grip).
    dialect 'shop' -> M82/M40/M41 (sync = function); 'star' -> M200+n waits
    plus TransferCodes function codes.
    """
    from .post import ChannelEmitter
    from .sync import NumberedWaitStrategy, ShopSyncStrategy, assign_codes
    cutoff = cutoff or Tool(1, ToolUnit.GANG, name="kesme")
    if dialect == "shop":
        codes = codes or SHOP_CODES
        strat = ShopSyncStrategy()
        macros = True if macros is None else macros
    elif dialect == "star":
        codes = codes or STAR_CODES
        strat = NumberedWaitStrategy(actions={})   # function codes come from TransferCodes
        macros = False if macros is None else macros
    else:
        raise ValueError("dialect must be 'shop' or 'star'")
    prog = Program(params=params)
    a, b = build_pickoff(params, cutoff, codes=codes, main_open=main_open, macros=macros)
    prog.p1.add(*a)
    prog.p2.add(*b)
    check_pickoff(prog)
    sc = assign_codes(prog, strat)

    def w(i: int) -> str:
        return " ".join(sc[i])

    steps = [
        (1, "P2: sub yaklasir (G131, G0 guvenli bosluk, G1 yakalama Z)", None),
        (2, "P1+P2: devir (ve istege bagli C faz) senkronu", w(0)),
        (3, "P2: sub ayna kapanir + bekleme -> parca tutuldu", w(1)),
        (4, "P1: main pens KAPALI kalir; sonraki N99'da acilir (bar surme)", None),
        (6, "P1: kesme, iki ayna parcayi tutarken -> kesme bitti", w(2)),
        (5, "P2: parcayla geri cekilir W-, G28W0. (yalnizca kesme bittikten sonra)", None),
    ]
    return (ChannelEmitter(Path.P1, sc).emit_all(prog.p1.ops),
            ChannelEmitter(Path.P2, sc).emit_all(prog.p2.ops), steps)


def build_cycle(p: PartParams, main_ops: Sequence[Op], back_ops: Sequence[Op],
                cutoff: Tool) -> Program:
    """Shop overlapped cycle: P2 machines the PREVIOUS part (gripped since last
    pick-off) and ejects it while P1 machines the current one; then N100 transfer."""
    prog = Program(params=p)
    po1, po2 = build_pickoff(p, cutoff)
    prog.p1.add(*p1_header(p), *main_ops, *po1)
    prog.p2.add(*p2_header(p), *back_ops, *p2_eject(), *po2)
    check_pickoff(prog)
    return prog


def _idx(ops: List[Op], pred) -> List[int]:
    return [i for i, o in enumerate(ops) if pred(o)]


def _sync_idx(ops, ev) -> int:
    ix = _idx(ops, lambda o: isinstance(o, Sync) and o.event == ev)
    if not ix:
        raise SyncError(f"missing sync '{ev}'")
    return ix[-1]


def check_pickoff(prog: Program) -> None:
    """Safety invariants (in addition to sync sequence equality):
    1. P1 at cut position before SPINDLE_SYNC; P2 approach only after it.
    2. P2 grip before PART_GRIPPED; P1 cut only after it.
    3. P1 cut before CUT_DONE; P2 retract only after it (else part is torn off).
    4. Main collet must not open in the transfer before CUT_DONE (the bar is then
       held only by the guide bush, the part only by the sub: cut chatters,
       bar can be pulled out / part bends or tears)."""
    validate_sync(prog)
    a, b = prog.p1.ops, prog.p2.ops
    s1 = {e: _sync_idx(a, e) for e in (SPINDLE_SYNC, PART_GRIPPED, CUT_DONE)}
    s2 = {e: _sync_idx(b, e) for e in (SPINDLE_SYNC, PART_GRIPPED, CUT_DONE)}

    def tagged(ops, t):
        return _idx(ops, lambda o: o.tag == t)

    def need(cond, msg):
        if not cond:
            raise SyncError("pick-off safety: " + msg)

    pos = tagged(a, T_CUT_POS)
    need(pos and max(pos) < s1[SPINDLE_SYNC], "P1 must reach cut position before spindle sync")
    need(all(i > s2[SPINDLE_SYNC] for i in tagged(b, T_APPROACH)),
         "sub must not approach main before P1 is at cut position (spindle sync)")
    grip = tagged(b, T_GRIP)
    need(grip and max(grip) < s2[PART_GRIPPED], "sub must grip before PART_GRIPPED")
    cut = tagged(a, T_CUT)
    need(cut and min(cut) > s1[PART_GRIPPED], "P1 must not start cut before grip")
    need(max(cut) < s1[CUT_DONE], "cut must finish before CUT_DONE")
    ret = tagged(b, T_RETRACT)
    need(ret and min(ret) > s2[CUT_DONE], "sub must not retract before cut done")
    n100 = max(_idx(a, lambda o: isinstance(o, Label) and o.n == 100) or [0])
    need(not any(n100 <= i < s1[CUT_DONE] for i in tagged(a, T_MAIN_OPEN)),
         "main collet must not open before cut done (bar unsupported, part tears)")


def _n(v: float) -> str:
    from .post import fnum
    return fnum(v)
