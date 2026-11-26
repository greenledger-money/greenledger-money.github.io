-- 2026-11-27 股價、匯率記下最後寫入的時間，股票頁才能顯示「更新於 今天 13:50」。
-- 舊資料不知道是什麼時候寫的，所以先加沒有預設值的欄位（舊資料是 null），再設預設值給之後新增的列。
-- 排程用 upsert 覆寫同一天的股價時走 update，由觸發器更新時間。
alter table public.stock_prices add column if not exists updated_at timestamptz;
alter table public.stock_prices alter column updated_at set default now();
alter table public.fx_rates add column if not exists updated_at timestamptz;
alter table public.fx_rates alter column updated_at set default now();

drop trigger if exists stock_prices_touch on public.stock_prices;
create trigger stock_prices_touch before update on public.stock_prices
  for each row execute function public.touch_updated_at();
drop trigger if exists fx_rates_touch on public.fx_rates;
create trigger fx_rates_touch before update on public.fx_rates
  for each row execute function public.touch_updated_at();
