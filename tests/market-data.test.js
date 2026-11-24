// 每日更新腳本的解析器（用固定樣本測，不連網路）
import { describe, expect, test } from 'bun:test';
import { parseBotCsv, parseTwDate, parseTwPrices, taipeiToday } from '../scripts/update-market-data.mjs';

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
