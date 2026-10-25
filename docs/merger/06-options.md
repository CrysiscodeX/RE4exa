# 06 Options brief: four candidates for the owner to choose from

This is where the strategizing phase stops. Nothing below has been built. Every level is design intent, and every size is an estimate. Each statement links to the layer where it is argued and cited. The decisions the owner has to make are in §8.

## 1. The question, and the short answer

**The question** ([charter](00-charter.md)): is there a product that combines leanrea, rea, pi-durable and absurd and is worth more than using them side by side?

**The short answer from the debate:**

1. **What makes a combination worth considering is rea's Evidence record, not rea's 208 tools.**
   - All eight advocate cards built on the Evidence record, including the absurd and durable advocates' cards ([03-ideas.md](03-ideas.md)).
   - That record needs three fixes before it can carry a product. Its ID is derived from the probe's output (X-1). "Complete" coverage only means "not truncated" (X-6). It has no enforced boundary for untrusted content (X-2).
2. **The two durability engines are useful mostly as designs, not as engines.**
   - Four architects, working independently, ended up with candidates A, B and C running only rea and leanrea code at run time ([review §3b](05-candidates/review.md)).
   - pi-durable and absurd each have a multi-writer defect that was confirmed during the debate. Neither engine is safe to adopt as it stands ([gaps.md](gaps.md): pi-durable's two-owner overwrite, absurd's acceptance of an expired lease, PGlite losing data when two processes open one store, N-1).
3. **Every margin a new product has over "compose the four as they are" can be partly erased by upstream changes to rea.**
   - What is then left is **ownership and speed**, not capability ([round-2-judge §3](04-debate/round-2-judge.md), [review §3c](05-candidates/review.md)).
   - The one exception is A's one-commit-per-probe. It survives unless rea also adopts probe keys derived from inputs.
4. **Using account credits instead of API keys works in every candidate, when the person's own official client is the host.**
   - That client is the Claude SDK or CLI, `codex app-server`, or an ACP agent (T3 Code's pattern: [donors.md](01-anatomy/donors.md), [round-2-a-durable X-3](04-debate/round-2-a-durable.md)).
   - pi-ai's built-in Claude subscription login presents itself as Claude Code. It is excluded.
   - Whether provider terms allow a third-party product to *launch* the official client, or to run it in CI, is **unknown** (decision 6).

## 2. The four candidates

| | **A Case File** | **B Release Delta Gate** | **C Claim Verifier** | **D Compose and contribute upstream** |
|---|---|---|---|---|
| Thesis | A local investigation server, run by the person's official agent client. Each probe commits its step, Evidence and unknown in one transaction, so a case survives crashes and can be resumed | An unattended CI sweep with no model, for every new version of a dependency, extension or app. It gives a verdict that survives the version change and fails closed on coverage it did not resolve | The agent works freely. A verifier with no model re-runs each `seen` claim with pinned probes and marks it verified, refuted or unverifiable, with a record of what was not examined | No new runtime. A pinned composition in four tiers, which is also the baseline every other candidate is measured against, plus about 25 upstream PRs that fix the measured defects for everyone |
| Main user | An agent or analyst, interactive | Platform and supply-chain teams, CI | Reviewers, CI and auditors who receive agent reports | Existing rea and leanrea users |
| Its one capability | One commit per probe | A finding key that survives versions, plus a fail-closed census | An independent re-run of every claim | Nothing new; it measures and improves the parents |
| Repos run at run time | rea, leanrea | rea, leanrea (absurd only in the multi-worker variant) | rea, leanrea | **all four** |
| Store | own SQLite per case, locked at open | SQLite bundle per artifact (Postgres + fence in the variant) | none | rea's own (after PR), bundles until then |
| Owned code, est. | 10–18k new + 5.7k vendored | 15–30k + 3k vendored | 7–10k incl. ~3k vendored | 1.2–2k glue + PRs |
| Maintainers, est. | 2 + SECURITY owner | ~2.5 FTE | 1 | 0.25 FTE, plus 0.5 FTE for 3 months |
| Services | none | none (Postgres in the variant) | none | none (Postgres in tier 3) |
| Subscription, no API key | Every model turn, through the person's client | Not needed; the gate calls no model. Summaries only if the terms allow | The verifier holds no credentials; the agent uses whatever the person already has | Tiers 0–1 yes; tier 2 on keys (the Mode A recorder is unproven) |
| Main kill criterion | At most 1 repeated probe against the S-1 tier 2 baseline → fold into D | Any exit 0 on a seeded capability change; within 5 points of tier 3 → fold into D | Fewer than 50% of `seen` claims map to a probe | rea declines 2 or more core PRs within 90 days → becomes A or B |
| Full file | [A-case-file.md](05-candidates/A-case-file.md) | [B-delta-gate.md](05-candidates/B-delta-gate.md) | [C-claim-verifier.md](05-candidates/C-claim-verifier.md) | [D-compose-upstream.md](05-candidates/D-compose-upstream.md) |

## 3. Anatomy of capabilities across the candidates

● = core to the candidate; ○ = optional or partial; — = not used. Each row names the organ it is transplanted from, or "new".

| Capability | Source organ | A | B | C | D |
|---|---|---|---|---|---|
| Claim record (S-2 v1: record + ProbeKey + ObservationId) | rea O5 Evidence, O7 unknowns (lift, rewritten from spec) | ● | ● | ● | ○ via PR |
| FindingKey stable across versions | new (normalisers, L) | — | ● | — | — |
| Coverage census ("complete" only when nothing is unresolved) | new, on rea O11 AST | ○ | ● | ● | ○ via PR |
| Router pack as data plus `reach.json` | leanrea L5–L7 (adapt) | ● | ● | ● (as probes) | ○ via PR |
| rea artifact readers and JS/Electron analysis | rea O10, O11 (adapt or depend) | ● | ● | ● | ● |
| Cheap-first escalation ladder | leanrea L-1 policy (new rule) | ● | ○ | — | ○ prose |
| One transaction per probe, lock at open | pi-durable intent rule (pattern) + new | ● | ○ per bundle | — | — |
| Lease fence, sequenced topics | absurd O3, O5 + spike fixes (adapt) | ○ (B-2 option) | ○ variant | — | ○ via PR |
| Isolated runner (container per attempt, process-host) | Orca process-host, worktree (lift or adapt); sandbox pattern | ○ enforced lane | ● | ● | — |
| Delegated sign-in through the official client | T3 Code providers (pattern) | ● | ○ summaries | ○ (agent side) | ● tiers 0–1 |
| Untrusted-content taint gate | rea O3 effect audit + T3 envelope + new | ● | ○ | ● (verifier side) | — |
| Redaction at source | new (SEC-6) | ● | ● | ● | — |
| Budgets and a resent-request record | pi-durable organ 7 (pattern) | ● | ○ | — | ○ tier 2 |
| Calibration report | my-jev, laya (pattern) | ● | ○ | ● (labels by construction) | — |
| Independent claim re-run | strix closure (pattern) + new | ○ add-on | ○ mode | ● | — |
| Version-to-version verdict | rea `compare_application_versions` (adapt) | — | ● | — | — |
| Null-arm baseline (S-1 tier 2) | pi MCP client + pi-durable (compose) | test | test | test | ● |

**What the four share:** the claim record, the router pack, `reach.json`, the isolated runner and redaction. That is roughly half of A, B and C's owned code ([review §4](05-candidates/review.md)). Whichever candidate is chosen, that core gets built.

## 4. Trade-offs

| | Strongest point | Weakest point | Hurt or helped by 2030–35 trends |
|---|---|---|---|
| A | The only candidate that delivers framing job 1, investigations that survive, for the main user (an agent in a session). It runs on the person's own account | The most interacting risks: attach mode is unenforced; approval fatigue (N-3); durability covers the tool side only (N-4); its margin depends on what rea does upstream | Hurt if official clients ship their own tool-side durability, and as value shifts from producing answers to checking them |
| B | A model-free verdict that survives better models; fits CRA-era release evidence; no agent in the gate | Until the census exists it can only report, not block; the largest owned code; the most exposed to its own CRA duties | Neutral to good |
| C | The smallest surface; no store and no credentials; the only real EPI-2 labels (the checker is not the producer) | Only claims that map to a probe can be checked (an estimated 45–70%); relies on agents emitting claims; uses two of the four repos | Helped as models write more structured claims; weakened if models stop making presence errors |
| D | No owned runtime; improves the parents for everyone; builds the baseline every other candidate needs (N-12) | Depends on maintainers who owe nothing (52–91% single-author concentration); no atomic join between rea and pi-durable; no enforced taint boundary in tiers 0–1 | Helped: Tier 0 improves for free. Cannot offer users CRA evidence of its own |

## 5. Findings the owner should know regardless of the choice

- **Nothing is measured yet against the simplest baseline:** a strong model, Bash and leanrea's 8 KB skill (Tier 0).
  - leanrea's own benchmark has only 12 paired cells.
  - The proposed decision rule was rejected because it passed by construction. The replacement is correct-and-verified claims per dollar against Tier 0 ([gaps.md](gaps.md) X-9).
  - Any candidate can still lose to the null option.
- **Two results came from runs during the debate, not from reading code:**
  1. absurd's SQL runs embedded on PGlite, and the proposed lease fence works.
  2. PGlite loses committed rows when two processes open one store (5 of 8 runs).

  Both are recorded in [spikes/pglite](04-debate/spikes/pglite/README.md).
- **Corrections made along the way:**
  - The rea advocate withdrew its "missed worker edge" example ([journal J-05](journal.md)).
  - The judge withdrew a round-1 credit it had given D-1 ([round-2-judge](04-debate/round-2-judge.md)).
  - The router row count was corrected from 19 to 18.
- **Upstream conditions found in the clones:**
  - absurd's PR template grants Earendil Inc. reuse "under Earendil Inc.'s choice of terms".
  - pi-durable states "no cross-process locking" by design (`pi:packages/durable/README.md:783`).
  - pi auto-closes PRs from new contributors until a maintainer replies.
- **Open corrections to the candidate files** (from [review §1–2](05-candidates/review.md)):
  - A must say which of attach mode and restricted launch is the default.
  - C must declare `uses_llm`.
  - B's verdict relies on FindingKey, which is outside the S-2 v1 cap. It should be declared as a versioned extension.
  - D's key guard must filter the environment, because pi-ai reads `ANTHROPIC_OAUTH_TOKEN` first.

## 6. Combinations that hold together

These come from [review §4](05-candidates/review.md).

- **D as phase 0 of any other candidate:** coherent. Every kill test needs D's baseline, and D's PRs shrink what the others vendor.
- **C as a mode of B:** coherent. Both use the same model-free probe engine. "Verify claims" and "diff two versions" are two inputs to it.
- **A and B as one core with two front ends:** coherent. As one binary they are not.
- **Not coherent:**
  - A with several workers;
  - C with durable investigations;
  - D with forks (that is A or B by another name).

## 7. Moderator's recommendation and the strongest dissent

**The judge recommends** ([review §5](05-candidates/review.md)):
- First, a bounded **D phase**: build the baseline, the key guard and the lock; file the core rea PRs with a named owner; run the cost-per-answer protocol.
- **In the same phase**, build **C on B's runner core**. It is both the verifier and the measuring instrument.
- Choose between A and B only on the measured results.

**My view.** I agree with the sequencing, with one change. You named "integrated clients using account credits instead of API keys" as an opportunity, and A is the candidate that turns it into an interactive product. If the main user is an analyst or agent at work (decision 1), I would start A's restricted-launch spike alongside phase D, not after it. That spike checks that a server killed mid-call settles correctly, and it is cheap. The first real question would then be answered within the same phase.

**The strongest dissent against the judge's recommendation:**
- It answers *verification*, not the charter's question. It uses two of the four repositories at run time. It drops the one job that only A does.
- It waits on upstream maintainers who owe the owner nothing.
- A 90-day wait may cost the window before official clients ship tool-side durability of their own.

## 8. Decisions for the owner

The numbering is new. The judge's and candidates' numbers are given in brackets.

| # | Decision | Options | What it changes |
|---|---|---|---|
| 1 | **Who is the primary user?** | interactive agent or analyst / CI and release teams / reviewers and auditors / existing rea users | Points to A / B / C / D respectively. This flips the recommendation more than any other choice |
| 2 | **Must all four repositories run at run time?** | yes / patterns are enough | Yes leaves only D |
| 3 | **How much weight does owning the code and moving fast get, compared with capability?** [D-e] | own it / contribute upstream first | Owning it means building A or B directly, with D only as the baseline |
| 4 | **One worker process or several?** [J1] | one / several | Several brings in B's Postgres variant (fence, roles, absurd fork, PG14/PG18 matrix) |
| 5 | **Store for A** [J2] | own SQLite / PGlite with an OS lock / pi-durable kernel | Different atomicity and churn. Choosing PGlite waits on the TS SDK and a kill test |
| 6 | **Provider terms**: may a third-party product launch the official client on a subscription, interactively, in CI, or unattended? [J3, G-terms] | to be checked per provider | Affects A's restricted launch and B's summaries. Attach mode and C are unaffected |
| 7 | **Must product mode use a restricted client** (no built-in shell)? [J4] | yes / no | Prompt-injection protection (AGT-1) is 3h if yes, 2 if no. Codex's shell may not be removable |
| 8 | **Platforms in v1** [J5, J6] | Windows declared not covered or required; macOS host-only lane allowed or not | Reach against enforcement (SEC-8) |
| 9 | **The product's own CRA role and support period** [J9] | none (D) / declared role and period | Load-bearing for B. A five-year period means backporting fixes into vendored code |
| 10 | **Keep secret values found in targets?** [J8] | no (fingerprints only) / yes, in the OS keychain | Secret-handling level (SEC-6) |
| 11 | **Upstream engagement** [D-a, b, c] | who owns the PRs, and for how long; accept absurd's contribution grant or not; length of the decline window (90 days proposed) | Whether D can start at all |
| 12 | **Are handovers and multi-week waits a real need?** [J7] | evidence from session logs / no | Turns A's B-2 option on, or cuts it |
| 13 | **Claim intake for C** [C-1, 2, 3] | structured claims only, or also a converter from prose; may CI block on a refuted claim; may per-model calibration be published | C's scope and its risk of laundering inference into evidence |
| 14 | **Keep the rendered skill as an unenforced mode?** [J10] | keep / drop | Wider reach against enforcement |

## 9. What happens after the choice

The next layer would be a build plan for the chosen candidate, or sequence of candidates. It would start with the tests the candidate's kill criteria name, before any feature work:
- the S-1 tier 2 baseline;
- the cost-per-answer protocol;
- the lock and two-process tests;
- the injection tripwire set.

This phase writes none of it.
