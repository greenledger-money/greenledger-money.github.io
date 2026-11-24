// 共用的小元件：圖示、頁面框架、清單列、底部面板、對話框、提示、路由
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { fmt } from '../lib/money.js';
import { friendlyError } from '../data/errors.js';

// ---------- 圖示（線條 SVG） ----------
const PATHS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2Zm13 7h.01',
  plus: 'M12 5v14M5 12h14',
  chart: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
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
};
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
export function useRoute() {
  const [route, setRoute] = useState(readHash);
  useEffect(() => {
    const on = () => { setRoute(readHash()); window.scrollTo(0, 0); };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
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
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; removeEventListener('keydown', onKey); };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`sheet ${full ? 'full' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <button type="button" className="link" onClick={onClose}>取消</button>
          <h3>{title}</h3>
          {onSave ? <button type="button" className="link" onClick={onSave} disabled={saving}>{saving ? '儲存中' : saveLabel}</button> : <span style={{ minWidth: 64 }} />}
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
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
