"""Talaş boyu kontrolü (yalnız kayar otomat).

(a) Talaş kırıcı geometri + malzeme sünekliğine göre doğal talaş formu
(b) LFV tipi Z osilasyonlu kesme (düşük frekanslı titreşim): hava kesmesi → talaş kırılır
(c) G-kodu seviyesinde "her N mm'de dur/geri çek" kesintili ilerleme

Birimler: mm, mm/dev, dev/dak, s.
"""
from dataclasses import dataclass, field, replace
from typing import Dict, List, Optional
import math
import numpy as np

from .materials import get_material
from .kinematics import PassSamples, generate_pass, spindle_rpm
from .analysis import analyze_samples, PassResult
from .surface import roughness, vibration_pp

RAPID = 24000.0         # G0 hızı [mm/dak] (yaklaşık)
CHIP_COMPRESSION = 2.0  # talaş sıkışma oranı λ = kesilen yol / talaş boyu (tipik 1.5–3)


# ------------------------------------------------------------ (a) talaş formu
@dataclass(frozen=True)
class ChipBreaker:
    """Talaş kırıcı uygulama penceresi (uygulamadaki talaş grupları fikri)."""
    key: str
    label: str
    f_min: float
    f_max: float
    ap_min: float
    ap_max: float


CHIPBREAKERS: Dict[str, ChipBreaker] = {
    "sharp": ChipBreaker("sharp", "Taşlanmış keskin (Al/plastik)", 0.02, 0.12, 0.1, 2.0),
    "F": ChipBreaker("F", "Finiş (ince)", 0.03, 0.15, 0.2, 1.5),
    "M": ChipBreaker("M", "Orta", 0.08, 0.30, 0.5, 3.0),
    "R": ChipBreaker("R", "Kaba", 0.20, 0.50, 1.5, 5.0),
}

# Süneklik indeksi (0 = kendiliğinden kırılır, 1 = çok sünek/uzun talaş). YAKLAŞIK.
DUCTILITY = {"free": 0.25, "brass": 0.15, "c45": 0.55, "alloy": 0.6, "ss": 0.9,
             "alu": 0.8, "ti": 0.7, "pom": 1.0}


@dataclass
class ChipForm:
    breaks: bool
    form: str            # "kısa/kırık", "spiral", "sürekli"
    score: float         # >1 kırılır
    reason: str


def chip_form(material, f: float, ap: float, breaker: str = "M",
              kappa_deg: float = 95.0) -> ChipForm:
    """Doğal talaş formu. h = f·sin κ. Kırılma skoru:
    score = (h/h_kır)·(ap/ap_min)^0.3·(1−0.7·süneklik)/0.5,
    h_kır = pencerenin alt f sınırının sin κ katı. Pencere dışında (f veya ap altında) skor düşer."""
    m = get_material(material)
    cb = CHIPBREAKERS[breaker]
    duct = DUCTILITY.get(m.key, 0.6)
    h = f * math.sin(math.radians(min(kappa_deg, 180 - kappa_deg) if kappa_deg > 90 else kappa_deg))
    h_brk = cb.f_min * math.sin(math.radians(min(kappa_deg, 180 - kappa_deg) if kappa_deg > 90 else kappa_deg))
    score = (h / h_brk) * min(1.5, ap / cb.ap_min) ** 0.3 * (1 - 0.7 * duct) / 0.5
    if f > cb.f_max or ap > cb.ap_max:
        reason = "pencere üstü: kırılır ama uç zorlanır"
    elif f < cb.f_min or ap < cb.ap_min:
        reason = "pencere altı: talaş kırıcıya ulaşmıyor"
    else:
        reason = "pencere içinde"
    if duct <= 0.25:
        score = max(score, 1.2)  # otomat çeliği/pirinç: kurşun/kükürt ile kendiliğinden kırılır
    form = "kısa/kırık" if score >= 1.0 else ("spiral" if score >= 0.6 else "sürekli")
    return ChipForm(score >= 1.0, form, score, reason)


# ------------------------------------------------------------ (b) LFV osilasyon
def lfv_break_condition(f: float, A: float, ratio: float) -> bool:
    """Analitik (tek devir hafızası): h_min = f − 2A·|sin(πR)| < 0 → hava kesmesi.
    R = devir başına osilasyon sayısı; yarım-tamsayı R'de koşul A > f/2, tamsayı R'de asla."""
    return f - 2.0 * A * abs(math.sin(math.pi * ratio)) < 0.0


@dataclass
class OscillationResult:
    samples: PassSamples       # ince örneklenmiş; f = anlık eksenel talaş kalınlığı, cutting = h>0
    h: np.ndarray              # eksenel talaş kalınlığı [mm]
    breaks: bool
    chip_lengths: np.ndarray   # segment başına talaş boyu [mm] (sıkışma λ uygulanmış)
    chip_length: float         # ortalama [mm]
    air_fraction: float        # hava kesmesi zaman oranı
    extra_time: float          # LFV'de ilerleme sabit → 0 (makine yalnız Z'ye bindirir)


def oscillate(f: float, n: float, A: float, ratio: float, length: float, dia: float,
              z0: float = 0.0, direction: float = -1.0, overhang_start: float = 1.0,
              overhang_end: float = 3.0, pts_per_rev: int = 72,
              compression: float = CHIP_COMPRESSION) -> OscillationResult:
    """Z'ye bindirilmiş osilasyon: z(θ) = f·θ/2π + A·sin(R·θ) (malzemeye doğru pozitif).
    Yüzey hafızası S(φ) = geçmiş tüm devirlerde aynı açıdaki max z; h = max(0, z − S).
    h=0 bölgeleri hava kesmesidir; aradaki kesintisiz bölgeler bir talaş segmentidir."""
    revs = max(int(math.ceil(length / f)), 1)
    M = pts_per_rev
    phi = np.arange(M) * 2 * math.pi / M
    S = phi / (2 * math.pi) * f - f + A * np.sin(ratio * (phi - 2 * math.pi))  # önceki devir (osilasyonlu)
    for k in range(-3, 0):                   # ısınma: çok devirli yüzey hafızası oturur
        z = f * (2 * math.pi * k + phi) / (2 * math.pi) + A * np.sin(ratio * (2 * math.pi * k + phi))
        S = np.maximum(S, z)
    hs, zs = [], []
    for k in range(revs):
        th = 2 * math.pi * k + phi
        z = f * th / (2 * math.pi) + A * np.sin(ratio * th)
        h = np.maximum(0.0, z - S)
        S = np.maximum(S, z)
        hs.append(h); zs.append(z)
    h = np.concatenate(hs); zrel = np.concatenate(zs)
    cut = h > 1e-3 * f              # sayısal gürültü eşiği
    h = np.where(cut, h, 0.0)
    # segmentler (ilk devir geçiş bölgesi dahil edilmez)
    steady = cut
    arc = math.pi * dia / M
    lens, run = [], 0
    for c in steady:
        if c:
            run += 1
        elif run:
            lens.append(run); run = 0
    if run:
        lens.append(run)
    lens = np.array(lens, float) * arc / compression
    breaks = len(lens) > 1
    t = np.arange(len(h)) * 60.0 / (n * M)
    s = np.linspace(0, 1, len(h))
    samples = PassSamples(t=t, z=z0 + direction * zrel,
                          overhang=overhang_start + (overhang_end - overhang_start) * s,
                          vf=np.full(len(h), f * n), n=np.full(len(h), n), f=h, cutting=cut)
    return OscillationResult(samples, h, breaks, lens,
                             float(lens.mean()) if len(lens) else 0.0,
                             float(1 - steady.mean()), 0.0)


def apply_oscillation(samples: PassSamples, dia: float, A: float, ratio: float,
                      pts_per_rev: int = 72) -> OscillationResult:
    """Var olan PassSamples'a (sabit f, n) osilasyon bindirir; f/cutting yeniden yazılır."""
    f = float(samples.f[0]); n = float(samples.n[0])
    length = abs(samples.z[-1] - samples.z[0])
    d = -1.0 if samples.z[-1] < samples.z[0] else 1.0
    return oscillate(f, n, A, ratio, length, dia, samples.z[0], d,
                     float(samples.overhang[0]), float(samples.overhang[-1]), pts_per_rev)


# ------------------------------------------------------------ (c) kesintili ilerleme
@dataclass
class InterruptResult:
    chip_length: float     # mm (λ uygulanmış)
    breaks: bool
    interrupts: int
    extra_time: float      # s
    base_time: float       # s


def interrupted_feed(length: float, every: float, f: float, n: float, dia: float,
                     retract: float = 0.1, dwell_rev: float = 0.5,
                     overhead: float = 0.02, rapid: float = RAPID,
                     compression: float = CHIP_COMPRESSION) -> InterruptResult:
    """Her `every` mm'de ilerleme durur, `retract` kadar Z geri çekilip G1 ile geri döner.
    Talaş boyu = π·D·(every/f)/λ. Ek süre/kesinti = dwell + 2·r/G0 ... (geri G0, dönüş G1):
    t_i = dwell_rev·60/n + r/rapid·60 + r/(f·n)·60 + overhead."""
    k = max(int(math.ceil(length / every)) - 1, 0)
    base = 60.0 * length / (f * n)
    ti = dwell_rev * 60 / n + retract / rapid * 60 + retract / (f * n) * 60 + overhead
    chip = math.pi * dia * min(every, length) / f / compression
    return InterruptResult(chip, k > 0, k, k * ti, base)


def interrupted_samples(samples: PassSamples, every: float, retract: float = 0.1,
                        dwell_rev: float = 0.5, rapid: float = RAPID) -> PassSamples:
    """PassSamples'a kesinti ekler: her `every` mm'de cutting=False bekleme/geri çekme örnekleri."""
    f = float(samples.f[0]); n = float(samples.n[0])
    ti = dwell_rev * 60 / n + retract / rapid * 60 + retract / (f * n) * 60
    dist = np.abs(samples.z - samples.z[0])
    seg = np.floor(dist / every + 1e-9).astype(int)
    seg = np.minimum(seg, max(int(math.ceil(dist[-1] / every)) - 1, 0))
    t = samples.t + seg * ti
    # her sınırda iki boşta örnek
    idx = np.nonzero(np.diff(seg))[0] + 1
    cols = {k: getattr(samples, k) for k in ("t", "z", "overhang", "vf", "n", "f", "cutting")}
    cols["t"] = t
    out = {k: [] for k in cols}
    prev = 0
    for i in list(idx) + [len(t)]:
        for k in cols:
            out[k].append(cols[k][prev:i])
        if i < len(t):
            for k in cols:
                v = cols[k][i - 1]
                if k == "t":
                    arr = np.array([v + 1e-6, cols["t"][i] - 1e-6])
                elif k == "cutting":
                    arr = np.array([False, False])
                elif k == "f":
                    arr = np.zeros(2)
                else:
                    arr = np.array([v, v])
                out[k].append(arr)
        prev = i
    return PassSamples(**{k: np.concatenate(v) for k, v in out.items()})


# ------------------------------------------------------------ 2. kuvvet/burç etkisi
def force_fluctuation(Fp: np.ndarray, base: float = 0.1) -> float:
    """Etkin dalgalanma oranı: fluct = max(base, ptp(Fp)/(2·max Fp)).
    Hava kesmeli osilasyonda Fp 0..max arası salınır → fluct=0.5 → titreşim pp = δ_max
    (çubuk burç boşluğu içinde her osilasyonda tam boşalıp yüklenir). VARSAYIM."""
    Fp = np.asarray(Fp, float)
    mx = float(Fp.max()) if len(Fp) else 0.0
    return max(base, float(np.ptp(Fp)) / (2 * mx)) if mx > 0 else base


@dataclass
class OscillationEffect:
    base: PassResult
    osc: PassResult
    oscillation: OscillationResult
    fluct: float

    @property
    def ra_increase(self) -> float:
        return self.osc.ra_max - self.base.ra_max

    @property
    def dia_error_increase(self) -> float:
        return self.osc.dia_error_max - self.base.dia_error_max


def oscillation_effect(material, bar_dia, ap, f, vc, rn, kappa_deg, support,
                       A, ratio, length=2.0, overhang_start=1.0, overhang_end=3.0,
                       max_rpm=10000, pts_per_rev=72) -> OscillationEffect:
    """Osilasyonsuz ve osilasyonlu pasoyu analyze_samples ile karşılaştırır.
    Kuvvet anlık h ile hesaplanır; yüzey izi yine devir başına f (son geçiş yüzeyi belirler),
    titreşim payı force_fluctuation() ile büyütülür. Çap hatasına ek olarak titreşim pp/2 eklenir."""
    n = spindle_rpm(vc, bar_dia, max_rpm)
    s0 = generate_pass(0.0, -length, f, n, overhang_start, overhang_end, 100)
    base = analyze_samples(s0, material, bar_dia, ap, rn, kappa_deg, support, vc)
    o = oscillate(f, n, A, ratio, length, bar_dia, 0.0, -1.0, overhang_start, overhang_end, pts_per_rev)
    r = analyze_samples(o.samples, material, bar_dia, ap, rn, kappa_deg, support, vc)
    fl = force_fluctuation(r.forces.Fp[o.samples.cutting] if o.samples.cutting.any() else r.forces.Fp)
    if o.air_fraction > 0:
        fl = max(fl, 0.5)
    d_max = np.full(len(o.samples), float(r.deflection.total.max()))
    pp = vibration_pp(d_max, support.clearance_noise(o.samples.overhang), fl)
    ra, rz = roughness(np.full(len(o.samples), f), rn, pp)
    r.ra, r.rz = ra, rz
    r.dia_error = np.full(len(o.samples), float(r.dia_error.max())) + pp / 2
    r.warnings.append(f"osilasyon: etkin kuvvet dalgalanması {fl:.2f} (varsayılan 0.10)")
    base.dia_error = base.dia_error + vibration_pp(base.deflection.total,
                                                  support.clearance_noise(s0.overhang), 0.1) / 2
    return OscillationEffect(base, r, o, fl)


# ------------------------------------------------------------ G-kodu
def gcode_interrupted_turning(length: float, every: float, f: float, retract: float = 0.1,
                              dwell_rev: float = 0.0) -> str:
    """Kesintili tornalama: artımsal W segmentleri + küçük Z geri çekme (plain string)."""
    lines, done = [], 0.0
    while done < length - 1e-9:
        step = min(every, length - done)
        lines.append(f"G1W-{step:.3f}F{f:g}")
        done += step
        if done < length - 1e-9:
            if dwell_rev > 0:
                lines.append(f"G4U{dwell_rev:g}")
            lines.append(f"G0W{retract:.3f}")
            lines.append(f"G1W-{retract:.3f}")
    return "\n".join(lines)
