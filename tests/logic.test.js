// 核心邏輯測試：bun test
import { describe, expect, test } from 'bun:test';
import { evaluate, press } from '../src/lib/calc.js';
import { occurrenceDate, dueOccurrences } from '../src/lib/recurring.js';
import { buildSplit, computeBalances, summarize, categoryBreakdown, netWorth, netWorthSeries, buildFee, monthlyTrend, counts } from '../src/lib/ledger.js';
import { buildTree, validateCategory, parentOptions } from '../src/lib/categories.js';
import { makeFx } from '../src/lib/fx.js';
import { runFifo, makePriceBook, valuePositions, realizedByPeriod, allocation, estimateTwFee, estimateTwTax, stockValueByAccount, realizedTxnPlan } from '../src/lib/stocks.js';
import { analyzeCW, buildImport, guessAdvance, catKey } from '../src/lib/cwimport.js';
import { parseCSV, toCSV, transactionsToRows } from '../src/lib/csv.js';
import { addMonthsClamped, addBusinessDays, monthRange } from '../src/lib/dates.js';
import { defaultCategoryRows, missingSystemRows, defaultAccountRows } from '../src/lib/defaults.js';
import { fmt } from '../src/lib/money.js';

const at = (s) => new Date(s).toISOString();

describe('計算機', () => {
  test('基本運算與優先順序', () => {
    expect(evaluate('120+85')).toBe(205);
    expect(evaluate('2×3+4')).toBe(10);
    expect(evaluate('1000÷3')).toBe(333.33);
    expect(evaluate('100-30×2')).toBe(40);
    expect(evaluate('1.5+1.25')).toBe(2.75);
  });
  test('不完整或除以零回傳 null', () => {
    expect(evaluate('10+')).toBeNull();
    expect(evaluate('5÷0')).toBeNull();
    expect(evaluate('')).toBeNull();
  });
  test('按鍵行為', () => {
    let s = '';
    for (const k of ['1', '2', '0', '+', '×', '8', '5']) s = press(s, k);
    expect(s).toBe('120×85');
    expect(press('0', '5')).toBe('5');
    expect(press('1.5', '.')).toBe('1.5');
    expect(press('12+', '.')).toBe('12+0.');
    expect(press('120+85', '=')).toBe('205');
  });
});

describe('日期', () => {
  test('月底不漂移', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2026-01-31', 2)).toBe('2026-03-31');
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29');
  });
  test('交割日 T+2 跳過週末', () => {
    expect(addBusinessDays('2026-11-20', 2)).toBe('2026-11-24'); // 週五 → 週二
  });
});

describe('固定收支', () => {
  const rule = { interval_unit: 'month', interval_count: 1, start_date: '2026-01-31', next_index: 0, active: true, end_date: null };
  test('起始日＋第 k 次：1/31 → 2/28 → 3/31', () => {
    expect([0, 1, 2, 3].map((k) => occurrenceDate(rule, k))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
  test('到期清單從 next_index 開始，遵守結束日', () => {
    expect(dueOccurrences({ ...rule, next_index: 2 }, '2026-05-15').map((o) => o.k)).toEqual([2, 3]);
    expect(dueOccurrences({ ...rule, end_date: '2026-03-01' }, '2026-12-31').map((o) => o.date)).toEqual(['2026-01-31', '2026-02-28']);
    expect(dueOccurrences({ ...rule, active: false }, '2026-12-31')).toEqual([]);
  });
  test('每 2 週、每年（閏年 2/29）', () => {
    expect(occurrenceDate({ interval_unit: 'week', interval_count: 2, start_date: '2026-11-02' }, 3)).toBe('2026-12-14');
    expect(occurrenceDate({ interval_unit: 'year', interval_count: 1, start_date: '2028-02-29' }, 1)).toBe('2029-02-28');
    expect(occurrenceDate({ interval_unit: 'year', interval_count: 1, start_date: '2028-02-29' }, 4)).toBe('2032-02-29');
  });
});

// 規格書的分帳範例
function splitExample() {
  const accounts = [
    { id: 'line', name: 'LINE Pay', type: 'e_payment', currency: 'TWD', opening_balance: 1000 },
    { id: 'owe', name: '朋友欠我', type: 'friends_owe', currency: 'TWD', opening_balance: 0, system_key: 'friends_owe' },
    { id: 'cash', name: '現金', type: 'cash', currency: 'TWD', opening_balance: 0 },
    { id: 'post', name: '郵局', type: 'bank', currency: 'TWD', opening_balance: 0 },
  ];
  const txns = [
    ...buildSplit({ accountId: 'line', total: 500, mine: 70, categoryId: 'food', occurredAt: at('2026-11-10T12:00:00'), friendsOweId: 'owe' }),
    { type: 'transfer', occurred_at: at('2026-11-11T09:00:00'), account_id: 'owe', amount: 215, fx_rate: 1, to_account_id: 'cash', to_amount: 215, to_fx_rate: 1 },
    { type: 'transfer', occurred_at: at('2026-11-12T09:00:00'), account_id: 'owe', amount: 215, fx_rate: 1, to_account_id: 'post', to_amount: 215, to_fx_rate: 1 },
  ];
  return { accounts, txns, accById: new Map(accounts.map((a) => [a.id, a])) };
}

describe('分帳與餘額', () => {
  test('分帳產生「支出 70」＋「轉進朋友欠我 430」', () => {
    const rows = buildSplit({ accountId: 'line', total: 500, mine: 70, categoryId: 'food', occurredAt: at('2026-11-10'), friendsOweId: 'owe' });
    expect(rows.map((r) => [r.type, r.amount])).toEqual([['expense', 70], ['transfer', 430]]);
    expect(rows[0].group_id).toBe(rows[1].group_id);
    expect(() => buildSplit({ accountId: 'line', total: 50, mine: 70, categoryId: 'f', occurredAt: at('2026-11-10'), friendsOweId: 'owe' })).toThrow();
  });
  test('規格書範例：每個時間點的餘額與本月支出都正確', () => {
    const { accounts, txns, accById } = splitExample();
    const snap = (iso) => {
      const b = computeBalances(accounts, txns, Date.parse(iso));
      return ['line', 'owe', 'cash', 'post'].map((id) => b.get(id));
    };
    expect(snap('2026-11-09T00:00:00')).toEqual([1000, 0, 0, 0]);
    expect(snap('2026-11-10T13:00:00')).toEqual([500, 430, 0, 0]);
    expect(snap('2026-11-11T10:00:00')).toEqual([500, 215, 215, 0]);
    expect(snap('2026-11-12T10:00:00')).toEqual([500, 0, 215, 215]);
    const { from, to } = monthRange('2026-11');
    expect(summarize(txns, accById, { from, to })).toEqual({ income: 0, expense: 70, net: -70 });
  });
  test('外幣帳戶分帳：朋友欠我收到換算後的台幣', () => {
    const rows = buildSplit({ accountId: 'usd', total: 30, mine: 10, categoryId: 'f', occurredAt: at('2026-11-10'), friendsOweId: 'owe', fxRate: 32 });
    expect(rows[1].amount).toBe(20);
    expect(rows[1].to_amount).toBe(640);
  });
  test('隱藏帳戶的收支照算、例外可排除、轉帳不算', () => {
    const accounts = [{ id: 'a', type: 'cash', currency: 'TWD', opening_balance: 0 }, { id: 'h', type: 'cash', currency: 'TWD', opening_balance: 0, hidden: true }];
    const accById = new Map(accounts.map((a) => [a.id, a]));
    const txns = [
      { type: 'expense', occurred_at: at('2026-11-05'), account_id: 'a', amount: 100, fx_rate: 1, category_id: 'c' },
      { type: 'expense', occurred_at: at('2026-11-05'), account_id: 'a', amount: 1000, fx_rate: 1, category_id: 'c', is_exception: true },
      { type: 'expense', occurred_at: at('2026-11-05'), account_id: 'h', amount: 5000, fx_rate: 1, category_id: 'c' },
      { type: 'income', occurred_at: at('2026-11-06'), account_id: 'a', amount: 10, fx_rate: 32, category_id: 'i' },
      { type: 'transfer', occurred_at: at('2026-11-06'), account_id: 'a', amount: 50, fx_rate: 1, to_account_id: 'h', to_amount: 50, to_fx_rate: 1 },
    ];
    const { from, to } = monthRange('2026-11');
    expect(summarize(txns, accById, { from, to })).toEqual({ income: 320, expense: 6100, net: -5780 });
    expect(summarize(txns, accById, { from, to, includeExceptions: false }).expense).toBe(5100);
    expect(monthlyTrend(txns, accById, ['2026-10', '2026-11'])[1]).toEqual({ month: '2026-11', income: 320, expense: 6100, net: -5780 });
  });
  test('未來日期的交易（還沒到交割日）不算進目前餘額', () => {
    const acc = [{ id: 'b', opening_balance: 1000 }];
    const t = [{ type: 'expense', occurred_at: at('2099-01-01'), account_id: 'b', amount: 100 }];
    expect(computeBalances(acc, t).get('b')).toBe(1000);
    expect(computeBalances(acc, t, null).get('b')).toBe(900);
  });
  test('轉帳手續費拆成一筆支出', () => {
    const fee = buildFee({ transfer: { id: 'x', occurred_at: at('2026-11-01'), account_id: 'post', fx_rate: 1 }, fee: 15, feeCategoryId: 'feeCat' });
    expect([fee.type, fee.amount, fee.parent_id, fee.category_id]).toEqual(['expense', 15, 'x', 'feeCat']);
    expect(buildFee({ transfer: {}, fee: 0, feeCategoryId: 'f' })).toBeNull();
  });
});

describe('分類樹', () => {
  const cats = [
    { id: 'food', parent_id: null, kind: 'expense', name: '飲食', sort_order: 0 },
    { id: 'bf', parent_id: 'food', kind: 'expense', name: '早餐', sort_order: 0 },
    { id: 'ex', parent_id: null, kind: 'expense', name: '年度例外', sort_order: 1 },
    { id: 'gift', parent_id: 'ex', kind: 'expense', name: '禮物', sort_order: 0 },
    { id: 'ming', parent_id: 'gift', kind: 'expense', name: '小明', sort_order: 0 },
    { id: 'pay', parent_id: null, kind: 'income', name: '工作收入', sort_order: 0 },
  ];
  const tree = buildTree(cats);
  test('路徑名稱與深度', () => {
    expect(tree.path('ming')).toBe('年度例外-禮物-小明');
    expect(tree.depth('ming')).toBe(3);
    expect(tree.height('ex')).toBe(3);
  });
  test('規則：三層、同收支、不能掛到子孫、搬移連子樹算', () => {
    expect(validateCategory(tree, { parent_id: 'ming', kind: 'expense', name: '第四層' })).toMatch('三層');
    expect(validateCategory(tree, { parent_id: 'food', kind: 'income', name: 'x' })).toMatch('收支類型');
    expect(validateCategory(tree, { id: 'food', parent_id: 'bf', kind: 'expense', name: '飲食' })).toMatch('子分類底下');
    expect(validateCategory(tree, { id: 'ex', parent_id: 'food', kind: 'expense', name: '年度例外' })).toMatch('三層');
    expect(validateCategory(tree, { parent_id: null, kind: 'expense', name: '飲食' })).toMatch('已經有');
    expect(validateCategory(tree, { id: 'bf', parent_id: 'ex', kind: 'expense', name: '早餐' })).toBeNull();
  });
  test('搬移選單不包含自己的子孫，也不包含會超過三層的位置', () => {
    const ids = parentOptions(tree, 'expense', 'gift').map((o) => o.id);
    expect(ids).toEqual(['food', 'ex'].filter((id) => id !== 'ex').concat('ex'));
    expect(ids).not.toContain('ming');
    expect(parentOptions(tree, 'expense', 'ex').map((o) => o.id)).toEqual([]);
  });
  test('圓餅圖往下鑽：上層金額包含子孫，直接記在上層的顯示成未細分', () => {
    const accById = new Map([['a', { id: 'a' }]]);
    const txns = [
      { type: 'expense', occurred_at: at('2026-11-02'), account_id: 'a', amount: 60, fx_rate: 1, category_id: 'bf' },
      { type: 'expense', occurred_at: at('2026-11-02'), account_id: 'a', amount: 40, fx_rate: 1, category_id: 'food' },
      { type: 'expense', occurred_at: at('2026-11-03'), account_id: 'a', amount: 500, fx_rate: 1, category_id: 'ming' },
    ];
    const { from, to } = monthRange('2026-11');
    const top = categoryBreakdown({ txns, tree, accById, kind: 'expense', from, to });
    expect(top.map((r) => [r.name, r.total])).toEqual([['年度例外', 500], ['飲食', 100]]);
    const food = categoryBreakdown({ txns, tree, accById, kind: 'expense', from, to, parentId: 'food' });
    expect(food.map((r) => [r.name, r.total])).toEqual([['早餐', 60], ['飲食（未細分）', 40]]);
    const gift = categoryBreakdown({ txns, tree, accById, kind: 'expense', from, to, parentId: 'gift' });
    expect(gift.map((r) => r.name)).toEqual(['小明']);
  });
});

describe('匯率', () => {
  const fx = makeFx([{ currency: 'USD', rate_date: '2026-11-20', rate: 32.1 }, { currency: 'USD', rate_date: '2026-11-18', rate: 31.9 }]);
  test('當天沒有就用最近的前一天；比資料早就用最早的；台幣是 1；完全沒有資料回傳 null', () => {
    expect(fx.rateOn('USD', '2026-11-19')).toBe(31.9);
    expect(fx.rateOn('USD', '2026-11-23')).toBe(32.1);
    expect(fx.rateOn('USD', '2026-11-01')).toBe(31.9);
    expect(fx.rateOn('TWD', '2026-11-01')).toBe(1);
    expect(fx.latest('USD')).toBe(32.1);
    expect(fx.latest('JPY')).toBeNull();
  });
});

describe('股票 FIFO', () => {
  const base = { brokerage_account_id: 'tw', market: 'TW', symbol: '2330', name: '台積電', kind: 'stock', currency: 'TWD' };
  const trades = [
    { ...base, id: '1', side: 'buy', trade_date: '2026-01-05', shares: 1000, price: 100, fee: 142, tax: 0 },
    { ...base, id: '2', side: 'buy', trade_date: '2026-02-05', shares: 1000, price: 120, fee: 171, tax: 0 },
    { ...base, id: '3', side: 'sell', trade_date: '2026-03-05', shares: 1500, price: 130, fee: 277, tax: 585 },
  ];
  test('先買先賣，手續費算進成本，賣出扣手續費和稅', () => {
    const p = runFifo(trades).get('tw|TW|2330');
    expect(p.shares).toBe(500);
    expect(p.cost).toBe(60085.5);
    expect(p.realized[0]).toMatchObject({ proceeds: 194138, cost: 160227.5, pnl: 33910.5 });
  });
  test('期初持股當成一批買進（無手續費）', () => {
    const p = runFifo([{ ...base, id: 'o', side: 'opening', trade_date: '2025-12-31', shares: 2000, price: 550, fee: 0 }]).get('tw|TW|2330');
    expect([p.shares, p.cost, p.avgCost]).toEqual([2000, 1100000, 550]);
  });
  test('某天為止的持股', () => {
    expect(runFifo(trades, { until: '2026-01-31' }).get('tw|TW|2330').shares).toBe(1000);
  });
  test('市值、報酬率、配置、已實現損益（美股用賣出日匯率換台幣）', () => {
    const us = { brokerage_account_id: 'us', market: 'US', symbol: 'VOO', name: 'VOO', kind: 'etf', currency: 'USD' };
    const all = [...trades,
      { ...us, id: '4', side: 'buy', trade_date: '2026-01-10', shares: 10, price: 500, fee: 5, tax: 0 },
      { ...us, id: '5', side: 'sell', trade_date: '2026-06-10', shares: 5, price: 560, fee: 5, tax: 0 }];
    const pos = runFifo(all);
    const fx = makeFx([{ currency: 'USD', rate_date: '2026-06-01', rate: 32 }]);
    const pb = makePriceBook([{ market: 'TW', symbol: '2330', price_date: '2026-11-20', close: 150 }], [{ market: 'US', symbol: 'VOO', price_date: '2026-11-20', close: 600 }]);
    const rows = valuePositions(pos, pb, fx);
    const tw = rows.find((r) => r.symbol === '2330'); const voo = rows.find((r) => r.symbol === 'VOO');
    expect(tw.marketValue).toBe(75000);
    expect(voo.marketValue).toBe(3000);
    expect(voo.marketValueTwd).toBe(96000);
    expect(voo.cost).toBe(2502.5);
    expect(stockValueByAccount(rows).get('us')).toEqual({ twd: 96000, native: 3000 });
    expect(allocation(rows).map((a) => [a.name, a.total])).toEqual([['ETF', 96000], ['台股', 75000]]);
    const byYear = realizedByPeriod(pos, fx, 'year');
    expect(byYear[0].byCurrency).toEqual({ TWD: 33910.5, USD: 292.5 });
    expect(byYear[0].twd).toBe(33910.5 + 292.5 * 32);
  });
  test('手續費、證交稅估算', () => {
    expect(estimateTwFee(100000)).toBe(142);
    expect(estimateTwFee(5000)).toBe(20);
    expect(estimateTwFee(500, { oddLot: true })).toBe(1);
    expect(estimateTwFee(100000, { discount: 0.6 })).toBe(85);
    expect(estimateTwTax(195000)).toBe(585);
    expect(estimateTwTax(195000, 'etf')).toBe(195);
  });
});

describe('已實現損益記進月收支（CW 記法）', () => {
  const base = { brokerage_account_id: 'tw', market: 'TW', symbol: '2330', name: '台積電', kind: 'stock', currency: 'TWD', tax: 0 };
  const buy = { ...base, id: 'b', side: 'buy', trade_date: '2026-01-05', shares: 1000, price: 100, fee: 142 };
  // 賣 500 股 @120，手續費 85、稅 180 → 拿回 59,735；FIFO 成本 50,071 → 賺 9,664
  const sell = { ...base, id: 's', side: 'sell', trade_date: '2026-03-05', settle_date: '2026-03-09', shares: 500, price: 120, fee: 85, tax: 180,
    settlement_account_id: 'bank', settle_amount: 59735, settlement_txn_id: 'st' };
  const settleTx = { id: 'st', type: 'transfer', account_id: 'tw', amount: 59735, fx_rate: 1, to_account_id: 'bank', to_amount: 59735, to_fx_rate: 1, occurred_at: new Date('2026-03-09T00:00:00').toISOString() };
  const ctx = { gainCatId: 'gain', lossCatId: 'loss', rateFor: () => 32 };
  const apply = (txns, plan) => [...txns.map((t) => ({ ...t, ...(plan.update.find((u) => u.id === t.id)?.patch ?? {}) })).filter((t) => !plan.remove.includes(t.id)), ...plan.insert];

  test('交割轉帳改成成本 50,071，獲利 9,664 記在交割戶（交割日），兩筆加起來＝拿回的錢', () => {
    const plan = realizedTxnPlan({ trades: [buy, sell], txns: [settleTx], ...ctx });
    expect(plan.update).toEqual([{ id: 'st', patch: { amount: 50071, to_amount: 50071 } }]);
    expect(plan.insert[0]).toMatchObject({ type: 'income', amount: 9664, category_id: 'gain', account_id: 'bank', source: 'stock' });
    expect(new Date(plan.insert[0].occurred_at).getDate()).toBe(9);
    const after = apply([settleTx], plan);
    expect(computeBalances([{ id: 'bank', opening_balance: 0 }], after, null).get('bank')).toBe(59735);
  });
  test('已經記好就不動；改了以前的買進價，兩筆一起改；變成虧損就改成支出', () => {
    const p1 = realizedTxnPlan({ trades: [buy, sell], txns: [settleTx], ...ctx });
    const linked = { ...sell, pnl_txn_id: p1.insert[0].id };
    const txns = apply([settleTx], p1);
    expect(realizedTxnPlan({ trades: [buy, linked], txns, ...ctx })).toEqual({ insert: [], update: [], remove: [], link: [] });
    const loss = realizedTxnPlan({ trades: [{ ...buy, price: 130 }, linked], txns, ...ctx });
    const after = apply(txns, loss);
    const pnl = after.find((t) => t.id === linked.pnl_txn_id);
    expect([pnl.type, pnl.amount, pnl.category_id]).toEqual(['expense', 65071 - 59735, 'loss']);
    expect(after.find((t) => t.id === 'st').amount).toBe(65071);
    expect(computeBalances([{ id: 'bank', opening_balance: 0 }], after, null).get('bank')).toBe(59735);
  });
  test('美股＋台幣證券戶＋台幣交割：轉帳兩邊都記台幣成本，獲利換成台幣記在交割戶', () => {
    const us = { brokerage_account_id: 'ntd', market: 'US', symbol: 'SOXX', name: '', kind: 'etf', currency: 'USD', tax: 0, fee: 0 };
    const b1 = { ...us, id: 'x1', side: 'opening', trade_date: '2026-01-02', shares: 10, price: 200 };
    // 賣 10 股 @250 → 拿回 US$2,500，對帳單入帳 NT$80,000（匯率 32）；成本 US$2,000 → 賺 US$500 ＝ NT$16,000
    const s1 = { ...us, id: 'x2', side: 'sell', trade_date: '2026-06-01', settle_date: '2026-06-03', shares: 10, price: 250, settlement_account_id: 'bank', settle_amount: 80000, settlement_txn_id: 'st2' };
    const st2 = { id: 'st2', type: 'transfer', account_id: 'ntd', amount: 80000, fx_rate: 1, to_account_id: 'bank', to_amount: 80000, to_fx_rate: 1, occurred_at: new Date('2026-06-03T00:00:00').toISOString() };
    const plan = realizedTxnPlan({ trades: [b1, s1], txns: [st2], ...ctx, accountCurrency: (id) => ({ ntd: 'TWD', bank: 'TWD' }[id]) });
    expect(plan.update).toEqual([{ id: 'st2', patch: { amount: 64000, to_amount: 64000 } }]);
    expect(plan.insert[0]).toMatchObject({ type: 'income', amount: 16000, account_id: 'bank', fx_rate: 1 });
  });
  test('剛好打平就刪掉損益那筆、轉帳回到全額；沒有交割戶就記在證券戶；美股用匯率', () => {
    const p1 = realizedTxnPlan({ trades: [buy, sell], txns: [settleTx], ...ctx });
    const txns = apply([settleTx], p1);
    const even = { ...sell, price: (50071 + 85 + 180) / 500, settle_amount: 50071, pnl_txn_id: p1.insert[0].id };
    const p2 = realizedTxnPlan({ trades: [buy, even], txns, ...ctx });
    expect(p2.remove).toEqual([p1.insert[0].id]);
    const noSettle = realizedTxnPlan({ trades: [buy, { ...sell, settlement_account_id: null, settlement_txn_id: null }], txns: [], ...ctx });
    expect(noSettle.insert[0]).toMatchObject({ account_id: 'tw', amount: 9664 });
    const us = { ...base, market: 'US', symbol: 'VOO', currency: 'USD', brokerage_account_id: 'us' };
    const p = realizedTxnPlan({ trades: [{ ...us, id: 'u1', side: 'buy', trade_date: '2026-01-02', shares: 10, price: 500, fee: 0 }, { ...us, id: 'u2', side: 'sell', trade_date: '2026-06-01', shares: 10, price: 550, fee: 0 }], txns: [], ...ctx });
    expect(p.insert[0]).toMatchObject({ amount: 500, fx_rate: 32, account_id: 'us' });
  });
});

describe('淨資產', () => {
  test('隱藏帳戶不算；證券戶用股票市值；外幣用匯率；月底走勢', () => {
    const accounts = [
      { id: 'c', type: 'cash', currency: 'TWD', opening_balance: 1000 },
      { id: 'u', type: 'bank', currency: 'USD', opening_balance: 100 },
      { id: 'cc', type: 'credit_card', currency: 'TWD', opening_balance: 0 },
      { id: 'h', type: 'bank', currency: 'TWD', opening_balance: 99999, hidden: true },
      { id: 's', type: 'brokerage', currency: 'TWD', opening_balance: 0 },
    ];
    const txns = [{ type: 'expense', occurred_at: at('2026-10-15T10:00:00'), account_id: 'cc', amount: 300, fx_rate: 1, category_id: 'x' }];
    const fx = makeFx([{ currency: 'USD', rate_date: '2026-09-30', rate: 30 }, { currency: 'USD', rate_date: '2026-11-01', rate: 32 }]);
    const nw = netWorth({ accounts, balances: computeBalances(accounts, txns), fx, stockValue: new Map([['s', { twd: 5000, native: 5000 }]]) });
    expect(nw.total).toBe(1000 + 3200 - 300 + 5000);
    const series = netWorthSeries({ accounts, txns, monthKeys: ['2026-09', '2026-10'], fx, stockValueAt: () => new Map([['s', { twd: 5000 }]]), now: new Date('2026-11-24T12:00:00') });
    expect(series).toEqual([{ month: '2026-09', total: 1000 + 3000 + 5000 }, { month: '2026-10', total: 1000 + 3000 - 300 + 5000 }]);
  });
});

describe('從 CW 匯入', () => {
  const csv = '﻿日期,類別,主分類,子分類,帳戶,專案,金額,匯率,小計,更新時間,地址,發票號碼,轉帳,備註\r\n'
    + '2023/10/29,支出,飲食,早餐,現金,,85,1,85,2023/10/29 08:00,台北市某路,AB12345678,,蛋餅\r\n'
    + '2023/10/30,支出,轉帳,轉出,郵局,,3000,1,3000,,,,yes,\r\n'
    + '2023/10/30,收入,轉帳,轉入,美金帳戶,,3000,1,3000,,,,yes,\r\n'
    + '2023/10/30,支出,結帳,手續費,郵局,,15,1,15,,,,yes,\r\n'
    + '2023/10/31,支出,轉帳,轉出,現金,,500,1,500,,,,yes,\r\n'
    + '2023/10/31,收入,轉帳,轉入,郵局,,500,1,500,,,,yes,\r\n'
    + '2023/10/31,支出,結帳,手續費,現金,,0,1,0,,,,yes,\r\n'
    + '2023/11/01,支出,人際,借錢,現金,,430,1,430,,,,,幫小明付\r\n'
    + '2023/11/02,收入,其他收入,借錢的還錢,郵局,,430,1,430,,,,,"小明還,謝謝"\r\n'
    + '2023/11/05,收入,工作收入,薪水,郵局,,50000,1,50000,,,,,\r\n';
  const plan = analyzeCW(csv);

  test('三行一組的轉帳還原成一筆轉帳，手續費 > 0 另記', () => {
    expect(plan.stats).toMatchObject({ rows: 10, transfers: 2, fees: 1, from: '2023-10-29', to: '2023-11-05' });
    const tr = plan.items.filter((i) => i.type === 'transfer');
    expect(tr.map((t) => [t.from, t.to, t.amount, t.fee])).toEqual([['郵局', '美金帳戶', 3000, 15], ['現金', '郵局', 500, 0]]);
    expect(plan.warnings).toEqual([]);
    expect(plan.accounts.map((a) => a.name).sort()).toEqual(['現金', '美金帳戶', '郵局'].sort());
  });
  test('猜代墊類分類', () => {
    const lend = plan.categories.find((c) => c.sub === '借錢');
    const repay = plan.categories.find((c) => c.sub === '借錢的還錢');
    expect(guessAdvance(lend)).toBe('lend');
    expect(guessAdvance(repay)).toBe('repay');
    expect(guessAdvance(plan.categories.find((c) => c.sub === '早餐'))).toBeNull();
  });
  test('產生交易：時間 00:00、外幣用當天匯率換算、代墊改成朋友欠我轉帳、期初餘額反推', () => {
    const accs = { 現金: { id: 'cash', name: '現金', currency: 'TWD' }, 郵局: { id: 'post', name: '郵局', currency: 'TWD' }, 美金帳戶: { id: 'usd', name: '美金帳戶', currency: 'USD' } };
    const owe = { id: 'owe', currency: 'TWD' };
    const fx = makeFx([{ currency: 'USD', rate_date: '2023-10-27', rate: 30 }]);
    const { txns, problems } = buildImport({
      items: plan.items, accountOf: (n) => accs[n], categoryOf: (k) => `cat:${k}`,
      advanceOf: (k) => guessAdvance(plan.categories.find((c) => c.key === k)), friendsOwe: owe, feeCategoryId: 'fee',
      rateFor: (a, d) => fx.rateOn(a.currency, d),
    });
    expect(problems).toEqual([]);
    expect(txns.length).toBe(7);
    expect(new Date(txns[0].occurred_at).getHours()).toBe(0);
    const usdIn = txns.find((t) => t.to_account_id === 'usd');
    expect([usdIn.amount, usdIn.to_amount, usdIn.to_fx_rate]).toEqual([3000, 100, 30]);
    const fee = txns.find((t) => t.category_id === 'fee');
    expect([fee.amount, fee.parent_id]).toEqual([15, usdIn.id]);
    const lend = txns.find((t) => t.to_account_id === 'owe');
    expect([lend.type, lend.account_id, lend.amount]).toEqual(['transfer', 'cash', 430]);
    const repay = txns.find((t) => t.account_id === 'owe');
    expect([repay.to_account_id, repay.to_amount, repay.note]).toEqual(['post', 430, '小明還,謝謝']);
    expect(txns.find((t) => t.note === '蛋餅').category_id).toBe(`cat:${catKey('expense', '飲食', '早餐')}`);

    // CW 現在餘額：郵局 47,055 → 期初＝目前餘額 − 流水
    const accounts = Object.values(accs).map((a) => ({ ...a, opening_balance: 0 }));
    const flows = computeBalances([...accounts, { id: 'owe', opening_balance: 0 }], txns, null);
    expect(flows.get('post')).toBe(-3000 - 15 + 500 + 430 + 50000);
    expect(flows.get('owe')).toBe(0);
  });
  test('不是 CW 檔案時給清楚的錯誤', () => {
    expect(() => analyzeCW('a,b\n1,2')).toThrow('缺少欄位');
  });
});

describe('CSV 與預設資料', () => {
  test('匯出含 BOM，逗號/引號正確跳脫，可以再讀回來', () => {
    const accById = new Map([['a', { id: 'a', name: '現金', currency: 'TWD' }]]);
    const tree = buildTree([{ id: 'c', parent_id: null, kind: 'expense', name: '飲食', sort_order: 0 }]);
    const rows = transactionsToRows([{ type: 'expense', occurred_at: at('2026-11-01T08:30:00'), account_id: 'a', amount: 85, fx_rate: 1, category_id: 'c', note: '蛋餅, "加蛋"' }], { accById, tree });
    const text = toCSV(rows);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const back = parseCSV(text);
    expect(back[1][0]).toBe('2026-11-01');
    expect(back[1][12]).toBe('蛋餅, "加蛋"');
  });
  test('預設分類包含系統分類；缺系統項目時會補', () => {
    const cats = defaultCategoryRows();
    expect(cats.filter((c) => c.system_key).map((c) => c.system_key).sort()).toEqual(['dividend', 'fee', 'interest', 'investment_income', 'other_expense', 'stock_gain', 'stock_loss']);
    expect(cats.filter((c) => !c.parent_id && c.kind === 'expense').map((c) => c.name)).toEqual(['飲食', '交通', '日常用品', '居住', '娛樂', '繳費/訂閱', '醫療', '學習', '人際', '其他支出']);
    const accs = defaultAccountRows();
    expect(missingSystemRows(accs, cats)).toEqual({ insertAccounts: [], updateAccounts: [], insertCategories: [], updateCategories: [] });
    const plan = missingSystemRows([], cats.filter((c) => c.system_key !== 'fee'));
    expect(plan.insertAccounts.length).toBe(1);
    expect(plan.insertCategories.map((c) => c.name)).toEqual(['手續費']);
  });
  test('金額格式', () => {
    expect(fmt(-1234, 'TWD')).toBe('-$1,234');
    expect(fmt(12.5, 'USD')).toBe('US$12.50');
    expect(fmt(10.5, 'TWD')).toBe('$11');
    expect(fmt(10.5, 'TWD', { exact: true })).toBe('$10.50');
    expect(fmt(24097.16)).toBe('$24,097');
  });
});

test('只看例外：counts 的 only 模式', () => {
  const acc = new Map([['a', { id: 'a', hidden: false }]]);
  const normal = { type: 'expense', account_id: 'a', is_exception: false };
  const exc = { type: 'expense', account_id: 'a', is_exception: true };
  expect([counts(normal, acc, true), counts(exc, acc, true)]).toEqual([true, true]);
  expect([counts(normal, acc, false), counts(exc, acc, false)]).toEqual([true, false]);
  expect([counts(normal, acc, 'only'), counts(exc, acc, 'only')]).toEqual([false, true]);
});
