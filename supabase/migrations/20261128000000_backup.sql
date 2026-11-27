-- 2026-11-28 自動備份
--   1. 每天在資料庫裡存一份快照（backup schema，API 讀不到），誤刪、改壞時可以還原。
--   2. Edge Function「backup」把最新快照加密後推到私人 GitHub repo（整個 Supabase 出事時用）。
--   3. app 讀 backup_status() 顯示上次備份時間，太久沒備份就提醒。
-- 只備份個人資料；股價、匯率是公開資料，還原後用 call_market_data('history') 重抓即可。

create schema if not exists backup;
revoke all on schema backup from public;

create table if not exists backup.snapshots (
  id       bigint generated always as identity primary key,
  taken_at timestamptz not null default now(),
  reason   text not null default 'daily' check (reason in ('daily', 'manual', 'before_restore')),
  counts   jsonb not null,          -- 每張表幾筆
  checksum text not null,           -- md5(data::text)，異地備份檔也會帶這個，用來核對
  data     jsonb not null           -- { version, taken_at, tables: { 表名: [列…] } }
);

-- 備份紀錄：快照與異地備份的成功／失敗（app 顯示用）
create table if not exists backup.log (
  id     bigint generated always as identity primary key,
  at     timestamptz not null default now(),
  kind   text not null check (kind in ('snapshot', 'offsite', 'restore')),
  ok     boolean not null,
  detail text not null default ''
);

-- 個人資料表，照外鍵的先後順序（還原時照這個順序新增，刪除時反過來）
create or replace function backup.tables()
returns text[] language sql immutable as $$
  select array['profiles', 'accounts', 'categories', 'recurring_rules', 'pending_items', 'transactions',
               'stock_trades', 'dividends', 'templates', 'manual_prices', 'inbox_tokens'];
$$;

-- 某個使用者全部資料的校驗碼（不含 user_id，所以還原到新帳號後也能比對）
create or replace function backup.user_checksum(p_uid uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare t text; n bigint; h text; out jsonb := '{}';
begin
  foreach t in array backup.tables() loop
    execute format($q$select count(*), coalesce(md5(string_agg(r, ',' order by r)), '')
                      from (select (to_jsonb(x) - 'user_id')::text r from public.%I x where x.user_id = $1) s$q$, t)
      into n, h using p_uid;
    out := out || jsonb_build_object(t, jsonb_build_object('n', n, 'md5', h));
  end loop;
  return out;
end $$;

-- 存一份快照（全部使用者），並清掉過期的：每天的留 30 天，每月第一份留 1 年，還原前的留 90 天
create or replace function backup.take_snapshot(p_reason text default 'daily')
returns bigint language plpgsql set search_path = '' as $$
declare t text; rows jsonb; tbls jsonb := '{}'; counts jsonb := '{}'; d jsonb; new_id bigint;
begin
  foreach t in array backup.tables() loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', t) into rows;
    tbls := tbls || jsonb_build_object(t, rows);
    counts := counts || jsonb_build_object(t, jsonb_array_length(rows));
  end loop;
  d := jsonb_build_object('version', 1, 'taken_at', now(), 'tables', tbls);
  insert into backup.snapshots (reason, counts, checksum, data) values (p_reason, counts, md5(d::text), d)
    returning id into new_id;
  insert into backup.log (kind, ok, detail) values ('snapshot', true, p_reason || ' #' || new_id);

  delete from backup.snapshots s
  where (s.reason in ('daily', 'manual') and s.taken_at < now() - interval '30 days'
         and not (s.id in (select min(id) from backup.snapshots where reason in ('daily', 'manual') group by date_trunc('month', taken_at))
                  and s.taken_at > now() - interval '1 year'))
     or (s.reason = 'before_restore' and s.taken_at < now() - interval '90 days');
  delete from backup.log where at < now() - interval '1 year';
  return new_id;
end $$;

-- 把快照資料還原給 p_to_user。
--   p_from_user：快照裡要還原的是哪個使用者（快照含所有使用者）
--   p_to_user  ：還原到哪個帳號。新的 Supabase 專案裡重新註冊後，帳號 id 會不同，這裡會換掉 user_id
--   p_force    ：目標帳號已經有交易時，必須明確指定才會覆蓋（目標帳號有資料就先自動存一份快照）
-- 還原時暫停資料規則的觸發器（例如「待確認只能確認一次」），因為備份裡的資料本來就已經確認過；外鍵照樣檢查。
create or replace function backup.restore(p_data jsonb, p_from_user uuid, p_to_user uuid, p_force boolean default false)
returns jsonb language plpgsql set search_path = '' as $$
declare
  t text; cols text; rows jsonb; n bigint; counts jsonb := '{}';
  tbls text[] := backup.tables();
begin
  if p_data->'tables' is null then raise exception '不是備份資料（找不到 tables）'; end if;
  if not exists (select 1 from auth.users where id = p_to_user) then raise exception '找不到要還原到的帳號 %', p_to_user; end if;
  if not exists (select 1 from jsonb_array_elements(p_data->'tables'->'accounts') e where e->>'user_id' = p_from_user::text) then
    raise exception '備份裡沒有使用者 % 的資料', p_from_user;
  end if;
  if exists (select 1 from public.transactions where user_id = p_to_user) and not p_force then
    raise exception '這個帳號已經有交易，要覆蓋請加 p_force => true';
  end if;
  -- 目標帳號有任何資料（就算只剩帳戶）都先存一份，還原本身也能復原
  if exists (select 1 from public.accounts where user_id = p_to_user) or exists (select 1 from public.profiles where user_id = p_to_user) then
    perform backup.take_snapshot('before_restore');
  end if;

  foreach t in array tbls loop execute format('alter table public.%I disable trigger user', t); end loop;

  for i in reverse array_length(tbls, 1)..1 loop
    execute format('delete from public.%I where user_id = $1', tbls[i]) using p_to_user;
  end loop;

  foreach t in array tbls loop
    select coalesce(jsonb_agg(e || jsonb_build_object('user_id', p_to_user)), '[]')
      into rows from jsonb_array_elements(p_data->'tables'->t) e where e->>'user_id' = p_from_user::text;
    -- 只寫備份裡有的欄位：舊備份缺的新欄位用預設值
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
      from pg_attribute a
      where a.attrelid = format('public.%I', t)::regclass and a.attnum > 0 and not a.attisdropped
        and exists (select 1 from jsonb_array_elements(rows) e where e ? a.attname);
    if jsonb_array_length(rows) > 0 then
      execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, $1)', t, cols)
        using rows;
    end if;
    get diagnostics n = row_count;
    counts := counts || jsonb_build_object(t, case when jsonb_array_length(rows) > 0 then n else 0 end);
  end loop;

  foreach t in array tbls loop execute format('alter table public.%I enable trigger user', t); end loop;
  insert into backup.log (kind, ok, detail) values ('restore', true, counts::text);
  return counts;
end $$;

-- 用資料庫裡的快照還原自己的帳號（誤刪、改壞時用）：select backup.restore_snapshot(快照 id, user_id);
create or replace function backup.restore_snapshot(p_id bigint, p_uid uuid)
returns jsonb language sql set search_path = '' as $$
  select backup.restore((select data from backup.snapshots where id = p_id), p_uid, p_uid, true);
$$;

revoke all on all tables in schema backup from public, anon, authenticated;
revoke all on all functions in schema backup from public, anon, authenticated;

-- ---------- 給 API 用的三個函式（都在 public，權限分開） ----------

-- app：上次快照、上次異地備份的時間（不含任何資料內容）
create or replace function public.backup_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'snapshot_at', (select max(at) from backup.log where kind = 'snapshot' and ok),
    'offsite_at',  (select max(at) from backup.log where kind = 'offsite' and ok),
    'offsite_last', (select jsonb_build_object('at', at, 'ok', ok, 'detail', left(detail, 200))
                       from backup.log where kind = 'offsite' order by at desc limit 1));
$$;
revoke all on function public.backup_status() from public, anon;
grant execute on function public.backup_status() to authenticated;

-- Edge Function：拿最新的快照去做異地備份（只有 service_role）
create or replace function public.backup_latest()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', id, 'taken_at', taken_at, 'checksum', checksum, 'counts', counts, 'data', data)
  from backup.snapshots order by id desc limit 1;
$$;
revoke all on function public.backup_latest() from public, anon, authenticated;
grant execute on function public.backup_latest() to service_role;

-- Edge Function：記錄異地備份的結果（只有 service_role）
create or replace function public.backup_mark_offsite(p_ok boolean, p_detail text)
returns void language sql security definer set search_path = '' as $$
  insert into backup.log (kind, ok, detail) values ('offsite', p_ok, coalesce(p_detail, ''));
$$;
revoke all on function public.backup_mark_offsite(boolean, text) from public, anon, authenticated;
grant execute on function public.backup_mark_offsite(boolean, text) to service_role;
