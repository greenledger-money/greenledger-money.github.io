// 預算：一般支出每月一個額度、例外一年一個額度，主分類可以另外設（只算一般支出）；股票虧損不算
import { counts, twdOf } from './ledger.js';
import { parseYmd } from './dates.js';

/** 這段期間的支出：一般、例外、各主分類（一般） */
export function spending({ txns, accById, tree, from, to }) {
  const lo = from.getTime(); const hi = to.getTime();
  let normal = 0; let exception = 0;
  const byRoot = new Map();
  for (const t of txns) {
    if (t.type !== 'expense' || !counts(t, accById, true)) continue;
    const ms = Date.parse(t.occurred_at);
    if (ms < lo || ms >= hi) continue;
    const chain = t.category_id ? tree.chain(t.category_id) : [];
    if (chain.some((c) => c.system_key === 'stock_loss')) continue; // 股票虧損是投資，不算生活花費
    const v = twdOf(t);
    if (t.is_exception) { exception += v; continue; }
    normal += v;
    const root = chain[0]?.id ?? null;
    if (root) byRoot.set(root, (byRoot.get(root) ?? 0) + v);
  }
  const r = (x) => Math.round(x * 100) / 100;
  return { normal: r(normal), exception: r(exception), byRoot: new Map([...byRoot].map(([k, v]) => [k, r(v)])) };
}

/** 一個額度的狀態；沒設額度回傳 null */
export function meter(spent, limit) {
  const l = Number(limit);
  if (!(l > 0)) return null;
  const left = Math.round((l - spent) * 100) / 100;
  return { spent, limit: l, left, ratio: spent / l, over: left < 0, level: spent >= l ? 'over' : spent >= l * 0.8 ? 'warn' : 'ok' };
}

/** 這個月還剩幾天（含今天）；不是這個月就回傳 null */
export function daysLeft(month, today) {
  if (today.slice(0, 7) !== month) return null;
  const d = parseYmd(today);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return last - d.getDate() + 1;
}

/** 今年還剩幾個月（含這個月）；不是今年就回傳 null */
export function monthsLeft(year, today) {
  if (Number(today.slice(0, 4)) !== Number(year)) return null;
  return 12 - Number(today.slice(5, 7)) + 1;
}

/** 設定裡的預算整理成數字。例外是一年的額度（舊版存的是每月 exception，換算成 ×12） */
export function readBudget(settings) {
  const b = settings?.budget ?? {};
  const num = (v) => (Number(v) > 0 ? Number(v) : 0);
  const categories = {};
  for (const [k, v] of Object.entries(b.categories ?? {})) if (num(v)) categories[k] = num(v);
  const exceptionYear = b.exceptionYear != null ? num(b.exceptionYear) : num(b.exception) * 12;
  return { total: num(b.total), exceptionYear, categories };
}
