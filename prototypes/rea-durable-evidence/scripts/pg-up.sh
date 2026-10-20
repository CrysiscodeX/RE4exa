#!/usr/bin/env bash
# Start a throwaway local Postgres 16 and install Absurd's schema plus sql/app.sql.
# env: PG_ROOT (cluster dir), PG_PORT, ABSURD_REF (absurd git commit to take sql/absurd.sql from)
set -euo pipefail
export PGOPTIONS="-c client_min_messages=warning"
HERE=$(cd "$(dirname "$0")/.." && pwd)
PG_ROOT=${PG_ROOT:-$HERE/.run/pg} PG_PORT=${PG_PORT:-54329}
ABSURD_REF=${ABSURD_REF:-3cfc64f10b0bef7ff159ec4e01a4ae76424c8d05}
BIN=${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }  # postgres refuses root
mkdir -p "$PG_ROOT"; [ "$(id -u)" = 0 ] && chown postgres "$PG_ROOT"
[ -f "$PG_ROOT/data/PG_VERSION" ] || as_pg "$BIN/initdb" -D "$PG_ROOT/data" -A trust -U postgres -E UTF8 >/dev/null
as_pg "$BIN/pg_ctl" -D "$PG_ROOT/data" -o "-p $PG_PORT -k $PG_ROOT -c listen_addresses=127.0.0.1" -l "$PG_ROOT/log" -w status >/dev/null 2>&1 \
  || as_pg "$BIN/pg_ctl" -D "$PG_ROOT/data" -o "-p $PG_PORT -k $PG_ROOT -c listen_addresses=127.0.0.1" -l "$PG_ROOT/log" -w start >/dev/null
URL=postgresql://postgres@127.0.0.1:$PG_PORT/rea_durable
psql -q "postgresql://postgres@127.0.0.1:$PG_PORT/postgres" -tc "select 1 from pg_database where datname='rea_durable'" | grep -q 1 \
  || psql -q "postgresql://postgres@127.0.0.1:$PG_PORT/postgres" -c "create database rea_durable"
if [ "$(psql -qtA "$URL" -c "select to_regprocedure('absurd.get_schema_version()') is not null")" != t ]; then
  SQL=${ABSURD_SQL:-}
  if [ -z "$SQL" ]; then  # absurd.sql is not in the npm package; take it from the pinned repo commit
    SRC=$HERE/.run/absurd-src; rm -rf "$SRC"; git init -q "$SRC"
    git -C "$SRC" fetch -q --depth 1 https://github.com/earendil-works/absurd "$ABSURD_REF"
    git -C "$SRC" show FETCH_HEAD:sql/absurd.sql > "$HERE/.run/absurd.sql"; SQL=$HERE/.run/absurd.sql
  fi
  psql -q -v ON_ERROR_STOP=1 "$URL" -f "$SQL" >/dev/null
  psql -q "$URL" -c "select absurd.create_queue('rea')" >/dev/null
fi
psql -q -v ON_ERROR_STOP=1 "$URL" -f "$HERE/sql/app.sql" >/dev/null
echo "$URL"
