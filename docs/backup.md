# 自動備份與還原

## 備份怎麼運作

| 層 | 做什麼 | 放在哪 | 留多久 | 防什麼 |
|---|---|---|---|---|
| 資料庫快照 | 每天 03:05（台北）存一份所有個人資料 | Supabase 的 `backup` schema（API 讀不到） | 每天的留 30 天、每月第一份留 1 年 | 誤刪、改壞、匯入出錯 |
| 異地備份 | 把最新快照 gzip＋AES-256 加密 | 私人 GitHub repo，`daily/年/月/日期.glbk` | 永久（每天一個檔，git 歷史也在） | 整個 Supabase 專案出事 |

- 排程：`supabase/cron/backup_cron.sql`（pg_cron 先存快照，再呼叫 Edge Function `backup`）。
- 上傳前 Edge Function 會先自己解開一次，確認檔案還原得回來；repo 不是私人的就拒絕上傳。
- app 的「設定 › 自動備份」顯示上次成功的時間；超過 2 天沒成功，或異地備份失敗，首頁會出現提醒。
- 只備份個人資料。股價、匯率是公開資料，還原後執行 `select public.call_market_data('history');` 重抓。
- 登入帳號（密碼、Passkey）存在 Supabase Auth，沒辦法備份；換新專案時要重新註冊。

## 第一次設定（使用者自己做）

1. **建私人 repo**：GitHub › New repository，名稱例如 `greenledger-backup`，選 **Private**，勾「Add a README」。
2. **產生 token**：GitHub › Settings › Developer settings › Fine-grained tokens › Generate new token
   - Repository access：Only select repositories → 只選 `greenledger-backup`
   - Permissions › Repository permissions › **Contents：Read and write**（其他都不用）
   - Expiration：選最長，並在日曆記下到期日，到期前換新的
3. **想一組備份密碼**（至少 12 個字，建議用密碼管理器產生），**存進密碼管理器**。
   這組密碼不見了，異地備份就永遠打不開。
4. **填到 Supabase**：Supabase › Edge Functions › Secrets，新增三個：
   - `BACKUP_GITHUB_TOKEN`：第 2 步的 token
   - `BACKUP_GITHUB_REPO`：`你的帳號/greenledger-backup`
   - `BACKUP_PASSPHRASE`：第 3 步的密碼
5. 回 app 的「設定 › 自動備份」，隔天看到「異地備份：今天 03:06」就完成了。
   想馬上測試：在 Supabase SQL Editor 執行 `select backup.take_snapshot('manual'); select public.call_backup();`

## 還原

### 情況一：資料改壞了，Supabase 還在

1. 找出正確的 user_id（有交易的那個帳號）和要還原的快照：
   ```sql
   select user_id, count(*) from transactions group by 1;
   select id, taken_at, reason, counts->>'transactions' as txns from backup.snapshots order by id desc limit 10;
   ```
2. 還原（會先自動存一份 `before_restore` 快照，還原本身也能復原）：
   ```sql
   select backup.restore_snapshot(<快照 id>, '<user_id>');
   ```

### 情況二：整個 Supabase 專案不見了

1. 建新的 Supabase 專案，在 SQL Editor 跑 `supabase/migrations/20261124000000_init.sql`。
2. 更新 repo Variables 的 `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`，重新部署；到 app 重新註冊。
3. 從私人 repo 下載最新的 `.glbk` 檔，在自己電腦上（需要 Bun 或 Node 18+）：
   ```sh
   bun scripts/backup-restore.mjs info 2026-11-28.glbk          # 看有哪些使用者、各幾筆，找出舊的 user_id
   bun scripts/backup-restore.mjs sql 2026-11-28.glbk <舊 user_id> <新 user_id> --force > restore.sql
   psql "<新專案的連線字串>" -f restore.sql
   ```
   新帳號登入時 app 會自動建預設帳戶，所以要加 `--force` 蓋掉。
4. 重跑排程：`supabase/cron/market_cron.sql`、`supabase/cron/backup_cron.sql`，部署兩個 Edge Function，補股價：`select public.call_market_data('history');`

### 演練

`PGHOST=/tmp/pg PGPORT=5544 PGUSER=postgres bash supabase/tests/restore_drill.sh`
會用測試資料完整跑一次「快照 → 加密 → 解密 → 還原到全新的資料庫 → 比對校驗碼」。
