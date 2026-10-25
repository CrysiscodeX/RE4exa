# Gap register

This register lists every weak spot raised in the debate and where it stands after round 2b. Where the skeptic's verdict ([round-2-skeptic.md](04-debate/round-2-skeptic.md)) is stricter than the advocate's claim, the skeptic's verdict is used. The register then names which candidates in [05-candidates/](05-candidates/) inherit each gap.

**Statuses**

| Status | Meaning |
|---|---|
| **closed** | The skeptic accepted it and no test is outstanding |
| **test-gated** | Closed only once the named test passes |
| **paper** | A design exists, but it rests on code nobody has built or run |
| **scope-cut** | Taken out of scope, and the cut is stated |
| **owner** | Waits on a decision listed in the [options brief](06-options.md) |
| **open** | No resolution yet |

**Severity** is critical, high, medium or low.

## Cross-card and systemic gaps

| ID | Weak spot | Sev. | Resolution proposed (by) | Status | Test that closes it |
|---|---|---|---|---|---|
| X-1 | Evidence identity comes from the output, so it cannot be a step key, a review key across versions, or the same on every host (`rea:src/domain/evidence.ts:251-278`) | critical | Three keys (A-rea): **ProbeKey** from inputs, computed before the probe runs; **ObservationId**, today's hash with nested records reduced to their IDs; **FindingKey**, stable across versions | paper | The same bytes at two paths and on two hosts give equal keys; changing any parameter changes the key; ≥95% of FindingKeys survive a version change with no collisions |
| X-2 = AGT-1 | No enforced boundary for untrusted content, and no injection evaluation | critical | A `Tainted` type at the one point where commands run; a fresh random tag around tainted text; once a session is tainted, every effect needs approval; the client gets no shell; a 24+ fixture tripwire set (A-leanrea) | test-gated | Policy unit tests block 100%; 0 tripwire hits in ≥120 agent runs, **including a second MCP server in the same session** |
| X-3 | Model access conflicts with the runtime: pi-durable needs pi-ai `Models`, but subscription use means the official client runs the loop | high | **Mode A:** the official client is the host and the product is an MCP server. **Mode B:** API keys with a guard against `sk-ant-oat` and `ANTHROPIC_OAUTH_TOKEN` (A-durable) | paper (mechanism), owner (terms) | Mode A spike: kill the server mid-call and check it settles. Mode B: only allowed key types are accepted, and a network capture shows no `claude-cli` user agent |
| X-4 | Storage split: SQLite has one owner, Postgres breaks local-first, both together doubles the test matrix | high | One schema on PGlite and Postgres (A-absurd); own SQLite (A-rea, A-leanrea); the pi-durable kernel (A-durable) | owner | Migrate embedded to shared; CI matrix on PGlite, PG14 and PG18 |
| X-5 | rea cannot be imported as a library | high | Rewrite from the S-2 spec, starting from the vendored 17-file core; golden vectors produced by rea (A-rea) | test-gated | CI checks byte-identical IDs against a pinned rea |
| X-6 | Coverage overclaims: "complete" only means "not truncated" (`javascriptApplicationEvidenceSchemas.ts:197-203`) | high | A census of loading forms with a catch-all for sites no form claims; "complete" only when nothing is unresolved; until the census exists, read rea's `complete` as `partial` (A-rea) | test-gated (needs upstream change or a fork) | Resolver ablation never gives `complete`; a mutation corpus |
| X-7 | Replay safety and approvals rest on effects the tools declare about themselves | medium | An enforced execution profile (A-durable) | test-gated (Linux only) | Adversarial "read-only" tools fail under inspection; non-Linux runs are labelled unenforced |
| X-8 | Platform reach; desktop users are absent | medium | `reach.json` generated from per-row fixtures; Linux container as the default lane; macOS optional; native Windows declared not covered (A-leanrea) | closed (reach), owner (Windows) | Every cell marked covered passes its fixture in CI |
| X-9 / N-9 | Bytes and cost per answer are not measured, and the proposed decision rule passes by construction | high | 60 paired cells (12 tasks × 5 reps) with a task-level bootstrap (A-leanrea). The skeptic's replacement rule: **correct-and-verified claims per dollar must beat Tier 0**, checked against oracles, with a resume task where Tier 0 may keep notes | open (rule replaced, not run) | Run the protocol |
| X-10 | Spend is re-sent after a crash, with no budget | medium | Budgets per run and per step; a `request_resent` record; dedupe of model requests is conceded impossible (A-durable) | test-gated | Kill during streaming gives exactly one `request_resent`; going over budget gives a typed stop |
| SEC-1 | No threat model | high | Assets, actors, 7 trust boundaries, 10 threats (A-leanrea) | test-gated | Add the host client and other MCP servers in the session as trust boundaries; name a SECURITY.md owner; run a report drill |
| SEC-6 | Secrets found in targets are stored unredacted | high | Redact at the source before anything is committed; keep a fingerprint, not the value; export through `VACUUM INTO` (A-durable) | paper | A seeded-secret corpus gives 0 hits across the DB, the WAL, the export and the provider request |
| EPI-2 | Calibration of observed, derived and inferred | high | Precision per producer and class with Wilson intervals; INSUFFICIENT below n=30; demotion in the style of laya (A-rea) | test-gated | A deliberately wrong producer is demoted within one run; labels come from someone other than the producer's author. About 3,000 labelled claims are needed (estimate) |
| PRV-4 / EVO-4 | No CRA position or support period of its own | medium | SECURITY.md, advisories, SBOM and provenance per release, a machine-readable support period, VEX (A-absurd; legal points are inferred) | owner | The owner states the role and the period, with a staff-cost estimate |
| N-1 | **An embedded PGlite store opened by two processes silently loses committed rows.** Committed rows were lost in 5 of 8 runs across the skeptic's and the moderator's tests; see [spike](04-debate/spikes/pglite/README.md) | critical | An exclusive OS lock taken at open; a second opener is refused | open | The two-process test is refused, not lost |
| N-2 | The identity scheme and S-2 grow field by field | high | S-2 v1 is capped at the record plus two IDs; everything else becomes a versioned extension (skeptic) | open | The spec review keeps to the cap |
| N-3 | Taint is enforced at one point only: other MCP servers and the client's own tools bypass it, and approval fatigue sets in | high | Product mode refuses to run next to other MCP servers, or says so; measure the approval rate | open | The X-2 test with a second server; approval rate per session |
| N-4 | With the official client as host, the turn loop is not durable | high | Claim durability for the tool side only; test resume per client | scope-cut (claim narrowed) | Resume after a client crash, for each supported client |
| N-5 | One candidate has three kernels on paper | high | Each candidate names exactly one store (moderator rule for layer 5) | closed in layer 5 | — |
| N-6 | The fence, sequenced topics, roles and AB004/AB005 fork the 3,158-line `absurd.sql`, whose migrations are not transactional | medium | Send the changes upstream, or budget for owning the fork | owner | — |
| N-7 | "One schema" runs two code paths (PG18 `uuidv7()` ignores the fake clock) | medium | CI on PGlite, PG14 and PG18 | open | That matrix |
| N-8 | Enforcement exists only on Linux; the macOS desktop is unenforced | medium | A macOS VM lane, or a stated scope cut | owner | — |
| N-10 | Updating the redaction detector changes ObservationIds | medium | Include the detector version in the profile digest and the ProbeKey | paper | Change the detector version and check the keys |
| N-11 | The Mode B guard copies pi-ai's substring check | low-medium | Accept only listed key types (an allowlist); pin pi-ai | paper | As in X-3 |
| N-12 | No one owns the null arm (S-1 tier 2) that every comparison uses | medium | Assign it and build it before any layer-5 numbers are claimed (est. 350–600 lines) | open | Tier 2 exists and passes its own kill test |
| G-pi-ai | pi-ai's Claude subscription login presents as Claude Code | high (guardrail) | **leave**; use Mode A delegation only | closed (excluded) | — |
| G-terms | Whether provider terms let a third party drive the official CLI or SDK on a subscription, interactively, in CI or unattended | high | — | owner | — |

## Per-card weak spots (summary)

The details are in round 1 and round 2b. The status is the skeptic's round-2b verdict.

| Card → family | Weak spots and status |
|---|---|
| R-1 → case file | W-R1-1 replay key: test-gated (X-1). W-R1-2 faithful recording, where only the runner writes `observed`: test-gated. W-R1-3 thin margin over S-1: closed by test gate, needs N-12 |
| D-1 → case file | W-D1-1 model access: paper (Mode A spike). W-D1-2 atomic commit, Evidence first with a pointer in the result: test-gated (crash at 3 points). W-D1-3 handover between machines: closed |
| L-1 → case file (policy) | W-L1-1 the gate authorises itself: **rejected, paper** (the agent still supplies `items[]`). W-L1-2 overhead: paper (X-9). W-L1-3 single writer: scope-cut |
| R-2 → CI gate | W-R2-1 finding identity across versions: **paper** (no normalisers yet). W-R2-2 false "no change": test-gated (X-6). W-R2-3 cost per pair: test-gated (≤60 s on ≥50 pairs) |
| L-2 → CI gate | W-L2-1 inventories are not answers: scope-cut (pre-filter only). W-L2-2 macOS probes on Linux: closed (declared partial). W-L2-3 untrusted parsers at scale: test-gated (fuzzing, images pinned by digest) |
| B-1 → CI gate (multi-worker) | W-B1-1 Postgres dependency: owner, test-gated (N-1). W-B1-2 role model: paper. W-B1-3 lease fence: test-gated (race on two connections, 1,000 iterations) |
| D-2 → effects layer | W-D2-1 client built-ins bypass the gateway: test-gated (a canary for each client). W-D2-2 at-most-once: closed, claim narrowed. W-D2-3 not analysis: scope-cut |
| B-2 → option | W-B2-1 event misfire: test-gated (property test). W-B2-2 unproven need: scope-cut. W-B2-3 embedded mode: test-gated, plus N-1 |
| S-1 (null) | W-S1-1..4 (state lost on resume, prose-only routing in tier 1, no subscriptions in tier 2, no query across the fleet): open, with N-12 |
| S-2 (spec) | Becomes a mandatory layer. W-S2-2 identity: paper. W-S2-3 adoption: test-gated (golden vectors). W-S2-4 laundering inference into evidence: closed |

## Count after round 2b

These figures cover the 27 cross-card rows above. Each row is counted under its main status. Secondary statuses (X-3 terms: owner; X-8 Windows: owner) are not counted.

| Status | Rows |
|---|---|
| open | 6: X-9, N-1, N-2, N-3, N-7, N-12 |
| paper | 5: X-1, X-3, SEC-6, N-10, N-11 |
| test-gated | 7: X-2, X-5, X-6, X-7, X-10, SEC-1, EPI-2 |
| owner | 5: X-4, PRV-4/EVO-4, N-6, N-8, G-terms |
| scope-cut | 1: N-4 |
| closed | 3: X-8 (reach), N-5, G-pi-ai |

Critical items not yet closed: **X-1** (paper), **X-2** (test-gated) and **N-1** (open). Every candidate in layer 5 has to state how it handles these three.
