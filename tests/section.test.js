// Serbest çizim kesiti → döner parça (çift-tek dolgu, iç boşluklar, hatalar)
import { describe, it, expect } from 'vitest';
import { solveSection, sectionToPart, rectEnts, cornerOp, entsFromPoints } from '../src/part/section.js';
import { profileR } from '../src/sim/stockSim.js';
import { newProject, runPipeline } from '../src/project.js';

const L = (a, b) => ({ type: 'line', a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] } });
const poly = (...p) => p.map((q, i) => L(q, p[(i + 1) % p.length]));

describe('serbest çizim kesiti', () => {
  it('kademeli dış hat (çizgilerle, eksen dahil kapalı) → profil', () => {
    const e = poly([0, 0], [0, 3], [8, 3], [8, 5], [20, 5], [20, 0]);
    const r = sectionToPart(e, 'p');
    expect(r.errors).toEqual([]);
    expect(r.part.length).toBeCloseTo(20, 6);
    expect(profileR(r.part.profile, 4)).toBeCloseTo(3, 6);
    expect(profileR(r.part.profile, 15)).toBeCloseTo(5, 6);
    expect(r.part.inner).toBeNull();
  });
  it('ön alından düz dipli delik (iç dikdörtgen, eksen kenarı çakışık) → delik, flat, uyarı', () => {
    const e = [...rectEnts({ x: 0, y: 0 }, { x: 20, y: 5 }), ...rectEnts({ x: 0, y: 0 }, { x: 6, y: 2 })];
    const r = sectionToPart(e, 'p');
    expect(r.errors).toEqual([]);
    const h = r.part.features.find(f => f.type === 'axialHole');
    expect(h).toMatchObject({ side: 'front', dia: 4, depth: 6, flat: true });
    expect(r.warnings.join()).toMatch(/düz dip/);
  });
  it('boydan delik ve kademeli delik + iç segman kanalı', () => {
    const outer = rectEnts({ x: 0, y: 0 }, { x: 30, y: 8 });
    const bore = poly([0, 0], [0, 4], [10, 4], [10, 3], [14, 3], [14, 3.8], [15, 3.8], [15, 3], [30, 3], [30, 0]);
    const r = sectionToPart([...outer, ...bore], 'p');
    expect(r.errors).toEqual([]);
    const holes = r.part.features.filter(f => f.type === 'axialHole');
    expect(holes.some(h => h.dia === 8 && h.depth === 10 && h.side === 'front')).toBe(true);
    expect(r.part.features.some(f => f.type === 'innerGroove' && f.z0 === 14 && f.z1 === 15)).toBe(true);
  });
  it('açık kontur ve kopuk parça hata verir', () => {
    const open = [L([0, 0], [0, 3]), L([0, 3], [10, 3]), L([10, 3], [10, 0])];
    expect(solveSection(open).errors.join()).toMatch(/açık uç/);
    const two = [...rectEnts({ x: 0, y: 0 }, { x: 5, y: 3 }), ...rectEnts({ x: 8, y: 0 }, { x: 12, y: 3 })];
    expect(solveSection(two).errors.join()).toMatch(/ikiye/);
  });
  it('kapalı iç boşluk (döndürülemez) hata verir', () => {
    const e = [...rectEnts({ x: 0, y: 0 }, { x: 20, y: 6 }), ...rectEnts({ x: 5, y: 2 }, { x: 10, y: 4 })];
    expect(solveSection(e).errors.join()).toMatch(/birden fazla/);
  });
  it('köşe radyüsü ve pah; eski nokta çizimi dönüşür; CAM hatasız', () => {
    const e = rectEnts({ x: 0, y: 0 }, { x: 25, y: 6 });
    expect(cornerOp(e, { x: 0, y: 6 }, 'ch', 0.5).ok).toBe(true);
    expect(cornerOp(e, { x: 25, y: 6 }, 'rad', 1).ok).toBe(true);
    const r = sectionToPart(e, 'p');
    expect(r.errors).toEqual([]);
    expect(profileR(r.part.profile, 0.25)).toBeCloseTo(5.75, 2);
    expect(profileR(r.part.profile, 25)).toBeLessThan(5.1);
    const e2 = entsFromPoints([{ z: 0, r: 3 }, { z: 8, r: 3 }, { z: 8, r: 5 }, { z: 20, r: 5 }]);
    expect(sectionToPart(e2).errors).toEqual([]);
    const P = newProject(r.part);
    expect(runPipeline(P).errors).toEqual([]);
  });
});
