# 04 Debate, round 2: A-durable

Advocate: A-durable. Inputs: [round-1-skeptic.md](round-1-skeptic.md), [round-1-judge.md](round-1-judge.md), journal J-04.

**Prefixes.** `durable:` = `pi:packages/durable/` and `ai:` = `pi:packages/ai/`, both at `fdce48e`; `t3code:` = pingdotgg/t3code at `7e289ae`. Card lines are cited as `a-durable.md:N`.

**Labels.** Each statement is **[seen]**, **[inferred]** or **[unknown]**. Every design below is **[inferred]** until it is built.

## 1. Weak spots on my cards

### W-D1-1 Model access contradicts the runtime (also the judge's D-1 AGT row)
**Accepted; resolved by the X-3 design in §2.** In the default mode the official client owns the turn loop and the product is an MCP tool host. pi-durable hosts the loop only in an API-key mode, with OAuth-capable paths blocked.
**Status:** closed-by-design; the terms question goes to the owner as unresolved-owner (X-3).

### W-D1-2 "Same atomic commit" is not in pi-durable's API
**Verified: the skeptic is right about the API.** `details()` and `commit()` are separate tool operations [seen, `durable:src/harness/types.ts:241-243`]. The harness writes the result itself in `settle()`, whose commit appends the `pi.tool-result` entry together with the result's `details` [seen, `durable:src/harness/tool.ts:655-676`]. So Evidence written through `api.commit` lands in an *earlier* commit than the result.

**Design change: "evidence ahead, pointer with the result".** No kernel change is needed.
1. **Write Evidence first.** Before `execute()` returns, the tool writes each Evidence record through `api.commit(tx => tx.doc(EvidenceFamily, …))`, keyed by its observation ID and carrying `(taskId, attempt)`. Tools can write documents in a commit [seen, `durable:README.md:650`, `:730-747`].
2. **Return only pointers.** The tool returns `details: { evidence: [ids] }`, which `settle()` commits atomically with the transcript entry.
3. **Invariant.** Every committed tool-result entry points only to Evidence that is already durable, because ordering puts the Evidence commit first.
4. **Crash between the two commits.** The Evidence exists with no result pointing to it. On reopen the call is settled `interrupted` or rerun (`durable:src/harness/tool.ts:185-196`) [seen]. A reconcile scan marks such Evidence `delivered: false`, and the model and the report never cite undelivered Evidence.
5. **Nested calls (code mode).** Their results are dropped when the caller settles [seen, `durable:README.md:327`], so step 1 is their only path. Because the Evidence documents are conversation-scoped, they survive.

**Claim amended.** The card now claims "no result is ever shown without its Evidence durable, and Evidence that was never delivered is marked", not "one atomic commit".
**Test.** Hold commits with `ControlledStorage.holdCommits()` and `crash()` [seen, `durable:test/session-support.ts:61-63`], injecting before the Evidence commit, between the two commits and after the result commit. Assert the invariant and the `delivered` marks.
**Residual risk.** Two commits per call instead of one; the overhead must be measured against the card's 5% threshold (`a-durable.md:51`).
**Status:** closed-by-design (claim amended).

### W-D1-3 Handing the file between machines
**Design change.** Handover goes through `export`, which runs `VACUUM INTO`, never a raw copy.
- A raw copy loses the `-wal` file, the trap leanrea lists [seen, `leanrea:leanrea/SKILL.md:50`]. `VACUUM INTO` also drops free pages that may still hold redacted content (SEC-6).
- Open checks the schema version and refuses with a typed error; without that check, an older reader fails on schema v2 [seen, `durable:CHANGELOG.md:9`].

**Status:** closed-by-design for handover. Concurrent editing is a **scope-cut**: it is a spec non-goal [seen, `durable:docs/spec.md:5614`].

### Judge's D-1 must-fixes
- **Split `mutatesSession`.** That split is A-rea's (`rea.md` O3). My X-7 design makes replay depend on the *execution profile*, not on that flag, so D-1 no longer depends on it.
- **Model request re-sent, and budgets:** covered by X-10.
- **Injection test.** X-2 is A-leanrea's; I offer pi-durable's faux provider as the harness for the corpus [seen, `durable:README.md:859`].
- **RL-5 wording:** published as "loses at most the step in flight; a model request in flight is re-sent and charged".
- **RL-2 (the portable file carries target content):** covered by SEC-6 and the `VACUUM INTO` export.

**Status:** closed-by-design, except the injection corpus, which depends on X-2.

### W-D2-1 The official client's built-in tools bypass the gateway
**Partial rebuttal with evidence.**
- **Claude path.** t3code already runs Claude with built-ins off: `--tools ""` for plain generation, or an explicit `--tools`/`--allowedTools`/`--disallowedTools` set, plus `--strict-mcp-config` [seen, `t3code:apps/server/src/textGeneration/ClaudeTextGeneration.ts:217-226`]. It registers MCP servers over the SDK control channel [seen, `t3code:apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts:893-940`].
- **Codex path.** t3code sets `approvalPolicy` and `sandboxPolicy` per turn [seen, `t3code:apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts:680-704`]. Whether Codex's own shell can be removed entirely, rather than only sandboxed, is [unknown].

**Design.** Effects go only through the gateway. The client starts with built-ins off where it supports that, and otherwise runs in a read-only sandbox with approval `untrusted`. A canary test asks the agent to run a built-in shell command and asserts that it is refused.
**Status:** closed-by-design for the Claude path, pending the canary test; unresolved-owner for the Codex path until the shell question is answered.

### W-D2-2 "At-most-once" is overclaimed
**Conceded as written.** After `interrupted`, the model can call again with a new call ID [seen, `durable:src/harness/tool.ts:195`; F3], and a lease check cannot be atomic with an external effect.

**Design change (narrow claim).**
1. **Effect key from inputs, not the call ID.** The gateway computes `effectKey = H(case, target, operation, canonical payload)`, so a re-call with a new call ID hits the same record.
2. **Record states:** `intended`, then `done`, or `possibly-done` when a crash fell after intent. A call against a `possibly-done` key is blocked until it is reconciled, through the target's lookup by key or by a person. The same key with a different payload is refused with `request_mismatch`, as Orca does (`donors.md` row 4, adapt).
3. **Forward the key** to the target as its idempotency key wherever the target accepts one.
4. **Scope cut.** For targets with neither a key nor a lookup, every call needs human approval.

**Revised claim.** "The gateway never re-runs an effect it recorded. Effects that cross a crash are held until reconciled. Duplicates are prevented end to end only for targets that accept the key."
**Test.** 8 workers, random kills, and a fake tracker that counts posts per key. Assert 0 duplicates for keyed targets and 0 unreconciled `possibly-done` records left over.
**Status:** conceded (old claim); closed-by-design (new claim); scope-cut (targets without a key).

### W-D2-3 Not an analysis product
**Accepted** (see §3, item 3). **Status:** scope-cut; D-2 is no longer a candidate on its own.

### Judge's D-2 rows
- **EPI-1, no path fix named:** adopt S-2's separate observation and claim IDs (§3, item 4).
- **PERF-2 = U:** the gateway catalog is measured with leanrea's sizer (`leanrea.md` L11) before any number is claimed.
- **AGT-1 = U:** adopt the T3 envelope (`donors.md` row 14), pending A-leanrea's X-2 corpus.
- **RL-2, SecretRef stores plain 0600 files:** back it with the OS keychain, as `donors.md` row 12 already requires.

**Status:** closed-by-design; AGT-1 depends on X-2.

## 2. Cross-card gaps I own

### X-3 Model access versus delegated sign-in
**Evidence** [all seen]:
- pi-durable takes a pi-ai `Models` object (`durable:src/harness/types.ts:217`), and pi-ai accepts custom providers (`ai:src/models.ts:1061`; `ai:README.md:1226`).
- pi has an MCP *client* only (`pi:packages/mcp/README.md:3`); a grep of pi's packages found no ACP code.
- `ToolTask` and `AssistantEntry` are exported, and a tool task's input can point at an assistant entry (`durable:src/index.ts:3,60`; `durable:src/harness/tool.ts:62-63`).
- t3code drives the official clients and gives them tools over MCP (W-D2-1 citations).

**Option rejected: a pi-ai provider that delegates to the official SDK.** To keep pi-durable's loop, the SDK would have to return a tool call without running it. That uses an agent SDK as a disguised raw-completion endpoint: fragile [inferred], and too close to the guardrail's "presenting as an official client".

**Design: two modes, one kernel.**
- **Mode A, delegated (default; interactive and local).**
  - The official client (Claude Agent SDK or CLI, `codex app-server`, an ACP agent) owns the loop, in a separate config home per account (`donors.md` rows 9-10). The product is an MCP stdio server.
  - Each MCP call is recorded in a pi-durable *case conversation*: commit an `AssistantEntry` that mirrors the client's call, then create a `ToolTask` with `{kind: "model", assistant, callId}`. Intent, replay policy, parking and Evidence-ahead (W-D1-2) all apply on the tool side. The client's own transcript is not ours; the case conversation is our record.
  - Running `ToolTask` outside a generation is a **one-day spike** [inferred]; the fallback is to re-implement `tool.ts:144-208` as a pattern.
- **Mode B, API key (unattended CI and fleet).**
  - pi-durable hosts the loop with pi-ai providers on API keys only, stored through SecretRef.
  - **Guard needed.** pi-ai switches to the Claude Code identity headers for any key containing `sk-ant-oat` [seen, `ai:src/api/anthropic-messages.ts:1014-1016`, `:1049-1069`] and reads `ANTHROPIC_OAUTH_TOKEN` from the environment [seen, `ai:src/providers/anthropic.ts:43`]. So the host wraps `Models` to refuse that key prefix and the OAuth env variables, and never calls `login`.

**Still needs API keys:** Mode B, and any unattended run whose provider terms do not allow a subscription.
**Residual risk.** In Mode A, model spend, crash re-sends and the client's built-ins are outside our guarantee (W-D2-1). Two modes double the product surface. Provider terms for a third party driving the official client on a subscription, in particular in CI, are [unknown].
**Test.** Mode A spike: kill the MCP server mid-call and assert the call is settled `interrupted` or rerun per policy. Mode B guard: a key containing `sk-ant-oat` is refused before any request. A network capture shows no `user-agent: claude-cli` from the product.
**Status:** closed-by-design (mechanism); **unresolved-owner** (terms).

### X-7 Replay and approvals from self-declared effects
**Evidence.** rea's effects are declarations, and `mutatesSession` marks almost every tool (`rea.md` O3). pi-durable builds an environment per call (`durable:README.md:425-440`), and `wrapTool` can replace a tool's execution (`durable:README.md:295-302`) [seen].

**Design: replay safety belongs to the execution profile, not to the declaration.** The declaration only picks a profile; the profile enforces it.

| Profile | Network | Subject | Writes | Process |
|---|---|---|---|---|
| `inspect` | none | read-only bind | per-(task, attempt) scratch, discarded on rerun | orca process-host (`donors.md` row 1) |
| `detonate` | — | — | — | runs foreign code; approval is always required |

- **Replay rule.** `replay: "safe"` is granted only to steps that ran under `inspect`. An under-declared tool that tries network or writes outside scratch *fails* rather than leaking.
- **Approvals** follow the profile: `detonate`, and any effect outside the gateway, always need approval. Declarations are hints for the UI only.
- **rea session state** counts as replay-safe only when it can be rebuilt from the step's inputs (coordinated with A-rea's `mutatesSession` split).

**Residual risk.** Enforcement depends on Linux namespaces or containers, and the isolation donor is pattern-only with no LICENSE (`donors.md` row 21). macOS and Windows get weaker enforcement and must declare it (links to X-8).
**Test.** Adversarial tools declared read-only that (a) open a socket and (b) write outside scratch must fail under `inspect`. A kill test checks that scratch resets between attempts.
**Status:** closed-by-design on Linux; unresolved-owner for other host platforms.

### X-10 Spend re-sent after a crash, no budget
**Evidence** [all seen]:
- The `request` phase reruns and sends a new request (`durable:src/harness/generation.ts:209-236`), but a lost attempt is visible, because `live.generation = {attempt}` is committed before streaming (`:212-216`).
- `beforeTool` can block a call (`durable:src/harness/tool.ts:148-158`).
- Usage is kept per conversation, model and tool (`durable:README.md:749-755`).

**Design.**
1. **Budgets before work.** A `Budget` document per run and per step: tokens, money (estimated, labelled as such), model calls, tool calls, wall time, nesting depth.
2. **Tool calls are blocked** by a `beforeTool` hook when over budget.
3. **Model calls are blocked** by a `Models` wrapper that checks the committed `pi.usage` against the budget and fails with a *non-retryable* error. Whether `classify()` treats it as non-retryable is [unknown] and needs a check.
4. **Re-sends are counted.** When `request` reruns and finds a `live.generation` attempt already present, the harness records a `request_resent` report and charges an estimate of the lost attempt's input tokens. The generation's restart limit is lowered (for example to 2) so a crash loop cannot multiply spend.
5. **No dedupe promise.** The LLM APIs I read take no idempotency key [inferred]. Deferred and batch providers already resume by stored handle (`durable:src/harness/generation.ts:251-262`) [seen], so they are preferred for unattended runs.
6. **Mode A:** the official client owns spend, and only its usage ledger is read (`donors.md` row 11).

**Residual risk.** The cost of a lost attempt is an estimate, and a budget check before the request cannot stop one in-flight overspend.
**Test.** Kill during streaming and assert one `request_resent` report with the estimate charged. A run over its budget stops with a typed, non-retried error. 2 crash restarts park the generation.
**Status:** closed-by-design (budgets, visibility); conceded (no dedupe of model requests).

### SEC-6 Secrets inside targets stored unredacted
**Evidence.**
- Transcript entries are immutable and kept forever (`durable:README.md:539`) [seen].
- Live output is committed every 100 ms, *before* `afterTool` runs (`durable:README.md:500`, `:621`) [seen].
- For `pi.live`, which keeps only its latest value, earlier revisions are deleted when a new base is written (`durable:src/storage/sqlite/storage.ts:922-925`) [seen], but the bytes can survive in SQLite free pages and the WAL until checkpoint or vacuum [inferred].
- So redaction after the commit is impossible, and redaction in `afterTool` alone is too late.

**Design.**
1. **Redact at the source.** A tool wrapper replaces `api.output` and the result channels (`output`, `structuredOutput`, `details`) with redacting versions. Wrappers that transform output must set `outputWindow` to undefined (`durable:src/harness/types.ts:229-231`) [seen]. Detection uses pattern and entropy rules; the detector's source and licence are open [unknown].
2. **Fingerprint, don't store.** A found secret becomes `secret:<type>:<sha256/12>` plus its location. The value is *not stored by default*: reporting that a key exists does not need the key. Keeping it is opt-in, into a keychain-backed SecretRef (`donors.md` row 12), never in Evidence.
3. **Evidence identity.** The observation ID is computed over the redacted projection, with a `redactions` list (coordinated with A-rea's X-1 and S-2's spec), so the ID stays stable and leaks nothing.
4. **Storage hygiene.** `PRAGMA secure_delete=ON`. Export only through `VACUUM INTO` (W-D1-3). Export refuses when the scan finds unredacted secret patterns.
5. **The model sees only redacted text,** so nothing reaches a provider request.

**Residual risk.** Detection has false negatives (novel formats). A fingerprint of a low-entropy secret can be brute-forced, so short secrets get a type-only marker.
**Test.** A seeded-secret corpus (cloud keys, private keys, JWTs) inside archives and binaries. Grep the SQLite file, the WAL, the export and a provider request capture; each must show 0 hits.
**Status:** closed-by-design; unresolved-owner on keeping secret values at all.

## 3. The forced merges

1. **R-1 + D-1 + L-1 → durable case file: accept, amended.** D-1 supplies the runtime rules (lease row, Evidence-ahead, budgets, profiles, two-mode model access). R-1 supplies the record and coverage. L-1 is the escalation policy inside it, with the runner opening unknowns (W-L1-1). *Amendments:* Mode A (an MCP server under an official client) is the default shape, not pi-durable owning the loop; the step key is computed from inputs, per W-R1-1 and B-1, and is never the Evidence ID.
2. **R-2 + L-2 + B-1 → CI sweep and delta gate: accept.** Mode B and the X-7 `inspect` profile apply there. *Amendment:* if the owner answers "one worker" (J-02), the sweep runs on the SQLite lease row and Postgres is not required.
3. **D-2 as the effects layer: accept, amended.** It is the effects layer of *both* candidates, because the case file also launches targets and files findings. Its claim is the narrow one from W-D2-2. Its code is the tool-task rule plus effect keys, sharing one conformance suite with absurd's adapter.
4. **S-2 as a mandatory layer: accept, amended.** The spec must carry separate observation and claim IDs (W-S2-2), the input-derived step key, the `redactions` field (SEC-6), and `delivered: false` for Evidence written ahead of a result that never landed (W-D1-2).
