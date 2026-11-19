import { describe, expect, it } from 'vitest';
import { acceptAdvice, summarizeFaces } from '../src/ops/analysisAdvice.js';

describe('CAM analiz yardımcısı', () => {
  it('kaba önerisini mevcut değerler ve desteklenen alanlarla sınırlar', () => {
    expect(acceptAdvice('rough', { ap: 1, feed: 0.1, vc: 100 }, {
      settings: { ap: 0.5, feed: 0.2, vc: -1, strategy: 'profile', allowX: 0, X: 10 },
      notes: ['Test notu', 3],
    })).toEqual({ settings: { ap: 0.5, strategy: 'profile' }, notes: ['Test notu'] });
  });
  it('finişte strateji ve paso yazmaz', () => {
    expect(acceptAdvice('finish', { ap: 1, feed: 0.1 }, {
      settings: { ap: 0.5, feed: 0.08, strategy: 'face' },
    }).settings).toEqual({ feed: 0.08 });
  });
  it('seçili STEP yüzünü parça çerçevesinde özetler', () => {
    const part = {
      fixture: { O: [0, 0, 0], A: [1, 0, 0], ea: [0, 1, 0], eb: [0, 0, 1], dFront: 2 },
      mesh: { faces: [{ tri0: 0, tri1: 0 }], indices: [0, 1, 2], positions: new Float32Array([2, 1, 0, 7, 2, 0, 3, 1, 4]) },
    };
    expect(summarizeFaces(part, [0, 9])).toEqual([{ id: 0, triangles: 1, sampled: false, min: [0, 1, 0], max: [5, 2, 4] }]);
  });
});
