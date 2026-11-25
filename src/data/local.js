// 試用模式的後端：資料存在這台裝置的瀏覽器（localStorage），不用註冊。
// 會模擬資料庫的規則（不能刪有交易的帳戶、同一筆不能確認兩次…），讓試用時的行為跟正式版一樣。

import { TABLES, planDelete, applyDelete } from './relations.js';
import { buildTree, validateCategory } from '../lib/categories.js';
import { uid } from '../lib/ledger.js';

const KEY = 'ledger.demo.v1';

const DEFAULTS = {
  accounts: { currency: 'TWD', opening_balance: 0, hidden: false, sort_order: 0, system_key: null },
  categories: { parent_id: null, archived: false, sort_order: 0, system_key: null },
  transactions: {
    fx_rate: 1, to_account_id: null, to_amount: null, to_fx_rate: null, category_id: null, note: '',
    is_exception: false, parent_id: null, group_id: null, source: 'manual', pending_item_id: null,
  },
  templates: { mode: 'fill', account_id: null, to_account_id: null, category_id: null, amount: null, note: '', is_exception: false, sort_order: 0 },
  recurring_rules: { to_account_id: null, category_id: null, note: '', interval_count: 1, end_date: null, next_index: 0, active: true },
  pending_items: { recurring_id: null, occurrence_index: null, dedupe_key: null, payload: {}, status: 'pending', resolved_at: null },
  stock_trades: {
    name: '', kind: 'stock', settle_date: null, fee: 0, tax: 0, settlement_account_id: null, settle_amount: null,
    settlement_txn_id: null, pnl_txn_id: null, order_no: null, pending_item_id: null, note: '',
  },
  dividends: { withholding: 0, nhi_premium: 0, note: '' },
  manual_prices: {},
  profiles: { settings: {} },
};

const fail = (msg) => { throw new Error(msg); };
const clone = (x) => JSON.parse(JSON.stringify(x));
const emptyTables = () => Object.fromEntries(TABLES.map((t) => [t, []]));

export function createLocalBackend() {
  let db = null;
  try { db = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { db = null; }
  const listeners = new Set();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* 存不了就只留在記憶體 */ } };
  const emit = () => listeners.forEach((cb) => cb(db?.signedIn ? db.user : null));
  const T = (t) => db.tables[t];

  function checkPending(row) {
    if (!row.pending_item_id) return;
    const p = T('pending_items').find((x) => x.id === row.pending_item_id);
    if (!p) fail('找不到待確認項目');
    if (p.status !== 'pending') fail('這筆待確認項目已經處理過了');
    p.status = 'confirmed';
    p.resolved_at = new Date().toISOString();
  }

  function validate(table, row, isUpdate) {
    if (table === 'accounts') {
      if (!row.name?.trim()) fail('請輸入帳戶名稱');
      if (T('accounts').some((a) => a.id !== row.id && a.name === row.name)) fail('已經有同名的帳戶');
    }
    if (table === 'categories') {
      const tree = buildTree(T('categories'));
      const err = validateCategory(tree, row);
      if (err) fail(err);
      if (isUpdate) {
        const old = T('categories').find((c) => c.id === row.id);
        if (old && old.kind !== row.kind && (T('categories').some((c) => c.parent_id === row.id) || T('transactions').some((t) => t.category_id === row.id))) {
          fail('已有子分類或交易的分類不能改收支類型');
        }
      }
    }
    if (table === 'transactions' || table === 'templates' || table === 'recurring_rules') {
      const full = table === 'transactions' || table === 'recurring_rules' || row.mode === 'instant';
      if (row.type === 'transfer') {
        if (full && (!row.to_account_id || row.to_account_id === row.account_id)) fail('轉帳要選不同的轉出、轉入帳戶');
        if (table === 'transactions' && row.to_amount == null) fail('轉帳要有轉入金額');
      } else if (full && !row.category_id) fail('請選擇分類');
      if (row.category_id) {
        const c = T('categories').find((x) => x.id === row.category_id);
        if (c && c.kind !== row.type) fail('分類的收支類型跟交易不一致');
      }
      if (table === 'templates' && row.mode === 'instant' && row.amount == null) fail('一鍵記帳的範本一定要有金額');
    }
    if (table === 'stock_trades' && row.order_no && T('stock_trades').some((x) => x.id !== row.id && x.order_no === row.order_no)) {
      fail('這個委託書號已經記過了');
    }
  }

  return {
    kind: 'local',
    hasData: () => !!db?.tables,
    async getUser() { return db?.signedIn ? db.user : null; },
    onAuth(cb) { listeners.add(cb); return () => listeners.delete(cb); },

    /** 開始（或繼續）試用；seed(tables) 可以放範例資料 */
    async startDemo(seed) {
      if (!db?.tables) {
        db = { user: { id: uid(), email: null, demo: true }, tables: emptyTables(), shared: { fx_rates: [], stock_prices: [] } };
        if (seed) seed(db);
      }
      db.signedIn = true;
      save(); emit();
      return db.user;
    },
    async resetDemo() { db = null; try { localStorage.removeItem(KEY); } catch { /* ignore */ } emit(); },
    async signOut() { if (db) db.signedIn = false; save(); emit(); },
    async deleteAccount() { return this.resetDemo(); },
    passkey: { supported: false },

    async loadAll() {
      if (!db?.tables) fail('還沒開始試用');
      return clone(db.tables);
    },
    async loadShared() { return clone(db?.shared ?? { fx_rates: [], stock_prices: [] }); },

    async insert(table, rows, { ignoreDuplicates = false } = {}) {
      const now = new Date().toISOString();
      const out = [];
      for (const r of rows) {
        const row = { ...DEFAULTS[table], id: uid(), user_id: db.user.id, created_at: now, ...clone(r) };
        if (table === 'transactions') row.updated_at = now;
        if (table === 'pending_items') {
          const dup = T('pending_items').some((p) => (row.recurring_id && p.recurring_id === row.recurring_id && p.due_date === row.due_date)
            || (row.dedupe_key && p.dedupe_key === row.dedupe_key));
          if (dup) { if (ignoreDuplicates) continue; fail('這筆待確認項目已經存在'); }
        }
        if (table === 'manual_prices') {
          const i = T('manual_prices').findIndex((p) => p.market === row.market && p.symbol === row.symbol && p.price_date === row.price_date);
          if (i >= 0) { T('manual_prices')[i] = { ...T('manual_prices')[i], close: row.close }; out.push(clone(T('manual_prices')[i])); continue; }
        }
        if (table === 'profiles' && T('profiles').length) { if (ignoreDuplicates) continue; fail('已經建立過了'); }
        validate(table, row, false);
        if (table === 'transactions' || table === 'stock_trades') checkPending(row);
        T(table).push(row); // 先放進去，同一批後面的子分類才找得到上層
        out.push(clone(row));
      }
      save();
      return out;
    },

    async updateMany(table, ids, patch) {
      const out = [];
      for (const id of ids) out.push(await this.update(table, id, patch));
      return out;
    },

    async update(table, id, patch) {
      const list = T(table);
      const key = table === 'profiles' ? 'user_id' : 'id';
      const i = list.findIndex((r) => r[key] === id);
      if (i < 0) fail('找不到這筆資料');
      const row = { ...list[i], ...clone(patch) };
      if (table === 'pending_items' && patch.status && list[i].status !== 'pending' && patch.status !== list[i].status) {
        fail('這筆待確認項目已經處理過了');
      }
      if (table === 'pending_items' && row.status !== 'pending' && !row.resolved_at) row.resolved_at = new Date().toISOString();
      validate(table, row, true);
      if (table === 'transactions') row.updated_at = new Date().toISOString();
      list[i] = row;
      save();
      return clone(row);
    },

    async removeImported() {
      const ids = T('transactions').filter((t) => t.source === 'cw_import').map((t) => t.id);
      return this.remove('transactions', ids);
    },

    async remove(table, ids) {
      const plan = planDelete(db.tables, table, ids);
      if (plan.blocked) fail(plan.blocked);
      db.tables = applyDelete(db.tables, plan);
      save();
      return plan;
    },
  };
}
