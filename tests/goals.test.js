import { test, expect } from 'bun:test';
import { goalProgress, monthsUntil } from '../src/lib/goals.js';

test('還有幾個月（含這個月）', () => {
  expect(monthsUntil('2027-03', '2026-11')).toBe(5);
  expect(monthsUntil('2026-11', '2026-11')).toBe(1);
  expect(monthsUntil('2026-10', '2026-11')).toBe(0);
  expect(monthsUntil(null, '2026-11')).toBeNull();
});

test('連結帳戶看餘額；手動看已存；每月要存多少', () => {
  const bal = { a: 20000, b: 10000 };
  const g = goalProgress({ target: 60000, deadline: '2027-03', accountIds: ['a', 'b'] }, (id) => bal[id], '2026-11');
  expect(g).toMatchObject({ current: 30000, left: 30000, months: 5, perMonth: 6000, done: false, ratio: 0.5 });
  const m = goalProgress({ target: 1000, saved: 1200 }, () => 0, '2026-11');
  expect(m).toMatchObject({ done: true, ratio: 1, left: 0, perMonth: null });
  expect(goalProgress({ target: 1000, saved: 100, deadline: '2026-01' }, () => 0, '2026-11').late).toBe(true);
});
