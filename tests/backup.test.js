// 備份檔：加密、解密、還原 SQL
import { describe, expect, test } from 'bun:test';
import { decryptBackup, encryptBackup, packBackup, readBackup, toBase64 } from '../scripts/backup-crypto.mjs';
import { restoreSql, summary } from '../scripts/backup-restore.mjs';

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';
const payload = {
  format: 'greenledger-backup', snapshot_id: 7, taken_at: '2026-11-28T19:05:00Z', checksum: 'x',
  data: { version: 1, tables: { accounts: [{ id: 'a', user_id: U1, name: "小明's $glbk$ 帳戶" }], transactions: [{ id: 't', user_id: U1, amount: 120 }, { id: 'u', user_id: U2, amount: 5 }] } },
};
const PASS = 'correct horse battery staple';

describe('備份檔', () => {
  test('加密後解得回來，而且看不到原文', async () => {
    const bytes = await encryptBackup(payload, PASS);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('GLBK1');
    expect(new TextDecoder('latin1').decode(bytes).includes('小明')).toBe(false);
    expect(await decryptBackup(bytes, PASS)).toEqual(payload);
  });
  test('每次加密結果都不同（隨機 salt、iv）', async () => {
    const a = await encryptBackup(payload, PASS); const b = await encryptBackup(payload, PASS);
    expect(toBase64(a)).not.toBe(toBase64(b));
  });
  test('密碼錯、檔案被改、不是備份檔、密碼太短都會失敗', async () => {
    const bytes = await encryptBackup(payload, PASS);
    await expect(decryptBackup(bytes, 'wrong password!!')).rejects.toThrow('解不開');
    const bad = bytes.slice(); bad[bad.length - 1] ^= 1;
    await expect(decryptBackup(bad, PASS)).rejects.toThrow('解不開');
    await expect(decryptBackup(new TextEncoder().encode('hello world, not a backup file'), PASS)).rejects.toThrow('不是');
    await expect(encryptBackup(payload, 'short')).rejects.toThrow('12');
  });
  test('沒設密碼：只壓縮成 .json.gz，讀得回來', async () => {
    const { bytes, ext } = await packBackup(payload, '');
    expect(ext).toBe('json.gz');
    expect(await readBackup(bytes)).toEqual(payload);
    const enc = await packBackup(payload, PASS);
    expect(enc.ext).toBe('glbk');
    expect(await readBackup(enc.bytes, PASS)).toEqual(payload);
  });
  test('base64 跟內建的結果一樣（大檔分段）', () => {
    const big = new Uint8Array(100000).map((_, i) => i % 251);
    expect(toBase64(big)).toBe(Buffer.from(big).toString('base64'));
  });
  test('還原 SQL：換掉使用者、內容裡的 $ 符號不會弄壞語法', () => {
    const sql = restoreSql(payload, U1, U2);
    expect(sql).toContain(`'${U1}', '${U2}', false`);
    expect(sql).toContain('$glbkx$');
    expect(() => restoreSql(payload, 'x', U2)).toThrow('格式');
    expect(summary(payload).users[U1]).toEqual({ accounts: 1, transactions: 1 });
  });
});

describe('備份狀態提醒', async () => {
  const { backupHealth } = await import('../src/lib/backup.js');
  const now = new Date('2026-11-28T12:00:00Z');
  const h = (o) => backupHealth({ snapshot_at: '2026-11-28T19:05:00Z', offsite_at: '2026-11-28T19:06:00Z', offsite_last: { at: '2026-11-28T19:06:00Z', ok: true }, ...o }, now);
  test('都正常', () => { expect(h({ snapshot_at: '2026-11-27T19:05:00Z', offsite_at: '2026-11-27T19:06:00Z' }).level).toBe('ok'); });
  test('試用模式沒有狀態', () => { expect(backupHealth(null, now)).toBe(null); });
  test('異地備份還沒設定、失敗、太久沒成功', () => {
    expect(h({ offsite_at: null, offsite_last: null }).warning).toBe('異地備份還沒設定完成');
    expect(h({ offsite_last: { at: 'x', ok: false, detail: '還沒設定：BACKUP_PASSPHRASE' } }).warning).toContain('BACKUP_PASSPHRASE');
    expect(h({ offsite_at: '2026-11-25T19:06:00Z' }).warning).toBe('異地備份已經 2 天沒成功');
  });
  test('快照太久沒更新優先提醒', () => {
    expect(h({ snapshot_at: '2026-11-20T19:05:00Z' }).warning).toBe('資料庫快照已經 7 天沒更新');
    expect(h({ snapshot_at: null }).warning).toBe('資料庫還沒有任何快照');
  });
});
