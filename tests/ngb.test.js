// Burçsuz (N.G.B.) çalışma: kısa parça hatasız ve çarpışmasız; uzun parça açıklayıcı hata; pens somunu çarpışma kontrolünde
import { describe, it, expect } from 'vitest';
import { newProject, runPipeline } from '../src/project.js';
import { StockSim, buildTarget, compare } from '../src/sim/stockSim.js';
import { makePart, profileFromTable } from '../src/part/part.js';
import { Collider, moved, intersects } from '../src/sim/collision.js';
import { mainColletFace, NGB_GAP, toolBodies } from '../src/sim/bodies.js';

const part = (L) => { const rows = [{ dia: 8, len: L / 2, ch: 0.3 }, { dia: 12, len: L / 2, ch: 0.3 }]; return makePart({ name: 'NGB', profile: profileFromTable(rows), rows, features: [] }); };

describe('burçsuz çalışma', () => {
  it('kısa parça: hatasız, çarpışmasız, fazla kesimsiz', () => {
    const P = newProject(part(24)); P.machine.guideBush = false;
    const r = runPipeline(P);
    expect(r.errors).toEqual([]);
    const ss = new StockSim(P, r.sim).runAll();
    expect(ss.collisions).toEqual([]);
    expect(compare(ss.resultStock(), buildTarget(P, ss.opts), P.part.length).over).toBe(0);
  });
  it('çap × 2.5 sınırını aşan parça: hata', () => {
    const P = newProject(part(40)); P.machine.guideBush = false;   // Ø14 çubuk → en çok 35 mm
    expect(runPipeline(P).errors.some(e => /Burçsuz çalışmada parça boyu/.test(e.msg))).toBe(true);
  });
  it('pens somunu çarpışma kontrolünde: kesme sırasında pens alnı kesme düzleminin gerisinde, kesme kateri somuna değer', () => {
    const P = newProject(part(24)); P.machine.guideBush = false;
    const c = new Collider(P, { L: 24 });
    expect(c.bush).toEqual([]);
    expect(c.nose.map(b => b.name)).toEqual(['Ana iş mili pens somunu', 'Ana iş mili burnu']);
    // kesme anında (parça ön alnı x = L + kesme) pens alnı kesme düzleminden NGB_GAP geride
    expect(mainColletFace(24 + 2, 24, 0, 2)).toBe(-NGB_GAP);
    // kesme kateri gövdesi somunun içine kaydırılırsa kesişir
    const blade = toolBodies(P.tools.find(t => t.type === 'cutoff')).find(b => b.cut);
    const nut = moved(c.nose[0], -NGB_GAP, 0, 0);
    expect(intersects(moved(blade, -NGB_GAP - 5, 0, -(blade.b[4] + blade.b[5]) / 2), nut, 0)).toBe(true);
    expect(intersects(moved(blade, 0, 0, -(blade.b[4] + blade.b[5]) / 2), nut, 0)).toBe(false);   // kesme düzleminde: değmez
  });
});

describe('eski proje yerleşimi', () => {
  it('yerleşim 1 projesi yüklenince takımlar istasyonlara taşınır, program hatasız ve çarpışmasız', async () => {
    const { saveProject, loadProject } = await import('../src/project.js');
    const P = newProject();
    // eski yerleşim: arka takımlar −40…60, çapraz −20…−68, ön kovan tornalama sırasının altında, X2 −180…20
    P.layout = undefined;
    P.tools.filter(t => t.unit === 'back').forEach((t, i) => { t.yPos = -40 + 20 * i; });
    P.tools.filter(t => t.unit === 'front').forEach((t, i) => { t.yPos = 38 + 20 * i; t.xPos = -52; });
    Object.assign(P.machine.axes.X2, { min: -180, max: 20 });
    const Q = loadProject(saveProject(P));
    expect(Q.layout).toBe(2);
    expect(Q.machine.axes.X2.max).toBe(185);
    const r = runPipeline(Q);
    expect(r.errors).toEqual([]);
    expect(new StockSim(Q, r.sim).runAll().collisions).toEqual([]);
  });
});
