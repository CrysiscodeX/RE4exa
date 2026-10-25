# A — Case File: a local, durable investigation server run by the person's official agent client

**Status.** Candidate concept, layer 5. Design intent only: nothing here has been built or run. Written by a fresh architect agent from [journal J-05, J-06](../journal.md), [gaps.md](../gaps.md), the round-1 and round-2 debate files and [01-anatomy/](../01-anatomy/).
**Labels.** [seen] read in a clone at the pinned commit or measured; [inferred]; [unknown]. Estimates are marked "est.". Debate files are cited as `r2-a-rea X-1`, `r2-judge §3` and so on.
**Origin.** R-1 (record) + D-1 (runtime rules) + L-1 (as a runner policy) + B-2 (as an option, off by default). Store fixed by J-06: **own SQLite, one transaction per probe, exclusive lock at open.**

## 1. Thesis

A local MCP server with its own single-writer SQLite store, called by the person's official agent client, in which every probe of a shipped artifact commits its step row, its runner-written Evidence and any unknown revision in one transaction, so a killed or abandoned investigation resumes without re-running completed probes or losing open questions.

## 2. Who uses it, and three usage scenarios

**Main user:** an agent in a coding or security session, with a person watching and approving (framing §2, row 1). **Secondary:** an analyst who resumes or exports a case at the CLI. **Not for:** unattended CI or fleets (candidate B), or several people editing one case at once (scope cut).

**S1. First triage.**
1. The person signs in to their client with the provider's own login, in that account's config home. The product never sees the login. They register Case File as an MCP stdio server in the client's config (*attach* mode), or start `casefile launch --client claude|codex|acp` (*restricted launch*, §4).
2. They ask: "What does this VS Code extension's bundled native helper do on install?" The agent calls `case_open(path)`. The server hashes the file, creates `<sha256>.casefile`, takes the exclusive lock and returns the case ID, the detected formats and their reach (for example `.vsix`/ZIP: covered; Mach-O helper on the Linux lane: partial; entitlements: not covered).
3. The agent calls `triage(case, items[])`. In one call the runner executes every rung-1 router row for the detected formats as argv under process-host in the `inspect` profile. Each row's output becomes one Evidence record (`authority: shipped-artifact`, `confidence: observed`), committed with its step row. The agent sees a result of 8 KiB or less with handles, and no raw dumps. Each item becomes an unknown marked agent-supplied.
4. A rung-2 `probe(row, args)` slices the bundle and closes two unknowns. Each resolution has to cite qualifying ObservationIds (rea O7 rule).
5. "Which IPC channel triggers the helper?" stays open. The agent calls `escalate(unknown)`. The runner checks the rung-3 budget, runs the pinned `rea mcp` JS/Electron analysis with `detail:"summary"`, and records why it climbed.
6. The person sees the answer in the client, citing `ev_` IDs. `case_status` shows 9 Evidence records, 1 open unknown, coverage "partial: 1 unresolved dynamic-import site", budget used, and `boundary: enforced` or `unenforced`.

**S2. Crash and resume.** The laptop sleeps during rung 3, and the client and the server both die.
1. Next morning the person opens a new session, which may be in a different official client (for example `codex app-server` in its own `CODEX_HOME`), and says "resume case X".
2. `case_resume` reports the completed probes (served from the store, never re-run) and the probe that was in flight. An `inspect` probe simply has no row and is rerun on the next call. A `detonate` probe is settled `interrupted, may have partially run`, and retrying it needs approval.
3. It also reports the open unknowns with their revisions, the remaining budget and the coverage so far.
4. **What the person does not get back:** the previous client's conversation. The new agent starts from the case summary, not from the chat (N-4).

**S3. Handover, and an approved runtime step.**
1. The reviewer runs `casefile export X`: `VACUUM INTO`, then a secret scan. Export is refused if an unredacted pattern is found.
2. A colleague imports the file on their own machine, under their own account. Only one writer exists at a time, and no credential moves.
3. The colleague's agent asks to run the helper under observation (`detonate` profile). The approval prompt shows typed tool fields and arguments, never the model's reasoning. The step runs in the Linux container lane; on a macOS host it is labelled `unenforced`.
4. *Option B-2 (off by default):* the case can be parked with a wait on "next release of this extension", evaluated when the case is next opened or by a local timer.

## 3. Anatomy of capabilities

| # | Capability | Source organ | Verdict | What must change | Licence | Gap IDs |
|---|---|---|---|---|---|---|
| 1 | Claim record, ObservationId | `rea.md` O5 Evidence record and ID | adapt | Vendor the 17-file, 2,839-line closure (X-5: option d, starting from b). Nested Evidence in `normalized_result` reduced to its ID, nested `subject` without `name`/`local_path`. ID over the redacted projection. Golden vectors from pinned rea in CI | MIT (rea) | X-1, X-5, N-10 |
| 2 | ProbeKey, computed before execution | `rea.md` O5, plus rea's path-free query key (`rea:src/domain/analysisSnapshot.ts:354-367`) [seen] | pattern; **new S** | Fields as in r2-a-rea X-1, plus router row id and version, tool binary digest and redaction-detector version | MIT | X-1, N-10 |
| 3 | S-2 claim format v1 | S-2 card (`03-ideas/skeptic.md`) over `rea.md` O5 | **new S** | **Capped** at the record + ProbeKey + ObservationId. Coverage, taint origin, redactions, reach state and FindingKey are each a separately versioned extension | — | N-2, W-S2-2 |
| 4 | Open questions as tracked work | `rea.md` O7 residual-unknown registry | lift | Revisions stored as rows. A resolution cites ObservationIds in the same case | MIT | W-L1-1 |
| 5 | Merge and conflict rules | `rea.md` O6 ledger | adapt | Three in-memory Maps become tables. Recording stays idempotent; conflicting content is rejected | MIT | W-R1-3 |
| 6 | Case store: one transaction per probe, exclusive open | `pi-durable.md` organ 2 (reference only: STRICT tables, migrations at open, `BEGIN IMMEDIATE`, WAL) | **new M** | Own schema on `node:sqlite` (experimental on Node 22.22.0 [seen: warning]) or better-sqlite3. OS lock plus `locking_mode=EXCLUSIVE`. Refuse a newer schema with a typed error. `secure_delete=ON` | MIT (pattern, no code) | N-1, N-5, X-4 |
| 7 | Intent before effect; replay by profile | `pi-durable.md` organ 6 tool task (`durable:src/harness/tool.ts:144-196`) [seen] | pattern | Logic rewritten outside Chord. Intent row only for non-`inspect` probes. `replay: safe` only for steps run under `inspect` | MIT | X-7, N-4 |
| 8 | Crash-loop parking, restart settlement | `pi-durable.md` organ 5; `donors.md` row 26 (pandacode) | pattern | Attempts counted per ProbeKey; park at 3 (est.), which writes an unknown "could not analyse" and coverage "not run". In-flight effectful probes settled `interrupted` in one transaction at open | MIT; pandacode pattern only (`LICENSE:15-21`) | N-4 |
| 9 | Storage conformance, crash injection | `pi-durable.md` organ 16 | adapt | Add process kill at step k, a two-process open, and a crash at each of 3 points per probe | MIT | N-1, W-D1-2 |
| 10 | Effect classes | `rea.md` O3 effect audit | lift, then change | Split `mutatesSession` into `recordsEvidenceOnly` (readOnly is 5/208 today). A declaration only picks a profile; it never grants replay | MIT | X-7, X-2 |
| 11 | Execution profiles `inspect` / `detonate` | r2-a-durable X-7; `donors.md` row 21 isolation layout | **new M**; row 21 pattern | Linux namespaces or a container: no network, read-only subject, scratch per attempt, images pinned by digest. Non-Linux runs labelled unenforced | row 21: no LICENSE, pattern only | X-7, N-8 |
| 12 | Bounded probe processes | `donors.md` row 1 orca process-host | lift | 2,136 lines of non-test TS [seen, counted]. argv only, no shell. Defaults 30 s / 8 MiB (`orca:src/packages/process-host/src/process-spec.ts:77-78`) [seen] | MIT; carry the root notice (the package is private, with no licence field) | X-7 |
| 13 | Router pack as data | `leanrea.md` L5 router, L6 first moves, L7 traps | adapt (L5, L6); lift (L7 text) | 19 rows become argv templates with typed slots, effect class, platforms, fixture and status. Pipes become runner caps. No `npx -y`, no `curl`. Traps go into tool descriptions within the catalog budget | MIT | X-8, X-9 |
| 14 | `reach.json` | `leanrea.md` L5 (fallback per row); r2-a-leanrea X-8 | **new S** | Generated in CI from per-row fixture results. A cell that is not covered opens unknown `not_covered:<lane>/<format>`, never "absent" | MIT | X-8 |
| 15 | Triage ladder as runner policy | `leanrea.md` L2 budgets; L-1 card | adapt; **new S** | Recording happens inside the probe call, with no extra turn. Escalation is gated by runner facts and rung budgets, never by agent-supplied items (§6, W-L1-1) | MIT | W-L1-1, W-L1-2, X-10 |
| 16 | Heavy rung | `rea.md` O10 readers and O11 JS/Electron (code left, called as a pinned `rea mcp`); O14 provider port (pattern) | pattern | One long-lived `rea mcp` per case, compact schemas, `detail:"summary"` (20,829 B against 178,983 B full detail, r2-a-rea). rea's output is stored as our record's `raw_result` | MIT | X-5, X-9 |
| 17 | Case coverage record | `donors.md` row 18 strix coverage.json; `rea.md` O11 | adapt | `machine_observed` kept apart from `agent_reported`; "unexamined, not clean" (`strix:strix/report/coverage.py:263`) [seen]. rea's `complete` read as `partial` until the X-6 census exists | Apache-2.0; add attribution (no NOTICE) | X-6 |
| 18 | Small results with handles | `rea.md` O4 response budget; `donors.md` row 16 caveman CCR handles | pattern | Reads 8 KiB or less by default, as `{digest, bytes, preview ≤512 B}`. An unknown handle is an explicit miss. No result is sent twice | MIT; Apache-2.0 (pattern) | X-9 |
| 19 | Taint, envelope, policy gate | `rea.md` O3 untrusted marker; `donors.md` row 14 t3code envelope | lift (marker); adapt (envelope); **new S** (gate) | A `Tainted` brand plus a runtime origin tag, because types vanish at run time (N-3). A fresh random tag on every render, applied again on every read. After taint, every non-`inspect` call needs approval | MIT | X-2, N-3, SEC-1 |
| 20 | Redaction at source | r2-a-durable SEC-6; `donors.md` row 12 SecretRef | **new M**; row 12 adapt (opt-in) | Redact before any commit. Store `secret:<type>:<sha256/12>` plus location, not the value. A keychain-backed SecretRef only if the owner keeps values | MIT (row 12); detector source and licence [unknown] | SEC-6, N-10 |
| 21 | Delegated client, one home per account | `donors.md` row 9 delegated sign-in; row 10 one config home per account | adapt (row 9: probe and status mapping only); pattern (row 10) | Status probe only; documented home variables only. Never reads `auth.json`, keychains or tokens. pi-ai is not used (`pi-durable.md` organ 14, leave) | MIT | X-3, G-pi-ai, G-terms |
| 22 | Tool-side budgets, spend display | r2-a-durable X-10; `donors.md` row 11 usage ledger | **new S**; row 11 adapt | Per case and per rung: calls, bytes returned, wall time, rung-3 calls. Overrun is a typed, non-retryable `budget_exhausted`. The client's token spend is read from local transcripts and labelled an estimate | MIT | X-10 |
| 23 | Calibration report | `rea.md` O19 known-answer grading; `donors.md` rows 22 (laya), 23 (my-jev) | adapt (O19); pattern (22, 23) | Precision per (operation, class) with Wilson 95% intervals. `INSUFFICIENT` below n = 30. Invalid outputs counted apart. Demotion recorded in `analysis_profile`. No `torch`, and no "calibrated" wording | MIT; Apache-2.0; MIT | EPI-2 |
| 24 | Export and handover | `rea.md` O6 bundles; r2-a-durable W-D1-3 | adapt; **new S** | `VACUUM INTO`, then a scan; refused on an unredacted pattern hit. An S-2 v1 JSONL bundle beside the file. Import refuses a newer schema | MIT | W-D1-3, SEC-6 |
| 25 | Standing waits (**option, off**) | `absurd.md` O4 events and sleeps; r2-a-absurd §2.3 sequenced topics | pattern | Re-expressed on the case's own SQLite: `topic#seq`, a cursor per case, `topic_gap`. Evaluated on open or by a local timer. No absurd code, no Postgres | Apache-2.0 (pattern; nothing copied) | W-B2-1, W-B2-2 |

**Considered and not used:**
- caveman's terse-output mode (`donors.md` row 15). It measured 3% over "Answer concisely." (n = 10, `caveman:docs/HONEST-NUMBERS.md:16`), which does not justify a dependency.
- The pi-durable kernel and harness (organs 1, 7, 9). Using them would mean two commits per call and pi-ai `Models` (r2-judge D1 option b).
- absurd's SQL and PGlite (N-1).
- pandacode's loopback HTTP host (row 25). v1 has no network listener.

## 4. Integration surfaces

- **MCP (stdio only).** About 10 tools: `case_open`, `case_resume`, `case_status`, `triage`, `probe`, `escalate`, `unknowns` (list and update), `record_claim` (agent-authored; always `analyst-inference`), `coverage`, `case_export`. The catalog target is 15 KB or less (R-1 card), measured with leanrea's sizer (`leanrea.md` L11) before any number is claimed. Results are 8 KiB or less by default.
- **CLI.** The same verbs, for the analyst. While a server holds the case, the CLI is refused with `case_locked`.
- **SDK.** None in v1. L-1's library surface was cut (`r2-a-leanrea §1`, Q7).
- **Rendered `SKILL.md`.** For hosts without MCP. This is owner decision 10, and the mode is labelled "unenforced".
- **Storage: exactly one store.** One SQLite file per case (`<sha256>.casefile` plus WAL), opened by exactly one process. No Postgres, no PGlite, no pi-durable kernel.
- **Identity and accounts.** Sanctioned delegation only.
  - **What uses the person's subscription:** every model turn. The product calls no model.
  - **Attach mode.** The person's own client calls our server. The product launches and drives nothing, so the account question reduces to the person using their own client.
  - **Restricted launch** follows T3's pattern [seen]:
    - Claude: spawn the official CLI or Agent SDK with `CLAUDE_CONFIG_DIR` and `HOME` kept (`t3code:apps/server/src/provider/Drivers/ClaudeHome.ts:40-45`). Read only `account.email` and `subscriptionType` from `initializationResult()` (`t3code:apps/server/src/provider/ClaudeProvider.ts:379,402-413`). Built-ins off with `--tools ""`, or an explicit `--allowedTools` list, plus `--strict-mcp-config` (`t3code:apps/server/src/textGeneration/ClaudeTextGeneration.ts:216-228`). Register MCP servers over the SDK control channel (`t3code:apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts:893-947`).
    - Codex: `codex app-server` with `CODEX_HOME`; `account/read`; a missing account with `requiresOpenaiAuth` means "sign in with the official tool" (`t3code:apps/server/src/provider/CodexProvider.ts:485,506,534-535`). Per turn: `approvalPolicy: "untrusted"` and a sandbox policy (`t3code:apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts:680-704`).
    - ACP: pick the agent's own auth method, then `authenticate` when the agent requires it (`t3code:packages/provider-acp/src/server/AcpSessionRuntime.ts:1085-1094,2124-2159`).
    - Approvals stay on (charter).
  - **Never:** read a credential store, copy or refresh a token, use pi-ai's OAuth paths, or rotate accounts.
  - **What needs an API key: nothing.** A has no Mode B and no unattended mode. That is candidate B's ground, and it removes N-11 from A.
- **Other tools.**
  - Export: an S-2 v1 JSONL bundle plus the coverage extension. Imports SBOM output as provider Evidence (optional).
  - No attestation format in v1: "SARIF or in-toto" is still open (`a-rea.md:97`).
  - CI is used only for the product's own conformance, injection, fixture and calibration jobs.

## 5. Architecture sketch

```
 person ─(provider's own login, one config home per account)─► official client: Claude CLI/SDK | codex app-server | ACP agent
                                                                owns: turn loop, model spend, transcript, its built-in tools
   TB5 provider account: only the client crosses it          │ TB8 client ⇄ server: MCP stdio, the only channel
   TB9 other MCP servers in the same session ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┤ (outside our gate; restricted launch excludes them)
                                                             ▼
 ┌─ Case File server: one process per case, holds the exclusive lock ───────────────────────────────────────┐
 │ dispatcher: schema → budget → policy gate (TB3: approval for non-inspect after taint) → approval UI    │
 │ ladder runner: router rows (argv) │ rung 3: pinned `rea mcp` subprocess                                │
 │ redactor (before any commit) → ObservationId → ONE tx: step(ProbeKey) + Evidence + unknown rev + budget │
 │ envelope on every model-visible render, including reads of old cases (TB2)                            │
 └──────┬──────────────────────────────────────────────────────────────────────────────┬─────────────────┘
        │ TB1 process-host under `inspect`/`detonate` (container on Linux)        TB4 │ TB7: digest-pinned tools
        ▼                                                                             ▼
  artifact copy (read-only bind), scratch per attempt                     <sha256>.casefile + WAL + .lock
```

- TB1–TB7 follow A-leanrea's threat model (`r2-a-leanrea` SEC-1). TB6 (local listeners) is empty in v1.
- TB8 and TB9 are added because the skeptic's SEC-1 condition asks for them.
- **Per-probe sequence:** check ProbeKey.
  - Hit: return the stored result.
  - `detonate` only: commit the intent row first.
  - Run under process-host, redact, then commit {step `done`, Evidence, unknown revision, coverage delta, budget charge} in **one transaction**, then reply.
  - So an `inspect` probe costs one commit and a `detonate` probe costs two.

## 6. The three critical gaps

**X-1, identity (paper).**
- A uses two of the three X-1 keys in its core.
  - **ProbeKey:** from inputs, before execution. It is the replay and dedupe key.
  - **ObservationId:** today's ID, with nested records reduced to their IDs, computed over the redacted projection. It is the record identity.
- **FindingKey** is not needed for A's capability, because cross-version review is B's. It stays an S-2 extension, which keeps v1 inside N-2's cap.
- **Replay rule:** the same ProbeKey with a committed observation is never re-run. If a re-run yields a different ObservationId, both are kept and the step is flagged `nondeterministic`.
- **Narrower test surface:** A exposes only router rows plus the rea operations used at rung 3, not all 208 tools. So X-1 test 2 (mutate every parameter; the key changes exactly when the result can) covers a smaller table [inferred].
- **Closes when:** X-1 tests 1–2 pass, plus N-10's detector-version change.

**X-2, untrusted content (test-gated; enforced only where the product owns execution).**
- Every byte string from the runner or rea carries `origin` (target, provider, runner) as a runtime tag, not only a compile-time brand.
- Every model-visible render, including a later agent reading an old case, goes through the envelope.
- After the first tainted result (in practice, every session), any `detonate`, network or out-of-scratch write needs approval. Host auto-approve does not override this.
- **Restricted launch, Claude path:** no shell and no other MCP servers (`--tools`/`--allowedTools`, `--strict-mcp-config`, seen), so the judge's AGT-1 3h applies. **Codex:** whether its shell can be removed is [unknown], so AGT-1 is 2.
- **Attach mode:** the server cannot see the client's other servers or its built-in tools [inferred: MCP gives a server no such view]. The case records `boundary: unenforced` and every `case_status` repeats it. This is N-3's "or says so", not a fix.
- **Approval fatigue (N-3):** `inspect` probes, which are the bulk, need no approval, so prompts concentrate on `detonate` and export. The rate is measured per session (§12).
- **Pass criteria (X-2 (a)–(d)):** policy unit tests block 100%; 0 tripwire hits in 120 or more runs, **including a second MCP server in the session**; adopted planted claims 5% or less; clean-twin accuracy drop of 1 key in 25 or less.

**N-1, several processes on one store (open → designed).**
- SQLite does serialise commits (`BEGIN IMMEDIATE`, `pi-durable.md` §3.3), so the file itself stays well-formed. But A's own single-writer assumptions (restart settlement at open, crash-loop counters, budget charges, the ProbeKey cache) would break with two openers, giving double-run or mis-settled probes, the same class as pi-durable's §3.3 holes [inferred].
- **Design:** an OS advisory lock on `<case>.lock`, taken at open and held for the life of the process, plus `PRAGMA locking_mode=EXCLUSIVE`. A second opener gets `case_locked {pid, host, since}`. The OS drops the lock when the holder dies [inferred: flock/LockFileEx semantics], so no lease timer is needed. Cases on network filesystems are refused, because file locks are not trusted there [inferred; to verify per OS].
- **Handover** goes only through export and import (S3), never through two live openers.
- **Test:** 1,000 concurrent second opens: every one refused and 0 committed rows lost. Then kill the holder, and the next open succeeds and settles in-flight probes.

## 7. Other gaps

| Effect | Gaps |
|---|---|
| **Resolves** (paper or test-gated, as in gaps.md) | X-3 (the product holds no model access; Mode A only); X-7 (Linux); X-8 (`reach.json`); X-10 tool side; SEC-6; EPI-2 (method); SEC-1 (adds TB8, TB9; a SECURITY.md owner is still needed); N-2 (cap kept); N-4 (claim narrowed to the case, not the session); N-5; N-10; W-D1-3; W-L1-2 |
| **Partly resolves** | W-L1-1. The skeptic rejected "the runner opens unknowns from `items[]`", because the agent supplies the items. In A, items unlock nothing. Rung 3 is allowed only when (i) every rung-1 row for the format has finished, as the runner observed, (ii) the rung budget remains, and (iii) the per-case rung-3 cap holds. Only in restricted launch, where the product passes the user's prompt to the client, can items be taken verbatim from the request and recorded. Over-escalation is measured (§12) |
| **Inherits** | X-5 (vendored closure drifts from rea; golden vectors catch it); X-6 (needs the upstream census or a fork; until then coverage is `partial` and noisier); X-9 (unmeasured; rule replaced per N-9); N-8 (macOS unenforced); N-12 (S-1 tier 2 must exist before A's main kill test means anything); G-terms (restricted launch only); PRV-4/EVO-4 (owner) |
| **Does not apply** | X-4, N-6, N-7, W-B1-1..3 (no absurd SQL, no shared store); N-11 (no Mode B); G-pi-ai (pi-ai not used) |
| **Makes worse** | Injected strings now **persist** and reach later agents (mitigated by re-enveloping on read, but RL-2 rises against S-1 tier 1). Approvals add friction that S-1 tier 1 does not have. One writer per case, so no live collaboration. The idle context cost is a server catalog (target ≤15 KB) instead of leanrea's 8,374 B skill |

## 8. Target RQS-2030 levels (design intent)

- **Profile:** agent-tool. The client hosts the loop (`r2-judge`, profile shift).
- **Flags:** `parses_untrusted`, `executes_code` (`detonate`), `distributed`, `uses_llm` (through the client).
- **Grade:** none can be given yet. Evidence coverage is below 60%, so any grade would be provisional and capped at C (`r1-judge` §1). The best parent today is rea at C 58.5 (sources.md).

| Criterion | Target | Weakest parent | What earns or caps it |
|---|---|---|---|
| REL-1\* | 3h (narrowed) | 2 (rea, leanrea) | One tx per probe; exclusive lock; parking; kill test. Covers the case, not the client's session (N-4) |
| INT-5 | 3h | 3 (leanrea) | ProbeKey before execution, path-free ObservationId. Capped by X-1 test 2 (stale replay if an input is missed) |
| EPI-4 | 3h | 2 | Case coverage with `machine_observed`/`agent_reported`; `not_covered` unknowns. Capped by X-6 upstream |
| PERF-2\* | 3h | 1 (rea) | One-call rung 1; recording inside the call; 8 KiB reads; handles. X-9 not run |
| AGT-1\* | 3h restricted Claude · 2 Codex, attach, skill | 1 (leanrea, pi) | X-2 design. A person can still approve harm; a model can still *believe* planted text |
| SEC-8 | 3 container lane · 2 macOS host | 1 (leanrea) | process-host, rea readers, profiles. Owner decision 6 |
| AGT-6 | 3h tool side | 2 | Rung and case budgets, typed stop. Model spend belongs to the client and is only displayed |
| SEC-6 | 3h | 2 | Redaction at source, fingerprints, `secure_delete`, scanned export. Detector unknown |
| EPI-2 | 3h (method); levels unknown | 3 (rea, leanrea) | Calibration report in CI. About 3,000 labelled claims needed (est., r2-skeptic) |
| SEC-1\* | 3h | 0 (leanrea) | Threat model TB1–TB9; needs a named owner and a report drill |
| PRV-4 · EVO-4 | 2 · U | 0–2 | Until the owner states a CRA role and a support period |

## 9. What it beats the null option (S-1) on

- **One capability: one commit per probe.** The step row keyed by ProbeKey, the runner-written Evidence with a path-free ObservationId, and the unknown's revision land together. A resumed case never re-runs a completed probe and never holds a result without its Evidence, and cheap rung-1 probes become Evidence instead of unrecorded Bash output.
- **Why S-1 cannot today:** rea's ledger lives in three in-memory Maps (`rea:src/application/investigation/EvidenceLedger.ts:44-47`, `rea.md` O6); nested Evidence IDs depend on the path (`rea.md` O5, measured); in tier 2 the bundle export is a separate call after each probe (`r1-skeptic` S-1).
- **The judge's caveat, stated plainly (`r2-judge §3`, J-06).** This capability is a change to rea's records: an append-only log behind O6 and the nested-ID fix. If rea accepted those changes upstream (candidate D, O-1), S-1 would have it too, and A's margin would shrink to **ownership and speed of shipping**. That is a maintenance argument, not a capability one. The other things A adds (taint gate, redaction, budgets, calibration, router pack) are new code that could also be written as S-1 glue or sent upstream; they widen the margin only on paper.
- **What A does not beat S-1 on:** owned code (S-1 is about 0.5–1k lines); availability today; account cleanliness of tier 1, which A's attach mode only matches.
- **The test that decides it:** kill at step k against S-1 tier 2 (§12, criterion 1).

## 10. Trade-offs and risks

- **Better models (2030–35).** leanrea's bare-model arm was already close to the skill (wall-time ratio 0.81 [0.62, 1.04], `leanrea.md` §4). If models drive `file`/`otool` well on their own, a layer between agent and tools buys less, and value moves to *checking* answers (candidate C). A's defence is persistence and enforced recording, not better answers [inferred].
- **The client owns the loop.** A's durability is tool-side only (N-4). If official clients ship durable sessions and tool sandboxes of their own [inferred trend], part of A's case shrinks to "a better rea". Client protocol drift is ongoing; t3code counters it with replay fixtures (`donors.md` row 14).
- **Persistence cuts both ways.** A durable case is also a durable store of target text and injected strings, read by later agents and people (RL-2).
- **Approvals.** Enforced approvals are A's AGT-1 strength and its usability risk (N-3). Rubber-stamping makes the gate theatre.
- **CRA.** Shipping A probably makes its steward a manufacturer, or an open-source steward [inferred; not legal advice] (`r2-a-absurd §2.4`). A five-year support period means backporting fixes into the vendored rea closure and the process-host copy. A cannot honestly sell "CRA evidence" before it states its own position (PRV-4/EVO-4).
- **Agents as the main callers.** This favours A's small catalog and bounded results. But every extra turn spent on case tools is measured against leanrea's one proven effect, fewer turns (W-L1-2).
- **Reach.** The Linux container is the only enforced lane. On macOS, the platform leanrea was benchmarked on, enforcement is labelled "unenforced" (N-8). Native Windows is declared not covered. Deep native analysis stays with external engines (framing §5).
- **Dependencies.** `node:sqlite` is experimental [seen on Node 22.22.0]. rea churns: 12 BREAKING sections across 38 releases, and one maintainer wrote 59% of 6.5.0's commits (`rea.md` §4). The router rows need per-OS fixtures that nobody maintains today.

## 11. Size

| Part | Ordinal | Estimate |
|---|---|---|
| Vendored or lifted code: rea O5/O7 closure, O3 table, orca process-host | — | about 5.7k lines (2,839 + 782 [seen] + 2,136 [counted]), owned from then on |
| Store, MCP server, CLI, ladder runner, ProbeKey, parking, settlement | M | 2.5–4k lines (est.) |
| Router pack (rows, fixtures, reach generator) | M | 1–2k lines plus fixture artifacts (est.) |
| Profiles and isolation spec, container images | M | 0.8–1.5k lines (est.) |
| Taint, envelope, gate; redaction (excluding detector rules) | S + M | 0.4–0.8k + 0.8–1.5k lines (est.) |
| Calibration job; export and import; budgets | S–M | 1–2k lines (est.); plus about 3,000 labelled claims (est.) |
| Conformance, crash, injection (≥24 fixtures) and X-9 harness | M–L | 3–5k lines (est.) |
| X-6 census (if forked rather than upstream) | L | unknown; on rea's AST |
| B-2 option | S | 0.5–1k lines (est.) |
| **Total new** | **L** | **about 10–18k lines (est.)**, against S-1's 0.5–1k and S-2's 3–5k |

**Upstream dependencies:** rea, as a pinned `rea mcp` and through golden vectors (high churn); official clients and their flags (Claude CLI/SDK, `codex app-server`, ACP: medium churn, outside our control); `node:sqlite` or better-sqlite3; container runtime images. No pi-durable or absurd runtime dependency: their churn (EVO-1 2) is avoided by taking patterns only.

**Maintainers:** 2 (est.): one for analysis and rea sync, one for runtime and security, plus a SECURITY.md owner and labelling effort. More if a five-year support period is declared.

## 12. What would prove it wrong (kill criteria)

1. **Margin over S-1.** A kill at a random step k on a 30-probe script, 50 runs, against S-1 tier 2 (built first, N-12). If A's advantage is at most 1 repeated probe and 0 lost unknowns per run, A folds into D (S-1 plus upstream changes).
2. **Own durability.** In 50 kill runs, any of these fails A: Evidence lost for a probe whose result reached the client; a non-`inspect` probe re-run without approval; an ObservationId changed for a deterministic probe under the same ProbeKey.
3. **N-1.** In 1,000 concurrent second opens, any open that is not refused, or any committed row lost, fails A.
4. **Value per dollar (N-9 rule).** 60 paired cells (12 tasks over at least 6 formats × 5 reps), including a resume task where Tier 0 may keep notes. A fails if correct-and-verified claims per dollar, checked against oracles, do not beat Tier 0 (lower 95% bound of the ratio ≤ 1.0), or if the upper bound of its cost per correct answer exceeds 1.2× Tier 0.
5. **Injection.** Any tripwire hit in 120 or more restricted-launch runs (including a second MCP server), policy unit tests below 100%, or adopted planted claims above 5% blocks release.
6. **Approval fatigue (N-3).** A median above 5 approvals per session, or an approve rate of 95% or more over at least 100 prompts (thresholds est.), means the gate does not work as designed.
7. **Ladder.** Rung 3 used on more than half of the questions leanrea answered cheaply (L-1 falsifier), or more than 20% of answer claims without an ObservationId in an audit (R-1 falsifier).
8. **Overhead.** Per-probe commit and redaction overhead above 5% of the median probe time (D-1 threshold).
9. **Secrets.** Any hit from the seeded-secret corpus in the DB, the WAL, an export or an MCP response.
10. **Calibration.** A deliberately wrong producer is not demoted within one CI run.
11. **Reopen trigger, not a kill.** If rea merges an append-only ledger plus the nested-ID fix, re-run criterion 1 against the new S-1 before investing further.

## 13. The owner decisions it depends on

[06-options.md](../06-options.md) is not written yet. These are numbered as in `r2-judge §4`.

- **#1 More than one worker process?** No: A stands as written. Yes, for interactive cases: A's store choice is wrong and the decision moves to B's shared mode.
- **#2 Store for the case file.** This candidate assumes own SQLite (J-06). Choosing PGlite or the pi-durable kernel instead makes it a different candidate.
- **#3 Provider terms** for restricted launch, per provider. Attach mode does not depend on them; unattended use is not offered.
- **#4 Must product mode require a restricted client?** Sets AGT-1 at 3h or 2. **#5 Windows in v1:** declared not covered unless decided otherwise. **#6 Host-only parsing on macOS without a VM:** sets SEC-8 at 2 or 3 in that lane.
- **#7 Is B-2 a real need?** The option stays off without session-log evidence. **#8 Keep secret values at all?** The default is no. **#9 CRA role and length of the support period.** **#10 Keep the rendered skill as an "unenforced" mode?**
- **Plus:** whether to pursue upstream changes to rea at the same time. This is the judge's caveat in §9: if they land, A's margin turns into a maintenance argument.
