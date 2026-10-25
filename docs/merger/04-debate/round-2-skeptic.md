# 04 Debate, round 2b: the skeptic

**Inputs.** The four round-2 rebuttals and the moderator's re-run of [spikes/pglite](spikes/pglite/README.md).

**Rebuttal citations** have the form `r2-<role> §n`. They point to sections of `round-2-a-*.md`.

**Labels.** [seen], [inferred] and [unknown].

**Verdicts.**
- **accept** means the gap is closed.
- **accept-with-condition** means it is closed only if the named test passes.
- **reject** means the gap is not closed.
- A claim of "closed-by-design" that rests on code nobody has built or run is downgraded to **closed-on-paper, test required**.

**New fact N-0: PGlite does not stop two processes from writing to one store, and committed data is lost** [seen, measured by me].
- **Setup.** `@electric-sql/pglite` 0.5.8 on Node 22.22.0. Two Node processes opened the same data directory at the same time, and each inserted rows and committed. The script is `/tmp/claude-0/-home-user-RE4exa/d56d1359-e50d-5e20-87e7-73dc76d672d7/scratchpad/pgl-scripts/two.mjs`.
- **Behaviour.** Neither process got an error. Each process saw only its own rows.
- **Result after both closed and the store was reopened, over 3 runs:**
  - run 1: process A's 200 committed rows were gone, and only B's rows remained;
  - run 2: no rows were lost;
  - run 3: A kept 175 of its 200 rows.
- **Status of the spike's gap.** The spike README lists "several processes sharing one store" as **not tested**. This measurement closes that gap, and the answer is unsafe.

## 1. Status of every gap

| Gap | Advocate's status | Verdict | Reason (citation) | Test required before it counts as closed |
|---|---|---|---|---|
| W-R1-1 Evidence ID used as replay key | closed-by-design: ProbeKey (r2-rea §1, §2 X-1) | accept-with-condition | A path-free query key already exists in rea (`rea:src/domain/analysisSnapshot.ts:354-367`) [seen] | X-1 tests 1-2: the same bytes at two paths and on two hosts give equal keys. Changing each parameter of each of the 208 tools changes the key |
| W-R1-2 agents may not record faithfully | closed-by-design: the runner writes Evidence, and agents write only `analyst-inference` (r2-rea §1) | accept-with-condition | Both values exist in rea's schema (`rea:src/domain/evidence.ts:112-118`) | The schema refuses `observed` from an agent-facing write path. Audit: fewer than 20% of answer claims lack an Evidence ID |
| W-R1-3 thin margin over the null option | scope-cut, test-gated | accept | — | Kill test against S-1 tier 2. **Someone has to build tier 2** (N-12) |
| W-R2-1 finding identity across versions | closed-by-design: FindingKey | **reject → closed-on-paper** | The capability-class normalisers "do not exist yet" (r2-rea X-1, residual risk) | X-1 test 3: at least 95% of FindingKeys survive across versions, and none collide |
| W-R2-2 false "no change" | closed-by-design for false "complete" | accept-with-condition | "complete" means only that the output was not truncated (`rea:src/domain/javascript/javascriptApplicationEvidenceSchemas.ts:197-203`) [seen]. The census is an upstream change | Before the census exists, the gate must read rea's `complete` as `partial`. Then the resolver ablation and the noise falsifier |
| W-R2-3 cost per pair | closed-by-design; warm call 0.65-0.85 s measured | accept-with-condition | Full results still come back twice: 178,983 B against 20,829 B in summary mode (r2-rea §1) | Wall time on at least 50 real version pairs at or under 60 s each |
| W-L1-1 the escalation gate authorises itself | closed-by-design: the runner opens unknowns from `items[]` (r2-leanrea §1) | **reject → closed-on-paper** | `triage(target, items[])` takes its items from the agent. Self-authorisation has moved back one step, not gone | Items must be taken verbatim from the user's request and recorded, or the budget per rung alone gates escalation. The test is an over-escalation rate within the L-1 falsifier |
| W-L1-2 overhead eats the turn saving | closed-by-design, measurement pending | closed-on-paper | — | X-9 |
| W-L1-3 single writer with no lease | scope-cut | accept | — | — |
| W-L2-1 inventories are not answers | scope-cut | accept | — | Publish the closure rate per question class |
| W-L2-2 macOS probes cannot run on Linux | design change plus scope-cut | accept | Entitlements depend on `codesign`, so they are declared `partial` on Linux (r2-leanrea §1) | — |
| W-L2-3 untrusted parsers at fleet scale | closed-by-design: one container per attempt | accept-with-condition | The donor images are unpinned (`donors.md` row 21). Linux only (N-8) | Fuzz every extractor row. Images pinned by digest |
| W-D1-1 model access contradicts the runtime | closed-by-design: Mode A and Mode B (r2-durable §2 X-3) | **reject → closed-on-paper** | Running a `ToolTask` outside a generation is "a one-day spike" that has not been run. Mode A writes made-up `AssistantEntry` records (N-4) | The Mode A spike: kill the server mid-call and check the settlement |
| W-D1-2 "same atomic commit" | closed-by-design: Evidence first, pointer with the result | accept-with-condition | The settlement commit is separate (`durable:src/harness/tool.ts:655-676`) [seen]. A-rea and A-leanrea propose something else (N-5) | `ControlledStorage` crash at all three points, then check the invariant and the `delivered` flags |
| W-D1-3 handing the file between machines | closed-by-design: export through `VACUUM INTO` | accept | — | Round-trip an export; refuse to open a store with a newer schema |
| W-D2-1 the client's built-ins bypass the gateway | closed for Claude, pending a canary | accept-with-condition | T3 runs Claude with `--tools ""` (`t3code:apps/server/src/textGeneration/ClaudeTextGeneration.ts:217-224`) [seen]. For Codex, whether the shell can be removed is unknown | Canary: a request for a built-in shell must be refused, per client version |
| W-D2-2 "at-most-once" overclaimed | conceded; claim narrowed | accept | — | 8 workers and a fake tracker: zero duplicates for keyed targets |
| W-D2-3 not an analysis product | scope-cut | accept | — | — |
| W-B1-1 Postgres is a hard dependency | unresolved-owner, narrowed by the PGlite spike | accept-with-condition | N-0: the embedded mode is single-process *only if something enforces it* | A second process opening the store is refused (N-1) |
| W-B1-2 no role model | closed-by-design: roles and SECURITY DEFINER | closed-on-paper | Not built. Definer functions that run dynamic `%I` DDL need an audit (r2-absurd §1). Roles mean nothing on single-user PGlite [inferred] | A pytest as each role: everything outside its allowlist fails with `42501` |
| W-B1-3 the lease fence | closed-by-design, prototyped | accept-with-condition | `fence.mjs` ran on one connection with a fake clock, so no race was exercised | A two-connection race on real Postgres, 1,000 iterations, with exactly one outcome per pair |
| W-B2-1 waits on a reused name misfire | closed-by-design, prototyped | accept-with-condition | This is new owned code (N-6). TTL cleanup can let a name be emitted again (r2-absurd §1) | A property test with redeliveries and random cursors, plus TTL cleanup during a pending wait |
| W-B2-2 unproven need | scope-cut | accept | — | Session-length logs |
| W-B2-3 embedded mode unknown | closed for one process | accept-with-condition | The SDK has not been run on PGlite. Several processes lose data (N-0) | The TS SDK on a PGlite adapter, plus a kill test |
| W-S1-1 to W-S1-4 (mine) | not addressed by anyone | open | Tier 2 is now everyone's falsifier arm (W-R1-3, X-9), but no one owns building it | Build tier 2 (my estimate: 350-600 lines) before any comparison |
| W-S2-1 | scope-cut: S-2 becomes a layer (all four advocates) | accept | — | — |
| W-S2-2 separate claim and observation IDs | designed as three keys | closed-on-paper | Complexity (N-2) | X-1 tests |
| W-S2-3 adoption without a conforming rea | option d plus golden vectors (r2-rea X-5) | accept-with-condition | — | The CI job compares byte-identical IDs against a pinned rea |
| W-S2-4 converter launders inference | accepted | accept | — | — |
| X-1 identity | closed-by-design: three keys | closed-on-paper | The FindingKey normalisers do not exist. Redaction changes ObservationIds (N-10) | X-1 tests 1-3, plus a change of detector version |
| X-2 untrusted content | closed only for product-owned execution | accept-with-condition | Enforced at one choke point. `Tainted` exists only at compile time. The gate fires in every session (N-3) | Policy unit tests (a), and 0 tripwires in at least 120 runs (b), **including a second MCP server in the same client session** |
| X-3 model access | mechanism closed-by-design; terms unresolved-owner | closed-on-paper | Mode A spike not run. The Mode B guard keys on an internal substring check (`ai:src/api/anthropic-messages.ts:1014-1016`) [seen] (N-11) | The Mode A spike. Mode B allows only listed key types, and a network capture shows no `claude-cli` user agent |
| X-4 storage split | unresolved-owner; option A recommended | accept as unresolved | N-0 and N-7 weaken option A | The migrate-embedded-to-shared test; the matrix runs on PGlite, PG14 and PG18 |
| X-5 rea not importable | closed-by-design: d starting from b | accept-with-condition | Deep import works (r2-rea X-5), but it is an undeclared API | The golden-vector job |
| X-6 coverage overclaim | closed-by-design, upstream change | accept-with-condition | The census is new code on rea's AST, either upstream or in a fork | Resolver ablation never yields `complete`. Mutation corpus |
| X-7 self-declared effects | closed-by-design on Linux | accept-with-condition | macOS and Windows are unenforced (N-8) | Adversarial "read-only" tools fail under `inspect`. Every non-Linux run is labelled unenforced |
| X-8 platform reach | closed-by-design: `reach.json` generated from fixtures | accept | Native Windows declared not covered | Every cell marked covered passes its fixture in CI |
| X-9 bytes per answer | protocol designed | **reject the decision rule** | "Evidence share beats Tier 0 by 50 points" (r2-leanrea X-9) holds by construction, because Tier 0 writes no runner Evidence. That leaves "cost at most 1.2×" as the only bar, and it lets the candidate be 20% dearer | Replace with: correct-and-verified claims per dollar beat Tier 0, where claims are checked against oracles rather than counted IDs. Include a resume task where Tier 0 may keep notes |
| X-10 spend re-sent after a crash | budgets closed-by-design; no dedupe conceded | accept-with-condition | Whether `classify()` treats a budget stop as non-retryable is unknown (r2-durable X-10) | Kill during streaming, then check for one `request_resent`. A typed stop when over budget |
| AGT-1 (judge) | = X-2 | as X-2 | — | as X-2 |
| SEC-1 (judge) | threat-model outline (r2-leanrea §2) | accept-with-condition | The trust boundaries leave out the host client and **other MCP servers in the same session** (TB1-TB7). There is no SECURITY.md owner or response process | Name an owner for SECURITY.md, add those boundaries, run a report drill |
| EPI-2 (judge) | method closed-by-design; numbers unknown | accept-with-condition | About 106 confidence sites at n ≥ 30 each means about 3,000 labelled claims [estimate]. The team writes its own labels | A seeded wrong producer is demoted within one run. Labels are written by someone other than the producer's author |
| SEC-6 (judge) | closed-by-design: redaction at source (r2-durable §2) | closed-on-paper | The detector's source and licence are unknown | The seeded-secret corpus gives 0 hits across the DB, the WAL, the export and the provider request |
| PRV-4 / EVO-4 (judge) | mechanics closed; role and support period unresolved-owner | accept as unresolved | A five-year support period means backporting fixes into vendored rea, absurd and pi forks. That cost is not quantified | The owner states the role and the period. Staff cost estimated |

## 2. Weak spots the rebuttals created

| ID | Weak spot | Severity | Evidence | What would close it |
|---|---|---|---|---|
| N-1 | **The embedded PGlite store silently loses committed data with two processes**, for example a CLI and the MCP server open at the same time | critical (for X-4 option A) | N-0 | An exclusive OS lock taken at open, with a second opener refused. Then the two-process test |
| N-2 | **The identity scheme has become complex.** It now has ProbeKey, ObservationId and FindingKey, plus `redactions`, `delivered`, `origin` and reach state per claim, all in the S-2 spec (r2-rea §3, r2-durable §3, r2-leanrea §3) | high | Every advocate added fields, and no one removed any | Cap S-2 v1 at the record plus two IDs. Make everything else an optional extension with its own version |
| N-3 | **Taint is enforced at one choke point, our own dispatcher.** Branded `Tainted<string>` types disappear at runtime [inferred, TypeScript semantics]. Another MCP server, or the client's own tools, sit outside the gate. Every analysis session is tainted from its first result, so "approval after taint" means approval for every effect, and people tire of approving | high | r2-leanrea X-2 parts 1 and 3 | Product mode refuses to run beside other MCP servers, or says so. Measure the approval rate per session |
| N-4 | **With the official client as host, the turn loop is no longer durable.** "Investigations that survive" (framing §3 job 1) now depends on the client's session resume [unknown]. Mode A writes `AssistantEntry` records copied from a loop the product did not run | high | r2-durable X-3, residual risk | Claim durability only for the tool side. Test resume after a client crash with each supported client |
| N-5 | **The candidate has three kernels on paper:** pi-durable with Evidence first (A-durable), one transaction in the server's own SQLite (A-rea, A-leanrea), and absurd on PGlite (A-absurd) | high | r2-durable §3.1, r2-rea §3, r2-absurd §3.1 | The owner picks one kernel before layer 5. Each candidate names exactly one store |
| N-6 | **The sequenced topics, the fence, the roles and AB004/AB005 are a fork of the 3,158-line `absurd.sql`.** absurd's migrations do not run inside transactions (`absurd.md` O13) | medium | r2-absurd §2.2-2.3 | Send the work upstream, or budget for owning the fork and its migrations |
| N-7 | **"One schema" runs two code paths.** PGlite is PostgreSQL 18.3, so `portable_uuidv7` takes the native branch, which ignores the fake clock. A shared PG14 or PG16 takes the fallback branch | medium | spike README; r2-absurd §2.1 residual risk | CI covers PGlite, PG14 and PG18, with partitioned queues running on the fake clock |
| N-8 | **Enforcement exists only on Linux.** The X-7 profiles, the L-2 container and the X-2 rule that the client owns no shell all rely on namespaces or containers. The macOS desktop, the only platform leanrea ever benchmarked (`leanrea.md` §4), gets "unenforced" | medium | r2-durable X-7, r2-leanrea X-8 | A macOS VM lane, or a declared scope cut |
| N-9 | **The X-9 decision rule favours the candidate** (see the table above) | high | r2-leanrea X-9 | Replace the rule as stated in the table |
| N-10 | **Redaction feeds into ObservationIds.** Updating the detector changes IDs, which sets off `nondeterministic` flags and breaks dedupe | medium | r2-durable SEC-6 item 3 | Put the detector version into the profile digest and the ProbeKey |
| N-11 | **The Mode B guard copies pi-ai's internal OAuth check** (`isOAuthToken` = contains `sk-ant-oat`). A new OAuth path with another prefix would get through | low-medium | `ai:src/api/anthropic-messages.ts:1014-1016` [seen] | Allow listed key types instead of blocking known ones, and pin pi-ai |
| N-12 | **No one owns the null arm.** Every falsifier compares against S-1 tier 2, which does not exist. A comparison against an unbuilt baseline becomes a straw man | medium | W-R1-3; X-9 | Assign tier 2 to someone, and build it before layer-5 numbers are claimed |

## 3. Attacking the convergence

The advocates now mostly agree on three things:
- (a) the official client is the host, and the product is an MCP server with its own store;
- (b) one schema on PGlite and Postgres;
- (c) S-2 as a mandatory spec layer.

**What the agreement hides.**
1. **The agreement comes partly from the method.** Every advocate had to argue for its own repo, and the only organ all of them could use was rea's Evidence record (03-ideas.md point 1). Nobody has produced user evidence for case files or delta gates. The framing's users are still a draft (framing §2), and the need for B-2 is admitted to be unevidenced.
2. **Agreement (a) empties the product.** The model loop goes to the client. Durability of the loop goes to the client (N-4). Identity goes to the client. What is left is a tool server with a ledger, which is close to "S-1 tier 1 with a better rea". The obvious alternative has not been costed: send those changes to rea upstream (`exports`, a durable ledger, the census, the `mutatesSession` split, tar) and keep no new product.
3. **Agreement (b) was reached after one single-connection spike.** N-0 shows that the first two-process test fails silently. In one round the group went from "unknown" to "recommended".
4. **Agreement (c) is growing with no one cutting it** (N-2). "SARIF or in-toto (to decide)" (`a-rea.md:97`) is still open. Nobody has checked whether an existing attestation envelope already carries most of the needed fields [unknown].
5. **What is not on the table at all:**
   - a person working in a GUI (03-ideas.md point 4);
   - a design that does not sit between the agent and its tools;
   - the possibility that by 2030 models with Bash are good enough that the value lies in **checking** answers, not in **producing** them. leanrea's own data already points that way: the bare model was close to the skill (`leanrea.md` §4).

**Outsider candidate O-1: upstream-first, no new product.**
- **Thesis:** contribute 6-8 changes upstream instead of merging. To rea: an `exports` map for evidence, an append-only SQLite log behind O6, the X-6 census, the `mutatesSession` split, a tar/gzip reader, compact and output-off defaults, and an end to sending results twice. To leanrea: the router as versioned data. To absurd: the fence and AB005.
- **Users:** existing rea and leanrea users, through the agent clients they already use.
- **What it beats:** it owns no code, and it leaves CRA and support-period duties where they already sit. It fixes most of the measured defects for everyone.
- **What it loses:** control. It depends on one maintainer, who wrote 59% of the commits (`rea.md` §4). It provides no fleet ledger.
- **What would prove it wrong:** rea's maintainer declines the ledger or the `exports` PR within a set window, or the PRs require more than about 30% of rea's interfaces to change [threshold is an estimate].

**Outsider candidate O-2: a verifier that checks claims after the fact.**
- **Thesis:** do not sit between the agent and its tools. The agent works freely: the official client, Bash and the leanrea skill (Tier 0). It then emits its claims as structured JSON in the S-2 format, each with a `seen` citation (file:offset, or a symbol).
- **How it works:** a separate verifier calls no model. It reruns each `seen` claim with pinned probes from the router pack, in an isolated container, against the artifact's digest. Each claim is marked `verified` (it gets an Evidence record), `refuted`, or `unverifiable` (demoted to `inferred`). It also writes a coverage record.
- **Users:**
  - reviewers who receive agent reports;
  - CI that accepts or rejects them;
  - auditors who need proof of how a result was reached.
- **Organs:**
  - S-2 records, `rea.md` O5 and O7;
  - `leanrea.md` L5 rows reused as verification probes;
  - rea providers;
  - strix closure discipline (`donors.md` row 17);
  - coverage.json (row 18);
  - the isolation layout (row 21).
- **What it beats:**
  - It adds no cost to the first answer, which keeps leanrea's turn saving.
  - It works with any client and any account, so the provider-terms question does not arise.
  - The verifier has no model and no effects on the world, so injection cannot drive it into an action, and the X-2 boundary becomes simple.
  - It needs no durable runtime. Verification can simply be run again.
- **What it loses:**
  - No durable investigations.
  - Only claims that map to a probe can be checked.
  - It relies on agents emitting structured claims.
- **What would prove it wrong:** fewer than about half of the `seen` claims in real agent reports map to a probe [threshold is an estimate], or verification costs more wall time than a Tier 2 run.

**My recommendation for layer 5:** carry four options, (1) the durable case file, (2) the CI sweep and gate, (3) S-1, and (4) **one of O-1 or O-2**, so that at least one candidate does not share the convergence's assumptions. I would choose O-2: it is the only shape whose costs fall as models improve.
