// 點年月直接選：月 → 先選年（左右切）再點月份；年 → 點年份
import { useMemo, useState } from 'react';
import { useLedger } from '../store.jsx';
import { Icon, Sheet } from './kit.jsx';
import { localDate, thisMonth } from '../lib/dates.js';

/** 有紀錄的年份範圍：最早一筆那年 ～ 今年 */
export function useYearRange() {
  const { data } = useLedger();
  return useMemo(() => {
    const now = Number(thisMonth().slice(0, 4));
    const oldest = data.transactions[data.transactions.length - 1]; // 由新到舊排
    const first = oldest ? Number(localDate(oldest.occurred_at).slice(0, 4)) : now;
    return { first: Math.min(first, now), last: now };
  }, [data.transactions]);
}

/**
 * mode：'month'（value 'YYYY-MM'）或 'year'（value 數字）
 * onPick(value) 之後自動關閉
 */
export function PeriodPicker({ mode, value, onPick, onClose }) {
  const { first, last } = useYearRange();
  const now = thisMonth();
  const [year, setYear] = useState(mode === 'month' ? Number(value.slice(0, 4)) : value);
  const pick = (v) => { onPick(v); onClose(); };
  const years = [];
  for (let y = last; y >= first; y--) years.push(y);

  return (
    <Sheet title={mode === 'month' ? '選月份' : '選年份'} onClose={onClose}>
      {mode === 'month' ? (
        <div className="period-pick">
          <div className="monthnav" style={{ justifyContent: 'center' }}>
            <button className="iconbtn" aria-label="前一年" disabled={year <= first} onClick={() => setYear(year - 1)}><Icon name="back" /></button>
            <b>{year} 年</b>
            <button className="iconbtn" aria-label="後一年" disabled={year >= last} onClick={() => setYear(year + 1)}><Icon name="chev" /></button>
          </div>
          <div className="pgrid">
            {Array.from({ length: 12 }, (_, i) => {
              const key = `${year}-${String(i + 1).padStart(2, '0')}`;
              return (
                <button key={key} type="button" aria-pressed={key === value} disabled={key > now}
                  className={key === now ? 'now' : ''} onClick={() => pick(key)}>{i + 1} 月</button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="pgrid">
          {years.map((y) => (
            <button key={y} type="button" aria-pressed={y === value} className={y === last ? 'now' : ''} onClick={() => pick(y)}>{y} 年</button>
          ))}
        </div>
      )}
    </Sheet>
  );
}

/** 左右箭頭＋中間可以點的年月 */
export function PeriodNav({ mode, value, onChange, label, min, max, center = false }) {
  const [open, setOpen] = useState(false);
  const { first, last } = useYearRange();
  const shift = (n) => {
    if (mode === 'year') return onChange(value + n);
    const d = new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1 + n, 1);
    onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const lo = min ?? (mode === 'year' ? first : null);
  const hi = max ?? (mode === 'year' ? last : null);
  return (
    <div className="monthnav" style={center ? { justifyContent: 'center' } : undefined}>
      <button className="iconbtn" aria-label="往前" disabled={lo != null && value <= lo} onClick={() => shift(-1)}><Icon name="back" /></button>
      <button type="button" className="period-label" aria-haspopup="dialog" aria-label={`${label}，點一下選${mode === 'month' ? '月份' : '年份'}`} onClick={() => setOpen(true)}>
        <b>{label}</b><Icon name="chev" className="caret" />
      </button>
      <button className="iconbtn" aria-label="往後" disabled={hi != null && value >= hi} onClick={() => shift(1)}><Icon name="chev" /></button>
      {open && <PeriodPicker mode={mode} value={value} onPick={onChange} onClose={() => setOpen(false)} />}
    </div>
  );
}
