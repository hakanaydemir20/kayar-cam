"""Yöntem seçimi: silindirik (G7.1) / Y ekseni / polar (G12.1) / indeksleme."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

from . import transforms as T

Y_STROKE = 20.0   # SB-20R çapraz Y stroku ~ ±20 mm (yaklaşık)


@dataclass
class Feature:
    kind: str                      # 'keyway','helix','engrave','face_flat','face_polygon','face_slot','cross_hole','flat'
    R: float = 5.0                 # çap/2
    width: float = 0.0
    depth: float = 0.0
    tool_dia: float = 0.0
    lead: Optional[float] = None
    tol: float = 0.01              # duvar/kontur toleransı
    face_extent: float = 0.0       # alın özelliği: merkezden en uzak |y| (mm)
    through_center: bool = False   # alın konturu merkezden geçiyor mu
    on_face: bool = False


@dataclass
class Choice:
    method: str                    # 'cylindrical','y_axis','polar','index'
    reasons: List[str] = field(default_factory=list)


def choose_method(f: Feature) -> Choice:
    r: List[str] = []
    if f.kind in ("helix", "engrave"):
        r.append("Z ile C birlikte sürekli değişiyor → yalnız silindirik interpolasyon (G7.1)")
        if f.width > f.tool_dia + 1e-9:
            dev = T.keyway_wall_deviation_max(f.R, f.width, f.depth, f.tool_dia / 2)
            r.append(f"Genişlik > takım: ofset pasoları duvarı {dev:.3f} mm eğer (radyal duvar)")
        return Choice("cylindrical", r)
    if f.kind == "keyway":
        rt = f.tool_dia / 2
        if f.width <= f.tool_dia + 1e-9:
            r.append("Kanal = takım çapı: C kilitli (M6) tek paso, Z yönünde; duvarlar takım yüzeyi → paralel")
            return Choice("index", r)
        e = f.width / 2 - rt
        dev = T.keyway_wall_deviation_max(f.R, f.width, f.depth, rt)
        if e + rt <= Y_STROKE:
            r.append(f"Y-ofset (±{e:.3f}) ile duvarlar tam paralel; G7.1/C-ofset sapması {dev:.4f} mm")
            r.append("C kilitli → rijit, çevrim kısa, düz taban")
            return Choice("y_axis", r)
        r.append("Y stroku yetmiyor → G7.1 + G41/G42; duvar sapması " + f"{dev:.4f} mm")
        return Choice("cylindrical", r)
    if f.kind in ("cross_hole", "flat"):
        if f.width / 2 > Y_STROKE:
            r.append("Düzlük genişliği Y strokunu aşıyor → polar/indeks gerekli")
            return Choice("cylindrical", r)
        r.append("C indeks + M6 kilit, Y ile düz yüzey/delik: düz taban tam, tekillik yok")
        return Choice("y_axis" if f.kind == "flat" else "index", r)
    if f.kind in ("face_flat", "face_polygon", "face_slot"):
        if f.through_center:
            r.append("Kontur merkezden geçiyor: polar tekillik (C hızı sonsuz)")
            if f.face_extent <= Y_STROKE:
                r.append("Alın takımı + C kilitli Y-X hareketi (G17 benzeri) tercih edilir")
                return Choice("y_axis", r)
        if f.face_extent > Y_STROKE:
            r.append("Y stroku yetmiyor → polar (G12.1)")
            return Choice("polar", r)
        if f.kind == "face_polygon":
            r.append("Çokgen: polar (G12.1) tek kontur, tüm kenarlar tek kurulum (JS GEN.backPolar)")
            r.append("Alternatif: her kenar için C indeks + Y — kenarlar tam düz ama çok indeks")
            return Choice("polar", r)
        r.append("Tek düzlük/kanal: C kilitli Y hareketi — tam düz, tekillik yok")
        return Choice("y_axis", r)
    raise ValueError(f.kind)
