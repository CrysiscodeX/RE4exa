# 03 Ideas: A-absurd

Advocate: A-absurd. Inputs: [02-framing.md](../02-framing.md), journal J-02, [01-anatomy/](../01-anatomy/). Organ references read *file → organ (verdict)*. Labels: [seen], [inferred], [unknown]. Both cards build on what only absurd brings: multi-worker leases on a shared Postgres, enqueueing inside the caller's transaction, and first-write-wins events and durable sleeps.

**Techniques used:** **combination matrix** and **donor-enabled variant** (B-1: what two organs gain by writing in one Postgres transaction, plus Orca process-host and receipts and strix coverage); **inversion** (B-2: absurd is obsolete if every run is one process on one laptop, so B-2 targets work that outlives a process, a machine and a person) and **constraint shift, "one schema, embedded or shared"** (B-2; the embedded half is *unknown* until PGlite is tested, absurd.md §4).

Combination matrix (B-1). Each cell is what the pairing adds in one transaction [inferred]:

| | rea O5 Evidence | rea O7 Unknowns | pi-durable 6 Tool intent | strix 18 coverage.json |
|---|---|---|---|---|
| **absurd O2 checkpoints** | Evidence row and step checkpoint commit together: each finding is recorded once | An unknown's revision commits with the step that raised it | The intent commits before the effect; replay follows the stated policy | Coverage is written per step, so a killed run still shows what it examined |
| **absurd O3 lease** | Writes fenced by run id (needs the absurd.md O3 fix) | Many workers probe one fleet's unknowns | Only the new lease holder reruns a tool | — |
| **absurd O4 events / spawn key** | `evidence.recorded:<ev_id>` wakes tasks; spawn key = sha256 + probe + tool version | `unknown.resolved:<id>` wakes dependants; spawn key = unknown id | — | — |

## B-1 Fleet ledger

**Thesis.** Fleet artifact analysis in which every finding, open question and coverage gap is a row committed in the same Postgres transaction as the durable step that produced it. Many workers share one ledger with no duplicate or orphaned evidence.

**Users and scenario.** A platform or supply-chain team.

1. The release pipeline inserts its release row and spawns the analysis in the same transaction (absurd.md O8, `bindToConnection`). If the release rolls back, nothing is queued.
2. Twenty workers claim artifacts. Each tries leanrea's router row first and escalates to a rea provider only when needed, recording why. Every tool runs under Orca's process-host.
3. A question that cannot be answered becomes a residual unknown and spawns a probe task keyed by the unknown's id. A vendor reply emits `unknown.resolved:<id>`.
4. CI reads one SQL view (findings with evidence ids, open unknowns, formats not covered) and exports it as an evidence bundle and an attestation predicate.

**Organs used:**

- **absurd.md:** O2 state machine (lift), O3 lease (lift with fixes), O4 events (lift), O7 fake clock (lift), O8 TS SDK (adapt), O11 absurdctl read commands as JSON (adapt).
- **rea.md:** O5 Evidence (lift, with the nested-path fix), O7 unknowns (lift), O6 ledger rules on a Postgres table (adapt), O3 effect audit and untrusted marker (lift), O10/O11 readers and JS analysis as subprocess providers (adapt).
- **leanrea.md:** L5 router table as data (adapt), L4 labels (pattern).
- **pi-durable.md:** 6 intent before effect (lift, rewritten as an absurd step helper), 5 crash-loop parking (pattern).
- **donors.md:** 1 Orca process-host (lift), 4 Orca mutation receipts for the MCP surface (adapt), 18 strix coverage.json (adapt), 17 strix closure discipline (pattern).

**New, against the null option.** The null option is rea's CLI inside absurd steps, with a bundle exported per artifact. That works today. But findings then live in two stores, and each one is recorded once only if the export is idempotent [inferred]. B-1 adds three things no repo does today [inferred from the anatomy]:

1. Evidence commits atomically with its step and is fenced by run id.
2. Unknowns become deduplicated tasks that wake on events.
3. The whole fleet can be queried in SQL, for example "which releases ship this native module, and with what authority?".

**Integration surfaces.**

- The SQL function API; spawn inside the caller's transaction.
- A loopback MCP server of 6 to 8 tools with a per-run bearer token (donors.md 25, pattern).
- A JSON CLI; webhook → `emit_event`; export as an evidence bundle and an in-toto/SLSA predicate.

**Model accounts.** Most steps use no model. For triage, the operator supplies a key through the provider's official SDK, or signs in through the official CLI, SDK or ACP into one home per account (donors.md 9 and 10). pi-ai's Claude OAuth path is excluded. Workers never rotate accounts.

**Fit for 2030–35.** CRA: evidence per release plus a declared negative space. Agents as callers: a small MCP surface with bounded JSON. Durability: fleet runs survive crashes. Gap: only the "shared service" half of "local first".

**My top 3 weak spots.**

1. **Postgres is a hard dependency** (framing §6, "services required").
2. **Thin merge.** Most rea organs pull in 90–120 files (rea.md §4), so workers run rea as a subprocess, and the margin over the null option is the ledger schema and the step helpers.
3. **Effects inside a step stay at-least-once** (absurd.md §3). Every run also reloads every checkpoint (REL-2), so evidence needs its own table rather than checkpoint payloads.

**What would prove it wrong.**

- A kill test (step *k*, two workers, expired leases, 1,000 artifacts) where the null option with idempotent keys loses, duplicates and orphans no more evidence than B-1.
- Target teams will not run Postgres.
- More than 90% of steps are short and deterministic, so a plain queue suffices. (All three are *unknown* today.)

## B-2 Standing investigations

**Thesis.** An investigation is a durable task that can sleep for weeks, until a new release, an analyst's reply or a resolved unknown. Any worker, or any person, can take it over, because ownership is a lease, not a process.

**Users and scenario.** An analyst, or an agent in a coding or security session.

1. An agent asks what a desktop app's helper binary does. The investigation records evidence and three open unknowns, then waits with `awaitEvent("release:<product>")`.
2. Two weeks later a release webhook emits that event. A team worker claims the investigation, runs the router and rea's compare, resolves one unknown, and waits on `handover:<inv>`.
3. A colleague's agent, on another machine with its own account and home, continues from the same transcript and ledger.

The same schema runs embedded for one analyst (*unknown*: PGlite) or on a shared Postgres.

**Organs used:**

- **absurd.md:** O2, O3, O4 as session ownership, wake-ups and sleeps (lift); O5 retries (adapt); O8 SDK (adapt).
- **pi-durable.md:** 6 tool intent and replay (lift), 4 phase and effect-sandwich model (pattern), 5 parking (pattern), 8 requestId inbox (lift the semantics, add UNIQUE), 9 typed transcript (pattern).
- **rea.md:** O5, O7 (lift); O6 ledger in Postgres (adapt); O3 untrusted marker (lift).
- **leanrea.md:** L5 router (adapt), L4 labels (pattern), L2 budget rules (adapt).
- **donors.md:**
  - 9 and 10 delegated sign-in, one home per account (adapt / pattern);
  - 12 SecretRef (adapt);
  - 26 restart settlement (pattern);
  - 5 liveness vocabulary (adapt);
  - 25 loopback MCP host (pattern), in place of habitat (absurd.md O12, leave).

**New, against the null option.** The null option is a pi-durable session in SQLite on one laptop. Handover means copying the file, and two processes on one store silently overwrite each other (J-02). absurd alone has no transcript, replay policy or inbox. B-2 adds:

1. Handover between machines and people that is safe under a lease, with the run id as the fence.
2. Wake-on-world-change through first-write-wins events.
3. One evidence ledger that both agents and people write into.

**Integration surfaces.**

- MCP tools `open`, `status`, `evidence`, `unknowns`, `handover`, `submit`.
- Webhook → `emit_event`; a JSON CLI; evidence bundle export.
- Each person's own official provider CLI, SDK or ACP in their own home. A handover never moves a credential.

**Fit for 2030–35.** Local first with an optional cloud, if the embedded mode works. Identity across many providers: one home per person and account, never pooled. Durability for runs that last days.

**My top 3 weak spots.**

1. **The agent semantics must be rebuilt.** pi-durable organs 6–9 on absurd steps are a design change, not a lift (pi-durable.md §5.3). This is the largest new code in either card.
2. **The embedded mode is unproven.** If PGlite cannot run absurd.sql, a lone analyst needs Postgres, and pi-durable on SQLite wins that user.
3. **A shared, long-lived store of untrusted artifact text.** absurd has no role or grant model (absurd.md O2). Evidence text can carry prompt injection to the next agent (rea.md O3 must apply everywhere). Whether provider terms allow long unattended runs through an official CLI is *unknown* (J-02).

**What would prove it wrong.**

- Median investigations end within one session (under about 1 h, an estimate) and handovers are rare; session logs can measure this.
- A lease-per-session adapter for pi-durable (A-durable's route) gives the same handover with less new code.
- The PGlite spike fails.
