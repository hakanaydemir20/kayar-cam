import { describe, it, expect } from 'vitest';
import { sectionPoints, innerRAt } from '../src/view3d/partSection.js';
import { sectionToPart } from '../src/part/section.js';
import { examplePart } from '../src/part/part.js';

const L = (a, b) => ({ type: 'line', a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] } });
const poly = (...p) => p.map((q, i) => L(q, p[(i + 1) % p.length]));

describe('3D kesit (iç profil dahil)', () => {
  it('çizim: delik + iç kanal kesitte görünür', () => {
    // dış Ø12 × 20; önden Ø6 × 12 delik, Z 5–7 arası Ø8 iç kanal
    const e = [...poly([0, 0], [0, 6], [20, 6], [20, 0]), ...poly([0, 0], [0, 3], [5, 3], [5, 4], [7, 4], [7, 3], [12, 3], [12, 0])];
    const { part } = sectionToPart(e, 'kanallı burç');
    const pts = sectionPoints(part);
    expect(innerRAt(part, 2)).toBeCloseTo(3, 3);
    expect(innerRAt(part, 6)).toBeCloseTo(4, 3);
    expect(innerRAt(part, 15)).toBeCloseTo(0, 3);
    expect(pts.some(p => Math.abs(p.r - 4) < 1e-6 && p.z > 4.9 && p.z < 7.1)).toBe(true);
    expect(pts[0]).toEqual(pts[pts.length - 1]);   // kapalı
  });
  it('özellikteki eksenel delik (tablo parça) kesitte', () => {
    const p = examplePart();
    const pts = sectionPoints(p);
    const h = p.features.find(f => f.type === 'axialHole');
    expect(pts.some(q => Math.abs(q.r - h.dia / 2) < 1e-6)).toBe(true);
  });
});
