import { expect, it } from 'vitest';
import { backMillType, faceBoundary, simMillTools } from '../src/ops/simMillSetup.js';

it('keeps boundary edges and drops the triangulation diagonal', () => {
  const mesh = { faces: [{ tri0: 0, tri1: 1 }], indices: [0, 1, 2, 0, 2, 3] };
  expect(faceBoundary(mesh, 0).map(e => e.key).sort()).toEqual(['0:1', '0:3', '1:2', '2:3']);
  expect(faceBoundary(mesh, 1)).toEqual([]);
});

it('filters mounted live endmills by channel and tool unit', () => {
  const tool = { channel: 1, unit: 'cross', type: 'endmill', dia: 4 };
  expect(simMillTools([tool, { ...tool, channel: 2 }, { ...tool, type: 'drill' }], 1)).toEqual([tool]);
  expect(simMillTools([tool], 2)).toEqual([]);
  const live = { channel: 2, unit: 'back', type: 'endmill', dia: 3, live: true };
  expect(simMillTools([tool, live, { ...live, live: false }, { ...live, unit: 'cross' }], 2)).toEqual([live]);
  expect(simMillTools([live], 2, { type: 'faceSlot', side: 'back', width: 4 })).toEqual([]);
  expect(simMillTools([live], 2, { type: 'faceSlot', side: 'back', width: 3 })).toEqual([live]);
});

it('routes only existing rear face feature types to P2 generators', () => {
  expect(backMillType({ type: 'facePolygon', side: 'back' })).toBe('backPolar');
  expect(backMillType({ type: 'faceSlot', side: 'back' })).toBe('backSlot');
  expect(backMillType({ type: 'faceSlot', side: 'front' })).toBeNull();
  expect(backMillType({ type: 'flat', side: 'back' })).toBeNull();
});
