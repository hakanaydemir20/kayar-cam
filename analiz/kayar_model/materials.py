"""Malzeme tablosu (src/tools/toolLibrary.js MATERIALS ile aynı anahtarlar).

Birimler: kc1.1 [N/mm²] (h=1 mm, b=1 mm için özgül kesme kuvveti), E [MPa = N/mm²].

Kienzle sabitleri literatürde tipik (YAKLAŞIK) değerlerdir; kaynaklar:
König/Klocke "Fertigungsverfahren 1", Sandvik Coromant teknik kılavuzu (kc1 / mc),
VDI 3323 malzeme grupları. Gerçek değerler ısıl işlem, takım kaplaması ve
talaş açısına göre ±%20 değişebilir; kalibrasyon için ölçüm önerilir.

Ff/Fc ve Fp/Fc oranları κr≈90° ve pozitif talaş açılı kesici için tipik
oranlardır (ratio_t = itme kuvveti / Fc); itme kuvveti eşdeğer κr ile
ilerleme (Ff) ve radyal (Fp) bileşenlere ayrılır.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Material:
    key: str
    label: str
    vc_rough: float      # m/min
    vc_finish: float     # m/min
    f_rough: float       # mm/dev
    f_finish: float      # mm/dev
    ap_max: float        # mm
    kc11: float          # N/mm²
    mc: float            # Kienzle üssü (-)
    thrust_ratio: float  # sqrt(Ff²+Fp²)/Fc (-)
    E: float             # MPa


MATERIALS = {
    "free":  Material("free", "Otomat çeliği (11SMnPb30)", 180, 220, 0.12, 0.05, 1.5, 1350, 0.20, 0.45, 210e3),
    "c45":   Material("c45", "Karbon çeliği (C45)", 150, 190, 0.10, 0.05, 1.2, 1600, 0.25, 0.50, 210e3),
    "alloy": Material("alloy", "Alaşımlı çelik (42CrMo4)", 120, 160, 0.09, 0.04, 1.0, 1800, 0.26, 0.55, 210e3),
    "ss":    Material("ss", "Paslanmaz (304/316L)", 110, 140, 0.08, 0.04, 0.8, 2000, 0.21, 0.60, 193e3),
    "brass": Material("brass", "Pirinç (CuZn39Pb3)", 250, 300, 0.12, 0.05, 2.0, 780, 0.18, 0.40, 100e3),
    "alu":   Material("alu", "Alüminyum (6061/7075)", 300, 400, 0.12, 0.06, 2.0, 700, 0.25, 0.40, 70e3),
    "ti":    Material("ti", "Titanyum (Ti6Al4V)", 50, 70, 0.08, 0.04, 0.6, 1400, 0.23, 0.65, 114e3),
    "pom":   Material("pom", "Plastik (POM/PA)", 250, 300, 0.15, 0.08, 2.0, 200, 0.20, 0.35, 3e3),
}


def get_material(m) -> Material:
    """Anahtar (str) veya Material nesnesi kabul eder."""
    if isinstance(m, Material):
        return m
    try:
        return MATERIALS[m]
    except KeyError:
        raise KeyError(f"Bilinmeyen malzeme '{m}'. Geçerli: {list(MATERIALS)}")
