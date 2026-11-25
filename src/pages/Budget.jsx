// 預算：一般支出每月一個額度、例外一年一個額度；主分類可以另外設
import { useMemo, useState } from 'react';
import { useLedger } from '../store.jsx';
import { Icon, Page, Section, Tile, categoryIcon, go, useAction } from '../ui/kit.jsx';
import { fmt } from '../lib/money.js';
import { monthLabel, monthRange, shiftMonth, thisMonth, todayStr } from '../lib/dates.js';
import { daysLeft, meter, monthsLeft, readBudget, spending } from '../lib/budget.js';

/** 一條預算進度：已花／額度、進度條、剩多少；per＝{ n, text } 平均下來每天／每月可花 */
export function Meter({ label, m, per, compact = false, onClick }) {
  if (!m) return null;
  const pct = Math.min(100, Math.round(m.ratio * 100));
  const body = (
    <>
      <div className="row-flex" style={{ gap: 8 }}>
        <span className="grow" style={{ fontWeight: compact ? 500 : 600 }}>{label}</span>
        <span className="num small"><b>{fmt(m.spent)}</b><span className="muted"> / {fmt(m.limit)}</span></span>
      </div>
      <div className={`bar ${m.level}`} role="progressbar" aria-label={`${label}已用 ${pct}%`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="small row-flex" style={{ gap: 8 }}>
        {m.over
          ? <span className="grow" style={{ color: 'var(--expense)', fontWeight: 600 }}>超支 {fmt(-m.left)}</span>
          : <span className="grow muted">還剩 <b className="num" style={{ color: m.level === 'warn' ? 'var(--warn)' : 'var(--ink)' }}>{fmt(m.left)}</b></span>}
        {!m.over && per?.n ? <span className="muted">{per.text} <b className="num" style={{ color: 'var(--ink)' }}>{fmt(Math.floor(m.left / per.n))}</b></span> : null}
        {!per?.n && <span className="muted">{Math.round(m.ratio * 100)}%</span>}
      </div>
    </>
  );
  return onClick
    ? <button type="button" className="meter" onClick={onClick}>{body}</button>
    : <div className="meter">{body}</div>;
}

const yearRange = (y) => ({ from: new Date(y, 0, 1), to: new Date(y + 1, 0, 1) });
function useBudgetNumbers(month) {
  const { data } = useLedger();
  const b = readBudget(data.settings);
  const year = Number(month.slice(0, 4));
  const s = useMemo(() => spending({ txns: data.transactions, accById: data.accById, tree: data.tree, ...monthRange(month) }), [data, month]);
  const ys = useMemo(() => spending({ txns: data.transactions, accById: data.accById, tree: data.tree, ...yearRange(year) }), [data, year]);
  const today = todayStr();
  const days = daysLeft(month, today);
  const months = monthsLeft(year, today);
  return {
    b, s, ys, year,
    mt: meter(s.normal, b.total), me: meter(ys.exception, b.exceptionYear),
    perDay: days ? { n: days, text: '每天可花' } : null,
    perMonth: months ? { n: months, text: '之後每月可用' } : null,
  };
}

/** 首頁的預算卡 */
export function BudgetCard({ month }) {
  const { mt, me, perDay, perMonth, year } = useBudgetNumbers(month);
  if (!mt && !me) {
    return (
      <button type="button" className="card row-flex" style={{ border: 0, textAlign: 'left', gap: 12 }} onClick={() => go('budget')}>
        <Tile name="wallet" /><span className="grow"><b>設定預算</b><div className="small muted">一般支出每月、例外每年，看每天還能花多少</div></span>
        <Icon name="chev" className="chev" />
      </button>
    );
  }
  return (
    <div className="card" style={{ display: 'grid', gap: 14 }}>
      <Meter label={`${Number(month.slice(5))} 月預算`} m={mt} per={perDay} onClick={() => go('budget')} />
      <Meter label={`${year} 年例外預算`} m={me} per={perMonth} compact onClick={() => go('budget')} />
    </div>
  );
}

function MoneyInput({ value, onCommit, label, placeholder = '不設' }) {
  const [v, setV] = useState(value ? String(value) : '');
  const commit = () => { const n = Math.round(Number(v.replace(/[,\s$]/g, ''))); onCommit(n > 0 ? n : 0); setV(n > 0 ? String(n) : ''); };
  return (
    <input className="input num" inputMode="numeric" aria-label={label} value={v} placeholder={placeholder} style={{ textAlign: 'right', maxWidth: 140 }}
      onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
  );
}

export default function Budget() {
  const { data, actions } = useLedger();
  const [run] = useAction();
  const [month, setMonth] = useState(thisMonth());
  const { b, s, mt, me, perDay, perMonth, year } = useBudgetNumbers(month);
  const save = (patch) => {
    const next = { total: b.total, exceptionYear: b.exceptionYear, categories: b.categories, ...patch };
    return run(() => actions.updateSettings({ budget: next }), '預算已更新');
  };
  const setCat = (id, n) => { const categories = { ...b.categories }; if (n > 0) categories[id] = n; else delete categories[id]; save({ categories }); };
  const roots = data.tree.roots.expense.filter((n) => !n.archived || b.categories[n.id] || s.byRoot.get(n.id));
  const catTotal = Object.values(b.categories).reduce((x, v) => x + v, 0);

  return (
    <Page title="預算" onBack={() => go('more')}>
      <div className="monthnav" style={{ justifyContent: 'center' }}>
        <button className="iconbtn" aria-label="上個月" onClick={() => setMonth(shiftMonth(month, -1))}><Icon name="back" /></button>
        <b>{monthLabel(month)}</b>
        <button className="iconbtn" aria-label="下個月" onClick={() => setMonth(shiftMonth(month, 1))}><Icon name="chev" /></button>
      </div>

      <Section title="預算額度">
        <div className="list">
          <div className="item"><Tile name="wallet" /><div className="main"><div className="title">一般支出（每月）</div><div className="sub">沒勾「例外」的支出</div></div>
            <MoneyInput key={`t${b.total}`} label="一般支出每月預算" value={b.total} onCommit={(n) => n !== b.total && save({ total: n })} /></div>
          <div className="item"><Tile name="calendar" /><div className="main"><div className="title">例外（每年）</div><div className="sub">有勾「例外」的支出，整年一起算</div></div>
            <MoneyInput key={`e${b.exceptionYear}`} label="例外每年預算" value={b.exceptionYear} onCommit={(n) => n !== b.exceptionYear && save({ exceptionYear: n })} /></div>
        </div>
        <p className="small muted" style={{ margin: '6px 4px 0' }}>留空就是不設。例外像旅行、修手機這種不規律的，用一整年來看：某個月花很多沒關係，全年沒超過就好。股票虧損不算在預算裡。</p>
      </Section>

      {(mt || me) && (
        <Section title="狀況">
          <div className="card" style={{ display: 'grid', gap: 16 }}>
            <Meter label={`${monthLabel(month)}一般支出`} m={mt} per={perDay} />
            <Meter label={`${year} 年例外`} m={me} per={perMonth} />
          </div>
        </Section>
      )}
      <Section title={<>分類預算（選填）{catTotal > 0 && <span className="num small muted" style={{ marginLeft: 'auto', fontWeight: 400 }}>合計 {fmt(catTotal)}{b.total > 0 && catTotal > b.total ? '（超過總預算）' : ''}</span>}</>}>
        <div className="list">
          {roots.map((n) => {
            const m = meter(s.byRoot.get(n.id) ?? 0, b.categories[n.id]);
            return (
              <div key={n.id} className="item" style={{ display: 'grid', gap: 8 }}>
                <div className="row-flex" style={{ gap: 12 }}>
                  <Tile name={categoryIcon(data.tree, n.id)} />
                  <div className="main"><div className="title">{n.name}</div>{!m && <div className="sub">本月 {fmt(s.byRoot.get(n.id) ?? 0)}</div>}</div>
                  <MoneyInput key={`${n.id}${b.categories[n.id] ?? 0}`} label={`${n.name}每月預算`} value={b.categories[n.id]} onCommit={(v) => v !== (b.categories[n.id] ?? 0) && setCat(n.id, v)} />
                </div>
                {m && <Meter label="" m={m} per={perDay} compact />}
              </div>
            );
          })}
        </div>
        <p className="small muted" style={{ margin: '6px 4px 0' }}>分類預算只算一般支出（不含例外），包含底下所有子分類。</p>
      </Section>
    </Page>
  );
}
