// 報表：分類占比圓環 → 點分類進那個分類的頁面 → 點最底層看每一筆（像 CWMoney）
import { useMemo, useState } from 'react';
import { useLedger } from '../store.jsx';
import { Icon, Page, Section, Seg, Toggle, back, go } from '../ui/kit.jsx';
import { TxnList } from '../ui/TxnList.jsx';
import { Donut, LineChart, MonthBars } from '../ui/charts.jsx';
import { categoryBreakdown, counts, monthlyTrend, netWorthSeries, summarize, twdOf } from '../lib/ledger.js';
import { fmt } from '../lib/money.js';
import { lastMonths, monthLabel, monthRange, shiftMonth, thisMonth } from '../lib/dates.js';

// 報表的期間、收支、含例外：在報表和點進去的頁面之間共用（換頁不會跑掉）
const RS = { period: null, month: thisMonth(), year: Number(thisMonth().slice(0, 4)), kind: 'expense', incl: null };
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

function PeriodBar({ rs, set, label, showIncl = true }) {
  const shift = (n) => (rs.period === 'month' ? set({ month: shiftMonth(rs.month, n) }) : set({ year: rs.year + n }));
  return (
    <div className="row-flex" style={{ justifyContent: 'space-between' }}>
      <div className="monthnav">
        <button className="iconbtn" aria-label="往前" onClick={() => shift(-1)}><Icon name="back" /></button>
        <b>{label}</b>
        <button className="iconbtn" aria-label="往後" onClick={() => shift(1)}><Icon name="chev" /></button>
      </div>
      {showIncl && <label className="row-flex small"><span>含例外</span><Toggle label="含例外" checked={rs.incl} onChange={(v) => set({ incl: v })} /></label>}
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

  return (
    <Page title="報表">
      <Seg value={rs.period} onChange={(v) => set({ period: v })} options={[{ value: 'month', label: '月' }, { value: 'year', label: '年' }]} />
      <PeriodBar rs={rs} set={set} label={label} />

      <div className="card">
        <div className="stats">
          <div><span className="small muted">收入</span><b className="num income">{fmt(s.income)}</b></div>
          <div><span className="small muted">支出</span><b className="num expense">{fmt(s.expense)}</b></div>
          <div><span className="small muted">結餘</span><b className={`num ${s.net < 0 ? 'expense' : ''}`}>{fmt(s.net)}</b></div>
        </div>
      </div>

      <Section title="分類占比">
        <div className="card" style={{ display: 'grid', gap: 12 }}>
          <Seg value={kind} onChange={(v) => set({ kind: v })} options={[{ value: 'expense', label: '支出' }, { value: 'income', label: '收入' }]} />
          <Donut rows={rows} onPick={(r) => openRow(r)} onSelect={(r) => openRow(r)} centerLabel={kind === 'expense' ? '總支出' : '總收入'} />
          <p className="small muted" style={{ margin: 0 }}>點分類看下一層，最底層就是每一筆紀錄。隱藏帳戶的收支不算；外幣都換成台幣。</p>
        </div>
      </Section>

      <Section title="每月收支（近 12 個月，點長條看那個月）">
        <div className="card"><MonthBars data={trend} onPick={(k) => { set({ period: 'month', month: k }); window.scrollTo({ top: 0, behavior: 'smooth' }); }} /></div>
      </Section>

      <Section title="淨資產走勢（每月月底）">
        <div className="card">
          <LineChart data={worth} />
          <p className="small muted" style={{ margin: '8px 0 0' }}>含股票市值；股價、匯率用當月月底（或之前最近一天）的資料。</p>
        </div>
      </Section>
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
  const total = rows.reduce((x, r) => x + r.amount, 0);
  if (!node) return <Page title="報表" onBack={() => back('reports')}><div className="card">找不到這個分類</div></Page>;
  return (
    <Page title={data.tree.path(id)} onBack={() => back('reports')}>
      <PeriodBar rs={rs} set={set} label={label} />
      <div className="card" style={{ display: 'grid', gap: 12 }}>
        {rows.length
          ? <Donut rows={rows} onPick={(r) => openRow(r, id)} onSelect={(r) => openRow(r, id)} centerLabel={kind === 'expense' ? '總支出' : '總收入'} />
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
  const txns = useMemo(() => {
    if (!node) return [];
    const set2 = self ? new Set([catId]) : data.tree.descendants(catId);
    const lo = range.from.getTime(); const hi = range.to.getTime();
    return data.transactions.filter((t) => t.type === node.kind && set2.has(t.category_id) && counts(t, data.accById, rs.incl)
      && Date.parse(t.occurred_at) >= lo && Date.parse(t.occurred_at) < hi);
  }, [data, catId, self, range.from.getTime(), range.to.getTime(), rs.incl]);
  const total = txns.reduce((x, t) => x + twdOf(t), 0);
  if (!node) return <Page title="明細" onBack={() => back('reports')}><div className="card">找不到這個分類</div></Page>;
  return (
    <Page title={`${node.name}${self ? '（未細分）' : ''}`} onBack={() => back('reports')}>
      <PeriodBar rs={rs} set={set} label={label} showIncl={false} />
      <div className="row-flex" style={{ justifyContent: 'space-between', padding: '0 4px' }}>
        <span className="muted">項目：<b className="num">{txns.length}</b> 筆</span>
        <span className="muted">合計：<b className={`num ${node.kind === 'expense' ? 'expense' : 'income'}`}>{fmt(total)}</b></span>
      </div>
      <div className="small muted" style={{ padding: '0 4px' }}>{data.tree.path(catId)}</div>
      <TxnList txns={txns} empty="這段期間沒有紀錄" />
    </Page>
  );
}
