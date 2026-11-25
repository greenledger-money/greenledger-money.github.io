// 登入／註冊：Email＋密碼、Passkey（Face ID）、或先試用
import { useState } from 'react';
import { Field, Icon, Seg } from '../ui/kit.jsx';
import { friendlyError } from '../data/errors.js';
import { APP } from '../config.js';
import { Privacy } from './Settings.jsx';

export function NewPassword({ backend, onDone }) {
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault();
    if (pw.length < 6) { setMsg('密碼至少要 6 個字元'); return; }
    setBusy(true);
    try { await backend.updatePassword(pw); onDone(); } catch (ex) { setMsg(friendlyError(ex)); } finally { setBusy(false); }
  }
  return (
    <div className="auth">
      <div className="brand"><h1>設定新密碼</h1></div>
      <form className="form" onSubmit={save}>
        <Field label="新密碼"><input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        {msg && <div className="error">{msg}</div>}
        <button className="btn primary block" disabled={busy}>儲存新密碼</button>
      </form>
    </div>
  );
}

export default function Auth({ supa, onDemo, hasDemoData }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [privacy, setPrivacy] = useState(false);

  const act = async (fn) => {
    setBusy(true); setMsg(null);
    try { await fn(); } catch (e) { setMsg({ err: true, text: friendlyError(e) }); } finally { setBusy(false); }
  };
  const submit = (e) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) { setMsg({ err: true, text: '請輸入正確的 Email' }); return; }
    if (mode === 'reset') {
      act(async () => { await supa.resetPassword(email); setMsg({ text: '已寄出重設密碼的信，點信裡的連結就能設定新密碼。' }); });
      return;
    }
    if (pw.length < 6) { setMsg({ err: true, text: '密碼至少要 6 個字元' }); return; }
    if (mode === 'signup') {
      act(async () => {
        const r = await supa.signUp(email, pw);
        if (!r.session) setMsg({ text: '已寄出驗證信。點信裡的連結完成驗證後，回到這裡登入。' });
      });
    } else act(() => supa.signIn(email, pw));
  };

  if (privacy) return <Privacy standalone onClose={() => setPrivacy(false)} />;

  return (
    <div className="auth">
      <div className="brand">
        <h1>{APP.name}</h1>
        <p>免費、多人可用的記帳本。分類可以三層、外幣自動帶匯率、分帳用「朋友欠我」記，餘額每次從帳本重算。</p>
      </div>
      <div className="ledger-art" aria-hidden="true">
        <em style={{ top: 4 }}>早餐</em><b style={{ top: 4 }} className="expense">-$85</b>
        <em style={{ top: 32 }}>朋友欠我 → 郵局</em><b style={{ top: 32 }}>$215</b>
        <em style={{ top: 60 }}>薪水</em><b style={{ top: 60 }} className="income">+$52,000</b>
        <em style={{ top: 88 }}>0050 股利</em><b style={{ top: 88 }} className="income">+$1,960</b>
      </div>

      {supa ? (
        <>
          {supa.passkey.supported && mode === 'login' && (
            <>
              <button className="btn primary block" disabled={busy} onClick={() => act(() => supa.passkey.signIn())}>
                <Icon name="key" className="chev" />用 Face ID／Passkey 登入
              </button>
              <div className="divider">或用 Email</div>
            </>
          )}
          {mode !== 'reset' && <Seg value={mode} onChange={(m) => { setMode(m); setMsg(null); }} options={[{ value: 'login', label: '登入' }, { value: 'signup', label: '註冊' }]} />}
          <form className="form" onSubmit={submit}>
            <Field label="Email"><input className="input" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            {mode !== 'reset' && (
              <Field label="密碼" hint={mode === 'signup' ? '至少 6 個字元' : ''}>
                <input className="input" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={pw} onChange={(e) => setPw(e.target.value)} />
              </Field>
            )}
            {msg && <div className={msg.err ? 'error' : 'notice'} role="status">{msg.text}</div>}
            <button className={`btn block ${supa.passkey.supported && mode === 'login' ? '' : 'primary'}`} disabled={busy}>
              {busy ? '請稍候…' : mode === 'signup' ? '註冊' : mode === 'reset' ? '寄重設密碼信' : '登入'}
            </button>
            {mode === 'login' && <button type="button" className="link" onClick={() => setMode('reset')}>忘記密碼</button>}
            {mode === 'reset' && <button type="button" className="link" onClick={() => setMode('login')}>回到登入</button>}
            {mode === 'signup' && <p className="small muted" style={{ margin: 0 }}>登入後可在設定綁定 Passkey，使用 Face ID 登入。</p>}
          </form>
          <div className="divider">還不想註冊</div>
        </>
      ) : (
        <div className="notice">尚未連線伺服器，僅能使用試用模式。</div>
      )}
      <button className="btn block" onClick={onDemo}>{hasDemoData ? '繼續試用' : '先試用（附範例資料）'}</button>
      <button className="link" onClick={() => setPrivacy(true)}>隱私權政策</button>
    </div>
  );
}
