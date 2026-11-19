import { expect, it } from 'vitest';
import { compare, Stock } from '../src/sim/stockSim.js';

it('Verify distinguishes excess, remaining stock, and unmeasured ends', () => {
  const opts = { dMin: 0, dMax: 2, dz: 0.05, nth: 120, R: 5 };
  const target = new Stock(opts);
  const stock = new Stock(opts);
  const row = stock.idx(1);
  const outer = row * stock.nth;
  target.rin.fill(2);
  stock.rin.fill(2);
  stock.r[outer] = 4.9;
  stock.r[outer + 1] = 5.08;
  stock.rin[row] = 2.12;
  const result = compare(stock, target, 2);
  expect([...result.status.slice(outer, outer + 3)]).toEqual([1, 2, 0]);
  expect(result.status[0]).toBe(3);
  expect(result.innerStatus[row]).toBe(1);
  expect(result.innerStatus[0]).toBe(3);
  expect(result.overMax).toBeCloseTo(0.1);
  expect(result.underMax).toBeCloseTo(0.08);
});
