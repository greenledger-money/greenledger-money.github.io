import { expect, test } from 'bun:test';
import { createSupabaseBackend } from '../src/data/supabase.js';
import { TABLES } from '../src/data/relations.js';

// 假的 supabase-js：transactions 有 2,345 筆，其他表各 3 筆；記錄每次 range 請求
function fakeClient(log) {
  const sizes = Object.fromEntries(TABLES.map((t) => [t, t === 'transactions' ? 2345 : 3]));
  return () => ({
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    from(table) {
      const st = { count: false };
      const q = {
        select(_c, opts) { st.count = opts?.count === 'exact'; return q; },
        order() { return q; },
        in() { return q; }, gte() { return q; },
        async range(from, to) {
          log.push([table, from, st.count]);
          await new Promise((r) => setTimeout(r, 5));
          const n = sizes[table] ?? 0;
          const data = Array.from({ length: Math.max(0, Math.min(to, n - 1) - from + 1) }, (_, i) => ({ id: `${table}-${from + i}` }));
          return { data, error: null, count: st.count ? n : null };
        },
      };
      return q;
    },
  });
}

test('讀整張表：第一頁拿總數，其餘頁同時抓，筆數完整不重複', async () => {
  const log = [];
  const be = await createSupabaseBackend({ url: 'https://x.supabase.co', key: 'k', createClient: fakeClient(log) });
  const all = await be.loadAll();
  expect(all.transactions.length).toBe(2345);
  expect(new Set(all.transactions.map((r) => r.id)).size).toBe(2345);
  const tx = log.filter((l) => l[0] === 'transactions');
  expect(tx.map((l) => l[1])).toEqual([0, 1000, 2000]);
  expect(tx[0][2]).toBe(true); // 只有第一頁要總數
  expect(all.accounts.length).toBe(3);
});
