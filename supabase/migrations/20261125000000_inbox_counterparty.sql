-- 2026-11-25
-- 1. 朋友欠款：交易可以記「誰」（counterparty）
-- 2. 捷徑／信箱自動記帳：個人專用的記帳碼（只存雜湊），用 inbox_add() 寫入
--    iPhone 捷徑：有對到分類、帳戶就直接記一筆；對不到就進「待確認」
--    信用卡通知信（Gmail Apps Script 解析後送來）：一律進「待確認」，同一封信不會重複

create extension if not exists pgcrypto with schema extensions;

alter type public.pending_source add value if not exists 'email';
alter type public.pending_source add value if not exists 'shortcut';

alter table public.pending_items drop constraint if exists pending_items_check;
alter table public.pending_items add constraint pending_items_check check (
  (source = 'recurring' and recurring_id is not null and occurrence_index is not null)
  or (source::text in ('broker', 'email', 'shortcut') and dedupe_key is not null));  -- ::text：同一個交易裡還不能直接用新的 enum 值

alter table public.transactions drop constraint if exists transactions_source_check;
alter table public.transactions add constraint transactions_source_check
  check (source in ('manual','template','recurring','split','stock','dividend','cw_import','email','shortcut'));

alter table public.transactions add column if not exists counterparty text
  check (counterparty is null or length(btrim(counterparty)) between 1 and 40);

-- ---------- 記帳碼 ----------
create table if not exists public.inbox_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  label        text not null default '' check (length(label) <= 40),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.inbox_tokens enable row level security;
drop policy if exists own_rows on public.inbox_tokens;
create policy own_rows on public.inbox_tokens for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.inbox_tokens from anon;
grant select, insert, update, delete on public.inbox_tokens to authenticated;

-- 依名稱找分類：「午餐」或「飲食-午餐」都可以；同名時選有用過最多次的
create or replace function public.inbox_find_category(p_uid uuid, p_kind public.category_kind, p_q text)
returns uuid language sql stable security definer set search_path = '' as $$
  with recursive tree as (
    select c.id, c.name::text as path from public.categories c
     where c.user_id = p_uid and c.parent_id is null and c.kind = p_kind and not c.archived
    union all
    select c.id, tree.path || '-' || c.name from public.categories c join tree on c.parent_id = tree.id
     where c.user_id = p_uid and not c.archived
  )
  select t.id from tree t
   where p_q is not null and btrim(p_q) <> ''
     and (t.path = btrim(p_q) or t.path like '%-' || btrim(p_q) or t.path = replace(btrim(p_q), '/', '-'))
   order by (select count(*) from public.transactions x where x.category_id = t.id) desc, length(t.path)
   limit 1;
$$;

create or replace function public.inbox_add(token text, item jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid; kind text := coalesce(item->>'kind', 'quick'); amt numeric; typ public.txn_type;
  cat uuid; acc uuid; acc_cur text; at timestamptz; today date := (now() at time zone 'Asia/Taipei')::date;
  key text; settings jsonb; new_id uuid;
begin
  if token is null or length(token) < 32 then raise exception '記帳碼不對' using errcode = 'insufficient_privilege'; end if;
  update public.inbox_tokens set last_used_at = now()
   where token_hash = encode(extensions.digest(token, 'sha256'), 'hex') returning user_id into uid;
  if uid is null then raise exception '記帳碼不對或已經停用' using errcode = 'insufficient_privilege'; end if;

  amt := round(nullif(regexp_replace(coalesce(item->>'amount', ''), '[^0-9.]', '', 'g'), '')::numeric, 2);
  if amt is null or amt <= 0 or amt > 100000000 then raise exception '金額不對'; end if;
  at := coalesce(nullif(item->>'at', '')::timestamptz, now());

  if kind = 'email' then
    key := 'email:' || left(coalesce(nullif(item->>'message_id', ''), md5(item::text)), 200);
    insert into public.pending_items (user_id, source, due_date, dedupe_key, payload)
    values (uid, 'email', (at at time zone 'Asia/Taipei')::date, key, jsonb_build_object(
      'amount', amt, 'currency', upper(coalesce(nullif(item->>'currency', ''), 'TWD')),
      'merchant', left(coalesce(item->>'merchant', ''), 100), 'at', at,
      'bank', left(coalesce(item->>'bank', ''), 20), 'card', left(coalesce(item->>'card', ''), 8),
      'subject', left(coalesce(item->>'subject', ''), 200)))
    on conflict (user_id, dedupe_key) do nothing;
    return jsonb_build_object('ok', true, 'status', 'pending');
  end if;

  -- iPhone 捷徑
  typ := case when item->>'type' in ('income', '收入') then 'income'::public.txn_type else 'expense'::public.txn_type end;
  cat := public.inbox_find_category(uid, typ::text::public.category_kind, item->>'category');
  select a.id, a.currency into acc, acc_cur from public.accounts a
   where a.user_id = uid and a.name = btrim(coalesce(item->>'account', '')) limit 1;
  if acc is null then
    select p.settings into settings from public.profiles p where p.user_id = uid;
    select a.id, a.currency into acc, acc_cur from public.accounts a
     where a.user_id = uid and a.id::text = coalesce(settings->>'defaultAccountId', '') limit 1;
  end if;
  if acc is null then  -- 最近一次記帳用的帳戶
    select a.id, a.currency into acc, acc_cur from public.transactions x join public.accounts a on a.id = x.account_id
     where x.user_id = uid and x.type <> 'transfer' and a.type not in ('brokerage', 'friends_owe')
     order by x.created_at desc limit 1;
  end if;

  if cat is not null and acc is not null and acc_cur = 'TWD' then
    insert into public.transactions (user_id, type, occurred_at, account_id, amount, fx_rate, category_id, note, source)
    values (uid, typ, at, acc, amt, 1, cat, left(coalesce(item->>'note', ''), 500), 'shortcut')
    returning id into new_id;
    return jsonb_build_object('ok', true, 'status', 'recorded', 'id', new_id);
  end if;

  insert into public.pending_items (user_id, source, due_date, dedupe_key, payload)
  values (uid, 'shortcut', today, 'shortcut:' || gen_random_uuid(), jsonb_build_object(
    'amount', amt, 'type', typ, 'category', left(coalesce(item->>'category', ''), 60), 'category_id', cat,
    'account_id', acc, 'note', left(coalesce(item->>'note', ''), 500), 'at', at));
  return jsonb_build_object('ok', true, 'status', 'pending');
end $$;

revoke all on function public.inbox_find_category(uuid, public.category_kind, text) from public, anon, authenticated;
revoke all on function public.inbox_add(text, jsonb) from public;
grant execute on function public.inbox_add(text, jsonb) to anon, authenticated;
