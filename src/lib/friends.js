// 朋友欠款：把「朋友欠我」帳戶的進出按對象（counterparty）分開算

export const NO_NAME = '沒寫名字';

/** 這筆對「朋友欠我」的影響（台幣）：借出去 +、收回來 − */
export function friendDelta(t, foId) {
  if (t.type === 'transfer') {
    if (t.to_account_id === foId) return Number(t.to_amount) * Number(t.to_fx_rate || 1);
    if (t.account_id === foId) return -Number(t.amount) * Number(t.fx_rate || 1);
    return 0;
  }
  if (t.account_id !== foId) return 0;
  return (t.type === 'income' ? 1 : -1) * Number(t.amount) * Number(t.fx_rate || 1);
}

/**
 * 每個人的欠款。回傳 [{ name, balance, open（上次還清後借了幾筆）, last（最近一筆日期）, txns（新到舊）}]
 * 欠最多的排前面
 */
export function friendBalances(txns, foId) {
  const map = new Map();
  for (const t of txns) {
    const d = friendDelta(t, foId);
    if (!d) continue;
    const name = t.counterparty?.trim() || NO_NAME;
    if (!map.has(name)) map.set(name, []);
    map.get(name).push({ t, d });
  }
  const out = [];
  for (const [name, list] of map) {
    list.sort((a, b) => Date.parse(a.t.occurred_at) - Date.parse(b.t.occurred_at));
    let bal = 0; let open = 0;
    for (const { d } of list) {
      bal = Math.round((bal + d) * 100) / 100;
      if (d > 0) open += 1;
      if (bal <= 0.005) open = 0;
    }
    out.push({ name, balance: bal, open, last: list[list.length - 1].t.occurred_at, txns: list.map((x) => x.t).reverse() });
  }
  return out.sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
}
