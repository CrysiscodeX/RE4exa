# Live benchmark summary

| Backend | Cells | Mean accuracy | Hits | Wrong | Label errors | Parse errors | Errors | Mean s | Cost USD | Models |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| hybrid | 5 | 0.000 | 2/23 | 5 | 0 | 3 | 3 | 39.1 | 0.763 | claude-opus-5-5 + /Users/crysiscodev_x/.cache/reax/models/Qwen3-4B-Instruct-2507-Q4_K_M.gguf + gpt-6.1-sol; claude-opus-5-5 + /Users/crysiscodev_x/.cache/reax/models/Qwen3-4B-Instruct-2507-Q4_K_M.gguf + gpt-6.1-sol + local; claude-opus-5-5 + local |

Local model ran on: darwin arm64, llama.cpp metal on MTL0: Apple M4 Pro.

Hybrid: the local worker's first answers averaged 0.000; after review, 0.000.

## Errors

- hybrid exports-lib-aarch64-macos-s.dylib: worker: memory cap: llama-server resident memory reached 4160 MiB, over the 4096 MiB cap
- hybrid identify-hello-x86_64-linux-gnu.2.28-s: worker: memory cap: llama-server resident memory reached 4160 MiB, over the 4096 MiB cap
- hybrid links-hello-x86_64-windows-gnu-s.exe: worker: memory cap: llama-server resident memory reached 4160 MiB, over the 4096 MiB cap
