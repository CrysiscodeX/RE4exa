#!/usr/bin/env bash
# Rebuild dissection.db from the studied repositories and re-run the exploration layer.
# usage: build.sh <dir-with-clones> [<rea-tools-list.json>]
#   clones are expected as <owner>__<repo> directories (see ../rea-self-analysis/NOTICE.md)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
G=$1 CATALOG=${2:-}
DISSECT="$HERE/../../tools/dissect/dissect.sh"
DB=$HERE/dissection.db
rm -f "$DB" "$DB-wal" "$DB-shm"
"$DISSECT" --db "$DB" scan \
  "$G/morluto__rea=rea" "$G/aicodeking__leanrea=leanrea" "$G/JuliusBrussee__caveman=caveman" \
  "$G/usestrix__strix=strix" "$G/DietrichGebert__ponytail=ponytail" "$G/PromptEngineer48__my-jev=my-jev" \
  "$G/earendil-works__pi=pi" "$G/earendil-works__absurd=absurd" "$G/mizorewww__laya-coreml=laya-coreml" \
  "$G/NandhaKishorM__laya=laya" 2> "$HERE/scan.log" > "$HERE/scan-result.json"
[ -n "$CATALOG" ] && "$DISSECT" --db "$DB" import-mcp rea "$CATALOG"
python3 "$HERE/explore.py" "$DB" "$HERE/../rea-self-analysis/results/findings.jsonl" "$HERE/exploration.json" > /dev/null
"$DISSECT" --db "$DB" stats | python3 -c "import json,sys; print(json.load(sys.stdin)['totals'])"
