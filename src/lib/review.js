// 年度回顧：一年的收支總結，跟前一年比
import { counts, twdOf } from './ledger.js';
import { localDate, monthKey } from './dates.js';

const r2 = (n) => Math.round(n * 100) / 100;
const pct = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

function yearTotals(txns, accById, tree, year, upto = 12) {
  const y = String(year);
  let income = 0; let expense = 0; let exc = 0; let n = 0;
  const days = new Set();
  const months = Array.from({ length: 12 }, (_, i) => ({ month: `${y}-${String(i + 1).padStart(2, '0')}`, income: 0, expense: 0 }));
  const cats = new Map();
  let biggest = null;
  for (const t of txns) {
    if (localDate(t.occurred_at).slice(0, 4) !== y || !counts(t, accById, true)) continue;
    const v = twdOf(t);
    const mi = Number(monthKey(t.occurred_at).slice(5));
    if (mi > upto) continue;
    const m = months[mi - 1];
    n += 1; days.add(localDate(t.occurred_at));
    if (t.type === 'income') { income += v; m.income += v; continue; }
    expense += v; m.expense += v;
    if (t.is_exception) exc += v;
    const root = tree.chain(t.category_id)[0];
    const key = root?.id ?? '__unknown';
    cats.set(key, (cats.get(key) ?? 0) + v);
    if (!biggest || v > biggest.v) biggest = { t, v };
  }
  return { income: r2(income), expense: r2(expense), exc: r2(exc), n, days: days.size, months: months.map((m) => ({ ...m, income: r2(m.income), expense: r2(m.expense) })), cats, biggest };
}

/** nowKey：這個月（YYYY-MM），用來算今年已經過了幾個月 */
export function yearReview({ txns, accById, tree }, year, nowKey) {
  const elapsed = String(year) < nowKey.slice(0, 4) ? 12 : String(year) === nowKey.slice(0, 4) ? Number(nowKey.slice(5)) : 0;
  const cur = yearTotals(txns, accById, tree, year);
  const prev = yearTotals(txns, accById, tree, year - 1, elapsed || 12); // 今年還沒過完：跟去年「同期」比
  const active = cur.months.slice(0, elapsed || 12).filter((m) => m.income || m.expense);
  const byExpense = [...active].sort((a, b) => b.expense - a.expense);
  const top = [...cur.cats].map(([id, total]) => ({
    id, name: tree.byId.get(id)?.name ?? '未分類', total: r2(total),
    last: r2(prev.cats.get(id) ?? 0), change: pct(total, prev.cats.get(id) ?? 0),
  })).sort((a, b) => b.total - a.total);
  const net = r2(cur.income - cur.expense);
  return {
    year, income: cur.income, expense: cur.expense, net,
    savingRate: cur.income > 0 ? Math.round((net / cur.income) * 100) : null,
    exception: cur.exc, normal: r2(cur.expense - cur.exc),
    avgMonthlyNormal: elapsed ? Math.round((cur.expense - cur.exc) / elapsed) : null,
    months: cur.months, elapsed,
    maxMonth: byExpense[0] ?? null, minMonth: byExpense.length > 1 ? byExpense[byExpense.length - 1] : null,
    top, biggest: cur.biggest?.t ?? null, count: cur.n, days: cur.days,
    prev: { income: prev.income, expense: prev.expense, net: r2(prev.income - prev.expense), has: prev.n > 0, partial: elapsed > 0 && elapsed < 12 },
    expenseChange: pct(cur.expense, prev.expense), incomeChange: pct(cur.income, prev.income),
  };
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
/** 備註裡的店家：交易對象優先；秒記帳的「店家：品項」取冒號前；短備註整段算 */
export function placeOf(t) {
  const who = t.counterparty?.trim();
  if (who) return who;
  const note = (t.note ?? '').trim().split('\n')[0];
  if (!note) return null;
  const head = note.split(/[：:]/)[0].trim();
  if (head && head !== note) return head.slice(0, 20);
  return note.length <= 12 ? note : null;
}

/**
 * 年度回顧的細項（只看這一年）：細分類、常記的店家／項目、用什麼付、星期幾、小錢、沒花錢的日子、前五大、收入來源
 * today：今天（YYYY-MM-DD），今年還沒過完時只算到今天
 */
export function yearDetails({ txns, accById, tree }, year, today) {
  const y = String(year);
  const subs = new Map(); const places = new Map(); const pay = new Map(); const incomes = new Map();
  const week = Array.from({ length: 7 }, (_, i) => ({ day: WEEK[i], total: 0, n: 0 }));
  const spendDays = new Set();
  let first = null; let expense = 0; const small = { n: 0, total: 0 }; const list = [];
  const add = (m, k, v, extra) => { const o = m.get(k) ?? { ...extra, total: 0, n: 0 }; o.total += v; o.n += 1; m.set(k, o); };
  for (const t of txns) {
    const d = localDate(t.occurred_at);
    if (d.slice(0, 4) !== y || d > today || !counts(t, accById, true)) continue;
    if (!first || d < first) first = d;
    const v = twdOf(t);
    if (t.type === 'income') { const r = tree.chain(t.category_id)[0]; add(incomes, r?.id ?? '__unknown', v, { name: r?.name ?? '未分類' }); continue; }
    expense += v; spendDays.add(d); list.push({ t, v });
    add(subs, t.category_id ?? '__unknown', v, { name: t.category_id ? tree.path(t.category_id) : '未分類' });
    const p = placeOf(t); if (p) add(places, p, v, { name: p });
    add(pay, t.account_id, v, { name: accById.get(t.account_id)?.name ?? '其他' });
    const w = week[new Date(`${d}T00:00:00`).getDay()]; w.total += v; w.n += 1;
    if (v < 100) { small.n += 1; small.total += v; }
  }
  const end = today < `${y}-12-31` ? today : `${y}-12-31`;
  const tracked = first ? Math.round((new Date(`${end}T00:00:00`) - new Date(`${first}T00:00:00`)) / 864e5) + 1 : 0;
  const sorted = (m, by = 'total', n = 6) => [...m.entries()].map(([id, o]) => ({ id, ...o, total: r2(o.total) }))
    .sort((a, b) => b[by] - a[by] || b.total - a.total).slice(0, n);
  const income = [...incomes.values()].reduce((s, o) => s + o.total, 0);
  return {
    subs: sorted(subs),
    places: sorted(places, 'n').filter((p) => p.n >= 2),
    pay: sorted(pay, 'total', 5).map((p) => ({ ...p, pct: expense ? Math.round((p.total / expense) * 100) : 0 })),
    week: [...week.slice(1), week[0]].map((w) => ({ ...w, total: r2(w.total) })), // 週一開始
    small: { n: small.n, total: r2(small.total), pct: expense ? Math.round((small.total / expense) * 100) : 0 },
    noSpend: Math.max(0, tracked - spendDays.size), tracked,
    // 前五大：同一個分類只留最大的一筆，免得被每月房租洗版
    biggest: list.sort((a, b) => b.v - a.v).filter((x, i, arr) => arr.findIndex((y) => y.t.category_id === x.t.category_id) === i)
      .slice(0, 5).map((x) => ({ t: x.t, v: r2(x.v) })),
    incomes: [...incomes.entries()].map(([id, o]) => ({ id, ...o, total: r2(o.total), pct: income ? Math.round((o.total / income) * 100) : 0 })).sort((a, b) => b.total - a.total),
  };
}
