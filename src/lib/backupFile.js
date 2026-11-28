// 讀 GitHub 上的備份檔（.json.gz，或有設密碼的 .glbk），給「從備份檔還原」用
import { readBackup } from '../../scripts/backup-crypto.mjs';

const isGzip = (b) => b[0] === 0x1f && b[1] === 0x8b;
const isEncrypted = (b) => new TextDecoder().decode(b.slice(0, 5)) === 'GLBK1';

/**
 * bytes → 備份內容。askPass：加密檔才會呼叫，回傳密碼（取消就回 null）
 * 回傳 { payload, summary }；不是備份檔、密碼錯會丟錯誤
 */
export async function openBackupFile(bytes, askPass) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let payload;
  if (isGzip(b) || isEncrypted(b)) {
    const pass = isEncrypted(b) ? await askPass() : '';
    if (pass === null) return null;
    payload = await readBackup(b, pass);
  } else {
    try { payload = JSON.parse(new TextDecoder().decode(b)); } catch { throw new Error('這不是小綠記帳的備份檔'); }
  }
  if (payload?.format !== 'greenledger-backup' || !payload.data?.tables?.transactions) throw new Error('這不是小綠記帳的備份檔');
  return { payload, summary: backupSummary(payload) };
}

/** 備份裡交易最多的那個使用者有幾筆資料（備份含所有帳號，還原時用的就是這個人的） */
export function backupSummary(payload, preferUser = null) {
  const per = new Map();
  for (const [t, rows] of Object.entries(payload.data.tables)) {
    for (const r of rows) {
      const u = per.get(r.user_id) ?? {}; u[t] = (u[t] ?? 0) + 1; per.set(r.user_id, u);
    }
  }
  let user = preferUser && per.get(preferUser)?.accounts ? preferUser : null;
  if (!user) user = [...per.entries()].sort((a, b) => (b[1].transactions ?? 0) - (a[1].transactions ?? 0))[0]?.[0] ?? null;
  const c = per.get(user) ?? {};
  return {
    takenAt: payload.taken_at, user,
    transactions: c.transactions ?? 0, accounts: c.accounts ?? 0, categories: c.categories ?? 0, trades: c.stock_trades ?? 0,
  };
}
