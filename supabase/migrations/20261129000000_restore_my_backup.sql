-- 2026-11-29 app 內「從備份檔還原」：登入的使用者把備份檔的資料還原到自己的帳號。
--   p_data     ：備份檔裡的 data（{ version, tables }）
--   p_from_user：備份裡要用哪個使用者的資料；不給的話，備份裡有自己的資料就用自己的，
--                否則用交易最多的那個（換新 Supabase 專案、帳號 id 變了的情況）
-- 一律覆蓋自己目前的資料；backup.restore 覆蓋前會自動存一份 before_restore 快照，選錯檔也能救回來。
-- user_id 一律換成自己，加上 (id, user_id) 外鍵，動不到別人的資料。
create or replace function public.restore_my_backup(p_data jsonb, p_from_user uuid default null)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '120s' as $$
declare uid uuid := auth.uid(); src uuid := p_from_user;
begin
  if uid is null then raise exception '請先登入'; end if;
  if p_data->'tables'->'transactions' is null then raise exception '這不是小綠記帳的備份檔'; end if;
  if src is null then
    if exists (select 1 from jsonb_array_elements(p_data->'tables'->'accounts') e where e->>'user_id' = uid::text) then
      src := uid;
    else
      select (e->>'user_id')::uuid into src from jsonb_array_elements(p_data->'tables'->'transactions') e
        group by 1 order by count(*) desc limit 1;
    end if;
  end if;
  if src is null then raise exception '備份檔裡沒有任何交易'; end if;
  return backup.restore(p_data, src, uid, true);
end $$;
revoke all on function public.restore_my_backup(jsonb, uuid) from public, anon;
grant execute on function public.restore_my_backup(jsonb, uuid) to authenticated;
