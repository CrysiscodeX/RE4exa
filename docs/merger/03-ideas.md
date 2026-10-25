# 03 Divergent ideas: 10 concept cards

Each advocate wrote two cards centred on its own repo, using organs from the others and from donors. The skeptic wrote two contrarian cards, one of them the strongest null option, plus a pre-mortem and the test questions for layer 4. The full cards are in [03-ideas/](03-ideas/). The table gives each card's thesis only.

| ID | Name | Thesis (shortened) | Author | Techniques |
|---|---|---|---|---|
| [R-1](03-ideas/a-rea.md) | Case file | The product is the investigation record itself: content-addressed Evidence and tracked unknowns, durable and resumable by anyone. Tools are interchangeable probes that write into it, cheapest first | A-rea | inversion, combination |
| [R-2](03-ideas/a-rea.md) | Release delta gate | For each new version of a package, extension or app, an unattended, model-free diff of declared capabilities. Every line is backed by Evidence and the report says what was not examined. CI can gate on it | A-rea | constraint shift (zero model calls), combination |
| [L-1](03-ideas/a-leanrea.md) | Triage ladder | A recorded ladder: cheap CLI probe, then targeted slice, then heavy parser. Each rung writes Evidence. Moving up a rung is allowed only for a named open unknown within the remaining budget | A-leanrea | combination, donor |
| [L-2](03-ideas/a-leanrea.md) | Model-free first sweep | For known types, a sandboxed runner applies the router table to every artifact with no model. It emits Evidence and a coverage record, and passes only the unclosed questions to a signed-in agent | A-leanrea | inversion, constraint shift, donor |
| [D-1](03-ideas/a-durable.md) | Investigation Log | One investigation is one SQLite file. Each step is an intent-recorded tool task, and its Evidence is committed in the same atomic commit. A kill loses at most the step in flight | A-durable | combination, constraint shift (single file) |
| [D-2](03-ideas/a-durable.md) | Effect Gateway | Only pi-durable's intent-before-effect rule, shipped as an MCP gateway in front of official agent clients. Receipts are kept locally, or under absurd leases for a fleet. Side effects run at most once | A-durable | inversion, constraint shift (agent-only interface), donor |
| [B-1](03-ideas/a-absurd.md) | Fleet ledger | Every finding, unknown and coverage gap is a row committed in the same Postgres transaction as the step that produced it. Many workers share one ledger | A-absurd | combination, donor |
| [B-2](03-ideas/a-absurd.md) | Standing investigations | An investigation is a durable task that can sleep for weeks until a release, a reply or a resolved unknown. Ownership is a lease, so any worker or person can take it over | A-absurd | inversion, constraint shift (one schema, embedded or shared) |
| [S-1](03-ideas/skeptic.md) | Compose, don't merge | Pin the four as they are and add a few hundred lines of glue, in tiers: skill only; plus `rea mcp` in compact mode; plus a pi-durable host (est. 350–600 lines); plus an optional absurd fleet (est. 150–250 lines) | Skeptic | null option |
| [S-2](03-ideas/skeptic.md) | Claim format, not runtime | Unify only how a claim about an artifact is written and checked again: a versioned spec, a reference library and a conformance suite (est. 3–5k lines) | Skeptic | reduction |

## Moderator's clustering

The ten cards fall into five families. One family is a concept in its own right; the rest are features that could join others.

| Family | Cards | Common core | Where they disagree |
|---|---|---|---|
| **A. Durable investigation record, single node** | R-1, D-1, L-1 | rea's Evidence record (O5) and unknown registry (O7), persisted through pi-durable's intent and checkpoint rule | Whether the record or the runtime is the product; whether the ladder (L-1) is a product or a policy |
| **B. Unattended fleet / CI** | R-2, L-2, B-1 | A model-free first pass, Evidence and coverage records, and fan-out under absurd leases | Postgres as the core (B-1) versus a per-artifact SQLite file merged later (S-1 tier 3) |
| **C. Long-lived, handed-over work** | B-2 | Durable sleeps and events, with ownership as a lease | Whether anyone needs investigations that last weeks (not evidenced yet) |
| **D. Effects governance for hosted agents** | D-2 | Intent-before-effect as a gateway, plus receipts | Whether it is an analysis product at all, or a general agent-safety product |
| **E. Not a merged runtime** | S-1, S-2 | Compose or standardize instead of owning code | — |

**What came out of this layer:**

1. **Every one of the eight advocate cards uses rea's Evidence record as its central organ.** Not one uses rea's 208-tool surface as the thing that adds value. The organ that makes a merger worth considering is the claim record, not the tool catalog. S-2 takes this to its end point.
2. **A model-free first pass appears on its own in R-2 and L-2.** This changes the economics. If the first pass needs no model, the leanrea-versus-rea cost argument (pre-mortem cause 1) applies only to the questions left over. It also makes the subscription sign-in a feature for the remaining questions, not something the base product needs.
3. **The storage split runs across families A and B.** Family A wants embedded SQLite; family B wants shared Postgres. This repeats the pi-durable/absurd overlap from J-02. The debate needs to settle whether one schema can serve both: absurd's model on SQLite (rewrite), PGlite (unknown), or one interface with two backends (the test matrix doubles).
4. **No card covers people on the Windows desktop or the macOS desktop.** Every card targets agents, CLI or CI. This is a known gap in framing §2, carried into the debate.
5. **The skeptic checked two new facts in the clones** and I re-checked both:
   - pi ships an MCP client (`pi:packages/mcp`).
   - rea's `package.json` has no `main` or `exports` field.

   So rea's Evidence code cannot be imported as a library today. Every card that "lifts" the Evidence record either vendors the code or depends on an upstream change. That makes test question 9 (ownership) bite.

## Input to layer 4

- The skeptic's **10 test questions** ([skeptic.md §C](03-ideas/skeptic.md)) are put to every card: writers, evidence identity, atomicity, replay side effects, untrusted content, context cost, accounts, reach, ownership, and the capability only a combination has.
- The skeptic's **12-cause pre-mortem** (§B) seeds the gap register. 3 causes are critical, 5 high and 4 medium.
