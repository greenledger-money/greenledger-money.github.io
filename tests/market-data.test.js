// 每日更新腳本的解析器（用固定樣本測，不連網路）
import { describe, expect, test } from 'bun:test';
import { parseBotCsv, parseErApi, parseTwDate, parseTwPrices, taipeiToday, parseStooqCsv, parseYahooChart, openMarkets, parseYahooQuote } from '../scripts/update-market-data.mjs';

describe('股價、匯率解析', () => {
  test('民國／西元日期', () => {
    expect(parseTwDate('1151124')).toBe('2026-11-24');
    expect(parseTwDate('20261124')).toBe('2026-11-24');
    expect(parseTwDate('2026/11/24')).toBe('2026-11-24');
    expect(parseTwDate('', '2026-01-01')).toBe('2026-01-01');
    expect(taipeiToday(new Date('2026-11-24T17:00:00Z'))).toBe('2026-11-25');
  });
  test('TWSE、TPEx 只留持有的代號，跳過沒成交的', () => {
    const twse = [
      { Date: '1151124', Code: '2330', Name: '台積電', ClosingPrice: '1,085.00' },
      { Date: '1151124', Code: '0050', Name: '元大台灣50', ClosingPrice: '182.35' },
      { Date: '1151124', Code: '1101', Name: '台泥', ClosingPrice: '' },
    ];
    const tpex = [{ Date: '1151124', SecuritiesCompanyCode: '6488', CompanyName: '環球晶', Close: '420.5' }];
    const wanted = new Set(['2330', '6488', '1101']);
    expect([...parseTwPrices(twse, wanted, 'x'), ...parseTwPrices(tpex, wanted, 'x')]).toEqual([
      { market: 'TW', symbol: '2330', price_date: '2026-11-24', close: 1085, name: '台積電' },
      { market: 'TW', symbol: '6488', price_date: '2026-11-24', close: 420.5, name: '環球晶' },
    ]);
  });
  test('備用匯率來源：1 台幣＝x 外幣 → 1 外幣＝1/x 台幣', () => {
    const json = { result: 'success', base_code: 'TWD', rates: { TWD: 1, USD: 0.030769, JPY: 4.65 } };
    expect(parseErApi(json, '2026-11-25')).toEqual([
      { currency: 'USD', rate_date: '2026-11-25', rate: 32.500244 },
      { currency: 'JPY', rate_date: '2026-11-25', rate: 0.215054 },
    ]);
    expect(parseErApi({ result: 'error' }, 'x')).toEqual([]);
  });
  test('標題變亂碼時照欄位位置讀', () => {
    const csv = '\uFFFD\uFFFD,x,x,x,x,x,x,x,x,x,x,x,x,x\nUSD,買,32.54,32.865,0,0,0,0,0,0,0,賣,33.21,33.015\n';
    expect(parseBotCsv(csv, '2026-11-25')).toEqual([{ currency: 'USD', rate_date: '2026-11-25', rate: 32.94 }]);
  });
  test('台銀 CSV：即期買賣中價，沒有即期用現金', () => {
    const csv = '﻿幣別,匯率,現金,即期,遠期10天,遠期30天,遠期60天,遠期90天,遠期120天,遠期150天,遠期180天,匯率,現金,即期,遠期10天,遠期30天,遠期60天,遠期90天,遠期120天,遠期150天,遠期180天\r\n'
      + 'USD,本行買入,31.925,32.275,32.2,32.15,32.06,31.98,31.9,31.82,31.74,本行賣出,32.595,32.425,32.36,32.31,32.22,32.14,32.06,31.98,31.9\r\n'
      + 'THB,本行買入,0.8471,0,0,0,0,0,0,0,0,本行賣出,1.0341,0,0,0,0,0,0,0,0\r\n';
    expect(parseBotCsv(csv, '2026-11-24')).toEqual([
      { currency: 'USD', rate_date: '2026-11-24', rate: 32.35 },
      { currency: 'THB', rate_date: '2026-11-24', rate: 0.9406 },
    ]);
  });
});

test('美股：Stooq CSV', () => {
  expect(parseStooqCsv('Symbol,Date,Time,Close\r\nSOXX.US,2026-11-24,22:00:09,265.31\r\n'))
    .toEqual({ market: 'US', symbol: 'SOXX', price_date: '2026-11-24', close: 265.31, name: '' });
  expect(parseStooqCsv('Symbol,Date,Time,Close\nXXXX.US,N/D,N/D,N/D\n')).toBeNull();
  expect(parseStooqCsv('')).toBeNull();
});

test('美股：Yahoo chart 取最後一個有收盤價的交易日（紐約日期）', () => {
  const json = { chart: { result: [{ timestamp: [1763994600, 1764081000], indicators: { quote: [{ close: [100.123456, null] }] } }] } };
  expect(parseYahooChart(json, 'tsm')).toEqual({ market: 'US', symbol: 'TSM', price_date: '2025-11-24', close: 100.1235, name: '' });
  expect(parseYahooChart({ chart: { result: null } }, 'TSM')).toBeNull();
});

test('盤中：哪些市場開盤中', () => {
  expect(openMarkets(new Date('2026-11-25T02:00:00Z'))).toEqual(['TW']);      // 台北週三 10:00
  expect(openMarkets(new Date('2026-11-25T06:00:00Z'))).toEqual([]);          // 台北 14:00 收盤
  expect(openMarkets(new Date('2026-11-25T15:00:00Z'))).toEqual(['US']);      // 紐約週三 10:00
  expect(openMarkets(new Date('2026-11-28T02:00:00Z'))).toEqual([]);          // 台北週六
  expect(openMarkets(new Date('2026-07-01T13:45:00Z'))).toEqual(['US']);      // 夏令時間：紐約 09:45
});

test('盤中：Yahoo 即時價，日期用當地時間', () => {
  const j = (price, time) => ({ chart: { result: [{ meta: { regularMarketPrice: price, regularMarketTime: time } }] } });
  expect(parseYahooQuote(j(1085, 1764036000), 'TW', '2330')).toEqual({ market: 'TW', symbol: '2330', price_date: '2025-11-25', close: 1085, name: '' });
  expect(parseYahooQuote(j(262.7812345, 1764086400), 'US', 'qqqm')).toEqual({ market: 'US', symbol: 'QQQM', price_date: '2025-11-25', close: 262.7812, name: '' });
  expect(parseYahooQuote({ chart: { result: [{ meta: {} }] } }, 'TW', '2330')).toBeNull();
});

test('runUpdate：每日模式整套流程（假的網路），寫入台股、美股、匯率', async () => {
  const { runUpdate } = await import('../scripts/update-market-data.mjs');
  const posts = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.includes('/rest/v1/stock_trades')) return json(u.includes('market=eq.TW') ? [{ symbol: '2330' }] : [{ symbol: 'voo' }]);
    if (u.includes('/rest/v1/')) { posts.push([u.split('/rest/v1/')[1].split('?')[0], JSON.parse(init.body)]); return new Response(null, { status: 201 }); }
    if (u.includes('twse')) return json([{ Code: '2330', Name: '台積電', ClosingPrice: '1,085.00', Date: '1151125' }]);
    if (u.includes('tpex')) return json([]);
    if (u.includes('stooq')) return new Response('Symbol,Date,Time,Close\nVOO.US,2026-11-24,22:00:00,600.5\n');
    if (u.includes('rate.bot')) return new Response('<html>blocked</html>');
    if (u.includes('er-api')) return json({ result: 'success', rates: { USD: 0.0305 } });
    throw new Error(`沒預期的網址 ${u}`);
  };
  const lines = [];
  const log = { log: (...a) => lines.push(a.join(' ')), warn: () => {}, error: (...a) => lines.push(a.join(' ')) };
  try {
    const r = await runUpdate({ base: 'https://x.supabase.co/', key: 'sb_secret_x', log });
    expect(r.failures).toBe(0);
  } finally { globalThis.fetch = realFetch; }
  const prices = posts.filter(([t]) => t === 'stock_prices').flatMap(([, b]) => b);
  expect(prices).toEqual([
    { market: 'TW', symbol: '2330', price_date: '2026-11-25', close: 1085, name: '台積電' },
    { market: 'US', symbol: 'VOO', price_date: '2026-11-24', close: 600.5, name: '' },
  ]);
  expect(posts.find(([t]) => t === 'fx_rates')[1][0]).toMatchObject({ currency: 'USD', rate: 32.786885 });
});

test('Supabase 函式裡的程式跟 scripts/ 的一樣（改了要一起更新、重新部署）', async () => {
  const fs = await import('node:fs');
  const a = fs.readFileSync(new URL('../scripts/update-market-data.mjs', import.meta.url), 'utf8');
  const b = fs.readFileSync(new URL('../supabase/functions/market-data/update-market-data.mjs', import.meta.url), 'utf8');
  expect(b).toBe(a);
});

test('Yahoo 歷史日線：日期用交易所時區、跳過空值、同一天只留一筆', async () => {
  const { parseYahooHistory } = await import('../scripts/update-market-data.mjs');
  const json = { chart: { result: [{ timestamp: [1772802000, 1772888400, 1772974800], indicators: { quote: [{ close: [101.23456, null, 103] }] } }] } };
  const rows = parseYahooHistory(json, 'US', 'SOXX', 'America/New_York');
  expect(rows).toEqual([
    { market: 'US', symbol: 'SOXX', price_date: '2026-03-06', close: 101.2346, name: '' },
    { market: 'US', symbol: 'SOXX', price_date: '2026-03-08', close: 103, name: '' },
  ]);
});
