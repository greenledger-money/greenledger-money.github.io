// 從 CWMoney 匯入：上傳 CSV → 設定帳戶（類型、幣別、目前餘額）→ 對應分類（含代墊類）→ 匯入
import { useMemo, useState } from 'react';
import { useLedger } from '../store.jsx';
import { Field, Page, Section, back, go, useUI } from '../ui/kit.jsx';
import { analyzeCW, buildImport, catKey, guessAdvance } from '../lib/cwimport.js';
import { ACCOUNT_TYPES, computeBalances, uid } from '../lib/ledger.js';
import { CURRENCIES, fmt, num, round2 } from '../lib/money.js';
import { friendlyError } from '../data/errors.js';

function guessType(name) {
  if (/現金|錢包/.test(name)) return 'cash';
  if (/卡$|信用卡|Cube|cube/.test(name) && !/悠遊|一卡通|icash/i.test(name)) return 'credit_card';
  if (/pay|Pay|PAY|悠遊|一卡通|icash|街口|全支付|全盈/.test(name)) return 'e_payment';
  if (/證券|股票|複委託/.test(name)) return 'brokerage';
  if (/借|欠/.test(name)) return 'loan';
  return 'bank';
}

export default function Import() {
  const { data, actions, backend } = useLedger();
  const { confirm, toast } = useUI();
  const [step, setStep] = useState(1);
  const [plan, setPlan] = useState(null);
  const [err, setErr] = useState('');
  const [acc, setAcc] = useState({});     // CW 帳戶名 → { target: 'new'|帳戶id, type, currency, current, fallback }
  const [cat, setCat] = useState({});     // 分類 key → 'normal' | 'lend' | 'repay'
  const [rename, setRename] = useState({}); // `${kind}|${主分類}` → 新名稱
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const prevImported = data.transactions.filter((t) => t.source === 'cw_import').length;

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr('');
    try {
      const text = await file.text();
      const p = analyzeCW(text);
      setPlan(p);
      const a = {};
      for (const x of p.accounts) {
        const same = data.accounts.find((y) => y.name === x.name);
        a[x.name] = { target: same ? same.id : 'new', type: same?.type ?? guessType(x.name), currency: same?.currency ?? 'TWD', current: '', fallback: '' };
      }
      setAcc(a);
      const c = {};
      for (const x of p.categories) c[x.key] = guessAdvance(x) ?? 'normal';
      setCat(c);
      const r = {};
      for (const x of p.categories) r[`${x.kind}|${x.main}`] = x.main.replace(/（公$/, '/訂閱').slice(0, 30);
      setRename(r);
      setStep(2);
    } catch (ex) { setErr(friendlyError(ex)); }
  }

  const mains = useMemo(() => {
    if (!plan) return [];
    const m = new Map();
    for (const c of plan.categories) {
      if (cat[c.key] !== 'normal') continue;
      const k = `${c.kind}|${c.main}`;
      const e = m.get(k) ?? { key: k, kind: c.kind, main: c.main, count: 0, subs: [] };
      e.count += c.count; if (c.sub) e.subs.push(c.sub);
      m.set(k, e);
    }
    return [...m.values()];
  }, [plan, cat]);

  // 外幣帳戶需要匯率：看看有沒有日期找不到匯率
  const needRate = useMemo(() => {
    if (!plan) return {};
    const out = {};
    for (const [name, a] of Object.entries(acc)) {
      const currency = a.target === 'new' ? a.currency : data.accById.get(a.target)?.currency;
      if (!currency || currency === 'TWD') continue;
      const missing = plan.items.some((it) => (it.account === name || it.from === name || it.to === name) && data.fx.rateOn(currency, it.date) == null);
      if (missing) out[name] = currency;
    }
    return out;
  }, [plan, acc, data.fx, data.accById]);

  function checkAccounts() {
    for (const [name, a] of Object.entries(acc)) {
      if (a.current === '' || Number.isNaN(Number(String(a.current).replace(/,/g, '')))) return `請填「${name}」在 CW 的目前餘額`;
      if (needRate[name] && !(Number(a.fallback) > 0)) return `「${name}」有些日期找不到 ${needRate[name]} 匯率，請填一個備用匯率`;
    }
    const newNames = Object.entries(acc).filter(([, a]) => a.target === 'new').map(([n]) => n);
    const dup = newNames.find((n) => data.accounts.some((x) => x.name === n));
    if (dup) return `已經有叫「${dup}」的帳戶，請改成「對應到現有帳戶」`;
    return null;
  }

  async function runImport() {
    setErr('');
    if (!data.friendsOwe || !data.feeCat) { setErr('找不到系統帳戶或分類，請重新整理'); return; }
    const ok = await confirm(`要匯入 ${plan.items.length} 筆（轉帳 ${plan.stats.transfers} 組）。舊帳時間統一設成 00:00，地址不匯入。開始？`, { ok: '開始匯入' });
    if (!ok) return;
    try {
      setProgress({ label: '建立帳戶', done: 0, total: 1 });
      // 1. 帳戶
      const newAccs = Object.entries(acc).filter(([, a]) => a.target === 'new')
        .map(([name, a], i) => ({ id: uid(), name: name.slice(0, 40), type: a.type, currency: a.currency, opening_balance: 0, hidden: false, sort_order: data.accounts.length + i }));
      const created = newAccs.length ? await actions.insertRows('accounts', newAccs) : [];
      const byName = {};
      for (const [name, a] of Object.entries(acc)) {
        byName[name] = a.target === 'new' ? created.find((c) => c.name === name.slice(0, 40)) : data.accById.get(a.target);
      }

      // 2. 分類（主分類可改名；有同名的就合併）
      setProgress({ label: '建立分類', done: 0, total: 1 });
      const cats = [...data.categories];
      const newCats = [];
      const findOrMake = (kind, parentId, name) => {
        const nm = (name || '未分類').slice(0, 30);
        const hit = cats.find((c) => c.kind === kind && (c.parent_id ?? null) === (parentId ?? null) && c.name === nm);
        if (hit) return hit.id;
        const row = { id: uid(), kind, parent_id: parentId ?? null, name: nm, archived: false, sort_order: 60 };
        cats.push(row); newCats.push(row);
        return row.id;
      };
      const catId = {};
      for (const c of plan.categories) {
        if (cat[c.key] !== 'normal') continue;
        const top = findOrMake(c.kind, null, rename[`${c.kind}|${c.main}`] || c.main);
        catId[c.key] = c.sub ? findOrMake(c.kind, top, c.sub) : top;
      }
      if (newCats.length) await actions.insertRows('categories', newCats);

      // 3. 交易
      const { txns, problems } = buildImport({
        items: plan.items, accountOf: (n) => byName[n], categoryOf: (k) => catId[k],
        advanceOf: (k) => (cat[k] === 'normal' ? null : cat[k]), friendsOwe: data.friendsOwe, feeCategoryId: data.feeCat.id,
        rateFor: (a, d) => data.fx.rateOn(a.currency, d) ?? (Number(Object.entries(acc).find(([n]) => byName[n]?.id === a.id)?.[1].fallback) || null),
      });
      setProgress({ label: '寫入交易', done: 0, total: txns.length });
      await actions.bulkInsert('transactions', txns, (done, total) => setProgress({ label: '寫入交易', done, total }));

      // 4. 期初餘額＝CW 目前餘額 − 流水加總（含這個帳戶原本就有的交易）
      setProgress({ label: '計算期初餘額', done: 0, total: 1 });
      const allTx = [...data.transactions, ...txns];
      const flows = computeBalances(Object.values(byName).map((a) => ({ id: a.id, opening_balance: 0 })), allTx, null);
      for (const [name, a] of Object.entries(acc)) {
        const target = byName[name];
        const opening = round2(num(a.current) - (flows.get(target.id) ?? 0));
        await actions.updateRow('accounts', target.id, { opening_balance: opening });
      }
      setProgress(null);
      setResult({ count: txns.length, problems, accounts: created.length, categories: newCats.length });
      setStep(5);
      toast('匯入完成');
    } catch (ex) {
      setProgress(null);
      setErr(`匯入中斷：${friendlyError(ex)}。可以用「刪除之前匯入的資料」清掉後重來。`);
    }
  }

  async function removePrevious() {
    if (!(await confirm(`刪除之前從 CW 匯入的 ${prevImported} 筆交易？帳戶和分類會保留。`, { ok: '刪除', danger: true }))) return;
    try { await backend.removeImported(); await actions.reload(); toast('已刪除'); } catch (ex) { toast(friendlyError(ex)); }
  }

  return (
    <Page title="從 CWMoney 匯入" onBack={() => back('more')}>
      {step === 1 && (
        <>
          <div className="card prose">
            <p style={{ marginTop: 0 }}>在 CWMoney 匯出 CSV（UTF-8），選擇檔案就會開始分析，還不會寫入任何資料。</p>
            <ul>
              <li>三行一組的轉帳會還原成一筆轉帳；手續費大於 0 另記一筆「其他支出-手續費」</li>
              <li>你填各帳戶在 CW 的<b>目前餘額</b>，程式反推期初餘額</li>
              <li>代墊類分類（例如「借錢」）可以改記成「朋友欠我」轉帳</li>
              <li>CW 只有日期：時間統一設成 00:00；地址、發票、專案不匯入</li>
            </ul>
          </div>
          <Field label="選擇 CW 匯出的 CSV"><input className="input" type="file" accept=".csv,text/csv" onChange={onFile} /></Field>
          {prevImported > 0 && (
            <div className="notice warn row-flex wrap">
              <span className="grow">之前已經匯入過 {prevImported} 筆。重新匯入前建議先刪掉，以免重複。</span>
              <button className="btn small danger" onClick={removePrevious}>刪除之前匯入的資料</button>
            </div>
          )}
        </>
      )}

      {plan && step >= 2 && step < 5 && (
        <div className="card">
          <div className="stats">
            <div><span className="small muted">筆數</span><b className="num">{plan.stats.rows}</b></div>
            <div><span className="small muted">轉帳</span><b className="num">{plan.stats.transfers} 組</b></div>
            <div><span className="small muted">期間</span><b className="small">{plan.stats.from} ～ {plan.stats.to}</b></div>
          </div>
          {plan.warnings.length > 0 && (
            <details style={{ marginTop: 8 }}><summary className="small" style={{ color: 'var(--warn)' }}>有 {plan.warnings.length} 個提醒</summary>
              <ul className="small">{plan.warnings.slice(0, 50).map((w) => <li key={w}>{w}</li>)}</ul></details>
          )}
        </div>
      )}

      {step === 2 && (
        <Section title={`步驟 1／3：帳戶（${plan.accounts.length} 個）`}>
          <p className="small muted" style={{ margin: '0 4px 8px' }}>填 CW 裡每個帳戶「現在」的餘額。標成外幣的帳戶，舊紀錄（CW 當台幣記的）會用當天匯率換回外幣。</p>
          <div className="list">
            {plan.accounts.map((x) => {
              const a = acc[x.name];
              const upd = (patch) => setAcc((s) => ({ ...s, [x.name]: { ...s[x.name], ...patch } }));
              const existing = a.target !== 'new' ? data.accById.get(a.target) : null;
              const cur = existing?.currency ?? a.currency;
              return (
                <div key={x.name} className="item" style={{ display: 'grid', gap: 8 }}>
                  <div className="row-flex"><b className="grow">{x.name}</b><span className="small muted">{x.count} 筆</span></div>
                  <select className="input" value={a.target} onChange={(e) => upd({ target: e.target.value })} aria-label="對應">
                    <option value="new">新建帳戶</option>
                    {data.accounts.filter((y) => y.type !== 'friends_owe').map((y) => <option key={y.id} value={y.id}>對應到現有：{y.name}</option>)}
                  </select>
                  {a.target === 'new' && (
                    <div className="grid2">
                      <select className="input" value={a.type} onChange={(e) => upd({ type: e.target.value })} aria-label="類型">
                        {ACCOUNT_TYPES.filter((t) => t.value !== 'friends_owe').map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      <select className="input" value={a.currency} onChange={(e) => upd({ currency: e.target.value })} aria-label="幣別">
                        {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                  )}
                  <input className="input num" inputMode="decimal" placeholder={`CW 目前餘額（${cur}）`} value={a.current} onChange={(e) => upd({ current: e.target.value })} aria-label="目前餘額" />
                  {needRate[x.name] && (
                    <input className="input num" inputMode="decimal" placeholder={`找不到當天匯率時用的 ${needRate[x.name]} 匯率`} value={a.fallback} onChange={(e) => upd({ fallback: e.target.value })} aria-label="備用匯率" />
                  )}
                </div>
              );
            })}
          </div>
          {err && <div className="error">{err}</div>}
          <div className="grid2" style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => { setStep(1); setPlan(null); }}>重選檔案</button>
            <button className="btn primary" onClick={() => { const e = checkAccounts(); setErr(e ?? ''); if (!e) setStep(3); }}>下一步</button>
          </div>
        </Section>
      )}

      {step === 3 && (
        <>
          <Section title="步驟 2／3：代墊類分類">
            <p className="small muted" style={{ margin: '0 4px 8px' }}>先幫朋友付、之後朋友還錢的分類，改記成「朋友欠我」轉帳，月支出和餘額才會正確。</p>
            <div className="list">
              {plan.categories.map((c) => (
                <div key={c.key} className="item">
                  <div className="main">
                    <div className="title">{c.kind === 'expense' ? '支出' : '收入'}：{c.main}{c.sub ? `-${c.sub}` : ''}</div>
                    <div className="sub">{c.count} 筆 · {fmt(c.total)}</div>
                  </div>
                  <select className="input" style={{ width: 150 }} value={cat[c.key]} onChange={(e) => setCat((s) => ({ ...s, [c.key]: e.target.value }))} aria-label="怎麼記">
                    <option value="normal">一般{c.kind === 'expense' ? '支出' : '收入'}</option>
                    {c.kind === 'expense' ? <option value="lend">→ 轉進朋友欠我</option> : <option value="repay">朋友欠我 → 還錢</option>}
                  </select>
                </div>
              ))}
            </div>
          </Section>
          <Section title="步驟 3／3：主分類名稱">
            <p className="small muted" style={{ margin: '0 4px 8px' }}>可以順便改名（例如「繳費（公」改成「繳費/訂閱」）。名稱跟現有分類一樣的會合併。</p>
            <div className="list">
              {mains.map((m) => (
                <div key={m.key} className="item">
                  <div className="main"><div className="title">{m.kind === 'expense' ? '支出' : '收入'}：{m.main}</div><div className="sub">{m.subs.length ? m.subs.join('、') : '沒有子分類'}</div></div>
                  <input className="input" style={{ width: 150 }} value={rename[m.key] ?? m.main} onChange={(e) => setRename((s) => ({ ...s, [m.key]: e.target.value }))} aria-label={`${m.main} 新名稱`} />
                </div>
              ))}
            </div>
          </Section>
          {err && <div className="error">{err}</div>}
          {progress && (
            <div className="card" style={{ display: 'grid', gap: 8 }}>
              <span className="small">{progress.label}… {progress.total > 1 ? `${progress.done}/${progress.total}` : ''}</span>
              <div className="progress"><i style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
            </div>
          )}
          <div className="grid2">
            <button className="btn" onClick={() => setStep(2)} disabled={!!progress}>上一步</button>
            <button className="btn primary" onClick={runImport} disabled={!!progress}>開始匯入</button>
          </div>
        </>
      )}

      {step === 5 && result && (
        <div className="card prose">
          <h3 style={{ marginTop: 0 }}>匯入完成</h3>
          <p>寫入 {result.count} 筆交易，新增 {result.accounts} 個帳戶、{result.categories} 個分類，期初餘額已經依目前餘額反推。</p>
          {result.problems.length > 0 && (
            <details><summary style={{ color: 'var(--warn)' }}>{result.problems.length} 筆沒有匯入</summary><ul className="small">{result.problems.map((p) => <li key={p}>{p}</li>)}</ul></details>
          )}
          <p>CW 只有股票損益、沒有買賣明細，請到股票頁用「期初持股」輸入目前的股數和均價。</p>
          <div className="grid2">
            <button className="btn" onClick={() => go('accounts')}>看帳戶</button>
            <button className="btn primary" onClick={() => go('stocks')}>輸入期初持股</button>
          </div>
        </div>
      )}
    </Page>
  );
}
