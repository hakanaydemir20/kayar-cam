"""Kayar otomat (Swiss-type) Z1 ofset zinciri — 3x3 homojen (z, x) matrisleri.

Çerçeveler (src/sim/frames.js ile aynı, kanal 1):
  dünya  w : eksenel, karşı mile doğru +; kesme düzlemi w=0, burç alnı w=bush_face (-3.2)
  parça  d : parça ön alnından (d=0) aynaya doğru +;   w = front_world - d
  makine Z1: ana mil (ayna) konumu;                     front_world = Z1 + bar_offset
  takım    : referans ucu dünya konumu w_tip = tool.dz (gang ~ 0), X1 = x + dx (çap)
Program Z = kesme noktasındaki parça koordinatı d (bar_offset=0, dz=0 iken Z1 = d).
"""
from __future__ import annotations
from dataclasses import dataclass
import numpy as np


def T(dz=0.0, dx=0.0):
    """3x3 homojen öteleme (z, x)."""
    m = np.eye(3)
    m[0, 2] = dz
    m[1, 2] = dx
    return m


FLIP = np.diag([-1.0, 1.0, 1.0])  # parça d (aynaya doğru +) -> dünya w (karşı mile doğru +)


@dataclass(frozen=True)
class Tool:
    name: str = "T"
    dz: float = 0.0        # referans ucunun dünya Z'si (kesme düzlemine göre); gang tasarımı gereği ~0
    dx: float = 0.0        # X (çap) ofseti
    dy: float = 0.0        # Y ofseti (bilgi; Z1'i etkilemez)
    width: float = 0.0     # kesme kalemi genişliği w
    ref: str = "front"     # 'front' (parça tarafı kenar) | 'back' (ayna tarafı kenar, atölye)

    def matrix(self):
        """takım -> kızak/dünya: referans noktasının konumu."""
        return T(self.dz, self.dx)

    def edge_shift(self):
        """Programlanan referans kenar ile parça tarafı kesici kenar arası (parça d).
        back referansta parça tarafı kenar = Z - w."""
        return self.width if self.ref == "back" else 0.0


@dataclass
class MachineState:
    bar_offset: float = 0.0            # front_world - Z1 (ayna kapalı)
    chuck_open: bool = False
    front_world: float | None = None   # ayna açıkken çubuk ön alnı (sabit kalır)
    z1: float = 0.0

    def front(self, z1=None):
        z1 = self.z1 if z1 is None else z1
        return self.front_world if self.chuck_open else z1 + self.bar_offset

    # --- çevrim olayları (stockSim.js ile birebir) ---
    def open_chuck(self):
        self.front_world = self.front()
        self.chuck_open = True

    def close_chuck(self):
        self.bar_offset = self.front_world - self.z1
        self.chuck_open = False

    def move(self, z1):
        self.z1 = float(z1)

    def zero_set(self, z):
        """G125 Z<z>: ayna açık + çubuk dayamada -> ön alın dünya z'de; kapalıysa bar_offset=0."""
        if self.chuck_open:
            self.front_world = float(z)
        else:
            self.bar_offset = 0.0

    def rechuck(self, dz1):
        """Ara yeniden bağlama: ayna aç, ana mil dz1 kadar git (çubuk burçta durur), kapat.
        bar_offset -= dz1  (frames.js zShift = -bar_offset; G10/W kaydırması)."""
        self.open_chuck()
        self.move(self.z1 + dz1)
        self.close_chuck()


@dataclass(frozen=True)
class Setup:
    L: float = 20.0
    face_stock: float = 0.2
    cutoff_width: float = 2.0
    extra: float = 0.1                # #120
    bush_face: float = -3.2           # LAYOUT.bushFace
    z1_min: float = -20.0
    z1_max: float = 205.0
    max_overhang: float = 60.0
    bush_d: float | None = None       # burç/ham çap (geri çekme kuralı)

    # zincir: parça -> çubuk(dünya, Z1=0) -> ana mil(Z1)
    def part_to_headstock(self, st: MachineState):
        return T(st.bar_offset) @ FLIP

    def part_to_world(self, st: MachineState, z1):
        return T(z1) @ self.part_to_headstock(st)

    def z1(self, d, tool: Tool, st: MachineState, x=0.0):
        """Z1 = f(d): takım referansı parça d'ye denk gelecek ana mil konumu.
        tip = Z1 + (part_to_headstock . d)  ->  Z1 = dz + d - bar_offset."""
        p = self.part_to_headstock(st) @ np.array([d, x, 1.0])
        return float((tool.matrix() @ [0.0, 0.0, 1.0])[0] - p[0])

    def z_part(self, z1, tool: Tool, st: MachineState):
        """Ters: Z1 -> takım referansı altındaki parça d."""
        tip = tool.matrix() @ [0.0, 0.0, 1.0]
        return float((np.linalg.inv(self.part_to_world(st, z1)) @ tip)[0])

    def x1(self, x, tool: Tool):
        return float(x + tool.dx)

    def stickout(self, d, tool: Tool):
        """d kesilirken burçtan dışarıdaki desteksiz boy = front_world - bush_face = d + dz - bush_face."""
        return float(d + tool.dz - self.bush_face)

    def cut_to_bush(self, tool: Tool):
        """Kesme noktası <-> burç alnı (sabit; kayar otomatın esası)."""
        return float(tool.dz - self.bush_face)

    def cutoff_z(self, tool: Tool):
        """N100: Z = L + w + #120 (back ref.) | L + #120 (front ref.)."""
        return self.L + self.extra + tool.edge_shift()
