// OBJ içe aktarma: aynı parçanın STEP ağından üretilen OBJ'si STEP ile aynı profil ve özellikleri vermeli
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { createRequire } from 'module';
import { readStep } from '../src/cad/stepImport.js';
import { readObj } from '../src/cad/objImport.js';
import { partFromModel } from '../src/cad/featureRecog.js';

const require = createRequire(import.meta.url);
let occt;
beforeAll(async () => { occt = await require('occt-import-js')(); }, 60000);
const load = (f) => readStep(occt, new Uint8Array(fs.readFileSync('tests/fixtures/' + f)));

/** STEP ağını OBJ metnine çevir (yüz bilgisi olmadan, köşeler paylaşımlı) */
function toObj(m) {
  const key = new Map(), out = [], idx = [];
  for (let i = 0; i < m.positions.length / 3; i++) {
    const k = [0, 1, 2].map(j => m.positions[i * 3 + j].toFixed(5)).join(' ');
    if (!key.has(k)) { key.set(k, key.size + 1); out.push('v ' + k); }
    idx.push(key.get(k));
  }
  for (let t = 0; t < m.indices.length; t += 3) out.push(`f ${idx[m.indices[t]]} ${idx[m.indices[t + 1]]} ${idx[m.indices[t + 2]]}`);
  return '# test\no part\n' + out.join('\n');
}
const sig = (p) => p.features.map(f => f.type).sort().join(',');

describe('OBJ içe aktarma', () => {
  for (const f of ['pim_x_ekseni.step', 'kanalli_mil.step', 'capraz_delikli_burc.step', 'altigen_pim.step']) {
    it(f + ' → OBJ aynı parçayı verir', () => {
      const ms = load(f);
      const ps = partFromModel(ms, { name: 's' }).part;
      const mo = readObj(toObj(ms));
      const po = partFromModel(mo, { name: 'o' }).part;
      expect(po.length).toBeCloseTo(ps.length, 2);
      expect(po.maxDia).toBeCloseTo(ps.maxDia, 2);
      expect(sig(po)).toBe(sig(ps));
    });
  }
  it('dörtgen ve negatif indeksli yüzler', () => {
    const t = 'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf -4 -3 -2 -1\n';
    const m = readObj(t);
    expect(m.indices.length).toBe(6);
    expect(m.faces.length).toBe(1);
  });
  it('boş OBJ hata verir', () => { expect(() => readObj('# yok')).toThrow(/yüz/); });
});
