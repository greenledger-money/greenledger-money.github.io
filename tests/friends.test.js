import { test, expect } from 'bun:test';
import { friendBalances, NO_NAME } from '../src/lib/friends.js';

const FO = 'fo';
const x = (id, day, o) => ({ id, occurred_at: `2026-11-${day}T12:00:00Z`, fx_rate: 1, to_fx_rate: 1, ...o });
const lend = (id, day, who, amt) => x(id, day, { type: 'transfer', account_id: 'cash', to_account_id: FO, amount: amt, to_amount: amt, counterparty: who });
const back = (id, day, who, amt) => x(id, day, { type: 'transfer', account_id: FO, to_account_id: 'bank', amount: amt, to_amount: amt, counterparty: who });

test('按人分開算，還清的歸零，沒寫名字另外一組', () => {
  const r = friendBalances([
    lend('1', '01', '小明', 300), lend('2', '02', '小明', 200), back('3', '03', '小明', 500), lend('4', '05', '小明', 120),
    lend('5', '04', '阿華', 1000), back('6', '06', '阿華', 400),
    lend('7', '01', null, 50),
    x('8', '01', { type: 'expense', account_id: 'cash', amount: 99, category_id: 'c' }),
  ], FO);
  expect(r.map((p) => [p.name, p.balance, p.open])).toEqual([['阿華', 600, 1], ['小明', 120, 1], [NO_NAME, 50, 1]]);
  expect(r[1].txns.map((t) => t.id)).toEqual(['4', '3', '2', '1']);
});

test('直接在朋友欠我帳戶記支出（不用還了）也會扣掉', () => {
  const r = friendBalances([lend('1', '01', '小明', 300), x('2', '02', { type: 'expense', account_id: FO, amount: 300, counterparty: '小明' })], FO);
  expect(r[0].balance).toBe(0);
});
