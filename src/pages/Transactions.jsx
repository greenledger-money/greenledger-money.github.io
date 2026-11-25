// 明細：按月份（或自訂期間、全部）看交易；可依帳戶、分類、備註、類型、例外、金額篩選
import { useMemo, useState } from 'react';
import { useLedger } from '../store.jsx';
import { Icon, Page, Seg, back } from '../ui/kit.jsx';
import { TxnList } from '../ui/TxnList.jsx';
import { AccountSelect, CategoryButton } from '../ui/pickers.jsx';
import { monthLabel, monthRange, shiftMonth, thisMonth, todayStr, ymd } from '../lib/dates.js';
import { summarize, twdOf } from '../lib/ledger.js';
import { fmt } from '../lib/money.js';

const NONE = { type: 'all', exc: 'all', min: '', max: '' };
const num = (v) => { const n = Number(String(v).replace(/[,\s$]/g, '')); return v !== '' && Number.isFinite(n) ? n : null; };

/** 進階篩選條件（純函式，方便測試） */
export function matchAdvanced(t, f) {
  if (f.type !== 'all' && t.type !== f.type) return false;
  if (f.exc === 'only' && !t.is_exception) return false;
  if (f.exc === 'no' && t.is_exception) return false;
  const v = twdOf(t);
  const lo = num(f.min); const hi = num(f.max);
  if (lo != null && v < lo) return false;
  if (hi != null && v > hi) return false;
  return true;
}

export default function Transactions() {
  const { data } = useLedger();
  const [month, setMonth] = useState(thisMonth());
  const [period, setPeriod] = useState('month'); // month | custom | all
  const [range, setRange] = useState(() => ({ from: ymd(monthRange(thisMonth()).from), to: todayStr() }));
  const [accountId, setAccountId] = useState(null);
  const [kind, setKind] = useState('expense');
  const [categoryId, setCategoryId] = useState(null);
  const [q, setQ] = useState('');
  const [adv, setAdv] = useState(NONE);
  const [showAdv, setShowAdv] = useState(false);
  const advCount = ['type', 'exc'].filter((k) => adv[k] !== 'all').length + (num(adv.min) != null || num(adv.max) != null ? 1 : 0);

  const list = useMemo(() => {
    let lo = -Infinity; let hi = Infinity;
    if (period === 'month') { const r = monthRange(month); lo = r.from.getTime(); hi = r.to.getTime(); }
    if (period === 'custom') { lo = new Date(`${range.from}T00:00:00`).getTime(); hi = new Date(`${range.to}T00:00:00`).getTime() + 86400e3; }
    const cats = categoryId ? data.tree.descendants(categoryId) : null;
    const text = q.trim().toLowerCase();
    return data.transactions.filter((t) => {
      const ms = Date.parse(t.occurred_at);
      if (ms < lo || ms >= hi) return false;
      if (accountId && t.account_id !== accountId && t.to_account_id !== accountId) return false;
      if (cats && !cats.has(t.category_id)) return false;
      if (text && !(t.note ?? '').toLowerCase().includes(text) && !(t.counterparty ?? '').toLowerCase().includes(text)
        && !(t.category_id && data.tree.path(t.category_id).toLowerCase().includes(text))) return false;
      return matchAdvanced(t, adv);
    });
  }, [data, period, month, range, accountId, categoryId, q, adv]);
  const s = summarize(list, data.accById, { from: new Date(0), to: new Date(8.64e15) });
  const setA = (k) => (v) => setAdv((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));

  return (
    <Page title="明細" onBack={() => back('home')}>
      <Seg value={period} onChange={setPeriod} options={[{ value: 'month', label: '按月' }, { value: 'custom', label: '自訂期間' }, { value: 'all', label: '全部' }]} />
      {period === 'month' && (
        <div className="monthnav" style={{ justifyContent: 'center' }}>
          <button className="iconbtn" aria-label="上個月" onClick={() => setMonth(shiftMonth(month, -1))}><Icon name="back" /></button>
          <b>{monthLabel(month)}</b>
          <button className="iconbtn" aria-label="下個月" onClick={() => setMonth(shiftMonth(month, 1))}><Icon name="chev" /></button>
        </div>
      )}
      {period === 'custom' && (
        <div className="grid2">
          <input className="input" type="date" aria-label="從" value={range.from} onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))} />
          <input className="input" type="date" aria-label="到" value={range.to} onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))} />
        </div>
      )}
      <div className="row-flex">
        <input className="input grow" type="search" placeholder="搜尋備註、分類、對象" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="chip" aria-pressed={showAdv || advCount > 0} aria-expanded={showAdv} onClick={() => setShowAdv(!showAdv)}>
          篩選{advCount ? ` ${advCount}` : ''}
        </button>
      </div>
      {showAdv && (
        <div className="card form adv-filter">
          <Seg label="類型" value={adv.type} onChange={setA('type')} options={[{ value: 'all', label: '全部' }, { value: 'expense', label: '支出' }, { value: 'income', label: '收入' }, { value: 'transfer', label: '轉帳' }]} />
          <Seg label="例外" value={adv.exc} onChange={setA('exc')} options={[{ value: 'all', label: '含例外' }, { value: 'no', label: '不含例外' }, { value: 'only', label: '只看例外' }]} />
          <div className="row-flex">
            <span className="small muted" style={{ flex: 'none' }}>金額</span>
            <input className="input num" inputMode="numeric" aria-label="最低金額" placeholder="最低" value={adv.min} onChange={setA('min')} />
            <span className="muted">～</span>
            <input className="input num" inputMode="numeric" aria-label="最高金額" placeholder="最高" value={adv.max} onChange={setA('max')} />
          </div>
          {advCount > 0 && <button className="link small" onClick={() => setAdv(NONE)}>清除篩選</button>}
        </div>
      )}
      <div className="grid2">
        <AccountSelect value={accountId} onChange={setAccountId} includeHidden placeholder="所有帳戶" allowEmpty />
        <div className="input row-flex" style={{ padding: '0 8px' }}>
          <select aria-label="分類類型" value={kind} onChange={(e) => { setKind(e.target.value); setCategoryId(null); }} style={{ border: 0, background: 'none', width: 'auto' }}>
            <option value="expense">支出</option><option value="income">收入</option>
          </select>
          <div className="frow" style={{ padding: 0, minHeight: 0, flex: 1 }}><div className="ctrl"><CategoryButton kind={kind} value={categoryId} onChange={setCategoryId} placeholder="所有分類" /></div></div>
          {categoryId && <button className="link" onClick={() => setCategoryId(null)} aria-label="清除分類">✕</button>}
        </div>
      </div>
      <div className="row-flex small muted" style={{ justifyContent: 'space-between' }}>
        <span>{list.length} 筆</span>
        <span className="num">收入 {fmt(s.income)} · 支出 {fmt(s.expense)}</span>
      </div>
      <TxnList txns={list} accountId={accountId} empty="沒有符合的紀錄" />
    </Page>
  );
}
