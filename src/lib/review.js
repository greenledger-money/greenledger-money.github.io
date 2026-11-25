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
