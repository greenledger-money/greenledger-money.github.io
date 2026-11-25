import { test, expect } from 'bun:test';

import { gmailScript } from '../src/lib/gmailScript.js';

// 從產生的 Apps Script 裡取出 parse()，用幾種常見的通知信格式測
const code = gmailScript({ url: 'u', key: 'k', token: 't' });
// eslint-disable-next-line no-new-func
const parse = new Function(`${code.slice(code.indexOf('function parse'))}; return parse;`)();

test('國泰世華格式：新臺幣金額、商店、民國年時間、末四碼', () => {
  const r = parse('國泰世華銀行信用卡消費通知', '親愛的卡友您好\n卡號末四碼：1234\n消費日期：114/11/25 14:32\n消費金額：新臺幣 3,280 元\n消費商店：全聯福利中心\n', new Date('2026-11-25T06:40:00Z'));
  expect(r).toMatchObject({ amount: '3280', currency: 'TWD', merchant: '全聯福利中心', card: '1234' });
  expect(r.at).toBe('2025-11-25T06:32:00.000Z');
});

test('外幣、西元年、NT$ 寫法', () => {
  expect(parse('刷卡通知', '交易時間 2026-11-20 09:05\n交易金額: 日幣 12,800\n特約商店: BIC CAMERA', new Date()).currency).toBe('JPY');
  const r = parse('刷卡通知', '交易時間 2026/11/20 21:05\n刷卡金額 NT$ 4,500\n商店名稱：Uniqlo', new Date());
  expect(r).toMatchObject({ amount: '4500', currency: 'TWD', merchant: 'Uniqlo', at: '2026-11-20T13:05:00.000Z' });
});

test('不是消費通知的信（廣告、帳單）不送', () => {
  expect(parse('CUBE 卡年底回饋活動', '刷卡滿額送小樹點，最高回饋 10%', new Date())).toBeNull();
});

test('整段程式語法正確、記帳碼和網址有放進去', () => {
  const c = gmailScript({ url: 'https://x.supabase.co/rest/v1/rpc/inbox_add', key: 'sb_publishable_x', token: 'abc' });
  // eslint-disable-next-line no-new-func
  expect(() => new Function(c)).not.toThrow();
  expect(c).toContain("const TOKEN = 'abc';");
  expect(c).toContain("const URL = 'https://x.supabase.co/rest/v1/rpc/inbox_add';");
});
