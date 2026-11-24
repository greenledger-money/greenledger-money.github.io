// 報表：分類占比圓環（點進去看下一層）、每月收支趨勢、淨資產走勢；可切換「含／不含例外」
import { useMemo, useState } from 'react';
import { useLedger } from '../store.jsx';
import { Icon, Page, Section, Seg, Toggle } from '../ui/kit.jsx';
import { Donut, LineChart, MonthBars } from '../ui/charts.jsx';
import { categoryBreakdown, monthlyTrend, netWorthSeries, summarize } from '../lib/ledger.js';
import { fmt } from '../lib/money.js';
import { lastMonths, monthLabel, monthRange, shiftMonth, thisMonth } from '../lib/dates.js';

export default function Reports() {
  const { data } = useLedger();
  const [period, setPeriod] = useState(data.settings.reportPeriod);
  const [month, setMonth] = useState(thisMonth());
  const [year, setYear] = useState(Number(thisMonth().slice(0, 4)));
  const [kind, setKind] = useState('expense');
  const [incl, setIncl] = useState(data.settings.includeExceptions);
  const [parentId, setParentId] = useState(null);

  const range = period === 'month' ? monthRange(month) : { from: new Date(year, 0, 1), to: new Date(year + 1, 0, 1) };
  const label = period === 'month' ? monthLabel(month) : `${year} 年`;
  const s = useMemo(() => summarize(data.transactions, data.accById, { ...range, includeExceptions: incl }), [data, range.from.getTime(), incl]);
  const rows = useMemo(() => categoryBreakdown({ txns: data.transactions, tree: data.tree, accById: data.accById, kind, ...range, includeExceptions: incl, parentId }),
    [data, kind, range.from.getTime(), incl, parentId]);
  const months = lastMonths(thisMonth(), 12);
  const trend = useMemo(() => monthlyTrend(data.transactions, data.accById, months, incl), [data, incl]);
  const worth = useMemo(() => netWorthSeries({ accounts: data.accounts, txns: data.worthTxns, monthKeys: months, fx: data.fx, stockValueAt: data.stockValueAt }), [data]);
  const crumbs = parentId ? data.tree.chain(parentId) : [];

  const shift = (n) => { setParentId(null); if (period === 'month') setMonth(shiftMonth(month, n)); else setYear(year + n); };

  return (
    <Page title="報表">
      <Seg value={period} onChange={(v) => { setPeriod(v); setParentId(null); }} options={[{ value: 'month', label: '月' }, { value: 'year', label: '年' }]} />
      <div className="row-flex" style={{ justifyContent: 'space-between' }}>
        <div className="monthnav">
          <button className="iconbtn" aria-label="往前" onClick={() => shift(-1)}><Icon name="back" /></button>
          <b>{label}</b>
          <button className="iconbtn" aria-label="往後" onClick={() => shift(1)}><Icon name="chev" /></button>
        </div>
        <label className="row-flex small"><span>含例外</span><Toggle label="含例外" checked={incl} onChange={setIncl} /></label>
      </div>

      <div className="card">
        <div className="stats">
          <div><span className="small muted">收入</span><b className="num income">{fmt(s.income)}</b></div>
          <div><span className="small muted">支出</span><b className="num expense">{fmt(s.expense)}</b></div>
          <div><span className="small muted">結餘</span><b className={`num ${s.net < 0 ? 'expense' : ''}`}>{fmt(s.net)}</b></div>
        </div>
      </div>

      <Section title="分類占比">
        <div className="card" style={{ display: 'grid', gap: 12 }}>
          <Seg value={kind} onChange={(v) => { setKind(v); setParentId(null); }} options={[{ value: 'expense', label: '支出' }, { value: 'income', label: '收入' }]} />
          {parentId && (
            <div className="crumbs">
              <button onClick={() => setParentId(null)}>全部</button>
              {crumbs.map((c) => <span key={c.id} className="row-flex">› <button onClick={() => setParentId(c.id)}>{c.name}</button></span>)}
            </div>
          )}
          <Donut rows={rows} onPick={(r) => setParentId(r.id)} centerLabel={parentId ? data.tree.byId.get(parentId)?.name : kind === 'expense' ? '總支出' : '總收入'} />
          <p className="small muted" style={{ margin: 0 }}>點有 › 的分類可以看下一層。隱藏帳戶的收支不算；外幣都換成台幣。</p>
        </div>
      </Section>

      <Section title="每月收支（近 12 個月）">
        <div className="card"><MonthBars data={trend} /></div>
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
