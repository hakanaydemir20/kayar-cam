"""Çalıştır (kayar-cam klasöründen): python -m analiz.swiss_z1.example"""
from shapely.geometry import LineString
from analiz.swiss_z1.offsets import Setup, Tool, MachineState
from analiz.swiss_z1.toolpath import convert, validate, cycle

setup = Setup(L=20, face_stock=0.2, cutoff_width=2.0, extra=0.1)
t1 = Tool("T01")
cut = Tool("T05 kesme", width=2.0, ref="back")
path = LineString([(0, 6), (5, 6), (5, 8), (20, 8)])

c = convert(path, setup, t1, MachineState())
for z, x, Z1, oh in zip(c.z_part, c.x, c.Z1, c.overhang):
    print(f"z={z:6.2f} x={x:5.2f} -> Z1={Z1:7.3f} çıkıntı={oh:6.2f}")
print("doğrulama:", validate(c, setup, stock_d=10) or "OK")

traj, ev, st = cycle(setup, [path], t1, cut, rechuck_at=10)
for e in ev:
    print(f"[{e.t:3d}] {e.kind:15s} Z1={e.Z1:8.3f} {e.info}")
