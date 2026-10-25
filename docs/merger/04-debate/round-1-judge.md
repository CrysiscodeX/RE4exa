# 04 Debate, round 1: the Judge's provisional RQS-2030 levels

**Role:** Judge. **Inputs:** [charter](../00-charter.md), [framing](../02-framing.md) (§4 forces, §6 measures), [journal](../journal.md) J-01 to J-03, [03-ideas.md](../03-ideas.md) and the five card files, [01-anatomy/](../01-anatomy/) (skimmed), `standard/RQS-2030.md` v1.1.0, and the parent reviews `research/rqs-review/reports/{rea,leanrea,pi-durable,absurd}.md`.

No excluded path was read. Nothing in the cards is built, so no level here is observed, except S-1 cells that reuse a parent unchanged.

## 1. Method

**Profile per card.** RQS judges a product by what it is for (§2, "profile"). I give one profile per card.

| Card | Profile | Why this profile and not the nearest alternative |
|---|---|---|
| R-1 | agent-tool | An MCP/CLI record store that agents call. It calls no model itself ("Identity: none stored"), so it is not agent-harness |
| R-2 | security-tool | A defensive scanner that gates CI on capability diffs, with the model optional. Its main caller is a CI job, not an agent |
| L-1 | agent-tool | Four MCP tools plus a rendered skill. The rules are enforced by the runner, so the product is not a skill-pack |
| L-2 | security-tool | An unattended, sandboxed sweep of untrusted artifacts in CI |
| D-1 | agent-harness | A pi-durable session that holds the model client (ACP or official SDK) and runs the turn loop |
| D-2 | agent-harness | It carries out effects for agents on the person's systems (tracker posts). The workflow-engine profile weights AGT at 0.5 and would hide the card's own claim |
| B-1 | workflow-engine | Its offer is a substrate others build on: a SQL function API and enqueue inside the caller's transaction. security-tool also fits its users; §4 notes where that changes the verdict |
| B-2 | agent-harness | It owns the agent transcript, the inbox, and handover between agents and people |
| S-1 | agent-harness (Tier 2) | Tier 2 is the tier that claims durability, and it runs pi-durable with pi-ai keys. Tier 1 alone would be skill-pack plus agent-tool |
| S-2 | agent-tool | A spec, a reference library and a verify CLI. Its claim sits in EPI and INT, which this profile weights 3 and 3 |

**Flags (§5).** All ten cards: `parses_untrusted`, `executes_code` and `distributed` (each card implies shipping). `uses_llm` for every card except S-2, which has no agent surface, so S-2's AGT rows are NA.

**Criteria scored.**
1. **All 10 RQS core criteria.** Core is global in RQS, not set per profile: PUR-2, COR-1, REL-1, PERF-2, SEC-1, AGT-1, AGT-4, INT-1, EPI-1, PRV-3.
2. **Horizon criteria whose level-5 anchor is a framing §4 force:** agents as the main callers (INT-3, INT-5, AGT-2); proof of how a result was reached (COR-5, EPI-3, EPI-4); identity across providers, and spend (SEC-6, AGT-6); software in many untrusted forms (SEC-8).
3. **One profile extra per card,** where the profile weights that dimension highly and the card makes a claim there: EPI-2 (agent-tool), COR-2 and EVO-3 (security-tool), AGT-3 (agent-harness), OPS-3 (workflow-engine), INT-7 (S-2).
4. **Stated once here and not repeated in the tables:** PRV-4 and EVO-4 are **U for all ten cards**. Six cards (R-1, R-2, L-2, D-2, B-1, S-2) cite the CRA as a reason users will want the product. None states the product's own CRA position or its support period.

**Rules for scoring a concept on paper.**
1. **Every level is design-intent.** In RQS terms its confidence is `inferred` (weight 0.6). The exception is S-1 cells that reuse a parent unchanged: they carry the parent review's level and are marked *obs*.
2. **Levels are capped at 0–3.** Level 4 means "enforced by automation" and level 5 "horizon anchor met"; a card can show neither. Where a card names the mechanism of the level-5 anchor, I write **3h**. 3h is not 5: it says only that the design points at the horizon. For REL-1, 3h needs all four parts of the anchor: a lease, idempotency keys, a crash-loop guard and a named fault-injection test.
3. **A card gets only the level its own mechanism supports.** A defect named in layer 1 that the card does not fix is carried into the card. Examples: rea's child Evidence IDs that change with the path (rea.md O5, measured), and absurd's expired-but-unswept leases that still accept writes (absurd.md O3).
4. **A card that is silent gets U.** U is never a pass.
5. **"Weakest parent"** is the lowest review level among the parents whose organs the card uses for that criterion (NA is ignored). **"Lifts?"** asks whether the design removes the cause of that low level.
6. **Consequence: no grade is possible.** Each card has known levels on about 20 of roughly 55 applicable criteria, so evidence coverage is below 60% for every card. Under RQS §9 any grade would be provisional and capped at C. No card can show framing §6's "B or better" at this stage, so I compute no QI.

In the tables, `*` marks a core criterion. "process" stands for PUR-2\*·COR-1\*·SEC-1\*·AGT-4\*·INT-1\*·PRV-3\*.

## 2. Cards

### R-1 Case file (agent-tool)

| Criterion | Level | Weakest parent | Lifts? | Reason |
|---|---|---|---|---|
| REL-1\* | 3 | 2 (rea, leanrea) | yes | Intent and replay from pi-durable organ 6, with the Evidence ID as step key; kill test named. Not 3h: there is no lease in embedded mode, yet "resumable by anyone" invites two owners (pi-durable.md §3.3). The card adds only a UNIQUE on submissions |
| EPI-1\* · COR-5 | 3 · 3h | 2 · 2 (leanrea) | yes | Raw CLI output is stored as `observed` Evidence with digests; nested-path fix named; the kill test fails if "any Evidence ID" changes. EPI-1 is not 3h: nothing is signed |
| INT-5 | 3h | 3 (leanrea) | yes | A replayed probe that yields the same ID is a no-op by construction. This holds only after the path fix |
| EPI-3 · EPI-4 | 3h · 3h | 2 · 2 (absurd, leanrea) | yes | strix coverage plus "loading forms checked" answers the `import.meta` overclaim (rea.md O11). Unknowns become scheduled work |
| PERF-2\* · INT-3 | 3h · 3 | 1 · 1 (rea) | yes, unmeasured | About 8 tools, a catalog budget of ≤15 KB "to measure", and content-addressed handles instead of 85 KB results. Each `record` call adds a turn |
| AGT-1\* · AGT-2 | 2 · 2 | 1 · 2 (leanrea, pi) | partly · no | rea's O3 marker is lifted, but channels are not separated and nothing is tested. The `mutatesSession` defect is not split (rea.md O3), so the hints stay inaccurate |
| SEC-8 | 2 | 1 (leanrea) | partly | rea's readers serve the heavy rung, but the router runs `file` and `unzip -l` on the host with no sandbox and no limits named |
| AGT-6 · SEC-6 | U · 2 | 2 · 2 | — · no | No budget is stated. No model credential is stored, but the exported case file carries target strings with no redaction rule |
| process | 2·U·U·2·2·3 | 1·1·0·1·2·2 | — | Falsifiers with thresholds (kill test, paired benchmark at ≤1.5× tokens, a 20% uncited-claims audit) are plans, not harnesses. Interfaces are named but not versioned. PRV-3 rests on the charter's licence rule |
| EPI-2 | 2 | 3 (rea, leanrea) | lowers | Card weak spot 2: agents may record `inferred` as `observed`, and the classes are uncalibrated |

**Red-line risk.** **RL-5:** a case file that "looks rigorous and is not", because recording is not enforced. **RL-2:** the case file is attached to tickets with target-derived secrets inside. **RL-4, low:** router rows adapted from leanrea's unquoted snippets (leanrea.md L5, L6) must become argv calls.

### R-2 Release delta gate (security-tool)

| Criterion | Level | Weakest parent | Lifts? | Reason |
|---|---|---|---|---|
| REL-1\* | 3 | 2 (rea) | yes | absurd claim and lease with the J-02 fixes, plus retries and Orca's liveness rule ("lost contact is unverifiable"). No crash-loop guard and no kill test, so not 3h |
| EPI-1\* · COR-5 | 3 · 2 | 2 · 3 (absurd) | yes · no | Evidence for every diff line; in-toto is "to decide". The card requires identical IDs on two runs but lifts O5 without the path fix. CI runners extract to different paths, so the composite IDs will differ (rea.md O5, measured) |
| INT-5 | 2 | 4 (rea, absurd) | lowers | "Findings keyed by Evidence ID across versions" cannot work: the ID hashes `subject.sha256`, which changes with every version (rea.md O5). It needs a finding key without the subject digest, and none is designed [inferred] |
| EPI-3 · EPI-4 | 3h · 3h | 2 · 3 (absurd) | yes | The report never says "clean"; unknowns block or warn by policy; coverage must name the loading forms checked (card weak spot 1) |
| PERF-2\* · INT-3 | 3 · 3 | 1 · 1 (rea) | yes | No model in the gate: one CLI, a JSON report and read-only `case.*` tools. Report size is not stated |
| AGT-1\* · AGT-2 | U · 3h | 2 · 2 (rea) | — · yes | Silent on injection for the reviewing agent, although reports carry target literals (hosts, channel names). A policy file plus "`executesForeignCode` forbidden in the gate" is machine-checkable policy |
| SEC-8 | 2 | 2 (absurd) | no | Untrusted tarballs are parsed statically on CI runners. Isolation (donor 21) covers only the optional runtime lane, and the new tar/gzip reader has no limits stated |
| AGT-6 · SEC-6 | 3 · 2 | 2 · 2 | yes · no | The model is optional, so token spend is bounded by construction, and process-host gives timeouts. Delegated summaries store no credential, but reports are not redacted |
| process | 2·U·U·U·2·3 | 1·3·0·2·3·2 | — | The best falsification plan of the ten: recall ≥90% on 50+ historical updates, ≤1 false "changed" per 10, determinism, ≤60 s per pair. It is still a plan. AGT-4 is U because the summaries are not evaluated |
| COR-2 · EVO-3 | 2 · 2 | 2 · 1 (absurd) | = · partly | The historical replay corpus would be an independent oracle. The card concedes native-heavy updates get "unknown", so in practice this is a JS/Electron product, and tar/gzip support is still to be added |

**Red-line risk.** **RL-5, the highest of the ten:** a gate that passes on a false "no change" while coverage says "complete" repeats a measured rea defect (rea.md O11). **RL-4:** a new tar reader on untrusted input invites path traversal (a SEC-7 pattern class) unless extraction is confined.

### L-1 Triage ladder (agent-tool)

| Criterion | Level | Weakest parent | Lifts? | Reason |
|---|---|---|---|---|
| REL-1\* | 3 | 2 (rea, leanrea) | yes | Every probe is a pi-durable tool task, replayed only if `safe`, with restart settlement (donor 26). Single writer only; the card admits the seams are not ready (weak spot 3) |
| EPI-1\* · COR-5 | 3 · 3 | 2 · 2 (leanrea) | yes | Every probe records its command, tool version, input sha256, authority and confidence. The path fix is named as a design change |
| INT-5 | 3 | 3 (leanrea) | = | Resume replays stored probes, not the work. IDs are content-based after the fix; the card claims nothing beyond that |
| EPI-3 · EPI-4 | 3 · 2 | 3 · 2 (leanrea) | = · = | An unknown is opened for every unanswered item, but there is no coverage record for the whole run (strix row 18 is not used). The card concedes "complete" is hard to state |
| PERF-2\* · INT-3 | 3h · 3 | 1 · 1 (rea) | yes | 4 tools and a catalog target below 10 KB. Heavy results are fetched only for a named unknown, and oversized results are refused early with a continuation (rea O4). Risk: 6 calls where leanrea needed 4 (weak spot 1) |
| AGT-1\* · AGT-2 | 2 · 3h | 1 · 2 (leanrea, pi) | yes | The untrusted envelope (donor 14) and the traps go into tool text, but no injection test. Every router row has an effect class, launch and attach need approval, and a climb is keyed to an unknown and a budget |
| SEC-8 | 2 | 1 (leanrea) | partly | process-host gives a timeout, an 8 MiB cap and tree kill, but the parsers still run on the host |
| AGT-6 · SEC-6 | 3h · 2 | 2 · 2 | yes · no | The only card that declares budgets before work, enforces them in the runner and measures cost per rung. Target strings are not redacted |
| process | 2·U·U·2·2·3 | 2·1·0·1·2·2 | — | A 3-arm rerun of leanrea's L10 harness with ≥5 reps, self-tested keys and a 1.2× threshold. A good AGT-4 plan, but not yet an eval in CI |
| EPI-2 | 2 | 3 (rea, leanrea) | lowers | The escalation trigger is a model's judgement. Both over- and under-escalation are named (weak spot 2) |

**Red-line risk.** **RL-4:** the router rows are adapted from leanrea snippets with unquoted `$T`, `$X` and `rm -rf $X` (leanrea.md L5, L6), and the card does not say they become argv calls. **RL-5:** low.

### L-2 Model-free first sweep (security-tool)

| Criterion | Level | Weakest parent | Lifts? | Reason |
|---|---|---|---|---|
| REL-1\* | 3 | 2 (rea, leanrea) | yes | absurd lease with fixes, receipts (donor 4), and kill-at-step-k tests from pi-durable's conformance kits (organ 16). No crash-loop guard, so not 3h |
| EPI-1\* · COR-5 | 3 · 2 | 2 · 2 (leanrea) | yes · no | Tool versions, input digests and the measurement record (donor 24). O5 is lifted without the path fix |
| INT-5 | 2 | 3 (leanrea) | no | Receipts make retries safe, but IDs still change with the path |
| EPI-3 · EPI-4 | 3h · 3h | 2 · 2 | yes | Coverage separates checked, never looked at and could not run. The abstention kernel (donor 22) sends low route confidence to an agent instead of guessing. Reach is declared row by row |
| PERF-2\* · INT-3 | 3 · 3 | 1 · 1 (rea) | yes | The bulk pass spends no model tokens; only the residue reaches an agent, through L-1's surface |
| AGT-1\* · AGT-2 | 2 · 3h | 1 · 2 | yes | The agent sees only flagged items, through L-1's enveloped surface. Launch and attach rows are disabled when unattended, and rows are versioned data with effect classes |
| SEC-8 | 3h | 1 (leanrea) | yes | The only card that designs parser safety: a decompression budget (rea O10), and a container with no network, read-only and with no capabilities. A parser escape under fuzzing is named as a kill condition. The isolation donor is pattern only (no licence file) |
| AGT-6 · SEC-6 | 2 · 2 | 2 · 2 | = | No token budget for the residue agent. The "team's API key" lives in CI with no secret-handling design (SecretRef is not used) |
| process | 2·3·U·U·2·3 | 1·1·0·1·2·2 | — | The corpus test against an SBOM-scanner baseline is the only falsifier that names a competitor. Per-row fixture tests and a catalog-size gate in CI make COR-1 3 by design |
| EVO-3 | 2 | 1 (leanrea, absurd) | partly | The commands must be rewritten from macOS-only one-liners, and Linux and Windows rows do not exist yet |

**Red-line risk.** **RL-4:** path traversal on extraction. Contained by the container design, but present. **RL-1:** stays contained only while donor 21 remains pattern only. **RL-2:** a model key held in CI.

### D-1 Investigation Log (agent-harness)

| Criterion | Level | Weakest parent | Lifts? | Reason |
|---|---|---|---|---|
| REL-1\* | 3h | 2 (rea, leanrea) | yes | Evidence and the tool result share one atomic commit. The card adds a lease row, a UNIQUE requestId and ID minting inside the transaction, which closes all three holes in pi-durable.md §3.3. Parking, and a kill test over 50 runs. Open: a crash during the generation `request` re-sends the model call (pi-durable.md §3.1), and the card does not address it |
| EPI-1\* · COR-5 | 3 · 3 | 2 · 2 (leanrea) | yes | The path fix is named. The code-mode journal reattaches nested calls, so a replayed script yields the same IDs |
| INT-5 | 3h | 3 (leanrea) | yes | Content-based IDs, a UNIQUE requestId, keyed nested calls, and ID minting inside the transaction |
| EPI-3 · EPI-4 | 3 · 3h | 3 · 2 (leanrea) | yes | Coverage and residual unknowns become durable documents that outlive compaction |
| PERF-2\* · INT-3 | 3h · 3 | 1 · 1 (rea) | yes | A 5-tool MCP surface, escalation only after the router, and content-addressed handles (donor 16) |
| AGT-1\* · AGT-2 | 2 · 2 | 1 · 2 (pi, leanrea) | partly · no | Untrusted envelope (donor 14), not tested. Replay safety is derived from rea's effects, but `mutatesSession` marks almost every rea tool as mutating (readOnly 5/208, rea.md O3). So "read-only steps rerun" rarely applies until that is split. Weak spot 2 adds under-declaration |
| SEC-8 | 2 | 1 (leanrea) | partly | process-host replaces pi's bash defaults; no sandbox |
| AGT-6 · SEC-6 | U · 2 | 2 · 2 | no | pi-durable has no per-run budget (pi-durable.md §4), and the card adds none. Sign-in is delegated, but the portable `.sqlite` file carries target strings and the transcript to other machines |
| process | 2·U·U·U·2·3 | 2·1·0·1·2·2 | — | A kill test, a comparison with reviewers, and a ≤5% commit-overhead threshold. The agent's behaviour is not evaluated |
| AGT-3 | 3 | 2 (all) | yes | The transcript with escalation reasons is a readable action log; approvals are on; the file is an open export of the trail. No rollback, so not 3h |

**Red-line risk.** **RL-2:** the single file moves between people with target-derived content in it. **RL-5:** only if "loses at most the step in flight" is published without the model-request exception.

### D-2 Effect Gateway (agent-harness)

| Criterion | Level | Weakest parent | Lifts? | Reason |
|---|---|---|---|---|
| REL-1\* | 3h | 2 (rea, leanrea) | yes | Intent, receipt and lease form one record keyed by (task, step, call). Writes under an expired lease are refused and a timeout of 0 is forbidden. Parking, and kill and two-owner tests on both backends |
| EPI-1\* · COR-5 | 3 · 2 | 2 · 2 | yes · no | Uses rea's O5 without naming the path fix; receipts are JSON |
| INT-5 | 2 | 3 (leanrea) | partly | Unsafe effects are deduplicated by receipt key, but Evidence IDs still depend on the path |
| EPI-3 · EPI-4 | 3 · 3h | 2 · 2 | yes | A parked artifact is recorded as "unexamined" in coverage, never dropped |
| PERF-2\* · INT-3 | U · 3 | 1 · 1 | — · yes | No statement on context cost; few gateway tools |
| AGT-1\* · AGT-2 | U · 3 | 1 · 2 | — · yes | No injection design (donor 14 is not used). The gateway enforces effect classes, but only on calls routed through it (weak spot 2), so not 3h |
| SEC-8 | 2 | 1 | partly | The isolation layout (donor 21, pattern) is named, but its scope is unclear |
| AGT-6 · SEC-6 | U · 3 | 2 · 2 | — · yes | No budget. SecretRef (donor 12) and one home per account keep fleet keys out of the transcript and the model's context |
| process | 2·3·U·U·2·3 | 1·1·0·1·2·2 | — | A fault-injection run (8 workers, 400 artifacts), an explicit kill condition against the null option, and one conformance suite for both backends |
| AGT-3 | 2 | 2 | = | Receipts and approvals exist, but the official client's own shell and file edits are invisible to the gateway |

**Red-line risk.** **RL-5:** "side effects run at most once" is contradicted by the card's own bypass. Only "at most once for routed calls" is true. **RL-2:** the donor's SecretRef store is plain files with mode 0600 (donors.md row 12).

### B-1 Fleet ledger (workflow-engine)

| Criterion | Level | Weakest parent | Lifts? | Reason |
|---|---|---|---|---|
| REL-1\* | 3h | 2 (rea, leanrea) | yes | Evidence commits in the step's own transaction, fenced by run id once the O3 fix is in. Spawn keys, the parking pattern, and a kill test with two workers and expired leases. Steps stay at-least-once (weak spot 3) |
| EPI-1\* · COR-5 | 3h · 3 | 2 · 2 (absurd, leanrea) | yes | The path fix is named. Results export as an evidence bundle and an attestation predicate |
| INT-5 | 3h | 3 (leanrea) | yes | Spawn key = sha256 + probe + tool version; `evidence.recorded:<ev_id>` events, first write wins |
| EPI-3 · EPI-4 | 3 · 3h | 2 · 2 | yes | One SQL view of findings, open unknowns and formats not covered. Coverage is written per step |
| PERF-2\* · INT-3 | 3 · 3 | 1 · 1 | yes | 6–8 MCP tools returning "bounded JSON", but the bounds are not given. absurdctl's unbounded `dump-task` (absurd review, PERF-2) is not mentioned |
| AGT-1\* · AGT-2 | 2 · 2 | 1 · 2 | partly · no | rea's marker is lifted. The shared store hands untrusted text to many agents with no envelope and no test |
| SEC-8 | 2 | 1 | partly | Orca's process-host wraps every tool and rea runs as a subprocess; no sandbox |
| AGT-6 · SEC-6 | U · 2 | 2 · 2 | no | No budget, and the operator's key handling is not specified |
| process | 2·U·U·U·2·3 | 1·1·0·1·2·2 | — | The kill test against the null option with idempotent keys is the right comparison. SEC-1 matters most here: a shared service built on a parent whose SEC-1 is 0 |
| OPS-3 | 2 | 1 (absurd) | partly | habitat is left out and loopback MCP gets a per-run bearer token (donor 25). But Postgres has no role or grant model (absurd.md O2) |

**Red-line risk.** **RL-2:** one shared ledger of target-derived text that every worker and agent can read. **RL-4:** if absurdctl's unverified remote SQL fetch is kept. The card adapts only the read commands. **RL-5:** if absurd's "exactly-once" wording comes along.

### B-2 Standing investigations (agent-harness)

| Criterion | Level | Weakest parent | Lifts? | Reason |
|---|---|---|---|---|
| REL-1\* | 2 | 2 (rea, leanrea) | no | Lifts O2–O4 for session ownership without the lease fixes. An expired lease that has not been swept still accepts writes (absurd.md O3), so "safe handover with the run id as fence" fails in that window. No kill test |
| EPI-1\* · COR-5 | 3 · 2 | 2 · 2 | yes · no | O5 is lifted without the path fix |
| INT-5 | 2 | 3 | no | requestId gets a UNIQUE constraint, but IDs still depend on the path |
| EPI-3 · EPI-4 | 3 · 2 | 2 · 2 | = | Unknowns wait for events; there is no coverage record |
| PERF-2\* · INT-3 | U · 3 | 1 · 1 | — · yes | Six MCP tools; no statement on cost |
| AGT-1\* · AGT-2 | 2 · U | 1 · 2 | partly · — | The card names the risk (evidence text carries an injection to the next agent) but applies only rea's marker |
| SEC-8 | 2 | 1 | partly | Runs the router and rea's compare; no isolation |
| AGT-6 · SEC-6 | U · 3 | 2 · 2 | — · yes | A handover never moves a credential; one home per person; SecretRef |
| process | 2·U·U·U·2·3 | 1·1·0·1·2·2 | — | The falsifiers test demand (session length, how often handover happens), not the mechanism |
| AGT-3 | 2 | 2 | = | People and agents write into one ledger, but no approval, pause or rollback is described for runs that last weeks unattended |

**Red-line risk.** **RL-2, the highest of the ten:** a long-lived shared store of untrusted text, used by many people, with no roles. **RL-5:** the handover-safety claim conflicts with the lease defect it leaves unfixed.

### S-1 Compose, don't merge (agent-harness, Tier 2)

| Criterion | Level | Weakest parent | Lifts? | Reason |
|---|---|---|---|---|
| REL-1\* | 3 | 2 (rea, leanrea) | yes | pi-durable's intent and replay (*obs* 4) plus a bundle checkpoint after every Evidence call. Weak points: loss of up to one tool call (inferred); rehydration through `open_binary` and import is unverified; Ghidra projects are lost (rea.md O15); export cost grows quadratically. Tier 3 avoids lease overlap with one SQLite file per attempt |
| EPI-1\* · COR-5 | 2 · 2 | 2 · 2 | no | Findings on the rea path are EPI-1 4 *obs*. But the cheap path (Bash plus the skill) records no Evidence, and the skill sends most answers there. Child IDs depend on the path (measured) |
| INT-5 | 2 | 3 | no | The same path defect; pi-durable's dedupe holds for one writer only |
| EPI-3 · EPI-4 | 3 · 2 | 2 · 2 | = | rea's per-result coverage is *obs* 4, but its "complete" overclaim is measured (rea.md O11). There is no coverage for the whole investigation (the card concedes this) |
| PERF-2\* · INT-3 | 2 · 1 | 1 · 1 | partly · no | The compact profile measures 222,396 B. Results are still sent twice, a 3-file app still produces 85 KB, and all 208 tools are exposed |
| AGT-1\* · AGT-2 | 1 · 2 | 1 · 2 | no | pi-durable passes tool output into context unmarked and treats injection as out of scope (AGT-1 1 *obs*). Whether rea's `_meta` marker survives the pi-mcp wrapper is unknown. An approval hook on destructive and open-world hints exists, but the hints are inaccurate (readOnly 5/208) |
| SEC-8 | 2 | 1 | no | Unchanged: rea's readers are 3, leanrea's host-side extractors 1 |
| AGT-6 · SEC-6 | 2 · 2 | 2 · 2 | = | Budgets are prose. Tier 2 takes pi-ai API keys from the environment, and pi's bash tool inherits that environment (pi-durable review, SEC-6). Tier 1 stores no credentials |
| process | 2·*obs* 1–4·1·2·3·2 | 1·1·0·1·2·2 | — | Each tier can be measured against Tier 0 with leanrea's existing harness, but the glue is untested. No kit-level security policy, and two parents have none (SEC-1 0). The pi-durable and absurd tarballs ship without the licence text (PRV-3 2 *obs*) |
| AGT-3 | 2 | 2 | = | A `beforeTool` approval hook and pi's transcript; no stop control or rollback is added |

**Blocking weaknesses** (RQS §9 gate): Tier 2 has AGT ≈ 1.7 and SEC ≈ 1.5, both below 2 in dimensions weighted 3. **Red-line risk.** **RL-2:** keys in the environment can be reached by shell commands the model chooses. **RL-4, inherited:** the agent pastes leanrea's unquoted snippets. **RL-1:** not triggered.

### S-2 Claim format, not runtime (agent-tool)

| Criterion | Level | Weakest parent | Lifts? | Reason |
|---|---|---|---|---|
| REL-1\* | 1 | 2 | lowers | By scope cut. The append-only WAL store keeps records, but no investigation survives a crash (the card concedes this). Framing §4 expects durability for any run longer than a few minutes |
| EPI-1\* · COR-5 | 3 · 3h | 2 · 2 | yes | The spec makes IDs independent of path at every nesting level, with conformance fixtures. The in-toto envelope is only "possibly" |
| INT-5 | 3h | 3 | yes | "Identical IDs for identical observations" is the spec's first fix |
| EPI-3 · EPI-4 | 3h · 3h | 3 · 2 | yes | A required `examined/not_examined` block; coverage names the loading forms; closure states (donor 17) |
| PERF-2\* · INT-3 | U · 3 | 1 · 1 | — · yes | The card is "neutral on agents" and does not address record size |
| AGT-1\* · AGT-2 | NA · NA | — | — | No agent surface (`uses_llm` not set) |
| SEC-8 | 2 | 1 | partly | The verifier parses untrusted bundles with no size limits stated. rea's failure to re-import a large bundle is a known risk (*unconfirmed*) |
| AGT-6 · SEC-6 | NA · 2 | — · 2 | no | No model use. `raw_result` holds target bytes; the spec could define redaction and does not |
| process | 2·3·U·NA·3·3 | 2·1·0·1·2·2 | — | The conformance suite is the product (COR-1 for itself, an oracle for others). A versioned JSON Schema |
| INT-7 | 3h | 3 | yes | A specified, versioned format that third parties can read is exactly the INT-7 horizon anchor |

**Red-line risk.** **RL-5:** if the spec is presented as "verifiable claims". A record proves integrity, not truth (the card's own weak spot). Otherwise the lowest risk of the ten.

## 3. Cross-card comparison

**Why these criteria decide 2030–35.** **REL-1:** framing §4 expects durability, and it is the one join where the combination adds what no single parent has (J-02). **INT-5:** one observation must have one ID on any machine, or caching, dedupe and cross-tool checking fail; the measured path defect breaks this today. **EPI-4:** CRA-style proof needs a declared negative space, and rea's measured overclaim shows how silently it fails. **PERF-2:** agents are the main callers, and leanrea's benchmark is the bar (pre-mortem cause 1). **AGT-1:** durable, approved-once agency turns one injected string into a lasting one (cause 5). **SEC-8:** untrusted formats parsed at fleet scale. **AGT-6:** unattended spend across several provider accounts (cause 10). **Services:** the local-first force.

| Card | REL-1 | INT-5 | EPI-4 | PERF-2 | AGT-1 | SEC-8 | AGT-6 | Services | Beats S-1 on what? |
|---|---|---|---|---|---|---|---|---|---|
| R-1 | 3 | 3h | 3h | 3h | 2 | 2 | U | none (Postgres optional) | Cheap probes become Evidence; path-fixed IDs as step keys; coverage for the whole case; ~8 tools instead of 208 |
| R-2 | 3 | 2 | 3h | 3 | U | 2 | 3 | SQLite or Postgres | A policy gate and a leased fleet queue. Its cross-version identity claim does not hold |
| L-1 | 3 | 3 | 2 | 3h | 2 | 2 | 3h | none | Cheap-first as enforced policy with budgets (in S-1 it is prose) |
| L-2 | 3 | 2 | 3h | 3 | 2 | 3h | 2 | SQLite; Postgres for multi-host | Isolation, coverage declared row by row, and a bulk pass that spends no tokens |
| D-1 | 3h | 3h | 3h | 3h | 2 | 2 | U | none | An atomic Evidence-plus-transcript commit and the two-owner fixes. Removes S-1's one-call loss window and its quadratic export |
| D-2 | 3h | 2 | 3h | U | U | 2 | U | SQLite or Postgres | At-most-once for unsafe effects, routed calls only. Its own null ("absurd + 50 lines") is untested |
| B-1 | 3h | 3h | 3h | 3 | 2 | 2 | U | Postgres (hard) | One ledger across artifacts, queryable in SQL, with transactional enqueue. S-1 Tier 3 has per-attempt files only |
| B-2 | 2 | 2 | 2 | U | 2 | 2 | U | Postgres (PGlite unknown) | Wake-on-event and handover. The need is not evidenced and the fence is not fixed |
| S-1 | 3 | 2 | 2 | 2 | 1 | 2 | 2 | none (T0–2); Postgres (T3) | — (the bar: exists now, ~0.5–1k owned lines) |
| S-2 | 1 | 3h | 3h | U | NA | 2 | NA | none | Portable, path-independent IDs and a coverage block. Loses on durability |

No card reaches 3h on AGT-1, and none goes above 2 on SEC-6 except D-2 and B-2, which reach 3 for model keys only.

## 4. Ranking and systemic gaps

**These are design-intent levels at 0.6 confidence.** "Beats S-1" means "beats it on paper". S-1's *obs* cells are real.

1. **D-1.** The highest levels on the two survival and identity criteria, with every layer-1 defect it touches addressed in the design (the three §3.3 holes, the path fix). No services. It delivers the one capability S-1 concedes it lacks: an atomic commit of Evidence and transcript. *Must fix:* split `mutatesSession`; handle the model request re-sent after a crash; add budgets (AGT-6 is U); add an injection test. *Owner risk:* churn in the pi-durable kernel ("API changes without notice", EVO-1 2).
2. **L-2.** The only card that designs SEC-8, the strongest EPI-3/EPI-4, and model-free bulk work that changes the cost question. *Decided by an unknown:* the share of real questions closed without a model (card weak spot 1). *Must fix:* the path fix (cheap); a budget and secret handling for the residue agent; router rows as argv calls.
3. **R-1.** The same family as D-1: better on coverage (loading forms) and on recording cheap probes, weaker on durability (it promises resume by anyone, with no lease). *Recommendation:* the moderator should treat R-1 and D-1 as one candidate, with R-1's record and coverage on D-1's commit and lease rules. If they merge, the next distinct card on criteria is B-1.
4. **B-1.** Strong REL-1, INT-5 and EPI-4 by design. But a hard Postgres dependency fails local-first, and the shared store sits on a SEC-1 0 parent with no roles. Under the security-tool profile (SEC weight 3) it falls below L-1.
5. **L-1.** The best AGT-6 design and a 3h PERF-2. But EPI-4 is 2 and the ladder may cost turns. It reads as a policy for R-1 or D-1, not as a product.
6. **R-2.** Strong AGT-2, EPI-3/EPI-4 and falsifiers. But its headline identity claim is broken by design, and it carries the worst RL-5 risk.
7. **S-1 (the bar).** It beats every card on owned code and on availability, which RQS does not score as levels. On criteria it has blocking AGT and SEC weaknesses under its own Tier 2 profile. Tier 1 alone stays the only configuration that is clean on accounts by construction.
8. **S-2.** Every card ranked above it depends on what S-2 specifies (path-independent IDs, the coverage block), so it is a necessary component. As a product it is not enough (REL-1 1).
9. **D-2.** At-most-once holds only for routed effects. Four of the decisive criteria are U, and it is not an analysis product.
10. **B-2.** REL-1 is 2 because its fence is unfixed. The need is not evidenced, and it needs the most new code.

**Disagreement recorded, not averaged away.** If the owner answers "yes" to multiple workers (J-02), B-1 rises above R-1, because B-1 is the strongest of the four cards that name fixed leases for several writers (B-1, D-2, R-2, L-2). I keep R-1 third because framing §4 puts local-first ahead of fleet scale.

**Systemic gaps: criteria where all ten cards are weak.**
1. **AGT-1, prompt injection.** No card goes above 2. None proposes an adversarial corpus, or blocking actions caused by target content through policy rather than prompt wording. Durable stores and handover (R-1, D-1, B-1, B-2) make one injected string persistent. Parents: 1–2.
2. **SEC-1, security policy and threat model.** U for the nine new designs and 1 for S-1. Two parents (leanrea, absurd) are at 0. The shared modes (B-1, B-2, D-2) need a threat model most.
3. **EPI-2, calibrated uncertainty.** 2 where scored (R-1, L-1), U elsewhere. No card measures the calibration of `observed/derived/inferred`, of escalation decisions, or of route confidence. L-2's abstention kernel touches routing only. Records look authoritative either way (S-2's weak spot).
4. **SEC-6, target-derived secrets.** Every card persists raw target content (Evidence `raw_result`, transcripts, case files, shared ledgers), and none defines redaction: all sit at 2 or below on this point. Framing §6 counts only the model credentials the product stores.
5. **PRV-4 and EVO-4, the product's own regulatory position.** U for all ten. Six cards sell CRA evidence to their users, yet none states its own CRA role, vulnerability handling or support period. Parents: 0–2.

**Also weak everywhere, but less decisive:** PUR-2 is at most 2 everywhere, because every card offers plans only. EVO-3 is U or ≤2 everywhere, so the gap for Windows and macOS desktop users (J-03 point 4) stands.
