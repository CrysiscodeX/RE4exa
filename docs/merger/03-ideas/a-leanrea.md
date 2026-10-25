# 03 Ideas: A-leanrea

Two concept cards built around what leanrea brings: a cheap first pass, the router as data, and budgets. Organ references use the form `file › organ (verdict)` and point to [01-anatomy/](../01-anatomy/). Labels: **[seen]**, **[inferred]**, **[unknown]**. Numbers come with their source. Anything forward-looking is **[inferred]** unless it says otherwise.

**Techniques used:** a combination matrix (both cards), inversion (L-2), a constraint shift ("no model in the first pass", L-2) and donor-enabled variants (both cards).

**Inversion, stated once.** What would make leanrea obsolete? Its own benchmark points to the answer. The no-skill model was nearly as good. The wall-time ratio was 0.81 [0.62, 1.04], and only fewer turns is a clear effect (leanrea.md §4; journal J-02) [seen]. So the *knowledge* in the skill is being absorbed into models. Two things are not absorbed: (a) a cheap pass that is **enforced and recorded**, not merely suggested, and (b) the parts of the first pass that need **no model at all**. L-1 builds (a). L-2 builds (b).

**Combination matrix.** The useful pairings are leanrea organ × other organ. A cell marks the card that uses it; "—" means no use.

| leanrea organ × | rea O5 Evidence | rea O7 unknowns | rea O3 effects | pi-durable 6 intent | absurd O2-O4 | orca process-host | strix coverage | laya abstention |
|---|---|---|---|---|---|---|---|---|
| L5 router as data | L-1, L-2 | L-1 | L-1, L-2 | — | — | L-2 | L-2 | L-2 |
| L6 first moves | L-1, L-2 | — | L-2 | L-1 | L-2 | L-1, L-2 | — | — |
| L2 budgets | — | L-1 | — | L-1 | — | L-1, L-2 | — | — |
| L4 labels | L-1, L-2 | L-1 | — | — | — | — | L-2 | L-2 |

Empty cells are pairings I found no use for [inferred]. leanrea's L10 harness is the shared evaluation instrument for both cards, not a product part.

---

## L-1 Triage ladder

**Thesis.** Every investigation climbs a recorded ladder: cheap CLI probe, then targeted slice, then heavy parser. Each rung stores its result as an Evidence record. A climb to the next rung is allowed only against a named open unknown and a remaining budget.

**Users and scenario.** The main user is an agent in a coding or security session, with a person watching (02-framing §2). Scenario: "What does this Electron app send over IPC when the mic turns on?"
1. The agent calls `triage(target)`. The router row for Electron runs the asar inventory under a 30 s / 8 MiB cap.
2. That stores an Evidence record per probe: command, tool version, input sha256, authority `shipped-artifact`, confidence `observed`.
3. It opens unknowns for each question item not yet answered.
4. The agent slices the bundle (rung 2) and closes two unknowns.
5. One unknown stays open: which v2 channel is live. The leanrea benchmark's only miss was this kind of ambiguity (leanrea.md §4) [seen].
6. The agent then calls `escalate(unknown_id)`. That runs rea's JS/Electron analysis on that one question and records why the climb happened.
7. If the session dies, resuming replays the stored probes, not the work.

**Organs used.**

| Organ | From | Role here |
|---|---|---|
| L5 router, L6 first moves, L2 budgets, L4 labels, L7 traps | leanrea.md (adapt / adapt / adapt / pattern / lift) | Rung 1 and 2 commands, budgets as enforced limits, trap text in tool descriptions |
| O5 Evidence record | rea.md (lift, with the nested-path fix) | One record per probe and per escalation |
| O7 residual-unknown registry | rea.md (lift) | The only key that allows escalation |
| O3 effect audit | rea.md (lift) | Effect class on every router row; launch/attach rows need approval |
| O10 readers, O11 JS/Electron analysis; O4 response budget | rea.md (adapt; pattern) | The heavy rung, as a provider not 208 tools; refuse early and return a continuation |
| 6 tool task, 4 phase model, 5 parking; 2 SQLite storage | pi-durable.md (lift / pattern / pattern; adapt) | Each probe is a durable tool task, replayed only if `safe`; local store for ladder and ledger (rea O6, adapt) |
| process-host (donor 1) | donors.md (lift) | Timeout, output cap and tree kill for every probe |
| untrusted envelope (14); restart settlement (26) | donors.md (adapt; pattern) | Probe output reaches the model as data only; unfinished probes marked interrupted after a crash |

**New compared with the null option.** The null option is leanrea's skill, rea's MCP and pi-durable installed side by side. Today the agent decides on its own when to call rea, nothing records why, cheap-probe results are not evidence, and a crash loses rea's in-memory ledger (rea.md O6) [seen]. Genuinely new [inferred]: (1) Cheap probes become first-class Evidence, with input digest and tool version, which leanrea answers lack (leanrea.md L4). (2) Escalation is a recorded decision tied to an unknown. That is checkable, and it makes "cost per answer" measurable per rung. (3) Budgets and caps are enforced by the runner, not by prose (leanrea.md L2). (4) The ledger survives a crash.

None of these needs a new analysis engine.

**Integration surfaces.**
- MCP surface of about 4 tools: `triage`, `probe(row_id)`, `escalate(unknown_id)`, `ledger_view(page)`. Target catalog below 10 KB, against rea's 3,211,385 B default (rea.md §5) [seen for rea; the target is an estimate].
- A SKILL.md rendered from the router data, for hosts without MCP.
- An embeddable library on pi-durable.
- rea consumed as a provider over MCP or as a library.
- No model credentials: the host agent is the official client (charter guardrail).

**2030-35 fit.** Agents are the main callers, and this surface is small (02-framing §4). "Proof of how a result was reached" becomes a per-probe record. Context cost falls because heavy results are fetched only for named unknowns. Local-first: SQLite, no services.

**My top 3 weak spots.**
1. **The overhead may eat the saving.** leanrea's measured gain is mainly fewer turns (leanrea.md §4) [seen]. Recording Evidence and unknowns adds tool calls. A ladder that needs 6 calls where leanrea needed 4 loses the one effect leanrea proved [inferred].
2. **The escalation trigger is a model judgement.** "This unknown cannot be closed cheaply" is decided by the agent. Over-escalation recreates the REA arm's cost. Under-escalation recreates the 74/75 miss. rea's coverage overclaim (journal J-02) shows that "complete" is itself hard to state [seen].
3. **The seams are not ready.** rea O5 IDs change with the path, and pi-durable has single-writer dedupe only (journal J-02) [seen]. Both need fixes before the ledger can be trusted. This is a design change, not a lift.

**What would prove it wrong.**
- Rerun leanrea's harness with three arms (leanrea skill, rea arm, L-1), at least 5 interleaved reps, self-tested keys (donors.md row 20 hygiene), and new tasks that need evidence and resumption.
- L-1 is wrong if its cost per correct answer is more than 1.2× the leanrea arm (threshold is my estimate) without a measured gain in checkable-evidence share or in kill-and-resume loss.
- L-1 is also wrong if agents escalate on more than half of the questions that leanrea answered cheaply.

---

## L-2 Model-free first sweep

**Thesis.** For known artifact types, the first pass needs no model. A sandboxed runner applies the router table to every artifact, emits Evidence and a coverage record, and hands only the questions it could not close to an agent.

**Constraint shift.** There is no model in the first pass, and the run is unattended in CI. **Inversion:** the model was only choosing commands that the table already names (leanrea.md L5, L6) [seen].

**Users and scenario.** The main user is a platform or supply-chain team (02-framing §2). Scenario: every release candidate of 40 desktop apps and 300 npm/Go/Rust artifacts runs through the sweep.
1. Workers claim one artifact each and pick a router row by `file`/magic.
2. They run the first-move inventory (Go `go version -m`, Rust `.dep-v0`, Mach-O imports and entitlements, Electron IPC and fuses) inside an isolated container, with egress denied.
3. They write Evidence, plus a coverage record of what was checked, never looked at, or could not be run.
4. A diff of inventories against the previous release (leanrea.md L7, "diff inventories before code") flags changes such as a new entitlement, a new IPC channel or a new native addon.
5. Only flagged items and low-confidence routes go to an agent. That agent runs on the team's API key, or on a person's subscription only through the official CLI/SDK/ACP sign-in (donors.md rows 9-10). pi-ai's Claude OAuth path is not used (journal J-02).

**Organs used.**

| Organ | From | Role here |
|---|---|---|
| L5 router as data, L6 first moves, L7 traps; L10 harness, L11 sizer | leanrea.md (adapt / adapt / lift; adapt / adapt) | The deterministic sweep program; per-row fixture tests and a catalog-size gate in CI |
| O5 Evidence, O3 effects; measurement record (donor 24) | rea.md (lift / lift); donors.md (pattern) | Output format with tool versions and input digests; launch/attach rows disabled when unattended |
| O10 readers | rea.md (adapt) | Hardened ZIP/ASAR/DMG extraction with a decompression budget, used in place of raw `asar extract` (leanrea.md §3: no integrity check) |
| O2 state machine, O3 claim/lease, O4 events | absurd.md (lift / lift with fixes / lift) | Fan-out across workers and hosts. A single-worker SQLite mode is an owner decision (journal J-02) |
| 16 conformance kits | pi-durable.md (adapt) | Kill-at-step-k tests for the sweep store |
| process-host (1), mutation receipts (4) | donors.md (lift / adapt) | Bounded probes; retried steps do not repeat effects |
| isolation layout (21) | donors.md (pattern; no licence file) | Container with no network, read-only and no capabilities, for extractors (leanrea.md §3 gap) |
| coverage.json (18); abstention kernel (22) | donors.md (adapt; adapt) | "Unexamined" kept apart from "clean"; low route confidence goes to an agent, not a guess |

**New compared with the null option.** The null option is a shell loop over leanrea's commands, with rea run by hand on hits. Genuinely new [inferred]: (1) Router rows are versioned, tested data with effect classes. leanrea has none of this, and its commands are macOS-only, unquoted and unpinned (leanrea.md L5, L6, L9) [seen]. (2) Extraction is hardened and isolated by default. (3) Coverage and abstention are explicit, so "nothing found" never means "clean". (4) Inventory diffs across releases are Evidence-backed. (5) Model tokens are spent only on residue.

**Integration surfaces.**
- CLI `sweep <paths|manifest>` and a CI action.
- Output as an Evidence bundle plus `coverage.json`, both open formats.
- A queue: absurd on Postgres, or a local single-worker store.
- Escalation hands an agent the same small MCP surface as L-1.
- The router pack is consumable by rea and other tools.

**2030-35 fit.** Evidence for the CRA and SBOMs: per-release inventories with digests and declared non-coverage (02-framing §4). Context cost close to zero for the bulk of artifacts. Format reach can be stated row by row, including what is not covered.

**My top 3 weak spots.**
1. **Inventories are not answers.** The benchmark's hard tasks needed reading disassembly (the "deep" task), which a fixed command cannot do (leanrea.md §4) [seen]. The share of real questions that a model-free pass closes is **unknown**, and it may be small.
2. **Overlap with existing scanners.** SBOM and composition tools already inventory Go, Rust and npm dependencies. The new value may shrink to entitlements, IPC and native-addon diffs [inferred; not compared in layer 1].
3. **Isolation and operations are expensive.** The sandbox donor is pattern-only (no licence), absurd's lease defects must be fixed first (absurd.md O3) [seen], and Postgres becomes required for multi-host runs. Running untrusted parsers at fleet scale makes any isolation gap a real exposure.

**What would prove it wrong.**
- On a fixed corpus (for example 50 artifacts × 2 releases), with standard questions per type (versions, dependencies, entitlements, IPC surface, native addons) and self-tested keys, L-2 is wrong if:
  - the sweep closes fewer than half of the questions without a model, or
  - an existing SBOM scanner plus a plain agent matches its closed-question rate and cost (thresholds are my estimate).
- L-2 is also wrong if any row shows a parser escape from the container in fuzzing.
