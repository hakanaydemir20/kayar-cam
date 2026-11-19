import { describe, expect, it } from 'vitest';
import { planBack } from '../src/ops/backPlan.js';
import { newProject } from '../src/project.js';
import { makeOp } from '../src/ops/program.js';

function fixture() {
  const p = newProject();
  p.part.features = [{ id: 'rear', type: 'axialHole', side: 'back', dia: 4, depth: 2 }];
  p.ops = [makeOp('pickoff'), makeOp('cutoff', p.tools.find(t => t.type === 'cutoff').id), makeOp('eject')];
  return p;
}

describe('karşı mil planı', () => {
  it('arka deliği bir kez ekler ve bırakmanın önünde tutar', () => {
    const p = fixture();
    const plan = planBack(p, 'rough');
    expect(plan.ops.map(o => o.type)).toEqual(['backDrill']);
    p.ops.splice(plan.index, 0, ...plan.ops);
    expect(p.ops.map(o => o.type)).toEqual(['pickoff', 'cutoff', 'backDrill', 'eject']);
    expect(planBack(p, 'rough').ops).toEqual([]);
  });
  it('transfer olmadan işlem önermez', () => {
    const p = fixture();
    p.ops.shift();
    expect(planBack(p, 'rough').ops).toEqual([]);
  });
  it('arka finiş için kesme payı ve takılı takım ister', () => {
    const p = fixture();
    expect(planBack(p, 'finish').ops).toEqual([]);
    p.ops[1].params.backStock = 0.5;
    const turn = { id: 'rear-turn', type: 'turn', unit: 'back', channel: 2 };
    p.tools = p.tools.filter(t => t.channel !== 2 || t.type !== 'turn');
    expect(planBack(p, 'finish').ops).toEqual([]);
    p.tools.push(turn);
    const result = planBack(p, 'finish');
    expect(result.ops.map(o => [o.type, o.toolId, o.params.faceOnly])).toEqual([['backTurn', turn.id, true]]);
  });
});
