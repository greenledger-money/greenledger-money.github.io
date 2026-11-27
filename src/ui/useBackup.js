// 讀備份狀態（每次打開 app 讀一次就好，同一個工作階段共用結果）
import { useEffect, useState } from 'react';
import { useLedger } from '../store.jsx';
import { backupHealth } from '../lib/backup.js';

let cache = null; // { at, status }

export function useBackupHealth() {
  const { backend } = useLedger();
  const [status, setStatus] = useState(cache?.status ?? null);
  useEffect(() => {
    if (!backend.backupStatus || (cache && Date.now() - cache.at < 10 * 60e3)) return undefined;
    let alive = true;
    backend.backupStatus().then((s) => { cache = { at: Date.now(), status: s }; if (alive) setStatus(s); }).catch(() => {});
    return () => { alive = false; };
  }, [backend]);
  return backupHealth(status);
}
