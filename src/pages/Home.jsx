// 首頁：本月收支與結餘、淨資產（含股票市值）、待確認清單、範本、最近明細
import { BudgetCard } from './Budget.jsx';
import { useMemo, useRef, useState } from 'react';
import { useLedger } from '../store.jsx';
import { Empty, Icon, Money, Page, Section, Tile, go, useAction, useUI } from '../ui/kit.jsx';
import { TxnRow } from '../ui/TxnList.jsx';
import { counts, summarize, twdOf } from '../lib/ledger.js';
import { fmt } from '../lib/money.js';
import { addDays, dayLabel, localDate, monthRange, parseYmd, todayStr } from '../lib/dates.js';
import { describe } from '../lib/recurring.js';
import { useBackupHealth } from '../ui/useBackup.js';

export function PendingList() {
  const { data, actions } = useLedger();
  const { openEntry, openTrade, confirm, toast } = useUI();
  const [run, busy] = useAction();
  if (!data.pending.length) return null;
  const today = todayStr();

  async function quickConfirm(p) {
    const r = await run(async () => {
      try { await actions.confirmRecurring(p); return 'done'; } catch (e) { if (e.message === 'NEED_FORM') return 'form'; throw e; }
    });
    if (r === 'form') openFromPending(p); // 外幣找不到匯率 → 打開表單手動填
    else if (r === 'done') toast('已確認');
  }
  function openFromPending(p) {
    if (p.source === 'broker') { openTrade({ initial: { ...p.payload, pending_item_id: p.id } }); return; }
    if (p.source === 'shortcut') {
      const x = p.payload ?? {};
      openEntry({
        initial: {
          type: x.type ?? 'expense', amount: x.amount, note: x.note ?? '', occurred_at: x.at ?? new Date().toISOString(),
          account_id: x.account_id ?? undefined, category_id: x.category_id ?? undefined, pending_item_id: p.id, source: 'shortcut',
        },
      });
      return;
    }
    const rule = data.recurring_rules.find((r) => r.id === p.recurring_id);
    openEntry({
      initial: {
        type: rule.type, amount: rule.amount, account_id: rule.account_id, to_account_id: rule.to_account_id,
        category_id: rule.category_id, note: rule.note || rule.name, occurred_at: new Date(`${p.due_date}T00:00:00`).toISOString(),
        pending_item_id: p.id, source: 'recurring',
      },
    });
  }
  async function skip(p) {
    if (await confirm('跳過這次，不記帳？', { ok: '跳過' })) run(() => actions.skipPending(p), '已跳過');
  }

  return (
    <Section title={`待確認（${data.pending.length}）`}>
      <div className="list">
        {data.pending.map((p) => {
          const rule = data.recurring_rules.find((r) => r.id === p.recurring_id);
          const acc = data.accById.get(rule?.account_id ?? p.payload?.brokerage_account_id);
          const inbox = p.source === 'shortcut';
          const title = p.source === 'broker'
            ? `${p.payload?.side === 'sell' ? '賣出' : '買進'} ${p.payload?.symbol ?? ''} ${p.payload?.name ?? ''}`
            : p.source === 'shortcut' ? (p.payload?.note || p.payload?.category || '捷徑記的一筆')
              : rule?.name ?? '固定收支';
          const sub = p.source === 'broker' ? `券商成交 · ${p.payload?.shares ?? '?'} 股 @ ${p.payload?.price ?? '?'}`
            : p.source === 'shortcut' ? `捷徑${p.payload?.category ? ` · ${p.payload.category}（找不到這個分類）` : ''}`
              : `${describe(rule)} · ${acc?.name ?? ''}`;
          return (
            <div key={p.id} className="item" style={{ flexWrap: 'wrap' }}>
              <div className="main">
                <div className="title">{title}</div>
                <div className="sub">{dayLabel(p.due_date)}{p.due_date < today ? '（已過）' : ''} · {sub}</div>
              </div>
              {rule && <Money value={rule.amount} currency={acc?.currency} tone={rule.type === 'expense' ? 'expense' : rule.type === 'income' ? 'income' : ''} />}
              {inbox && <Money value={p.payload?.amount} currency={p.payload?.currency ?? 'TWD'} tone={p.payload?.type === 'income' ? 'income' : 'expense'} />}
              <div className="row-flex" style={{ width: '100%', justifyContent: 'flex-end' }}>
                <button className="btn small" onClick={() => skip(p)} disabled={busy}>跳過</button>
                <button className="btn small" onClick={() => openFromPending(p)} disabled={busy}>{p.source === 'broker' ? '檢查後確認' : inbox ? '確認' : '改金額'}</button>
                {p.source === 'recurring' && <button className="btn small primary" onClick={() => quickConfirm(p)} disabled={busy}>確認</button>}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function TemplateBar() {
  const { data, actions } = useLedger();
  const { openEntry, confirm } = useUI();
  const [run, busy] = useAction();
  if (!data.templates.length) return null;
  const sorted = [...data.templates].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'zh-Hant'));
  async function use(t) {
    if (t.mode === 'instant') {
      if (!(await confirm(`直接記一筆「${t.name}」${fmt(t.amount, data.accById.get(t.account_id)?.currency)}？`, { ok: '記帳' }))) return;
      run(() => actions.useInstantTemplate(t), `已記帳：${t.name}`);
    } else {
      openEntry({ initial: { type: t.type, amount: t.amount, account_id: t.account_id, to_account_id: t.to_account_id, category_id: t.category_id, note: t.note, is_exception: t.is_exception, source: 'template' } });
    }
  }
  return (
    <Section title="範本" action={<button className="link" onClick={() => go('templates')}>管理</button>}>
      <div className="chips">
        {sorted.map((t) => (
          <button key={t.id} className="chip" disabled={busy} onClick={() => use(t)}>
            {t.mode === 'instant' && <span aria-label="一鍵">⚡︎ </span>}{t.name}
          </button>
        ))}
      </div>
    </Section>
  );
}

/** 淨資產卡：可以切換含不含股票（設定會記住） */
export function WorthCard({ big = false }) {
  const { data, actions } = useLedger();
  const [run] = useAction();
  const inc = data.settings.worthIncludeStocks;
  const total = inc ? data.worth.total : data.worthNoStocks;
  return (
    <div className="card hero" style={{ gap: 6 }}>
      <div className="row-flex">
        <Tile name="layers" size={32} />
        <span className="label grow">淨資產{inc ? '（含股票）' : '（不含股票）'}</span>
        <button className="chip" aria-pressed={inc} onClick={() => run(() => actions.updateSettings({ worthIncludeStocks: !inc }))} style={{ minHeight: 30, fontSize: 13 }}>
          含股票
        </button>
      </div>
      <button className="row-flex" style={{ border: 0, background: 'none', padding: 0, textAlign: 'left' }} onClick={() => go('worth')} aria-label="看淨資產走勢">
        <span className={`num grow ${big ? 'big' : ''}`} style={big ? undefined : { fontSize: 26, fontWeight: 700 }}>{fmt(total)}</span>
        <Icon name="chev" className="chev" />
      </button>
      {inc && data.worthStocks > 0 && <div className="small muted">其中股票市值 {fmt(data.worthStocks)}</div>}
      {data.worth.missingRate.length > 0 && <div className="small" style={{ color: 'var(--warn)' }}>缺少 {data.worth.missingRate.map((a) => a.currency).join('、')} 匯率，未計入</div>}
    </div>
  );
}

const WD = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
/** 這天所在那一週（週一開始）的 7 天 */
function weekOf(day) {
  const d = parseYmd(day);
  const back = (d.getDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => addDays(day, i - back));
}

export default function Home() {
  const { data, user, actions } = useLedger();
  const [run] = useAction();
  const incExc = data.settings.includeExceptions !== false;
  const { openEntry } = useUI();
  const today = todayStr();
  const [day, setDay] = useState(today);
  const touch = useRef(null);
  const month = day.slice(0, 7);
  const s = useMemo(() => summarize(data.transactions, data.accById, { ...monthRange(month), includeExceptions: data.settings.includeExceptions }), [data, month]);
  const { homeShowWorth, homeShowTemplates, homeShowBudget } = data.settings;
  const week = weekOf(day);
  const byDay = useMemo(() => {
    const m = new Map();
    for (const t of data.transactions) { const k = localDate(t.occurred_at); if (!m.has(k)) m.set(k, []); m.get(k).push(t); }
    return m;
  }, [data.transactions]);
  const dayTxns = byDay.get(day) ?? [];
  let dayExp = 0; let dayInc = 0;
  for (const t of dayTxns) {
    if (!counts(t, data.accById, true)) continue;
    if (t.type === 'expense') dayExp += twdOf(t); else dayInc += twdOf(t);
  }
  const shiftWeek = (n) => setDay(addDays(day, 7 * n));
  const [y, m] = month.split('-').map(Number);

  const backup = useBackupHealth();
  const add = () => openEntry(day === today ? {} : { initial: { type: 'expense', occurred_at: new Date(`${day}T12:00:00`).toISOString() } });

  return (
    <Page title={<>{y} 年 {m} 月{user.demo && <span className="small muted">（試用）</span>}</>} right={<>
      <label className="iconbtn" aria-label="選日期" style={{ position: 'relative' }}>
        <Icon name="calendar" />
        <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} style={{ position: 'absolute', inset: 0, opacity: 0 }} aria-label="選日期" />
      </label>
      <button className="iconbtn" aria-label="設定" onClick={() => go('settings')}><Icon name="gear" /></button>
    </>}>
      {backup?.warning && (
        <button type="button" className="notice warn row-flex" style={{ width: '100%', textAlign: 'left', font: 'inherit', border: 0, cursor: 'pointer' }} onClick={() => go('settings')}>
          <span className="grow">備份提醒：{backup.warning}</span><Icon name="chev" className="chev" />
        </button>
      )}
      {homeShowWorth && <WorthCard />}
      <div className="card" style={{ padding: '10px 8px 14px', display: 'grid', gap: 12 }}
        onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => { const dx = e.changedTouches[0].clientX - (touch.current ?? 0); if (Math.abs(dx) > 50) shiftWeek(dx < 0 ? 1 : -1); touch.current = null; }}>
        <div className="week">
          <button className="iconbtn" aria-label="上一週" onClick={() => shiftWeek(-1)}><Icon name="back" /></button>
          {week.map((d, i) => (
            <button key={d} className={`day ${d === today ? 'today' : ''} ${d > today ? 'future' : ''}`} aria-pressed={d === day} onClick={() => setDay(d)} aria-label={dayLabel(d)}>
              <span className="wd">{WD[i]}</span>
              <span className="dn">{Number(d.slice(8))}</span>
              <span className="dot" style={{ visibility: byDay.has(d) ? 'visible' : 'hidden' }} />
            </button>
          ))}
          <button className="iconbtn" aria-label="下一週" onClick={() => shiftWeek(1)}><Icon name="chev" /></button>
        </div>
        <div className="row-flex" style={{ padding: '0 8px' }}>
          <span className="label small muted grow">{m} 月收支{incExc ? '（含例外）' : '（不含例外）'}</span>
          <button className="chip" aria-pressed={incExc} onClick={() => run(() => actions.updateSettings({ includeExceptions: !incExc }))} style={{ minHeight: 30, fontSize: 13 }}>
            含例外
          </button>
        </div>
        <div className="stats" style={{ padding: '0 8px' }}>
          <div className="stat"><Tile name="arrowDown" tone="solid income" round size={26} /><span className="label small muted">{m} 月收入</span><b className="num income">{fmt(s.income)}</b></div>
          <div className="stat"><Tile name="arrowUp" tone="solid expense" round size={26} /><span className="label small muted">{m} 月支出</span><b className="num expense">{fmt(s.expense)}</b></div>
          <div className="stat"><Tile name="wallet" tone="solid" round size={26} /><span className="label small muted">結餘</span><b className={`num ${s.net < 0 ? 'expense' : ''}`}>{fmt(s.net)}</b></div>
        </div>
        {day !== today && <button className="link" style={{ justifySelf: 'center', padding: 0 }} onClick={() => setDay(today)}>回到今天</button>}
      </div>

      {homeShowBudget && <BudgetCard month={month} />}

      <button className="btn primary block" style={{ minHeight: 52, fontSize: 17 }} onClick={add}>
        <Icon name="plus" className="chev" />記一筆{day !== today ? `（${dayLabel(day)}）` : ''}
      </button>

      <Section title={<>{dayLabel(day)}{day === today ? ' 今天' : ''}<span className="num" style={{ marginLeft: 'auto', fontWeight: 400 }}>
        {dayExp > 0 && <span className="expense">支出 {fmt(dayExp)}</span>}{dayExp > 0 && dayInc > 0 && ' · '}{dayInc > 0 && <span className="income">收入 {fmt(dayInc)}</span>}
      </span></>}>
        {dayTxns.length
          ? <div className="list">{dayTxns.map((t) => <TxnRow key={t.id} t={t} />)}</div>
          : <div className="list"><Empty>{data.transactions.length ? '這天沒有紀錄' : '還沒有紀錄'}</Empty></div>}
      </Section>

      <PendingList />
      {homeShowTemplates && <TemplateBar />}
    </Page>
  );
}
