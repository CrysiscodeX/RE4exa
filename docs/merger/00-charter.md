# 00 Charter: how this brainstorm is run

## Question

Is there a product that combines the following four repositories and is worth more than they are when used side by side? If there is, what would it be, what could it do, who would use it, how would it fit with other tools, and where would it be weak?

- **leanrea:** a thin skill for analysing software artifacts.
- **rea:** an MCP server for artifact analysis with an evidence ledger.
- **pi `packages/durable`:** a durable agent harness on SQLite.
- **absurd:** a durable workflow engine on Postgres.

This phase ends with **3 or 4 standalone candidate concepts**. Each comes with its trade-offs and an anatomy of its capabilities. The owner picks one before any build planning starts. This phase writes no code and no build plan.

## Inputs and exclusions

- **Core:** the four repositories at the commits listed in [sources.md](sources.md).
- **Donors:** parts of the other ten reviewed repositories are added where they fit, for example:
  - Orca's parallel workers.
  - T3 Code's sign-in that delegates to the person's own provider account, so integrated clients use subscription credits instead of API keys.
- **Evaluations used as evidence:** the RQS-2030 reviews in [`research/rqs-review/`](../../research/rqs-review/) and the extraction notes in [`research/extraction/orca-t3code.md`](../../research/extraction/orca-t3code.md).
  - A review finding counts only after it has been checked against the source.
  - A finding that cannot be checked is marked *unconfirmed*.
- **Excluded (clean slate):** RE4exa's own merge prototypes and designs. Participants do not read them:
  - `tools/rex/`
  - `prototypes/`
  - `research/dissection/`
  - `research/rea-self-analysis/`

## Evidence rules

1. Every statement about a repository cites `repo:path:line` at its pinned commit.
2. Every statement is labelled with one of:
   - **seen**: read in the code or docs;
   - **inferred**: reasoned from what was seen;
   - **unknown**.
3. A number is quoted only with its source. Estimates are marked as estimates.
4. The moderator spot-checks citations after each layer and records the result in [journal.md](journal.md).

## Roles

Each role is a separate agent with its own brief, apart from the moderator.

| Role | Job |
|---|---|
| **Advocate (one per repo):** A-rea, A-leanrea, A-durable, A-absurd | Reads its own repository. Argues for what it should contribute, and states honestly what it should not |
| **Donor scout** | Reads the other ten reviews, the Orca and T3 Code clones and the extraction notes. Nominates parts to transplant |
| **Skeptic** | Attacks every idea: failure modes, overlaps, joins between parts, licences, operations, security, cost, and whether merging is worth it at all |
| **Judge** | Gives provisional RQS-2030 levels with evidence. Applies the 2030–35 horizon criteria. Keeps the debate tied to criteria, not rhetoric |
| **Moderator and scribe** (the main session) | Writes the layers, merges outputs, keeps the journal and the gap register, and records dissent instead of averaging it away |

## Debate rules

- A rebuttal has to cite evidence. "It could be done" is not a rebuttal.
- A weak spot closes in one of three ways only:
  - a **design change**, described;
  - a **scope cut**, stated;
  - **unresolved: owner decision**, carried into the options brief.
- If roles still disagree after round 2, both positions are written down.
- **The null option always stands:** "don't merge; compose the four as they are". Each candidate has to beat it.

## Fixed guardrails (not up for debate)

- **Accounts:** only sanctioned delegation is allowed. That means the provider's official CLI, SDK or ACP sign-in into a separate configuration home per account. Never:
  - read another application's credential store;
  - copy or refresh tokens;
  - call undocumented endpoints while presenting as an official client;
  - rotate accounts automatically to get around limits.
- **Agency:** agents start with approvals on. The person can loosen this per repository.
- **Licences:** a part is marked *lift* only when its licence allows that and the notice can be kept. The parts in [sources.md](sources.md) are MIT or Apache-2.0.
- **Security wording** stays defensive. The documents describe what a design must prevent, not how to defeat it.

## Layers

| # | Layer | File(s) |
|---|---|---|
| 0 | Charter, sources, index | this file, [sources.md](sources.md), [README.md](README.md) |
| 1 | Anatomy: each repository taken apart into "organs" | [01-anatomy/](01-anatomy/) |
| 2 | Framing: users, jobs, the forces of 2030–35, non-goals, success measures | [02-framing.md](02-framing.md) |
| 3 | Divergent ideas | [03-ideas.md](03-ideas.md) |
| 4 | Debate rounds and the gap register | [04-debate/](04-debate/), [gaps.md](gaps.md) |
| 5 | Convergence: 3–4 candidates | [05-candidates/](05-candidates/) |
| 6 | Options brief, where the phase stops | [06-options.md](06-options.md) |
| — | Journal of thoughts and decisions along the way | [journal.md](journal.md) |

## Organ record (used in layer 1 and in every candidate)

| Field | Meaning |
|---|---|
| Organ | A named part with one job |
| Function | What it does, with citations |
| Interfaces | CLI, MCP, SDK, schema, files, network |
| State and lifecycle | What it owns, how it starts, stops, retries and recovers |
| Depends on | Runtime, services, OS, packages |
| Licence | Licence and notice |
| RQS | The relevant criteria levels from the review, confirmed or *unconfirmed* |
| Carried defects | Known defects that come with it if reused |
| Verdict | **lift** (copy with the notice), **adapt** (copy, then change named parts), **pattern** (rewrite, keeping the idea), **leave** |
