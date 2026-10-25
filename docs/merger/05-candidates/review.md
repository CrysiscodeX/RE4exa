# 05 Candidates: the Judge's review

**Inputs.** The four candidate files, the [template](README.md), journal J-05 and J-06, [gaps.md](../gaps.md), and my round-1 and round-2 files.

**Method.** The same rules as before:
- levels are design-intent and capped at 3;
- **3h** means the design names the mechanism the level-5 anchor asks for;
- a silent card gets U.

**Citations.** I checked them against the clones in `/home/user/GitHub_Repos_Dump/`. All seven clones I opened are at the pinned commits: rea `b4938ae`, leanrea `09ba4aa`, pi `fdce48e`, absurd `3cfc64f`, orca `997d34b`, t3code `7e289ae`, strix `aa2036f`.

## 1. Template compliance and evidence check

**Template compliance.** All four files have the 13 template sections. The deviations and thin spots are listed per candidate below.

### A Case File

- **Thin: no default mode.** The file never says which mode is the default. Attach mode is unenforced, with AGT-1 at 2; restricted launch is enforced, with AGT-1 at 3h on the Claude path. The headline AGT-1 level depends on which one ships first.
- **Thin: no EVO-3 row in §8,** although the file discusses reach in §10.
- **Unsupported numbers:** none unlabelled. The ≤15 KB catalog and the 8 KiB reads are targets. "Park at 3", "5 approvals per session" and "about 3,000 labels" are marked as estimates.

| Citation in A | Check | Result |
|---|---|---|
| `rea:src/domain/analysisSnapshot.ts:354-367`, a path-free query key | `snapshotTarget` holds `sha256`, `kind`, `architecture`, `format`, and no path | match |
| `rea:…/EvidenceLedger.ts:44-47`, three in-memory Maps | `#records`, `#unknownRevisions`, `#unknownHeads` | match |
| `orca:…/process-spec.ts:77-78`, 30 s and 8 MiB | `DEFAULT_PROCESS_TIMEOUT_MS = 30_000`, `DEFAULT_MAX_OUTPUT_BYTES = 8 MiB` (lines 78-79) | match |
| orca process-host, "2,136 non-test TS lines" | counted 2,136 | match |
| `t3code:…/ClaudeTextGeneration.ts:216-228`, `--tools ""` and `--strict-mcp-config` | both present; `--strict-mcp-config` is dropped when a managed MCP config exists | match, with a condition A does not mention |
| `t3code:…/ClaudeHome.ts:40-45`, `CLAUDE_CONFIG_DIR` with `HOME` kept | present | match |
| `strix:…/coverage.py:263`, "unexamined, not clean" | present | match |
| "19 rows" in the router (`leanrea:SKILL.md`) | **18** data rows (lines 38-55) | **mismatch**, minor |
| `node:sqlite` is experimental on Node 22.22.0 | `ExperimentalWarning` printed | match |

### B Release Delta Gate

- **Thin: owner decisions renumbered.** §13 numbers the decisions 1–10 in its own order and cites the judge's numbers next to each. The mapping is correct, but it breaks one shared numbering across the four files.
- **Thin: account rotation not mentioned.** The file is silent on it. That is not a breach, because nothing in B rotates.
- **Unsupported numbers:** none unlabelled. 15–30k lines, 2.5 FTE, K4 20% and the 150–300-line baseline script are all marked as estimates.

| Citation in B | Check | Result |
|---|---|---|
| `rea:package-lock.json:93`, an `integrity` sha512 | present (a dev dependency in rea's own lockfile; it serves as an example) | match |
| `rea:…/applicationToolContracts.ts:117`, `compare_application_versions` | present at 117 | match |
| `…/javascriptApplicationEvidenceSchemas.ts:420-430`, `global-exact` and `source-map-exact` | both present | match |
| `…Schemas.ts:197-203`, `complete` = not truncated and nothing omitted | present | match |
| `ai:src/api/anthropic-messages.ts:1014-1016`, `includes("sk-ant-oat")` | present | match |
| `leanrea:bench/run.py:16`, `--max-budget-usd` | present (value 4) | match |
| "rea emits no SBOM, SARIF or in-toto output, outside `licenses/` and one fixture" | `git grep` finds only `scripts/fixtures/evm-interface.sol` | match |

### C Claim Verifier

- **Thin: `uses_llm` is not set in §8, but it should be.** The file offers an optional MCP tool, `verify_claims`, that agents call. Under RQS §5 that sets `uses_llm`, so AGT-1 applies to the verifier and does not become NA. Its adversarial claims-file tests (TB-V1) already cover the case.
- **Unsupported numbers:**
  - "21 of 25 keyed facts (84%) can be checked" rests on C's own classification. The count of 25 is correct (5 + 8 + 4 + 8 keys in `leanrea:bench/tasks.json`). The split is a judgement, so it is [inferred].
  - "45–70% mappable" is labelled an estimate.

| Citation in C | Check | Result |
|---|---|---|
| `rea:…/KnownAnswerEvaluation.ts:37-51`, 14 failure codes | 14 codes, from `claim_missing` to `selector_failed` | match |
| `…KnownAnswerEvaluation.ts:100-110`, `finalAnswerSchema` | `{id, value, evidence_id, confidence, authority}` | match |
| `…KnownAnswerEvaluation.ts:117-138`, canonical-JSON equality and a duplicate-key parser | both present | match |
| `strix:…/system_prompt.jinja:203`, closure states | `confirmed`, `ruled_out`, … present | match |
| `strix:…/reporting/tool.py:231-262`, unverifiable IDs dropped rather than stored | present | match |
| "19 rows", `leanrea:SKILL.md:36-55` | 18 data rows | **mismatch**, minor (A has the same one) |

### D Compose and contribute upstream

- **Deviation in §9, justified.** It lists what D gives up against A, B and C instead of "beats S-1". D is S-1, so the reframing is reasonable.
- **Deviation from "exactly one store".** D has one store for findings, but two or three stores of state in tiers 2 and 3. The file admits it. It conflicts with N-5, which J-06 settled by naming rea's ledger as D's store.
- **Thin: §8 mixes levels.** Today's levels (the S-1 row) and the levels "if the PRs merge" are mixed. Merging is outside D's control, so I score today's levels and show the PR-conditional ones in brackets.
- **Unsupported numbers:** the 90-day window, the "30% of contracts" threshold and the FTE figures are estimates and are marked as such.

| Citation in D | Check | Result |
|---|---|---|
| leanrea: 4 commits, 0 tags, one author | 4 commits; 0 tags; AICodeKing, all on 2026-10-17 | match |
| rea outside PRs #994, #1303, #1382, #1391 merged on 10-07 and 10-10 | all four merge commits present | match |
| `rea:CONTRIBUTING.md:53-57`, a human owner per PR; `:114-117`, extraction in scope | present | match |
| `pi:CONTRIBUTING.md:23-34`, auto-close and `lgtm` | present | match |
| `absurd:.github/PULL_REQUEST_TEMPLATE.md:11`, "under Earendil Inc.'s choice of terms" | present | match |
| `absurd:habitat/internal/config/config.go:15`, `:7890` | `defaultListenAddress = ":7890"` | match |
| `durable:src/storage/sqlite/storage.ts:212-216`, `mintId` counter | `nextId++` at 214-217 | match (off by two lines) |
| `rea:…/analysisErrorProjection.ts:569-576`, `invalid_request` retryable | in `RETRYABLE_CODES` | match |
| absurd: 285 of 313 commits by one author; pi-durable: 128 of 175 in the window; rea: 12 releases 10-05 to 10-18 | 285/313; 128/175; 4.0.0 to 6.7.0 = 12 | match |

**Evidence summary.** 31 citations checked: 29 match, and 2 are the same minor slip (18 router rows, not 19) in A and C. I found no fabricated citation.

## 2. Consistency across the four

- **Gap IDs.** All four use the [gaps.md](../gaps.md) IDs and answer X-1, X-2 and N-1 in §6.
- **Owner-decision numbering.** A, C and D use the judge's §4 numbers. B renumbers (see §1). Because `06-options.md` does not exist yet, every file refers to my list. The moderator should fix one numbering in 06.
- **S-2 v1 cap** (the record plus two IDs, N-2). A and C name the two IDs as ProbeKey and ObservationId, and keep FindingKey as an extension. D proposes the same cap upstream (R-11). **B states the cap but builds its verdict on FindingKey,** so B's core depends on an extension the cap excludes. B should say so, and version FindingKey as a required extension *for B*. Otherwise N-2 is broken in practice.
- **Guardrails:**
  - **Sanctioned delegation only:** A, B and D comply. C does not touch accounts.
  - **pi-ai Claude OAuth excluded:** A, B and C do not use pi-ai. D's tier 2 does, behind an allowlist guard (row 8). One correction to D: pi-ai checks `ANTHROPIC_OAUTH_TOKEN` *before* `ANTHROPIC_API_KEY` (`ai:src/providers/anthropic.ts:43`). So "ignore the variable" has to be done by supplying a filtered `ctx.env`, and not only by checking keys.
  - **No credential-store reading:** A states it explicitly; the others never read one.
  - **No rotation:** A states it; B, C and D are silent but rotate nothing.
  - **Approvals on:** A, B (the summary agent is read-only) and C (the person's own client) comply. **D's tier 3 runs agents unattended** with foreign-code and device tools removed. The charter allows that only as a per-repository loosening *by the person*. D must say that tier 3 needs that opt-in.
  - **Breaches:** none.
- **Two soft flags:**
  - A's row 22 reads the client's local transcripts to estimate spend (a donor pattern). These are not credentials, but they are another application's data. That needs opt-in (PRV-2).
  - B and C mark target-derived text with `origin: target`, but neither one redacts it from reports at source the way A does. Both rate SEC-6 at 2, which is honest.

## 3. Side-by-side matrix

### 3a. Profile and decisive criteria (design-intent; D's PR-conditional levels in brackets)

| | Profile | REL-1 | INT-5 | EPI-4 | PERF-2 | AGT-1 | SEC-8 | AGT-6 | EPI-2 |
|---|---|---|---|---|---|---|---|---|---|
| A | agent-tool | 3h (case only, N-4) | 3h | 3h | 3h | 3h restricted Claude · 2 attach, Codex, skill | 3 container · 2 macOS host | 3h tool side | 3h method |
| B | security-tool | 3 (3h in the variant after the race test) | 3h (normalisers unbuilt) | 3h (census unbuilt) | 3h | 3h (no agent in the gate) | 3h | 3h | 3h method |
| C | security-tool (`uses_llm` set, §1) | 3 verifier · U investigation | 3h | 3h | 3 | 3 verifier · 1–2 agent session | 3 · 2 | NA | **3h, with labels by construction** |
| D | skill-pack + agent-tool (tiers 0–1); agent-harness (tier 2) | 3 | 2 [3] | 2 [3] | 2 [3] | 1 tiers 0–1 · 2 tier 2 | 2 | 3 tier 2 | U |

C's EPI-2 is the one place a candidate earns something the others only promise. Every verified or refuted claim is a label from a producer that did not write the claim, which is exactly the condition gaps.md sets for EPI-2.

### 3b. Cost and reach

| | Owned code (est.) | Maintainers (est.) | Services | Repos used at run time · patterns only | Main donors | Subscription, no API key |
|---|---|---|---|---|---|---|
| A | 10–18k new + 5.7k vendored | 2 + SECURITY owner + labelling | none (container for the enforced lane) | rea, leanrea · pi-durable, absurd (B-2 option) | orca process-host, t3 delegation, strix coverage, caveman handles, laya/my-jev | every model turn, through the person's client; no key anywhere. Restricted launch depends on G-terms; attach does not |
| B | 15–30k + 3k vendored | ~2.5 FTE | none (CI and containers); Postgres in the variant | rea, leanrea · pi-durable (one rule, test kit); absurd only in the variant | orca process-host, worktree and liveness; strix; laya-coreml; sandbox pattern; orca receipts | the gate needs no model. Summaries use a subscription in CI only if the terms allow; otherwise an allowlisted key |
| C | 7–10k incl. ~3k vendored | 1 + fixture help | none (container) | rea, leanrea · pi-durable kit shape; **absurd unused** | strix closure and coverage; laya/my-jev; t3 envelope; orca process-host | the verifier holds no model and no credentials; the agent uses whatever the person already has |
| D | 1.2–2k glue + about 25 upstream PRs | 0.25 FTE + 0.5 FTE for 3 months + upstream review | none (tiers 0–2); Postgres (tier 3) | **all four** | none beyond the leanrea harness | tiers 0–1 through the person's client; tier 2 on keys (Mode A unproven); tier 3 on keys or per terms |

**Finding for the charter question.** In their defaults, A, B and C run only rea and leanrea code, plus donors. pi-durable and absurd contribute patterns and test kits, not runtime. Only D uses all four repositories at run time. The owner should read "combine the four" with that in mind: the architects, writing independently, all found that the two durability engines are not needed as engines.

### 3c. Critical gaps, margin, trends, kill criterion

| | X-1 · X-2 · N-1 | Margin over S-1 · does an upstream change erase it? | Sensitivity to 2030–35 trends (better models · CRA · agents as callers) | Top kill criterion |
|---|---|---|---|---|
| A | ProbeKey + ObservationId (paper) · enforced only in restricted launch; attach mode says "unenforced" · OS lock at open, 1,000-open test | One commit per probe (step, Evidence, unknown). **Partly.** Erased by an upstream rea log that is transactional per call *and* keyed by an input-derived ProbeKey. D's R-3 as written (replayed by Evidence ID) would **not** erase it | Hurt: value moves to checking answers, and clients may ship their own durability. Must state its own CRA position. Best fit: small catalog, bounded results | Kill at step k against S-1 tier 2: ≤1 repeated probe and 0 lost unknowns → fold into D |
| B | All three keys; FindingKey normalisers unbuilt (L) · no agent in the gate; the summary job has no shell · one writer per bundle, `-<attempt>` files | Verdict by FindingKey plus fail-closed census. **Partly:** the census goes upstream with R-4; the normalisers are B's own and D does not propose them | Neutral to good: a model-free verdict survives better models. Most exposed to the CRA, because it sells release evidence. Agents matter little | K1: any exit 0 on a seeded capability change. K8: within 5 points of S-1 tier 3 → fold into D |
| C | Two keys; `/in/<sha256>` hides the path defect · verifier side has no model and typed slots; the agent side is unenforced · no store, content-named atomic files | Independent, model-free re-run of every `seen` claim. **Mostly**, by a rea `verify_claims` tool. What remains: checking with an implementation other than the producer's, and nothing in the agent's path | Helped: more claims, better structured output. Countered if models stop making presence errors. Its CRA value is "independent re-run" | K1: fewer than 50% of `seen` claims map to a covered probe |
| D | Depends on R-2 · measured, not enforced · lock until P-1 | Is S-1, built and measured; adds the key guard and the open lock. **Not applicable**; its upstream PRs are what erode A and B | Helped: Tier 0 improves for free. CRA duties stay with the parents, so D cannot give users CRA evidence | rea declines ≥2 of R-2, R-3 and R-4 within 90 days → D becomes A or B |

**A conflict to adjudicate.** D's §9 says the one-transaction capability can never come from upstream ("it needs one owner of both records"). A, and my round-2 caveat, say it can.
- **Both are partly right.** In tier 1 the official client is the host, so rea's own log could own both the step and its Evidence. That works only if rea's log keys entries by an input-derived ProbeKey.
- So the precise statement is: A's margin survives R-3 as D wrote it, and disappears under R-3 plus ProbeKey.

## 4. Are they distinct, and which combinations hold together

**A, B, C and D are distinct in their main user and their single capability:**
- A: an interactive investigation that survives;
- B: a CI verdict across versions;
- C: an after-the-fact check of claims;
- D: no new runtime.

**They share a large core.** A, B and C share the S-2 v1 library, ProbeKey and ObservationId, the router pack plus `reach.json`, Orca's process-host, the Linux container profile, and the same single-writer SQLite pattern (A per case, B per artifact). That shared core is roughly half of each one's owned code (inferred from their §11 tables).

| Combination | Coherent? | Why |
|---|---|---|
| D as phase 0 of any other | **yes** | Every kill test (A1, B K8, C K6) needs D's built null arm (N-12). D's PRs shrink what A, B and C vendor. The cost: if the PRs land, they shrink A's and B's margins. That is the purpose of running D first |
| C as a mode of B | **yes** | The same model-free runner, pack, container, CI consumer and absence of any shared store. "Verify the agent's claims" and "diff two versions" are two inputs to one probe engine |
| C as a mode of A | **as an add-on only** | A's runner already writes `observed` Evidence, so C adds little there. Folding C into A removes C's main selling point, which is that nothing sits in the agent's path |
| A and B as one product | **one core, two front ends; not one binary** | The users, trust models (approvals against unattended) and gap profiles (taint UI against normalisers) differ. One binary would double the surface again (the N-5 lesson) |
| B's variant after D's tier 3 | **yes** | D's tier 3 is exactly B's baseline arm. The fence PR (A-1) feeds B's variant |
| A with B-2 and several workers | **no** | It contradicts A's single-writer store and N-1 |
| C with durable investigations | **no** | Having no store is C's design |
| "D with forks" | **no** | D's fallback when a PR is declined is to *become* A or B. A D that forks is A or B without saying so |

## 5. Recommendation and the strongest dissent

**Recommendation.** Do D first, as a bounded phase:
- build tier 2 and its kill test, the key guard and the open lock;
- file the core rea PRs (R-2, R-3, R-4, R-6) with a named human owner;
- run X-9 with the replacement decision rule.

In the same phase, build **C on B's runner core.** That means one model-free probe engine with the router pack, `reach.json` and the container profile, used two ways: as C's claim verifier, and as the measuring instrument for "correct-and-verified claims per dollar" (N-9). Decide on A or B's version gate only on the measured outcomes.

**Reasons:**
1. **Every margin in A and B is partly erasable by upstream changes,** and D is the only route that tests that cheaply.
2. **C is the smallest owned surface** (1 maintainer, no store, no credentials, no dependence on G-terms) and the most robust to better models.
3. **C supplies what EPI-2 and N-9 both need:** labels from a producer that is not the claim's author.
4. **The shared engine is the common core of B and C,** so the work is not lost if B follows.
5. **A carries the most interacting risks:** attach mode unenforced, approval fatigue, a narrowed REL-1, vendor durability as a trend, and a margin that depends on how R-3 is designed.

**Strongest dissent.**
- **It answers a different question.** This plan answers verification, not the charter's question of "a combined product worth more than the parts".
- **It uses two of the four repositories,** and it drops framing job 1 (investigations that survive). Framing §4 says durability is expected of any agent run longer than a few minutes, and only A delivers it for the main user: an agent in a coding or security session.
- **It depends on others:** on agents emitting claims files (C's K5), and on upstream maintainers with 52–91% single-author concentration who owe the owner nothing.
- **A's capability is the only one of the four** that survives upstream R-3 as proposed. A 90-day wait costs the window before official clients ship tool-side durability of their own.
- **The dissent's alternative:** build A now (restricted launch as the default), with D's null arm in parallel, not as a gate in front of it.

**Owner decisions that flip the recommendation:**

| Decision | Effect |
|---|---|
| The primary user is an interactive analyst or agent, not CI or review | A first; C becomes A's add-on |
| Ownership and speed weighted above capability (D's decision e) | A or B is built directly; D runs only as the null arm |
| Several workers needed (judge #1) | B's variant enters scope; C stays a mode of B |
| The charter requires all four repositories at run time | Only D satisfies it |
| rea declines the core PRs, or does not answer within the window | D becomes A or B, by user |
| Provider terms forbid driving the client (G-terms) | Affects A's restricted launch only; the recommendation does not change |
