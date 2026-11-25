// 每天收盤後執行（GitHub Actions），改了這支程式推上去也會馬上跑一次：
//   1. 台股收盤價：TWSE OpenAPI（上市）＋ TPEx OpenAPI（上櫃），只存「有人持有」的代號
//   1b. 美股收盤價：Stooq（免費、不用金鑰），抓不到改用 Yahoo Finance；一樣只存有人持有的代號
//   2. 匯率：台灣銀行牌告匯率，存即期買賣的中間價（1 外幣 = ? 台幣）；
//      台銀會擋 GitHub 的伺服器（回驗證頁），擋到時改用 open.er-api.com 的每日匯率
//   3. 盤中（--intraday）：開盤時間每 10 分鐘抓一次持股的最新價（Yahoo Finance，約延遲 15–20 分鐘）
// 寫入 Supabase 的 stock_prices、fx_rates（這兩張表只有 secret key 能寫）。
//
// 環境變數：SUPABASE_URL、SUPABASE_SECRET_KEY（放在 GitHub Actions Secrets，絕對不要放進前端）
// 用法：node scripts/update-market-data.mjs              → 今天
//       node scripts/update-market-data.mjs --fx-from=2023-10-29  → 另外補抓這天以後每天的匯率（CW 匯入外幣帳戶用）
//       node scripts/update-market-data.mjs --intraday             → 盤中更新（只有開盤中的市場）

const TWSE_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
const TPEX_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes';
const BOT_URL = (day = 'day') => `https://rate.bot.com.tw/xrt/flcsv/0/${day}`;
const ER_URL = 'https://open.er-api.com/v6/latest/TWD';
const STOOQ_URL = (sym) => `https://stooq.com/q/l/?s=${encodeURIComponent(sym.toLowerCase())}.us&f=sd2t2c&h&e=csv`;
const YAHOO_URL = (sym) => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`;
const CURRENCIES = ['USD', 'JPY', 'EUR', 'CNY', 'HKD', 'GBP', 'AUD', 'CAD', 'SGD', 'KRW', 'CHF', 'NZD', 'THB'];

/** 台北時間的今天 'YYYY-MM-DD' */
export const taipeiToday = (now = new Date()) => new Date(now.getTime() + 8 * 3600e3).toISOString().slice(0, 10);

/** '1151124'（民國）或 '20261124' 或 '2026-11-24' → '2026-11-24' */
export function parseTwDate(s, fallback) {
  const t = String(s ?? '').replace(/[/\-.]/g, '').trim();
  if (/^\d{7}$/.test(t)) return `${Number(t.slice(0, 3)) + 1911}-${t.slice(3, 5)}-${t.slice(5, 7)}`;
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  return fallback;
}

const price = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };

/** TWSE / TPEx JSON → [{ market, symbol, price_date, close, name }]，只留 wanted 裡的代號 */
export function parseTwPrices(rows, wanted, today) {
  const out = [];
  for (const r of rows ?? []) {
    const symbol = String(r.Code ?? r.SecuritiesCompanyCode ?? '').trim();
    if (!wanted.has(symbol)) continue;
    const close = price(r.ClosingPrice ?? r.Close);
    if (close == null) continue; // 當天沒成交
    out.push({ market: 'TW', symbol, price_date: parseTwDate(r.Date, today), close, name: String(r.Name ?? r.CompanyName ?? '').trim() });
  }
  return out;
}

/** 台銀 CSV → [{ currency, rate_date, rate }]（即期買入、賣出的中間價；沒有即期就用現金） */
export function parseBotCsv(text, date) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const head = lines[0].split(',').map((h) => h.trim());
  let spot = head.flatMap((h, i) => (h === '即期' ? [i] : []));
  let cash = head.flatMap((h, i) => (h === '現金' ? [i] : []));
  // 標題讀不懂（例如編碼不同變亂碼）時，照台銀固定的欄位位置：現金買 2、即期買 3、現金賣 12、即期賣 13
  if (spot.length !== 2) spot = [3, 13];
  if (cash.length !== 2) cash = [2, 12];
  const out = [];
  for (const line of lines.slice(1)) {
    const c = line.split(',').map((x) => x.trim());
    const currency = c[0];
    if (!/^[A-Z]{3}$/.test(currency)) continue;
    const mid = (idx) => {
      const [b, s] = idx.map((i) => price(c[i]));
      return b && s ? (b + s) / 2 : b || s || null;
    };
    const rate = (spot.length === 2 && mid(spot)) || (cash.length === 2 && mid(cash));
    if (rate) out.push({ currency, rate_date: date, rate: Math.round(rate * 1e6) / 1e6 });
  }
  return out;
}

/** open.er-api.com（以台幣為基準：1 台幣 = x 外幣）→ 1 外幣 = 1/x 台幣 */
export function parseErApi(json, date) {
  if (json?.result !== 'success' || !json.rates) return [];
  return CURRENCIES.filter((c) => Number(json.rates[c]) > 0)
    .map((c) => ({ currency: c, rate_date: date, rate: Math.round((1 / Number(json.rates[c])) * 1e6) / 1e6 }));
}

// ---------------------------------------------------------------------
/** Stooq CSV（Symbol,Date,Time,Close）→ { market, symbol, price_date, close }；沒資料回傳 null */
export function parseStooqCsv(text) {
  const lines = String(text).trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const [sym, date, , close] = lines[1].split(',').map((x) => x.trim());
  const c = Number(close);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(c > 0)) return null; // 查不到時是 N/D
  return { market: 'US', symbol: sym.replace(/\.US$/i, '').toUpperCase(), price_date: date, close: c, name: '' };
}

/** Yahoo chart JSON → 最後一個有收盤價的交易日（日期用紐約時間） */
export function parseYahooChart(json, symbol) {
  const r = json?.chart?.result?.[0];
  const ts = r?.timestamp ?? [];
  const closes = r?.indicators?.quote?.[0]?.close ?? [];
  for (let i = ts.length - 1; i >= 0; i--) {
    const c = Number(closes[i]);
    if (!(c > 0)) continue;
    const price_date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts[i] * 1000));
    return { market: 'US', symbol: symbol.toUpperCase(), price_date, close: Math.round(c * 10000) / 10000, name: '' };
  }
  return null;
}

/** 現在哪些市場開盤中（台股 09:00–13:30 台北；美股 09:30–16:00 紐約），多抓 10 分鐘收尾 */
export function openMarkets(now = new Date()) {
  const parts = (tz) => {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
    const get = (t) => f.find((x) => x.type === t)?.value;
    return { wd: get('weekday'), min: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
  };
  const weekday = (wd) => !['Sat', 'Sun'].includes(wd);
  const tw = parts('Asia/Taipei'); const us = parts('America/New_York');
  const out = [];
  if (weekday(tw.wd) && tw.min >= 9 * 60 && tw.min <= 13 * 60 + 40) out.push('TW');
  if (weekday(us.wd) && us.min >= 9 * 60 + 30 && us.min <= 16 * 60 + 10) out.push('US');
  return out;
}

/** Yahoo chart 的即時報價（meta.regularMarketPrice）→ 今天的價格；日期用該市場當地時間 */
export function parseYahooQuote(json, market, symbol) {
  const m = json?.chart?.result?.[0]?.meta;
  const price = Number(m?.regularMarketPrice);
  const t = Number(m?.regularMarketTime);
  if (!(price > 0) || !(t > 0)) return null;
  const tz = market === 'TW' ? 'Asia/Taipei' : 'America/New_York';
  const price_date = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t * 1000));
  return { market, symbol: symbol.toUpperCase(), price_date, close: Math.round(price * 10000) / 10000, name: '' };
}

async function main() {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!base || !key) throw new Error('缺少 SUPABASE_URL 或 SUPABASE_SECRET_KEY');
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`; // 舊版 service_role JWT

  const rest = async (path, init = {}) => {
    const res = await fetch(`${base}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init.headers } });
    // 錯誤訊息只留代碼和說明：details 可能帶到股票代號，公開 repo 的執行紀錄任何人都看得到
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(`Supabase ${res.status}：${b.code ?? ''} ${b.message ?? ''}`.trim()); }
    return res.status === 204 ? null : res.json().catch(() => null);
  };
  const upsert = (table, conflict, rows) => (rows.length
    ? rest(`${table}?on_conflict=${conflict}`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) })
    : null);
  /** 台銀的 CSV 可能是 UTF-8 也可能是 Big5，兩種都試 */
  const decode = (buf) => {
    const utf8 = new TextDecoder('utf-8').decode(buf);
    if (!utf8.includes('\uFFFD')) return utf8;
    try { return new TextDecoder('big5').decode(buf); } catch { return utf8; }
  };
  const get = async (url) => {
    const res = await fetch(url, { headers: { 'User-Agent': 'ledger-app-price-updater' } });
    if (!res.ok) throw new Error(`${new URL(url).host} → ${res.status}`); // 不印完整網址（裡面有股票代號）
    return res;
  };

  const today = taipeiToday();

  // 盤中模式：只抓開盤中的市場、有人持有的代號；抓不到不算失敗（下一輪再試，收盤後的每日更新會補正式收盤價）
  if (process.argv.includes('--intraday')) {
    const markets = openMarkets();
    if (!markets.length) { console.log('現在沒有市場開盤，略過'); return; }
    for (const market of markets) {
      const held = await rest(`stock_trades?select=symbol&market=eq.${market}`);
      const wanted = [...new Set((held ?? []).map((r) => r.symbol.toUpperCase()))];
      const rows = [];
      for (const sym of wanted) {
        // 台股要加 .TW（上市）或 .TWO（上櫃），不知道是哪個就兩個都試
        const tries = market === 'TW' ? [`${sym}.TW`, `${sym}.TWO`] : [sym];
        for (const y of tries) {
          try {
            const row = parseYahooQuote(await (await get(YAHOO_URL(y).replace('range=5d', 'range=1d'))).json(), market, sym);
            if (row) { rows.push(row); break; }
          } catch (e) { console.warn(`${market} 盤中有一檔失敗：${e.message}`); }
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      await upsert('stock_prices', 'market,symbol,price_date', rows);
      // 只印檔數：repo 是公開的，執行紀錄任何人都看得到，不能印出持有哪些股票
      console.log(`${market} 盤中：${rows.length}/${wanted.length} 檔`);
    }
    return;
  }

  const fxFrom = process.argv.find((a) => a.startsWith('--fx-from='))?.split('=')[1];
  let failures = 0;

  // 1. 台股收盤價（只抓有人持有的代號）
  try {
    const held = await rest('stock_trades?select=symbol&market=eq.TW');
    const wanted = new Set((held ?? []).map((r) => r.symbol));
    if (wanted.size) {
      const [twse, tpex] = await Promise.all([
        get(TWSE_URL).then((r) => r.json()).catch((e) => { console.warn('TWSE 失敗', e.message); return []; }),
        get(TPEX_URL).then((r) => r.json()).catch((e) => { console.warn('TPEx 失敗', e.message); return []; }),
      ]);
      const rows = [...parseTwPrices(twse, wanted, today), ...parseTwPrices(tpex, wanted, today)];
      await upsert('stock_prices', 'market,symbol,price_date', rows);
      console.log(`台股收盤價：${rows.length}/${wanted.size} 檔`);
    } else console.log('台股收盤價：沒有人持有台股，略過');
  } catch (e) { failures++; console.error('台股收盤價失敗：', e.message); }

  // 1b. 美股收盤價（只抓有人持有的代號）
  try {
    const held = await rest('stock_trades?select=symbol&market=eq.US');
    const wanted = [...new Set((held ?? []).map((r) => r.symbol.toUpperCase()))];
    if (wanted.length) {
      const rows = [];
      const missing = [];
      for (const sym of wanted) {
        let row = null;
        try { row = parseStooqCsv(await (await get(STOOQ_URL(sym))).text()); } catch (e) { console.warn(`Stooq 有一檔失敗：${e.message}`); }
        if (!row) {
          try { row = parseYahooChart(await (await get(YAHOO_URL(sym))).json(), sym); } catch (e) { console.warn(`Yahoo 有一檔失敗：${e.message}`); }
        }
        if (row) rows.push(row); else missing.push(sym);
        await new Promise((r) => setTimeout(r, 300)); // 不要打太快
      }
      await upsert('stock_prices', 'market,symbol,price_date', rows);
      console.log(`美股收盤價：${rows.length}/${wanted.length} 檔`);
      if (missing.length) throw new Error(`有 ${missing.length} 檔抓不到`);
    } else console.log('美股收盤價：沒有人持有美股，略過');
  } catch (e) { failures++; console.error('美股收盤價失敗：', e.message); }

  // 2. 今天的匯率
  try {
    let rows = [];
    let source = '台銀';
    try {
      const text = decode(await (await get(BOT_URL('day'))).arrayBuffer());
      rows = parseBotCsv(text, today);
      if (!rows.length) console.warn(`台銀回傳的不是匯率（開頭：${text.slice(0, 80).replace(/\s+/g, ' ')}），改用備用來源`);
    } catch (e) { console.warn(`台銀失敗（${e.message}），改用備用來源`); }
    if (!rows.length) {
      source = 'open.er-api.com';
      rows = parseErApi(await (await get(ER_URL)).json(), today);
    }
    if (!rows.length) throw new Error('兩個匯率來源都抓不到');
    await upsert('fx_rates', 'currency,rate_date', rows);
    console.log(`匯率（${source}）：${rows.length} 種幣別（${today}），USD ${rows.find((r) => r.currency === 'USD')?.rate}`);
  } catch (e) { failures++; console.error('匯率失敗：', e.message); }

  // 3. 補抓歷史匯率（選用）
  if (fxFrom) {
    let n = 0;
    for (let d = new Date(`${fxFrom}T00:00:00Z`); d.toISOString().slice(0, 10) < today; d.setUTCDate(d.getUTCDate() + 1)) {
      const day = d.toISOString().slice(0, 10);
      if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
      try {
        const rows = parseBotCsv(decode(await (await get(BOT_URL(day))).arrayBuffer()), day);
        await upsert('fx_rates', 'currency,rate_date', rows);
        n += rows.length ? 1 : 0;
      } catch (e) { console.warn(`${day} 匯率失敗：${e.message}`); }
      await new Promise((r) => setTimeout(r, 300)); // 不要打太快
    }
    console.log(`補抓匯率：${n} 天`);
  }

  if (failures) process.exit(1); // 有任何一項失敗就讓 GitHub 顯示紅色
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
