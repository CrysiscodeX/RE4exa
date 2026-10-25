# 04 Debate, round 2: A-absurd

Inputs: [round-1-skeptic.md](round-1-skeptic.md), [round-1-judge.md](round-1-judge.md), journal J-04.

**Notation.** Clone citations are `absurd:path:line` at `3cfc64f`. Labels: [seen], [inferred], [unknown]. "Spike" means runs I made in `scratchpad/pglite-spike/scripts/` (`spike.mjs`, `spike2.mjs`, `fence.mjs`, `events.mjs`) against unmodified `absurd.sql` on `@electric-sql/pglite@0.5.8`, which reports "PostgreSQL 18.3 (PGlite 0.5.8) … wasm32". `node_modules` has since been deleted. The spike outputs quoted below are [seen].

## 1. Weak spots and judge criticisms

**W-B1-1: Postgres is a hard dependency.**
- *Rebuttal, in part.* The spike loaded `absurd.sql` into an embedded PGlite in 39 ms and ran the whole lifecycle with no changes: spawn, idempotent spawn, claim, checkpoint, lease reclaim, events, partitioned queue, cleanup. Data survived a close and reopen from a data directory (`spike2.mjs`). So "Postgres" no longer means "a Postgres service".
- *What remains.* A shared, multi-worker ledger does need a server. Status: **unresolved-owner**, narrowed to the J-02 question: "more than one worker process?" A single-process deployment needs no service (see X-4).

**W-B1-2: no role model.** The gap is confirmed: `sql/absurd.sql` has no GRANT or REVOKE. *Design change:*
- **Roles.** Three NOLOGIN roles: `absurd_owner` owns the schema and functions; `absurd_worker` may execute only the worker functions (claim, checkpoint, extend, complete, fail, schedule, await, ledger append); `absurd_reader` may execute only the read functions and read-only views.
- **Privileges.** `REVOKE ALL ON SCHEMA absurd FROM PUBLIC`.
- **SECURITY DEFINER.** Writers become SECURITY DEFINER with `SET search_path = absurd, pg_temp`. This is the documented safe pattern; without it the functions can be hijacked through `search_path`.
- **Row ownership.** Each ledger row carries `writer_run_id` and is accepted only under the lease fence below.
- **Tenants.** Row-level security per tenant is an *option*, not the default.

Residual risk: the dynamic `%I` DDL inside definer functions has to be audited. Test: a pytest that connects as each role and checks that every function outside its allowlist fails with `42501`. Status: **closed-by-design** (not yet built).

**W-B1-3: the lease fence.** Design in §2.2. A prototype on PGlite rejects every write from a lease that has expired but not yet been swept. Status: **closed-by-design** (prototyped).

**Judge, B-1, PERF-2: "bounded JSON" with no bounds.**
- *Design change.* Every MCP or CLI read returns at most 8 KiB by default (a target, not yet measured). Lists hold at most 50 rows and carry a `next` cursor. Payloads come back as `{digest, bytes, preview≤512 B}` and are expanded only on request.
- absurdctl's unbounded `dump-task` (`absurd:absurdctl:2401-2440`) is replaced by a paged read. Status: **closed-by-design**. The bytes per answer get measured as part of X-9 (A-leanrea).

**Judge, B-1 and B-2, AGT-1: untrusted text in a shared store.**
- *Design change, B-1's part.*
  - Text derived from a target is stored only in an `untrusted_text` column, with the source digest and rea's O3 marker.
  - Read tools return structured fields by default, and return untrusted text only inside the envelope that A-leanrea designs under X-2.
  - A role-scoped view hides untrusted text from automated consumers unless they ask for it.
- The enforced boundary and the injection evaluation are owned by A-leanrea (X-2). Status: **unresolved-owner** until X-2 is settled.

**Judge, B-1, SEC-8 (no sandbox) and AGT-6/SEC-6 (budget, operator key).**
- *Scope cut.* B-1 workers run parsers only inside the isolation layout (donors.md 21, pattern), with no network.
- The operator key reaches the worker as a SecretRef (donors.md 12) and never enters the ledger.
- The spend budget is enforced per task through `max_attempts` plus X-10's ledger (A-durable). Status: **scope-cut**, with the budget **unresolved-owner** (X-10).

**Judge, B-1, red lines.**
- RL-4: absurdctl's remote SQL fetch is removed (absurd.md O11).
- RL-5: the product says "at-least-once execution, exactly-once recording". This is accurate under the fence (absurd.md §3). Status: **closed-by-design**.

**W-B2-1: waits on a reused name misfire.** *Verified* (`events.mjs`):
- A second `await_event` on `release:app`, after one emit, returned `{"should_suspend":false,"payload":{"v":"1.0"}}` at once.
- After TTL cleanup the same name could be emitted *again* with a new payload (`{"v":"2.0"}`). So "first write wins" in fact means "first write wins within one TTL window" (`absurd:sql/absurd.sql:1906-1922, 2252-2294`).
- Design in §2.3: sequenced topics, a cursor per task, and detection of gaps. Status: **closed-by-design** (prototyped).

**W-B2-2: the need is unproven and the new code is large.** *Accepted.* B-2 becomes an option of the case file (§3). It is enabled only if session logs show handovers or waits that last longer than a session. Status: **scope-cut**.

**W-B2-3: the embedded mode is unknown.** *The spike closes most of it.*
- What worked unmodified on PGlite: every core function, SKIP LOCKED claims, the `$ClaimTimeout` sweep (after which a stale writer gets `AB002`), attempt-scoped checkpoint visibility, first-write-wins events, partitioned queues, and persistence across reopen.
- `enable_cron` fails cleanly with "pg_cron is not available".
- Still open:
  - the TypeScript SDK running on a PGlite adapter (*unknown*, not run);
  - access from several processes (PGlite runs inside one process; *not tested*);
  - throughput at scale (*unknown*). Status: **closed-by-design** for one process; the rest is **unresolved-owner** under X-4.

**Judge, B-2: REL-1 = 2 (fence unfixed), O5 lifted without the path fix, no coverage record.**
- The fence: §2.2.
- Identity: B-2 uses the same split as B-1. The step and spawn key is *input*-derived: sha256 + probe + tool version. The Evidence ID stays the *output* identity, minted by rea's fixed O5, and the ledger links the two. This matches X-1 and W-S2-2; A-rea owns the final rule.
- Coverage: B-2 adopts the strix coverage record per step (donors.md 18), as B-1 does. Status: **closed-by-design**, with identity depending on A-rea.

## 2. Gaps I own

### 2.1 X-4: the storage split

| Option | What it means | Evidence | Matrix cost |
|---|---|---|---|
| **A. One SQL schema, two hosts:** PGlite embedded, Postgres shared | The same `absurd.sql`, plus the fence and the topics, runs in both | The spike: unmodified, 39 ms load, persistence works [seen]. PGlite is Apache-2.0 per npm metadata, 25.4 MB unpacked for 0.5.8 [seen] | One implementation. Two hosts in CI, both running absurd's existing pytest suite (`absurd:tests/`, 20 files) |
| B. Port absurd to SQLite | Rewrite about 39 functions in TS over SQLite. `BEGIN IMMEDIATE` replaces SKIP LOCKED | SQLite can hold several local processes on one file [inferred]. pi-durable shows the tables are feasible (pi-durable.md organ 2) | Two implementations of the semantics. The skeptic's doubled matrix, in full |
| C. Keep both engines and add an adapter | pi-durable on SQLite locally, absurd shared | pi-durable.md §5.3: a Postgres Storage still needs one owner per Session | Two models and two failure semantics |

**Recommendation: option A.** The lease, events and fence are written once and tested on both hosts. pi-durable's agent organs (intent before effect, inbox, transcript) are rebuilt as a layer on that schema, which is the cost the B-2 card already concedes.

**What is lost.**
- Several local processes on one store. PGlite is in-process; option B's SQLite would allow this.
- pi-durable's Cloudflare Durable Object backend.
- pg_cron. Retention runs on the host's timer instead.

**Residual risk.**
- PGlite is at version 0.x.
- WASM performance and memory under thousands of checkpoints is *unknown*.
- Moving a store from embedded to shared (a dump from PGlite into Postgres) is *untested*.
- On PG18 the built-in `uuidv7()` ignores `absurd.fake_now`. In the spike, a task id embedded `2026-10-25T12:00Z` while `fake_now` was set to `2026-01-01` (`spike2.mjs`). Partition ranges keyed by id therefore follow real time while the fake clock does not. Tests with a fake clock on partitioned queues must take this into account [seen; consequence inferred].

**How to test.** Run absurd's pytest suite and pi-durable's storage-conformance cases, extended with kill-at-step-k and expired-lease cases, against PGlite and Postgres 14 and 18 in CI. Add a migrate-embedded-to-shared test.

Status: **unresolved-owner**. The owner chooses between A and "single-process only". I recommend A.

### 2.2 The lease fence

**Rule.** A write by run *R* is accepted only if, while *R*'s row is locked `FOR UPDATE` in the same transaction:
- `R.state = 'running'`, and
- `R.claim_expires_at IS NOT NULL`, and
- `R.claim_expires_at > absurd.current_time()`.

The writes covered are: `set_task_checkpoint_state`, `extend_claim`, `complete_run`, `schedule_run`, `await_event`, and the new ledger append.

On failure the order is:
- `AB001` if cancelled;
- `AB002` if failed;
- new `AB004 lease expired`. The SDKs map it to a silent stop, as they already do for `AB002` (`absurd:sdks/typescript/src/index.ts:1392-1404`).

**Two further rules.**
- `fail_run` stays callable after expiry, because it ends the run either way.
- `claim_task` rejects `claim_timeout <= 0` with new `AB005`. Today a timeout of zero or less disables recovery entirely (`absurd:sql/absurd.sql:946-948, 993-995`).

Taking the row lock matters. Today the checkpoint write reads the run without a lock (`absurd:sql/absurd.sql:1492-1500`). With the lock, a racing sweep and a write are serialised, so exactly one of them wins.

**Evidence.** Unmodified absurd accepted an expired, unswept `extend_claim` (the expiry moved to `00:01:30`) and an expired `complete_run` ("accepted") (`spike2.mjs`). With the prototype fence, about 20 lines of `assert_lease` injected into the five writers (`fence.mjs`):
- a lease of 0 gave `AB005`;
- a write inside the lease was accepted;
- an expired-but-unswept extend, checkpoint, complete or await gave `AB004`;
- the reclaim then produced attempt 2, which saw only checkpoints committed while the lease held, and the new holder's `complete_run` was accepted.

**Residual risk.**
- The fence stops *recording*, not *execution*. A stale step body may still be running and causing external effects, so effects still need keys derived from inputs (absurd.md §3).
- One extra row lock per checkpoint: the cost is *unmeasured*.

**How to test.** Port the `fence.mjs` cases into `tests/`. Add a two-connection race on real Postgres (sweep against checkpoint, 1,000 iterations) and assert exactly one outcome per pair.

### 2.3 B-2 event semantics

**Design.** Event names never repeat, and waits use topics. `publish(queue, topic, dedupe_key, payload)` works as follows:
- It increments a per-topic high-water mark.
- It records `dedupe_key`, so a redelivered webhook does not create a second occurrence.
- It calls the existing `emit_event` with the name `topic#seq`.

Each task stores a cursor in a checkpoint and awaits `topic#(cursor+1)`. If the task falls behind, its next wait resolves immediately, and a policy chooses between processing in order and skipping to the latest.

**Retention.** Cleanup must keep topic events whose sequence is above the lowest cursor of any live task. `topic_gap(topic, seq)` reports a deleted occurrence as a gap error instead of an endless wait, which is the "absence is not a negative" rule.

**Evidence** (`events.mjs`): publishing `1.1` twice returned sequence 1 both times; a wait on `#2` suspended; publishing `1.2` returned 2; after deleting `#1`, `topic_gap(…,1)` returned `true`. Waking a suspended waiter is absurd's existing emit path, exercised in `spike.mjs`.

**Residual risk.**
- The high-water mark row is a hot spot for each topic.
- The sentinel rows (`emitted_at = 'epoch'`, `absurd:sql/absurd.sql:1763-1764`) are deleted by any cleanup run. This is harmless only because `emit_event` wakes waiters through `w_` [inferred].

**How to test.**
- Property test: N publishes with random redeliveries against M waiters with random cursors, asserting that each waiter sees each sequence at most once, or gets a gap error.
- Add a test where a TTL cleanup runs while a wait is pending.

### 2.4 PRV-4 and EVO-4: the product's own CRA position and support period

Everything below is inferred, and is not legal advice.

**CRA role.** If a company makes the merged product available commercially, it is likely a *manufacturer* of a product with digital elements. If a non-profit stewards it, the lighter *open-source steward* regime may apply.

**What a declaration credible in 2030 needs:**
1. **A private reporting channel and published advisories.** SECURITY.md with GitHub private reporting, a response target (for example 5 working days to triage), and published advisories. Absurd shipped an injection fix without an advisory (`absurd:CHANGELOG.md:63`).
2. **Reporting duty.** A process for reporting actively exploited vulnerabilities, as CRA reporting requires from 11 Sep 2026 (framing §4).
3. **SBOMs and attested builds.** A machine-readable SBOM per release (CycloneDX or SPDX), covering vendored parent code from rea, absurd and pi, plus SLSA provenance and checksums for every asset. Absurd ships neither (`absurd:.github/workflows/build.yml:181-187`).
4. **A declared support period** per major version, in a machine-readable file (for example `support.json` with an end date) and in the docs. The CRA's default expectation is at least five years unless expected use is shorter. A pre-1.0 product that declares "no support" can still say so honestly, but it cannot then sell CRA evidence to its users.
5. **VEX statements** for vulnerabilities inherited from the parents.

**Evidence.**
- The parents give little to build on: absurd SEC-1 = 0 and PRV-4 = 0 (absurd review).
- They also churn fast. rea had 38 releases in three months (rea.md §4), and pi-durable says its API "changes without notice" (`pi:packages/durable/README.md:3`).

**Residual risk.** A five-year period means vendoring pinned parent code and backporting fixes to it. That is a standing staff cost for the owner.

**How to test.** An OpenSSF Scorecard gate; `gh attestation verify` on every asset; and a yearly drill: inject a fake report, then advisory, patch and VEX within the stated targets.

Status: **unresolved-owner** for the role and the period length; **closed-by-design** for the mechanics.

## 3. The forced merges

1. **R-1 + D-1 + L-1 → durable case file: accept, amended.**
   - Its store should be X-4 option A: the absurd schema on embedded PGlite, with the fence on even locally, because it costs little. This replaces D-1's SQLite lease row unless the owner needs several local processes, which only option B gives.
   - Step keys come from inputs; Evidence IDs come from outputs and are linked to them (§1).
2. **R-2 + L-2 + B-1 → CI sweep and delta gate: accept, amended.**
   - B-1's shared ledger is the back end *only* if the owner answers yes to several workers.
   - Otherwise each runner uses its own embedded store and the bundles are merged afterwards (S-1 tier 3). The cross-fleet SQL query is then the union of the bundles, which remains possible because both modes use one schema.
   - D-2's receipts fold in as the effect layer.
3. **B-2 as an option of the case file: accept.** It has the same schema, so it is a deployment mode (a shared host, topics, handover), not a separate product. It is gated by evidence of handovers (W-B2-2).
4. **S-2 mandatory: accept.** Both candidates use one claim format with W-S2-2's separate observation and claim IDs. B-1's input-derived step key is a third, internal ID and is never shown as a claim.

**Disagreement kept.** I would not make PGlite the local default before the TS SDK and a kill test have run on it. Until then the case file states "embedded mode: SQL proven, SDK unproven".
