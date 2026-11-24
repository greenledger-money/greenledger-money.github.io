// 明細：按月份看所有交易，可依帳戶、分類、備註篩選
import { useMemo, useState } from 'react';
import { useLedger } from '../store.jsx';
import { Icon, Page, back } from '../ui/kit.jsx';
import { TxnList } from '../ui/TxnList.jsx';
import { AccountSelect, CategoryButton } from '../ui/pickers.jsx';
import { monthLabel, monthRange, shiftMonth, thisMonth } from '../lib/dates.js';
import { summarize } from '../lib/ledger.js';
import { fmt } from '../lib/money.js';

export default function Transactions() {
  const { data } = useLedger();
  const [month, setMonth] = useState(thisMonth());
  const [accountId, setAccountId] = useState(null);
  const [kind, setKind] = useState('expense');
  const [categoryId, setCategoryId] = useState(null);
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);

  const list = useMemo(() => {
    const { from, to } = monthRange(month);
    const cats = categoryId ? data.tree.descendants(categoryId) : null;
    const text = q.trim().toLowerCase();
    return data.transactions.filter((t) => {
      if (!all) { const ms = Date.parse(t.occurred_at); if (ms < from.getTime() || ms >= to.getTime()) return false; }
      if (accountId && t.account_id !== accountId && t.to_account_id !== accountId) return false;
      if (cats && !cats.has(t.category_id)) return false;
      if (text && !(t.note ?? '').toLowerCase().includes(text) && !(t.category_id && data.tree.path(t.category_id).toLowerCase().includes(text))) return false;
      return true;
    });
  }, [data, month, accountId, categoryId, q, all]);
  const s = summarize(list, data.accById, { from: new Date(0), to: new Date(8.64e15) });

  return (
    <Page title="明細" onBack={() => back('home')}>
      <div className="row-flex" style={{ justifyContent: 'space-between' }}>
        {!all ? (
          <div className="monthnav">
            <button className="iconbtn" aria-label="上個月" onClick={() => setMonth(shiftMonth(month, -1))}><Icon name="back" /></button>
            <b>{monthLabel(month)}</b>
            <button className="iconbtn" aria-label="下個月" onClick={() => setMonth(shiftMonth(month, 1))}><Icon name="chev" /></button>
          </div>
        ) : <b>全部期間</b>}
        <button className="chip" aria-pressed={all} onClick={() => setAll(!all)}>全部期間</button>
      </div>
      <div className="row-flex">
        <input className="input grow" type="search" placeholder="搜尋備註或分類" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
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
      <TxnList txns={list} accountId={accountId} empty="這段期間沒有符合的紀錄" />
    </Page>
  );
}
