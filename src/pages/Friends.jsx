// 朋友欠款：「朋友欠我」帳戶按人分，誰還欠多少、哪幾筆；收回時一鍵記還款
import { useMemo, useState } from 'react';
import { remember, useLedger } from '../store.jsx';
import { Empty, Icon, Page, Tile, back, useUI } from '../ui/kit.jsx';
import { TxnList } from '../ui/TxnList.jsx';
import { fmt } from '../lib/money.js';
import { friendBalances, NO_NAME } from '../lib/friends.js';

export default function Friends() {
  const { data } = useLedger();
  const { openEntry } = useUI();
  const [open, setOpen] = useState(null);
  const [showDone, setShowDone] = useState(false);
  const fo = data.friendsOwe;
  const people = useMemo(() => (fo ? friendBalances(data.transactions, fo.id) : []), [data.transactions, fo]);
  if (!fo) return <Page title="朋友欠款" onBack={() => back('more')}><Empty>找不到「朋友欠我」帳戶</Empty></Page>;

  const owing = people.filter((p) => Math.abs(p.balance) >= 0.005);
  const done = people.filter((p) => Math.abs(p.balance) < 0.005);
  const total = owing.reduce((x, p) => x + p.balance, 0);

  function collect(p) {
    const to = [remember.get('lastAccount'), data.settings.defaultAccountId].find((id) => id && id !== fo.id && data.accById.get(id) && !data.accById.get(id).hidden);
    openEntry({
      initial: {
        type: 'transfer', account_id: fo.id, to_account_id: to ?? null, amount: Math.max(0, p.balance),
        counterparty: p.name === NO_NAME ? '' : p.name, note: p.name === NO_NAME ? '還款' : `${p.name} 還款`,
      },
    });
  }

  const card = (p) => (
    <div key={p.name} className="card friend">
      <button type="button" className="friend-head" aria-expanded={open === p.name} onClick={() => setOpen(open === p.name ? null : p.name)}>
        <Tile name="people" round size={40} />
        <span className="grow">
          <b>{p.name}</b>
          <span className="small muted">{p.open} 筆未還{p.last ? ` · 最近 ${p.last.slice(5, 10).replace('-', '/')}` : ''}</span>
        </span>
        <b className={`num ${p.balance < 0 ? 'expense' : 'income'}`}>{fmt(p.balance)}</b>
        <Icon name="chev" className={`chev ${open === p.name ? 'up' : 'down'}`} />
      </button>
      {p.balance > 0 && <button className="btn small primary" onClick={() => collect(p)}>收回 {fmt(p.balance)}</button>}
      {p.balance < 0 && <div className="small muted">多還了 {fmt(-p.balance)}（或是你欠他）</div>}
      {open === p.name && <TxnList txns={p.txns} accountId={fo.id} dayTotals={false} />}
    </div>
  );

  return (
    <Page title="朋友欠款" onBack={() => back('more')}>
      <div className="card hero">
        <div>
          <div className="label">朋友總共還欠我</div>
          <div className="big num income">{fmt(total)}</div>
          <div className="small muted">{owing.length} 個人</div>
        </div>
      </div>
      {owing.length ? owing.map(card) : <Empty>大家都還清了</Empty>}
      {people.some((p) => p.name === NO_NAME && Math.abs(p.balance) >= 0.005) && (
        <p className="small muted" style={{ padding: '0 4px' }}>「{NO_NAME}」是之前沒填對象的紀錄，點進去改一筆，在「誰」填上名字就會分開。</p>
      )}
      {done.length > 0 && (
        <>
          <button className="link small" onClick={() => setShowDone(!showDone)}>{showDone ? '收起' : '顯示'}已還清的（{done.length}）</button>
          {showDone && done.map(card)}
        </>
      )}
    </Page>
  );
}
