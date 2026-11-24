// 從 CWMoney 匯入。
// CW 匯出格式：日期、類別、主分類、子分類、帳戶、專案、金額、匯率、小計、更新時間、地址、發票號碼、轉帳、備註（UTF-8 with BOM）
// 轉帳是連續三行：轉出（支出）、轉入（收入）、「結帳-手續費」，轉帳欄是 yes。

import { parseCSV } from './csv.js';
import { num, round2 } from './money.js';
import { startOfDayIso, pad } from './dates.js';
import { uid } from './ledger.js';

const COLS = {
  date: '日期', kind: '類別', main: '主分類', sub: '子分類', account: '帳戶', project: '專案',
  amount: '金額', rate: '匯率', subtotal: '小計', updated: '更新時間', address: '地址',
  invoice: '發票號碼', transfer: '轉帳', note: '備註',
};

/** '2023/10/29'、'2023-10-29'、'2023/10/29 12:00' → '2023-10-29' */
export function normDate(s) {
  const m = String(s ?? '').trim().match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  return m ? `${m[1]}-${pad(+m[2])}-${pad(+m[3])}` : null;
}

const isYes = (s) => /^(yes|y|true|是|1)$/i.test(String(s ?? '').trim());
export const isFeeRow = (r) => /手續費/.test(r.sub) || /手續費/.test(r.main) || /^結帳/.test(r.main);

/** 讀 CSV → 一列一筆紀錄 */
export function parseCW(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('檔案是空的');
  const header = rows[0].map((h) => h.trim());
  const col = {};
  for (const [k, name] of Object.entries(COLS)) col[k] = header.indexOf(name);
  const missing = ['date', 'kind', 'account', 'amount'].filter((k) => col[k] < 0).map((k) => COLS[k]);
  if (missing.length) throw new Error(`這不像 CW 匯出的檔案，缺少欄位：${missing.join('、')}`);

  const get = (r, k) => (col[k] >= 0 ? (r[col[k]] ?? '').trim() : '');
  const records = [];
  const errors = [];
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const date = normDate(get(r, 'date'));
    if (!date) { errors.push(`第 ${line} 行：日期看不懂（${get(r, 'date')}）`); return; }
    const raw = num(get(r, 'amount'));
    const kindText = get(r, 'kind');
    let kind = /支出/.test(kindText) ? 'expense' : /收入/.test(kindText) ? 'income' : null;
    if (!kind) kind = raw < 0 ? 'expense' : 'income';
    records.push({
      line, date, kind, main: get(r, 'main'), sub: get(r, 'sub'), account: get(r, 'account'),
      amount: Math.abs(raw), transfer: isYes(get(r, 'transfer')), note: get(r, 'note'),
    });
  });
  return { records, errors };
}

/**
 * 把三行一組的轉帳還原成一筆轉帳。
 * 回傳 items：{ type:'transfer', date, from, to, amount, toAmount, fee, feeAccount, note, lines }
 *            或 { type:'expense'|'income', date, account, main, sub, amount, note, lines }
 */
export function groupCW(records) {
  const items = [];
  const warnings = [];
  let transfers = 0; let fees = 0;
  for (let i = 0; i < records.length; i++) {
    const a = records[i];
    if (!a.transfer) {
      items.push({ type: a.kind, date: a.date, account: a.account, main: a.main, sub: a.sub, amount: a.amount, note: a.note, lines: [a.line] });
      continue;
    }
    const b = records[i + 1];
    if (b && b.transfer && !isFeeRow(a) && !isFeeRow(b) && a.kind !== b.kind && a.date === b.date) {
      const out = a.kind === 'expense' ? a : b;
      const inn = a.kind === 'expense' ? b : a;
      const c = records[i + 2];
      const fee = c && c.transfer && isFeeRow(c) && c.date === a.date ? c : null;
      items.push({
        type: 'transfer', date: a.date, from: out.account, to: inn.account, amount: out.amount, toAmount: inn.amount,
        fee: fee?.amount ?? 0, feeAccount: fee?.account || out.account, note: out.note || inn.note,
        lines: [a.line, b.line, ...(fee ? [fee.line] : [])],
      });
      transfers++;
      if (fee && fee.amount > 0) fees++;
      i += fee ? 2 : 1;
      continue;
    }
    if (isFeeRow(a)) {
      // 落單的手續費列：有金額就當一般支出
      if (a.amount > 0) {
        items.push({ type: 'expense', date: a.date, account: a.account, main: a.main, sub: a.sub, amount: a.amount, note: a.note, lines: [a.line], fee: true });
        fees++;
      }
      warnings.push(`第 ${a.line} 行：找不到對應轉帳的手續費列`);
      continue;
    }
    warnings.push(`第 ${a.line} 行：轉帳配對不到另一邊，先當一般${a.kind === 'expense' ? '支出' : '收入'}匯入`);
    items.push({ type: a.kind, date: a.date, account: a.account, main: a.main, sub: a.sub, amount: a.amount, note: a.note, lines: [a.line] });
  }
  return { items, transfers, fees, warnings };
}

export const catKey = (kind, main, sub) => `${kind}|${main}|${sub}`;

/** 整理出帳戶、分類清單，給匯入精靈顯示 */
export function analyzeCW(text) {
  const { records, errors } = parseCW(text);
  const { items, transfers, fees, warnings } = groupCW(records);
  const accounts = new Map();
  const touch = (name, date) => {
    if (!name) return;
    const a = accounts.get(name) ?? { name, count: 0, first: date, last: date };
    a.count++;
    if (date < a.first) a.first = date;
    if (date > a.last) a.last = date;
    accounts.set(name, a);
  };
  const categories = new Map();
  for (const it of items) {
    if (it.type === 'transfer') { touch(it.from, it.date); touch(it.to, it.date); continue; }
    touch(it.account, it.date);
    const k = catKey(it.type, it.main, it.sub);
    const c = categories.get(k) ?? { key: k, kind: it.type, main: it.main || '未分類', sub: it.sub, count: 0, total: 0 };
    c.count++; c.total = round2(c.total + it.amount);
    categories.set(k, c);
  }
  const dates = records.map((r) => r.date).sort();
  return {
    items,
    accounts: [...accounts.values()].sort((a, b) => b.count - a.count),
    categories: [...categories.values()].sort((a, b) => a.kind.localeCompare(b.kind) || b.count - a.count),
    stats: { rows: records.length, transfers, fees, from: dates[0], to: dates[dates.length - 1] },
    warnings: [...errors, ...warnings],
  };
}

/** 看名字猜代墊類分類：「借錢」「墊」→ 付出去；「還錢」→ 收回來 */
export function guessAdvance(c) {
  const text = `${c.main}${c.sub}`;
  if (c.kind === 'income' && /(還錢|還款|墊)/.test(text)) return 'repay';
  if (c.kind === 'expense' && /(借錢|借出|代墊|墊)/.test(text)) return 'lend';
  return null;
}

/**
 * 產生要寫入的交易。
 * accountOf(name) → 帳戶物件（含 id、currency）
 * categoryOf(key) → 分類 id
 * advanceOf(key)  → 'lend' | 'repay' | null（代墊類分類改記成「朋友欠我」轉帳）
 * rateFor(account, date) → 外幣帳戶的匯率（CW 的金額都是當台幣記的，要換回外幣）
 */
export function buildImport({ items, accountOf, categoryOf, advanceOf, friendsOwe, feeCategoryId, rateFor }) {
  const txns = [];
  const problems = [];
  const conv = (acc, twdAmount, date) => {
    if (acc.currency === 'TWD') return { amount: round2(twdAmount), rate: 1 };
    const rate = rateFor(acc, date);
    if (!rate) throw new Error(`「${acc.name}」${date} 沒有匯率`);
    return { amount: round2(twdAmount / rate), rate };
  };
  const base = (date, note) => ({ occurred_at: startOfDayIso(date), note: (note ?? '').slice(0, 500), is_exception: false, source: 'cw_import' });

  for (const it of items) {
    try {
      if (it.type === 'transfer') {
        const from = accountOf(it.from); const to = accountOf(it.to);
        if (!from || !to) throw new Error('帳戶沒有對應');
        if (from.id === to.id) { problems.push(`${it.date} 轉帳的轉出、轉入是同一個帳戶，略過`); continue; }
        const f = conv(from, it.amount, it.date); const t = conv(to, it.toAmount, it.date);
        const id = uid();
        txns.push({ id, type: 'transfer', ...base(it.date, it.note), account_id: from.id, amount: f.amount, fx_rate: f.rate, to_account_id: to.id, to_amount: t.amount, to_fx_rate: t.rate });
        if (it.fee > 0) {
          const feeAcc = accountOf(it.feeAccount) ?? from;
          const c = conv(feeAcc, it.fee, it.date);
          txns.push({ id: uid(), type: 'expense', ...base(it.date, '轉帳手續費'), account_id: feeAcc.id, amount: c.amount, fx_rate: c.rate, category_id: feeCategoryId, parent_id: feeAcc.id === from.id ? id : null });
        }
        continue;
      }
      const acc = accountOf(it.account);
      if (!acc) throw new Error('帳戶沒有對應');
      const key = catKey(it.type, it.main, it.sub);
      const adv = advanceOf(key);
      const c = conv(acc, it.amount, it.date);
      if (adv === 'lend' && it.type === 'expense') {
        txns.push({ id: uid(), type: 'transfer', ...base(it.date, it.note || [it.main, it.sub].filter(Boolean).join('-')), account_id: acc.id, amount: c.amount, fx_rate: c.rate, to_account_id: friendsOwe.id, to_amount: round2(it.amount), to_fx_rate: 1 });
      } else if (adv === 'repay' && it.type === 'income') {
        txns.push({ id: uid(), type: 'transfer', ...base(it.date, it.note || [it.main, it.sub].filter(Boolean).join('-')), account_id: friendsOwe.id, amount: round2(it.amount), fx_rate: 1, to_account_id: acc.id, to_amount: c.amount, to_fx_rate: c.rate });
      } else {
        const category_id = it.fee ? feeCategoryId : categoryOf(key);
        if (!category_id) throw new Error('分類沒有對應');
        txns.push({ id: uid(), type: it.type, ...base(it.date, it.note), account_id: acc.id, amount: c.amount, fx_rate: c.rate, category_id });
      }
    } catch (e) {
      problems.push(`第 ${it.lines.join('、')} 行：${e.message}`);
    }
  }
  return { txns, problems };
}

/** 期初餘額＝CW 目前餘額 − 所有流水加總（帳戶幣別） */
export function openingFromCurrent(current, flows) {
  return round2(num(current) - flows);
}
