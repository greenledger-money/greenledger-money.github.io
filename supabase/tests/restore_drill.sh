#!/usr/bin/env bash
# 還原演練：模擬「整個 Supabase 專案不見了」的情況，從加密的異地備份檔還原到一個全新的資料庫。
# 用法：PGHOST=... PGPORT=... PGUSER=postgres bash supabase/tests/restore_drill.sh
#   1. 舊資料庫：跑完 db_test（裡面有各種交易、股票、待確認…），存一份快照
#   2. 匯出快照 → 用跟 Edge Function 一樣的程式加密成 .glbk
#   3. 用 scripts/backup-restore.mjs 解密、產生還原 SQL
#   4. 新資料庫：只跑 migrations，建一個新帳號，執行還原 SQL
#   5. 比對兩邊的校驗碼（每張表的筆數＋內容）
set -euo pipefail
cd "$(dirname "$0")/../.."
OLD=drill_old_$$; NEW=drill_new_$$; TMP=$(mktemp -d)
trap 'dropdb --if-exists "$OLD"; dropdb --if-exists "$NEW"; rm -rf "$TMP"' EXIT
FROM=cccccccc-0000-0000-0000-000000000003    # db_test 最後還原出來的帳號
TO=eeeeeeee-0000-0000-0000-000000000005      # 新專案裡重新註冊的帳號
export BACKUP_PASSPHRASE="drill-$(date +%s)-passphrase"

for db in "$OLD" "$NEW"; do
  createdb "$db"
  psql -q -v ON_ERROR_STOP=1 -d "$db" -f supabase/tests/supabase_mock.sql
  for f in supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$f" 2>/dev/null; done
done
psql -q -o /dev/null -v ON_ERROR_STOP=1 -d "$OLD" -f supabase/tests/db_test.sql 2>/dev/null
psql -q -At -v ON_ERROR_STOP=1 -d "$OLD" -c "select backup.take_snapshot('manual')" >/dev/null
psql -q -At -v ON_ERROR_STOP=1 -d "$OLD" -c "select public.backup_latest()" > "$TMP/latest.json"

bun -e "
import { encryptBackup } from './scripts/backup-crypto.mjs';
const s = JSON.parse(await Bun.file('$TMP/latest.json').text());
const p = { format: 'greenledger-backup', snapshot_id: s.id, taken_at: s.taken_at, checksum: s.checksum, counts: s.counts, data: s.data };
await Bun.write('$TMP/backup.glbk', await encryptBackup(p, process.env.BACKUP_PASSPHRASE));"

bun scripts/backup-restore.mjs info "$TMP/backup.glbk" > "$TMP/info.json"
bun scripts/backup-restore.mjs sql "$TMP/backup.glbk" "$FROM" "$TO" > "$TMP/restore.sql"

psql -q -v ON_ERROR_STOP=1 -d "$NEW" -c "insert into auth.users values ('$TO', 'new@test')"
psql -q -o /dev/null -v ON_ERROR_STOP=1 -d "$NEW" -f "$TMP/restore.sql"

A=$(psql -At -d "$OLD" -c "select backup.user_checksum('$FROM')")
B=$(psql -At -d "$NEW" -c "select backup.user_checksum('$TO')")
N=$(psql -At -d "$NEW" -c "select count(*) from public.transactions where user_id = '$TO'")
echo "備份檔大小：$(wc -c < "$TMP/backup.glbk") bytes；新資料庫交易筆數：$N"
if [ "$A" = "$B" ] && [ "$N" -gt 0 ]; then echo "還原演練通過：新資料庫的資料跟原本完全一樣"; else echo "還原演練失敗"; echo "$A"; echo "$B"; exit 1; fi
