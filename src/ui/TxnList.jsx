// 交易清單（依日期分組）。給首頁、明細頁、帳戶頁共用。
import { useLedger } from '../store.jsx';
import { Tile, categoryIcon, useUI } from './kit.jsx';
import { fmt } from '../lib/money.js';
import { dayLabel, localDate, timeLabel } from '../lib/dates.js';
import { counts, twdOf } from '../lib/ledger.js';

/** 分類名稱：太長時只顯示最後兩層 */
function catName(tree, id) {
  const chain = tree.chain(id);
  return chain.slice(-2).map((n) => n.name).join('-') || '（未分類）';
}

export function TxnRow({ t, accountId }) {
  const { data } = useLedger();
  const { openEntry } = useUI();
  const { accById, tree } = data;
  const a = accById.get(t.account_id); const to = accById.get(t.to_account_id);
  const future = Date.parse(t.occurred_at) > Date.now();
  let title; let amount; let cur = a?.currency ?? 'TWD'; let cls = '';
  if (t.type === 'transfer') {
    title = `${a?.name ?? '?'} → ${to?.name ?? '?'}`;
    if (accountId && accountId === t.to_account_id) { amount = Number(t.to_amount); cur = to?.currency ?? 'TWD'; cls = 'income'; }
    else if (accountId) { amount = -Number(t.amount); cls = 'expense'; }
    else amount = Number(t.amount);
  } else {
    title = catName(tree, t.category_id);
    amount = t.type === 'expense' ? -Number(t.amount) : Number(t.amount);
    cls = t.type === 'expense' ? 'expense' : 'income';
  }
  const subParts = [timeLabel(t.occurred_at), t.type !== 'transfer' && !accountId ? a?.name : null, t.note].filter(Boolean);
  return (
    <button type="button" className="item" onClick={() => openEntry({ original: t })}>
      {t.type === 'transfer'
        ? <Tile name="swap" tone="plain" round />
        : <Tile name={categoryIcon(tree, t.category_id)} tone={t.type === 'income' ? 'income' : ''} round />}
      <div className="main">
        <div className="title">{title}</div>
        <div className="sub">{subParts.join(' · ')}</div>
      </div>
      <div className="value">
        <span className={`num ${cls}`}>{fmt(amount, cur, { sign: cls === 'income', exact: true })}</span>
        <span className="row-flex" style={{ gap: 4 }}>
          {t.is_exception && <span className="badge">例外</span>}
          {t.group_id && <span className="badge">分帳</span>}
          {t.parent_id && <span className="badge">手續費</span>}
          {future && <span className="badge warn">未到</span>}
          {cur !== 'TWD' && t.type !== 'transfer' && <span className="small muted num">≈{fmt(twdOf(t))}</span>}
          {t.orig_currency && <span className="small muted num">{fmt(Number(t.orig_amount), t.orig_currency)}</span>}
        </span>
      </div>
    </button>
  );
}

export function TxnList({ txns, accountId, empty = '還沒有紀錄', dayTotals = true }) {
  const { data } = useLedger();
  if (!txns.length) return <div className="list"><div className="empty">{empty}</div></div>;
  const days = [];
  for (const t of txns) {
    const d = localDate(t.occurred_at);
    if (!days.length || days[days.length - 1].day !== d) days.push({ day: d, items: [] });
    days[days.length - 1].items.push(t);
  }
  return (
    <div className="list">
      {days.map((g) => {
        let exp = 0;
        for (const t of g.items) if (t.type === 'expense' && counts(t, data.accById, true)) exp += twdOf(t);
        return (
          <div key={g.day} style={{ borderTop: 0 }}>
            <div className="daybar"><span>{dayLabel(g.day)}</span>{dayTotals && exp > 0 && <span className="num">支出 {fmt(exp)}</span>}</div>
            <div className="list" style={{ borderRadius: 0, boxShadow: 'none' }}>
              {g.items.map((t) => <TxnRow key={t.id} t={t} accountId={accountId} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
