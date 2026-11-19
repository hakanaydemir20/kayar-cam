"""Parça destek modelleri (takılabilir): kılavuz burç (Path 1) ve alt fener pensi (Path 2).

Her iki model de ankastre kiriş varsayar:
  δ_eğilme = Fp·L³/(3·E·I),  I = π·d⁴/64
  δ_temas  = Fp/k_destek
Burçta ek olarak boşluk (c) içinde rijit gövde eğilmesi:
  δ_boşluk = c·(1 + 2·L/L_burç)   (ön uç +c, arka uç −c → açı 2c/L_burç)
Pens sıkı tuttuğundan boşluk yoktur; pens kavrama boyu g ve rijitlik k_collet.
Birimler: N, mm, MPa.
"""
from dataclasses import dataclass
import math
import numpy as np

# Burç tipine göre tipik radyal boşluk [mm] (h8/h9 çubuğa ayarlı)
BUSH_CLEARANCE = {"rotary": 0.005, "fixed": 0.010, "fixed_h9": 0.020}


@dataclass
class Deflection:
    bending: np.ndarray     # [mm]
    contact: np.ndarray     # [mm]
    clearance: np.ndarray   # [mm]
    total: np.ndarray       # radyal toplam [mm]

    @property
    def dia_error(self) -> np.ndarray:
        """Çap hatası = 2·δ_toplam [mm] (takım kaçar → çap büyür)."""
        return 2.0 * self.total


def second_moment(d: float) -> float:
    return math.pi * d ** 4 / 64.0


class Support:
    """Destek arayüzü. deflection(Fp, L, d, E) → Deflection; fluct_clearance() → titreşim payı."""
    name = "support"

    def deflection(self, Fp, L, d, E) -> Deflection:
        raise NotImplementedError

    def clearance_noise(self, L) -> np.ndarray:
        """Kuvvet dalgalanmasıyla boşluk içinde gezinme genliği (tepe-tepe) [mm]."""
        return np.zeros_like(np.asarray(L, float))


@dataclass
class BushSupport(Support):
    """Kılavuz burç: radyal boşluk c, burç boyu, temas rijitliği."""
    clearance: float = 0.010   # c [mm]
    length: float = 20.0       # burç temas boyu [mm]
    k_contact: float = 2.0e4   # [N/mm] temas+burç tutucu rijitliği (yaklaşık)
    noise_frac: float = 0.1    # dalgalanmada c'nin ne kadarı gezilir (kalibre: gerçek programlar, Ra 0.4–0.8 µm @ f0.02)
    name: str = "bush"

    def deflection(self, Fp, L, d, E) -> Deflection:
        Fp = np.asarray(Fp, float)
        L = np.asarray(L, float)
        bend = Fp * L ** 3 / (3.0 * E * second_moment(d))
        cont = Fp / self.k_contact
        # Fp>0 iken bar boşluğun bir tarafına yaslanır (tam alım)
        clr = np.where(Fp > 0, self.clearance * (1.0 + 2.0 * L / self.length), 0.0)
        return Deflection(bend, cont, clr, bend + cont + clr)

    def clearance_noise(self, L):
        L = np.asarray(L, float)
        return self.noise_frac * self.clearance * (1.0 + 2.0 * L / self.length)


@dataclass
class ColletSupport(Support):
    """Alt fener pensi: boşluksuz sıkma; kavrama boyu g kısaldıkça rijitlik düşer."""
    grip: float = 10.0          # g [mm]
    k_collet: float = 5.0e4     # g_ref kavramada pens rijitliği [N/mm]
    grip_ref: float = 10.0
    name: str = "collet"

    def deflection(self, Fp, L, d, E) -> Deflection:
        Fp = np.asarray(Fp, float)
        L = np.asarray(L, float)
        bend = Fp * L ** 3 / (3.0 * E * second_moment(d))
        k = self.k_collet * min(1.0, self.grip / self.grip_ref)
        # pens içinde dönme: moment Fp·L, dönme rijitliği ~ k·g²/12 → δ = Fp·L²·12/(k g²)
        rot = Fp * L ** 2 * 12.0 / (k * self.grip ** 2)
        cont = Fp / k + rot
        z = np.zeros_like(bend)
        return Deflection(bend, cont, z, bend + cont)
