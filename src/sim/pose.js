// Hareket içinde t anındaki program (p) ve makine (m) konumu. 3D görünüm ve çarpışma kontrolü ortak kullanır.
import { movePoint } from './interpreter.js';

/** Kanal hareketsizken (program yok) güvenli park konumları */
export function homePose(ch, machine) {
  const h = ch === 1 ? { X: 25, Y: 0, Z: -1, C: 0 } : { X: 0, Y: 0, Z: machine?.subHomeZ ?? 200, C: 0 };
  return { p: { ...h }, m: { ...h }, f: 1 };
}

export function poseOf(m, t, ch = 1, machine = null) {
  if (!m) return homePose(ch, machine);
  const f = m.t1 > m.t0 ? Math.min(1, Math.max(0, (t - m.t0) / (m.t1 - m.t0))) : 1;
  const p = movePoint(m, f);
  const a = m.mFrom, b = m.mTo;
  let mm;
  if (m.kind === 'arc') {
    // yay: program noktasını makineye çevirmek için doğrusal ofset farkı yeterli (ofset sabit)
    mm = { X: p.X + (a.X - m.from.X), Y: p.Y + (a.Y - m.from.Y), Z: p.Z + (a.Z - m.from.Z), C: p.C };
  } else mm = { X: a.X + (b.X - a.X) * f, Y: a.Y + (b.Y - a.Y) * f, Z: a.Z + (b.Z - a.Z) * f, C: a.C + (b.C - a.C) * f };
  return { p, m: mm, f };
}
