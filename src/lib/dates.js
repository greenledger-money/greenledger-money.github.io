// 日期工具：一律用裝置的當地時間（台灣使用者＝台北時間）
// 日期字串格式統一為 'YYYY-MM-DD'，月份為 'YYYY-MM'

export const pad = (n) => String(n).padStart(2, '0');

export function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 交易時間（ISO）→ 當地日期 'YYYY-MM-DD' */
export const localDate = (iso) => ymd(new Date(iso));
export const monthKey = (iso) => localDate(iso).slice(0, 7);
export const todayStr = (now = new Date()) => ymd(now);
export const thisMonth = (now = new Date()) => ymd(now).slice(0, 7);

export function daysInMonth(year, month0) {
  return new Date(year, month0 + 1, 0).getDate();
}

export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/** 加 n 個月，日子超過該月天數就取月底：1/31 + 1 個月 = 2/28 */
export function addMonthsClamped(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const first = new Date(y, m - 1 + n, 1);
  const dim = daysInMonth(first.getFullYear(), first.getMonth());
  return ymd(new Date(first.getFullYear(), first.getMonth(), Math.min(d, dim)));
}

/** 加 n 個工作天（只跳過週六日，不含國定假日） */
export function addBusinessDays(s, n) {
  const d = parseYmd(s);
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) left--;
  }
  return ymd(d);
}

/** 'YYYY-MM' → 這個月的 [開始, 下個月開始) 兩個 Date */
export function monthRange(key) {
  const [y, m] = key.split('-').map(Number);
  return { from: new Date(y, m - 1, 1), to: new Date(y, m, 1) };
}

export function shiftMonth(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** 最近 n 個月（含 endKey），由舊到新 */
export function lastMonths(endKey, n) {
  return Array.from({ length: n }, (_, i) => shiftMonth(endKey, i - n + 1));
}

/** 某天 00:00（當地）的 ISO 字串 */
export const startOfDayIso = (s) => parseYmd(s).toISOString();

/** ISO → <input type="datetime-local"> 的值 */
export function toInputDateTime(iso) {
  const d = new Date(iso);
  return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromInputDateTime(v) {
  const [date, time = '00:00'] = v.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm).toISOString();
}

const WD = ['日', '一', '二', '三', '四', '五', '六'];

/** '2026-11-24' → '11/24（二）' */
export function dayLabel(s) {
  const d = parseYmd(s);
  return `${d.getMonth() + 1}/${d.getDate()}（${WD[d.getDay()]}）`;
}

export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return `${y} 年 ${m} 月`;
}

export function timeLabel(iso) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
