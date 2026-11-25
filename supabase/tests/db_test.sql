-- 資料庫測試：用 psql 跑，任何一項失敗最後會 raise exception
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create schema t;
grant usage on schema t to anon, authenticated;

create function t.ok(cond boolean, descr text) returns void language plpgsql as $$
declare n int := coalesce(nullif(current_setting('t.n', true), ''), '0')::int + 1;
begin
  perform set_config('t.n', n::text, false);
  if cond then raise notice 'ok %  - %', n, descr;
  else
    perform set_config('t.fail', coalesce(current_setting('t.fail', true), '') || n || ',', false);
    raise notice 'NOT OK %  - %', n, descr;
  end if;
end $$;

-- 執行 sql，預期會失敗，而且錯誤訊息符合 pattern
create function t.throws(sql text, pattern text, descr text) returns void language plpgsql as $$
declare msg text := null;
begin
  begin
    execute sql;
  exception when others then msg := sqlerrm;
  end;
  perform t.ok(msg is not null and msg ~* pattern, descr || coalesce(' [' || msg || ']', ' [沒有失敗]'));
end $$;

create function t.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), false);
  perform set_config('role', case when uid is null then 'anon' else 'authenticated' end, false);
end $$;
grant execute on all functions in schema t to anon, authenticated;

insert into auth.users values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@test'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@test');
insert into public.fx_rates values ('USD', '2026-11-20', 32.1);

-- ================= 使用者 A =================
select t.as_user('aaaaaaaa-0000-0000-0000-000000000001');

insert into public.profiles default values;
insert into public.accounts (id, name, type, opening_balance, system_key) values
  ('a0000000-0000-0000-0000-00000000000c', '現金', 'cash', 0, null),
  ('a0000000-0000-0000-0000-00000000000f', '朋友欠我', 'friends_owe', 0, 'friends_owe'),
  ('a0000000-0000-0000-0000-0000000000a1', 'LINE Pay', 'e_payment', 1000, null),
  ('a0000000-0000-0000-0000-0000000000a2', '郵局', 'bank', 0, null),
  ('a0000000-0000-0000-0000-0000000000a3', '國泰台股', 'brokerage', 0, null),
  ('a0000000-0000-0000-0000-0000000000a4', '美金帳戶', 'bank', 0, null);
select t.ok((select count(*) from public.accounts) = 6, 'A 可以建立自己的帳戶');
update public.accounts set currency = 'USD' where name = '美金帳戶';

-- 一次 insert 多筆、父子同一個 statement（前端註冊時就是這樣建預設分類）
insert into public.categories (id, parent_id, kind, name, system_key) values
  ('c0000000-0000-0000-0000-000000000001', null, 'expense', '飲食', null),
  ('c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'expense', '早餐', null),
  ('c0000000-0000-0000-0000-000000000003', null, 'expense', '年度例外', null),
  ('c0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000003', 'expense', '禮物', null),
  ('c0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000004', 'expense', '小明', null),
  ('c0000000-0000-0000-0000-000000000006', null, 'expense', '其他支出', 'other_expense'),
  ('c0000000-0000-0000-0000-000000000007', 'c0000000-0000-0000-0000-000000000006', 'expense', '手續費', 'fee'),
  ('c0000000-0000-0000-0000-000000000008', null, 'income', '投資收入', 'investment_income'),
  ('c0000000-0000-0000-0000-000000000009', 'c0000000-0000-0000-0000-000000000008', 'income', '股利', 'dividend'),
  ('c0000000-0000-0000-0000-00000000000a', null, 'income', '工作收入', null);
select t.ok((select count(*) from public.categories) = 10, '父子分類可以在同一次 insert 建立，三層可以');

select t.throws($$insert into public.categories (parent_id, kind, name) values ('c0000000-0000-0000-0000-000000000005','expense','第四層')$$,
  '最多三層', '不能超過三層');
select t.throws($$insert into public.categories (parent_id, kind, name) values ('c0000000-0000-0000-0000-000000000001','income','薪水')$$,
  '收支類型', '子分類收支類型要跟上層一樣');
select t.throws($$update public.categories set parent_id = 'c0000000-0000-0000-0000-000000000001' where name = '年度例外'$$,
  '最多三層', '搬移整棵時連子分類一起算深度');
select t.throws($$update public.categories set parent_id = 'c0000000-0000-0000-0000-000000000002' where name = '飲食'$$,
  '子分類底下', '不能掛到自己的子孫底下');
select t.throws($$update public.categories set parent_id = id where name = '飲食'$$,
  '子分類底下', '不能掛到自己底下');
update public.categories set parent_id = 'c0000000-0000-0000-0000-000000000003' where name = '早餐';
select t.ok((select parent_id from public.categories where name = '早餐') = 'c0000000-0000-0000-0000-000000000003', '可以把子分類搬到別的上層');
update public.categories set parent_id = 'c0000000-0000-0000-0000-000000000001' where name = '早餐';
select t.throws($$insert into public.categories (kind, name) values ('expense','飲食')$$,
  'duplicate|unique', '同一層分類不能重名');
select t.throws($$update public.categories set kind = 'income' where name = '飲食'$$,
  '不能改收支類型', '有子分類的分類不能改收支類型');

-- 分帳範例（規格書）：LINE Pay 1000，幫大家付 500、自己吃 70，小明還現金 215、小華轉郵局 215
insert into public.transactions (type, occurred_at, account_id, amount, category_id, group_id, source) values
  ('expense', '2026-11-10 12:00+08', 'a0000000-0000-0000-0000-0000000000a1', 70, 'c0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001', 'split');
insert into public.transactions (type, occurred_at, account_id, amount, to_account_id, to_amount, to_fx_rate, group_id, source) values
  ('transfer', '2026-11-10 12:00+08', 'a0000000-0000-0000-0000-0000000000a1', 430, 'a0000000-0000-0000-0000-00000000000f', 430, 1, 'e0000000-0000-0000-0000-000000000001', 'split'),
  ('transfer', '2026-11-11 09:00+08', 'a0000000-0000-0000-0000-00000000000f', 215, 'a0000000-0000-0000-0000-00000000000c', 215, 1, null, 'manual'),
  ('transfer', '2026-11-12 09:00+08', 'a0000000-0000-0000-0000-00000000000f', 215, 'a0000000-0000-0000-0000-0000000000a2', 215, 1, null, 'manual');

create temp view bal as
  select a.name, a.opening_balance
       + coalesce((select sum(case when t.type = 'income' then t.amount else -t.amount end)
                     from public.transactions t where t.account_id = a.id), 0)
       + coalesce((select sum(t.to_amount) from public.transactions t where t.to_account_id = a.id), 0) as balance
    from public.accounts a;
grant select on bal to authenticated;
select t.ok((select string_agg(name || '=' || balance::int, ' ' order by name) from bal
             where name in ('LINE Pay','朋友欠我','現金','郵局')) = 'LINE Pay=500 朋友欠我=0 現金=215 郵局=215',
  '分帳範例：餘額 LINE Pay 500、朋友欠我 0、現金 215、郵局 215');
select t.ok((select sum(amount) from public.transactions where type = 'expense'
               and occurred_at >= '2026-11-01+08' and occurred_at < '2026-12-01+08') = 70,
  '分帳範例：本月支出 70');

select t.throws($$insert into public.transactions (type, account_id, amount, category_id) values ('expense','a0000000-0000-0000-0000-00000000000c', 10, 'c0000000-0000-0000-0000-00000000000a')$$,
  '不一致', '支出不能記在收入分類');
select t.throws($$insert into public.transactions (type, account_id, amount, to_account_id) values ('transfer','a0000000-0000-0000-0000-00000000000c', 10, 'a0000000-0000-0000-0000-0000000000a2')$$,
  'check', '轉帳一定要有轉入金額');
select t.throws($$insert into public.transactions (type, account_id, amount, to_account_id, to_amount, to_fx_rate) values ('transfer','a0000000-0000-0000-0000-00000000000c', 10, 'a0000000-0000-0000-0000-00000000000c', 10, 1)$$,
  'check', '不能轉給自己');
select t.throws($$delete from public.accounts where name = 'LINE Pay'$$,
  'foreign key', '有交易的帳戶不能刪');
select t.throws($$delete from public.categories where name = '早餐'$$,
  'foreign key', '有交易的分類不能刪');
select t.throws($$delete from public.categories where name = '年度例外'$$,
  'foreign key', '有子分類的分類不能刪');
select t.throws($$delete from public.categories where system_key = 'fee'$$,
  '系統預設', '系統分類不能刪');
delete from public.categories where name = '小明';
select t.ok(not exists (select 1 from public.categories where name = '小明'), '沒有交易的分類可以刪');

-- 轉帳手續費：拆出一筆「其他支出-手續費」，刪轉帳時一起刪
insert into public.transactions (id, type, account_id, amount, to_account_id, to_amount, to_fx_rate) values
  ('d0000000-0000-0000-0000-000000000001', 'transfer', 'a0000000-0000-0000-0000-0000000000a2', 1000, 'a0000000-0000-0000-0000-0000000000a4', 31.15, 32.1);
insert into public.transactions (type, account_id, amount, category_id, parent_id) values
  ('expense', 'a0000000-0000-0000-0000-0000000000a2', 15, 'c0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000001');
delete from public.transactions where id = 'd0000000-0000-0000-0000-000000000001';
select t.ok(not exists (select 1 from public.transactions where parent_id = 'd0000000-0000-0000-0000-000000000001'),
  '刪除轉帳時，拆出來的手續費一起刪');

-- 範本
select t.throws($$insert into public.templates (name, mode, type, account_id, category_id) values ('早餐','instant','expense','a0000000-0000-0000-0000-00000000000c','c0000000-0000-0000-0000-000000000002')$$,
  'check', '一鍵記帳的範本一定要有金額');
insert into public.templates (name, mode, type, account_id, category_id, amount) values
  ('早餐', 'instant', 'expense', 'a0000000-0000-0000-0000-00000000000c', 'c0000000-0000-0000-0000-000000000002', 60);
select t.ok((select count(*) from public.templates) = 1, '有金額的一鍵範本可以存');

-- 固定收支＋待確認清單
insert into public.recurring_rules (id, name, type, account_id, category_id, amount, interval_unit, start_date) values
  ('f0000000-0000-0000-0000-000000000001', '房租', 'expense', 'a0000000-0000-0000-0000-0000000000a2', 'c0000000-0000-0000-0000-000000000002', 12000, 'month', '2026-01-31');
insert into public.pending_items (id, source, recurring_id, occurrence_index, due_date) values
  ('90000000-0000-0000-0000-000000000001', 'recurring', 'f0000000-0000-0000-0000-000000000001', 0, '2026-01-31'),
  ('90000000-0000-0000-0000-000000000002', 'recurring', 'f0000000-0000-0000-0000-000000000001', 1, '2026-02-28');
select t.throws($$insert into public.pending_items (source, recurring_id, occurrence_index, due_date) values ('recurring','f0000000-0000-0000-0000-000000000001', 0, '2026-01-31')$$,
  'duplicate|unique', '同一個固定收支的同一天不會產生兩筆');
insert into public.transactions (type, account_id, amount, category_id, source, pending_item_id) values
  ('expense', 'a0000000-0000-0000-0000-0000000000a2', 12500, 'c0000000-0000-0000-0000-000000000002', 'recurring', '90000000-0000-0000-0000-000000000001');
select t.ok((select status from public.pending_items where id = '90000000-0000-0000-0000-000000000001') = 'confirmed',
  '確認時產生交易，項目自動變成已確認（可改金額）');
select t.throws($$insert into public.transactions (type, account_id, amount, category_id, pending_item_id) values ('expense','a0000000-0000-0000-0000-0000000000a2', 1, 'c0000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001')$$,
  '處理過|duplicate|unique', '同一筆不能確認兩次');
update public.pending_items set status = 'skipped' where id = '90000000-0000-0000-0000-000000000002';
select t.throws($$insert into public.transactions (type, account_id, amount, category_id, pending_item_id) values ('expense','a0000000-0000-0000-0000-0000000000a2', 1, 'c0000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000002')$$,
  '處理過', '已跳過的項目不能再確認');
select t.throws($$update public.pending_items set status = 'pending' where id = '90000000-0000-0000-0000-000000000002'$$,
  '處理過', '已處理的項目不能改回待確認');

-- 股票
insert into public.pending_items (id, source, dedupe_key, due_date, payload) values
  ('90000000-0000-0000-0000-000000000003', 'broker', 'W0001', '2026-11-20', '{"symbol":"2330"}');
select t.throws($$insert into public.pending_items (source, dedupe_key, due_date) values ('broker','W0001','2026-11-20')$$,
  'duplicate|unique', '同一個委託書號不會重複匯入');
select t.throws($$insert into public.stock_trades (brokerage_account_id, market, symbol, side, trade_date, shares, price, currency, settlement_account_id) values ('a0000000-0000-0000-0000-0000000000a3','TW','2330','opening','2026-01-01',1000,500,'TWD','a0000000-0000-0000-0000-0000000000a2')$$,
  'check', '期初持股不產生交割');
insert into public.stock_trades (brokerage_account_id, market, symbol, side, trade_date, shares, price, currency) values
  ('a0000000-0000-0000-0000-0000000000a3', 'TW', '2330', 'opening', '2026-01-01', 1000, 500, 'TWD');
insert into public.stock_trades (brokerage_account_id, market, symbol, side, trade_date, settle_date, shares, price, fee, currency, settlement_account_id, settle_amount, order_no, pending_item_id) values
  ('a0000000-0000-0000-0000-0000000000a3', 'TW', '2330', 'buy', '2026-11-20', '2026-11-24', 100, 1000, 142, 'TWD', 'a0000000-0000-0000-0000-0000000000a2', 100142, 'W0001', '90000000-0000-0000-0000-000000000003');
select t.ok((select status from public.pending_items where id = '90000000-0000-0000-0000-000000000003') = 'confirmed',
  '確認券商成交後，項目變成已確認');
select t.throws($$insert into public.stock_trades (brokerage_account_id, market, symbol, side, trade_date, shares, price, currency, order_no) values ('a0000000-0000-0000-0000-0000000000a3','TW','2330','buy','2026-11-21',1,1,'TWD','W0001')$$,
  'duplicate|unique', '委託書號不能重複');
select t.throws($$update public.stock_trades set pnl_txn_id = (select id from public.transactions limit 1) where side = 'opening'$$,
  'check', '只有賣出才有已實現損益');
insert into public.categories (kind, name, parent_id, system_key) values ('income', '股票獲利', 'c0000000-0000-0000-0000-000000000008', 'stock_gain');
insert into public.transactions (id, type, account_id, amount, category_id, source) values
  ('d0000000-0000-0000-0000-000000000009', 'income', 'a0000000-0000-0000-0000-0000000000a3', 2725, (select id from public.categories where system_key = 'stock_gain'), 'stock');
insert into public.stock_trades (brokerage_account_id, market, symbol, side, trade_date, shares, price, currency, pnl_txn_id) values
  ('a0000000-0000-0000-0000-0000000000a3', 'TW', '2330', 'sell', '2026-11-22', 50, 1000, 'TWD', 'd0000000-0000-0000-0000-000000000009');
delete from public.transactions where id = 'd0000000-0000-0000-0000-000000000009';
select t.ok((select pnl_txn_id from public.stock_trades where trade_date = '2026-11-22') is null, '刪掉損益那筆，成交上的連結清空（成交本身保留）');
select t.throws($$insert into public.dividends (brokerage_account_id, market, symbol, pay_date, gross, withholding, currency, transaction_id) select 'a0000000-0000-0000-0000-0000000000a3','US','VOO','2026-11-01',10,20,'USD', id from public.transactions limit 1$$,
  'check', '預扣不能大於股利總額');

-- 匯率：讀得到、寫不了
select t.ok((select rate from public.fx_rates where currency = 'USD') = 32.1, '登入的人讀得到匯率');
select t.throws($$insert into public.fx_rates values ('JPY','2026-11-20',0.21)$$,
  'permission|policy|row-level', '一般使用者不能寫匯率');

-- ================= 使用者 B =================
select t.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select t.ok((select count(*) from public.accounts) = 0, 'B 看不到 A 的帳戶');
select t.ok((select count(*) from public.transactions) = 0, 'B 看不到 A 的交易');
update public.transactions set amount = 1;
select t.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select t.ok((select count(*) from public.transactions where amount = 1) = 0, 'B 改不到 A 的交易');
select t.as_user('bbbbbbbb-0000-0000-0000-000000000002');
delete from public.transactions;
select t.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select t.ok((select count(*) from public.transactions) > 0, 'B 刪不到 A 的交易');
select t.as_user('bbbbbbbb-0000-0000-0000-000000000002');

insert into public.accounts (id, name, type) values ('b0000000-0000-0000-0000-00000000000c', '現金', 'cash');
insert into public.categories (id, kind, name) values ('cb000000-0000-0000-0000-000000000001', 'expense', '飲食');
select t.ok((select count(*) from public.accounts) = 1, 'B 可以建立同名的帳戶（各自獨立）');
select t.throws($$insert into public.transactions (type, account_id, amount, category_id) values ('expense','a0000000-0000-0000-0000-00000000000c', 10, 'cb000000-0000-0000-0000-000000000001')$$,
  'foreign key', 'B 不能把交易掛在 A 的帳戶');
select t.throws($$insert into public.transactions (type, account_id, amount, category_id) values ('expense','b0000000-0000-0000-0000-00000000000c', 10, 'c0000000-0000-0000-0000-000000000002')$$,
  'foreign key|找不到', 'B 不能把交易掛在 A 的分類');
select t.throws($$insert into public.transactions (type, account_id, amount, to_account_id, to_amount, to_fx_rate) values ('transfer','b0000000-0000-0000-0000-00000000000c', 10, 'a0000000-0000-0000-0000-00000000000c', 10, 1)$$,
  'foreign key', 'B 不能轉帳到 A 的帳戶');
select t.throws($$insert into public.categories (parent_id, kind, name) values ('c0000000-0000-0000-0000-000000000001','expense','偷掛')$$,
  '找不到|foreign key', 'B 不能把分類掛在 A 的分類底下');
select t.throws($$insert into public.accounts (user_id, name, type) values ('aaaaaaaa-0000-0000-0000-000000000001','偷塞','cash')$$,
  'row-level|policy', 'B 不能用 A 的 user_id 寫資料');
select t.throws($$insert into public.transactions (type, account_id, amount, category_id, pending_item_id) values ('expense','b0000000-0000-0000-0000-00000000000c', 1, 'cb000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000003')$$,
  'foreign key|duplicate|unique', 'B 不能確認 A 的待確認項目');
select t.throws($$update public.accounts set user_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  'row-level|policy', 'B 不能把自己的資料改成 A 的');

-- ================= 捷徑／信箱記帳碼 =================
-- B 產生記帳碼（App 只存雜湊）
insert into public.inbox_tokens (token_hash, label) values (encode(extensions.digest('b-token-0123456789-0123456789-0123456789', 'sha256'), 'hex'), 'iPhone');
select t.ok((select count(*) from public.inbox_tokens) = 1, '記帳碼：自己看得到自己的');
insert into public.categories (kind, name) values ('income', '飲食');  -- 同名的收入分類不能被拿去記支出
select t.as_user(null);
select t.throws($$select public.inbox_add('wrong-token-0123456789-0123456789-0123', '{"amount":"100","category":"飲食"}')$$, '記帳碼不對', '捷徑：記帳碼錯的不能寫');
select t.throws($$select count(*) from public.inbox_tokens$$, 'permission', '未登入讀不到記帳碼');
select t.throws($$select public.inbox_find_category('bbbbbbbb-0000-0000-0000-000000000002', 'expense', '飲食')$$, 'permission', '未登入不能直接呼叫找分類');
select t.ok((public.inbox_add('b-token-0123456789-0123456789-0123456789', '{"amount":"NT$120","category":"飲食","account":"現金","note":"捷徑午餐"}'))->>'status' = 'recorded', '捷徑：分類、帳戶對得到 → 直接記一筆');
select t.ok((public.inbox_add('b-token-0123456789-0123456789-0123456789', '{"amount":"88","category":"不存在的分類"}'))->>'status' = 'pending', '捷徑：分類對不到 → 進待確認');
select t.ok((public.inbox_add('b-token-0123456789-0123456789-0123456789', '{"kind":"email","amount":"3,280","merchant":"全聯","message_id":"m1"}'))->>'status' = 'pending', '信箱：消費通知進待確認');
select public.inbox_add('b-token-0123456789-0123456789-0123456789', '{"kind":"email","amount":"3,280","merchant":"全聯","message_id":"m1"}');
select t.throws($$select public.inbox_add('b-token-0123456789-0123456789-0123456789', '{"amount":"0","category":"飲食"}')$$, '金額', '捷徑：金額 0 不行');
select t.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select t.ok((select count(*) from public.transactions where source = 'shortcut' and amount = 120 and note = '捷徑午餐' and category_id = 'cb000000-0000-0000-0000-000000000001') = 1, '捷徑記的那筆在 B 的帳上');
select t.ok((select count(*) from public.pending_items where source = 'email') = 1, '同一封信只進一次待確認');
select t.ok((select count(*) from public.pending_items where source = 'shortcut' and (payload->>'amount')::numeric = 88) = 1, '對不到分類的捷徑在待確認');
select t.ok((select last_used_at is not null from public.inbox_tokens limit 1), '記帳碼記錄最後使用時間');
select set_config('role', 'postgres', false);
select t.ok((select count(*) from public.transactions where source = 'shortcut' and user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0, '捷徑不會寫到別人帳上');
select t.as_user('bbbbbbbb-0000-0000-0000-000000000002');
-- 朋友欠款：交易可以記「誰」
insert into public.transactions (type, account_id, amount, category_id, counterparty) values ('expense','b0000000-0000-0000-0000-00000000000c', 10, 'cb000000-0000-0000-0000-000000000001', '小明');
select t.ok((select count(*) from public.transactions where counterparty = '小明') = 1, '交易可以記對象');

-- ================= 未登入 =================
select t.as_user(null);
select t.throws($$select count(*) from public.accounts$$, 'permission', '未登入不能讀帳戶');
select t.throws($$select public.delete_my_account()$$, 'permission', '未登入不能呼叫刪帳號');

-- ================= 刪除帳號 =================
select t.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select public.delete_my_account();
select set_config('role', 'postgres', false);
select t.ok(not exists (select 1 from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000001'), '刪帳號：使用者被刪除');
select t.ok((select count(*) from public.transactions where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0
        and (select count(*) from public.accounts where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0
        and (select count(*) from public.categories where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0
        and (select count(*) from public.stock_trades where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0
        and (select count(*) from public.pending_items where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0,
  '刪帳號：所有資料一起刪掉（含系統帳戶、系統分類）');
select t.ok((select count(*) from public.accounts where user_id = 'bbbbbbbb-0000-0000-0000-000000000002') = 1, '刪帳號不影響其他人');

do $$ begin
  if coalesce(current_setting('t.fail', true), '') <> '' then
    raise exception '失敗的測試：%', current_setting('t.fail');
  end if;
  raise notice '全部 % 項通過', current_setting('t.n');
end $$;
