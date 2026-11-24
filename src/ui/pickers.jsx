// 選帳戶、選分類（分類是樹，可以一層一層點進去，也可以直接選上層）
import { useMemo, useState } from 'react';
import { useLedger } from '../store.jsx';
import { Icon, Sheet } from './kit.jsx';
import { accountTypeLabel, ACCOUNT_TYPES } from '../lib/ledger.js';
import { fmt } from '../lib/money.js';

export function AccountSelect({ value, onChange, includeHidden = false, filter, placeholder = '選擇帳戶', className = 'input', id, allowEmpty }) {
  const { data } = useLedger();
  const groups = ACCOUNT_TYPES.map((t) => ({
    ...t,
    items: data.accounts.filter((a) => a.type === t.value && (includeHidden || !a.hidden || a.id === value) && (!filter || filter(a))),
  })).filter((g) => g.items.length);
  return (
    <select id={id} className={className} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      {(!value || allowEmpty) && <option value="">{placeholder}</option>}
      {groups.map((g) => (
        <optgroup key={g.value} label={g.label}>
          {g.items.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}{a.currency !== 'TWD' ? `（${a.currency}）` : ''}{a.type !== 'brokerage' ? `　${fmt(data.balances.get(a.id), a.currency, { exact: true })}` : ''}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function CategoryButton({ kind, value, onChange, placeholder = '選擇分類' }) {
  const { data } = useLedger();
  const [open, setOpen] = useState(false);
  const label = value ? data.tree.path(value) : null;
  return (
    <>
      <button type="button" className="pick" onClick={() => setOpen(true)}>
        {label ? <span>{label}</span> : <span className="placeholder">{placeholder}</span>}
        <Icon name="chev" className="chev" />
      </button>
      {open && <CategoryPicker kind={kind} value={value} onClose={() => setOpen(false)} onPick={(id) => { onChange(id); setOpen(false); }} />}
    </>
  );
}

export function CategoryPicker({ kind, value, onPick, onClose }) {
  const { data } = useLedger();
  const { tree } = data;
  const start = value && tree.byId.get(value)?.kind === kind ? tree.byId.get(value).parent_id : null;
  const [parentId, setParentId] = useState(start ?? null);
  const parent = parentId ? tree.byId.get(parentId) : null;
  const nodes = (parent ? parent.children : tree.roots[kind]).filter((n) => !n.archived || n.id === value);
  const crumbs = parentId ? tree.chain(parentId) : [];

  // 最近用過的分類（從交易紀錄找最近 6 個不重複的）
  const recent = useMemo(() => {
    const seen = new Set(); const out = [];
    for (const t of data.transactions) {
      if (t.type !== kind || !t.category_id || seen.has(t.category_id)) continue;
      const n = tree.byId.get(t.category_id);
      if (!n || n.archived) continue;
      seen.add(t.category_id); out.push(n);
      if (out.length >= 6) break;
    }
    return out;
  }, [data.transactions, kind, tree]);

  return (
    <Sheet title={kind === 'expense' ? '支出分類' : '收入分類'} onClose={onClose}>
      {!parentId && recent.length > 0 && (
        <div className="chips" aria-label="最近用過">
          {recent.map((n) => (
            <button key={n.id} className="chip" aria-pressed={n.id === value} onClick={() => onPick(n.id)}>{tree.path(n.id)}</button>
          ))}
        </div>
      )}
      {parentId && (
        <div className="crumbs">
          <button onClick={() => setParentId(null)}>全部</button>
          {crumbs.map((c) => (
            <span key={c.id} className="row-flex">› <button onClick={() => setParentId(c.id)}>{c.name}</button></span>
          ))}
        </div>
      )}
      <div className="list">
        {parent && (
          <button className="item" onClick={() => onPick(parent.id)}>
            <div className="main"><div className="title">就選「{parent.name}」</div><div className="sub">不細分到下一層</div></div>
            {value === parent.id && <Icon name="check" className="chev" />}
          </button>
        )}
        {nodes.map((n) => (
          <div key={n.id} className="item" style={{ padding: 0 }}>
            <button className="item" style={{ flex: 1 }} onClick={() => onPick(n.id)}>
              <div className="main"><div className="title">{n.name}{n.archived ? '（已封存）' : ''}</div></div>
              {value === n.id && <Icon name="check" className="chev" />}
            </button>
            {n.children.some((c) => !c.archived) && (
              <button className="iconbtn" aria-label={`看「${n.name}」的子分類`} onClick={() => setParentId(n.id)} style={{ borderLeft: '1px solid var(--line)', borderRadius: 0, width: 64, height: 'auto', alignSelf: 'stretch', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                <span className="small muted" style={{ marginRight: 2 }}>{n.children.filter((c) => !c.archived).length}</span><Icon name="chev" />
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="small muted">分類可以在「更多 › 分類」新增或調整。</p>
    </Sheet>
  );
}

export const accountLabel = (a) => (a ? `${a.name}${a.currency !== 'TWD' ? `（${a.currency}）` : ''}` : '');
export { accountTypeLabel };
