// 淨資產：走勢圖（1 年／3 年／全部）、跟上個月／一年前比、按帳戶類型分
import { useMemo, useState } from 'react';
import { useLedger } from '../store.jsx';
import { Page, Section, Seg, Tile, accountIcon, back, useAction } from '../ui/kit.jsx';
import { LineChart } from '../ui/charts.jsx';
import { accountTypeLabel, orderedTypes } from '../lib/ledger.js';
import { lastMonths, monthKey, thisMonth } from '../lib/dates.js';
import { fmt } from '../lib/money.js';

const diff = (a, b) => (a == null || b == null ? null : Math.round((a - b) * 100) / 100);
function Delta({ label, value }) {
  if (value == null) return null;
  return (
    <div>
      <span className="small muted">{label}</span>
      <b className={`num ${value < 0 ? 'expense' : 'income'}`}>{value >= 0 ? '+' : '−'}{fmt(Math.abs(value))}</b>
    </div>
  );
}

export default function Worth() {
  const { data, actions } = useLedger();
  const [run] = useAction();
  const inc = data.settings.worthIncludeStocks;
  const [range, setRange] = useState('1y');
  const first = useMemo(() => {
    const t = data.transactions[data.transactions.length - 1]; // 由新到舊排，最後一筆最舊
    return t ? monthKey(t.occurred_at) : thisMonth();
  }, [data.transactions]);
  const allMonths = useMemo(() => {
    const now = thisMonth();
    const n = (Number(now.slice(0, 4)) - Number(first.slice(0, 4))) * 12 + Number(now.slice(5)) - Number(first.slice(5)) + 1;
    return lastMonths(now, Math.max(2, Math.min(n, 240)));
  }, [first]);
  const series = useMemo(() => data.worthSeries(allMonths, inc), [data, allMonths, inc]);
  const shown = range === 'all' ? series : series.slice(-(range === '3y' ? 37 : 13));
  const now = inc ? data.worth.total : data.worthNoStocks;
  const at = (k) => series.find((s) => s.month === k)?.total ?? null;
  const cur = thisMonth();
  const prevMonth = series.length > 1 ? series[series.length - 2].total : null;
  const yearAgo = at(`${Number(cur.slice(0, 4)) - 1}-${cur.slice(5)}`);
  const lastYearEnd = at(`${Number(cur.slice(0, 4)) - 1}-12`);

  // 按帳戶類型
  const groups = useMemo(() => {
    const m = new Map();
    for (const r of data.worth.rows) {
      if (!inc && r.account.type === 'brokerage') continue;
      const g = m.get(r.account.type) ?? { type: r.account.type, total: 0, rows: [] };
      g.total += r.twd; g.rows.push(r); m.set(r.account.type, g);
    }
    return orderedTypes(data.settings.accountTypeOrder).map((t) => m.get(t.value)).filter(Boolean);
  }, [data, inc]);
  const pos = groups.filter((g) => g.total > 0).reduce((x, g) => x + g.total, 0);

  // 每月變化（新到舊）
  const months = series.map((s, i) => ({ ...s, change: i ? diff(s.total, series[i - 1].total) : null })).reverse().slice(0, range === 'all' ? undefined : range === '3y' ? 36 : 12);

  return (
    <Page title="淨資產" onBack={() => back('accounts')}>
      <div className="card hero" style={{ gap: 6 }}>
        <div className="row-flex">
          <span className="label grow">目前淨資產{inc ? '（含股票）' : '（不含股票）'}</span>
          <button className="chip" aria-pressed={inc} onClick={() => run(() => actions.updateSettings({ worthIncludeStocks: !inc }))} style={{ minHeight: 30, fontSize: 13 }}>含股票</button>
        </div>
        <div className="big num">{fmt(now)}</div>
        <div className="stats" style={{ marginTop: 6 }}>
          <Delta label="比上個月底" value={diff(now, prevMonth)} />
          <Delta label="今年以來" value={diff(now, lastYearEnd)} />
          <Delta label="比一年前" value={diff(now, yearAgo)} />
        </div>
      </div>

      <Seg value={range} onChange={setRange} options={[{ value: '1y', label: '1 年' }, { value: '3y', label: '3 年' }, { value: 'all', label: '全部' }]} />
      <div className="card"><LineChart data={shown} height={210} /></div>

      <Section title="資產分布">
        <div className="list">
          {groups.map((g) => (
            <div key={g.type} className="item">
              <Tile name={accountIcon(g.type)} size={36} />
              <div className="main">
                <div className="title">{accountTypeLabel(g.type)}</div>
                <div className="sub">{g.rows.length} 個帳戶{g.total > 0 && pos > 0 ? ` · 占 ${Math.round((g.total / pos) * 100)}%` : ''}</div>
              </div>
              <b className={`num ${g.total < 0 ? 'expense' : ''}`}>{fmt(g.total)}</b>
            </div>
          ))}
        </div>
      </Section>

      <Section title="每月月底">
        <div className="list">
          {months.map((m) => (
            <div key={m.month} className="item">
              <div className="main"><div className="title num">{m.month.replace('-', ' 年 ')} 月</div></div>
              <div style={{ textAlign: 'right' }}>
                <b className="num">{fmt(m.total)}</b>
                {m.change != null && <div className={`small num ${m.change < 0 ? 'expense' : 'income'}`}>{m.change >= 0 ? '+' : '−'}{fmt(Math.abs(m.change))}</div>}
              </div>
            </div>
          ))}
        </div>
      </Section>
    </Page>
  );
}
