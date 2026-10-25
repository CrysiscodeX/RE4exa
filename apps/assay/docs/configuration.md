# Configuration

Assay has very few settings, and each default is the safe choice. Settings that are not recognised are rejected, not ignored.

| Setting | Where | Default | Meaning |
|---|---|---|---|
| `--home DIR` / `ASSAY_HOME` | CLI / env | `~/.assay` | The store (`assay.db`), account homes Assay creates, worker worktrees and the signing key. Created with mode 0700 |
| `--workspace DIR` | CLI | current directory | The only tree that probes, file tools and workers can read or write. Paths that leave it are refused |
| `--port N` | CLI | random free port | The loopback port. The server binds `127.0.0.1` only |
| `--demo` | CLI | off | Adds the deterministic fake provider and its account (for demos and tests) |
| `ASSAY_LOG` | env | `warn` (`info` under `serve`) | `error`, `warn`, `info`, `debug` or `off`. JSON lines on stderr, with secrets redacted |
| `ASSAY_LIVE` | env | unset | `1` enables tests and benchmarks that spend real model usage |
| Mode | per case (UI) | `enforced` | `enforced` exposes only Assay's tools to the agent client. `open` keeps the client's built-in tools, which bypass Assay's checks, and is labelled "unenforced" |
| Budget | per case (UI, API `budgetUsd`) | none | A cap in USD. Once the case's recorded spend reaches it, new turns and workers are refused with `budget_exceeded`. The coordinator gets the cap, and each worker what is left of it, as the client's own per-session limit (`maxBudgetUsd`, Claude only). Spend is known only after a turn ends, so one turn can overshoot; Codex and ACP turns are checked only between turns |

Limits fixed in code:

| Limit | Value |
|---|---|
| Tool call waiting for approval | 50 s |
| Approval request expiry | 10 min |
| Worker task text | 8,000 characters |
| Circuit breaker | opens after 3 worker failures |
| Worker depth | 1 |
| Tool text result | 8 KB, with the rest behind a handle |
| `assay_exec` | 30 s and 1 MiB of output |
| Crash-loop parking | after 5 crashes |
