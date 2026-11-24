// 股票：持股（股數、成本、市值、報酬率）、資產配置、已實現損益（按年／月）、個股交易與股利紀錄
import { useState } from 'react';
import { useLedger } from '../store.jsx';
import { Empty, Field, Icon, Item, Page, Section, Seg, Sheet, back, go, useAction, useUI } from '../ui/kit.jsx';
import { Donut } from '../ui/charts.jsx';
import { AccountSelect } from '../ui/pickers.jsx';
import { allocation, currencyOfMarket, defaultSettleDate, estimateNhi, estimateTwFee, estimateTwTax, guessKind, marketOfAccount, tradeNetAmount } from '../lib/stocks.js';
import { fmt, pct, round2, shares as fmtShares } from '../lib/money.js';
import { dayLabel, todayStr } from '../lib/dates.js';

const SIDE = { opening: '期初持股', buy: '買進', sell: '賣出' };

function usePnl() {
  const { data } = useLedger();
  return (v) => (v > 0 ? (data.settings.twColors ? 'up' : 'income') : v < 0 ? (data.settings.twColors ? 'down' : 'expense') : '');
}

// ---------------------------------------------------------------------
// 成交（買進／賣出／期初持股）
// ---------------------------------------------------------------------
export function TradeSheet({ original, initial = {}, onClose }) {
  const { data, actions } = useLedger();
  const { confirm } = useUI();
  const [run, busy] = useAction();
  const brokerages = data.accounts.filter((a) => a.type === 'brokerage');
  const src = original ?? initial;
  const firstBrk = src.brokerage_account_id ?? brokerages[0]?.id ?? null;
  const brk0 = data.accById.get(firstBrk);
  const st = data.settings;
  const market0 = src.market ?? marketOfAccount(brk0);
  const [f, setF] = useState({
    side: src.side ?? 'buy', brokerage_account_id: firstBrk, market: market0,
    symbol: src.symbol ?? '', name: src.name ?? '', kind: src.kind ?? 'stock', trade_date: src.trade_date ?? todayStr(),
    settle_date: src.settle_date ?? '', shares: src.shares != null ? String(src.shares) : '', price: src.price != null ? String(src.price) : '',
    fee: src.fee != null ? String(src.fee) : '', tax: src.tax != null ? String(src.tax) : '',
    settlement_account_id: src.settlement_account_id ?? (market0 === 'US' ? st.settlementUS : st.settlementTW)
      ?? data.stock_trades.findLast?.((t) => t.settlement_account_id && t.market === market0)?.settlement_account_id ?? null,
    settle_amount: src.settle_amount != null ? String(src.settle_amount) : '', order_no: src.order_no ?? '', note: src.note ?? '',
  });
  const [touched, setTouched] = useState({ fee: src.fee != null, tax: src.tax != null, settle: !!src.settle_date, name: !!src.name, kind: !!src.kind });
  const [err, setErr] = useState('');
  const set = (k) => (e) => { const v = e?.target ? e.target.value : e; setF((x) => ({ ...x, [k]: v })); setTouched((t) => ({ ...t, [k === 'settle_date' ? 'settle' : k]: true })); };

  // 自動帶：名稱、ETF、手續費、稅、交割日（使用者改過就不再覆蓋）
  const gross = Number(f.shares) * Number(f.price);
  const sym = f.symbol.trim().toUpperCase();
  const autoName = sym ? data.priceBook.name(f.market, sym) || data.stock_trades.find((t) => t.symbol === sym && t.name)?.name || '' : '';
  const view = {
    ...f,
    name: touched.name ? f.name : autoName || f.name,
    kind: touched.kind ? f.kind : guessKind(f.market, sym),
    fee: touched.fee || f.market !== 'TW' || f.side === 'opening' ? f.fee : String(estimateTwFee(gross, { discount: st.feeDiscount, oddLot: Number(f.shares) % 1000 !== 0, minLot: st.minFeeLot, minOdd: st.minFeeOdd })),
    tax: touched.tax || f.market !== 'TW' || f.side !== 'sell' ? f.tax : String(estimateTwTax(gross, touched.kind ? f.kind : guessKind(f.market, sym))),
    settle_date: touched.settle ? f.settle_date : defaultSettleDate(f.trade_date, f.market === 'US' ? st.usSettleDays : st.twSettleDays),
  };
  const settleAcc = data.accById.get(f.settlement_account_id);
  const net = gross > 0 ? tradeNetAmount({ ...view, shares: Number(f.shares), price: Number(f.price) }) : 0;
  const currency = currencyOfMarket(f.market); // 美股一律美金計價，台幣交割時用交割金額或匯率換算
  const cross = settleAcc && settleAcc.currency !== currency;

  function changeBrokerage(id) {
    const a = data.accById.get(id);
    setF((x) => ({ ...x, brokerage_account_id: id, market: marketOfAccount(a) }));
  }

  async function save() {
    if (!f.brokerage_account_id) return setErr('請先在「帳戶」新增一個證券戶（例如：國泰台股）');
    if (!/^[A-Z0-9.\-]{1,12}$/.test(sym)) return setErr('請輸入股票代號（例如 2330、0050、VOO）');
    if (!(Number(f.shares) > 0)) return setErr('請輸入股數');
    if (!(Number(f.price) >= 0) || f.price === '') return setErr(f.side === 'opening' ? '請輸入均價' : '請輸入成交價');
    if (f.side !== 'opening' && !f.settlement_account_id) return setErr('請選擇交割戶（扣款／入帳的銀行帳戶）');
    if (f.side === 'sell') {
      const pos = data.positions.get(`${f.brokerage_account_id}|${f.market}|${sym}`);
      const held = (pos?.shares ?? 0) + (original?.side === 'sell' ? Number(original.shares) : 0);
      if (Number(f.shares) > held + 1e-9 && !(await confirm(`目前只有 ${fmtShares(held)} 股，確定要賣 ${f.shares} 股？`))) return;
    }
    const ok = await run(() => actions.saveTrade({ ...view, currency, symbol: sym, pending_item_id: initial.pending_item_id }, original), original ? '已更新' : '已記錄成交');
    if (ok) onClose();
  }
  async function remove() {
    if (!(await confirm('刪除這筆成交？交割戶的扣款／入帳也會一起刪除。', { ok: '刪除', danger: true }))) return;
    if (await run(() => actions.deleteTrade(original), '已刪除')) onClose();
  }

  return (
    <Sheet title={original ? '修改成交' : initial.pending_item_id ? '確認券商成交' : '記錄成交'} onClose={onClose} onSave={save} saving={busy} full>
      <Seg value={f.side} onChange={set('side')} options={[{ value: 'buy', label: '買進' }, { value: 'sell', label: '賣出' }, { value: 'opening', label: '期初持股' }]} />
      {f.side === 'opening' && <div className="notice">輸入目前股數＋均價，當成一批買進（不產生交割扣款）。從 CW 搬過來時用這個。</div>}
      <div className="form">
        <Field label="證券戶">
          {brokerages.length ? (
            <select className="input" value={f.brokerage_account_id ?? ''} onChange={(e) => changeBrokerage(e.target.value)}>
              {brokerages.map((a) => <option key={a.id} value={a.id}>{a.name}（{a.currency}）</option>)}
            </select>
          ) : <div className="notice warn">還沒有證券戶，請先到「帳戶」新增，類型選「證券戶」。</div>}
        </Field>
        <div className="grid2">
          <Field label="代號"><input className="input" value={f.symbol} onChange={set('symbol')} placeholder={f.market === 'US' ? 'VOO' : '2330'} autoCapitalize="characters" /></Field>
          <Field label="名稱"><input className="input" value={view.name} onChange={set('name')} placeholder="選填" /></Field>
        </div>
        <div className="grid2">
          <Field label="市場"><select className="input" value={f.market} onChange={set('market')}><option value="TW">台股</option><option value="US">美股（複委託）</option></select></Field>
          <Field label="種類"><select className="input" value={view.kind} onChange={set('kind')}><option value="stock">股票</option><option value="etf">ETF</option></select></Field>
        </div>
        <div className="grid2">
          <Field label={f.side === 'opening' ? '基準日' : '成交日'}><input className="input" type="date" value={f.trade_date} onChange={set('trade_date')} /></Field>
          {f.side !== 'opening' && <Field label="交割日"><input className="input" type="date" value={view.settle_date} onChange={set('settle_date')} /></Field>}
        </div>
        <div className="grid2">
          <Field label="股數" hint={f.market === 'TW' ? '一張＝1000 股' : ''}><input className="input num" inputMode="decimal" value={f.shares} onChange={set('shares')} /></Field>
          <Field label={f.side === 'opening' ? `均價（${currency}）` : `成交價（${currency}）`}><input className="input num" inputMode="decimal" value={f.price} onChange={set('price')} /></Field>
        </div>
        {f.side !== 'opening' && (
          <>
            <div className="grid2">
              <Field label="手續費" hint={f.market === 'TW' && !touched.fee ? '已估算' : ''}><input className="input num" inputMode="decimal" value={view.fee} onChange={set('fee')} /></Field>
              <Field label="交易稅" hint={f.market === 'TW' && f.side === 'sell' && !touched.tax ? '已估算' : ''}><input className="input num" inputMode="decimal" value={view.tax} onChange={set('tax')} disabled={f.side === 'buy'} /></Field>
            </div>
            <Field label="交割戶"><AccountSelect value={f.settlement_account_id} onChange={set('settlement_account_id')} filter={(a) => a.type === 'bank'} placeholder="選擇交割戶" /></Field>
            {cross && (
              <Field label={`實際${f.side === 'buy' ? '扣款' : '入帳'}（${settleAcc.currency}）`} hint="照對帳單填；留空用匯率換算">
                <input className="input num" inputMode="decimal" value={f.settle_amount} onChange={set('settle_amount')} />
              </Field>
            )}
            <div className="notice">
              {f.side === 'buy' ? '交割日從交割戶扣款' : '交割日入帳到交割戶'} <b className="num">{fmt(net, currency)}</b>{cross ? `（${settleAcc.currency} 交割）` : ''}
              （{f.side === 'buy' ? '價金＋手續費' : '價金－手續費－稅'}）。這是轉帳，不算進月收支。
            </div>
            <Field label="委託書號" hint="選填，防止重複"><input className="input" value={f.order_no} onChange={set('order_no')} /></Field>
          </>
        )}
        <Field label="備註"><input className="input" value={f.note} onChange={set('note')} /></Field>
        {err && <div className="error" role="alert">{err}</div>}
        {original && <button className="btn danger block" onClick={remove} disabled={busy}>刪除這筆成交</button>}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------
// 股利：總額＋預扣（美股預扣稅、二代健保），實拿記成收入「投資收入-股利」
// ---------------------------------------------------------------------
export function DividendSheet({ original, initial = {}, onClose }) {
  const { data, actions } = useLedger();
  const { confirm } = useUI();
  const [run, busy] = useAction();
  const brokerages = data.accounts.filter((a) => a.type === 'brokerage');
  const txn = original ? data.transactions.find((t) => t.id === original.transaction_id) : null;
  const src = original ?? initial;
  const brk = data.accById.get(src.brokerage_account_id ?? brokerages[0]?.id);
  const [f, setF] = useState({
    brokerage_account_id: brk?.id ?? null, market: src.market ?? marketOfAccount(brk), symbol: src.symbol ?? '',
    pay_date: src.pay_date ?? todayStr(), gross: src.gross != null ? String(src.gross) : '', withholding: src.withholding != null ? String(src.withholding) : '',
    nhi_premium: src.nhi_premium != null ? String(src.nhi_premium) : '',
    deposit_account_id: txn?.account_id ?? null, note: src.note ?? '',
  });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const divCur = currencyOfMarket(f.market);
  const gross = Number(f.gross) || 0;
  const wh = f.withholding === '' ? (f.market === 'US' ? round2(gross * data.settings.usWithholding) : 0) : Number(f.withholding);
  const nhi = f.nhi_premium === '' ? (f.market === 'TW' ? estimateNhi(gross) : 0) : Number(f.nhi_premium);
  const held = [...data.positions.values()].filter((p) => p.shares > 0 && p.accountId === f.brokerage_account_id);

  async function save() {
    if (!f.brokerage_account_id) return setErr('請先新增證券戶');
    if (!f.symbol.trim()) return setErr('請輸入代號');
    if (!(gross > 0)) return setErr('請輸入股利總額');
    if (!f.deposit_account_id) return setErr('請選擇入帳帳戶');
    const ok = await run(() => actions.saveDividend({ ...f, currency: divCur, withholding: wh, nhi_premium: nhi }, original), original ? '已更新' : '已記錄股利');
    if (ok) onClose();
  }
  async function remove() {
    if (!(await confirm('刪除這筆股利？入帳的收入也會一起刪除。', { ok: '刪除', danger: true }))) return;
    if (await run(() => actions.deleteDividend(original), '已刪除')) onClose();
  }
  return (
    <Sheet title={original ? '修改股利' : '記錄股利'} onClose={onClose} onSave={save} saving={busy}>
      <div className="form">
        <Field label="證券戶">
          <select className="input" value={f.brokerage_account_id ?? ''} onChange={(e) => { const a = data.accById.get(e.target.value); setF((x) => ({ ...x, brokerage_account_id: a.id, market: marketOfAccount(a) })); }}>
            {brokerages.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <div className="grid2">
          <Field label="代號">
            <input className="input" list="held-symbols" value={f.symbol} onChange={set('symbol')} autoCapitalize="characters" />
            <datalist id="held-symbols">{held.map((p) => <option key={p.key} value={p.symbol}>{p.name}</option>)}</datalist>
          </Field>
          <Field label="發放日"><input className="input" type="date" value={f.pay_date} onChange={set('pay_date')} /></Field>
        </div>
        <Field label={`股利總額（${divCur}）`}><input className="input num" inputMode="decimal" value={f.gross} onChange={set('gross')} /></Field>
        <div className="grid2">
          <Field label="預扣稅" hint={f.market === 'US' && f.withholding === '' ? `預設 ${Math.round(data.settings.usWithholding * 100)}%` : ''}><input className="input num" inputMode="decimal" value={f.withholding} placeholder={String(wh)} onChange={set('withholding')} /></Field>
          <Field label="二代健保" hint={f.market === 'TW' && f.nhi_premium === '' ? '滿 2 萬扣 2.11%' : ''}><input className="input num" inputMode="decimal" value={f.nhi_premium} placeholder={String(nhi)} onChange={set('nhi_premium')} /></Field>
        </div>
        <Field label="入帳帳戶"><AccountSelect value={f.deposit_account_id} onChange={set('deposit_account_id')} filter={(a) => a.type !== 'brokerage'} /></Field>
        <div className="notice">實拿 <b className="num">{fmt(gross - wh - nhi, divCur)}</b>，記成收入「投資收入-股利」（入帳帳戶是別的幣別時用匯率換算）。</div>
        <Field label="備註"><input className="input" value={f.note} onChange={set('note')} /></Field>
        {err && <div className="error">{err}</div>}
        {original && <button className="btn danger block" onClick={remove} disabled={busy}>刪除這筆股利</button>}
      </div>
    </Sheet>
  );
}

function PriceSheet({ market: m0 = 'TW', symbol: s0 = '', onClose }) {
  const { actions } = useLedger();
  const [run, busy] = useAction();
  const [f, setF] = useState({ market: m0, symbol: s0, price_date: todayStr(), close: '' });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function save() {
    if (!f.symbol.trim()) return setErr('請輸入代號');
    if (!(Number(f.close) > 0)) return setErr('請輸入股價');
    if (await run(() => actions.saveManualPrice({ ...f, symbol: f.symbol.trim().toUpperCase() }), '已更新股價')) onClose();
  }
  return (
    <Sheet title="手動輸入股價" onClose={onClose} onSave={save} saving={busy}>
      <div className="form">
        <p className="small muted" style={{ margin: 0 }}>台股會每天收盤後自動更新；美股自動來源還沒決定，先手動輸入。同一天手動的價格優先。</p>
        <div className="grid2">
          <Field label="市場"><select className="input" value={f.market} onChange={set('market')}><option value="TW">台股</option><option value="US">美股</option></select></Field>
          <Field label="代號"><input className="input" value={f.symbol} onChange={set('symbol')} autoCapitalize="characters" /></Field>
        </div>
        <div className="grid2">
          <Field label="日期"><input className="input" type="date" value={f.price_date} onChange={set('price_date')} /></Field>
          <Field label="收盤價"><input className="input num" inputMode="decimal" value={f.close} onChange={set('close')} /></Field>
        </div>
        {err && <div className="error">{err}</div>}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------
export default function Stocks() {
  const { data } = useLedger();
  const { openTrade } = useUI();
  const pnlCls = usePnl();
  const [sheet, setSheet] = useState(null);
  const rows = data.holdings;
  const totalMv = rows.reduce((s, r) => s + r.marketValueTwd, 0);
  const totalCost = rows.reduce((s, r) => s + r.costTwd, 0);
  const brokerages = data.accounts.filter((a) => a.type === 'brokerage');
  const alloc = allocation(rows);
  const divs = [...data.dividends].sort((a, b) => b.pay_date.localeCompare(a.pay_date)).slice(0, 6);
  const noPrice = rows.filter((r) => r.priceSource === 'cost');

  return (
    <Page title="股票" onBack={() => back('more')}>
      <div className="card hero">
        <div>
          <div className="label">總市值（台幣）</div>
          <div className="big num">{fmt(totalMv)}</div>
        </div>
        <div className="stats">
          <div><span className="label">未實現損益</span><b className={`num ${pnlCls(totalMv - totalCost)}`}>{fmt(totalMv - totalCost, 'TWD', { sign: true })}</b></div>
          <div><span className="label">報酬率</span><b className={`num ${pnlCls(totalMv - totalCost)}`}>{totalCost ? pct((totalMv - totalCost) / totalCost) : '—'}</b></div>
          <div><span className="label">成本</span><b className="num">{fmt(totalCost)}</b></div>
        </div>
      </div>
      <div className="chips">
        <button className="chip" onClick={() => openTrade({ initial: { side: 'buy' } })}>＋ 買進／賣出</button>
        <button className="chip" onClick={() => openTrade({ initial: { side: 'opening' } })}>＋ 期初持股</button>
        <button className="chip" onClick={() => setSheet({ kind: 'div' })}>＋ 股利</button>
        <button className="chip" onClick={() => setSheet({ kind: 'price' })}>手動股價</button>
      </div>
      {!brokerages.length && <div className="notice warn">先到「帳戶」新增證券戶（類型選「證券戶」，例如：國泰台股 TWD、國泰美股 USD）。</div>}
      {noPrice.length > 0 && <div className="notice warn">{noPrice.map((r) => r.symbol).join('、')} 還沒有股價，市值暫時用成本計算。</div>}

      {brokerages.length > 0 && (
        <Section title="證券戶">
          <div className="list">
            {brokerages.map((b) => {
              const list = rows.filter((r) => r.accountId === b.id);
              const rate = b.currency === 'TWD' ? 1 : data.fx.latest(b.currency) || 1;
              const mv = list.reduce((x, r) => x + r.marketValueTwd, 0) / rate;
              const cost = list.reduce((x, r) => x + r.costTwd, 0) / rate;
              return (
                <Item key={b.id} onClick={() => go('account', b.id)} title={b.name}
                  sub={`持股 ${list.length} 檔${b.currency !== 'TWD' ? ` · ${b.currency}` : ''}`}
                  value={<span className="num">{fmt(mv, b.currency)}</span>}
                  valueSub={<span className={`num ${pnlCls(mv - cost)}`}>{fmt(mv - cost, b.currency, { sign: true })}（{cost ? pct((mv - cost) / cost) : '—'}）</span>} />
              );
            })}
          </div>
        </Section>
      )}
      {!rows.length && <div className="list"><Empty>還沒有持股。先用「期初持股」輸入目前的股數和均價。</Empty></div>}

      {alloc.length > 0 && (
        <Section title="資產配置">
          <div className="card"><Donut rows={alloc} centerLabel="總市值" /></div>
        </Section>
      )}

      <div className="notice row-flex wrap">
        <span className="grow">這頁只看還持有的股票。已經賣掉的獲益記在交割戶，到「報表 › 收入 › 投資收入 › 股票獲利」查（虧損在「支出 › 其他支出 › 股票虧損」）。</span>
        <button className="btn small" onClick={() => go('reports')}>看報表</button>
      </div>

      <Section title="最近股利">
        <div className="list">
          {divs.length ? divs.map((dv) => (
            <Item key={dv.id} onClick={() => setSheet({ kind: 'div', original: dv })} title={`${dv.symbol} 股利`} sub={`${dayLabel(dv.pay_date)} · 總額 ${fmt(dv.gross, dv.currency)}${Number(dv.withholding) + Number(dv.nhi_premium) > 0 ? ` · 預扣 ${fmt(Number(dv.withholding) + Number(dv.nhi_premium), dv.currency)}` : ''}`}
              value={<span className="num income">{fmt(Number(dv.gross) - Number(dv.withholding) - Number(dv.nhi_premium), dv.currency)}</span>} />
          )) : <Empty>還沒有股利紀錄</Empty>}
        </div>
      </Section>

      {sheet?.kind === 'div' && <DividendSheet original={sheet.original} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'price' && <PriceSheet onClose={() => setSheet(null)} />}
    </Page>
  );
}

export function StockDetail({ id }) {
  const { data } = useLedger();
  const { openTrade } = useUI();
  const pnlCls = usePnl();
  const [sheet, setSheet] = useState(null);
  const [accountId, market, symbol] = id.split('|');
  const pos = data.positions.get(id);
  const row = data.holdings.find((r) => r.key === id);
  if (!pos || pos.shares <= 1e-9) return <Page title={symbol} onBack={() => back('stocks')}><Empty>這檔已經全部賣掉了，獲益到「報表」查。</Empty></Page>;
  const trades = [...pos.trades].sort((a, b) => b.trade_date.localeCompare(a.trade_date));
  const divs = data.dividends.filter((dv) => dv.symbol === symbol && dv.brokerage_account_id === accountId).sort((a, b) => b.pay_date.localeCompare(a.pay_date));
  const cur = currencyOfMarket(market);
  return (
    <Page title={`${symbol} ${pos.name || data.priceBook.name(market, symbol)}`} onBack={() => back('account', accountId)}>
      <div className="card hero">
        <div>
          <div className="label">{data.accById.get(accountId)?.name} · {pos.kind === 'etf' ? 'ETF' : market === 'TW' ? '台股' : '美股'}</div>
          <div className="big num">{fmt(row?.marketValue ?? 0, cur)}</div>
          {cur !== 'TWD' && row && <div className="small muted">≈ {fmt(row.marketValueTwd)}</div>}
        </div>
        <div className="stats">
          <div><span className="label">股數</span><b className="num">{fmtShares(pos.shares)}</b></div>
          <div><span className="label">均價（FIFO）</span><b className="num">{fmt(pos.avgCost, cur)}</b></div>
          <div><span className="label">現價</span><b className="num">{row ? fmt(row.price, cur) : '—'}</b></div>
          <div><span className="label">成本</span><b className="num">{fmt(pos.cost, cur)}</b></div>
          <div><span className="label">未實現</span><b className={`num ${pnlCls(row?.unrealized ?? 0)}`}>{fmt(row?.unrealized ?? 0, cur, { sign: true })}</b></div>
        </div>
      </div>
      <div className="chips">
        <button className="chip" onClick={() => openTrade({ initial: { side: 'buy', brokerage_account_id: accountId, market, symbol, name: pos.name, kind: pos.kind, currency: cur } })}>＋ 買進</button>
        <button className="chip" onClick={() => openTrade({ initial: { side: 'sell', brokerage_account_id: accountId, market, symbol, name: pos.name, kind: pos.kind, currency: cur } })}>＋ 賣出</button>
        <button className="chip" onClick={() => setSheet({ kind: 'div' })}>＋ 股利</button>
        <button className="chip" onClick={() => setSheet({ kind: 'price' })}>手動股價</button>
      </div>
      <Section title="交易紀錄">
        <div className="list">
          {trades.map((t) => {
            return (
              <Item key={t.id} onClick={() => openTrade({ original: t })} title={`${SIDE[t.side]} ${fmtShares(t.shares)} 股 @ ${fmt(t.price, cur)}`}
                sub={`${dayLabel(t.trade_date)}${t.settle_date ? ` · 交割 ${t.settle_date.slice(5)}` : ''}${Number(t.fee) ? ` · 手續費 ${fmt(t.fee, cur)}` : ''}${Number(t.tax) ? ` · 稅 ${fmt(t.tax, cur)}` : ''}`}
                value={<span className="num">{fmt(t.side === 'opening' ? Number(t.shares) * Number(t.price) : tradeNetAmount(t), cur)}</span>}
                valueSub={<span className="small muted">{t.side === 'buy' ? '付出' : t.side === 'sell' ? '拿回' : '成本'}</span>} />
            );
          })}
        </div>
      </Section>
      <Section title="股利紀錄">
        <div className="list">
          {divs.length ? divs.map((dv) => (
            <Item key={dv.id} onClick={() => setSheet({ kind: 'div', original: dv })} title={dayLabel(dv.pay_date)} sub={`總額 ${fmt(dv.gross, dv.currency)} · 預扣 ${fmt(Number(dv.withholding) + Number(dv.nhi_premium), dv.currency)}`}
              value={<span className="num income">{fmt(Number(dv.gross) - Number(dv.withholding) - Number(dv.nhi_premium), dv.currency)}</span>} />
          )) : <Empty>還沒有股利紀錄</Empty>}
        </div>
      </Section>
      {sheet?.kind === 'div' && <DividendSheet original={sheet.original} initial={{ brokerage_account_id: accountId, market, symbol, currency: cur }} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'price' && <PriceSheet market={market} symbol={symbol} onClose={() => setSheet(null)} />}
    </Page>
  );
}


/** 一個證券戶的持股（帳戶頁用）：總市值、漲跌、成本，下面列每一檔 */
export function BrokerageView({ account }) {
  const { data } = useLedger();
  const { openTrade } = useUI();
  const pnlCls = usePnl();
  const [sheet, setSheet] = useState(null);
  const cur = account.currency;
  const rows = data.holdings.filter((r) => r.accountId === account.id);
  // 合計換成證券戶的幣別（例如台幣交割的美股戶：每檔看美金，合計看台幣）
  const rate = cur === 'TWD' ? 1 : data.fx.latest(cur) || 1;
  const mv = rows.reduce((x, r) => x + r.marketValueTwd, 0) / rate;
  const cost = rows.reduce((x, r) => x + r.costTwd, 0) / rate;
  const pnl = mv - cost;
  const twd = rows.reduce((x, r) => x + r.marketValueTwd, 0);
  const last = rows.map((r) => r.priceDate).filter(Boolean).sort().pop();
  const market = marketOfAccount(account);
  const noPrice = rows.filter((r) => r.priceSource === 'cost');
  return (
    <>
      <div className="card hero center" style={{ gap: 2 }}>
        <div className="big num">{fmt(mv, cur, { exact: true })}</div>
        <div className={`num ${pnlCls(pnl)}`} style={{ fontSize: 18, fontWeight: 600 }}>{fmt(pnl, cur, { sign: true, exact: true })}</div>
        <div className={`num small ${pnlCls(pnl)}`}>（{cost ? pct(pnl / cost) : '—'}）</div>
        <div className="small muted">股票總市值{cur !== 'TWD' ? ` ≈ ${fmt(twd)}` : ''}{rows.some((r) => r.currency !== cur) ? `（外幣持股換成 ${cur}）` : ''}</div>
        <div className="stats" style={{ borderTop: '1px solid var(--line)', marginTop: 12, paddingTop: 12 }}>
          <div><b className="num">{fmt(cost, cur)}</b><span className="small muted">股票成本</span></div>
          <div><b className="num">{rows.length}</b><span className="small muted">持股檔數</span></div>
          <div><b className={`num ${pnlCls(pnl)}`}>{fmt(pnl, cur, { sign: true })}</b><span className="small muted">未實現損益</span></div>
        </div>
      </div>
      <div className="chips">
        <button className="chip" onClick={() => openTrade({ initial: { side: 'buy', brokerage_account_id: account.id, market } })}>＋ 買進／賣出</button>
        <button className="chip" onClick={() => openTrade({ initial: { side: 'opening', brokerage_account_id: account.id, market } })}>＋ 期初持股</button>
        <button className="chip" onClick={() => setSheet({ kind: 'div' })}>＋ 股利</button>
        <button className="chip" onClick={() => setSheet({ kind: 'price' })}>手動股價</button>
      </div>
      {noPrice.length > 0 && <div className="notice warn">{noPrice.map((r) => r.symbol).join('、')} 還沒有股價，市值暫時用成本計算。</div>}
      <Section title={`持股（${rows.length}）`}>
        <div className="list">
          {rows.length ? rows.map((r) => (
            <button key={r.key} type="button" className="item" onClick={() => go('stock', r.key)} style={{ alignItems: 'flex-start' }}>
              <div className="main">
                <div className="title" style={{ fontWeight: 600 }}>{r.name || data.priceBook.name(r.market, r.symbol) || r.symbol}</div>
                <div className="sub">{r.symbol}.{r.market === 'TW' ? 'TW' : 'US'}</div>
                <div className="sub">{fmtShares(r.shares)} 股 · 現價 {fmt(r.price, r.currency, { exact: true })}</div>
              </div>
              <div className="value">
                <span className="num" style={{ fontWeight: 600 }}>{fmt(r.marketValue, r.currency, { exact: true })}</span>
                <span className={`num ${pnlCls(r.unrealized)}`}>{fmt(r.unrealized, r.currency, { sign: true, exact: true })}</span>
                <span className={`num small ${pnlCls(r.unrealized)}`}>（{pct(r.returnPct)}）</span>
              </div>
              <Icon name="chev" className="chev" />
            </button>
          )) : <Empty>還沒有持股。用「期初持股」輸入目前的股數和均價。</Empty>}
        </div>
      </Section>
      {last && <p className="small muted right" style={{ margin: 0 }}>股價日期：{last}</p>}
      {sheet?.kind === 'div' && <DividendSheet initial={{ brokerage_account_id: account.id, market }} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'price' && <PriceSheet market={market} onClose={() => setSheet(null)} />}
    </>
  );
}
