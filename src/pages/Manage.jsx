// 「更多」選單，以及範本、固定收支、分類的管理頁
import { useMemo, useState } from 'react';
import { useLedger } from '../store.jsx';
import { Empty, Field, Group, Icon, Item, MoveButtons, Money, Page, Section, Seg, Sheet, Toggle, back, go, useAction, useUI, Tile, categoryIcon, IconPicker } from '../ui/kit.jsx';
import { AccountSelect, CategoryButton } from '../ui/pickers.jsx';
import { exceptionSource, parentOptions, validateCategory } from '../lib/categories.js';
import { describe, nextDate, UNIT_LABEL } from '../lib/recurring.js';
import { TXN_LABEL } from '../lib/ledger.js';
import { dayLabel, todayStr } from '../lib/dates.js';

export function More() {
  const { data, user } = useLedger();
  const links = [
    ['transactions', 'doc', '明細', ''],
    ['friends', 'people', '朋友欠款', data.friendsOwe && data.balances.get(data.friendsOwe.id) > 0 ? `還欠 ${Math.round(data.balances.get(data.friendsOwe.id)).toLocaleString()}` : ''],
    ['goals', 'star', '存錢目標', (data.settings.goals ?? []).length ? `${data.settings.goals.length} 個目標` : ''],
    ['year', 'calendar', '年度回顧', ''],
    ['budget', 'wallet', '預算', data.settings.budget?.total ? `每月 ${Number(data.settings.budget.total).toLocaleString()}` : '未設定'],
    ['stocks', 'stock', '股票', `${data.holdings.length} 檔持股`],
    ['templates', 'bolt', '範本', `${data.templates.length} 個`],
    ['recurring', 'repeat', '固定收支', `${data.recurring_rules.filter((r) => r.active).length} 個進行中`],
    ['categories', 'tag', '分類', ''],
    ['inbox', 'phone', '捷徑與自動記帳', 'Siri 記一筆、刷卡通知信'],
    ['import', 'upload', '從 CWMoney 匯入', ''],
    ['export', 'download', '匯出 CSV', ''],
    ['settings', 'gear', '設定', user.demo ? '試用模式' : user.email],
  ];
  return (
    <Page title="更多">
      <div className="list">
        {links.map(([href, icon, title, sub]) => (
          <Item key={href} href={`#${href}`} left={<Tile name={icon} />} title={title} sub={sub || undefined} chevron />
        ))}
      </div>
    </Page>
  );
}

// ---------------------------------------------------------------------
// 範本
// ---------------------------------------------------------------------
function TemplateSheet({ original, onClose }) {
  const { data, actions } = useLedger();
  const { confirm } = useUI();
  const [run, busy] = useAction();
  const [f, setF] = useState(() => original ? { ...original, amount: original.amount ?? '' } : { name: '', mode: 'fill', type: 'expense', account_id: null, to_account_id: null, category_id: null, amount: '', note: '', is_exception: false });
  const [err, setErr] = useState('');
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  async function save() {
    if (!f.name.trim()) return setErr('請輸入名稱');
    if (f.mode === 'instant') {
      if (!(Number(f.amount) > 0)) return setErr('一鍵記帳的範本一定要有固定金額');
      if (!f.account_id) return setErr('一鍵記帳的範本要選帳戶');
      if (f.type === 'transfer' ? !f.to_account_id || f.to_account_id === f.account_id : !f.category_id) return setErr(f.type === 'transfer' ? '請選不同的轉入帳戶' : '一鍵記帳的範本要選分類');
    }
    if (f.amount !== '' && Number.isNaN(Number(f.amount))) return setErr('金額要是數字');
    if (await run(() => actions.saveTemplate(f, original), '已儲存範本')) onClose();
  }
  async function remove() {
    if (!(await confirm(`刪除範本「${original.name}」？`, { ok: '刪除', danger: true }))) return;
    if (await run(() => actions.removeRows('templates', [original.id]), '已刪除')) onClose();
  }
  return (
    <Sheet title={original ? '修改範本' : '新增範本'} onClose={onClose} onSave={save} saving={busy}>
      <div className="form">
        <Field label="名稱"><input className="input" value={f.name} onChange={set('name')} placeholder="例如：早餐、悠遊卡加值" /></Field>
        <Group label="模式">
          <Seg value={f.mode} onChange={set('mode')} options={[{ value: 'fill', label: '帶入表單再改' }, { value: 'instant', label: '一鍵直接記' }]} />
        </Group>
        <Seg value={f.type} onChange={(t) => setF((x) => ({ ...x, type: t, category_id: data.tree.byId.get(x.category_id)?.kind === t ? x.category_id : null }))} options={['expense', 'income', 'transfer'].map((v) => ({ value: v, label: TXN_LABEL[v] }))} />
        <div className="formlist">
          <div className="frow"><span className="lbl">{f.type === 'transfer' ? '轉出' : '帳戶'}</span><div className="ctrl"><AccountSelect className="" value={f.account_id} onChange={set('account_id')} allowEmpty placeholder="（記帳時再選）" /></div></div>
          {f.type === 'transfer'
            ? <div className="frow"><span className="lbl">轉入</span><div className="ctrl"><AccountSelect className="" value={f.to_account_id} onChange={set('to_account_id')} allowEmpty placeholder="（記帳時再選）" /></div></div>
            : <div className="frow"><span className="lbl">分類</span><div className="ctrl"><CategoryButton kind={f.type} value={f.category_id} onChange={set('category_id')} placeholder="（記帳時再選）" /></div></div>}
          <div className="frow"><label htmlFor="tamt">金額</label><div className="ctrl"><input id="tamt" inputMode="decimal" value={f.amount} onChange={set('amount')} placeholder={f.mode === 'instant' ? '必填' : '選填'} /></div></div>
          <div className="frow"><label htmlFor="tnote">備註</label><div className="ctrl"><input id="tnote" value={f.note} onChange={set('note')} placeholder="選填" /></div></div>
        </div>
        {err && <div className="error">{err}</div>}
        {original && <button className="btn danger block" onClick={remove} disabled={busy}>刪除範本</button>}
      </div>
    </Sheet>
  );
}

export function Templates() {
  const { data, actions } = useLedger();
  const [run] = useAction();
  const [edit, setEdit] = useState(null);
  const [sorting, setSorting] = useState(false);
  const list = [...data.templates].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'zh-Hant'));
  const ids = list.map((t) => t.id);
  return (
    <Page title="範本" onBack={() => back('more')} right={<>
      {list.length > 1 && <button className="link" onClick={() => setSorting(!sorting)}>{sorting ? '完成' : '排序'}</button>}
      {!sorting && <button className="iconbtn" aria-label="新增範本" onClick={() => setEdit({})}><Icon name="plus" /></button>}
    </>}>
      <div className="list">
        {list.length ? list.map((t) => {
          const acc = data.accById.get(t.account_id);
          if (sorting) {
            return (
              <Item key={t.id} title={t.name} chevron={false}>
                <MoveButtons ids={ids} id={t.id} label={t.name} onMove={(next) => run(() => actions.reorder('templates', next))} />
              </Item>
            );
          }
          return (
            <Item key={t.id} onClick={() => setEdit(t)} title={<>{t.mode === 'instant' && <span className="badge accent">一鍵</span>} {t.name}</>}
              sub={[TXN_LABEL[t.type], t.category_id && data.tree.path(t.category_id), acc?.name].filter(Boolean).join(' · ')}
              value={t.amount != null ? <Money value={t.amount} currency={acc?.currency} /> : <span className="muted small">不固定</span>} />
          );
        }) : <Empty>還沒有範本</Empty>}
      </div>
      {edit && <TemplateSheet original={edit.id ? edit : null} onClose={() => setEdit(null)} />}
    </Page>
  );
}

// ---------------------------------------------------------------------
// 固定收支
// ---------------------------------------------------------------------
function RecurringSheet({ original, onClose }) {
  const { data, actions } = useLedger();
  const { confirm } = useUI();
  const [run, busy] = useAction();
  const [f, setF] = useState(() => original ? { ...original, amount: String(Number(original.amount)), end_date: original.end_date ?? '' }
    : { name: '', type: 'expense', account_id: null, to_account_id: null, category_id: null, amount: '', note: '', interval_unit: 'month', interval_count: 1, start_date: todayStr(), end_date: '', active: true });
  const [err, setErr] = useState('');
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  async function save() {
    if (!f.name.trim()) return setErr('請輸入名稱');
    if (!(Number(f.amount) >= 0) || f.amount === '') return setErr('請輸入金額');
    if (!f.account_id) return setErr('請選擇帳戶');
    if (f.type === 'transfer' ? !f.to_account_id || f.to_account_id === f.account_id : !f.category_id) return setErr(f.type === 'transfer' ? '請選不同的轉入帳戶' : '請選擇分類');
    if (!(Number(f.interval_count) >= 1)) return setErr('週期至少是 1');
    if (f.end_date && f.end_date < f.start_date) return setErr('結束日不能早於起始日');
    if (await run(() => actions.saveRecurring(f, original), '已儲存')) onClose();
  }
  async function remove() {
    if (!(await confirm(`刪除「${original.name}」？已經記好的帳不會被刪，還沒確認的待確認項目會一起刪除。`, { ok: '刪除', danger: true }))) return;
    if (await run(() => actions.removeRows('recurring_rules', [original.id]), '已刪除')) onClose();
  }
  return (
    <Sheet title={original ? '修改固定收支' : '新增固定收支'} onClose={onClose} onSave={save} saving={busy} full>
      <div className="form">
        <Field label="名稱"><input className="input" value={f.name} onChange={set('name')} placeholder="例如：房租、Netflix" /></Field>
        <Seg value={f.type} onChange={(t) => setF((x) => ({ ...x, type: t, category_id: data.tree.byId.get(x.category_id)?.kind === t ? x.category_id : null }))} options={['expense', 'income', 'transfer'].map((v) => ({ value: v, label: TXN_LABEL[v] }))} />
        <div className="formlist">
          <div className="frow"><label htmlFor="ramt">金額</label><div className="ctrl"><input id="ramt" inputMode="decimal" value={f.amount} onChange={set('amount')} placeholder="選填" /></div></div>
          <div className="frow"><span className="lbl">{f.type === 'transfer' ? '轉出' : '帳戶'}</span><div className="ctrl"><AccountSelect className="" value={f.account_id} onChange={set('account_id')} /></div></div>
          {f.type === 'transfer'
            ? <div className="frow"><span className="lbl">轉入</span><div className="ctrl"><AccountSelect className="" value={f.to_account_id} onChange={set('to_account_id')} placeholder="選擇轉入帳戶" /></div></div>
            : <div className="frow"><span className="lbl">分類</span><div className="ctrl"><CategoryButton kind={f.type} value={f.category_id} onChange={set('category_id')} /></div></div>}
          <div className="frow"><label htmlFor="rnote">備註</label><div className="ctrl"><input id="rnote" value={f.note} onChange={set('note')} placeholder="選填" /></div></div>
        </div>
        <Field label="週期">
          <div className="row-flex">
            <span>每</span>
            <input className="input num" style={{ width: 80 }} inputMode="numeric" value={f.interval_count} onChange={set('interval_count')} />
            <select className="input grow" value={f.interval_unit} onChange={set('interval_unit')}>
              {Object.entries(UNIT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </Field>
        <div className="grid2">
          <Field label="起始日"><input className="input" type="date" value={f.start_date} onChange={set('start_date')} /></Field>
          <Field label="結束日" hint="選填"><input className="input" type="date" value={f.end_date} onChange={set('end_date')} /></Field>
        </div>
        <p className="small muted" style={{ margin: 0 }}>到期時會列在首頁「待確認」。</p>
        <div className="row-flex"><span className="grow">啟用</span><Toggle label="啟用" checked={f.active} onChange={set('active')} /></div>
        {err && <div className="error">{err}</div>}
        {original && <button className="btn danger block" onClick={remove} disabled={busy}>刪除</button>}
      </div>
    </Sheet>
  );
}

export function Recurring() {
  const { data } = useLedger();
  const [edit, setEdit] = useState(null);
  return (
    <Page title="固定收支" onBack={() => back('more')} right={<button className="iconbtn" aria-label="新增固定收支" onClick={() => setEdit({})}><Icon name="plus" /></button>}>
      <div className="list">
        {data.recurring_rules.length ? data.recurring_rules.map((r) => {
          const acc = data.accById.get(r.account_id);
          const nd = nextDate(r);
          return (
            <Item key={r.id} onClick={() => setEdit(r)} title={<>{r.name}{!r.active && <span className="badge"> 暫停</span>}</>}
              sub={`${describe(r)} · ${nd ? `下次 ${dayLabel(nd)}` : '已結束'} · ${acc?.name ?? ''}`}
              value={<Money value={r.amount} currency={acc?.currency} tone={r.type === 'expense' ? 'expense' : r.type === 'income' ? 'income' : ''} />} />
          );
        }) : <Empty>還沒有固定收支</Empty>}
      </div>
      {edit && <RecurringSheet original={edit.id ? edit : null} onClose={() => setEdit(null)} />}
    </Page>
  );
}

// ---------------------------------------------------------------------
// 分類
// ---------------------------------------------------------------------
function CategorySheet({ original, kind, parentId, onClose }) {
  const { data, actions } = useLedger();
  const { confirm } = useUI();
  const [run, busy] = useAction();
  const [f, setF] = useState(() => original ? { ...original } : { name: '', kind, parent_id: parentId ?? null, archived: false });
  const [err, setErr] = useState('');
  const opts = useMemo(() => parentOptions(data.tree, f.kind, original?.id), [data.tree, f.kind, original?.id]);
  const used = original && data.transactions.some((t) => t.category_id === original.id);
  const hasKids = original && data.tree.byId.get(original.id)?.children.length > 0;
  const excList = data.settings.exceptionCats ?? [];
  const excWas = !!original && excList.includes(original.id);
  const [exc, setExc] = useState(excWas);
  const [applyPast, setApplyPast] = useState(true);
  const inherited = f.parent_id ? exceptionSource(data.tree, f.parent_id, excList) : null;
  const pastCount = original && exc && !excWas ? actions.pastNotException(original.id).length : 0;
  async function save() {
    const e = validateCategory(data.tree, { ...f, id: original?.id });
    if (e) return setErr(e);
    const ok = await run(async () => {
      const saved = await actions.saveCategory(f, original);
      if (exc !== excWas) await actions.setCategoryException(saved.id, exc, exc && applyPast);
    }, '已儲存');
    if (ok) onClose();
  }
  async function remove() {
    if (used) return setErr('這個分類已經有交易，不能刪除。可以打開「封存」，以後記帳就不會出現。');
    if (hasKids) return setErr('底下還有子分類，請先刪除或搬走子分類。');
    if (!(await confirm(`刪除分類「${original.name}」？`, { ok: '刪除', danger: true }))) return;
    if (await run(() => actions.removeRows('categories', [original.id]), '已刪除')) onClose();
  }
  return (
    <Sheet title={original ? '修改分類' : '新增分類'} onClose={onClose} onSave={save} saving={busy}>
      <div className="form">
        <Field label="名稱"><input className="input" value={f.name} maxLength={30} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        {!original && <Seg value={f.kind} onChange={(k) => setF({ ...f, kind: k, parent_id: null })} options={[{ value: 'expense', label: '支出' }, { value: 'income', label: '收入' }]} />}
        <Field label="上層分類" hint="最多三層">
          <select className="input" value={f.parent_id ?? ''} onChange={(e) => setF({ ...f, parent_id: e.target.value || null })}>
            <option value="">（最上層）</option>
            {opts.map((o) => <option key={o.id} value={o.id}>{'　'.repeat(o.depth - 1)}{o.label}</option>)}
          </select>
        </Field>
        <Field label="圖示">
          <IconPicker value={f.icon ?? null} onChange={(v) => setF({ ...f, icon: v })} tone={f.kind === 'income' ? 'income' : ''}
            auto={categoryIcon({ ...data.tree, chain: () => [...(f.parent_id ? data.tree.chain(f.parent_id) : []), { name: f.name, icon: null }] }, 'x')} />
        </Field>
        {inherited
          ? <div className="row-flex"><span className="grow">一律算例外<div className="small muted">跟著上層「{inherited.name}」</div></span><Toggle label="一律算例外" checked disabled onChange={() => {}} /></div>
          : <div className="row-flex"><span className="grow">一律算例外<div className="small muted">記到這個分類（含子分類）自動勾例外</div></span><Toggle label="一律算例外" checked={exc} onChange={setExc} /></div>}
        {pastCount > 0 && (
          <div className="row-flex"><span className="grow">過去 {pastCount} 筆也改成例外</span><Toggle label="過去的也改成例外" checked={applyPast} onChange={setApplyPast} /></div>
        )}
        {original && <div className="row-flex"><span className="grow">封存<div className="small muted">記帳時不再顯示</div></span><Toggle label="封存" checked={f.archived} onChange={(v) => setF({ ...f, archived: v })} /></div>}
        {original?.system_key && <p className="small muted">系統分類無法刪除。</p>}
        {err && <div className="error">{err}</div>}
        {original && !original.system_key && <button className="btn danger block" onClick={remove} disabled={busy}>刪除分類</button>}
      </div>
    </Sheet>
  );
}

export function Categories() {
  const { data, actions } = useLedger();
  const [run] = useAction();
  const [sorting, setSorting] = useState(false);
  const [kind, setKind] = useState('expense');
  const [edit, setEdit] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [open, setOpen] = useState(() => new Set()); // 展開的分類，預設全部收起
  const toggle = (id) => setOpen((o) => { const x = new Set(o); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const counts = useMemo(() => {
    const m = new Map();
    data.transactions.forEach((t) => t.category_id && m.set(t.category_id, (m.get(t.category_id) ?? 0) + 1));
    return m;
  }, [data.transactions]);
  const rows = [];
  const walk = (n, depth) => {
    if (n.archived && !showArchived) return;
    const kids = n.children.filter((c) => showArchived || !c.archived);
    rows.push({ n, depth, kids: kids.length });
    if (open.has(n.id)) kids.forEach((c) => walk(c, depth + 1));
  };
  data.tree.roots[kind].forEach((r) => walk(r, 0));
  // 收起來時顯示整個分類（含子分類）的筆數
  const total = (n) => { let x = 0; for (const id of data.tree.descendants(n.id)) x += counts.get(id) ?? 0; return x; };
  const parents = [];
  const collect = (n) => { if (n.children.length) { parents.push(n.id); n.children.forEach(collect); } };
  data.tree.roots[kind].forEach(collect);
  const allOpen = parents.length > 0 && parents.every((id) => open.has(id));
  const fold = (n, kids) => (kids
    ? <button className="iconbtn fold" aria-expanded={open.has(n.id)} aria-label={`${open.has(n.id) ? '收起' : '展開'}「${n.name}」`} onClick={() => toggle(n.id)}><Icon name="chev" /></button>
    : <span className="fold-gap" />);
  return (
    <Page title="分類" onBack={() => back('more')} right={<>
      <button className="link" onClick={() => setSorting(!sorting)}>{sorting ? '完成' : '排序'}</button>
      {!sorting && <button className="iconbtn" aria-label="新增分類" onClick={() => setEdit({ kind })}><Icon name="plus" /></button>}
    </>}>
      <Seg value={kind} onChange={setKind} options={[{ value: 'expense', label: '支出' }, { value: 'income', label: '收入' }]} />
      <div className="row-flex">
        <span className="grow" />
        <button className="link small" style={{ flex: 'none' }} onClick={() => setOpen(allOpen ? new Set() : new Set(parents))}>{allOpen ? '全部收起' : '全部展開'}</button>
      </div>
      <div className="list">
        {rows.map(({ n, depth, kids }) => (sorting ? (
          <div key={n.id} className={`item cat-row depth-${depth}`} style={{ paddingTop: 0, paddingBottom: 0 }}>
            {fold(n, kids)}
            <div className="main"><div className="title">{n.name}</div></div>
            <MoveButtons label={n.name} id={n.id}
              ids={(n.parent_id ? data.tree.byId.get(n.parent_id).children : data.tree.roots[kind]).filter((c) => showArchived || !c.archived).map((c) => c.id)}
              onMove={(ids) => run(() => actions.reorder('categories', ids))} />
          </div>
        ) : (
          <div key={n.id} className={`item cat-row depth-${depth}`} style={{ paddingTop: 0, paddingBottom: 0 }}>
            {fold(n, kids)}
            {depth === 0 && <Tile name={categoryIcon(data.tree, n.id)} tone={kind === 'income' ? 'income' : ''} size={34} />}
            <button className="item" style={{ padding: '10px 0', flex: 1 }} onClick={() => setEdit({ original: n })}>
              <div className="main">
                <div className="title" style={depth === 0 ? { fontWeight: 600 } : undefined}>{n.name}{n.archived && <span className="badge"> 已封存</span>}{n.system_key && <span className="badge"> 系統</span>}{(data.settings.exceptionCats ?? []).includes(n.id) && <span className="badge"> 例外</span>}</div>
                {kids > 0 && !open.has(n.id) && <div className="sub">{kids} 個子分類</div>}
              </div>
              <span className="small muted num">{(kids && !open.has(n.id) ? total(n) : counts.get(n.id)) ? `${kids && !open.has(n.id) ? total(n) : counts.get(n.id)} 筆` : ''}</span>
            </button>
            {depth < 2 ? <button className="iconbtn" style={{ width: 40, height: 40, color: 'var(--muted)' }} onClick={() => { setOpen((o) => new Set(o).add(n.id)); setEdit({ kind, parentId: n.id }); }} aria-label={`在「${n.name}」底下新增子分類`} title="新增子分類"><Icon name="plus" /></button>
              : <span style={{ width: 40 }} />}
          </div>
        )))}
      </div>
      <label className="row-flex small"><span className="grow">顯示已封存的分類</span><Toggle label="顯示已封存" checked={showArchived} onChange={setShowArchived} /></label>
      {edit && <CategorySheet original={edit.original} kind={edit.kind ?? kind} parentId={edit.parentId} onClose={() => setEdit(null)} />}
    </Page>
  );
}

