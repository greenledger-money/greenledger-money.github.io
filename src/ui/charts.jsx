// 圖表：圓環（分類占比，可往下鑽）、每月收支長條、淨資產折線。
// 手寫 SVG，依實際寬度重畫；滑過或點一下會顯示數值。
import { useEffect, useRef, useState } from 'react';
import { fmt } from '../lib/money.js';
import { Icon, Tile } from './kit.jsx';

export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
const OTHER = 'var(--s-other)';

function useWidth(ref) {
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** 12345 → '1.2萬' */
export function short(v) {
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  if (a >= 1e8) return `${s}${+(a / 1e8).toFixed(1)}億`;
  if (a >= 1e4) return `${s}${+(a / 1e4).toFixed(1)}萬`;
  return `${s}${Math.round(a).toLocaleString('en-US')}`;
}

function niceTicks(min, max, count = 4) {
  if (min === max) { max = min + 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return { lo, hi, ticks };
}

// ---------------------------------------------------------------------
// 圓環：rows = [{ id, name, total, drillable }]，超過 8 塊時第 8 塊起併成「其他」
// ---------------------------------------------------------------------
export function Donut({ rows, onPick, onSelect, selected, centerLabel = '合計', kind = 'expense', iconOf }) {
  const [hover, setHover] = useState(null);
  const total = rows.reduce((s, r) => s + r.total, 0);
  let slices = rows;
  if (rows.length > 8) {
    const rest = rows.slice(7);
    slices = [...rows.slice(0, 7), { id: '__other', name: `其他 ${rest.length} 項`, total: rest.reduce((s, r) => s + r.total, 0), drillable: false, other: true }];
  }
  const colored = slices.map((r, i) => ({ ...r, color: r.other ? OTHER : SERIES[i] }));
  // 清單列出全部分類（圓環裡併成「其他」的那些用灰色），每一項都可以點進去
  const listed = rows.map((r, i) => ({ ...r, color: rows.length > 8 && i >= 7 ? OTHER : SERIES[i] }));
  const W = 340; const H = 240; const cx = W / 2; const cy = H / 2; const R = 100; const r0 = 66;
  let a0 = -Math.PI / 2;
  const gap = colored.length > 1 ? 0.012 : 0;
  const arcs = total > 0 ? colored.map((s) => {
    const a1 = a0 + (s.total / total) * Math.PI * 2;
    const p = (a, rad) => `${cx + rad * Math.cos(a)} ${cy + rad * Math.sin(a)}`;
    const s0 = a0 + gap; const s1 = Math.max(s0, a1 - gap);
    const large = s1 - s0 > Math.PI ? 1 : 0;
    const d = colored.length === 1
      ? `M ${cx} ${cy - R} A ${R} ${R} 0 1 1 ${cx - 0.01} ${cy - R} L ${cx - 0.01} ${cy - r0} A ${r0} ${r0} 0 1 0 ${cx} ${cy - r0} Z`
      : `M ${p(s0, R)} A ${R} ${R} 0 ${large} 1 ${p(s1, R)} L ${p(s1, r0)} A ${r0} ${r0} 0 ${large} 0 ${p(s0, r0)} Z`;
    const arc = { ...s, d, mid: (a0 + a1) / 2, share: s.total / total };
    a0 = a1;
    return arc;
  }) : [];
  // 前三大（占比 4% 以上）在圓環外標百分比和名稱
  const labeled = [...arcs].filter((s) => !s.other && s.share >= 0.04).sort((x, y) => y.total - x.total).slice(0, 3);
  const h = hover != null ? colored.find((s) => s.id === hover) : null;
  const sign = kind === 'expense' ? '-' : '+';

  return (
    <div className="donut-wrap">
      <svg className="donut-fig" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="分類占比圓環圖">
        {total === 0 && <circle cx={cx} cy={cy} r={(R + r0) / 2} fill="none" stroke="var(--grid)" strokeWidth={R - r0} />}
        {arcs.map((s) => (
          <path key={s.id} d={s.d} fill={s.color}
            opacity={hover && hover !== s.id ? 0.35 : 1} style={{ cursor: s.drillable || onSelect ? 'pointer' : 'default', transition: 'opacity .15s' }}
            onPointerEnter={() => setHover(s.id)} onPointerLeave={() => setHover(null)}
            onClick={() => (s.drillable ? onPick?.(s) : onSelect ? onSelect(s) : setHover(hover === s.id ? null : s.id))} />
        ))}
        {labeled.map((s) => {
          const x = cx + (R + 16) * Math.cos(s.mid); const y = cy + (R + 16) * Math.sin(s.mid);
          const anchor = Math.cos(s.mid) > 0.25 ? 'start' : Math.cos(s.mid) < -0.25 ? 'end' : 'middle';
          const nm = s.name.length > 6 ? `${s.name.slice(0, 6)}…` : s.name;
          return (
            <g key={`l${s.id}`} pointerEvents="none">
              <text x={x} y={y - 2} textAnchor={anchor} fontSize="13" fontWeight="700" fill="var(--ink)" className="num">{(s.share * 100).toFixed(1)}</text>
              <text x={x} y={y + 13} textAnchor={anchor} fontSize="11" fill="var(--ink-2)">{nm}</text>
            </g>
          );
        })}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize="13" fill="var(--ink-2)">{h ? h.name : centerLabel}</text>
        <text x={cx} y={cy + 18} textAnchor="middle" fontSize="21" fontWeight="800" fill="var(--ink)" className="num">
          {h ? `${((h.total / total) * 100).toFixed(1)}%` : fmt(total)}
        </text>
      </svg>
      <div className="dlist">
        {listed.length === 0 && <div className="empty">這段期間沒有資料</div>}
        {listed.map((s) => {
          const share = total ? s.total / total : 0;
          const icon = iconOf?.(s);
          const body = (
            <>
              <span className="dbar" style={{ background: s.color }} />
              {icon && <Tile name={icon} tone={kind === 'income' ? 'income' : ''} round size={40} />}
              <span className="title grow">{s.name}</span>
              <span className="dval">
                <b className={`num ${kind}`}>{sign}{fmt(s.total)}</b>
                <span className="small muted num">{(share * 100).toFixed(1)}%</span>
              </span>
              {(s.drillable || onSelect) && <Icon name="chev" className="chev" />}
            </>
          );
          const click = s.drillable ? () => onPick?.(s) : onSelect ? () => onSelect(s) : null;
          const cls = `drow ${selected === s.id ? 'sel' : ''}`;
          return click
            ? <button key={s.id} type="button" className={cls} onClick={click} onPointerEnter={() => setHover(s.id)} onPointerLeave={() => setHover(null)}>{body}</button>
            : <div key={s.id} className={cls} onPointerEnter={() => setHover(s.id)} onPointerLeave={() => setHover(null)}>{body}</div>;
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 每月收支：兩組長條（收入、支出），hover 顯示當月數字
// ---------------------------------------------------------------------
export function MonthBars({ data, height = 210, onPick }) {
  const ref = useRef(null);
  const W = useWidth(ref);
  const [hi, setHi] = useState(null);
  const padL = 44; const padB = 24; const padT = 8;
  const max = Math.max(1, ...data.flatMap((d) => [d.income, d.expense]));
  const { hi: top, ticks } = niceTicks(0, max, 4);
  const plotW = Math.max(0, W - padL - 4); const plotH = height - padB - padT;
  const band = data.length ? plotW / data.length : 0;
  const bw = Math.max(3, Math.min(14, band / 3 - 2));
  const y = (v) => padT + plotH - (v / top) * plotH;
  const narrow = W < 420;
  const bar = (x, v, color) => {
    const h = Math.max(0, plotH - (y(v) - padT));
    if (h <= 0) return null;
    const r = Math.min(4, h, bw / 2);
    const yy = y(v); const b = padT + plotH;
    return <path d={`M${x} ${b}V${yy + r}Q${x} ${yy} ${x + r} ${yy}H${x + bw - r}Q${x + bw} ${yy} ${x + bw} ${yy + r}V${b}Z`} fill={color} />;
  };
  const d = hi != null ? data[hi] : null;
  return (
    <div>
      <div className="legend" style={{ marginBottom: 8 }}>
        <span><i className="dot" style={{ background: 'var(--income)' }} />收入</span>
        <span><i className="dot" style={{ background: 'var(--expense)' }} />支出</span>
      </div>
      <div className="fig" ref={ref} style={{ height }}>
        {W > 0 && (
          <svg width={W} height={height} role="img" aria-label="每月收支長條圖" onPointerLeave={() => setHi(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--axis)' : 'var(--grid)'} strokeWidth="1" />
                <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{short(t)}</text>
              </g>
            ))}
            {data.map((m, i) => {
              const x0 = padL + i * band;
              const cx = x0 + band / 2;
              return (
                <g key={m.month}>
                  {hi === i && <rect x={x0} y={padT} width={band} height={plotH} fill="var(--surface-2)" />}
                  {bar(cx - bw - 1, m.income, 'var(--income)')}
                  {bar(cx + 1, m.expense, 'var(--expense)')}
                  {(!narrow || i % 2 === (data.length - 1) % 2) && (
                    <text x={cx} y={height - 6} textAnchor="middle" fontSize="11" fill="var(--muted)">{Number(m.month.slice(5))}月</text>
                  )}
                  <rect x={x0} y={0} width={band} height={height} fill="transparent" style={{ cursor: onPick ? 'pointer' : 'default' }} onPointerEnter={() => setHi(i)} onClick={() => { setHi(i); onPick?.(m.month); }} />
                </g>
              );
            })}
          </svg>
        )}
        {d && (
          <div className="tip" style={{ left: Math.min(W - 70, Math.max(70, padL + (hi + 0.5) * band)), top: padT + 4, transform: 'translate(-50%, 0)' }}>
            <b>{d.month.replace('-', ' 年 ')} 月</b><br />收入 {fmt(d.income)}<br />支出 {fmt(d.expense)}<br />結餘 {fmt(d.net, 'TWD', { sign: true })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 淨資產走勢：折線＋十字線
// ---------------------------------------------------------------------
export function LineChart({ data, height = 190, label = '淨資產' }) {
  const ref = useRef(null);
  const W = useWidth(ref);
  const [hi, setHi] = useState(null);
  const padL = 48; const padB = 24; const padT = 10; const padR = 8;
  const vals = data.map((d) => d.total);
  const { lo, hi: top, ticks } = niceTicks(Math.min(0, ...vals), Math.max(...vals, 1), 4);
  const plotW = Math.max(0, W - padL - padR); const plotH = height - padB - padT;
  const x = (i) => padL + (data.length <= 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = (v) => padT + plotH - ((v - lo) / (top - lo)) * plotH;
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(i)} ${y(d.total)}`).join('');
  const narrow = W < 420;
  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px - padL) / plotW) * (data.length - 1));
    setHi(Math.max(0, Math.min(data.length - 1, i)));
  };
  const d = hi != null ? data[hi] : null;
  return (
    <div className="fig" ref={ref} style={{ height }}>
      {W > 0 && (
        <svg width={W} height={height} role="img" aria-label={`${label}走勢`} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHi(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--axis)' : 'var(--grid)'} />
              <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{short(t)}</text>
            </g>
          ))}
          {data.map((m, i) => {
            // 一年內：每月（窄螢幕隔月）；超過一年：只標每年一月和最後一個月
            const long = data.length > 13;
            const show = long ? (m.month.endsWith('-01') || i === data.length - 1) && !(i === data.length - 1 && data.length - 1 - data.findLastIndex((z) => z.month.endsWith('-01')) < 3 && !m.month.endsWith('-01'))
              : (!narrow || i % 2 === (data.length - 1) % 2);
            const text = long ? (m.month.endsWith('-01') ? `${m.month.slice(2, 4)}年` : `${Number(m.month.slice(5))}月`) : `${Number(m.month.slice(5))}月`;
            return show && <text key={m.month} x={x(i)} y={height - 6} textAnchor="middle" fontSize="11" fill="var(--muted)">{text}</text>;
          })}
          <path d={path} fill="none" stroke="var(--s1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {d && (
            <>
              <line x1={x(hi)} x2={x(hi)} y1={padT} y2={padT + plotH} stroke="var(--axis)" />
              <circle cx={x(hi)} cy={y(d.total)} r="5" fill="var(--s1)" stroke="var(--surface)" strokeWidth="2" />
            </>
          )}
          {!d && data.length > 0 && <circle cx={x(data.length - 1)} cy={y(vals[vals.length - 1])} r="4" fill="var(--s1)" stroke="var(--surface)" strokeWidth="2" />}
        </svg>
      )}
      {d && (
        <div className="tip" style={{ left: Math.min(W - 60, Math.max(60, x(hi))), top: y(d.total) }}>
          {d.month.replace('-', ' 年 ')} 月底<br /><b>{fmt(d.total)}</b>
        </div>
      )}
    </div>
  );
}
