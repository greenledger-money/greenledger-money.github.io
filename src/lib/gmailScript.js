// Gmail Apps Script 範本：使用者貼到 script.google.com，讀國泰世華刷卡通知信送進「待確認」

export function gmailScript({ url, key, token }) {
  return `// 小綠記帳：把國泰世華信用卡的消費通知信送進「待確認」
// 第一次：上面選「setup」按「執行」，照指示授權。之後每 10 分鐘會自動檢查新信。
const TOKEN = '${token || '貼上你的記帳碼'}';
const URL = '${url}';
const KEY = '${key}';
const QUERY = 'from:cathaybk.com.tw newer_than:7d -label:小綠記帳';
const LABEL = '小綠記帳';

function setup() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('run').timeBased().everyMinutes(10).create();
  run();
}

function run() {
  const label = GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
  GmailApp.search(QUERY, 0, 50).forEach((thread) => {
    thread.getMessages().forEach((m) => {
      const item = parse(m.getSubject(), m.getPlainBody() || '', m.getDate());
      if (!item) return;
      item.message_id = m.getId();
      const res = UrlFetchApp.fetch(URL, {
        method: 'post', contentType: 'application/json', headers: { apikey: KEY },
        payload: JSON.stringify({ token: TOKEN, item }), muteHttpExceptions: true,
      });
      if (res.getResponseCode() >= 300) throw new Error(res.getContentText());
    });
    thread.addLabel(label);
  });
}

function parse(subject, body, date) {
  const text = (subject + '\\n' + body).replace(/\\r/g, '').replace(/[ \\t\\u3000]+/g, ' ');
  const amt = text.match(/(?:消費金額|交易金額|刷卡金額)\\s*[:：]?\\s*(新臺幣|新台幣|NT\\$|TWD|日幣|日圓|JPY|美金|美元|USD)?\\s*\\$?\\s*([\\d,]+(?:\\.\\d+)?)/);
  if (!amt) return null;
  const cur = { '新臺幣': 'TWD', '新台幣': 'TWD', 'NT$': 'TWD', '日幣': 'JPY', '日圓': 'JPY', '美金': 'USD', '美元': 'USD' }[amt[1]] || amt[1] || 'TWD';
  const shop = text.match(/(?:消費商店|特約商店|商店名稱|交易商店|消費地點|商店)\\s*[:：]\\s*([^\\n]+)/);
  const card = text.match(/(?:末四碼|卡號)[^\\d\\n]{0,12}(\\d{4})/);
  const t = text.match(/(\\d{3,4})[\\/\\-年](\\d{1,2})[\\/\\-月](\\d{1,2})日?\\s*(\\d{1,2}):(\\d{2})/);
  let at = date;
  if (t) {
    const y = Number(t[1]) < 1911 ? Number(t[1]) + 1911 : Number(t[1]);
    const p = (n) => String(n).padStart(2, '0');
    at = new Date(y + '-' + p(t[2]) + '-' + p(t[3]) + 'T' + p(t[4]) + ':' + t[5] + ':00+08:00');
  }
  return {
    kind: 'email', bank: '國泰世華', amount: amt[2].replace(/,/g, ''), currency: cur,
    merchant: shop ? shop[1].trim().slice(0, 60) : '', card: card ? card[1] : '',
    at: at.toISOString(), subject: subject.slice(0, 120),
  };
}
`;
}
