"""Parça koordinatlı takım yolu -> Z1 yörüngesi, çıkıntı, doğrulama, segmentleme, çevrim."""
from __future__ import annotations
from dataclasses import dataclass
import numpy as np
from .offsets import Setup, Tool, MachineState


def as_array(path):
    """numpy (N,2) [z_part, x] veya shapely LineString (koordinat (z, x))."""
    if hasattr(path, "coords"):
        return np.asarray(path.coords, float)[:, :2]
    a = np.asarray(path, float)
    if a.ndim != 2 or a.shape[1] < 2:
        raise ValueError("(N,2) [z, x] bekleniyor")
    return a[:, :2]


@dataclass
class Converted:
    z_part: np.ndarray
    x: np.ndarray
    Z1: np.ndarray
    X1: np.ndarray
    overhang: np.ndarray       # anlık desteksiz boy (ön alın <-> burç alnı)
    cut_to_bush: float         # kesme noktası <-> burç (sabit)
    bar_offset: float


def convert(path, setup: Setup, tool: Tool, st: MachineState) -> Converted:
    a = as_array(path)
    z, x = a[:, 0], a[:, 1]
    Z1 = np.array([setup.z1(d, tool, st) for d in z])
    return Converted(z, x, Z1, x + tool.dx, z + tool.dz - setup.bush_face,
                     setup.cut_to_bush(tool), st.bar_offset)


@dataclass
class Issue:
    kind: str      # stroke | overhang | bush_pullback
    index: int
    value: float
    msg: str


def validate(c: Converted, setup: Setup, stock_d: float | None = None):
    """Z1 strok sınırı, maksimum çıkıntı, burç geri-çekme kuralı
    (çapı burç/ham çaptan küçük işlenmiş kesit burç içine geri çekilemez)."""
    out = []
    for i, (z1, oh) in enumerate(zip(c.Z1, c.overhang)):
        if not setup.z1_min <= z1 <= setup.z1_max:
            out.append(Issue("stroke", i, z1, f"Z1={z1:.3f} strok dışı [{setup.z1_min},{setup.z1_max}]"))
        if oh > setup.max_overhang:
            out.append(Issue("overhang", i, oh, f"çıkıntı {oh:.2f} > {setup.max_overhang}"))
    bush_d = setup.bush_d if setup.bush_d is not None else stock_d
    if bush_d is not None:
        machined = -np.inf   # şimdiye kadar işlenmiş en derin d
        for i in range(len(c.z_part)):
            d_at_bush = c.overhang[i]  # burç alnındaki parça d'si = front_world - bush_face
            if machined > d_at_bush + 1e-9:
                out.append(Issue("bush_pullback", i, machined - d_at_bush,
                                 f"bitmiş kesit (d<={machined:.2f}) burca geri çekiliyor (burçtaki d={d_at_bush:.2f})"))
            if c.x[i] < bush_d - 1e-9:
                machined = max(machined, c.z_part[i])
    return out


def segment(path, setup: Setup, tool: Tool, st: MachineState, rechuck_shift: float | None = None):
    """Takım yolunu böl (app'teki stock.segment benzeri):
    (a) çıkıntı sınırı aşılınca -> 'segment' sınırı (destek/karşı mil gerekli),
    (b) Z1 strok üst sınırı aşılınca -> 'rechuck' (ayna aç, ana mil geri, kapa; st güncellenir).
    Dönüş: [(dilim (N,2), olay | None)]."""
    a = as_array(path)
    if rechuck_shift is None:
        rechuck_shift = -0.5 * (setup.z1_max - setup.z1_min)
    segs, cur = [], [a[0]]
    seg_lim = setup.max_overhang
    for p in a[1:]:
        ev = None
        if setup.stickout(p[0], tool) > seg_lim:
            ev = ("segment", seg_lim)
            seg_lim += setup.max_overhang
        elif setup.z1(p[0], tool, st) > setup.z1_max:
            st.rechuck(rechuck_shift)
            ev = ("rechuck", rechuck_shift)
        if ev:
            segs.append((np.array(cur), ev))
            cur = [cur[-1], p]
        else:
            cur.append(p)
    segs.append((np.array(cur), None))
    return segs


@dataclass
class Event:
    t: int
    kind: str
    Z1: float
    info: str = ""


class StrokeError(ValueError):
    """Çevrim hareketi Z1 strok sınırı dışında."""


def safe_rechuck(st: MachineState, setup: Setup, shift: float):
    """Strok içinde kalan rechuck: geri çekme Z1 >= z1_min olacak şekilde sınırlanır; gerekirse
    birden çok adıma bölünür (adım arası ayna kapalı ileri dönüş). Dönüş: [(olay, Z1, bilgi)]."""
    out, rem, z0 = [], -shift, st.z1
    while rem > 1e-9:
        avail = st.z1 - setup.z1_min
        if avail <= 1e-9:
            raise StrokeError(f"rechuck yapılamaz: Z1={st.z1:.3f} zaten z1_min={setup.z1_min}")
        step = min(rem, avail)
        st.rechuck(-step); rem -= step
        out.append(("rechuck", st.z1, f"-{step:.3f} barOffset={st.bar_offset:+.3f}"))
        if rem > 1e-9:
            st.move(z0); out.append(("G0 ileri (ayna kapalı)", st.z1, ""))
    return out


def cycle(setup: Setup, passes, tool: Tool, cutoff: Tool, rechuck_at: float | None = None,
          rechuck_shift: float = -12.0, strict: bool = True):
    """Tam çevrim (kayarTemplate.js): M11 aç, G0Z-fs T0, G125Z-fs, M10 kapa, G0W-12.,
    pasolar (d > rechuck_at olunca bir kez ara rechuck), N100 kesme (Z = L + w + #120).
    Dönüş: (Z1 dizisi, olaylar, son durum)."""
    st = MachineState(z1=0.0)
    traj, ev = [], []

    def check(z1):
        if not setup.z1_min - 1e-9 <= z1 <= setup.z1_max + 1e-9:
            msg = f"Z1={z1:.3f} strok dışı [{setup.z1_min},{setup.z1_max}]"
            if strict:
                raise StrokeError(msg)
            ev.append(Event(len(traj) - 1, "stroke", z1, msg))

    def push(kind, info="", z1=None):
        z1 = st.z1 if z1 is None else z1
        check(z1)
        traj.append(z1)
        ev.append(Event(len(traj) - 1, kind, z1, info))

    fs = setup.face_stock
    st.open_chuck(); push("M11 ayna aç")
    st.move(-fs); push("G0Z T0", f"Z-{fs:g}")
    st.zero_set(-fs); push("G125", f"ön alın dünya {st.front_world:g}")
    st.close_chuck(); push("M10 ayna kapa", f"barOffset={st.bar_offset:+.3f}")
    st.move(st.z1 - 12.0); push("G0W-12.")
    done = False
    for k, p in enumerate(passes):
        a = as_array(p)
        if rechuck_at is not None and not done and a[:, 0].max() > rechuck_at:
            done = True
            for kind, z, info in safe_rechuck(st, setup, rechuck_shift):
                push(kind, info, z)
        for z1 in convert(a, setup, tool, st).Z1:
            st.move(z1); check(z1); traj.append(z1)
        ev.append(Event(len(traj) - 1, "pass", st.z1, f"paso {k}"))
    zc = setup.cutoff_z(cutoff)
    st.move(setup.z1(zc, cutoff, st)); push("N100 kesme", f"Z={zc:.3f} ({cutoff.ref})")
    return np.array(traj), ev, st
