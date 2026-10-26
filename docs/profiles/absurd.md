# Profile: absurd (earendil-works/absurd)

Profile 3 of 6 (rea, leanrea, pi-durable, **absurd**, Orca, T3 Code). Written 2026-10-26.

## Conventions

- **Commit.** Code citations are `path:line` at commit `3cfc64f10b0bef7ff159ec4e01a4ae76424c8d05`, the pinned commit and also `main` HEAD on 2026-10-26.
- **Labels.** Each statement carries one of these labels:
  - **author says:** Armin Ronacher, the Earendil maintainers, or the repo's own docs, with a citation.
  - **users report:** third parties, with a citation.
  - **code shows:** file:line.
  - **inferred:** my own reasoning, stated as such. It is never presented as fact.
  - **prior note:** taken from `docs/merger/01-anatomy/absurd.md` or `research/rqs-review/reports/absurd.md` and re-checked here.
- **Public-source caveat.** In this session I could not open the blog posts, Hacker News pages or GitHub issue comments directly (the sandbox's DNS and proxy blocked them). Public material therefore comes from search-engine result summaries and from GitHub issue bodies returned by GitHub search. Every quotation taken from a search snippet is marked *(snippet)*: it was not checked against the page.

---

## 1. Identity card

| Field | Value | Label |
|---|---|---|
| Repository | https://github.com/earendil-works/absurd, default branch `main`. GitHub description: "An experiment in durability". Docs at https://earendil-works.github.io/absurd | code shows (`README.md:15-18`); GitHub API search result, 2026-10-26 |
| Pinned commit | `3cfc64f` "meta: reset schema version to main after 0.5.1 release" (2026-10-20). It sits one commit after tag `0.5.1` (`201a1ef`). At this commit `absurd.get_schema_version()` returns `'main'` (`sql/absurd.sql:156-161`) | code shows (git log) |
| Changes on `main` since the pin | None. `git log 3cfc64f..origin/main` is empty as of 2026-10-26 | code shows |
| Commits | 313, from 2025-10-19 (`3c1914e` "Initial absurd.sql based on pgmq.sql") to 2026-10-20 | code shows (git log) |
| Commits per month | 2025-10: 104, 11: 56, 12: 16; 2026-02: 1, 03: 73, 04: 41, 05: 7, 06: 5, 08: 6, 10: 4. Activity is front-loaded, and since May 2026 there have been about 5 commits a month | code shows |
| Releases | 15 tags. `0.0.1`-`0.0.3` (2025-10-30), `0.0.4` (11-01), `0.0.5` (11-15), `0.0.6` (12-08), `0.0.7` (12-22), `0.0.8` (2026-03-02), `0.1.0` (03-03), `0.1.1` (03-25), `0.2.0` (03-26), `0.3.0` (04-02), `0.4.0` (05-27), `0.5.0` (08-04), `0.5.1` (10-20). Go module tags `sdks/go/absurd/v0.4.0`, `v0.5.0` and `v0.5.1` | code shows (git tags) |
| Licence | Apache-2.0 (`LICENSE`, `sdks/go/absurd/LICENSE`). No NOTICE file. The npm package ships only `dist` and `README.md`, without the licence text (prior note, `sdks/typescript/package.json:15-18`). The README says that "to the extent to which it can be copyrighted, the Apache 2.0 license should be assumed" because the code was largely AI-assisted (`README.md:228-232`) | code shows / author says |
| Origin of the code | The first commit was "based on pgmq.sql" (pgmq is under the PostgreSQL License). The original file had `grant ... to pg_monitor` and LISTEN/NOTIFY triggers (`git show 3c1914e:sql/absurd.sql`, lines 13-25 and 592-624). Both were removed in October 2025 (`dd4c5a3` and `ba24bfa`). The repo contains no pgmq attribution today (grep finds "PGMQ" only in the comparison docs). How much pgmq-derived text survives is **unknown**; inferred: little, because the queue functions were rewritten between 2025-10-20 and 2025-10-25 | code shows / inferred |
| Authors | 15 distinct commit authors. Armin Ronacher has 285 of 313 commits (91%). Next come Vegard Stikbakke (6), Javier Lopez (4), niloc (3), Cristina Poncela (3), Ruud Kamphuis (2) and Mark Story (2), then 8 people with 1 commit each | code shows (git log) |
| Steward | Earendil Inc. The PR template asks outside contributors to grant "Earendil Inc. can use, modify, copy, and redistribute my contributions ... under Earendil Inc.'s choice of terms" (`.github/PULL_REQUEST_TEMPLATE.md`) | code shows |
| Languages (lines, tracked files) | SQL 8,253 (core `sql/absurd.sql` 3,158; migrations about 5,000). Python 11,525 + `absurdctl` 3,027. TypeScript 6,351 + TSX 5,283 (habitat UI). Go 6,853. Markdown 7,187. 217 tracked files; 6.7 MB working tree without `.git` | code shows (`wc -l`) |
| Main files | `sql/absurd.sql` (3,158 lines, 39 `create function`). `absurdctl` (3,027). `sdks/python/src/absurd_sdk/__init__.py` (2,317). `sdks/typescript/src/index.ts` (1,610). `sdks/go/absurd/*.go` (1,880 lines without tests). `habitat/internal/server/handlers.go` (1,771) | code shows |
| Activity (2026-10-26) | 2,512 stars, 121 forks, 35 open issues + PRs. Created 2025-10-20T22:15Z; last push 2026-10-20 | GitHub API (search_repositories), 2026-10-26 |
| Package versions | `absurd-sdk` on npm 0.5.1 (`sdks/typescript/package.json:3`); `absurd-sdk` on PyPI 0.5.1 (`sdks/python/pyproject.toml:3`); `absurdctl` on PyPI and as a GitHub Releases binary; Go module `github.com/earendil-works/absurd/sdks/go/absurd` | code shows |
| Supported runtimes | PostgreSQL 14 or later, with optional `pg_cron` (`docs/quickstart.md:24-25`). CI tests only `postgres:16-alpine` (`tests/conftest.py:155`), Python 3.12 and Node 24 (`.github/workflows/test.yml:18,26`). The Python package claims 3.9+ (`pyproject.toml:6`) | code shows |

## 2. Purpose and origin

- **The motivation.** Absurd's author says he wrote it while building agents, found that "durable execution problems came back with them", and "wanted to see how far he could get with just Postgres". The result was "a tiny SQL-only library with a very thin SDK to enable durable workflows on top of just Postgres — no extension needed" *(snippet of "Absurd Workflows: Durable Execution With Just Postgres", lucumr.pocoo.org, 2025-11-03)*.
- **The stated contrast** is with systems that "are incredibly complex and require you to sign up for another third-party service" *(snippet, same post)*.
- **Earendil context.** On X he called it "my sidequest at Earendil: Building Absurd which implements durable execution (use workflow, Temporal, Inngest, etc.) on just Postgres" *(snippet, x.com/mitsuhiko/status/1985268932752691524, Nov 2025)*. Earendil uses it internally (author says, "Absurd In Production", 2026-04-04, *snippet*).
- **Design goal, from the README:** "Absurd is the simplest durable execution workflow system you can think of. It's entirely based on Postgres and nothing else." The goal is "to move the complexity of SDKs into the underlying stored functions" (`README.md:8-11, 69-72`) (author says).
- **Cheap SDKs.** "The goal of this project really is that writing SDKs becomes very cheap. The TypeScript/JavaScript SDK is less than 1000 lines of code" (issue #15, 2025-10-30). He wanted a Go SDK "to retire our `pgmq` system in mailhook" (same issue) (author says). The TS SDK is now 1,610 lines (code shows).
- **The name:** "… because it's absurd how much you can over-design such a simple thing" (`README.md:13`) (author says).
- **Self-hosting.** On Hacker News he said he wants to "stick to a manageable number of services" so the system can later be self-hosted (HN item 45797228, Nov 2025, *snippet*) (author says).
- **Why not DBOS.** On HN he wrote that "the only postgres only solution was DBOS which unfortunately did not look ready for prime time yet when I tried it", citing global client state and trouble with async code (*snippet*) (author says).
- **Agents.** The README and docs name "LLM-based agents" first among target uses (`README.md:33-35`) and ship an agent skill (`skills/absurd/SKILL.md`) (author says).
- **Five months on** (2026-04-04, "Absurd In Production"): "The design held up fine, partitioning is still hard" (*snippet*, x.com/mitsuhiko/status/2040380018941976895). He considered building on durable promises, found the idea appealing but "much more complex to implement in practice", and "did not get anywhere" with a prototype (*snippet*) (author says). Partitioned storage shipped in `0.4.0` (2026-05-27; commit `f6d64a6`, 2026-04-12), after that post (code shows).

## 3. Public reception

**Sample.** I sampled:
- **Hacker News:** the announcement thread (item 45797228, about 2025-11-03; points and comment count not retrievable), "Building durable workflows on Postgres" (item 48313530, a DBOS post that mentions Absurd), and "Building a Durable Execution Engine with SQLite" (item 45992316, which links to Absurd).
- **Lobsters:** two threads, "Absurd Workflows" (lobste.rs/s/7rhkpy, 2025-11-03, 5 comments) and "Absurd In Production" (lobste.rs/s/xqttxu, about 2026-04-04, 12 comments).
- **GitHub issues:** about 15 issue bodies (no comments).
- **Write-ups:** a few blogs and aggregators (mfyz.com, letsdatascience.com, daily.dev, tproger.ru, a translation).

**Not found:** Reddit threads, Bluesky or Mastodon discussion (one hackers.pub/hachyderm repost of his post appeared, without content), formal benchmarks, and named production adopters other than Earendil and TensorZero (below). Public discussion is **thin and mostly positive or curious; little of it is technical criticism**.

| # | What | Source, date | Label |
|---|---|---|---|
| R1 | Praise for the minimal footprint. "if you don't need a ton of throughput I think `absurd` (and our Rust derivative `durable`) are very nice options that keep the client side extremely simple" | HN 48313530, user `vrm`, 2026 (*snippet*) | users report |
| R2 | A derivative: TensorZero's `durable`, a Rust SDK "derived from absurd" with checkpointing, sleeping, events, retries and pg_cron scheduling, "experimental software to be used in TensorZero". One mirror says it was archived on 2026-06-12 (unverified). Viraj Mehta, likely `vrm`, has 1 commit in absurd (git log) | search results for github.com/tensorzero/durable mirrors, 2026 (*snippet*) | users report / inferred |
| R3 | Third-party SDKs: `bytefish/Absurd.NET` (about 4 stars; referenced in issue #120, 2026-05-09); "python-absurd-client" (readthedocs, copyright rodmena-limited); a Java SDK effort (issues #101 etc., 2026-04-16, closed); requests for Effect (#114) and more SDKs (#15, 19 comments, 7 👍) | GitHub search, readthedocs | users report |
| R4 | Scale concern: commenters raised concerns that `SKIP LOCKED` queues scale poorly as worker counts grow and that vacuum can fall behind; another warned that tables grow "from a few thousand rows to terabytes" | HN (thread not identified with certainty), *snippet* | users report |
| R5 | Correctness concern: a commenter called the approach "too hand-wavy on consistency and correctness" | HN related thread, *snippet* | users report |
| R6 | Idempotency debate. Commenter `eximius` said retries and idempotency are the core requirements, and that steps only mitigate non-idempotent APIs. The author replied that idempotent APIs would be better but "that is very hard to do with agents which are just all probabilistic". He suggested task-ID-derived keys, noted that provider idempotency windows are often 1-24 h, and proposed a Postgres-backed idempotency wrapper with a longer TTL | HN 45832565, about Nov 2025 (*snippet*) | users report / author says |
| R7 | DBOS comparison. On HN, `jedberg` (DBOS) replied that DBOS runs in production at multiple Fortune 500 companies. On Lobsters, a DBOS user complained of a paywalled console, no partitioning, and `DBOS.sleep()` blocking a connection. The author replied that "Absurd currently does not do partitions yet" and he had not found a good design | HN 45797228 / lobste.rs xqttxu, 2026-04 (*snippet*) | users report / author says |
| R8 | Positioning. "interesting, but ... not the first thing I would reach for when the job is simply 'do this one task later'"; PGMQ and pg-boss are suggested for plain queues | mfyz.com "Durable Queue Workers With Just Postgres", 2026 (*snippet*) | users report |
| R9 | Clock-skew bug in the field. A user on a managed Postgres (Sealos) saw a `sleepFor(10)` task re-claimed about every 300 ms, so non-step code (external API polls) re-ran about 12 times in 11 s. The issue was closed 2026-06-25, the same day as commit `2248c04` "fix(sdk): schedule sleeps against database clock", which shipped in 0.5.0 ("avoiding drift when worker and database clocks differ", `CHANGELOG.md`) | issue #122, 2026-05-17 | users report / code shows |
| R10 | Retention outage. "It took down my DB ... queue tables quietly grew to ~1.4 GB until the disk filled", on a small free Postgres whose app data was about 30 MB. The user had not found the cleanup functions. Closed 2026-06-21 | issue #130, 2026-06-15 | users report |
| R11 | Replay bug reported and still open: an `awaitEvent` timeout does not persist a checkpoint, so a loop of awaits re-suspends on a stale event (see P3) | issue #96, 2026-04-15, open | users report |
| R12 | Feature requests: queue-level concurrency limits (#89, open, 5 comments), manual resume of sleeping tasks from habitat (#29, open), and separating durable execution from the queue so it can run on SQS/Lambda (#59, closed) | GitHub search | users report |
| R13 | A misreading of claim semantics. Issue #34 asked why `sleeping` is claimable. It was closed the same day. The design intends sleeping runs to be claimable once `available_at` passes (`sql/absurd.sql:1021-1023`) | issue #34, 2025-11-11 | users report / code shows |

**Author replies to critics** are documented only in R6 and R7: idempotency is pushed to steps and external keys, and partitioning was acknowledged as missing and later shipped. I could not see his replies to the scale and vacuum comments (R4).

**Summary.** About 20 public items were sampled. Reception is curious and favourable towards "just Postgres" simplicity. Criticism clusters around three things:
1. scale, `SKIP LOCKED`/vacuum and table growth (R4, R10);
2. correctness rigour (R5, R11);
3. idempotency being left to the user (R6).

No independent benchmarks or post-mortems were found. The only adoption I can name is Earendil itself (author says) and TensorZero's fork (users report).

## 4. Architecture and mechanics: design decisions

**D1. Postgres is the only required service.**
- *What:* all state and logic live in the `absurd` schema. Workers, the CLI and the dashboard talk only to Postgres (`README.md:8-11`, `docs/comparison.md:14-20`).
- *Why:* to avoid adding a third-party service and extra operational complexity, and to stay self-hostable (author says: blog *snippet*; HN *snippet*).
- *Consequence:* Postgres supplies durability, fencing and locking. You inherit its operational load (vacuum, bloat, connection limits) and get no engine-level scale-out beyond one primary (inferred). Throughput has never been measured (prior note PERF-1; no benchmarks in the repo).

**D2. The logic lives in stored procedures; the SDKs are thin.**
- *What:* 39 PL/pgSQL or SQL functions (`sql/absurd.sql`). By convention, SDKs issue no SQL "which are not just calling to" those functions, except for observability (`CONTRIBUTING.md:25-29`).
- *Why:* SDKs become cheap to write in any language (author says, issue #15; `README.md:69-72`).
- *Consequences:*
  - **Atomic transitions.** Each state transition (claim, complete, fail plus schedule retry, emit plus wake) runs as one function call, so it is atomic in one transaction (inferred from Postgres function semantics).
  - **The function signatures are the wire protocol.**
  - **Logic sits outside the application process,** so a SQLite or embedded port must move it into a host library (inferred).
  - **Uneven behaviour.** Some behaviour still lives in the SDKs and differs between them: the step-name counter, the timeout detection in `awaitEvent`, the watchdog and unknown-task deferral (code shows; see C49, C52, C61 and C62).

**D3. One SQL file, plus forward migrations; no extension.**
- *What:* `sql/absurd.sql` installs everything. `sql/migrations/` holds 11 version-pair files. The `uuid-ossp` dependency was removed in 0.5.0 (#127) (code shows; `CHANGELOG.md`).
- *Why:* "plug it into your favorite migration system" (`README.md:43-46`). Using your own migration system is "strongly recommended for production" (`docs/database.md:7-13`) (author says). "No extension needed" (blog *snippet*). Inferred further reason: managed Postgres services restrict extensions.
- *Consequence:* the file is easy to vendor. Migrations are non-atomic and bump the version first (prior note O13, confirmed: no `begin`/`commit` in the migration files).

**D4. Pull-based workers that poll; no push, no coordinator, no LISTEN/NOTIFY.**
- *What:* workers call `claim_task` every `pollInterval` (default 0.25 s in TS, Python and Go: `sdks/typescript/src/index.ts:1126`, `sdks/python/src/absurd_sdk/__init__.py:1632, 2180`, `sdks/go/absurd/absurd.go:25`).
- *Why:* "Push systems have the inherent disadvantage that you need to take greater care of system load constraints." A push model "would require a coordinator" (`README.md:58-65`; `docs/concepts.md:426-430`) (author says).
- *Removed NOTIFY:* the pgmq-derived first version had NOTIFY triggers, removed on 2025-10-23 (code shows). No reason was stated. Inferred: NOTIFY needs a dedicated listening session, behaves badly through transaction-pooling proxies, and adds a second code path.
- *Consequences* (inferred from defaults):
  - Wake-up latency is up to one poll interval.
  - Idle load is about 4 claim calls per second per worker per queue.
  - Each `claim_task` also runs the cancellation sweep and the lease sweep (`sql/absurd.sql:958-1014`), so the poll is not a cheap read.

**D5. Checkpoint replay, not deterministic replay.**
- *What:* on every run the SDK loads all committed checkpoints. `step(name)` returns the cached value when it exists, and code outside steps simply runs again (`docs/concepts.md:87-88`; `sdks/typescript/src/index.ts:302-331, 350-358`).
- *Why:* to be less invasive than Temporal and "not try to turn your code into a deterministic workflow runtime", which gives much simpler SDKs (`docs/comparison.md:80-92`) (author says).
- *Consequences:*
  - Step identity is the name plus a per-run occurrence counter (`name#2`…), so the order of steps must be stable across code versions (`docs/patterns/living-with-code-changes.md`, author says).
  - Steps are at-least-once: `fn()` runs, then the checkpoint is written in a separate statement (code shows, `index.ts:356-357, 457-474`).

**D6. One run row per attempt; retries happen per task.**
- *What:* `fail_run` inserts a new run with the next attempt number. Checkpoints are shared across runs (`sql/absurd.sql:1264-1307`; `docs/concepts.md:238-246`).
- *Why:* author says, issue #16 "Create new run on reclaiming" (2025-10-31), shipped as "Properly retry tasks which had their claim expire (#17)" in 0.0.4.
- *Consequence:* you get a per-attempt audit trail. Checkpoint visibility is attempt-scoped (`:1692`), and an older attempt cannot overwrite a newer attempt's checkpoint (`:1540`) (code shows).

**D7. A lease is a timestamp, swept lazily by claimers.**
- *What:* `claim_expires_at` sits on the run. Expired leases are failed only inside `claim_task`, at most `qty` per call (`sql/absurd.sql:950-1014`). Leases are extended by checkpoint writes (`:1515-1525`) and `extend_claim` (`:1555-1614`).
- *Why:* inferred. There is no background process (D4), so claimers are the only always-running actors. The bounded sweep was added in 0.1.0 "to bound cancellation and expired-lease sweep work per claim call" (author says, `CHANGELOG.md`).
- *Consequence:* the lease is advisory. Its liveness depends on polling, and a stale worker can still write until the sweep runs (P1).

**D8. A separate table set per queue, created with dynamic DDL.**
- *What:* `t_`, `r_`, `c_`, `e_` and `w_`, plus `i_` for partitioned queues, via `format('%I')` (`sql/absurd.sql:184-369`). Queue names are capped at 57 bytes to fit Postgres's 63-byte identifier limit (`:163-182`).
- *Why:* "Queues let you scale workers independently and isolate different workloads" (`docs/concepts.md:123`) (author says). Inferred further reasons: separate indexes, vacuum and bloat per queue, and `drop_queue` as a cheap `DROP TABLE`.
- *Consequence:* there is no cross-queue query without dynamic SQL. Habitat queries the tables directly, so the schema is a de facto API (prior note O1).

**D9. Events are per queue, first-write-wins, and cached until cleanup.**
- *What:* `emit_event` allows exactly one transition from NULL to a payload. Later emits are ignored (`:1904-1924`). `await_event` resolves at once if the event row already has a payload (`:1797-1840`).
- *Why:* "Events are cached (first emit wins), which means they are race-free" (`README.md:81-82`). First-write-wins was enforced in 0.1.0 (author says).
- *Consequence:* an emit that arrives before the await is not lost (tested, `tests/test_events.py:165`). Event names must be unique per occurrence, e.g. `shipment.packed:<orderId>` (`README.md:162`). A reused name resolves at once with the old payload (P2).

**D10. Sleep is a checkpoint plus `schedule_run`.**
- *What:* `sleepUntil` persists the wake time as a checkpoint, then calls `schedule_run` with `absurd.current_time() + remaining` and throws `SuspendTask` (`index.ts:414-427, 476-481`).
- *Why:* because the checkpoint holds the absolute wake time, a replay does not reschedule the sleep forever (tested, `tests/test_checkpoints.py:233`). Since 0.5.0 the DB clock anchors the wake-up, after issue #122 (users report; author says, `CHANGELOG.md`).
- *Consequence:* `remaining` is still computed on the worker clock against the stored absolute time (`index.ts:422`), so skew between the worker that set the sleep and the worker that replays it still shifts the wake-up (inferred).

**D11. A fake clock inside the database.**
- *What:* `absurd.current_time()` reads the session setting `absurd.fake_now` (`:37-52`).
- *Why:* "Tests use `absurd.fake_now` session variable to control time" (`CONTRIBUTING.md`, "Testing Time") (author says).
- *Consequence:* lease, retry and timeout tests are deterministic, and run against real Postgres.

**D12. UUIDv7 ids, and optional weekly range partitions on those ids.**
- *What:* `portable_uuidv7()` uses PG18's `uuidv7()` when present (`:2296-2323`). Partitioned queues range-partition `t_`/`c_` by `task_id` and `r_`/`w_` by `run_id` into weekly buckets (`:208-213, 2424-2534`).
- *Why:* time-ordered ids let a primary key double as the partition key (inferred). The author said partitioning was "still hard" in April 2026 (*snippet*).
- *Consequence:* retention can drop whole partitions. That brings `DETACH ... CONCURRENTLY` (PG14+), default partitions and pg_cron jobs (`:2736-2921`).

**D13. No capability filter on claim; unknown tasks are deferred.**
- *What:* a worker that claims a task name it does not know reschedules the run 15-30 s later and does not fail it (`index.ts:1292-1318`).
- *Why:* to keep "claim path fast and simple for everyone" and handle rollout race windows (`docs/patterns/deployments.md`) (author says).
- *Consequence:* deferral does not consume an attempt, so a task nobody can run cycles forever unless `max_duration` is set (author says, same doc).

**D14. A lease watchdog that kills the process (TS and Go).**
- *What:* the watchdog warns at 1× the lease and calls `process.exit(1)` / `os.Exit(1)` at 2× (`index.ts:1254-1277`; `sdks/go/absurd/worker.go:260-297`).
- *Why:* "Terminate stuck workers" (0.0.4). The production post mentions "watchdogs that terminate broken workers" (*snippet*) (author says).
- *Consequence:* the whole process dies, including healthy concurrent tasks (inferred). The Python SDK has no watchdog (code shows, by absence).

**D15. Transaction-agnostic SDKs and transactional enqueue.**
- *What:* TS `bindToConnection(con)` (`index.ts:668-679`); Python accepts a caller-owned connection (`__init__.py:1316-1321`; "Fixed Python SDK to be transaction agnostic. #51"). Go takes only a `*sql.DB` (`absurd.go:61-71`), so no `sql.Tx` (code shows).
- *Why:* inferred, so that work can be spawned atomically with application writes.
- *Consequence:* there is an outbox-free enqueue path in TS and Python, but not in Go.

**D16. No security model in SQL; an unauthenticated dashboard.**
- *What:* there are no GRANT/REVOKE and no `security definer` statements (grep finds none). Habitat listens on `:7890`, all interfaces, with `sslmode=disable` (`habitat/internal/config/config.go:15, 21`), and offers an unauthenticated `POST /api/tasks/retry` (`habitat/internal/server/server.go:121`). The docs say "localhost" and "read-only view" (`docs/tools/habitat.md:22, 87`) (code shows).
- *Why:* not stated. Inferred: the tool targets a trusted single team.
- *Consequence:* any database role that can call the functions can complete or cancel any run (prior note).

**D17. Agent-first tooling.**
- *What:* the bundled skill and `absurdctl install-skill` (`README.md:215-226`; `skills/absurd/SKILL.md`).
- *Why:* "built so that agents such as Claude Code or pi can efficiently work with the state in the database" (author says).

**D18. AI-assisted development is disclosed.**
- *What:* the README says so and CONTRIBUTING requires it to be disclosed (`README.md:228-232`; `CONTRIBUTING.md:7-21`). There is a `.pi/` prompt directory, including `/make-migrations` (author says / code shows).

## 5. Capability inventory

**Notes for every row.**
- **Licence duties.** Copying code or documentation from absurd requires keeping the Apache-2.0 licence text, keeping copyright and attribution notices, and marking modified files (Apache-2.0 §4). There is no NOTICE file to propagate. Re-implementing a behaviour from a specification carries no licence duty. Copying SQL that may descend from pgmq would add the PostgreSQL License notice; whether any such text survives is **unknown**.
- **"Postgres feature" column.** It names what absurd relies on. **"Build new"** is what a port to another store, such as SQLite, must supply.

### 5a. SQL core (`sql/absurd.sql`) — code shows

| ID | Capability | Where (@3cfc64f) | In → Out | Limits | To reproduce elsewhere |
|---|---|---|---|---|---|
| ABS-C01 | `absurd` schema and `absurd.queues` policy table (storage mode, partition window, cleanup TTL/limit, detach policy) | `:33, 131-150` | DDL | Defaults: TTL 30 days, limit 1000, lookahead 28 days, lookback 1 day | PG: schemas, CHECK constraints, `interval`. Build new: a namespaced queue table; durations as integers |
| ABS-C02 | `current_time()` with test override `absurd.fake_now` | `:37-52` | → timestamptz | Session-scoped setting; behaviour under poolers is unknown | PG: `current_setting`, `clock_timestamp`. Build new: an injectable clock in the host library |
| ABS-C03 | `retry_delay_seconds(strategy, attempt)`: `none`, `fixed` (default 60 s) or `exponential` (base 30, factor 2), capped at 86,400 s, overflow saturates; raises AB003 on invalid input | `:56-129` | jsonb, int → seconds | One-day maximum; no jitter | Pure function, trivial to port |
| ABS-C04 | `get_schema_version()` | `:156-161` | → text (`'main'` at this commit) | Bumped by release automation | A version table or `user_version` pragma |
| ABS-C05 | `validate_queue_name`: non-empty, at most 57 bytes | `:167-182` | text → text | Exists only because of PG's 63-byte identifiers | Unneeded with a queue column |
| ABS-C06 | `ensure_queue_tables`: 5 or 6 tables and 7-8 indexes per queue; fillfactor 70 when unpartitioned | `:184-369` | queue → DDL | Dynamic DDL; identifiers quoted with `%I` | PG: `EXECUTE format`, partial indexes, fillfactor. Build new: static tables with a `queue` column and partial indexes (SQLite has partial indexes) |
| ABS-C07 | `create_queue(name, mode)`, idempotent while the mode matches | `:374-410` | → void | Mode is fixed once created | Simple insert |
| ABS-C08 | `create_queue(name)` (backward-compatible form) | `:413-420` | → void | — | — |
| ABS-C09 | `drop_queue`: also unschedules cron jobs, then `DROP ... CASCADE` | `:425-460` | → void | Irreversible; does not validate the name | Delete rows by queue |
| ABS-C10 | `list_queues` | `:463-468` | → setof text | — | Trivial |
| ABS-C11 | `get_queue_policy` | `:471-499` | → row | — | Trivial |
| ABS-C12 | `set_queue_policy(jsonb)`: validates keys; can detach and drop the default partition under an `ACCESS EXCLUSIVE` lock | `:511-722` | → void | `default_partition` applies only to partitioned queues | PG: `pg_inherits`, `LOCK TABLE`. Build new: policy rows only |
| ABS-C13 | `get_task_result`: state, plus result (completed) or failure reason (failed) | `:729-756` | queue, task_id → row | Non-terminal states return nulls | A join |
| ABS-C14 | `spawn_task(queue, name, params, options)`: one task row plus its first run; options `headers`, `retry_strategy` (validated), `max_attempts ≥ 1`, `cancellation`, `idempotency_key`. Race-safe dedup through `ON CONFLICT DO NOTHING`, on `t_` or on the `i_` side table for partitioned queues; raises 40001 if a key is cleaned up concurrently | `:764-911` | → (task_id, run_id, attempt, created) | A key is unique per queue only until cleanup deletes the task; params are unbounded jsonb | PG: `ON CONFLICT`, `FOR KEY SHARE`, a transaction per call. Build new: a UNIQUE index on (queue, key) with `INSERT OR IGNORE` + `SELECT` in one transaction |
| ABS-C15 | `claim_task(queue, worker, claim_timeout=30, qty=1)`, in three phases: (a) cancel tasks whose `max_delay`/`max_duration` has elapsed; (b) fail at most `qty` expired leases with `$ClaimTimeout` (`FOR UPDATE SKIP LOCKED`); (c) pick ready runs ordered by `(available_at, run_id)` with `SKIP LOCKED`, mark them `running` with `claim_expires_at = now + timeout`, update the task, and delete waits whose timeout has passed | `:915-1078` | → setof claimed rows | Zero lease means no expiry (P4); no priorities; no per-queue concurrency cap (#89) | PG: `FOR UPDATE SKIP LOCKED`, CTE-based `UPDATE ... RETURNING`, row locks. Build new: under SQLite's single writer, `BEGIN IMMEDIATE` + `UPDATE ... WHERE ... RETURNING` (3.35+) gives exclusive claims without SKIP LOCKED. Multi-host contention needs a server database |
| ABS-C16 | `complete_run(queue, run, result)`: locks the run; requires `running`; raises AB001 if cancelled and AB002 if failed; marks run and task completed; deletes waits | `:1081-1141` | → void | Checks neither lease expiry nor worker id (P1) | Single transaction; add a lease or fencing check |
| ABS-C17 | `schedule_run(queue, run, wake_at)`: running → sleeping, clears the claim | `:1143-1187` | → void | Requires `running` | Trivial update |
| ABS-C18 | `fail_run(queue, run, reason, retry_at)`: marks the run failed; within `max_attempts` (null means unlimited) inserts the next run at `retry_at` or after the strategy's delay; cancels if the retry would pass `max_duration`; an invalid legacy strategy fails the task for good | `:1189-1332` | → void | Locks run before task (deadlock tests in `tests/test_lock_ordering.py`) | Transaction + insert; keep the lock order or rely on serialised writes |
| ABS-C19 | `retry_task(queue, task, {spawn_new, max_attempts})`: reopens a failed task with a new run (checkpoints reused), or spawns a fresh copy | `:1343-1466` | → (task_id, run_id, attempt, created) | Failed tasks only | Straightforward |
| ABS-C20 | `set_task_checkpoint_state(queue, task, step, state, owner_run, extend_by)`: upsert; raises AB001/AB002; optionally extends the lease; keeps a newer attempt's checkpoint | `:1468-1553` | → void | Does not check that the run is `running` or belongs to `p_task_id` (P6); state unbounded | PG: `ON CONFLICT DO UPDATE`. SQLite: `INSERT ... ON CONFLICT DO UPDATE` (3.24+) |
| ABS-C21 | `extend_claim(queue, run, secs)`: requires a running run with a non-null expiry | `:1555-1614` | → void | Accepts an already-expired lease (P1) | Add `claim_expires_at > now` |
| ABS-C22 | `get_task_checkpoint_state(queue, task, step, include_pending)` | `:1618-1643` | → row | `pending` status is never written by the SDKs (inferred from the code: all writes use `'committed'`) | Simple select |
| ABS-C23 | `get_task_checkpoint_states(queue, task, run)`: committed checkpoints whose owner attempt ≤ this run's attempt | `:1647-1698` | → setof rows | Loads everything, no paging | Join on attempt |
| ABS-C24 | `await_event(queue, task, run, step, event, timeout)`: (1) cached checkpoint → return it; (2) pre-insert a sentinel event row (payload NULL, `emitted_at` epoch); lock it `FOR SHARE`, then the run `FOR UPDATE`; (3) payload present → write checkpoint and return; (4) woken by timeout → return null; (5) otherwise register a wait and set the run to sleeping with `available_at` = timeout or infinity | `:1700-1885` | → (should_suspend, payload) | Timeout detection relies on `wake_event`, and no checkpoint is written (P3) | PG: `FOR SHARE`/`FOR UPDATE` ordering, `'infinity'` timestamps. SQLite: one write transaction makes the emit/await race impossible; use a large sentinel instead of infinity |
| ABS-C25 | `emit_event(queue, name, payload)`: first write wins (only NULL → payload); in one statement wakes sleeping waiters, writes their checkpoints and deletes their waits | `:1887-1979` | → void | No fan-out across queues; no consumption | PG: data-modifying CTEs. Build new: the same steps in one transaction |
| ABS-C26 | `cancel_task`: locks runs then task; task and live runs → `cancelled`; deletes waits | `:1984-2048` | → void | Cooperative: running code learns of it only at its next SQL call | Transaction |
| ABS-C27 | `cleanup_all_queues(queue?)`: per-queue TTL and limit from policy | `:2052-2106` | → (queue, tasks_deleted, events_deleted) | One batch per call | Loop |
| ABS-C28 | `cleanup_tasks(queue, ttl, limit)`: deletes terminal tasks older than the TTL, with their waits, checkpoints, runs and idempotency rows | `:2113-2246` | → count | Freed keys can be reused | Batched DELETE; `ON DELETE CASCADE` in SQLite |
| ABS-C29 | `cleanup_events(queue, ttl, limit)` | `:2252-2293` | → count | Also deletes await sentinels (epoch `emitted_at`); harmless, since emit re-inserts (inferred) | Batched DELETE |
| ABS-C30 | `portable_uuidv7()`: PG18 native, or a fallback from `gen_random_uuid` | `:2296-2323` | → uuid | The PG18 branch is untested in CI | Generate in the application |
| ABS-C31 | `uuidv7_timestamp(uuid)` | `:2327-2352` | → timestamptz | Non-v7 → NULL | Bit arithmetic |
| ABS-C32 | `uuidv7_floor(ts)`: lowest v7 for a timestamp (partition bounds) | `:2356-2382` | → uuid | Range 0…2^48 ms | Same |
| ABS-C33 | `week_bucket_utc(ts)` | `:2385-2392` | → timestamptz | — | Date arithmetic |
| ABS-C34 | `partition_week_tag(ts)`: `YWW` | `:2404-2417` | → text | Rolls over every 10 years (`docs/storage.md`) | — |
| ABS-C35 | `ensure_partitions(queue?)`: default partitions plus weekly partitions over lookback/lookahead | `:2424-2534` | → void | Partitioned queues only | PG: declarative partitioning. SQLite: none; use per-period tables or DB files, or plain DELETE |
| ABS-C36 | `list_detach_candidates(queue?)`: empty partitions older than `detach_min_age` | `:2540-2646` | → setof rows | Parses `pg_get_expr` bound text with a regex | PG catalogs |
| ABS-C37 | `drop_detached_partition(table, job)`: drops it and unschedules the paired cron jobs | `:2655-2722` | → bool | — | — |
| ABS-C38 | `schedule_detach_jobs(queue?)`: one detach/drop pipeline per parent via `cron.schedule('* * * * *')`; `CONCURRENTLY` unless a default partition exists | `:2736-2921` | → setof jobs | Needs pg_cron | PG14+ `DETACH CONCURRENTLY`, pg_cron. Build new: a maintenance loop in the application |
| ABS-C39 | `enable_cron(queue?, schedules)`: partitions at :05, cleanup at :17, detach planning at :29, hourly; replaces existing jobs | `:2929-3081` | → setof (job, id) | Needs pg_cron; tested only with pg_cron 1.6.7 on PG16 | Application scheduler |
| ABS-C40 | `disable_cron(queue?)` | `:3089-3158` | → setof (job, id) | — | — |
| ABS-C41 | Error contract: AB001 cancelled, AB002 run already failed, AB003 bad retry strategy, 40001 key cleaned up concurrently; the rest are plain exceptions | `:76-127, 851, 1110-1113, 1233-1237` etc. | SQLSTATE | 17 of 80 raise sites carry a code (prior note); none are documented | Typed error enum |

### 5b. SDK features — per language (code shows)

TS = `sdks/typescript/src/index.ts`, Py = `sdks/python/src/absurd_sdk/__init__.py`, Go = `sdks/go/absurd/{absurd,context,worker}.go`.

| ID | Capability | TS | Py (sync + async) | Go (experimental, `README.md:56`) | Limits / differences | To reproduce elsewhere |
|---|---|---|---|---|---|---|
| ABS-C42 | Client and connection resolution: `ABSURD_DATABASE_URL` → `PGDATABASE` → `postgresql://localhost/absurd` | `634-661` (owns a `pg.Pool`) | `1302-1322` (one psycopg connection, `autocommit=True`), `310` | `New` `absurd.go:406-451` (`database/sql`, default driver `postgres`) | Python sync uses **one** connection for all threads (inferred risk of serialisation) | A connection factory |
| ABS-C43 | Run on a caller's connection or transaction (transactional enqueue) | `bindToConnection` `668-679` | caller-owned `Connection` `1316-1321`; "transaction agnostic" (#51) | No: `Options.DB *sql.DB` only (`absurd.go:61-71`) | — | Accept a caller transaction handle |
| ABS-C44 | Task registration (name, queue, `defaultMaxAttempts`, `defaultCancellation`) | `689-714` | `1324`, decorator `1219-1241` | `Task[P,R]` `278`, `Register` `462` | Go is generically typed | Registry map |
| ABS-C45 | `spawn` (resolves queue from registration; an unregistered name needs an explicit queue; default max attempts 5) | `881-958` | `1453-1508` | `Spawn` `629-665`; `TaskDefinition.Spawn` `285` | — | Calls C14 |
| ABS-C46 | Hooks `beforeSpawn` / `wrapTaskExecution` (trace propagation) | `197-218, 921-927, 1328-1332` | `AbsurdHooks` `224`; `get_current_context()` contextvar `64-79` | `Hooks` `154-164` | — | Middleware |
| ABS-C47 | `step(name, fn)`: check cache → run → persist | `350-358` | `step` `693`; `@run_step` decorator `734-764` | `Step[T]` `context.go:278-292` | At-least-once; the result must be JSON | Library logic plus C20 |
| ABS-C48 | `beginStep` / `completeStep` (split around external hooks) | `367-395` | `702-723` | `BeginStep` `context.go:294`; `StepHandle.CompleteStep` `absurd.go:254` | — | Same |
| ABS-C49 | Repeated names become `name#2`, `name#3` (per-run counter) | `429-434` | `905` | `context.go:150` | Positional: reordering steps breaks replay | In-memory counter |
| ABS-C50 | Checkpoint preload plus lazy single lookup | `302-331, 436-455` | `621-645, 911-929` | `context.go:41-87, 161-183` | Loads every checkpoint on each run (REL-2) | Calls C23/C22 |
| ABS-C51 | `sleepFor` / `sleepUntil` (checkpoint the wake time; `schedule_run` relative to the DB clock; suspend) | `402-427, 476-481` | `766-790, 948` | `context.go:324-363, 208` | `remaining` uses the worker clock (D10) | C17 plus a checkpoint |
| ABS-C52 | `awaitEvent(name, {stepName, timeout})` (default step `$awaitEvent:<name>`; integer-second timeout; `TimeoutError`) | `490-545` (SDK-side timeout detection `509-517`) | `792-839` (same detection `806-812`) | `context.go:368-431` (relies on the SQL timeout path) | No checkpoint on timeout (P3) | C24 |
| ABS-C53 | `emitEvent` from a client or a task context | `607-616, 967-981` | `881-890, 1535-1552` | `context.go:443-457`, `absurd.go:613` | Same-queue only from a context | C25 |
| ABS-C54 | `heartbeat(seconds)` | `592-599` | `892-903` | `context.go:434-441` | — | C21 |
| ABS-C55 | `fetchTaskResult` / `awaitTaskResult` (client; polling backoff 50 ms → 1 s) | `987-1008, 1472-1557` | `1510-1533, 486-506` | `absurd.go:667-684, 753-797` | Polling only | C13 |
| ABS-C56 | Durable child wait `ctx.awaitTaskResult` (wrapped in a step, heartbeats every half lease; **refuses the same queue** to avoid worker-slot deadlock) | `553-586` | `841-879` | `context.go:229-276` | Holds a worker slot while it polls | Step + poll |
| ABS-C57 | `retryTask`, `cancelTask` | `1014-1060` | `1554-1600` | `absurd.go:686-721` | — | C19, C26 |
| ABS-C58 | Queue management: create (with policy), drop, list, get/set policy | `723-866` | `1341-1452` | `absurd.go:486-611` | — | C07-C12 |
| ABS-C59 | `claimTasks` / `workBatch` (sequential) | `1062-1100` | `1602-1624` | `worker.go:110-163` | Defaults: lease 120 s, batch 1 | C15 |
| ABS-C60 | Worker loop: concurrency (default 1), batch = concurrency, poll 0.25 s, graceful close | `startWorker` `1120-1220` | sync `1626-1708` (thread pool when concurrency > 1, `1689`); async `2174-2212` (claims a batch, then `gather`s **all** before the next claim) | `RunWorker` `worker.go:165-225` (semaphore) | Python async has a batch barrier (inferred head-of-line blocking) | A polling loop |
| ABS-C61 | Lease watchdog: warn at 1×, exit the process at 2× (`fatalOnLeaseTimeout`, default true) | `1254-1277, 1128` | **none** | `worker.go:241-314` | Kills the whole process | A per-task abort instead |
| ABS-C62 | Unknown task name → defer 15-30 s with deterministic jitter (no attempt consumed) | `1292-1318, 1441-1470` | `1732-1756` | `worker.go:88-108` | Loops forever without `max_duration` | C17 |
| ABS-C63 | Control-flow exceptions and error mapping: `SuspendTask`, `CancelledTask` (AB001), `FailedTask` (AB002) swallowed; others → `fail_run` | `138-175, 1333-1350, 1392-1404` | `265-296, 1795-1801` | `absurd.go:1026-1037`; panic recovery `worker.go:316-330` | User code that catches all exceptions breaks suspension (prior note) | Typed results instead of exceptions |
| ABS-C64 | Error serialisation into `failure_reason` (name, message, stack/traceback) | `1381-1390` | `318-332` | `absurd.go:845-866` | Unbounded size | — |
| ABS-C65 | Context accessors | `taskID`, `headers` (`267, 298`) | `task_id`, `headers` (`689`) | `TaskID`, `RunID`, `TaskName`, `QueueName`, `Attempt`, `Headers` (`context.go:106-116`); `TaskFromContext` `125` | Only Go exposes run id and attempt | — |
| ABS-C66 | Sync/async client conversion | — | `make_async` `1720`, `make_sync` `2224` | — | — | — |

### 5c. absurdctl (Python CLI that runs `psql`) — code shows (`absurdctl`)

| ID | Command | Where | What it does | Limits | Reproduce |
|---|---|---|---|---|---|
| ABS-C67 | `init [--ref]` | `1572-1616` | Applies the bundled `absurd.sql`, or fetches it from GitHub for a non-bundled ref | Remote SQL applied without a digest check (prior note; `517-519, 585-606`) | Embedded schema |
| ABS-C68 | `migrate [--from --to --dump-sql]` | `1642-1838` | Applies or dumps version-pair migrations | Not `--single-transaction`; missing files treated as "null migrations" (prior note) | Transactional migrator |
| ABS-C69 | `schema-version` | `1618-1640` | Prints the version or "unknown" | — | — |
| ABS-C70 | `cleanup QUEUE TTL` | `802-952` | Calls the cleanup functions | — | — |
| ABS-C71 | `create-queue [--storage-mode]` | `954-1008` | C07 | — | — |
| ABS-C72 | `drop-queue --yes` | `1010-1058` | C09 | — | — |
| ABS-C73 | `list-queues` | `1060-1124` | C10 | Text output only | — |
| ABS-C74 | `queue-policy` | `1126-1239` | C11/C12 | — | — |
| ABS-C75 | `cron --enable/--disable` | `1241-1392` | C39/C40 | pg_cron | — |
| ABS-C76 | `list-detach-candidates` | `1394-1472` | C36 | — | — |
| ABS-C77 | `detach-candidate [--drop]` | `1474-1570` | Manual detach | — | — |
| ABS-C78 | `spawn-task NAME -P k=v -P k:=json` | `1839-2111` | C14 | — | — |
| ABS-C79 | `list-tasks --queue --status` | `2113-2280` | Reads tables directly | No `--json` | — |
| ABS-C80 | `cancel-task` | `2282-2320` | C26 | — | — |
| ABS-C81 | `retry-task [--max-attempts]` | `2322-2399` | C19 | — | — |
| ABS-C82 | `dump-task --task-id/--run-id` | `2401-2774` | Task, runs and checkpoints | Unbounded output | — |
| ABS-C83 | `emit-event NAME -P` | `2776-2849` | C25 | — | — |
| ABS-C84 | `install-skill [path] [--force]` | `2851-2911` | Copies `skills/absurd/SKILL.md` | — | — |

Connection settings come from `ABSURD_DATABASE_URL` or `PG*`; `psql` is called with an argv list and `-v` variables (`absurdctl:302-342`, prior note).

### 5d. habitat (Go server + SolidJS UI) — code shows

| ID | Capability | Where | Limits |
|---|---|---|---|
| ABS-C85 | `GET /_healthz` (DB ping) | `habitat/internal/server/handlers.go:22` | — |
| ABS-C86 | `GET /api/config` | `handlers.go:38` | — |
| ABS-C87 | `GET /api/metrics`: per-queue state counts | `handlers.go:184-297` | 10 s timeout |
| ABS-C88 | `GET /api/tasks`: filtered, windowed list with `hasMore`; returns 504 on timeout rather than a partial result | `handlers.go:299-784` (`hasMore` `450-452`) | — |
| ABS-C89 | `GET /api/tasks/{id}`: runs, checkpoints, payloads | `handlers.go:786-958` | — |
| ABS-C90 | `POST /api/tasks/retry` → `retry_task` (the only write) | `handlers.go:960-1082` | Unauthenticated; no Origin check or body limit |
| ABS-C91 | `GET /api/queues`, `/api/queues/{q}/tasks`, `/api/queues/{q}/events`, `GET /api/events` | `handlers.go:1084-1400` | — |
| ABS-C92 | UI views: Overview, Queues, Tasks, TaskRuns, EventLog; JSON viewer, date-range selector, auto-refresh; embedded with `go:embed`; base-path support | `habitat/ui/src/views/*.tsx`; `habitat/internal/web/static.go:10` | Rows are mouse-only (prior note) |
| ABS-C93 | Server: `:7890`, `sslmode=disable` default, 5 s graceful shutdown | `habitat/internal/config/config.go:15-21`; `server.go:73, 90-97` | Listens on all interfaces |

### 5e. Other artefacts

| ID | Capability | Where | Notes |
|---|---|---|---|
| ABS-C94 | Forward migrations `0.0.3`→`0.5.1` (11 files) | `sql/migrations/` | Non-atomic (prior note) |
| ABS-C95 | Agent skill: summary-first debugging flow, "Safe operating rules" in prose | `skills/absurd/SKILL.md` (256 lines); `docs/agents.md` | Not enforced |
| ABS-C96 | Pattern docs: cron via app scheduler + idempotency key (task, cron expression, UTC minute slot) or pg_cron; living with code changes (rename or translate steps); two-phase rollouts; cleanup as a task; pi agent durable turns | `docs/patterns/*.md`, `docs/cleanup.md` | The pi doc uses old package names (prior note) |
| ABS-C97 | Executable specification: 163 pytest functions across 20 files in `tests/` (46 cover absurdctl) against real PG16 and a pg_cron image; SDK suites in TS, Python and Go (Go parity test `sdks/go/tests/parity_test.go`); EXPLAIN-based index assertions (`tests/test_indexes.py`) | `tests/`, `sdks/*/test*` | Habitat tests not in `make test` (`Makefile:39`) |
| ABS-C98 | Release channels: npm with provenance, PyPI trusted publishing, GitHub Releases (habitat binary, standalone absurdctl), Go module tags | `.github/workflows/build.yml` (prior note) | Publishing not gated on tests (prior note) |
| ABS-C99 | Docs site (zensical) | `zensical.toml`, `.github/workflows/docs.yml`, `docs/` (5,368 lines) | — |

**Count: 99 capabilities.** They break down as 41 SQL (40 objects plus the error contract), 25 SDK features (each with per-language columns), 18 CLI commands, 9 habitat items and 6 other artefacts.

## 6. Workloads

**Many workers and machines.**
- Any number of workers on any number of hosts can poll the same queue. Two workers cannot claim the same run at the same moment, because of `FOR UPDATE SKIP LOCKED` on the candidate CTE (`sql/absurd.sql:1017-1027`) (code shows).
- There is no worker registry, coordinator or heartbeat table. `claimed_by` defaults to `hostname:pid` in the SDKs (`index.ts:1122`) (code shows).
- Scale ceiling: one Postgres primary. Each poll writes when there is work and also runs two sweeps (D4) (inferred). The ceiling has never been measured (prior note PERF-1). Commenters raised scale and vacuum concerns (R4).

**Concurrency inside a worker.**
- TS uses `concurrency` slots (default 1) and claims `min(batchSize, free)` (`index.ts:1176-1210`).
- Go uses a semaphore (`worker.go:165-225`).
- Python sync uses a thread pool over one connection (`__init__.py:1689`). Python async claims a batch and waits for all of it to finish (`2192-2212`) (code shows).
- There is no queue-level concurrency cap or rate limit; it was requested in #89 (open) (users report).

**Leases and claim timeouts.**
- The SQL default is 30 s (`:918`); the SDKs default to 120 s (`index.ts:1069, 1123`; `absurd.go:23`).
- Every checkpoint write extends the lease by the full claim timeout (`index.ts:469`; `:1515-1525`). `heartbeat()` extends it explicitly (code shows).
- An expired run is failed with `$ClaimTimeout` (worker id, expiry time, attempt) only when some later `claim_task` on that queue sweeps it, at most `qty` per call (`:985-1014`). That sweep consumes an attempt (code shows).
- A zero or negative timeout disables expiry entirely (`:946-948`) (code shows).
- Watchdogs: TS and Go warn at 1× the lease and exit the process at 2×; Python has none (code shows).

**Retries and backoff.**
- Retries are per task. With no strategy the next run is available immediately (`:1268-1285`).
- `fixed` waits `base_seconds` (default 60). `exponential` waits `base·factor^(attempt-1)` (defaults 30 and 2), capped by `max_seconds` and an absolute 86,400 s (`:56-129`).
- `max_attempts` defaults to 5 in the SDKs (`index.ts:658`; `absurd.go:22`). NULL in SQL means unlimited (`:1268`).
- There is no jitter (code shows, by absence).
- `retry_task` can reopen a permanently failed task (C19).

**Cancellation.**
- Manual cancellation goes through `cancel_task`.
- Policy cancellation (`max_delay` from enqueue to first start; `max_duration` since first start) is evaluated at each `claim_task` and when a retry is scheduled (`:958-983, 1287-1294`).
- It is cooperative: a running handler learns of it only at its next checkpoint, heartbeat or await, through AB001. There is no in-process abort signal (code shows).
- Doc mismatch: `docs/concepts.md:312` still describes `maxDelay` as "no checkpoint has been written for N seconds", while the code and `docs/patterns/deployments.md:44-47` treat it as time to first start (code shows; prior note confirmed at HEAD).

**Sleeps and events.**
- *Sleep* is covered in D10.
- *Event waits.* A run sleeps with `available_at = timeout or 'infinity'` (`:1737, 1863-1873`). An emit wakes waiters in the same statement (`:1926-1977`). A timeout wakes the run through the normal claim path; the expired wait is deleted at claim time (`:1048-1055`) (code shows).
- *Timeout gap.* No checkpoint is written for a timeout (P3).

**Idempotency.**
- *At spawn:* a per-queue key, race-safe, tested by 8 tests in `tests/test_idempotent_spawn.py` (prior note). The duplicate spawn returns the existing ids with `created=false` (`:875-886`). The key is freed when cleanup deletes the task (`:2175-2177`) (code shows).
- *Inside steps:* derive keys from `ctx.taskID` (`docs/concepts.md:362-414`) (author says). The author notes that external providers' idempotency windows are short (R6).

**Duplicate and overlapping work.**
- Steps run at least once.
- A worker that lost its lease can keep executing, and keep writing, until the sweep. "Brief overlapping execution is possible — design your steps to tolerate it" (`docs/concepts.md:131-133`) (author says).
- After the sweep the old run id acts as a fencing token: its writes raise AB002, which the SDKs swallow quietly (`index.ts:1392-1404`) (code shows).

**Ordering.**
- Claims go in order of `available_at, run_id`, where the run id is UUIDv7 and so roughly FIFO by creation (`:1024`).
- There are no priorities, no per-key serialisation and no ordering guarantee between tasks. `SKIP LOCKED` lets concurrent claimers take later rows first (inferred from Postgres semantics).
- Within a task, steps are sequential in user code.

## 7. Organisation

- **Maintainers.** Effectively one: Armin Ronacher wrote 91% of the commits. Vegard Stikbakke cut 0.4.0 (code shows, git log). There are no CODEOWNERS or governance documents (prior note).
- **Steward.** Earendil Inc., through the PR-template rights grant (D-row in §1) (code shows).
- **Cadence.**
  - Bursts: 176 commits in October-December 2025 and 114 in March-April 2026, then about 5 a month.
  - 15 releases in 12 months. Minor versions arrive every 1-3 months; the last two were 0.5.0 on 2026-08-04 and 0.5.1 on 2026-10-20 (code shows).
  - The changelog has no dates (prior note).
- **Triage.** 35 open issues and PRs (GitHub API, 2026-10-26). Issue #96, a replay correctness bug, has been open since 2026-04-15. Issue #122 was closed with a fix about 5 weeks after it was reported. Issue #130 was closed in 6 days. Issues #34 and #79 were closed the same day (users report / GitHub search). Response times and labels beyond these could not be retrieved (gap).
- **Roadmap.** No public roadmap file. Open threads point to more SDKs (#15, open since 2025-10-30), concurrency limits (#89) and resuming sleepers (#29) (users report). The author has shelved durable promises (author says, *snippet*).
- **Contribution.**
  - AI assistance must be disclosed (`CONTRIBUTING.md:7-21`).
  - Contributors put SQL changes only in `absurd.sql`; migrations are generated at release with an agent prompt (`CONTRIBUTING.md`, "Migrations").
  - CI runs on every push and PR (`.github/workflows/test.yml`) (code shows).
- **Security process.** There is no `SECURITY.md` (prior note). An SQL-injection fix in absurdctl (0.1.0, #68) shipped without an advisory (`CHANGELOG.md`).

## 8. Documentation, notes and metadata stored

Per queue (code shows, `sql/absurd.sql:222-312`):

- **Task `t_<q>`:**
  - `task_id` (UUIDv7), `task_name`, `params` jsonb, `headers` jsonb (free-form, for trace or correlation ids)
  - `retry_strategy` jsonb, `max_attempts`, `cancellation` jsonb
  - `enqueue_at`, `first_started_at`, `state`, `attempts`, `last_attempt_run`, `completed_payload` jsonb, `cancelled_at`
  - `idempotency_key` (unique when unpartitioned)
- **Run `r_<q>`:**
  - `run_id`, `task_id`, `attempt`, `state`
  - `claimed_by` (worker id), `claim_expires_at`, `available_at`
  - `wake_event`, `event_payload`
  - `started_at`, `completed_at`, `failed_at`
  - `result` jsonb, `failure_reason` jsonb: the SDK writes `{name, message, stack}`; a lease expiry writes `{name:'$ClaimTimeout', message, workerId, claimExpiredAt, attempt}` (`:1005-1011`)
  - `created_at`
- **Checkpoint `c_<q>`:** primary key `(task_id, checkpoint_name)`; `state` jsonb (step result, sleep wake ISO string, or event payload); `status` (always `'committed'` in practice); `owner_run_id`; `updated_at`. There is one row per name: an overwrite replaces the value, and no history is kept.
- **Event `e_<q>`:** `event_name` primary key, `payload` jsonb (NULL means not yet emitted), `emitted_at` (epoch for a sentinel).
- **Wait `w_<q>`:** `(run_id, step_name)`, `task_id`, `event_name`, `timeout_at`, `created_at`.
- **Idempotency `i_<q>`** (partitioned queues only): `idempotency_key` → `task_id`.
- **Global:** the `absurd.queues` policy row, plus the schema version, which is a function.

**Not stored** (code shows, by absence):
- the code, SDK or schema version that produced a result;
- per-step timings (only `updated_at` of the last write);
- a step's input arguments;
- logs and metrics; the SDKs offer pluggable loggers and hooks only (prior note OPS-2);
- an event's emitter identity;
- a cancellation reason;
- the history of overwritten checkpoints.

**How it is stored.**
- Everything is JSON in `jsonb`, with no size limit.
- Timestamps come from the DB clock through `absurd.current_time()`, except the sleep wake values the SDKs compute (D10).
- Retention is "forever" by default (`docs/concepts.md:432-436`). Cleanup must be scheduled (C27-C29, C39); issue #130 shows the cost of missing that (R10).

**Documentation set.** 5,368 lines across 20 Markdown pages in `docs/`, published with zensical. Its content:
- quickstart, concepts, storage, database, cleanup and comparison pages;
- SDK pages per language;
- tool pages;
- 5 pattern pages.

## 9. Known problems, challenges and open questions

Pinned commit = HEAD, so every code finding below is true at HEAD.

**P1. Stale-lease writes (still true).**
- `complete_run` checks only `state='running'` (`:1108`). `extend_claim` rejects only a NULL expiry (`:1602`), not an expired one. `set_task_checkpoint_state` checks neither the lease nor the run state (`:1491-1525`) (code shows).
- Consequence (inferred): a worker whose lease expired, but which has not yet been swept, can extend the lease, write checkpoints and complete the run, even though the lease logically passed to nobody yet. If another worker has already re-claimed, the old run is `failed` and its writes raise AB002, so the guard holds only after a sweep (prior note §3).

**P2. Event names are reused, not consumed (still true).**
- An event row keeps its payload until `cleanup_events` (`:2252-2293`). `await_event` resolves at once from it (`:1797-1825`) (code shows).
- A second task, or a second loop iteration, that waits on the same name gets the old payload without suspending (inferred). The author's mitigation is unique names (`README.md:162`).

**P3. An `awaitEvent` timeout writes no checkpoint, so replay diverges (open issue #96).**
- TS and Python throw `TimeoutError` before calling SQL, based on `wake_event` (`index.ts:509-517`; `__init__.py:806-812`). The SQL timeout path also returns without a checkpoint (`:1842-1851`). Any later suspension clears `wake_event` (`schedule_run :1175`, `fail_run :1257`) (code shows).
- On the next replay the timed-out await finds no checkpoint and registers a fresh wait. The task then re-suspends on a stale event for a full timeout. If the event arrives later, the replay takes the payload branch instead of the timeout branch (inferred).
- The reporter measured an extra 5 minutes of delay with 300 s timeouts, and describes a lost emit in that window (users report, #96).
- The existing tests cover only the immediate re-await (`tests/test_events.py:106`; `sdks/typescript/test/events.test.ts:212`) (code shows).

**P4. A lease of 0 or less never expires.** `claim_timeout <= 0` sets `claim_expires_at = NULL` (`:946-948`), and the sweep requires a non-null value (`:993`) (code shows; prior note).

**P5. `maxDelay` documentation mismatch.** See §6 (code shows).

**P6. Checkpoint write is not scoped.** `set_task_checkpoint_state` looks the run up by `p_owner_run` alone and writes to `p_task_id` without checking that they match. It accepts runs in any non-failed, non-cancelled state (`:1491-1550`) (code shows). Inferred: the SDKs always pass matching ids, so this is a defence-in-depth gap, not a live bug.

**P7. Retention is off by default.** Issue #130 reports a database outage at about 1.4 GB (users report).

**P8. Clock skew.**
- The repeated-claim bug in #122 was fixed in 0.5.0 by anchoring wake-ups to the DB clock (users report / author says).
- The `remaining` computation still uses the worker clock (`index.ts:422`; `__init__.py:787`; `context.go:357`) (code shows); the cross-worker effect is inferred (D10).

**P9. Watchdogs.** `process.exit` / `os.Exit` at 2× the lease kills every task in the process (inferred). Python has no watchdog, so a hung Python handler is detected only by lease expiry (code shows).

**P10. Python async worker barrier.** `start_worker` waits for every task in a batch before claiming more (`__init__.py:2205-2212`) (code shows). Inferred consequence: one slow task idles all other slots.

**P11. Unbounded growth per task.** Every run reloads every checkpoint, and payloads have no size limit (prior note REL-2). This matters for agent loops that checkpoint each message (`docs/patterns/pi-ai-agent.md`).

**P12. Control-flow exceptions are visible to user code.** A handler that catches everything also swallows `SuspendTask` (prior note O8, inferred).

**P13. Security.**
- No grants or roles in SQL.
- Habitat listens on all interfaces, has no authentication, and exposes a retry endpoint that writes, while the docs say "read-only" and "localhost".
- No `SECURITY.md`.
- absurdctl fetches remote SQL without checking a digest.
- (All prior notes, re-checked at HEAD: `config.go:15,21`; `server.go:121`; `docs/tools/habitat.md:22,87`.)

**P14. Migrations are non-atomic** and bump the version first (prior note O13).

**P15. Narrow test matrix.** PG16 only, so the PG18 `uuidv7` branch never runs. Python 3.12 only; Node 24 only. Habitat tests are not in `make test` (`Makefile:39`) (code shows).

**P16. "Exactly-once" wording.** "the promise of 'exactly-once' semantics" (`README.md:37-38`) and "close to 'exactly once'" (`docs/concepts.md:29`). The code gives at-least-once execution with an exactly-once *record* of each committed step (prior note §3, re-checked).

**P17. Licence hygiene.**
- The npm tarball lacks `LICENSE` (prior note).
- pgmq-derived origin with no attribution; how much survives is unknown (code shows / unknown).
- Contributors grant Earendil relicensing rights (PR template).

**P18. Throughput unknown.** There are no benchmarks. Users raise vacuum and scale questions (R4).

**Open questions.**
- Does `bindToConnection` inside a long application transaction hold `SKIP LOCKED` row locks or block claimers? Inferred: spawn only inserts, so it should not block claimers.
- How does the system behave under PgBouncer transaction pooling, given that `absurd.fake_now` is a session setting? (prior note: unknown)
- What happened to the author's reply to the vacuum and scale critique (R4)? Not retrievable.
- Is TensorZero's `durable` fork archived, and why? (unverified)
- What is the planned fix for #96? No maintainer response was visible, because comments were not retrievable.

## 10. Lessons for a successor (written with Assay's SQLite kernel in mind)

**Keep:**
1. **The five-entity model:** task, run-per-attempt, checkpoint, event and wait. Attempt-scoped checkpoint visibility, and the rule that a newer attempt wins (`:1540, 1692`). They are small, explicit and tested, and they port to any transactional store (inferred).
2. **One transaction per state transition** (D2). In SQLite, put each `claim`/`complete`/`fail`/`emit` in one `BEGIN IMMEDIATE` transaction. This replaces `SKIP LOCKED` and the lock-ordering work, because SQLite has one writer (inferred).
3. **First-write-wins events with the pre-await "emit before await is not lost" guarantee** (`tests/test_events.py:165`).
4. **Race-safe spawn idempotency keys** with `created=false` reporting.
5. **An injectable database-side clock for tests** (D11). Use one clock source for both lease and sleep arithmetic, which absurd still mixes (P8).
6. **Deferring unknown task names instead of failing them** (D13), but bound the loop.
7. **Honest documentation of overlap** (`docs/concepts.md:131-133`); drop the "exactly-once" phrasing.
8. **The SQL test suite as a conformance specification** (C97): port the scenarios rather than the code.

**Avoid:**
1. **A lease that is advisory without a fence on every write.** Check `claim_expires_at > now` (and the claimer) in complete, checkpoint and extend (P1).
2. **Lazy expiry that depends on polling claimers.** That is acceptable only if a claimer always exists. A single-process host should sweep on its own timer (inferred).
3. **A zero lease that means "never expires"** (P4).
4. **A timeout branch with no checkpoint.** Record a timeout checkpoint, as #96 proposes (P3).
5. **Events that are never consumed,** or else make reuse explicit, for example with scoped event keys (P2).
6. **Killing the process on lease overrun.** Abort the one task instead (P9).
7. **Control flow through exceptions** that user code can catch (P12).
8. **Loading the whole checkpoint history** on each run, and unbounded payloads (P11).
9. **Retention off by default** (P7).
10. **Per-queue dynamic DDL.** A `queue` column is simpler in SQLite (D8).
11. **An unauthenticated dashboard on all interfaces,** and non-atomic migrations (P13, P14).

**Unknown, measure before deciding:**
- Throughput and latency of a polling claim loop on SQLite WAL with N processes (absurd has no numbers either).
- Whether Assay needs multi-host workers at all. Absurd's genuinely unique value is multi-machine leasing on a shared Postgres; on single-host SQLite the lease guards only against crashed or hung processes (inferred, prior note §4).
- How to version step names and results across code changes. Absurd offers only conventions (`docs/patterns/living-with-code-changes.md`).

## 11. Sources (accessed 2026-10-26 unless noted)

**Code**
- earendil-works/absurd, cloned at `3cfc64f10b0bef7ff159ec4e01a4ae76424c8d05` (also HEAD): `sql/absurd.sql`, `sql/migrations/`, `sdks/typescript/src/index.ts`, `sdks/python/src/absurd_sdk/__init__.py`, `sdks/go/absurd/*.go`, `absurdctl`, `habitat/`, `tests/`, `docs/`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `.github/`, and the git log and tags. The clone was deleted after reading.

**Internal notes**
- `/home/user/RE4exa/docs/merger/01-anatomy/absurd.md`
- `/home/user/RE4exa/research/rqs-review/reports/absurd.md`

**GitHub**
- Repository metadata: GitHub search API.
- Issues read through GitHub issue search (bodies only): #3, #14, #15, #16, #29, #33, #34, #49, #59, #76, #79, #89, #96, #101, #114, #120, #122, #130 — https://github.com/earendil-works/absurd/issues/{n}

**Author** (search snippets only; pages not opened)
- "Absurd Workflows: Durable Execution With Just Postgres", https://lucumr.pocoo.org/2025/11/3/absurd-workflows/ (2025-11-03)
- "Absurd In Production", https://lucumr.pocoo.org/2026/4/4/absurd-in-production/ (2026-04-04)
- X: https://x.com/mitsuhiko/status/1985268932752691524 (Nov 2025); https://x.com/mitsuhiko/status/2040380018941976895 (Apr 2026)

**Discussion** (search snippets only)
- HN https://news.ycombinator.com/item?id=45797228; https://news.ycombinator.com/item?id=45832565; https://news.ycombinator.com/item?id=45829400; https://news.ycombinator.com/item?id=45797439; https://news.ycombinator.com/item?id=48313530; https://news.ycombinator.com/item?id=45992316
- Lobsters https://lobste.rs/s/7rhkpy/absurd_workflows_durable_execution_with; https://lobste.rs/s/xqttxu/absurd_production

**Third-party write-ups and derivatives** (search snippets only)
- https://mfyz.com/durable-queue-workers-with-just-postgres/
- https://letsdatascience.com/news/absurd-delivers-durable-workflows-on-postgres-cb349d8d
- https://daily.dev/posts/absurd-in-production-2sbxsxfzn
- https://tproger.ru/translations/absurd-pyat-mesyacev-durable-execution-na-postgres-otchyot-armin
- tensorzero/durable (via mirrors)
- bytefish/Absurd.NET
- https://python-absurd-client.readthedocs.io

**Searched without useful results:** Reddit (no threads found); Bluesky and Mastodon (one hackers.pub repost, no content); benchmarks (none).

**Blocked:** direct page fetches (DNS failure in this sandbox), the hn.algolia.com API (proxy refusal), and GitHub issue comments (repo not enabled for this session).
