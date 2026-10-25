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
