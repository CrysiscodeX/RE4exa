# 04 Debate, round 1: the skeptic

Role: Skeptic. Inputs: [03-ideas.md](../03-ideas.md) and every card in [03-ideas/](../03-ideas/). My ten test questions ([skeptic.md §C](../03-ideas/skeptic.md)) are put to each card.

**How to read the tables.** Verdicts: **A** answered, **P** partly answered, **N** not answered. Card citations are `file:line` in the card files in `03-ideas/`; anatomy citations are `file.md organ`; clone citations are `repo:path:line` at the pinned commits. Labels: [seen], [inferred], [unknown].

**Question keys.** Q1 writers; Q2 Evidence identity and source of truth; Q3 atomicity across the join; Q4 side effects on replay; Q5 untrusted content; Q6 context cost per answer; Q7 accounts; Q8 platform and format reach; Q9 ownership and upstream; Q10 the capability only a combination has.

**New facts from the clones, used below.** Each one was checked in this round [seen].
- **F1. The Evidence ID is derived from output.** It hashes `raw_result`, `normalized_result`, `environment`, `subject.digest` and `provider` (`rea:src/domain/evidence.ts:251-278`). `environment` is `{id, platform, architecture, isolation}` (`:120-125`). So the ID is known only after a probe has run, the same probe gives a different ID on a different host platform, and a new version of an artifact always gives new IDs, because its digest changes.
- **F2. A pi-durable tool has no commit shared with its result.** The tool gets `api.commit(tx => …)` and `api.details(...)`, both separate from the harness's own settlement of the result (`durable:src/harness/types.ts:241-243`). The harness asks for `models: Models`, the pi-ai object (`:217-218`).
- **F3. pi-durable gives no idempotency for external effects.** "A replay-safe tool with external effects still needs its own idempotency" (`pi:packages/durable/README.md:326`). After a crash, an unsafe call settles as "was interrupted and may have partially run" (`durable:src/harness/tool.ts:195`). Nothing stops the model from calling it again.
- **F4. absurd event names must be unique per occurrence.** The README's own example keys the event by order id (`absurd:README.md:162`). Events are first-write-wins and are never consumed (`absurd.md` O4).
- **F5. pi-durable's spec excludes offline multi-writer merge.** It lists "CRDT/offline multi-writer merge" as a non-goal (`durable:docs/spec.md:5614`).
- **F6. Claude Code can be limited to a list of tools.** leanrea's benchmark launches it headless with `--allowedTools` (`leanrea:bench/run.py:15-17`).

## 1. The eight advocate cards

### R-1 Case file (a-rea.md)
| Q | V | Card says | Counter-evidence |
|---|---|---|---|
| 1 | P | SQLite locally, absurd "when shared"; multi-worker is left to the owner (:31, :47) | Two backends (X-1). pi-durable has no lease (`pi-durable.md` §3.3) |
| 2 | P | "The Evidence ID becomes the durable step key" (:38) | F1: the ID exists only after the probe runs and changes with the host platform, so it cannot be a key decided before execution |
| 3 | N | The ledger Maps are "replaced" (:30). Nothing says what commits with what | F2: Evidence and the tool result land in separate commits unless the kernel changes |
| 4 | P | Foreign code needs approval (:33) | No rule per tool class. A model request is re-sent after a crash (`pi-durable.md` organ 7) |
| 5 | P | rea's O3 marker (:33) | Only the marker's presence is tested. No injection evaluation (`rea.md` O12, O19) |
| 6 | P | Catalog ≤ 15 KB, "to measure" (:44) | Bytes per answer not addressed. 85,449 B for a 3-file app (`rea.md` O4) |
| 7 | A | Stores no identity; the host agent calls the model (:49) | — |
| 8 | N | — | No tar/gzip (`rea.md` O10); first-move commands are macOS-only (`leanrea.md` L6) |
| 9 | N | O5 and O7 are "lift" (:29) | rea exports no library (`rea:package.json`, no `main` or `exports`). The code must be vendored (2,839 lines) or changed upstream |
| 10 | P | "That adapter is the product" (:42) | Its own weak spot 1 concedes the null option may be enough (:58). S-1 tier 2 checkpoints the bundle after each call |

- **W-R1-1 (high): the Evidence ID cannot be the replay key.** F1. A probe whose output varies, such as timing in process captures (`rea.md` O13) or a host-dependent environment, never dedupes. *Close (design change):* a step key computed from inputs, namely subject digest + operation + parameters + provider version. The Evidence ID stays the identity of the record only.
- **W-R1-2 (high): agents may not record faithfully.** The card's own text (:59). A rigorous-looking file with uncalibrated classes is worse than plain prose. *Close (design change):* the runner writes Evidence from every probe's output. Records an agent writes are forced to authority `analyst-inference`.
- **W-R1-3 (high): thin margin over the null option** (:58). *Close:* a kill-at-step-k test against S-1 tier 2. If the gap is at most one tool call, make the scope cut and fold R-1 into S-1.

### R-2 Release delta gate (a-rea.md)
| Q | V | Card says | Counter-evidence |
|---|---|---|---|
| 1 | A | Multi-worker "yes" under absurd leases (:81) | absurd's lease-overlap window and missing fence (`absurd.md` O3, §3 item 2); the card admits the fixes are needed (:109) |
| 2 | N | "Findings keyed by Evidence ID across versions, so a reviewed finding stays reviewed" (:89) | F1: the subject digest is part of the ID, so every new version gives new IDs. The stated mechanism cannot work |
| 3 | N | — | — |
| 4 | A | Static probes only; foreign code forbidden in the gate (:80) | — |
| 5 | P | No model in the gate (:76) | Reviewing agents read cases through MCP (:96). That boundary is not specified |
| 6 | P | Model-free (:91) | Bytes per answer for the reviewing agent not stated |
| 7 | A | A model is used only through delegation, and the gate never needs one (:98) | Terms for CI use unknown (`donors.md` row 9) |
| 8 | P | "Mostly a JS/Electron product" (:108) | `.tgz` is rejected today (`rea.md` §5). Ghidra is absent on CI runners (:108) |
| 9 | N | O10 and O11 "adapt" (:78) | Those closures are 90-120 files (`rea.md` §4), so this means a fork or an upstream change |
| 10 | P | Leases, retries, negative space (:88) | S-1 tier 3 has leases too. Negative space comes from coverage.json, not from combining the repos |

- **W-R2-1 (critical): finding identity across versions is undesigned.** F1. *Close (design change):* a finding fingerprint made of capability class, normalised location and symbol, with the subject digest left out. Per-version Evidence IDs are kept underneath it.
- **W-R2-2 (critical): a false "no change"** (:107). rea marked coverage "complete" and missed an edge (`rea.md` O11). *Cannot be closed without upstream change* to rea's JS loader handling and its coverage claim. Until then, every unresolved loading form must be a fail-closed line.
- **W-R2-3 (medium): cost per pair.** The CLI takes 2.1-2.2 s to start per call (`rea.md` O17). JS analysis took 2.4 s for 3 files (O11). The 60 s target (:115) is unmeasured. *Close:* one long-lived `rea mcp` per worker, then measure.

### L-1 Triage ladder (a-leanrea.md)
| Q | V | Card says | Counter-evidence |
|---|---|---|---|
| 1 | P | pi-durable SQLite local store (:44) | Unlike D-1, it adds no lease (`pi-durable.md` §3.3) |
| 2 | P | One record per probe, with command, tool version and input sha256 (:28, :40) | F1: raw CLI text in `raw_result` makes IDs host-dependent |
| 3 | N | — | F2 |
| 4 | P | "Replayed only if safe" (:44); "resuming replays the stored probes, not the work" (:33) | The two statements disagree. A replayed shell probe needs its own idempotency (F3) |
| 5 | P | Untrusted envelope (:46) | T3 frames untrusted text four different ways (`donors.md` row 14). No evaluation |
| 6 | P | Catalog < 10 KB (:53) | Its own weak spot 1: recording may add calls (:62) |
| 7 | A | The host agent is the official client (:57) | Contradicts "embeddable library on pi-durable" (:55), which needs pi-ai `Models` (F2) |
| 8 | N | — | Router rows are macOS-first (`leanrea.md` L6, §3) |
| 9 | P | rea "over MCP or as a library" (:56) | The library route does not exist (`rea:package.json`) |
| 10 | P | Enforced budgets, recorded escalation (:48) | S-1 tier 2's `beforeTool` hook can enforce caps without a merger |

- **W-L1-1 (high): the escalation gate authorises itself.** The agent creates the unknown that permits its own climb (:29, :32, :41). *Close (design change):* the runner opens unknowns from the question items. A per-rung byte and call budget then applies whether or not an unknown exists.
- **W-L1-2 (high): the overhead can eat the turn saving** (:62). Fewer turns is the only effect leanrea proved (`leanrea.md` §4). *Close:* recording is implicit in the probe call and costs no extra model turn. Then measure against the leanrea arm.
- **W-L1-3 (medium): a single writer with no lease.** *Scope cut:* declare single-writer and adopt D-1's lease row.

### L-2 Model-free first sweep (a-leanrea.md)
| Q | V | Card says | Counter-evidence |
|---|---|---|---|
| 1 | A | absurd fan-out; single-worker is an owner decision (:93) | `absurd.md` O3 fixes needed |
| 2 | P | Evidence plus coverage record (:103) | F1 |
| 3 | N | — | — |
| 4 | A | Launch and attach rows disabled when unattended (:91) | — |
| 5 | P | No model in the sweep (:75) | The residue handed to an agent carries target strings (:84). Boundary unspecified |
| 6 | A | Close to zero for the bulk of artifacts (:108) | — |
| 7 | A | API key, or official CLI/SDK/ACP sign-in (:84) | Terms unknown (`donors.md` §4) |
| 8 | P | "Row by row" (:108) | The Mach-O and entitlement first moves use `lipo`, `otool` and `codesign` (`leanrea.md` L6). Those are macOS tools and do not run in the card's Linux-style container [inferred] |
| 9 | P | Router as tested data (:99) | The isolation donor is pattern-only, with unpinned images (`donors.md` row 21) |
| 10 | P | (:99) | Its own weak spot 2: SBOM scanners overlap (:112) |

- **W-L2-1 (high): inventories are not answers** (:111). *Scope cut:* position L-2 as a pre-filter and publish the measured closure rate.
- **W-L2-2 (high): macOS-native probes cannot run inside the isolation boundary.** *Close (design change):* rea's cross-platform Mach-O reader (`rea.md` O10) in place of `otool`, declaring entitlements not covered on Linux. Or a separate macOS VM lane.
- **W-L2-3 (high): untrusted parsers at fleet scale** (:113). *Close (design change):* the product's own isolation spec with pinned images, plus fuzzing of every extractor row.

### D-1 Investigation Log (a-durable.md)
| Q | V | Card says | Counter-evidence |
|---|---|---|---|
| 1 | A | Single owner plus a lease row (:32, :35) | — |
| 2 | P | O5 with the path fix (:36) | F1: a colleague on another platform who reruns a safe step gets a different ID |
| 3 | P | "Evidence committed in the same atomic commit" (:27, :40) | F2: the API does not provide this. It needs Evidence in the result `details` or a change to the kernel, which the card calls Chord-coupled (:49) |
| 4 | A | Read-only steps rerun, a target launch settles `interrupted` (:31) | Only 5 of 208 rea tools are read-only (`rea.md` O3). Generation requests are re-sent after a crash (`pi-durable.md` organ 7) |
| 5 | P | T3 envelope (:38) | No evaluation |
| 6 | P | Small catalog, handles for large results (:42, :44) | Not measured |
| 7 | P | "An ACP or official-SDK client for the model" (:42) | F2: the harness takes pi-ai `Models`. I found no adapter from the Agent SDK or ACP into `Models` [inferred]. D-2's own inversion says the turn loop is exactly what should not be owned with subscription credentials (:57) |
| 8 | N | — | — |
| 9 | P | Its own weak spot 3 (:49) | One-way schema v2 migration (`pi-durable.md` organ 2) |
| 10 | A | Evidence and result in one commit (:40) | If it is delivered, S-1 cannot do it. This is the strongest Q10 answer among the cards |

- **W-D1-1 (high): the model-access contradiction.** A pi-durable host owns the loop through pi-ai, while delegated sign-in means an official client owns the loop. *Close:* either state "API keys only", or invert: the official client is the host and D-1 is an MCP server. Then the transcript is no longer pi-durable's, and "same commit" covers only Evidence plus the tool result inside the server.
- **W-D1-2 (high): "same atomic commit" is not in pi-durable's API** (F2). *Close (design change):* Evidence goes in the result `details`, or the harness is extended. Either way it is an upstream change or a kernel fork.
- **W-D1-3 (medium): handing over the file between machines.**
  - Copying a WAL database without its `-wal` file loses commits; leanrea lists this exact trap (`leanrea:leanrea/SKILL.md:50`).
  - A colleague on an older version cannot open a store migrated to v2.
  - Concurrent work is a non-goal (F5). *Close:* export with `VACUUM INTO` or a bundle; *scope cut:* concurrent work.

### D-2 Effect Gateway (a-durable.md)
| Q | V | Card says | Counter-evidence |
|---|---|---|---|
| 1 | A | SQLite lease row, or absurd (:75) | — |
| 2 | P | Receipt key = intent id; O5 lifted (:69) | — |
| 3 | P | Intent, receipt and lease form one record (:73) | The lease check and the external effect are not atomic. A stalled old worker can still act (`absurd.md` §3 item 2) |
| 4 | P | "At-most-once"; a ticket is not posted twice (:59, :63) | F3: after `interrupted` the model can call again with a new call id. That holds only if an idempotency key reaches the tracker |
| 5 | N | — | — |
| 6 | P | Agent-only interface (:77) | Not measured |
| 7 | P | Holds by construction (:77) | CI on subscriptions unknown (:82) |
| 8 | N | — | — |
| 9 | P | Lift the logic, leave the kernel (:67) | That means rewriting tool.ts outside Chord |
| 10 | P | (:73) | Its own falsifier: absurd plus a 50-line receipt check may match it (:84) |

- **W-D2-1 (high): the official client's built-in tools bypass the gateway** (:81). *Partly closed:* restrict the client to the gateway's tools in CI (F6). Whether that list also removes the built-in shell is [inferred] and needs a test.
- **W-D2-2 (high): "at-most-once" is overclaimed** (F3, Q3). *Close (design change):* claim only "never re-run by the gateway", and require idempotency keys forwarded to each effect target. *Scope cut:* targets that cannot take a key.
- **W-D2-3 (medium): not an analysis product.** It is general agent safety, close to the non-goal "Not a general workflow platform" (framing §5). *Scope cut:* fold it into the fleet card as its effect layer.

### B-1 Fleet ledger (a-absurd.md)
| Q | V | Card says | Counter-evidence |
|---|---|---|---|
| 1 | A | Many workers, one ledger (:17, :22) | — |
| 2 | P | Spawn key = sha256 + probe + tool version (:13) | This key is computed from inputs, which is the right one (compare W-R1-1). Who mints Evidence IDs is not stated |
| 3 | A | Evidence row in the same transaction as the step (:17, :36) | A step runs `fn()` and then a separate autocommit checkpoint (`absurd.md` §3 item 3). A new SQL function has to write both [inferred: feasible] |
| 4 | P | Its own weak spot 3: effects stay at-least-once (:54) | — |
| 5 | P | O3 marker (:29) | No GRANT anywhere: any role can write ledger rows (`absurd.md` O2) |
| 6 | P | 6-8 MCP tools (:43) | Not measured |
| 7 | A | Operator key, or official sign-in with one home per account (:46) | — |
| 8 | N | A "formats not covered" view (:24) | No table of what is covered |
| 9 | P | rea runs as a subprocess (:53) | — |
| 10 | A | SQL across the fleet (:38) | S-1 tier 3's files per attempt cannot answer cross-fleet queries |

- **W-B1-1 (high): Postgres is a hard dependency** (:52). *Unresolved: owner decision* (the multi-worker question in J-02).
- **W-B1-2 (high): the shared ledger has no role model** (`absurd.md` O2). *Close (design change):* roles, SECURITY DEFINER functions, and rows owned by the writing run.
- **W-B1-3 (high): atomic Evidence needs the lease fence first.** `extend_claim` and `complete_run` accept an expired lease (`absurd:sql/absurd.sql:1108,1602-1612`). *Close (design change):* compare `claim_expires_at` with now on every write.

### B-2 Standing investigations (a-absurd.md)
| Q | V | Card says | Counter-evidence |
|---|---|---|---|
| 1 | A | Ownership is a lease (:64) | — |
| 2 | P | Inherits B-1 | F1 |
| 3 | P | Inherits B-1 | — |
| 4 | P | pi-durable 6 rebuilt on absurd (:103) | A design change, not a lift (`pi-durable.md` §5.3) |
| 5 | P | Its own weak spot 3 (:105) | Evidence text is replayed to the next agent weeks later |
| 6 | N | — | — |
| 7 | P | A handover never moves a credential (:97) | Terms for long unattended runs unknown (:105) |
| 8 | N | — | — |
| 9 | N | "The largest new code in either card" (:103) | — |
| 10 | P | Handover plus wake on events (:89-91) | The need itself is unevidenced (03-ideas.md, family C) |

- **W-B2-1 (high): the waits misfire.** `awaitEvent("release:<product>")` (:68) reuses a name. Because events are never consumed, the next wait returns the old release at once (F4). TTL cleanup can also delete an event before a long wait reads it (`absurd.md` O4, O6). *Close (design change):* event names carry a version or sequence number, plus a per-investigation cursor.
- **W-B2-2 (high): an unproven need on top of the largest new code** (:103, :109). *Scope cut*, unless session logs show handovers.
- **W-B2-3 (high): the embedded mode is unknown** (PGlite, :104). *Close:* the one-hour spike from `absurd.md` §4.

## 2. My own cards (honesty test)

### S-1 Compose, don't merge
| Q | V | Card says | Counter-evidence |
|---|---|---|---|
| 1 | P | One store per host; tier 3 has one file per attempt | No shared ledger |
| 2 | P | rea mints IDs; the bundle on disk holds the truth | Inherits F1 and the nested path |
| 3 | N | Up to one tool call lost per crash | — |
| 4 | P | Replay map from MCP hints | See W-S1-1 |
| 5 | N | Inherits rea's marker | No envelope, no evaluation |
| 6 | P | 222,396 B catalog, measured | Results are still sent twice (`rea.md` O4) |
| 7 | A | Tiers 0-1 are clean; tier 2 uses API keys | — |
| 8 | N | Inherits every gap | — |
| 9 | A | Pinned dependencies, about 0.5-1k lines | Upstream fixes arrive only if upstream wants them |
| 10 | — | It is the null option | — |

- **W-S1-1 (high): resuming loses engine state.** Ghidra projects are ephemeral (`rea.md` O15). Importing a snapshot needs an exact match, and a session with metadata edits must be closed first (`rea:src/contracts/sessionToolContracts.ts:72`). So "resume" can mean re-running expensive analysis. *Cannot be closed without upstream change.*
- **W-S1-2 (high): in tier 1, exporting and cheap-first routing are prose.** They depend on the agent following instructions, like leanrea L2. Exports in tier 1 are also model-visible calls that add turns. *Cannot be closed in tier 1;* tier 2 closes it.
- **W-S1-3 (high): the durable tier cannot use subscriptions.** pi-ai's OAuth is leave, and no adapter for delegated sign-in exists. *Scope cut,* stated: tier 2 is API keys only.
- **W-S1-4 (medium): no query across the fleet.** Tier 3 keeps one file per attempt. *Scope cut,* or merge the bundles afterwards (`import_evidence_bundle` merges atomically, `rea.md` O6).

### S-2 Claim format, not runtime
| Q | V | Card says | Counter-evidence |
|---|---|---|---|
| 1 | A | One append-only store | — |
| 2 | P | The spec defines IDs that do not depend on the path | F1: does not separate claim identity from observation identity |
| 3 | N | There is no runtime | — |
| 4 | N | — | — |
| 5 | N | — | — |
| 6 | N | — | — |
| 7 | A | No accounts | — |
| 8 | N | — | — |
| 9 | P | Rewrite of rea's 2,839 lines | rea itself must change to conform |
| 10 | P | A shared format | rea already exports canonical bundles today (`rea.md` O6) |

- **W-S2-1 (high): it addresses none of framing jobs 1, 2 or 4.** Every advocate card treats durability as core. *Scope cut,* stated: S-2 serves as a layer inside another candidate, not on its own.
- **W-S2-2 (high): the identity design is incomplete** (F1). *Close (design change):* an observation ID (today's ID) and a claim ID (subject, predicate, normalised value) kept separate.
- **W-S2-3 (high): adoption depends on one implementation, and rea does not conform yet.** *Cannot be closed without upstream change.*
- **W-S2-4 (high): the converter from prose to records can launder inference into evidence.** *Scope cut:* converted records carry only `analyst-inference`.

## 3. Cross-card weak spots

| ID | Problem | Severity | Cards | Evidence |
|---|---|---|---|---|
| X-1 | **Evidence identity is derived from output.** It cannot serve as a step key, a review key across versions, or an ID that is the same on every host. The nested-path defect sits on top of that | critical | R-1, R-2, L-1, D-1, B-1, B-2, S-2 | F1; `rea.md` O5 |
| X-2 | **No card has an enforced untrusted-content boundary or an injection evaluation.** Each relies on rea's marker or T3's envelope | critical | all 10 | `rea.md` O3, O12, O19; `leanrea.md` §3; `pi-durable.md` §4.5; `donors.md` row 14 |
| X-3 | **Model access contradicts the runtime.** Cards that embed pi-durable need pi-ai `Models`, while delegated sign-in needs the official client to own the loop. Provider terms for CI and unattended use are unknown | high | D-1, L-1, B-2, S-1 tier 2 (contradiction); R-2, L-2, D-2, B-1 (terms) | F2; `pi-durable.md` organ 14; `donors.md` row 9 |
| X-4 | **The storage split.** SQLite is single-owner and has no lease. Postgres breaks local-first. Running both doubles the test matrix | high | R-1, R-2, L-2, D-2, B-1, B-2 | `pi-durable.md` §3.3, §5.3; `absurd.md` §4 |
| X-5 | **rea is not importable as a library.** Every lift of O5 and O7 is vendored code or an upstream change, against rea's release churn | high | all 8 advocate cards, S-2 | `rea:package.json` (no `main` or `exports`); `rea.md` §4 |
| X-6 | **Coverage overclaims.** Every negative-space promise rests on rea's analysis, which reported "complete" and was not | high | R-2, L-2, B-1, D-2 | `rea.md` O11; J-02 |
| X-7 | **Replay and approval come from self-declared effects, not isolation.** `mutatesSession` makes almost nothing read-only | medium | R-1, L-1, D-1, D-2, S-1 | `rea.md` O3; `rea:src/contracts/toolEffects.ts:718-741` |
| X-8 | **No card serves Windows or macOS desktop users.** macOS-only probes conflict with Linux isolation | medium | all 10 | 03-ideas.md point 4; `leanrea.md` L6; `rea.md` §3 |
| X-9 | **Bytes per answer are unmeasured.** Every catalog budget is a target, not a measurement | medium | all 10 | `rea.md` O4 (85,449 B); `leanrea.md` §4 |
| X-10 | **Spend is re-sent after a crash, with no budget** | medium | D-1, L-1, B-2, S-1 tier 2 | `pi-durable.md` organ 7, §4 |

## 4. Overlaps and merges I would force

1. **R-1, D-1 and L-1 are one product,** a single-node durable case file. D-1 is its storage design, R-1 its record model, and L-1 an escalation policy inside it. L-1 is not a product.
   - *Merge into one candidate.* Take the step keys computed from inputs from B-1 (W-R1-1). Take D-1's lease row. Settle W-D1-1 before anything else.
2. **R-2, L-2 and B-1 are one product,** an unattended sweep and delta gate. L-2 is the first pass, R-2 the diff and the gate, and B-1 the fleet back end.
   - *Merge into one candidate,* with S-1 tier 3 as its cheap baseline arm.
3. **D-2 is the effect layer of the merged R-2/L-2/B-1 candidate.** Its receipts belong there. On its own it drifts into a non-goal.
   - *Fold it in, or cut it.*
4. **B-2 is the merged R-1/D-1/L-1 candidate plus absurd sleeps and events.**
   - *Keep it as an option on candidate 1,* depending on the multi-writer answer and on evidence that handovers happen.
5. **S-1 is the baseline both merged candidates must beat.**
   - Tier 2 equals candidate 1 without the atomic commit.
   - Tier 3 equals candidate 2 without the shared ledger.
   - So the debate should measure exactly those two differences.
6. **S-2 is the common core of everything** (03-ideas.md point 1). It should be a mandatory layer inside both candidates, with W-S2-2's separate claim ID, not a separate candidate.

**My resulting field:** a durable case file, a CI sweep and delta gate, and the null option S-1. S-2 becomes a required layer in both, and D-2 and B-2 are folded in or cut.
