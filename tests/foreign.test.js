import { test, expect } from 'bun:test';
import { costRate, foreignFeeOf, foreignToTwd } from '../src/lib/ledger.js';

const jpy = { id: 'jpy', currency: 'JPY', type: 'cash' };
const at = (d) => `${d}T03:00:00Z`;
const xfer = (id, d, twd, yen) => ({ id, type: 'transfer', occurred_at: at(d), account_id: 'bank', amount: twd, fx_rate: 1, to_account_id: 'jpy', to_amount: yen, to_fx_rate: 0.2 });
const spend = (id, d, yen) => ({ id, type: 'expense', occurred_at: at(d), account_id: 'jpy', amount: yen, fx_rate: 0.2 });

test('換匯成本：花掉的日幣用當初換的匯率（移動平均）', () => {
  const txns = [xfer('a', '2026-08-01', 10000, 47000), spend('s1', '2026-08-16', 20000), xfer('b', '2026-08-17', 5000, 22000)];
  expect(costRate(txns, jpy, '2026-08-16')).toBeCloseTo(10000 / 47000, 8);
  // 剩 27000 日幣（成本 10000×27/47）＋新換 22000 日幣（5000 元）
  const expected = (10000 * 27000 / 47000 + 5000) / 49000;
  expect(costRate(txns, jpy, '2026-08-20')).toBeCloseTo(expected, 8);
  expect(costRate(txns, jpy, '2026-07-01')).toBeNull();
  expect(costRate(txns, { id: 'twd', currency: 'TWD' }, '2026-08-20')).toBe(1);
});

test('改舊的那筆時不把自己算進去', () => {
  const txns = [xfer('a', '2026-08-01', 10000, 50000), spend('s1', '2026-08-02', 50000)];
  expect(costRate(txns, jpy, '2026-08-02')).toBeNull();
  expect(costRate(txns, jpy, '2026-08-02', 's1')).toBeCloseTo(0.2, 8);
});

test('刷卡外幣：匯率 × (1 + 海外手續費)，信用卡預設 1.5%', () => {
  expect(foreignFeeOf({ type: 'credit_card' })).toBe(1.5);
  expect(foreignFeeOf({ type: 'credit_card', foreign_fee_pct: 0 })).toBe(0);
  expect(foreignFeeOf({ type: 'cash' })).toBe(0);
  expect(foreignToTwd(3280, 0.2148, 1.5)).toBe(715);
  expect(foreignToTwd(0, 0.2, 1.5)).toBeNull();
});
