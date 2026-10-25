# 03 Ideas: A-durable (two cards)

Advocate: A-durable. Layer 3, divergent. Both cards centre on what pi-durable contributes: an embedded durable agent runtime, intent recorded before every effect, dual replay policies, crash-loop parking, requestId dedupe and the code-mode journal. They borrow organs from rea, leanrea, absurd and the donors. Organ references point to `01-anatomy/<file>.md` with the organ and its layer-1 verdict; source citations use the prefixes defined in `01-anatomy/pi-durable.md`.

**Labels.** Each statement is **[seen]**, **[inferred]** or **[unknown]**. Every product claim below is **[inferred]** unless marked otherwise, because nothing here has been built. Byte, time and count targets are estimates.

**Guardrails.** Model access goes only through sanctioned delegation (official CLI, SDK or ACP sign-in, T3 Code's pattern: `01-anatomy/donors.md` row 9, adapt). pi-ai's Claude OAuth path is excluded (`01-anatomy/pi-durable.md` organ 14, leave). Agents start with approvals on.

**Techniques used:** combination matrix (both cards); constraint shift, to zero-dependency single file (D-1) and agent-only interface (D-2); inversion, asking what would make pi-durable obsolete (D-2); donor-enabled variant (both cards).

## Combination matrix (organ × organ, the cells that produced the cards)

| pi-durable organ ↓ / other organ → | rea 5 Evidence record (lift) | rea 3 Effect audit (lift) | rea 7 Residual unknowns (lift) | leanrea L5 Router (adapt) | absurd O3 Claim and lease (lift with fixes) | orca 4 Mutation receipts (adapt) | strix 18 coverage.json (adapt) |
|---|---|---|---|---|---|---|---|
| 6 Tool task, intent before effect (lift) | Evidence committed in the **same commit** as the tool result → **D-1** | Replay policy *derived* from declared effects, not hand-set → **D-1, D-2** | — | — | Intent row written under a lease → **D-2** | Receipt key = intent id → **D-2** | — |
| 9 Transcript and compaction (adapt) | Transcript entries point to evidence IDs → **D-1** | — | Open questions survive compaction as documents → **D-1** | Escalation decisions recorded as entries → **D-1** | — | — | Coverage as a committed document → **D-1** |
| 13 Code-mode journal (adapt) | A replayable analysis script yields the same evidence IDs → **D-1** | — | — | Router commands run as journaled nested calls → **D-1** | — | — | — |
| 5 Crash-loop parking (pattern) | — | — | Parked artifact → residual unknown "could not analyse" → **D-2** | — | Parking counted per run across workers → **D-2** | — | Parked = unexamined in coverage → **D-2** |
| 16 Conformance kits (adapt) | — | — | — | — | Same kill-at-step-k suite on SQLite and Postgres → **D-2** | Receipt replay test → **D-2** | — |

Rejected cells: rea 6 Ledger × pi-durable 1 Session kernel (two stores of truth); absurd O2 × pi-durable 4 (two task engines in one process).

---

## D-1 Investigation Log: a single-file, crash-proof analysis session

**Thesis.** An investigation is a pi-durable session in one SQLite file: each analysis step is an intent-recorded tool task whose evidence is committed in the same atomic commit, so a killed run loses at most the step in flight and anyone can reopen and continue it.

**Users and scenario.** A security reviewer, or a coding agent acting for one, asks "what does this Electron installer actually do?"
1. The agent starts with leanrea's router (one batched inventory call for the detected type), then escalates to rea's ASAR reader and JS analysis only where the router cannot answer; each escalation reason is recorded as an entry.
2. After 40 minutes the laptop sleeps and the process is killed. On reopen, read-only steps rerun (their effects say "no mutation, no network", which makes them replay-safe), a step that launched the target is settled `interrupted`, and the open questions are still in the residual-unknown document.
3. The next day a colleague opens `investigation.sqlite` on another machine under a new owner lease (single owner, see weak spot 1) and continues. The final report cites evidence IDs that resolve inside the same file.

**Organs used.**
- *pi-durable:* tool task 6 (lift), task model 4 (adapt), parking 5 (pattern), submissions 8 (lift), transcript 9 (adapt), code mode 13 (adapt), SQLite storage 2 (adapt: add a lease row, a UNIQUE requestId and in-transaction ID minting).
- *rea:* evidence record and content-addressed ID 5 (lift; fix the ID's dependence on paths, per J-02), effect audit 3 (lift), residual unknowns 7 (lift), artifact readers 10 (adapt), JS/Electron analysis 11 (adapt).
- *leanrea:* L5 router as data (adapt), L4 evidence labels (pattern), L2 budget rules (adapt).
- *Donors:* orca row 1 process-host (lift), replacing pi-durable's bash defaults (`01-anatomy/pi-durable.md` organ 11, leave); strix row 18 coverage.json (adapt); caveman row 16 content-addressed handles for large results (pattern); t3code row 9 delegated sign-in (adapt); t3code row 14 untrusted-content envelope (adapt).

**Genuinely new versus the null option.** Composed as they are, rea's ledger stays in memory (`01-anatomy/rea.md` organ 6). pi-durable sees rea's tool results only as opaque text, and a crash still loses every finding not yet in the transcript. Three things are new: evidence and the tool result share one atomic commit; replay safety is computed from rea's effect declarations, where today pi-durable defaults every tool to `unsafe` (`durable:src/harness/tool.ts:175`) [seen]; and coverage and residual unknowns become durable documents that outlive compaction. None of this exists across the four repos today [inferred from layer 1].

**Integration surfaces.** An MCP stdio server with a small catalog (triage, analyse, cite, resume, report); a library API in the `Harness` shape; a documented SQLite file format that doubles as the exit format (`01-anatomy/pi-durable.md` organ 2, INT-7 4); an ACP or official-SDK client for the model. No services.

**Fit for 2030–35.** Durability is expected (framing §4), and the file *is* the investigation. Content-addressed evidence plus the transcript gives an audit trail that could feed SLSA-style attestation. Zero services keeps it local first. Router-first escalation and handles for large results limit context cost. Delegated sign-in means no stored model credentials.

**My top 3 weak spots.**
1. **A single owner is a real limit.** A lease stops the silent overwrites, but two people cannot work at once. Merging two divergent copies of the file is unsolved, and pi-durable's spec lists offline multi-writer merge as a non-goal (`durable:docs/spec.md:5614`) [seen].
2. **Replay-safe-from-effects is only as good as the declarations.** A rea tool that under-declares `accessesNetwork` would be rerun. The effect audit is self-reported data, not enforced isolation.
3. **The pi-durable kernel is experimental and Chord-coupled** (`01-anatomy/pi-durable.md` organ 1, pattern; EVO-1). Building on it imports API churn; rewriting it as a pattern costs much of the advantage.

**What would prove it wrong.** A kill-at-random-step test over 50 investigations loses evidence that a tool had returned, or reruns a step declared unsafe. Reviewers given the resumed file do no better (time to continue, findings re-derived) than with rea's JSON snapshot plus notes. Per-step commit overhead exceeds about 5% of step time (estimated threshold).

---

## D-2 Effect Gateway: durable effects for agents you do not host

**Inversion.** Two things would make pi-durable obsolete. First, the turn loop moves into the providers' official clients (Claude Agent SDK, `codex app-server`, ACP agents); owning the loop then has no value, and owning it with subscription credentials is exactly what the guardrail forbids for pi-ai. Second, durability moves into a shared Postgres engine such as absurd. What survives both is the **effect rule**: commit intent, run the effect, settle or mark interrupted, and never repeat an unsafe effect.

**Thesis.** Ship only that rule, as an MCP gateway that every effectful analysis tool goes through: it works with any official agent client, keeps intent and receipts in SQLite locally or under absurd leases for a fleet, and gives fleet analysis at-most-once side effects.

**Users and scenario.** A supply-chain team re-checks 400 npm tarballs per release in CI, with 8 workers each running an official agent client with approvals on.
1. Each artifact is one absurd task, claimed under a lease. The agent calls gateway tools: fetch (replay-safe, content-addressed), unpack, analyse (replay-safe from effects) and file-finding (unsafe: posts to the tracker).
2. Worker 3 dies mid-run, its lease expires, and worker 5 claims the task. The gateway replays the safe steps and answers the posting step from its receipt, or as `interrupted` with the receipt key, so the ticket is not posted twice.
3. An artifact that crashes its analyser 5 times is parked. It becomes a residual unknown listed as unexamined in the coverage record, rather than being silently dropped.

**Organs used.**
- *pi-durable* (logic lifted, Chord kernel left): tool task 6, intent and dual replay (lift); parking 5 (pattern); requestId semantics 8 (lift); conformance kits 16 (adapt: add kill and two-owner tests).
- *absurd:* O3 claim and lease (lift with fixes: refuse writes under an expired lease and forbid timeout 0, per J-02); O2 task/run/checkpoint (lift); O7 test clock (lift); O11 absurdctl (adapt).
- *rea:* effect audit 3 (lift), evidence record 5 (lift), residual unknowns 7 (lift), error contract 8 (adapt).
- *leanrea:* L5 router (adapt), as the gateway's cheapest first tool.
- *Donors:* orca row 4 mutation receipts (adapt); orca row 1 process-host (lift); orca row 5 liveness vocabulary (pattern); t3code row 9 delegated sign-in (adapt); t3code row 10 one config home per account (pattern); t3code row 12 SecretRef (adapt); strix row 18 coverage.json (adapt); agent-sandbox-lockdown row 21 isolation layout (pattern only; it has no LICENSE file).

**Genuinely new versus the null option.** Composed as they are, absurd gives leases but no effect classes; pi-durable gives effect classes but no lease and no multi-process safety (`01-anatomy/pi-durable.md` §3.3); rea's effect declarations are not enforced at replay. Three things are new: the intent row, the receipt and the lease form one record keyed by (task, step, call); replay safety comes from declared effects; and the gateway does not care which official agent client drives it. Neither engine alone offers at-most-once for unsafe effects across a worker death [inferred from layer 1].

**Integration surfaces.** An MCP server with the gateway tools plus `resume`, `receipt` and `coverage`; a storage adapter whose two backends (SQLite single-owner with a lease row, absurd Postgres) share one conformance suite; `absurdctl` for operators; an official CLI, SDK or ACP for models; JSON receipts and coverage for CI.

**Fit for 2030–35.** Agents are the main callers, and the gateway's interface is agent-only with idempotent calls. It never touches model credentials, so the account guardrail holds by construction. SQLite locally and Postgres for a fleet give local first with an optional cloud. Receipts and coverage are CRA-style evidence of what was and was not checked.

**My top 3 weak spots.**
1. **Two storage backends behind one contract double the test surface.** absurd's checkpoint model (re-run from the top with cached steps) and pi-durable's phase model differ, and the adapter may leak either model's semantics.
2. **The gateway sees only calls routed through it.** An official client's own built-in tools (its shell, its file edits) bypass the gateway, so "at-most-once" covers only part of the effects. Approvals and isolation in the client must cover the rest.
3. **Whether a third party may drive official clients on subscription logins in CI is unknown** (J-02 open question). If it is not allowed, fleet use falls back to API keys stored through SecretRef, and the cost case weakens.

**What would prove it wrong.** In a fault-injection run (8 workers, random kills, 400 artifacts), an unsafe effect executes twice, or a parked artifact is missing from the coverage record. An official client cannot be limited to the gateway's tools for effects, so the bypass makes the guarantee meaningless. absurd alone with a 50-line "check receipt before posting" step matches the result; then the null option wins and D-2 should be cut.
