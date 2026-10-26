# T3 Code

Profile 6 of 6 (rea, leanrea, pi-durable, absurd, Orca, T3 Code). Subject: `pingdotgg/t3code`.

**Role:** T3 Code is a donor. Assay (`apps/assay`) copied its delegated sign-in, per-account config homes, pairing and untrusted-content envelope.

**Labels:**
- **code shows**: read at commit `7e289ae1` (path:line).
- **author says**: the maintainers' own words, in the repo or in their posts.
- **users report**: GitHub issues or third-party posts.
- **inferred**: my reasoning, not a fact.
- **snippet**: the public source was seen only as a WebSearch result summary; the page itself could not be opened from this session.

Today is 2026-10-26.

## 1. Identity card

| Field | Value |
|---|---|
| Repo | https://github.com/pingdotgg/t3code (public) |
| Pinned commit | `7e289ae1f77b9137580688aaccf00d48906984ad`, 2026-10-20 18:58 UTC, by Julius Marminge, "test(web): pooled Limits segments narrower than 6px draw no pace mark… (#22453)" (**code shows**: commit object) |
| Default branch now | `main` at `1316d48b0c68`, 2026-10-26 09:10 UTC. That is **700 first-parent commits after the pin, in 6 days** |
| History | Root commit `f194c9661c` on 2026-02-08 ("Monorepo electron init"). 7,726 first-parent commits (7,800 commits in all) |
| Commits per month (first parent) | Feb 487, Mar 599, Apr 228, May 97, Jun 406, Jul 364, Aug 681, Sep 1,595, Oct (to the 26th) 3,269 |
| Licence | MIT, "Copyright (c) 2026 T3 Tools Inc." (`LICENSE:1-3`) |
| Company / people | T3 Tools Inc. AGENTS.md names "Theo, Julius and the people building T3 Code" as maintainers (`AGENTS.md:48`) |
| Authors (first parent, all time) | 728 distinct names. Julius Marminge 3,466 (45%), Theo Browne 917, maria 443, Yash Singh 122, t3-code[bot] 121 |
| Agent co-authors | Co-author trailers include "Claude Opus 5.5" ×1,449, "codex" ×568, "Claude Opus 5.5 (1M context)" ×424 and "Claude Fable 5" ×316 (**code shows**: commit messages) |
| Stack | TypeScript 7.0.2, Effect 4.0.5 (`pnpm-workspace.yaml:62`), Node ^24.13.1, pnpm 11.10.0, Vite+ (`vite: npm:@voidzero-dev/vite-plus-core@1.0.0`), React 19.3 |
| Clients and storage | Electron 44.4.5 desktop, Expo 58 / React Native 0.88 mobile, SQLite in WAL mode. `@anthropic-ai/claude-agent-sdk ^0.3.276`, `@cursor/sdk 1.0.35`, `@opencode-ai/sdk ^1.3.15` (`apps/server/package.json:34-41`) |
| Size | 28,433 files, of which 21,835 are vendored read-only references in `.repos/` (alchemy-effect 19,245; effect-smol 2,590) |
| Own code | 6,598 files: 5,629 TS/TSX, 1,922 test files, 1,249 server `.ts`, 103 migration files, 24 packages. Lines of code were not counted (the blobs were too large to stream) |
| Largest files | `Orchestrator.ts` 12,143 lines; `ClaudeAdapterV2.ts` 10,417; `CodexAdapterV2.ts` 7,528; `GitVcsDriverCore.ts` 4,521; `ProviderSessionManager.ts` 2,524 |
| Releases | 752 tags. 44 stable, `v0.0.2` → `v0.1.2`, and nightlies up to `v0.1.3-nightly.20261026.3717` (**code shows**: ls-refs) |
| Stars and forks | about 19.8k stars on 2026-08-21 (star-history, **snippet**). 3,043 forks, undated (ossinsight, **snippet**). On GitHub Trending around 2026-10-04 to 10-06 (aitoolly, **snippet**). Not checked against GitHub: API access was refused |
| Users | "over 500,000 users" (**author says**, `AGENTS.md:9`; unverified) |

## 2. Purpose and origin

- **author says:** "T3 Code is an 'agent harness control surface'" that controls the agents on your machine from mobile, web and desktop. It "works with your subscriptions on Claude Code, Codex, Cursor, Grok Build, OpenCode, and Google Antigravity" (`README.md:3-5`).
- **author says:** "Nothing. We built T3 Code because we wanted the best possible development experience with agents. We were inspired by existing solutions like the Codex desktop app, Conductor, Claude Desktop and Cursor Glass, but none met our bar." The goal is "performant, remote-ready, and truly open", so users can fork it if the project goes wrong (`README.md:9-11`).
- **author says:** it is an "open source 'bring-your-own-subscription' alternative to apps like Claude Desktop, Codex App, Cursor Glass and Conductor" (`AGENTS.md:5`).
- **author says:** four things are non-negotiable (`AGENTS.md:11-31`):
  1. open at the core;
  2. performance;
  3. remote-ready;
  4. multi-surface (web, desktop, mobile).
- **author says:** Theo's design note: "Do not preserve complexity just because it already exists. Do not introduce machinery because it looks architecturally impressive… fight for the smallest model that makes the correct behavior unsurprising" (`AGENTS.md:35-37`).
- **author says:** the public launch was on X, 2026-03-07 03:40 UTC: "T3 Code is here. I shot a short video about why we built it" (x.com/theo/status/2030126522577879327, **snippet**). On 2026-04-16 Theo wrote: "T3 Code exists because we were unhappy as a team… so tired of feeling the tools I rely on slowly eroding under me. That's why we open sourced it" (x.com/theo/status/2044710197114097922, **snippet**).
- **users report (secondhand):** a podcast summary says Theo was unhappy with the Codex app's performance on macOS. He tried a native SwiftUI/AppKit client first, then rebuilt on Electron with everything over a websocket for remote control (finance.biggo.com podcast summary, **snippet**). The video itself was not seen.

## 3. Public reception

Sample and method:
- About 20 WebSearch queries, all read as result summaries only.
- Direct fetches were refused for HN, Reddit, X, YouTube, t3.codes and the blogs.
- No Hacker News thread about T3 Code was found. The only HN hit was an unrelated 2013 item. HN's API could not be queried.
- No Reddit threads appeared in any result.

| Source (date) | What it says |
|---|---|
| x.com/theo/status/2030072127605592547 (2026-03-07 00:04 UTC, **snippet**) | Theo on the Claude Agent SDK: "We have a PR with the changes ready. We just don't know if we're allowed to ship it", waiting for a 👍 from named Anthropic staff |
| theregister.com, 2026-02-20 (**snippet**) | Anthropic clarifies its ban on third-party tools using Claude subscription OAuth. Its terms say subscription OAuth tokens are for Claude Code and Claude.ai |
| x.com/theo/status/2054613327696056660 (2026-05-13, **snippet**) | "Good news: T3 Code is officially supported by Claude now. Bad news: it bills API credits" |
| "I'm done." video summaries (rosetta.to, iamtypist.dev, **snippet**) | Theo says routing Agent SDK use into a monthly credit cuts T3 Code users' effective subscription use "25 to 40 times", and that he is switching to Codex |
| github.com/pingdotgg/t3code/issues/2680 (**snippet**, undated) | "Do we lose access to the subscription usage with this Anthropic policy change in T3 Code?" |
| x.com/theo/status/2066669344483143701 (2026-06-15, **snippet**) | "T3 Code users can continue using Claude Code with their subscriptions :)". Reported as following Anthropic pausing the change; no Anthropic source was found |
| aicoder.com, 2026-09-08 (**snippet**) | OpenAI's Codex lead said third-party clients using Sign in with ChatGPT for Codex were not an approved use, except pure open-source clients and partners |
| x.com/t3dotcodes/status/2105014171012313129 (2026-09-29, **snippet**) | T3 Code is a launch partner of "Sign in with ChatGPT", which supports several accounts. OpenAI's docs list T3 among the open-source integrations (learn.chatgpt.com, **snippet**) |
| digg.com X digest (undated, **snippet**) | 27 visible X reactions from 123 accounts. Praise for the sidebar and workflow; criticism of self-promotion ("this constant glazing is kinda annoying"). Requests: scheduled-task visibility, a simulator, better sub-agent visibility |
| hunted.space (**snippet**) | Product Hunt: 4 upvotes, 1 comment, #105 that day |
| notes.nicolasdeville.com, betterstack.com, flaviocopes.com (**snippet**) | Explainers. "Very very early. Expect bugs." Outside contributions mostly not accepted |

**Summary:**
- Public discussion is mostly Theo's own posts, explainers, aggregators and GitHub issues. No independent hands-on review was found.
- The one recurring controversy is whether a subscription may be used through a third-party client. That was settled per provider by policy (Anthropic: Agent SDK billing, changed and then paused; OpenAI: a formal partner program), not by T3's code.
- The sample is too small and too self-selected to estimate satisfaction.

## 4. Architecture and mechanics

**D1. Server owns execution; clients are thin.**
- **What:** one Node server per environment owns the provider processes, terminals, Git and files. Web, desktop and mobile clients talk to it over authenticated WebSocket RPC (`docs/internals/overview.md:3-6,10-19`).
- **Why (author says):** "A remote client must never substitute its own filesystem, provider credentials, or machine state for the environment's" (`overview.md:4-5`). Remote use is a core value (`AGENTS.md:19-21`).
- **Trade-off:** every feature has to work in local, remote/relay and tunnel modes. "Hit every surface" lists this as the most common defect (`AGENTS.md:65-76`).

**D2. Event sourcing with a transactional outbox (Orchestration V2).**
- **What:** commands are serialized, and the orchestrator decides events "without performing provider or filesystem work". One SQLite transaction commits:
  - the events;
  - the persisted projections;
  - the command receipt;
  - the outbox effects.

  An effect worker then performs the I/O and feeds results back as commands (`overview.md:53-67`; `AGENTS.md:154`).
- **code shows:**
  - The commit-then-publish lane is a semaphore, so subscribers see events in sequence order (`apps/server/src/orchestration-v2/EventSink.ts:249-276`).
  - The outbox has 14 effect types (`EffectOutbox.ts:31-120`).
  - The worker uses a 30 s lease and 5 attempts, with backoff `min(30 s, 100 ms × 2^(n-1))` (`EffectWorker.ts:595-596,784`).
- **Why (author says):**
  - "keeps command retries idempotent and prevents a persisted projection from getting ahead of the event log" (`overview.md:59-61`);
  - a command ack "means the intent committed, not that the provider… finished" (`overview.md:64-66`).
- **Trade-off (author says):** "Persisted events must remain decodable on replay." A schema change can break startup for old environments (`overview.md:69-71`). One example: file attachments can make an image-only server "fail the entire environment's startup" when it replays such an event (`docs/internals/providers.md:141-144`).

**D3. Effects are classed by whether they survive process loss.**
- **What:**
  - **Replay-safe** (requeued after a crash): `checkpoint.capture`, `provider-thread.rollback`, the cleanups, title generation, `delegated-tasks.stop` and others.
  - **Process-bound** (cancelled after a crash, with `last_error` "Cancelled because the server process ended before the effect completed."): `provider-turn.start`, `interrupt`, `steer`, `restart`, `runtime-request.respond` (`EffectOutbox.ts:123-142,496-523`).
- **Why (author says):** "Effects tied to a lost provider process cannot simply replay; recovery retires them before admitting new work" (`overview.md:67`).
- **Trade-off (inferred):** a crash mid-turn never re-sends a prompt blindly. Continuation is a separate, guarded policy (D9).

**D4. Effects run one at a time per thread.**
- **What:** a pending effect cannot be claimed while an earlier effect on the same thread is running or pending (`EffectOutbox.ts:320-348`).
- **Why (code comment):** "a turn cannot start while a failed rollback is about to restore files" (`EffectOutbox.ts:320-321`).
- **Trade-off:** there is no parallelism inside a thread. Parallel work means more threads.

**D5. App ids are primary; provider ids are only references.**
- **What:** the graph is `AppThread → Run → RunAttempt → ExecutionNode tree`, plus `ProviderThread`, `ProviderSession`, `ContextTransfer`, `ContextHandoff` and `CheckpointScope`. "Only the root node can complete the run" (`docs/orchestration-v2/core-graph-and-data-model.md:5-25,287`; `README.md:33-42`).
- **Why (author says):** from Codex app-server probes:
  - "Subagent child `turn/completed` events can occur before the parent/root turn completes";
  - `turn/interrupt` completes as a request before the terminal event arrives (`docs/orchestration-v2/README.md:85-94`).
- **Trade-off:** a 12,143-line orchestrator and 10k-line adapters. The V2 docs call themselves "target architecture… intentionally ignores migration" (`README.md:3`), so some described features may lag the code (inferred).

**D6. Delegate to official clients instead of using API keys.**
- **What:**
  - Codex: `codex app-server` with `CODEX_HOME` and `account/read` (`apps/server/src/provider/CodexProvider.ts:485,506,534-535`).
  - Claude: the Agent SDK's `initializationResult()`, reading `email` and `subscriptionType` without starting a conversation (`ClaudeProvider.ts:365,379,402-413`).
  - Cursor through `@cursor/sdk`.
  - OpenCode, Grok and Pi through their own CLIs or SDKs.
  - Any ACP agent through the ACP Registry.
- **Why (author says):** "bring-your-own-subscription" (`AGENTS.md:5`). Setup must not happen as a side effect of a health check, because "opening a provider session can start MCP servers, run hooks, or launch a login browser" (`providers.md:52-57`).
- **Trade-off:**
  - T3 inherits every provider's protocol drift and policy changes (section 7);
  - it carries one adapter per provider;
  - whether the provider allows this is a per-provider policy question (section 3).

**D7. Provider instances: one per account or configuration.**
- **What:** "Route work by instance, so two accounts using the same driver do not share mutable session or catalog state" (`providers.md:8-10`). Each provider isolates accounts its own way:
  - Claude uses `CLAUDE_CONFIG_DIR` and keeps `HOME`, so the macOS keychain lookup still works (`Drivers/ClaudeHome.ts:40-45`).
  - Codex uses a "shadow home": shared `sessions`, `skills`, `worktrees` and so on, with `auth.json` and `models_cache.json` private (`Drivers/CodexHomeLayout.ts:11-31`).
  - Antigravity forces file-based credentials per profile and strips ambient Google credentials (`providers.md:39-45`).
- **Trade-off:** the Codex shadow home lets "work and personal accounts continue the same threads" (`docs/user/providers-codex.md:36-38`). A thread can move between accounts. See the guardrail notes in section 12.

**D8. Effect-TS everywhere on the server.**
- **What:**
  - services are `Effect.fn("Service.operation")` with stable span names (`AGENTS.md:173-178`);
  - time comes from `DateTime`/`Clock` and randomness from `effect/Random`, so tests are deterministic (`docs/orchestration-v2/testing-strategy.md:52-60`).
- **Why (author says):** tracing spans and deterministic tests (same lines).
- **Trade-off:**
  - a steep learning curve: contributors are told to read `.repos/effect-smol/LLMS.md` (`AGENTS.md:160`);
  - after the pin, about 60 `chore(lint)` commits enforce Effect idioms (**code shows**: commit log).

**D9. Restart continuation with a crash-loop guard.**
- **What:** after a server restart, a run cut off mid-turn is continued with "Continue where you left off." (`RestartContinuation.ts:31`).
  - It is blocked if the thread is archived, deleted, settled or snoozed, or has a pending approval or secret request (`:36-82`).
  - At most 3 continuations in a row within 5 minutes (`:33-34,230-243`), because "A turn that keeps crashing the server would otherwise restart it forever".
- **Trade-off (inferred):** the agent may redo work, or see a half-applied state. The checkpoint of the cut turn is the safety net.

**D10. Checkpoints as hidden Git refs.**
- **What:**
  - Refs are named `refs/t3/checkpoints/<base64url threadId>/turn/<n>` (`apps/server/src/checkpointing/Utils.ts:4-9`).
  - Capture uses a temporary `GIT_INDEX_FILE` in the git common dir, with author "T3 Code", and guards split-index and sparse checkouts (`apps/server/src/vcs/GitVcsDriver.ts:830-900`).
- **Why (author says):** "capture workspace state without adding commits to the user's branch" (`overview.md:82-84`).
- **Trade-off:** a checkpoint covers the whole checkout, so a restore in a shared checkout could clobber other threads. The code refuses that (D11, section 8).

**D11. Approvals: four modes, with full access as the initial default.**
- **What:** Supervised, Auto-accept edits, Auto, Full access (`docs/user/permission-modes.md:11-16`).
  - `DEFAULT_RUNTIME_MODE = "full-access"` (`packages/contracts/src/providerPolicy.ts:32`).
  - "The initial default is **Full access**" (`permission-modes.md:8`).
- **Why:** not stated. Inferred: it matches what agent power users choose.
- **Trade-off:** it conflicts with Assay's "approvals on at start".

## 5. Complete capability inventory (at `7e289ae1`)

Paths are under `apps/server/src/` unless they start with `docs/`, `packages/` or `.github/`.

| ID | Capability | How implemented | Limits | To reproduce elsewhere |
|---|---|---|---|---|
| T3-C01 | Event-sourced orchestration | `orchestration-v2/Orchestrator.ts` (12,143 lines), `EventSink.ts:249-276`, `EventStore.ts` | One SQLite file per environment. Persisted events must stay decodable forever | Append-only log plus projections in the same transaction. Absurd and pi-durable already fill this role in the core |
| T3-C02 | Idempotent commands (receipts) | `CommandReceiptStore.ts:40-51`. MCP `clientRequestId` derives command, thread and message ids (`docs/orchestration-v2/orchestrator-mcp-server.md:502-505`) | Calls without a key create new work. `t3_thread_launch` has no retry key (`…mcp-server.md:359-360`) | A receipt row keyed by command id that returns the result sequence |
| T3-C03 | Durable effect outbox and worker | `EffectOutbox.ts:31-142`, `EffectWorker.ts:595-596,784` | 30 s lease, 5 attempts, backoff capped at 30 s. Settled rows kept for 7 days (`EffectOutbox.ts:153-159`) | Outbox table with lease owner and expiry, `attempt_count`, `available_at` |
| T3-C04 | Reconciliation after process loss | `EffectOutbox.ts:123-142,496-523` | Process-bound effects are cancelled, never retried | Split effect types into replay-safe and process-bound |
| T3-C05 | Per-thread effect ordering | `EffectOutbox.ts:320-348` | No intra-thread parallelism | `NOT EXISTS` over earlier pending or running rows for the same thread |
| T3-C06 | Snapshot plus cursor streaming | `docs/orchestration-v2/core-graph-and-data-model.md:31-38`. `LiveStreamBudget.ts:18-19` caps at 1,000 items and 8 MiB | Reconnect may reset to a fresh snapshot | Monotonic store sequence; a client applies only seq > snapshot |
| T3-C07 | Execution graph (runs, attempts, nodes) | `core-graph-and-data-model.md:40-137,179-287`. Contracts in `packages/contracts/src/orchestrationV2.ts` (3,654 lines) | Complex | Keep "run ≠ provider turn" and "only the root completes the run" |
| T3-C08 | Steer, queue or restart follow-ups | `docs/orchestration-v2/feature-lifecycles.md:61-116`. MCP `t3_thread_send` modes auto, queue, steer, restart (`…mcp-server.md:411-424`) | Steering needs provider support, otherwise interrupt-and-restart | `MessageDispatchMode` union |
| T3-C09 | Queue order with priority for delegated results | `QueuedRunOrder.ts:12-31` | Automatic completion messages jump the queue | Sort queued runs by priority, then position |
| T3-C10 | Provider adapters with capability flags | `orchestration-v2/Adapters/ClaudeAdapterV2.ts:389-395`, `CodexAdapterV2.ts:295-301`. Others in `packages/provider-*` | One adapter per provider. "Provider-shaped features need a decision per adapter" (`AGENTS.md:71`) | Declare capabilities and degrade by policy, not by provider name |
| T3-C11 | Delegated sign-in status: Codex | `provider/CodexProvider.ts:485,506,534-535` | `account/read` is called with `{}`. Whether Codex refreshes the token on that call: unknown | Ask the official client and map "requires auth" to a sign-in step |
| T3-C12 | Delegated sign-in status: Claude | `provider/ClaudeProvider.ts:365,379,402-413` | Users report wrong status in both directions (#14186, #13635) | SDK initialization only, no conversation |
| T3-C13 | ACP agent authentication | `packages/provider-acp/src/server/AcpSessionRuntime.ts:1085-1094` (prior notes; not re-read here) | Terminal-only logins stay manual (`…mcp-server.md:136-137`) | Use the agent's own advertised auth method |
| T3-C14 | Managed "Sign in with ChatGPT" | `provider/CodexChatGptAuth.ts:34-36,405-411`, `CodexManagedRuntime.ts:19-29` (`model_provider="openai_token_sharing"`, token in `ACCESS_TOKEN`). Remote handoff in `docs/internals/providers.md:65-70` | T3 holds and renews OAuth tokens. After the pin: "keep managed Codex token renewal in the server" (#21786) and "renew active managed Codex turns through native auth" (#21787) | Only with your own partner registration. Breaks Assay's guardrail (section 12) |
| T3-C15 | Per-account homes | `provider/Drivers/ClaudeHome.ts:40-45`, `Drivers/CodexHomeLayout.ts:11-31`, `provider/antigravityAuthSupport.ts` | A Claude thread can move only between instances with the same config dir (`docs/user/providers-claude.md:32-35`) | Documented home variables; the official login runs into that home |
| T3-C16 | Routing by provider instance | `docs/internals/providers.md:8-10`, `provider/ProviderInstanceRegistry*.ts` | | Key sessions by instance id, not driver |
| T3-C17 | Probes without side effects | `providers.md:52-57`, `packages/provider-grok/src/server/status.ts` | | Status checks must never open sessions or logins |
| T3-C18 | Provider install and update by the owning installer | `provider/providerMaintenance*.ts`; `providers.md:81-102` | Mise and some Homebrew installs stay manual | Prove ownership from the real path before running a package manager |
| T3-C19 | Orchestrator MCP server: 11 tools | `mcp/OrchestratorMcpService.ts`, `mcp/toolkits/orchestrator/`; spec in `…mcp-server.md:195-438` | `create_threads` makes 1 to 20 threads (`:322`) | MCP endpoint on loopback with per-session bearer tokens |
| T3-C20 | MCP credential per provider session | `mcp/McpSessionRegistry.ts`; `…mcp-server.md:40-55` | Max lifetime and idle expiry; revoked on release; never persisted | Mint before session open, revoke on close |
| T3-C21 | Delegated tasks (app-owned sub-agents) | `delegated_task.request` in `Orchestrator.ts`; `…mcp-server.md:210-297,440-485` | The child receives only the task prompt. No task-level follow-up (`:247-253`) | Child thread plus lineage plus spawn/result `ContextTransfer` |
| T3-C22 | Privilege ceiling for children and cross-thread calls | `orchestration-v2/DispatchModeLimit.ts:15-45`; `…mcp-server.md:487-498` | Ranks: approval-required < auto-accept-edits < auto < full-access; plan < default | Re-check inside the target thread's command lock |
| T3-C23 | Child questions routed to the parent | `orchestration-v2/DelegatedTaskQuestionReactor.ts`; `…mcp-server.md:471-482` | Approvals are not routed (`:476-477`) | Notify the parent when a child opens a `user_input` request |
| T3-C24 | Stop cascades | `feature-lifecycles.md:254-260`; `delegated-tasks.stop` effect | Depth first, after commit | Stop effect per child |
| T3-C25 | Hidden-ref checkpoints | `checkpointing/Utils.ts:4-9`, `vcs/GitVcsDriver.ts:830-900` | Git only; whole checkout | Temporary index, write-tree/commit-tree to a private ref namespace |
| T3-C26 | Turn diffs limited to authored paths | `checkpointing/CheckpointStore.ts:66-72`; `docs/user/source-control.md:8-11` | Pulled-in files are excluded from the turn's changes | Compare HEAD movement between checkpoints |
| T3-C27 | Rollback with provider reconciliation | `CheckpointRollbackService.ts:23,365` (workspace lease); `feature-lifecycles.md:401-425` | Providers that cannot roll back the conversation reject revert before touching files (`providers.md:128-131`) | Restore files, then provider rollback, then mark later runs `rolled_back` |
| T3-C28 | Restore needs an isolated worktree | `CheckpointRestoreSafety.ts:9-13,26-96` | Shared checkouts can only rewind the conversation | Refuse a file restore when another thread's cwd overlaps |
| T3-C29 | Worktree launch strategies | MCP `t3_thread_launch` `root` / `worktree` / `existing_worktree` (`…mcp-server.md:346-360`); `worktreesDirectory.ts:52-54`; `t3.json` `runOnWorktreeCreate` | Default env mode inherits `t3.json`, then `"local"` (`packages/contracts/src/settings.ts:1198`) | Bind the thread to its workspace before the agent starts |
| T3-C30 | Same prompt to several models | `docs/user/thread-sidebar.md:41-44` | Needs a Git project; one thread and one worktree per model | Fan out at thread creation |
| T3-C31 | Thread inbox lifecycle: pin, settle, snooze, archive, Working section | `ThreadSettlementService.ts` (647 lines); `thread-sidebar.md:46-170,231-238` | Auto-settle after 3 days idle, or when the PR merged (`:149-151`) | Server-owned settlement; clients render the persisted state |
| T3-C32 | Usage-limit recovery | `UsageLimitRecoveryWorker.ts:11-124`; settings default false (`settings.ts:1164-1165`) | Needs a provider reset time. Fires once (users report #22026, #22619) | Arm at the reported reset, then continue on the same account |
| T3-C33 | Restart continuation | `RestartContinuation.ts:31-34,36-82,230-243` | At most 3 in 5 minutes | As shown |
| T3-C34 | Idle release of provider sessions | `ProviderSessionManager.ts:56-58` (30 min idle, 4 h max pin) | | Reaper through the production lifecycle API |
| T3-C35 | Idle compaction (beta, Claude) | `IdleCompactionService.ts:20-24,64-75` | Timers live in memory and are lost on restart | Send `/compact` before the prompt cache expires |
| T3-C36 | Portable context handoff | `ContextHandoffService.ts`; `docs/user/portable-handoffs.md:6-31` | Default 16,000-token cap, clamped 1,024 to 64,000. Counts 1 token per UTF-8 byte | A budgeted selection with retrieval references, not a summary |
| T3-C37 | Forks and merge-back | `ThreadForkService.ts`; `feature-lifecycles.md:181-222`; replay fixtures `thread_fork_native*`, `thread_merge_back_*` | Merge-back moves context, not code | Lazy resolution: native fork, else portable context |
| T3-C38 | Durable approvals and questions | `RuntimeRequestService.ts`; `core-graph-and-data-model.md:460-485`; `providers.md:106-118` | Respondable only while the provider callback is live | Requests are rows with a `responseCapability` |
| T3-C39 | Pull request link, sync and watch | `PullRequestSyncReactor.ts`, `PullRequestWatchReactor.ts`; `source-control.md:262-299` | 2-minute poll. Stops after 10 comment-only wakes or 8 failed reads | Server-side watcher that wakes the agent |
| T3-C40 | Usage ledger from local transcripts | `usage/UsageService.ts` (`:340-352` per prior notes), `usage/usagePricing.ts`; `docs/user/usage.md:9-39` | API-equivalent estimates, "not your subscription bill" (`usage.md:11`) | Scan each account home and de-duplicate by real path |
| T3-C41 | Pooled limits view | `usage.md:79-103`; Codex `account/rateLimits/updated` (`provider/codexUsageLimits.ts:161-166`); Claude SDK `get_usage` (`provider/claudeUsageLimits.ts:1`) | Clients re-check at most every 5 minutes (`usage.md:105-106`) | Official channels only |
| T3-C42 | Reset credits and CLIProxyAPI hub | `provider/claudeResetCredits.ts:14,144-145,161,228`; `usage/cliproxyApi.ts:138,209-217,266,400`; `usage.md:132-142` | Private endpoints. Claude resets unavailable on macOS (`usage.md:92-93`) | Do not reproduce (section 12) |
| T3-C43 | Antigravity limits | `provider/antigravityUsageLimits.ts:18-28,206-224` | Reads the agent's token file and refreshes it with Google itself | Do not reproduce |
| T3-C44 | SecretRef | `secrets/SecretRequests.ts:1-6,214-218` | Single use | One-use reference to the secret store |
| T3-C45 | Server secret store | `auth/ServerSecretStore.ts:200-205` | Plain files, mode 0600 | Use the OS keychain instead |
| T3-C46 | Pairing, sessions, WebSocket tickets, DPoP | `auth/PairingGrantStore.ts:249` (5 min), `auth/SessionStore.ts:424-426` (30 days; tickets 5 min), `auth/dpop.ts` | 30-day sessions | Adapt with shorter sessions |
| T3-C47 | MCP OAuth for outside agents | `auth/McpOAuth.ts:48-49` (60 s code); `docs/user/outside-agents.md:29-37` | Approving a hosted agent gives its operator the access (`:36-37`) | Code flow with PKCE S256 |
| T3-C48 | Untrusted webhook envelope | `scheduledTasks/webhookTemplate.ts:1-8,160-166` | | Random tag per request plus an "untrusted data" note |
| T3-C49 | Scheduled tasks and webhooks | `scheduledTasks/ScheduledTaskService.ts`, `Schedule.ts`, `webhookVerification.ts` | | |
| T3-C50 | Raw provider diagnostics | `provider/EventNdjsonLogger.ts`; `providers.md:146-159` | 64 KiB per payload; rotating files, not SQLite | Bounded, redacted NDJSON |
| T3-C51 | Replay test kit | `packages/provider-testing/src/replayTranscript.ts`, `replayGate.ts`; 91 scenarios, 149 `.ndjson` under `orchestration-v2/testkit/fixtures/` | | Record real frames and replay at the transport boundary |
| T3-C52 | Product telemetry | `telemetry/AnalyticsService.ts:81` (default true); `docs/user/telemetry.md:3-19` | On by default. Sends hashed OpenAI and Claude account ids | Off by default, or a first-run choice |
| T3-C53 | Remote access: T3 Connect relay, Tailscale, SSH | `relay/`, `cloud/`, `packages/ssh`, `packages/tailscale`; `AGENTS.md:19-21` | Push notifications need T3 Connect (`docs/user/mobile-notifications.md:11`) | |
| T3-C54 | Mobile push and live activity | `docs/user/mobile-notifications.md:3-11` | Alerts on finished, failed, needs approval, asks for input | |
| T3-C55 | Thread search and `t3-thread://` links | `ThreadSearch.ts`; `…mcp-server.md:385-390` | | |
| T3-C56 | V1 → V2 migration | `orchestration-v2/legacy/`; `docs/user/thread-migration.md:3-25` | Old checkpoints, diffs and tool activity are not converted | Copy-then-migrate, keeping the original |
| T3-C57 | Self-triage (`t3 triage` with an agent playbook) | `.github/triage/PLAYBOOK.md:3-60` | | Give a coding agent machine facts plus a playbook |
| T3-C58 | SQLite tuning | `persistence/Sqlite.ts:12-38`: WAL, `synchronous=NORMAL`, `busy_timeout=5000`, 32 MiB journal limit | NORMAL can lose the last commits on power loss (inferred) | Comment explains the choice: every provider event is a commit |

Total: **58 capabilities**.

## 6. Workloads and sub-agents

**Unit of work.**
- **author says:** a *thread* is "the durable conversation and work history for a project. It survives provider process exits". A *turn* is "one user-to-agent cycle, a V2 run" (`docs/internals/glossary.md:15-16`).
- **author says:** a *session* is "the provider runtime attached to a thread… can be stopped and resumed without deleting the thread" (`glossary.md:40`).
- A run has statuses queued, starting, running, waiting, completed, interrupted, failed, cancelled and rolled_back (`core-graph-and-data-model.md:191-200`).
- The sidebar status is either "idle" or a run status (`packages/contracts/src/orchestrationV2.ts:1781-1784`).

**Concurrent agents.**
- Parallelism is many threads. I found no global cap on concurrent threads or sessions in the files read; this is absence of evidence, not proof.
- Inside a thread, effects are serialized (`EffectOutbox.ts:320-348`).
- One Codex app-server can serve several threads: "A session shared by several threads (one Codex app server)…" (`ProviderRuntimeRecoveryService.ts:178-182`).
- Idle sessions are released after 30 minutes (`ProviderSessionManager.ts:56`).
- Background submissions (Cmd/Ctrl+Enter) and multi-model fan-out start several threads, each in its own worktree if chosen (`thread-sidebar.md:34-44`).

**Long turns.**
- "A provider turn ending and its follow-up work settling are separate milestones." A late checkpoint must not extend the recorded duration (`overview.md:75-80`).
- Codex `/goal` runs can contain several native turns in one app run (`providers.md:120-126`).
- The orchestrator records turns while no client is connected. Settlement and PR watches run server-side (`overview.md:87-96`).
- Each client tracks an 8 MiB / 1,000-item live budget (`LiveStreamBudget.ts:18-19`).
- After the pin: "long agent turns no longer load whole when a thread opens" (#24589); "background compactions no longer flip threads to Working" (#25122).

**Sub-agents exist in two forms.**

1. **Provider-native sub-agents** are mirrored into the graph as nested `ExecutionNode`s and `ProviderThread`s. Child completion never closes the parent run (`README.md:36`). Capabilities differ by provider:
   - Codex: thread ids exposed, wait, close and fork all supported (`CodexAdapterV2.ts:295-301`).
   - Claude: emits lifecycle, but no thread ids and no wait or close (`ClaudeAdapterV2.ts:389-395`).
   - After a server restart, open native sub-agents are closed out, because "No provider process outlives the server" (`ProviderRuntimeRecoveryService.ts:529-544`).
2. **App-owned delegated tasks** through T3's MCP tools (`delegate_task`, `task_status`, `task_cancel`, `create_threads`, `t3_thread_*`; 11 tools, `…mcp-server.md:195`).
   - **How:** the child is a real T3 thread with lineage `subagent`, created by the command `delegated_task.request`. The parent gets a sub-agent turn item; finalization is idempotent through the `subagent_result` transfer (`:440-469`).
   - **Why (author says):** these are "T3 orchestration operations, not provider-native sub-agent APIs", so any provider can delegate to any other (`:17-20,182-191`). ACP has "no native subagents", so Grok and registry agents get child threads instead (`:111-115`).
   - **Context isolation:** "The child receives only the supplied task prompt… Parent conversation history is not copied" (`:18-20`).
   - **Waiting:** `mode: "wait"` returns on completion, timeout (`waitTimedOut`), a pending question, or a pending approval. A timeout does not cancel the child (`:259-270`).
   - **Privilege:** a child may not get a broader runtime or interaction mode than its parent (`:487-492`; `DispatchModeLimit.ts:29-45`).
   - **Questions:** child questions wake the parent, because "Users rarely watch child threads" (`:471-482`). Approvals are not routed.
   - **For users:** sub-agent threads cannot take messages; the parent asks for the child's approvals (`thread-sidebar.md:219-224`). Stop on a parent stops its delegated tasks depth first (`feature-lifecycles.md:254-260`).
   - **Review loops:** each round is a new `delegate_task` with its own `clientRequestId`; there is no follow-up API on the same reviewer (`…mcp-server.md:247-253`).

**users report** (all **snippet**):
- delegation multiplies cost: "v0.1.1 sends same-model Codex subagents through delegate_task, using about 2.8× the allowance" (#23525);
- "T3 Code makes Claude Code subagents cost about 15% more" (#22749);
- a red Failed badge stays on a resumed sub-agent (#17486).

After the pin, commit `3ed0688c1` "remove one-child-per-model instruction (#25359)" and commit `5f64c5eb2` "cut T3's agent instructions and tool copy by 60% (#24850)" look like responses. That link is inferred from the titles.

## 7. Problems and challenges

**Provider crashes and server restarts.**
- Process-bound effects are cancelled; replay-safe ones are requeued (`EffectOutbox.ts:496-523`).
- Cut turns are continued at most 3 times in 5 minutes (`RestartContinuation.ts:33-34,230-243`).
- A pending live request becomes `not_resumable` when its callback is gone (`core-graph-and-data-model.md:473-485`).
- Codex async questions persist across exit and restart because they are answered by a new message (`providers.md:106-118`).
- After the pin: "bound pending requests after app-server stdout closes" (#24600); "retry provider event writes after brief SQLite locks" (#24571); "ended roots no longer leave provider turns running" (#22846).

**Auth expiry and account changes.**
- The `auth_refresh` runtime-request kind exists (`core-graph-and-data-model.md:471`).
- Antigravity sign-out stops existing processes before clearing account metadata, "Otherwise a helper or resumed session could retain the old account" (`providers.md:72-74`).
- **users report** (**snippet**):
  - #9607: a Claude thread "stays logged out after re-login until its CLI process is reaped";
  - #23720: "Switching Codex accounts with `codex login` is not picked up by the running shared app-server; every turn fails with 'access token could not be refreshed'";
  - #22816: macOS desktop reports Claude "Not authenticated" when auth comes from `CLAUDE_CODE_OAUTH_TOKEN` in the shell profile;
  - #14186: Claude reported authenticated when it is not;
  - #13635: one probe timeout leaves Claude stuck on "Could not verify" for hours.
- The common pattern (inferred): long-lived official-client processes cache credentials. Delegation moves the failure from "token expired" to "stale process".

**Protocol drift.**
- Defences (**author says**):
  - "Tests should prefer replay-backed integration coverage over mocked unit tests" (`README.md:42`);
  - 91 recorded scenarios (T3-C51);
  - "Native permission and question option IDs must also survive normalization; a display label is not necessarily a valid reply" (`providers.md:130-131`).
- **code shows** two kinds of drift workaround:
  - SDK typings that lag the CLI: "`model_scoped` shipped in the CLI after the SDK typings we pin, so it is read structurally" (`claudeUsageLimits.ts:113-116`);
  - Codex partial snapshots (`codexUsageLimits.ts:161-166`).
- After the pin: "ENABLE_TOOL_SEARCH=auto no longer costs 10x cache writes per session" (#24654); "finished Cursor turns no longer end in Provider error after the SDK's late resume" (#24231); "use Codex native collaboration modes" (#24737).

**Rate limits.**
- Failure classes are `usage_limit`, `provider_error`, `transport_error`, `permission_error`, `validation_error`, `unknown` (`orchestrationV2.ts:1239-1246`).
- A limited thread shows "Limited" and offers Resume, "Resume at reset", "Snooze until reset", or "switch to another provider instance" (`thread-sidebar.md:196-217`).
- Auto-resume is off by default (`settings.ts:1165`). When on, it arms at the provider's reset time and sends "Continue where you left off." with idempotent ids `limit-arm:` and `limit-resume:` (`UsageLimitRecoveryWorker.ts:34-71`). It ignores reset times already past at failure (`:27-33`).
- **users report** (**snippet**):
  - auto-resume "fires at the reset second and never retries after Claude refuses" (#22026);
  - "Claude 429 with no reset time fails delegated runs with no recovery" (#22619);
  - cancelling a limited delegated task "leaves its reset arm active and revives a superseded child" (#21091);
  - auto-resume restarted "days-old delegated tasks after a server update" (#21716);
  - request to resume after 429 or 5xx like after a restart, noting that about half of limited child runs were never resumed (#23399).

**Policy risk.**
- Anthropic's terms on subscription OAuth in third-party tools (The Register, 2026-02-20, **snippet**).
- Agent SDK billing went to API credits (2026-05-13), then was paused (2026-06-15) (Theo's posts, **snippet**).
- OpenAI first said third-party Codex clients were not approved (2026-09-08), then T3 became a Sign in with ChatGPT partner (2026-09-29) (**snippet**).

**Performance.**
- **author says:** "regularly audit for performance regressions, often caused by sending too much data over websockets, css animations causing gpu spikes" (`AGENTS.md:15-17`).
- `synchronous=NORMAL`, because "Every provider event is its own commit, so a slow or busy disk stalls the event loop and clients drop" (`persistence/Sqlite.ts:27-32`).
- After the pin: cold connects skip settled threads, "93% of the shell JSON" (#24723); idle sub-agent threads skipped, "a third of the thread list" (#24648).

**Desktop native crashes.**
- Native modules run in forked children with deadlines, because "A crash or stall in any of these must not take the app down" (`overview.md:118-123`).

## 8. Overlapping work and results

**Default is a shared checkout.**
- Workspace mode inherits `t3.json`, then `"local"`, meaning the project root (`settings.ts:1198`).
- Users choose **New worktree** per thread (`thread-sidebar.md:3-4`).
- `create_threads` from an agent shares the parent's checkout. `t3_thread_launch` can make a worktree, and "Creating a worktree in the task prompt does not update this binding" (`…mcp-server.md:341-353`).

**Worktrees.**
- Managed under `<worktrees folder>/<repo>/<branch>`, checked by real path (`worktreesDirectory.ts:52-54`).
- The repo's `t3.json` script with `runOnWorktreeCreate: true` runs setup (`t3.json`). `runOnSettle` scripts reclaim disk, for example `cargo clean` (`thread-sidebar.md:137-142`).
- A ref beginning with `-` is refused before `worktree add` (`vcs/GitVcsDriverCore.ts:314-316`).

**Collisions the code guards.**
- **File restore needs isolation.** "File restore requires an isolated worktree. This workspace may contain changes from another thread. Rewind the conversation without restoring files instead" (`CheckpointRestoreSafety.ts:9-10`).
  - The check runs at admission and again before provider rollback (`:12-13`).
  - It treats any other thread's worktree, checkpoint cwd or live session cwd that contains, or is contained by, this one as shared (`:53-91`).
- **users report** the bug that motivated it: "A revert in one thread deletes the work of other threads" (#5512, **snippet**). PR #11543, "revert only the files a thread changed", is linked; its merge status is unknown.
- **Turn diffs show the turn's own work.** "When a turn pulls, merges, or rebases, the files Git brought in are left out" (`source-control.md:8-11`; `CheckpointStore.ts:66-72`).
- **Rollback holds a per-cwd lock.** It runs under a workspace lease, a per-cwd semaphore (`workspace/workspaceLease.ts:4-21`; `CheckpointRollbackService.ts:365`).
- **No merge tool.** I found no code that resolves conflicts between threads. The PR watch wakes the agent "when… the branch starts to conflict" (`source-control.md:283-286`).
- **Merge-back is context, not code.** It carries "decisions, files changed, commands/tests run" from a fork into the source thread (`feature-lifecycles.md:209-222`).

**users report** (all **snippet**):
- moving a thread's worktree mid-turn leaves the agent in the old one (#14343);
- storage cleanup keeps a shared worktree forever (#17816);
- cleanup deletes git worktrees nested inside a thread worktree, "including uncommitted work" (#23866);
- deleted threads' checkpoint refs are never pruned (PR #24140).

**Results.**
- A delegated task publishes `summary` and a `resultContextTransferId`, stable across later follow-ups (`…mcp-server.md:299-308`).
- "A failed run exposes its provider error before any progress text" (`:484-485`).
- Activity summaries do not over-claim: "Waiting on a thread does not mean it finished" (`docs/user/activity-log.md:16-19`).

## 9. Organisational management

**For users.**
- **Projects:**
  - a project is a directory record per environment;
  - threads can be scratch threads without a project, in `~/.t3/scratch/<date>-<words>-<id>` (`thread-sidebar.md:16-32`);
  - new projects go in `~/.t3/projects` (`source-control.md:124-131`).
- **Sidebar:**
  - sections Pinned, Active, Working (beta, on by default after the pin, #25190), Snoozed and Settled;
  - drag between sections; Undo for 5 s; order saved on the server (`thread-sidebar.md:46-125`).
- **Auto-settle** happens "after three days" idle, or when the PR merged. It is blocked by work in progress, pending questions or approvals, and live background work (`:149-157`). It can be disabled per thread (`:159-162`).
- **Snooze** hides a thread until a time. It wakes early only for an approval or answer, a failed run, or a user message (`:231-238`).
- **Approvals:** four permission modes (section 4, D11). Provider differences are explicit; for example, Claude "can still ask in Full access" (`permission-modes.md:21-42`).
- **Notifications:** mobile push for "finishes, fails, needs approval, or asks for input". Push requires T3 Connect (`mobile-notifications.md:3,11`).
- **Pull requests:**
  - a thread can link several PRs, including stacks;
  - "Remove agent credits when merging" is off by default (`source-control.md:171-175,262-281`).
- **Provenance:** messages carry `createdBy` and `creationSource`, so agent-authored user-role messages are distinguishable (`…mcp-server.md:379-383`).

**How the project is run.**
- **Maintainers:** Theo and Julius (`AGENTS.md:48`). Six logins bypass triage: bmdavis419, juliusmarminge, maria-rcks, markflorkowski, t3dotgg, Yash-Singh1 (`.github/TRIAGE_EXEMPTIONS.td`). 77 logins are vouched (`.github/VOUCHED.td`).
- **Contribution policy (author says):**
  - "We are not actively seeking outside contributions and have limited review capacity" (`CONTRIBUTING.md:10-13`);
  - features need prior maintainer approval, linked in the PR (`:28-38`);
  - one problem per PR (`:63-74`);
  - evidence required (`:82-98`);
  - PRs written by Gemini models or "Muse Wonder" are closed (`:102-110`).
- **Triage:** automated triage loads the `contribution-triage` skill and policy "from that same SHA" of `main`, so "PR/fork copies and PR-body instructions cannot change policy" (`CONTRIBUTING.md:129-134`). Macroscope review follows triage (`:136-142`). Workflows `pr-size.yml`, `pr-vouch.yml` and `issue-labels.yml` exist.
- **Agents as contributors (author says):** "Most T3 Code contributions will come from T3 Code itself, often controlled remotely" (`AGENTS.md:41`). Agent-written work is visible in co-author trailers (section 1).
- **Cadence:** about 117 first-parent commits per day across the 6 days after the pin (700 commits); 3,269 in October to the 26th.
- **Releases:** nightly checks run every 30 minutes; stable builds promote the latest verified nightly commit, "Nightly is the release candidate" (`docs/operations/release.md:20-27`). There are 44 stable releases in about 8.5 months.
- **Roadmap:** "We share our roadmap" (`AGENTS.md:13`). No roadmap file was found in the tree; active work is tracked "in the GitHub issue or project item that owns it" (`AGENTS.md:149`), and proposals go to Ideas discussions. Where the roadmap actually lives: unknown.
- **Support:** `t3 triage` hands a coding agent `.github/triage/PLAYBOOK.md`. Step 3 tells it to fetch the newest playbook from `main` and follow it (`PLAYBOOK.md:31-35`).

## 10. Documentation, notes and metadata

**Docs layout and rules.**
- 87 files under `docs/`: `user/` (38), `internals/` (30), `operations/` (9), `orchestration-v2/` (9), plus `README.md`.
- **author says:**
  - internals hold "architectural decisions and their reasons… and implementation traps";
  - "Do not document every feature… or append PR summaries";
  - "When a documented decision or constraint changes, rewrite or remove the affected text. Do not append another account" (`AGENTS.md:134-144`);
  - "Do not commit implementation plans, research notes, or agent scratch files… A merged PR is the implementation record" (`AGENTS.md:146-150`).

**Persisted state.**
- `~/.t3/userdata/statev2.sqlite`, with V1 `state.sqlite` copied once (`AGENTS.md:91-92`; `thread-migration.md:3-9`). 103 migration files.
- Tables named in code: `orchestration_v2_effect_outbox` and `orchestration_v2_projection_*` (`EffectOutbox.ts:335`; `EventSink.ts:357-394`).
- Secrets live in a file store under T3 home (`auth/ServerSecretStore.ts`).

**Event log and projections.**
- The event log is the source of truth (`overview.md:55`).
- Projections: thread shell, thread detail, execution graph, provider sessions, pending requests (`core-graph-and-data-model.md:582-591`).
- An ordered `turnItems` projection means "The frontend should not reconstruct display order" (`:596-600`).
- After the pin: "compact superseded turn-item snapshots" (#20990).

**Command receipts and effects.**
- Receipts hold `resultSequence`, status and error (`CommandReceiptStore.ts:43-51`).
- Settled effects are kept 7 days; failed rows are kept so cleanup keeps a deleted thread's worktree (`EffectOutbox.ts:153-159`).

**Raw provider frames.**
- "append-only evidence for debugging, support, and replay fixture generation… bounded rotating log files, not… canonical durable SQLite state" (`core-graph-and-data-model.md:551-553`).
- Payloads over 64 KiB become structural summaries (`providers.md:152-155`).
- Server traces go to `server.trace.ndjson` (`PLAYBOOK.md:76-77`). OpenTelemetry export can be set per environment (`telemetry.md:24-36`).

**Checkpoints and diffs.**
- Hidden refs per turn (T3-C25). A checkpoint has status ready, missing, error or stale (`core-graph-and-data-model.md:532-546`).
- Codex `turn/diff/updated` is turned off, because "T3 derives diffs from checkpoints" (`providers.md:157-159`).

**Usage.**
- Usage is rebuilt from each account home's transcripts and priced as API-equivalent estimates, with custom prices and model mapping (`usage.md:7-77`).
- Limits come from official channels or private endpoints (T3-C41 to T3-C43).

**Telemetry.**
- Events go to `ingest.t3.codes` and on to PostHog, "associated with a hashed account or installation identifier", including "your OpenAI and Claude accounts when you are signed in".
- Events exclude prompts, responses, file contents and tokens (`telemetry.md:3-12`).
- On by default (`AnalyticsService.ts:81`).

## 11. Known problems and open questions

1. **Orchestrator size.** It is a 12,143-line file. AGENTS.md asks for "the smallest model", yet the V2 graph is large. The V2 docs are a "target architecture", so the gap between doc and code is unknown (`orchestration-v2/README.md:3`).
2. **Stale credentials in long-lived processes.** Issues #9607, #23720 and #14186 (**snippet**). Their fix status was not checked; GitHub API access was refused.
3. **Limit recovery fails in many shapes.** #21091, #21716, #22026, #22619 and #23399 (**snippet**). The current code still fires once at the reset time (`UsageLimitRecoveryWorker.ts:50-71`).
4. **Shared-checkout data loss.** #5512 is guarded now (`CheckpointRestoreSafety.ts`). Cleanup bugs #17816 and #23866 were not checked against `main`.
5. **Delegation cost.** #23525 and #22749 report 2.8× and 15% extra allowance use.
6. **Full access by default** (`providerPolicy.ts:32`).
7. **Telemetry on by default**, including hashed provider account ids.
8. **Private endpoints and tokens.**
   - Claude reset credits read `.credentials.json` and call undocumented endpoints.
   - The Antigravity limits code refreshes Google tokens itself.
   - Managed Codex holds and renews tokens.
9. **Unverified numbers.** "over 500,000 users" (`AGENTS.md:9`) has no published source.
10. **Open question: does the Codex probe refresh tokens?** `account/read` is sent with `{}` (`CodexProvider.ts:534`); Codex's default for `refreshToken` was not checked.
11. **Open question: how do private-endpoint calls identify themselves?** The User-Agent or originator headers on those calls were not read. The `anthropic-beta: oauth-2025-04-20` header is sent (`claudeResetCredits.ts:150-151`).

## 12. Lessons for a successor (Assay)

**Keep:**
- **Event log with outbox and receipts, and effect classes** (T3-C01 to T3-C05).
  - The process-bound versus replay-safe split, and "an ack means intent committed", are the most transferable ideas.
  - Put them on Assay's existing durable core rather than lifting T3's SQLite kernel (the donors file already says this).
- **"Only the root completes the run"** and run ≠ provider turn (D5). This is backed by probe evidence.
- **Restart continuation with a chain cap** (3 in 5 minutes), plus the blocking conditions (D9).
- **Isolation check before file restore** (T3-C28), and authored-path diffs (T3-C26).
- **App-owned delegation through MCP:**
  - prompt-only child context;
  - a privilege ceiling re-checked in the target's lock;
  - questions routed to the parent;
  - idempotent `clientRequestId`;
  - typed denials (T3-C19 to T3-C24).
- **Probes without side effects** (T3-C17). **Routing by instance** (T3-C16).
- **Replay fixtures at the transport boundary** (T3-C51). Assay's adapters face the same drift.
- **SecretRef, the untrusted envelope, and pairing with short tickets** (already copied).
- **Server-owned settlement and snooze state**, so clients render and do not derive it.

**Avoid:**
- Full access as the initial default. Assay keeps approvals on.
- Telemetry on by default, especially hashed provider account ids.
- Shared checkout as the default for parallel threads. Default to a worktree per write-capable worker. T3's own revert bug (#5512) shows the cost.
- Many-shaped limit recovery that fires once at the exact reset second (users report). If Assay offers resume-at-reset at all, add jitter and a retry; keep it on the **same account**.
- Delegated children that multiply cost without telling the user (#23525).

**Guardrail conflicts (do not copy):**

| Assay guardrail | T3 practice at `7e289ae1` |
|---|---|
| Never read other apps' credential stores | `claudeResetCredits.ts:144-145` reads Claude's `.credentials.json`. `server.ts:273` wires a Cursor keychain reader; users opt in on macOS (`usage.md:27-29`). `antigravityUsageLimits.ts:206` reads the Antigravity agent's token file. `telemetry/Identify.ts:181-189` decodes the Codex `id_token` |
| Never copy or refresh tokens | `antigravityUsageLimits.ts:213-224` posts the refresh token to `oauth2.googleapis.com/token`. Managed Codex stores tokens and passes them as `ACCESS_TOKEN` (`CodexManagedRuntime.ts:19-29`); after the pin, renewal moved into the server (#21786, #21787). The CLIProxyAPI hub has T3 send requests with a `$TOKEN$` placeholder that the hub fills (`cliproxyApi.ts:209-217`), so the hub holds the tokens |
| Never call undocumented endpoints while presenting as the official client | `claudeResetCredits.ts:161,228` (`/api/oauth/usage`, `/reset_rate_limits` with the OAuth beta header). `cliproxyApi.ts:138,266` (`chatgpt.com/backend-api/wham`, `api.anthropic.com/api/oauth/usage` through the hub). `antigravityUsageLimits.ts:18-21` (`cloudcode-pa.googleapis.com`) |
| Never rotate accounts to evade limits | **No automatic rotation found.** Auto-resume waits for the same thread's reset (`UsageLimitRecoveryWorker.ts:17-71`). But four things lean that way:<br>1. The Limited state suggests "switch to another provider instance" (`thread-sidebar.md:196-198`).<br>2. Codex "compatible accounts can continue the same thread" (`providers-codex.md:30-31`).<br>3. Limits pool all accounts per provider, ordered "by their next 5-hour refill, soonest first" (`usage.md:81-85`).<br>4. T3 integrates with a CLIProxyAPI hub described as showing "pooled accounts" (`usage.md:134`).<br>Inferred: together these make manual rotation easy. Assay should show per-account limits only, and should not offer an account switch from a limit-stop screen |

Note: T3's main live-limit path is through official channels: the Claude SDK `get_usage` and Codex `account/rateLimits/updated` (T3-C41). That path is acceptable.

**Corrections to prior internal notes** (`research/extraction/orca-t3code.md`):
- The notes say "Both apps call providers' private OAuth usage endpoints" for live quota. That is not correct for T3's main path, which uses official channels (T3-C41). The private endpoints are used for reset credits, the CLIProxyAPI hub and Antigravity.
- The notes miss Antigravity's token refresh and the CLIProxyAPI hub entirely.
- The private set in the Codex shadow home also includes `models_cache.json`.

**Unknown:**
- whether Anthropic's and OpenAI's current terms cover Assay's use; T3's status came from a partner program and a paused policy, not from its code;
- how stable T3's 12k-line orchestrator is in practice;
- whether the V2 docs match the code everywhere.

## 13. Sources (accessed 2026-10-26)

**Code.**
- `pingdotgg/t3code` at `7e289ae1f77b9137580688aaccf00d48906984ad`.
- Files were read via `https://raw.githubusercontent.com/pingdotgg/t3code/7e289ae1…/<path>`.
- Trees and history came from git smart-HTTP v2 against `https://github.com/pingdotgg/t3code.git`, parsed in memory; no clone was written to disk.
- History is to `main` at `1316d48b0c68` (2026-10-26 09:10 UTC).

**Prior internal notes.**
- `research/extraction/orca-t3code.md`.
- `docs/merger/01-anatomy/donors.md`. Line citations rows 9-14 and the rejected parts were re-checked and hold at `7e289ae1`.

**Public sources** (seen as WebSearch summaries only; post dates decoded from X ids):
- x.com/theo/status/2030072127605592547 (2026-03-07)
- x.com/theo/status/2030126522577879327 (2026-03-07)
- x.com/theo/status/2030137750905835561 (2026-03-07)
- x.com/theo/status/2036216034949312851 (2026-03-23)
- x.com/theo/status/2044710197114097922 (2026-04-16)
- x.com/theo/status/2054613327696056660 (2026-05-13)
- x.com/theo/status/2066669344483143701 (2026-06-15)
- x.com/theo/status/2112310547727462542 (2026-10-19)
- x.com/t3dotcodes/status/2105014171012313129 (2026-09-29)
- theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/5014546
- aicoder.com/news/news-20260908-openai-codex-sign-in-policy
- learn.chatgpt.com/docs/sign-in-with-chatgpt
- thenewstack.io/sign-in-with-chatgpt/
- finance.biggo.com/news/382b1ef1c37acfb3
- rosetta.to/u/t3dotgg/i-m-done
- iamtypist.dev/tools/youtube-summary/i-m-done-131yAOjxHHQ
- daily.dev/posts/t3-code-got-banned-from-claude--fwselnkdq
- digg.com/tech/5vvigo44
- star-history.com/pingdotgg/t3code
- ossinsight.io/analyze/pingdotgg/t3code
- aitoolly.com (2026-10-05 and 2026-10-07 articles)
- hunted.space/dashboard/t3-code
- notes.nicolasdeville.com/ai/t3-code/
- betterstack.com/community/guides/ai/t3-code/
- flaviocopes.com/t3-code
- moge.ai/product/t3-code
- GitHub issues and PRs: #2495, #2680, #5512, #9607, #11543, #13635, #14186, #14343, #17002, #17486, #17816, #21091, #21435, #21716, #22026, #22225, #22619, #22749, #22816, #23152, #23399, #23525, #23720, #23866, #24140, #24412

**Searched, nothing usable.**
- Hacker News: no T3 Code story in search results; the API was unreachable.
- Reddit: no threads in results; the site was unreachable.
- Security advisories or CVEs: none found.
- Independent hands-on reviews: none found.
- T3 Code against Conductor, the Codex app or Claude Code desktop: no comparison found that includes T3 Code.
- The contribution-policy controversy: nothing found.
