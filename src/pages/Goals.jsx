// 存錢目標：例如「日本旅費 6 萬，明年 3 月前」→ 進度、每月要存多少
import { useState } from 'react';
import { useLedger } from '../store.jsx';
import { Empty, Field, Icon, Page, Seg, Sheet, Tile, back, useAction, useUI } from '../ui/kit.jsx';
import { goalProgress } from '../lib/goals.js';
import { thisMonth } from '../lib/dates.js';
import { fmt } from '../lib/money.js';
import { uid } from '../lib/ledger.js';

export function useGoals() {
  const { data } = useLedger();
  const twdOf = (id) => {
    const a = data.accById.get(id);
    if (!a) return 0;
    if (a.type === 'brokerage') return data.stockValue.get(id)?.twd ?? 0;
    const rate = a.currency === 'TWD' ? 1 : data.fx.latest(a.currency) ?? 0;
    return (data.balances.get(id) ?? 0) * rate;
  };
  const now = thisMonth();
  return (data.settings.goals ?? []).map((g) => ({ goal: g, p: goalProgress(g, twdOf, now) }));
}

export function GoalCard({ goal, p, onClick, compact = false }) {
  const pct = Math.round(p.ratio * 100);
  return (
    <button type="button" className="card goal" onClick={onClick}>
      <div className="row-flex" style={{ gap: 10 }}>
        <Tile name={goal.icon || 'star'} size={compact ? 32 : 38} />
        <span className="grow" style={{ textAlign: 'left' }}>
          <b>{goal.name}</b>
          <span className="small muted" style={{ display: 'block' }}>
            {p.done ? '達成了！' : p.late ? '已經過了期限' : goal.deadline ? `${goal.deadline.replace('-', ' 年 ')} 月前` : '沒有期限'}
          </span>
        </span>
        <span className="num small" style={{ textAlign: 'right' }}><b>{fmt(p.current)}</b><span className="muted"> / {fmt(p.target)}</span></span>
      </div>
      <div className={`bar ${p.done ? 'done' : ''}`} role="progressbar" aria-label={`${goal.name}進度 ${pct}%`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${pct}%` }} />
      </div>
      {!compact && (
        <div className="small row-flex">
          <span className="grow muted">{pct}%{p.done ? '' : ` · 還差 ${fmt(p.left)}`}</span>
          {p.perMonth != null && <span className="muted">每月要存 <b className="num" style={{ color: 'var(--ink)' }}>{fmt(p.perMonth)}</b></span>}
        </div>
      )}
    </button>
  );
}

function GoalSheet({ original, onClose }) {
  const { data, actions } = useLedger();
  const { confirm } = useUI();
  const [run, busy] = useAction();
  const [f, setF] = useState(() => original ? { ...original, target: String(original.target), saved: String(original.saved ?? '') }
    : { id: uid(), name: '', target: '', deadline: '', accountIds: [], saved: '', icon: 'star' });
  const [mode, setMode] = useState(original?.accountIds?.length ? 'account' : 'manual');
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const toggleAcc = (id) => setF((x) => ({ ...x, accountIds: x.accountIds.includes(id) ? x.accountIds.filter((y) => y !== id) : [...x.accountIds, id] }));
  const list = data.settings.goals ?? [];

  async function save() {
    const target = Math.round(Number(String(f.target).replace(/[,\s$]/g, '')));
    if (!f.name.trim()) return setErr('請輸入名稱');
    if (!(target > 0)) return setErr('請輸入目標金額');
    if (mode === 'account' && !f.accountIds.length) return setErr('請選至少一個帳戶');
    const row = {
      id: f.id, name: f.name.trim().slice(0, 30), target, deadline: f.deadline || null, icon: f.icon,
      accountIds: mode === 'account' ? f.accountIds : [], saved: mode === 'manual' ? Math.max(0, Number(String(f.saved).replace(/[,\s$]/g, '')) || 0) : 0,
    };
    const next = original ? list.map((g) => (g.id === row.id ? row : g)) : [...list, row];
    if (await run(() => actions.updateSettings({ goals: next }), '已儲存')) onClose();
  }
  async function remove() {
    if (!(await confirm(`刪除目標「${original.name}」？`, { ok: '刪除', danger: true }))) return;
    if (await run(() => actions.updateSettings({ goals: list.filter((g) => g.id !== original.id) }), '已刪除')) onClose();
  }
  const ICONS = ['star', 'plane', 'gift', 'phone', 'car', 'bank', 'heart', 'shirt'];
  return (
    <Sheet title={original ? '修改目標' : '新增目標'} onClose={onClose} onSave={save} saving={busy}>
      <div className="form">
        <Field label="名稱"><input className="input" value={f.name} maxLength={30} placeholder="例如：日本旅費" onChange={set('name')} /></Field>
        <div className="iconpick" role="radiogroup" aria-label="圖示">
          {ICONS.map((n) => <button key={n} type="button" className="ip" role="radio" aria-checked={f.icon === n} onClick={() => setF((x) => ({ ...x, icon: n }))}><Tile name={n} size={36} /></button>)}
        </div>
        <div className="grid2">
          <Field label="目標金額"><input className="input num" inputMode="numeric" value={f.target} placeholder="60000" onChange={set('target')} /></Field>
          <Field label="期限（可不填）"><input className="input" type="month" value={f.deadline ?? ''} onChange={set('deadline')} /></Field>
        </div>
        <Seg value={mode} onChange={setMode} options={[{ value: 'account', label: '看帳戶餘額' }, { value: 'manual', label: '自己記已存多少' }]} />
        {mode === 'account' ? (
          <div className="list">
            {data.accounts.filter((a) => !a.hidden && a.type !== 'credit_card' && a.type !== 'friends_owe' && a.type !== 'loan').map((a) => (
              <label key={a.id} className="item" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={f.accountIds.includes(a.id)} onChange={() => toggleAcc(a.id)} />
                <span className="main"><span className="title">{a.name}</span></span>
              </label>
            ))}
          </div>
        ) : (
          <Field label="目前已存" hint="之後在目標頁按「存一筆」累加"><input className="input num" inputMode="numeric" value={f.saved} placeholder="0" onChange={set('saved')} /></Field>
        )}
        {err && <div className="error">{err}</div>}
        {original && <button className="btn danger block" onClick={remove} disabled={busy}>刪除目標</button>}
      </div>
    </Sheet>
  );
}

export default function Goals() {
  const { data, actions } = useLedger();
  const { prompt } = useUI();
  const [run] = useAction();
  const goals = useGoals();
  const [edit, setEdit] = useState(null);

  async function addSaved(goal) {
    const v = await prompt(`「${goal.name}」存入多少？`, { placeholder: '金額', inputMode: 'numeric' });
    const n = Math.round(Number(String(v ?? '').replace(/[,\s$]/g, '')));
    if (!n) return;
    const next = (data.settings.goals ?? []).map((g) => (g.id === goal.id ? { ...g, saved: Math.max(0, (Number(g.saved) || 0) + n) } : g));
    run(() => actions.updateSettings({ goals: next }), n > 0 ? `已存入 ${fmt(n)}` : `已扣掉 ${fmt(-n)}`);
  }

  return (
    <Page title="存錢目標" onBack={() => back('more')} right={<button className="iconbtn" aria-label="新增目標" onClick={() => setEdit({})}><Icon name="plus" /></button>}>
      {goals.length === 0 && <Empty>還沒有目標。按右上角 ＋ 新增，例如「日本旅費 60,000，明年 3 月前」。</Empty>}
      {goals.map(({ goal, p }) => (
        <div key={goal.id} className="goal-wrap">
          <GoalCard goal={goal} p={p} onClick={() => setEdit({ original: goal })} />
          {!p.linked && !p.done && <button className="btn small" onClick={() => addSaved(goal)}>存一筆</button>}
        </div>
      ))}
      {edit && <GoalSheet original={edit.original} onClose={() => setEdit(null)} />}
    </Page>
  );
}
