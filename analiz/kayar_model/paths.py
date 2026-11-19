"""İki kanallı (FANUC $1/$2) bağımsız veri akışları.

Path 1 = MainPath: ana fener + gang takımlar, Z1, kılavuz burç desteği (ön işleme).
Path 2 = SubPath : alt fener + arka takım tablası, Z2, pens desteği (burç YOK;
         çıkıntı = parça boyu − kavrama boyu g). Arka tornalama / delme / kılavuz.

Her yol işlem listesinden kendi zaman örneklenmiş akışını üretir. run_paths()
iki yolu eşzamanlı (ThreadPoolExecutor) hesaplar, isteğe bağlı senkron
işaretleriyle (M82/M40/M41 gibi bekleme kodları) zamanları hizalar ve
istenirse ortak zaman eksenine yeniden örnekler.
"""
from dataclasses import dataclass, field
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Optional, Union
import math
import numpy as np

from .materials import get_material
from .kinematics import generate_pass, spindle_rpm, PassSamples
from .forces import cutting_forces
from .bush import BushSupport, ColletSupport, Support
from .analysis import analyze_samples
from .surface import it_tolerance
from .drilling import (drill_forces, tap_torque, recommend_q, needs_peck, peck_schedule,
                       collet_slip_check, bush_axial_check, RAPID)


# ---------------------------------------------------------------- işlemler
@dataclass
class TurnOp:
    """Boyuna tornalama. overhang None → yolun varsayılanı (Path 2: parça boyu − g)."""
    material: str
    dia: float
    ap: float
    f: float
    vc: float
    rn: float = 0.2
    kappa_deg: float = 95.0
    z0: float = 0.0
    z1: float = -10.0
    overhang_start: Optional[float] = None
    overhang_end: Optional[float] = None
    samples: int = 100
    it_grade: Optional[int] = None


@dataclass
class DrillOp:
    """Eksenel delme/kılavuz (sapma yok, yalnız eksenel itme). tap=True → f = hatve.
    Ajan 2 burada gagalama (peck) çevrimini genişletebilir."""
    material: str
    drill_dia: float
    depth: float
    f: float
    vc: float
    z0: float = 0.0
    samples: int = 50
    tap: bool = False
    peck: bool = False             # gagalama çevrimi
    cycle: str = "g83"             # 'g83' (tam geri) | 'g73' (kısa geri)
    q: Optional[float] = None      # gaga [mm]; None → recommend_q
    retract: float = 0.2           # d [mm]
    clearance: float = 1.0         # R noktası [mm]
    decay: float = 1.0             # azalan gaga çarpanı
    pitch: Optional[float] = None  # kılavuz hatvesi (tap=True; None → f)


@dataclass
class SyncOp:
    """Bekleme/senkron işareti (ör. 'M82'); iki yolda aynı kodla eşleşir."""
    code: str


Op = Union[TurnOp, DrillOp, SyncOp]

FIELDS = ("z", "x", "n", "f", "Fc", "Ff", "Fp", "deflection", "dia_error", "ra", "rz")


@dataclass
class Stream:
    """Bir yolun zaman akışı. Tüm diziler t ile aynı uzunlukta; op = işlem indeksi."""
    path: str
    t: np.ndarray
    data: Dict[str, np.ndarray]
    op: np.ndarray
    events: List[tuple] = field(default_factory=list)   # (t, code)
    warnings: List[str] = field(default_factory=list)

    def __getitem__(self, k):
        return self.t if k == "t" else self.data[k]

    @property
    def duration(self) -> float:
        return float(self.t[-1]) if len(self.t) else 0.0


def _seg(t, op_i, **cols):
    n = len(t)
    d = {k: np.asarray(cols.get(k, np.zeros(n)), float) * np.ones(n) for k in FIELDS}
    return t, d, np.full(n, op_i)


# ---------------------------------------------------------------- yollar
class PathModel:
    """Ortak arayüz: run(ops) → Stream. Destek modeli takılabilir."""
    name = "path"
    max_rpm = 10000

    def __init__(self, support: Support):
        self.support = support

    def default_overhang(self, op: TurnOp):
        return 1.0, 3.0

    def run(self, ops: List[Op]) -> Stream:
        ts, ds, os_, events, warns = [], [], [], [], []
        t_now = 0.0
        for i, op in enumerate(ops):
            if isinstance(op, SyncOp):
                events.append((t_now, op.code))
                continue
            if isinstance(op, TurnOp):
                t, d, w = self._turn(op, i)
            elif isinstance(op, DrillOp):
                t, d, w = self._drill(op, i)
            else:
                raise TypeError(f"Bilinmeyen işlem: {op!r}")
            ts.append(t + t_now); ds.append(d); os_.append(np.full(len(t), i))
            warns += [f"[{self.name} op{i}] {x}" for x in w]
            t_now = ts[-1][-1]
        if ts:
            t = np.concatenate(ts)
            data = {k: np.concatenate([d[k] for d in ds]) for k in FIELDS}
            op = np.concatenate(os_)
        else:
            t, data, op = np.zeros(0), {k: np.zeros(0) for k in FIELDS}, np.zeros(0, int)
        return Stream(self.name, t, data, op, events, warns)

    def _turn(self, op: TurnOp, i):
        o0, o1 = self.default_overhang(op)
        o0 = op.overhang_start if op.overhang_start is not None else o0
        o1 = op.overhang_end if op.overhang_end is not None else o1
        n = spindle_rpm(op.vc, op.dia, self.max_rpm)
        s = generate_pass(op.z0, op.z1, op.f, n, o0, o1, op.samples)
        tol = it_tolerance(op.dia, op.it_grade) if op.it_grade else None
        r = analyze_samples(s, op.material, op.dia, op.ap, op.rn, op.kappa_deg,
                            self.support, op.vc, tolerance=tol)
        d = {"z": s.z, "x": np.full(len(s), op.dia - 2 * op.ap), "n": s.n, "f": s.f,
             "Fc": r.forces.Fc, "Ff": r.forces.Ff, "Fp": r.forces.Fp,
             "deflection": r.deflection.total, "dia_error": r.dia_error,
             "ra": r.ra, "rz": r.rz}
        return s.t, d, r.warnings

    def axial_check(self, thrust, torque, D):
        return bush_axial_check(thrust, torque, D)

    def _drill(self, op: DrillOp, i):
        n = spindle_rpm(op.vc, op.drill_dia, self.max_rpm)
        if op.tap:
            M = tap_torque(op.material, op.drill_dia, op.pitch or op.f)
            s = generate_pass(op.z0, op.z0 - op.depth, op.f, n, 0, 0, op.samples)
            d = {k: np.zeros(len(s)) for k in FIELDS}
            d.update({"z": s.z, "n": s.n, "f": s.f})
            ck = self.axial_check(0.0, M, op.drill_dia)
            return s.t, d, ck.warnings
        F = drill_forces(op.material, op.drill_dia, op.f, op.vc)
        q = op.q if op.q is not None else recommend_q(op.material, op.drill_dia, op.depth)
        cyc = op.cycle if op.peck else "none"
        sch = peck_schedule(op.depth, q, op.f, n, cyc, op.retract, op.clearance, op.decay)
        vf = op.f * n / 60.0
        ts, zs, cut = [], [], []
        t, prev = 0.0, 0.0
        per = max(2, op.samples // max(1, sch.count))
        for j, zp in enumerate(sch.pecks):
            start = max(0.0, prev - (op.retract if j else 0.0))
            zz = np.linspace(start, zp, per)
            ts.append(t + (zz - start) / vf); zs.append(zz); cut.append(zz > prev - 1e-9)
            t = ts[-1][-1]
            back = (prev + op.clearance) if cyc == "g83" else op.retract
            tr = 2 * back / (RAPID / 60.0) + 0.03
            ts.append(np.array([t + 1e-6, t + tr])); zs.append(np.array([zp, zp]))
            cut.append(np.array([False, False])); t += tr
            prev = zp
        tt = np.concatenate(ts); zz = np.concatenate(zs); c = np.concatenate(cut)
        d = {k: np.zeros(len(tt)) for k in FIELDS}
        d.update({"z": op.z0 - zz, "n": np.full(len(tt), n), "f": np.where(c, op.f, 0.0),
                  "Fc": np.where(c, F.Fc_lip, 0.0), "Ff": np.where(c, F.thrust, 0.0)})
        w = list(self.axial_check(F.thrust, F.torque, op.drill_dia).warnings)
        if not op.peck and needs_peck(op.material, op.drill_dia, op.depth):
            w.append(f"L/D={op.depth/op.drill_dia:.1f}: talaş tahliyesi için gagalama önerilir (Q≈{q:.2f} mm)")
        return tt, d, w


class MainPath(PathModel):
    """Path 1 ($1): ana fener, Z1, kılavuz burç."""
    name = "path1"
    max_rpm = 10000

    def __init__(self, support: Optional[Support] = None):
        super().__init__(support or BushSupport())


class SubPath(PathModel):
    """Path 2 ($2): alt fener, Z2, pens (burç yok). Çıkıntı = parça boyu − g."""
    name = "path2"
    max_rpm = 8000

    def __init__(self, part_length: float = 20.0, grip: float = 8.0,
                 support: Optional[Support] = None):
        self.part_length = part_length
        self.grip = grip
        super().__init__(support or ColletSupport(grip=grip))

    def axial_check(self, thrust, torque, D):
        return collet_slip_check(thrust, torque, D, self.grip,
                                 clamp_force=getattr(self, "clamp_force", 6000.0))

    def default_overhang(self, op):
        L = max(self.part_length - self.grip, 0.1)
        return L, L


# ---------------------------------------------------------------- eşzamanlı koşu
def _shift_after(s: Stream, t_at: float, dt: float, code: str):
    """t_at anından sonra dt bekleme ekle (sıfır-kuvvet örneği ile)."""
    idx = np.searchsorted(s.t, t_at, side="right")
    t = s.t.copy(); t[idx:] += dt
    ins_t = np.array([t_at, t_at + dt])
    last = {k: (v[idx - 1] if idx > 0 else 0.0) for k, v in s.data.items()}
    idle = {k: np.array([last[k] if k in ("z", "x") else 0.0] * 2) for k in FIELDS}
    s.t = np.concatenate([t[:idx], ins_t, t[idx:]])
    s.data = {k: np.concatenate([s.data[k][:idx], idle[k], s.data[k][idx:]]) for k in FIELDS}
    s.op = np.concatenate([s.op[:idx], [-1, -1], s.op[idx:]])
    s.events = [(et + dt if (et > t_at) else et, c) for et, c in s.events]


def align_sync(a: Stream, b: Stream) -> None:
    """Ortak senkron kodlarını sırayla eşleyip erken gelen yolu bekletir (yerinde)."""
    used_b = set()
    for k in range(len(a.events)):
        ta, code = a.events[k]
        j = next((j for j, (_, c) in enumerate(b.events) if c == code and j not in used_b), None)
        if j is None:
            a.warnings.append(f"[senkron] {code} yalnız {a.path}'de var — eşi yok, bekleme yapılmadı")
            continue
        used_b.add(j)
        ta = a.events[k][0]; tb = b.events[j][0]
        if ta < tb:
            _shift_after(a, ta, tb - ta, code)
            a.events[k] = (tb, code)
        elif tb < ta:
            _shift_after(b, tb, ta - tb, code)
            b.events[j] = (ta, code)


    for j, (_, code) in enumerate(b.events):
        if j not in used_b:
            b.warnings.append(f"[senkron] {code} yalnız {b.path}'de var — eşi yok, bekleme yapılmadı")
    order_a = [c for _, c in a.events if c in {c2 for _, c2 in b.events}]
    order_b = [c for _, c in b.events if c in {c2 for _, c2 in a.events}]
    if order_a != order_b:
        a.warnings.append(f"[senkron] kod sırası farklı: {order_a} ≠ {order_b} (makinede kilitlenme riski)")


def resample(s: Stream, t: np.ndarray) -> Dict[str, np.ndarray]:
    out = {"t": t}
    for k, v in s.data.items():
        if len(s.t) == 0:
            out[k] = np.zeros_like(t); continue
        r = np.interp(t, s.t, v)
        if k not in ("z", "x"):
            r[(t < s.t[0]) | (t > s.t[-1])] = 0.0
        out[k] = r
    return out


@dataclass
class RunResult:
    streams: Dict[str, Stream]
    shared: Optional[Dict[str, Dict[str, np.ndarray]]] = None   # ortak t ekseni

    @property
    def cycle_time(self) -> float:
        return max(s.duration for s in self.streams.values())


def run_paths(path1_ops: List[Op], path2_ops: List[Op],
              main: Optional[MainPath] = None, sub: Optional[SubPath] = None,
              sync: bool = True, shared_dt: Optional[float] = None) -> RunResult:
    """İki yolu eşzamanlı hesaplar. sync=True → SyncOp kodlarıyla hizalar.
    shared_dt verilirse her iki akış ortak zaman eksenine (adım dt [s]) örneklenir."""
    main = main or MainPath()
    sub = sub or SubPath()
    with ThreadPoolExecutor(max_workers=2) as ex:
        fa = ex.submit(main.run, path1_ops)
        fb = ex.submit(sub.run, path2_ops)
        a, b = fa.result(), fb.result()
    if sync:
        align_sync(a, b)
    res = RunResult({"path1": a, "path2": b})
    if shared_dt:
        T = max(a.duration, b.duration)
        t = np.arange(0.0, T + shared_dt / 2, shared_dt)
        res.shared = {"path1": resample(a, t), "path2": resample(b, t)}
    return res
