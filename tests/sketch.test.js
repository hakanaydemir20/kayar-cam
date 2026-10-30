// 2D çizim → döner profil
import { describe, it, expect } from 'vitest';
import { validateSketch, sketchToProfile, partFromSketch, mirrorSketchPart, exampleSketch } from '../src/part/sketch.js';
import { newProject, runPipeline } from '../src/project.js';

const mono = (pr) => pr.every((p, i) => i === 0 || p.z >= pr[i - 1].z - 1e-9);

describe('çizim', () => {
  it('örnek çizim: boy, çap, kapalı ve Z artan profil', () => {
    const part = partFromSketch(exampleSketch(), 'Ç');
    expect(part.length).toBeCloseTo(35, 6);
    expect(part.maxDia).toBeCloseTo(14, 6);
    const pr = part.profile;
    expect(pr[0]).toEqual({ z: 0, r: 0 });
    expect(pr.at(-1).r).toBe(0);
    expect(mono(pr)).toBe(true);
    // ön alın pahı 0.5: (0, 2.5) → (0.5, 3)
    expect(pr[1]).toEqual({ z: 0, r: 2.5 });
    expect(pr[2]).toEqual({ z: 0.5, r: 3 });
  });
  it('radyüs: teğet yay, yarıçap kenara sığmazsa küçülür', () => {
    const pr = sketchToProfile([{ z: 0, r: 5 }, { z: 10, r: 5, rad: 1 }, { z: 10, r: 8 }, { z: 20, r: 8 }]);
    expect(mono(pr)).toBe(true);
    // köşe (10,5) içbükey: yay noktaları merkez (9, 6)'ya 1 mm uzaklıkta
    const arc = pr.filter(p => p.z > 9 - 1e-9 && p.z <= 10 + 1e-9 && p.r >= 5 - 1e-9 && p.r <= 6 + 1e-9);
    expect(arc.length).toBeGreaterThan(3);
    for (const p of arc) expect(Math.hypot(p.z - 9, p.r - 6)).toBeCloseTo(1, 5);
    const big = sketchToProfile([{ z: 0, r: 5 }, { z: 2, r: 5, rad: 10 }, { z: 2, r: 8 }, { z: 9, r: 8 }]);
    expect(mono(big)).toBe(true);
  });
  it('denetim: geri giden nokta, tek nokta, sıfır çap', () => {
    expect(validateSketch([{ z: 0, r: 3 }])).toHaveLength(1);
    expect(validateSketch([{ z: 0, r: 3 }, { z: 5, r: 3 }, { z: 4, r: 4 }]).join()).toMatch(/geriye/);
    expect(validateSketch([{ z: 0, r: 0 }, { z: 5, r: 0 }]).join()).toMatch(/çap/);
    expect(validateSketch(exampleSketch())).toEqual([]);
  });
  it('çevir iki kez = aynı parça', () => {
    const p = partFromSketch(exampleSketch(), 'Ç', [{ id: 'a', type: 'crossHole', dia: 3, z: 29, c: 90, through: true }]);
    const m = mirrorSketchPart(p).part;
    expect(m.length).toBeCloseTo(35, 6);
    expect(m.features[0].z).toBeCloseTo(6, 6);
    const back = mirrorSketchPart(m).part;
    expect(back.profile.length).toBe(p.profile.length);
    back.profile.forEach((q, i) => { expect(q.z).toBeCloseTo(p.profile[i].z, 5); expect(q.r).toBeCloseTo(p.profile[i].r, 5); });
  });
  it('çizim parçası CAM hattından hatasız geçer', () => {
    const r = runPipeline(newProject(partFromSketch(exampleSketch(), 'Ç')));
    expect(r.errors).toEqual([]);
    expect(r.posted.text).toMatch(/G1/);
  });
});
