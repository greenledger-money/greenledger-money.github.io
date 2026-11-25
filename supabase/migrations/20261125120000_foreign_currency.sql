-- 2026-11-25 外幣記帳
-- 用台幣帳戶（信用卡、台幣現金）付外幣：記原本的外幣金額，amount 存換算後的台幣
-- 信用卡海外交易手續費（%），換算時加上去；帳單出來可以改成實際台幣
alter table public.transactions add column if not exists orig_currency char(3) check (orig_currency ~ '^[A-Z]{3}$');
alter table public.transactions add column if not exists orig_amount numeric(18,2) check (orig_amount >= 0);
alter table public.transactions drop constraint if exists transactions_orig_check;
alter table public.transactions add constraint transactions_orig_check check ((orig_currency is null) = (orig_amount is null));
alter table public.accounts add column if not exists foreign_fee_pct numeric(5,2) check (foreign_fee_pct between 0 and 10);
