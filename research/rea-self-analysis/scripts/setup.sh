#!/usr/bin/env bash
# Recreate the scratch layout used by every stage of the REA self-analysis.
# usage: setup.sh <scratch-dir>
# Produces: rt670/ (REA 6.7.0 runtime), tgt/{670,650}/package (published packages with
# production dependencies), tgt/*/package-*.zip (ZIP repacks REA can inventory),
# env.sh (exports used by the other scripts).
set -euo pipefail
S=$(mkdir -p "$1" && cd "$1" && pwd)
mkdir -p "$S"/{rt670,rt650,tgt/670,tgt/650,out,home,tmp}
export HOME=$S/home TMPDIR=$S/tmp
for v in 670 650; do
  ver=6.${v:1:1}.0
  (cd "$S/rt$v" && [ -f package.json ] || npm init -y >/dev/null; cd "$S/rt$v" && npm i --ignore-scripts --no-audit --no-fund "rea-agents@$ver" >/dev/null)
  (cd "$S/tgt/$v" && npm pack "rea-agents@$ver" >/dev/null && tar -xzf "rea-agents-$ver.tgz")
  # `npm install` inside the unpacked package fails (arborist: "Cannot read properties of null
  # (reading 'edgesOut')"), so reuse the dependency tree npm resolved for the runtime install.
  rm -rf "$S/tgt/$v/package/node_modules"
  cp -a "$S/rt$v/node_modules" "$S/tgt/$v/package/node_modules"
  rm -rf "$S/tgt/$v/package/node_modules/rea-agents" "$S/tgt/$v/package/node_modules/.bin/rea" "$S/tgt/$v/package/node_modules/.bin/rea-agents"
  python3 -I - "$S/tgt/$v/package" "$S/tgt/$v/package-$v.zip" <<'EOF'
import os, sys, zipfile
root, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for d, dirs, files in os.walk(root):
        dirs[:] = sorted(x for x in dirs if not (d == root and x == "node_modules"))
        for f in sorted(files):
            p = os.path.join(d, f); z.write(p, "package/" + os.path.relpath(p, root))
EOF
done
cat > "$S/env.sh" <<EOF
export S=$S
export REA=$S/rt670/node_modules/.bin/rea
export REA_PACKAGE_DIR=$S/rt670/node_modules/rea-agents
export P=$S/tgt/670/package P650=$S/tgt/650/package
export HOME=$S/home TMPDIR=$S/tmp NODE_OPTIONS=--max-old-space-size=8192 DO_NOT_TRACK=1
EOF
sha256sum "$S"/tgt/*/*.tgz
echo "source $S/env.sh"
