#!/usr/bin/env bash
# 用法：PGHOST=... PGPORT=... PGUSER=postgres ./supabase/tests/run.sh
# 會建一個暫時的資料庫，跑 migration 和測試，最後刪掉。
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=ledger_test_$$
createdb "$DB"
trap 'dropdb --if-exists "$DB"' EXIT
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/supabase_mock.sql
for f in supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"; done
psql -q -o /dev/null -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/db_test.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  //'
