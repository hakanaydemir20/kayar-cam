// Tam makine çarpışma kontrolü: bilinen hatalı kurulumları yakalamalı, doğru programda yanlış alarm vermemeli.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { newProject, runPipeline } from '../src/project.js';
import { makePart, profileFromTable } from '../src/part/part.js';
import { makeOp } from '../src/ops/program.js';
import { StockSim } from '../src/sim/stockSim.js';
import { intersects } from '../src/sim/collision.js';
import { toolBodies } from '../src/sim/bodies.js';
import { createToolMesh } from '../src/view3d/toolMeshes.js';
import { rotaryProfile, gangToolBoxes, isRotaryType } from '../src/tools/toolGeom.js';
import { subPark } from '../src/ops/generators.js';
import { buildContext } from '../src/ops/context.js';

const run = (p) => { const r = runPipeline(p); return { r, ss: new StockSim(p, r.sim).runAll() }; };
const tool = (p, n) => p.tools.find(t => t.num === n);

function backPart(grip = 4) {
  const rows = [{ dia: 8, len: 6, ch: 0.3 }, { dia: 12, len: 14, ch: 0.5 }, { dia: 8, len: 10 }];
  const part = makePart({ name: 'Arka Test', profile: profileFromTable(rows), rows, features: [{ id: 'h1', type: 'facePolygon', side: 'back', n: 6, af: 6, depth: 2, c: 0 }] });
  const p = newProject(part);
  p.ops = p.ops.filter(o => o.type !== 'groove');
  p.ops.find(o => o.type === 'cutoff').params.backStock = 0.3;
  p.ops.find(o => o.type === 'pickoff').params.grip = grip;
  p.ops.splice(p.ops.findIndex(o => o.type === 'backPolar'), 0, makeOp('backTurn', tool(p, 42).id));
  return p;
}

describe('çarpışma geometrisi', () => {
  it('kutu/silindir kesişim testleri', () => {
    const box = (x0, x1, y0, y1, z0, z1) => ({ t: 'box', b: [x0, x1, y0, y1, z0, z1] });
    const cyl = (x0, x1, r, cy = 0, cz = 0) => ({ t: 'cyl', x0, x1, r0: r, r1: r, cy, cz });
    expect(intersects(box(0, 1, 0, 1, 0, 1), box(0.5, 2, 0.5, 2, 0.5, 2))).toBe(true);
    expect(intersects(box(0, 1, 0, 1, 0, 1), box(1.2, 2, 0, 1, 0, 1))).toBe(false);
    expect(intersects(cyl(0, 10, 5), box(2, 3, 4, 6, -1, 1))).toBe(true);      // kutu silindir yüzeyine giriyor
    expect(intersects(cyl(0, 10, 5), box(2, 3, 4, 6, 4, 6))).toBe(false);      // köşegen: √(16+16)=5.66 > 5
    expect(intersects(cyl(0, 10, 5), cyl(5, 20, 3, 0, 7.9))).toBe(true);
    expect(intersects(cyl(0, 10, 5), cyl(5, 20, 3, 0, 8.1))).toBe(false);
  });
  it('3D takım modelleri ile çarpışma gövdeleri aynı ölçüde (toolGeom ↔ toolMeshes)', () => {
    const p = newProject();
    for (const t of p.tools) {
      const g = createToolMesh(t);
      const bb = new THREE.Box3().setFromObject(g);
      if (isRotaryType(t)) {
        const pr = rotaryProfile(t);
        expect(bb.max.y, t.name).toBeCloseTo(pr.length, 1);
        const rmax = Math.max(...pr.segs.map(s => s.r));
        expect(Math.max(bb.max.x, -bb.min.x), t.name).toBeLessThanOrEqual(rmax + 0.05);
      } else {
        const bx = gangToolBoxes(t);
        const u = [Math.min(...bx.map(b => b.box[0])), Math.max(...bx.map(b => b.box[1])), Math.min(...bx.map(b => b.box[2])), Math.max(...bx.map(b => b.box[3]))];
        expect(bb.min.x, t.name).toBeGreaterThanOrEqual(u[0] - 0.3);
        expect(bb.max.x, t.name).toBeLessThanOrEqual(u[1] + 0.3);
        expect(bb.max.y, t.name).toBeLessThanOrEqual(u[3] + 0.3);
        expect(bb.min.y, t.name).toBeGreaterThanOrEqual(-0.05);
      }
    }
  });
  it('takım ucu modelde uç noktası orijinde (gövdeler uç düzleminin gerisine taşmaz)', () => {
    const p = newProject();
    for (const t of p.tools.filter(t => t.unit === 'gang' && t.type === 'turn')) {
      for (const b of toolBodies(t).filter(b => !b.cut)) expect(b.b[0], t.name).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('çarpışma kontrolü: doğru programlar temiz', () => {
  it('örnek parça', () => { const { ss } = run(newProject()); expect(ss.collisions).toEqual([]); });
  it('arka işlemli kısa parça (tutma 4 mm)', () => { const { r, ss } = run(backPart(4)); expect(r.errors).toEqual([]); expect(ss.collisions).toEqual([]); });
});

describe('çarpışma kontrolü: hatalı kurulumları yakalar', () => {
  it('gang takımları çok sık (8 mm): komşu takım çubuğa çarpar', () => {
    const p = newProject();
    tool(p, 2).yPos = tool(p, 1).yPos - 8;
    const { ss } = run(p);
    expect(ss.collisions.some(c => /T02 .*↔ ana iş milindeki parça/.test(c.msg))).toBe(true);
  });
  it('kısa parça + uzun tutma: karşı iş mili pens somunu komşu takıma çarpar', () => {
    const { ss } = run(backPart(6));
    expect(ss.collisions.some(c => /pens somunu/.test(c.msg))).toBe(true);
  });
  it('arka ünitede takımlar çok sık: komşu takım karşı iş milindeki parçaya çarpar', () => {
    const p = backPart(4);
    tool(p, 41).yPos = tool(p, 42).yPos - 8;
    const { ss } = run(p);
    expect(ss.collisions.some(c => /T41 .*↔ karşı iş milindeki parça/.test(c.msg))).toBe(true);
  });
  it('kovan takımı çok yukarıda: kovan bloğu parçaya çarpar', () => {
    const p = newProject();
    for (const t of p.tools.filter(t => t.unit === 'front')) t.xPos = -20;
    const { ss } = run(p);
    expect(ss.collisions.some(c => /Kovan|T2\d/.test(c.msg))).toBe(true);
  });
});

describe('güvenlik kuralları (çarpışma kontrolünün bulduğu hatalar)', () => {
  it('karşı iş mili ön kovan takımlarının erişiminin dışında bekler', () => {
    const p = newProject();
    const ctx = buildContext(p);
    const reach = Math.max(...p.tools.filter(t => t.unit === 'front').map(t => rotaryProfile(t).length));
    expect(subPark(ctx) - 10.4).toBeGreaterThan(reach + 10);
  });
  it('kovan takımından sonra radyal takıma geçişte önce güvenli X, sonra Z (diş yaklaşması)', () => {
    const { r } = run(newProject());
    const l1 = r.posted.paths[0];
    const i = l1.findIndex(s => /^T0404/.test(s));
    const moves = l1.slice(i + 1).filter(s => /^(G0|G1|X|Y|Z)/.test(s)).slice(0, 3);
    expect(moves[0]).toMatch(/^G0 X16\.$/);           // yalnız X
    expect(moves[1]).not.toMatch(/X/);                 // sonra Y/Z
  });
  it('arka alın payında karşı iş mili tam tutma boyunda tutar (Z = L + pay − tutma)', () => {
    const p = backPart(4);
    const { r } = run(p);
    expect(r.posted.paths[1].join('\n')).toMatch(/G1 Z26\.3 F500\./);   // 30 + 0.3 − 4
  });
});
