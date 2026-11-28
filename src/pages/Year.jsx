// 年度回顧：收支、儲蓄率、分類、細項、店家、付款方式、星期幾、小錢、沒花錢的日子、前五大、收入來源
import { useMemo, useState } from 'react';
import { useLedger } from '../store.jsx';
import { Page, Section, Tile, back, categoryIcon, go, useAction, useUI } from '../ui/kit.jsx';
import { MonthBars } from '../ui/charts.jsx';
import { PeriodNav } from '../ui/PeriodPicker.jsx';
import { yearDetails, yearReview } from '../lib/review.js';
import { thisMonth, localDate, todayStr } from '../lib/dates.js';
import { fmt } from '../lib/money.js';

const Change = ({ v, good = 'down' }) => {
  if (v == null) return null;
  const better = good === 'down' ? v <= 0 : v >= 0;
  return <span className={`small ${better ? 'income' : 'expense'}`}>{v > 0 ? '▲' : v < 0 ? '▼' : ''}{Math.abs(v)}%</span>;
};

/** 一列：名稱、金額、長條 */
const Bar = ({ title, value, max, sub, icon, color = 'var(--expense)' }) => (
  <div className="item">
    {icon && <Tile name={icon} size={36} />}
    <div className="main">
      <div className="title row-flex"><span className="grow">{title}</span><b className="num">{fmt(value)}</b></div>
      <div className="bar-track"><i style={{ width: `${max ? (value / max) * 100 : 0}%`, background: color }} /></div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  </div>
);

export default function Year() {
  const { data, actions } = useLedger();
  const { openEntry } = useUI();
  const [run] = useAction();
  const inc = data.settings.worthIncludeStocks;
  const now = thisMonth();
  const [year, setYear] = useState(Number(now.slice(0, 4)));
  const firstYear = useMemo(() => Number(localDate(data.transactions[data.transactions.length - 1]?.occurred_at ?? new Date().toISOString()).slice(0, 4)), [data.transactions]);
  const r = useMemo(() => yearReview({ txns: data.transactions, accById: data.accById, tree: data.tree }, year, now), [data, year, now]);
  const worth = useMemo(() => {
    const end = String(year) === now.slice(0, 4) ? now : `${year}-12`;
    const s = data.worthSeries([`${year - 1}-12`, end], data.settings.worthIncludeStocks);
    return { start: s[0].total, end: s[1].total };
  }, [data, year, now]);
  const d = useMemo(() => yearDetails({ txns: data.transactions, accById: data.accById, tree: data.tree }, year, todayStr()), [data, year]);
  const isNow = String(year) === now.slice(0, 4);
  const max = r.top[0]?.total || 1;

  return (
    <Page title="年度回顧" onBack={() => back('reports')}>
      <PeriodNav mode="year" value={year} onChange={setYear} label={`${year} 年${isNow ? '（到目前）' : ''}`} min={firstYear} center />

      {r.count === 0 ? <div className="card empty">這一年沒有紀錄</div> : (
        <>
          <div className="card hero" style={{ gap: 10 }}>
            <div className="stats">
              <div><span className="small muted">總收入 <Change v={r.incomeChange} good="up" /></span><b className="num income">{fmt(r.income)}</b></div>
              <div><span className="small muted">總支出 <Change v={r.expenseChange} /></span><b className="num expense">{fmt(r.expense)}</b></div>
              <div><span className="small muted">存下來</span><b className={`num ${r.net < 0 ? 'expense' : ''}`}>{fmt(r.net)}</b></div>
            </div>
            {r.savingRate != null && (
              <div>
                <div className="row-flex small"><span className="grow">儲蓄率</span><b className="num">{r.savingRate}%</b></div>
                <div className="bar done" role="progressbar" aria-label={`儲蓄率 ${r.savingRate}%`} aria-valuenow={r.savingRate} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.max(0, Math.min(100, r.savingRate))}%` }} /></div>
              </div>
            )}
            {r.prev.has && <div className="small muted">{r.prev.partial ? `去年同期（1–${r.elapsed} 月）` : '去年'}：收入 {fmt(r.prev.income)} · 支出 {fmt(r.prev.expense)} · 存下 {fmt(r.prev.net)}</div>}
          </div>

          <div className="grid2 review-tiles">
            <div className="card"><span className="small muted">一般支出平均每月</span><b className="num">{fmt(r.avgMonthlyNormal ?? 0)}</b></div>
            <div className="card"><span className="small muted">例外支出（占 {r.expense ? Math.round((r.exception / r.expense) * 100) : 0}%）</span><b className="num">{fmt(r.exception)}</b></div>
            <div className="card">
              <span className="row-flex small muted" style={{ gap: 6 }}>
                <span className="grow">淨資產變化</span>
                <button className="chip" aria-pressed={inc} onClick={() => run(() => actions.updateSettings({ worthIncludeStocks: !inc }))} style={{ minHeight: 26, fontSize: 12, padding: '0 10px' }}>含股票</button>
              </span><b className={`num ${worth.end - worth.start < 0 ? 'expense' : 'income'}`}>{worth.end - worth.start >= 0 ? '+' : '−'}{fmt(Math.abs(worth.end - worth.start))}</b><span className="small muted">{fmt(worth.start)} → {fmt(worth.end)}</span></div>
            <div className="card"><span className="small muted">記帳</span><b className="num">{r.count} 筆</b><span className="small muted">{r.days} 天有記</span></div>
            <div className="card"><span className="small muted">沒花錢的日子</span><b className="num">{d.noSpend} 天</b><span className="small muted">共 {d.tracked} 天</span></div>
            <div className="card"><span className="small muted">100 元以下的小錢</span><b className="num">{fmt(d.small.total)}</b><span className="small muted">{d.small.n} 筆 · 占 {d.small.pct}%</span></div>
          </div>

          <Section title="每個月">
            <div className="card">
              <MonthBars data={r.months.slice(0, r.elapsed || 12)} onPick={() => go('reports')} />
              <div className="small muted" style={{ marginTop: 6 }}>
                {r.maxMonth && <>花最多：<b>{Number(r.maxMonth.month.slice(5))} 月</b> {fmt(r.maxMonth.expense)}</>}
                {r.minMonth && <>　最省：<b>{Number(r.minMonth.month.slice(5))} 月</b> {fmt(r.minMonth.expense)}</>}
              </div>
            </div>
          </Section>

          <Section title="花最多的分類">
            <div className="list">
              {r.top.slice(0, 8).map((c) => (
                <div key={c.id} className="item">
                  <Tile name={categoryIcon(data.tree, c.id)} size={36} />
                  <div className="main">
                    <div className="title row-flex"><span className="grow">{c.name}</span><b className="num">{fmt(c.total)}</b></div>
                    <div className="bar-track"><i style={{ width: `${(c.total / max) * 100}%`, background: 'var(--expense)' }} /></div>
                    <div className="sub">{r.expense ? Math.round((c.total / r.expense) * 100) : 0}%{c.last ? <> · {r.prev.partial ? '去年同期' : '去年'} {fmt(c.last)} <Change v={c.change} /></> : r.prev.has ? ` · ${r.prev.partial ? '去年同期' : '去年'}沒有` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {d.subs.length > 0 && (
            <Section title="細項排行">
              <div className="list">
                {d.subs.map((c) => <Bar key={c.id} title={c.name} value={c.total} max={d.subs[0].total} sub={`${c.n} 筆`} icon={categoryIcon(data.tree, c.id)} />)}
              </div>
            </Section>
          )}

          {d.places.length > 0 && (
            <Section title="最常記的">
              <div className="list">
                {d.places.map((p) => <Bar key={p.id} title={p.name} value={p.total} max={Math.max(...d.places.map((x) => x.total))} sub={`${p.n} 次 · 平均 ${fmt(p.total / p.n)}`} />)}
              </div>
            </Section>
          )}

          <Section title="星期幾花最多">
            <div className="card" style={{ display: 'grid', gap: 6 }}>
              {d.week.map((w) => {
                const top = Math.max(...d.week.map((x) => x.total)) || 1;
                return (
                  <div key={w.day} className="row-flex small" style={{ gap: 8 }}>
                    <span style={{ width: 18 }}>{w.day}</span>
                    <div className="bar-track grow"><i style={{ width: `${(w.total / top) * 100}%`, background: w.total === top ? 'var(--expense)' : 'var(--muted)' }} /></div>
                    <span className="num" style={{ width: 84, textAlign: 'right' }}>{fmt(w.total)}</span>
                  </div>
                );
              })}
            </div>
          </Section>

          {d.pay.length > 0 && (
            <Section title="用什麼付">
              <div className="list">
                {d.pay.map((p) => <Bar key={p.id} title={p.name} value={p.total} max={d.pay[0].total} sub={`${p.pct}% · ${p.n} 筆`} />)}
              </div>
            </Section>
          )}

          {d.incomes.length > 0 && (
            <Section title="收入來源">
              <div className="list">
                {d.incomes.map((c) => <Bar key={c.id} title={c.name} value={c.total} max={d.incomes[0].total} sub={`${c.pct}%`} color="var(--income)" icon={categoryIcon(data.tree, c.id)} />)}
              </div>
            </Section>
          )}

          {d.biggest.length > 0 && (
            <Section title="最大筆的支出">
              <div className="list">
                {d.biggest.map(({ t, v }) => (
                  <button key={t.id} type="button" className="item" style={{ width: '100%', border: 0, textAlign: 'left', font: 'inherit', color: 'inherit', background: 'none' }} onClick={() => openEntry({ original: t })}>
                    <Tile name={categoryIcon(data.tree, t.category_id)} size={36} />
                    <div className="main">
                      <div className="title">{data.tree.path(t.category_id)}</div>
                      <div className="sub">{localDate(t.occurred_at).slice(5).replace('-', '/')}{t.note ? ` · ${t.note.split('\n')[0]}` : ''}</div>
                    </div>
                    <b className="num expense">{fmt(v)}</b>
                  </button>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </Page>
  );
}
