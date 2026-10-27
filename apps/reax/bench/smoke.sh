#!/usr/bin/env bash
# The smoke test: the 5 smoke tasks on each backend in turn, one after another (never at once),
# into one results directory. Stops before running anything if the doctor finds a problem.
set -euo pipefail
cd "$(dirname "$0")/.."
node --conditions=source --disable-warning=ExperimentalWarning bench/doctor.ts --backend all
OUT="bench/results/smoke-$(date -u +%Y-%m-%d-%H%M)"
for b in local codex claude hybrid; do
  node --conditions=source --disable-warning=ExperimentalWarning bench/live.ts --backend "$b" --smoke --out "$OUT/$b"
done
cat "$OUT"/*/summary.md > "$OUT/summary.md"
echo "results: $OUT/summary.md"
