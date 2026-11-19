"""Gagalamalı delme (G83/G73) ve kılavuz çekme — yalnız kayar otomat.

Path 1 (ön delme): matkap gang/ön takımda sabit, çubuk Z1 ile burç içinden itilir.
   Eksenel itme → ana fener pensi (chuck) eksenel yükü; burç radyal destektir, eksenel yük taşımaz.
Path 2 (arka delme): alt fener Z2 pensteki parçayı matkaba sürer.
   Eksenel itme → parçayı pense geri iter: kayma kontrolü μ·F_sıkma·(g/g_ref) ile.
Birimler: mm, mm/dev, dev/dak, N, N·mm, s.
"""
from dataclasses import dataclass, field
from typing import List, Optional
import math
import numpy as np

from .materials import get_material

RAPID = 24000.0
POINT_HALF = 59.0          # 118° matkap
# Keski ağzı genişliği / D. Klasik (inceltilmemiş) HSS matkapta ~0.18; kayar otomatta kullanılan
# karbür, göbeği inceltilmiş (web-thinned) matkaplarda ~0.06. İnceltme itmeyi %30–50 azaltır
# (Shaw "Metal Cutting Principles"; Sandvik Ff ≈ 0.5·kc·(D/2)·fn·sinκ ile ±%20 uyum, bkz. README).
CHISEL_RATIO = {"thinned": 0.06, "conventional": 0.18}
CHISEL_FACTOR = 1.5        # keski ağzı negatif talaş açısı çarpanı

# L/D sınırı (gagalamasız) ve temel Q/D oranı (malzemeye göre, YAKLAŞIK)
LD_LIMIT = {"free": 4.0, "brass": 5.0, "c45": 3.0, "alloy": 3.0, "ss": 2.5,
            "alu": 3.5, "ti": 2.0, "pom": 4.0}
Q_FACTOR = {"free": 1.0, "brass": 1.2, "c45": 0.6, "alloy": 0.5, "ss": 0.35,
            "alu": 0.8, "ti": 0.3, "pom": 1.0}


@dataclass
class DrillForces:
    Fc_lip: float      # ağız başına kesme kuvveti [N]
    thrust: float      # toplam eksenel itme [N] (ağızlar + keski)
    thrust_chisel: float
    torque: float      # [N·mm]
    power_kw: float


def drill_forces(material, D: float, f: float, vc: float = 50.0,
                 point: str = "thinned") -> DrillForces:
    """Ağız başına Kienzle: h = (f/2)·sin κ, b = (D/2)/sin κ, Fc1 = kc1.1·b·h^(1−mc).
    Moment M = 2·Fc1·D/4. Ağız itmesi = 2·oran·Fc1·sin κ.
    Keski: F_ch = 1.5·kc1.1·(r·D)·(f/2)^(1−mc); r = 0.06 (inceltilmiş uç) / 0.18 (klasik).
    D ≤ 0 veya f ≤ 0 → ValueError."""
    if D <= 0 or f <= 0:
        raise ValueError("D ve f pozitif olmalı")
    m = get_material(material)
    k = math.radians(POINT_HALF)
    h = f / 2 * math.sin(k); b = D / 2 / math.sin(k)
    Fc1 = m.kc11 * b * h ** (1 - m.mc)
    Fch = CHISEL_FACTOR * m.kc11 * CHISEL_RATIO[point] * D * (f / 2) ** (1 - m.mc)
    thrust = 2 * m.thrust_ratio * Fc1 * math.sin(k) + Fch
    M = Fc1 * D / 2
    return DrillForces(Fc1, thrust, Fch, M, Fc1 * vc / 60000.0)


def tap_torque(material, D: float, pitch: float) -> float:
    """Rijit kılavuz momenti (basit): M ≈ P·kc1.1·D²/8 [N·mm] (Sandvik tipi)."""
    m = get_material(material)
    return pitch * m.kc11 * D ** 2 / 8.0


def needs_peck(material, D: float, depth: float) -> bool:
    return depth / D > LD_LIMIT.get(get_material(material).key, 3.0)


def recommend_q(material, D: float, depth: float) -> float:
    """Önerilen Q [mm]: Q = D·Q_FACTOR·c(L/D); c = 1 (L/D≤5), 0.7 (≤8), 0.5 (>8). Gagalama gerekmiyorsa Q = derinlik."""
    m = get_material(material)
    if not needs_peck(m, D, depth):
        return depth
    ld = depth / D
    c = 1.0 if ld <= 5 else (0.7 if ld <= 8 else 0.5)
    return max(0.05, D * Q_FACTOR.get(m.key, 0.6) * c)


def recommend_cycle(material, D: float, depth: float) -> str:
    """L/D ≤ 4 (sınırın biraz üstü) → G73 (talaş kırma); daha derin → G83 (tam boşaltma)."""
    if not needs_peck(material, D, depth):
        return "none"
    return "g73" if depth / D <= max(4.0, LD_LIMIT.get(get_material(material).key, 3.0) + 1) else "g83"


@dataclass
class PeckSchedule:
    cycle: str
    pecks: List[float]          # her gaganın bitiş derinliği [mm]
    feed_time: float
    rapid_time: float
    total_time: float

    @property
    def count(self) -> int:
        return len(self.pecks)


def peck_schedule(depth: float, q: float, f: float, n: float, cycle: str = "g83",
                  retract: float = 0.2, clearance: float = 1.0, decay: float = 1.0,
                  q_min: Optional[float] = None, overhead: float = 0.03,
                  rapid: float = RAPID) -> PeckSchedule:
    """G83: her gagada R noktasına (−clearance) G0 geri, G0 ile (önceki derinlik − d)'ye dön, d+q G1.
    G73: her gagada d kadar G0 geri, d+q G1. Azalan gaga: q_i = max(q_min, q·decay^i).
    Süre = Σ G1 yolu/(f·n) + Σ G0 yolu/rapid + gaga başına ivme payı."""
    if cycle not in ("g83", "g73", "none"):
        raise ValueError("cycle 'g83' | 'g73' | 'none'")
    vf = f * n / 60.0; vr = rapid / 60.0
    q_min = q_min if q_min is not None else 0.25 * q
    pecks, z, i = [], 0.0, 0
    if cycle == "none" or q >= depth:
        pecks = [depth]
    else:
        while z < depth - 1e-9:
            qi = max(q_min, q * decay ** i)
            z = min(depth, z + qi); pecks.append(z); i += 1
    feed = clearance / vf + depth / vf; rap = 2 * clearance / vr
    prev = 0.0
    for j, zp in enumerate(pecks):
        if j > 0:
            feed += retract / vf          # yeniden yaklaşma payı d (G1)
            if cycle == "g83":
                rap += 2 * (prev + clearance) / vr
            else:
                rap += 2 * retract / vr
        prev = zp
    rap += (pecks[-1] + clearance) / vr   # son çıkış
    total = feed + rap + overhead * len(pecks)
    return PeckSchedule(cycle, pecks, feed, rap, total)


@dataclass
class AxialCheck:
    thrust: float
    capacity: float
    torque: float
    torque_capacity: float
    slip: bool
    warnings: List[str] = field(default_factory=list)


def collet_slip_check(thrust: float, torque: float, D_part: float, grip: float,
                      clamp_force: float = 6000.0, mu: float = 0.15, grip_ref: float = 10.0,
                      safety: float = 2.0, where: str = "Path 2 pens") -> AxialCheck:
    """Pens kayma: eksenel kapasite = μ·F_sıkma·min(1, g/g_ref); burulma = kapasite·D/2.
    thrust·SF > kapasite veya M·SF > M_kap → kayma uyarısı. F_sıkma ~ pens çekme kuvvetinden (VARSAYIM)."""
    cap = mu * clamp_force * min(1.0, grip / grip_ref)
    tcap = cap * D_part / 2
    w = []
    slip = thrust * safety > cap or torque * safety > tcap
    if thrust * safety > cap:
        w.append(f"{where}: itme {thrust:.0f} N × SF{safety:g} > eksenel tutma {cap:.0f} N (kayma riski; g={grip} mm)")
    if torque * safety > tcap:
        w.append(f"{where}: moment {torque/1000:.2f} N·m × SF > tutma {tcap/1000:.2f} N·m")
    return AxialCheck(thrust, cap, torque, tcap, slip, w)


def bush_axial_check(thrust: float, torque: float, D_bar: float,
                     clamp_force: float = 12000.0, mu: float = 0.15) -> AxialCheck:
    """Path 1: itme ana fener pensine gider (çubuk tam kavranmış, g ≥ g_ref); burç eksenel yük taşımaz."""
    return collet_slip_check(thrust, torque, D_bar, 10.0, clamp_force, mu, 10.0,
                             where="Path 1 ana fener pensi")


# ------------------------------------------------------------ G-kodu
def gcode_peck_front(tool: int, depth: float, q: float, f: float, rpm: int,
                     cycle: str = "g83", f_approach: float = 0.04) -> str:
    """Ön (Path 1) delme, atölye diyalekti. Q µm cinsinden."""
    g = "G73" if cycle == "g73" else "G83"
    t = f"{tool:02d}"
    return "\n".join([
        f"T{t}00", f"M3S{rpm}", f"G0X0Y0T{t}", "G99G1Z-0.5F0.5", f"Z0F{f_approach:g}",
        f"{g}Z{depth:.3f}Q{int(round(q*1000))}F{f:g}", "G80", "G0Z-5", "G0T0"])


def gcode_peck_back(tool: int, depth: float, q: float, f: float,
                    cycle: str = "g83", f_approach: float = 0.04) -> str:
    """Arka (Path 2) delme: Z2 artımsal W ile."""
    g = "G73" if cycle == "g73" else "G83"
    t = f"{tool:02d}"
    return "\n".join([
        f"T{t}00", f"T{t}", "G99G0Z-5", f"G1Z0F{f_approach:g}",
        f"{g}W{depth:.3f}Q{int(round(q*1000))}F{f:g}", "G80", "G0Z-5", "G28W0.", "G0T0"])
