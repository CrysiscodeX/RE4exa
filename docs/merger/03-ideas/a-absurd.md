# 03 Ideas: A-absurd

Advocate: A-absurd. Inputs: [02-framing.md](../02-framing.md), journal J-02, and the files in [01-anatomy/](../01-anatomy/). Organ references use the form *file → organ (verdict)*. Labels: [seen], [inferred], [unknown]. Both cards build on what only absurd brings:

- multi-worker leases on a shared Postgres;
- enqueueing work inside the caller's own transaction;
- first-write-wins events and durable sleeps.

## Techniques used

1. **Combination matrix** (B-1). For each pair of organs, the matrix asks what becomes possible only when they share one Postgres transaction.
2. **Donor-enabled variant** (B-1). Orca's process-host, Orca's receipts, and strix's coverage record fill gaps that none of the four core repos covers.
3. **Inversion** (B-2). Absurd becomes obsolete if every agent run is one process on one laptop. So B-2 targets work that *outlives* a process, a machine and a person.
4. **Constraint shift: "one schema, embedded or shared"** (B-2). The same SQL runs embedded for one analyst and on a shared Postgres for a team. The embedded half is *unknown* until PGlite is tested (absurd.md §4).

Combination matrix (B-1). Each cell says what the pairing adds when both organs write in one Postgres transaction [inferred]:

| | rea O5 Evidence record | rea O7 Residual unknowns | pi-durable 6 Tool task (intent) | strix 18 coverage.json |
|---|---|---|---|---|
| **absurd O2 checkpoints** | The evidence row and the step checkpoint commit together: each finding is recorded exactly once | An unknown's revision commits together with the step that raised it | An intent checkpoint commits before the effect; replay follows a stated policy | Coverage is written per step, so a killed run still shows what was examined |
| **absurd O3 lease** | Writes are fenced by run id, so a stale worker cannot add evidence (needs the absurd.md O3 fix) | Many workers can probe one fleet's unknowns in parallel | A tool reruns only on the new lease holder | — |
| **absurd O4 events** | `evidence.recorded:<ev_id>` can wake waiting tasks | `unknown.resolved:<id>` wakes the tasks that depend on it | — | — |
| **absurd spawn idempotency** | Spawn key = artifact sha256 + probe + tool version | Spawn key = unknown id: one probe task per question | — | — |

---

## B-1 Fleet ledger

**Thesis.** Fleet artifact analysis where every finding, open question and coverage gap is a row written in the same Postgres transaction as the durable step that produced it. Many workers then share one ledger without duplicate or orphaned evidence.

**Users and scenario.** A platform or supply-chain team.

1. The release pipeline inserts its `release` row and calls `spawn` in the same transaction, through `bindToConnection` (absurd.md O8). If the release row rolls back, no analysis is queued [seen as a mechanism].
2. Twenty workers claim artifacts. Each runs leanrea's router row as the cheap first step. It escalates to a rea provider only when the router cannot answer, and records the reason.
3. Each tool runs under Orca's process-host, with a timeout and an output cap.
4. An unanswered question becomes a residual unknown, which spawns a probe task keyed by the unknown's id.
5. When the vendor answers, the probe emits `unknown.resolved:<id>`.
6. At the end, CI reads one SQL view: findings with evidence ids, unknowns still open, formats not covered. That view is exported as an evidence bundle and an attestation predicate.

**Organs used.**

| Organ | Source and verdict | How B-1 uses it |
|---|---|---|
| State machine, lease, events, fake clock | absurd.md O2 (lift), O3 (lift with fixes), O4 (lift), O7 (lift) | The core engine |
| TS SDK, transactional enqueue | absurd.md O8 (adapt) | Spawn inside the pipeline's transaction |
| absurdctl read commands as JSON | absurd.md O11 (adapt) | Agent and CI inspection |
| Evidence record | rea.md O5 (lift, with the nested-path fix) | The claim format |
| Residual unknowns | rea.md O7 (lift) | Open questions as work items |
| Ledger merge and conflict rules on a Postgres table | rea.md O6 (adapt) | One ledger for the fleet |
| Effect audit and untrusted marker | rea.md O3 (lift) | Input to the approval policy |
| JS/Electron analysis and artifact readers, as subprocess providers | rea.md O11, O10 (adapt) | The deep path |
| Router table as data | leanrea.md L5 (adapt) | The cheap first step |
| Labels | leanrea.md L4 (pattern) | Basis of each claim |
| Intent before effect, replay policy | pi-durable.md 6 (lift) | Rewritten as an absurd step helper |
| Crash-loop parking | pi-durable.md 5 (pattern) | Stop tasks that keep killing workers |
| process-host | donors.md 1, Orca (lift) | Supervise tool processes |
| Mutation receipts | donors.md 4, Orca (adapt) | Safe retries on the MCP surface |
| coverage.json | donors.md 18, strix (adapt) | What was examined and what was not |
| Closure discipline | donors.md 17, strix (pattern) | How findings are closed |

**What is new, against the null option.** The null option is rea's CLI inside absurd steps, with a bundle file exported per artifact. That works today, but every finding then lives in two stores, and a finding is recorded once only if the export step is idempotent [inferred].

B-1 adds three things the parts cannot do as they are:

1. **Evidence is committed atomically with the step,** fenced by run id. Duplicates and orphans are excluded by construction once absurd.md O3's expiry check exists.
2. **Unknowns become schedulable, deduplicated tasks** that wake on events.
3. **The whole fleet can be queried in SQL,** for example "which releases contain this native module, and with what authority?".

None of the four repos does any of these today [inferred from the anatomy files].

**Integration surfaces.**

- The SQL function API, which any language can call.
- Spawn inside the caller's transaction.
- A loopback MCP server of 6 to 8 tools, with a per-run bearer token (donors.md 25, pandacode; pattern).
- JSON CLI output.
- Webhook → `emit_event`.
- Export as a rea evidence bundle and an in-toto/SLSA predicate.

**Model accounts.** Most steps need no model. Where triage uses one, the worker's operator supplies a key through the provider's official SDK, or signs in through the official CLI, SDK or ACP into a home for that account only (donors.md 9 and 10; adapt and pattern). pi-ai's Claude OAuth path is excluded. Workers never rotate accounts to raise limits.

**Fit for 2030–35.**

- **CRA duties:** each release gets machine-readable evidence plus a declared negative space.
- **Agents as callers:** a small MCP surface and bounded JSON.
- **Durability:** durable fleet runs are expected.
- **Weak against "local first":** this card is the "shared service" half only.

**My top 3 weak spots.**

1. **Postgres is a hard dependency** (framing §6, "services required"). A team without Postgres pays an operations cost that pi-durable's SQLite avoids.
2. **The thin-merge risk.** rea organs other than O3, O5 and O7 pull in 90–120 files each (rea.md §4), so workers would run rea as a subprocess. The product's value then sits in the ledger schema and the step helpers. That makes the margin over the null option narrow.
3. **Side effects inside a step remain at-least-once** (absurd.md §3). Every run also reloads every checkpoint, which hurts at thousands of evidence rows per artifact (REL-2). Evidence has to live in its own table, not in checkpoint payloads.

**What would prove it wrong.**

- A kill test at step *k*: two workers, expired leases, 1,000 artifacts. The null option (subprocess plus bundle export, with idempotent keys) shows the same counts of lost work, duplicated evidence and orphaned evidence as B-1.
- Or: the target teams will not run Postgres for this.
- Or: more than 90% of steps are short and deterministic, so a plain queue suffices. All three are *unknown* today.

---

## B-2 Standing investigations

**Thesis.** An investigation is a durable task that can sleep for weeks: until a new release, an analyst's reply or a resolved unknown. Any worker, or any person, can take it over, because ownership is a lease, not a process.

**Users and scenario.** An analyst, or an agent in a coding or security session.

1. On Monday, an agent in a coding session asks what a desktop app's helper binary does. The investigation records its evidence and three open unknowns, then calls `awaitEvent("release:<product>")`.
2. Two weeks later a release webhook emits that event. A worker on a team server claims the investigation, runs the router and rea's compare, and resolves one unknown.
3. It then hands the next step to a person with `awaitEvent("handover:<inv>")`.
4. A colleague's agent picks it up on another machine, under its own account and home, and continues from the same transcript and ledger.

The same schema runs embedded for one analyst (constraint shift; PGlite is *unknown*) and on a shared Postgres for the team.

**Organs used.**

| Organ | Source and verdict | How B-2 uses it |
|---|---|---|
| Lease as session ownership, events and sleeps | absurd.md O2, O3, O4 (lift) | Who owns an investigation, and what wakes it |
| Retries | absurd.md O5 (adapt) | Attempt limits and cancellation |
| SDK | absurd.md O8 (adapt) | The worker |
| Tool task (intent, replay) | pi-durable.md 6 (lift) | Effects inside the investigation |
| Phase and effect-sandwich model | pi-durable.md 4 (pattern) | Structure of each step |
| Crash-loop parking | pi-durable.md 5 (pattern) | Stop runs that keep dying |
| requestId inbox | pi-durable.md 8 (lift semantics, add a UNIQUE constraint) | Durable input from people and agents |
| Typed transcript | pi-durable.md 9 (pattern) | The investigation's history |
| Evidence record | rea.md O5 (lift) | The claim format |
| Residual unknowns | rea.md O7 (lift) | What the investigation waits on |
| Ledger | rea.md O6 (adapt) | Stored in Postgres |
| Untrusted marker | rea.md O3 (lift) | Mark artifact-derived text |
| Router | leanrea.md L5 (adapt) | Cheap first step |
| Labels | leanrea.md L4 (pattern) | Basis of each claim |
| Budget rules | leanrea.md L2 (adapt) | Keep output and turns small |
| Delegated sign-in, one home per account | donors.md 9, 10 (adapt, pattern) | Each person's own model access |
| SecretRef | donors.md 12 (adapt) | Secrets never reach the transcript |
| Restart settlement | donors.md 26, pandacode (pattern) | "Interrupted" is recorded honestly |
| Liveness vocabulary | donors.md 5, Orca (adapt) | Lost contact is "unverifiable", never "exited" |
| Loopback MCP host | donors.md 25 (pattern) | Replaces habitat (absurd.md O12, leave) |

**What is new, against the null option.** The null option is a pi-durable session in SQLite on one laptop. It can be handed over only by copying the file, and two processes silently overwrite each other (J-02). absurd alone has no transcript, no replay policy and no inbox.

B-2 adds:

1. **A handover between machines and people that is safe under a lease,** with the run id as the fencing token.
2. **Wake-on-world-change,** through release webhooks and unknown resolution, using first-write-wins events.
3. **One evidence ledger** that both the agent and the person write into.

**Integration surfaces.**

- An MCP server with a few tools: `open`, `status`, `evidence`, `unknowns`, `handover`, `submit`.
- Webhook → `emit_event`.
- A JSON CLI.
- Each person's own official provider CLI, SDK or ACP, under their own account home.
- Evidence bundle export.

**Fit for 2030–35.**

- **Local first with an optional cloud,** if the embedded mode works.
- **Identity across many providers:** each person's account and home stay theirs, and a handover never moves a credential.
- **Durability** of runs measured in days.

**My top 3 weak spots.**

1. **The agent semantics must be rebuilt.** Putting pi-durable organs 6–9 onto absurd steps is a design change, not a lift (pi-durable.md §5.3). It is the largest piece of new code in either card.
2. **The embedded mode is unproven.** If PGlite cannot run absurd.sql, a single analyst needs Postgres, and pi-durable on SQLite wins that user outright.
3. **A shared, long-lived store of untrusted artifact text** creates new risks:
   - absurd has no role or grant model (absurd.md O2);
   - evidence text can carry prompt injection into the next agent (needs rea.md O3 everywhere);
   - whether provider terms allow a third-party product to drive the official CLI for long unattended work is *unknown* (J-02).

**What would prove it wrong.**

- Median investigations finish within one session (under about an hour, an estimate), and handovers are rare.
- Or: an adapter that gives pi-durable a lease per session (A-durable's route) delivers the same handover with less new code.
- Or: the PGlite spike fails and no cheap embedded Postgres exists.

The first two can be measured from session logs and from a prototype of each card; that work belongs to a later phase.
