// 共用的小元件：圖示、頁面框架、清單列、底部面板、對話框、提示、路由
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fmt } from '../lib/money.js';
import { friendlyError } from '../data/errors.js';

// ---------- 圖示（線條 SVG） ----------
const PATHS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2Zm13 7h.01',
  plus: 'M12 5v14M5 12h14',
  chart: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  more: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8 12h.01M12 12h.01M16 12h.01',
  chev: 'm9 6 6 6-6 6',
  back: 'm15 6-6 6 6 6',
  down: 'm6 9 6 6 6-6',
  up: 'm6 15 6-6 6 6',
  x: 'M6 6l12 12M18 6 6 18',
  check: 'm5 12 5 5 9-10',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  stock: 'M3 17l6-6 4 4 8-8m0 0h-6m6 0v6',
  repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  tag: 'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9zM8 8h.01',
  upload: 'M12 16V4m0 0-5 5m5-5 5 5M4 20h16',
  download: 'M12 4v12m0 0-5-5m5 5 5-5M4 20h16',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z',
  key: 'M15 7a4 4 0 1 1-3.9 4.9L3 20v-3h3v-3h3l1.1-1.1A4 4 0 0 1 15 7Zm1 1h.01',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm10 3-5-5',
  trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5l3 2',
  split: 'M6 3v6a6 6 0 0 0 6 6 6 6 0 0 1 6 6M18 3v6a6 6 0 0 1-3 5.2M3 6l3-3 3 3m6 0 3-3 3 3',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 9a8 8 0 0 1 16 0',
  calendar: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 10h16M8 2v4m8-4v4',
  food: 'M7 3v18M4 3v5a3 3 0 0 0 6 0V3M17 21V3c-2.2 0-3.5 3-3.5 6.5S15 13 17 13',
  coffee: 'M4 8h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 9h1a3 3 0 0 1 0 6h-1M8 2v3m4-3v3M4 21h13',
  bus: 'M5 17V6a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v11zM5 11h14M8 14h.01M16 14h.01M7 17v3m10-3v3',
  plane: 'M10 14 3 11l2-2 6 1 5-5a2 2 0 0 1 3 3l-5 5 1 6-2 2-3-7z',
  bag: 'M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2',
  shirt: 'M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3a4 4 0 0 1-8 0Z',
  game: 'M6 9h12a4 4 0 0 1 0 8c-1.5 0-2.5-1-3.5-2h-5C8.5 16 7.5 17 6 17a4 4 0 0 1 0-8Zm2 2v3m-1.5-1.5h3M15 12h.01M17 14h.01',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
  medical: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v8m-4-4h8',
  book: 'M4 19V5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2 2 2 0 0 0 2 2h13v-4',
  gift: 'M4 11h16v10H4zM3 7h18v4H3zM12 7v14M12 7S10.5 3 8 3a2 2 0 0 0 0 4m4 0s1.5-4 4-4a2 2 0 0 1 0 4',
  paw: 'M12 13c-3 0-5 3-5 5a2 2 0 0 0 2 2c1 0 2-.5 3-.5s2 .5 3 .5a2 2 0 0 0 2-2c0-2-2-5-5-5ZM5 9.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0M8 5.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0M13 5.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0M16 9.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0',
  phone: 'M7 2h10v20H7zM11 18h2',
  briefcase: 'M3 8h18v12H3zM9 8V5h6v3M3 13h18',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  percent: 'M19 5 5 19M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  coins: 'M8 8a5 3 0 1 0 10 0A5 3 0 1 0 8 8Zm0 0v4c0 1.7 2.2 3 5 3s5-1.3 5-3V8M6 12.5C4.8 13 4 13.8 4 14.6c0 1.7 2.2 3 5 3 1.3 0 2.5-.3 3.4-.8',
  card: 'M3 6h18v12H3zM3 10h18M7 15h4',
  bank: 'M3 10 12 4l9 6zM5 10v8m4.7-8v8m4.6-8v8M19 10v8M3 21h18',
  cash: 'M3 7h18v10H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 10v.01M18 14v.01',
  people: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 9a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6m2 9a6 6 0 0 0-3-5.2',
  doc: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6',
  swap: 'M7 4 3 8l4 4M3 8h14m0 12 4-4-4-4m4 4H7',
  arrowUp: 'M12 19V5m-6 6 6-6 6 6',
  arrowDown: 'M12 5v14m-6-6 6 6 6-6',
  layers: 'm12 3 9 5-9 5-9-5zm-9 9 9 5 9-5M3 16l9 5 9-5',
};
/** 圓角方塊裡的圖示（像「更多」清單左邊那種） */
export function Tile({ name, tone = '', round = false, size }) {
  return <span className={`tile ${tone} ${round ? 'round' : ''}`} style={size ? { width: size, height: size } : undefined}><Icon name={name} /></span>;
}

// 分類 → 圖示：從最底層往上找第一個對得上的關鍵字
const CAT_ICONS = [
  [/飲料|咖啡|茶|點心/, 'coffee'], [/早餐|午餐|晚餐|宵夜|飲食|食|餐|喝酒/, 'food'],
  [/旅|機票|住宿|出去玩/, 'plane'], [/交通|車|捷運|加油|停車|高鐵|計程|悠遊/, 'bus'],
  [/房|租|居住|水電|瓦斯|管理費/, 'home'], [/衣|服飾|鞋/, 'shirt'], [/日常|用品|生活|超市/, 'bag'],
  [/娛樂|遊戲|電影|唱歌|運動/, 'game'], [/繳費|訂閱|電信|網路|手續費/, 'receipt'], [/醫|藥|健康|保險/, 'medical'],
  [/學|書|課|教育/, 'book'], [/人際|禮|紅包|請客|交際/, 'gift'], [/寵物/, 'paw'], [/3C|電子|手機|電腦/, 'phone'],
  [/例外|年度/, 'calendar'], [/股利|配息/, 'coins'], [/股票|投資|證券/, 'stock'], [/利息/, 'percent'], [/獎金|獎/, 'star'], [/薪|工作|兼職/, 'briefcase'],
];
export function categoryIcon(tree, id) {
  const chain = id ? tree.chain(id) : [];
  for (let i = chain.length - 1; i >= 0; i--) {
    for (const [re, icon] of CAT_ICONS) if (re.test(chain[i].name)) return icon;
  }
  return 'tag';
}
const ACC_ICONS = { cash: 'cash', bank: 'bank', credit_card: 'card', e_payment: 'phone', brokerage: 'stock', friends_owe: 'people', loan: 'doc', other: 'wallet' };
export const accountIcon = (type) => ACC_ICONS[type] ?? 'wallet';

export function Icon({ name, className, title }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={PATHS[name]} />
    </svg>
  );
}

// ---------- 路由：#home、#account/xxx ----------
function readHash() {
  const h = location.hash.replace(/^#\/?/, '');
  if (!h || /^(access_token|error|type=|refresh_token)/.test(h)) return { name: 'home', arg: null };
  const [name, ...rest] = h.split('/');
  return { name, arg: rest.length ? decodeURIComponent(rest.join('/')) : null };
}
// 捲動位置自己管：iPhone Safari 返回時自己還原捲動，跟我們的「回到頂端」打架會卡住
if (typeof history !== 'undefined' && 'scrollRestoration' in history) history.scrollRestoration = 'manual';
const scrollPos = new Map();   // 每個頁面離開時捲到哪
const visited = [];             // 走過的頁面，用來判斷是不是「返回」
export function useRoute() {
  const [route, setRoute] = useState(readHash);
  useEffect(() => {
    let cur = location.hash;
    visited.push(cur);
    const onScroll = () => { if (!locks) scrollPos.set(cur, window.scrollY); };
    const on = () => {
      const next = location.hash;
      const isBack = visited.length >= 2 && visited[visited.length - 2] === next;
      if (isBack) visited.pop(); else visited.push(next);
      cur = next;
      setRoute(readHash());
      unlockIfNoSheet();
      const y = isBack ? scrollPos.get(next) ?? 0 : 0;
      // 等新頁面畫好再捲
      requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));
    };
    addEventListener('hashchange', on);
    addEventListener('scroll', onScroll, { passive: true });
    return () => { removeEventListener('hashchange', on); removeEventListener('scroll', onScroll); };
  }, []);
  return route;
}

// 開視窗時鎖住後面的頁面；用計數，多層視窗一起開關也不會留下鎖。
// iPhone Safari 只設 overflow:hidden 鎖不住：打開下拉選單或鍵盤時它會偷偷捲動後面的頁面，
// 收起後畫面沒動、但點擊位置整個偏掉（按「取消」會點到別的欄位）。所以改成把 body 固定住。
let locks = 0;
let lockedY = 0;
function applyLock() {
  lockedY = window.scrollY;
  const b = document.body.style;
  Object.assign(b, { position: 'fixed', top: `-${lockedY}px`, left: '0', right: '0', width: '100%', overflow: 'hidden' });
}
function releaseLock() {
  const b = document.body.style;
  Object.assign(b, { position: '', top: '', left: '', right: '', width: '', overflow: '' });
  window.scrollTo(0, lockedY);
}
function lockScroll() { if (locks++ === 0) applyLock(); }
function unlockScroll() { if (locks > 0 && --locks === 0) releaseLock(); }
function unlockIfNoSheet() {
  setTimeout(() => { if (!document.querySelector('.sheet') && (locks || document.body.style.position === 'fixed')) { locks = 0; releaseLock(); } }, 50);
}
// 鍵盤、下拉選單收起後，把被 Safari 推走的頁面拉回原位，點的位置才會跟畫面對上
function realign() { if (locks && window.scrollY !== 0) window.scrollTo(0, 0); }
if (typeof window !== 'undefined') {
  document.addEventListener('focusout', () => setTimeout(realign, 60));
  document.addEventListener('change', () => setTimeout(realign, 60));
  window.visualViewport?.addEventListener('resize', () => setTimeout(realign, 60));
  window.addEventListener('scroll', () => { if (locks) realign(); }, { passive: true });
}
export const go = (name, arg) => { location.hash = arg ? `${name}/${encodeURIComponent(arg)}` : name; };
export const back = (fallback = 'home') => { if (history.length > 1) history.back(); else go(fallback); };

// ---------- 頁面框架 ----------
export function Page({ title, onBack, right, children }) {
  return (
    <>
      <header className="topbar">
        {onBack && <button className="iconbtn" onClick={onBack} aria-label="返回"><Icon name="back" /></button>}
        <h1>{title}</h1>
        {right}
      </header>
      <main className="content">{children}</main>
    </>
  );
}

export function Section({ title, action, children, className = '' }) {
  return (
    <section className={`section ${className}`}>
      {(title || action) && <h2>{title}{action}</h2>}
      {children}
    </section>
  );
}

export function Item({ title, sub, value, valueSub, onClick, href, left, chevron = !!(onClick || href), className = '', children }) {
  const inner = (
    <>
      {left}
      <div className="main">
        <div className="title">{title}</div>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {(value !== undefined || valueSub) && <div className="value">{value}{valueSub && <span className="sub">{valueSub}</span>}</div>}
      {children}
      {chevron && <Icon name="chev" className="chev" />}
    </>
  );
  if (href) return <a className={`item ${className}`} href={href}>{inner}</a>;
  if (onClick) return <button type="button" className={`item ${className}`} onClick={onClick}>{inner}</button>;
  return <div className={`item ${className}`}>{inner}</div>;
}

export function Money({ value, currency = 'TWD', tone, sign, className = '' }) {
  const cls = tone === 'auto' ? (value < 0 ? 'expense' : value > 0 ? 'income' : '') : tone ?? '';
  return <span className={`num ${cls} ${className}`}>{fmt(value, currency, { sign })}</span>;
}

export function Empty({ children }) { return <div className="empty">{children}</div>; }

export function Seg({ options, value, onChange, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button type="button" key={o.value} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }) {
  return (
    <label className="toggle">
      <input type="checkbox" role="switch" checked={!!checked} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

/** 一組按鈕（例如分段選擇）用 Group，不要用 Field：<label> 會把標籤文字套到第一個按鈕上 */
export function Group({ label, hint, children }) {
  return (
    <div className="field" role="group" aria-label={label}>
      <span>{label}{hint && <> <span className="hint">{hint}</span></>}</span>
      {children}
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span>{label}{hint && <> <span className="hint">{hint}</span></>}</span>
      {children}
    </label>
  );
}

// ---------- 底部面板 ----------
export function Sheet({ title, onClose, onSave, saveLabel = '儲存', saving, full, children }) {
  useEffect(() => { lockScroll(); return unlockScroll; }, []);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  // 用 portal 放到最外層：從記帳畫面裡再開的視窗（例如選分類）不會沿用外面欄位的樣式
  return createPortal(
    <div className="sheet-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`sheet ${full ? 'full' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <button type="button" className="link" onClick={onClose}>取消</button>
          <h3>{title}</h3>
          {onSave ? <button type="button" className="link" onClick={onSave} disabled={saving}>{saving ? '儲存中' : saveLabel}</button> : <span style={{ minWidth: 64 }} />}
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// ---------- 對話框與提示（不用瀏覽器的 confirm/alert） ----------
const UICtx = createContext(null);
export const useUI = () => useContext(UICtx);

export function UIProvider({ children, extra }) {
  const [dialog, setDialog] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);
  const timer = useRef(null);
  const toast = useCallback((msg) => {
    setToastMsg(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToastMsg(null), 2600);
  }, []);
  const confirm = useCallback((message, { ok = '確定', danger = false, cancel = '取消' } = {}) => new Promise((resolve) => {
    setDialog({ message, ok, danger, cancel, resolve });
  }), []);
  const close = (v) => { dialog?.resolve(v); setDialog(null); };
  return (
    <UICtx.Provider value={{ toast, confirm, ...extra }}>
      {children}
      {dialog && (
        <div className="dialog-backdrop" onClick={(e) => { if (e.target === e.currentTarget) close(false); }}>
          <div className="dialog" role="alertdialog" aria-modal="true">
            <p>{dialog.message}</p>
            <div className="grid2">
              {dialog.cancel && <button className="btn" onClick={() => close(false)}>{dialog.cancel}</button>}
              <button className={`btn ${dialog.danger ? 'danger' : 'primary'}`} onClick={() => close(true)} autoFocus>{dialog.ok}</button>
            </div>
          </div>
        </div>
      )}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </UICtx.Provider>
  );
}

/** 包一層：執行動作，失敗時跳提示 */
export function useAction() {
  const { toast } = useUI();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, okMsg) => {
    setBusy(true);
    try {
      const r = await fn();
      if (okMsg) toast(okMsg);
      return r ?? true;
    } catch (e) {
      toast(friendlyError(e));
      return false;
    } finally { setBusy(false); }
  }, [toast]);
  return [run, busy];
}

/** 下載文字檔；在不允許下載的環境（例如預覽框）會失敗，所以畫面另外提供「複製」 */
export function downloadText(filename, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** 排序模式用的上下移動；list 是同一組的 id，回傳移動後的新順序 */
export function MoveButtons({ ids, id, onMove, label }) {
  const i = ids.indexOf(id);
  const move = (d) => {
    const next = [...ids];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onMove(next);
  };
  return (
    <span className="row-flex" style={{ gap: 0 }}>
      <button type="button" className="iconbtn" disabled={i <= 0} onClick={() => move(-1)} aria-label={`${label} 往上移`} style={{ opacity: i <= 0 ? 0.3 : 1 }}><Icon name="up" /></button>
      <button type="button" className="iconbtn" disabled={i >= ids.length - 1} onClick={() => move(1)} aria-label={`${label} 往下移`} style={{ opacity: i >= ids.length - 1 ? 0.3 : 1 }}><Icon name="down" /></button>
    </span>
  );
}
