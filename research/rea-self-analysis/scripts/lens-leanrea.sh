#!/usr/bin/env bash
# Lens (leanrea): answer the self-analysis questions with leanrea's plain-CLI recipe
# (jq + `rg -uu`, sliced output, one batched call) and time it.
# usage: lens-leanrea.sh <package-dir> <outdir>
set -u
P=$1 OUT=$2
mkdir -p "$OUT"
cd "$P"
t0=$(date +%s%N)
{
echo '--- Q1 entry points (package.json bin/main/imports)'
jq -c '{main, bin, imports, exports}' package.json
echo '--- Q2 #subpath worker resolution'
rg -uu -n -o 'import\.meta\.resolve\("#[^"]+"\)' dist --glob '!node_modules' | head -20
echo '--- Q3 bridge files referenced from JS (distinct targets)'
rg -uu -o -N 'bridge/[A-Za-z0-9_./-]+\.(py|java|swift)' dist --glob '!node_modules' | sed 's/^[^:]*://' | sort -u
echo '--- Q4 native addon load sites'
rg -uu -n -o '.{0,60}rea-windows-x64\.node.{0,40}' dist --glob '!node_modules' | head -8
echo '--- Q5 child_process call sites'
rg -uu -c '\b(spawn|execFile|fork|spawnSync|execFileSync)\(' dist --glob '!node_modules' | awk -F: '{s+=$2; n++} END {print n" files, "s" call-like matches"}'
echo '--- Q6 bundler/framework markers'
for m in __webpack_require__ webpackChunk __vite__ 'import.meta.hot' __commonJS __esm 'React.createElement' 'react/jsx-runtime' __NEXT_DATA__; do
  printf '%s: %s files\n' "$m" "$(rg -uu -l -F "$m" dist --glob '!node_modules' | wc -l)"
done
echo '--- Q7 source maps'
printf 'map files: %s, sourceMappingURL comments: %s\n' "$(find . -path ./node_modules -prune -o -name '*.map' -print | wc -l)" "$(rg -uu -l '^//[#@] sourceMappingURL=' dist | wc -l)"
} > "$OUT/answers.txt" 2>&1
t1=$(date +%s%N)
printf '{"ms":%s,"bytes":%s}\n' $(( (t1 - t0) / 1000000 )) "$(stat -c %s "$OUT/answers.txt")" | tee "$OUT/timing.json"
