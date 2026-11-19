"""Kayar otomat (sliding headstock) kinematiği.

Takım Z'de sabittir; Z1 ana fener (malzeme) burç içinden hareket eder.
Kesme düzlemi burç alnının hemen önündedir. L_o (overhang) = burç alnından
kesme noktasına olan mesafe [mm].

Birimler: mm, mm/dev, dev/dak, s.
"""
from dataclasses import dataclass
import math
import numpy as np

BUSH_FACE_X = -3.2      # uygulama modelinde burç alnı dünya x koordinatı [mm]
MAX_RPM_MAIN = 10000    # SB-20R ana iş mili (yaklaşık)


def spindle_rpm(vc: float, dia: float, max_rpm: float = MAX_RPM_MAIN) -> float:
    """n = 1000·vc/(π·D), makine limiti ile sınırlı."""
    return min(max_rpm, 1000.0 * vc / (math.pi * max(dia, 1e-6)))


def feed_velocity(f: float, n: float) -> float:
    """Z1 ilerleme hızı vf = f·n [mm/dak]."""
    return f * n


@dataclass
class PassSamples:
    """Zaman örneklenmiş paso. Tüm diziler aynı uzunlukta.

    t [s], z [mm] (Z1 fener konumu), overhang [mm] (burç alnı–kesme noktası),
    vf [mm/dak], n [dev/dak], f [mm/dev] (örnek başına; ajan 2 kesintili
    ilerleme/osilasyon için f veya z'yi değiştirebilir), cutting [bool].
    """
    t: np.ndarray
    z: np.ndarray
    overhang: np.ndarray
    vf: np.ndarray
    n: np.ndarray
    f: np.ndarray
    cutting: np.ndarray

    def __len__(self):
        return len(self.t)


def generate_pass(z0: float, z1: float, f: float, n: float,
                  overhang_start: float, overhang_end: float,
                  samples: int = 200) -> PassSamples:
    """Boyuna tornalama pasosu üretir (Z1: z0 → z1, sabit f ve n).

    Overhang z ilerledikçe doğrusal olarak overhang_start → overhang_end
    değişir (fener malzemeyi burçtan dışarı iterken kesme noktası uzaklaşır).
    """
    if samples < 2:
        raise ValueError("samples >= 2 olmalı")
    if f < 0 or n < 0:
        raise ValueError("f ve n negatif olamaz")
    vf = feed_velocity(f, n)
    length = abs(z1 - z0)
    duration = 60.0 * length / vf if vf > 0 else 0.0
    t = np.linspace(0.0, duration, samples)
    s = np.linspace(0.0, 1.0, samples)
    z = z0 + (z1 - z0) * s
    ov = overhang_start + (overhang_end - overhang_start) * s
    return PassSamples(t=t, z=z, overhang=ov,
                       vf=np.full(samples, vf), n=np.full(samples, n),
                       f=np.full(samples, f), cutting=np.ones(samples, bool))
