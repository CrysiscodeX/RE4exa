# Benchmark pre-registration, version 2: smoke test

Written 2026-10-27, before any live cell runs. Version 1 (`PREREG.md`) still governs the full
comparison. This version covers only the smoke test of the live backends. **Smoke results count
for no hypothesis.** They answer three questions: does each backend work end to end on a real
machine, what does a cell cost in time, tokens and memory, and which configuration is worth the
full run.

## Backends

| Backend | What runs | Model and effort |
|---|---|---|
| `local` | llama-server (llama.cpp at commit `de5122d8`, Metal) on loopback, driven by reax's lean tool loop (`reax_op`, `list_files`, `read_file`) | Qwen3-4B-Instruct-2507, Q4_K_M GGUF, digest pinned in `bench/backends.json`; context 16384, KV cache q8_0 |
| `codex` | `codex exec --json`, read-only sandbox, under the user's own ChatGPT sign-in | `gpt-6.1-sol`, `model_reasoning_effort="medium"` |
| `claude` | `claude -p --output-format stream-json`, tools limited to `Bash(reax:*)`, Read, Glob and Grep, no MCP servers, under the user's own Claude sign-in | `claude-opus-5-5`, `--effort medium` when the CLI offers it |
| `hybrid` | Opus plans (no tools), the local model works, Codex reviews, Opus decides, at most one revision | as above, per role |

Each cell records the model the CLI or server reports, not only the one requested. A difference
between the two is reported, never corrected.

## Tasks and cells

5 tasks, one of each kind: `identify-hello-x86_64-linux-gnu.2.28-s`,
`links-hello-x86_64-windows-gnu-s.exe`, `exports-lib-aarch64-macos-s.dylib`, `debug-pair` and
`adversarial-note`. 4 backends × 5 tasks × 1 repetition = 20 cells. Backends run one after
another, never at once.

## Limits

- 10 minutes per cell. A cell that runs out is kept, graded as 0 and marked `timed_out`.
- The local model: llama.cpp's reported buffers (weights, KV cache, compute) and llama-server's
  resident memory, sampled each second, must stay at or under 4096 MiB. Going over stops the
  backend; the cell is an error, not a wrong answer. The CLIs' own memory is measured, not capped.
- USD 2 of reported API-equivalent cost per cell (the CLIs' own `total_cost_usd` where they report
  one). A cell over it is reported as over budget; the run is not stopped mid-cell.

## Grading

`src/bench/grade.ts`, unchanged from version 1, identical for every backend. For `hybrid` both the
worker's first answer and the final answer are graded, so the reviewers' effect shows.

## What is published

`bench/results/smoke-<date>/<backend>/`: `cells.jsonl`, `summary.md` and every raw transcript,
written by the harness only. Errors (sign-in needed, memory cap, timeout) are published as
errors.

## Choosing the full-run configuration

Read from the smoke results, in this order: a backend with any harness error is fixed first;
then accuracy; then cost per correct answer; then time. With 5 cells per backend the result is a
direction, not evidence. The full run (version 1's design, with the chosen configuration) needs
its own go-ahead.
