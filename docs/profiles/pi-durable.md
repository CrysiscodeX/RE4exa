# Profile: pi-durable (`earendil-works/pi`, `packages/durable`)

Profile 3 of 6 (rea, leanrea, pi-durable, absurd, Orca, T3 Code). Written 2026-10-26. Purpose: let a later step compare Assay (`apps/assay/src/kernel/kernel.ts`) against pi-durable.

**Labels.** Every claim carries one of:
- **author says**: README, CHANGELOG, spec, code comments, commit messages, maintainer issue comments, or the authors' posts.
- **users report**: third parties.
- **code shows**: `file:line @ version`.
- **inferred**: my reasoning, stated as such.

**Citation prefixes and versions.**
- `durable:` = `packages/durable/`.
- `@1.4.0` = the npm 1.4.0 tarball's embedded sources, published 2026-10-21. These are the pin plus about one day.
- `@fdce48e` = the pinned commit, 2026-10-20.
- `@main` = default-branch head `d5b3de22d0e2`, 2026-10-25.

Where the prior notes (`docs/merger/01-anatomy/pi-durable.md`) cite the same lines at `fdce48e`, I re-read them at 1.4.0 and they match exactly:
- `harness/tool.ts:168-211`
- `harness/scheduler.ts:374-417`
- `storage/sqlite/storage.ts:176, 212-216, 679-684, 821-846`
- `storage/sqlite/migrations.ts:63, 98`
- `harness/submissions.ts:201-218`
- `session/transaction.ts:279-281`
- `types.ts:1179-1189`

README line numbers below are @1.4.0 unless marked otherwise. (corrected 2026-10-26) Checked against a clone at `fdce48e`: the pinned README has 869 lines. 1.4.0 adds two lines after pin line 79 (the `HarnessOptions.identity` paragraph), one after pin line 761 (the IndexedDB table row) and four after pin line 764 (the IndexedDB paragraph). The pin line number is therefore the 1.4.0 number minus 2 for lines 82-763, minus 3 for lines 765-767, and minus 7 for lines 772 onward. Example: README:790 @1.4.0 = README:783 @fdce48e. Lines 80-81, 764 and 768-771 @1.4.0 do not exist at the pin. Spec line numbers below were checked at `fdce48e` (`docs/spec.md`, 5,618 lines).

## 1. Identity card

| Field | Value | Label / source |
|---|---|---|
| Repository | github.com/earendil-works/pi, directory `packages/durable`. Monorepo with chord, pi-telemetry, pi-ai, pi-durable, pi-agent-core, pi-coding-agent, pi-tui and others | code shows: npm `repository.directory` |
| Package | `@earendil-works/pi-durable`. Description: "Durable conversation, task, and document runtime for Pi". Keywords: durable-execution, agents, conversations, tasks | author says: npm metadata, 2026-10-26 |
| Pinned commit | `fdce48eb404e` (2026-10-20) | task brief |
| Default branch head | `d5b3de22d0e2` (2026-10-25): "fix(durable): record the requested thinking level on assistant messages" | code shows: `git ls-remote`; GitHub commits page |
| Licence | MIT (`package.json` license field; root `LICENSE` © 2025 Mario Zechner). The npm tarball has **no LICENSE file**: its top level is only `package.json`, `README.md`, `CHANGELOG.md` and `dist/` | code shows: tarball listing @1.4.0; prior notes for the root LICENSE |
| npm maintainers | mitsuhiko (Armin Ronacher), badlogic (Mario Zechner), rwachtler | code shows: npm metadata |
| Commit authors on `packages/durable` | About 195 commits, 2026-09-18 to 2026-10-25. Roughly 140 by badlogic, 46 by mitsuhiko, 7 by christianklotz, 1 by davidbrai, 1 by petrroll. Counted from GitHub's paginated commit list (35 per page, 6 pages); approximate | code shows: GitHub web, 2026-10-26 |
| First commit | 2026-09-18, `0801601` "feat(durable): move Pico into dedicated package" | code shows: GitHub commits page 6 |
| Releases | 17 npm versions: 0.0.1 (2026-09-19); lockstep 0.86.0 to 0.99.2 (2026-09-19 to 09-30); 1.0.0 (2026-10-01) to 1.4.0 (2026-10-21). 1.4.0 is `latest`. Six 1.x releases (1.0.3, 1.0.4, 1.1.0, 1.2.0 and 1.4.0, plus Unreleased on main) carry "Breaking Changes" sections | code shows: npm `time`; `durable:CHANGELOG.md` @1.4.0 |
| Size @1.4.0 | 84 TypeScript source files, about 27,250 lines. Tarball: 339 files, 3.52 MB unpacked. Largest files: `harness/scheduler.ts` 2,507; `testing/storage-conformance.ts` 1,682; `types.ts` 1,274; `env/node.ts` 1,235; `storage/indexeddb.ts` 1,208; `session/session.ts` 1,123; `session/transaction.ts` 1,071 | code shows: source-map count |
| Size @fdce48e | 26,028 lines in `src` (prior notes). `docs/spec.md`: 5,618 lines (prior notes), 303,143 characters (WebFetch). `test/`: 86 files plus `examples/` (32 scripts, `00-conversation.ts` to `31-reload-and-restart.ts`) and `fixtures/` (2 files): 70 `*.test.ts` and 16 support and bench scripts (corrected 2026-10-26: confirmed in a clone at `fdce48e`; the listing was not truncated) | code shows: clone at `fdce48e` |
| Runtime | Node >= 22.19 (`node:sqlite`), Cloudflare Workers/Durable Objects, browser (IndexedDB) | code shows: npm `engines`; README:761-767 |
| Dependents | In the monorepo only `pi-env` depends on it. **`pi-coding-agent` 1.4.0 does not** (its deps: pi-agent-core, pi-ai, pi-codemode, pi-mcp, pi-tui). External: Cloudflare Agents SDK `PiHarness` (search result, not opened); `disler/durable-pi` (280 stars, 1 commit, pins 1.0.3) | code shows: `npm view … dependencies`; GitHub page |
| npm downloads | **Not obtained.** api.npmjs.org and npmjs.com were blocked from this environment on 2026-10-26 | gap |
| Monorepo activity (whole repo, not durable alone) | 117.9k stars, 15.1k forks, 300 open issues, 88 open PRs, 7,109 commits on main | code shows: GitHub repo page, 2026-10-26 |
| Issues labelled `durable` | 44 in total: 19 open, 25 closed. Oldest is #10325 (2026-10-02); newest is #11327 (2026-10-23) | code shows: GitHub issue search, 2026-10-26 |

## 2. Purpose and origin

- **author says.** "A durable agent harness. Conversations, model turns, tool calls, and your own state are committed to storage before anything is shown. If the process dies mid-turn, reopening the storage picks the work up where it stopped." (`durable:README.md:5` @1.4.0). The README marks it "**Experimental.** The API changes without notice between releases." (`:3`).
- **author says** (Earendil post "Pi Durable", earendil.com/posts/pi-durable/, 2026-10-01). The post was not opened (DNS failure). Wording comes from search-engine summaries of the page: "a new experimental package for long-running, durable, and malleable agents that can run anywhere". Its "Why Pi Durable?" section lists needs for a harness that runs anywhere, is reachable from different surfaces, supports infinitely long conversations, survives catastrophic internal and external failures, and lets multiple humans steer the same agents. Third-party summaries also say it "does not replace the Pi coding agent" and is "a framework for building any agentic application, coding agents included".
- **author says (origin).** The package came from an internal prototype called **Pico**:
  - First path commit: "feat(durable): move Pico into dedicated package" (`0801601`, 2026-09-18). (corrected 2026-10-26) **code shows** this commit moved the prototype out of `packages/agent/src/pico` and `packages/agent/docs/pico-v5*.md` (renames R099/R100). Its design started there on 2026-09-15 ("docs(agent): replace obsolete Pico prototypes with Pico5 design", `56cd598`). So pi-durable began as a Pico5 rewrite inside pi-agent-core three days before it became its own package.
  - Commits "docs: revise Pico5 immutable revision design" and "align Pico5 with canonical immutable tracker" (Sep 23-29).
  - The SQLite class comment still reads "Portable SQLite implementation of the Pico storage contract" (`durable:src/storage/sqlite/storage.ts:151` @1.4.0).
  - Spec §13 lists, as a non-goal, a "compatibility layer for earlier harness prototypes".
- **Why it is a separate package from the pi coding agent.**
  - **code shows** that the coding agent stores sessions as JSONL tree files (`~/.pi/agent/sessions/…/<ts>_<id>.jsonl`, entries linked by `id`/`parentId`). It runs extensions as in-process TypeScript modules loaded with `jiti`, hooking events such as `tool_call` and `tool_result` (`pi-coding-agent` 1.4.0 `docs/session-format.md`, `docs/how-pi-works.md:25-49`, `docs/extensions.md:38-218`). It has no task records, no intent checkpoints and no crash resumption of a running turn.
  - **inferred.** pi-durable re-implements the coding agent's concepts as durable tasks over a commit line. These concepts are read/write/edit/bash tools, compaction, steer/follow-up queues, `executeTool` nested calls, codemode and `tool_search`. The two packages are therefore independent today; the prior notes found `edit-diff.ts` 495/500 and `truncate.ts` 141/174 lines identical.
  - **users report** (#10386, 2026-10-03). Coding-agent extensions cannot run under the durable Harness. The maintainers have not answered whether they will.
- **Relation to pi-ai.** **code shows** that pi-durable calls models only through a host-supplied pi-ai `Models` object (`durable:src/harness/types.ts:260` @1.4.0). It uses pi-ai's `validateToolArguments`, retry helpers (`isRetryableAssistantError`, `retryDelayMs`; `generation.ts:13`) and `uuidv7` (`provider.ts:2`). Credentials, OAuth and provider quirks therefore all live in pi-ai. The prior notes record pi-ai's Anthropic subscription-OAuth path presenting as Claude Code; not re-checked here.
- **Relation to absurd** (same organisation).
  - **code shows** that no code is shared. Neither the 1.4.0 tarball nor the absurd clone @`3cfc64f` mentions the other: zero hits for "pglite|postgres|absurd" in the tarball.
  - **author says** that absurd is "the simplest durable execution workflow system … entirely based on Postgres" and promises "'exactly-once' semantics … expressed as code" (`absurd:README.md:9-12, 30-35`). pi-durable says nested calls are "not exactly-once execution" (`durable:src/harness/types.ts:273` @1.4.0).
  - **inferred.** The two solve the same layer, durable steps and retries, for different hosts. Absurd targets many workers on one Postgres with leased claims. pi-durable targets one owner on an embedded store (SQLite file, Durable Object, browser) and adds agent semantics. Armin Ronacher authors both.
- **Correction to the brief.**
  - **PGlite:** pi-durable has **no PGlite or Postgres adapter** at the pin, in 1.4.0 or on main. The backends are Memory, SQLite (Node `node:sqlite`, Cloudflare Durable Object), JSONL and IndexedDB (IndexedDB added 2026-10-21, after the pin) (README:761-767 @1.4.0). The spec at the pin does not mention PGlite or Postgres.
  - **Replay policies:** pi-durable has **two** replay policies, `"safe" | "unsafe"` (`durable:src/harness/types.ts:305`, `tool.ts:77` @1.4.0). "Keyed" exists only as nested-call keys and `requestId`. A `keyed` replay *policy* is Assay's own addition. pi's own roadmap issue #10624 (badlogic, 2026-10-07, open) proposes the same idea for bash: keyed exec with a `{ envId, key }` memo.

## 3. Public reception

Sample: one HN thread (not opened directly), about 12 third-party articles (titles and search summaries only), 2 podcasts or videos (not watched), 2 quantified user experiments, and 44 GitHub issues (8 opened). No Reddit threads were found. X/Twitter search returned nothing relevant. The authors' own blogs could not be reached.

| Date | Source | What it says | Label |
|---|---|---|---|
| ~2026-10-01 | HN item 49925969, "Pi Durable (earendil.com)" | Points reported as 486, 515 or 932 and comments as 67 or 307 by different aggregators: unverified. Snippets: badlogic calls it a library for durable agents where "you can plug in any sandbox"; azuanrb uses DBOS for session durability, "overkill"; anilgulecha says it makes Pi a Cloudflare acquisition target; lukebuehler names LangChain Deep Agents and Anthropic Managed Agents as competitors | users report (search snippets) |
| 2026-10-01 | earendil.com/posts/pi-1-0/ and /posts/pi-durable/ | Launch alongside Pi 1.0 | author says (summaries) |
| 2026-10-02 | Cloudflare changelog "Run the Pi Durable harness on Cloudflare with the Agents SDK"; docs `agents/harnesses/pi` | `PiHarness` class; one Pi session maps to one Durable Object; "each Agents release supports one Pi minor version" | third party (summaries) |
| 2026-10-02 | withone.ai, "We killed a Pi Durable agent after a Gmail write. Haiku left two drafts" | SIGKILL right after the Gmail response. With the default (unsafe) policy, Sonnet 5.5 declined to retry. **Haiku 4.5 re-issued the call, left two drafts, and said it saved one.** Keying the tool on the model's tool-call ID left one draft for both models. Two runs per model | users report |
| 2026-10-02 | The Register, "Pi coding agent pulls a 180 and adds MCP support" | About Pi 1.0 | third party |
| 2026-10-03 | GitHub #10386 (SiebertLanhove) | Extension-free sub-agent roles on Durable: "45 forced SIGKILL recoveries, 0 duplicate completed tool steps". Roles that need coding-agent extensions cannot move. No maintainer reply | users report |
| 2026-10-09 | GitHub #10749 (TVATDCI) | A second-process observer receives "zero post-attach events … 10/10 trials", because watch has no storage-level notification. Closed by badlogic with "i have no idea wtf this issue is trying to tell me" (the body was AI-drafted) | users report / author says |
| 2026-10-19 | GitHub #11139 (aron-cf), open | A host restart mid-stream re-runs the generation, and OOM repeats it "indefinitely. Nothing stops it or reports it". badlogic (2026-10-24, AI-labelled) says the 1.4.0 parking leaves "the conversation … busy forever with a stale partial" and that the counter "counts every task that was running when the host died, not the one that killed it" | users report / author says |
| ~2026-10-20 | Fragmented podcast #312 "Understanding Pi Durable with Mario & Armin"; YouTube `ja_7AF54OtE` "Pi Durable: Agents That Survive Crashes" | Show notes: explicit tasks, crash recovery, "multiplayer primitives", Chord. Not listened to | author says (show notes) |
| Oct 2026 | redreamality.com, "What Durable Agent Harnesses Actually Guarantee" | Replay safety "is a promise you make, not one the harness checks"; losing the commit that recorded a call's start reruns it; no approval step; event streams cannot resume | users report (summary) |
| Oct 2026 | blog.bokvi.com, flaviocopes.com, mindstudio.ai, agentspulse, varops.com, dev.to "Pi Durable Shipped, Then the Hype Took Over the Timeline" | Explainers and tutorials; contents not verified | third party |

**Honest summary.** Launch attention was high: front-page HN, a Cloudflare integration on day one, many explainers. Independent evidence about behaviour is thin, with two small kill experiments (n=4 runs and n=45 kills). Both confirm the documented semantics. The only criticism with data is the withone.ai result: an "interrupted" answer moves the duplicate-effect decision to the model, and a weaker model repeats the effect. Maintainer engagement on design issues is sparse. Several durable issues have no maintainer reply (#10386, #10852), and new-contributor issues are auto-closed by default.

## 4. Architecture and mechanics: design decisions

Each decision gives: what (code shows), why (author says, or inferred), and consequence.

**D1. One in-process mutation line; publish only after storage settles.**
- *What:*
  - `SessionImpl` serialises every commit, multi-read job, sweep and watch attach through one promise chain: `#enqueue` (`durable:src/session/session.ts:896-903` @1.4.0).
  - A commit runs four steps on the line: callback, then `tx.settleSuccess()`, then `storage.commit(writes)`, then adoption and `#publish` (`:720-767`).
  - Once admitted, a commit is not interrupted by caller cancellation (`:749-750`).
- *Why (author says):*
  - "Session kernel: one mutation line … Only committed state is observable." (`session.ts:106-113`)
  - Spec §4: the Session "owns the Session mutation line through callback execution, preparation, storage settlement".
  - Spec §13 non-goal: "visible-undurable publication".
- *Consequence:*
  - Read-your-writes, dedupe and memo races are trivially correct inside one process.
  - Commits are strictly serial, so a slow storage or a long commit callback stalls every conversation (spec §12 footgun "Long transactions").
  - Reads after the first table write in a transaction throw `ReadAfterWrite` (`transaction.ts:953`).
  - **On main this rule is relaxed for streaming partials.** "Partial answers and tool output are stored later than they are shown", within `settings.progress.persistWithinMs`, default 1,000 ms. Deferred commits are "stored with the next commit that reads or writes the document" (main CHANGELOG [Unreleased], commit `6c2fd73` "deferred storage of throttled commits", 2026-10-24).

**D2. A small, engine-neutral Storage contract over whole JSON records.**
- *What:*
  - `Storage` has `commit(writes) → Seq`, `mintId()`, point reads, cursor scans, `submissionByRequest`, document find/read/scan, and `close` (`durable:src/types.ts:1179-1274` @1.4.0).
  - Writes come in eight kinds: conversation, entry, task, submission, and document create, copy, change and retire (`types.ts:852-868`).
  - SQLite stores each record as `record TEXT CHECK (json_valid(record))`, with a few indexed columns, in 9 STRICT tables (`storage/sqlite/migrations.ts:14-89`).
- *Why:*
  - **author says** the "portable SQLite and JSONL cores … run without Node APIs, for example on Bun or in Cloudflare Durable Objects" (README:790).
  - **inferred:** keeping the engine dumb, with JSON blobs and no SQL translation of document ops (spec §13 non-goal "SQL translation of arbitrary Chord operations"), lets one kernel run on SQLite, JSONL, Memory and IndexedDB, and be certified by one conformance kit.
- *Consequence:* a new backend is about 850-1,200 lines (memory.ts 865, jsonl 847, sqlite 958, indexeddb 1,208).
- *Trade-off:* task and submission writes are **full-record replacements**. The conformance case "replaces complete task records" (`testing/storage-conformance.ts:581`) requires it, and SQLite does it with `INSERT … ON CONFLICT(id) DO UPDATE` (`storage.ts:818-847`). There is no version or compare-and-set column, so the last writer wins.

**D3. One global numeric ID space, minted in memory.**
- *What:*
  - `SqliteStorage.open` reads `next_id` once (`storage.ts:168-177`), and `mintId()` returns `this.nextId++` (`:212-216`).
  - `commit()` re-reads `next_id` inside the SQL transaction and stores `max(next_id, highest written id + 1)`, but it updates the in-memory counter only from its own writes (`:191-208`).
  - `record_ids` enforces one type per ID. Conversations, entries and documents must be new. Tasks and submissions may reuse an ID of the same type (`:668-689`). ID 1 is the root conversation (conformance `:98`).
- *Why (author says):* `mintId` must return an ID "greater than every ID minted or stored before, also across reopen: scans order by ID as creation order, and the Harness relies on it" (`types.ts:1185-1188` @1.4.0).
- *Consequence:* minting is cheap and needs no round trip, but it is per-process. On main the contract was "narrowed to IDs greater than every ID minted since the storage was opened" (main CHANGELOG), and `mintId` is still in-memory (raw `main` storage.ts, 2026-10-26). See §9.1.

**D4. Tasks are checkpointed phase state machines; a phase reruns from its top.**
- *What:*
  - `defineTask({name, version, initial, phases, abort, migrate})` (`durable:src/tasks.ts`).
  - Statuses: `pending | running | waiting | sleeping | completing | terminal` (`types.ts:599-643`). Outcomes: `completed | failed | aborted | orphaned | faulted` (`:562-596`).
  - A phase "must commit a changed checkpoint or a terminal outcome …; returning without durable progress faults the task" (`types.ts:222-225`).
- *Why (author says):*
  - "a phase reruns from its top after a restart, so work after the wait goes in the next phase" (README:162).
  - Spec §5.2 "Effect sandwich": "Reopening in an intent phase means the effect may have happened."
  - (corrected 2026-10-26) Spec §13 does not list resumable stacks; its 11 non-goals are at `docs/spec.md:5604-5618` @fdce48e. The no-stack-restore point comes from third-party summaries ("doesn't restore a suspended JavaScript stack") and from README:162. **author says** it in spec §5.6 for sleeps: "Work before the sleep is not exactly-once" (`docs/spec.md:2433`).
- *Consequence:*
  - No event-sourced replay of user code, unlike Temporal. Developers must split effects at phase boundaries.
  - It is easy to implement on any store with atomic multi-row writes.
  - Migration per definition version: a missing migration makes the task `blocked: migration_failed` or `orphaned` (`scheduler.ts:1591-1663, 2480-2486`).

**D5. Intent before effect, with a dual replay policy (`safe`/`unsafe`).**
- *What:* the `pi.tool` task's `call` phase does the following, in order (`durable:src/harness/tool.ts:135-179` @1.4.0):
  1. Resolves the tool, prepares and validates the arguments, and runs the `beforeTool` hooks (which may block or rewrite).
  2. Re-validates.
  3. Commits `{phase:"execute", arguments: final, replay: tool.replay ?? "unsafe"}` as the task checkpoint.
  4. Runs `execute()`.

  Recovery (`execute` phase, `:180-198`) reruns only `if (replay === "safe" && tool?.replay === "safe")`. Otherwise it settles the call with "Tool X was interrupted and may have partially run" and a `failed` ending, which also aborts owned conversations. An abort after a restart distinguishes `interrupted` (intent committed) from `abandoned` (not started) (`:200-211`).
- *Why:*
  - **author says** the commit "durably records the final arguments and resolved replay policy before execution" and that "Omitted `replay` is `unsafe`" (spec §7.3, `docs/spec.md:3456` and `:3152` @fdce48e; corrected 2026-10-26: both quotes are in §7.3, not §8.4).
  - **inferred** for the *dual* check: a call recorded `unsafe` must not be upgraded by a later redefinition, and a tool redefined as `unsafe` must not be rerun on the strength of an old record.
- *Consequence:*
  - The harness never re-executes an unsafe effect, so the harness is at-most-once for those tools.
  - The model sees "interrupted" and may re-issue the call, so at the system level duplication is possible (withone.ai, §3).
  - None of the built-in `read`/`write`/`edit`/`bash` tools declares `replay`. They are all unsafe. Only `codemode` (`codemode.ts:245`) and `tool_search` (`tool-search.ts:62`) are `safe`.
  - Live output is committed at most every 100 ms (`agent.ts:34-37`), so "interrupted" carries the committed partial output.

**D6. Nested calls are keyed tasks owned by the caller.**
- *What:*
  - `api.executeTool(name, args, ctx, {key?, progress?})` creates a `pi.tool` task of kind `"nested"` (`tool.ts:62-72`).
  - Each call gets a `NestedCallDoc` family member keyed by the call key, holding `{taskId, result?}` (`:101-114`). The key defaults to call order (`:306-307`).
  - A replay-safe caller reattaches. A non-safe caller's unfinished nested calls are `abandonOnRestart` (`:303-305`; README:328-331).
  - Reusing a key with another tool or other arguments throws (`types.ts:270-274`).
- *Why (author says):* "Keys … let a replay-safe caller's rerun reattach to its nested calls" (CHANGELOG 1.2.0). This is "not exactly-once execution" (`types.ts:273`).
- *Consequence:* MCP bridges and code mode become durable. Nesting depth is unbounded (README:331).

**D7. Code mode: deterministic replay of a model-written script from a journal.**
- *What (code shows, `codemode/codemode.ts:10-34` @1.4.0):*
  - QuickJS VM with a virtual clock, seeded randomness and UTC.
  - Each result delivered to the script is first written to `pi.codemode.journal` (VM call ID, clock value, result).
  - On rerun the script is replayed against the journal and reattaches to nested calls by key.
  - Divergence, a VM fingerprint change, a module version change or a passed deadline ends the call with an error.
- *Cost (author says):* "one journal commit and one count commit per result, on top of its nested calls' own" (`:23-25`).
- *Consequence:* this is the only place pi-durable gives replay of arbitrary logic. It works because the VM is deterministic. Normal tool code is not.

**D8. Generation: re-send on recovery, partial becomes `aborted`, backoff as durable sleep.**
- *What:* `pi.generation` phases are `prepare → request → retry/poll → tools` (`harness/generation.ts:122-300` @1.4.0).
  - `prepare` pins the model, thinking level, stream options and cutoff into the checkpoint (`:67-77, 133-207`).
  - `request` first converts any committed partial into an assistant entry with `stopReason:"aborted"` (`:212-217, 431-439`), then streams anew with a persisted provider `sessionId` (`:226-233`).
  - Retries: default 3, base 2 s, max agent delay 60 s (`agent.ts:20-25`). A retry is a committed `retry` checkpoint followed by a durable sleep (`:238-250`).
  - Deferred-response providers store a `handle` and `pollAt` and poll without re-sending (`:252-263`).
- *Why (author says):* the checkpoint comment reads "a resend after recovery uses them unchanged" (`generation.ts:73`). Spec §8.3: "Recovery resends the same committed messages with the same pinned model, thinking level, and stream options, and reruns `beforeRequest`."
- *Why (inferred):* provider streams cannot be resumed, so the only choices after a crash are re-send or fail. Re-sending keeps unattended runs alive.
- *Consequence:* a crash during streaming repeats spend and may give a different answer. Re-sends are not counted against `maxRetries`. The crash-loop guard is the only bound (D9). This produced #11139.

**D9. Crash-loop guard (restart counting and parking).**
- *What:*
  - `TaskScheduler.open` rewrites every surviving `running` task to `pending` with `restarts+1` in one commit (`scheduler.ts:374-405` @1.4.0).
  - Reaching the limit parks the task and reports `task_parked` once (`:406-412`). Limit: default 5; `Infinity` never parks (`agent.ts:56-62`).
  - A committed state change clears the count (`progressed()`, `:1955-1962, 2466-2471`), and so does `retryTask()` (`:433-442`).
  - An abort handler cut off 5 times ends the task `faulted` (`:1521-1523`).
  - Shipped in 1.4.0 (commit `a30c2a8`, 2026-10-18).
- *Why (author says):* "Work that deterministically crashes its process, by exhausting memory or CPU before its next checkpoint, would otherwise be resumed and crash again forever." (README:216)
- *Consequence (author says):* "Every task running when a process dies is counted" (README:216). On a Durable Object "resuming is routine" and the counter blames innocent tasks (badlogic, #11139). A parked generation leaves its conversation busy, with no `runFailure` state yet (#11139, #11327 open).

**D10. Submissions and inbox with `requestId` dedupe inside the commit.**
- *What:*
  - `admitSubmission` first calls `tx.submissionByRequest(conversationId, requestId)` and returns the existing submission (`harness/submissions.ts:201-218` @1.4.0).
  - Otherwise it queues into `pi.inbox` (steer, follow-up, write) or places the input and starts a run (`:219-282`).
  - Display-only writes settle `done` at once (`:220-228`). `whenBusy:"reject"` throws `ConversationBusy`.
  - The SQLite index `(conversation_id, request_id)` is **not UNIQUE** (`migrations.ts:63`; still true on main).
- *Why (author says):* "A retried submission with the same `requestId` returns the existing submission instead of submitting twice" (README:129).
- *Consequence:* idempotent admission for one owner. The check is a read through the in-memory transaction under the single mutation line. Two processes can both miss and both insert (inferred).

**D11. Storage errors are fatal; the kernel never retries.**
- *What (code shows):* "the first error a Storage method throws … fails the Session … Nothing retries: transient errors are the Storage's to retry. Reopening recovers from what was committed." (`session.ts:115-119` @1.4.0; README:823-835)
- *Why (inferred):* after an unknown storage outcome, in-memory trackers may be ahead of or behind disk. Failing closed and reopening from committed state is the only consistent option.
- *Consequence:* hosts must supervise and reopen (`harness.closed`, README:829-833).

**D12. Single owner per storage, no lease.**
- *What:*
  - **author says** "One process owns a storage at a time; there is no cross-process locking." (README:790 @1.4.0, :783 @fdce48e)
  - Spec §7.5: "Old and new Harness instances must never own the same Session concurrently."
  - **code shows** no lock, lease or owner row in SQLite (raw `main` storage.ts and migrations.ts, 2026-10-26).
  - IndexedDB: "One owner must hold the database at a time; use a Web Lock" (README:769-771). The code does not take the lock (`storage/indexeddb.ts:377` comment only).
- *Why:*
  - **author says** spec §13 rules out "CRDT/offline multi-writer merge".
  - **inferred:** the target hosts each supply exclusion. A CLI owns its file; a Cloudflare Durable Object is single-instance per ID; a browser tab can hold a Web Lock.
  - Post-pin direction (**author says**): `readOnly` Harness for "a viewer of a session another process drives" (`be14d97`, mitsuhiko, 2026-10-22, on main). "replicate storages as a commit log" (`ReplayableStorage`, `ReplicatingStorage`, outbox; `4c25119`) was reverted the same day: "The work continues on the replication branch" (`cae9fd2`). Neither adds fencing.
- *Consequence:* see §9.1.

**D13. Durability knobs are left at backend defaults.**
- **code shows** SQLite: WAL with `synchronous=NORMAL`, so the newest commit can be lost on power or host failure (README:765; `chord:src/sqlite/node.ts:237-238` @fdce48e). Each commit is `BEGIN IMMEDIATE` (`chord:src/sqlite/node.ts:144`). Busy timeout 5 s (`DEFAULT_BUSY_TIMEOUT_MS = 5_000`, `chord:src/sqlite/node.ts:15`). Confirmed in a clone, 2026-10-26.
- **code shows** JSONL: `fsync` defaults to false (`storage/jsonl/storage.ts:78-79, 257`). With it, each sidecar is flushed before the main marker (`:295-302`). JSONL keeps the whole history in memory (README:766).
- Durable Object: commits are the object's storage transactions (README:767).
- *Consequence:* "durable" means durable across a process crash by default, not across power loss.

**D14. Extensions stored by name, resolved per phase.**
- *What (author says):*
  - Conversations store extension and tool *names* in `pi.agent`, resolved against the in-process registry at each phase (README:104, 401, 472).
  - "By default every conversation selects every installed extension" (README:243).
  - After a restart the host must reinstall, or tasks stay blocked (`missing_task`).
- *Consequence:* code is never persisted, so hot reload is safe. Behaviour after a restart depends on what the host reinstalls.

**D15. Observation derives from commits.**
- *What (author says):* `viewState`/`watch` deliver Chord ops per commit. A slow watch keeps at most 100 frames, then gets one snapshot. "nothing is replayed" to late joiners (README:476-500). `watchEvents` is experimental (README:590-604), and badlogic proposes removing it (#11327).

**D16. Content-free telemetry and typed reports.**
- *What (author says):*
  - `DURABLE_TELEMETRY_SCHEMA` spans, events and metrics carry IDs and control metadata only, except diagnostics capped at 500 characters, which "can contain caller content" (README:82-90).
  - `onReport(error, info)` types: `session_failed`, `task_faulted`, `task_parked`, `migration_failed`, `task_outdated`, `task_error`, `extension_error`, `host_error`, `listener_error` (README:218).

## 5. Capability inventory

Licence for all rows: MIT (pi monorepo). Copy the root notice: the npm tarball lacks a LICENSE file. "Reproduce" means what Assay or any successor must build, and which storage-engine features it relies on.

| ID | Capability | How implemented (files @1.4.0 unless noted) | Inputs → outputs | Limits | To reproduce elsewhere |
|---|---|---|---|---|---|
| PID-C01 | Serial mutation line, publish after store | `session/session.ts:106-120, 720-767, 896-903` | commit callback → `Seq`, publication to watchers | One process. Strictly serial commits. Main stores partials up to 1 s late | An in-process async queue, or a DB write lock. The engine needs atomic multi-row transactions |
| PID-C02 | Atomic multi-record commit with monotonic `Seq` | `types.ts:1181-1183`; `storage/sqlite/storage.ts:187-210` (metadata row `next_seq`) | `StorageWrite[]` → `Seq` | Single SQL transaction per commit | A transaction plus a sequence counter row. SQLite `BEGIN IMMEDIATE` (chord) or any ACID store |
| PID-C03 | Global numeric ID minting | `storage.ts:168-177, 212-216, 655-689`; `record_ids` table `migrations.ts:21-24` | → branded ID | In-memory counter; unsafe with two processes; ID 1 is root | Mint inside the commit transaction (`UPDATE … RETURNING`) or use UUIDv7. Keep a PRIMARY KEY |
| PID-C04 | Immutable transcript entries with head markers | `types.ts:428-443`; `entries` table `migrations.ts:33-41`; `findLatestHeadMarker` `types.ts:1215-1219` | entry drafts → `EntryRecord` | No delete API (#11026 open) | Append-only table plus a partial index on `head` |
| PID-C05 | Conversations, ownership edges, forks at an entry | `types.ts:397-409`; `session/forks.ts`; README:627-634 | parent + entry → new conversation | Fork history scans through ancestor chain (conformance `:367`) | Parent pointer plus an ancestry-aware scan |
| PID-C06 | Typed JSON documents with base/delta revisions, scopes and families | `documents.ts`; `document_revisions` `migrations.ts:66-89`; `defineDoc` README:728-749 (`checkpointWhen` required since 1.4.0) | doc definition + edits → revisions, ops | Chord-coupled. Retention 10 min in memory | Hardest to port: needs a delta/op engine (chord) or a simpler "whole JSON per commit" store |
| PID-C07 | Durable task state machine with versions and migration | `tasks.ts`; `types.ts:217-230, 599-704`; `scheduler.ts:2480-2486` | definition + input → `TaskRecord` | Phase reruns from top; must commit progress | Tasks table (status, kind, JSON record) plus a phase-dispatch loop |
| PID-C08 | Child tasks, waiting (`allSettled`/`failFast`), completing, bottom-up abort, background boundary, wait-cycle rejection | README:683-708; `scheduler.ts` (ownership indexes); CHANGELOG 1.2.0 (#10411) | `waiting` state with `on[]` | In-memory ownership index (bounded by live work) | Owner column plus join-wait logic, plus cycle detection |
| PID-C09 | Durable sleep, timers, host wake | `types.ts:622-631`; `scheduler.ts:1341, 2488-2494`; `timers.ts`; README:140-212 | `sleepUntil(until, checkpoint)` → `sleeping` | All processes must share one clock (README:164) | A `sleeping` status with `until`, plus a timer or alarm. SQLite needed a table rebuild for the CHECK constraint (`migrations.ts:91-112`) |
| PID-C10 | First-writer-wins task memos | `scheduler.ts:2154-2162, 2440-2444`; `types.ts:279-282, 697-698` | name + candidate → winner | Stored inside the task JSON; dropped at terminal | A JSON field or side table with insert-if-absent inside the transaction |
| PID-C11 | Crash recovery on open | `scheduler.ts:374-417` | storage → running→pending, restarts+1 | Resumes *everything* live; assumes sole owner | One startup sweep transaction, or lease expiry per task (absurd/Assay) |
| PID-C12 | Crash-loop parking and retry | `scheduler.ts:395-411, 1365-1367, 1504-1523, 433-442`; `agent.ts:56-62` | `restartLimit` (5) → `blocked: restart_limit`, `task_parked` report | Blames all running tasks; parked run keeps conversation busy | Per-task crash counter reset on progress, plus a parked state and an unpark API |
| PID-C13 | `abandonOnRestart` | `types.ts:665-672`; README:351-353; `scheduler.ts:393` | flag → abort with `abortReason:"restart"` | Waits for its definition to run its abort handler | Flag column plus a startup cascade |
| PID-C14 | Intent before effect for tools | `harness/tool.ts:74-77, 135-179` | call → checkpoint `{execute, arguments, replay}` → result entry | Hooks before intent may rerun | Intent row committed before the effect; outcome row after. Any ACID store |
| PID-C15 | Dual replay policy, interrupted/abandoned results | `tool.ts:180-211`; `types.ts:305` | stored + current policy → rerun or `interrupted` | Only `safe`/`unsafe`; no `keyed`. Built-in tools all unsafe | Policy enum on the intent; recovery rule. Add a `keyed` mode that passes a stable key to the effect (pi roadmap #10624) |
| PID-C16 | Keyed nested tool calls with reattach | `tool.ts:87-114, 300-340`; `types.ts:264-275, 292` | `executeTool(name,args,{key})` → `NestedToolExecutionResult` | Unbounded depth; not exactly-once | Child task per call, plus a (parent, key) unique index |
| PID-C17 | Tool exposure: `callers`, `modelTools`, deferred tools, `tool_search` (BM25) | `types.ts:324-329, 420`; `tool-search/tool-search.ts`; README:333-349 | registrations → offered/callable lists | Selection stored by name | Plain registry logic. No storage needs |
| PID-C18 | Generation task (prepare/request/retry/poll/tools) | `harness/generation.ts:56-300, 431-576` | conversation context → assistant entry, tool tasks | Re-sends on crash; retries 3 × 2 s base | Phase machine plus a provider adapter. Record a "resent" marker (not done in pi) |
| PID-C19 | Partial-as-aborted salvage | `generation.ts:431-439, 441-498`; progress throttle 100 ms `agent.ts:34-37` | committed partial → `pi.assistant` with `stopReason:"aborted"` | Loses at most the throttle window (main: up to `persistWithinMs`) | Throttled upsert of a live row, converted on recovery |
| PID-C20 | Per-conversation provider session ID (UUIDv7) | `harness/provider.ts:1-40` | → `sessionId` to pi-ai | Cache affinity only, not idempotency (inferred) | Store one UUID per conversation |
| PID-C21 | Submissions with `requestId` dedupe and inbox modes (steer, follow-up, write, reject), `afterFailedRun` | `harness/submissions.ts:191-283`; `harness/inbox.ts`; `types.ts:466-560`; README:504-537 | submission draft → `Submission` (`queued/placed/done/unanswered`) | Non-unique index; single-owner correctness | Submissions table with **UNIQUE(conversation_id, request_id)** |
| PID-C22 | Compaction (background, blocking, overflow retry, stale cut, per-model overrides) | `harness/compaction.ts`; README:550-588; CHANGELOG 1.4.0 `modelOverrides` | thresholds → `pi.compaction` entry | Tested with the faux provider only (prior notes) | Summariser call as a task; head-marker entry |
| PID-C23 | Extensions, registry, hooks, sections, wraps; hot reload | `harness/define.ts`, `registry.ts`, `prompt.ts`; README:224-243, 462-472, 606-625 | extension objects → resolved agent per phase | All installed selected by default; host reinstalls after a restart | In-process plugin registry; store names only |
| PID-C24 | Code-mode deterministic replay journal | `codemode/codemode.ts:1-340, 492-497, 739, 884` | script → journaled results, nested calls | 2 commits per result; needs a deterministic VM (QuickJS via pi-codemode) | Deterministic sandbox plus a journal table keyed by call order |
| PID-C25 | Storage backends: Memory, SQLite (Node, DO, prefix, migrations), JSONL, IndexedDB | `storage/memory.ts`, `storage/sqlite/*`, `storage/jsonl/*`, `storage/indexeddb.ts`; README:759-799 | — | SQLite `synchronous=NORMAL`; JSONL no fsync by default, all in memory; IndexedDB owner lock left to host | Per-engine adapter, about 1k lines each, against C26 |
| PID-C26 | Storage conformance kit (25 cases) | `testing/storage-conformance.ts` (cases at `:98-1674`); `registerStorageConformance` README:801-815 | storage factory → Vitest/Jest cases | No crash, torn-write, two-owner or concurrency cases | Port the case list. Add kill-at-step-k, two-owner, power-loss |
| PID-C27 | ExecutionEnv interface, Node env, env conformance | `env/index.ts`, `env/node.ts`, `testing/env-conformance.ts` (634 lines) | per-call env → files, exec (shell or argv), watch | No sandbox; bash inherits `process.env` (`tools/bash.ts:76`; `env/node.ts:273-277`) | Interface plus conformance. Swap in a sandbox |
| PID-C28 | Coding tools: read, write, edit, bash, powershell | `tools/*.ts`; `truncate.ts`; per-file mutation queue `tools/file-mutation-queue.ts` | args → bounded output, spill file | No default timeout (`bash.ts:12`); not replay-safe; copies of pi-coding-agent | Reuse from a donor; add timeout, env allowlist, keyed exec |
| PID-C29 | Views, watches, agent events, task graph, `inspect()` | `harness/view.ts`, `events.ts`, `task-graph.ts`, `harness.ts:292-367` | commits → Chord states/ops | Watch backlog 100; no resume (#11327) | Derive views from the commit stream; add a cursor |
| PID-C30 | Content-free telemetry and typed reports | `harness/telemetry.ts` (140 lines); README:82-90, 218 | spans/events/metrics | Diagnostics up to 500 chars may include content | Fixed schema; opt-in |
| PID-C31 | Usage and cost accounting | `harness/usage.ts`; README:751-757 | per provider/model and per tool totals in `pi.usage` | No budget enforcement | Counter document per conversation |
| PID-C32 | Error model: storage-fatal, `SessionFailed`, `closed` promise, `StorageRequestError` for bad reads | `errors.ts`; `session.ts:115-119, 222-225`; README:819-835 | — | Host must reopen | Fail-closed wrapper around storage calls |
| PID-C33 | Read-only Harness (viewer) — **main only, post-pin** | `be14d97` (2026-10-22): `HarnessOptions.readOnly`, `ReadOnlySession` | open without recovery; writes rejected in process | Local flag, not a lock | Read-only open mode that skips recovery |
| PID-C34 | Deferred commits of partials — **main only, post-pin** | `6c2fd73` (2026-10-24); `settings.progress.persistWithinMs` (1,000 ms) | display now, store later | Breaks spec §13 "no visible-undurable publication" for partials | Optional. Avoid if "nothing shown before stored" is a product promise |
| PID-C35 | Cloudflare Durable Object hosting and wake protocol | `storage/sqlite/cloudflare.ts` (adapter via chord); `Harness.wake()`/`onWake` README:166-212; shared operation queue per storage object (CHANGELOG 1.3.0) | alarm → `resume()` | Exclusion comes from the platform; #10857 (sleep wakes only on the next request) open | Map one session to one single-writer actor; an alarm per earliest sleep |

**Count: 35 capabilities.** 33 are present at or near the pin; C33 and C34 exist only on main.

## 6. Workloads

- **Concurrency in one process.**
  - **code shows** many conversations, tasks and tools run concurrently, with tool rounds `"parallel"` by default (`agent.ts:77`). Every commit still passes through one serial line (C01).
  - **author says** the CHANGELOG 1.2.0 benchmarks (single runs, no environment stated):
    - 32,000 one-item appends: 11.3 s → 1.4 s.
    - A chain of 500 owned tasks: 12 s → 50 ms; 20,000 tasks: 1.5 s.
    - 8,000 parallel nested calls: 18.8 s → 2.7 s.
  - **inferred:** throughput is bounded by storage commit latency × commits per step. Code mode costs 2 commits per result, plus the progress commits every 100 ms per streaming generation or tool.
- **Multiple processes.**
  - **author says** this is not supported (README:790; spec §7.5).
  - **code shows** SQLite gives per-commit atomicity only. In-memory caches, ID counter, live-task index and dedupe all assume a sole writer (§9.1).
  - **author says** the post-pin direction is a single driver with read-only viewers and replication (D12).
  - **users report** cross-process watchers see no events (#10749).
- **Long runs.**
  - Durable sleeps hold no invocation (C09). Retry backoffs and deferred polls became sleeps in 1.4.0.
  - Compaction bounds context. The document cache (10 min) and context cache (10 min) are bounded (CHANGELOG 1.2.0).
  - JSONL holds the whole history in memory (README:766).
  - Durable Objects hibernate when `onWake` is used (README:166-212).
  - **inferred:** a multi-day run is supported in design. No public report of one exists.
- **Retries.**
  - Generation: 3 retries, base 2 s, max 60 s (`agent.ts:20-25`). The schedule comes from pi-ai's `retryDelayMs`.
  - A context overflow triggers compaction and one retry (README:584).
  - Tools are never retried by the harness. A thrown error becomes an error result for the model.
  - Storage is never retried (D11).
- **Failure handling.**
  - A phase throw makes the task `faulted` and is reported (`task_faulted`).
  - A missing definition blocks the task (`missing_task`); a missing migration marks it `migration_failed`/`orphaned`.
  - A crash loop parks the task (C12). Abort handlers run bottom-up (README:706).
  - A storage error fails the Session closed (C32).
- **Duplicate or overlapping effects.**
  - Input admission: `requestId` (C21). The README's subagent example keys child input by `subagent:${api.taskId}` (README:663).
  - Tool effects: intent plus `unsafe` default, so the harness never repeats them (C14/C15). The *model* may repeat them, because "interrupted" is a prompt, not a guard (withone.ai). Replay-safe tools "still need their own idempotency" (README:328).
  - Nested calls: keys (C16).
  - App effects: the effect sandwich plus first-writer-wins memos (C10; spec §5.2).
  - Model calls: **not deduplicated**. They are re-sent on recovery (D8).
  - Overlapping inputs merge by inbox mode. Steers join the current run after the tool round; follow-ups start the next run (README:515-519).
  - Two owners: nothing prevents duplicates. Both resume the same work, and records can be overwritten (§9.1).

## 7. Organisation

- **Maintainers.**
  - **code shows** commits on `packages/durable` are about 72% badlogic (Mario Zechner) and about 24% mitsuhiko (Armin Ronacher), with christianklotz, davidbrai and petrroll occasionally.
  - Issue triage is mostly badlogic (assignee on the durable issues read). davidbrai labels and reopens.
  - npm publishers: mitsuhiko, badlogic, rwachtler.
  - Earendil (Ronacher's company) acquired Pi in April 2026 (third-party reports: 2026-04-08).
- **Cadence.**
  - About 195 commits in 38 days (2026-09-18 to 2026-10-25), about 5 per day.
  - 1.x releases: 1.0.0 (10-01), 1.0.1 (10-03), 1.0.2 (10-04), 1.0.3 and 1.0.4 (10-05), 1.1.0 (10-07), 1.2.0 (10-12), 1.3.0 (10-15), 1.4.0 (10-21).
  - Versions are lockstep across the monorepo (prior notes: `scripts/publish.mjs:34`).
  - Breaking changes ship in minor and patch releases (§1).
- **Triage rules** (**author says**, `CONTRIBUTING.md` @fdce48e):
  - "All issues and PRs from new contributors are auto-closed by default."
  - "Maintainers review auto-closed issues daily and reopen worthwhile ones."
  - "Only `lgtm` grants rights to submit PRs."
  - "Issues submitted Friday through Sunday are not guaranteed to be reviewed."
  - "Using AI to write code is fine. Submitting AI-generated slop without understanding it is not."
  - Maintainers add changelog entries ("Do not edit `CHANGELOG.md`").
  - Larger changes go through RFCs, some public at rfc.earendil.com.
- **Agent rules** (**author says**, `AGENTS.md` @fdce48e): "Do not preserve backward compatibility unless the user asks for it." "Released version sections … are immutable." "Never commit unless the user asks." Run `npm run check` and `./test.sh`.
- **Roadmap signals** (**author says**, issues):
  - #10624 keyed exec and replay-safe bash (open, badlogic).
  - #11327 replace `watchEvents` with a windowed `ConversationView`; `runFailure` state (open).
  - #11139 restart-counter rework (open, "on hold").
  - The replication branch (`cae9fd2`).
  - The read-only Harness (landed on main).
  - Open user asks: delete a conversation (#11026), approval and client-side tools (#10852), turn limit (#11043), admit a submission inside a host commit (#11149).
- **Observed triage behaviour** (**code shows**, GitHub):
  - Several design issues have no maintainer reply (#10386, #10852).
  - An AI-drafted cross-process issue got a dismissive reply and was closed without explanation (#10749).
  - The org blocked one commenter on #10852 (2026-10-16, no reason given).

## 8. Documentation, notes and metadata: what it journals and how

- **Docs.**
  - README: 876 lines @1.4.0 (869 at the pin; corrected 2026-10-26).
  - Normative `docs/spec.md`: about 5.6k lines, sections 1-13, with goals as invariants, a footguns list (§12) and non-goals (§13).
  - CHANGELOG with dated, detailed breaking-change notes.
  - 32 examples (`test/examples/00-…` to `31-…`, confirmed in a clone at `fdce48e`).
  - The spec is not in the npm tarball.
- **Persistent records** (SQLite schema v2, `migrations.ts:14-112` @1.4.0; all STRICT):
  - `metadata`: singleton `next_id` (TEXT), `next_seq`.
  - `record_ids`: `id`, `record_type`.
  - `conversations`: `id`, owner columns, JSON record.
  - `entries`: `id`, `conversation_id`, `head`, `commit_seq`, JSON record.
  - `tasks`: `id`, `conversation_id`, `kind`, `status`, `abort_requested`, `background`, JSON record.
  - `submissions`: `id`, `conversation_id`, `request_id`, `status`, JSON record.
  - `documents`: `id`, `kind`, `family`, `key_value`, `scope_kind`, `owner_id`, `created_at`, `retired_at`, JSON record.
  - `document_revisions`: `document_id`, `seq`, `kind` base or delta, `version`, JSON content.
  - Optional table prefix (README:773-777).
- **IDs.** One numeric space for every record type. Creation order equals ID order (`types.ts:1185-1188`). Seq is per commit. Provider session IDs are UUIDv7 (`provider.ts:18`).
- **Task record** (`types.ts:645-704`): `id`, `conversationId`, `kind`, `version`, `input`, `owner`, `background`, `abortRequested`, `abortReason`, `abandonOnRestart`, `startedAt`, `endedAt`, `restarts`, `state` (status, checkpoint, `on`/`policy`/`until`, or `outcome`), `memos`, `trace`, `links`.
- **Tool journal.** Intent is the task checkpoint (`tool.ts:74-77`). Results are `pi.tool-result` entries with `durationMs` (CHANGELOG 1.1.0), or `NestedCallDoc` for nested calls. Live progress is in the `pi.live` doc.
- **Entry kinds:** `pi.user`, `pi.assistant` (api, provider, model, response model, usage, `durationMs`; main adds `thinkingLevel`), `pi.tool-result`, `pi.system`, `pi.reset`, `pi.compaction`, plus host kinds (README:96).
- **Built-in documents:** `pi.agent` (rewindable, base on every change, `agent.ts:43-51`), `pi.provider`, `pi.live`, `pi.inbox`, `pi.usage`, `pi.codemode.journal`, `pi.tool.nested-call`.
- **Logs.** No text logs. Reports go through `onReport` and telemetry spans and events (C30). JSONL storage is itself an append-only log with commit markers (`jsonl/storage.ts:186, 301`). No tamper evidence or hashing. The prior notes found sha256 used only for change detection.

## 9. Known problems and challenges

1. **Two-process overwrite: still true at 1.4.0 and on main (2026-10-26).** **code shows** the sequence:
   - Process A and process B each open the same SQLite file and read `next_id = N` (`storage.ts:172-176`).
   - Each mints N from its private counter (`:212-216`).
   - A commits task N. B then commits its own task N. `checkGlobalIds` lets a same-type ID through (`:682-685`), and the upsert replaces A's record (`:818-834`). Submissions behave the same way (`:835-846`).
   - Conversations, entries and documents collide loudly instead. The commit throws (`:679-681`), which fails B's Session.
   - **inferred:** a fix needs mint-inside-transaction, or refreshing `this.nextId` from the `next_id` read at `:192-196`, *plus* an owner lease or fence. The ID fix alone still leaves both processes resuming the same work (`scheduler.ts:374-405`).
   - No test covers two owners. The conformance kit has no such case (§5, C26).
2. **Model requests are re-sent after a crash** (spec §8.3; `generation.ts:73, 209-236`). Spend is repeated and the answer may differ. Nothing marks the re-send. **users report** combined with OOM this loops (#11139).
3. **The restart counter blames every running task**, and a parked generation leaves its conversation busy with no reason recorded (README:216; badlogic on #11139; #11327 `runFailure` proposed, open).
4. **"Interrupted" relies on the model.** An unsafe tool is never re-run by the harness, but a model can re-issue it (withone.ai: Haiku 4.5 duplicated a Gmail draft). None of the built-in tools is replay-safe or keyed (C15). The fix exists only as a roadmap issue (#10624).
5. **`requestId` dedupe is not backed by a UNIQUE index** (`migrations.ts:63`, main unchanged). It is correct only under the single mutation line.
6. **Durability defaults.** SQLite `synchronous=NORMAL` can lose the newest acknowledged commit on power loss (README:765). JSONL `fsync=false` by default, and holds all history in memory (README:766; `jsonl/storage.ts:257`).
7. **Main weakens "nothing shown before stored"** for partials, up to 1 s by default (main CHANGELOG [Unreleased]; `6c2fd73`). This contradicts the spec's non-goal "visible-undurable publication" for that data.
8. **Agent-safety defaults** (prior notes; re-confirmed at 1.4.0):
   - bash has "no default timeout" (`tools/bash.ts:12`) and `inheritEnv: true` (`:76`), which copies `process.env` (`env/node.ts:273-277`).
   - Every installed extension is selected by default (README:243).
   - Nesting is unbounded (README:331).
   - No approval or pause flow (#10852 open).
   - No turn or token budget (#11043 open).
9. **Unstable API and one-way migrations.** "The API changes without notice" (README:3). Schema v2 cannot be opened by 1.3.0 (CHANGELOG 1.4.0 line 9). The reverted replication commit would have added v3.
10. **No deletion or retention API** for transcripts (#11026 open). Reset and compaction keep old entries (README:541, 552).
11. **Observation gaps.** No cross-process notification (#10749). No stream resume (#11327). A sleeping task on a Durable Object woke only on the next request (#10857 open; partly addressed by `onWake` in 1.4.0).
12. **Licence file missing from the npm tarball** (code shows: tarball listing).
13. **Production mileage unknown.** pi's own coding agent does not run on pi-durable (npm deps @1.4.0). Public evidence is two small experiments (§3).

**Open questions.**
- Will the replication branch add any fencing or term number?
- Will the restart counter be scoped to the task that killed the process, and how would it know?
- Will keyed exec make `bash` replay-safe by default?
- What exactly does `adopt(seq)` inside the commit (main) change for custom storages?
- What do the HN thread and the Earendil posts say verbatim? Not read: hosts unreachable.

## 10. Lessons for a successor (Assay)

**Keep**, with reasons:
- **Intent before effect, with the policy stored on the intent and re-checked against the current definition** (C14/C15). It is small, readable, and answers "did this effect possibly happen?" The dual check stops silent policy upgrades.
- **Phase-reruns-from-top plus the effect sandwich plus first-writer-wins memos** (D4, C10). This is the simplest crash model that does not need deterministic user code.
- **Crash-loop parking, with the count reset on committed progress** (C12). It is cheap and stops OOM loops. Keep the explicit `retryTask`/unpark.
- **`requestId` idempotent admission** (C21), but enforce it with a UNIQUE constraint.
- **Partial-as-aborted salvage** (C19). The transcript stays honest about what the model produced before the crash.
- **One storage contract certified by a conformance kit** (C26). Port its 25 cases, and add the missing ones: kill at step k, two owners, power-loss simulation.
- **Fail closed on any storage error and reopen** (C32).
- **Content-free telemetry and typed report reasons** (C30).

**Avoid** (or fix), with reasons:
- **In-memory ID minting and whole-record upsert without a fence** (§9.1). Mint in the transaction, and make every attempt-scoped write check a lease or attempt number. Assay's `fence()` (`apps/assay/src/kernel/kernel.ts:462-473`) is the right shape.
- **No lease.** Even a single-owner design should take an owner row with expiry at open, so that an accidental second open fails with a typed error instead of corrupting state.
- **Silent model re-sends.** Record each re-send as an event, count it against a budget, and surface it.
- **Treating "interrupted" as sufficient protection.** Offer a `keyed` policy that hands the effect a stable key (`taskId/n`), as pi's #10624 and Assay do. Make the harness, not the model, own dedupe for external writes.
- **A restart counter that charges every running task.** Track which attempt held the lease when the process died, or count per attempt start.
- **Weakening "nothing shown before stored"** (main's deferred partials), if the product promise is evidence-grade.
- **Permissive tool defaults** (bash environment, no timeout, every extension enabled).

**Unknown** (insufficient evidence):
- Real-world crash behaviour beyond n≈50 kills in two user reports.
- Performance under contention on SQLite.
- Whether the authors will add multi-writer support or keep single-writer with replicas.
- Durability on Durable Objects under eviction storms.
- Download and adoption numbers.

## 11. Sources (all accessed 2026-10-26)

Code:
- npm `@earendil-works/pi-durable` 1.3.0 and 1.4.0 tarballs, embedded sources: https://registry.npmjs.org/@earendil-works/pi-durable/-/pi-durable-1.4.0.tgz
- npm metadata for `@earendil-works/pi-durable`, `pi-coding-agent`, `pi-env`, `pi-ai`, `pi-agent-core`, `chord`
- `pi-coding-agent` 1.4.0 tarball docs (`session-format.md`, `how-pi-works.md`, `extensions.md`)
- `git ls-remote https://github.com/earendil-works/pi` (main = `d5b3de22d0e2`)
- GitHub web:
  - https://github.com/earendil-works/pi
  - https://github.com/earendil-works/pi/commits/main/packages/durable (pages 1-6)
  - commits `be14d97`, `4c25119`, `cae9fd2`
  - https://github.com/earendil-works/pi/tree/fdce48eb404ec014adaf2ac10a3a53bc6b1740c2/packages/durable/test
- Raw files:
  - `fdce48e`: `packages/durable/docs/spec.md`, `CONTRIBUTING.md`, `AGENTS.md`
  - `main`: `packages/durable/CHANGELOG.md`, `src/storage/sqlite/storage.ts`, `src/storage/sqlite/migrations.ts`
- absurd local clone @`3cfc64f` (`README.md`)
- Prior internal notes: `docs/merger/01-anatomy/pi-durable.md`, `research/rqs-review/reports/pi-durable.md`

Issues (GitHub, earendil-works/pi): #10386, #10624, #10749, #10852, #11139, #11327; label listing `label:durable` (44 issues).

Public (search-result summaries; pages not opened unless noted):
- Earendil posts: https://earendil.com/posts/pi-durable/, https://earendil.com/posts/pi-durable-on-cloudflare/, https://earendil.com/posts/pi-1-0/ (unreachable: DNS)
- HN: https://news.ycombinator.com/item?id=49925969 (unreachable), plus comment items 49927001, 49928041
- Cloudflare: https://developers.cloudflare.com/changelog/post/2026-10-02-pi-harness/, https://developers.cloudflare.com/agents/harnesses/pi/ (unreachable)
- withone.ai: https://www.withone.ai/blog/pi-durable-crash-safe-one-cli (2026-10-02)
- redreamality: https://redreamality.com/blog/pi-durable-agent-harness-durable-execution/
- bokvi: https://blog.bokvi.com/blog/pi-durable-agent-harness/
- flaviocopes: https://flaviocopes.com/pi-durable/
- dev.to: https://dev.to/dishant0406/pi-durable-shipped-then-the-hype-took-over-the-timeline-4k3p
- The Register: https://www.theregister.com/ai-and-ml/2026/10/02/pi-coding-agent-pulls-a-180-and-adds-mcp-support/5300678
- Fragmented #312: https://fragmentedpodcast.com/episodes/312/
- YouTube: https://www.youtube.com/watch?v=ja_7AF54OtE, https://www.youtube.com/watch?v=7mBQknCnovM
- disler/durable-pi: https://github.com/disler/durable-pi (opened)
- Absurd in production: https://lucumr.pocoo.org/2026/4/4/absurd-in-production/ (unreachable)
- Searched with no relevant result: Reddit, X/Twitter (Mario Zechner, durable), mariozechner.at (unreachable)
- Not obtained: npm download counts (api.npmjs.org blocked; npmjs.com 403)

