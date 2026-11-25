// 計算機鍵盤用的算式求值：支援 + − × ÷ 和小數點，例如 '120+85'、'1000÷3'
// 不用 eval，自己做一個小的運算子優先順序解析。

import { round2 } from './money.js';

const OPS = { '+': 1, '-': 1, '*': 2, '/': 2 };

export function normalize(expr) {
  return String(expr).replace(/[×xX]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/[,\s]/g, '');
}

/** 回傳數字；算式不完整或除以 0 回傳 null */
export function evaluate(expr) {
  const s = normalize(expr);
  if (!s) return null;
  const tokens = s.match(/\d*\.?\d+|\d+\.|[+\-*/]/g);
  if (!tokens || tokens.join('') !== s) return null;

  const out = [];
  const stack = [];
  let expectNumber = true;
  for (const tok of tokens) {
    if (tok in OPS) {
      if (expectNumber) {
        if (tok === '-' && out.length === 0 && stack.length === 0) { out.push(0); } // 開頭負號
        else return null;
      }
      while (stack.length && OPS[stack[stack.length - 1]] >= OPS[tok]) out.push(stack.pop());
      stack.push(tok);
      expectNumber = true;
    } else {
      out.push(parseFloat(tok));
      expectNumber = false;
    }
  }
  if (expectNumber) return null;
  while (stack.length) out.push(stack.pop());

  const st = [];
  for (const t of out) {
    if (typeof t === 'number') { st.push(t); continue; }
    const b = st.pop(); const a = st.pop();
    if (a === undefined || b === undefined) return null;
    if (t === '+') st.push(a + b);
    else if (t === '-') st.push(a - b);
    else if (t === '*') st.push(a * b);
    else { if (b === 0) return null; st.push(a / b); }
  }
  return st.length === 1 && Number.isFinite(st[0]) ? round2(st[0]) : null;
}

/** 有沒有運算子（決定要不要在畫面上顯示「＝結果」） */
export const hasOperator = (expr) => /[+\-*/×÷−]/.test(String(expr).replace(/^-/, ''));

/** 按下一個鍵之後的新算式字串 */
export function press(expr, key) {
  const s = String(expr ?? '');
  if (key === 'C') return '';
  if (key === '⌫') return s.slice(0, -1);
  if (key === '=') { const v = evaluate(s); return v === null ? s : String(v); }
  const isOp = /[+\-×÷]/.test(key);
  if (isOp) {
    if (!s) return key === '-' ? '-' : '';
    if (/[+\-×÷]$/.test(s)) return s.slice(0, -1) + key; // 連按運算子 → 取代
    return s + key;
  }
  if (key === '.') {
    const last = s.split(/[+\-×÷]/).pop();
    if (last.includes('.')) return s;
    return s + (last === '' ? '0.' : '.');
  }
  // 數字：避免 '00' 開頭
  const last = s.split(/[+\-×÷]/).pop();
  if (key === '00') return last === '' || last === '0' ? s : s + '00';
  if (last === '0' && key !== '.') return s.slice(0, -1) + key;
  if (s.length > 40) return s;
  return s + key;
}
