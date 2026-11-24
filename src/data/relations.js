// 刪除時的連帶關係，跟資料庫的外鍵設定一致：
//   - 「擋住」（restrict）：有交易的帳戶、分類不能刪
//   - 「一起刪」（cascade）：刪轉帳 → 它的手續費；刪固定收支 → 它的待確認項目…
//   - 「清空欄位」（set null）
// 試用模式用它來模擬資料庫；正式模式刪除成功後，用它同步畫面上的資料。

export const TABLES = ['profiles', 'accounts', 'categories', 'transactions', 'templates', 'recurring_rules',
  'pending_items', 'stock_trades', 'dividends', 'manual_prices'];

const refs = (rows, field, ids) => rows.filter((r) => ids.has(r[field]));

/**
 * 算出刪除 table 裡 ids 會影響哪些資料。
 * 回傳 { blocked: 錯誤訊息或 null, remove: { table: Set(id) }, nullify: [{ table, id, field }] }
 */
export function planDelete(tables, table, idList) {
  const remove = {};
  const nullify = [];
  let blocked = null;
  const add = (t, id) => { (remove[t] ??= new Set()).add(id); };

  const queue = [[table, new Set(idList)]];
  while (queue.length) {
    const [t, ids] = queue.shift();
    const fresh = new Set([...ids].filter((id) => !remove[t]?.has(id)));
    if (!fresh.size) continue;
    fresh.forEach((id) => add(t, id));
    const T = (name) => tables[name] ?? [];

    if (t === 'accounts') {
      const sys = T('accounts').find((a) => fresh.has(a.id) && a.system_key);
      if (sys) blocked ??= `「${sys.name}」是系統帳戶，不能刪除`;
      if (T('transactions').some((x) => fresh.has(x.account_id) || fresh.has(x.to_account_id))
        || T('stock_trades').some((x) => fresh.has(x.brokerage_account_id) || fresh.has(x.settlement_account_id))
        || T('dividends').some((x) => fresh.has(x.brokerage_account_id))) {
        blocked ??= '這個帳戶已經有交易，不能刪除，只能隱藏';
      }
      const tpl = T('templates').filter((x) => fresh.has(x.account_id) || fresh.has(x.to_account_id)).map((x) => x.id);
      const rec = T('recurring_rules').filter((x) => fresh.has(x.account_id) || fresh.has(x.to_account_id)).map((x) => x.id);
      if (tpl.length) queue.push(['templates', new Set(tpl)]);
      if (rec.length) queue.push(['recurring_rules', new Set(rec)]);
    } else if (t === 'categories') {
      const sys = T('categories').find((c) => fresh.has(c.id) && c.system_key);
      if (sys) blocked ??= `「${sys.name}」是系統分類，不能刪除`;
      if (T('categories').some((c) => fresh.has(c.parent_id) && !fresh.has(c.id))) blocked ??= '這個分類底下還有子分類，請先刪除或搬走子分類';
      if (refs(T('transactions'), 'category_id', fresh).length) blocked ??= '這個分類已經有交易，不能刪除，只能封存';
      const tpl = refs(T('templates'), 'category_id', fresh).map((x) => x.id);
      const rec = refs(T('recurring_rules'), 'category_id', fresh).map((x) => x.id);
      if (tpl.length) queue.push(['templates', new Set(tpl)]);
      if (rec.length) queue.push(['recurring_rules', new Set(rec)]);
    } else if (t === 'transactions') {
      const kids = refs(T('transactions'), 'parent_id', fresh).map((x) => x.id);
      if (kids.length) queue.push(['transactions', new Set(kids)]);
      const divs = refs(T('dividends'), 'transaction_id', fresh).map((x) => x.id);
      if (divs.length) queue.push(['dividends', new Set(divs)]);
      refs(T('stock_trades'), 'settlement_txn_id', fresh).forEach((x) => nullify.push({ table: 'stock_trades', id: x.id, field: 'settlement_txn_id' }));
      refs(T('stock_trades'), 'pnl_txn_id', fresh).forEach((x) => nullify.push({ table: 'stock_trades', id: x.id, field: 'pnl_txn_id' }));
    } else if (t === 'recurring_rules') {
      const items = refs(T('pending_items'), 'recurring_id', fresh).map((x) => x.id);
      if (items.length) queue.push(['pending_items', new Set(items)]);
    } else if (t === 'pending_items') {
      refs(T('transactions'), 'pending_item_id', fresh).forEach((x) => nullify.push({ table: 'transactions', id: x.id, field: 'pending_item_id' }));
      refs(T('stock_trades'), 'pending_item_id', fresh).forEach((x) => nullify.push({ table: 'stock_trades', id: x.id, field: 'pending_item_id' }));
    }
  }
  return { blocked, remove, nullify };
}

/** 套用刪除計畫，回傳新的 tables（不改原物件） */
export function applyDelete(tables, plan) {
  const next = { ...tables };
  for (const [t, ids] of Object.entries(plan.remove)) {
    next[t] = (next[t] ?? []).filter((r) => !ids.has(r.id));
  }
  for (const { table, id, field } of plan.nullify) {
    next[table] = (next[table] ?? []).map((r) => (r.id === id ? { ...r, [field]: null } : r));
  }
  return next;
}
