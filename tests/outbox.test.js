import { test, expect } from 'bun:test';
import { applyOps, flushOps, stampRows } from '../src/data/outbox.js';

const base = () => ({
  transactions: [{ id: 't1', type: 'expense', amount: 10, parent_id: null }, { id: 'fee', type: 'expense', amount: 1, parent_id: 't1' }],
  dividends: [], stock_trades: [],
});

test('離線動作先套用在畫面資料上：新增、修改、刪除（含手續費一起刪）', () => {
  const rows = stampRows([{ id: 'n1', type: 'expense', amount: 50 }], 'u1');
  let t = applyOps(base(), [{ op: 'insert', table: 'transactions', rows }]);
  expect(t.transactions.find((x) => x.id === 'n1').user_id).toBe('u1');
  t = applyOps(t, [{ op: 'update', table: 'transactions', id: 'n1', patch: { amount: 60 } }]);
  expect(t.transactions.find((x) => x.id === 'n1').amount).toBe(60);
  t = applyOps(t, [{ op: 'remove', table: 'transactions', ids: ['t1'] }]);
  expect(t.transactions.map((x) => x.id)).toEqual(['n1']);
});

test('上傳：網路斷了就停，剩下的保留；資料錯誤的跳過', async () => {
  const calls = [];
  let online = true;
  const backend = {
    insert: async (table, rows, opts) => { if (!online) throw new Error('Failed to fetch'); calls.push(['insert', rows[0].id, opts]); return rows; },
    update: async (table, id) => { if (id === 'bad') throw new Error('違反規則'); calls.push(['update', id]); return {}; },
    remove: async () => { online = false; throw new Error('Failed to fetch'); },
  };
  const ops = [
    { op: 'insert', table: 'transactions', rows: [{ id: 'a' }] },
    { op: 'update', table: 'transactions', id: 'bad', patch: {} },
    { op: 'update', table: 'transactions', id: 'a', patch: {} },
    { op: 'remove', table: 'transactions', ids: ['a'] },
    { op: 'insert', table: 'transactions', rows: [{ id: 'b' }] },
  ];
  const r = await flushOps(backend, ops);
  expect(calls).toEqual([['insert', 'a', { onConflict: 'id', ignoreDuplicates: true }], ['update', 'a']]);
  expect(r.failed.length).toBe(1);
  expect(r.remaining.map((o) => o.op)).toEqual(['remove', 'insert']);
});
