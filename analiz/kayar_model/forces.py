"""Kienzle kesme kuvveti modeli (örnek başına çağrılabilir, numpy dizileriyle de çalışır).

Fc = kc1.1 · b · h^(1−mc) · K_rake · K_wear
h = f·sin κ,  b = ap/sin κ   (κ: eşdeğer yaklaşma açısı)

Uç radyüsü düzeltmesi (Colwell eşdeğer kenar yaklaşımı): ap küçükken
(özellikle ap < rn) kesme kenarının yalnızca radyüs kısmı çalışır;
eşdeğer κ, çalışan kenar kirişinin açısıdır → h küçülür, b büyür, Fp/Ff
oranı radyal yöne kayar.
"""
from dataclasses import dataclass
import math
import numpy as np
from .materials import get_material


def equivalent_kappa(ap, f, rn, kappa_deg):
    """Colwell kirişi ile eşdeğer yaklaşma açısı [rad].

    Uç ucu (0,0), radyüs merkezi (0,rn). Kenar φ=κr'ye kadar ark, sonra düz.
    Kiriş: arka uç (−f/2, 0) → ana kenarda derinlik=ap noktası.
    """
    ap = np.asarray(ap, float)
    kr = math.radians(kappa_deg)
    if rn <= 0:
        return np.full_like(ap, kr)
    ap_arc = rn * (1.0 - math.cos(kr))
    phi = np.arccos(np.clip(1.0 - ap / rn, -1.0, 1.0))
    dx_arc = rn * np.sin(phi)
    s = np.maximum(ap - ap_arc, 0.0) / math.sin(kr)
    dx_line = rn * math.sin(kr) + s * math.cos(kr)
    dx = np.where(ap <= ap_arc, dx_arc, dx_line)
    return np.arctan2(ap, dx + f / 2.0)


@dataclass
class Forces:
    Fc: np.ndarray       # kesme (teğetsel) kuvveti [N]
    Ff: np.ndarray       # ilerleme (eksenel, Z) kuvveti [N]
    Fp: np.ndarray       # pasif/radyal (X) kuvveti [N]
    h: np.ndarray        # talaş kalınlığı [mm]
    b: np.ndarray        # talaş genişliği [mm]
    kappa_eq_deg: np.ndarray
    power_kw: np.ndarray  # Pc = Fc·vc/60000


def rake_factor(gamma_deg: float, gamma0_deg: float = 6.0) -> float:
    """Talaş açısı düzeltmesi: her 1° için ~%1.5 (König). γ0 referans açı."""
    return 1.0 - 0.015 * (gamma_deg - gamma0_deg)


def wear_factor(vb_mm: float = 0.0) -> float:
    """Aşınma düzeltmesi: VB=0.3 mm için ~+%30 (yaklaşık, doğrusal)."""
    return 1.0 + vb_mm


def cutting_forces(material, ap, f, kappa_deg=95.0, rn=0.2, vc=100.0,
                   gamma_deg: float = 6.0, vb_mm: float = 0.0) -> Forces:
    """Kuvvet bileşenleri. ap, f skaler veya dizi olabilir (f=0 → kuvvet 0)."""
    m = get_material(material)
    ap = np.asarray(ap, float)
    f = np.asarray(f, float)
    k = equivalent_kappa(ap, f, rn, kappa_deg)
    sk = np.maximum(np.sin(k), 1e-6)
    h = f * sk
    b = ap / sk
    with np.errstate(invalid="ignore", divide="ignore"):
        Fc = m.kc11 * b * np.where(h > 0, h, 0.0) ** (1.0 - m.mc)
    Fc = Fc * rake_factor(gamma_deg) * wear_factor(vb_mm)
    Ft = m.thrust_ratio * Fc
    Ff = Ft * np.sin(k)
    # Not: Fp = Ft·cos κeq; κr>90° iken cos negatif olabilir → |.| alınır (radyal itme)
    Fp = np.abs(Ft * np.cos(k))
    # κ≈90° için bile kenar köşesi/sürtünmeden kaynaklı minimum radyal pay (~%10 Fc)
    Fp = np.maximum(Fp, 0.10 * Fc)
    return Forces(Fc=Fc, Ff=Ff, Fp=Fp, h=h, b=b,
                  kappa_eq_deg=np.degrees(k), power_kw=Fc * vc / 60000.0)
