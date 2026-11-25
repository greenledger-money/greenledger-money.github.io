import { test, expect } from 'bun:test';
import { netWorthSeries } from '../src/lib/ledger.js';

// 只記了今天（11 月）的期初持股：之前的月份證券戶用轉進去的錢（成本）算，不會像錢不見
const accounts = [
  { id: 'bank', type: 'bank', currency: 'TWD', opening_balance: 100000, hidden: false },
  { id: 'brk', type: 'brokerage', currency: 'TWD', opening_balance: 0, hidden: false },
];
const txns = [{ id: 't', type: 'transfer', occurred_at: '2026-03-10T04:00:00Z', account_id: 'bank', amount: 60000, fx_rate: 1, to_account_id: 'brk', to_amount: 60000, to_fx_rate: 1 }];
const fx = { rateOn: () => 1, latest: () => 1 };
const stockValueAt = (d) => new Map(d >= '2026-11-25' ? [['brk', { twd: 75000 }]] : []);
const base = { accounts, txns, monthKeys: ['2026-02', '2026-04', '2026-11'], fx, stockValueAt, now: new Date('2026-11-26T00:00:00Z') };

test('含股票：第一筆股票紀錄之前用成本，之後用市值', () => {
  const s = netWorthSeries({ ...base, stockStart: new Map([['brk', '2026-11-25']]) });
  expect(s.map((x) => x.total)).toEqual([100000, 100000, 115000]);
});

test('不含股票：轉進證券戶的錢不算', () => {
  const s = netWorthSeries({ ...base, includeStocks: false, stockStart: new Map([['brk', '2026-11-25']]) });
  expect(s.map((x) => x.total)).toEqual([100000, 40000, 40000]);
});
