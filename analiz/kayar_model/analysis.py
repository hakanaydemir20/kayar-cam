"""Paso analizi: kinematik → kuvvet → destek sapması → yüzey/tolerans."""
from dataclasses import dataclass, field
from typing import List, Optional
import numpy as np

from .materials import get_material
from .kinematics import PassSamples, generate_pass, spindle_rpm
from .forces import cutting_forces, Forces
from .bush import BushSupport, Support, Deflection
from .surface import roughness, vibration_pp, it_tolerance


SWISS_AREA_FACTOR = 2.0   # kalibrasyon: gerçek programlar (realcheck)


@dataclass
class PassResult:
    samples: PassSamples
    forces: Forces
    deflection: Deflection
    ra: np.ndarray            # µm (örnek başına)
    rz: np.ndarray            # µm
    dia_error: np.ndarray     # mm (2·δ)
    dia_error_variation: float  # mm, paso boyunca max−min (konik/form hatası)
    tolerance: Optional[float]  # mm
    warnings: List[str] = field(default_factory=list)

    @property
    def ra_max(self) -> float:
        return float(np.max(self.ra))

    @property
    def rz_max(self) -> float:
        return float(np.max(self.rz))

    @property
    def dia_error_max(self) -> float:
        return float(np.max(self.dia_error))


def analyze_samples(samples: PassSamples, material, bar_dia, ap, rn, kappa_deg,
                    support: Support, vc=100.0, fluct=0.1, tolerance=None,
                    ra_limit=None, gamma_deg=6.0, vb_mm=0.0) -> PassResult:
    """Hazır örnek dizisi üzerinde analiz (ajan 2: kesintili ilerleme vb. için giriş noktası).
    samples.f örnek başına ilerlemedir; cutting=False örneklerde kuvvet 0."""
    m = get_material(material)
    if ap <= 0:
        raise ValueError("ap > 0 olmalı")
    if bar_dia <= 0:
        raise ValueError("bar_dia > 0 olmalı")
    if np.any(np.asarray(samples.f) < 0):
        raise ValueError("f negatif olamaz")
    f = np.where(samples.cutting, samples.f, 0.0)
    F = cutting_forces(m, np.full(len(samples), ap), f, kappa_deg, rn, vc, gamma_deg, vb_mm)
    d = support.deflection(F.Fp, samples.overhang, bar_dia, m.E)
    # Boşluk payı statik ofsettir (bar bir tarafa yaslı); kuvvetle ölçeklenen yalnız elastik kısım.
    pp = vibration_pp(d.bending + d.contact, np.where(samples.cutting, support.clearance_noise(samples.overhang), 0.0), fluct)
    ra, rz = roughness(samples.f, rn, pp)
    ra = np.where(samples.cutting, ra, 0.0)
    rz = np.where(samples.cutting, rz, 0.0)
    err = d.dia_error
    cut = samples.cutting
    var = float(np.ptp(err[cut])) if cut.any() else 0.0

    w = []
    # Kalibrasyon (gerçek programlar): kayar otomatta ap 2–3.4 mm, f 0.02 olağan. Sınır, talaş
    # kesiti ap·f > SWISS_AREA_FACTOR·ap_max·f_rough ise uyarır (atölyede ap 6 mm @ f 0.02 çalışıyor);
    # yalnız ap'ye bakmak fazla muhafazakârdı.
    f_max = float(np.max(samples.f)) if len(samples) else 0.0
    a_lim = SWISS_AREA_FACTOR * m.ap_max * m.f_rough
    if ap * f_max > a_lim:
        w.append(f"ap={ap:.2f} mm, ap·f={ap*f_max:.3f} mm² talaş kesiti sınırını ({a_lim:.3f} mm²) aşıyor")
    if np.max(samples.f) > 0.5 * rn * 2:
        w.append("f > rn: talaş kontrolü/uç zorlanması riski")
    if ap < rn:
        w.append("ap < rn: kesme yalnız uç radyüsünde, radyal kuvvet payı yüksek")
    if tolerance is not None and float(np.max(err)) > tolerance:
        w.append(f"Çap hatası {np.max(err):.4f} mm > tolerans {tolerance:.4f} mm")
    if tolerance is not None and var > tolerance / 2:
        w.append(f"Paso boyunca çap değişimi {var:.4f} mm (konik/form hatası)")
    if ra_limit is not None and float(np.max(ra)) > ra_limit:
        w.append(f"Ra {np.max(ra):.2f} µm > sınır {ra_limit} µm")
    ov = float(np.max(samples.overhang))
    if ov > 3 * bar_dia:
        w.append(f"Çıkıntı {ov:.1f} mm > 3·D: titreşim riski")
    return PassResult(samples, F, d, ra, rz, err, var, tolerance, w)


def analyze_pass(material, bar_dia, ap, f, vc, rn, kappa_deg=95.0,
                 bush_clearance=0.010, overhang_start=1.0, overhang_end=3.0,
                 z0=0.0, z1=-10.0, samples=200, bush_length=20.0,
                 k_bush=2.0e4, it_grade=None, tolerance=None, ra_limit=None,
                 fluct=0.1, max_rpm=10000, support: Optional[Support] = None) -> PassResult:
    """Ana iş mili (Path 1) boyuna tornalama pasosu analizi. Birimler mm, m/dak, mm/dev."""
    n = spindle_rpm(vc, bar_dia, max_rpm)
    s = generate_pass(z0, z1, f, n, overhang_start, overhang_end, samples)
    if support is None:
        support = BushSupport(clearance=bush_clearance, length=bush_length, k_contact=k_bush)
    if tolerance is None and it_grade is not None:
        tolerance = it_tolerance(bar_dia, it_grade)
    return analyze_samples(s, material, bar_dia, ap, rn, kappa_deg, support, vc,
                           fluct, tolerance, ra_limit)
