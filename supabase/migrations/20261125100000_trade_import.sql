-- 2026-11-25 匯入券商歷史成交
-- pnl_external：這筆賣出的損益已經另外記過（例如 CW 匯入的「工作收入-股票」），App 不再自動記損益
-- shares 改成 6 位小數：複委託碎股到小數 5 位（0.58106 股）
alter table public.stock_trades add column if not exists pnl_external boolean not null default false;
alter table public.stock_trades alter column shares type numeric(18,6);
