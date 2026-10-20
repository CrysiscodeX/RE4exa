#!/usr/bin/env bash
# Dissect the five targets added for the RQS-2030 re-review into their own database (the first
# ten are in ../dissection/dissection.db.gz; orca alone makes this one ~160 MB, so it is not
# committed), then load the review graph into it.
# usage: dissect-targets.sh <dir-with-clones> <out.db>
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
G=$1 DB=$2
DISSECT="$HERE/../../tools/dissect/dissect.sh"
"$DISSECT" --db "$DB" scan "$G/PromptEngineer48__agent-sandbox-lockdown=agent-sandbox-lockdown" "$G/aicodeking__pandacode=pandacode" \
  "$HERE/../..=re4exa" "$G/pingdotgg__t3code=t3code" "$G/stablyai__orca=orca" > /dev/null
python3 "$HERE/load_graph.py" "$DB" "$HERE/results.json"
