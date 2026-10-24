import { describe, it, expect } from 'vitest';
import { sampleProfile, noseTipPath, turnableEnvelope, dilate } from '../src/geom/sampled.js';
import { fitSegments, segmentsToPoints } from '../src/geom/fit.js';
import { profileFromTable } from '../src/part/part.js';

describe('örneklenmiş profil', () => {
  const pts = profileFromTable([{ dia: 6, len: 5 }, { dia: 10, len: 5 }]);
  const s = sampleProfile(pts, -1, 11, 0.001, 0);
  it('çapları doğru örnekler', () => {
    expect(s.at(2)).toBeCloseTo(3, 6);
    expect(s.at(7)).toBeCloseTo(5, 6);
    expect(s.at(-0.5)).toBe(0);
  });
  it('burun telafisi: hayali uç çap ve yüzlerde profile oturur', () => {
    const p = noseTipPath(s, 0.4);
    expect(p.at(2.5)).toBeCloseTo(3, 3);   // düz çap
    expect(p.at(7.5)).toBeCloseTo(5, 3);
    // hiçbir noktada burun dairesi profili kesmemeli
    for (let i = 0; i < p.n; i += 97) {
      const z = p.zAt(i), cr = p.r[i] + 0.4, cz = z - 0.4;
      for (let j = 0; j < s.n; j += 11) {
        const d = Math.hypot(s.zAt(j) - cz, s.r[j] - cr);
        if (s.zAt(j) >= 0 && s.zAt(j) <= 10) expect(d).toBeGreaterThan(0.4 - 0.0025);
      }
    }
  });
  it('zarf geriye bakan basamağı doldurur', () => {
    const p2 = sampleProfile(profileFromTable([{ dia: 10, len: 5 }, { dia: 6, len: 5 }]), 0, 10, 0.01);
    const e = turnableEnvelope(p2, 30);
    expect(e.at(5.5)).toBeGreaterThan(4.6);
    expect(e.at(9.9)).toBeCloseTo(3, 6);
  });
  it('dilate pay ekler', () => {
    const d = dilate(s, 0.1, 0.2);
    expect(d.at(2)).toBeCloseTo(3.2, 6);
    expect(d.at(4.95)).toBeCloseTo(5.2, 6);
  });
});

describe('segment uydurma', () => {
  it('düz çizgileri tek segmente indirger', () => {
    const pts = [];
    for (let z = 0; z <= 10; z += 0.01) pts.push({ z, r: 3 + z * 0.1 });
    const segs = fitSegments(pts, 0.001);
    expect(segs.length).toBe(1);
  });
  it('yayı tanır ve yönünü bulur', () => {
    const pts = [];
    for (let a = Math.PI; a >= Math.PI / 2; a -= 0.001) pts.push({ z: 1 + Math.cos(a), r: 4 + Math.sin(a) });
    const segs = fitSegments(pts, 0.001);
    expect(segs.length).toBe(1);
    expect(segs[0].type).toBe('arc');
    expect(segs[0].cw).toBe(true);
    expect(segs[0].R).toBeCloseTo(1, 3);
    const back = segmentsToPoints(segs, 0.01);
    expect(back[back.length - 1].z).toBeCloseTo(pts[pts.length - 1].z, 6);
  });
});
