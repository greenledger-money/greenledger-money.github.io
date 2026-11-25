// 帳戶：依類型分組、餘額（外幣另顯示台幣）、隱藏帳戶、新增／修改；帳戶明細
import { useMemo, useState } from 'react';
import { useLedger } from '../store.jsx';
import { Empty, Field, Icon, Item, MoveButtons, Money, Page, Section, Seg, Sheet, Toggle, back, go, useAction, useUI, Tile, accountIcon, IconPicker } from '../ui/kit.jsx';
import { TxnList } from '../ui/TxnList.jsx';
import { BrokerageView } from './Stocks.jsx';
import { WorthCard } from './Home.jsx';
import { ACCOUNT_TYPES, accountTypeLabel, orderedTypes } from '../lib/ledger.js';
import { CURRENCIES, fmt } from '../lib/money.js';

export function AccountSheet({ original, onClose }) {
  const { data, actions } = useLedger();
  const { confirm } = useUI();
  const [run, busy] = useAction();
  const [f, setF] = useState(() => original ? { ...original, opening_balance: String(Number(original.opening_balance)) } : { name: '', type: 'bank', currency: 'TWD', opening_balance: '0', hidden: false });
  const [err, setErr] = useState('');
  const used = original && (data.transactions.some((t) => t.account_id === original.id || t.to_account_id === original.id)
    || data.stock_trades.some((t) => t.brokerage_account_id === original.id || t.settlement_account_id === original.id));
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));

  async function save() {
    if (!f.name.trim()) { setErr('請輸入帳戶名稱'); return; }
    if (Number.isNaN(Number(f.opening_balance))) { setErr('期初餘額要是數字'); return; }
    if (await run(() => actions.saveAccount(f, original), original ? '已更新' : '已新增帳戶')) onClose();
  }
  async function remove() {
    if (used) { setErr('這個帳戶已經有交易，不能刪除。可以打開「隱藏」。'); return; }
    if (!(await confirm(`刪除「${original.name}」？用到它的範本、固定收支也會一起刪除。`, { ok: '刪除', danger: true }))) return;
    if (await run(() => actions.removeRows('accounts', [original.id]), '已刪除')) { onClose(); go('accounts'); }
  }
  const sys = original?.system_key;
  return (
    <Sheet title={original ? '修改帳戶' : '新增帳戶'} onClose={onClose} onSave={save} saving={busy}>
      <div className="form">
        <Field label="名稱"><input className="input" value={f.name} maxLength={40} onChange={set('name')} placeholder="例如：國泰 Cube 卡" /></Field>
        <Field label="圖示"><IconPicker value={f.icon ?? null} onChange={set('icon')} auto={accountIcon(f.type)} /></Field>
        <Field label="類型">
          <select className="input" value={f.type} onChange={set('type')} disabled={!!sys}>
            {ACCOUNT_TYPES.filter((t) => t.value !== 'friends_owe' || sys || f.type === 'friends_owe').map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <div className="grid2">
          <Field label="幣別">
            <select className="input" value={f.currency} onChange={set('currency')} disabled={used || !!sys}>
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="期初餘額" hint={f.type === 'credit_card' ? '欠款填負數' : ''}>
            <input className="input num" inputMode="decimal" value={f.opening_balance} onChange={set('opening_balance')} />
          </Field>
        </div>
        {f.type === 'brokerage' && <div className="notice">淨資產以股票市值計算。</div>}
        <div className="row-flex"><span className="grow">隱藏<div className="small muted">不顯示在帳戶列表和記帳選單、不計入淨資產；收支照樣算進報表</div></span><Toggle label="隱藏" checked={f.hidden} onChange={set('hidden')} /></div>
        {err && <div className="error">{err}</div>}
        {original && !sys && <button className="btn danger block" onClick={remove} disabled={busy}>刪除帳戶</button>}
        {sys && <p className="small muted">系統帳戶無法刪除。</p>}
      </div>
    </Sheet>
  );
}

export default function Accounts() {
  const { data, actions } = useLedger();
  const [run] = useAction();
  const [edit, setEdit] = useState(null);
  const [sorting, setSorting] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const visible = data.accounts.filter((a) => !a.hidden);
  const hidden = data.accounts.filter((a) => a.hidden);
  // 帳戶類別（銀行、信用卡…）的順序
  const types = orderedTypes(data.settings.accountTypeOrder);
  const shownTypes = types.filter((t) => visible.some((a) => a.type === t.value));
  const moveType = (ids) => {
    const rest = types.map((t) => t.value).filter((v) => !ids.includes(v));
    run(() => actions.updateSettings({ accountTypeOrder: [...ids, ...rest] }));
  };
  const row = (a, groupIds) => {
    const isBrk = a.type === 'brokerage';
    if (sorting) {
      return (
        <Item key={a.id} title={a.name} sub={accountTypeLabel(a.type)} chevron={false}>
          <MoveButtons ids={groupIds} id={a.id} label={a.name} onMove={(ids) => run(() => actions.reorder('accounts', ids))} />
        </Item>
      );
    }
    const native = isBrk ? data.stockValue.get(a.id)?.native ?? 0 : data.balances.get(a.id);
    const twd = data.worth.rows.find((r) => r.account.id === a.id)?.twd;
    return (
      <Item key={a.id} title={a.name} left={<Tile name={accountIcon(a)} tone={a.type === 'friends_owe' ? 'income' : a.type === 'credit_card' || a.type === 'loan' ? 'expense' : ''} />}
        sub={isBrk ? '股票市值' : data.unsettled.get(a.id) ? `待交割 ${fmt(data.unsettled.get(a.id), a.currency, { sign: true })}` : a.currency !== 'TWD' ? a.currency : null}
        value={<Money value={native} currency={a.currency} className={native < 0 ? 'expense' : ''} />}
        valueSub={a.currency !== 'TWD' && twd != null ? `≈ ${fmt(twd)}` : null}
        onClick={() => go('account', a.id)} />
    );
  };
  return (
    <Page title="帳戶" right={<>
      <button className="link" onClick={() => setSorting(!sorting)}>{sorting ? '完成' : '排序'}</button>
      {!sorting && <button className="iconbtn" aria-label="新增帳戶" onClick={() => setEdit({})}><Icon name="plus" /></button>}
    </>}>
      <WorthCard big />
      {shownTypes.map((t) => {
        const list = visible.filter((a) => a.type === t.value);
        const sum = data.worth.rows.filter((r) => r.account.type === t.value).reduce((s, r) => s + r.twd, 0);
        return (
          <Section key={t.value} title={<>{t.label}{sorting
            ? <span style={{ marginLeft: 'auto' }}><MoveButtons label={`「${t.label}」這一類`} ids={shownTypes.map((x) => x.value)} id={t.value} onMove={moveType} /></span>
            : <span className="num" style={{ marginLeft: 'auto', fontWeight: 400 }}>{fmt(sum)}</span>}</>}>
            <div className="list">{list.map((a) => row(a, list.map((x) => x.id)))}</div>
          </Section>
        );
      })}
      {hidden.length > 0 && (
        <Section title={<button className="btn small" onClick={() => setShowHidden(!showHidden)}>{showHidden ? '收起' : '顯示'}已隱藏的帳戶（{hidden.length}）</button>}>
          {(showHidden || sorting) && <div className="list">{hidden.map((a) => row(a, hidden.map((x) => x.id)))}</div>}
        </Section>
      )}
      {edit && <AccountSheet original={edit.id ? edit : null} onClose={() => setEdit(null)} />}
    </Page>
  );
}

export function AccountDetail({ id }) {
  const { data } = useLedger();
  const { openEntry } = useUI();
  const [edit, setEdit] = useState(false);
  const [kind, setKind] = useState('all');
  const a = data.accById.get(id);
  const txns = useMemo(() => data.transactions.filter((t) => (t.account_id === id || t.to_account_id === id)
    && (kind === 'all' || (kind === 'future' ? Date.parse(t.occurred_at) > Date.now() : Date.parse(t.occurred_at) <= Date.now()))), [data.transactions, id, kind]);
  if (!a) return <Page title="帳戶" onBack={() => back('accounts')}><Empty>找不到這個帳戶</Empty></Page>;
  const isBrk = a.type === 'brokerage';
  const bal = data.balances.get(id);
  const hasFuture = data.transactions.some((t) => (t.account_id === id || t.to_account_id === id) && Date.parse(t.occurred_at) > Date.now());
  if (isBrk) {
    return (
      <Page title={a.name} onBack={() => back('stocks')} right={<button className="link" onClick={() => setEdit(true)}>編輯</button>}>
        <BrokerageView account={a} />
        {edit && <AccountSheet original={a} onClose={() => setEdit(false)} />}
      </Page>
    );
  }
  return (
    <Page title={a.name} onBack={() => back('accounts')} right={<button className="link" onClick={() => setEdit(true)}>編輯</button>}>
      <div className="card hero">
        <div>
          <div className="label">{accountTypeLabel(a.type)}{a.hidden ? '（已隱藏）' : ''} · 目前餘額</div>
          <div className={`big num ${bal < 0 ? 'expense' : ''}`}>{fmt(bal, a.currency, { exact: true })}</div>
          {a.currency !== 'TWD' && data.fx.latest(a.currency) && <div className="small muted">≈ {fmt(bal * data.fx.latest(a.currency))}（匯率 {data.fx.latest(a.currency)}）</div>}
          <div className="small muted">期初餘額 {fmt(a.opening_balance, a.currency)}</div>
        </div>
        <button className="btn primary" onClick={() => openEntry({ initial: { account_id: id, type: 'expense' } })}><Icon name="plus" className="chev" />在這個帳戶記一筆</button>
      </div>
      {hasFuture && <Seg value={kind} onChange={setKind} options={[{ value: 'all', label: '全部' }, { value: 'past', label: '已發生' }, { value: 'future', label: '未到（交割）' }]} />}
      <TxnList txns={txns} accountId={id} dayTotals={false} />
      {edit && <AccountSheet original={a} onClose={() => setEdit(false)} />}
    </Page>
  );
}
