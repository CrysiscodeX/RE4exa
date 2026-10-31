#!/bin/bash
# Development setup for RE4exa: the repository needs Node >= 24.15 (CI uses the version in
# .nvmrc), but some container images default to Node 22 and come back to it after a restart.
# Installs the pinned Node with nvm (checksum-verified by nvm), prints the PATH line to use, and
# installs the workspace dependencies with scripts off, as CI does. Idempotent and non-interactive.
#   bash scripts/dev/setup-node.sh            # e.g. as a cloud environment's setup script
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NODE_VERSION="$(tr -d '[:space:]' < "$ROOT/.nvmrc")"
export NVM_DIR="${NVM_DIR:-/opt/nvm}"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm ls "$NODE_VERSION" >/dev/null 2>&1 || nvm install "$NODE_VERSION" >/dev/null
nvm alias default "$NODE_VERSION" >/dev/null
NODE_BIN="$NVM_DIR/versions/node/v$NODE_VERSION/bin"
export PATH="$NODE_BIN:$PATH"
cd "$ROOT"
npm install --ignore-scripts --no-audit --no-fund >/dev/null
echo "node $(node --version) at $NODE_BIN; dependencies installed"
echo "export PATH=\"$NODE_BIN:\$PATH\""
