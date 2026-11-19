"""G-kodu parçacıkları: FANUC standart (G7.1 / G12.1) ve atölye stili (C indeks + M6/M7,
G19 G2 Y-Z, H artımsal C, M36S../M38, T3100 + G0..T31). Post doğrulanmamıştır."""
from __future__ import annotations

import math
from typing import Iterable, List, Sequence, Tuple

from . import transforms as T


def f3(v: float) -> str:
    s = f"{v:.3f}".rstrip("0").rstrip(".")
    if s in ("-0", ""):
        s = "0"
    return s if "." in s else s + "."


def _fmt(**ax) -> str:
    return "".join(f"{k}{f3(v)}" for k, v in ax.items() if v is not None)


# --------------------------------------------------------------------------- FANUC standart
def fanuc_cyl_keyway(R: float, z0: float, z1: float, c0_deg: float, c1_deg: float,
                     depth: float, step_down: float, feed: float) -> List[str]:
    """G7.1 silindirik interpolasyon (JS GEN.cylSlot ile aynı yapı: dalış, G7.1 C{R},
    Z/C hareket, G7.1 C0). G7.1 içinde C derece yazılır (generators.js gibi)."""
    out = [f"G0{_fmt(X=2 * (R + 1), Z=z0, C=c0_deg)}"]
    at0 = True
    for d in T.depth_levels(depth, step_down):
        out.append(f"G1{_fmt(X=2 * (R - d))}F{round(feed * 0.5)}")
        out.append(f"G7.1C{f3(R)}")
        z, c = (z1, c1_deg) if at0 else (z0, c0_deg)
        out.append(f"G1{_fmt(Z=z, C=c)}F{round(feed)}")
        out.append("G7.1C0")
        at0 = not at0
    out.append(f"G0{_fmt(X=2 * (R + 1))}")
    return out


def fanuc_polar(pts_xy: Sequence[Tuple[float, float]], z_depth: float, feed: float,
                x_start: float) -> List[str]:
    """G12.1 polar interpolasyon: X = 2·x (çap), C = y (mm). G13.1 ile iptal."""
    out = [f"G0{_fmt(X=x_start, C=0.0)}", "G12.1", f"G1{_fmt(Z=z_depth)}F{round(feed)}"]
    for x, y in pts_xy:
        out.append(f"G1{_fmt(X=2 * x, C=y)}")
    out += [f"G1{_fmt(X=x_start, C=0.0)}", "G13.1"]
    return out


# --------------------------------------------------------------------------- atölye stili
def shop_live_start(tool: int = 31, rpm: int = 2800, c_deg: float = 0.0,
                    x: float = 10.0, z: float = 0.0, clamp: bool = True) -> List[str]:
    """T3100 seçimi, M36S (canlı takım), C indeks, M6 kilit, G0..T31 (O112233B stili)."""
    out = [f"T{tool}00", "M8", f"M36S{rpm}", f"G0C{f3(c_deg)}"]
    if clamp:
        out.append("M6")
    out.append(f"G0{_fmt(X=x, Z=z)}T{tool}")
    return out


def shop_live_end() -> List[str]:
    return ["M7", "M38", "G0T0", "G28U0"]


def shop_keyway_y(R: float, z0: float, z1: float, c_deg: float, width: float, rt: float,
                  depth: float, step_down: float, feed: float, y_clear: float = 2.0) -> List[str]:
    """C kilitli kama kanalı, Y-ofset pasoları (duvarlar paralel). G17 düzlem, Y ile kayma."""
    out = shop_live_start(c_deg=c_deg, x=2 * (R + 1), z=z0)
    out.append(f"G1G98F{round(feed)}")
    for y in T.keyway_y_offsets(width, rt):
        out.append(f"G0Y{f3(y)}")
        at0 = True
        for d in T.depth_levels(depth, step_down):
            out.append(f"G1X{f3(2 * (R - d))}")
            out.append(f"G1Z{f3(z1 if at0 else z0)}")
            at0 = not at0
        out.append(f"G0X{f3(2 * (R + 1))}")
        out.append(f"G0Z{f3(z0)}")
    out.append("G0Y0")
    return out + shop_live_end()


def shop_g19_slot(R: float, y_ent: float, z_c: float, j: float, x_levels: Iterable[float],
                  feed: float, y_clear: float = 2.0) -> List[str]:
    """Y-Z düzleminde (G19) yay kanal/yuvarlak cep — O112233B-P1 yapısı:
    G0Y(y_ent+boşluk) / G1X.. / G1Y y_ent / G2Y-y_ent Z.. J.. K0 / G1Y-.. / G0X.. """
    ys = y_ent + y_clear
    out = ["G19", f"G0Y{f3(ys)}"]
    first = True
    for x in x_levels:
        out.append(f"G1G98X{f3(x)}F{round(feed)}." if first else f"G1X{f3(x)}")
        first = False
        out.append(f"G1Y{f3(y_ent)}")
        out.append(f"G2Y{f3(-y_ent)}Z{f3(z_c)}J{f3(j)}K0")
        out.append(f"G1Y{f3(-ys)}")
        out.append(f"G0X{f3(2 * (R + 1))}")
        out.append(f"G0Y{f3(ys)}")
    return out


def shop_full_turns(turns: int, feed: float) -> List[str]:
    """C tam turları artımsal H (OFREZE stili: H365F1500) — C kilit açık (M7 sonrası)."""
    """Not: atölye programı H365 kullanır (360 + 5° bindirme); burada aynen korunur."""
    return ["M7"] + [f"H365F{round(feed)}" for _ in range(turns)]


def shop_index_holes(holes: Sequence[T.CrossHole], feed: float, rpm: int = 2800,
                     tool: int = 31) -> List[str]:
    """Çapraz delikler: her delik için C indeks + M6 kilit, delme, M7 çöz."""
    out = [f"T{tool}00", "M8", f"M36S{rpm}"]
    first = True
    for h in holes:
        m = T.cross_hole_machine(h)
        out.append(f"G0C{f3(m['C'])}")
        out.append("M6")
        out.append(f"G0{_fmt(X=m['X_start'], Z=m['Z'])}" + (f"T{tool}" if first else ""))
        first = False
        if abs(m["Y"]) > 1e-9:
            out.append(f"G0Y{f3(m['Y'])}")
        out.append(f"G1G98X{f3(m['X_bottom'])}F{round(feed)}")
        out.append(f"G0X{f3(m['X_start'])}")
        out.append("M7")
    return out + ["M38", "G0T0"]
