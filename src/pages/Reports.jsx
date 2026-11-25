// 報表：分類占比圓環 → 點分類進那個分類的頁面 → 點最底層看每一筆（像 CWMoney）
import { useMemo, useState } from 'react';
import { useLedger } from '../store.jsx';
import { Icon, Page, Section, Seg, back, categoryIcon, go, useAction, useUI } from '../ui/kit.jsx';
import { exceptionSource } from '../lib/categories.js';
import { TxnList } from '../ui/TxnList.jsx';
import { Donut, LineChart, MonthBars } from '../ui/charts.jsx';
import { categoryBreakdown, counts, monthlyTrend, netWorthSeries, summarize, twdOf } from '../lib/ledger.js';
import { fmt } from '../lib/money.js';
import { lastMonths, monthLabel, monthRange, shiftMonth, thisMonth } from '../lib/dates.js';

// 報表的期間、收支、含例外：在報表和點進去的頁面之間共用（換頁不會跑掉）
const RS = { view: 'cat', period: null, month: thisMonth(), year: Number(thisMonth().slice(0, 4)), kind: 'expense', incl: null };
function useReportState() {
  const { data } = useLedger();
  const [, force] = useState(0);
  if (RS.period == null) RS.period = data.settings.reportPeriod;
  if (RS.incl == null) RS.incl = data.settings.includeExceptions;
  const set = (patch) => { Object.assign(RS, patch); force((x) => x + 1); };
  const range = RS.period === 'month' ? monthRange(RS.month) : { from: new Date(RS.year, 0, 1), to: new Date(RS.year + 1, 0, 1) };
  const label = RS.period === 'month' ? monthLabel(RS.month) : `${RS.year} 年`;
  return { rs: RS, set, range, label };
}

const EXC = [{ value: 'no', label: '不含例外' }, { value: 'yes', label: '含例外' }, { value: 'only', label: '只看例外' }];
const excOf = (incl) => (incl === 'only' ? 'only' : incl ? 'yes' : 'no');
function ExceptionBar({ rs, set }) {
  return <Seg value={excOf(rs.incl)} onChange={(v) => set({ incl: v === 'only' ? 'only' : v === 'yes' })} options={EXC} />;
}

/** 這個分類在這段期間，被「不含例外／只看例外」擋掉的筆數和金額 */
function useFilteredOut(catSet, kind, range, incl) {
  const { data } = useLedger();
  return useMemo(() => {
    if (incl === true || !catSet) return null;
    const lo = range.from.getTime(); const hi = range.to.getTime();
    let n = 0; let sum = 0;
    for (const t of data.transactions) {
      if (t.type !== kind || !catSet.has(t.category_id)) continue;
      const ms = Date.parse(t.occurred_at);
      if (ms < lo || ms >= hi || !counts(t, data.accById, true) || counts(t, data.accById, incl)) continue;
      n += 1; sum += twdOf(t);
    }
    return n ? { n, sum } : null;
  }, [data, catSet, kind, range.from.getTime(), range.to.getTime(), incl]);
}

function FilteredOut({ info, incl, set, node }) {
  const { data, actions } = useLedger();
  const { confirm } = useUI();
  const [run, busy] = useAction();
  if (!info) return null;
  // 同一個分類有的標例外、有的沒標：可以一鍵把整個分類設成「一律算例外」
  const canFix = node && node.kind === 'expense' && !exceptionSource(data.tree, node.id, data.settings.exceptionCats);
  async function fixAll() {
    const n = actions.pastNotException(node.id).length;
    if (!(await confirm(`把「${node.name}」設成一律算例外？\n過去 ${n} 筆沒勾例外的也會一起改，以後記到這個分類會自動勾例外。`, { ok: '設成例外' }))) return;
    await run(() => actions.setCategoryException(node.id, true, true), '已設成例外');
  }
  return (
    <div className="filtered-out">
      <button className="grow" onClick={() => set({ incl: true })}>
        另有 {info.n} 筆{incl === 'only' ? '非例外' : '例外'}（{fmt(info.sum)}）沒算進來 · <b>含例外一起看</b>
      </button>
      {canFix && <button className="btn small" disabled={busy} onClick={fixAll}>全部算例外</button>}
    </div>
  );
}

function PeriodBar({ rs, set, label }) {
  const shift = (n) => (rs.period === 'month' ? set({ month: shiftMonth(rs.month, n) }) : set({ year: rs.year + n }));
  return (
    <div className="row-flex" style={{ justifyContent: 'space-between' }}>
      <div className="monthnav">
        <button className="iconbtn" aria-label="往前" onClick={() => shift(-1)}><Icon name="back" /></button>
        <b>{label}</b>
        <button className="iconbtn" aria-label="往後" onClick={() => shift(1)}><Icon name="chev" /></button>
      </div>
    </div>
  );
}

/** 點圓環的分類：有下一層 → 分類頁；最底層 → 明細頁 */
const openRow = (r, parentId) => {
  if (r.id === '__unknown' || r.id === '__other') return;
  if (r.drillable) go('rcat', r.id);
  else go('rtx', r.id === '__self' ? `${parentId}~self` : r.id);
};

export default function Reports() {
  const { data } = useLedger();
  const { rs, set, range, label } = useReportState();
  const { kind, incl } = rs;
  const s = useMemo(() => summarize(data.transactions, data.accById, { ...range, includeExceptions: incl }), [data, range.from.getTime(), range.to.getTime(), incl]);
  const rows = useMemo(() => categoryBreakdown({ txns: data.transactions, tree: data.tree, accById: data.accById, kind, ...range, includeExceptions: incl, parentId: null }),
    [data, kind, range.from.getTime(), range.to.getTime(), incl]);
  const months = lastMonths(thisMonth(), 12);
  const trend = useMemo(() => monthlyTrend(data.transactions, data.accById, months, incl), [data, incl]);
  const worth = useMemo(() => netWorthSeries({ accounts: data.accounts, txns: data.worthTxns, monthKeys: months, fx: data.fx, stockValueAt: data.stockValueAt }), [data]);

  const iconOf = (r) => (data.tree.byId.get(r.id) ? categoryIcon(data.tree, r.id) : 'tag');

  return (
    <Page title="報表">
      <Seg value={rs.view} onChange={(v) => set({ view: v })} options={[{ value: 'cat', label: '分類報表' }, { value: 'trend', label: '收支趨勢' }]} />

      {rs.view === 'cat' ? (
        <>
          <div className="utabs" role="tablist">
            {[['expense', '支出'], ['income', '收入']].map(([v, l]) => <button key={v} type="button" role="tab" aria-selected={kind === v} onClick={() => set({ kind: v })}>{l}</button>)}
          </div>
          <div className="pillrow">
            <button type="button" className="pill" aria-pressed={rs.period === 'month'} onClick={() => set({ period: 'month' })}>月分類</button>
            <button type="button" className="pill" aria-pressed={rs.period === 'year'} onClick={() => set({ period: 'year' })}>年分類</button>
          </div>
          <PeriodBar rs={rs} set={set} label={label} />
          <ExceptionBar rs={rs} set={set} />
          <div className="card">
            <Donut rows={rows} kind={kind} iconOf={iconOf} onPick={(r) => openRow(r)} onSelect={(r) => openRow(r)} centerLabel={kind === 'expense' ? '總支出' : '總收入'} />
          </div>
        </>
      ) : (
        <>
          <Seg value={rs.period} onChange={(v) => set({ period: v })} options={[{ value: 'month', label: '月' }, { value: 'year', label: '年' }]} />
          <PeriodBar rs={rs} set={set} label={label} />
          <ExceptionBar rs={rs} set={set} />
          <div className="card">
            <div className="stats">
              <div><span className="small muted">收入</span><b className="num income">{fmt(s.income)}</b></div>
              <div><span className="small muted">支出</span><b className="num expense">{fmt(s.expense)}</b></div>
              <div><span className="small muted">結餘</span><b className={`num ${s.net < 0 ? 'expense' : ''}`}>{fmt(s.net)}</b></div>
            </div>
          </div>
          <Section title="近 12 個月">
            <div className="card"><MonthBars data={trend} onPick={(k) => { set({ period: 'month', month: k, view: 'cat' }); window.scrollTo({ top: 0, behavior: 'smooth' }); }} /></div>
          </Section>
          <button className="btn block" onClick={() => go('year')}><Icon name="calendar" className="chev" />{rs.year} 年度回顧</button>
          <Section title="淨資產走勢" action={<button className="link small" onClick={() => go('worth')}>看更多</button>}>
            <div className="card">
              <LineChart data={worth} />
              <p className="small muted" style={{ margin: '8px 0 0' }}>每月月底，含股票市值</p>
            </div>
          </Section>
        </>
      )}
    </Page>
  );
}

/** 某個分類的頁面：它下一層的占比 */
export function ReportCategory({ id }) {
  const { data } = useLedger();
  const { rs, set, range, label } = useReportState();
  const node = data.tree.byId.get(id);
  const kind = node?.kind ?? rs.kind;
  const rows = useMemo(() => categoryBreakdown({ txns: data.transactions, tree: data.tree, accById: data.accById, kind, ...range, includeExceptions: rs.incl, parentId: id }),
    [data, kind, id, range.from.getTime(), range.to.getTime(), rs.incl]);
  const total = rows.reduce((x, r) => x + r.total, 0);
  const catSet = useMemo(() => data.tree.descendants(id), [data.tree, id]);
  const out = useFilteredOut(catSet, kind, range, rs.incl);
  if (!node) return <Page title="報表" onBack={() => back('reports')}><div className="card">找不到這個分類</div></Page>;
  return (
    <Page title={data.tree.path(id)} onBack={() => back('reports')}>
      <PeriodBar rs={rs} set={set} label={label} />
      <ExceptionBar rs={rs} set={set} />
      <FilteredOut info={out} incl={rs.incl} set={set} node={node} />
      <div className="card" style={{ display: 'grid', gap: 12 }}>
        {rows.length
          ? <Donut rows={rows} kind={kind} iconOf={(r) => categoryIcon(data.tree, r.id === '__self' ? id : r.id)} onPick={(r) => openRow(r, id)} onSelect={(r) => openRow(r, id)} centerLabel={kind === 'expense' ? '總支出' : '總收入'} />
          : <div className="empty">這段期間沒有紀錄</div>}
      </div>
      {total > 0 && <button className="btn block" onClick={() => go('rtx', id)}>看「{node.name}」全部 {fmt(total)} 的明細</button>}
    </Page>
  );
}

/** 明細頁：這個分類（含子分類）這段期間的每一筆。id 結尾 ~self 表示只看沒細分的 */
export function ReportTxns({ id }) {
  const { data } = useLedger();
  const { rs, set, range, label } = useReportState();
  const self = id.endsWith('~self');
  const catId = self ? id.slice(0, -5) : id;
  const node = data.tree.byId.get(catId);
  const catSet = useMemo(() => (self ? new Set([catId]) : data.tree.descendants(catId)), [data.tree, catId, self]);
  const out = useFilteredOut(node ? catSet : null, node?.kind, range, rs.incl);
  const txns = useMemo(() => {
    if (!node) return [];
    const set2 = catSet;
    const lo = range.from.getTime(); const hi = range.to.getTime();
    return data.transactions.filter((t) => t.type === node.kind && set2.has(t.category_id) && counts(t, data.accById, rs.incl)
      && Date.parse(t.occurred_at) >= lo && Date.parse(t.occurred_at) < hi);
  }, [data, catId, self, range.from.getTime(), range.to.getTime(), rs.incl]);
  const total = txns.reduce((x, t) => x + twdOf(t), 0);
  if (!node) return <Page title="明細" onBack={() => back('reports')}><div className="card">找不到這個分類</div></Page>;
  return (
    <Page title={`${node.name}${self ? '（未細分）' : ''}`} onBack={() => back('reports')}>
      <PeriodBar rs={rs} set={set} label={label} />
      <ExceptionBar rs={rs} set={set} />
      <FilteredOut info={out} incl={rs.incl} set={set} node={node} />
      <div className="row-flex" style={{ justifyContent: 'space-between', padding: '0 4px' }}>
        <span className="muted">項目：<b className="num">{txns.length}</b> 筆</span>
        <span className="muted">合計：<b className={`num ${node.kind === 'expense' ? 'expense' : 'income'}`}>{fmt(total)}</b></span>
      </div>
      <div className="small muted" style={{ padding: '0 4px' }}>{data.tree.path(catId)}</div>
      <TxnList txns={txns} empty="這段期間沒有紀錄" />
    </Page>
  );
}
