// 試用模式的範例資料：最近一年，日期跟著今天走。資料都是虛構的。
import { defaultAccountRows, defaultCategoryRows } from '../lib/defaults.js';
import { uid } from '../lib/ledger.js';
import { addDays, addBusinessDays, todayStr, parseYmd, ymd } from '../lib/dates.js';
import { buildSplit } from '../lib/ledger.js';

function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }

export function seedDemo(db) {
  const user = db.user.id;
  const now = new Date().toISOString();
  const T = db.tables;
  const today = todayStr();
  const r = rng(20261124);
  const at = (date, h = 12, m = 0) => { const d = parseYmd(date); d.setHours(h, m); return d.toISOString(); };
  const stamp = (row) => ({ user_id: user, created_at: now, ...row });

  T.profiles.push({ user_id: user, settings: {}, created_at: now });
  const accounts = defaultAccountRows();
  const A = (name, type, currency, opening, sort) => { const a = { id: uid(), name, type, currency, opening_balance: opening, hidden: false, system_key: null, sort_order: sort }; accounts.push(a); return a; };
  const cash = accounts[0]; cash.opening_balance = 4200;
  const owe = accounts[1];
  const post = A('郵局', 'bank', 'TWD', 68000, 1);
  const settle = A('國泰交割戶', 'bank', 'TWD', 152000, 2);
  const cube = A('國泰 Cube 卡', 'credit_card', 'TWD', -4200, 3);
  const line = A('LINE Pay', 'e_payment', 'TWD', 1600, 4);
  const easy = A('悠遊卡', 'e_payment', 'TWD', 350, 5);
  const usd = A('美金帳戶', 'bank', 'USD', 1200, 6);
  const twBrk = A('國泰台股', 'brokerage', 'TWD', 0, 7);
  const usBrk = A('國泰美股', 'brokerage', 'USD', 0, 8);
  T.accounts.push(...accounts.map(stamp));

  const cats = defaultCategoryRows();
  T.categories.push(...cats.map((c) => stamp({ archived: false, ...c })));
  const C = (path) => {
    const [a, b] = path.split('-');
    const top = cats.find((c) => !c.parent_id && c.name === a);
    return b ? cats.find((c) => c.parent_id === top.id && c.name === b).id : top.id;
  };

  const tx = [];
  let cardDue = 4200;
  const add = (row) => tx.push({
    id: uid(), fx_rate: 1, to_account_id: null, to_amount: null, to_fx_rate: null, category_id: null, note: '',
    is_exception: false, parent_id: null, group_id: null, source: 'manual', pending_item_id: null, ...row,
  });
  const exp = (date, cat, acc, amount, note = '', h = 12) => {
    if (acc === cube) cardDue += amount;
    add({ type: 'expense', occurred_at: at(date, h, Math.floor(r() * 59)), account_id: acc.id, amount, category_id: C(cat), note });
  };
  const inc = (date, cat, acc, amount, note = '') => add({ type: 'income', occurred_at: at(date, 10), account_id: acc.id, amount, category_id: C(cat), note });
  const tr = (date, from, to, amount, note = '', toAmount = amount, fx = 1) => add({ type: 'transfer', occurred_at: at(date, 9), account_id: from.id, amount, fx_rate: fx, to_account_id: to.id, to_amount: toAmount, to_fx_rate: 1, note });

  const start = addDays(today, -365);
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const wd = parseYmd(d).getDay();
    if (r() < 0.85) exp(d, '飲食-早餐', r() < 0.6 ? cash : line, [55, 60, 65, 70, 85][Math.floor(r() * 5)], ['蛋餅', '飯糰', '三明治', ''][Math.floor(r() * 4)], 8);
    if (wd > 0 && wd < 6) exp(d, '飲食-午餐', r() < 0.5 ? cash : line, 90 + Math.round(r() * 8) * 10, '', 12);
    if (r() < 0.7) exp(d, '飲食-晚餐', r() < 0.5 ? cube : cash, 110 + Math.round(r() * 20) * 10, '', 19);
    if (r() < 0.35) exp(d, '飲食-飲料點心', line, 50 + Math.round(r() * 4) * 10, ['珍奶', '咖啡', '豆花'][Math.floor(r() * 3)], 15);
    if (wd > 0 && wd < 6) exp(d, '交通-大眾運輸', easy, 30, '', 8);
    if (r() < 0.08) exp(d, '日常用品', cube, 150 + Math.round(r() * 40) * 10, '全聯', 18);
    if (r() < 0.05) exp(d, '娛樂', cube, 300 + Math.round(r() * 50) * 10, ['電影', '桌遊', 'KTV'][Math.floor(r() * 3)], 20);
    if (r() < 0.03) exp(d, '交通-計程車', line, 180 + Math.round(r() * 15) * 10, '', 23);
    const dom = parseYmd(d).getDate();
    if (dom === 5) inc(d, '工作收入-薪水', post, 52000, '薪水');
    if (dom === 6) { tr(d, post, cube, cardDue, '繳卡費'); cardDue = 0; }
    if (dom === 1) exp(d, '居住-房租', post, 12000, '房租');
    if (dom === 12) exp(d, '繳費/訂閱', cube, 390, 'Netflix');
    if (dom === 20) exp(d, '居住-水電瓦斯', post, 800 + Math.round(r() * 30) * 10, '');
    if (dom === 3 || dom === 18) tr(d, post, easy, 350, '悠遊卡加值');
    if (dom === 1 || dom === 15) tr(d, post, line, 1500, 'LINE Pay 儲值');
    if (dom === 2 || dom === 18) tr(d, post, cash, 2500, '提款');
    if (dom === 25 && r() < 0.4) inc(d, '工作收入-獎金', post, 5000 + Math.round(r() * 10) * 1000, '');
  }
  // 規格書的分帳範例：LINE Pay 幫大家付 500、自己吃 70，小明還現金 215、小華轉郵局 215
  const sd = addDays(today, -9);
  buildSplit({ accountId: line.id, total: 500, mine: 70, categoryId: C('飲食-午餐'), occurredAt: at(sd, 12, 30), note: '公司聚餐', friendsOweId: owe.id })
    .forEach((row) => add({ ...row, source: 'split' }));
  tr(addDays(sd, 1), owe, cash, 215, '小明還錢');
  tr(addDays(sd, 2), owe, post, 215, '小華還錢');
  // 年度例外：三層分類
  const ex = { id: uid(), parent_id: null, kind: 'expense', name: '年度例外', system_key: null, sort_order: 20 };
  const gift = { id: uid(), parent_id: ex.id, kind: 'expense', name: '禮物', system_key: null, sort_order: 0 };
  const ming = { id: uid(), parent_id: gift.id, kind: 'expense', name: '小明', system_key: null, sort_order: 0 };
  cats.push(ex, gift, ming);
  T.categories.push(...[ex, gift, ming].map((c) => stamp({ archived: false, ...c })));
  add({ type: 'expense', occurred_at: at(addDays(today, -30), 20), account_id: cube.id, amount: 2680, category_id: ming.id, note: '生日禮物', is_exception: true });
  // 美金：轉帳換匯＋手續費
  const fxd = addDays(today, -40);
  const conv = { id: uid() };
  add({ id: conv.id, type: 'transfer', occurred_at: at(fxd, 11), account_id: post.id, amount: 32150, to_account_id: usd.id, to_amount: 1000, to_fx_rate: 32.15, note: '換美金' });
  add({ type: 'expense', occurred_at: at(fxd, 11), account_id: post.id, amount: 30, category_id: C('其他支出-手續費'), note: '轉帳手續費', parent_id: conv.id });
  add({ type: 'expense', occurred_at: at(addDays(today, -12), 14), account_id: usd.id, amount: 45.9, fx_rate: 32.4, category_id: C('學習'), note: '線上課程' });

  // 股票
  const trades = [];
  const trade = (row) => trades.push(stamp({
    id: uid(), name: '', kind: 'stock', settle_date: null, fee: 0, tax: 0, settlement_account_id: null, settle_amount: null,
    settlement_txn_id: null, order_no: null, pending_item_id: null, note: '', ...row,
  }));
  const open = addDays(today, -390);
  trade({ brokerage_account_id: twBrk.id, market: 'TW', symbol: '0050', name: '元大台灣50', kind: 'etf', side: 'opening', trade_date: open, shares: 2000, price: 168.4, currency: 'TWD' });
  trade({ brokerage_account_id: twBrk.id, market: 'TW', symbol: '2330', name: '台積電', kind: 'stock', side: 'opening', trade_date: open, shares: 120, price: 905, currency: 'TWD' });
  trade({ brokerage_account_id: usBrk.id, market: 'US', symbol: 'VOO', name: 'Vanguard S&P 500 ETF', kind: 'etf', side: 'opening', trade_date: open, shares: 6, price: 512.3, currency: 'USD' });
  const buyDate = addDays(today, -50);
  const buySettle = addBusinessDays(buyDate, 2);
  const buyTxn = uid();
  trade({ brokerage_account_id: twBrk.id, market: 'TW', symbol: '2330', name: '台積電', kind: 'stock', side: 'buy', trade_date: buyDate, settle_date: buySettle, shares: 30, price: 1010, fee: 43, currency: 'TWD', settlement_account_id: settle.id, settle_amount: 30343, settlement_txn_id: buyTxn, order_no: 'D0001' });
  add({ id: buyTxn, type: 'transfer', occurred_at: at(buySettle, 0), account_id: settle.id, amount: 30343, to_account_id: twBrk.id, to_amount: 30343, to_fx_rate: 1, note: '買進 2330 台積電 30 股', source: 'stock' });
  const sellDate = addDays(today, -20);
  const sellSettle = addBusinessDays(sellDate, 2);
  const sellTxn = uid();
  trade({ brokerage_account_id: twBrk.id, market: 'TW', symbol: '2330', name: '台積電', kind: 'stock', side: 'sell', trade_date: sellDate, settle_date: sellSettle, shares: 50, price: 1080, fee: 76, tax: 162, currency: 'TWD', settlement_account_id: settle.id, settle_amount: 53762, settlement_txn_id: sellTxn, order_no: 'D0002' });
  add({ id: sellTxn, type: 'transfer', occurred_at: at(sellSettle, 0), account_id: twBrk.id, amount: 53762, to_account_id: settle.id, to_amount: 53762, to_fx_rate: 1, note: '賣出 2330 台積電 50 股', source: 'stock' });
  T.stock_trades.push(...trades);
  // 0050 股利
  const divTxn = uid();
  const divDate = addDays(today, -26);
  add({ id: divTxn, type: 'income', occurred_at: at(divDate, 0), account_id: settle.id, amount: 1960, category_id: C('投資收入-股利'), note: '0050 股利', source: 'dividend' });
  T.dividends.push(stamp({ id: uid(), brokerage_account_id: twBrk.id, market: 'TW', symbol: '0050', pay_date: divDate, gross: 1960, withholding: 0, nhi_premium: 0, currency: 'TWD', transaction_id: divTxn, note: '' }));

  T.transactions.push(...tx.map((t) => stamp({ updated_at: now, ...t })));

  // 範本、固定收支
  T.templates.push(stamp({ id: uid(), name: '早餐', mode: 'instant', type: 'expense', account_id: cash.id, to_account_id: null, category_id: C('飲食-早餐'), amount: 60, note: '', is_exception: false, sort_order: 0 }));
  T.templates.push(stamp({ id: uid(), name: '午餐', mode: 'fill', type: 'expense', account_id: line.id, to_account_id: null, category_id: C('飲食-午餐'), amount: null, note: '', is_exception: false, sort_order: 1 }));
  T.templates.push(stamp({ id: uid(), name: '悠遊卡加值', mode: 'instant', type: 'transfer', account_id: post.id, to_account_id: easy.id, category_id: null, amount: 500, note: '', is_exception: false, sort_order: 2 }));
  const d0 = parseYmd(today);
  const nextMonthDay = (day) => ymd(new Date(d0.getFullYear(), d0.getMonth() + (d0.getDate() >= day ? 1 : 0), day));
  T.recurring_rules.push(stamp({ id: uid(), name: '房租', type: 'expense', account_id: post.id, to_account_id: null, category_id: C('居住-房租'), amount: 12000, note: '', interval_unit: 'month', interval_count: 1, start_date: nextMonthDay(1), end_date: null, next_index: 0, active: true }));
  T.recurring_rules.push(stamp({ id: uid(), name: 'Spotify', type: 'expense', account_id: cube.id, to_account_id: null, category_id: C('繳費/訂閱'), amount: 149, note: '', interval_unit: 'month', interval_count: 1, start_date: addDays(today, -1), end_date: null, next_index: 0, active: true }));

  // 公開資料（範例）：匯率、收盤價
  const fx = []; const px = [];
  let usdRate = 31.6; let p50 = 170; let p2330 = 960;
  for (let d = addDays(today, -400); d <= today; d = addDays(d, 1)) {
    const wd = parseYmd(d).getDay();
    if (wd === 0 || wd === 6) continue;
    usdRate = Math.round((usdRate + (r() - 0.48) * 0.08) * 1000) / 1000;
    p50 = Math.round((p50 * (1 + (r() - 0.47) * 0.012)) * 100) / 100;
    p2330 = Math.round(p2330 * (1 + (r() - 0.47) * 0.016) / 5) * 5;
    fx.push({ currency: 'USD', rate_date: d, rate: usdRate });
    px.push({ market: 'TW', symbol: '0050', price_date: d, close: p50, name: '元大台灣50' });
    px.push({ market: 'TW', symbol: '2330', price_date: d, close: p2330, name: '台積電' });
  }
  db.shared = { fx_rates: fx, stock_prices: px };
  T.manual_prices.push(stamp({ id: uid(), market: 'US', symbol: 'VOO', price_date: addDays(today, -1), close: 561.2 }));
}
