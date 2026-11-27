-- 每天自動備份（在正式 Supabase 跑一次；本機測試資料庫沒有 pg_cron、pg_net，所以不放在 migrations/）
-- 先在資料庫存快照，再呼叫 Edge Function「backup」加密推到私人 GitHub repo。
-- 暗號沿用 market_cron.sql 建的 vault 'market_cron_secret'（market_cron_ok 檢查）。

create or replace function public.call_backup()
returns bigint language sql security definer set search_path = '' as $$
  select net.http_post(
    url := 'https://qopkoivdrildkdihnyto.supabase.co/functions/v1/backup',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'market_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000);
$$;
revoke all on function public.call_backup() from public, anon, authenticated;

-- UTC 19:05 = 台北 03:05（沒人在記帳的時間）。pg_net 會在快照 commit 之後才送出請求。
select cron.unschedule('backup-daily') where exists (select 1 from cron.job where jobname = 'backup-daily');
select cron.schedule('backup-daily', '5 19 * * *', $$select backup.take_snapshot('daily'); select public.call_backup();$$);
