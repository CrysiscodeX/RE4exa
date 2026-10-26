# Orca (stablyai/orca): donor profile

One profile in a set of six (rea, leanrea, pi-durable, absurd, Orca, T3 Code). Orca is a donor: Assay (`apps/assay`) copied its sub-agent model and UI layout. This profile asks how and why Orca handles workloads, sub-agents, failures, overlapping work, organisation and records, and what a successor should keep or avoid.

## How to read this

Every statement carries a source label:

- **[code]**: the code shows it, cited as `path:line` at the pinned commit `997d34b0`. Code paths are relative to the repository root. `@main` means the default-branch head `1d90fd51` (2026-10-26).
- **[author]**: the authors say it, in docs, README, release notes, skill guides or code comments ("Why:" comments are author statements, not behaviour).
- **[users]**: issue reporters, Hacker News commenters, Product Hunt or third-party reviewers say it. Some issue reporters may be maintainers or agents (see §9).
- **[inferred]**: my reasoning. It is not established fact.
- **[prior]**: taken from the earlier internal notes (`research/extraction/orca-t3code.md`, `docs/merger/01-anatomy/donors.md`, `research/rqs-review/reports/orca.md`) and not re-checked here.

**Method and limits.**
- The code was read file by file over HTTPS (raw.githubusercontent.com, plus github.com directory pages). There was no clone, no build and no run, and no repository-wide search was possible. "Not found" therefore means "not found in the files read", never "absent".
- The GitHub API, hn.algolia.com, reddit.com, ycombinator.com, onorca.dev and third-party blogs could not be fetched from this environment. Public material on those sites comes only from search-engine snippets and is labelled as such.

### Corrections to the earlier internal notes

1. **"One worktree per worker" is wrong for orchestration.**
   - [author] "A fresh worker means a fresh agent terminal, not a new Git worktree. Use the current or an exact existing workspace by default. Create a worktree only when the user requested one or a concrete checkout or filesystem conflict makes sharing unsafe." (`skill-guides/orchestration/references/placement-and-remote.md:8-11`)
   - [code] The canonical loop starts workers with `--worktree current` (`skill-guides/orchestration.md:104-108`).
   - Worktree-per-task is the *human* workflow (`docs/site/content/docs/model/worktrees.mdx:8`), not the orchestration default. The extraction notes (§1, "One worktree per worker") and donors.md row 7 ("creates … a worktree") should be corrected.
2. **The circuit breaker counts per Task, not per run, and not every failure.**
   - [author] "After three consecutive failures for one Task, its dispatch context circuit-breaks and the Task is failed. Failed `worker-start` attempts count across `--retry-of`; a worker's own `failed` report does not." (`…/references/recovery-and-cleanup.md:120-122`)
   - [code] `DISPATCH_CIRCUIT_BREAK_FAILURES = 3` (`src/main/runtime/orchestration/db/dispatch-context/dispatch-circuit-breaker.ts:2`), stored as `dispatch_contexts.failure_count` and `status = 'circuit_broken'` (`src/main/runtime/orchestration/db/schema/create-graph-tables-sql.ts:164-167`).
   - Assay's breaker is per case instead (§12).
3. **The depth cap of 1 is newer than the docs that described it.**
   - [author] It was "the behaviour Orca documented but never actually enforced" (`src/shared/nested-worker-depth.ts:3-7`). Enforcement arrived with schema v37 (creator identity), per `src/main/runtime/orchestration/db/contract-constants.ts` (schema comment).
4. **The supervised loop is experimental, and the older scheduler is retired.**
   - [author] "Enable orchestration under Settings → Experimental" (`docs/site/content/docs/cli/orchestration.mdx:12-15`).
   - [author] `orchestration run`, `run-stop`, `coordinator-start` and `coordinator-stop` "perform **no effects**" (`:17-21`).
   - [code] The in-process `Coordinator` class still exists (`src/main/runtime/orchestration/coordinator.ts`). Whether anything still reaches it was not traced.

---

## 1. Identity card

| Field | Value | Source |
|---|---|---|
| Repository | https://github.com/stablyai/orca | — |
| Pinned commit | `997d34b04389665795966ec4c0325b5cbfabf9ee`, PR #31130 "Layout groundwork (switched off): main creates, starts and closes terminal tabs and panes itself". Parent `5726453`. Commit date not shown on the page; about 2026-10-20 [inferred from neighbouring issue numbers and the RQS review date] | [code] github.com commit page, read 2026-10-26 |
| Default-branch head | `1d90fd51c6d20644763e2bfca66fbe8e8513bb9e` (`git ls-remote`, 2026-10-26). **1,188 commits** since the pin; the compare page lists 62 contributors | [code] compare page, read 2026-10-26 |
| Version | `package.json` reads 1.4.214 at both the pin and main. The release workflow pushes only a tag when main requires PRs (`.github/CONTRIBUTING.md`, "Release Process"). Latest release **v1.4.241, 26 Oct 2026**; v1.4.235 to v1.4.241 shipped between 20 and 26 Oct | [code] [author] releases page |
| Licence | MIT, © 2026 Lovecast Inc. (`LICENSE`). Sub-packages carry no `license` field | [prior] donors.md licence table |
| Company | Stably AI, San Francisco. The YC profile, seen only as a search snippet, lists batch W22 (founded 2022) and co-founders Jinjing Liang (CEO) and Neil Parker. A third-party blog calls it a "four-person" team. The link between Lovecast Inc. and Stably AI is **unknown** | [users] search snippets of ycombinator.com and agentconn.com, 2026-10-26 |
| Dates | First commit 2026-03-17, according to a third-party blog. Earliest issues (#16 to #36) closed 22 Mar 2026. Product Hunt launch 9 Apr 2026 | [users] agentconn.com snippet; GitHub issues page; hunted.space snippet |
| Stack | Electron 43.7.8 (43.8.1 @main), TypeScript, React renderer, SQLite (WAL) for orchestration, a separate terminal daemon, Node 24 plus Bun for tests. Also a mobile (Expo) app, a `cloud/` relay, and native helpers in Swift, Rust and C++ | [code] `package.json`; `.github/CONTRIBUTING.md` "Local Setup"; [prior] RQS review |
| Size | 16,956 production TS/TSX files and 2,101,263 lines under `src`; 15,404 test files; 284 CLI commands; 748 RPC methods; 97 workflows | [prior] RQS review (measured at the pin) |
| Supported agents | At least 45 CLI agent IDs in `src/shared/tui-agent.ts:3-48` (Claude Code, Codex, OpenCode, Pi, Gemini, Cursor, Copilot, Grok, Hermes and others) | [code] |
| Stars and activity | The GitHub page showed **106.4k stars, 6.7k forks, 144 watchers, 16,553 commits on main, about 4.3k open issues and about 4.1k open PRs** (WebFetch summary, 2026-10-26). Release v1.4.237 (21 Oct) is titled a "100,000 stars celebration" [author]. Third-party snapshots: 42,896 stars (Aug 2026), 58,464 (1 Sep 2026), 94.8k (undated). Issue and PR numbers reached #33,853 by 26 Oct, about 150 items a day since mid-March [inferred arithmetic] | GitHub repo and releases pages; search snippets |

## 2. Purpose and origin

- **Origin.** [author] Show HN "Open Source 'Conductor + Ghostty'" (item 47549197, 21 points, date not retrieved), quoted via a search snippet: "Our team works with Claude Code, Codex, Gemini all day. We love Ghostty, but wanted something where we could work in multiple worktree at once and have multiple agents run." The team open-sourced an internal tool.
- **Current pitch.** [author] "The AI Orchestrator for 100x builders. Run Codex, ClaudeCode, OpenCode or Pi side-by-side — each in its own worktree, tracked in one place." (`README.md`, header.) The GitHub About text reads: "the place for working with a fleet of agents".
- **Position.** [author, YC snippet] "Orca is an open-source Cursor - a local-first AI coding environment that helps developers code with their own AI setup locally." The sibling product, Stably, is an AI end-to-end testing platform.
- **Why worktrees.** [author] "This is what makes parallel agents safe — they never step on each other's files." (`docs/site/content/docs/model/worktrees.mdx:8`)
- **Why orchestration.** [author] Orchestration "records who owns work, which attempt is authoritative, and when supervised work has settled" (`skill-guides/orchestration.md:15-16`). The docs reserve it for "when you need ownership, completion tracking, or a DAG" (`docs/site/content/docs/cli/orchestration.mdx:10`).
- **Who uses orchestration.** [author, code comment] "only the small minority who dispatch work ever have dispatch_contexts rows" (`src/main/runtime/orchestration/db/orchestration-db.ts:19-24`). Orca is mostly used as a many-terminal, many-worktree IDE that a human drives. The coordinator layer is a niche, experimental part of it.

## 3. Public reception

**Sample.** Almost all public discussion is either the repository's own issue tracker or SEO aggregator pages. I found:
- **Hacker News:** about 4 relevant threads through search, with fewer than 10 user comments visible in snippets.
- **Product Hunt:** 1 listing.
- **Reviews:** 3 or 4 third-party pages, mostly from competing vendors.
- **Reddit:** searches returned no threads, and the domain was blocked for direct search.
- **YouTube:** nothing found.

| Source | Date | What it says |
|---|---|---|
| HN Show HN, https://news.ycombinator.com/item?id=47549197 | Probably Mar 2026, not retrieved | 21 points. One commenter asked how it differs from cmux. Another noted the repo had no LICENSE file at launch, since fixed [users, search snippet] |
| HN comment, https://news.ycombinator.com/item?id=49234357 and nearby | Undated | "I tried Orca for a few days … liked being able to manage git worktrees from the UI and being able to leave comments for the agent while I'm reviewing the diff, I found editing experience too slow for daily use … missing … vim bindings, being able to change default shell" [users]. Another: "Orca is my main ADE too, but I haven't found any other users!" [users]. Another describes sleeping worktrees to free RAM [users] |
| Product Hunt, https://www.producthunt.com/products/orca-5 (via hunted.space) | 9 Apr 2026 | 83 upvotes, 6 comments, #44 of the day [users, snippet] |
| superset.sh "Orca vs Conductor" (a competitor) | 2026 | Orca: cross-platform, open source, 25+ agents. Conductor: macOS only, proprietary, paid cloud tier [users, snippet] |
| vibecodinghub.org review | 2026 | "parallel agents remove collisions, not merge conflicts, and not your review burden" [users, snippet] |
| braindetox.kr review | 2026 | Each worktree duplicates dependencies on disk and in memory, and more agents mean more tokens and more diffs to review [users, snippet] |
| GitHub issues, https://github.com/stablyai/orca/issues | Read 2026-10-26 | 9,107 issues in total. 969 match "orchestration", 315 match "worker stuck OR hang OR hung", 63 match merge-conflict terms. The most-upvoted requests are workspace and editor features (Jujutsu workspaces #1082, multi-repo diffs #1099, LSP #961, multiple windows #6074), not orchestration [users] |

**Summary.**
- Reception is large in stars and small in independent discussion. I found no first-hand public write-up of the coordinator and worker loop. The only search results were mirrors of Orca's own skill guide on mcpservers.org.
- The concrete criticisms I found:
  - editor speed and polish (HN);
  - memory growth with three or more parallel agents (issue #29899);
  - worktrees do not prevent merge conflicts or reduce review work (reviews);
  - worktrees do not isolate the filesystem, network or secrets (HN comment on a competitor).
- Star counts rose from about 43k in August to about 106k in October 2026, per third-party snapshots and the GitHub page. Why they rose so fast is **unknown**.

## 4. Architecture and mechanics: design decisions

Each row gives the decision, why it was made, and its consequence.

| # | Decision | Why | Consequence or trade-off |
|---|---|---|---|
| D1 | **Orca drives existing CLI agents in real terminals** instead of embedding a model loop. Status comes from agent hooks and from the OSC 7501 terminal protocol | [author] Bring your own agent and subscription (`README.md`, "Supported Agents"); "if it runs in a terminal, it runs in Orca" | Every agent's TUI quirks become Orca's problem: paste timing, trust menus, typed-text drops (`src/shared/agent-prompt-injection.ts:13-22`, the STA-8200 notes). The prompt budget and timing constants exist because of this [code] |
| D2 | **Agent-facing CLI plus skill guides** as the coordination interface. The coordinator is itself an agent following `skill-guides/orchestration.md`, not Orca code | [author] Agents drive Orca through the CLI (`README.md`, "Orca CLI"). The legacy in-process scheduler was retired (`docs/…/cli/orchestration.mdx:17-21`) | The protocol is only as reliable as the coordinating model's adherence. Rules are written as prose with exact argv. The guide is 13,298 bytes, plus 7 references [code] |
| D3 | **A ledger, not a scheduler.** "A Run … does not schedule or place workers" | [author] `skill-guides/orchestration.md:51-52` | No automatic dispatch, priority, concurrency cap or retry in the supervised loop: the coordinating agent decides everything [inferred from the docs and the files read] |
| D4 | **SQLite in WAL mode** (`synchronous=NORMAL`, `busy_timeout=5000`) for Runs, Tasks, Dispatches, messages, deliveries, receipts and gates | [code] `src/main/runtime/orchestration/db/orchestration-db.ts:29-32` | Durable and inspectable. Schema version 43 in about 7 months, with a migration log in comments (`src/main/runtime/orchestration/db/contract-constants.ts`) [code] |
| D5 | **Attempt identity (Dispatch) separate from work (Task).** Lifecycle authority comes only from the active Dispatch | [author] So that "stale messages from a previously-failed dispatch" cannot complete or refresh the retry (`src/main/runtime/orchestration/preamble.ts:8-13`) | Every worker message must carry both `taskId` and `dispatchId`. Wrong-pane senders are rejected (`src/main/runtime/orchestration/lifecycle-reconciliation.ts:42-52`) [code] |
| D6 | **Idempotent mutation receipts** keyed by caller fingerprint and request id, with a payload hash | [author] So that a lost response can be replayed, joined or recovered "instead of starting a duplicate" (`…/references/recovery-and-cleanup.md:76-80`) | Adds a three-state recovery protocol (completed, pending, absent) that agents must follow [code] |
| D7 | **Absence is never death.** The vocabulary is `live`, `unverifiable` or `exited`, and only positive proof of exit authorises stop, retry or release | [author] `AGENTS.md:102`; `src/shared/pty-liveness-verdict.ts:1-12`. The SSH and remote use case is the driver | A crashed worker can sit "in progress" until someone looks. Users report 40-minute blind spots (§7) [users] |
| D8 | **Placement is explicit and never inherited.** A retry must restate `--worktree` | [author] "Placement is never silently inherited" (`…/recovery-and-cleanup.md:112-118`) | Prevents a retry from landing in the wrong checkout, at the cost of longer commands [inferred] |
| D9 | **Depth cap default 1, fail-closed.** Unstamped rows read depth 1; malformed settings fall back to 1 | [author] A malformed setting "must not be a way to get unlimited nesting" (`src/shared/nested-worker-depth.ts:29-33`). Unstamped rows "fail closed" (`create-graph-tables-sql.ts:170-172`) | Workers do the work themselves. The sub-dispatch section is left out of the preamble when nesting is off, "a worker told it 'usually cannot' delegate still tries" (`preamble.ts`, `buildSubDispatchSection` comment) [author] |
| D10 | **Prompt budget derived from Windows terminal paste speed** | [author] "Keeps worst-case Windows ingest plus effect settlement inside worker-start's fixed RPC grace" (`src/shared/orchestration-worker-start-prompt-budget.ts:16`) | The task body limit works out to 1,214,464 bytes: (50,000 − 30,000) ms × 64 B/ms = 1,280,000 B, minus 4 × 16 KiB reserved for the preamble (`orchestration-timing-budgets.ts:4,8`; `agent-prompt-injection.ts:36,62-72`; `terminal-input.ts:8-9`) [code]. A transport fact, not a context-window fact |
| D11 | **Supervised worker-start composes everything in one call**: task, dispatch, placement, terminal, readiness and preamble. Each stage is recorded with its residual resources | [author] "`worker-start` is the normal path, composing placement, terminal readiness, prompt injection, and supervised resource ownership" (`skill-guides/orchestration.md:150-152`) | A failed start reports `failedStage` and `residualResources` instead of being torn down blind (`skill-guides/orchestration.md:111-113`; `…/worker/worker-worktree-creation.ts:52-94`) [code] |
| D12 | **Terminal ownership is a table.** Release closes only the exact terminal a settled Dispatch owns | [author] `…/recovery-and-cleanup.md:157-161`; [code] `worker_terminal_resources` (`create-core-tables-sql.ts:168-196`) | Orca never closes a user's own, reused or setup terminal by mistake. Five release states, including `unknown`, must be handled |
| D13 | **The execution host owns the facts.** Remote workers are addressed by Dispatch id, and a relay keeps sequence and ack bookkeeping | [author] `AGENTS.md:102`; `…/references/placement-and-remote.md:73-78` | Federation tables and legacy migrations make up a large share of the schema (`create-graph-tables-sql.ts:25-113`) [code] |
| D14 | **Agents launch with approval bypass by default** | [author] "The intent is that the worktree itself is the sandbox" (`docs/site/content/docs/model/agents-sessions.mdx:63`) | Contradicted by Orca's own `agents/supported.mdx`, which says a worktree is not a security sandbox [prior, RQS gap G1]. @main stores a per-agent permission choice (`own`, `ask`, `accept-edits`, `auto`, `full-access`), and a missing choice resolves to `own` (`src/shared/tui-agent-permission-choice.ts`, `resolveAgentPermission` @main). But `DEFAULT_TUI_AGENT_ARGS` still equals the bypass args (`src/shared/tui-agent-launch-defaults.ts:37-38` @main). What a fresh install gets on main is **unknown** |
| D15 | **Rationale lives in code comments**, with a concise-comment rule | [author] "Concise/Brief Non-obvious Comments ONLY" (`AGENTS.md:21-24`) | @main has replaced many multi-line "Why:" comments with one-liners. For example, the liveness comment shrank from 8 lines to 2 (diff of `src/shared/pty-liveness-verdict.ts`, pin vs main) [code]. Design docs cited in comments (`DESIGN_DOC_PREAMBLE_FIX.md`, `ORCHESTRATOR_FEEDBACK.md`, `docs/reference/ssh-execution-boundary.md`) return 404 at the pin [code] |

## 5. Capability inventory

Paths at `997d34b0` unless marked @main. Docs paths are under `docs/site/content/docs/`; skill references are under `skill-guides/orchestration/references/`.

| ID | Capability | How it is implemented (files @ commit) | Limits | To reproduce elsewhere |
|---|---|---|---|---|
| ORCA-C01 | Worktree per human task | `src/main/ipc/worktree-logic.ts:28-56` (`sanitizeWorktreeName`: Unicode kept, `..` collapsed); docs `model/worktrees.mdx:17-23` | Needs git; folder workspaces have no isolation | `git worktree add` plus a name sanitizer that refuses `.`, `..` and empty names |
| ORCA-C02 | Sharing gitignored state into worktrees | docs `model/worktrees.mdx:38-65` (Shared Paths, `orca.yaml worktree.sharedDirectories`, `.worktreeinclude`) | Literal paths only; globs skipped | Copy or link a declared allow-list of gitignored paths |
| ORCA-C03 | Repo setup script on worktree creation | `src/main/hooks.ts:24` (`HOOK_TIMEOUT = 120_000`), process-group kill at `:300,342-344` [prior]; `setupRunPolicy: 'run-by-default'` (`src/shared/constants.ts:145` at the pin; `:136` @main) | Runs untrusted repo scripts by default [prior, RQS G7] | Gate on a per-repository trust decision |
| ORCA-C04 | Orchestration ledger | `src/main/runtime/orchestration/db/orchestration-db.ts:29-41`; `…/db/schema/create-core-tables-sql.ts`; `…/db/schema/create-graph-tables-sql.ts` | Single local SQLite file per runtime | Tables: runs, tasks, dispatch_contexts, messages, deliveries, receipts, gates |
| ORCA-C05 | Task DAG and ready view | `tasks.deps` and `status` (`create-graph-tables-sql.ts:115-135`); `task-list --ready --brief` echoes specs capped at 160 characters (`coordinator-loop.md:13-20`) | No priority column; "prefer parallel waves over chains deeper than three or four steps" (`skill-guides/orchestration.md:116-117`) [author] | deps array plus a readiness projection |
| ORCA-C06 | Supervised worker-start | `src/main/runtime/rpc/methods/orchestration/worker/workers.ts:19-95`; `local-worker-start.ts` | Coordinator must be bound to the Run, else `consumer_fenced` (`workers.ts:41-47`) | One RPC that creates task and attempt, then places and briefs the worker |
| ORCA-C07 | Placement options | `current`, `new-child`, `new-top-level`, exact selector, `--on <env>` (`placement-and-remote.md:13-22,48-59`); lineage via `worker-worktree-creation.ts:76-80` | Remote `current` and `new-child` are invalid | An explicit placement enum; never inherit on retry |
| ORCA-C08 | Worker preamble | `src/main/runtime/orchestration/preamble.ts:70-164`; delivered by `…/worker/deliver-worker-dispatch-preamble.ts:34-121` | Rules sit as comments above the CLI examples because "LLM readers anchor on examples and skim trailing prose" (`preamble.ts:65-69`) [author] | Inject exact argv with the ids filled in |
| ORCA-C09 | Mailbox with FIFO deliveries and ack | `deliveries` table (`create-core-tables-sql.ts:90-101`); batch of up to 50 messages, replayed until acked (`messaging-and-gates.md:17-24`) | Nothing interrupts a worker: it must poll `check` (`preamble.ts:141-145`) | Durable enqueue plus an acked delivery batch plus a consumer generation |
| ORCA-C10 | Group addresses | `@all`, `@idle`, `@<agent>`, `@worktree:<id>` (`messaging-and-gates.md:42-53`) | Never for `worker_done` or heartbeat | Scoped fan-out inside one Run |
| ORCA-C11 | Durable ask and reply | `preamble.ts:125-135`; `worker-contract.md:20-32`; `remote_questions` table | Timeout leaves one pending question to resume | Question message plus resume-by-id |
| ORCA-C12 | Decision gates | `decision_gates` table (`create-graph-tables-sql.ts:188-199`); `gate-create` and `gate-resolve` (`messaging-and-gates.md:60-71`) | Coordinator-owned only | A blocking record on a task |
| ORCA-C13 | Heartbeat and stale warning | 5-minute cadence (`preamble.ts:41-45`); 10-minute threshold, log-only warning (`src/main/runtime/orchestration/coordinator-task-dispatch.ts:16-27`); CLI emits stderr heartbeats every 15 s during waits (`cli/orchestration.mdx:129`) | A warning, never an action | Heartbeat keyed by attempt id |
| ORCA-C14 | Lifecycle reconciliation | `src/main/runtime/orchestration/lifecycle-reconciliation.ts:42-52` (10 rejection codes, e.g. `stale_dispatch`, `sender_not_assignee`); heartbeats for inactive dispatches suppressed but kept for audit | Requires a JSON payload | Validate each completion against the active attempt and the sender |
| ORCA-C15 | Mutation receipts | `src/main/runtime/rpc/orchestration-mutation-executor.ts:46-251`; table `create-core-tables-sql.ts:106-117`; capacity 10,000 rows, completed rows pruned after 30 days (`src/main/runtime/orchestration/mutation-receipt-capacity.ts:4-6`) | `request_mismatch` on a reused id; `operation_unknown` after a restart mid-mutation (`executor.ts:180-207`) | Keep (caller, request) → {method, payload hash, state, receipt} |
| ORCA-C16 | Was-it-applied query | `request-show` returns `completed`, `pending` or `absent`; "absent … is not proof nothing happened" (`recovery-and-cleanup.md:74-90`) | Per caller identity | Expose receipt lookup to callers |
| ORCA-C17 | Per-Task circuit breaker | `dispatch-circuit-breaker.ts:2`; `failure_count` (`create-graph-tables-sql.ts:166`); escalation path `src/main/runtime/orchestration/coordinator-escalation-triage.ts:58-66` | Counts failed starts, not worker-reported failures (`recovery-and-cleanup.md:120-125`) | A counter per task-attempt chain; refuse `--retry-of` after it opens |
| ORCA-C18 | Nesting depth cap | `src/shared/nested-worker-depth.ts:8,34-42`; `src/main/runtime/orchestration/db/dispatch-depth.ts:98-222` (takes the maximum over the roles a caller holds; ambiguity throws) | Default 1, configurable in Settings | Stamp depth on every attempt row; compute it from the creator |
| ORCA-C19 | Prompt budget | `src/shared/orchestration-worker-start-prompt-budget.ts:12-28`; checked before any effect (`workers.ts:55`) | 1,214,464 bytes, Windows-derived | Derive from your own transport |
| ORCA-C20 | Liveness vocabulary | `src/shared/pty-liveness-verdict.ts:9-12`; fleet versus PTY liveness (`skill-guides/orchestration.md:61-63`) | "A live terminal can still hold a dead or stuck agent" [author] | Three-valued verdict with a reason |
| ORCA-C21 | Fleet projection with a next action | `worker-list` rows carry `projection.liveness`, `attention`, `requiresAction` and a literal `nextAction` argv, paged at 100 (`recovery-and-cleanup.md:25-31,47-50`); `…/worker/worker-list-projection.ts` | Unscoped lists bury live workers | Machine-readable "what to do next" per worker |
| ORCA-C22 | Staged start with residual resources | `worker_dispatches` (states `starting` through `abandoned`; `stage`, `effects`, `residual_resources`) (`create-core-tables-sql.ts:144-166`); `worker-worktree-creation.ts:52-94` | — | Record each side effect before taking the next |
| ORCA-C23 | Stop, abandon, retain, release | `recovery-and-cleanup.md:127-172`; `worker_terminal_resources` (`create-core-tables-sql.ts:168-196`) | `worker-stop` never deletes the worktree (`:134-135`) | An ownership table and release states |
| ORCA-C24 | Output archive | `worker_terminal_archives` with kinds `transcript_pin`, `terminal_tail`, `structured_journal` (`create-core-tables-sql.ts:220-226`); `worker-read --source auto` (`recovery-and-cleanup.md:65-72`) | Bounded tail; cursors pinned to a source | Archive output on release |
| ORCA-C25 | Stale-base guard | `DISPATCH_STALE_THRESHOLD = 20` commits; `allow-stale-base: true` spec line (`src/main/runtime/orchestration/coordinator-stale-base-flag.ts:3-9`); drift section lists 5 missing commit subjects (`preamble.ts`, `buildDriftSection`) | Legacy coordinator path [code]; whether the supervised path uses it was not traced | Refuse dispatch on a far-behind base |
| ORCA-C26 | Legacy in-process coordinator | `src/main/runtime/orchestration/coordinator.ts:35-36` (poll 2 s, `maxConcurrent` 4); at most one terminal created per tick (`:252`); "decomposition isn't implemented yet" (`:146`) | Retired commands (`cli/orchestration.mdx:17-21`) | — (history only) |
| ORCA-C27 | Federated (remote) workers | `create-graph-tables-sql.ts:25-113`; `…/rpc/methods/orchestration/federation/` | Capability negotiation required (`placement-and-remote.md:80-86`) | Skip unless multi-host |
| ORCA-C28 | Agent status fusion | `src/main/agent-hooks/README.md:14-23` (hooks win; OSC 7501 fills in, including after 2 minutes of hook silence) | 5 agents send OSC 7501 (`:33-41`) | Lift the OSC 7501 parser [prior] |
| ORCA-C29 | Agent Dashboard kanban | Columns Needs You, Working, Done, Idle (idle after about 30 minutes, hidden by default) (`model/agents-sessions.mdx:25-34`) | Experimental | Status-column board over sessions |
| ORCA-C30 | Notifications and Agents feed | docs `notifications.mdx`; `activity.mdx` | — | Working-to-idle transition → ping and feed entry |
| ORCA-C31 | Agent hibernation | docs `agents/hibernation.mdx` (30 minutes default, 1 minute to 24 hours; never with an unsettled Dispatch) | Experimental; 11 resumable agents | Sleep only provably settled sessions |
| ORCA-C32 | Session history and resume | docs `agents/session-history.mdx` (reads each CLI's own transcript store) | Resume local only | Scan agents' own transcript dirs |
| ORCA-C33 | Annotate AI Diff | docs `review/annotate-ai-diff.mdx` (line comments sent back as one batch) | — | Batch review notes into one prompt |
| ORCA-C34 | Commit, push and PR, with AI repair | docs `review/commit-push.mdx` ("Fix with AI", "Resolve with AI", `--force-with-lease` only as an explicit action) | Merge is human or PR-host driven | Keep merges human, with agent assist |
| ORCA-C35 | process-host | `src/packages/process-host` (timeout 30 s, output cap 8 MiB: vendored `process-spec.ts:77-78`) | Kill gate registered by host | Already vendored in Assay |
| ORCA-C36 | Terminal daemon that survives crashes | at most 5 respawns a minute; backpressure 4 MiB in total and 64 KiB per session [prior] | About 35k coupled lines [prior] | Pattern only |
| ORCA-C37 | Launch permission profile | Pin: bypass by default (`src/shared/tui-agent-launch-defaults.ts:18-22`) [prior]. @main: stored choice (`src/shared/tui-agent-permission-choice.ts:11-57`) | Fresh-install default @main unknown | Start in ask mode |
| ORCA-C38 | Folder-trust presets | `src/main/agent-trust-presets.ts:10-38` (written so a trust menu does not eat the pasted prompt) | Bypasses a third-party prompt | Ask the person first |
| ORCA-C39 | Agent skill guides on demand | `skill-guides/*.md`, `orca skills get <name> --reference` (`skill-guides/orchestration.md:183-199`); 323,068 bytes of guides [prior] | Version skew handled by fallback rules | Lazy, per-domain guides |
| ORCA-C40 | Reliability-gate manifest | `config/reliability-gates.jsonc` (1,879,463 bytes) [code]; 149 gates, all "experimental" [prior] | Hand-maintained | Pattern for CI evidence |

**Count: 40 capabilities.**

## 6. Workloads and sub-agents

**Spawn model.**
- [code] There are two worker modes: a terminal (PTY) agent and a "structured" chat session. Both receive the same preamble (`…/worker/deliver-worker-dispatch-preamble.ts:24-33`).
- [author] `worker-start --spec` creates the Task and its attempt in one call. `task-create` followed by `worker-start --task` is for planned fan-out with dependencies (`skill-guides/orchestration.md:100-118`).
- [author] The coordinator should "start the full independent wave before waiting" (`:100`).
- [code] `--model` and `--effort` are per launch. The start receipt records `launch.requested` and `launch.effective`, and "never claim a model or effort from requested arguments alone" (`coordinator-loop.md:41-44`).

**Isolation.**
- [author] The default is a fresh terminal in the coordinator's current workspace. Worktrees are opt-in, used "only when the user requested one or a concrete checkout or filesystem conflict makes sharing unsafe" (`placement-and-remote.md:8-11`).
- [author] Orca keeps "lineage, Git base, filesystem isolation, coordination parentage, UI grouping, and execution host" as separate decisions (`placement-and-remote.md:42-44`).
- [inferred] Parallel workers in one workspace can edit the same files. Isolation is a coordinator choice, not a guarantee. The only guard against overlap is the Ownership field of the task spec (§8).

**Depth.**
- [code] The default is 1 (`src/shared/nested-worker-depth.ts:8`). Every path that creates a live worker goes through `resolveChildDispatchDepth`, "so the cap cannot be skipped by adding a new spawn verb" (`src/main/runtime/orchestration/db/dispatch-depth.ts:202-222`).
- [code] A coordinator recording context against its own terminal is "bookkeeping, not delegation" and does not count as a parent (`dispatch-depth.ts:63-73`).
- [code] Two live remote attachments for one terminal identity throw instead of guessing (`dispatch-depth.ts:192-198`).
- [author] "Creating another Run does not reset depth" (`coordinator-loop.md:19-20`).
- [author] @main changes the sub-worker model: a worker now starts helpers "with `worker-start --spec` on the Run it works for, without `run-create`". The pinned preamble said "Create your own Run first" (`skill-guides/orchestration.md` diff, pin vs main).

**Liveness.**
- [author] There are two layers. `worker-list`'s `projection.liveness` is the fleet verdict for the agent, and `worker-show`'s `observation.status` is PTY liveness only. "A live terminal can still hold a dead or stuck agent." (`skill-guides/orchestration.md:61-63`)
- [author] Heartbeats prove liveness, never completion (`worker-contract.md:17-18`).
- [code] The stale threshold is 10 minutes, twice the 5-minute cadence, and produces a log warning only (`coordinator-task-dispatch.ts:16-27`).

**Coordinator loop.**
1. [author] `status`, then `run-create`, then N × `worker-start`.
2. `check --wait --types worker_done,escalation,question --timeout-ms 900000` (15 minutes).
3. Process every message: reply, validate each `worker_done` against the expected Dispatch, decide each settled terminal's next owner.
4. `check --ack <deliveryId> --wait …`, and repeat until every Dispatch settles (`skill-guides/orchestration.md:103-134`).

After three consecutive empty waits, enumerate with `worker-list --include-remote` and act on `nextAction` (`:136-148`). The coordinator must not end its turn while `worker-list --terminal-state reclaimable` returns rows (`:176-179`).

**Messaging.**
- [code] Message types: `status`, `dispatch`, `worker_done`, `merge_ready`, `escalation`, `handoff`, `decision_gate`, `question`, `heartbeat`. Priorities: `normal`, `high`, `urgent` (`create-core-tables-sql.ts:32-38`).
- [code] Of these, the legacy coordinator acts only on `worker_done`, `heartbeat`, `escalation`, `decision_gate` and `status`. `merge_ready` and `handoff` are no-ops (`coordinator.ts:174-196`).
- [author] Successful `send` proves durable enqueue. "Wake and nudge are best-effort attention only" (`messaging-and-gates.md:6-8`).
- [author] Workers are never interrupted and must poll at natural checkpoints (`preamble.ts:141-145`).
- [author] Workers must not "post to Slack, GitHub, or other channels during the run" (`preamble.ts:92`).

**Budgets.**
- [code] Task text: 1,214,464 bytes (§4, D10).
- [code] Readiness timeout: 60 s by default. Client grace: readiness plus 50 s (`orchestration-timing-budgets.ts:4-8`).
- [code] `ask` timeout in the preamble example: 600,000 ms.
- [code] Nothing tracks a token or cost budget per worker in the orchestration files read. Usage tracking exists separately for accounts [prior].

**Scheduling and parallelism limits.**
- [code] The retired in-process loop had `maxConcurrent = 4`, polled every 2 s, and created at most one terminal per tick (`coordinator.ts:35-36,251-252`).
- [inferred] The supervised loop has no Orca-side concurrency cap in the files read (`workers.ts`, `worker-start-budgets.ts`). The coordinator agent decides how many workers to start.
- [users] Machine resources are the practical limit: issue #29899 (17 Oct 2026) reports "RAM climbs steadily … not reclaimed", UI freezes and crashes with "3 or more parallel Claude Code / Codex / CLI agents". A maintainer could not reproduce it (19 Oct).
- [author] Hibernation exists because "idle agents add up — each one is a live PTY holding a model session in memory" (`agents/hibernation.mdx`).

## 7. Problems and challenges

**Failure modes Orca names.**
- [code] Worker states: `starting`, `ready`, `start_unknown`, `failed`, `succeeded`, `stopping`, `stop_unknown`, `stopped`, `abandoned` (`create-core-tables-sql.ts:147-151`).
- [code] Dispatch states: `pending`, `dispatched`, `completed`, `failed`, `circuit_broken` (`create-graph-tables-sql.ts:164-165`).
- [author] Refused starts have stable codes: `task_not_found`, `task_not_startable`, `inject_rejected`, `runtime_error`, `nested_worker_depth_exceeded` (`recovery-and-cleanup.md:98-108`).

**Crash recovery.**
- [code] A mutation found `pending` after a restart throws `operation_unknown`. For a worker start it names the Dispatch already accepted: "Inspect that Dispatch; do not start another worker." A terminal prompt "will not be sent again" (`orchestration-mutation-executor.ts:180-207`).
- [code] Completed receipts survive a failed post-commit notification (`:210-217`).
- [code] On open, the database reconciles settled worker dispatches (`orchestration-db.ts:38`).
- [author] Ambiguity is never resolved by guessing, and recovery commands must carry their exact next action (`skill-guides/orchestration.md:201-202`).

**Stuck or looping agents.**
- [author] "Leave the wait only on positive proof the agent stopped: `exited` liveness, the worker's own observation of process exit, or a transcript whose final agent turn sent no `worker_done`." (`recovery-and-cleanup.md:52-56`)
- [author] A depth refusal says "Complete this task yourself", because "a refusal alone leaves the worker looping on a capability it will never get" (`nested-worker-depth.ts:15-21`).
- [author] Workers idle after `worker_done` ("do NOT run a sleep/poll loop") (`preamble.ts`, `buildPostWorkerDoneInstructions`).
- [code] Nothing auto-kills a hung worker in the files read.

**Retries and receipts.**
- [author] Retry only a positively proven `failed` or `stopped` attempt, with `--retry-of` and explicit placement (`recovery-and-cleanup.md:110-118`).
- [code] A reused request id with different input gives `request_mismatch`, and an identical in-flight worker start is joined, not duplicated (`orchestration-mutation-executor.ts:68-111`).
- [author] `--wait-submit` observes an accepted prompt and "returns the input-accepted receipt without resending" (`recovery-and-cleanup.md:92-94`).

**Breaker.**
- [author] Three consecutive failed starts of one Task fail it. Routing around the breaker "with a new Run, Task, or unrelated Dispatch" is forbidden (`recovery-and-cleanup.md:120-125`).
- [code] In the legacy loop, an escalation from the exact owning worker fails the dispatch and counts towards the breaker. Under the threshold the Task "returns to 'pending' for re-dispatch next tick" (`coordinator-escalation-triage.ts:58-66`).
- [code] A stale base is a "silent-return, not failDispatch — failing a recoverable stale-base here would burn the circuit-breaker budget" (`coordinator-task-dispatch.ts:85`).

**What issue reporters say breaks** (titles quoted as summarised from the issue list pages, read 2026-10-26):

| Issue | State | Report |
|---|---|---|
| #33167 (24 Oct) | Open | A Codex worker hit `server_overloaded` about 4 minutes in. The Dispatch stayed in progress and "the coordinator didn't notice for roughly 40 minutes". After a PC crash, dispatches still showed in progress. The reporter runs an external watcher polling `worker-list` and `worker-read`, and asks Orca to "Distinguish **process liveness** from **agent turn state**". Assigned to a maintainer [users] |
| #33096 | Closed | Native coordinator is never woken for messages that arrive during its turn [users] |
| #33228 | Closed | Headless `orca serve` stores orchestration mail but never sends the idle pointer [users] |
| #32500 | Open | `check --terminal <other handle>` consumes another terminal's mail, so the recipient never sees it [users] |
| #33634 | Open | `dispatch-show --preamble` can name the inspecting worker as coordinator [users] |
| #29741 | Open | `worker-start` waits out the full readiness budget after the agent exits on a rejected `--model` [users] |
| #33244 | Open | `worker-stop` leaves a Hermes worker's turn and tools running in a shared gateway [users] |
| #33454 | Open | A phone-driven terminal blocks CLI sends but still accepts orchestration sends [users] |
| #32892 | Open | `worker-read` forward paging fails with `transcript_parse_failed` [users] |
| #30495 | Open | The orchestration guide hard-codes `--agent claude/codex`, with no step to probe installed CLIs [users] |
| #29899 | Open | Memory saturation and crashes with 3 or more concurrent agents on Windows [users] |

[inferred] The pattern: Orca's design deliberately refuses to infer failure from silence, and the most-reported operational pain is exactly that silence (an agent turn failed but the PTY lives). The open request #33167 asks for a turn-state signal that still avoids auto-stop and auto-retry.

## 8. Overlapping work and results

- **Overlap prevention is advisory.**
  - [author] Every Task spec must name Target, Change, Constraints, **Ownership** ("what this worker may edit and any coordination boundary") and Observable acceptance (`skill-guides/orchestration.md:154-162`).
  - [code] No file-lock, claim or ownership column exists in the ledger tables read (`create-core-tables-sql.ts`, `create-graph-tables-sql.ts`).
  - [inferred] Two workers in `--worktree current` can therefore edit the same file. Prevention rests on the coordinator writing disjoint specs, or on choosing `new-child` or `new-top-level` worktrees.
- **Worktree conflicts are moved, not removed.**
  - [users] "parallel agents remove collisions, not merge conflicts, and not your review burden" (vibecodinghub snippet).
  - [author] When a merge or rebase conflicts, Source Control offers **Resolve with AI** or Review conflicts, plus Abort merge or Abort rebase (`review/commit-push.mdx`, "Source control panel").
  - [users] Open gaps: #28022 "Cannot resolve delete/modify merge conflicts or complete merge through GUI"; #25346 finish a rebase or merge inside the app; #18487 "Show merge-conflict / behind-target state on the workspace card". #20543 (closed) reported that mobile "Resolve conflicts with AI" spawned duplicate worktree terminals.
- **Merge and review flow.**
  - [author] The per-feature lifecycle is Create, Work, Review (diff against start-from ref, Annotate AI Diff), Ship (commit, push, PR, checks), then Archive or delete (`model/worktrees.mdx:17-23`).
  - [author] The README's "compare the results and merge the winner" is done by the human with git and the PR host.
  - [code] No automatic merge step was found. `merge_ready` is a message type that the legacy loop ignores (`coordinator.ts:192-195`).
  - [author] "A review-only `worker_done` authorizes synthesis of findings, not coordinator file edits." (`coordinator-loop.md:60-65`)
- **Stale base.** [code] Dispatch is refused when the worktree is more than 20 commits behind its tracking base. A smaller drift is shown to the worker with the 5 most recent missing commit subjects (`coordinator-stale-base-flag.ts:3-4`; `preamble.ts`, `buildDriftSection`). The threshold of 20 was chosen to pass "normal monorepo day-velocity" while tripping "the 168-commit harm" recorded in an unpublished `ORCHESTRATOR_FEEDBACK.md` [author, comment].
- **Duplicate tasks and results.**
  - [code] Duplicate *starts* are prevented by receipts (C15).
  - [code] Duplicate or late *completions* are rejected: `inactive_dispatch`, `stale_dispatch`, `task_dispatch_mismatch`, `sender_not_assignee` (`lifecycle-reconciliation.ts:42-52`).
  - [author] A replaced worker learns it only through `consumer_fenced` and must then stop without sending `worker_done` (`worker-contract.md:49-54`).
  - [author] Duplicate *questions* are avoided by resuming the message id (`worker-contract.md:31-32`).
  - [code] Nothing de-duplicates the *same work* submitted as two different Tasks.
- **Reconciliation and who decides.**
  - [author] Exactly one `worker_done` with an explicit outcome. Failure in prose alone is forbidden (`worker-contract.md:66-68`).
  - [author] The coordinator agent synthesises and reports, per Task, "its outcome, the evidence behind it, and any unresolved blocker" (`skill-guides/orchestration.md:20-26`). Humans decide merges.
  - [users] #21984 (open, 21 Sep) says orchestration "treats opening a pull request as finishing the task". It proposes head-revision-keyed review states and notes "Mailbox ACK proves consumption only; it must not advance review or task progress".

## 9. Organisational management

**How a human organises many agents in Orca.**
- [author] The sidebar groups worktrees by project, with filters (sleeping, default-branch, automation-created, CLI-created, other-client, detached HEAD), pinning, multi-select bulk actions, parent and child nesting, and "Sleep/Delete with Descendants" (`model/worktrees.mdx:93-119`).
- [author] The Agent Dashboard, when its experimental flag is on, is a kanban of agents with columns **Needs You**, **Working**, **Done** and **Idle** (about 30 minutes, hidden by default). It has project, workspace and PR-status filters, and nested subagents appear as children (`model/agents-sessions.mdx:23-59`).
- [author] Notifications fire on the working-to-idle transition, with a header bell, a Dock badge and "mark unread" (`notifications.mdx`). The Agents feed is a threaded catch-up surface (`activity.mdx`). The mobile app can monitor and steer agents (`README.md`).
- [author] Task sources: GitHub, Linear, Jira and GitLab items can be linked to a workspace (`model/worktrees.mdx:67-77`).

**Priorities.**
- [code] Messages have a `priority` column (`normal`, `high`, `urgent`; `create-core-tables-sql.ts:37-38`).
- [code] Tasks have no priority column (`create-graph-tables-sql.ts:115-135`). Ordering comes from DAG dependencies and coordinator choice.

**Human in the loop.**
- [author] Workers' questions go to the coordinator through `ask`, never to a local TUI prompt (`preamble.ts:125-135`). Decision gates block a Task until resolved (C12).
- [code] Agents run with approval bypass by default at the pin, so the person is mostly out of the per-tool loop (D14). Oversight comes through the board, notifications and diff review.
- [inferred] I found no orchestration-specific board of Tasks and Dispatches in the docs read. The dashboard is per agent session. [users] #33357 asks for "inspectable workers".

**How the Orca project itself is run.**
- [code] CODEOWNERS names only two owners, for localisation and `cloud/` (`.github/CODEOWNERS`).
- [users] Maintainers seen replying in issues: AmethystLiang, brennanb2025, Jinwoo-H. Triage replies look like "looking into it" plus assignment (#29899, #33167).
- **Cadence.**
  - [author] "we ship daily, so this list is perpetually behind. The changelog is the real feature list." (`README.md`)
  - [code] Release notes show 7 releases from 20 to 26 Oct 2026 (v1.4.235 to v1.4.241).
  - [code] Issue and PR numbers rose from #31,139 (20 Oct) to #33,853 (26 Oct), about 450 a day in that week.
  - [inferred] At that rate most issues and PRs are probably written by agents. Many titles read like agent reports ("diagnosis + candidate patch", #33634). Not verified.
- **Agent-run development.**
  - [author] `AGENTS.md:63-69` tells agents to verify the aggregate `PR checks passed` job for the exact head before merging, never to use `--admin`, and to use `--match-head-commit`.
  - [author] The PR template requires "a brief code review summary from your AI coding agent" (`.github/CONTRIBUTING.md`, "Pull Requests"). Internal team members skip the AI-disclosure section (`.github/pull_request_template.md`, "AI Disclosure").
  - [prior] An AI review agent, `pullfrog`, runs in CI (RQS G9).
- **Contribution rules.**
  - [author] Outside contributors must link a real issue or the PR "**wiil** be ignored" (`.github/pull_request_template.md`).
  - [author] Releases are cut only through the "Cut Release" workflow, never locally (`.github/CONTRIBUTING.md`, "Release Process").
- **Roadmap.** [inferred] No public roadmap document was found. The issue tracker and release notes are the visible plan.

## 10. Documentation, notes and metadata

- **Ledger and receipts as records.**
  - [code] Per Task: spec, title, display name, deps, result (JSON), creator terminal, pane and process incarnation, and timestamps (`create-graph-tables-sql.ts:115-135`).
  - [code] Per Dispatch: assignee, creator, `retry_of_dispatch_id`, `creator_dispatch_id`, depth, failure count, last failure, `termination_reason`, heartbeat time and consumer generation (`:140-180`).
  - [code] Per worker start: stage, effects, residual resources, start options and last error (`create-core-tables-sql.ts:144-162`).
  - [code] An append-only `attempt_observation_facts` table records authority id and clock, facet, and source and receive times (`:124-139`).
  - [code] Receipts are kept until 30 days or 10,000 rows (C15).
- **Worker-written notes.**
  - [author] `worker_done --body` is "a 3-sentence executive summary (what you did, what you found, what's left)", read first by the coordinator, which "only opens artifacts if it needs more detail" (`preamble.ts:97-104`).
  - [author] Optional `--files-modified` and `--report-path` are given only with real values (`worker-contract.md:70-71`).
  - [inferred] I did not find `--files-modified` used for conflict detection in the reconciliation code read.
- **Logs and transcripts.**
  - [code] On release, output is archived as a transcript pin, terminal tail or structured journal (`create-core-tables-sql.ts:220-226`).
  - [author] Session History reads each CLI's own transcripts and offers resume, copy-id, copy-log-path and open-log (`agents/session-history.mdx`).
  - [prior] Redacted NDJSON traces rotate locally at 10 MB × 10 (RQS OPS-2).
- **Per-session metadata.**
  - [author] Dashboard cards show conversation name, last message preview, project, worktree, age and cached review state (`model/agents-sessions.mdx:50-57`).
  - [author] Hibernation keeps launch command, args and private env for resume (`agents/hibernation.mdx`).
- **Project documentation conventions.**
  - [author] Four `AGENTS.md` files [prior]. A user-facing docs site under `docs/site/content/docs/`. Agent skill guides under `skill-guides/` (with references), delivered lazily by `orca skills get` (`skill-guides/orchestration.md:183-199`).
  - [author] Rationale lives in "Why:" code comments under a one-line rule (`AGENTS.md:21-24`).
  - [author] Agent-screen rules must be written "against a captured transcript, not a remembered screen", using a capture script that scrubs account identifiers (`AGENTS.md:112-114`).
  - [code] Design docs cited by comments are not in the repository at the paths tried (D15).
  - [code] @main compresses many "Why:" comments.
  - [inferred] Knowledge of *why* is thinning in the code and was never published as design docs.
- **Docs that disagree with code.** [prior, RQS G1]
  - "the worktree itself is the sandbox" (`model/agents-sessions.mdx:63`) contradicts `agents/supported.mdx`.
  - "No API calls, no extra auth" contradicts the usage-endpoint calls.
  - Attribution gutter markers are documented (`review/attribution.mdx`), but no implementation was found.

## 11. Known problems and open questions

1. **Silent failed turns.** [users] #33167: process liveness without turn state leaves coordinators blind for tens of minutes. The request is open.
2. **Mailbox correctness under concurrency.** [users] #32500 (another terminal's mail consumed) and #33096 (coordinator not woken mid-turn, closed) show the hard parts are wake and consumption, not storage.
3. **Experimental status.** [author] Orchestration, the Agent Dashboard and hibernation are all behind Settings → Experimental. [author] Orchestration is used by "the small minority".
4. **Safety defaults.**
   - [code] At the pin: approval bypass and pre-written folder trust.
   - [code] @main: a permission choice exists.
   - **Unknown:** whether new installs on main default to `own` or to full access.
   - [prior] Setup scripts run by default, and the trust check is enforced only in the renderer (RQS G7).
5. **No overlap enforcement.** [inferred] Ownership is prose in the spec. No locks, no conflict check on `--files-modified`.
6. **The end of a task is "PR opened", not "merged".** [users] #21984.
7. **Resource growth with parallel agents.** [users] #29899, not reproduced by maintainers.
8. **Schema churn.** [code] 43 schema versions plus federation and legacy tables. [inferred] This is costly to copy, and the reason Assay took the pattern rather than the schema.
9. **Unpublished rationale.** [code] Design docs cited by comments are absent, and the comments are being shortened on main.
10. **Open questions.**
    - Whether the supervised loop uses the stale-base guard: only the legacy path was read.
    - Whether the legacy `Coordinator` is still reachable.
    - The actual concurrency anyone runs in practice: no public data.
    - Why stars rose from about 43k to about 106k in two months.
    - The Lovecast Inc. / Stably AI relationship.

## 12. Lessons for a successor (Assay)

Assay references: `apps/assay/src/orchestrator/orchestrator.ts`.

**Keep**
- **Attempt id separate from task id, with completion bound to the active attempt** (C14, D5). It turns late, stale and foreign completions into typed rejections instead of corrupted state. Assay already keys workers as kernel tasks with a caller id per MCP token (`orchestrator.ts:3-5`).
- **Receipts with three recovery answers** (completed, pending, absent) and "absent is not proof nothing happened" (C15, C16). Assay copied retry receipts (`orchestrator.ts:6-7`). Also copy the `request-show` query and the "pending after restart → operation_unknown, name the accepted attempt, do not restart" rule.
- **Never infer death from silence** (D7). Assay copied it (`orchestrator.ts:11-12`).
- **Machine-readable next action per worker** (C21: `nextAction` argv, attention categories). It lets the coordinating model recover without improvising.
- **Staged starts with residual resources** (C22). A failed start says what it left behind.
- **Stop never deletes work.** [code] Orca's `worker-stop` "never deletes the worktree" (`recovery-and-cleanup.md:134-135`). Orca's release archives output and closes only the owned terminal, and release is allowed only after an accepted settlement. Assay's single `assay_release_worker` tool stops the worker *and* removes its worktree. Its own description says "Stop a worker and remove its worktree (uncommitted changes in it are lost)" (`orchestrator.ts:755-761,909-910`). **Recommendation:** separate stop from worktree cleanup, as Orca does with stop, abandon, retain and release, and keep worktree deletion a separate, confirmed step.
- **Preamble rules placed beside the exact commands**, plus the "Complete this task yourself" depth refusal. Both are cheap and aimed at known model failure modes [author].
- **Stale-base refusal** (C25) for workers in worktrees, if Assay workers edit code.

**Avoid, or change before copying**
- **Breaker scope.** Orca breaks per Task and counts only failed *starts*; a worker's own `failed` report does not count. [code] Assay counts every worker task in the case whose state is `failed`, newest first, until it reaches a completed one, and refuses new spawns at 3 (`orchestrator.ts:554-562,610-611`). So three failing workers on *different* sub-tasks stop all spawning in the case, and a worker that legitimately reports failure counts the same as a crash [inferred from the code read]. Decide which semantics Assay wants, and say so in its docs.
- **Prompt budget.** Orca's 1.2 MB is a Windows paste-rate number (D10). Assay's 8,000 characters (`orchestrator.ts:35`) is a different, context-oriented choice. Do not cite Orca's derivation for it.
- **Silence-only liveness.** Add the turn-state signal users are asking Orca for (#33167): an agent turn that ended without a completion is positive evidence, distinct from process death. Report it to the coordinator without auto-retry.
- **Approval bypass by default and pre-written trust** (D14, C38): do not copy.
- **Advisory ownership only.** If workers share a workspace, add at least a check on files claimed or modified across live workers. Orca has none (§8).
- **Federation and legacy tables, and the terminal daemon** (C27, C36): pattern only.
- **"PR opened = done."** Model the end state explicitly (#21984).

**Unknown**
- Whether Orca's supervised loop works well in practice: there are no public first-hand reports.
- What concurrency Orca users actually run, and the per-worker resource cost.
- Whether Orca will change liveness semantics in response to #33167, which would affect what Assay copied.

## 13. Sources

All accessed 2026-10-26.

**Code and repository** (raw.githubusercontent.com at `997d34b0` unless marked @main `1d90fd51`):
- `README.md`, `AGENTS.md`, `.github/CONTRIBUTING.md`, `.github/CODEOWNERS`, `.github/pull_request_template.md`, `package.json` (pin and main)
- `skill-guides/orchestration.md` (pin and main); `skill-guides/orchestration/references/{coordinator-loop,recovery-and-cleanup,messaging-and-gates,worker-contract,placement-and-remote}.md`
- `docs/site/content/docs/cli/orchestration.mdx`, `model/{meta.json,worktrees.mdx,agents-sessions.mdx}`, `review/{commit-push,annotate-ai-diff,attribution}.mdx`, `notifications.mdx`, `activity.mdx`, `agents/{hibernation,session-history}.mdx`
- `src/main/runtime/orchestration/{coordinator,preamble,coordinator-stale-base-flag,coordinator-escalation-triage,coordinator-task-dispatch,lifecycle-reconciliation,mutation-receipt-capacity}.ts`
- `src/main/runtime/orchestration/db/{orchestration-db,dispatch-depth,contract-constants}.ts`, `…/db/schema/{create-tables,create-core-tables-sql,create-graph-tables-sql}.ts`, `…/db/dispatch-context/dispatch-circuit-breaker.ts`
- `src/main/runtime/rpc/orchestration-mutation-executor.ts`; `src/main/runtime/rpc/methods/orchestration/worker/{workers,deliver-worker-dispatch-preamble,worker-worktree-creation,worker-start-budgets}.ts`
- `src/shared/{nested-worker-depth,pty-liveness-verdict,orchestration-worker-start-prompt-budget,orchestration-timing-budgets,terminal-input,agent-prompt-injection,tui-agent}.ts`
- `src/shared/{tui-agent-launch-defaults,tui-agent-permission-choice}.ts` (@main); `src/main/agent-trust-presets.ts` (pin and main diff); `src/main/ipc/worktree-logic.ts`; `src/main/agent-hooks/README.md`
- Assay's vendored copy: `apps/assay/src/vendor/orca-process-host/README.md`, `process-spec.ts`
- Directory and summary pages (github.com via WebFetch):
  - https://github.com/stablyai/orca
  - https://github.com/stablyai/orca/commit/997d34b04389665795966ec4c0325b5cbfabf9ee
  - https://github.com/stablyai/orca/compare/997d34b04389665795966ec4c0325b5cbfabf9ee...main
  - https://github.com/stablyai/orca/releases
  - issue searches for `orchestration`, `worker stuck OR hang OR hung`, merge-conflict terms, top reactions, and oldest first
  - issues #29899, #33167 and #21984
- `git ls-remote https://github.com/stablyai/orca HEAD`

**Public** (search-engine snippets only; the pages themselves could not be fetched from this environment):
- Hacker News: https://news.ycombinator.com/item?id=47549197 (Show HN), https://news.ycombinator.com/item?id=49234357, https://news.ycombinator.com/item?id=49234738, https://news.ycombinator.com/item?id=49216491
- Product Hunt: https://www.producthunt.com/products/orca-5 and https://hunted.space/dashboard/orca-5
- YC: https://www.ycombinator.com/companies/stably-ai-orca/jobs (snippet)
- Comparisons and reviews: https://superset.sh/compare/orca-vs-conductor, https://agentsroom.dev/blog/best-multi-agent-coding-tools, https://www.morphllm.com/parallel-coding-agents, https://vibecodinghub.org/blog/orca-review, https://braindetox.kr/en/posts/orca_parallel_coding_agents_2026.html, https://agentconn.com/blog/orca-ade-agent-fleet-parallel-coding-agents-2026, https://explainx.ai/blog/orca-stablyai-open-source-agent-orchestrator-worktrees-mobile-guide-2026

**Searched with nothing useful found:**
- the hn.algolia.com API (blocked);
- Reddit (domain blocked for search);
- X/Twitter `@orca_build` (no relevant results);
- YouTube demos (none surfaced);
- a founders' "why we built Orca" post (none found).

**Prior internal notes:**
- `research/extraction/orca-t3code.md`
- `docs/merger/01-anatomy/donors.md`
- `research/rqs-review/reports/orca.md`
