#!/usr/bin/env bash
# One-time setup on a Mac (Apple Silicon) for the live benchmark backends.
# Builds llama.cpp at a pinned commit with Metal, downloads the local model, and prints the
# sign-in steps for the two CLIs (you run those yourself; this script never touches credentials).
set -euo pipefail

LLAMA_COMMIT="${LLAMA_COMMIT:-de5122d879d00d2895c36be7e0cee94105aeeabd}"   # ggml-org/llama.cpp, pinned 2026-10-27
MODEL_REPO="${MODEL_REPO:-unsloth/Qwen3-4B-Instruct-2507-GGUF}"
MODEL_FILE="${MODEL_FILE:-Qwen3-4B-Instruct-2507-Q4_K_M.gguf}"
CACHE="${REAX_CACHE:-$HOME/.cache/reax}"
HERE="$(cd "$(dirname "$0")" && pwd)"

command -v cmake >/dev/null || { echo "cmake missing: brew install cmake"; exit 1; }
mkdir -p "$CACHE/models"

if [ ! -x "$CACHE/llama.cpp/build/bin/llama-server" ]; then
  rm -rf "$CACHE/llama.cpp"
  git clone --filter=blob:none https://github.com/ggml-org/llama.cpp "$CACHE/llama.cpp"
  git -C "$CACHE/llama.cpp" checkout --quiet "$LLAMA_COMMIT"
  cmake -S "$CACHE/llama.cpp" -B "$CACHE/llama.cpp/build" -DGGML_METAL=ON -DLLAMA_CURL=OFF -DCMAKE_BUILD_TYPE=Release
  cmake --build "$CACHE/llama.cpp/build" --target llama-server -j
fi

if [ ! -f "$CACHE/models/$MODEL_FILE" ]; then
  curl -fL --progress-bar -o "$CACHE/models/$MODEL_FILE.part" "https://huggingface.co/$MODEL_REPO/resolve/main/$MODEL_FILE"
  mv "$CACHE/models/$MODEL_FILE.part" "$CACHE/models/$MODEL_FILE"
fi
SHA="$(shasum -a 256 "$CACHE/models/$MODEL_FILE" | cut -d' ' -f1)"

if [ ! -f "$HERE/backends.json" ]; then
  cat > "$HERE/backends.json" <<JSON
{
  "local": {
    "server": ["$CACHE/llama.cpp/build/bin/llama-server"],
    "model": "$CACHE/models/$MODEL_FILE",
    "modelSha256": "$SHA"
  }
}
JSON
  echo "wrote $HERE/backends.json (model pinned to sha256 $SHA)"
fi

cat <<TXT

Local model: $CACHE/models/$MODEL_FILE
  sha256 $SHA

Now sign in yourself (once each):
  npm install -g @openai/codex @anthropic-ai/claude-code
  codex login          # browser sign-in with your ChatGPT account
  claude               # then type /login, choose your Claude account, then /exit

Then check everything, including one short request per CLI:
  cd $(dirname "$HERE") && npm run bench:doctor -- --live

And run the smoke test (5 tasks on each of local, codex, claude and hybrid):
  npm run bench:smoke
TXT
