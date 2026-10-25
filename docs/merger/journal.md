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
