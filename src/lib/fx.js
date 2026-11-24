// 匯率查詢：當天沒有就用「最近的前一天」。台幣永遠是 1。

export function makeFx(rows = []) {
  const byCur = new Map();
  for (const r of rows) {
    if (!byCur.has(r.currency)) byCur.set(r.currency, []);
    byCur.get(r.currency).push({ date: r.rate_date, rate: Number(r.rate) });
  }
  for (const list of byCur.values()) list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  /** 回傳 { rate, date } 或 null（完全沒有資料時） */
  function lookup(currency, date) {
    if (!currency || currency === 'TWD') return { rate: 1, date };
    const list = byCur.get(currency);
    if (!list?.length) return null;
    let lo = 0; let hi = list.length - 1; let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].date <= date) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans >= 0 ? list[ans] : null;
  }
  const rateOn = (currency, date) => lookup(currency, date)?.rate ?? null;
  const latest = (currency) => {
    if (!currency || currency === 'TWD') return 1;
    const list = byCur.get(currency);
    return list?.length ? list[list.length - 1].rate : null;
  };
  return { lookup, rateOn, latest, currencies: [...byCur.keys()] };
}
