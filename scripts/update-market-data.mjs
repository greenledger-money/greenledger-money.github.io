// 每天收盤後執行（GitHub Actions），改了這支程式推上去也會馬上跑一次：
//   1. 台股收盤價：TWSE OpenAPI（上市）＋ TPEx OpenAPI（上櫃），只存「有人持有」的代號
//   2. 匯率：台灣銀行牌告匯率，存即期買賣的中間價（1 外幣 = ? 台幣）；
//      台銀會擋 GitHub 的伺服器（回驗證頁），擋到時改用 open.er-api.com 的每日匯率
// 寫入 Supabase 的 stock_prices、fx_rates（這兩張表只有 secret key 能寫）。
//
// 環境變數：SUPABASE_URL、SUPABASE_SECRET_KEY（放在 GitHub Actions Secrets，絕對不要放進前端）
// 用法：node scripts/update-market-data.mjs              → 今天
//       node scripts/update-market-data.mjs --fx-from=2023-10-29  → 另外補抓這天以後每天的匯率（CW 匯入外幣帳戶用）

const TWSE_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
const TPEX_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes';
const BOT_URL = (day = 'day') => `https://rate.bot.com.tw/xrt/flcsv/0/${day}`;
const ER_URL = 'https://open.er-api.com/v6/latest/TWD';
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
async function main() {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!base || !key) throw new Error('缺少 SUPABASE_URL 或 SUPABASE_SECRET_KEY');
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`; // 舊版 service_role JWT

  const rest = async (path, init = {}) => {
    const res = await fetch(`${base}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init.headers } });
    if (!res.ok) throw new Error(`Supabase ${res.status}：${await res.text()}`);
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
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return res;
  };

  const today = taipeiToday();
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
