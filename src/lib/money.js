// 金額工具：四捨五入到小數兩位、格式化顯示

export const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

/** 任何輸入 → 數字（'1,234.5' → 1234.5；無效 → 0） */
export function num(x) {
  if (typeof x === 'number') return Number.isFinite(x) ? x : 0;
  const n = parseFloat(String(x ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

const SYMBOL = {
  TWD: '$', USD: 'US$', JPY: '¥', EUR: '€', CNY: 'CN¥', HKD: 'HK$', GBP: '£',
  AUD: 'A$', CAD: 'C$', SGD: 'S$', KRW: '₩', CHF: 'CHF ', NZD: 'NZ$', THB: '฿',
};
const NO_DECIMALS = new Set(['JPY', 'KRW']);

export const CURRENCIES = ['TWD', 'USD', 'JPY', 'EUR', 'CNY', 'HKD', 'GBP', 'AUD', 'CAD', 'SGD', 'KRW', 'CHF', 'NZD', 'THB'];

export const currencySymbol = (c) => SYMBOL[c] ?? `${c} `;

/**
 * 顯示金額。台幣預設顯示整數（合計、換算後的金額不會出現零頭）；
 * exact: true 時，台幣有角分才顯示兩位小數（單筆交易、帳戶餘額用）。外幣一律兩位小數。
 * fmt(-1234, 'TWD') → '-$1,234'；fmt(12.5, 'USD') → 'US$12.50'
 */
export function fmt(amount, currency = 'TWD', { sign = false, symbol = true, exact = false } = {}) {
  let v = round2(num(amount));
  let digits = 2;
  if (NO_DECIMALS.has(currency)) { digits = 0; v = Math.round(v); }
  else if (currency === 'TWD') {
    if (!exact) v = Math.round(v);
    digits = Number.isInteger(v) ? 0 : 2;
  }
  const body = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const s = v < 0 ? '-' : sign && v > 0 ? '+' : '';
  return `${s}${symbol ? currencySymbol(currency) : ''}${body}`;
}

/** 百分比：0.1234 → '+12.34%' */
export function pct(x, { sign = true } = {}) {
  if (!Number.isFinite(x)) return '—';
  const s = sign && x > 0 ? '+' : '';
  return `${s}${(x * 100).toFixed(2)}%`;
}

/** 股數：整數不帶小數，零股/碎股最多 4 位 */
export function shares(x) {
  return num(x).toLocaleString('en-US', { maximumFractionDigits: 4 });
}
