# Journal

The moderator's running notes: what was done, what was thought, and what was decided, and why. Entries are added in order and are not rewritten.

## J-01 Setup (layer 0)

**Owner's choices:**
- Markdown in this repo.
- A multi-agent debate.
- Stop at 3–4 standalone candidates.
- Clean slate: RE4exa's own merge prototypes are not inputs.
- Donors are allowed where they fit, for example subscription sign-in through the provider's own tooling.

**Clones** were re-made at the reviewed commits. Blob-filtered checkouts:

| Repo | Commit | Size |
|---|---|---|
| rea | `b4938ae` | 113 MB |
| leanrea | `09ba4aa` | 0.3 MB |
| pi | `fdce48e` | 51 MB |
| absurd | `3cfc64f` | 9 MB |

The orca and t3code clones from the extraction study are kept as donors.

**Licences checked:**
- rea, leanrea, pi, orca and t3code are MIT.
- absurd is Apache-2.0.
- These are compatible: combining MIT and Apache-2.0 code is fine if the Apache NOTICE and licence text are kept. So licensing is not what decides between the candidates.

**What I expect going in.** I'm writing these down so that later layers can show them wrong:

1. **The four repos sit at two levels.**
   - rea and leanrea are about **what is learned**: analysing artifacts.
   - pi-durable and absurd are about **how work survives**: durable execution.
   - A merger is not four peers. It is a domain layer on top of an execution layer. The interesting design questions are at the join between them.
2. **pi-durable and absurd overlap.** Both are durable step engines, one on SQLite and one on Postgres. Shipping both is a likely weak spot, and "pick one, or one interface with two back ends" is a likely debate.
3. **rea and leanrea are opposites by design.**
   - rea is heavy: about 208 tools and a ~3.16 MB catalog.
   - leanrea is thin: an 8 KB skill.
   - The merged product has to choose where on that spectrum it sits.
4. **The null option is strong.** These pieces may compose well without merging, for example rea run as Absurd steps. A candidate has to show a capability that only exists once they are combined.

I'll check these expectations against the anatomy in layer 1.

## J-02 Layer 1 anatomy returned

Five agents wrote [01-anatomy/](01-anatomy/):

| File | Organs | Lines | Verdict mix |
|---|---|---|---|
| [rea.md](01-anatomy/rea.md) | 20 | 294 | lift: evidence record, residual unknowns, effect audit; adapt: ledger, JS/Electron analysis; most others pull in 90–120 files each, so in practice they are rewrites |
| [leanrea.md](01-anatomy/leanrea.md) | 13 | 213 | adapt: the router table (as data); lift: the trap list; pattern: labels and the budget rules |
| [pi-durable.md](01-anatomy/pi-durable.md) | 17 | 139 | lift/adapt: intent-before-effect tool rule, phase/checkpoint model, crash-loop parking, requestId dedupe, codemode journal, conformance kits; leave: the coding tools |
| [absurd.md](01-anatomy/absurd.md) | 16 | 337 | lift: task/run/checkpoint state machine, claim and lease, events and sleeps, fake clock; leave: habitat, the Python and Go SDKs |
| [donors.md](01-anatomy/donors.md) | 26 donor rows | 174 | Orca 8, T3 Code 6, others 12; plus a list of rejected parts |

**Spot checks.** I compared 14 citations against the clones. All 14 matched.

| Repo | Citations checked |
|---|---|
| leanrea | `SKILL.md` is 66 lines and 8,374 bytes; `:11`, `:14-18`, `:23` |
| rea | `artifactCommands.ts:199-201` (integrity policy defaults to "fail"); `EvidenceLedger.ts:44-47` (three in-memory Maps) |
| pi-durable | `harness/tool.ts:173-196` (replay only if both policies are "safe"); `sqlite/storage.ts` `mintId` uses a counter cached when the store opens |
| absurd | `absurd.sql` is 3,158 lines; `SKIP LOCKED` at :997 and :1026; a claim timeout of 0 or less means no lease (:937-947); `docs/patterns/pi-ai-agent.md:19-20` imports `@mariozechner/*` |
| donors | agent-sandbox-lockdown `README.md:61`; PandaCode `LICENSE:15-21`; caveman `HONEST-NUMBERS.md:16` |

**My layer-0 expectations, checked:**

1. *Two levels: knowledge and survival.* Confirmed. No organ crosses the boundary. The only place they touch is rea's ledger, which needs a durable backing log that rea does not have.
2. *pi-durable and absurd overlap.* Confirmed, and the overlap is large. They differ exactly here:
   - absurd: multi-worker leases on shared Postgres, and enqueueing inside the caller's transaction.
   - pi-durable: an intent record before every effect, replay policies, crash-loop parking, embedded SQLite, and agent concepts.

   Both advocates, writing independently, recommend joining them through an adapter rather than merging the code. One owner decision falls out of this: **will the product ever need more than one worker process?**
3. *rea and leanrea are opposites.* Only partly right, and I am revising it:
   - rea's default catalog is 3,211,385 bytes, measured at b4938ae. Output schemas are 74.7% of that. With compact schemas it drops to 222,396 bytes.
   - With tool loading on demand, rea's idle context cost is about 3.5k tokens, against leanrea's 3.1k.
   - leanrea's benchmark shows that the REA arm's extra cost came mostly from large results and a long skill text, not from slow tools. Only 17 of 112 tool calls in that arm were REA tools.
   - So the real axis is not *heavy versus thin*. It is **how much an answer costs to produce and read**: result size, turns, and whether a cheap path is tried first.
4. *The null option is strong.* Still true, and stronger now. Composing pi-durable with rea's evidence record looks feasible without merging anything (inferred).

**New facts that change the debate:**

- **Guardrail hit (pi-ai).** pi-ai's Claude subscription sign-in presents as Claude Code: a `claude-cli` user agent, `x-app: cli`, and a hard-coded client id with the `user:sessions:claude_code` scope. This breaks the account guardrail, so that path is **leave**.
  - Any "use account credits" capability has to come from T3's delegation pattern instead: drive the official `codex app-server`, the Claude Agent SDK, or ACP `authenticate`.
  - Whether each provider's terms allow a third-party product to drive its official tool on a subscription login is **unknown**. It goes to the owner as an open question.
- **Durability holes in both engines:**
  - **pi-durable:** two processes on one store can silently overwrite each other's records. The requestId dedupe holds for a single writer only.
  - **absurd:** a lease that has expired but not yet been swept still accepts writes, and a timeout of 0 removes the lease entirely.

  Neither engine is safe to adopt as it stands. A merged engine has to fix both.
- **rea's evidence IDs depend on file paths.** The top-level ID drops the path, but child evidence embeds `local_path`. So the same bytes at a different path get a different composite ID. This weakens the content-addressing claim.
- **Coverage overclaims.** rea reported coverage as "complete" on a package where it had missed the `new URL(..., import.meta.url)` worker edge. A coverage record has to say which loading forms were checked, not only which files.
- **Benchmark evidence is thin.** leanrea's totals reproduce, but the sample is 12 paired cells. Against a plain model with Bash and no skill, the wall-time ratio is 0.81 [0.62, 1.04]. Only "fewer turns" is a clear effect.
- **Donor evidence is modest.** caveman's measured output gain over "Answer concisely." is 3% (n=10). strix does not replay its proofs of concept; verify-by-replay would have to be built.
- **Licences.** PandaCode's licence requires a visible "fork of PandaCode" notice, and agent-sandbox-lockdown has no LICENSE file. Both are therefore **pattern only**.

**Housekeeping.** The donor scout added eight blob-filtered donor clones to `GitHub_Repos_Dump`. The rea advocate built a copy of rea in the scratchpad. All of these are deleted at the end of the phase.

## J-03 Layer 3: ten ideas, five families

The cards are summarized in [03-ideas.md](03-ideas.md). Each advocate came back after its anatomy pass, so it kept the context of its own repository. The skeptic was a fresh agent.

**What changed my view.**
- I expected the four advocates to defend their own repositories' surfaces. They didn't. All four built their cards around **rea's Evidence record**.
- Nobody proposed rea's 208-tool catalog as the value. I read this as convergence, not as bias from a shared prompt, because:
  - the prompts asked each advocate to centre its card on its *own* repository;
  - the absurd and durable advocates still chose rea's record as their payload.
- **Model-free first pass.** Two advocates arrived at it independently (R-2, L-2). This is the most promising direction so far, because it reframes the cost question. A pass with no model has no token cost. The cost comparison with leanrea then applies only to the residual questions.

**Families.** I grouped the ten cards into five families. Families A (durable record, single node) and B (fleet/CI) are the strongest seeds for candidates. C (long-lived work) and D (effects gateway) may be features, not products. E (null option and spec) holds the baselines every candidate has to beat.

**Moderator decision (method, not product).** Layer 4 tests every card against the skeptic's ten questions, not only the families. Clustering too early would hide weak cards inside strong families.

## J-04 Debate round 1: attack and scoring

The files are [round-1-skeptic.md](04-debate/round-1-skeptic.md) (237 lines) and [round-1-judge.md](04-debate/round-1-judge.md) (257 lines).

**Spot checks.** I checked three of the skeptic's critical claims against the clones, and all three hold.

1. **The rea Evidence ID is a hash of the semantic projection** (`rea:src/domain/evidence.ts:251-278`). The projection includes `raw_result`, `normalized_result` and `environment`. So the ID is known only after the probe runs. It changes when output varies between runs, and it changes between hosts.
2. **pi-durable tools take a `models` object from `HarnessOptions`** (`durable:src/harness/types.ts:217-218`). Its `commit` belongs to the tool runtime (`:243`). It is not shared with the tool's result.
3. **absurd events are cached and the first emit wins** (`absurd:README.md:160-161`). A reused event name returns the old payload.

**The skeptic and the judge disagree on one point.** I am recording the disagreement here rather than averaging it.
- The judge ranks **D-1 first**, saying it fixes rea's path-dependent IDs on paper.
- The skeptic argues that D-1's step key cannot be the Evidence ID at all (X-1). It also argues that D-1's "same atomic commit" is not in pi-durable's API (W-D1-2).
- Both points are true at the same time. D-1's *intent* is the right one, and its *mechanism* as written does not work. Round 2 has to give a mechanism.

**The skeptic proposed forcing the cards together.** The judge's ranking supports it independently: the judge also proposed merging D-1 with R-1.
- R-1, D-1 and L-1 become a **durable case file**.
- R-2, L-2 and B-1 become a **CI sweep and delta gate**.
- D-2 becomes the effects layer.
- B-2 becomes an option.
- S-2 becomes a mandatory layer.
- S-1 stays as the baseline.

I am not adopting the merge yet. Round 2 gives the advocates a chance to argue against it.

**The judge found systemic gaps that no card fills:**

| Gap | Where every card stands |
|---|---|
| AGT-1, prompt injection | at most 2 |
| SEC-1, threat model | U |
| EPI-2, calibration | U or 2 |
| SEC-6, secrets taken from targets | at most 2 |
| PRV-4 / EVO-4 | No card states its own CRA position or support period. Six of them sell CRA evidence to their users |

Two of the skeptic's cross-card weak spots are critical: **X-1** (output-derived identity) and **X-2** (no enforced untrusted-content boundary).

**Moderator decision (method).** In round 2 each advocate also **owns the resolution of specific cross-card gaps**. Without an owner these would stay everyone's problem and no one's design.

| Advocate | Gaps it owns |
|---|---|
| A-rea | X-1 identity, X-5 importability, X-6 coverage, EPI-2 calibration |
| A-leanrea | X-2 untrusted content and injection evaluation, SEC-1 threat model, X-9 bytes per answer, X-8 platform reach |
| A-durable | X-3 model access versus delegated sign-in, X-7 replay from declared effects, X-10 spend and budget, SEC-6 secret handling |
| A-absurd | X-4 storage split, the lease fence, B-2 event semantics, PRV-4/EVO-4 support period and CRA position |

## J-05 Debate round 2: rebuttals, a spike, and one correction

Files: [round-2-a-rea.md](04-debate/round-2-a-rea.md), [round-2-a-leanrea.md](04-debate/round-2-a-leanrea.md), [round-2-a-durable.md](04-debate/round-2-a-durable.md), [round-2-a-absurd.md](04-debate/round-2-a-absurd.md) and [spikes/pglite/](04-debate/spikes/pglite/).

### Evidence produced this round

The moderator re-ran or checked each item.

- **PGlite spike (absurd advocate).** I re-ran it and got the same results.
  - The unmodified `absurd.sql` runs on embedded PGlite 0.5.8 (PostgreSQL 18.3 in WASM). It covered spawn, claim, checkpoints, lease expiry and reclaim, events, partitioned queues, cleanup, and data surviving a reopen.
  - The proposed lease fence rejects every write from an expired lease that has not yet been swept, with error AB004. A timeout of 0 is rejected with AB005.
  - Sequenced topics fix the misfire caused by a reused event name.
  - This turns J-02's "PGlite unknown" into **seen**: the same schema can be used embedded and shared. Still untested: several processes on one store, the TypeScript SDK on PGlite, and throughput.
- **pi-ai identity (durable advocate).** I checked this. Any key containing `sk-ant-oat`, and any token in `ANTHROPIC_OAUTH_TOKEN`, is sent as `claude-cli` (`ai:src/api/anthropic-messages.ts:1015,1061`; `ai:src/providers/anthropic.ts:43`). An API-key mode therefore needs a guard that refuses these tokens.
- **rea coverage (rea advocate).** "Complete" is only the shape `{status: complete, truncated: false, omitted_count: 0}` (`rea:src/domain/javascript/javascriptApplicationEvidenceSchemas.ts:197-203`). It says nothing about resolution.

### Correction

The rea advocate withdrew its layer-1 claim that rea "missed the `new URL(…, import.meta.url)` worker edge". The fixture had read `worker.js` with `readFile`, which is correctly not counted as a load. `new Worker(new URL(...))` does resolve.

The overclaim that still stands: an unresolved `import(p)` after `import.meta.resolve` is reported under coverage "complete". I added a correction note to [01-anatomy/rea.md](01-anatomy/rea.md). I left the earlier entries in J-02, the idea cards and the pre-mortem as they were, because the point they make still holds: "complete" can be false. Only the example changes.

### Where the advocates now converge

All four advocates accepted both forced merges, each with amendments:
1. **Durable case file.** The person's official client (Claude SDK or CLI, codex app-server, or ACP) is the host. The product is an MCP server with its own store. This is the inversion A-durable designed for X-3, and it removes the conflict with pi-ai `Models` in the default mode.
2. **CI sweep and delta gate.** The model-free pass comes first. D-2 is narrowed to an effects and publishing layer.
3. **S-2 becomes a mandatory spec layer.** It carries the three identity keys: ProbeKey before execution, ObservationId as today's ID, and FindingKey stable across versions. It also carries taint origin, redactions, coverage and reach.

### Where they still disagree

| Topic | Positions |
|---|---|
| The case file's store and kernel | A-rea: own SQLite, no pi-durable kernel. A-durable: pi-durable tool tasks. A-absurd: the PGlite schema with the fence. A-leanrea: SQLite by default |

### What I think

- The convergence is real, but it came fast. The same four agents proposed the merges and then accepted them.
- That is why round 2b asks the skeptic to attack the convergence itself and to sketch "outsider" candidates. Without that, layer 5 would hold two variants of one idea plus the null option. That is not the 3–4 truly different options the owner asked for.

## J-06 Round 2b and the choice of four candidates

**Inputs:** [round-2-skeptic.md](04-debate/round-2-skeptic.md), [round-2-judge.md](04-debate/round-2-judge.md) and the consolidated [gaps.md](gaps.md).

**Round 2b produced one measured result.**
- **PGlite does not protect a store from a second process.** When two processes opened the same data directory, committed rows were silently lost in 5 of 8 runs across the skeptic's tests and mine. The script and the results are in [the spike](04-debate/spikes/pglite/README.md).
- In one round the group had gone from "PGlite unknown" (J-02) to "PGlite recommended" (round 2). After a single test of the case the spike had not covered, it was back at "unsafe without an outside lock".
- The lesson for the method: **a recommendation needs the failure-mode test, not only the success path.**

**The judge's caveat, which I take to be the most important finding of the debate so far.**
- The only capabilities the merged families have that composition (S-1) does not are:
  - one commit per probe;
  - finding keys that survive a version change.
- Both are changes to rea's own records.
- If rea accepted them upstream, S-1 would get them too. The margin would then be **ownership and speed**, a maintenance argument, not a capability one.
- The owner has to see this plainly.

**The convergence, attacked.**
- **Why the agreement is not convincing on its own:**
  - Part of it comes from the method, because every advocate could only share rea's Evidence record.
  - None of it rests on evidence from users.
- **Two outside candidates** that do not share those assumptions:
  - **O-1, upstream-first:** no new product.
  - **O-2, verify after the fact:** a checker with no model that re-runs each claim.

**Decision (moderator, on method): the four candidates for layer 5**

Each is meant to stand on its own and be clearly different from the others.

| # | Candidate | From | Main user | Store (one per candidate; rule N-5) |
|---|---|---|---|---|
| A | **Case File**: a local, durable investigation server, run by the person's official agent client | R-1 + D-1 + L-1 (policy) + B-2 (option) | Agent or analyst, interactive | **Own SQLite**, one transaction per probe, with an exclusive lock when the store is opened. The judge rated it best on atomicity and on churn. PGlite is held back by N-1. The pi-durable kernel needs two commits per call |
| B | **Release Delta Gate**: an unattended, model-free CI sweep with a version-to-version gate | R-2 + L-2 + B-1 + D-2 (publishing) | Platform and supply-chain teams, CI | **SQLite bundle per artifact**, merged into the run report. The multi-worker variant (absurd + fence on Postgres) is an owner decision that changes the store |
| C | **Claim Verifier**: the agent works freely; a verifier with no model re-runs each `seen` claim | O-2 + S-2 + L-2's router as probes | Reviewers, CI, auditors receiving agent reports | **None needed.** It outputs a file of S-2 records; verification can simply be run again |
| D | **Compose and contribute upstream**: no new runtime; pinned composition plus upstream changes | S-1 + O-1 | Existing rea and leanrea users | **rea's own ledger** after the proposed append-only-log change is accepted upstream; until then, bundle exports |

**Shared by A, B and C:**
- the **S-2 claim format, v1**, capped at the record plus two IDs (N-2);
- the **router pack** (leanrea's table as data);
- **`reach.json`**.

D contributes the same items upstream instead.

**Donor capabilities, as the owner asked:**
- **T3's sanctioned delegation.** The person's official client and account drive A and C, using subscription credit and no API key held by the product. B uses delegation only for optional summaries; the terms question goes to the owner.
- **Orca's process-host and worktree-per-worker.** These are B's runner, and C's re-run harness.
- **strix's closure discipline:** used in C.
- **my-jev and laya calibration:** used in A and C.

**Writing.** Each candidate goes to a fresh architect agent with a fixed template ([05-candidates/README.md](05-candidates/README.md)). A fresh agent is used so that no advocate writes its own winner. The judge then reviews all four together.

## J-07 Layer 5 and layer 6: candidates reviewed, options brief written

**Candidates.** Four fresh architect agents wrote [A](05-candidates/A-case-file.md), [B](05-candidates/B-delta-gate.md), [C](05-candidates/C-claim-verifier.md) and [D](05-candidates/D-compose-upstream.md) to one template.

**The judge's review** ([review.md](05-candidates/review.md)) checked 31 citations against the clones.
- 29 matched.
- The 2 mismatches were the same slip, a router of 19 rows where the source has 18. I checked the count, which is 18 data rows at `leanrea:SKILL.md:38-55`, and corrected it in the leanrea anatomy and in A and C.
- The review found no breach of the guardrails.

**Two observations the owner should weigh:**
1. **The durability engines are not used at run time.** Four architects worked independently, and in three of the four candidates the durability engines pi-durable and absurd contribute designs and test kits but no runtime code. This has to be said plainly. The charter asked about combining all four repositories. The evidence says the two engines are most valuable as **sources of rules**: intent before effect, leases with a fence, sequenced events, conformance kits. As engines they are less valuable, because both have multi-writer defects that were confirmed in the debate. Only D runs all four, and it does so by not merging them.
2. **"Account credits instead of API keys" is achievable in every candidate.** The person's official client acts as the host. The product calls no model, or the verifier holds no credentials. What stays unknown is whether provider terms allow a third-party product to *launch* that client, or to run it in CI.

**Where the phase stops.** The [options brief](06-options.md) contains:
- the four candidates side by side;
- an anatomy of capabilities across them;
- the trade-offs and combinations that hold together;
- the judge's recommendation, my amendment, and the strongest dissent;
- 14 decisions for the owner.

**My amendment to the judge's recommendation.**
- **The judge recommends** D first, and C built on B's runner. Then choose A or B from the measurements.
- **I add:** start A's restricted-launch spike in parallel *if* the primary user is interactive (decision 1). That is the one cheap test that covers the owner's stated interest in integrated clients that use account credits.

**What was not done in this phase:**
- no code beyond the spike probes;
- no build plan;
- no measurements against the Tier 0 baseline (that is the first task of whatever comes next).
