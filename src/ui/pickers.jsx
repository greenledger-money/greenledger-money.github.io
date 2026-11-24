// 選帳戶、選分類（分類是樹，可以一層一層點進去，也可以直接選上層）
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLedger } from '../store.jsx';
import { Icon, Sheet, Tile, categoryIcon, useAction } from './kit.jsx';
import { parentOptions, validateCategory } from '../lib/categories.js';
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
  const cur = value && tree.byId.get(value)?.kind === kind ? tree.chain(value) : [];
  const inCur = (n) => cur.some((c) => c.id === n.id);
  const live = (n) => !n.archived || inCur(n);
  const roots = tree.roots[kind].filter(live);
  const [mainId, setMainId] = useState(cur[0]?.id ?? roots[0]?.id ?? null);
  const main = mainId ? tree.byId.get(mainId) : null;
  const subs = main ? main.children.filter(live) : [];
  const box = useRef(null);

  // 打開時把目前選的捲到看得到的地方
  useEffect(() => { box.current?.querySelectorAll('.cp.on, .cp.sel').forEach((el) => el.scrollIntoView({ block: 'nearest' })); }, []);

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

  // 點主分類：有子分類 → 右邊列出來；沒有 → 直接選
  const tapMain = (n) => (n.children.some(live) ? setMainId(n.id) : onPick(n.id));
  const tone = kind === 'income' ? 'income' : '';
  const check = (id) => value === id && <Icon name="check" className="chev" />;

  return (
    <Sheet title={kind === 'expense' ? '選擇支出分類' : '選擇收入分類'} onClose={onClose}>
      {recent.length > 0 && (
        <div className="chips" aria-label="最近用過">
          {recent.map((n) => (
            <button key={n.id} className="chip" aria-pressed={n.id === value} onClick={() => onPick(n.id)}>{tree.path(n.id)}</button>
          ))}
        </div>
      )}
      <div className="catpick" ref={box}>
        <div className="col" role="group" aria-label="主分類">
          <div className="colhead">主分類</div>
          {roots.map((n) => {
            const kids = n.children.filter(live).length;
            return (
              <button key={n.id} type="button" className={`cp ${n.id === mainId ? 'on' : ''} ${value === n.id ? 'sel' : ''}`} onClick={() => tapMain(n)}
                aria-label={kids ? `${n.name}（${kids} 個子分類）` : n.name}>
                <Tile name={categoryIcon(tree, n.id)} tone={tone} round size={38} />
                <span className="name">{n.name}{n.archived ? '（封存）' : ''}</span>
                {kids > 0 ? <Icon name="chev" className="chev" /> : check(n.id)}
              </button>
            );
          })}
        </div>
        <div className="col sub" role="group" aria-label="子分類">
          <div className="colhead">子分類</div>
          {main && subs.length > 0 && (
            <button type="button" className={`cp ${value === main.id ? 'sel' : ''}`} onClick={() => onPick(main.id)}>
              <Tile name={categoryIcon(tree, main.id)} tone="plain" round size={38} />
              <span className="name">就選「{main.name}」</span>{check(main.id)}
            </button>
          )}
          {subs.map((c) => (
            <div key={c.id} style={{ display: 'contents' }}>
              <button type="button" className={`cp ${value === c.id ? 'sel' : ''}`} onClick={() => onPick(c.id)}>
                <Tile name={categoryIcon(tree, c.id)} tone={tone} round size={38} />
                <span className="name">{c.name}{c.archived ? '（封存）' : ''}</span>{check(c.id)}
              </button>
              {c.children.filter(live).map((g) => (
                <button key={g.id} type="button" className={`cp lv3 ${value === g.id ? 'sel' : ''}`} onClick={() => onPick(g.id)}>
                  <span className="name">└ {g.name}</span>{check(g.id)}
                </button>
              ))}
            </div>
          ))}
          {main && !subs.length && <div className="empty">「{main.name}」沒有子分類</div>}
        </div>
      </div>
      <AddCategory kind={kind} parentId={mainId} onAdded={onPick} />
      <p className="small muted">改名、搬移、排序到「更多 › 分類」。</p>
    </Sheet>
  );
}

/** 選分類時直接新增：預設放在目前這一層，新增完直接選用 */
function AddCategory({ kind, parentId, onAdded }) {
  const { data, actions } = useLedger();
  const { tree } = data;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [parent, setParent] = useState(parentId ?? '');
  const [err, setErr] = useState('');
  const [run, busy] = useAction();
  const opts = useMemo(() => parentOptions(tree, kind).filter((o) => !tree.byId.get(o.id)?.archived), [tree, kind]);
  const start = (p) => { setParent(p ?? ''); setName(''); setErr(''); setOpen(true); };
  const pName = parentId ? tree.byId.get(parentId)?.name : null;
  if (!open) {
    return (
      <div className="row-flex" style={{ gap: 8 }}>
        <button className="btn grow" onClick={() => start(null)}><Icon name="plus" className="chev" />主分類</button>
        {pName && <button className="btn grow" onClick={() => start(parentId)} aria-label={`新增「${pName}」的子分類`}><Icon name="plus" className="chev" />子分類</button>}
      </div>
    );
  }
  const submit = async (e) => {
    e.preventDefault();
    const draft = { name: name.trim(), parent_id: parent || null, kind };
    const bad = validateCategory(tree, draft);
    if (bad) { setErr(bad); return; }
    const row = await run(() => actions.saveCategory(draft), `已新增「${draft.name}」`);
    if (row && row.id) onAdded(row.id);
  };
  return (
    <form className="card" style={{ display: 'grid', gap: 10 }} onSubmit={submit}>
      <b>新增{kind === 'expense' ? '支出' : '收入'}分類</b>
      <label className="field"><span>名稱</span>
        <input className="input" autoFocus value={name} maxLength={30} onChange={(e) => { setName(e.target.value); setErr(''); }} placeholder="例如：寵物" />
      </label>
      <label className="field"><span>放在</span>
        <select className="input" value={parent} onChange={(e) => { setParent(e.target.value); setErr(''); }}>
          <option value="">最上層</option>
          {opts.map((o) => <option key={o.id} value={o.id}>{o.label} 底下</option>)}
        </select>
      </label>
      {err && <div className="small" style={{ color: 'var(--expense)' }}>{err}</div>}
      <div className="row-flex" style={{ gap: 8 }}>
        <button type="button" className="btn grow" onClick={() => setOpen(false)}>取消</button>
        <button type="submit" className="btn primary grow" disabled={busy || !name.trim()}>新增並選用</button>
      </div>
    </form>
  );
}

export const accountLabel = (a) => (a ? `${a.name}${a.currency !== 'TWD' ? `（${a.currency}）` : ''}` : '');
export { accountTypeLabel };
