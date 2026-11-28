#!/usr/bin/env bun
// 備份檔工具（在自己電腦上跑，Bun 或 Node 18 以上都可以）
//
//   查看內容：  bun scripts/backup-restore.mjs info 2026-11-28.json.gz（加密的 .glbk 要加 BACKUP_PASSPHRASE=…）
//   產生還原 SQL：BACKUP_PASSPHRASE=… bun scripts/backup-restore.mjs sql 2026-11-28.glbk <舊 user_id> <新 user_id> > restore.sql
//                然後：psql "<新專案的連線字串>" -f restore.sql
//
// 密碼也可以不放環境變數，執行時會問。完整步驟見 docs/backup.md。
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { readBackup } from './backup-crypto.mjs';

const ask = (q) => new Promise((res) => { const rl = createInterface({ input: process.stdin, output: process.stderr }); rl.question(q, (a) => { rl.close(); res(a); }); });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 把備份內容變成一個 psql 可以直接跑的 SQL 檔（用 backup.restore 還原，同一個 transaction，失敗就全部不算） */
export function restoreSql(payload, fromUser, toUser, { force = false } = {}) {
  if (!UUID.test(fromUser) || !UUID.test(toUser)) throw new Error('user_id 格式不對');
  const json = JSON.stringify(payload.data);
  let tag = 'glbk'; while (json.includes(`$${tag}$`)) tag += 'x';
  return [
    `-- 小綠記帳還原：快照 #${payload.snapshot_id}（${payload.taken_at}）`,
    '\\set ON_ERROR_STOP 1',
    'begin;',
    `select backup.restore($${tag}$${json}$${tag}$::jsonb, '${fromUser}', '${toUser}', ${force});`,
    `select backup.user_checksum('${toUser}');`,
    'commit;',
    '',
  ].join('\n');
}

/** 備份裡每個使用者有幾筆 */
export function summary(payload) {
  const users = new Map();
  for (const [t, rows] of Object.entries(payload.data.tables)) {
    for (const r of rows) {
      const u = users.get(r.user_id) ?? {}; u[t] = (u[t] ?? 0) + 1; users.set(r.user_id, u);
    }
  }
  return { snapshot_id: payload.snapshot_id, taken_at: payload.taken_at, users: Object.fromEntries(users) };
}

if (import.meta.main ?? process.argv[1]?.endsWith('backup-restore.mjs')) {
  const [cmd, file, from, to, flag] = process.argv.slice(2);
  if (!['info', 'sql'].includes(cmd) || !file) {
    console.error('用法：info <檔案> ｜ sql <檔案> <舊 user_id> <新 user_id> [--force]');
    process.exit(1);
  }
  const bytes = readFileSync(file);
  const plain = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const pass = plain ? '' : (process.env.BACKUP_PASSPHRASE || await ask('備份密碼：'));
  const payload = await readBackup(bytes, pass);
  if (cmd === 'info') console.log(JSON.stringify(summary(payload), null, 2));
  else process.stdout.write(restoreSql(payload, from, to, { force: flag === '--force' }));
}
