import { describe, it, expect } from 'vitest';
import { newProject, fitStations } from '../src/project.js';
import { STATIONS, makeTool } from '../src/tools/toolLibrary.js';

describe('takım istasyonları (makine çizimi)', () => {
  it('varsayılan takımlar gerçek istasyonlarda', () => {
    const p = newProject();
    expect(fitStations(p)).toEqual([]);
    for (const t of p.tools.filter(t => t.unit === 'gang')) expect(STATIONS.gang).toContain(t.yPos);
    expect(p.tools.filter(t => t.unit === 'gang').length).toBeLessThanOrEqual(6);
  });
  it('fazla ve kullanılmayan takım çıkarılır, kullanılan korunur', () => {
    const p = newProject();
    const extra = makeTool({ num: 7, name: 'Fazla', type: 'turn', unit: 'gang', yPos: 128 });
    const usedX = makeTool({ num: 8, name: 'Kullanılan', type: 'turn', unit: 'gang', yPos: 146 });
    p.tools.push(extra, usedX);
    p.ops.push({ id: 'x', type: 'rough', toolId: usedX.id, params: {} });
    fitStations(p);
    const gang = p.tools.filter(t => t.unit === 'gang');
    expect(gang.length).toBe(6);
    expect(gang).toContain(usedX);
    expect(STATIONS.gang).toContain(usedX.yPos);
    expect(new Set(gang.map(t => t.yPos)).size).toBe(6);
  });
});

import { profileConflicts } from '../src/post/fanucStar.js';
import postDef from '../src/post/postProfile.json';
describe('post profili kod çakışması', () => {
  it('varsayılan profilde aynı M kodu tek işleve ait', () => { expect(profileConflicts(postDef)).toEqual([]); });
  it('çakışma yakalanır (M29 = arka soğutma kapalı / rijit kılavuz)', () => {
    const p = { codes: { ...postDef.codes, backCoolantOff: 'M29' } };
    expect(profileConflicts(p).map(c => c.code)).toEqual(['M29']);
  });
});
