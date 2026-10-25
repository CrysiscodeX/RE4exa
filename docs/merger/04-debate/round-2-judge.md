# 04 Debate, round 2b: the Judge

**Inputs:**
- the four rebuttals [round-2-a-rea](round-2-a-rea.md), [round-2-a-leanrea](round-2-a-leanrea.md), [round-2-a-durable](round-2-a-durable.md) and [round-2-a-absurd](round-2-a-absurd.md);
- the [PGlite spike](spikes/pglite/README.md), which the moderator re-ran;
- journal J-04, [round-1-skeptic](round-1-skeptic.md) and my [round-1](round-1-judge.md).

The skeptic's round 2 was not available when I wrote this.

**Same method as round 1:**
- Levels are design-intent, capped at 3; **3h** means the card names the mechanism the level-5 anchor asks for.
- A silent card gets U. A carried defect counts against the card.
- The spike's results are *observed*, but only for what the spike ran: unmodified `absurd.sql` on PGlite 0.5.8 in one process, plus the fence and topic probes. They raise confidence. They do not raise a level above 3, because a probe is not the product.

**Correction to my round 1.**
- I gave INT-5 3h and COR-5 3h to R-1, D-1 and B-1 on the strength of "the Evidence ID is the step key".
- The skeptic's F1, confirmed in J-04, shows that this cannot work: the ID hashes output and environment, so it exists only after the probe has run.
- Those levels were overstated. They are re-earned below on a mechanism that does work: A-rea's X-1.
- A second correction comes from A-rea §0. rea does resolve `new Worker(new URL(…, import.meta.url))`. The real overclaim is that `complete` measures truncation, not resolution: `import.meta.resolve` followed by `import(p)` stays unresolved under "complete". That changes the evidence behind EPI-4, but not any level.

**Profile shift.** In the amended case file, the official client hosts the turn loop, so in its default mode (Mode A) it is an **agent-tool** (INT 3, EPI 3), no longer an agent-harness. Mode B, where pi-durable runs the loop on API keys, is still agent-harness. The CI sweep stays **security-tool**.

## 1. Re-scored families

"r1" is the round-1 range across the family's member cards.

### F1 Durable case file (R-1 + D-1 + L-1; official client as host; MCP server with its own store; B-2 as an option)

| Criterion | r1 | r2 | Moved by | Residual that caps it |
|---|---|---|---|---|
| REL-1\* | 3–3h | 3h | A-rea §3: step row, Evidence and unknown revision in one transaction inside the server. A-durable W-D1-2 and W-D1-3: Evidence-ahead, `VACUUM INTO` handover. Lease row (all) | **Narrowed:** the client's own conversation and model spend are no longer covered. The guarantee is "the case survives", not "the session survives" |
| INT-5 | 3–3h (overstated) | 3h | A-rea X-1: ProbeKey computed from inputs before execution; ObservationId with nested paths removed; FindingKey | The ProbeKey may miss an input that affects the result (stale replay). X-1 test 2 (mutate every parameter of all 208 tools) decides it |
| EPI-4 | 2–3h | 3h | A-rea X-6 census and resolver ablation; A-leanrea's split into `machine_observed` and `agent_reported` | Needs an upstream schema change in rea. Until then rea's `complete` is read as `partial` |
| PERF-2\* | 3h | 3h | A-leanrea W-L1-2: recording happens inside the probe call, with no extra turn. A-rea measured 20,829 B with `detail:"summary"` against 178,983 B full detail (sent twice) | Bytes per answer are measured for one call only. X-9 is pre-registered and not run |
| AGT-1\* | 2 | 3h (Claude path) · 2 (Codex, skill mode) | A-leanrea X-2: `Tainted<string>`, an envelope applied again on every read, a policy gate in the dispatcher, a client with no shell (t3code `--tools ""` seen) | Codex's shell may not be removable (unknown). Skill mode is labelled "unenforced". A person can still approve a harmful action |
| SEC-8 | 2 | 3 (container lane) · 2 (host-only) | A-rea: argv calls under process-host, rea's ZIP reader with a 500× budget, a tar reader with reject classes and fuzzing. A-leanrea: a container "whenever available" | On a macOS desktop, `otool` and `nm` still parse untrusted bytes on the host (owner decision) |
| AGT-6 | U–3h | 3h (tool side) | Budgets per case and per rung (A-rea, A-leanrea); X-10 budgets and `request_resent` (A-durable, Mode B) | In Mode A, model spend belongs to the client; the product only reads the client's usage ledger |

### F2 CI sweep and delta gate (R-2 + L-2 + B-1; D-2 narrowed to effects and publishing)

| Criterion | r1 | r2 | Moved by | Residual that caps it |
|---|---|---|---|---|
| REL-1\* | 3–3h | 3h | A-absurd §2.2 lease fence, prototyped (`fence.mjs`: AB004 on expired-but-unswept writes, AB005 on a timeout of 0), *observed* in the probe. D-2 effect keys with `possibly-done` (A-durable W-D2-2) | The fence stops recording, not execution: a stale step can still cause effects. The race test on real Postgres has not been run |
| INT-5 | 2–3h | 3h | X-1 FindingKey removes the subject digest, which fixes R-2's broken claim of identity across versions | The capability-class normalisers do not exist. Survival ≥95% over real version pairs is untested |
| EPI-4 | 3h | 3h | X-6: the gate fails closed on any unresolved loading site; coverage reach is generated from fixtures (`reach.json`, A-leanrea X-8) | Noise is unmeasured: ≤1 false "changed" per 10 benign updates decides whether the gate is usable |
| PERF-2\* | 3 | 3h | A-absurd: reads ≤8 KiB, `{digest, bytes, preview}` expanded on request, 50 rows per page with a cursor. A-rea: one long-lived `rea mcp` per worker | The 8 KiB figure is a target. The 60 s per pair is unmeasured on real packages |
| AGT-1\* | U–2 | 3h | The escalation agent gets only read-only MCP tools and no shell; the key stays outside the container; the X-2 set runs in CI (A-leanrea L-2, X-2) | The same residuals as F1, minus skill mode |
| SEC-8 | 2–3h | 3h | A container per attempt with images pinned by digest and every extractor row fuzzed (A-leanrea W-L2-3); the tar reject classes (A-rea) | Kernel escape. Donor 21 stays a pattern only, with no licence |
| AGT-6 | U–3 | 3h | `--max-budget-usd` per escalation (seen in leanrea's harness), a cap per sweep, a model-free bulk pass | Spend is estimated, and depends on the subscription-terms decision (§4) |

### Summary matrix (round 2; arrows show change from round 1)

| | REL-1 | INT-5 | EPI-4 | PERF-2 | AGT-1 | SEC-8 | AGT-6 | Services |
|---|---|---|---|---|---|---|---|---|
| F1 case file | 3h (narrowed) | 3h (re-earned) | 3h | 3h | 2→3h* | 2→3 | U→3h | none (SQLite, or PGlite in-process) |
| F2 sweep/gate | 3h | 2→3h | 3h | 3→3h | U→3h | 2→3h | 3→3h | none for one worker; Postgres for several |
| S-1 (null) | 3 | 2 | 2 | 2 | 1 | 2 | 2 | none (Tiers 0–2) |
| S-2 (layer) | 1 | 3h | 3h | U | NA | 2 | NA | none |

\*3h on the Claude path, 2 for Codex and skill mode.

**S-1 is unchanged, with one new risk and one available gain:**
- **Risk.** pi-ai switches to Claude Code identity headers for any key containing `sk-ant-oat` and reads `ANTHROPIC_OAUTH_TOKEN` (A-durable X-3, seen). S-1 Tier 2 passes keys through pi-ai with no guard, so it can break the account guardrail if a user supplies an OAuth token.
- **Gain not yet taken.** `detail:"summary"` exists in rea today and would lift S-1's PERF-2. Nobody has measured it in S-1's configuration, so it stays 2.

**S-2** is now a mandatory layer, not a candidate. Its spec gains the three X-1 keys, X-6 coverage, the EPI-2 report shape, `origin` taint, `redactions`, reach state per claim and `delivered:false`. As a stand-alone product it stays at REL-1 1.

### Disagreements on the amended shape (scored, not resolved)

**D1. The case-file store and kernel.**

| Option | Who | Better on | Worse on |
|---|---|---|---|
| (a) Own SQLite store in the MCP server; pi-durable's organs 6, 8 and 16 taken as logic, not the kernel | A-rea; A-leanrea (SQLite default plus a lease row) | REL-1 atomicity (one transaction); EVO-1 (no imported "API changes without notice"); footprint (`node:sqlite`); several local processes possible [inferred] | No crash-loop guard or conformance kit until rebuilt; nothing has run yet; if the fleet uses absurd, two engines (X-4 doubles the test matrix) |
| (b) pi-durable `ToolTask` in a "case conversation", Evidence-ahead plus pointer; Mode B harness for CI | A-durable | COR-1 and REL-1 machinery that exists (parking, `ControlledStorage` crash tests); one kernel for Mode A and Mode B | Two commits per call, needing a reconcile scan and `delivered:false`; the one-day spike (`ToolTask` outside a generation) has not run; inherits pi-durable's churn (EVO-1 2) and its single-owner store |
| (c) absurd schema on embedded PGlite, fence on locally (X-4 option A) | A-absurd | Consolidation (one schema for F1, F2 and B-2; no doubled matrix); the strongest evidence in hand (spike *observed*); the fence comes free | PGlite is 0.x and 25.4 MB; the TS SDK on PGlite has not run; one process only; PG18 `uuidv7()` ignores the fake clock. A-absurd itself refuses PGlite as the default until the SDK and a kill test have run |

Neither (a) nor (c) dominates on criteria; (b) is behind on REL-1 atomicity and EVO-1. If the owner wants one engine for both families, (c) wins on PUR-3 and MNT-2. If F1 must stand alone and stay small, (a) wins.

**D2. Where D-2's effect layer goes.**
- **A-durable:** in both families, because the case file also launches targets and files findings. Better on REL-1 and AGT-3 for those case-file effects.
- **A-rea and A-leanrea:** only for effects the gate itself causes (reports, tickets). Better on PUR-3 and INT-3 (less surface).
- The case file does run `detonate` steps, so I score A-durable's placement higher on REL-1. The cost is surface.

**D3. Model access in CI.**
- **A-durable, Mode B:** a pi-durable harness on API keys. Richer AGT-6 (`request_resent`, restart limit), but it doubles the product's modes (INT-3, MNT) and needs the `sk-ant-oat` guard (SEC-6).
- **A-leanrea:** a headless official client with `--allowedTools` and `--max-budget-usd`. Better on AGT-1 (no shell) and on owned code. Its AGT-6 is coarser.

**D4. Redaction point.**
- **A-leanrea:** at the envelope, at render time.
- **A-durable:** at the source, before the commit.
- Only source redaction keeps secrets out of the store, the WAL and exports. On SEC-6, A-durable's design wins. The envelope adds a second layer.

**D5. Keep a rendered skill (an "unenforced" mode)?**
- **Keep (A-leanrea):** better reach (EVO-3) and INT-6.
- **Cost:** in that mode AGT-1 drops back to 2, and the mode must be labelled.

## 2. The systemic gaps after round 2

| Gap | r1 | r2 | Lifted by | Test that would confirm |
|---|---|---|---|---|
| AGT-1 | ≤2 | 3h for product-owned execution; 2 in skill mode and the Codex path | A-leanrea X-2 | (a) unit tests with no model: 100% of effectful calls in a tainted session blocked without approval, on every commit; (b) 0 tripwire hits in 120 runs per supported model (bounds the rate below 2.5%); (c) planted false claims adopted as `observed` ≤5%, with an interval; (d) a planted case replayed to a fresh agent |
| SEC-1 | U | 3h | A-leanrea's threat model (TB1–TB7, threat table with a test each); A-absurd's advisories, 5-day triage target and yearly drill | `SECURITY.md` plus the threat model reviewed each release; the drill run once with its timings recorded |
| EPI-2 | U / 2 | 3h (method); levels unknown | A-rea: precision per (operation, class) with Wilson intervals; `INSUFFICIENT` below n=30; a demotion rule; escalation now rule-based (A-leanrea) | The calibration report published from CI; a deliberately wrong producer demoted within one run; no level stated for `INSUFFICIENT` units. Residual: fixture labels are not real targets, and errors are systematic |
| SEC-6 | ≤2 | 3h | A-durable: redact at source, store a fingerprint not the value, ID computed over the redacted projection, `secure_delete`, export through `VACUUM INTO`, export refused on a pattern hit | A seeded-secret corpus; grep the database, the WAL, the export and a captured provider request: 0 hits each. Residual: the detector's false negatives; the detector's source and licence are unknown; rea refuses to infer secrecy (`rea:AGENTS.md:13`), so this lives outside rea |
| PRV-4 / EVO-4 | U / U | PRV-4 2 · EVO-4 U | A-absurd §2.4: a draft position (manufacturer or steward), reporting process, SBOM, VEX, `support.json` | PRV-4 reaches 3 once the owner fixes the role. EVO-4 stays U until a support period with an end date is published. Then: a Scorecard gate, `gh attestation verify` on every asset, a fake-report drill |

**What none of these lifts touch:**
- **S-1 is unaffected.** All five lifts are new product code, not composition. This widens the margin over S-1 on paper, but only if the code is built and the tests are run.
- **No lift covers a person approving a harmful request,** or a model *believing* planted text without acting on it. AGT-1 can measure that and label it. It cannot block it.

## 3. Beats S-1 on what? One capability each

- **F1. One commit per probe.** It holds a step row keyed by an input-derived ProbeKey, the Evidence the runner wrote (with a path-free ObservationId) and the unknown's revision. A resumed case never re-runs a completed probe and never holds a result without its Evidence.
  - **Why S-1 cannot:** rea's ledger lives in memory; nested Evidence IDs depend on the path; and in Tier 2 the bundle export is a separate call after each probe. All three need changes inside rea's O5 and O6, which is upstream.
  - **The test that decides it** (A-rea W-R1-3): kill at step k against S-1 Tier 2. If the gap is ≤1 repeated probe and 0 lost unknowns, F1 folds into S-1 plus the S-2 layer.
- **F2. A verdict that survives a version change and cannot pass on coverage it did not resolve.** The gate keys a finding by FindingKey and fails closed on X-6 census gaps.
  - **Why S-1 Tier 3 cannot:** rea's `complete` is a truncation flag (`javascriptApplicationEvidenceSchemas.ts:197-203`), and its IDs include the subject digest.
  - **What is not F2's capability:** the shared fleet ledger. If the owner answers "one worker", bundles from one schema are merged afterwards, which is S-1 Tier 3 with a better format.
- **Strict caveat for both.** Each capability is a change to rea's records or analysis. If rea accepted those changes upstream, S-1 would get them too. The merger's real margin is then **who owns those changes, and how fast they ship** (X-5: vendor the code and pin golden vectors). That is a maintenance argument, not a capability one, and the owner should weigh it as such.
- **S-2.** It beats S-1 on portability across tools only. It adds no capability unless someone adopts it, and rea does not conform yet.

## 4. Owner decisions that have emerged

| # | Decision | What it changes in the scores |
|---|---|---|
| 1 | **More than one worker process?** | **No:** F2 stays REL-1 3h on embedded storage with no services; B-1's shared ledger and roles drop out; fleet SQL is a union of bundles; F2's margin over S-1 Tier 3 shrinks to §3's gate capability. **Yes:** a Postgres service, the fence plus roles (OPS-3 2→3 by design), and the shared-store threat boundary TB4 active. RL-2 risk rises |
| 2 | **Store for F1:** own SQLite, the pi-durable kernel, or absurd on PGlite (D1) | As in table D1: REL-1 atomicity and EVO-1 against consolidation (PUR-3, MNT-2) and evidence in hand. The PGlite default waits on the TS SDK and a kill test (A-absurd's own condition) |
| 3 | **Do provider terms allow a third party to drive the official client on a subscription:** interactively, in CI, unattended? | **Forbidden in CI:** Mode B or a headless client on API keys. SEC-6 secret storage (keychain-backed SecretRef) becomes load-bearing. Framing §6's "no stored credentials" fails for CI. AGT-6 relies on product budgets. **Allowed:** AGT-6 leans on the client's ledger. Either way, Mode A interactive stays clean |
| 4 | **Must product mode require a restricted client** (no built-in shell)? | **Yes:** AGT-1 3h holds. **No, or Codex's shell cannot be removed:** AGT-1 2 for those users |
| 5 | **Windows coverage in v1?** | **Declared not covered** (X-8): EVO-3 stays 2, with WSL2 or a container as the route. **Required:** a Windows lane, process-host Windows tests, and weaker X-7 enforcement on that host |
| 6 | **Host-only parsing on a macOS desktop with no VM?** | **Allowed:** SEC-8 2 in that lane, declared. **Forbidden:** SEC-8 3, at the cost of setup (OPS-1, INT-6) |
| 7 | **Are handovers and multi-week waits a real need (B-2)?** | **Evidence from session logs says yes:** topics plus a shared or PGlite store; AGT-3 weighs more; RL-2 is highest (a long-lived shared untrusted store). **No:** B-2 is cut, and F1's scores do not change |
| 8 | **Keep secret values at all?** | **No:** SEC-6 3h as designed. **Yes:** it depends on the OS keychain on every host, so SEC-6 is weaker on hosts without one |
| 9 | **CRA role and length of the support period** | Sets PRV-4 (2→3) and EVO-4 (U→3 if stated). A five-year period means vendoring pinned parent code and backporting fixes: a standing SUS-1 cost |
| 10 | **Keep the rendered skill as an "unenforced" mode?** | **Keep:** EVO-3 and INT-6 rise, and AGT-1 is 2 in that mode. **Drop:** reach shrinks to MCP hosts |

**Facts still open (not owner decisions, but they move scores):**
- whether Codex's shell can be removed (decision 4);
- whether `ToolTask` runs outside a generation (D1 option b);
- the TS SDK on PGlite, and a migration from embedded to shared (D1 option c);
- whether the capability-class normalisers for FindingKey can be built;
- the X-9 result against Tier 0, which can still return the null option for F1.
