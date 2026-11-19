import { expect, it } from 'vitest';
import { splitChannelLines, joinChannelTexts, lineMap } from '../src/ui/gcodeEditor.js';

it('lists P1 and P2 blocks with the original editor line numbers', () => {
  const [p1, p2] = splitChannelLines('%\r\n$1\r\nG0 X10.\r\nM200\r\n$2\r\nM200\r\nG0 Z20.\r\n%');
  expect(p1.map(row => row.index)).toEqual([2, 3]);
  expect(p2.map(row => [row.index, row.line])).toEqual([[5, 'M200'], [6, 'G0 Z20.']]);
  expect(splitChannelLines('$2\nM30')[0]).toEqual([]);
});

it('joins separately typed P1/P2 texts and round-trips through the channel split', () => {
  const t = joinChannelTexts('G0X10.\nM200\n%', 'M200\n$1\nG0Z5.');
  expect(t).toBe('%\n$1\nG0X10.\nM200\n$2\nM200\nG0Z5.\n%');
  const [p1, p2] = splitChannelLines(t);
  expect(p1.map(r => r.line).join('\n')).toBe('G0X10.\nM200');
  expect(p2.map(r => r.line).join('\n')).toBe('M200\nG0Z5.');
  // kanal satırı → simülasyon (kanal, satır) eşlemesi
  const m = lineMap(t);
  expect(m.fwd[p2[1].index]).toMatchObject({ pi: 1 });
});
