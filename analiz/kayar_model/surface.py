"""Yüzey pürüzlülüğü ve tolerans kontrolü.

Kinematik: Ra ≈ f²/(32·rn), Rz ≈ f²/(8·rn)   [mm → µm için ×1000]
Titreşim/sapma terimi (VARSAYIM): kuvvet ±fluct oranında dalgalanır; sapma
bu oranda değişir, burçta bar ayrıca boşluk içinde gezinir. Tepe-tepe Δ olan
sinüs dalgası için Ra = Δ/π, Rz ≈ Δ. Toplam: Ra = √(Ra_kin² + Ra_vib²),
Rz = Rz_kin + Rz_vib.
"""
import math
import numpy as np

IT_FACTORS = {5: 7, 6: 10, 7: 16, 8: 25, 9: 40, 10: 64, 11: 100, 12: 160}


def ra_kinematic(f, rn):
    return np.asarray(f, float) ** 2 / (32.0 * rn) * 1000.0   # µm


def rz_kinematic(f, rn):
    return np.asarray(f, float) ** 2 / (8.0 * rn) * 1000.0    # µm


def vibration_pp(deflection_total, clearance_noise, fluct: float = 0.1):
    """Tepe-tepe radyal titreşim genliği [mm]."""
    return 2.0 * fluct * np.asarray(deflection_total, float) + np.asarray(clearance_noise, float)


def roughness(f, rn, pp_mm):
    """(Ra, Rz) µm."""
    pp = np.asarray(pp_mm, float) * 1000.0
    ra = np.sqrt(ra_kinematic(f, rn) ** 2 + (pp / math.pi) ** 2)
    rz = rz_kinematic(f, rn) + pp
    return ra, rz


def it_tolerance(dia: float, grade: int) -> float:
    """ISO 286 IT toleransı [mm]: i = 0.45·∛D + 0.001·D µm."""
    i = 0.45 * dia ** (1 / 3) + 0.001 * dia
    return IT_FACTORS[grade] * i / 1000.0
