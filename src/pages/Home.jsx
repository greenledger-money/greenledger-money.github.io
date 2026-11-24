// 首頁：本月收支與結餘、淨資產（含股票市值）、待確認清單、範本、最近明細
import { useMemo } from 'react';
import { useLedger } from '../store.jsx';
import { Empty, Icon, Money, Page, Section, go, useAction, useUI } from '../ui/kit.jsx';
import { TxnList } from '../ui/TxnList.jsx';
import { summarize } from '../lib/ledger.js';
import { fmt } from '../lib/money.js';
import { dayLabel, monthRange, thisMonth, todayStr } from '../lib/dates.js';
import { describe } from '../lib/recurring.js';

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
          const title = p.source === 'broker'
            ? `${p.payload?.side === 'sell' ? '賣出' : '買進'} ${p.payload?.symbol ?? ''} ${p.payload?.name ?? ''}`
            : rule?.name ?? '固定收支';
          const sub = p.source === 'broker' ? `券商成交 · ${p.payload?.shares ?? '?'} 股 @ ${p.payload?.price ?? '?'}` : `${describe(rule)} · ${acc?.name ?? ''}`;
          return (
            <div key={p.id} className="item" style={{ flexWrap: 'wrap' }}>
              <div className="main">
                <div className="title">{title}</div>
                <div className="sub">{dayLabel(p.due_date)}{p.due_date < today ? '（已過）' : ''} · {sub}</div>
              </div>
              {rule && <Money value={rule.amount} currency={acc?.currency} tone={rule.type === 'expense' ? 'expense' : rule.type === 'income' ? 'income' : ''} />}
              <div className="row-flex" style={{ width: '100%', justifyContent: 'flex-end' }}>
                <button className="btn small" onClick={() => skip(p)} disabled={busy}>跳過</button>
                <button className="btn small" onClick={() => openFromPending(p)} disabled={busy}>{p.source === 'broker' ? '檢查後確認' : '改金額'}</button>
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

export default function Home() {
  const { data, user } = useLedger();
  const month = thisMonth();
  const s = useMemo(() => summarize(data.transactions, data.accById, { ...monthRange(month), includeExceptions: data.settings.includeExceptions }), [data, month]);
  const stockTotal = [...data.stockValue.values()].reduce((x, v) => x + v.twd, 0);
  const { homeShowWorth, homeShowTemplates, homeRecentCount } = data.settings;
  const recent = data.transactions.filter((t) => Date.parse(t.occurred_at) <= Date.now() + 864e5).slice(0, Number(homeRecentCount) || 0);
  const m = Number(month.slice(5));

  return (
    <Page title={user.demo ? '記帳（試用）' : '記帳'} right={<button className="iconbtn" aria-label="設定" onClick={() => go('settings')}><Icon name="gear" /></button>}>
      <div className="card hero">
        <div>
          <div className="label">{m} 月支出{data.settings.includeExceptions ? '' : '（不含例外）'}</div>
          <div className="big num">{fmt(s.expense)}</div>
        </div>
        <div className="stats">
          <div><span className="label">收入</span><b className="num income">{fmt(s.income)}</b></div>
          <div><span className="label">結餘</span><b className={`num ${s.net < 0 ? 'expense' : ''}`}>{fmt(s.net)}</b></div>
          <div><button className="link" style={{ padding: 0, textAlign: 'left' }} onClick={() => go('reports')}>看報表 ›</button></div>
        </div>
      </div>

      {homeShowWorth && <button className="card hero" style={{ border: 0, textAlign: 'left', width: '100%' }} onClick={() => go('accounts')}>
        <div className="row-flex">
          <div className="grow">
            <div className="label">淨資產</div>
            <div className="num" style={{ fontSize: 26, fontWeight: 700 }}>{fmt(data.worth.total)}</div>
            {stockTotal > 0 && <div className="small muted">含股票市值 {fmt(stockTotal)}</div>}
            {data.worth.missingRate.length > 0 && <div className="small" style={{ color: 'var(--warn)' }}>{data.worth.missingRate.map((a) => a.currency).join('、')} 沒有匯率，暫時沒算進去</div>}
          </div>
          <Icon name="chev" className="chev" />
        </div>
      </button>}

      <PendingList />
      {homeShowTemplates && <TemplateBar />}

      {Number(homeRecentCount) > 0 && <Section title="最近明細" action={<button className="link" onClick={() => go('transactions')}>全部</button>}>
        {recent.length ? <TxnList txns={recent} dayTotals={false} /> : (
          <div className="list"><Empty>還沒有紀錄。按下方 <b>＋</b> 記第一筆，或到「更多 › 從 CWMoney 匯入」。</Empty></div>
        )}
      </Section>}
    </Page>
  );
}

