import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { createRequire } from 'module';
import { readStep } from '../src/cad/stepImport.js';
import { partFromModel } from '../src/cad/featureRecog.js';
import { profileR } from '../src/sim/stockSim.js';

const require = createRequire(import.meta.url);
let occt;
beforeAll(async () => { occt = await require('occt-import-js')(); }, 60000);
const load = (f) => readStep(occt, new Uint8Array(fs.readFileSync('tests/fixtures/' + f)));

describe('STEP içe aktarma ve özellik tanıma', () => {
  it('X eksenli pim: eksen hizalanır, profil doğru', () => {
    const { part } = partFromModel(load('pim_x_ekseni.step'));
    expect(part.length).toBeCloseTo(30, 2);
    // ön (pahlı uç) hangi tarafta olursa olsun çaplar: Ø6 x10 ve Ø10 x20
    const r1 = profileR(part.profile, 5), r2 = profileR(part.profile, 25);
    expect([r1, r2].sort()).toEqual([expect.closeTo(3, 2), expect.closeTo(5, 2)].sort());
  });
  it('kanallı mil: çaplar, kanal ve ön delik', () => {
    const { part } = partFromModel(load('kanalli_mil.step'));
    expect(part.length).toBeCloseTo(40, 2);
    const flip = profileR(part.profile, 5) > 6; // ön taraf Ø10 olmalı
    const at = (d) => profileR(part.profile, flip ? 40 - d : d);
    expect(at(6)).toBeCloseTo(5, 2);
    expect(at(16)).toBeCloseTo(8, 2);
    expect(at(21.5)).toBeCloseTo(6, 2);
    expect(at(30)).toBeCloseTo(8, 2);
    const h = part.features.find(f => f.type === 'axialHole');
    expect(h).toBeTruthy();
    expect(h.dia).toBeCloseTo(4, 2);
    expect(h.depth).toBeCloseTo(8, 2);
  });
  it('çapraz delikli burç: boydan delik, çapraz delik, düzlük', () => {
    const { part } = partFromModel(load('capraz_delikli_burc.step'));
    console.log(JSON.stringify(part.features));
    expect(part.length).toBeCloseTo(25, 2);
    const ch = part.features.find(f => f.type === 'crossHole');
    expect(ch).toBeTruthy();
    expect(ch.dia).toBeCloseTo(5, 2);
    expect(ch.through).toBe(true);
    const fl = part.features.find(f => f.type === 'flat');
    expect(fl).toBeTruthy();
    expect(fl.depth).toBeCloseTo(2, 2);
    const ax = part.features.filter(f => f.type === 'axialHole');
    expect(ax.length).toBeGreaterThan(0);
    expect(ax[0].dia).toBeCloseTo(8, 2);
  });
});
