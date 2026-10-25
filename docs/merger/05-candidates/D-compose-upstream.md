# Candidate D: Compose and contribute upstream

Written by a fresh architect agent that did not take part in the debate. Inputs: the charter, journal J-01 to J-06, [gaps.md](../gaps.md), the anatomy files, the idea cards and both debate rounds. Labels: **[seen]** read in the clones at the pinned commits ([sources.md](../sources.md)) or in the debate files; **[inferred]**; **[unknown]**. Line counts for code nobody has written are **estimates**. Anatomy references are written `rea.md O5`, `pi-durable.md organ 6`, and so on. Facts I checked in the clones for this file are cited `repo:path:line`, or "git log at <commit>".

**How to read the verdicts in this file.** D copies nothing. *lift* means "used unchanged as a pinned dependency". *adapt (PR)* means "used after an upstream pull request changes it". *new* is glue code that D owns, with an ordinal size.

## 1. Thesis

Build no new runtime. Ship the parents as a pinned four-tier composition, and use that composition as the null arm every other candidate is measured against (N-12). Send the changes that close the measured defects to the four upstreams, so everyone gets them. Fall back to vendoring only where a PR is declined, and at that point D becomes candidate A or B.

## 2. Who uses it, and three usage scenarios

**Users:**
- existing rea and leanrea users, working in the agent client they already have (Claude Code, Codex, an ACP client);
- tool builders who embed pi-durable or absurd and would benefit from the upstream fixes;
- the owner and the judge, who need a built, measured baseline before any number from A, B or C means anything (N-12, X-9).

**Scenario 1: Tier 1, interactive, on the person's subscription.** "What does this Electron installer do?"
1. The person installs `leanrea/SKILL.md`, pinned by commit, since leanrea has no tags [seen: git log at `09ba4aa`: 4 commits, 0 tags]. They add `rea mcp` to their client config with `REA_MCP_INPUT_SCHEMA_PROFILE=compact` and `REA_MCP_OUTPUT_SCHEMA_PROFILE=off`. That cuts the catalog from 3,211,385 B to 222,396 B (`rea.md` O2, measured). A short skill addendum (about 20 lines, estimate) sets the order: router row first; rea only when checkable Evidence is needed; `detail:"summary"`; then `export_evidence_bundle` to `./re/<sha256>/evidence.json`.
2. The agent runs the asar row through Bash, then calls one rea tool, then exports the bundle.
3. **What the person sees:** an answer with seen/inferred/unknown labels, the Evidence IDs of the rea-backed claims, and the bundle path.
4. Credit comes from the person's own sign-in. The kit stores no credential. If the client crashes, recovery depends on the client's own resume [unknown]. The bundle on disk survives and can be re-imported.

**Scenario 2: Tier 2, a durable 30-probe investigation that is killed at step 17.**
1. The tier-2 host is about 350-600 lines on pi-durable (estimate, `skeptic.md` S-1). It connects to `rea mcp` through pi-mcp and wraps each rea tool as a `defineTool`.
2. After each Evidence-producing call, the host exports the bundle and commits its path and sha256 in a pi-durable document.
3. On reopen, pi-durable settles the in-flight call as `interrupted` unless both replay policies are `safe` (`durable:src/harness/tool.ts:175-196`). The host then restarts rea and calls `open_binary` and `import_evidence_bundle`.
4. **What the person sees:** the CLI reports "resumed at step 17; 1 call interrupted; 16 Evidence records re-imported". Ghidra project state is gone and its analysis reruns (W-S1-1).
5. **Model access** is API keys through pi-ai, behind an allowlist guard. The Mode A recorder (§3 row 9) would use the person's client instead, but that mechanism has not been spiked.

**Scenario 3: Tier 3, an optional fleet over 200 release artifacts in CI.**
1. An absurd queue holds one task per artifact. Each attempt runs a tier-2 host on its own SQLite file, `<task_id>-<attempt>.db`, so the lease-overlap window never puts two writers on one store (`absurd.md` §3 item 2).
2. The checkpoint stores only the bundle digest. After the run, bundles are merged with `import_evidence_bundle`, which merges atomically (`rea.md` O6).
3. **What the platform team sees:** a merged bundle and a per-task status table. There is no cross-fleet SQL and no version-to-version verdict.
4. **Limits:** until the tar PR lands, npm `.tgz` inputs are rejected by rea (`rea.md` O10, measured). Unattended runs exclude tools with `executesForeignCode` or `mutatesDevice` (scope cut).

## 3. Anatomy of capabilities

| # | Capability | Source organ | Verdict | What must change | Licence | Gaps |
|---|---|---|---|---|---|---|
| 1 | Cheap-first routing, traps, labels (Tier 0) | `leanrea.md` L2, L4, L5, L7 | lift | Pin by commit; the addendum overrides the unquoted `$TMPDIR` lines until PR L-3 lands | MIT | X-9 (baseline) |
| 2 | rea MCP server, compact + off profiles (Tier 1) | `rea.md` O1, O2 | lift | Client config only (~20 lines, estimate) | MIT | PERF-2, X-9 |
| 3 | Evidence record, unknowns, bundles as the finding store | `rea.md` O5, O6, O7 | lift | None until R-1..R-3 merge; bundles are the source of truth | MIT | X-1 (inherited), X-5 |
| 4 | MCP-to-`defineTool` adapter (Tier 2) | pi-mcp (`skeptic.md` fact 1); `pi-durable.md` organ 6 | new S (~120) | The pi-mcp README recipe targets `pi-agent-core` `AgentTool`, not `defineTool`, so it has to be re-mapped (`pi:packages/mcp/README.md:34-53`) | MIT | — |
| 5 | Replay map from MCP hints | `rea.md` O3; `pi-durable.md` organ 6 | new S (~30) | `safe` only if idempotent and neither destructive nor open-world; a vendored `mutatesSession` table until R-5 | MIT | X-7 |
| 6 | Bundle checkpoint and rehydrate | `rea.md` O6; `pi-durable.md` organs 1, 4 | new S/M (~150) | Export per Evidence call; on resume `open_binary` then `import_evidence_bundle` | MIT | REL-1, W-S1-1 |
| 7 | Approval, taint and budget hook | `pi-durable.md` organs 6, 10; `rea.md` O3 | new S (~90) | After the first rea result, ask before any destructive or open-world tool; call and byte caps | MIT | X-2 (partial), X-10, AGT-6 |
| 8 | API-key guard for pi-ai | `pi-durable.md` organ 14 | new S (~40) | Allowlist of documented API-key types; refuse `sk-ant-oat`; ignore `ANTHROPIC_OAUTH_TOKEN`; never call `login` | MIT | X-3, N-11, G-pi-ai |
| 9 | Mode A recorder (optional): official client → kit's MCP proxy → pi-durable `ToolTask` | `pi-durable.md` organ 6; `donors.md` rows 9-10 | new M (~200-300) | Gated on the unrun one-day spike (`ToolTask` outside a generation, r2-durable X-3) | MIT | X-3, N-4 |
| 10 | Exclusive open lock on the tier-2 store | `pi-durable.md` §3.3 | new S (~30) | OS lock at open; a second opener is refused. Dropped if PR P-1 lands | MIT | N-1 analogue |
| 11 | Fleet queue, one SQLite file per attempt (Tier 3) | `absurd.md` O2, O3, O4 | lift + new S (150-250) | The checkpoint holds the bundle digest only; bundles are merged afterwards | Apache-2.0 + MIT | W-S1-4 |
| 12 | Null-arm kill test and X-9 harness | `leanrea.md` L10, L11 | adapt (fork) + new M (~400-700) | The fixes from r2-leanrea X-9; the skeptic's decision rule (verified claims per dollar) | MIT | N-12, X-9, N-9 |
| 13 | PRs R-1, R-2: Evidence importable, nested IDs path-free | `rea.md` O5 | adapt (PR) | `exports` `./evidence`; ObservationId as defined in r2-rea X-1 | MIT | X-5, X-1, COR-5 |
| 14 | PR R-3: append-only SQLite log behind the ledger | `rea.md` O6 | adapt (PR) | WAL log replayed by Evidence ID; merge rules unchanged | MIT | REL-1, W-S1-1 |
| 15 | PR R-4: coverage census | `rea.md` O11 | adapt (PR) | The X-6 schema; `complete` only when nothing is unresolved | MIT | X-6 |
| 16 | PRs R-5, R-6: effect split; tar/gzip reader | `rea.md` O3, O10 | adapt (PR) | `recordsEvidenceOnly` class; tar under the 500× budget with the reject classes | MIT | X-7, AGT-2, SEC-8 |
| 17 | PRs R-7..R-11: defaults, single encoding, retry, HTTP auth, S-2 export | `rea.md` O1, O2, O4, O8; `skeptic.md` S-2 | adapt (PR) | See the register below | MIT | PERF-2, INT-4, RL-2 |
| 18 | PRs L-1..L-4: router data, untrusted rule, quoting, harness | `leanrea.md` L3, L5, L6, L10, §3 | adapt (PR) | The router as versioned data, with the prose rendered from it | MIT | X-2, X-8, X-9 |
| 19 | PRs A-1..A-6: fence, migrations, habitat, pins, topics, fetch | `absurd.md` O3, O4, O11, O12, O13, O16 | adapt (PR) | The `fence.mjs` and `events.mjs` prototypes turned into SQL plus tests | Apache-2.0 | W-B1-3, N-6, B-2 |
| 20 | PRs P-1..P-4: storage lease, IDs in the transaction, UNIQUE, bash defaults | `pi-durable.md` organs 2, 8, 11 | adapt (PR) | Lease row at open; `mintId` inside the commit; UNIQUE index; default timeout and an env allowlist | MIT | §3.3, X-10, SEC-6 |

### 3.1 Upstream contribution register

**Acceptance risk** is my estimate: **L** (low), **M** (medium), **H** (high), with the reason.

**What upstream policy requires, in brief:**
- **rea:** every PR needs a named human owner, and AI agents must not make the readiness declaration (`rea:CONTRIBUTING.md:53-57,86-87`). Contract or architecture changes need an issue first (`:3`). Archive and compression extraction, and evidence reporting, are in scope (`:114-117`). Outside PRs do get merged: #994 on 2026-10-07, and #1303, #1382 and #1391 on 2026-10-10, adding 8 to 374 lines each [seen: git log at `b4938ae`].
- **pi:** PRs from new contributors are auto-closed. A PR needs a maintainer `lgtm` on an issue first (`pi:CONTRIBUTING.md:23-34,58`). Issues must be written in the person's own voice (`:43`). The core is kept minimal (`:9`).
- **absurd:** AI use must be disclosed (`absurd:CONTRIBUTING.md:9-12`). The PR template grants Earendil Inc. use of the contribution "under Earendil Inc.'s choice of terms" (`absurd:.github/PULL_REQUEST_TEMPLATE.md:11`).
- **leanrea:** no CONTRIBUTING file; 4 commits, all on one day, by one author [seen].

| ID | Repo: change | Size | Closes | Acceptance risk | Fallback if declined |
|---|---|---|---|---|---|
| R-1 | rea: `exports` map with `./evidence` (no `main` or `exports` today, `rea:package.json:36-44`) | S | X-5 | M: it declares a public API in a repo with 12 BREAKING sections (`rea.md` §4) | Deep import in a CI conformance job only; vendor the 17-file closure (= A's first step) |
| R-2 | rea: nested Evidence IDs without paths (ObservationId) | M | X-1 (part), COR-5 | M/H: changes every composite ID, so it is a contract change and needs an issue first | Vendor O5 with the fix, plus golden vectors (A / S-2) |
| R-3 | rea: append-only SQLite log behind O6 | L | REL-1, W-S1-1 (part) | H: new persistent state in an in-memory, per-connection design (`rea.md` O6) | Keep the tier-2 bundle checkpoint; an own store = candidate A |
| R-4 | rea: X-6 coverage census | L | X-6 | M: in scope as evidence reporting; large AST work; noisy at first | The glue reads rea's `complete` as `partial`; a census in a fork = candidate B |
| R-5 | rea: split `mutatesSession` (`rea:src/contracts/toolEffects.ts:4,46-53`) | S | X-7, AGT-2 | L/M: one file, no imports; it changes the MCP hints | Vendored table in row 5 (D keeps working) |
| R-6 | rea: tar/gzip reader under the decompression budget | M | Pre-mortem 11, SEC-8 | L: "standard compression extraction" is in scope (`rea:CONTRIBUTING.md:114-117`) | Tier 3 excludes `.tgz`; a vendored reader = B |
| R-7 | rea: compact + output-off as the default | S | PERF-2 | M: drops `outputSchema` (INT-2 4) for clients that use it | Client env config (already in tier 1) |
| R-8 | rea: stop sending results twice (documented, `rea:docs/mcp-contracts.md:10-14`) | S/M | PERF-2 | M/H: deliberate client compatibility | Use `detail:"summary"` (20,829 B against 178,983 B, r2-rea W-R2-3) |
| R-9 | rea: `invalid_request` not retryable (`rea:src/domain/analysisErrorProjection.ts:569-576`) | S | INT-4 | L: a clear defect | The glue treats it as non-retryable |
| R-10 | rea: per-instance bearer token on HTTP | M | RL-2, `rea.md` O1 | L/M: the bridges already use tokens | stdio only; HTTP is never enabled |
| R-11 | rea: S-2 v1 (record plus two IDs, N-2) as the bundle export format, starting as a design issue | M | W-S2-3, N-2 | H: a second format to maintain | A converter outside rea (C's layer) |
| L-1 | leanrea: router as versioned data with fixtures, prose rendered from it | M | X-8, W-S1-2 (part) | H: it changes what the repo is (a prompt); one maintainer; no process | A separate MIT router pack with the notice: the asset A, B and C share |
| L-2 | leanrea: untrusted-content rule (none today, `leanrea.md` §3) | S | X-2 (prose only) | L | Put it in the tier-1 addendum |
| L-3 | leanrea: quote variables, default `$TMPDIR`, unescape `\|`, pin `npx` | S | RL-4, `leanrea.md` L3, L6 | L | Override in the addendum |
| L-4 | leanrea: harness fixes (timeout row, no raw-stdout grading, key self-test, full argv) | M | X-9, `leanrea.md` L10 | M | Fork the harness (row 12 needs it anyway) |
| A-1 | absurd: lease fence AB004, plus AB005 for a timeout of 0 or less | M | W-B1-3, `absurd.md` O3 | M: it fits the admitted overlap (`absurd:CONTRIBUTING.md:107-110`); one extra row lock per write, cost unmeasured | Tier 3 keeps one file per attempt; a fence fork = B's multi-worker mode |
| A-2 | absurd: transactional migrations (no `BEGIN` in any migration file [seen, grep]) | S/M | N-6, `absurd.md` O13 | M: touches their release-time `/make-migrations` flow (`:33-36`) | The kit applies migrations with `--single-transaction` |
| A-3 | absurd: habitat on loopback by default (`:7890` today, `absurd:habitat/internal/config/config.go:15`), with auth | M | OPS-3, pre-mortem 8 | L/M | Tier 3 does not run habitat |
| A-4 | absurd: actions pinned by SHA (tags today, `absurd:.github/workflows/test.yml:13-24`) | S | SEC-5 | L | None needed for users; recorded as a supply-chain note |
| A-5 | absurd: sequenced topics (`events.mjs`) | M | W-B2-1 | M/H: new API; need unproven (W-B2-2) | Not used by D |
| A-6 | absurd: digest check on absurdctl's remote SQL fetch | S | RL-4, `absurd.md` O11 | L | Install only the bundled SQL, pinned by digest |
| P-1 | pi: storage owner lease | M | §3.3 item 1 | H: "no cross-process locking" is stated design (`durable:README.md:783`); "core is minimal" | The row 10 lock (D keeps working) |
| P-2 | pi: mint IDs inside the transaction (`durable:src/storage/sqlite/storage.ts:212-216`) | S/M | §3.3 item 2 | M | Single writer enforced by row 10 |
| P-3 | pi: UNIQUE (conversation, request_id) (`durable:src/storage/sqlite/migrations.ts:63`) | S | §3.3 item 3 | M: a schema migration | Row 10 |
| P-4 | pi: bash default timeout and env allowlist (`durable:src/tools/bash.ts:12`) | S | SEC-6, `pi-durable.md` organ 11 | M | Tier 2 does not register pi's coding tools |

## 4. Integration surfaces

- **MCP, CLI and SDK:**
  - `rea mcp` over stdio, to the client (tier 1) or to pi-mcp (tier 2);
  - the tier-2 host CLI (`kit run`, `kit resume`, about 100 lines);
  - pi-durable's `defineTool` and `beforeTool`;
  - absurd's TS SDK (tier 3);
  - the Mode A recorder would expose an MCP proxy.
  D adds no tool to rea's 208.
- **Storage.** There is one store for findings: **rea's own record**. Today that is the exported bundle files. After R-3 it would be rea's append-only log. The other stores hold no findings:
  - pi-durable's SQLite holds the transcript, the intents and the bundle digest;
  - absurd's Postgres holds queue and lease state.
  So there are still two or three stores of state side by side. This is why D has no atomic commit (§9).
- **Identity and accounts.** Sanctioned delegation only.
  - **Tiers 0-1:** the person's official client owns the loop and the sign-in, so subscription credit applies where the provider allows it. The kit stores 0 credentials.
  - **Tier 2:** API keys through pi-ai with the row 8 guard. Or Mode A, where the official client drives and pi-durable only records tool calls. Mode A uses subscription credit but is unproven.
  - **pi-ai's Claude subscription login is excluded** (G-pi-ai). Tier 2 as built by S-1 has no guard, which is a guardrail risk the judge recorded; row 8 closes it.
  - **Tier 3** is unattended: API keys, or a headless official client if the owner rules that the terms allow it (G-terms).
- **Other tools:**
  - rea bundles are canonical JSON, which external attestation tools could sign [inferred];
  - SBOM, advisories and support periods stay with each parent (rea ships `SECURITY.md`; leanrea and absurd have SEC-1 0);
  - CI runs the row 10 lock test, the row 12 kill test and the X-9 protocol in the kit's own repository.

## 5. Architecture sketch

```
 person ─TB5─> official client (own sign-in, own approvals) ── Tier 0: Bash + SKILL.md (host parsing, TB1 unguarded)
                    │ MCP stdio                                 Tier 1: + rea mcp (compact/off)
                    ▼
 [Tier 2] kit host (pi-durable SQLite: intents, transcript, bundle digest) ─pi-mcp─> rea mcp ─TB1─> artifact bytes
          beforeTool gate (TB3) · API-key guard (TB5) · open lock (TB4)              │ export
                    ▼                                                                ▼
 [Tier 3] absurd queue (Postgres: task, lease, bundle digest) ──> one host per attempt ──> bundles ─merge─> report
 TB2: tool output → model context, protected only by rea's _meta marker (whether pi-mcp keeps it is unknown)
 TB7: four pinned upstreams · TB8 (D only): upstream maintainers decide what lands, and when
```

**Trust boundaries, as numbered in r2-leanrea SEC-1:**
- **TB1:** artifact bytes into rea's hardened readers, or into host tools (tier 0 has no container).
- **TB2:** tool output into the model's context, carrying rea's untrusted marker.
- **TB3:** model to effects. The client's approvals apply in tiers 0-1; the `beforeTool` gate applies in tier 2.
- **TB4:** the glue to its stores.
- **TB5:** the product to the provider account. Delegation in tiers 0-1; guarded keys in tier 2.
- **TB6:** local listeners. None by default.
- **TB7:** the pinned upstreams.
- **TB8:** governance. It is new to D, and it is not a security boundary.

## 6. The three critical gaps

- **X-1 identity: not fixed by D itself.**
  - D proposes R-2 (ObservationId with nested paths removed) and offers rea's existing path-free `analysisQueryId` (`rea:src/domain/analysisSnapshot.ts:354-367`) as the basis for a ProbeKey, inside R-2's design issue.
  - **Until R-2 merges,** replay in tier 2 is keyed by pi-durable's tool intents, not by Evidence IDs, so X-1's replay problem does not arise. The nested path defect does remain. A partial workaround is to always open targets at `./re/<sha256>/` [inferred]: that makes IDs stable on one host only.
  - **FindingKey is not offered.** No normaliser is proposed upstream, because its design is still paper (W-R2-1).
  - **Status:** paper, depending on R-2.
- **X-2 untrusted content: measured, not enforced.**
  - **Tiers 0-1:** the client's approvals, rea's default-untrusted marker (`rea:src/contracts/toolEffects.ts:743-766`) and, if L-2 merges, a prose rule. Labelled **unenforced**.
  - **Tier 2:** row 7's gate asks before every destructive or open-world tool once a rea result is in context. It is only as accurate as the hints: readOnly is set on 5 of 208 tools until R-5 (`rea.md` O3).
  - **D runs the X-2 tripwire set** (24 or more fixtures, at least 120 runs, including a second MCP server) against tiers 0-2 as the baseline other candidates must beat. The outcome is unknown. It most likely fails part (b) in tiers 0-1 [inferred].
  - **Status:** test-gated; enforcement is A's and B's territory.
- **N-1 store safety with several processes: PGlite is not used, but the analogue exists.**
  - pi-durable's SQLite has no owner lease, and two openers can silently overwrite task records (`pi-durable.md` §3.3; `durable:README.md:783`).
  - D adds row 10's exclusive open lock until P-1 lands. Tier 3 avoids shared stores by using one file per attempt.
  - **Test:** 100 attempts to open a second process are all refused. **Status:** paper until the test runs.

## 7. Other gaps

- **Resolves, for every user of the parents, if the PRs merge:**
  - X-5 (R-1), X-6 (R-4), X-7 in part (R-5);
  - pre-mortem 11, tar (R-6);
  - rea's O1, O4 and O8 defects (R-8 to R-10);
  - N-6, by sending the absurd fork's content upstream (A-1, A-2);
  - pi-durable's §3.3 holes (P-1 to P-3).
- **Resolves without any upstream:**
  - N-12: D builds and owns tier 2 and its kill test;
  - X-9: D runs the protocol with the skeptic's replacement rule, so N-9 does not apply to it;
  - X-3 in tier 2, through the row 8 guard;
  - N-5: one store for findings.
- **Inherits:**
  - G-terms; N-4 (the client's loop is not durable);
  - EPI-2, since no calibration is proposed;
  - SEC-6: bundles keep target secrets, and rea will not infer secrecy (`rea:AGENTS.md:13`), so this is unlikely to be accepted upstream;
  - SEC-1 at the parents' levels; X-8 (leanrea is macOS-first; native Windows is not covered); N-8; N-3.
- **Makes worse:**
  - four pins to keep current;
  - no single support contact;
  - export cost that grows quadratically with long investigations (`skeptic.md` S-1);
  - Ghidra state lost on resume (W-S1-1);
  - three state stores in tier 3.

## 8. Target RQS-2030 levels

**Profile.** Tiers 0-1 are skill-pack plus agent-tool. Tier 2 is agent-harness (`round-1-judge.md` S-1).

**Baseline.** The judge's S-1 row: REL-1 3 · INT-5 2 · EPI-4 2 · PERF-2 2 · AGT-1 1 · SEC-8 2 · AGT-6 2. Tier 2 is blocked by AGT ≈ 1.7 and SEC ≈ 1.5.

**Design intent, if the named PRs merge (capped at 3):**

| Criterion | Target | Depends on |
|---|---|---|
| INT-5 | 3 | R-2 |
| EPI-4 | 3 | R-4 |
| PERF-2 | 3 | R-7, R-8, or summary detail; measured, not assumed |
| REL-1 | 3 | Tier 2; rea's own REL-1 would rise from 2 with R-3 |
| AGT-6 | 3 | Row 7 |
| AGT-1 | 2 in tier 2, 1 in tiers 0-1 | — |
| SEC-8 | 2 | Host parsing remains |

**Decisive criteria:** REL-1, INT-5, AGT-1. **Weakest parents:** leanrea D 40.3 and absurd D 44.7, both with SEC-1 0. Their levels pass through to D unchanged, because D owns no fix for them beyond PRs L-2 and A-3.

## 9. What it gives up versus A, B and C

D is the null option, so this section lists what each candidate has that D cannot have, and whether an upstream change would close the difference.

| Capability | Candidate | Can D get it? | Through upstream? |
|---|---|---|---|
| Step row, Evidence and unknown revision in **one transaction** | A | No. rea's log (R-3) and pi-durable's transcript stay separate stores; the loss window is at most one tool call [inferred] | No. It needs one owner of both records |
| Input-derived ProbeKey replay that survives hosts | A, B | Partly | Yes, if R-2 and a ProbeKey are accepted (judge's caveat) |
| FindingKey verdicts across versions, gate fails closed | B | Coverage only, via R-4 | Partly: R-4 yes; the normalisers are not proposed |
| Enforced taint boundary, client without a shell, container per attempt | A, B | No; the shell stays with the client in tiers 0-1 | No: it is product-owned execution |
| Shared fleet ledger under a fenced lease | B (multi-worker) | No; bundles are merged after the run | A-1 gives the fence, not the ledger |
| Model-free re-check of an agent's claims | C | No | R-11 gives only the format |

**The judge's caveat, applied.** A's and B's lead over D on identity and coverage disappears if R-2 and R-4 merge. What remains is transactional atomicity, enforcement, the fleet ledger and C's verifier. None of these is an upstream change; each needs code that a product owns.

The PR register in §3.1 also helps A, B and C, because it shrinks what they would have to vendor. It can run alongside any of them.

## 10. Trade-offs and risks

- **Dependence on a few maintainers.**
  - rea: one maintainer wrote 59% of the 6.5.0 commits (`rea.md` §4), and 1,960 of 3,780 commits at `b4938ae` (52%; author identities not merged) [seen: git shortlog].
  - pi-durable: 128 of 175 commits from 2026-09-11 to 2026-10-19 come from one author (73%) [seen: git log].
  - absurd: 285 of 313 commits come from one author (91%) [seen].
  - D's upstream arm moves at their pace and within their scope. The core rea PRs (R-2, R-3, R-11) are exactly the kind of change that needs an issue and a scope decision first.
- **Human cost.** rea and pi require a human owner who wrote and can explain each PR, and pi wants issues in the person's own voice. The owner's side therefore needs a named person. An agent alone cannot run the program.
- **Churn.**
  - rea shipped 12 releases from 2026-10-05 to 2026-10-18, including majors 4.0.0, 5.0.0 and 6.0.0 (`rea:CHANGELOG.md:3-1396`).
  - pi-durable shipped 8 from 2026-10-01 to 2026-10-15 (`durable:CHANGELOG.md:42-179`) and is "Experimental. The API changes without notice" (`durable:README.md:3`).
  - Accepted PRs ship quickly. Every pin bump can break the glue.
  - absurd is the opposite: 0.5.0 was released on 2026-08-04 and 0.5.1 on 2026-10-20 [seen: git log], so A-1 could wait months for a release.
- **Licence and contribution terms.** absurd's contribution grant lets Earendil Inc. relicense the contributions. The owner must accept that before filing A-1 to A-6.
- **2030-35 trends:**
  - **Better models** favour D. Tier 0 improves for free, and D owns no code whose value falls as models improve.
  - **The CRA** leaves manufacturer duties with the parents, which is D's advantage. It is also D's limit: D cannot give its users CRA evidence the parents do not produce. Shipping the kit as a commercial product could make its distributor a manufacturer [inferred, not legal advice].
  - **With agents as the main callers,** rea's default 3.2 MB catalog stays an issue unless R-7 merges or hosts load tools on demand.
- **Divergence.** An upstream may accept a different design from the one proposed, for example persistence in another form. D adapts to it. A, B and C would have to re-vendor.

## 11. Size

- **Owned code (estimates):**

  | Part | Lines |
  |---|---|
  | Tier 0 | 0 |
  | Tier 1 config and addendum | ~20 |
  | Tier 2 | 350-600, plus rows 8 and 10 (~70) |
  | Mode A recorder (optional) | 200-300 |
  | Tier 3 | 150-250 |
  | Kill test and X-9 harness | 400-700 |
  | **Total** | **≈1.2k-2k (ordinal S-M)** |

- **Upstream code written by the owner's side:**
  - 4 L-sized or M/H-risk rea PRs: R-2, R-3, R-4, R-11. R-3 and R-4 are each roughly 1-2k lines with tests, an estimate.
  - About 21 S or M PRs across the four repos.
  - Once merged, all of it is owned upstream.
- **Upstream dependencies:** four, pinned, with the churn above. pi-durable, pi-mcp and pi-ai version in lockstep.
- **People (estimates):**
  - about 0.25 FTE to keep the kit and bump pins;
  - about 0.5 FTE for 3 months as human owner of the PRs;
  - upstream review time, which the owner cannot control.

## 12. What would prove it wrong

Thresholds are estimates unless they cite a source.

1. **Upstream declines the core.** Within **90 days** of filing, rea declines **2 or more of R-2, R-3 and R-4**, or gives no maintainer response. Or the accepted designs need **more than 30%** of rea's 208 tool contracts to change (O-1). Then the upstream arm has failed, and D becomes A (vendor O5, O6 and O7 into an own store) or B.
2. **The tier-2 kill test fails.** On a 30-probe script, kill at k ∈ {5, 15, 25}, 10 reps each. **Any** run that loses more than 1 call's Evidence or any unknown, or a rehydration whose Evidence set differs from the one before the kill, fails tier 2. The null arm then falls back to tier 1, and A's margin widens.
3. **Exports are too slow.** Bundle export takes **more than 10%** of wall time by step 50 (`skeptic.md` S-1).
4. **Another candidate clearly beats D.** On X-9 (60 paired cells, task-level bootstrap), the best other candidate's ratio of correct-and-verified claims per dollar over the best D tier has a **lower 95% bound above 1.2**. D is then the wrong choice for that user. If the ratio's interval includes 1.0, that candidate folds into D plus its PRs.
5. **The lock fails.** A second process gets past the row 10 lock in **1 or more of 100** attempts.
6. **The guardrail is broken.** A network capture of tier 2 shows any `claude-cli` user agent or OAuth token. Tier 2's key mode is withdrawn.
7. **Maintenance outweighs ownership.** Pin bumps average **more than 2 person-days a month** over 3 months, or rea releases break the glue **more than twice a quarter**. The ownership-and-speed argument (the judge's caveat) then favours A or B.

## 13. The owner decisions it depends on

From [06-options.md](../06-options.md) and the judge's list (`round-2-judge.md` §4):
- **#1, more than one worker?** No means tier 3 stays optional. Yes means D needs A-1 merged, or it turns into B.
- **#3, provider terms (G-terms):** decides tier 3's model access and whether Mode A may be used.
- **#5, Windows:** D inherits "not covered".
- **#6, host-only parsing on macOS:** tiers 0-1 are host-only by construction.
- **#9, CRA role and support period:** D's answer is "none of its own", and the owner must accept what follows from that.
- **#10, unenforced skill mode:** this is most of D.

Decisions specific to D:
- **(a)** Who is the named human owner of the PRs, and for how long?
- **(b)** Is absurd's contribution grant acceptable?
- **(c)** How long is the decline window? 90 days is proposed above.
- **(d)** Is tier 2 built as the null arm whichever candidate wins? I recommend yes, because N-12 applies to every candidate.
- **(e)** How much weight should ownership and speed carry against capability? This is the judge's caveat, and it is the real choice between D and A or B.
