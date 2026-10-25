# B Release Delta Gate

Candidate B of four ([README](README.md); chosen in [journal J-06](../journal.md)). Writer: a fresh architect agent that took no part in the debate. Every design statement is **[inferred]** until built; facts carry [seen] with a `repo:path:line` citation at the pinned commits in [sources.md](../sources.md). Numbers without a source are marked as estimates. Claims about the CycloneDX, SPDX, in-toto, SLSA and VEX specifications are **[inferred]**: this writer did not verify them against the specs.

Origin: R-2 (diff and gate) + L-2 (model-free sweep) + B-1 (only as the multi-worker variant) + D-2 narrowed to publishing. Profile: **security-tool** (round-2 judge).

## 1. Thesis

For every new version of a dependency, extension or desktop app, an unattended CI job with no model runs pinned probes in a fresh container per attempt and returns a version-to-version verdict keyed by FindingKey. The verdict fails closed whenever coverage is unresolved, so "no change" is only reported when the gate can show what it examined.

## 2. Who uses it, and three usage scenarios

**Users.** Platform and supply-chain teams that gate merges and releases in CI (framing §2, row 3). Reviewers and their agents read the reports. Nobody has to talk to an agent for the gate itself to work.

**Scenario 1: a lockfile bump in a pull request.** A PR updates 41 npm packages and one Electron app.
1. The CI step `delta-gate sweep --lockfile-diff` turns the diff into 42 (old, new) pairs. A fetch step downloads each tarball and checks it against the lockfile's `integrity` hash, outside any analysis container (npm lockfiles carry `integrity` sha512 values, e.g. `rea:package-lock.json:93`) [seen].
2. Each pair runs in its own container with no network: the router pack inventories both versions, one long-lived `rea mcp` analyses the JS/Electron graphs and calls `compare_application_versions` (`rea:src/contracts/applicationToolContracts.ts:117`) [seen], and the census counts loading sites.
3. The PR check shows a short table and exits 1:
   ```
   delta-gate 42 pairs: 39 pass, 2 BLOCK, 1 UNRESOLVED (exit 1)
   BLOCK  pkg-a 2.3.1→2.4.0  npm.install-script added (fk_3a1…, observed)
   BLOCK  pkg-a 2.3.1→2.4.0  network.literal-host added "telemetry.example" (fk_9c0…, observed)
   UNRESOLVED pkg-b 1.2.0→1.3.0  dynamic-import: 1 unresolved site lib/x.js:88 (coverage partial)
   ```
4. The full report (S-2 v1 records, census, `reach.json` state, unknowns) is uploaded as a CI artifact, with an in-toto statement over its digest.

**Scenario 2: a vendor's desktop app release.** A supply-chain team re-checks a vendor's Electron app (macOS `.zip`) before rollout.
1. The pair runs on the default Linux lane. The Mach-O slices and load commands come from rea's portable reader (`rea:src/artifacts/apple/MachoLoadCommandReader.ts`) [seen file]. Entitlements need macOS `codesign` (`rea:src/native/parsers/codesign.ts`) [seen file; inferred from its location], so `reach.json` marks them **partial** on Linux.
2. The report says: "2 new IPC channels (observed); 1 native add-on changed digest; entitlements: not covered on lane linux-container". The team's policy treats "not covered" on entitlements as blocking for desktop apps, so the gate exits 2 until the optional macOS VM lane runs (owner decision, §13).

**Scenario 3: a reviewer accepts a finding, and it stays accepted.**
1. The reviewer looks at `pkg-a`'s new host, decides it is acceptable, and adds `{fk_9c0…, value digest, reason, reviewer, expiry}` to `accepted.json` in their own repository. That edit goes through the team's normal code review, so review state is versioned in git and needs no shared store.
2. At `pkg-a` 2.4.1 the FindingKey and its value are unchanged, so the line shows as `accepted` and does not block. At 2.5.0 the host changes, the value digest differs, and the line blocks again.
3. Optionally, a separate job writes a plain-language summary with the team's official agent client (§4). The summary never changes the exit code.

## 3. Anatomy of capabilities

| Capability | Source organ | Verdict | What must change | Licence | Gap IDs |
|---|---|---|---|---|---|
| Router pack as data, with leanrea's traps as row notes | `leanrea.md` L5 Router; L7 Traps | adapt; L7 lift | Typed argv rows (detect rule, command, cap, platform, effect class, fixture); no shell; pinned tools; `\|` escapes and `npx -y` removed | MIT, notice kept | X-8, RL-4 |
| Batched first-move inventories per type | `leanrea.md` L6 First moves | adapt | Linux rows written new; Mach-O through rea's reader, not `otool`; quoted, pinned, capped | MIT | W-L2-2, X-8 |
| Report and catalog size gate in CI | `leanrea.md` L11 MCP sizer | adapt | Add a timeout; measure the read-only MCP surface and report bytes per pair | MIT | X-9 |
| S-2 v1 record (Evidence) | `rea.md` O5 Evidence record | adapt | Vendored 17-file closure (2,839 lines); nested records reduced to IDs (ObservationId); capped at record + two IDs (N-2) | MIT | X-1, X-5, N-2 |
| ProbeKey (step key from inputs) | `rea.md` O6 snapshots (path-free query key, `rea:src/domain/analysisSnapshot.ts:354-367`) | **new, S** | Adds provider version, profile digest, redaction-detector version | — | X-1, N-10 |
| FindingKey and capability-class normalisers | `rea.md` O11 (node identity stability, `javascriptApplicationEvidenceSchemas.ts:420-478`) | **new, L** | One normaliser per class (install script, IPC channel, literal host, native add-on, child_process path, fuse, entitlement); none exists yet | — | X-1, W-R2-1 |
| Residual unknowns for unresolved items | `rea.md` O7 Unknown registry | lift | Opened by the runner only; `not_covered:<lane>/<format>` reason | MIT | EPI-4 |
| Gate policy from effect classes | `rea.md` O3 Effect audit | lift | Split `mutatesSession`; any row with `executesForeignCode`, `launchesProcess` of the target or `accessesNetwork` is refused in the gate | MIT | X-7, AGT-2 |
| Hardened readers plus a tar/gzip reader | `rea.md` O10 Artifact readers | adapt + **new, S** | Own tar reader extracts to a directory that rea reads; rejects absolute paths, `..`, links and devices; 500× budget | MIT | SEC-8, RL-4 |
| JS/Electron graphs and version compare | `rea.md` O11 JS/Electron analysis | leave (pinned `rea mcp` subprocess) | One long-lived server per attempt; `detail:"summary"`; procps in the image | MIT | W-R2-3 |
| Coverage census of loading forms | `rea.md` O11 (forms listed in r2-a-rea X-6) | **new, M** | An independent site count with `@babel/parser`, reconciled against rea's edges; until it exists, rea's `complete` is read as `partial` | — | X-6, W-R2-2 |
| Job-level coverage record | `donors.md` row 18 strix coverage.json | adapt | `machine_observed` only in the gate; versioned schema | Apache-2.0; add attribution (no NOTICE) | X-6, EPI-4 |
| Probe supervision | `donors.md` row 1 orca process-host | lift | None; 30 s / 8 MiB defaults (`orca:src/packages/process-host/src/process-spec.ts:77-78`) [seen] | MIT, root notice | SEC-8 |
| Attempt isolation and safe names | `donors.md` row 2 orca worktree-per-worker | adapt | A fresh work dir per attempt; a git worktree only when a pair is built from source tags | MIT | N-1 |
| Lost contact is never a pass | `donors.md` row 5 orca liveness vocabulary | pattern | `unverifiable` maps to exit 3, never to 0 | MIT | W-R2-2 |
| Container per attempt | `donors.md` row 21 agent-sandbox-lockdown | pattern (no LICENSE) | Own spec: internal network, read-only, `cap_drop: ALL`, non-root, limits; images pinned by digest | — | SEC-8, W-L2-3, N-8 |
| Bundle store: one SQLite file per artifact | `pi-durable.md` organ 2 (STRICT tables, migrate at open); organ 16 conformance kit | pattern; adapt kit | `node:sqlite`; exclusive lock at open; `secure_delete`; kill-at-step-k and two-opener cases | MIT | N-1, SEC-6 |
| Gate result rows with input digests | `donors.md` row 24 laya-coreml measurement record | pattern | Each verdict row carries pair digests, image digest, rea version, census version | Apache-2.0, NOTICE | EPI-1 |
| Delta engine, policy file, baseline, exit codes | — | **new, M** | Pairing by FindingKey; fail-closed rules; `accepted.json` | — | W-R2-2 |
| Report emitters (JSON, in-toto statement, SARIF view) | — | **new, M** | JSON S-2 records canonical; others are views | — | PRV-4 |
| `reach.json` from per-row fixtures | `leanrea.md` L5 (fallback per row) | **new, S** | Generated in CI, never hand-written | — | X-8 |
| Calibration report for normalisers | `donors.md` row 22 laya kernel; `rea.md` O19 known-answer grader | adapt | Precision per (class, producer), Wilson interval, `INSUFFICIENT` below n=30 | Apache-2.0; MIT | EPI-2 |
| Publishing with effect keys | `pi-durable.md` organ 6 (intent before effect); `donors.md` row 4 orca receipts | pattern; adapt | `effectKey = H(run, pair, report digest, target)` forwarded as idempotency key; `possibly-done` held | MIT | W-D2-2 |
| Optional summaries by delegation | `donors.md` row 9 t3code sign-in; row 10 one home per account | adapt; pattern | Separate job; read-only MCP tools only; `--max-budget-usd` | MIT | X-3, G-terms |
| *Variant only:* shared fleet ledger | `absurd.md` O2 state machine, O3 claim and lease | lift with fixes | Fence AB004, AB005, roles, Postgres server (not PGlite) | Apache-2.0, NOTICE | W-B1-1..3, X-4, N-6 |

## 4. Integration surfaces

- **CLI.** `delta-gate run --old A --new B --policy policy.yaml --baseline accepted.json --out report/` and `delta-gate sweep <manifest|--lockfile-diff>`. A thin CI wrapper (GitHub Actions, GitLab template) calls the CLI.
- **Exit codes.** 0: no blocking delta, coverage resolved. 1: a blocking delta. 2: unresolved coverage or a not-covered cell the policy names (fail closed). 3: unverifiable (timeout, lost contact, tool error). 4: policy or input error. The default policy fails CI on 1–4.
- **MCP.** A read-only stdio server for reviewing agents: `report.summary`, `report.finding(fk)`, `report.coverage`, `report.unknowns`, paged, with an 8 KiB-per-read target (A-absurd's figure, unmeasured). No write tools, no listener.
- **SDK.** None in v1 (scope cut). The vendored S-2 library is internal.
- **Storage: exactly one store.** One SQLite bundle per artifact (both versions of the pair), written by the one container attempt that analysed it. The runner merges the latest completed attempt per artifact into the run report (a SQLite file plus the JSON export) after the attempts exit. No database service. The multi-worker variant replaces this store with absurd on Postgres (§5).
- **Identity and accounts.** The gate stores and needs no credentials. Optional summaries run in a **separate job**, after the verdict, through the team's official client (Claude Agent SDK or CLI, `codex app-server`, or ACP) in its own config home (`donors.md` rows 9–10). Whether provider terms allow a subscription login to be used in CI is **unknown** (G-terms, owner). If they do not, summaries use an API key from the CI secret store. Any API-key path accepts only **listed key types** (an allowlist, per N-11) and refuses OAuth tokens and `ANTHROPIC_OAUTH_TOKEN`. pi-ai treats any key containing `sk-ant-oat` as an OAuth token (`ai:src/api/anthropic-messages.ts:1014-1016`) [seen], so a blocklist is not enough. B does not need pi-ai at all. No key ever enters an analysis container.
- **SBOM.** In: dependency inventory is taken from an existing CycloneDX or SPDX generator and recorded as provider Evidence (scope cut from L-2). The gate's own lines cover capability surface that component lists do not carry [inferred]. Out: report lines can reference SBOM components by purl or bom-ref [inferred about the specs]. rea itself emits no SBOM, SARIF or in-toto output (`git grep` finds these names only in `licenses/` and one fixture) [seen].
- **Attestations.** An in-toto Statement whose subject is the new artifact's digest and whose custom predicate holds the report digest and verdict [inferred about in-toto]. Signing and verification use the CI's existing tooling (for example Sigstore or `gh attestation`) [inferred]. The gate's own releases need SLSA provenance and an SBOM (PRV-4).
- **VEX.** The gate makes no exploitability statements, so it emits no VEX. The product publishes VEX for vulnerabilities it inherits from rea, absurd and pi (PRV-4) [inferred about VEX].

## 5. Architecture sketch

```
 CI job (runner, trusted code)                       TB5: provider account (summary job only)
 ┌───────────────────────────────────────────┐       ┌──────────────────────────────┐
 │ pair planner ─ fetch + integrity check ───┼─TB7─▶ │ official client, own home,   │
 │      │ (network allowed here only)        │       │ read-only MCP tools, no shell│
 │      ▼                                    │       └──────────────▲───────────────┘
 │ per pair: start container (image@digest) │                      │ TB2: enveloped text
 │ ┌──────────────── TB1 ──────────────────┐ │                      │
 │ │ no network, read-only artifact mount  │ │   report.sqlite + report.json + in-toto
 │ │ router rows (argv) → process-host     │ │          │
 │ │ tar reader → rea mcp (pinned) → census│ ├─TB4─▶ merge (read-only opens) ─▶ verdict ─▶ exit code
 │ │ redact at source → bundle.sqlite (lock)│ │          │
 │ └───────────────────────────────────────┘ │          └─TB3─▶ publisher (effect keys) ─▶ PR check / ticket
 └───────────────────────────────────────────┘
```

**Trust boundaries** (A-leanrea's TB1–TB7, with the SEC-1 additions the skeptic required):
- **TB1** artifact bytes → parsers: one container per attempt; extraction budgets; fuzzed rows.
- **TB2** parser output → any reader: `origin` and taint fields on records; the envelope is applied whenever report text reaches a model.
- **TB3** gate → effects: only publishing. Effect keys are forwarded; targets that take no key need approval or are not used unattended.
- **TB4** bundles → report: each bundle has one writer, under an exclusive lock; the merge opens bundles read-only; the report is signed.
- **TB5** product → provider: the official client only, in a separate job.
- **TB7** tool supply chain: image and tool digests are pinned, and CI rejects unpinned rows.
- **Host client and other MCP servers** (added per SEC-1): a reviewing agent may run the read-only MCP server beside other servers. B cannot enforce anything there and says so.
- **TB6** (local listeners) does not apply: there are none.

**Variant: multi-worker shared ledger (owner decision 1; not the default).** A Postgres **server**, not PGlite (N-1). absurd's queue holds one task per pair. Evidence rows commit in the step's transaction (B-1). The lease fence adds AB004 and AB005, prototyped on one connection only (`spikes/pglite/fence.mjs`). It also adds roles with SECURITY DEFINER and spawning inside the caller's transaction. **What it adds:** fleet SQL across releases. **What it costs:**
- a database service;
- a fork of the 3,158-line `absurd.sql`, whose migrations are not transactional (N-6);
- a CI matrix on PG14 and PG18 (N-7);
- the shared-store boundary TB4 is active, and RL-2 rises (a shared store of target text);
- roles that exist only on paper (W-B1-2).

The gate's verdict logic is unchanged in the variant.

## 6. The three critical gaps

- **X-1 identity (paper).** B depends on X-1 more than any other candidate, because the verdict is keyed by FindingKey.
  - **ProbeKey** from inputs makes retries skip finished probes.
  - **ObservationId** has nested paths removed, so CI paths do not change IDs.
  - **FindingKey** pairs findings across versions. Its normalisers do not exist (W-R2-1, paper).
  - **Interim rule.** Findings are paired only where the location stability is `global-exact` or `source-map-exact` (`rea:src/domain/javascript/javascriptApplicationEvidenceSchemas.ts:420-430`) [seen]. A `cross-version-inference` match is `inferred`, and in a blocking class it is treated as *added*. This trades noise for safety: an unmatched finding is reported, never silently treated as the same.
  - **Tests:** X-1 tests 1–3 in gaps.md; the detector version in the ProbeKey (N-10).
- **X-2 untrusted content (test-gated; much smaller here).** There is no model and no agent in the gate, so planted text cannot drive an action during the sweep. Argument slots in argv rows accept only typed handles, never strings taken from the target.
  - **Residual 1: the summary job.** It runs with read-only tools, no shell and enveloped input. The X-2 tripwire set runs against it: 0 hits in at least 120 runs.
  - **Residual 2: reviewers and their agents.** They read target literals (host names, channel names). Records carry `origin: target`.
  - **Residual 3: other MCP servers** in a reviewer's own client. This is outside B's control and stated as unenforced (N-3).
  - **Residual 4: parser exploits.** These are TB1's job, not an injection problem.
- **N-1 store safety with several processes.**
  - **Default: does not apply** as stated, because no store is shared. Each bundle has exactly one writer process, its attempt's container. It is opened with an exclusive lock (`PRAGMA locking_mode=EXCLUSIVE` plus an OS lock file; [inferred] sufficient for SQLite). A second opener is refused, and that refusal is tested.
  - **Retries.** An attempt writes `<artifact>-<attempt>.sqlite`, so a stale attempt and its retry never share a file (S-1 tier 3's rule).
  - **Merge.** The merge opens bundles read-only, after their containers have exited.
  - **PGlite** is not used in either mode.
  - **Variant.** It uses a Postgres server, so N-1 does not arise. The fence race test (two connections, 1,000 iterations) is still open.

## 7. Other gaps

- **Resolves within its scope** (each one test-gated):
  - W-R2-2 false "no change": the census plus fail-closed exit 2.
  - W-R2-3 cost per pair: one long-lived `rea mcp` per attempt.
  - X-7: the gate runs only static rows, enforced by the container rather than by declarations.
  - X-10: the gate spends nothing on models; summaries are capped with `--max-budget-usd` (`leanrea:bench/run.py:16`) [seen].
  - W-L2-3 (container per attempt), X-8 (`reach.json`), and W-L2-1 (pre-filter scope cut).
- **Inherits:**
  - X-5: vendored S-2 code checked against rea with golden vectors.
  - X-6: the census is new code, and the upstream route is optional.
  - EPI-2: the calibration numbers are unknown until about 3,000 labels exist (estimate, gaps.md).
  - SEC-6: redaction at source before the bundle commit stores `secret:<type>:<sha256/12>`. The detector's source and licence are unknown (paper).
  - SEC-1: the threat model needs a SECURITY.md owner and a report drill.
  - N-12: the null arm has to be built (§9).
  - N-8: macOS enforcement and entitlements.
  - The variant also inherits X-4, N-6 and N-7.
- **Does not apply:** N-4 (B has no client turn loop to make durable), and X-9's agent rule. B is compared with S-1 tier 3 on recall, noise and wall time, not on cost per answer.
- **Makes worse:**
  - **RL-5.** A gate is an authoritative-looking artifact, so a false pass does more harm than having no gate.
  - **PRV-4 and EVO-4.** B sells CRA-adjacent evidence to its users, so its own CRA position and support period stop being optional.
  - **Maintenance.** Every capability-class normaliser and router row is standing work that tracks bundler and format changes.
  - **The interim.** Until the census exists, every JS pair reads as `partial` and exits 2. B is then effectively **report-only**.

## 8. Target RQS-2030 levels

Profile **security-tool**. These are design-intent targets, at 0.6 confidence; nothing is built. The baselines are the weakest parent's levels in the round-1 judge's R-2 and L-2 rows. Best parent overall: rea C 58.5. Weakest parent overall: leanrea D 40.3.

| Criterion | Target | Weakest parent | Why, and what caps it |
|---|---|---|---|
| REL-1\* | 3 | 2 (rea) | Per-attempt files, ProbeKey skip and deterministic re-run. Not 3h: there is no lease in the default, and the CI system is the scheduler. The variant could reach 3h once the fence race test passes |
| INT-5 | 3h | 3 (leanrea) | The three keys. Capped until FindingKey survival is ≥95% on real pairs |
| EPI-4 | 3h | 2 (leanrea) | Census, fail-closed coverage, `reach.json` and `not_covered` unknowns. Needs the census code |
| PERF-2\* | 3h | 1 (rea) | No tokens in the bulk pass; paged read-only MCP. The 8 KiB and 60 s figures are unmeasured |
| AGT-1\* | 3h | 1 (leanrea) | No agent in the gate. The summary job has no shell. Reviewers' clients are outside the boundary |
| SEC-8 | 3h | 1 (leanrea) | Container per attempt, digest-pinned images, fuzzed rows, tar reject classes. Kernel escape is the residual risk; Linux only |
| AGT-6 | 3h | 2 | Zero model spend in the gate; per-summary and per-sweep caps |
| COR-2 | 3 | 2 (absurd) | A historical replay corpus as an independent oracle |
| EVO-3 | 2 | 1 (leanrea, absurd) | JS, Electron and npm in depth. Native code gets inventory only. Native Windows is declared not covered |
| SEC-1\* | 3h | 0 (leanrea, absurd) | Only if the threat model gains its owner and the drill is run |
| PRV-4 · EVO-4 | 2 · U | 0 · U | Waits on owner decision 8 |

\* marks a core criterion.

## 9. What it beats the null option (S-1) on

**One capability:** a verdict that survives a version change and cannot pass on coverage it did not resolve. A reviewed finding stays reviewed through its FindingKey, and any unresolved loading site gives exit 2, never a pass.
- **Why S-1 tier 3 cannot do this today:**
  - rea's `complete` is a truncation flag (`rea:src/domain/javascript/javascriptApplicationEvidenceSchemas.ts:197-203`) [seen].
  - Its IDs hash `subject.digest` and `raw_result` (`rea:src/domain/evidence.ts:251-278`) [seen], so every new version gets new IDs.
- **What B does not beat tier 3 on.** Each of these could be added to S-1 as glue, without a merger:
  - the model-free pass (a script that calls the rea CLI is also model-free);
  - container isolation;
  - the router pack;
  - in the default, a fleet-wide query. That needs the variant, and then it is B-1's capability, not B's.
- **The judge's caveat applies in full** (round-2 judge §3). Both halves of the capability are changes to rea's records and analysis: the census, and the identity fields a FindingKey needs. If rea accepted them upstream, S-1 tier 3 would gain them too. B's margin would then be **who owns those changes and how fast they ship**. That is a maintenance argument, not a capability argument.
- **The fair baseline arm (N-12)** is S-1 tier 3 with its agent removed: the rea CLI per pair, plus a 150–300-line policy script (estimate). It has to be built before any comparison is claimed.

## 10. Trade-offs and risks

- **Fail closed versus noise.** Exit 2 on every unresolved site is the safe rule. If the noise falsifier fails, teams switch the gate to warn-only, and the gate has then failed. Obfuscated loaders that count as unclassified raise the noise further (r2-a-rea X-6).
- **Narrow reach.** In depth it covers JS, Electron and npm. Go, Rust and .NET get build facts. Native code gets inventory and headers only, with "deep native analysis not covered". DMG on the Linux lane depends on rea reading it without a mount (`rea.md` O10 says macOS is needed for mounts) [unknown], and `reach.json` states the outcome.
- **Weak use of the durable parents.** In the default, absurd is absent and pi-durable contributes one rule (intent before effect) plus its test kit. B is mostly rea, leanrea and donors. That is a finding about the merger, not a defect to hide.
- **Upstream churn.** rea shipped 38 releases with 12 BREAKING sections in three months, and one maintainer made 59% of commits (`rea.md` §4). B pins `rea mcp` and checks it with golden vectors, but each pin bump re-runs the normaliser and census fixtures.
- **Trends to 2030–35:**
  - **Better models** do not erode a model-free, digest-reproducible verdict. They do make ad-hoc agent diffs cheaper, and the verifier shape (C) gets cheaper as models improve, which squeezes B from below [inferred].
  - **The CRA** raises demand for "what changed, and what was not examined" per release [inferred]. It also binds B to the same duties itself.
  - **Agents as the main callers** matter less here, because CI is B's caller. Agents only read reports.
- **Market.** Dependency-behaviour scanners already exist. How good they are is unknown, and nothing in our evidence compares B with them. SBOM tools overlap on component inventory, which B therefore delegates.

## 11. Size

- **Owned code: about 15–30k lines, plus tests (estimate).**
  - **L:** the FindingKey normalisers.
  - **M:** the census, the delta and policy engine, the report emitters, the runner and container orchestration, and the router-row executor with its fixtures.
  - **S:** ProbeKey, the tar reader, the bundle store and merge, `reach.json`, publishing.
  - **Vendored:** about 3k lines of S-2 core and process-host.
  - **Comparison:** S-1 tier 3 is about 0.5–1.25k lines (skeptic's estimate).
- **Upstream dependencies:**
  - rea as a pinned subprocess (high churn, see §10);
  - Node ^22.19 (`rea:package.json`), with `node:sqlite`;
  - a container runtime and digest-pinned images;
  - an external SBOM generator;
  - Orca process-host is copied once, so it has no ongoing churn.
  - The variant adds a Postgres service and an owned fork of `absurd.sql`.
- **Maintainers (estimate):**
  - about 2 FTE: one for normalisers, census and rea pins; one for the runner, isolation, release and CRA duties;
  - about 0.5 FTE for router rows and `reach.json` fixtures;
  - a five-year support period adds standing backport work (owner decision 8).

## 12. What would prove it wrong

Measured on a fixed corpus: at least 50 historical version pairs with publicly known capability changes, at least 100 benign pairs, and a seeded mutation corpus, all on a standard CI runner. The S-1 tier 3 baseline arm from §9 runs on the same corpus. Thresholds are estimates unless they come from the cards.

| # | Kill criterion | Threshold |
|---|---|---|
| K1 | False "no change": exit 0 on a pair with a known or seeded capability change in a form marked covered | any seeded case, or more than 1% of historical pairs |
| K2 | Recall on the declared capability classes (R-2 card) | below 90% |
| K3 | Noise: false "changed" or blocking lines on benign pairs (R-2 card) | more than 1 per 10 benign updates |
| K4 | Fail-closed rate on benign pairs once the census exists | exit 2 on more than 20% of pairs |
| K5 | Wall time per pair (W-R2-3) | median above 60 s or p95 above 300 s on at least 50 real pairs |
| K6 | FindingKey survival for unchanged code (X-1 test 3) | below 95%, or any collision across capability classes |
| K7 | Determinism: two runs on the same pair | any difference in verdict or ProbeKeys; ObservationId differences not flagged `nondeterministic` |
| K8 | Margin over the baseline arm | recall and noise both within 5 points of S-1 tier 3 plus the policy script → fold B into D |
| K9 | Isolation | any parser escape from the container in fuzzing |
| K10 | Store | a second opener of a bundle is not refused |
| K11 | Adoption (R-2 card) | pilot teams switch to warn-only within one month |

A trigger, not a kill: if rea accepts the census and FindingKey-ready fields upstream within the owner's window, the owner re-decides between B and D on maintenance grounds alone.

## 13. The owner decisions it depends on

[06-options.md](../06-options.md) is not written yet. Numbers refer to the round-2 judge's §4 list. Rows marked *proposed* are new and specific to B.
1. **More than one worker process?** (judge 1; X-4, N-6). **No** gives the default SQLite bundles with no services. **Yes** gives the Postgres variant: the fence, roles, the absurd fork and the PG14/PG18 matrix, with RL-2 rising.
2. **Provider terms for a subscription login in CI** (judge 3; G-terms). This only matters if summaries are enabled. **Forbidden** means an API key with the allowlist guard.
3. **A restricted client for summaries** (judge 4). Codex's shell may not be removable.
4. *Proposed:* **the census route.** Options: an independent pass (the default here), an upstream PR to rea, or a fork of O11 (X-6, X-5).
5. *Proposed:* **the blocking default before the census exists.** Ship report-only, or fail closed on everything.
6. **A macOS VM lane for entitlements and notarisation**, or keep them declared `partial` (N-8; similar to judge 6).
7. **Windows in v1** (judge 5). The default is declared not covered.
8. **CRA role and support period** (judge 9; PRV-4/EVO-4). This is load-bearing for B, because it sells release evidence.
9. **Keep secret values?** (judge 8). The default is no; only fingerprints are stored.
10. **Who builds the null arm** (N-12) before any number in §12 is claimed.
