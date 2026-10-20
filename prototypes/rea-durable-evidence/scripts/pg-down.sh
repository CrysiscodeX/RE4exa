#!/usr/bin/env bash
# Stop the throwaway cluster and delete it.
set -euo pipefail
HERE=$(cd "$(dirname "$0")/.." && pwd)
PG_ROOT=${PG_ROOT:-$HERE/.run/pg}
BIN=${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
[ -d "$PG_ROOT/data" ] && as_pg "$BIN/pg_ctl" -D "$PG_ROOT/data" -m fast -w stop >/dev/null 2>&1 || true
rm -rf "$PG_ROOT"
