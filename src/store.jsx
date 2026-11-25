// 整個 app 的資料中心：載入資料、算出餘額／淨資產／持股，提供所有「寫入」動作。
// 畫面只透過 useLedger() 拿資料、呼叫 actions，不直接碰後端。

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { TABLES, applyDelete, planDelete } from './data/relations.js';
import { friendlyError } from './data/errors.js';
import { OFFLINE_TABLES, applyOp, applyOps, flushOps, isNetworkError, readOutbox, stampRows, writeOutbox } from './data/outbox.js';
import { buildTree } from './lib/categories.js';
import { makeFx } from './lib/fx.js';
import { computeBalances, netWorth, netWorthSeries, buildSplit, buildFee, uid } from './lib/ledger.js';
import { runFifo, makePriceBook, valuePositions, stockValueByAccount, tradeNetAmount, realizedTxnPlan } from './lib/stocks.js';
import { dueOccurrences, occurrenceDate } from './lib/recurring.js';
import { DEFAULT_SETTINGS, defaultAccountRows, defaultCategoryRows, missingSystemRows } from './lib/defaults.js';
import { round2 } from './lib/money.js';
import { addDays, startOfDayIso, todayStr } from './lib/dates.js';

const Ctx = createContext(null);
export const useLedger = () => useContext(Ctx);

const snapKey = (id) => `ledger.snapshot.${id}`;
const isNetwork = isNetworkError;

function mergeById(list, rows) {
  const key = (r) => r.id ?? r.user_id;
  const map = new Map(list.map((r) => [key(r), r]));
  rows.forEach((r) => map.set(key(r), r));
  return [...map.values()];
}

export const remember = {
  get(k, d = null) { try { return JSON.parse(localStorage.getItem(`ledger.pref.${k}`)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`ledger.pref.${k}`, JSON.stringify(v)); } catch { /* ignore */ } },
};

export function LedgerProvider({ backend, user, children }) {
  const [tables, setTables] = useState(null);
  const [shared, setShared] = useState({ fx_rates: [], stock_prices: [] });
  const [status, setStatus] = useState({ loading: true, error: null, offline: false });
  const tablesRef = useRef(null);
  tablesRef.current = tables;
  const sharedRef = useRef(shared);
  sharedRef.current = shared;
  // 每次寫入都先算出新的資料，同步放進 tablesRef，下一個動作讀到的一定是最新的
  // writes 記錄寫入次數：背景重新載入時如果中途有寫入，就再載一次，避免剛記的帳被舊資料蓋掉
  const writes = useRef(0);
  const commit = (fn) => { writes.current += 1; const next = fn(tablesRef.current); tablesRef.current = next; setTables(next); };

  // ---------- 離線待上傳 ----------
  const statusRef = useRef(status);
  statusRef.current = status;
  const outbox = useRef(readOutbox(user.id));
  const [queued, setQueued] = useState(outbox.current.length);
  const setOutbox = (ops) => { outbox.current = ops; writeOutbox(user.id, ops); setQueued(ops.length); };
  /** 交易在沒網路（或前面還有沒傳完的）時先排隊；回傳 true 表示已排隊 */
  const shouldQueue = (table) => OFFLINE_TABLES.has(table) && (statusRef.current.offline || outbox.current.length > 0);
  const enqueue = (op) => {
    setOutbox([...outbox.current, op]);
    commit((t) => applyOp(t, op));
    flush();
  };
  const flushing = useRef(null);
  const flush = useCallback(() => {
    if (flushing.current || !outbox.current.length || backend.offline) return flushing.current;
    flushing.current = (async () => {
      try {
        while (outbox.current.length) {
          const ops = outbox.current;
          const { remaining, failed } = await flushOps(backend, ops);
          // 上傳期間又有新的排進來：保留新的
          const added = outbox.current.slice(ops.length);
          setOutbox([...remaining, ...added]);
          if (failed.length) {
            setStatus((s) => ({ ...s, warning: `有 ${failed.length} 筆離線記的帳上傳失敗：${friendlyError(failed[0].error)}` }));
          }
          if (remaining.length) return false;
        }
        if (statusRef.current.offline) setStatus((s) => ({ ...s, offline: false }));
        return true;
      } finally { flushing.current = null; }
    })();
    return flushing.current;
  }, [backend]);

  // ---------- 低階寫入（同步畫面上的資料） ----------
  const guard = (table) => {
    if (table && OFFLINE_TABLES.has(table)) return;
    if (statusRef.current.offline) throw new Error('離線中：記帳可以，其他設定要等有網路再改');
  };

  const insertRows = useCallback(async (table, rows, opts) => {
    guard(table);
    if (!rows.length) return [];
    const queue = () => {
      const stamped = stampRows(rows, user.id);
      enqueue({ op: 'insert', table, rows: stamped });
      const confirmed = new Set(stamped.map((r) => r.pending_item_id).filter(Boolean));
      if (confirmed.size) commit((t) => ({ ...t, pending_items: t.pending_items.map((p) => (confirmed.has(p.id) ? { ...p, status: 'confirmed' } : p)) }));
      return stamped;
    };
    if (shouldQueue(table)) return queue();
    let saved;
    try { saved = await backend.insert(table, rows, opts); } catch (e) {
      if (OFFLINE_TABLES.has(table) && isNetwork(e)) { setStatus((s) => ({ ...s, offline: true })); return queue(); }
      throw e;
    }
    commit((t) => {
      let next = { ...t, [table]: mergeById(t[table], saved) };
      // 資料庫觸發器會把確認過的待確認項目改成「已確認」，畫面同步一下
      const confirmed = new Set(saved.map((r) => r.pending_item_id).filter(Boolean));
      if (confirmed.size) {
        next = { ...next, pending_items: next.pending_items.map((p) => (confirmed.has(p.id) ? { ...p, status: 'confirmed' } : p)) };
      }
      return next;
    });
    return saved;
  }, [backend, status.offline]);

  const updateRow = useCallback(async (table, id, patch) => {
    guard(table);
    const queue = () => { enqueue({ op: 'update', table, id, patch }); return tablesRef.current[table].find((r) => r.id === id); };
    if (shouldQueue(table)) return queue();
    let row;
    try { row = await backend.update(table, id, patch); } catch (e) {
      if (OFFLINE_TABLES.has(table) && isNetwork(e)) { setStatus((s) => ({ ...s, offline: true })); return queue(); }
      throw e;
    }
    commit((t) => ({ ...t, [table]: mergeById(t[table], [row]) }));
    return row;
  }, [backend, status.offline]);

  const removeRows = useCallback(async (table, ids) => {
    guard(table);
    if (!ids.length) return;
    const plan = planDelete(tablesRef.current, table, ids);
    if (plan.blocked) throw new Error(plan.blocked);
    if (shouldQueue(table)) { enqueue({ op: 'remove', table, ids }); return; }
    try { await backend.remove(table, ids); } catch (e) {
      if (OFFLINE_TABLES.has(table) && isNetwork(e)) { setStatus((s) => ({ ...s, offline: true })); enqueue({ op: 'remove', table, ids }); return; }
      throw e;
    }
    commit((t) => applyDelete(t, plan));
  }, [backend, status.offline]);

  // ---------- 載入 ----------
  const loadShared = useCallback(async (t) => {
    const currencies = [...new Set(['USD', ...t.accounts.map((a) => a.currency), ...t.stock_trades.map((x) => x.currency)])].filter((c) => c !== 'TWD');
    const symbols = [...new Set(t.stock_trades.map((x) => x.symbol))];
    const since = addDays(todayStr(), -400);
    const sh = await backend.loadShared({ currencies, symbols, since });
    setShared(sh);
    sharedRef.current = sh;
    return sh;
  }, [backend]);

  /** 第一次登入：建立設定、預設帳戶與分類；之後每次檢查系統項目還在 */
  async function bootstrap(t) {
    if (!t.profiles.length) {
      const created = await backend.insert('profiles', [{ settings: {} }], { ignoreDuplicates: true, onConflict: 'user_id' });
      if (created.length) {
        t.profiles = created;
        if (!t.accounts.length) t.accounts = await backend.insert('accounts', defaultAccountRows());
        if (!t.categories.length) t.categories = await backend.insert('categories', defaultCategoryRows());
      } else {
        return backend.loadAll(); // 另一台裝置剛好同時建好了
      }
    }
    const plan = missingSystemRows(t.accounts, t.categories);
    if (plan.insertAccounts.length) t.accounts = [...t.accounts, ...await backend.insert('accounts', plan.insertAccounts)];
    for (const u of plan.updateAccounts) t.accounts = mergeById(t.accounts, [await backend.update('accounts', u.id, u.patch)]);
    for (const u of plan.updateCategories) t.categories = mergeById(t.categories, [await backend.update('categories', u.id, u.patch)]);
    if (plan.insertCategories.length) t.categories = [...t.categories, ...await backend.insert('categories', plan.insertCategories)];
    return t;
  }

  /** 打開 app 時：把到期但還沒產生的固定收支補進待確認清單 */
  async function syncRecurring(t) {
    const today = todayStr();
    for (const rule of t.recurring_rules) {
      const due = dueOccurrences(rule, today);
      if (!due.length) continue;
      await insertRows('pending_items', due.map((o) => ({
        source: 'recurring', recurring_id: rule.id, occurrence_index: o.k, due_date: o.date, payload: {},
      })), { ignoreDuplicates: true, onConflict: 'recurring_id,due_date' });
      await updateRow('recurring_rules', rule.id, { next_index: due[due.length - 1].k + 1 });
    }
  }

  /** 賣出的已實現損益記進月收支（每次用 FIFO 重算，跟現有交易比對後只寫有變的） */
  async function syncRealized() {
    const t = tablesRef.current;
    const key = (k) => t.categories.find((c) => c.system_key === k)?.id;
    const fx = makeFx(sharedRef.current.fx_rates);
    const curOf = (id) => t.accounts.find((a) => a.id === id)?.currency;
    const plan = realizedTxnPlan({ trades: t.stock_trades, txns: t.transactions, gainCatId: key('stock_gain'), lossCatId: key('stock_loss'), rateFor: fx.rateOn, accountCurrency: curOf });
    if (plan.insert.length) await insertRows('transactions', plan.insert);
    for (const u of plan.update) await updateRow('transactions', u.id, u.patch);
    for (const l of plan.link) await updateRow('stock_trades', l.tradeId, { pnl_txn_id: l.txnId });
    if (plan.remove.length) await removeRows('transactions', plan.remove);
  }

  const load = useCallback(async () => {
    // 先用上次存在這台裝置的資料把畫面打開，再到背景抓最新的換上去
    let cached = null;
    if (backend.kind === 'supabase' && !tablesRef.current) {
      try { cached = JSON.parse(localStorage.getItem(snapKey(user.id)) || 'null'); } catch { /* ignore */ }
    }
    if (cached?.tables) {
      cached.tables = applyOps(cached.tables, outbox.current);
      tablesRef.current = cached.tables; setTables(cached.tables);
      sharedRef.current = cached.shared; setShared(cached.shared);
      setStatus({ loading: false, refreshing: true, error: null, offline: false });
    } else if (!tablesRef.current) {
      setStatus((s) => ({ ...s, loading: true, error: null }));
    }
    try {
      // 先把離線時記的帳傳上去，再抓最新資料
      if (outbox.current.length && (await flush()) === false) throw new Error('offline');
      let t;
      for (let i = 0; i < 3; i++) {
        const before = writes.current;
        t = await backend.loadAll();
        if (writes.current === before) break;
      }
      t = await bootstrap(t);
      setTables(t);
      tablesRef.current = t;
      // 股價、匯率讀不到不影響記帳：顯示提醒，其他照常（固定收支、股票損益照樣同步）
      let sh = { fx_rates: [], stock_prices: [] };
      let warning = null;
      try { sh = await loadShared(t); } catch (e) { warning = `股價、匯率讀取失敗：${friendlyError(e)}`; console.error(e); }
      setStatus({ loading: false, refreshing: false, error: null, offline: false, warning });
      if (backend.kind === 'supabase') {
        try { localStorage.setItem(snapKey(user.id), JSON.stringify({ tables: t, shared: sh, at: Date.now() })); } catch { /* 太大就不存 */ }
      }
      await syncRecurring(t);
      await syncRealized();
    } catch (e) {
      let snap = null;
      try { snap = JSON.parse(localStorage.getItem(snapKey(user.id)) || 'null'); } catch { /* ignore */ }
      if (snap && isNetwork(e)) {
        const offTables = applyOps(snap.tables, outbox.current);
        tablesRef.current = offTables; setTables(offTables); setShared(snap.shared);
        setStatus({ loading: false, refreshing: false, error: null, offline: true, snapshotAt: snap.at });
      } else if (cached?.tables) {
        // 已經用快取打開了：不要整個畫面變錯誤頁，顯示提醒就好
        setStatus({ loading: false, refreshing: false, error: null, offline: false, warning: `更新失敗：${friendlyError(e)}` });
      } else {
        setStatus({ loading: false, error: friendlyError(e), offline: false });
      }
    }
  }, [backend, user?.id]);

  useEffect(() => { load(); }, [load]);

  // 開著的時候：每 10 分鐘更新股價；切回 app 時（超過 2 分鐘沒看）整份重新抓，別台裝置記的帳也會出現
  const lastLoad = useRef(Date.now());
  useEffect(() => {
    if (backend.kind !== 'supabase') return undefined;
    const prices = setInterval(() => {
      if (document.visibilityState === 'visible' && tablesRef.current) loadShared(tablesRef.current).catch(() => {});
    }, 10 * 60e3);
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastLoad.current < 2 * 60e3) return;
      lastLoad.current = Date.now();
      load();
    };
    document.addEventListener('visibilitychange', onVisible);
    // 網路回來：先上傳離線記的帳，再整份重新抓
    const onOnline = () => {
      if (backend.offline) { location.reload(); return; }
      lastLoad.current = Date.now();
      load();
    };
    window.addEventListener('online', onOnline);
    return () => { clearInterval(prices); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', onOnline); };
  }, [backend, load, loadShared]);

  // ---------- 衍生資料 ----------
  const derived = useMemo(() => {
    if (!tables) return null;
    const accounts = [...tables.accounts].sort((a, b) => (a.sort_order - b.sort_order) || String(a.created_at).localeCompare(String(b.created_at)));
    const accById = new Map(accounts.map((a) => [a.id, a]));
    const tree = buildTree(tables.categories);
    const fx = makeFx(shared.fx_rates);
    const priceBook = makePriceBook(shared.stock_prices, tables.manual_prices);
    const balances = computeBalances(accounts, tables.transactions);
    const positions = runFifo(tables.stock_trades);
    const holdings = valuePositions(positions, priceBook, fx);
    const stockValue = stockValueByAccount(holdings);
    // 證券戶市值換成證券戶的幣別（台幣交割的美股戶顯示台幣）
    for (const [id, v] of stockValue) {
      const acc = accById.get(id);
      const rate = !acc || acc.currency === 'TWD' ? 1 : fx.latest(acc.currency);
      if (rate) v.native = Math.round((v.twd / rate) * 100) / 100;
    }
    // 股票成交日就算進持股，交割款要到交割日才扣；淨資產先把「已成交、待交割」的款項算進去，避免重複計算
    const today = todayStr();
    const tradeDateOf = new Map(tables.stock_trades.flatMap((t) => [[t.settlement_txn_id, t.trade_date], [t.pnl_txn_id, t.trade_date]]).filter(([id]) => id));
    const worthTxns = tables.transactions.map((t) => (tradeDateOf.has(t.id) ? { ...t, occurred_at: startOfDayIso(tradeDateOf.get(t.id)) } : t));
    const worthBalances = computeBalances(accounts, worthTxns.filter((t) => Date.parse(t.occurred_at) <= Date.now() || (tradeDateOf.get(t.id) ?? '9999') <= today), null);
    const unsettled = new Map(accounts.map((a) => [a.id, Math.round((worthBalances.get(a.id) - balances.get(a.id)) * 100) / 100]).filter(([, v]) => v !== 0));
    const worth = netWorth({ accounts, balances: worthBalances, fx, stockValue });
    const worthStocks = worth.rows.filter((r) => r.account.type === 'brokerage').reduce((x, r) => x + r.twd, 0);
    const worthNoStocks = Math.round((worth.total - worthStocks) * 100) / 100;
    const stockValueAt = (date) => stockValueByAccount(valuePositions(runFifo(tables.stock_trades, { until: date }), priceBook, fx, date));
    const stockStart = new Map();
    for (const t of tables.stock_trades) {
      const cur = stockStart.get(t.brokerage_account_id);
      if (!cur || t.trade_date < cur) stockStart.set(t.brokerage_account_id, t.trade_date);
    }
    const worthSeries = (monthKeys, includeStocks = true) => netWorthSeries({
      accounts, txns: worthTxns, monthKeys, fx, stockValueAt, includeStocks, stockStart,
    });
    const settings = { ...DEFAULT_SETTINGS, ...(tables.profiles[0]?.settings ?? {}) };
    const pending = tables.pending_items.filter((p) => p.status === 'pending').sort((a, b) => a.due_date.localeCompare(b.due_date));
    const txns = [...tables.transactions].sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
    return {
      ...tables, transactions: txns, accounts, accById, tree, fx, priceBook, balances, positions, holdings,
      stockValue, worth, worthStocks, worthNoStocks, stockValueAt, worthSeries, settings, pending, unsettled, worthTxns,
      friendsOwe: accounts.find((a) => a.system_key === 'friends_owe'),
      feeCat: tree.bySystemKey('fee'), dividendCat: tree.bySystemKey('dividend'),
      rateFor: (currency, date) => fx.rateOn(currency, date),
    };
  }, [tables, shared]);

  // ---------- 動作 ----------
  const actions = useMemo(() => {
    if (!derived) return null;
    const d = derived;
    const T = () => tablesRef.current;

    /** 記帳表單存檔（新增或修改）。form.split = { mine } 代表分帳 */
    async function saveTxn(form, original) {
      const base = {
        type: form.type, occurred_at: form.occurred_at, account_id: form.account_id,
        amount: round2(Number(form.amount)), fx_rate: Number(form.fx_rate) || 1,
        note: (form.note ?? '').trim(), is_exception: !!form.is_exception,
      };
      if (form.counterparty !== undefined || original?.counterparty) base.counterparty = form.counterparty || null;
      if (form.type === 'transfer') {
        Object.assign(base, { to_account_id: form.to_account_id, to_amount: round2(Number(form.to_amount)), to_fx_rate: Number(form.to_fx_rate) || 1, category_id: null });
      } else {
        Object.assign(base, { category_id: form.category_id, to_account_id: null, to_amount: null, to_fx_rate: null });
      }
      const fee = Number(form.fee) || 0;
      if (!original) {
        let rows;
        if (form.split && form.type === 'expense') {
          rows = buildSplit({
            accountId: base.account_id, total: base.amount, mine: Number(form.split.mine), categoryId: base.category_id,
            occurredAt: base.occurred_at, note: base.note, friendsOweId: d.friendsOwe.id, fxRate: base.fx_rate, isException: base.is_exception,
            counterparty: base.counterparty,
          });
        } else {
          const row = { id: uid(), ...base, source: form.source ?? 'manual', pending_item_id: form.pending_item_id ?? null };
          rows = [row];
          if (form.type === 'transfer' && fee > 0) rows.push(buildFee({ transfer: row, fee, feeCategoryId: d.feeCat.id }));
        }
        await insertRows('transactions', rows);
      } else {
        await updateRow('transactions', original.id, base);
        const child = T().transactions.find((t) => t.parent_id === original.id);
        if (form.type === 'transfer' && fee > 0) {
          if (child) await updateRow('transactions', child.id, { amount: round2(fee), occurred_at: base.occurred_at, account_id: base.account_id, fx_rate: base.fx_rate });
          else await insertRows('transactions', [buildFee({ transfer: { ...original, ...base }, fee, feeCategoryId: d.feeCat.id })]);
        } else if (child) await removeRows('transactions', [child.id]);
      }
      remember.set('lastAccount', base.account_id);
      if (base.category_id) remember.set(`lastCategory.${base.type}`, base.category_id);
    }

    /** 刪交易：分帳的兩筆一起刪；轉帳的手續費由資料庫一起刪 */
    async function deleteTxn(t) {
      const ids = t.group_id ? T().transactions.filter((x) => x.group_id === t.group_id).map((x) => x.id) : [t.id];
      await removeRows('transactions', ids);
    }

    async function saveAccount(form, original) {
      const row = {
        name: form.name.trim(), type: form.type, currency: form.currency, icon: form.icon || null,
        opening_balance: round2(Number(form.opening_balance) || 0), hidden: !!form.hidden,
      };
      if (original) return updateRow('accounts', original.id, row);
      return (await insertRows('accounts', [{ ...row, sort_order: d.accounts.length }]))[0];
    }

    async function saveCategory(form, original) {
      const row = { name: form.name.trim(), parent_id: form.parent_id || null, kind: form.kind, archived: !!form.archived, icon: form.icon || null };
      if (original) return updateRow('categories', original.id, row);
      return (await insertRows('categories', [{ ...row, sort_order: 50 }]))[0];
    }

    async function saveTemplate(form, original) {
      const row = {
        name: form.name.trim(), mode: form.mode, type: form.type, account_id: form.account_id || null,
        to_account_id: form.type === 'transfer' ? form.to_account_id || null : null,
        category_id: form.type === 'transfer' ? null : form.category_id || null,
        amount: form.amount === '' || form.amount == null ? null : round2(Number(form.amount)),
        note: (form.note ?? '').trim(), is_exception: !!form.is_exception,
      };
      if (original) return updateRow('templates', original.id, row);
      return (await insertRows('templates', [row]))[0];
    }

    /** 一鍵範本直接記帳（用現在時間、自動帶匯率） */
    async function useInstantTemplate(tpl) {
      const acc = d.accById.get(tpl.account_id);
      const to = d.accById.get(tpl.to_account_id);
      const today = todayStr();
      const rate = d.rateFor(acc.currency, today);
      if (rate == null) throw new Error(`${acc.currency} 找不到匯率，請用一般記帳手動填`);
      const form = {
        type: tpl.type, amount: tpl.amount, account_id: tpl.account_id, category_id: tpl.category_id,
        occurred_at: new Date().toISOString(), note: tpl.note, is_exception: tpl.is_exception, fx_rate: rate, source: 'template',
      };
      if (tpl.type === 'transfer') {
        const toRate = d.rateFor(to.currency, today);
        if (toRate == null) throw new Error(`${to.currency} 找不到匯率，請用一般記帳手動填`);
        Object.assign(form, { to_account_id: to.id, to_fx_rate: toRate, to_amount: round2(tpl.amount * rate / toRate) });
      }
      await saveTxn(form);
    }

    async function saveRecurring(form, original) {
      const row = {
        name: form.name.trim(), type: form.type, account_id: form.account_id,
        to_account_id: form.type === 'transfer' ? form.to_account_id : null,
        category_id: form.type === 'transfer' ? null : form.category_id,
        amount: round2(Number(form.amount)), note: (form.note ?? '').trim(),
        interval_unit: form.interval_unit, interval_count: Number(form.interval_count) || 1,
        start_date: form.start_date, end_date: form.end_date || null, active: !!form.active,
      };
      let saved;
      if (original) {
        // 改了起始日或週期：從「已產生過的最後一天」之後繼續，已產生的項目不動
        const changed = original.start_date !== row.start_date || original.interval_unit !== row.interval_unit
          || Number(original.interval_count) !== row.interval_count;
        if (changed) {
          const lastDue = T().pending_items.filter((p) => p.recurring_id === original.id)
            .reduce((m, p) => (p.due_date > m ? p.due_date : m), '');
          let k = 0;
          while (lastDue && occurrenceDate(row, k) <= lastDue && k < 10000) k++;
          row.next_index = k;
        }
        saved = await updateRow('recurring_rules', original.id, row);
      } else saved = (await insertRows('recurring_rules', [row]))[0];
      await syncRecurring({ ...T(), recurring_rules: [saved] });
      return saved;
    }

    /** 確認待確認項目（固定收支一鍵確認；外幣找不到匯率時請畫面改用表單） */
    async function confirmRecurring(item) {
      const rule = T().recurring_rules.find((r) => r.id === item.recurring_id);
      if (!rule) throw new Error('找不到這個固定收支');
      const acc = d.accById.get(rule.account_id);
      const rate = d.rateFor(acc.currency, item.due_date);
      if (rate == null) throw new Error('NEED_FORM');
      const form = {
        type: rule.type, amount: rule.amount, account_id: rule.account_id, category_id: rule.category_id,
        occurred_at: startOfDayIso(item.due_date), note: rule.note || rule.name, is_exception: false, fx_rate: rate,
        source: 'recurring', pending_item_id: item.id,
      };
      if (rule.type === 'transfer') {
        const to = d.accById.get(rule.to_account_id);
        const toRate = d.rateFor(to.currency, item.due_date);
        if (toRate == null) throw new Error('NEED_FORM');
        Object.assign(form, { to_account_id: to.id, to_fx_rate: toRate, to_amount: round2(rule.amount * rate / toRate) });
      }
      await saveTxn(form);
    }

    const skipPending = (item) => updateRow('pending_items', item.id, { status: 'skipped' });

    /** 股票成交：寫成交紀錄，並在交割日產生交割戶扣款／入帳（轉帳，不算收支） */
    async function saveTrade(form, original) {
      const trade = {
        brokerage_account_id: form.brokerage_account_id, market: form.market, symbol: form.symbol.trim().toUpperCase(),
        name: (form.name ?? '').trim(), kind: form.kind, side: form.side, trade_date: form.trade_date,
        settle_date: form.side === 'opening' ? null : form.settle_date || null,
        shares: Number(form.shares), price: Number(form.price), fee: Number(form.fee) || 0, tax: Number(form.tax) || 0,
        currency: form.currency, settlement_account_id: form.side === 'opening' ? null : form.settlement_account_id || null,
        settle_amount: null, order_no: form.order_no?.trim() || null, note: (form.note ?? '').trim(),
      };
      let txn = null;
      if (trade.settlement_account_id) {
        const net = tradeNetAmount(trade);
        const settleAcc = d.accById.get(trade.settlement_account_id);
        const date = trade.settle_date || trade.trade_date;
        const settleRate = settleAcc.currency === 'TWD' ? 1 : d.rateFor(settleAcc.currency, date);
        const typed = Number(form.settle_amount) || 0; // 對帳單上實際扣／入的金額（交割戶幣別）
        const tradeRate = trade.currency === 'TWD' ? 1
          : d.rateFor(trade.currency, date) ?? (typed && settleRate && net ? (typed * settleRate) / net : null);
        if (!tradeRate || !settleRate) throw new Error(`找不到 ${trade.currency} 匯率，請填實際扣款／入帳金額`);
        const settleAmount = settleAcc.currency === trade.currency ? net : round2(typed || net * tradeRate / settleRate);
        // 證券戶那一邊用證券戶的幣別記（台幣證券戶裡的美股 → 記台幣）
        const brkAcc = d.accById.get(trade.brokerage_account_id);
        const brkSame = brkAcc.currency === trade.currency;
        const brkRate = brkSame ? tradeRate : brkAcc.currency === settleAcc.currency ? settleRate : (d.rateFor(brkAcc.currency, date) ?? tradeRate);
        const brkAmount = brkSame ? net : brkAcc.currency === settleAcc.currency ? settleAmount : round2(net * tradeRate / brkRate);
        trade.settle_amount = settleAmount;
        const label = `${trade.side === 'buy' ? '買進' : '賣出'} ${trade.symbol}${trade.name ? ` ${trade.name}` : ''} ${trade.shares} 股`;
        txn = trade.side === 'buy'
          ? { account_id: settleAcc.id, amount: settleAmount, fx_rate: settleRate, to_account_id: trade.brokerage_account_id, to_amount: brkAmount, to_fx_rate: brkRate }
          : { account_id: trade.brokerage_account_id, amount: brkAmount, fx_rate: brkRate, to_account_id: settleAcc.id, to_amount: settleAmount, to_fx_rate: settleRate };
        Object.assign(txn, { type: 'transfer', category_id: null, occurred_at: startOfDayIso(date), note: label, source: 'stock', is_exception: false });
      }
      if (!original) {
        const [t] = txn ? await insertRows('transactions', [{ id: uid(), ...txn }]) : [null];
        let saved;
        try {
          saved = (await insertRows('stock_trades', [{ ...trade, settlement_txn_id: t?.id ?? null, pending_item_id: form.pending_item_id ?? null }]))[0];
        } catch (e) {
          if (t) await removeRows('transactions', [t.id]);
          throw e;
        }
        await syncRealized();
        return saved;
      }
      let txnId = original.settlement_txn_id;
      if (txn && txnId) await updateRow('transactions', txnId, txn);
      else if (txn) txnId = (await insertRows('transactions', [{ id: uid(), ...txn }]))[0].id;
      else if (txnId) { await removeRows('transactions', [txnId]); txnId = null; }
      const saved = await updateRow('stock_trades', original.id, { ...trade, settlement_txn_id: txnId });
      await syncRealized();
      return saved;
    }

    async function deleteTrade(trade) {
      const ids = [trade.settlement_txn_id, trade.pnl_txn_id].filter(Boolean);
      await removeRows('stock_trades', [trade.id]);
      if (ids.length) await removeRows('transactions', ids);
      await syncRealized(); // 刪掉一筆買進，後面賣出的成本會變
    }

    /** 股利：實拿金額記成收入「投資收入-股利」，總額與預扣存在股利紀錄 */
    async function saveDividend(form, original) {
      const gross = round2(Number(form.gross)); const withholding = round2(Number(form.withholding) || 0);
      const nhi = round2(Number(form.nhi_premium) || 0);
      const net = round2(gross - withholding - nhi);
      if (net < 0) throw new Error('預扣稅＋二代健保不能大於股利總額');
      const dep = d.accById.get(form.deposit_account_id);
      const rateDiv = d.rateFor(form.currency, form.pay_date);
      const rateDep = d.rateFor(dep.currency, form.pay_date);
      if (rateDiv == null || rateDep == null) throw new Error('找不到當天匯率');
      const amount = dep.currency === form.currency ? net : round2(net * rateDiv / rateDep);
      const txn = {
        type: 'income', occurred_at: startOfDayIso(form.pay_date), account_id: dep.id, amount, fx_rate: rateDep,
        category_id: d.dividendCat.id, note: `${form.symbol} 股利`, source: 'dividend', is_exception: false,
        to_account_id: null, to_amount: null, to_fx_rate: null,
      };
      const div = {
        brokerage_account_id: form.brokerage_account_id, market: form.market, symbol: form.symbol.trim().toUpperCase(),
        pay_date: form.pay_date, gross, withholding, nhi_premium: nhi, currency: form.currency, note: (form.note ?? '').trim(),
      };
      if (original) {
        await updateRow('transactions', original.transaction_id, txn);
        return updateRow('dividends', original.id, div);
      }
      const [t] = await insertRows('transactions', [{ id: uid(), ...txn }]);
      try {
        return (await insertRows('dividends', [{ ...div, transaction_id: t.id }]))[0];
      } catch (e) { await removeRows('transactions', [t.id]); throw e; }
    }

    const deleteDividend = (div) => removeRows('transactions', [div.transaction_id]);

    /** 排序：照 ids 的順序把 sort_order 設成 0, 1, 2…（只寫有變的） */
    async function reorder(table, ids) {
      for (let i = 0; i < ids.length; i++) {
        const r = T()[table].find((x) => x.id === ids[i]);
        if (r && r.sort_order !== i) await updateRow(table, ids[i], { sort_order: i });
      }
    }

    async function saveManualPrice({ market, symbol, price_date, close }) {
      return (await insertRows('manual_prices', [{ market, symbol, price_date, close: Number(close) }], { onConflict: 'user_id,market,symbol,price_date' }))[0];
    }

    /** 分類「一律算例外」：開關設定，applyPast 時把過去還沒標例外的也一起改 */
    async function setCategoryException(catId, on, applyPast = false) {
      const cur = d.settings.exceptionCats ?? [];
      const next = on ? [...new Set([...cur, catId])] : cur.filter((x) => x !== catId);
      await updateSettings({ exceptionCats: next });
      if (!on || !applyPast) return 0;
      const ids = pastNotException(catId).map((t) => t.id);
      if (!ids.length) return 0;
      guard();
      const saved = await backend.updateMany('transactions', ids, { is_exception: true });
      commit((t) => ({ ...t, transactions: mergeById(t.transactions, saved) }));
      return saved.length;
    }

    /** 這個分類（含子分類）過去還沒標例外的支出 */
    function pastNotException(catId) {
      const set = d.tree.descendants(catId);
      return T().transactions.filter((t) => t.type !== 'transfer' && set.has(t.category_id) && !t.is_exception);
    }

    async function updateSettings(patch) {
      const p = T().profiles[0];
      return updateRow('profiles', p.user_id, { settings: { ...(p.settings ?? {}), ...patch } });
    }

    /** 大量寫入（匯入用），每 500 筆回報進度 */
    async function bulkInsert(table, rows, onProgress) {
      guard();
      const out = [];
      for (let i = 0; i < rows.length; i += 500) {
        out.push(...await backend.insert(table, rows.slice(i, i + 500)));
        onProgress?.(Math.min(rows.length, i + 500), rows.length);
      }
      commit((t) => ({ ...t, [table]: mergeById(t[table], out) }));
      return out;
    }

    return {
      setCategoryException, pastNotException,
      saveTxn, deleteTxn, saveAccount, saveCategory, saveTemplate, useInstantTemplate, saveRecurring,
      confirmRecurring, skipPending, saveTrade, deleteTrade, saveDividend, deleteDividend, saveManualPrice,
      updateSettings, bulkInsert, insertRows, updateRow, removeRows, reorder, reload: load,
    };
  }, [derived, insertRows, updateRow, removeRows, load]);

  const fullStatus = useMemo(() => ({ ...status, queued }), [status, queued]);
  const value = useMemo(() => ({ backend, user, status: fullStatus, data: derived, actions }), [backend, user, fullStatus, derived, actions]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { TABLES };
