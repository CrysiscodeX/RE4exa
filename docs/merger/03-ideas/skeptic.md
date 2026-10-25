# 03 Ideas: the skeptic (two contrarian cards, a pre-mortem, test questions)

Role: Skeptic, layer 3. Inputs: [charter](../00-charter.md), [framing](../02-framing.md), [journal](../journal.md) J-01 and J-02, and [01-anatomy/](../01-anatomy/). Anatomy citations are written `file.md organ` (for example `rea.md O5`, `pi-durable.md organ 6`, `donors.md row 9`). Statements I checked again in the clones are cited `repo:path:line` at the pinned commits. Labels: **[seen]**, **[inferred]**, **[unknown]**. Line counts for code that does not exist yet are **estimates**.

**Four facts I added by checking the clones.** None of them is in the anatomy files.
1. pi already ships an MCP client: `@earendil-works/pi-mcp`, "standalone Model Context Protocol client for pi and other applications" (`pi:packages/mcp/package.json:2-4`). Its client and transports come to 1,473 lines, and its README has a 15-line recipe that wraps every MCP tool as a pi agent tool (`pi:packages/mcp/README.md:34-53`) [seen]. So joining rea to pi needs no new protocol code.
2. rea's npm package `rea-agents` has `bin` entries and no `main` or `exports` field (`rea:package.json:2,41-44`; grep finds neither field) [seen]. rea's Evidence schema therefore cannot be imported as a library. To an outside program, Evidence is JSON in bundle files.
3. Tool effects default to `idempotent: true` (`rea:src/contracts/toolEffects.ts:36-43`). Over MCP they appear only as four derived hints: `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint` (`:718-741`) [seen]. Glue code can derive a pi-durable `replay` policy from those hints, but not from the ten raw booleans.
4. A rea session holds one active target (`rea:src/contracts/sessionToolContracts.ts:72,77`). The bundle tools write to and read from a path the caller supplies (`:85-93`) [seen]. After a restart, a new rea process has to reopen the target and import the bundle again before any replay.

## A. Contrarian concept cards

### S-1 Compose, don't merge (the strongest null option)

- **ID:** S-1. **Name:** Pinned composition kit.
- **Thesis:** Keep all four repositories as they are, pin their versions, and add a few hundred lines of glue. That gives most of what a merger promises at a small fraction of the code a merged product would have to own.
- **Users and scenario:** An agent in a coding or security session, and an analyst running an investigation over several days (framing §2, rows 1-2). Example: "What does this Electron installer do?" The cheap path answers first. If the question is still open, rea is called. If the process dies, the work resumes from the last recorded tool call.
- **What composition looks like, in three tiers:**
  - **Tier 0, no glue (0 lines).** The person installs `leanrea/SKILL.md` (8,374 bytes, [seen]) into their official agent client. The agent works through Bash. This is the baseline arm of leanrea's benchmark (`leanrea.md` L10, §4).
  - **Tier 1, configuration only (about 20 lines of client config and skill text, estimate).** The same client also runs `rea mcp` over stdio, with `REA_MCP_INPUT_SCHEMA_PROFILE=compact` and `REA_MCP_OUTPUT_SCHEMA_PROFILE=off`. That shrinks the catalog from 3,211,385 B to 222,396 B (`rea.md` O2). A short skill addendum gives the order: leanrea's router first; rea only when the router row has no answer or when checkable Evidence is needed; then `export_evidence_bundle` to `./re/<sha256>/evidence.json` after each finding.
    - Durability: the exported bundle on disk, plus whatever session resume the client itself offers [unknown].
    - Accounts: the official client handles its own sign-in, so the kit stores no model credentials [inferred]. This is the only tier that meets the account guardrail by construction.
  - **Tier 2, durable host (about 350-600 lines of TypeScript, estimate).** A small program on `@earendil-works/pi-durable` with SQLite. It has six parts:
    - (a) an adapter, about 120 lines, that connects `pi-mcp`'s `McpClient` and `StdioTransport` to `rea mcp` and turns each listed tool into a `defineTool`;
    - (b) a replay map, about 30 lines: a tool gets `replay: "safe"` only if `idempotentHint` is set and `destructiveHint` and `openWorldHint` are both unset. Every other tool keeps the default `unsafe` (`pi-durable.md` organ 6; `durable:src/harness/tool.ts:175,185`);
    - (c) a bundle checkpoint, about 150 lines. After each rea call that records Evidence, it exports the bundle and commits the bundle's path and sha256 in a pi-durable document. On resume it starts rea again, calls `open_binary`, then `import_evidence_bundle`;
    - (d) a `beforeTool` approval hook, about 60 lines. It asks the person before any tool with `destructiveHint` or `openWorldHint` runs (charter: approvals on);
    - (e) leanrea's `SKILL.md` loaded as a prompt section, about 20 lines;
    - (f) a CLI entry point and configuration, about 100 lines.
    - Accounts: model access goes through pi-ai with API keys only. pi-ai's subscription OAuth is **leave** (`pi-durable.md` organ 14).
  - **Tier 3, fleet (optional, about 150-250 more lines, estimate).** An absurd queue holds one task per artifact. Each attempt runs a Tier 2 host with its own SQLite file, named `<task_id>-<attempt>.db`, so that during absurd's lease-overlap window two attempts never write to one store (`absurd.md` §3 item 2; `pi-durable.md` §3.3). The absurd checkpoint stores only the bundle's path and digest, because jsonb values have no size limit (`absurd.md` O1). Unattended runs exclude tools that run foreign code or change a device; that is a scope cut.
- **Organs used:** `leanrea.md` L2, L4, L5, L7. `rea.md` O1, O2 (compact profile), O3, O5, O6, O7, O11. `pi-durable.md` organs 2, 4, 5, 6, 8, plus pi-mcp (fact 1 above). `absurd.md` O2, O3, O4 (Tier 3 only). Nothing is copied: every part is used as a pinned dependency.
- **What it beats a real merger on:**
  - It owns about 0.5-1k lines instead of several tens of thousands [estimate]. That avoids absorbing rea's 352k production lines and 38 releases with 12 BREAKING sections (`rea.md` §4 concessions), and pi-durable's "API changes without notice" (`pi-durable.md` §4).
  - It is available now.
  - Each tier can be measured on its own against Tier 0.
  - Tier 1 is clean on accounts.
  - Upstream fixes reach users when a pin is bumped.
- **What it loses against a real merger:**
  - **No atomic commit between Evidence and the transcript.** At most one tool call's worth of Evidence can be lost per crash, in Tier 2 [inferred].
  - **Export cost grows with the investigation.** Each export rewrites the whole bundle, so the total grows quadratically over a long investigation [inferred; the size is unmeasured].
  - **Every carried defect stays until upstream fixes it:**
    - nested `local_path` in Evidence IDs (`rea.md` O5);
    - no tar or gzip (O10);
    - each result sent twice (O4);
    - coverage that overclaims (O11);
    - pi-durable's single-owner store (§3.3);
    - absurd's expired leases that still accept writes and its lease of 0 that never expires (`absurd:sql/absurd.sql:937,946-948,1602-1612`, [seen]).
  - **No product surface that belongs to it:** four sets of documentation and four version pins.
  - **Cheap-first routing is prose, not policy** (`leanrea.md` L2).
  - **No coverage document for the whole investigation** (`rea.md` O7 defects).
- **Integration surfaces:**
  - MCP stdio, as rea's server and pi-mcp's client;
  - pi-durable's `defineTool`, `beforeTool` and documents;
  - Evidence bundle JSON files on disk;
  - absurd `spawn`, `step` and `claim` (SQL);
  - `SKILL.md` text.
- **Fit for 2030-35:**
  - Good on local-first operation, on agents as the main callers, and on bring-your-own account (Tier 1).
  - Fair on proof: bundles are canonical files that external attestation tools could sign [inferred].
  - Weak on fleet operation: two durability models live side by side (`pi-durable.md` §5.3, "Null option").
- **Its own weak spots:**
  - Tier 2 inherits pi-ai's credential model.
  - The replay map is only as good as rea's hints: `readOnlyHint` is true for 5 of 208 tools (`rea.md` O3).
  - A rea process restarted after a crash has lost its engine projects, such as ephemeral Ghidra databases (`rea.md` O15), so a "resume" can re-run expensive analysis.
  - The person has to install and pin four things.
- **What would prove it wrong:**
  - A Tier 2 prototype loses more than one tool call's Evidence in kill-at-step-k tests.
  - Rehydration through `open_binary` plus `import_evidence_bundle` fails or diverges.
  - Bundle export takes more than about 10% of wall time by step 50 [threshold is an estimate].
  - Or someone names a needed capability that requires changes inside rea or pi-durable rather than glue around them: one ledger that spans targets, transactional enqueue of evidence, or a single coverage record.

### S-2 The product is a claim format, not a runtime

- **ID:** S-2. **Name:** Evidence protocol and conformance suite.
- **Thesis:** The four repositories share no organ (J-02, point 1). The only thing worth unifying is how a claim about an artifact is written down and checked again later. So publish that as a versioned specification with a small reference library and a conformance suite, and let any analyser or durable engine produce it.
- **Users and scenario:**
  - A platform or supply-chain team that wants records from rea, from a Bash-driven agent (leanrea) or from Ghidra scripts to land in one store and verify the same way.
  - A tool builder who wants to emit claims without adopting rea (framing §2, rows 3-4).
- **Organs used:**
  - `rea.md` O5 (Evidence record and ID, a 17-file closure), O7 (residual unknowns), O3 (effect vocabulary);
  - `leanrea.md` L4 (seen, inferred and unknown, as a required field);
  - `donors.md` row 18 (strix `coverage.json`: unexamined is not clean), row 24 (input-digest measurement record) and row 17 (closure states);
  - `pi-durable.md` organ 16 (the shape of its conformance kits).
- **The pieces:**
  - **The specification**, with three fixes:
    - Evidence IDs that are independent of path at every level of nesting (the `rea.md` O5 defect);
    - a coverage record that names the loading forms checked, not only the files (J-02);
    - a required `examined/not_examined` block.
  - **A reference library** in TypeScript, rewritten from rea's 2,839-line closure. A full rewrite is required because rea exports no library (fact 2).
  - **An append-only store** for records: SQLite in WAL mode, keyed by Evidence ID.
  - **Converters** from rea bundles and from labelled prose answers.
  - **Conformance fixtures.**
  - Size: about 3-5k lines (estimate).
- **What it beats a real merger on:**
  - It is the smallest durable asset, and it outlives any one tool.
  - It sidesteps the choice between pi-durable and absurd entirely.
  - It matches the 2030-35 force toward "proof of how a result was reached" (framing §4).
  - It takes nothing from the guardrails: no accounts, no agency.
- **What it loses against a real merger:**
  - Investigations do not survive a crash, since there is no runtime.
  - No cheap-first routing, no fleet operation, no context savings.
  - Its value depends on others adopting it, which no repository here has shown it can achieve. leanrea has no version (`leanrea.md` L13); absurd's pattern doc has gone stale (`absurd.md` O15).
- **Integration surfaces:**
  - JSON Schema and canonical JSON;
  - a CLI that verifies a bundle;
  - an import path from rea's `export_evidence_bundle`.
  - Possibly in-toto or SLSA envelopes. rea's record already has a `predicate_type` field (`rea.md` O5), which suggests in-toto Statement alignment. That alignment is **[inferred]**: I did not check the in-toto or SLSA specifications for this document.
- **Fit for 2030-35:**
  - Strong on CRA and AI Act traceability, if a recognised attestation envelope carries the format [inferred].
  - Neutral on agents.
  - Weak on durability, which framing §4 expects of any run longer than a few minutes.
- **Its own weak spots:**
  - A content-addressed record proves integrity, not truth. A model can assemble a well-formed record around a fabricated claim, and the `analyst-inference` authority class does not stop that (`rea.md` O5).
  - Confidence classes are not calibrated (`rea.md` O5 defects; `donors.md` row 22).
  - Records cannot be re-verified automatically, because no donor re-executes proofs (`donors.md` row 17).
  - A specification with one implementation is a library with extra paperwork [inferred].
- **What would prove it wrong:**
  - Users need resumable investigations more than portable claims. One test: in an interview set or a usage log, crash recovery is asked for more often than cross-tool verification.
  - Or a converter from leanrea-style prose into records produces more than about 20% records that fail re-checking on a fixture set [threshold is an estimate].
  - Or an existing attestation format already carries everything the record needs.

## B. Pre-mortem: a merged product was built and had failed by 2030

| # | Likely cause | Evidence | Severity |
|---|---|---|---|
| 1 | It **did not beat "a strong model, Bash and 8 KB of notes"** on cost per answer. Agents and people went around it | lean/rea cost ratio 0.65 and lean was faster in all 12 paired cells; only 17 of 112 REA-arm calls used REA tools (`leanrea.md` §4) | critical |
| 2 | **Two durable engines, joined by an adapter, never became safe for more than one writer.** The lease-overlap window plus pi-durable's ID cache at open let two owners silently overwrite task records | `pi-durable.md` §3.3 items 1-3; `absurd.md` O3 defects and §3 items 2, 7 | critical |
| 3 | **Upstream churn.** The merge forked moving targets and fell behind, or kept rebasing and stalled | rea: 38 releases with 12 BREAKING sections in 3 months (`rea.md` §4); pi: "API changes without notice" (`pi-durable.md` §4.6); leanrea has no versions (`leanrea.md` L13) | critical |
| 4 | **Too much owned code for too few maintainers.** "Lifts" became rewrites | 352k production and about 502k test lines; organ closures of 90-120 files; one maintainer wrote 59% of the commits (`rea.md` §4, §5) | high |
| 5 | **Prompt injection through target content** caused a harmful action under durable, approved-once agency. Trust was lost after one incident | No injection evaluation in rea (`rea.md` O12, O19); none in leanrea (`leanrea.md` §3); pi-durable treats it as out of scope (`pi-durable.md` §4.5) | high |
| 6 | **Provider terms blocked subscription use**, and the "your own account" pitch fell back to API keys | Terms are unknown (`donors.md` row 9, §4); pi-ai's OAuth presents as Claude Code (`pi-durable.md` organ 14) | high |
| 7 | **Evidence lost credibility.** Users found that IDs changed with the path and that "complete" coverage had missed edges | Nested `local_path` (`rea.md` O5); the `new URL(…, import.meta.url)` edge missed while coverage said complete (`rea.md` O11) | high |
| 8 | **A shared deployment failed a security review**, or was exploited | rea's HTTP transport has no authentication (`rea.md` O1); habitat listens on all interfaces with an unauthenticated write endpoint (`absurd.md` O12); absurdctl applies SQL fetched from GitHub with no digest check (`absurd.md` O11) | high |
| 9 | **Postgres killed local-first**, or keeping two backends doubled the test matrix | `pi-durable.md` §5.3 ("cost of the alternative"); `absurd.md` §4 (code cannot run on SQLite; PGlite unknown) | medium |
| 10 | **Fleet runs overspent.** Crashes re-sent model requests, and there was no budget | `pi-durable.md` organ 7 and §3.1, the generation `request` row; §4, no per-run budget | medium |
| 11 | **Missing formats.** It could not inventory npm tarballs or work well on Linux CI, which is what supply-chain teams run | No tar or gzip (`rea.md` O10); leanrea is macOS-first (`leanrea.md` §3); several rea tools run only on Linux x64 or only on macOS (`rea.md` §3) | medium |
| 12 | **It never proved it was better.** Benchmarks stayed small and keyword-graded, so buyers could not tell it apart from the null option | 12 paired cells; lean/none wall 0.81 [0.62, 1.04] (J-02); lenient keys (`leanrea.md` L10) | medium |

## C. Questions every idea must answer in layer 4

1. **Writers.** Single writer or multiple writers? If multiple, which fence rejects a write from an expired lease, and what happens in absurd's overlap window? If single, why is absurd in the design (`absurd.md` §5)?
2. **Evidence identity and source of truth.** Who mints Evidence IDs? Are they independent of path at every nesting level? Which store is authoritative for a finding: rea's ledger, the durable engine, or a new one?
3. **Atomicity across the join.** Do the Evidence record and the tool intent or transcript entry commit in one transaction? If not, what is the measured loss window per crash, beyond S-1's one tool call?
4. **Side effects on replay.** For each tool class, what happens after a crash mid-call: rerun, settle as interrupted, or dedupe by key? The classes are: static read, extraction, running the target, changing a device, a model request.
5. **The untrusted-content boundary.** Where does target-derived text stop being able to act as instructions? How is that enforced in code rather than prose, and which adversarial test shows it holds?
6. **Context cost per answer.** Give bytes to start, bytes per answer and turns per task, measured with at least 5 interleaved reps against the Tier 0 arm (model, Bash and `SKILL.md`). Does it beat that arm, or at least match lean/rea's 0.65 cost ratio while adding checkable evidence?
7. **Accounts.** Which hosts and providers, under which sanctioned sign-in? What does the product do if a provider's terms forbid a third party driving its official CLI or SDK? How many credentials does the product itself store?
8. **Platform and format reach.** Which OS × format cells are tested in CI, and which are declared not covered? At least: tar/gzip, Windows, Linux-only and macOS-only tools.
9. **Ownership and upstream.** Which parts are forked, which are dependencies, and which are rewritten? How many lines does the product own? How are upstream breaking changes absorbed, and by whom?
10. **The capability only a combination has.** Name it, and show why S-1's composition cannot provide it without changing upstream code.
