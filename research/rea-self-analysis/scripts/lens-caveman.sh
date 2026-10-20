#!/usr/bin/env bash
# Lens (caveman): token accounting of REA's catalog and results with caveman's
# offline o200k counter and its catalog/JSON compressors (telemetry-free Go engine).
# usage: lens-caveman.sh <caveman-bin-dir> <tools-full.json> <outdir> <result.json>...
set -u
BIN=$1 CAT=$2 OUT=$3; shift 3
mkdir -p "$OUT"
export DO_NOT_TRACK=1 CAVEMAN_HOME=$OUT/caveman-home CAVEMAN_CCR_DB=$OUT/caveman-home/ccr.db
mkdir -p "$CAVEMAN_HOME"
report() { # label file type
  "$BIN/caveman-engine" compress --type "$3" < "$2" > "$OUT/$1.compressed" 2> "$OUT/$1.report.json"
  python3 - "$1" "$2" "$OUT/$1.compressed" "$OUT/$1.report.json" <<'EOF'
import json, os, sys
label, src, dst, rep = sys.argv[1:]
try: r = json.load(open(rep))
except Exception: r = {"raw": open(rep).read()[:300]}
print(json.dumps({"label": label, "bytes_before": os.path.getsize(src), "bytes_after": os.path.getsize(dst),
  **{k: r.get(k) for k in ("tokens_before", "tokens_after", "ratio", "method", "content_type", "token_count_basis")}}))
EOF
}
# 1. Catalog: caveman's catalog shrinker, then the same with outputSchema removed.
python3 -c "import json,sys; d=json.load(open(sys.argv[1])); [t.pop('outputSchema',None) for t in d['tools']]; json.dump(d,open(sys.argv[2],'w'))" "$CAT" "$OUT/tools-no-output-schema.json"
"$BIN/caveman-shrink" lint "$CAT" > "$OUT/catalog.lint.txt" 2>&1
"$BIN/caveman-shrink" < "$CAT" > "$OUT/catalog.shrunk.json" 2> "$OUT/catalog.shrunk.err"
"$BIN/caveman-shrink" < "$OUT/tools-no-output-schema.json" > "$OUT/catalog-no-output.shrunk.json" 2> "$OUT/catalog-no-output.shrunk.err"
for f in "$CAT" "$OUT/catalog.shrunk.json" "$OUT/tools-no-output-schema.json" "$OUT/catalog-no-output.shrunk.json"; do
  printf '{"catalog_file":"%s","bytes":%s}\n' "$(basename "$f")" "$(stat -c %s "$f")"
done
report catalog-json "$CAT" json
# 2. Results: per-result JSON compression (lossy, originals kept in caveman's CCR store).
for f in "$@"; do report "result-$(basename "$f" .json)" "$f" json; done
