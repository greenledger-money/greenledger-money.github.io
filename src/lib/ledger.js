// 帳本計算：餘額、月收支、分類占比、趨勢、淨資產。
// 原則：餘額不存，每次都從「期初餘額＋所有交易」重算 → 改舊帳會自動修正。

import { round2 } from './money.js';
import { monthKey, monthRange, ymd } from './dates.js';

export const ACCOUNT_TYPES = [
  { value: 'cash', label: '現金' },
  { value: 'bank', label: '銀行' },
  { value: 'credit_card', label: '信用卡' },
  { value: 'e_payment', label: '電子支付/儲值' },
  { value: 'brokerage', label: '證券戶' },
  { value: 'friends_owe', label: '朋友欠我' },
  { value: 'loan', label: '借貸' },
  { value: 'other', label: '其他' },
];
/** 照使用者排的順序排帳戶類別（沒排到的照預設順序接在後面） */
export function orderedTypes(order) {
  const pos = new Map((Array.isArray(order) ? order : []).map((v, i) => [v, i]));
  return ACCOUNT_TYPES.map((t, i) => ({ t, k: pos.has(t.value) ? pos.get(t.value) : 100 + i })).sort((a, b) => a.k - b.k).map((x) => x.t);
}
export const accountTypeLabel = (v) => ACCOUNT_TYPES.find((t) => t.value === v)?.label ?? v;
export const TXN_LABEL = { expense: '支出', income: '收入', transfer: '轉帳' };

export const uid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  }));

/** 一筆交易對各帳戶的影響（帳戶幣別） */
export function effects(t) {
  if (t.type === 'transfer') return [[t.account_id, -Number(t.amount)], [t.to_account_id, Number(t.to_amount)]];
  if (t.type === 'expense') return [[t.account_id, -Number(t.amount)]];
  return [[t.account_id, Number(t.amount)]];
}

/** 每個帳戶的目前餘額（不含未來日期的交易，例如還沒到交割日的股票款） */
export function computeBalances(accounts, txns, asOf = Date.now()) {
  const bal = new Map(accounts.map((a) => [a.id, Number(a.opening_balance) || 0]));
  for (const t of txns) {
    if (asOf != null && Date.parse(t.occurred_at) > asOf) continue;
    for (const [id, d] of effects(t)) if (bal.has(id)) bal.set(id, bal.get(id) + d);
  }
  for (const [k, v] of bal) bal.set(k, round2(v));
  return bal;
}

/** 換成台幣 */
export const twdOf = (t) => Number(t.amount) * Number(t.fx_rate || 1);

/** 這筆要不要算進收支報表：轉帳不算、可選擇排除「例外」。隱藏帳戶的收支照算（隱藏只是不顯示在列表） */
/** includeExceptions：true 含例外、false 不含、'only' 只看例外 */
export function counts(t, accById, includeExceptions = true) {
  if (t.type === 'transfer') return false;
  const a = accById.get(t.account_id);
  if (!a) return false;
  if (!includeExceptions && t.is_exception) return false;
  if (includeExceptions === 'only' && !t.is_exception) return false;
  return true;
}

const inRange = (t, from, to) => {
  const ms = Date.parse(t.occurred_at);
  return ms >= from.getTime() && ms < to.getTime();
};

export function summarize(txns, accById, { from, to, includeExceptions = true }) {
  let income = 0; let expense = 0;
  for (const t of txns) {
    if (!inRange(t, from, to) || !counts(t, accById, includeExceptions)) continue;
    if (t.type === 'income') income += twdOf(t); else expense += twdOf(t);
  }
  return { income: round2(income), expense: round2(expense), net: round2(income - expense) };
}

/**
 * 分類占比。parentId = null 看第一層；傳某個分類 id 就看它的下一層（點圓餅圖往下鑽）。
 * 直接記在上層（沒選到子分類）的金額，會顯示成「○○（未細分）」。
 */
export function categoryBreakdown({ txns, tree, accById, kind, from, to, includeExceptions = true, parentId = null }) {
  const totals = new Map();
  for (const t of txns) {
    if (t.type !== kind || !inRange(t, from, to) || !counts(t, accById, includeExceptions)) continue;
    const chain = tree.chain(t.category_id);
    let bucket;
    if (!parentId) bucket = chain[0]?.id ?? '__unknown';
    else {
      const i = chain.findIndex((n) => n.id === parentId);
      if (i < 0) continue;
      bucket = chain[i + 1]?.id ?? '__self';
    }
    totals.set(bucket, (totals.get(bucket) || 0) + twdOf(t));
  }
  const rows = [...totals].map(([id, total]) => {
    const node = tree.byId.get(id);
    let name = node?.name ?? '未分類';
    if (id === '__self') name = `${tree.byId.get(parentId)?.name ?? ''}（未細分）`;
    return { id, name, total: round2(total), drillable: !!node && node.children.length > 0 };
  });
  rows.sort((a, b) => b.total - a.total);
  return rows;
}

/** 每月收支（台幣） */
export function monthlyTrend(txns, accById, monthKeys, includeExceptions = true) {
  const map = new Map(monthKeys.map((k) => [k, { month: k, income: 0, expense: 0 }]));
  for (const t of txns) {
    if (!counts(t, accById, includeExceptions)) continue;
    const m = map.get(monthKey(t.occurred_at));
    if (m) m[t.type] += twdOf(t);
  }
  return [...map.values()].map((m) => ({
    month: m.month, income: round2(m.income), expense: round2(m.expense), net: round2(m.income - m.expense),
  }));
}

/**
 * 淨資產：未隱藏帳戶的餘額換成台幣；證券戶用股票市值取代帳上餘額。
 * stockValue: Map(證券戶 id → { twd, native })
 */
export function netWorth({ accounts, balances, fx, stockValue }) {
  let total = 0;
  const missingRate = [];
  const rows = [];
  for (const a of accounts) {
    if (a.hidden) continue;
    let native; let twd;
    if (a.type === 'brokerage') {
      const sv = stockValue?.get(a.id);
      native = sv?.native ?? 0;
      twd = sv?.twd ?? 0;
    } else {
      native = balances.get(a.id) ?? 0;
      const rate = fx.latest(a.currency);
      if (rate == null) { missingRate.push(a); twd = 0; } else twd = native * rate;
    }
    total += twd;
    rows.push({ account: a, native: round2(native), twd: round2(twd) });
  }
  return { total: round2(total), rows, missingRate };
}

/** 每月月底的淨資產（最多到今天） */
export function netWorthSeries({ accounts, txns, monthKeys, fx, stockValueAt, now = new Date() }) {
  const visible = accounts.filter((a) => !a.hidden);
  const bal = new Map(accounts.map((a) => [a.id, Number(a.opening_balance) || 0]));
  const sorted = [...txns].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  let p = 0;
  const out = [];
  for (const key of monthKeys) {
    const end = Math.min(monthRange(key).to.getTime() - 1, now.getTime());
    while (p < sorted.length && Date.parse(sorted[p].occurred_at) <= end) {
      for (const [id, d] of effects(sorted[p])) if (bal.has(id)) bal.set(id, bal.get(id) + d);
      p++;
    }
    const endDay = ymd(new Date(end));
    const stock = stockValueAt ? stockValueAt(endDay) : new Map();
    let total = 0;
    for (const a of visible) {
      if (a.type === 'brokerage') { total += stock.get(a.id)?.twd ?? 0; continue; }
      const rate = fx.rateOn(a.currency, endDay) ?? fx.latest(a.currency) ?? 0;
      total += bal.get(a.id) * rate;
    }
    out.push({ month: key, total: round2(total) });
  }
  return out;
}

// ---------------------------------------------------------------------
// 產生交易的小工具（記帳表單、範本、待確認清單、匯入都會用到）
// ---------------------------------------------------------------------

/**
 * 分帳：總額裡「自己的部分」記支出，其餘轉進「朋友欠我」。
 * 帳戶是外幣時，朋友欠我（台幣）收到的金額用匯率換算。
 */
export function buildSplit({ accountId, total, mine, categoryId, occurredAt, note = '', friendsOweId, fxRate = 1, isException = false, counterparty = null }) {
  const others = round2(Number(total) - Number(mine));
  if (!(Number(total) > 0)) throw new Error('請輸入總額');
  if (Number(mine) < 0 || others < 0) throw new Error('自己的部分不能大於總額');
  const group = uid();
  const rows = [];
  if (Number(mine) > 0) {
    rows.push({
      id: uid(), type: 'expense', occurred_at: occurredAt, account_id: accountId, amount: round2(Number(mine)),
      fx_rate: fxRate, category_id: categoryId, note, is_exception: isException, group_id: group, source: 'split',
    });
  }
  if (others > 0) {
    rows.push({
      id: uid(), type: 'transfer', occurred_at: occurredAt, account_id: accountId, amount: others, fx_rate: fxRate,
      to_account_id: friendsOweId, to_amount: round2(others * fxRate), to_fx_rate: 1,
      note: note ? `${note}（幫朋友付）` : '幫朋友付', is_exception: false, group_id: group, source: 'split', counterparty: counterparty || null,
    });
  }
  return rows;
}

/** 轉帳手續費：拆出一筆「其他支出-手續費」，parent_id 指向轉帳 */
export function buildFee({ transfer, fee, feeCategoryId }) {
  if (!(Number(fee) > 0)) return null;
  return {
    id: uid(), type: 'expense', occurred_at: transfer.occurred_at, account_id: transfer.account_id,
    amount: round2(Number(fee)), fx_rate: transfer.fx_rate ?? 1, category_id: feeCategoryId,
    note: '轉帳手續費', is_exception: false, parent_id: transfer.id, source: transfer.source ?? 'manual',
  };
}
