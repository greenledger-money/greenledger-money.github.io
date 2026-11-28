// 記一筆（新增／修改）：支出、收入、轉帳；內建計算機鍵盤；分帳；轉帳手續費；外幣自動帶匯率
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLedger, remember } from '../store.jsx';
import { Icon, Sheet, Tile, Toggle, accountIcon, categoryIcon, useAction, useUI } from './kit.jsx';
import { AccountSelect, CategoryPicker } from './pickers.jsx';
import { evaluate, hasOperator, press } from '../lib/calc.js';
import { fmt, round2 } from '../lib/money.js';
import { addDays, fromInputDateTime, toInputDateTime } from '../lib/dates.js';
import { exceptionSource } from '../lib/categories.js';
import { costRate, foreignFeeOf, foreignToTwd } from '../lib/ledger.js';

const CUR_NAMES = { TWD: '台幣', JPY: '日圓', USD: '美元', KRW: '韓元', EUR: '歐元', THB: '泰銖', HKD: '港幣', CNY: '人民幣', SGD: '新幣', GBP: '英鎊', AUD: '澳幣', CAD: '加幣', CHF: '瑞郎', NZD: '紐幣' };

// 鍵盤：5 欄，數字在左、運算在右（像 CWMoney）
const PAD = [
  ['7', '8', '9', '×', '÷'],
  ['4', '5', '6', '-', 'C'],
  ['1', '2', '3', '+', '⌫'],
];
const LABEL = { '-': '−', C: 'AC', '⌫': '⌫' };
const ARIA = { '⌫': '刪除', C: '清除', '-': '減', '+': '加', '×': '乘', '÷': '除' };

export function Keypad({ onKey, onDone }) {
  return (
    <div className="keypad" role="group" aria-label="計算機">
      <div className="kp-bar"><button type="button" className="kp-hide" onClick={onDone} aria-label="收起鍵盤"><Icon name="chev" /></button></div>
      <div className="kp-grid">
        {PAD.flat().map((k) => (
          <button type="button" key={k} data-k={k} className={/^\d$/.test(k) ? 'num' : 'op'} onClick={() => onKey(k)} aria-label={ARIA[k] ?? k}>
            {k === '⌫' ? <Icon name="arrowLeft" /> : (LABEL[k] ?? k)}
          </button>
        ))}
        <button type="button" className="num" data-k="00" onClick={() => onKey('00')}>00</button>
        <button type="button" className="num" data-k="0" onClick={() => onKey('0')}>0</button>
        <button type="button" className="num" data-k="." onClick={() => onKey('.')} aria-label="小數點">.</button>
        <button type="button" className="ok" onClick={onDone}>OK</button>
      </div>
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
  const { confirm, toast, openEntry } = useUI();
  const [run, busy] = useAction();
  const { accById, settings } = data;
  const feeChild = original ? data.transactions.find((t) => t.parent_id === original.id) : null;
  const locked = original && (original.source === 'stock' || original.source === 'dividend');

  const firstAccount = () => {
    const cands = [initial.account_id, original?.account_id, settings.defaultAccountId, remember.get('lastAccount')];
    for (const id of cands) { const a = id && accById.get(id); if (a && (!a.hidden || id === original?.account_id)) return id; }
    return data.accounts.find((a) => !a.hidden && a.type !== 'brokerage' && a.type !== 'friends_owe')?.id ?? null;
  };
  // 預設分類：'first' 第一個主分類（分類選單最上面那個）｜'last' 上次選的｜'none' 不帶
  const lastCat = (t) => {
    const mode = settings.categoryDefault;
    if (mode === 'none') return null;
    if (mode === 'first') return data.tree.roots[t]?.find((n) => !n.archived)?.id ?? null;
    const id = remember.get(`lastCategory.${t}`);
    const n = id && data.tree.byId.get(id);
    return n && !n.archived && n.kind === t ? id : null;
  };

  const src = original ?? initial;
  const [type, setType] = useState(src.type ?? 'expense');
  const [ex, setEx] = useState({
    amount: original?.orig_currency ? String(Number(original.orig_amount)) : src.amount != null ? String(Number(src.amount)) : '',
    twd: original?.orig_currency ? String(Number(original.amount)) : '',
    mine: '',
    fee: feeChild ? String(Number(feeChild.amount)) : '',
    to_amount: original?.to_amount != null ? String(Number(original.to_amount)) : '',
  });
  const [active, setActive] = useState(original || !settings.keypadOnOpen ? null : 'amount');
  const [accountId, setAccountId] = useState(firstAccount);
  const [toAccountId, setToAccountId] = useState(src.to_account_id ?? null);
  const initCat = src.category_id ?? (src.type === 'transfer' ? null : lastCat(src.type ?? 'expense'));
  const [categoryId, setCategoryId] = useState(initCat);
  const alwaysExc = (id) => !!exceptionSource(data.tree, id, data.settings.exceptionCats);
  const [when, setWhen] = useState(toInputDateTime(src.occurred_at ?? new Date().toISOString()));
  const [note, setNote] = useState(src.note ?? '');
  const [isException, setIsException] = useState(!!src.is_exception || (!original && alwaysExc(initCat)));
  const [split, setSplit] = useState(false);
  const [who, setWho] = useState(src.counterparty ?? '');
  const [fxRate, setFxRate] = useState(original ? String(Number(original.fx_rate)) : '');
  const [toFxRate, setToFxRate] = useState(original?.to_fx_rate ? String(Number(original.to_fx_rate)) : '');
  const [manual, setManual] = useState({ fx: !!original, toFx: !!original, toAmount: !!original, twd: !!original?.orig_currency });
  // 台幣帳戶（刷卡、台幣錢包）付外幣：選了外幣就打外幣金額，自動換算台幣；選過的幣別會記住（出國時不用每筆重選）
  const [payCur, setPayCur] = useState(original ? (original.orig_currency ?? null) : (remember.get('tripCurrency') || null));
  const [error, setError] = useState('');
  // 「再記一筆」帶入的金額：第一次按數字直接取代，按運算子則接在後面（例如 +50）
  const [freshAmount, setFreshAmount] = useState(!!initial.repeat);
  const [tplName, setTplName] = useState(null);
  const [tab, setTab] = useState(src.type ?? 'expense');
  const [advanced, setAdvanced] = useState(false);
  const advRef = useRef(null);
  const [pickCat, setPickCat] = useState(false);

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
  // 外幣現金花掉：用換匯成本（當初換的台幣 ÷ 拿到的外幣），花掉的台幣＝當初付的台幣
  const cost = useMemo(() => (currency !== 'TWD' && type === 'expense' ? costRate(data.transactions, acc, date, original?.id) : null),
    [data.transactions, acc, currency, type, date, original?.id]);
  const foreignPay = type !== 'transfer' && currency === 'TWD' && payCur && payCur !== 'TWD' ? payCur : null;
  const payRate = useMemo(() => (foreignPay ? (data.fx.lookup(foreignPay, date)?.rate ?? data.fx.latest(foreignPay)) : null), [data.fx, foreignPay, date]);
  const feePct = type === 'expense' ? foreignFeeOf(acc) : 0;
  const twdAuto = foreignPay ? foreignToTwd(amount, payRate, feePct) : null;
  const twdAmount = foreignPay ? (manual.twd ? evaluate(ex.twd) : twdAuto) : null;
  const autoToRate = useMemo(() => data.fx.lookup(toCurrency, date), [data.fx, toCurrency, date]);
  useEffect(() => {
    if (manual.fx) return;
    setFxRate(currency === 'TWD' ? '1' : cost ? String(Math.round(cost * 1e8) / 1e8) : autoRate ? String(autoRate.rate) : '');
  }, [currency, autoRate, cost, manual.fx]);
  useEffect(() => { if (!manual.toFx) setToFxRate(toCurrency === 'TWD' ? '1' : autoToRate ? String(autoToRate.rate) : ''); }, [toCurrency, autoToRate, manual.toFx]);
  useEffect(() => {
    if (type !== 'transfer' || manual.toAmount) return;
    if (!crossCurrency) { setEx((e) => ({ ...e, to_amount: amount != null ? String(amount) : '' })); return; }
    const r1 = Number(fxRate); const r2 = Number(toFxRate);
    setEx((e) => ({ ...e, to_amount: amount != null && r1 > 0 && r2 > 0 ? String(round2(amount * r1 / r2)) : '' }));
  }, [amount, fxRate, toFxRate, crossCurrency, type, manual.toAmount]);

  // 打開進階設定後捲到看得到的位置（內容在最下面，不捲的話會以為沒打開）
  useEffect(() => { if (advanced) advRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [advanced]);

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
    const replace = freshAmount && active === 'amount' && /^[0-9.]/.test(k);
    if (active === 'amount') setFreshAmount(false);
    setEx((e) => ({ ...e, [active]: press(replace ? '' : e[active], k) }));
    if (active === 'to_amount') setManual((m) => ({ ...m, toAmount: true }));
    if (active === 'twd') setManual((m) => ({ ...m, twd: true }));
    if (active === 'amount' && foreignPay) setManual((m) => ({ ...m, twd: false })); // 改了外幣金額 → 台幣重算
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
    if (foreignPay && !(twdAmount > 0)) throw new Error(`找不到 ${foreignPay} 匯率，請在下面填台幣金額`);
    if (type === 'transfer' && !(Number(toFxRate) > 0)) throw new Error(`請填 ${toCurrency} 匯率`);
    const toAmount = type === 'transfer' ? (crossCurrency ? evaluate(ex.to_amount) : amount) : null;
    if (type === 'transfer' && !(toAmount > 0)) throw new Error('請填對方收到的金額');
    const form = {
      type, amount, account_id: acc.id, category_id: categoryId, occurred_at: fromInputDateTime(when),
      note, is_exception: isException, fx_rate: Number(fxRate), to_account_id: toAcc?.id, to_amount: toAmount,
      to_fx_rate: Number(toFxRate) || 1, fee: type === 'transfer' ? evaluate(ex.fee) ?? 0 : 0,
      pending_item_id: initial.pending_item_id, source: initial.source,
      counterparty: (split || friendsXfer) ? (who.trim() || null) : null,
    };
    if (foreignPay) Object.assign(form, { amount: twdAmount, fx_rate: 1, orig_currency: foreignPay, orig_amount: amount });
    if (split) {
      const mine = evaluate(ex.mine);
      if (mine == null || mine < 0) throw new Error('請輸入自己的部分（沒吃就填 0）');
      if (mine > amount) throw new Error('自己的部分不能大於總額');
      if (!data.friendsOwe) throw new Error('找不到「朋友欠我」帳戶');
      form.split = { mine };
      if (foreignPay) {
        // 分帳＋外幣：自己的部分照同樣比例換成台幣，原幣金額寫進備註
        form.split = { mine: Math.round((mine * twdAmount) / amount) };
        form.note = `${note}${note ? ' ' : ''}（${foreignPay} ${amount}）`;
        form.orig_currency = null; form.orig_amount = null;
      }
    }
    return form;
  }

  /** 「再記一筆」要帶入的資料：剛剛填的內容（不含分帳、手續費、待確認的連結） */
  const repeatInitial = () => ({
    repeat: true, type, amount: evaluate(ex.amount) ?? '', account_id: accountId, to_account_id: toAccountId,
    category_id: type === 'transfer' ? null : categoryId, note, is_exception: isException,
    occurred_at: fromInputDateTime(when), counterparty: who || null,
  });

  /** again = true：存好後馬上開一張帶入同樣資料的新表單 */
  async function save(again = false) {
    let form;
    try { form = buildForm(); } catch (e) { setError(e.message); return; }
    const next = repeatInitial();
    const msg = original ? '已更新' : split ? '已記帳（分帳）' : '已記帳';
    const ok = await run(() => actions.saveTxn(form, original));
    if (!ok) return;
    if (!original && type !== 'transfer' && currency === 'TWD') remember.set('tripCurrency', foreignPay ?? '');
    onClose(true);
    if (again) { toast(msg); openEntry({ initial: next }); return; }
    // 新記的一筆：提示裡附「再記一筆」，不想再記就讓它自己消失
    if (!original && !initial.pending_item_id) toast(msg, { action: { label: '再記一筆', onClick: () => openEntry({ initial: next }) } });
    else toast(msg);
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

  const title = initial.pending_item_id ? (initial.source === 'recurring' ? '確認固定收支' : '確認這筆') : original ? '修改' : initial.repeat ? '再記一筆' : '記一筆';
  const canRepeat = !original && !initial.pending_item_id;
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

  const chain = categoryId ? data.tree.chain(categoryId) : [];
  const leaf = chain[chain.length - 1];
  const parentPath = chain.slice(0, -1).map((c) => c.name).join('-');
  const [y, mo, d] = date.split('-');
  const shiftDay = (n) => setWhen(`${addDays(date, n)}${when.slice(10)}`);
  const balanceOf = (a) => (a ? fmt(data.balances.get(a.id), a.currency, { exact: true }) : '');
  const canTemplate = !original && !initial.pending_item_id;
  const showAdvanced = advanced || split || (tplName != null);
  // 計算機開著時，進階設定會長在鍵盤底下被蓋住：打開時先把鍵盤收起來（等於按 OK）
  const toggleAdvanced = () => {
    const open = !showAdvanced;
    if (open && active) finishKeypad();
    setAdvanced(open);
  };
  const toAmountShown = crossCurrency ? evaluate(ex.to_amount) : amount;
  const friendsXfer = type === 'transfer' && (acc?.type === 'friends_owe' || toAcc?.type === 'friends_owe');
  const people = useMemo(() => {
    const m = new Map();
    data.transactions.forEach((t) => { if (t.counterparty) m.set(t.counterparty, (m.get(t.counterparty) ?? 0) + 1); });
    return [...m].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  }, [data.transactions]);
  const whoRow = (
    <div className="frow">
      <label htmlFor="who" className="lbl">誰</label>
      <div className="ctrl">
        <input id="who" list="who-list" maxLength={40} value={who} placeholder="朋友的名字（可不填）" onFocus={() => setActive(null)} onChange={(e) => setWho(e.target.value)} />
        <datalist id="who-list">{people.map((n) => <option key={n} value={n} />)}</datalist>
      </div>
    </div>
  );

  const applyTemplate = (t) => {
    changeType(t.type);
    if (t.account_id && accById.get(t.account_id)) setAccountId(t.account_id);
    setToAccountId(t.to_account_id ?? null);
    if (t.type !== 'transfer') setCategoryId(t.category_id ?? null);
    setEx((e) => ({ ...e, amount: t.amount != null && t.amount !== '' ? String(Number(t.amount)) : e.amount }));
    if (t.note) setNote(t.note);
    setIsException(!!t.is_exception);
    setTab(t.type);
    if (t.amount == null || t.amount === '') setActive('amount');
  };

  return (
    <Sheet title={title} onClose={() => onClose(false)} onSave={() => save()} saving={busy} full>
      <div className="etabs" role="tablist">
        {[...(canTemplate ? [['templates', '範本']] : []), ['expense', '支出'], ['income', '收入'], ['transfer', '轉帳']].map(([v, l]) => (
          <button key={v} type="button" role="tab" aria-selected={tab === v} onClick={() => { setTab(v); if (v !== 'templates') changeType(v); }}>{l}</button>
        ))}
      </div>

      {tab === 'templates' ? (
        <div className="list">
          {data.templates.length ? data.templates.map((t) => (
            <button key={t.id} type="button" className="item" onClick={() => applyTemplate(t)}>
              {t.type === 'transfer' ? <Tile name="swap" tone="plain" round size={38} /> : <Tile name={categoryIcon(data.tree, t.category_id)} tone={t.type === 'income' ? 'income' : ''} round size={38} />}
              <div className="main"><div className="title">{t.name}</div><div className="sub">{t.type === 'transfer' ? `${accById.get(t.account_id)?.name ?? ''} → ${accById.get(t.to_account_id)?.name ?? ''}` : t.category_id ? data.tree.path(t.category_id) : ''}</div></div>
              {t.amount != null && t.amount !== '' && <span className="num">{fmt(t.amount)}</span>}
            </button>
          )) : <div className="empty">還沒有範本</div>}
        </div>
      ) : (
        <>
          {type !== 'transfer' ? (
            <>
            <div className="ehero">
              <button type="button" className="catcard" onClick={() => { setActive(null); setPickCat(true); }} aria-label={`分類：${leaf ? data.tree.path(leaf.id) : '未選'}`}>
                <Tile name={categoryIcon(data.tree, categoryId)} tone={type === 'income' ? 'income' : ''} round size={52} />
                {parentPath && <span className="cc-parent">{parentPath}</span>}
                <b className="cc-leaf">{leaf ? leaf.name : '選擇分類'}</b>
                <Icon name="chev" className="chev down" />
              </button>
              <div className="hamt-wrap">
                <button type="button" className={`hamt ${active === 'amount' ? 'active' : ''}`} onClick={() => setActive('amount')} aria-label="金額">
                  <span className="cur">{split ? '總額' : ''}</span>
                  <span className="expr num">{hasOperator(ex.amount) ? ex.amount.replace(/-/g, '−') : ''}</span>
                  <span className={`val num ${type}`}>{fmt(amount ?? 0, foreignPay ?? currency, { exact: true })}</span>
                </button>
                {currency === 'TWD' ? (
                  <label className={`curchip ${foreignPay ? 'on' : ''}`}>
                    {foreignPay ? `${CUR_NAMES[foreignPay] ?? foreignPay} ${foreignPay}` : '台幣'}<Icon name="chev" className="caret" />
                    <select aria-label="幣別" value={foreignPay ?? 'TWD'} onChange={(e) => { setPayCur(e.target.value === 'TWD' ? null : e.target.value); setManual((m) => ({ ...m, twd: false })); }}>
                      {Object.entries(CUR_NAMES).map(([c, n]) => <option key={c} value={c}>{n} {c}</option>)}
                    </select>
                  </label>
                ) : <span className="curchip static">{CUR_NAMES[currency] ?? currency} {currency}</span>}
              </div>
            </div>
            {foreignPay && (
              <button type="button" className={`fxline ${active === 'twd' ? 'active' : ''}`} onClick={() => { setEx((e) => ({ ...e, twd: '' })); setActive('twd'); }} aria-label="台幣金額（帳單出來可以改）">
                <span className="grow">
                  {manual.twd ? '台幣（自己填的）' : `匯率 ${payRate ? Math.round(payRate * 10000) / 10000 : '—'}${feePct ? `＋海外手續費 ${feePct}%` : ''}`}
                </span>
                <b className="num">{active === 'twd' && ex.twd ? fmt(evaluate(ex.twd) ?? 0) : twdAmount != null ? `≈ ${fmt(twdAmount)}` : '—'}</b>
                <Icon name="chev" className="chev" />
              </button>
            )}
            {currency !== 'TWD' && type === 'expense' && cost && !manual.fx && amount > 0 && (
              <div className="fxline static"><span className="grow">用換匯成本 1 {currency} ＝ {Math.round(cost * 10000) / 10000} 元</span><b className="num">≈ {fmt(amount * cost)}</b></div>
            )}
            </>
          ) : (
            <div className="xfer">
              <div className="xacc">
                <Tile name={accountIcon(acc)} round size={48} />
                <b>{acc?.name ?? '轉出帳戶'}</b>
                <AccountSelect id="acc" className="overlay-select" value={accountId} onChange={(v) => { setAccountId(v); setManual((m) => ({ ...m, fx: false })); }} />
              </div>
              <button type="button" className="swapbtn" onClick={swapAccounts} disabled={!toAccountId} aria-label="交換轉出和轉入帳戶"><Icon name="swap" /></button>
              <div className="xacc right">
                <b>{toAcc?.name ?? '轉入帳戶'}</b>
                {toAcc ? <Tile name={accountIcon(toAcc)} round size={48} /> : <Tile name="plus" tone="plain" round size={48} />}
                <AccountSelect id="to" className="overlay-select" value={toAccountId} placeholder="選擇轉入帳戶" filter={(a) => a.id !== accountId} onChange={(v) => { setToAccountId(v); setManual((m) => ({ ...m, toFx: false, toAmount: false })); }} />
              </div>
              <button type="button" className={`xamt from ${active === 'amount' ? 'active' : ''}`} onClick={() => setActive('amount')} aria-label="轉出金額">
                <span className="lbl">轉出金額 <i>{currency}</i></span>
                <span className="num">{hasOperator(ex.amount) ? ex.amount.replace(/-/g, '−') : fmt(amount ?? 0, currency, { exact: true })}</span>
              </button>
              <button type="button" className={`xamt to ${active === 'to_amount' ? 'active' : ''}`} onClick={() => crossCurrency && setActive('to_amount')} disabled={!crossCurrency} aria-label="轉入金額">
                <span className="lbl">轉入金額 <i>{toCurrency}</i></span>
                <span className="num">{fmt(toAmountShown ?? 0, toCurrency, { exact: true })}</span>
              </button>
            </div>
          )}

          {split && (
            <div className="formlist">
              <div className="frow"><span className="lbl">自己的部分</span><div className="ctrl"><MiniAmount label="自己的部分" expr={ex.mine} active={active === 'mine'} onFocus={() => setActive('mine')} currency={foreignPay ?? currency} placeholder="沒吃就填 0" /></div></div>
              {whoRow}
              <div className="frow small muted" style={{ minHeight: 40 }}>
                支出 {fmt(evaluate(ex.mine) ?? 0, foreignPay ?? currency)}，{fmt(Math.max(0, (amount ?? 0) - (evaluate(ex.mine) ?? 0)), foreignPay ?? currency)} 記到「朋友欠我」
              </div>
            </div>
          )}
          {friendsXfer && <div className="formlist">{whoRow}</div>}

          <div className="datebar">
            <button type="button" aria-label="前一天" onClick={() => shiftDay(-1)}><Icon name="back" /></button>
            <label className="db-mid">
              <span className="num">{y}/{mo}/{d}</span><span className="small muted num">{when.slice(11, 16)}</span>
              <input id="when" type="datetime-local" aria-label="時間" value={when} onChange={(e) => e.target.value && setWhen(e.target.value)} />
            </label>
            <button type="button" aria-label="後一天" onClick={() => shiftDay(1)}><Icon name="chev" /></button>
          </div>

          {type !== 'transfer' ? (
            <div className="efield">
              <span className="elabel">帳戶</span>
              <div className="ebox">
                <span className="grow">{acc?.name ?? '選擇帳戶'}{acc && acc.currency !== 'TWD' ? `（${acc.currency}）` : ''}</span>
                {acc && acc.type !== 'brokerage' && <span className="small">餘額 <b className={`num ${data.balances.get(acc.id) < 0 ? 'expense' : ''}`}>{balanceOf(acc)}</b></span>}
                <AccountSelect id="acc" className="overlay-select" value={accountId} onChange={(v) => { setAccountId(v); setManual((m) => ({ ...m, fx: false })); }} />
              </div>
            </div>
          ) : (
            <div className="efield">
              <span className="elabel">手續費</span>
              <MiniAmount label="手續費" expr={ex.fee} active={active === 'fee'} onFocus={() => setActive('fee')} currency={currency} placeholder="請輸入金額" />
            </div>
          )}

          <textarea className="input enote" rows={3} maxLength={500} placeholder="請輸入備註" aria-label="備註" value={note} onChange={(e) => setNote(e.target.value)} onFocus={() => setActive(null)} />

          {type !== 'transfer' && (
            <div className="erow"><span className="grow">例外<span className="small muted">　不規律的大額支出</span></span><Toggle label="例外" checked={isException} onChange={setIsException} /></div>
          )}

          <button type="button" className="adv-toggle" aria-expanded={showAdvanced} onClick={toggleAdvanced}>
            <span>進階設定</span><Icon name="chev" className={`chev ${showAdvanced ? 'up' : 'down'}`} />
          </button>
          {showAdvanced && (
            <div className="formlist" ref={advRef}>
              {type === 'expense' && !original && !initial.pending_item_id && (
                <div className="frow"><span className="lbl">分帳</span><span className="grow small muted">代墊，朋友之後還款</span><Toggle label="分帳" checked={split} onChange={(v) => { setSplit(v); if (v) setActive('mine'); }} /></div>
              )}
              {currency !== 'TWD' && (
                <div className="frow">
                  <label htmlFor="fx">{currency} 匯率</label>
                  <div className="ctrl"><input id="fx" inputMode="decimal" value={fxRate} placeholder="請輸入" onFocus={() => setActive(null)} onChange={(e) => { setFxRate(e.target.value); setManual((m) => ({ ...m, fx: true })); }} /></div>
                </div>
              )}
              {type === 'transfer' && toCurrency !== 'TWD' && toCurrency !== currency && (
                <div className="frow">
                  <label htmlFor="tofx">{toCurrency} 匯率</label>
                  <div className="ctrl"><input id="tofx" inputMode="decimal" value={toFxRate} placeholder="請輸入" onFocus={() => setActive(null)} onChange={(e) => { setToFxRate(e.target.value); setManual((m) => ({ ...m, toFx: true })); }} /></div>
                </div>
              )}
              {canTemplate && (
                <div className="frow">
                  <span className="lbl">存成範本</span>
                  <div className="ctrl" style={{ gap: 8 }}>
                    <input placeholder="範本名稱" value={tplName ?? ''} onFocus={() => setActive(null)} onChange={(e) => setTplName(e.target.value)} />
                    <button type="button" className="btn" style={{ minHeight: 36 }} onClick={saveAsTemplate} disabled={busy}>存</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {currency !== 'TWD' && !cost && autoRate && !manual.fx && autoRate.date !== date && (
            <p className="small muted">無當日匯率，採用 {autoRate.date} 匯率。</p>
          )}
          {error && <div className="error" role="alert">{error}</div>}

          {!active && (
            <div className={original || canRepeat ? 'grid2' : ''}>
              {original && <button type="button" className="btn danger" onClick={remove} disabled={busy}><Icon name="trash" className="chev" />刪除</button>}
              {canRepeat && <button type="button" className="btn" onClick={() => save(true)} disabled={busy}>存好再記一筆</button>}
              <button type="button" className="btn primary block" onClick={() => save()} disabled={busy}>{busy ? '儲存中…' : '儲存'}</button>
            </div>
          )}
          {active && <Keypad onKey={onKey} onDone={finishKeypad} />}
          {pickCat && <CategoryPicker kind={type} value={categoryId} onClose={() => setPickCat(false)} onPick={(id) => { setCategoryId(id); if (alwaysExc(id)) setIsException(true); setPickCat(false); if (!(amount > 0)) setActive('amount'); }} />}
        </>
      )}
    </Sheet>
  );
}
