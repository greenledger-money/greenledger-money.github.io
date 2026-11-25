// 記一筆（新增／修改）：支出、收入、轉帳；內建計算機鍵盤；分帳；轉帳手續費；外幣自動帶匯率
import { useEffect, useMemo, useState } from 'react';
import { useLedger, remember } from '../store.jsx';
import { Icon, Seg, Sheet, Toggle, useAction, useUI } from './kit.jsx';
import { AccountSelect, CategoryButton } from './pickers.jsx';
import { evaluate, hasOperator, press } from '../lib/calc.js';
import { fmt, round2 } from '../lib/money.js';
import { fromInputDateTime, toInputDateTime } from '../lib/dates.js';

const KEYS = ['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '-', '.', '0', '⌫', '+'];

export function Keypad({ onKey, onDone }) {
  return (
    <div className="keypad" role="group" aria-label="計算機">
      {KEYS.map((k) => (
        <button type="button" key={k} className={/[÷×+\-]/.test(k) ? 'op' : ''} onClick={() => onKey(k)} aria-label={k === '⌫' ? '刪除' : k}>
          {k === '-' ? '−' : k}
        </button>
      ))}
      <button type="button" className="op" onClick={() => onKey('C')}>C</button>
      <button type="button" className="op" onClick={() => onKey('=')}>=</button>
      <button type="button" className="ok" style={{ gridColumn: 'span 2' }} onClick={onDone}>完成</button>
    </div>
  );
}

function MiniAmount({ label, expr, active, onFocus, currency, placeholder = '0' }) {
  const v = evaluate(expr);
  return (
    <button type="button" className={`mini-amount ${active ? 'active' : ''}`} onClick={onFocus} aria-label={label}>
      <span className="ph">{hasOperator(expr) ? expr : ''}</span>
      <span className="num">{expr ? (v == null ? expr : fmt(v, currency, { exact: true })) : <span className="ph">{placeholder}</span>}</span>
    </button>
  );
}

export default function EntrySheet({ original, initial = {}, onClose }) {
  const { data, actions } = useLedger();
  const { confirm } = useUI();
  const [run, busy] = useAction();
  const { accById, settings } = data;
  const feeChild = original ? data.transactions.find((t) => t.parent_id === original.id) : null;
  const locked = original && (original.source === 'stock' || original.source === 'dividend');

  const firstAccount = () => {
    const cands = [initial.account_id, original?.account_id, settings.defaultAccountId, remember.get('lastAccount')];
    for (const id of cands) { const a = id && accById.get(id); if (a && (!a.hidden || id === original?.account_id)) return id; }
    return data.accounts.find((a) => !a.hidden && a.type !== 'brokerage' && a.type !== 'friends_owe')?.id ?? null;
  };
  const lastCat = (t) => {
    if (settings.categoryDefault === 'none') return null;
    const id = remember.get(`lastCategory.${t}`);
    const n = id && data.tree.byId.get(id);
    return n && !n.archived && n.kind === t ? id : null;
  };

  const src = original ?? initial;
  const [type, setType] = useState(src.type ?? 'expense');
  const [ex, setEx] = useState({
    amount: src.amount != null ? String(Number(src.amount)) : '',
    mine: '',
    fee: feeChild ? String(Number(feeChild.amount)) : '',
    to_amount: original?.to_amount != null ? String(Number(original.to_amount)) : '',
  });
  const [active, setActive] = useState(original || !settings.keypadOnOpen ? null : 'amount');
  const [accountId, setAccountId] = useState(firstAccount);
  const [toAccountId, setToAccountId] = useState(src.to_account_id ?? null);
  const [categoryId, setCategoryId] = useState(src.category_id ?? (src.type === 'transfer' ? null : lastCat(src.type ?? 'expense')));
  const [when, setWhen] = useState(toInputDateTime(src.occurred_at ?? new Date().toISOString()));
  const [note, setNote] = useState(src.note ?? '');
  const [isException, setIsException] = useState(!!src.is_exception);
  const [split, setSplit] = useState(false);
  const [fxRate, setFxRate] = useState(original ? String(Number(original.fx_rate)) : '');
  const [toFxRate, setToFxRate] = useState(original?.to_fx_rate ? String(Number(original.to_fx_rate)) : '');
  const [manual, setManual] = useState({ fx: !!original, toFx: !!original, toAmount: !!original });
  const [error, setError] = useState('');
  const [tplName, setTplName] = useState(null);

  const acc = accById.get(accountId);
  const toAcc = accById.get(toAccountId);
  const currency = acc?.currency ?? 'TWD';
  const toCurrency = toAcc?.currency ?? 'TWD';
  const date = when.slice(0, 10);
  const amount = evaluate(ex.amount);
  const crossCurrency = type === 'transfer' && toAcc && toCurrency !== currency;

  // 換類型時，分類換成該類型上次用的
  const changeType = (t) => {
    setType(t); setError('');
    if (t !== 'transfer' && data.tree.byId.get(categoryId)?.kind !== t) setCategoryId(lastCat(t));
    if (t !== 'expense') setSplit(false);
  };

  // 外幣：自動帶當天匯率（當天沒有就用最近一天），可以手動改
  const autoRate = useMemo(() => data.fx.lookup(currency, date), [data.fx, currency, date]);
  const autoToRate = useMemo(() => data.fx.lookup(toCurrency, date), [data.fx, toCurrency, date]);
  useEffect(() => { if (!manual.fx) setFxRate(currency === 'TWD' ? '1' : autoRate ? String(autoRate.rate) : ''); }, [currency, autoRate, manual.fx]);
  useEffect(() => { if (!manual.toFx) setToFxRate(toCurrency === 'TWD' ? '1' : autoToRate ? String(autoToRate.rate) : ''); }, [toCurrency, autoToRate, manual.toFx]);
  useEffect(() => {
    if (type !== 'transfer' || manual.toAmount) return;
    if (!crossCurrency) { setEx((e) => ({ ...e, to_amount: amount != null ? String(amount) : '' })); return; }
    const r1 = Number(fxRate); const r2 = Number(toFxRate);
    setEx((e) => ({ ...e, to_amount: amount != null && r1 > 0 && r2 > 0 ? String(round2(amount * r1 / r2)) : '' }));
  }, [amount, fxRate, toFxRate, crossCurrency, type, manual.toAmount]);

  // 交換轉出、轉入；跨幣別時金額也一起對調
  const swapAccounts = () => {
    if (!toAccountId) return;
    const from = accountId;
    setAccountId(toAccountId); setToAccountId(from);
    if (crossCurrency) setEx((e) => ({ ...e, amount: e.to_amount, to_amount: e.amount }));
    setManual((m) => ({ ...m, fx: false, toFx: false }));
    setError('');
  };

  const onKey = (k) => {
    setError('');
    setEx((e) => ({ ...e, [active]: press(e[active], k) }));
    if (active === 'to_amount') setManual((m) => ({ ...m, toAmount: true }));
  };
  const finishKeypad = () => {
    setEx((e) => { const v = evaluate(e[active]); return v == null ? e : { ...e, [active]: String(v) }; });
    setActive(null);
  };

  function buildForm() {
    if (!(amount > 0)) throw new Error(split ? '請輸入總額' : '請輸入金額');
    if (!acc) throw new Error('請選擇帳戶');
    if (type !== 'transfer' && !categoryId) throw new Error('請選擇分類');
    if (type === 'transfer') {
      if (!toAcc) throw new Error('請選擇轉入帳戶');
      if (toAcc.id === acc.id) throw new Error('轉出和轉入不能是同一個帳戶');
    }
    if (!(Number(fxRate) > 0)) throw new Error(`請填 ${currency} 匯率（找不到當天或之前的匯率）`);
    if (type === 'transfer' && !(Number(toFxRate) > 0)) throw new Error(`請填 ${toCurrency} 匯率`);
    const toAmount = type === 'transfer' ? (crossCurrency ? evaluate(ex.to_amount) : amount) : null;
    if (type === 'transfer' && !(toAmount > 0)) throw new Error('請填對方收到的金額');
    const form = {
      type, amount, account_id: acc.id, category_id: categoryId, occurred_at: fromInputDateTime(when),
      note, is_exception: isException, fx_rate: Number(fxRate), to_account_id: toAcc?.id, to_amount: toAmount,
      to_fx_rate: Number(toFxRate) || 1, fee: type === 'transfer' ? evaluate(ex.fee) ?? 0 : 0,
      pending_item_id: initial.pending_item_id, source: initial.source,
    };
    if (split) {
      const mine = evaluate(ex.mine);
      if (mine == null || mine < 0) throw new Error('請輸入自己的部分（沒吃就填 0）');
      if (mine > amount) throw new Error('自己的部分不能大於總額');
      if (!data.friendsOwe) throw new Error('找不到「朋友欠我」帳戶');
      form.split = { mine };
    }
    return form;
  }

  async function save() {
    let form;
    try { form = buildForm(); } catch (e) { setError(e.message); return; }
    const ok = await run(() => actions.saveTxn(form, original), original ? '已更新' : split ? '已記帳（分帳）' : '已記帳');
    if (ok) onClose(true);
  }

  async function remove() {
    const group = original.group_id ? data.transactions.filter((t) => t.group_id === original.group_id).length : 1;
    const msg = group > 1 ? '會一併刪除分帳的「朋友欠我」紀錄。確定刪除？'
      : feeChild ? '會一併刪除手續費紀錄。確定刪除？' : '確定刪除這筆？';
    if (!(await confirm(msg, { ok: '刪除', danger: true }))) return;
    if (await run(() => actions.deleteTxn(original), '已刪除')) onClose(true);
  }

  async function saveAsTemplate() {
    if (!tplName?.trim()) { setError('請輸入範本名稱'); return; }
    const ok = await run(() => actions.saveTemplate({
      name: tplName, mode: 'fill', type, account_id: accountId, to_account_id: toAccountId, category_id: categoryId,
      amount: amount ?? '', note, is_exception: isException,
    }), '已存成範本');
    if (ok) setTplName(null);
  }

  const title = initial.pending_item_id ? '確認固定收支' : original ? '修改' : '記一筆';
  if (locked) {
    return (
      <Sheet title="交易明細" onClose={() => onClose(false)}>
        <div className="notice">此筆由{original.source === 'dividend' ? '股利' : original.type === 'transfer' ? '股票交割' : '股票賣出損益'}自動產生，請至「股票」修改。</div>
        <div className="formlist">
          <div className="frow"><span className="lbl">金額</span><div className="ctrl num">{fmt(original.amount, currency)}</div></div>
          <div className="frow"><span className="lbl">帳戶</span><div className="ctrl">{acc?.name}{toAcc ? ` → ${toAcc.name}` : ''}</div></div>
          <div className="frow"><span className="lbl">備註</span><div className="ctrl">{original.note}</div></div>
        </div>
        <a className="btn block" href="#stocks" onClick={() => onClose(false)}>前往股票頁</a>
      </Sheet>
    );
  }

  return (
    <Sheet title={title} onClose={() => onClose(false)} onSave={save} saving={busy} full>
      <Seg label="類型" value={type} onChange={changeType} options={[{ value: 'expense', label: '支出' }, { value: 'income', label: '收入' }, { value: 'transfer', label: '轉帳' }]} />

      <button type="button" className={`amount-box ${active === 'amount' ? 'active' : ''}`} onClick={() => setActive('amount')} aria-label="金額">
        <span className="lbl"><span>{split ? '總額（幫大家付的）' : '金額'}</span><span>{currency}</span></span>
        <span className="expr num">{hasOperator(ex.amount) ? ex.amount.replace(/-/g, '−') : ''}</span>
        <span className={`val num ${type === 'expense' ? 'expense' : type === 'income' ? 'income' : ''}`}>{fmt(amount ?? 0, currency, { exact: true })}</span>
      </button>

      {split && (
        <div className="formlist">
          <div className="frow"><span className="lbl">自己的部分</span><div className="ctrl"><MiniAmount label="自己的部分" expr={ex.mine} active={active === 'mine'} onFocus={() => setActive('mine')} currency={currency} placeholder="沒吃就填 0" /></div></div>
          <div className="frow small muted" style={{ minHeight: 40 }}>
            記成：支出 {fmt(evaluate(ex.mine) ?? 0, currency)}，另外 {fmt(Math.max(0, (amount ?? 0) - (evaluate(ex.mine) ?? 0)), currency)} 轉進「朋友欠我」
          </div>
        </div>
      )}

      <div className="formlist">
        <div className="frow">
          <label htmlFor="acc">{type === 'transfer' ? '轉出' : '帳戶'}</label>
          <div className="ctrl"><AccountSelect id="acc" className="" value={accountId} onChange={(v) => { setAccountId(v); setManual((m) => ({ ...m, fx: false })); }} /></div>
        </div>
        {type === 'transfer' && (
          <div className="frow">
            <span className="lbl swap-lbl">
              <label htmlFor="to">轉入</label>
              <button type="button" className="swapbtn" onClick={swapAccounts} disabled={!toAccountId} aria-label="交換轉出和轉入帳戶" title="交換轉出、轉入">
                <Icon name="swapV" />
              </button>
            </span>
            <div className="ctrl"><AccountSelect id="to" className="" value={toAccountId} placeholder="選擇轉入帳戶" filter={(a) => a.id !== accountId} onChange={(v) => { setToAccountId(v); setManual((m) => ({ ...m, toFx: false, toAmount: false })); }} /></div>
          </div>
        )}
        {crossCurrency && (
          <div className="frow"><span className="lbl">對方收到</span><div className="ctrl"><MiniAmount label="對方收到" expr={ex.to_amount} active={active === 'to_amount'} onFocus={() => setActive('to_amount')} currency={toCurrency} /></div></div>
        )}
        {type === 'transfer' && (
          <div className="frow"><span className="lbl">手續費</span><div className="ctrl"><MiniAmount label="手續費" expr={ex.fee} active={active === 'fee'} onFocus={() => setActive('fee')} currency={currency} placeholder="沒有就留空" /></div></div>
        )}
        {type !== 'transfer' && (
          <div className="frow"><span className="lbl">分類</span><div className="ctrl"><CategoryButton kind={type} value={categoryId} onChange={setCategoryId} /></div></div>
        )}
        <div className="frow">
          <label htmlFor="when">時間</label>
          <div className="ctrl"><input id="when" type="datetime-local" value={when} onChange={(e) => e.target.value && setWhen(e.target.value)} /></div>
        </div>
        <div className="frow">
          <label htmlFor="note">備註</label>
          <div className="ctrl"><input id="note" value={note} maxLength={500} placeholder="選填" onChange={(e) => setNote(e.target.value)} onFocus={() => setActive(null)} /></div>
        </div>
        {currency !== 'TWD' && (
          <div className="frow">
            <label htmlFor="fx">{currency} 匯率</label>
            <div className="ctrl"><input id="fx" inputMode="decimal" value={fxRate} placeholder="請手動填" onFocus={() => setActive(null)} onChange={(e) => { setFxRate(e.target.value); setManual((m) => ({ ...m, fx: true })); }} /></div>
          </div>
        )}
        {type === 'transfer' && toCurrency !== 'TWD' && toCurrency !== currency && (
          <div className="frow">
            <label htmlFor="tofx">{toCurrency} 匯率</label>
            <div className="ctrl"><input id="tofx" inputMode="decimal" value={toFxRate} placeholder="請手動填" onFocus={() => setActive(null)} onChange={(e) => { setToFxRate(e.target.value); setManual((m) => ({ ...m, toFx: true })); }} /></div>
          </div>
        )}
        {type !== 'transfer' && (
          <div className="frow"><span className="lbl">例外</span><span className="grow small muted">不規律的大額支出</span><Toggle label="例外" checked={isException} onChange={setIsException} /></div>
        )}
        {type === 'expense' && !original && !initial.pending_item_id && (
          <div className="frow"><span className="lbl">分帳</span><span className="grow small muted">代墊，朋友之後還款</span><Toggle label="分帳" checked={split} onChange={(v) => { setSplit(v); if (v) setActive('mine'); }} /></div>
        )}
      </div>

      {currency !== 'TWD' && autoRate && !manual.fx && autoRate.date !== date && (
        <p className="small muted">無當日匯率，採用 {autoRate.date} 匯率。</p>
      )}
      {error && <div className="error" role="alert">{error}</div>}

      {!active && (
        <div className="grid2">
          {original ? <button type="button" className="btn danger" onClick={remove} disabled={busy}><Icon name="trash" className="chev" />刪除</button>
            : <button type="button" className="btn" onClick={() => setTplName(tplName == null ? '' : null)}>存成範本</button>}
          <button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? '儲存中…' : '儲存'}</button>
        </div>
      )}
      {tplName != null && !active && (
        <div className="row-flex">
          <input className="input grow" placeholder="範本名稱，例如：早餐" value={tplName} onChange={(e) => setTplName(e.target.value)} />
          <button type="button" className="btn primary" onClick={saveAsTemplate} disabled={busy}>存</button>
        </div>
      )}
      {active && <Keypad onKey={onKey} onDone={finishKeypad} />}
    </Sheet>
  );
}
