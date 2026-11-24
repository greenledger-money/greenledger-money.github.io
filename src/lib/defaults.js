// 註冊時給的預設帳戶與分類；以及程式需要的「系統項目」（缺了會自動補回）。

import { uid } from './ledger.js';

export const DEFAULT_SETTINGS = {
  // 外觀
  theme: 'system',            // 'system' 跟著手機｜'light' 淺色｜'dark' 深色
  // 記帳
  defaultAccountId: null,     // 記帳預設帳戶（null＝上次用的）
  categoryDefault: 'last',    // 'last' 帶上次選的分類｜'none' 每次自己選
  keypadOnOpen: true,         // 打開記帳就跳出計算機
  // 首頁
  homeShowWorth: true,
  homeShowTemplates: true,
  worthIncludeStocks: true,  // 淨資產要不要算股票市值
  accountTypeOrder: [],      // 帳戶類別（銀行、信用卡…）的順序
  // 報表
  includeExceptions: true,    // 月報預設「含例外」
  reportPeriod: 'month',      // 報表預設看「月」或「年」
  // 股票
  twColors: true,             // 漲跌顏色：true＝台股習慣（漲紅跌綠）
  feeDiscount: 1,             // 台股手續費折扣（1＝不打折、0.6＝六折）
  minFeeLot: 20,              // 整股最低手續費
  minFeeOdd: 1,               // 零股最低手續費
  twSettleDays: 2,            // 台股交割：T+幾個工作天
  usSettleDays: 2,            // 美股（複委託）交割：T+幾個工作天
  usWithholding: 0.3,         // 美股股利預扣稅率
  settlementTW: null,         // 台股預設交割戶
  settlementUS: null,         // 美股預設交割戶
};

export const DEFAULT_ACCOUNTS = [
  { name: '現金', type: 'cash', currency: 'TWD', sort_order: 0 },
  { name: '朋友欠我', type: 'friends_owe', currency: 'TWD', system_key: 'friends_owe', sort_order: 90 },
];

// [名稱, 系統代號, 子分類[[名稱, 系統代號]]]
const TREE = {
  expense: [
    ['飲食', null, [['早餐'], ['午餐'], ['晚餐'], ['飲料點心']]],
    ['交通', null, [['大眾運輸'], ['計程車'], ['油錢'], ['停車']]],
    ['日常用品', null, []],
    ['居住', null, [['房租'], ['水電瓦斯'], ['網路電話']]],
    ['娛樂', null, []],
    ['繳費/訂閱', null, []],
    ['醫療', null, []],
    ['學習', null, []],
    ['人際', null, []],
    ['其他支出', 'other_expense', [['手續費', 'fee'], ['股票虧損', 'stock_loss']]],
  ],
  income: [
    ['工作收入', null, [['薪水'], ['獎金']]],
    ['其他收入', null, []],
    ['投資收入', 'investment_income', [['股利', 'dividend'], ['利息', 'interest'], ['股票獲利', 'stock_gain']]],
  ],
};

/** 預設分類（父在前、子在後，可以一次 insert） */
export function defaultCategoryRows() {
  const rows = [];
  for (const kind of ['expense', 'income']) {
    TREE[kind].forEach(([name, key, children], i) => {
      const id = uid();
      rows.push({ id, parent_id: null, kind, name, system_key: key, sort_order: i });
      children.forEach(([cname, ckey], j) => {
        rows.push({ id: uid(), parent_id: id, kind, name: cname, system_key: ckey ?? null, sort_order: j });
      });
    });
  }
  return rows;
}

export function defaultAccountRows() {
  return DEFAULT_ACCOUNTS.map((a) => ({ id: uid(), opening_balance: 0, hidden: false, system_key: null, ...a }));
}

const SYSTEM_CATEGORIES = [
  { key: 'other_expense', kind: 'expense', name: '其他支出', parent: null },
  { key: 'fee', kind: 'expense', name: '手續費', parent: 'other_expense' },
  { key: 'stock_loss', kind: 'expense', name: '股票虧損', parent: 'other_expense' },
  { key: 'investment_income', kind: 'income', name: '投資收入', parent: null },
  { key: 'dividend', kind: 'income', name: '股利', parent: 'investment_income' },
  { key: 'interest', kind: 'income', name: '利息', parent: 'investment_income' },
  { key: 'stock_gain', kind: 'income', name: '股票獲利', parent: 'investment_income' },
];

/**
 * 檢查系統項目是否都在；缺的話回傳要新增／要補上 system_key 的資料。
 * （例如使用者把「其他支出」改名後又建了一個同名分類，就把舊的那個標成系統分類）
 */
export function missingSystemRows(accounts, categories) {
  const plan = { insertAccounts: [], updateAccounts: [], insertCategories: [], updateCategories: [] };
  if (!accounts.some((a) => a.system_key === 'friends_owe')) {
    const same = accounts.find((a) => a.name === '朋友欠我' && a.type === 'friends_owe' && !a.system_key);
    if (same) plan.updateAccounts.push({ id: same.id, patch: { system_key: 'friends_owe' } });
    else {
      const name = accounts.some((a) => a.name === '朋友欠我') ? '朋友欠我（系統）' : '朋友欠我';
      plan.insertAccounts.push({ id: uid(), name, type: 'friends_owe', currency: 'TWD', opening_balance: 0, hidden: false, system_key: 'friends_owe', sort_order: 90 });
    }
  }
  const idOfKey = new Map(categories.filter((c) => c.system_key).map((c) => [c.system_key, c.id]));
  for (const s of SYSTEM_CATEGORIES) {
    if (idOfKey.has(s.key)) continue;
    const parentId = s.parent ? idOfKey.get(s.parent) : null;
    const same = categories.find((c) => c.kind === s.kind && c.name === s.name && (c.parent_id ?? null) === (parentId ?? null) && !c.system_key);
    if (same) {
      plan.updateCategories.push({ id: same.id, patch: { system_key: s.key } });
      idOfKey.set(s.key, same.id);
    } else {
      const id = uid();
      plan.insertCategories.push({ id, parent_id: parentId ?? null, kind: s.kind, name: s.name, system_key: s.key, sort_order: 99 });
      idOfKey.set(s.key, id);
    }
  }
  return plan;
}
