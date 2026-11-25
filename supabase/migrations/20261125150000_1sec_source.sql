-- 2026-11-25 秒記帳匯入的紀錄標記來源，之後要整批找出或刪除比較方便
alter table public.transactions drop constraint if exists transactions_source_check;
alter table public.transactions add constraint transactions_source_check
  check (source in ('manual','template','recurring','split','stock','dividend','cw_import','email','shortcut','1sec_import'));
