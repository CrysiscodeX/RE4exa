# Profiles: rea, leanrea, pi-durable, absurd, Orca, T3 Code

These six profiles describe what each project does, why it is built that way, and where it falls short. They draw on the code and on what the public says. They come before any comparison with Assay; that comparison is the next step.

## How the research was done

Each profile was written by a separate research agent from the same brief. Every profile follows the same method:

1. **Prior notes first.** The earlier dissection (`docs/merger/01-anatomy/`), the extraction notes (`research/extraction/`) and the RQS-2030 reviews (`research/rqs-review/`) were the starting point. The profiles correct them where the code says otherwise.
2. **Code at a pinned commit, then HEAD.** Each agent read the commit used in the merger study (`docs/merger/sources.md`), then compared it with the default branch on 2026-10-26.
   - Sources read: design notes, tests, commit history, and issue and PR pages.
   - Most of the reading streamed files from GitHub instead of cloning, because plan mode was on during the research.
3. **Public discussion.** Agents searched GitHub issues and PRs, Hacker News, Reddit, X, YouTube, the authors' blogs and package registries.
4. **Every statement is labelled.** The labels are:
   - **author says** (cited);
   - **users report** (cited);
   - **code shows** (file:line @ commit);
   - **my test** (a command run here);
   - **inferred** (reasoning, with its basis).
5. **Read-only towards the outside world.** Nothing was posted, starred or signed up for. No personal data was sent anywhere, and temporary clones were deleted.

**What could not be reached, stated once here and in each profile.** This environment's network proxy blocked or failed DNS for these hosts:
- Hacker News and its search API, X, Reddit and YouTube pages;
- npm download statistics;
- the authors' blogs (lucumr.pocoo.org, mariozechner.at);
- several company sites.

Material from those places comes only from search-engine snippets and is marked **snippet**. Comment threads were mostly unreadable, so maintainers' replies to critics are under-represented. Star counts not read from GitHub itself are dated and marked.

**Hands-on tests.**
- rea: run on local fixtures only (§9A of its profile).
- leanrea: tested on this machine, and its failure patterns were mined from the 24 recorded Tier 0 runs in `apps/assay/bench/results/live.json`.
- pi-durable: line numbers re-checked against a clone at the pin.
- Nothing was run against third-party systems.

## Index

| Profile | What it is | Capabilities inventoried | Top limitations | Biggest gap in public information |
|---|---|---|---|---|
| [rea](rea.md) | A reverse-engineering toolkit for agents: a CLI and an MCP server with about 229 tools at HEAD | 46 groups (REA-C01 to C46) covering all 208 tools at the pin | **Agent context cost:** users report clients loading 0 tools under a 1 MB line cap, and about 2.3× input tokens for similar accuracy. Every result is still sent twice. **State:** the session evidence ledger is in memory only, and there is no tar or gzip support. **Breaking changes:** 39 releases in 3.5 months, 21 breaking items in one minor release. Node ≥ 22.23.4 is now required | The author's motivation, npm downloads, and third-party write-ups (snippets only) |
| [leanrea](leanrea.md) | A skill file: 18-row tool router, 17 traps, seen/inferred/unknown labels, plus a 4-task benchmark | 59 capabilities + 17 traps | **Prose only:** every rule, budget and label is prose, and nothing enforces it. In 24 Haiku runs, 6 answers carried no labels. **Platform:** on Linux 2 of 18 router rows run as written, 9 partly and 7 not at all (macOS-specific commands and flags). Escaped pipes break when copied. **Untrusted content:** no rule says that content read from the target is data, not instructions | The YouTube video and its comments (unreadable); no independent re-run of the benchmark |
| [pi-durable](pi-durable.md) | Crash-safe agent kernel for one process, from the pi monorepo: intent before effect, `safe`/`unsafe` replay | 35 | **Two processes:** a second process can silently overwrite the first's records. IDs come from an in-memory counter, rows are upserted, there is no lease, and `request_id` is not UNIQUE. **Crash mid-stream:** the model request is re-sent, which can loop with OOM. The crash-loop guard blames every running task. **Adoption:** the pi agent itself does not use it | The Earendil posts, HN thread and podcast (snippets only); no production reports beyond two small experiments |
| [absurd](absurd.md) | Durable workflow engine in one PL/pgSQL file (39 functions), with TS, Python and Go SDKs, a CLI and a dashboard | 99 | **Stale leases:** checkpoint and complete writes still accept an expired lease. **Events:** payloads are never consumed. An `awaitEvent` timeout writes no checkpoint (#96). **Growth:** retention is off by default (1.4 GB growth reported, #130). Python has no lease watchdog, and Go cannot join a caller's transaction | The author's blog posts and HN thread read only as snippets; no throughput benchmarks anywhere |
| [orca](orca.md) | A desktop app for running many coding agents. Its orchestration is a ledger driven by a skill guide, not a scheduler | 40 | **Liveness:** silence is never treated as death, so a coordinator missed a failed turn for about 40 minutes (#33167). **Overlap:** controlled only by an "Ownership" line, with no file locks, and merging is human. **Approvals:** agents launched with approvals bypassed at the pin | No first-hand public account of the coordinator loop; the reason stars grew from about 43k to 106k is unknown |
| [t3code](t3code.md) | Event-sourced server and clients that drive official agent CLIs on the person's own subscriptions | 58 | **Overlap:** threads share one folder by default, and one thread's undo wiped another's work (#5512). Now refused without a worktree. **Rate-limit auto-resume** fires once and does not retry (#22026). **Guardrails:** it reads other apps' credential files, refreshes an Antigravity token itself, calls private usage endpoints, and pools accounts through a hub | Theo's videos unwatched; no HN or Reddit thread or independent review found |

## Why each one works the way it does

Each project's shape follows from one constraint it chose. Most of its strengths and limits come from that same choice.

- **rea chose breadth for agents.** It has hundreds of narrowly typed tools, each declaring its side effects and returning content-addressed evidence. That makes it precise per question but expensive to load into a model's context, and fast change breaks integrations.
  - Its capabilities cannot be copied by moving code around. Each depends on a parser written for the purpose, or on an external engine (Ghidra, JADX, WABT, objdump), driven through code written for that engine. Reproducing one means writing new code against the same format or engine.
- **leanrea chose to be prose that a model runs.** It ships nothing executable: the model reads the router and runs whatever tools are installed through Bash. Its reach is that of the host's tools and the model's diligence.
  - That is why it is tiny and flexible, why it is mostly macOS-shaped, and why no rule is enforced.
  - Reproducing it means turning the rules into code; Assay's router pack and probes are one attempt.
- **pi-durable chose a single in-process owner.** One serial commit line inside one process makes "nothing shown before it is stored" simple and fast.
  - It also explains why there is no lease, no fence and no protection against a second process.
  - Replay is decided per tool (`safe`/`unsafe`), because only the tool author knows whether re-running is harmless.
- **absurd chose to put everything in Postgres functions.** The SDKs only call SQL, so any language gets the same semantics, and nothing runs outside the database.
  - The trade-offs are polling workers (LISTEN/NOTIFY was removed), Postgres-specific features (`SKIP LOCKED`, row-lock ordering, `ON CONFLICT`), and invariants such as lease expiry. Those invariants are checked only where a function happens to check them.
- **Orca chose a ledger and a guide, not a scheduler.** The coordinator is itself an agent following a skill guide. Orca records runs, tasks, dispatches, receipts and mailboxes, and rejects stale or duplicate completions with typed codes.
  - It does not schedule, prioritise, lock files or merge; humans and git do that.
- **T3 Code chose event sourcing around official clients.** Each command commits its events, read views, receipt and pending side effects in one SQLite transaction. Side effects run later under leases with retries.
  - After a crash, work tied to a dead provider process is cancelled, never replayed. Cut-off turns are continued by sending "Continue where you left off", at most 3 times in 5 minutes.

## Findings that affect Assay (recorded, not yet acted on)

These feed the comparison step. Nothing in Assay was changed for them in this commit.

1. **Breaker scope.** Orca's breaker counts three consecutive failed *starts of one task*. Assay's counts any failed worker in the case (`apps/assay/src/orchestrator/orchestrator.ts`), so three different failing sub-tasks stop all spawning.
2. **Stop versus delete.** Orca stops a worker without deleting its worktree. `assay_release_worker` removes the worktree with `--force`, so uncommitted work is lost. Split the two.
3. **Worker placement.** Orca's default is the current workspace, with a worktree only on request. Assay already makes worktrees opt-in; its documentation should not claim Orca's isolation as the default.
4. **Prompt budget.** Orca's task-text limit is about 1.2 MB, derived from Windows paste speed. Assay's 8,000-character limit is its own choice and should be justified on its own terms.
5. **Liveness.** Orca issue #33167 shows the cost of never treating silence as failure. Assay's live / exited / unverifiable status needs a turn-state signal as well as process state.
6. **Confirmed by HEAD.** These still hold at HEAD, so Assay's fixes are still needed:
   - absurd still accepts stale-lease writes and never consumes event payloads;
   - pi-durable still lets a second process overwrite the first.
7. **Replay policies.** pi-durable has only `safe` and `unsafe`. Assay's `keyed` policy is Assay's own addition, close to pi's open roadmap item #10624.
8. **Restart policy.** T3 Code continues cut-off turns automatically (bounded). Assay settles them as interrupted. Both are defensible. Which one Assay offers, and whether the person chooses, is a design decision for the comparison step.
9. **Fixed in this commit.** Assay's Tier 0 baseline file had been reformatted (leanrea profile A-14). It is now byte-identical to upstream and checked by a test. The recorded live runs predate the reformatted copy.

## Corrections made to earlier notes

| Note | Was | Now | Where |
|---|---|---|---|
| Orca worker placement | "creates a git worktree for that worker" | Current workspace by default; worktree on request or when sharing is unsafe | `research/extraction/orca-t3code.md`, `docs/merger/01-anatomy/donors.md` |
| Orca breaker | "opens after 3 failures" | 3 consecutive failed starts of one task | same |
| T3 Code limits | private usage endpoints implied as the main path | Main live-limits path is official. Private endpoints serve reset credits, the account-pooling hub and Antigravity (whose token T3 refreshes itself) | `docs/merger/01-anatomy/donors.md` |
| leanrea router | "19-row router" | 18 rows | `research/rqs-review/README.md` (the report is generated) |
| Assay baseline | "copied unchanged" | It was not; now it is, with a digest test | `apps/assay/bench/baseline/README.md` |

The research brief also contained two errors of mine, both corrected in the pi-durable profile:
- it called `keyed` a pi-durable replay policy;
- it said pi-durable had a PGlite storage adapter.

PGlite appears in the merger notes only as a test of absurd's SQL.
