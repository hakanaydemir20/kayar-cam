"""Cs kontur (C ekseni) dönüşümleri — Star SB-20R (Type G sınıfı) kayar otomat.

Konvansiyonlar (JS uygulamasıyla aynı):
  * X çap değeridir (mm), Z eksenel (mm), C derece, Y çapraz takım kaçıklığı (mm).
  * Parça çerçevesi açısı θ: C açısındaki takım parçanın θ = -C açısındaki noktasına bakar
    (stockSim.js / simMill.js: C = -θ). "part" adlı fonksiyonlar θ, makine fonksiyonları C kullanır.
  * Polar (G12.1) hipotetik düzlem: interpreter.js polarMove ile aynı —
    x = X/2 (yarıçap), y = programdaki "C" (mm), C = atan2(y, x)  (makine çerçevesi).
  * Silindirik (G7.1 C{r}): programdaki C mm = r·θ_rad (referans yarıçapta yay boyu).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

import numpy as np

DEG = math.pi / 180.0


# --------------------------------------------------------------------------- yardımcı
def unwrap_deg(cs: Sequence[float], start: Optional[float] = None) -> List[float]:
    """C dizisini sürekli yapar (ardışık |ΔC| <= 180); start verilirse ona göre."""
    out: List[float] = []
    prev = start
    for c in cs:
        c = float(c)
        if prev is not None:
            c = prev + ((c - prev + 180.0) % 360.0) - 180.0
        out.append(c)
        prev = c
    return out


def c_from_theta(theta_rad: float) -> float:
    """Parça açısı θ (rad) -> makine C (derece): C = -θ."""
    return -theta_rad / DEG


def theta_from_c(c_deg: float) -> float:
    return -c_deg * DEG


# --------------------------------------------------------------------------- (a) silindirik
def unroll(theta, z, r):
    """Silindir yüzeyini aç: (θ rad, z) -> (u = r·θ, z). numpy dizisi kabul eder."""
    return np.asarray(theta, float) * r, np.asarray(z, float)


def wrap(u, z, r):
    """Açılmış düzlemden sar: (u, z) -> (θ = u/r, z)."""
    return np.asarray(u, float) / r, np.asarray(z, float)


def cyl_c_mm_to_deg(c_mm: float, r: float) -> float:
    """G7.1 içinde programlanan C (mm, yay boyu) -> kontrolün ürettiği C derece."""
    return c_mm / r / DEG


def cyl_c_deg_to_mm(c_deg: float, r: float) -> float:
    return c_deg * DEG * r


@dataclass
class MPoint:
    """Makine noktası. feed=False -> hızlı (G0)."""
    X: float
    Z: float
    C: float
    Y: float = 0.0
    feed: bool = True


def depth_levels(depth: float, step: float) -> List[float]:
    if step <= 0:
        raise ValueError("step > 0 olmalı")
    lv, d = [], step
    while d < depth - 1e-9:
        lv.append(round(d, 6))
        d += step
    lv.append(depth)
    return lv


def keyway_path(R: float, z0: float, z1: float, c_deg: float, depth: float,
                step_down: float, clearance: float = 1.0, y_off: float = 0.0) -> List[MPoint]:
    """Çapta düz (eksenel) kama kanalı, sabit C, radyal çapraz takım.
    Derinlik kanal ortasında (Y=0) yüzeyden ölçülür; taban düz düzlem x_b = R - d,
    Y ofsetli pasolarda da aynı X (düz taban). Zikzak z0<->z1."""
    up = 2 * (R + clearance)
    pts = [MPoint(up, z0, c_deg, y_off, feed=False)]
    at0 = True
    for d in depth_levels(depth, step_down):
        x = 2 * (R - d)
        zs, ze = (z0, z1) if at0 else (z1, z0)
        pts.append(MPoint(x, zs, c_deg, y_off))
        pts.append(MPoint(x, ze, c_deg, y_off))
        at0 = not at0
    pts.append(MPoint(up, pts[-1].Z, c_deg, y_off, feed=False))
    return pts


def helical_groove_path(R: float, z0: float, lead: float, turns: float, c0_deg: float,
                        depth: float, step_down: float, seg_deg: float = 10.0,
                        right_hand: bool = True) -> List[MPoint]:
    """Helis (kam) kanal: parça çerçevesinde z = z0 + lead·θ/2π (sağ el: θ artar).
    Makine C = c0 - θ (C = -θ). Her derinlik pasosunda yukarıdan dalış, helis boyunca
    kesme, çıkış. C sürekli (360'ı aşar, mod alınmaz)."""
    sgn = 1.0 if right_hand else -1.0
    n = max(2, int(math.ceil(abs(turns) * 360.0 / seg_deg)) + 1)
    th = np.linspace(0.0, 2 * math.pi * turns, n)
    zs = z0 + lead * th / (2 * math.pi)
    cs = c0_deg - sgn * th / DEG
    up = 2 * (R + 1)
    pts: List[MPoint] = []
    for d in depth_levels(depth, step_down):
        x = 2 * (R - d)
        pts.append(MPoint(up, z0, c0_deg, feed=False))
        pts.append(MPoint(x, z0, c0_deg))
        pts += [MPoint(x, float(z), float(c)) for z, c in zip(zs[1:], cs[1:])]
        pts.append(MPoint(up, float(zs[-1]), float(cs[-1]), feed=False))
    return pts


def helix_angle_deg(R: float, lead: float) -> float:
    """Helis açısı (eksene göre): tan β = 2πR / lead."""
    return math.atan2(2 * math.pi * R, lead) / DEG


# ---- kanal yan duvarı (radyal düz uçlu parmak freze)
def wall_y_rotated(rho, rt: float, phi: float):
    """C ile φ (rad) döndürülmüş radyal takımın yan duvarı. Takım çerçevesinde yan yüzey
    v = rt doğrusu (u: radyal). Kanal çerçevesinde (merkez düzlem y=0), ρ yarıçaplı
    duvar noktası:  y(ρ) = √(ρ² - rt²)·sin φ + rt·cos φ."""
    rho = np.asarray(rho, dtype=float)
    u = np.sqrt(np.maximum(rho ** 2 - rt ** 2, 0.0))
    return u * math.sin(phi) + rt * math.cos(phi)


def _solve_phi(rho: float, rt: float, y: float) -> float:
    """u sin φ + rt cos φ = y çöz (u = √(ρ²-rt²))."""
    u = math.sqrt(rho * rho - rt * rt)
    A = math.hypot(u, rt)
    return math.asin(max(-1.0, min(1.0, y / A))) - math.atan2(rt, u)


def keyway_wall_deviation(R: float, width: float, depth: float, rt: float,
                          ref: str = "g71", n: int = 41):
    """Genişlik > takım çapı kanal, C döndürerek (G7.1 + G41/G42 açılmış düzlemde) açılırsa
    yan duvar radyale yakın EĞİK çıkar; ideal kama kanalı duvarı y = ±w/2 (paralel).
      ref='g71'  : G7.1 C{R} telafisi -> φ = (w/2 - rt)/R  (yay boyu ofset)
      ref='exact': φ, duvar yüzeyde (ρ=R) tam w/2 olacak şekilde çözülür
    Dönüş: (ρ dizisi [R-d .. R], sapma y(ρ) - w/2, φ). Negatif sapma: dibe doğru daralma."""
    half = width / 2.0
    if ref == "g71":
        phi = (half - rt) / R
    elif ref == "exact":
        phi = _solve_phi(R, rt, half)
    else:
        raise ValueError(ref)
    rho = np.linspace(R - depth, R, n)
    return rho, wall_y_rotated(rho, rt, phi) - half, phi


def keyway_wall_deviation_max(R, width, depth, rt, ref="exact") -> float:
    _, dev, _ = keyway_wall_deviation(R, width, depth, rt, ref)
    return float(np.max(np.abs(dev)))


def keyway_y_offsets(width: float, rt: float, stepover: Optional[float] = None) -> List[float]:
    """Y-ofset düzeltmesi: C sabit+kilitli (M6), takım Y'de ±e = ±(w/2 - rt) kayar ->
    duvar y = ±w/2 düzlemi, derinlik boyunca tam paralel. Ara pasolar <= stepover."""
    e = width / 2.0 - rt
    if e < -1e-9:
        raise ValueError("takım kanaldan geniş")
    if e <= 1e-9:
        return [0.0]
    step = stepover if stepover else 1.6 * rt
    k = max(1, int(math.ceil(2 * e / step)))
    return [float(v) for v in np.linspace(-e, e, k + 1)]


def wall_y_yoffset(rho, rt: float, y_off: float, side: int = 1):
    """Y ofsetli radyal takımın duvarı: y = y_off + side·rt, ρ'dan bağımsız."""
    rho = np.asarray(rho, dtype=float)
    return np.full_like(rho, y_off + side * rt)


def check_y_stroke(ys: Sequence[float], y_limit: float = 20.0) -> bool:
    return all(abs(y) <= y_limit + 1e-9 for y in ys)


# --------------------------------------------------------------------------- (b) polar
def polar_to_machine(x: float, y: float, c_prev: Optional[float] = None) -> Tuple[float, float]:
    """Hipotetik alın düzlemi (x, y) [makine çerçevesi, interpreter.js polarMove] ->
    (X çap, C derece). c_prev verilirse C sürekli seçilir."""
    X = 2.0 * math.hypot(x, y)
    c = math.atan2(y, x) / DEG
    if c_prev is not None:
        c = unwrap_deg([c], c_prev)[0]
    return X, c


def machine_to_polar(X: float, C: float) -> Tuple[float, float]:
    r = X / 2.0
    return r * math.cos(C * DEG), r * math.sin(C * DEG)


def part_face_to_machine(xp: float, yp: float, c_prev=None) -> Tuple[float, float]:
    """Parça çerçevesi alın noktası (açısı θ) -> (X, C), C = -θ."""
    return polar_to_machine(xp, -yp, c_prev)


def _linear_machine_deviation(a, b, Ca, Cb, samples=16) -> float:
    """a->b arası X ve C doğrusal enterpole edilirse (G12.1 YOK) x-y'de çizilen eğrinin
    a-b doğrusuna en büyük uzaklığı."""
    ra, rb = math.hypot(*a), math.hypot(*b)
    d = b - a
    L = float(np.hypot(*d))
    worst = 0.0
    for t in np.linspace(0, 1, samples + 1)[1:-1]:
        r = ra + (rb - ra) * t
        c = (Ca + (Cb - Ca) * t) * DEG
        q = np.array([r * math.cos(c), r * math.sin(c)]) - a
        dist = float(np.hypot(*q)) if L < 1e-12 else abs(d[0] * q[1] - d[1] * q[0]) / L
        worst = max(worst, dist)
    return worst


def _split_segment(a, b, tol, c_prev, max_seg_deg):
    n = 1
    while True:
        pts = [a + (b - a) * k / n for k in range(n + 1)]
        if min(math.hypot(*p) for p in pts) < 1e-9:
            raise ValueError("segment merkezden geçiyor (polar tekillik)")
        cs = unwrap_deg([math.atan2(p[1], p[0]) / DEG for p in pts], c_prev)
        ok = all(abs(cs[i + 1] - cs[i]) <= max_seg_deg and
                 _linear_machine_deviation(pts[i], pts[i + 1], cs[i], cs[i + 1]) <= tol
                 for i in range(n))
        if ok:
            return pts[1:]
        n *= 2
        if n > 1 << 14:
            raise ValueError("densification yakınsamadı (merkeze çok yakın)")


def densify_polar(pts_xy: Sequence[Tuple[float, float]], chord_tol: float = 0.005,
                  c_start: Optional[float] = None, max_seg_deg: float = 30.0):
    """x-y doğrusal konturunu, X ve C'yi doğrusal enterpole eden kontrol (G12.1 olmadan,
    ör. G98 X..C.. blokları) için böler: her parçanın sapması <= chord_tol.
    Dönüş: list[(X, C, x, y)], C sürekli."""
    p0 = np.asarray(pts_xy[0], float)
    X, C = polar_to_machine(*p0, c_start)
    out = [(X, C, float(p0[0]), float(p0[1]))]
    for p1 in pts_xy[1:]:
        p1 = np.asarray(p1, float)
        for q in _split_segment(p0, p1, chord_tol, out[-1][1], max_seg_deg):
            X, C = polar_to_machine(*q, out[-1][1])
            out.append((X, C, float(q[0]), float(q[1])))
        p0 = p1
    return out


def polar_c_speed(pts_xy, feed_mm_min: float, c_max_rpm: float = 100.0) -> dict:
    """Doğrusal x-y hareketi F ile giderken gereken C hızı. Merkeze en yakın noktada
    (ρ_min) hareket tamamen teğetsel: ω = F/ρ_min (rad/dk). Dönüş: rho_min, c_rpm_peak,
    c_deg_min_peak, ok, f_allow (= c_max·2π·ρ_min)."""
    worst = {"rho_min": math.inf, "c_rpm_peak": 0.0}
    for a, b in zip(pts_xy[:-1], pts_xy[1:]):
        a, b = np.asarray(a, float), np.asarray(b, float)
        d = b - a
        L2 = float(np.dot(d, d))
        if L2 < 1e-18:
            continue
        t = float(np.clip(-np.dot(a, d) / L2, 0, 1))
        rho = float(np.hypot(*(a + d * t)))
        w = feed_mm_min / max(rho, 1e-9) / (2 * math.pi)
        if w > worst["c_rpm_peak"]:
            worst = {"rho_min": rho, "c_rpm_peak": w}
    worst["c_deg_min_peak"] = worst["c_rpm_peak"] * 360.0
    worst["ok"] = worst["c_rpm_peak"] <= c_max_rpm
    worst["f_allow"] = c_max_rpm * 2 * math.pi * worst["rho_min"]
    return worst


# --------------------------------------------------------------------------- (c) çapraz delik
@dataclass
class CrossHole:
    z: float
    theta_deg: float          # parça açısı θ; makine C = -θ
    R: float                  # giriş yüzeyi yarıçapı
    depth: float              # giriş noktasından eksen boyunca
    y_off: float = 0.0        # delik ekseni merkezden Y kaçıklığı (eksantrik delik)
    clearance: float = 1.0


def cross_hole_machine(h: CrossHole) -> dict:
    """Çapraz delik -> makine. Y ofsetliyse delik ekseni X'e paralel, merkezden y kaçık;
    silindire giriş x_e = √(R² - y²)."""
    if abs(h.y_off) >= h.R:
        raise ValueError("Y ofseti yarıçaptan büyük")
    xe = math.sqrt(h.R ** 2 - h.y_off ** 2)
    return {"C": -h.theta_deg, "Y": h.y_off, "Z": h.z,
            "X_start": 2 * (xe + h.clearance), "X_entry": 2 * xe,
            "X_bottom": 2 * (xe - h.depth)}


def hole_on_flat(z: float, theta_deg: float, flat_dist: float, depth: float,
                 lateral: float = 0.0, clearance: float = 1.0) -> dict:
    """Düzlük üstünde delik: düzlük normali θ yönünde, merkezden flat_dist; delik düzlükte
    lateral (Y) kaydırılmış. C=-θ ile düzlük takıma bakar -> giriş X = 2·flat_dist."""
    return {"C": -theta_deg, "Y": lateral, "Z": z,
            "X_start": 2 * (flat_dist + clearance), "X_entry": 2 * flat_dist,
            "X_bottom": 2 * (flat_dist - depth)}


def machine_to_part_point(X: float, Y: float, Z: float, C: float) -> Tuple[float, float, float]:
    """Ters: makine takım ucu (X çap, Y, Z, C) -> parça çerçevesi (xp, yp, z).
    Makine çerçevesinde (X/2, Y); parçaya θ-dönüşü -C ile."""
    xm, ym, a = X / 2.0, Y, -C * DEG
    return (xm * math.cos(a) - ym * math.sin(a), xm * math.sin(a) + ym * math.cos(a), Z)


def part_point_to_machine(xp: float, yp: float, z: float, Y: float = 0.0,
                          c_prev: Optional[float] = None) -> dict:
    """Parça noktası + seçilen Y -> X, C.  ρ² = (X/2)² + Y²,  -C = atan2(yp,xp) - atan2(Y, X/2)."""
    rho = math.hypot(xp, yp)
    if abs(Y) > rho:
        raise ValueError("|Y| > ρ")
    xm = math.sqrt(rho * rho - Y * Y)
    C = -(math.atan2(yp, xp) - math.atan2(Y, xm)) / DEG
    if c_prev is not None:
        C = unwrap_deg([C], c_prev)[0]
    return {"X": 2 * xm, "Y": Y, "Z": z, "C": C}


# --------------------------------------------------------------------------- (d) ilerleme
def feed_g98_cz(dz: float, dc_deg: float, r: float, f_surface: float) -> float:
    """G98, G7.1 KAPALI, Z+C bileşik: FANUC dereceyi mm gibi sayar,
    süre = √(ΔZ² + ΔC°²)/F.  r yarıçapında yüzey hızı f için:
        F = f · √(ΔZ² + ΔC°²) / √(ΔZ² + (r·ΔC·π/180)²)"""
    L_cmd = math.hypot(dz, dc_deg)
    L_true = math.hypot(dz, r * dc_deg * DEG)
    return f_surface if L_true < 1e-12 else f_surface * L_cmd / L_true


def feed_c_only(r: float, f_surface: float) -> float:
    """Yalnız C (G98): F [°/dk] = f · 180/(π r)."""
    return f_surface / (r * DEG)


def feed_g71(f_surface: float, r_ref: float, r_cut: Optional[float] = None) -> float:
    """G7.1 içinde F = referans yarıçap (C{r}) yüzeyindeki hız. Kesme r_cut'ta (ör. kanal
    dibi) f isteniyorsa ve hareket C-baskınsa: F ≈ f · r_ref / r_cut."""
    return f_surface if r_cut is None else f_surface * r_ref / r_cut


def move_time_g98(dz: float, dc_deg: float, F: float) -> float:
    """G98 bileşik hareket süresi (dk)."""
    return math.hypot(dz, dc_deg) / F
