# Benchmark pre-registration, version 2: smoke test

Written 2026-10-27, before any live cell runs. Version 1 (`PREREG.md`) still governs the full
comparison. This version covers only the smoke test of the live backends. **Smoke results count
for no hypothesis.** They answer three questions: does each backend work end to end on a real
machine, what does a cell cost in time, tokens and memory, and which configuration is worth the
full run.

## Backends

| Backend | What runs | Model and effort |
|---|---|---|
| `local` | llama-server (llama.cpp release `b11923` = commit `de5122d8`, the build `bench/setup.ts` chose for the machine's GPU) on loopback, driven by reax's lean tool loop (`reax_op`, `list_files`, `read_file`) | Qwen3-4B-Instruct-2507, Q4_K_M GGUF, digest pinned in `bench/backends.json`; context 16384, KV cache q8_0 |
| `codex` | `codex exec --json`, read-only sandbox, under the user's own ChatGPT sign-in | `gpt-6.1-sol`, `model_reasoning_effort="medium"` |
| `claude` | `claude -p --output-format stream-json`, tools limited to `Bash(reax:*)`, Read, Glob and Grep, no MCP servers, under the user's own Claude sign-in | `claude-opus-5-5`, `--effort medium` when the CLI offers it |
| `hybrid` | Opus plans (no tools), the local model works, Codex reviews, Opus decides, at most one revision | as above, per role |

Each cell records the model the CLI or server reports, not only the one requested. A difference
between the two is reported, never corrected.

## Machines

The smoke test runs on more than one machine:
1. first a MacBook (Apple Silicon, Metal);
2. then a Windows PC (the build chosen for its GPU).

Each cell records the OS, the architecture, the llama.cpp build and the device. Results from
different machines are reported separately and are never pooled: a local-model result depends on
the hardware it ran on. The CLI backends' results can differ between machines too (shell, tool
behaviour), so they are kept apart as well.

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

## Amendment 2.1 (2026-10-27, before the rerun)

Written after the first Mac run (results in `bench/results/smoke-2026-10-27-14-41-darwin/`, kept
as they are) and before any rerun. Accuracy rules and grading are unchanged.

- **Context size.** The fixed 16384-token context is replaced by the largest of 16384, 12288,
  8192 and 6144 whose measured peak fits the cap minus 5%. The measurement is the server's resident
  memory with the context about 90% full. `bench/setup.ts` measures this on the machine itself and
  writes it to `bench/backends.json`, and each local cell records it.
  - Why: in the first run llama.cpp's buffer report was under 4096 MiB, but resident memory reached
    4160–4213 MiB as the KV cache filled. The cap stays at 4096 MiB.
- **Cells not run.** When a backend stops (the memory cap, or a server that died), every remaining
  cell is still written, marked `not_run` with the reason. Such cells are left out of every mean
  and counted separately. In the first run they were missing without a record.
- **Shared machine.** Each cell records the load average, free memory, total memory and CPU count
  at its start. Runs happen on machines in normal use, so time per cell is descriptive only, and
  neither speed nor slowness is read as a property of a model.
- **The model stays the same.** Qwen3-4B-Instruct-2507 at Q4_K_M. A larger quantisation or model
  would make the cap harder to meet. A community distill has weaker provenance for a benchmark
  meant to be reproducible.

## Amendment 2.2 (2026-10-27, before the rerun)

Your decision, recorded before any run under it. Accuracy rules and grading are unchanged.

- **Local model.** Qwen3.5-9B at Q4_K_M, from your own copy
  (`~/Models/Qwen3.5-9B-Q4_K_M`). It replaces Qwen3-4B-Instruct-2507 for the local backend and as
  the hybrid's worker. `bench/setup.ts --model` pins it by the sha256 it computes; the provenance
  is your file, recorded as such, not a download from a publisher.
- **Memory cap: 12288 MiB** for these temporary test runs on a shared machine (`--mem-cap-mib`).
  It was 4096 MiB, which a 9B model's weights alone exceed. The context is still fitted under the
  cap by measurement (amendment 2.1).
- **Output per turn: up to 4096 tokens**, up from 2048, so a model that reasons before answering
  is not cut off. Its reasoning is kept in the transcript.
- **Clean shutdown.** Every local model server is closed after use and the close is confirmed:
  - SIGTERM first, SIGKILL after 5 s, then the exit and the freed port are checked;
  - also when the harness is interrupted;
  - the summary states whether the close was confirmed;
  - `bench:doctor` reports any llama-server left running.
- **No pooling.** Results from the 4B (the first Mac run) and the 9B are never pooled or
  compared as one series. The same holds for runs under different caps.

## Amendment 2.3 (2026-10-27, before the rerun)

Written after reading the 9B run (`bench/results/smoke-2026-10-27-17-01-darwin/`, kept as it is).
Every local cell failed with "no claims block". Four of the five held a claims array under a
```` ```json ```` fence. The fifth ran out of tokens while reasoning and had no answer at all. The
grader and the CLI backends are unchanged; these changes are to the local backend's harness:

- **System prompt.** It states the output contract: end with a fenced block whose info string is
  exactly `claims`. It also lists every reax operation with its one-line summary. Before, the
  contract was only in the task text and the operations were names only.
- **A `search_file` tool.** It searches a file's printable strings (UTF-8 and UTF-16). This gives
  the local model what Claude Code's Grep and Codex's shell give the CLI backends. Before, it
  could only page through 4 KiB of bytes at a time.
- **A turn that runs out of tokens while reasoning,** with no answer, gets one more turn. That
  turn asks for the final answer with thinking off. A second such turn makes the cell an error
  ("no answer"). An empty answer is never graded as if the model had answered, and each cell
  records `length_stops` and `nudged`.
- **A diagnostic, not a score.** For a cell with no claims block, the summary also shows what a
  claims array under another fence would have scored. The strict score is unchanged and is the
  only result.
- **Hybrid.** A worker with no answer is still reviewed, so the reviewers can ask it to try again.

Diagnostic of the 17:01 run under these rules: the local cells would have scored 1.00
(identify), 1.00 (adversarial-note), −0.20 (exports) and −0.125 (links); debug-pair had no
answer. Those strict scores stay at 0.00.
