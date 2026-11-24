// 股票：FIFO 成本、持股、市值、已實現損益、資產配置。
// 成本算法跟國泰一致：先買的先賣（FIFO），買進手續費算進成本，賣出的手續費＋交易稅從賣出金額扣掉。

import { round2 } from './money.js';
import { addBusinessDays, startOfDayIso } from './dates.js';
import { uid } from './ledger.js';

export const posKey = (t) => `${t.brokerage_account_id}|${t.market}|${t.symbol}`;
const SIDE_ORDER = { opening: 0, buy: 1, sell: 2 };
const EPS = 1e-9;

/** 依成交紀錄跑 FIFO；until（'YYYY-MM-DD'）可以算「某天為止」的持股 */
export function runFifo(trades, { until } = {}) {
  const list = trades
    .filter((t) => !until || t.trade_date <= until)
    .sort((a, b) => a.trade_date.localeCompare(b.trade_date)
      || SIDE_ORDER[a.side] - SIDE_ORDER[b.side]
      || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
  const pos = new Map();
  for (const t of list) {
    const k = posKey(t);
    if (!pos.has(k)) {
      pos.set(k, {
        key: k, accountId: t.brokerage_account_id, market: t.market, symbol: t.symbol, name: t.name,
        kind: t.kind, currency: t.currency, lots: [], realized: [], oversold: 0, trades: [],
      });
    }
    const p = pos.get(k);
    if (t.name) p.name = t.name;
    p.kind = t.kind;
    p.trades.push(t);
    const shares = Number(t.shares); const price = Number(t.price);
    const fee = Number(t.fee || 0); const tax = Number(t.tax || 0);
    if (t.side !== 'sell') {
      const cost = shares * price + (t.side === 'buy' ? fee : 0);
      p.lots.push({ shares, unitCost: cost / shares, date: t.trade_date, tradeId: t.id });
    } else {
      const proceeds = shares * price - fee - tax;
      let left = shares; let cost = 0;
      while (left > EPS && p.lots.length) {
        const lot = p.lots[0];
        const take = Math.min(lot.shares, left);
        cost += take * lot.unitCost;
        lot.shares -= take; left -= take;
        if (lot.shares <= EPS) p.lots.shift();
      }
      if (left > EPS) p.oversold += left;
      p.realized.push({
        date: t.trade_date, tradeId: t.id, symbol: t.symbol, market: t.market, shares,
        proceeds: round2(proceeds), cost: round2(cost), pnl: round2(proceeds - cost), currency: t.currency,
      });
    }
  }
  for (const p of pos.values()) {
    p.shares = p.lots.reduce((s, l) => s + l.shares, 0);
    p.cost = round2(p.lots.reduce((s, l) => s + l.shares * l.unitCost, 0));
    p.avgCost = p.shares > EPS ? p.cost / p.shares : 0;
  }
  return pos;
}

/** 股價查詢：自動抓的收盤價＋使用者手動輸入（同一天以手動為準） */
export function makePriceBook(stockPrices = [], manualPrices = []) {
  const map = new Map();
  const add = (r, source) => {
    const k = `${r.market}|${r.symbol}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push({ date: r.price_date, close: Number(r.close), source, name: r.name });
  };
  stockPrices.forEach((r) => add(r, 'auto'));
  manualPrices.forEach((r) => add(r, 'manual'));
  for (const list of map.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date) || (a.source === 'manual' ? 1 : -1));
  }
  function lookup(market, symbol, date) {
    const list = map.get(`${market}|${symbol}`);
    if (!list?.length) return null;
    if (!date) return list[list.length - 1];
    for (let i = list.length - 1; i >= 0; i--) if (list[i].date <= date) return list[i];
    return null;
  }
  const name = (market, symbol) => map.get(`${market}|${symbol}`)?.findLast((r) => r.name)?.name ?? '';
  return { lookup, name };
}

/** 持股估值。date 不給 = 用最新股價、最新匯率 */
export function valuePositions(pos, priceBook, fx, date) {
  const rows = [];
  for (const p of pos.values()) {
    if (p.shares <= EPS) continue;
    const q = priceBook.lookup(p.market, p.symbol, date);
    const price = q ? q.close : p.avgCost; // 沒有股價時先用成本，畫面會標示
    const rate = p.currency === 'TWD' ? 1 : ((date ? fx.rateOn(p.currency, date) : null) ?? fx.latest(p.currency) ?? 0);
    const mv = p.shares * price;
    rows.push({
      ...p, price, priceDate: q?.date ?? null, priceSource: q?.source ?? 'cost',
      marketValue: round2(mv), unrealized: round2(mv - p.cost),
      returnPct: p.cost > 0 ? (mv - p.cost) / p.cost : 0,
      rate, marketValueTwd: round2(mv * rate), costTwd: round2(p.cost * rate),
    });
  }
  rows.sort((a, b) => b.marketValueTwd - a.marketValueTwd);
  return rows;
}

/** 每個證券戶的市值：Map(帳戶 id → { twd, native }) */
export function stockValueByAccount(rows) {
  const m = new Map();
  for (const r of rows) {
    const v = m.get(r.accountId) ?? { twd: 0, native: 0 };
    v.twd = round2(v.twd + r.marketValueTwd);
    v.native = round2(v.native + r.marketValue);
    m.set(r.accountId, v);
  }
  return m;
}

/** 已實現損益，按年（'year'）或按月（'month'）彙總；外幣用賣出當天匯率換台幣 */
export function realizedByPeriod(pos, fx, period = 'year') {
  const map = new Map();
  for (const p of pos.values()) {
    for (const r of p.realized) {
      const key = period === 'year' ? r.date.slice(0, 4) : r.date.slice(0, 7);
      const rate = r.currency === 'TWD' ? 1 : (fx.rateOn(r.currency, r.date) ?? fx.latest(r.currency) ?? 0);
      const e = map.get(key) ?? { period: key, twd: 0, byCurrency: {} };
      e.twd = round2(e.twd + r.pnl * rate);
      e.byCurrency[r.currency] = round2((e.byCurrency[r.currency] ?? 0) + r.pnl);
      map.set(key, e);
    }
  }
  return [...map.values()].sort((a, b) => b.period.localeCompare(a.period));
}

/** 資產配置：ETF（不分市場）、台股、美股 */
export function allocation(rows) {
  const buckets = { ETF: 0, 台股: 0, 美股: 0 };
  for (const r of rows) {
    if (r.kind === 'etf') buckets.ETF += r.marketValueTwd;
    else if (r.market === 'TW') buckets.台股 += r.marketValueTwd;
    else buckets.美股 += r.marketValueTwd;
  }
  return Object.entries(buckets).map(([label, twd]) => ({ id: label, name: label, total: round2(twd) })).filter((b) => b.total > 0);
}

// ---------- 輸入成交時的預設值（都可以手動改） ----------

/** 台股手續費 0.1425%（可打折），整股最低 20 元、零股最低 1 元（都可以在設定改） */
export function estimateTwFee(amount, { discount = 1, oddLot = false, minLot = 20, minOdd = 1 } = {}) {
  if (!(amount > 0)) return 0;
  return Math.max(oddLot ? minOdd : minLot, Math.floor(amount * 0.001425 * discount));
}

/** 台股證交稅：股票 0.3%、ETF 0.1%（賣出才有） */
export function estimateTwTax(amount, kind = 'stock') {
  if (!(amount > 0)) return 0;
  return Math.floor(amount * (kind === 'etf' ? 0.001 : 0.003));
}

/** 預設交割日：T+N 個工作天（台股 T+2） */
export const defaultSettleDate = (tradeDate, days = 2) => addBusinessDays(tradeDate, days);

/** 證券戶預設的市場：名字有「美股／複委託／US」或帳戶是美金 → 美股；其他台股 */
export const marketOfAccount = (a) => (a && (/美股|複委託|US/i.test(a.name) || a.currency === 'USD') ? 'US' : 'TW');
/** 股票本身的幣別看市場（美股＝美金），跟交割戶、證券戶是哪個幣別無關 */
export const currencyOfMarket = (m) => (m === 'US' ? 'USD' : 'TWD');

/** 台股代號 00 開頭大多是 ETF */
export const guessKind = (market, symbol) => (market === 'TW' && /^00/.test(symbol) ? 'etf' : 'stock');

/** 交割金額（交易幣別）：買＝價金＋手續費；賣＝價金－手續費－稅 */
export function tradeNetAmount(t) {
  const gross = Number(t.shares) * Number(t.price);
  return round2(t.side === 'sell' ? gross - Number(t.fee || 0) - Number(t.tax || 0) : gross + Number(t.fee || 0));
}

/** 二代健保補充保費：單筆股利 ≥ 2 萬元，扣 2.11% */
export const estimateNhi = (gross) => (gross >= 20000 ? Math.round(gross * 0.0211) : 0);

/**
 * 已實現損益記進月收支（跟 CW 的記法一樣，只是自動算）：
 *   交割日：轉帳「證券戶 → 交割戶」＝成本；另一筆記在交割戶：賺的記收入「投資收入-股票獲利」、賠的記支出「其他支出-股票虧損」。
 *   兩筆加起來＝實際拿回的錢，交割戶餘額不變；證券戶只剩還沒賣的股票。
 * 每次都用 FIFO 從頭重算，跟現有交易比對，回傳要新增／修改／刪除哪些 → 改了以前的買賣，損益和轉帳金額都會自動更新。
 * 沒有交割戶的賣出（例如手動記、沒選交割戶），損益記在證券戶、日期用成交日。
 */
export function realizedTxnPlan({ trades, txns, gainCatId, lossCatId, rateFor, accountCurrency = () => null }) {
  const plan = { insert: [], update: [], remove: [], link: [] };
  if (!gainCatId || !lossCatId) return plan;
  const realized = new Map();
  for (const p of runFifo(trades).values()) for (const r of p.realized) realized.set(r.tradeId, r);
  const txById = new Map(txns.map((t) => [t.id, t]));
  const rate = (cur, date, fallback) => (cur === 'TWD' ? 1 : rateFor(cur, date) ?? fallback ?? null);
  const differs = (cur, want) => Object.entries(want).some(([k, v]) => {
    if (k === 'occurred_at') return Date.parse(cur[k]) !== Date.parse(v);
    if (typeof v === 'number') return Math.abs(Number(cur[k]) - v) > 1e-8;
    return (cur[k] ?? null) !== (v ?? null);
  });

  for (const s of trades) {
    if (s.side !== 'sell') continue;
    const r = realized.get(s.id);
    const cur = s.pnl_txn_id ? txById.get(s.pnl_txn_id) : null;
    const settleTx = s.settlement_txn_id ? txById.get(s.settlement_txn_id) : null;
    const pnl = r ? round2(r.pnl) : 0;
    const net = tradeNetAmount(s);

    // 交割戶那一邊的幣別與匯率
    const settleAcc = settleTx ? settleTx.to_account_id : null;
    const date = settleTx ? (s.settle_date || s.trade_date) : s.trade_date;
    const tradeRate = rate(s.currency, date, settleTx ? Number(settleTx.fx_rate) : cur ? Number(cur.fx_rate) : null);
    const settleRate = settleTx ? (Number(settleTx.to_fx_rate) || 1) : tradeRate;
    if (!tradeRate) continue; // 外幣找不到匯率，等有匯率再補
    const settleAmount = settleTx ? Number(s.settle_amount ?? settleTx.to_amount) : net;
    // 損益換成交割戶幣別：交割戶跟成交同幣別就直接用，否則依交割金額等比例換算
    const pnlSettle = settleTx ? (net ? round2(pnl * settleAmount / net) : 0) : pnl;

    // 1. 交割轉帳＝成本（拿回的錢扣掉損益）
    if (settleTx) {
      // 證券戶那邊的金額用證券戶幣別：跟成交同幣別＝成本；跟交割戶同幣別＝交割金額扣掉損益；都不同就用匯率換
      const brkCur = accountCurrency(s.brokerage_account_id) ?? s.currency;
      const settleCur = accountCurrency(settleAcc) ?? s.currency;
      const brkCost = brkCur === s.currency ? round2(net - pnl)
        : brkCur === settleCur ? round2(settleAmount - pnlSettle)
          : round2(((net - pnl) * tradeRate) / (Number(settleTx.fx_rate) || 1));
      const want = { amount: brkCost, to_amount: round2(settleAmount - pnlSettle) };
      if (want.amount >= 0 && want.to_amount >= 0 && differs(settleTx, want)) plan.update.push({ id: settleTx.id, patch: want });
    }

    // 2. 損益那一筆
    if (!r || pnl === 0) { if (cur) plan.remove.push(cur.id); continue; }
    const gain = pnl > 0;
    const want = {
      type: gain ? 'income' : 'expense', amount: round2(Math.abs(pnlSettle)),
      fx_rate: settleTx ? settleRate : tradeRate,
      category_id: gain ? gainCatId : lossCatId, account_id: settleAcc ?? s.brokerage_account_id,
      occurred_at: startOfDayIso(date), note: `賣出 ${s.symbol}${s.name ? ` ${s.name}` : ''} ${gain ? '獲利' : '虧損'}`,
      to_account_id: null, to_amount: null, to_fx_rate: null, is_exception: false, source: 'stock',
    };
    if (!cur) {
      const id = uid();
      plan.insert.push({ id, ...want });
      plan.link.push({ tradeId: s.id, txnId: id });
    } else if (differs(cur, want)) plan.update.push({ id: cur.id, patch: want });
  }
  return plan;
}
