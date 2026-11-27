// 自動備份的狀態：資料庫快照、異地備份（GitHub 私人 repo）多久以前成功，該不該提醒
import { updatedLabel } from './dates.js';

const STALE_H = 48; // 超過 2 天沒成功就提醒

/**
 * status：資料庫 backup_status() 的結果 { snapshot_at, offsite_at, offsite_last: { at, ok, detail } }
 * 回傳 { level: 'ok' | 'warn', warning, snapshot, offsite }；沒有狀態（試用模式、讀不到）回傳 null
 */
export function backupHealth(status, now = new Date()) {
  if (!status) return null;
  const hours = (iso) => (iso ? (now - new Date(iso)) / 3600e3 : Infinity);
  const last = status.offsite_last;
  let warning = '';
  if (hours(status.snapshot_at) > STALE_H) warning = status.snapshot_at ? `資料庫快照已經 ${Math.floor(hours(status.snapshot_at) / 24)} 天沒更新` : '資料庫還沒有任何快照';
  else if (last && !last.ok) warning = `異地備份失敗：${last.detail || '原因不明'}`;
  else if (!status.offsite_at) warning = '異地備份還沒設定完成';
  else if (hours(status.offsite_at) > STALE_H) warning = `異地備份已經 ${Math.floor(hours(status.offsite_at) / 24)} 天沒成功`;
  return {
    level: warning ? 'warn' : 'ok',
    warning,
    snapshot: status.snapshot_at ? updatedLabel(status.snapshot_at, now) : '還沒有',
    offsite: status.offsite_at ? updatedLabel(status.offsite_at, now) : '還沒有',
  };
}
