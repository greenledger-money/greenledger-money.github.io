// 離線記帳：沒網路時，記帳／修改／刪除先排進「待上傳」，畫面照樣更新；有網路後依序上傳。
// 只有交易（transactions）可以離線改；帳戶、分類等設定還是要有網路。

import { applyDelete, planDelete } from './relations.js';

export const OFFLINE_TABLES = new Set(['transactions']);
const key = (uid) => `ledger.outbox.${uid}`;

export const isNetworkError = (e) => /fetch|network|Load failed|offline|timed? ?out|Failed to fetch/i.test(String(e?.message ?? e))
  || (typeof navigator !== 'undefined' && navigator.onLine === false);

export function readOutbox(uid) {
  try { return JSON.parse(localStorage.getItem(key(uid)) || '[]'); } catch { return []; }
}
export function writeOutbox(uid, ops) {
  try {
    if (ops.length) localStorage.setItem(key(uid), JSON.stringify(ops)); else localStorage.removeItem(key(uid));
  } catch { /* 存不下就算了：至少這次開著的時候還在 */ }
}

const mergeById = (list, rows) => {
  const map = new Map(list.map((r) => [r.id, r]));
  rows.forEach((r) => map.set(r.id, { ...map.get(r.id), ...r }));
  return [...map.values()];
};

/** 先在畫面上的資料套用一個待上傳的動作 */
export function applyOp(tables, op) {
  const list = tables[op.table] ?? [];
  if (op.op === 'insert') return { ...tables, [op.table]: mergeById(list, op.rows) };
  if (op.op === 'update') {
    if (!list.some((r) => r.id === op.id)) return tables;
    return { ...tables, [op.table]: list.map((r) => (r.id === op.id ? { ...r, ...op.patch } : r)) };
  }
  if (op.op === 'remove') {
    const plan = planDelete(tables, op.table, op.ids.filter((id) => list.some((r) => r.id === id)));
    return applyDelete(tables, plan);
  }
  return tables;
}

export const applyOps = (tables, ops) => ops.reduce(applyOp, tables);

/** 離線新增的資料：補上資料庫平常會填的欄位，畫面才顯示得正常 */
export function stampRows(rows, uid) {
  const now = new Date().toISOString();
  return rows.map((r) => ({
    parent_id: null, group_id: null, pending_item_id: null, counterparty: null, source: 'manual', is_exception: false,
    note: '', to_account_id: null, to_amount: null, to_fx_rate: null, category_id: null,
    ...r, user_id: uid, created_at: now, updated_at: now,
  }));
}

/**
 * 依序上傳。回傳 { remaining: 還沒傳的, failed: [{ op, error }] 資料有問題、放棄的 }
 * 網路斷掉就停下來，剩下的下次再傳；同一筆重傳不會重複（新增用 id 判斷）
 */
export async function flushOps(backend, ops) {
  const failed = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    try {
      if (op.op === 'insert') await backend.insert(op.table, op.rows, { onConflict: 'id', ignoreDuplicates: true });
      else if (op.op === 'update') await backend.update(op.table, op.id, op.patch);
      else if (op.op === 'remove') await backend.remove(op.table, op.ids);
    } catch (e) {
      if (isNetworkError(e)) return { remaining: ops.slice(i), failed };
      failed.push({ op, error: e });
    }
  }
  return { remaining: [], failed };
}
