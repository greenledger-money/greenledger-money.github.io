// 存錢目標：連結帳戶（看帳戶餘額）或手動記已存多少；算出進度與每月要存多少

/** 從這個月到 deadline（YYYY-MM）還有幾個月，含這個月；過了回傳 0 */
export function monthsUntil(deadline, nowKey) {
  if (!deadline) return null;
  const n = (Number(deadline.slice(0, 4)) - Number(nowKey.slice(0, 4))) * 12 + Number(deadline.slice(5, 7)) - Number(nowKey.slice(5, 7)) + 1;
  return Math.max(0, n);
}

/**
 * goal: { target, deadline?, accountIds?: [], saved? }
 * twdOfAccount(id) → 帳戶目前台幣價值
 */
export function goalProgress(goal, twdOfAccount, nowKey) {
  const linked = (goal.accountIds ?? []).filter(Boolean);
  const current = Math.round((linked.length ? linked.reduce((x, id) => x + (twdOfAccount(id) ?? 0), 0) : Number(goal.saved) || 0) * 100) / 100;
  const target = Number(goal.target) || 0;
  const left = Math.max(0, Math.round((target - current) * 100) / 100);
  const months = monthsUntil(goal.deadline, nowKey);
  const done = target > 0 && current >= target;
  return {
    current, target, left, done, linked: linked.length > 0,
    ratio: target > 0 ? Math.max(0, Math.min(1, current / target)) : 0,
    months, late: months === 0 && !done,
    perMonth: !done && months ? Math.ceil(left / months) : null,
  };
}
