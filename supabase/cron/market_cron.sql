-- 股價、匯率的排程（在 Supabase 上跑，不靠 GitHub 的排程）
-- 由 pg_cron 定時用 pg_net 呼叫 Edge Function「market-data」。
-- 這個檔案只在正式的 Supabase 跑一次（本機測試資料庫沒有 pg_cron、pg_net，所以不放在 migrations/）。

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 呼叫函式用的暗號：存在 vault，只有資料庫裡面看得到
select vault.create_secret(gen_random_uuid()::text || gen_random_uuid()::text, 'market_cron_secret', '排程呼叫 market-data 函式的暗號')
where not exists (select 1 from vault.secrets where name = 'market_cron_secret');

-- 函式用來檢查暗號（只有 service_role 能呼叫）
create or replace function public.market_cron_ok(token text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'market_cron_secret' and decrypted_secret = token);
$$;
revoke all on function public.market_cron_ok(text) from public, anon, authenticated;
grant execute on function public.market_cron_ok(text) to service_role;

-- 排程呼叫函式（mode：'intraday' 盤中、'daily' 收盤後）
create or replace function public.call_market_data(mode text)
returns bigint language sql security definer set search_path = '' as $$
  select net.http_post(
    url := 'https://qopkoivdrildkdihnyto.supabase.co/functions/v1/market-data',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'market_cron_secret')),
    body := jsonb_build_object('mode', mode),
    timeout_milliseconds := 120000);
$$;
revoke all on function public.call_market_data(text) from public, anon, authenticated;

-- 時間都是 UTC。函式裡面會再判斷市場是不是真的開盤（假日、夏令時間）
select cron.schedule('market-intraday-tw', '*/10 1-5 * * 1-5', $$select public.call_market_data('intraday')$$);   -- 台北 09:00–13:50
select cron.schedule('market-intraday-us', '*/10 13-21 * * 1-5', $$select public.call_market_data('intraday')$$);  -- 台北 21:00–05:50
select cron.schedule('market-daily-pm', '30 8 * * 1-5', $$select public.call_market_data('daily')$$);              -- 台北 16:30 台股收盤
select cron.schedule('market-daily-am', '30 0 * * 1-6', $$select public.call_market_data('daily')$$);              -- 台北 08:30 美股收盤
