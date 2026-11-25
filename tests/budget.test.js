import { expect, test } from 'bun:test';
import { daysLeft, meter, readBudget, spending } from '../src/lib/budget.js';
import { buildTree } from '../src/lib/categories.js';

const tree = buildTree([
  { id: 'food', parent_id: null, kind: 'expense', name: '飲食' },
  { id: 'lunch', parent_id: 'food', kind: 'expense', name: '午餐' },
  { id: 'fun', parent_id: null, kind: 'expense', name: '娛樂' },
  { id: 'loss', parent_id: null, kind: 'expense', name: '股票虧損', system_key: 'stock_loss' },
]);
const accById = new Map([['a', { id: 'a', hidden: false }], ['h', { id: 'h', hidden: true }]]);
const tx = (o) => ({ type: 'expense', account_id: 'a', fx_rate: 1, is_exception: false, occurred_at: '2026-11-10T04:00:00Z', ...o });

test('預算：一般、例外分開算，分類算到主分類', () => {
  const s = spending({
    txns: [
      tx({ amount: 100, category_id: 'lunch' }),
      tx({ amount: 50, category_id: 'food' }),
      tx({ amount: 300, category_id: 'fun', is_exception: true }),
      tx({ amount: 999, category_id: 'fun', account_id: 'h' }),               // 隱藏帳戶不算
      tx({ amount: 70, category_id: 'fun', occurred_at: '2026-12-01T04:00:00Z' }), // 不在這個月
      tx({ type: 'income', amount: 5000, category_id: null }),
      tx({ amount: 8000, category_id: 'loss' }),                               // 股票虧損不算
    ],
    accById, tree, from: new Date('2026-11-01T00:00:00+08:00'), to: new Date('2026-12-01T00:00:00+08:00'),
  });
  expect(s.normal).toBe(150);
  expect(s.exception).toBe(300);
  expect(s.byRoot.get('food')).toBe(150);
  expect(s.byRoot.get('fun')).toBeUndefined();
});

test('預算：額度狀態與每天可花的天數', () => {
  expect(meter(100, 0)).toBeNull();
  expect(meter(10000, 13500)).toMatchObject({ left: 3500, level: 'ok', over: false });
  expect(meter(11000, 13500).level).toBe('warn');
  expect(meter(14000, 13500)).toMatchObject({ left: -500, level: 'over', over: true });
  expect(daysLeft('2026-11', '2026-11-25')).toBe(6);
  expect(daysLeft('2026-10', '2026-11-25')).toBeNull();
  expect(readBudget({ budget: { total: '13500', exception: 2000, categories: { food: 6000, fun: 0 } } }))
    .toEqual({ total: 13500, exception: 2000, categories: { food: 6000 } });
});
