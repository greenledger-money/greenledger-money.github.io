// 固定收支：第 k 次的日期＝起始日＋k 個週期。
// 用「起始日＋第 k 次」計算（不是「上一次＋一個月」），所以月底不會漂移：1/31 → 2/28 → 3/31。

import { addDays, addMonthsClamped } from './dates.js';

export const UNIT_LABEL = { day: '天', week: '週', month: '個月', year: '年' };

export function occurrenceDate(rule, k) {
  const n = Number(rule.interval_count) || 1;
  switch (rule.interval_unit) {
    case 'day': return addDays(rule.start_date, k * n);
    case 'week': return addDays(rule.start_date, 7 * k * n);
    case 'month': return addMonthsClamped(rule.start_date, k * n);
    case 'year': return addMonthsClamped(rule.start_date, 12 * k * n);
    default: throw new Error(`未知的週期：${rule.interval_unit}`);
  }
}

/** 從 next_index 開始，所有「已到期（≤ today）且沒超過結束日」的次數 */
export function dueOccurrences(rule, today, max = 120) {
  const out = [];
  if (!rule.active) return out;
  for (let k = rule.next_index ?? 0; out.length < max; k++) {
    const date = occurrenceDate(rule, k);
    if (date > today) break;
    if (rule.end_date && date > rule.end_date) break;
    out.push({ k, date });
  }
  return out;
}

/** 下一次的日期（已結束回傳 null） */
export function nextDate(rule) {
  const date = occurrenceDate(rule, rule.next_index ?? 0);
  if (rule.end_date && date > rule.end_date) return null;
  return date;
}

export function describe(rule) {
  const n = Number(rule.interval_count) || 1;
  return `每${n === 1 ? '' : ` ${n} `}${UNIT_LABEL[rule.interval_unit]}`;
}
