// App 外框：決定用哪個後端（Supabase 或試用模式）、登入狀態、頁面切換、底部分頁列
import Budget from './pages/Budget.jsx';
import { useEffect, useMemo, useState } from 'react';
import { LedgerProvider, useLedger } from './store.jsx';
import { Icon, UIProvider, go, useRoute } from './ui/kit.jsx';
import EntrySheet from './ui/EntrySheet.jsx';
import Auth, { NewPassword } from './pages/Auth.jsx';
import Home from './pages/Home.jsx';
import Accounts, { AccountDetail } from './pages/Accounts.jsx';
import Transactions from './pages/Transactions.jsx';
import Reports, { ReportCategory, ReportTxns } from './pages/Reports.jsx';
import Stocks, { StockDetail, TradeSheet } from './pages/Stocks.jsx';
import { Categories, More, Recurring, Templates } from './pages/Manage.jsx';
import Import from './pages/Import.jsx';
import Inbox from './pages/Inbox.jsx';
import Friends from './pages/Friends.jsx';
import Worth from './pages/Worth.jsx';
import Goals from './pages/Goals.jsx';
import Year from './pages/Year.jsx';
import { Export, Privacy, Settings } from './pages/Settings.jsx';
import { createLocalBackend } from './data/local.js';
import { createSupabaseBackend } from './data/supabase.js';
import { seedDemo } from './data/sample.js';
import { hasSupabase, SUPABASE } from './config.js';

const MODE_KEY = 'ledger.mode';
const LAST_USER = 'ledger.lastUser';
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* ignore */ } },
};

/** 沒網路、連 supabase-js 都載不到時：用最後一次的快取資料，只能看不能改 */
function offlineBackend(user) {
  const no = () => Promise.reject(new Error('offline'));
  return {
    kind: 'supabase', offline: true, getUser: async () => user, onAuth: () => () => {}, loadAll: no, loadShared: no,
    insert: no, update: no, remove: no, removeImported: no, deleteAccount: no, signOut: async () => { store.set(LAST_USER, null); location.reload(); },
    passkey: { supported: false },
  };
}

const TABS = [
  { name: 'home', label: '首頁', icon: 'home' },
  { name: 'accounts', label: '帳戶', icon: 'wallet' },
  { name: 'add', label: '記一筆', icon: 'plus' },
  { name: 'reports', label: '報表', icon: 'chart' },
  { name: 'more', label: '更多', icon: 'more' },
];
const TAB_OF = { budget: 'more', rcat: 'reports', rtx: 'reports', account: 'accounts', transactions: 'more', stocks: 'more', stock: 'more', templates: 'more', recurring: 'more', categories: 'more', import: 'more', inbox: 'more', friends: 'more', worth: 'accounts', goals: 'more', year: 'reports', export: 'more', settings: 'more', privacy: 'more' };

function Shell({ openEntry }) {
  const { status, data, actions, backend } = useLedger();
  const route = useRoute();
  const theme = data?.settings.theme ?? 'system';
  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);
  if (status.loading && !data) return <div className="auth"><p className="center muted">載入中…</p></div>;
  if (status.error && !data) {
    return (
      <div className="auth">
        <div className="notice warn">{status.error}</div>
        <button className="btn primary" onClick={() => actions?.reload?.() ?? location.reload()}>重試</button>
        <button className="btn" onClick={() => backend.signOut()}>登出</button>
      </div>
    );
  }
  let page;
  switch (route.name) {
    case 'accounts': page = <Accounts />; break;
    case 'account': page = <AccountDetail id={route.arg} key={route.arg} />; break;
    case 'transactions': page = <Transactions />; break;
    case 'reports': page = <Reports />; break;
    case 'rcat': page = <ReportCategory id={route.arg} key={route.arg} />; break;
    case 'rtx': page = <ReportTxns id={route.arg} key={route.arg} />; break;
    case 'more': page = <More />; break;
    case 'budget': page = <Budget />; break;
    case 'stocks': page = <Stocks />; break;
    case 'stock': page = <StockDetail id={route.arg} key={route.arg} />; break;
    case 'templates': page = <Templates />; break;
    case 'recurring': page = <Recurring />; break;
    case 'categories': page = <Categories />; break;
    case 'import': page = <Import />; break;
    case 'inbox': page = <Inbox />; break;
    case 'friends': page = <Friends />; break;
    case 'worth': page = <Worth />; break;
    case 'goals': page = <Goals />; break;
    case 'year': page = <Year />; break;
    case 'export': page = <Export />; break;
    case 'settings': page = <Settings />; break;
    case 'privacy': page = <Privacy />; break;
    default: page = <Home />;
  }
  const current = TAB_OF[route.name] ?? (TABS.some((t) => t.name === route.name) ? route.name : 'home');
  return (
    <div className="app">
      {status.warning && <div className="notice warn banner" style={{ marginTop: 'calc(env(safe-area-inset-top) + 8px)' }}>{status.warning}</div>}
      {status.offline ? (
        <div className="notice warn banner" style={{ marginTop: 'calc(env(safe-area-inset-top) + 8px)' }}>
          離線中：記的帳先存在手機，有網路會自動上傳{status.queued ? `（${status.queued} 筆待上傳）` : ''}
        </div>
      ) : status.queued > 0 && (
        <div className="notice banner" style={{ marginTop: 'calc(env(safe-area-inset-top) + 8px)' }}>{status.queued} 筆離線記的帳上傳中…</div>
      )}
      {page}
      <div className="tabbar">
        <nav aria-label="主選單">
          {TABS.map((t) => (t.name === 'add' ? (
            <button key={t.name} className="tab tab-add" aria-label="記一筆" onClick={() => openEntry({})}>
              <span><Icon name="plus" /></span>
            </button>
          ) : (
            <button key={t.name} className="tab" aria-current={current === t.name ? 'page' : undefined} onClick={() => go(t.name)}>
              <Icon name={t.icon} />{t.label}
            </button>
          )))}
        </nav>
      </div>
    </div>
  );
}

function SignedIn({ backend, user }) {
  const [entry, setEntry] = useState(null);
  const [trade, setTrade] = useState(null);
  const extra = useMemo(() => ({ openEntry: (o = {}) => setEntry(o), openTrade: (o = {}) => setTrade(o) }), []);
  return (
    <LedgerProvider backend={backend} user={user} key={user.id}>
      <UIProvider extra={extra}>
        <Shell openEntry={extra.openEntry} />
        {entry && <EntrySheet original={entry.original} initial={entry.initial} onClose={() => setEntry(null)} />}
        {trade && <TradeSheet original={trade.original} initial={trade.initial} onClose={() => setTrade(null)} />}
      </UIProvider>
    </LedgerProvider>
  );
}

export default function App() {
  const local = useMemo(() => createLocalBackend(), []);
  const [supa, setSupa] = useState(null);
  const [state, setState] = useState({ ready: false, backend: null, user: null, recovery: false });

  useEffect(() => {
    let off = () => {};
    let offLocal = () => {};
    (async () => {
      // 1. 試用模式
      offLocal = local.onAuth((u) => setState((s) => (u ? { ...s, ready: true, backend: local, user: u } : s.backend === local ? { ...s, backend: null, user: null } : s)));
      if (store.get(MODE_KEY) === 'demo') {
        const u = await local.getUser();
        if (u) { setState({ ready: true, backend: local, user: u }); }
      }
      // 2. Supabase
      if (!hasSupabase) { setState((s) => ({ ...s, ready: true })); return; }
      let sb;
      try {
        sb = await createSupabaseBackend(SUPABASE);
      } catch {
        const last = store.get(LAST_USER);
        if (last && store.get(MODE_KEY) !== 'demo') setState({ ready: true, backend: offlineBackend(JSON.parse(last)), user: JSON.parse(last) });
        else setState((s) => ({ ...s, ready: true }));
        return;
      }
      setSupa(sb);
      off = sb.onAuth((u, event) => {
        if (event === 'PASSWORD_RECOVERY') { setState((s) => ({ ...s, recovery: true })); return; }
        if (u) {
          store.set(MODE_KEY, 'supabase'); store.set(LAST_USER, JSON.stringify(u));
          setState((s) => (s.user?.id === u.id && s.backend === sb ? s : { ...s, ready: true, backend: sb, user: u }));
        } else if (event === 'SIGNED_OUT') {
          store.set(LAST_USER, null);
          setState((s) => (s.backend === sb ? { ...s, backend: null, user: null } : s));
        }
      });
      if (store.get(MODE_KEY) !== 'demo') {
        const u = await sb.getUser();
        if (u) { store.set(LAST_USER, JSON.stringify(u)); setState({ ready: true, backend: sb, user: u }); return; }
      }
      setState((s) => ({ ...s, ready: true }));
    })();
    return () => { off(); offLocal(); };
  }, [local]);

  if (!state.ready) return <div className="auth"><p className="center muted">載入中…</p></div>;
  if (state.recovery && supa) return <NewPassword backend={supa} onDone={() => setState((s) => ({ ...s, recovery: false }))} />;
  if (!state.backend || !state.user) {
    return (
      <Auth supa={supa} hasDemoData={local.hasData()} onDemo={async () => {
        store.set(MODE_KEY, 'demo');
        const u = await local.startDemo(seedDemo);
        setState({ ready: true, backend: local, user: u });
      }} />
    );
  }
  return <SignedIn backend={state.backend} user={state.user} />;
}
