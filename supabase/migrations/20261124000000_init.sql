-- =====================================================================
-- 記帳 App 資料庫結構（Supabase / Postgres 15+）
--
-- 設計原則
--   1. 每張個人資料表都有 user_id，並開 Row Level Security：
--      只能讀寫 user_id = 自己 的資料。這件事由資料庫保證，不靠前端。
--   2. 外鍵一律用 (id, user_id) 兩欄一起對，
--      所以交易只能掛在「自己的」帳戶、分類底下。
--   3. 餘額不存在資料庫：每次都從「期初餘額＋所有交易」重算，
--      改舊帳時餘額自然就對了。
--   4. 匯率、股價是大家共用的公開資料，只有後端（secret key）能寫。
-- =====================================================================

-- ---------- 列舉型別 ----------
create type public.account_type  as enum ('cash','bank','credit_card','e_payment','brokerage','friends_owe','loan','other');
create type public.category_kind as enum ('expense','income');
create type public.txn_type      as enum ('expense','income','transfer');
create type public.template_mode as enum ('fill','instant');
create type public.interval_unit as enum ('day','week','month','year');
create type public.pending_source as enum ('recurring','broker');
create type public.pending_status as enum ('pending','confirmed','skipped');
create type public.trade_side    as enum ('opening','buy','sell');
create type public.market        as enum ('TW','US');
create type public.security_kind as enum ('stock','etf');

-- ---------- 使用者設定 ----------
create table public.profiles (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  settings   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------- 帳戶 ----------
create table public.accounts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 40),
  type            public.account_type not null,
  currency        char(3) not null default 'TWD' check (currency ~ '^[A-Z]{3}$'),
  opening_balance numeric(18,2) not null default 0,
  hidden          boolean not null default false,
  sort_order      int not null default 0,
  icon            text check (icon is null or icon ~ '^[A-Za-z0-9]{1,24}$'),   -- 自己選的圖示，空著就照類型
  foreign_fee_pct numeric(5,2) check (foreign_fee_pct between 0 and 10),         -- 信用卡海外交易手續費 %
  system_key      text check (system_key in ('friends_owe')),   -- 系統帳戶：「朋友欠我」
  created_at      timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, name),
  unique (user_id, system_key),
  check (system_key is null or type = 'friends_owe')
);

-- ---------- 分類（樹狀，1–3 層） ----------
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  parent_id   uuid,
  kind        public.category_kind not null,
  name        text not null check (length(btrim(name)) between 1 and 30),
  archived    boolean not null default false,
  sort_order  int not null default 0,
  icon        text check (icon is null or icon ~ '^[A-Za-z0-9]{1,24}$'),   -- 自己選的圖示，空著就自動判斷
  -- 程式會用到的系統分類：其他支出-手續費、其他支出-股票虧損、投資收入-股利、投資收入-利息、投資收入-股票獲利（以及它們的上層）
  system_key  text check (system_key in ('other_expense','fee','stock_loss','investment_income','dividend','interest','stock_gain')),
  created_at  timestamptz not null default now(),
  unique (id, user_id),
  unique nulls not distinct (user_id, parent_id, kind, name),
  unique (user_id, system_key),
  foreign key (parent_id, user_id) references public.categories(id, user_id)
);

-- ---------- 固定收支 ----------
create table public.recurring_rules (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name           text not null check (length(btrim(name)) between 1 and 40),
  type           public.txn_type not null,
  account_id     uuid not null,
  to_account_id  uuid,
  category_id    uuid,
  amount         numeric(18,2) not null check (amount >= 0),
  note           text not null default '' check (length(note) <= 500),
  interval_unit  public.interval_unit not null,
  interval_count int not null default 1 check (interval_count between 1 and 366),
  start_date     date not null,
  end_date       date check (end_date is null or end_date >= start_date),
  next_index     int not null default 0 check (next_index >= 0),  -- 下一次要產生的是「第幾次」（從 0 算）
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (id, user_id),
  foreign key (account_id, user_id)    references public.accounts(id, user_id) on delete cascade,
  foreign key (to_account_id, user_id) references public.accounts(id, user_id) on delete cascade,
  foreign key (category_id, user_id)   references public.categories(id, user_id) on delete cascade,
  check ((type = 'transfer' and to_account_id is not null and to_account_id <> account_id and category_id is null)
      or (type <> 'transfer' and to_account_id is null and category_id is not null))
);

-- ---------- 待確認清單 ----------
create table public.pending_items (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source           public.pending_source not null,
  recurring_id     uuid,
  occurrence_index int,
  due_date         date not null,
  dedupe_key       text,                 -- 券商成交：委託書號，防止重複匯入
  payload          jsonb not null default '{}'::jsonb,
  status           public.pending_status not null default 'pending',
  resolved_at      timestamptz,
  created_at       timestamptz not null default now(),
  unique (id, user_id),
  unique (recurring_id, due_date),         -- 同一個固定收支、同一天只會有一筆
  unique (user_id, dedupe_key),
  foreign key (recurring_id, user_id) references public.recurring_rules(id, user_id) on delete cascade,
  check ((source = 'recurring' and recurring_id is not null and occurrence_index is not null)
      or (source = 'broker' and dedupe_key is not null))
);

-- ---------- 交易 ----------
create table public.transactions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type            public.txn_type not null,
  occurred_at     timestamptz not null default now(),
  account_id      uuid not null,
  amount          numeric(18,2) not null check (amount >= 0),       -- 帳戶幣別
  fx_rate         numeric(18,8) not null default 1 check (fx_rate > 0),  -- 1 單位帳戶幣別 = ? 台幣
  orig_currency   char(3) check (orig_currency ~ '^[A-Z]{3}$'),       -- 用台幣帳戶付外幣：原本的幣別
  orig_amount     numeric(18,2) check (orig_amount >= 0),             -- 原本的外幣金額（amount 是換算後的台幣）
  to_account_id   uuid,
  to_amount       numeric(18,2) check (to_amount >= 0),             -- 轉入帳戶收到的金額（轉入帳戶幣別）
  to_fx_rate      numeric(18,8) check (to_fx_rate > 0),
  category_id     uuid,
  note            text not null default '' check (length(note) <= 500),
  is_exception    boolean not null default false,
  parent_id       uuid,      -- 轉帳手續費那筆支出 → 指向原本的轉帳（刪轉帳時一起刪）
  group_id        uuid,      -- 分帳：同一次分帳的「支出」與「轉進朋友欠我」共用
  source          text not null default 'manual'
                  check (source in ('manual','template','recurring','split','stock','dividend','cw_import','email','shortcut','1sec_import')),
  pending_item_id uuid unique,   -- 從待確認清單確認來的；unique ＝ 同一筆不能確認兩次
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, user_id),
  foreign key (account_id, user_id)      references public.accounts(id, user_id),
  foreign key (to_account_id, user_id)   references public.accounts(id, user_id),
  foreign key (category_id, user_id)     references public.categories(id, user_id),
  foreign key (parent_id, user_id)       references public.transactions(id, user_id) on delete cascade,
  foreign key (pending_item_id, user_id) references public.pending_items(id, user_id) on delete set null (pending_item_id),
  check ((type = 'transfer' and to_account_id is not null and to_account_id <> account_id
          and to_amount is not null and to_fx_rate is not null and category_id is null)
      or (type <> 'transfer' and to_account_id is null and to_amount is null
          and to_fx_rate is null and category_id is not null)),
  constraint transactions_orig_check check ((orig_currency is null) = (orig_amount is null))
);
create index transactions_user_time on public.transactions (user_id, occurred_at);
create index transactions_account    on public.transactions (account_id);
create index transactions_to_account on public.transactions (to_account_id);
create index transactions_category   on public.transactions (category_id);
create index transactions_parent     on public.transactions (parent_id);

-- ---------- 範本 ----------
create table public.templates (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 40),
  mode          public.template_mode not null default 'fill',   -- fill＝帶入表單再改；instant＝一鍵直接記
  type          public.txn_type not null,
  account_id    uuid,
  to_account_id uuid,
  category_id   uuid,
  amount        numeric(18,2) check (amount >= 0),
  note          text not null default '' check (length(note) <= 500),
  is_exception  boolean not null default false,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  unique (id, user_id),
  foreign key (account_id, user_id)    references public.accounts(id, user_id) on delete cascade,
  foreign key (to_account_id, user_id) references public.accounts(id, user_id) on delete cascade,
  foreign key (category_id, user_id)   references public.categories(id, user_id) on delete cascade,
  -- 一鍵記帳的範本必須是完整的一筆（含固定金額）
  check (mode = 'fill' or (amount is not null and account_id is not null and
         ((type = 'transfer' and to_account_id is not null and to_account_id <> account_id) or
          (type <> 'transfer' and category_id is not null))))
);

-- ---------- 股票：成交（含期初持股） ----------
create table public.stock_trades (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users(id) on delete cascade,
  brokerage_account_id  uuid not null,                 -- 證券戶（國泰台股、國泰美股…）
  market                public.market not null,
  symbol                text not null check (symbol ~ '^[A-Z0-9.\-]{1,12}$'),
  name                  text not null default '',
  kind                  public.security_kind not null default 'stock',
  side                  public.trade_side not null,    -- opening＝期初持股（當成一批買進，不產生交割）
  trade_date            date not null,
  settle_date           date,
  shares                numeric(18,6) not null check (shares > 0),
  price                 numeric(18,6) not null check (price >= 0),
  fee                   numeric(18,2) not null default 0 check (fee >= 0),
  tax                   numeric(18,2) not null default 0 check (tax >= 0),
  currency              char(3) not null check (currency ~ '^[A-Z]{3}$'),
  settlement_account_id uuid,                          -- 交割戶
  settle_amount         numeric(18,2) check (settle_amount >= 0),  -- 交割戶實際扣/入金額（交割戶幣別）
  settlement_txn_id     uuid,
  pnl_txn_id            uuid,                          -- 賣出的已實現損益（記在證券戶的收入／支出，算進月收支）
  pnl_external          boolean not null default false, -- 損益已另外記過（匯入的歷史成交），不自動記
  order_no              text,                          -- 委託書號
  pending_item_id       uuid unique,
  note                  text not null default '' check (length(note) <= 500),
  created_at            timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, order_no),
  foreign key (brokerage_account_id, user_id)  references public.accounts(id, user_id),
  foreign key (settlement_account_id, user_id) references public.accounts(id, user_id),
  foreign key (settlement_txn_id, user_id)     references public.transactions(id, user_id) on delete set null (settlement_txn_id),
  foreign key (pnl_txn_id, user_id)            references public.transactions(id, user_id) on delete set null (pnl_txn_id),
  foreign key (pending_item_id, user_id)       references public.pending_items(id, user_id) on delete set null (pending_item_id),
  check (side <> 'opening' or (settlement_account_id is null and settlement_txn_id is null)),
  check (side = 'sell' or pnl_txn_id is null)
);
create index stock_trades_user on public.stock_trades (user_id, market, symbol, trade_date);

-- ---------- 股票：股利 ----------
create table public.dividends (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null default auth.uid() references auth.users(id) on delete cascade,
  brokerage_account_id uuid not null,
  market               public.market not null,
  symbol               text not null check (symbol ~ '^[A-Z0-9.\-]{1,12}$'),
  pay_date             date not null,
  gross                numeric(18,2) not null check (gross >= 0),
  withholding          numeric(18,2) not null default 0 check (withholding >= 0),  -- 美股預扣稅
  nhi_premium          numeric(18,2) not null default 0 check (nhi_premium >= 0),  -- 二代健保
  currency             char(3) not null check (currency ~ '^[A-Z]{3}$'),
  transaction_id       uuid not null,   -- 實拿金額記成收入「投資收入-股利」的那筆
  note                 text not null default '' check (length(note) <= 500),
  created_at           timestamptz not null default now(),
  unique (id, user_id),
  foreign key (brokerage_account_id, user_id) references public.accounts(id, user_id),
  foreign key (transaction_id, user_id) references public.transactions(id, user_id) on delete cascade,
  check (withholding + nhi_premium <= gross)
);

-- ---------- 股票：手動股價（沒有自動來源時用，例如美股） ----------
create table public.manual_prices (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  market     public.market not null,
  symbol     text not null check (symbol ~ '^[A-Z0-9.\-]{1,12}$'),
  price_date date not null,
  close      numeric(18,6) not null check (close >= 0),
  unique (user_id, market, symbol, price_date)
);

-- ---------- 公開資料：股價、匯率（只有後端能寫） ----------
create table public.stock_prices (
  market     public.market not null,
  symbol     text not null,
  price_date date not null,
  close      numeric(18,6) not null,
  name       text not null default '',
  updated_at timestamptz default now(),   -- 最後寫入時間（股票頁顯示「更新於…」）
  primary key (market, symbol, price_date)
);

create table public.fx_rates (
  currency  char(3) not null check (currency ~ '^[A-Z]{3}$'),
  rate_date date not null,
  rate      numeric(18,8) not null check (rate > 0),   -- 1 單位外幣 = ? 台幣（台銀即期買賣中價）
  updated_at timestamptz default now(),
  primary key (currency, rate_date)
);

-- =====================================================================
-- 觸發器：資料規則
-- =====================================================================

-- 分類規則：子分類收支類型要跟上層一樣；不能超過三層；
-- 不能掛到自己的子孫底下；搬移整棵時連子分類一起算深度。
create or replace function public.check_category_tree()
returns trigger language plpgsql set search_path = '' as $$
declare
  parent_kind  public.category_kind;
  parent_depth int := 0;
  cur          uuid;
  subtree      int;
begin
  if tg_op = 'UPDATE' and new.kind is distinct from old.kind then
    if exists (select 1 from public.categories c where c.parent_id = new.id)
       or exists (select 1 from public.transactions t where t.category_id = new.id) then
      raise exception '已有子分類或交易的分類不能改收支類型' using errcode = 'check_violation';
    end if;
  end if;

  if new.parent_id is not null then
    select c.kind into parent_kind from public.categories c
     where c.id = new.parent_id and c.user_id = new.user_id;
    if not found then
      raise exception '找不到上層分類' using errcode = 'foreign_key_violation';
    end if;
    if parent_kind <> new.kind then
      raise exception '子分類的收支類型要跟上層一樣' using errcode = 'check_violation';
    end if;

    -- 往上走，算上層深度，同時檢查是不是掛到自己的子孫底下
    cur := new.parent_id;
    while cur is not null loop
      if cur = new.id then
        raise exception '不能把分類搬到自己的子分類底下' using errcode = 'check_violation';
      end if;
      parent_depth := parent_depth + 1;
      if parent_depth > 3 then
        raise exception '分類最多三層' using errcode = 'check_violation';
      end if;
      select c.parent_id into cur from public.categories c where c.id = cur;
    end loop;
  end if;

  -- 這個節點底下最深有幾層（自己算 1）
  if tg_op = 'UPDATE' then
    with recursive sub as (
      select c.id, 1 as lvl from public.categories c where c.id = new.id
      union all
      select c.id, sub.lvl + 1 from public.categories c join sub on c.parent_id = sub.id
       where sub.lvl < 5
    )
    select max(lvl) into subtree from sub;
  else
    subtree := 1;
  end if;

  if parent_depth + coalesce(subtree, 1) > 3 then
    raise exception '分類最多三層（搬移時連子分類一起算）' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger categories_tree
  before insert or update of parent_id, kind on public.categories
  for each row execute function public.check_category_tree();

-- 系統帳戶、系統分類不能刪（刪整個帳號時例外）
-- security definer：一般使用者讀不到 auth.users，這裡要用擁有者權限檢查「帳號是否還在」
create or replace function public.protect_system_rows()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.system_key is not null
     and exists (select 1 from auth.users u where u.id = old.user_id) then
    raise exception '系統預設的項目不能刪除' using errcode = 'check_violation';
  end if;
  return old;
end $$;

-- 只給觸發器用，不讓任何人透過 API 直接呼叫
revoke all on function public.protect_system_rows() from public, anon, authenticated;

create trigger accounts_protect   before delete on public.accounts
  for each row execute function public.protect_system_rows();
create trigger categories_protect before delete on public.categories
  for each row execute function public.protect_system_rows();


-- 交易／範本／固定收支的分類，必須跟類型一致（支出記在支出分類、收入記在收入分類）
create or replace function public.check_category_kind()
returns trigger language plpgsql set search_path = '' as $$
declare k public.category_kind;
begin
  if new.category_id is not null then
    select c.kind into k from public.categories c
     where c.id = new.category_id and c.user_id = new.user_id;
    if found and k::text <> new.type::text then
      raise exception '分類的收支類型跟交易不一致' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create trigger transactions_category before insert or update on public.transactions
  for each row execute function public.check_category_kind();
create trigger templates_category before insert or update on public.templates
  for each row execute function public.check_category_kind();
create trigger recurring_category before insert or update on public.recurring_rules
  for each row execute function public.check_category_kind();

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger transactions_touch before update on public.transactions
  for each row execute function public.touch_updated_at();
create trigger stock_prices_touch before update on public.stock_prices
  for each row execute function public.touch_updated_at();
create trigger fx_rates_touch before update on public.fx_rates
  for each row execute function public.touch_updated_at();

-- 確認待確認項目：產生交易（或股票成交）時，在同一個 transaction 裡把項目標成已確認。
-- 項目不是「待確認」狀態就整筆失敗 → 同一筆不能確認兩次，也不能確認已跳過的。
create or replace function public.confirm_pending_on_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.pending_item_id is not null then
    update public.pending_items p
       set status = 'confirmed', resolved_at = now()
     where p.id = new.pending_item_id and p.user_id = new.user_id and p.status = 'pending';
    if not found then
      raise exception '這筆待確認項目已經處理過了' using errcode = 'unique_violation';
    end if;
  end if;
  return new;
end $$;

create trigger transactions_confirm_pending after insert on public.transactions
  for each row execute function public.confirm_pending_on_insert();
create trigger stock_trades_confirm_pending after insert on public.stock_trades
  for each row execute function public.confirm_pending_on_insert();

-- 待確認項目只能從「待確認」變成「已確認／已跳過」，不能改回來
create or replace function public.check_pending_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status and old.status <> 'pending' then
    raise exception '這筆待確認項目已經處理過了' using errcode = 'check_violation';
  end if;
  if new.status <> 'pending' and new.resolved_at is null then
    new.resolved_at := now();
  end if;
  return new;
end $$;

create trigger pending_status before update on public.pending_items
  for each row execute function public.check_pending_status();

-- =====================================================================
-- Row Level Security：每個人只讀寫得到自己的資料
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['profiles','accounts','categories','recurring_rules','pending_items',
                           'transactions','templates','stock_trades','dividends','manual_prices']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy own_rows on public.%I for all to authenticated
                      using (user_id = (select auth.uid()))
                      with check (user_id = (select auth.uid()))$p$, t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- 公開資料：登入的人可以讀；沒有寫入的 policy ＝ 只有 secret key（略過 RLS）能寫
alter table public.stock_prices enable row level security;
alter table public.fx_rates     enable row level security;
create policy read_all on public.stock_prices for select to authenticated using (true);
create policy read_all on public.fx_rates     for select to authenticated using (true);
revoke all on public.stock_prices, public.fx_rates from anon, authenticated;
grant select on public.stock_prices, public.fx_rates to authenticated;

-- =====================================================================
-- 刪除帳號：連同所有資料一起刪（每張表都是 on delete cascade）
-- =====================================================================
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception '請先登入' using errcode = 'insufficient_privilege';
  end if;
  delete from auth.users where id = uid;
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- =====================================================================
-- 自動備份（同 20261128000000_backup.sql）
-- =====================================================================

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

-- app 內「從備份檔還原」（同 20261129000000_restore_my_backup.sql）
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
