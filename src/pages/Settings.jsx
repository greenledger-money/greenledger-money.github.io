// 匯出 CSV、設定（Passkey、預設值、刪除帳號）、隱私權政策
import { useEffect, useState } from 'react';
import { useLedger } from '../store.jsx';
import { Field, Group, Icon, Item, Page, Section, Seg, Toggle, back, downloadText, useAction, useUI } from '../ui/kit.jsx';
import { AccountSelect, CategoryButton } from '../ui/pickers.jsx';
import { toCSV, transactionsToRows } from '../lib/csv.js';
import { monthRange, thisMonth, todayStr, ymd } from '../lib/dates.js';
import { friendlyError } from '../data/errors.js';
import { APP } from '../config.js';

// ---------------------------------------------------------------------
export function Export() {
  const { data } = useLedger();
  const { toast } = useUI();
  const { from } = monthRange(thisMonth());
  const [f, setF] = useState({ from: ymd(from), to: todayStr(), accountId: null, kind: 'expense', categoryId: null });
  const [text, setText] = useState(null);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));

  function pick() {
    const lo = new Date(`${f.from}T00:00:00`).getTime(); const hi = new Date(`${f.to}T23:59:59.999`).getTime();
    const cats = f.categoryId ? data.tree.descendants(f.categoryId) : null;
    return data.transactions.filter((t) => {
      const ms = Date.parse(t.occurred_at);
      if (ms < lo || ms > hi) return false;
      if (f.accountId && t.account_id !== f.accountId && t.to_account_id !== f.accountId) return false;
      if (cats && !cats.has(t.category_id)) return false;
      return true;
    });
  }
  function out(list, name) {
    const csv = toCSV(transactionsToRows(list, { accById: data.accById, tree: data.tree }));
    setText(csv);
    if (APP.demoOnly) { toast('試用頁不能下載檔案，請用下面的「複製」'); return; }
    try { downloadText(name, csv); toast(`已匯出 ${list.length} 筆`); } catch { toast('這裡不能下載，請用下面的「複製」'); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(text.replace(/^﻿/, '')); toast('已複製'); } catch { toast('複製失敗，請手動選取'); }
  }
  return (
    <Page title="匯出 CSV" onBack={() => back('more')}>
      <Section title="選範圍匯出">
        <div className="card form">
          <div className="grid2">
            <Field label="從"><input className="input" type="date" value={f.from} onChange={set('from')} /></Field>
            <Field label="到"><input className="input" type="date" value={f.to} onChange={set('to')} /></Field>
          </div>
          <Field label="帳戶"><AccountSelect value={f.accountId} onChange={set('accountId')} includeHidden allowEmpty placeholder="所有帳戶" /></Field>
          <Field label="分類（含子分類）">
            <div className="row-flex">
              <select className="input" style={{ width: 90 }} value={f.kind} onChange={(e) => setF((x) => ({ ...x, kind: e.target.value, categoryId: null }))}><option value="expense">支出</option><option value="income">收入</option></select>
              <div className="input grow frow" style={{ padding: '0 10px', minHeight: 44 }}><div className="ctrl"><CategoryButton kind={f.kind} value={f.categoryId} onChange={set('categoryId')} placeholder="所有分類" /></div></div>
              {f.categoryId && <button className="link" onClick={() => set('categoryId')(null)}>清除</button>}
            </div>
          </Field>
          <button className="btn primary" onClick={() => { const l = pick(); out(l, `記帳_${f.from}_${f.to}.csv`); }}>匯出 {pick().length} 筆</button>
        </div>
      </Section>
      <Section title="備份">
        <div className="card form">
          <p className="small muted" style={{ margin: 0 }}>一鍵匯出全部交易（含隱藏帳戶）。Excel 可以直接打開。</p>
          <button className="btn" onClick={() => out(data.transactions, `記帳_全部_${todayStr()}.csv`)}><Icon name="download" className="chev" />匯出全部（{data.transactions.length} 筆）</button>
        </div>
      </Section>
      {text && (
        <Section title="內容">
          <div className="card form">
            <button className="btn" onClick={copy}>複製 CSV 內容</button>
            <textarea className="input num" readOnly value={text.slice(0, 20000)} rows={6} />
          </div>
        </Section>
      )}
    </Page>
  );
}

// ---------------------------------------------------------------------
function Switch({ label, hint, checked, onChange }) {
  return (
    <label className="row-flex">
      <span className="grow">{label}{hint && <div className="small muted">{hint}</div>}</span>
      <Toggle label={label} checked={checked} onChange={onChange} />
    </label>
  );
}

/** 數字設定：離開輸入框時檢查範圍再存 */
function NumSetting({ label, hint, value, min, max, step, onSave }) {
  const [v, setV] = useState(String(value));
  const [bad, setBad] = useState(false);
  useEffect(() => { setV(String(value)); }, [value]);
  const commit = () => {
    const n = Number(v);
    const ok = v !== '' && Number.isFinite(n) && n >= min && n <= max && (!step || Number.isInteger(n));
    setBad(!ok);
    if (ok && n !== Number(value)) onSave(n);
  };
  return (
    <Field label={label} hint={hint}>
      <input className="input num" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} aria-invalid={bad} style={bad ? { borderColor: 'var(--expense)' } : undefined} />
    </Field>
  );
}

function Passkeys() {
  const { backend } = useLedger();
  const { confirm } = useUI();
  const [run, busy] = useAction();
  const [list, setList] = useState(null);
  const load = () => backend.passkey.list().then(setList).catch(() => setList([]));
  useEffect(() => { if (backend.passkey.supported) load(); }, []);
  if (!backend.passkey.supported) {
    return <p className="small muted" style={{ margin: 0 }}>這個瀏覽器不支援 Passkey，或 Supabase 專案還沒打開 Passkey。</p>;
  }
  return (
    <>
      <div className="list">
        {(list ?? []).map((p) => (
          <Item key={p.id} title={p.friendly_name || 'Passkey'} sub={`建立於 ${String(p.created_at).slice(0, 10)}${p.last_used_at ? ` · 上次使用 ${String(p.last_used_at).slice(0, 10)}` : ''}`}>
            <button className="link" style={{ color: 'var(--expense)' }} onClick={async () => {
              if (await confirm('移除這個 Passkey？之後這台裝置要用 Email 登入。', { ok: '移除', danger: true })) run(async () => { await backend.passkey.remove(p.id); await load(); }, '已移除');
            }}>移除</button>
          </Item>
        ))}
        {list?.length === 0 && <div className="empty">還沒有綁定 Passkey</div>}
      </div>
      <button className="btn" disabled={busy} onClick={() => run(async () => { await backend.passkey.register(); await load(); }, '已綁定 Passkey，下次可以用 Face ID 登入')}>
        <Icon name="key" className="chev" />綁定 Passkey（Face ID）
      </button>
    </>
  );
}

export function Settings() {
  const { data, actions, user, backend } = useLedger();
  const { confirm, toast } = useUI();
  const [run, busy] = useAction();
  const [del, setDel] = useState('');
  const s = data.settings;
  const upd = (patch) => run(() => actions.updateSettings(patch));

  async function deleteAccount() {
    if (del !== '刪除') { toast('請輸入「刪除」兩個字確認'); return; }
    if (!(await confirm(user.demo ? '清空這台裝置上的試用資料？' : '永久刪除帳號和所有資料？這個動作不能復原。', { ok: '永久刪除', danger: true }))) return;
    try { await backend.deleteAccount(); } catch (e) { toast(friendlyError(e)); }
  }
  return (
    <Page title="設定" onBack={() => back('more')}>
      <Section title="帳號">
        <div className="list">
          <Item left={<Icon name="user" className="chev" />} title={user.demo ? '試用模式' : user.email} sub={user.demo ? '資料只存在這台裝置的瀏覽器' : '用 Email 登入'} />
        </div>
      </Section>
      {!user.demo && (
        <Section title="Passkey（Face ID 登入）">
          <div style={{ display: 'grid', gap: 10 }}><Passkeys /></div>
        </Section>
      )}
      <Section title="外觀">
        <div className="card form">
          <Seg label="外觀" value={s.theme} onChange={(v) => upd({ theme: v })} options={[{ value: 'system', label: '跟著手機' }, { value: 'light', label: '淺色' }, { value: 'dark', label: '深色' }]} />
        </div>
      </Section>
      <Section title="記帳">
        <div className="card form">
          <Field label="預設帳戶">
            <AccountSelect value={s.defaultAccountId} onChange={(v) => upd({ defaultAccountId: v })} allowEmpty placeholder="上次用的帳戶" />
          </Field>
          <Group label="預設分類">
            <Seg label="預設分類" value={s.categoryDefault} onChange={(v) => upd({ categoryDefault: v })} options={[{ value: 'last', label: '帶上次選的' }, { value: 'none', label: '每次自己選' }]} />
          </Group>
          <Switch label="打開記帳就跳出計算機" checked={s.keypadOnOpen} onChange={(v) => upd({ keypadOnOpen: v })} />
        </div>
      </Section>
      <Section title="首頁">
        <div className="card form">
          <Switch label="顯示淨資產" checked={s.homeShowWorth} onChange={(v) => upd({ homeShowWorth: v })} />
          <Switch label="顯示範本按鈕" checked={s.homeShowTemplates} onChange={(v) => upd({ homeShowTemplates: v })} />
          <Group label="最近明細顯示幾筆">
            <Seg label="最近明細筆數" value={String(s.homeRecentCount)} onChange={(v) => upd({ homeRecentCount: Number(v) })} options={['0', '5', '8', '15'].map((v) => ({ value: v, label: v === '0' ? '不顯示' : `${v} 筆` }))} />
          </Group>
        </div>
      </Section>
      <Section title="報表">
        <div className="card form">
          <Group label="預設看">
            <Seg label="報表預設" value={s.reportPeriod} onChange={(v) => upd({ reportPeriod: v })} options={[{ value: 'month', label: '月' }, { value: 'year', label: '年' }]} />
          </Group>
          <Switch label="預設含例外" hint="首頁本月支出也會照這個設定" checked={s.includeExceptions} onChange={(v) => upd({ includeExceptions: v })} />
        </div>
      </Section>
      <Section title="股票">
        <div className="card form">
          <Switch label="漲紅跌綠" hint="關掉改成漲綠跌紅" checked={s.twColors} onChange={(v) => upd({ twColors: v })} />
          <Field label="台股預設交割戶"><AccountSelect value={s.settlementTW} onChange={(v) => upd({ settlementTW: v })} filter={(a) => a.type === 'bank'} allowEmpty placeholder="上次用的" /></Field>
          <Field label="美股預設交割戶"><AccountSelect value={s.settlementUS} onChange={(v) => upd({ settlementUS: v })} filter={(a) => a.type === 'bank'} allowEmpty placeholder="上次用的" /></Field>
          <div className="grid2">
            <NumSetting label="手續費折扣" hint="0.6＝六折" value={s.feeDiscount} min={0.01} max={1} onSave={(v) => upd({ feeDiscount: v })} />
            <NumSetting label="美股預扣稅率" hint="0.3＝30%" value={s.usWithholding} min={0} max={1} onSave={(v) => upd({ usWithholding: v })} />
          </div>
          <div className="grid2">
            <NumSetting label="整股最低手續費" value={s.minFeeLot} min={0} max={1000} onSave={(v) => upd({ minFeeLot: v })} />
            <NumSetting label="零股最低手續費" value={s.minFeeOdd} min={0} max={1000} onSave={(v) => upd({ minFeeOdd: v })} />
          </div>
          <div className="grid2">
            <NumSetting label="台股交割 T+" hint="工作天" value={s.twSettleDays} min={0} max={10} step={1} onSave={(v) => upd({ twSettleDays: v })} />
            <NumSetting label="美股交割 T+" hint="工作天" value={s.usSettleDays} min={0} max={10} step={1} onSave={(v) => upd({ usSettleDays: v })} />
          </div>
          <p className="small muted" style={{ margin: 0 }}>這些只影響輸入成交時自動帶入的預設值，每筆都還可以手動改。</p>
        </div>
      </Section>
      <Section title="其他">
        <div className="list">
          <Item href="#privacy" left={<Icon name="shield" className="chev" />} title="隱私權政策" />
          <Item onClick={() => backend.signOut()} title={user.demo ? '離開試用（資料保留在這台裝置）' : '登出'} />
        </div>
      </Section>
      <Section title={user.demo ? '清空試用資料' : '刪除帳號'}>
        <div className="card form">
          <p className="small" style={{ margin: 0 }}>{user.demo ? '刪除這台裝置上所有試用資料。' : '永久刪除帳號，連同所有帳戶、交易、股票紀錄一起刪除，不能復原。建議先到「匯出 CSV」備份。'}</p>
          <input className="input" placeholder="輸入「刪除」確認" value={del} onChange={(e) => setDel(e.target.value)} />
          <button className="btn danger" disabled={busy} onClick={deleteAccount}>{user.demo ? '清空試用資料' : '永久刪除帳號'}</button>
        </div>
      </Section>
      <p className="small muted center">{APP.name} · 版本 {APP.version}</p>
    </Page>
  );
}

// ---------------------------------------------------------------------
export function Privacy({ standalone, onClose }) {
  const body = (
    <div className="card prose">
      <p style={{ marginTop: 0 }}>最後更新：2026 年 11 月 24 日</p>
      <h3>我們收集什麼</h3>
      <ul>
        <li>註冊用的 Email，以及你綁定的 Passkey 公鑰（不含生物特徵，Face ID 資料不會離開你的裝置）。</li>
        <li>你輸入的記帳資料：帳戶、分類、交易、範本、固定收支、股票成交與股利。</li>
        <li>若你授權讀取 Gmail：只讀取國泰證券對帳單，用來匯入股票成交，不讀其他信件。</li>
      </ul>
      <h3>怎麼保存</h3>
      <ul>
        <li>資料存在 Supabase（Postgres）資料庫。每個人只讀寫得到自己的資料，這由資料庫的 Row Level Security 保證，不靠前端程式。</li>
        <li>網頁只放公開的 publishable key；能略過權限的 secret key 只放在後端（GitHub Actions Secrets）。</li>
        <li>試用模式的資料只存在你這台裝置的瀏覽器，不會上傳。</li>
      </ul>
      <h3>怎麼使用</h3>
      <ul>
        <li>只用來提供記帳功能。不賣資料、不放廣告、不做追蹤分析。</li>
        <li>匯率、股價是公開資料，由後端每天更新。</li>
      </ul>
      <h3>刪除</h3>
      <ul>
        <li>在「設定 › 刪除帳號」可以永久刪除帳號，所有資料會一起刪除。</li>
        <li>刪除前可以在「匯出 CSV」下載備份。</li>
      </ul>
      <h3>聯絡</h3>
      <p>這是個人開發、免費提供給朋友測試的 app。有問題請直接聯絡開發者。</p>
    </div>
  );
  if (standalone) return <Page title="隱私權政策" onBack={onClose}>{body}</Page>;
  return <Page title="隱私權政策" onBack={() => back('settings')}>{body}</Page>;
}

