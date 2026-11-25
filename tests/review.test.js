import { test, expect } from 'bun:test';
import { yearReview } from '../src/lib/review.js';
import { buildTree } from '../src/lib/categories.js';

const tree = buildTree([
  { id: 'food', parent_id: null, kind: 'expense', name: '飲食', sort_order: 0 },
  { id: 'lunch', parent_id: 'food', kind: 'expense', name: '午餐', sort_order: 0 },
  { id: 'jp', parent_id: null, kind: 'expense', name: '日本', sort_order: 1 },
  { id: 'pay', parent_id: null, kind: 'income', name: '薪水', sort_order: 0 },
]);
const accById = new Map([['cash', { id: 'cash' }]]);
const t = (id, d, type, amount, cat, exc = false) => ({ id, occurred_at: `${d}T04:00:00Z`, type, amount, fx_rate: 1, account_id: 'cash', category_id: cat, is_exception: exc });
const txns = [
  t('1', '2026-01-05', 'income', 40000, 'pay'), t('2', '2026-01-06', 'expense', 3000, 'lunch'),
  t('3', '2026-08-16', 'expense', 20000, 'jp', true), t('4', '2026-08-17', 'expense', 1000, 'lunch'),
  t('5', '2025-03-01', 'expense', 2000, 'lunch'), t('6', '2025-03-01', 'income', 30000, 'pay'),
  { id: 'x', occurred_at: '2026-02-01T04:00:00Z', type: 'transfer', amount: 999, fx_rate: 1, account_id: 'cash', to_account_id: 'b' },
];

test('一年的總收支、儲蓄率、例外、分類排行和去年比', () => {
  const r = yearReview({ txns, accById, tree }, 2026, '2026-11');
  expect(r).toMatchObject({ income: 40000, expense: 24000, net: 16000, savingRate: 40, exception: 20000, normal: 4000, elapsed: 11, count: 4, days: 4 });
  expect(r.avgMonthlyNormal).toBe(364);
  expect(r.top.map((c) => [c.name, c.total, c.change])).toEqual([['日本', 20000, null], ['飲食', 4000, 100]]);
  expect(r.maxMonth.month).toBe('2026-08');
  expect(r.minMonth.month).toBe('2026-01');
  expect(r.biggest.id).toBe('3');
  expect(r.expenseChange).toBe(1100);
});

test('今年還沒過完：跟去年同期比（不算去年後面的月份）', () => {
  const r = yearReview({ txns: [...txns, t('7', '2025-12-20', 'expense', 50000, 'lunch')], accById, tree }, 2026, '2026-11');
  expect(r.prev.expense).toBe(2000);
  expect(r.prev.partial).toBe(true);
  expect(yearReview({ txns: [...txns, t('7', '2025-12-20', 'expense', 50000, 'lunch')], accById, tree }, 2025, '2026-11').expense).toBe(52000);
});
