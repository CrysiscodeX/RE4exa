#!/usr/bin/env bash
# E6: REA's native/artifact inspectors on REA's own native payloads, next to the
# plain-CLI commands leanrea routes to for the same question (time + output bytes).
# usage: e6-native.sh <rea-cli> <package-dir> <outdir>
set -u
REA=$1 P=$2 OUT=$3
mkdir -p "$OUT"
WIN=$P/native/windows/build/rea-windows-x64.node
PTY=$P/node_modules/@lydell/node-pty-linux-x64/pty.node
TSV=$OUT/timings.tsv
printf 'arm\ttarget\tcommand\texit\tms\tstdout_bytes\n' > "$TSV"

run() { # arm target name cmd...
  local arm=$1 target=$2 name=$3; shift 3
  local f="$OUT/$arm-$target-$name.out" t0 t1 rc
  t0=$(date +%s%N); "$@" > "$f" 2> "$f.err"; rc=$?; t1=$(date +%s%N)
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$arm" "$target" "$name" "$rc" $(( (t1 - t0) / 1000000 )) "$(stat -c %s "$f")" >> "$TSV"
}

for t in win pty; do
  [ "$t" = win ] && F=$WIN || F=$PTY
  run rea "$t" pe-resources   "$REA" inspect-pe-resources "$F" --json
  run rea "$t" go-binary      "$REA" inspect-go-binary "$F" --json
  run rea "$t" rust-binary    "$REA" inspect-rust-binary "$F" --json
  run rea "$t" electron-fuses "$REA" inspect-electron-fuses "$F" --json
  run rea "$t" managed        "$REA" inspect-managed-artifact "$F" --json
  run rea "$t" objdump-headers "$REA" inspect-with-objdump "$F" file_headers --json
  run rea "$t" objdump-symbols "$REA" inspect-with-objdump "$F" symbols --json
  # leanrea's router rows for ELF/PE, Go, Rust (raw tools; same questions)
  run lean "$t" headers  objdump -f "$F"
  run lean "$t" exports  sh -c "objdump -p '$F' | sed -n '/Ordinal\/Name Pointer/,/^$/p'; nm -D --defined-only '$F' 2>/dev/null | head -50"
  run lean "$t" sections sh -c "objdump -h '$F' | grep -E 'rsrc|go.buildinfo|dep-v0' || echo 'no rsrc/go.buildinfo/.dep-v0 section'"
  run lean "$t" strings-go-rust sh -c "strings -a '$F' | grep -m3 -E 'Go buildinf|/rustc/[0-9a-f]{40}' || echo 'no Go/Rust markers'"
done
cat "$TSV"
