# 0008. The scheduler: registered operations as jobs under a bounded queue

Status: accepted (W2-2, SCH, first slice; `40467bd`, reax run 41565482186). Recorded as D-27 (the
job model, limits and dispatch rule), D-28 (`daemon_busy` and the additive protocol) and D-29
(`session.index` takes the `pm.db` write lock without blocking the event loop) in
`docs/implementation/DECISION-LOG.md`.

## Context

The daemon (ADR 0007) answers ping, status and shutdown. Clients now need to run operations
through it with limits on how much runs at once, a way to stop work they no longer want, and
deadlines. Only Node 24 built-ins are used; nothing in `src/` runs a host tool. The registry,
`docs/operations.md` and `docs/tools.json` are unchanged: no operation is added.

## Decision

- **Jobs.** `src/sched/scheduler.ts` (`Scheduler`, `SCHED_LIMITS`, `SchedulerOptions`) runs
  registered operations as jobs, in process. A job is `{job (UUID), seq, owner (the connection),
  operation, class, effect, state, submittedAt, startedAt, endedAt, timeoutMs, cancelRequested,
  reason, error}`. `class` is the operation's `cost` (`cheap`, `medium`, `deep`); `state` is
  `queued`, `running`, `succeeded`, `failed`, `cancelled` or `timed_out`, and a final state never
  changes. Times are milliseconds since the epoch, from the scheduler's clock.
- **Submit validates first:** an unknown operation is `operation_unknown`; arguments failing the
  operation's schema, a workspace that is not an absolute path to an existing directory, and a
  `timeoutMs` that is not a whole number from 1 to `maxTimeoutMs` are `bad_request`. A refused
  submission is never queued. Then admission, then dispatch.
- **Limits** (`SCHED_LIMITS`, frozen; no environment variable and no CLI flag; tests shrink them
  only in process through `new Scheduler({ limits })` or `startDaemon({ sched: { limits } })`):

  | Limit | Default | Refusal or effect |
  |---|---:|---|
  | `maxQueued` (queued jobs, daemon-wide) | 64 | `job_queue_full`, `scope: "daemon"`, for a job that cannot start at once |
  | `maxPerOwner` (queued plus running, per connection) | 16 | `job_queue_full`, `scope: "connection"` |
  | `maxRunning` | 4 | waits |
  | `maxRunningDeep` | 1 | waits |
  | `maxRunningNonCheap` (medium plus deep) | 3 (`maxRunning - 1`: the reserved cheap slot) | waits |
  | `maxRunningWrite` (`effect: "write"`) | 1 | waits (write serialisation) |
  | `timeoutMs` by class (cheap, medium, deep) | 60 s, 300 s, 900 s | `job_timeout` |
  | `maxTimeoutMs` | 3600 s | `bad_request` above it |
  | `maxRetained` (finished jobs kept) | 128 | the oldest finished job is evicted; then `job_not_found` |
  | `maxRetainedBytes` (stored results) | 32 MiB | the oldest finished job is evicted first |
  | `resultBudget` (runOperation's budget) | 512 KiB | paged results shortened; others `result_too_large` |
  | `maxWaitsPerConnection` (outstanding `job.wait`) | 8 | `bad_request` |
  | `maxWaitMs` (`job.wait`) | 30 s | `bad_request` above it |
  | `shutdownDrainMs` | 10 s | logged, then shutdown continues |

  `job_queue_full` is retryable, with `detail: {scope, queued, max}`. `resultBudget` stays under
  the daemon's 1 MiB reply backpressure limit.
- **The dispatch rule** (the fairness rule; the reference model in
  `test/fixtures/sched-model.ts` implements the same text, and is compared exactly with the
  scheduler on hand cases and 50 fixed seeds of 300 random events):
  1. Dispatch runs synchronously after each submit, finish, cancel and disconnect, and repeats
     until nothing more can start.
  2. A queued job is **eligible** when starting it keeps every running cap: total, deep,
     non-cheap and write.
  3. The owners with an eligible job are taken in **round-robin** order: the owner whose last
     dispatch is oldest goes first; an owner never dispatched counts as oldest, ties broken by
     their first submission's `seq`. That owner's eligible job with the lowest `seq` starts. An
     owner's record (first `seq`, last dispatch) lasts for the owner's whole life and is forgotten
     only when it disconnects (`dropOwner`): an owner that is idle for a while, or keeps one job
     at a time, keeps its place in the turn. The daemon has one owner per connection, so there
     are at most a few dozen records; an in-process caller is refused past 1024 owners.
  4. An ineligible job never blocks an eligible one behind it (no head-of-line blocking across
     classes). Within one owner and one class, order is FIFO.

  Because dispatch always runs to a fixed point, no queued job is eligible between events; so a
  submitted job that is eligible starts at once, and the daemon-wide cap refuses only jobs that
  would have to wait.

  **Bound.** While an owner has an eligible job, no other owner is dispatched twice before it is
  dispatched once: after a dispatch an owner is the most recent, and it cannot go again until
  every owner dispatched longer ago, or never, has had its turn. So a job waits for at most
  `(owners - 1)` dispatches of other owners per dispatch of its own owner, where `owners` counts
  every owner with an eligible job meanwhile. Each **new connection** (each `reax daemon run` is
  one) counts as never dispatched and so goes ahead of every owner already dispatched, once; it
  then takes its place in the turn. The bound therefore grows by one dispatch for each
  connection that submits for the first time while the job waits: with at most 32 connections
  open, at most 32 owners are ahead at any moment, but a stream of short-lived connections can
  keep delaying a waiting job of an older connection (fixing that needs aging or a "joins at the
  back" rule; a later slice). Within that, medium and deep jobs can hold at most
  `maxRunningNonCheap` slots, so a flood of them never takes the reserved cheap slot. The reference
  model checks the bound from the dispatch history at every dispatch (hand cases, including an
  owner that resubmits each time its job ends, and 50 seeds whose owners also resubmit), and the
  seeded runs check that every admitted job starts once the running ones finish.
- **Running a job.** At start the scheduler makes an `AbortController`, arms the deadline (from
  the **start**, not the submit, on the injected clock; `AbortSignal.timeout` is not used because
  a test clock cannot drive it), and calls the operation with `{ workspace: realpath(workspace),
  home: the daemon's home, signal }` and `budget: resultBudget`. `runOperation` (through `runOp`)
  checks `signal.throwIfAborted()` before `op.run`. The final state:
  - the operation resolves: `succeeded`, even when a cancel arrived after the operation had passed
    its last check (`cancelRequested: true` is kept): **succeeded beats a late cancel**;
  - it rejects while the signal is aborted: `cancelled` or `timed_out`, as the abort's reason
    says, with the operation's own code (`engine_cancelled`, …) kept as `error.detail.cause`;
  - otherwise `failed`, with the operation's `CoreError`; anything else becomes `job_failed` with
    a message excerpt of at most 200 characters.
- **Cancelling** is synchronous: a queued job is removed at once, becomes `cancelled` and never
  starts; a running job gets `cancelRequested` and its signal is aborted with `job_cancelled`
  (`detail.reason`: `client`, `disconnect` or `shutdown`); its final state comes from how the
  operation settles. A finished job is unchanged (`cancelled: false`). A timeout aborts with
  `job_timeout` (`detail.timeoutMs`), a code distinct from cancellation.
- **Cancellation is cooperative in process.** Engine runs are stopped by the sandbox: their
  process tree is killed (ADR 0006). In-process operations stop at their checks: `session.index`
  checks the signal after each slice is read, after its reads, before its write and once more
  inside the write transaction, just before COMMIT (`PM_HOOKS.inTransaction` is a synchronous
  test seam there), so an abort there rolls the transaction back. Nothing is checked after
  COMMIT.
- **Disconnect.** A closed connection cancels the queued and running jobs it submitted (reason
  `disconnect`) and ends its outstanding waits. A connection that only waited on or cancelled
  another owner's job cancels nothing when it goes.
- **Shutdown.** The daemon stops accepting connections, then `scheduler.close()` refuses new
  submits with `daemon_not_running` (retryable), cancels every job (reason `shutdown`) and waits
  up to `shutdownDrainMs` for the running ones to settle; what is still running then is logged and
  shutdown continues with ADR 0007's file order. Waiters are answered before the sockets close.
- **`pm.db` without freezing the daemon (D-29, amending D-23's `pm_busy`).** The daemon shares
  one `pm.db` connection across jobs. `withImmediate(db, { signal, budgetMs }, body)` takes the
  write lock: each attempt sets `PRAGMA busy_timeout = 0`, tries `BEGIN IMMEDIATE` and restores the
  pragma, so a lock held by another process never blocks the event loop; between attempts it awaits
  a cancellable timer of at most 50 ms. Past the budget (`PM_LIMITS.busyTimeoutMs`, 5 s, as before)
  it throws the retryable `pm_busy`; an abort while waiting throws the signal's reason. Once BEGIN
  succeeds, `body`, COMMIT and ROLLBACK run **synchronously, in the same tick**: an await between
  BEGIN and COMMIT would let another job's statements run inside this transaction on the shared
  connection. `body` must be synchronous (a returned promise is refused and rolled back). The CLI
  uses the same path: 5 s, then `pm_busy`. Write jobs also run one at a time (`maxRunningWrite`).
- **Wire** (`src/daemon/jobs.ts`; additive, `PROTOCOL_VERSION` stays 1; D-28). Every method is
  reachable only after a valid hello. `params` must be an object with only the listed keys
  (`bad_request` otherwise). Errors carry the failure's `detail`.

  | Method | Params | Result |
  |---|---|---|
  | `job.submit` | `operation`, `args?` (object), `workspace` (absolute), `timeoutMs?` | `{job, state, position}`: `state` is `running` when it started on submit; `position` is its 0-based place among queued jobs, or `null` |
  | `job.status` | `job` | JobInfo |
  | `job.list` | — | `{jobs (by seq), counts: {queued, running, retained}, limits}` |
  | `job.wait` | `job`, `timeoutMs?` (0 to 30 s, default 30 s) | JobInfo with `done`; `done: false` at the timeout, not an error |
  | `job.result` | `job` | `{job, result}` when `succeeded`; the job's own error otherwise; `bad_request` while not final |
  | `job.cancel` | `job` | `{job, state, cancelled}` |

  JobInfo is the job record above (no result). An unknown or evicted id is `job_not_found`.
  `job.wait` replies are sent when the wait resolves, so they can arrive out of order; clients
  match replies by `id`. `status` gains `jobs`. Test operations reach a scheduler only through
  the in-process `resolveOperation` option; `reax serve` never passes it.
- **The busy frame (D-28).** At `MAX_CONNECTIONS` a new connection gets one
  `{"type":"hello","ok":false,"error":{"code":"daemon_busy","retryable":true,…}}` frame before it
  has sent anything, and is ended (destroyed after 1 s at most, counted in the 64-socket cap).
  Past 64 sockets, and while stopping, it is closed without a frame. reax's client maps a close
  before the hello reply to `daemon_busy`. A wrong token still always gets `daemon_unauthorized`.
- **CLI.** `reax daemon run <operation> [key=value ...] [--json] [--workspace] [--timeout-ms N]
  [--format] [--filter-output] [--token-limit]` submits, waits (30 s per `job.wait`, at most 1000
  waits) and prints the result as `reax op` does, on one connection; SIGINT or SIGTERM closes it,
  so the daemon cancels the job, and the command exits 1 with `[job_cancelled]`. `reax daemon
  jobs` prints `job.list`; `reax daemon cancel <job>` prints `job.cancel`'s result. There is no
  `daemon submit` without waiting: its job would be cancelled when the CLI disconnected.
- **Failure codes** (`src/errors.ts`): `daemon_busy` (retryable), `job_queue_full` (retryable),
  `job_not_found`, `job_cancelled`, `job_timeout`, `job_failed`.
- **Trust.** Any authenticated connection may query or cancel any job: same-user trust, as SR-9
  states for the token.

## Out of scope (stated limits)

- Cancellation in process is cooperative: a synchronous parse between checks runs to completion
  (REA-C36-LIMIT stays open); only engine runs are killed.
- Jobs live in memory: a daemon restart loses them (XST).
- No retries (FAIL), no single-flight by cache key (SNAP), no aging or priorities, no memory- or
  disk-aware admission (POOL), no stall watchdog (AB-P9), no progress notifications (REA-C36), no
  MCP or sessions, no auto-start.
- Round-robin is unweighted (AB-P10 asks for weighted fair queuing).
- On Windows, engine jobs in tests run unenforced, as in ENG's contract tests; target engines stay
  fail-closed (D-22).
- `openPm`'s first-time migration still waits synchronously, up to 5 s, on the event loop.
- On `--tcp`, slot exhaustion by silent peers (ADR 0007) still delays clients, who are now told
  `daemon_busy`.
- The daemon does not own `pm.db`: the CLI still writes it directly, and SQLite's locks arbitrate
  (D-23's reopen trigger stays untriggered).

## Consequences

- Clients can bound and stop the work they start, and are told when to retry.
- The scheduler is the place where later slices add single-flight, priorities, memory admission
  and persistence; each is a reopen trigger for D-27.
