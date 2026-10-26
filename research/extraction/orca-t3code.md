# Extracting from Orca and T3 Code: parallel agents, subscription logins, several accounts

These notes cover three questions:
1. How does Orca delegate work and run it in parallel?
2. How does T3 Code use a person's own subscription logins instead of API keys?
3. How can one client work with several accounts, or combine usage across clients?

For each mechanism they give its location, how it works, and whether it can move to another project:
- **lift as is**: copy it with the notice;
- **adapt**: copy it, then change named parts;
- **pattern**: rewrite it, keeping the idea.

They also give the [RQS-2030](../../standard/RQS-2030.md) criteria a reused part must meet.

Sources:
- `stablyai/orca` at `997d34b0`, MIT, © 2026 Lovecast Inc.
- `pingdotgg/t3code` at `7e289ae1`, MIT, © 2026 T3 Tools Inc.

Both are MIT-licensed, so code can be reused if the copyright and licence notice is kept. The study was static: the code was read, but nothing was built or run. Paths are relative to each repository (Orca paths under `src/`).

## 1. Orca: delegation and parallel work

### How it works

**A task becomes a worker.**
- A coordinator agent calls `orca orchestration worker-start` once per task.
- Each call creates a Task and its first attempt (a dispatch) in one step.
- It then starts the agent CLI in a fresh terminal. By default that terminal is in the coordinator's current workspace; Orca creates a git worktree for a worker only when the user asks for one or sharing the checkout is unsafe (`skill-guides/orchestration/references/placement-and-remote.md:8-11`). *(corrected 2026-10-26, see [docs/profiles/orca.md](../../docs/profiles/orca.md))*
- It sends the worker a preamble: the exact commands for reporting back.
- Key files: `main/runtime/rpc/methods/orchestration/worker/workers.ts:36-92` and `local-worker-start.ts`.

**One worktree per worker.**
- One worktree per task is the human workflow. Orchestrated workers share the current workspace by default, so overlap is controlled by an "Ownership" line in each task spec, not by isolation. *(corrected 2026-10-26, see [docs/profiles/orca.md](../../docs/profiles/orca.md))*
- Worktree names are cleaned and kept inside the workspace (`ipc/worktree-logic.ts:28-115`).
- The repo's `orca.yaml` setup script runs with a 120 s deadline and is killed as a whole process group (`main/hooks.ts`).
- Removal is a separate step, with at most two deletions at a time.

**A ledger, not a scheduler.**
- A SQLite file (WAL mode) holds runs, tasks (with dependencies), dispatches, decision gates and per-recipient mailboxes.
- Messages include `worker_done`, `escalation`, `question` and `heartbeat` (`main/runtime/orchestration/db/`).

**The coordinator loop.**
1. `check --wait` for `worker_done`, `escalation` or `question`.
2. `reply` or `worker-release`.
3. `check --ack`.

A valid `worker_done`, sent exactly once, settles the task.

**Safety rules that make it reliable.**
- **Retries are safe.** Every change carries a retry id with a stored receipt. A repeat returns the first result, and a reused id with a different payload is refused (`rpc/orchestration-mutation-executor.ts:100-215`).
- **Ambiguous starts are not guessed.** They become `start_unknown` / `outcome_unknown`, with the next commands to run. Nothing is retried automatically.
- **Liveness is `live`, `exited` or `unverifiable`.** Lost contact is `unverifiable`, never `exited`, and it does not authorize stopping or retrying a worker (`shared/pty-liveness-verdict.ts`).
- **Failures stop after three.** The circuit breaker counts per task: three consecutive failed *starts* of one task fail that task; a worker reporting failure does not count. *(corrected 2026-10-26, see [docs/profiles/orca.md](../../docs/profiles/orca.md))* Nesting depth is 1 by default.
- **The task text must fit.** A prompt budget checks it before anything is created (`shared/orchestration-worker-start-prompt-budget.ts`).

**Status of each agent.**
- Agent hooks POST to a loopback server. Each start gets its own random token.
- The terminal stream carries OSC 7501 status codes (idle, working, blocked, done, error).
- Hook reports win, unless they stay silent for 2 minutes while the terminal stream says otherwise.
- A rule engine reads agent screens. Its rules are size-limited and checked for risky regexes.

**Terminals that survive restarts.**
- A separate daemon process owns the terminals. It reconnects after an app crash, with at most 5 respawns a minute.
- It applies backpressure (pause at 4 MiB in total, 64 KiB per session).
- It restores scrollback from checkpoints.

**Running processes.**
- `packages/process-host` provides timeouts (30 s by default), an output cap (8 MiB) that reports truncation, cancellation, process-tree kill and correct Windows quoting.
- It has no dependencies.

### What to extract

| Part | Verdict | Why |
|---|---|---|
| `src/packages/process-host` | **lift as is** | Self-contained, no dependencies, Node 18 or later; the hardest part to get right |
| OSC 7501 status parser and precedence rule (`shared/program-status/*`) | **lift as is** | Small, a published protocol, already used by pi |
| Retry receipts with idempotent replay, circuit breaker, depth cap, prompt budget | **adapt** | Replace Orca's error type and caller fingerprint; re-derive the budget for your transport |
| Ledger schema (runs, tasks, dispatches, deliveries, messages, receipts, gates) | **adapt** | Drop federation and legacy tables |
| Worker preamble and the coordinator loop | **adapt** | Swap in your CLI name; the protocol carries over unchanged |
| Worktree naming, path guard, setup-hook runner | **adapt** | Replace Orca's settings and path types |
| Response envelope `{id, ok, result \| error{code, message, data.nextSteps}}` | **adapt** | A good contract for agents to call |
| Terminal daemon, hook server, worker-start pipeline | **pattern** | About 35k lines and tightly coupled; keep the ownership protocol, backpressure numbers, respawn throttle and checkpoint restore |

### Defaults to change before reuse

- **Approval bypass is on by default.** Orca launches every agent with its approval-bypass flag (`shared/tui-agent-launch-defaults.ts:18-22`). Start in manual or each agent's own sandboxed mode instead.
- **Folder trust is pre-written.** Orca writes the "trust this folder" setting for Cursor, Copilot and Codex in advance (`main/agent-trust-presets.ts`). Do this only after the person confirms.
- **Repository setup scripts run unattended.** Gate them on trust in that repository.
- **Status rules are downloaded live.** Pin and verify them, or turn the download off.

These are the RQS-2030 AGT-2 (least agency) and AGT-3 (oversight) failures from Orca's review.

## 2. T3 Code: using a person's own logins instead of API keys

There are two separate things here: how T3 uses the person's provider accounts, and how T3 secures its own client and server.

### Provider accounts: four approaches, from safest to riskiest

1. **Delegate to the official tool. This is the default and the one to copy.**
   - **Codex:** T3 starts `codex app-server` with `CODEX_HOME` and asks `account/read` over JSON-RPC (`apps/server/src/provider/CodexProvider.ts:479-535`).
   - **Claude:** T3 uses the Claude Agent SDK and reads only the account summary from initialization (`ClaudeProvider.ts:364-416`).
   - **ACP agents:** T3 asks the agent to `authenticate` using its own method (`provider-acp/src/server/AcpSessionRuntime.ts:1085-1094`).
   - The person's existing `codex login` or `claude auth login` is used. T3 never touches the token, and "not signed in" comes back as a status the interface turns into a sign-in step.
2. **The app signs in itself ("managed" Codex).**
   - T3 runs a browser OAuth flow (PKCE, state, nonce, loopback callback) as a registered client.
   - It stores the tokens and passes them to the CLI through an environment variable (`CodexChatGptAuth.ts`, `CodexManagedRuntime.ts`).
   - This depends on the provider's sanctioned client program: copy the pattern only, and only with your own registration.
3. **Reading other apps' credential files and keychain items.**
   - T3 reads Cursor's and OpenCode's tokens, Claude's `.credentials.json` for usage and reset credits, and Codex and Claude account ids for telemetry identity.
   - Do not copy this.
4. **Calling providers' private usage and reset endpoints with the person's tokens, presenting as the official client.**
   - These endpoints are undocumented and can change or break terms of use.
   - Do not copy this.

### T3's own security (copy, with adaptation)

- **Pairing:** one-time grants that expire after 5 minutes.
- **Sessions:** signed with an HMAC key and valid for 30 days.
- **WebSocket tickets:** valid for 5 minutes.
- **DPoP:** proof-of-possession, with replay protection.
- **MCP OAuth:** for outside agents; code grant only, PKCE (S256) mandatory, and codes that expire after 60 s (`apps/server/src/auth/*`).
- **SecretRef:** when an agent needs a secret, the person's answer goes straight to the secret store under a one-use reference, so the value never reaches the transcript or the model (`secrets/SecretRequests.ts`).
- **One weakness:** T3's server secret store is plain files with 0600 permissions. Use the OS keychain instead, as Orca does for API keys.

## 3. Several accounts, and usage across clients

### What both apps do

| Need | How it is done | Verdict |
|---|---|---|
| Several accounts for one provider | One configuration home per account. Claude uses `CLAUDE_CONFIG_DIR`; Codex uses `CODEX_HOME`. T3 gives each "provider instance" its own home, and its Codex "shadow home" shares settings but keeps `auth.json` private. Orca stores each account in its own folder and adds accounts by running the official `claude auth login` / `codex login` into that folder | **pattern**. Use the documented home variables. Orca's per-folder keychain naming depends on Claude Code internals |
| Switching accounts | A deliberate user action. T3 changes the sign-in and stops the sessions bound to the old one. Orca's `select()` refuses accounts that need sign-in, clears ambient key variables before launch, and asks whether to restart open sessions | **adapt** |
| Combining usage across accounts and clients | Scan each tool's local transcripts (Claude `projects/`, Codex `sessions/`) across every account home, de-duplicate by real path and record key, and price from a table. T3 also shows pooled limit windows, sorted by the soonest reset | **adapt**. This is the safest way to merge usage, because it uses only files the person owns |
| Live quota per account | Both apps call providers' private OAuth usage endpoints with the stored token. Orca does not refresh tokens itself, but it copies and writes back Codex `auth.json` | **avoid**. Use official usage APIs or the CLI's own reporting where they exist |
| Rotating accounts when a limit is hit | Neither app does this; searches for auto-switching or failover found nothing. Both can claim a provider's own "reset credit" when the person asks | **do not build**. Spreading one workload over several subscriptions to get past limits breaks most providers' terms and puts the accounts at risk |

### What a transferable kit looks like

| Component | Comes from | Meets (RQS-2030) |
|---|---|---|
| **Account registry:** one home per account (person, provider, label, home path, sign-in status), filled by running the official login into that home | T3 provider instances, Orca account folders | SEC-6 (secrets stay with the provider's tool), PRV-2 (local) |
| **Launch with an account:** set the home variable, clear ambient key variables, record which account ran each session | Orca `environment.ts`, T3 `ClaudeHome.ts` | AGT-5 (who did what), INT-5 (stable ids) |
| **Sign-in status probe:** ask the official tool (Codex `account/read`, Claude SDK init, ACP `authenticate`) and turn "unauthenticated" into a sign-in step | T3 providers | INT-4 (actionable errors) |
| **Usage ledger:** a transcript scan per account home, de-duplicated, priced, and reported per account and in total | T3 `usage/*`, Orca `claude-usage`, `codex-usage` | AGT-6 (cost visible), EPI-1 (traceable numbers) |
| **App security:** pairing, DPoP, short-lived tickets, PKCE, SecretRef, keychain storage | T3 `auth/*`, `secrets/*` | SEC-1, SEC-6, OPS-3 |
| **Parallel work:** worktree per worker, ledger with receipts, coordinator loop, `process-host`, status protocol | Orca | REL-1, REL-2, INT-5, AGT-3 |

Rules for the kit:
- Never read another application's credential store.
- Never refresh or copy tokens.
- Never call undocumented endpoints while presenting as an official client.
- Never rotate accounts automatically to get around limits.
- Start agents with approvals on, and let the person loosen that per repository.
