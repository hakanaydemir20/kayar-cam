// ISO kesici uç kodları ve uç dış hattı
import { describe, it, expect } from 'vitest';
import { parseInsertCode, insertOutline, INSERT_SHAPES, makeTool } from '../src/tools/toolLibrary.js';

describe('kesici uç', () => {
  it('ISO kodları çözülür', () => {
    expect(parseInsertCode('VCMT 110304')).toMatchObject({ shape: 'V', clearance: 7, size: 11, noseR: 0.4 });
    expect(parseInsertCode('dcgt11t302')).toMatchObject({ shape: 'D', size: 11, noseR: 0.2 });
    expect(parseInsertCode('CNMG 120408')).toMatchObject({ shape: 'C', clearance: 0, size: 12, noseR: 0.8 });
    expect(parseInsertCode('TCMT-16T304')).toMatchObject({ shape: 'T', size: 16, noseR: 0.4 });
    expect(parseInsertCode('RCMT 1003M0')).toMatchObject({ shape: 'R', size: 10, noseR: null });
    expect(parseInsertCode('XYZ')).toBeNull();
  });
  for (const k of Object.keys(INSERT_SHAPES)) {
    it(k + ' dış hattı: hayali uç orijinde, uç açısı doğru', () => {
      const t = makeTool({ type: 'turn', insertShape: k, noseR: 0.4 });
      const p = insertOutline(t);
      expect(Math.min(...p.map(q => q[0]))).toBeCloseTo(0, 9);
      expect(Math.min(...p.map(q => q[1]))).toBeCloseTo(0, 9);
      expect(t.insertAngle).toBe(INSERT_SHAPES[k].angle);
      // hayali uç (0,0) şeklin dışında kalır (burun radyüsü kadar), şekil içine 0.4 mm'den fazla girmez
      const minD = Math.min(...p.map(([x, y]) => Math.hypot(x, y)));
      expect(minD).toBeGreaterThan(0.05);
      // yuvarlak uçta hayali uç sınır kutusunun köşesidir: r(√2 − 1)
      expect(minD).toBeLessThan(k === 'R' ? 5 * (Math.SQRT2 - 1) + 1e-6 : 0.4 * 1.5 + 1e-9);
    });
  }
  it('eski proje: açıdan şekil çıkarılır', () => {
    expect(makeTool({ type: 'turn', insertAngle: 55 }).insertShape).toBe('D');
    expect(makeTool({ type: 'turn' }).insertShape).toBe('V');
  });
});

import { insertAdvice, theoreticalRa, suggestRough } from '../src/tools/toolLibrary.js';
describe('uç seçim kuralları', () => {
  it('V 35° kenar 11 → paso ≤ 2.75; C 80° 12 → ≤ 7.9; negatif uç tanınır', () => {
    expect(insertAdvice(makeTool({ type: 'turn', insertShape: 'V', insertSize: 11 })).apMax).toBeCloseTo(2.75, 2);
    const c = makeTool({ type: 'turn', insertCode: 'CNMG 120408', insertShape: 'C', insertSize: 12, noseR: 0.8 });
    expect(insertAdvice(c).apMax).toBeCloseTo(7.92, 2);
    expect(insertAdvice(c).negative).toBe(true);
  });
  it('Ra ≈ f²/(32 rε); öneri rε ≤ ap ve f ≤ 0.5 rε', () => {
    expect(theoreticalRa(0.1, 0.4)).toBeCloseTo(0.78, 2);
    const t = makeTool({ type: 'turn', insertShape: 'D', insertSize: 11, noseR: 0.8 });
    const s = suggestRough('c45', t, 20);
    expect(s.ap).toBeGreaterThanOrEqual(0.8);
    expect(s.feed).toBeLessThanOrEqual(0.4);
  });
});

import { TOOL_CATALOG, INSERT_CODES } from '../src/tools/toolLibrary.js';
import { newProject as np, runPipeline as rp } from '../src/project.js';
import { createToolMesh } from '../src/view3d/toolMeshes.js';
describe('takım kataloğu', () => {
  it('her uç kodu çözülür ve her uç tipinden 5 kod var', () => {
    for (const [c] of INSERT_CODES) expect(parseInsertCode(c), c).toBeTruthy();
    for (const k of 'CDVTWSR') expect(INSERT_CODES.filter(([c]) => c[0] === k).length, k).toBe(5);
  });
  it('katalogdaki her takım oluşturulur, 3D modeli çizilir; kategori başına en az 5', () => {
    for (const g of TOOL_CATALOG) {
      expect(g.items.length, g.group).toBeGreaterThanOrEqual(5);
      for (const it of g.items) { const t = makeTool({ ...it.p, num: 90 }); expect(() => createToolMesh(t), it.label).not.toThrow(); }
    }
  });
  it('katalogdaki tornalama tutucusu kaba işlemde kullanılınca hatasız kod üretir', () => {
    for (const it of TOOL_CATALOG[0].items) {
      const P = np(); const t = makeTool({ ...it.p, num: 1, yPos: 110 });
      P.tools = P.tools.filter(x => x.num !== 1).concat(t);
      for (const o of P.ops) if (o.type === 'rough' || o.type === 'face') o.toolId = t.id;
      expect(rp(P).errors.filter(e => e.src === 'cam'), it.label).toEqual([]);
    }
  });
});
