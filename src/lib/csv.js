// CSV 讀寫。匯出加上 UTF-8 BOM，Excel 打開中文才不會亂碼。

import { localDate, timeLabel } from './dates.js';
import { round2 } from './money.js';
import { TXN_LABEL } from './ledger.js';

/** 解析 CSV（支援引號、引號內換行、CRLF、BOM） */
export function parseCSV(text) {
  const s = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = []; let field = ''; let inQ = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const esc = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCSV(rows) {
  return `﻿${rows.map((r) => r.map(esc).join(',')).join('\r\n')}\r\n`;
}

/** 交易 → CSV 列（日期由舊到新） */
export function transactionsToRows(txns, { accById, tree }) {
  const head = ['日期', '時間', '類型', '帳戶', '轉入帳戶', '分類', '金額', '幣別', '匯率', '台幣金額', '轉入金額', '轉入幣別', '備註', '例外'];
  const sorted = [...txns].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  const body = sorted.map((t) => {
    const a = accById.get(t.account_id); const to = accById.get(t.to_account_id);
    return [
      localDate(t.occurred_at), timeLabel(t.occurred_at), TXN_LABEL[t.type], a?.name ?? '', to?.name ?? '',
      t.category_id ? tree.path(t.category_id) : '', t.amount, a?.currency ?? '', t.fx_rate,
      round2(Number(t.amount) * Number(t.fx_rate || 1)), t.to_amount ?? '', to?.currency ?? '', t.note ?? '',
      t.is_exception ? '是' : '',
    ];
  });
  return [head, ...body];
}
