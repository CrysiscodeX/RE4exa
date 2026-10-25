# 01 Anatomy: absurd

Advocate: A-absurd. Source: `earendil-works/absurd` at `3cfc64f` (Apache-2.0, `absurd:LICENSE`). Citations are `absurd:path:line` at that commit unless they say otherwise. Labels: **[seen]** read in code or docs, **[inferred]** reasoned from what was seen, **[unknown]**. RQS levels come from `research/rqs-review/reports/absurd.md` (grade D, 44.7). I re-checked each one I use: *confirmed* means I found the cited evidence at this commit; *unconfirmed* means I could not check it.

## 1. What it really is

Absurd is one PL/pgSQL file, `absurd:sql/absurd.sql` (3158 lines). It installs an `absurd` schema with five tables per queue: tasks, runs, checkpoints, events and waits (`absurd:sql/absurd.sql:8-14, 222-302`). Stored functions on those tables provide a pull-based task queue with leases, per-step checkpoints, sleeps, first-write-wins events, task-level retries and cooperative cancellation (`absurd:sql/absurd.sql:764-2050`) [seen]. Three thin SDKs (TypeScript, Python, Go) call only those functions. Each SDK adds a worker loop, a step-name counter and a checkpoint cache (`absurd:CONTRIBUTING.md:25-29`, `absurd:sdks/typescript/src/index.ts:302-474`) [seen]. Around the core sit:

- `absurdctl`, a Python CLI that runs `psql`;
- `habitat`, a Go and SolidJS dashboard;
- an agent skill;
- pattern docs, including one for pi agents.

Absurd has no coordinator, no push delivery and no LISTEN/NOTIFY: workers poll, every 0.25 s by default (`absurd:README.md:58-65`, `absurd:sdks/typescript/src/index.ts:1126`) [seen]. It is a database-resident state machine with client libraries, not a service. Postgres provides all the durability; absurd chooses no commit settings of its own [inferred: nothing in `sql/` or the SDKs sets `synchronous_commit`].

## 2. Organs

All organs are Apache-2.0 under `absurd:LICENSE`, and the Go SDK also has `absurd:sdks/go/absurd/LICENSE` [seen]. The repo has no NOTICE file. The npm package ships only `dist` and `README.md`, without the licence text (`absurd:sdks/typescript/package.json:15-18`) [seen; confirms PRV-3 = 2]. To lift a part, copy `LICENSE` and add an attribution line.

### Summary

| # | Organ | One job | Verdict |
|---|---|---|---|
| O1 | Queue storage layout | Create the per-queue tables, indexes and optional partitions | adapt |
| O2 | Task/run/checkpoint state machine | Record tasks, attempts and step results, and move them between states | lift |
| O3 | Claim and lease | Give a run to exactly one claimer at a time, and recover it after the lease expires | lift (with fixes) |
| O4 | Events and sleeps | Suspend a run until a time or a named event | lift |
| O5 | Retries and cancellation | Schedule the next attempt, enforce attempt limits, cancel | adapt |
| O6 | Retention and partition maintenance (plus pg_cron) | Bound table growth | pattern |
| O7 | Test clock and ids | Fake time, portable UUIDv7 | lift |
| O8 | TypeScript SDK | Worker loop, `ctx.step` / `sleep` / `awaitEvent`, lease watchdog | adapt |
| O9 | Python SDK | The same as O8, sync and async | leave (pattern only) |
| O10 | Go SDK (experimental) | The same as O8 | leave |
| O11 | absurdctl | Install or migrate the schema, inspect and operate tasks | adapt |
| O12 | habitat | Web dashboard and JSON API | leave (pattern for the read model) |
| O13 | Migrations | Upgrade the schema between releases | pattern |
| O14 | Agent skill and agents docs | Teach an agent to inspect absurd state | pattern |
| O15 | pi-agent pattern doc and agent-loop example | Show agent turns as durable steps | leave |
| O16 | Tests, CI and release | Verify the SQL core and SDKs, publish packages | adapt (the tests); leave (the release pipeline) |

### O1 Queue storage layout

- **Function:**
  - `ensure_queue_tables` creates `t_`, `r_`, `c_`, `e_` and `w_` tables for each queue, plus `i_` for partitioned queues, through `format('%I')` dynamic DDL (`absurd:sql/absurd.sql:184-371`).
  - Queue names are capped at 57 bytes so that generated index names fit the 63-byte identifier limit (`:163-180`).
  - Partitioned mode partitions by UUIDv7 range, in weekly buckets (`:208-213, 2424-2538`) [seen].
- **Interfaces:**
  - `create_queue(name, mode)`, `drop_queue`, `list_queues`, `get_queue_policy` / `set_queue_policy` (`:374-726`);
  - the plain tables themselves, which habitat reads directly (`absurd:habitat/internal/server/handlers.go:218-219, 557-563`) [seen].
- **State and lifecycle:**
  - The tables live until `drop_queue`, which drops them with `cascade` (`:425-460`).
  - The queue policy row lives in `absurd.queues` (`:131-154`).
- **Depends on:** Postgres declarative partitioning with default partitions, and `DETACH ... CONCURRENTLY` (`:2881`; PG14+) [seen / inferred].
- **RQS:** INT-7 = 4 (open formats; confirmed: all state is in documented tables, `absurd:docs/concepts.md:96-109`).
- **Carried defects:**
  - The table layout is the de facto API for habitat, so a schema change can break the UI silently [inferred].
  - The `jsonb` columns for params, checkpoint state and payloads have no size limit (`:226, 271, 284`) [seen; confirms REL-2 = 2].
- **Verdict:** adapt. Keep the five-table model. In a merged product, decide between one table set per queue and one shared table set with a queue column, because per-queue dynamic DDL makes static analysis and grants harder [inferred].

### O2 Task/run/checkpoint state machine

- **Function:**
  - `spawn_task` inserts the task and its first run in one call (`:764-913`).
  - `complete_run` (`:1081-1140`), `schedule_run` (`:1143-1187`) and `fail_run` (`:1189-1341`) move the run and the task through `pending | running | sleeping | completed | failed | cancelled` (`:236, 253`).
  - `set_task_checkpoint_state` upserts a checkpoint keyed by `(task_id, checkpoint_name)` (`:1468-1553`).
  - `get_task_checkpoint_states` returns only the committed checkpoints whose owner attempt is at or before the reading run's attempt (`:1647-1698`, rule at `:1692`) [seen].
- **Interfaces:** SQL functions. Errors are the SQLSTATEs AB001 (cancelled), AB002 (run already failed) and AB003 (bad retry strategy) (`:76-121, 1108-1113`) [seen].
- **State and lifecycle:**
  - One run row per attempt. The task row keeps `attempts`, `last_attempt_run` and `completed_payload`.
  - A checkpoint written by attempt *n* is overwritten only by an attempt ≥ *n* (`:1540`) [seen].
  - Spawn idempotency uses `on conflict do nothing`, on `t_` or on the `i_` side table (`:813-890`) [seen; confirms INT-5 = 4, with tests in `absurd:tests/test_idempotent_spawn.py`].
- **Depends on:** PL/pgSQL, `jsonb`, and `gen_random_uuid` (core since PG13) [seen / inferred].
- **RQS:** REL-1 = 4 (confirmed for the SQL evidence `:915-1078` and the fake-clock CI tests `absurd:tests/test_state_transitions.py:41-90`). The external SIGKILL trial the review cites is in an excluded directory: *unconfirmed*. COR-5 = 3 (confirmed).
- **Carried defects:**
  - No GRANT/REVOKE anywhere. Every function runs with the caller's rights, so any role that can call `complete_run` with a run id can complete any run (no `grant` in `sql/absurd.sql`) [seen; supports SEC-1 = 0].
  - No code or SDK version is recorded with a run (EPI-1 = 2, confirmed).
- **Verdict:** lift. This is the most valuable organ. It is small, readable, tested against real Postgres, and its semantics are explicit in SQL.

### O3 Claim and lease

- **Function:** `claim_task(queue, worker, claim_timeout=30, qty=1)` (`:915-1078`), in four parts:
  1. It cancels tasks whose cancellation policy has fired (`:951-978`).
  2. It fails up to `qty` runs whose lease has expired, with reason `$ClaimTimeout` (`:980-1015`).
  3. It selects runs that are ready, using `for update skip locked` (`:1017-1026`).
  4. It marks them `running` with `claim_expires_at = now + timeout` (`:1030-1036`).

  `extend_claim` (`:1555-1616`) and the `p_extend_claim_by` argument of checkpoint writes (`:1515-1527`) renew the lease [seen].
- **Interfaces:** SQL. The SDKs default to a 120 s lease (`absurd:sdks/typescript/src/index.ts:1123`) [seen].
- **State and lifecycle:** The lease is a timestamp on the run row; there is no lock held during execution. Expiry has effect only when some worker next calls `claim_task` on that queue [seen: the sweep exists only inside `claim_task`].
- **Depends on:** `SKIP LOCKED`, and row locks taken runs-first, task-second (`:1995-2016`; deadlock tests in `absurd:tests/test_lock_ordering.py:61, 145`) [seen].
- **RQS:** REL-1 = 4 (confirmed); PERF-1 = 2 (confirmed: CI asserts index use with EXPLAIN, `absurd:tests/test_indexes.py:35-110`).
- **Carried defects (new findings, not in the review):**
  - `claim_timeout <= 0` gives `claim_expires_at = NULL` (`:946-948`). The expiry sweep needs a non-null expiry (`:993-995`), so a crashed worker's run then stays `running` forever [seen].
  - `extend_claim` refuses only a null expiry, not an expired one (`:1603-1612`). A worker whose lease expired but has not yet been swept can extend it again, and `complete_run` checks only `state = 'running'` (`:1108`). A late worker therefore wins if no other worker has polled in between [seen code; the consequence is inferred].
- **Verdict:** lift, with the two fixes above: reject a zero lease, and compare `claim_expires_at` with now in `extend_claim`, `complete_run` and checkpoint writes.

### O4 Events and sleeps

- **Function:**
  - `await_event` returns a cached checkpoint if there is one. Otherwise it pre-creates an event row with a NULL payload, locks it `for share`, then locks the run `for update`, and either resolves at once or registers a wait and sets the run to `sleeping` with `available_at = timeout or infinity` (`:1700-1885`).
  - `emit_event` lets one NULL→payload transition happen and ignores every later emit (`:1906-1922`). It wakes sleeping waiters and writes their checkpoint in one statement (`:1924-1980`).
  - Sleep is a checkpoint that holds the wake time, followed by `schedule_run` (`absurd:sdks/typescript/src/index.ts:414-427`) [seen].
- **Interfaces:** SQL, plus SDK `awaitEvent`, `emitEvent`, `sleepFor` and `sleepUntil`.
- **State and lifecycle:**
  - Events are scoped to a queue and kept until `cleanup_events` removes them by TTL (`:2252-2294`).
  - They are never consumed, so a later `awaitEvent` on the same name returns the old payload at once [seen code; the consequence is inferred]. Event names must be unique per occurrence, for example `shipment.packed:<orderId>` (`absurd:README.md:162`).
- **Depends on:** O2 and O3.
- **RQS:** INT-5 = 4 (confirmed: first-write-wins, `absurd:tests/test_events.py:66`; emit/await race test `:165`).
- **Carried defects:**
  - Sleep wake times come from the worker's clock (`Date.now()`, `absurd:sdks/typescript/src/index.ts:403-421`), while expiry uses the database clock, so clock skew shifts wake-ups [inferred].
  - An event timeout surfaces as `TimeoutError` (`:507-513`) and writes no checkpoint, so the timeout branch depends on the run's `wake_event` fields [seen].
- **Verdict:** lift.

### O5 Retries and cancellation

- **Function:**
  - Retries happen per task, never per step (`absurd:docs/concepts.md:238-246`).
  - `fail_run` creates the next run when `max_attempts` allows it (`:1268`). The delay is `fixed`, `exponential` or `none`, capped at 86400 s, and overflow saturates (`:56-129`).
  - `retry_task` reopens a failed task or spawns a copy (`:1343-1466`).
  - `cancel_task` marks the task and its live runs `cancelled` (`:1984-2050`).
  - Policies: `max_duration` (since first start) and `max_delay` (enqueue to first start only, `:962-974`) [seen].
- **Interfaces:** SQL, the SDK `spawn` options, and `absurdctl retry-task` / `cancel-task`.
- **State and lifecycle:**
  - The SDK default is 5 attempts (`absurd:sdks/typescript/src/index.ts:658`).
  - An expired lease consumes an attempt, because the sweep calls `fail_run` (`:1001-1014`) [seen].
  - Cancellation is cooperative: running code finds out only at its next checkpoint write, heartbeat or await, through AB001 (`:1506-1508, 1591-1593, 1793-1795`). I found no in-process abort signal [seen by absence of `AbortSignal` in the SDKs].
- **RQS:** REL-3 = 3 (confirmed).
- **Carried defects:**
  - `maxDelay` is documented as a "no checkpoint for N seconds" watchdog (`absurd:docs/concepts.md:312`, `absurd:docs/sdks/typescript.md:432`, `absurd:docs/sdks/go.md:727`). It is implemented as a limit on the time to first start (`:966-968`), and `absurd:docs/patterns/deployments.md:46-47` describes it correctly [seen; confirms the review gap].
  - Absurd has no crash-loop guard beyond `max_attempts`. With `max_attempts = null`, retries never end (`:1268`) [seen].
- **Verdict:** adapt. Keep the SQL, fix the docs, and add a no-progress policy if one is needed.

### O6 Retention and partition maintenance

- **Function:**
  - `cleanup_tasks` / `cleanup_events` delete in TTL batches (`:2113-2294`).
  - `ensure_partitions` builds a weekly window (`:2424-2538`).
  - Detach planning and dropping (`:2540-2920`).
  - `enable_cron` / `disable_cron` schedule all three jobs with pg_cron (`:2929-3158`) [seen].
- **Interfaces:** SQL, `absurdctl cleanup`, `absurdctl cron`.
- **State and lifecycle:** The policy lives in `absurd.queues`. By default data lives forever (`absurd:docs/concepts.md:432-436`).
- **Depends on:** pg_cron, optionally. Its absence raises explicit errors (`:2983-3004`) [seen].
- **RQS:** EPI-4 = 3 (confirmed for the cleanup counts). OPS-1 = 2 (confirmed).
- **Carried defects:** Only PG16 with pg_cron 1.6.7 is tested (`absurd:tests/docker/pg16-pgcron/Dockerfile:1`, `absurd:.github/workflows/test.yml:49`) [seen].
- **Verdict:** pattern. A merged product needs retention, but weekly partitions and pg_cron are heavyweight for a local or embedded deployment [inferred].

### O7 Test clock and ids

- **Function:**
  - `absurd.current_time()` returns the session setting `absurd.fake_now` if it is set, and `clock_timestamp()` otherwise (`:37-52`).
  - `portable_uuidv7()` uses PG18's `uuidv7()` when present and builds a v7 UUID from `gen_random_uuid` otherwise (`:2296-2325`) [seen].
- **RQS:** COR-5 = 3 (confirmed).
- **Carried defects:** The PG18 branch is never executed in CI (`absurd:tests/conftest.py:155` uses `postgres:16-alpine`) [seen].
- **Verdict:** lift. Database-side fake time is what makes the lease tests deterministic.

### O8 TypeScript SDK (`absurd-sdk`, 1610 lines)

- **Function:**
  - `TaskContext.create` loads all visible checkpoints into a Map (`absurd:sdks/typescript/src/index.ts:302-331`).
  - `step` = `beginStep`, then `fn()`, then `completeStep` (`:350-397`).
  - A repeated step name becomes `name#2`, `name#3` (`:429-434`).
  - `startWorker` provides concurrency, polling and graceful `close()` (`:1120-1222`).
  - The lease watchdog warns at 1× the lease and calls `process.exit(1)` at 2× (`:1256-1276`).
  - Unknown task names are deferred 15-30 s instead of failed (`:1292-1318`).
  - `bindToConnection` runs operations on a caller's connection, for example inside the caller's transaction (`:668`; `absurd:docs/sdks/typescript.md:339-351`) [seen].
- **Interfaces:** `Absurd`, `TaskContext`, the hooks `beforeSpawn` / `wrapTaskExecution`, and `Queryable = Pick<pg.Client, "query">` (`:7`) [seen].
- **Depends on:** Node (`os`, `process`), and `pg` ^8 as a peer dependency (`absurd:sdks/typescript/package.json:41-53`) [seen].
- **RQS:** COR-1 = 3 (confirmed: `make test` runs the TS suite, `absurd:Makefile:39`). REL-4 = 3 (confirmed).
- **Carried defects:**
  - `process.exit` kills every concurrent task in the process, not just the one that overran [inferred from `:1272`].
  - Every run reloads every checkpoint (REL-2, confirmed).
  - A handler that catches all exceptions also swallows the internal `SuspendTask` and breaks suspension [inferred from `:1334-1340`].
- **Verdict:** adapt. Of the three SDKs it is the closest to pi's TypeScript stack. Make the checkpoint load lazy or paged, and abort only the affected task.

### O9 Python SDK (`absurd-sdk`, 2317 lines)

- **Function:** The same model, sync and async (`absurd:sdks/python/src/absurd_sdk/__init__.py:674-1203`). The sync worker runs tasks in a thread pool over a single autocommit connection (`:1302-1321, 1689`) [seen].
- **Carried defects:**
  - No lease watchdog (no "exceeded claim timeout" path, unlike TS and Go) [seen by absence; new finding].
  - Python 3.9-3.14 is claimed (`absurd:sdks/python/pyproject.toml:13-21`), the quickstart says 3.11+ (`absurd:docs/quickstart.md:27`), and CI tests 3.12 only (`absurd:.github/workflows/test.yml:18`) [seen; EVO-3 = 1 confirmed].
- **Verdict:** leave, unless a Python surface is in scope. The SQL core makes a new SDK cheap anyway [inferred].

### O10 Go SDK (experimental)

- **Function:** `Step`, `SleepFor`, `AwaitEvent` and `Heartbeat` as generics over `context.Context` (`absurd:sdks/go/absurd/context.go:278-450`), with a lease watchdog that calls `os.Exit(1)` at 2× (`absurd:sdks/go/absurd/worker.go:260-297`). It runs over `database/sql` (`absurd:sdks/go/absurd/absurd.go:5, 421-434`) [seen].
- **Labelled:** "experimental bootstrap" (`absurd:README.md:56`).
- **Verdict:** leave.

### O11 absurdctl (Python, 3027 lines; it runs `psql`)

- **Function:** 18 commands: init, migrate, schema-version, cleanup, queue and cron management, spawn/retry/cancel/emit, list-tasks, dump-task, install-skill (`absurd:absurdctl:2914-2945`) [seen].
- **Interfaces:**
  - CLI text output only, no `--json` (review G11, confirmed: I saw no JSON mode in the help).
  - The `psql` subprocess takes an argv list and `-v` variables (`absurd:absurdctl:302-342`) [seen].
- **Depends on:** Python 3 and the `psql` binary [seen].
- **RQS:** SEC-7 = 3 (confirmed for argv-based psql). OPS-4 = 2 (confirmed).
- **Carried defects:**
  - When the requested ref is not bundled, `init` / `migrate` fetch SQL from GitHub over `urlopen`, with no digest check, and apply it (`absurd:absurdctl:517-519, 585-606, 1716-1730`) [seen; confirmed].
  - `CHANGELOG.md:63` records an earlier SQL injection fix [seen].
- **Verdict:** adapt. The read commands (list, dump, schema-version) are a good agent surface once they get JSON output and byte limits. Remove the remote fetch.

### O12 habitat (Go 1.24 server with an embedded SolidJS UI)

- **Function:** A read model over the queue tables, plus one write: `POST /api/tasks/retry` calls `absurd.retry_task` (`absurd:habitat/internal/server/server.go:113-131`, `absurd:habitat/internal/server/handlers.go:960-1069`). The UI is embedded with `go:embed` (`absurd:habitat/internal/web/static.go:10`) [seen].
- **Network exposure:**
  - The default listen address is `":7890"`, which means all interfaces (`absurd:habitat/internal/config/config.go:15`; `net.Listen` at `server.go:73`).
  - The default `sslmode` is `disable` (`config.go:21`).
  - No authentication middleware (`server.go:113-131`).
  - The write endpoint checks only the method and the JSON shape (`handlers.go:961-987`), with no Origin or content-type check and no body-size limit [seen].
  - The docs say "localhost" and "read-only view" (`absurd:docs/tools/habitat.md:22, 87`) [seen].
  - **All confirmed:** OPS-3 = 1, SEC-8 = 2.
- **Other defects:**
  - Its 13 Go tests never run in CI: `absurd:Makefile:39` has no habitat target [seen; confirmed].
  - `github.com/go-crypt/crypt` is required in `absurd:habitat/go.mod:8` but never imported [seen; new finding, minor].
- **Verdict:** leave. A merged product should keep the idea (a summary-first read model with `hasMore` and timeouts, `handlers.go:450-462`) but must bind to loopback by default, require authentication or a local socket, and keep writes off unless they are enabled.

### O13 Migrations

- **Function:** Eleven version-pair SQL files (`absurd:sql/migrations/`), applied by `absurdctl migrate`, or dumped for the user's own migration tool (`absurd:docs/database.md:7-13`) [seen].
- **Carried defects:**
  - No `begin` / `commit` in any migration file [seen by grep].
  - `run_psql` does not pass `--single-transaction` (`absurd:absurdctl:302-342`).
  - The version is bumped first (`absurd:sql/migrations/0.5.0-0.5.1.sql:6-11`).
  - Missing intermediate files are reported as "null migrations" (`absurd:absurdctl:1746-1752`) [seen; confirms review G4 and EPI-3 = 2].
  - A partly applied migration reports the new version [inferred, as in the review].
- **Verdict:** pattern. Keep the "single schema file plus forward migrations" idea; rebuild the runner around transactions.

### O14 Agent skill and agents docs

- **Function:** `absurd:skills/absurd/SKILL.md` (256 lines) teaches a summary-first debugging flow. Its "Safe operating rules" are prose only (`:198-213`). `absurdctl install-skill` copies it (`absurd:docs/agents.md:19-34`) [seen].
- **RQS:** PERF-2 = 2 and INT-2 = 2 (both confirmed).
- **Carried defects:** The rules are not enforced: there is no read-only mode or role [seen].
- **Verdict:** pattern.

### O15 pi-agent pattern doc and agent-loop example

- **Function:** `absurd:docs/patterns/pi-ai-agent.md:1-101` stores each pi `message_end` as a `message` step (`message`, `message#2`, …). On retry it rebuilds the context from those steps and calls `runAgentLoopContinue`. `absurd:sdks/typescript/examples/agent-loop/agent-loop.ts` does the same with the Vercel AI SDK [seen].
- **Carried defects:**
  - The doc imports `@mariozechner/pi-agent-core` and `@mariozechner/pi-ai` (`:19-20`). The packages are now `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` (`pi:packages/agent/package.json:2`, `pi:packages/ai/package.json:2` at `fdce48e`) [seen].
  - Tool executions are not steps, so a crash after a tool's side effect and before its `message_end` reruns the tool [inferred].
  - "last.role === 'assistant' → finished" (`:91-93`) may treat an assistant message that contains tool calls as finished [inferred; whether pi then emits separate tool-result messages is unknown, because I did not read `pi/packages/agent`].
- **Verdict:** leave. pi-durable now covers this ground with intent records and replay policies (section 5).

### O16 Tests, CI and release

- **Function:**
  - 20 pytest files against real Postgres 16 and a pg_cron image (`absurd:tests/`, `absurd:tests/conftest.py:155, 206`).
  - SDK suites for TS, Python and Go.
  - Everything runs on each push and PR through `make check` and `make test` (`absurd:.github/workflows/test.yml:3-5, 33, 53`) [seen].
- **Notable tests:**
  - a stale run's checkpoint write gets AB002 (`absurd:tests/test_checkpoints.py:82-115`);
  - a lease reclaim (`absurd:tests/test_state_transitions.py:41-90`);
  - the lock-ordering deadlock tests;
  - the bounded sweep (`absurd:tests/test_claim_maintenance.py:50`) [seen].
- **RQS:** COR-1 = 3, COR-3 = 1 and COR-4 = 3 (confirmed).
- **Release (EVO-2 = 2, SEC-5 = 1):**
  - Confirmed: the release job needs only `build-habitat` and `validate-release-versions` (`absurd:.github/workflows/build.yml:129`), and actions are pinned by tag (`test.yml:13-24`).
  - Unconfirmed: the review's count of 0 of 37 actions pinned by SHA.
- **Verdict:** adapt the SQL core tests: they are the executable specification of O2-O5. Leave the release pipeline.

## 3. Durability and concurrency guarantees, exactly

1. **Spawn.** The task and its first run are inserted inside one function call, which is one transaction [seen `:764-913`; inferred atomicity]. With an idempotency key, at most one task exists per key per queue (`on conflict do nothing`, `:813-890`; tests in `absurd:tests/test_idempotent_spawn.py`). This holds until retention cleanup deletes the task, after which the key can be used again [inferred]. `bindToConnection` lets a caller spawn inside its own transaction, which gives a transactional enqueue next to the caller's application writes (`absurd:docs/sdks/typescript.md:339-351`) [seen].
2. **Claim.** At any instant, at most one caller can move a given run from `pending` / `sleeping` to `running` (`for update skip locked`, `:1026`) [seen]. A claim does **not** guarantee exclusive execution for the length of the lease. The lease is advisory: nothing stops the original worker's code when the lease expires.
   - **Before the next `claim_task` on that queue,** an expired run is still `running`. Its worker can write checkpoints, extend the lease and complete the run (`:1108, 1595-1612`) [seen].
   - **After the sweep,** the old run is `failed`. Its writes raise AB002, and the SDKs turn AB002 into a silent stop (`absurd:sdks/typescript/src/index.ts:1392-1404`). Only from this point does the run id act as a fencing token [seen].
   - **Until the old worker's next SQL call,** its in-memory step code may still be running while attempt *n+1* runs elsewhere. The docs admit "brief overlapping execution is possible" (`absurd:docs/concepts.md:131-133, 247-252`) [seen].
3. **Steps are at-least-once.** `fn()` runs, and only then is the checkpoint written, as a separate autocommit statement (`absurd:sdks/typescript/src/index.ts:350-358, 455-474`). A crash between the two reruns `fn()` [seen code; the consequence is inferred]. Once a checkpoint has committed, later attempts read it and skip the step (`:1647-1698`) [seen]. Checkpoints from a later attempt are invisible to an earlier one (`:1692`), and an earlier attempt cannot overwrite a later one's checkpoint (`:1540`) [seen].
4. **Code outside steps runs again on every run:** after a sleep, an event wait, a retry or a lease loss (`absurd:docs/concepts.md:87-88`) [seen].
5. **Events.** The first emit per (queue, name) wins and later emits are ignored (`:1906-1922`). An emit before the await is not lost (`absurd:tests/test_events.py:165`) [seen]. Delivery to a waiter happens exactly once in the sense that the payload is stored as that waiter's checkpoint inside the emit statement (`:1951-1961`) [seen].
6. **Exactly-once is not guaranteed.** The README invokes "the promise of exactly-once" (`absurd:README.md:37-38`), and the concepts doc says "close to 'exactly once'" (`absurd:docs/concepts.md:29`). What it gives is **at-least-once execution, with an exactly-once record of each committed step result** [inferred from items 2-4].
7. **Liveness depends on polling.** Expired leases are recovered only by `claim_task`, at most `qty` per call (`:952, 980-1015`). A lease of 0 or less disables recovery entirely (`:946-948`) [seen].

**What a step must be in order to be safe** [inferred from items 2-4, and in line with `absurd:docs/concepts.md:362-406`]:

- **idempotent,** or guarded by an external idempotency key derived from `ctx.taskID` plus the step name;
- **called in a stable order with stable names,** because the `#n` suffixes are positional (`absurd:sdks/typescript/src/index.ts:429-434`);
- **JSON-serialisable,** with a bounded size, because every run reloads every checkpoint;
- **short,** or heartbeating, well within the lease;
- **tolerant of a concurrent duplicate** for the overlap window;
- **careful with exceptions:** it must not swallow the SDK's control-flow exceptions.

## 4. Environment, blind spots, and portability

- **Postgres:**
  - "14 or later" is stated in `absurd:docs/quickstart.md:24`. This corrects the review, which said supported versions are not stated. `DETACH ... CONCURRENTLY` needs PG14 (`:2881`), and `gen_random_uuid` is core from PG13 [seen / inferred].
  - Only PG16 is tested (`absurd:tests/conftest.py:155`).
  - The PG18 `uuidv7` branch has never run in CI [seen].
- **Extensions:** none are required. pg_cron is optional (`absurd:docs/quickstart.md:25`) [seen].
- **Clients:**
  - `psql` for absurdctl;
  - `pg` ^8 for TypeScript;
  - `psycopg` ≥ 3 for Python (`absurd:sdks/python/pyproject.toml:24-26`);
  - any `database/sql` driver for Go [seen].
- **Blind spots:**
  - No role or grant model [seen].
  - Behaviour under PgBouncer transaction pooling, on read replicas and across failover is untested [unknown]. Every SDK call is a single statement, which suggests transaction pooling is harmless, but `absurd.fake_now` is a session setting [inferred].
  - No metrics export or OpenTelemetry (OPS-2 = 2, confirmed).
  - No size limits on payloads.
  - No measured throughput (PERF-1 = 2).
  - Wake-ups have polling latency (0.25 s by default) because there is no NOTIFY [seen].
- **SQLite:**
  - The code cannot run there. It is PL/pgSQL with dynamic DDL, `SKIP LOCKED`, schemas and partitions [seen].
  - The *model* is portable: tasks, runs, attempt-scoped checkpoints, first-write-wins events and a lease timestamp. A SQLite port would be a rewrite of about 40 functions [inferred; the SQL has 39 `create function`, per the review count].
  - With one writer, the lease fields still guard against crashed processes, though not against concurrent claimers [inferred].
- **PGlite (embedded Postgres in WASM):** unknown. The repo never mentions it (grep for `pglite` finds nothing).
  - Points in favour [inferred, untested]: the schema needs no extension, the PL/pgSQL is plain, and the TS SDK only needs an object with `.query(sql, params)` returning `{rows}` (`absurd:sdks/typescript/src/index.ts:7`).
  - Points against [inferred]: pg_cron would be unavailable; a single connection makes `SKIP LOCKED` concurrency moot; and the TS SDK imports Node's `os` and calls `process.exit`.
  - A one-hour spike (load `absurd.sql` into PGlite and run `tests/test_state_transitions.py`-equivalent calls) would settle it. That is an estimate, not a measurement.

## 5. What absurd should contribute, and what it should not

**Contribute:**

- **O2-O5 and O7 as the shared-work substrate:** the run-per-attempt state machine, attempt-scoped checkpoint visibility, race-safe spawn idempotency, first-write-wins events, a lease with an expiry sweep, a database-side fake clock, and their pytest suite as a conformance specification. These parts are worth having only when more than one process or host must share durable work, or when the deployment already runs Postgres [inferred].
- **Transactional enqueue** through `bindToConnection` (O8): agent work can be spawned atomically with the application writes that caused it [seen].
- **The read surface of absurdctl** (O11), after JSON output and byte limits are added, as the agent-facing inspection tool. The skill (O14) supplies the summary-first flow, rebuilt as enforced read-only policy.
- **Honest documentation of semantics:** overlap is admitted and code outside steps is said to rerun. A merged product should keep that candour and drop "exactly-once" wording (`absurd:README.md:37-38`).

**Do not contribute:**

- **habitat** as it stands: it binds all interfaces, has no authentication, and has an untested write endpoint (O12).
- **absurdctl's** remote SQL fetch, and the non-atomic **migration runner** (O11, O13).
- **The pi pattern doc** (O15): it is stale and does not make tools durable.
- **The Python and Go SDKs** (O9, O10).
- **pg_cron and weekly partitioning** (O6) as defaults for a local product.
- **The 2× lease `process.exit`** (O8) as written: in a multi-task agent host it kills unrelated work [inferred].

**Overlap with pi-durable (honest note).** pi-durable re-implements most of this organ set for agents: tasks, checkpoints, sleeps, retries and crash bounds. It also adds three things absurd lacks:

- **intent records** committed before a tool runs, with `replay: "safe"` or an `interrupted` result (`pi:packages/durable/README.md:275`);
- **a crash-loop guard** that parks a task after `restartLimit` (`:214`);
- **storage portable** to SQLite, JSONL and Cloudflare Durable Objects (`:762-764`).

It states plainly that "one process owns a storage at a time; there is no cross-process locking" (`:783`) [seen].

So the overlap is large, and pi-durable is the better fit for a single-user or local agent. On that path absurd is mostly overhead: Postgres, polling, and a weaker tool-replay model [inferred]. Absurd's unique part is multi-worker leasing and fan-out on a shared Postgres, plus transactional enqueue. The realistic join is therefore an adapter, not a merge. Either pi-durable gets a Postgres storage plus lease backend whose semantics are copied from O2-O4, or absurd steps drive pi-durable tasks. In either case one product should not ship two durable-step engines [inferred; this agrees with the review's consolidation answer]. If the merged product will never run more than one worker process, the null option for absurd ("leave it, use pi-durable") is strong, and I record that against my own advocacy.
