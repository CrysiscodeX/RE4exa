# 05 Candidates

There are four standalone candidates. Each file follows the same template so the four can be compared section by section.

| # | Candidate | File |
|---|---|---|
| A | Case File: a local durable investigation server, run by the person's official agent client | [A-case-file.md](A-case-file.md) |
| B | Release Delta Gate: an unattended, model-free CI sweep with a version-to-version gate | [B-delta-gate.md](B-delta-gate.md) |
| C | Claim Verifier: the agent works freely; a verifier with no model re-runs each claim | [C-claim-verifier.md](C-claim-verifier.md) |
| D | Compose and contribute upstream: no new runtime | [D-compose-upstream.md](D-compose-upstream.md) |

The reasons these four were chosen are in [journal J-06](../journal.md). The judge's comparison is in [review.md](review.md).

## Template

1. **Thesis.** One sentence.
2. **Who uses it, and three usage scenarios.** Step by step, including what the user sees.
3. **Anatomy of capabilities.** A table with one row per capability:

   | Column | What goes in it |
   |---|---|
   | Capability | — |
   | Source organ | `01-anatomy/<file>` plus the organ |
   | Verdict | lift, adapt, pattern or new |
   | What must change | — |
   | Licence | — |
   | Gap IDs it addresses | from [gaps.md](../gaps.md) |

   Mark new code as **new**, with an ordinal size (S, M, L).
4. **Integration surfaces.**
   - MCP, CLI and SDK.
   - Storage: exactly one store.
   - **Identity and accounts.** Sanctioned delegation only. State what uses the person's subscription through the official client, and what, if anything, needs an API key.
   - Other tools: SBOM, attestations, CI.
5. **Architecture sketch.** In words or ASCII. Name the trust boundaries.
6. **The three critical gaps.** How this candidate handles X-1 (identity), X-2 (untrusted content) and N-1 (store safety with several processes), including when a gap does not apply.
7. **Other gaps.** Which ones it resolves, which it inherits, and which it makes worse.
8. **Target RQS-2030 levels.** Design intent only: profile, decisive criteria, and the weakest parent's baseline.
9. **What it beats the null option (S-1) on.** Name one capability, and say whether upstream changes would erase it.
10. **Trade-offs and risks.** Include the effect of 2030–35 trends, for example better models, the CRA, and agents as the main callers.
11. **Size.** Owned code (ordinal plus an estimate), upstream dependencies and their churn, and the maintainers needed.
12. **What would prove it wrong.** Concrete, measurable kill criteria.
13. **The owner decisions it depends on.** Taken from [06-options.md](../06-options.md) and the judge's list.
