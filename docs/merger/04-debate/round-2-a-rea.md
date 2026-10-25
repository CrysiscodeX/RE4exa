# 04 Debate, round 2: A-rea

**Inputs.** [round-1-skeptic.md](round-1-skeptic.md), [round-1-judge.md](round-1-judge.md) and journal J-04.
**Citations.** `rea:path:line` at `b4938ae`; `donors.md row N`; `pi-durable.md organ N`; `absurd.md ON`.
**Labels.** [seen] means read in the code or measured by me. To measure, I used a scratch build of rea (Linux x64, Node 22.22.0) and drove the CLI and `rea mcp` over stdio. [inferred] and [unknown] as before.
**Status words.** closed-by-design · scope-cut · unresolved-owner · conceded.

## 0. Correction to my layer-1 file (rea.md O11), stated first

My fixture read `worker.js` through `readFile(new URL(…, import.meta.url))`. rea models that form as a load only inside `new Worker(...)` (`rea:src/domain/javascript/javascriptStaticAnalysisCalls.ts:98-114`) [seen].

I re-ran with `new Worker(new URL("./worker.js", import.meta.url))`. That gives a resolved `loads → worker` edge [seen]. So "missed the worker edge" was overstated.

The overclaim is real, but it is a different one:
- `const p = import.meta.resolve("./worker.js"); import(p)` produces a `dynamic-import` edge with `specifier: null` and `resolution_status: null`.
- The same graph still reports `coverage: {status:"complete", truncated:false, omitted_count:0}` [seen].

The cause is in the schema. "complete" requires only `truncated:false` and `omitted_count:0` (`rea:src/domain/javascript/javascriptApplicationEvidenceSchemas.ts:197-203`). It measures **truncation, not resolution**. X-6 below rests on this.

## 1. Weak spots and judge criticisms of R-1 and R-2

**W-R1-1 The Evidence ID cannot be the replay key (skeptic, high).** I accept the premise. The design change is X-1 below.
- The step key is computed from inputs before execution. It generalises a key rea already has: `analysisQueryId` hashes `{target, binding, operation, parameters}`, and the target holds `sha256, kind, format, architecture` and no path (`rea:src/domain/analysisSnapshot.ts:354-367,519-528`) [seen]. The Evidence ID stays the identity of the record only. Status: **closed-by-design**.

**W-R1-2 Agents may not record faithfully (skeptic, high; judge RL-5 and EPI-2 = 2).** Design change, as the skeptic proposed.
- The runner writes an Evidence record from every probe's output. The agent never writes `observed` or `derived`. An agent-authored claim is forced to `authority: analyst-inference, confidence: inferred`. Both values already exist in the schema (`rea:src/domain/evidence.ts:112-118,137`), and rea's own investigation tools already use `analyst-inference` (`rea:src/server/registerInvestigationTools.ts:102,176,251`) [seen]. The audit falsifier stays: more than 20% of answer claims without an Evidence ID means failure. Calibration is EPI-2 below. Status: **closed-by-design**.

**W-R1-3 Thin margin over the null option (skeptic, high).** I keep the falsifier and accept the cut it implies.
- Run a kill-at-step-k test against S-1 tier 2 on one 30-probe script. If the gap is at most 1 repeated probe and 0 lost unknowns, R-1 folds into S-1 and the deliverable becomes the S-2 layer plus a durable log patch. Status: **scope-cut (test-gated)**.

**Judge: there is no lease in embedded mode, yet the card says "resumable by anyone".** Concede the wording. Design: one writer at a time, using D-1's lease row (`pi-durable.md` organ 2 adapt: "add a lease row"). Handover means release the lease, then claim it. Concurrent editing is out of scope; pi-durable's own spec excludes it (`durable:docs/spec.md:5614`, per the skeptic's F5). Status: **closed-by-design + scope-cut**.

**Judge: AGT-2, the `mutatesSession` defect is not split.** Design: add an effect class `recordsEvidenceOnly`, which keeps `readOnlyHint` true.
- Today any session write clears readOnly (`rea:src/contracts/toolEffects.ts:4,718-733`). Measured on the default catalog: readOnly is true for 5 of 208 tools [seen]. This is an upstream change to one file that has no imports (782 lines). Status: **closed-by-design** (upstream PR or a vendored policy table).

**Judge: SEC-8, the router runs `file` and `unzip -l` on the host with no limits.** Design: cheap probes run as argv calls under orca's process-host (`donors.md` row 1, lift; it has timeout and output caps). ZIP listing uses rea's reader in-process, which rejects symlinks and enforces a 500× decompression budget (`rea:src/artifacts/ZipArtifactReader.ts:81`; `rea:src/domain/artifactDecompressionBudget.ts:18-35`) [seen]. Status: **closed-by-design**.

**Judge: AGT-6 has no budget; SEC-6/RL-2, an exported case carries target strings.** The budget is per case and per rung, in bytes and calls; this is L-1's AGT-6 design adopted into the merge. Redaction belongs to A-durable (SEC-6). I do not claim it is closed. rea itself refuses to infer secrecy from text patterns (`rea:AGENTS.md:13`), so the policy has to come from that owner. Status: budget **closed-by-design**; redaction **unresolved-owner** (A-durable).

**Judge: AGT-1 = 2.** This belongs to A-leanrea (X-2). R-1's case store makes an injected string persistent, so an X-2 failure blocks R-1. Status: **unresolved-owner** (A-leanrea).

**W-R2-1 Finding identity across versions (skeptic, critical; judge INT-5 = 2).** Concede that the card's mechanism was wrong. The design change is the finding fingerprint in X-1, built on rea's existing stability vocabulary. Status: **closed-by-design**.

**W-R2-2 A false "no change" (skeptic, critical; judge RL-5 highest).** I partly rebut and partly accept.
- **Rebut:** the URL-plus-Worker form is handled (§0). **Accept:** `complete` is a truncation flag, so the gate cannot trust it. **Design:** the X-6 census, and the gate fails closed on any unresolved loading site of a capability-relevant form. **Residual cost:** warnings are noisy until rea resolves more forms. The noise falsifier (≤1 false "changed" per 10 benign updates) decides whether the gate is usable. Status: **closed-by-design** for false "complete". Usefulness is **unresolved** until it is measured.

**W-R2-3 Cost per pair (skeptic, medium).** Measured warm with one long-lived `rea mcp` [seen]:
- Initialize takes 2.1–2.2 s, once. `analyze_javascript_application` on a 3-file package takes 0.65–0.85 s per call (n = 3). Wire size is 178,983 B with full detail, which is twice the 85,449 B CLI result because results are sent twice (`rea:src/server/toolResultEncoding.ts:53-57`). With `detail:"summary"` it is 20,829 B.

The 60 s target per pair is not measured on real packages. Design: one long-lived server per worker, summary detail, and the full Evidence kept in the store. Status: **closed-by-design**; real-package timing still to be measured.

**Judge: COR-5 = 2, CI paths change composite IDs.** This is fixed by the X-1 observation ID: nested records are reduced to their IDs. Status: **closed-by-design**.

**Judge: SEC-8/RL-4, a new tar reader on untrusted input.** Design:
- Use the same decompression budget and SafeOutputTree as ZIP. Reject absolute paths, `..`, symlinks, hardlinks and device entries before extraction. Fuzz the reader with fixtures for every reject class. Status: **closed-by-design**. The code does not exist yet.

**Judge: EVO-3 = 2, the gate is JS/Electron in practice.** Scope cut, stated:
- **Covered:** JS, Electron, npm packages, and build facts for Go, Rust and .NET. **Native code** gets inventory, Mach-O/ELF/PE headers, and the line "deep native analysis not covered". No claim about native behaviour change. Status: **scope-cut**.

**Judge: AGT-4 = U, summaries are not evaluated.** Scope cut: model summaries are off by default and never part of the verdict. Status: **scope-cut**.

## 2. Gaps I own

### X-1 Identity: three keys, each with a different job

| Key | Computed | Fields | Excludes | Built on |
|---|---|---|---|---|
| **ProbeKey** `pk_` (step and replay key) | before execution | each input target `{sha256, kind, format, architecture, entry_point?}` sorted; `binding {provider id/name/version, analysis_profile.digest}`; `operation`; canonical `parameters` with every path-valued parameter replaced by its input digest; input Evidence IDs for derived operations; `env_class {platform, architecture}` **only** when the tool's effects include `launchesProcess`, `accessesNetwork` or `executesForeignCode` | paths, names, `environment.id`, time | `rea:src/domain/analysisSnapshot.ts:354-367,519-528` (path-free query key); `rea:src/domain/analysisProfile.ts:22-55` (pre-execution profile digest) |
| **ObservationId** `ev_` (record identity, today's ID) | after execution | today's semantic projection (`rea:src/domain/evidence.ts:251-278`), **but** every embedded Evidence inside `normalized_result` is replaced by its `evidence_id`, and every nested `subject` loses `name` and `local_path` | same as today, plus nested paths | fixes the measured defect: same bytes at a new path gave `ev_0425…` vs `ev_b74d…` while the child ID stayed equal (rea.md O5) |
| **FindingKey** `fk_` (review key across versions and hosts) | after normalisation | `predicate_type`; capability class (e.g. `electron.ipc.channel`, `npm.install-script`, `network.literal-host`); **lineage scope** (package name or bundle identifier, not digest); location by the most stable identity available, `source-map-original` > package-relative path + symbol > `structural-fingerprint`; normalised value | subject digest, provider version, environment, `raw_result`, timing | rea already labels node identity stability: `global-exact`, `source-map-exact`, `artifact-version`, `cross-version-inference` (`rea:src/domain/javascript/javascriptApplicationEvidenceSchemas.ts:420-478`) |

Two rules govern the keys.
- **Replay.** A step with the same ProbeKey and a committed observation is not re-run. If a re-run gives a different ObservationId, both records are kept and the step is flagged `nondeterministic`. One case is timing in process captures: identical output with at_ms 50 vs 40 gives "changed" (rea.md O13).
- **Version pairing.** A FindingKey carries the stability of its location. When the location was matched by `cross-version-inference`, the finding inherits `confidence: inferred`. rea already refuses to promote structural matches to exact identity (`rea:src/domain/javascript/javascriptApplicationChangeGraph.ts:82`) [seen].

**Evidence it would work.** Two runs of `inspect-artifact` on the same ELF gave the same ObservationId [seen]. The query key exists and is path-free [seen]. The stability vocabulary exists [seen].

**Residual risk.**
- The FindingKey depends on capability-class normalisers, which do not exist yet [inferred]. Renames between versions are false "new" findings unless a source map or structural match exists.
- A ProbeKey that misses a result-affecting input gives a stale replay. The snapshot cache has this risk today and lists its inputs explicitly (`rea:docs/cli.md:179-181`).

**Tests.**
1. Same bytes at two paths and on two hosts: equal ProbeKey, equal ObservationId.
2. For every one of the 208 tools, mutate each parameter: the ProbeKey must change exactly when the result can change. Use a table generated from the contracts.
3. Over N real version pairs: FindingKey survival rate for unchanged code is ≥95%, and 0 cross-capability collisions.

### X-5 rea is not importable as a library

Facts:
- `rea:package.json` has no `main` and no `exports` [seen]. Without `exports`, Node allows any deep path. From a separate directory, `import("rea-agents/dist/domain/evidence.js")` worked. `parseEvidence` accepted a real record and rejected a tampered one ("Evidence semantic identifier does not match its record") [seen]. The package pulls 174 production packages, including playwright-core (`npm ls --omit=dev --all`) [seen].

| Option | Cost | Risk |
|---|---|---|
| a. Deep import of `dist/` | 0 lines | Undeclared API; 12 BREAKING sections across 38 releases (rea.md §5); 174 packages for 2.8k lines of value |
| b. Vendor the 17-file closure (2,839 lines; zod, canonicalize, node:crypto/path/util) with the MIT notice | about 3k lines to own | Drift from rea |
| c. Upstream: an `exports` map with `./evidence`, or a separate small package | one PR, plus the maintainer's consent | Depends on one maintainer (59% of 6.5.0 commits) |
| d. Implement from the S-2 spec, with golden vectors generated by rea at a pinned commit | rewrite plus vectors | Two implementations can diverge, which the vectors are there to catch |

**Recommendation:** d, starting from b, with option a used **only** in a CI conformance job. That job feeds rea's own outputs through our parser and requires byte-identical IDs. Propose c upstream, but do not depend on it.

**Test:** vectors cover every subject format (28), nested records, tamper cases and unknown revisions. The job fails on any ID mismatch at the pinned rea version.

**Residual risk:** rea changes its projection, and the vectors then pin us to an old meaning. That is acceptable, because S-2 versions the format. Status: **closed-by-design**.

### X-6 Coverage that cannot be claimed falsely

**Design.** The coverage record states what was counted, not what went wrong:
- **`universe`**: files examined, with their digests root and each skipped file with its reason. **`census_version`**: the declared list of loading forms the analyzer recognises: static import and export-from, `import()`, `require()`, `createRequire()(…)`, `new Worker`/`SharedWorker`, `new URL(…, import.meta.url)`, `import.meta.resolve`, `process.dlopen`, `child_process.fork` of a script, HTML `<script src>`, and Electron `preload` and `webPreferences`. **Per form:** `{sites, resolved, unresolved}`, with locations for the unresolved sites (bounded, plus a count). **`unclassified_sites`**: a catch-all sweep. It counts every `MetaProperty` (`import.meta`), `eval` or `Function` call, computed `require` or `import`, and string literal ending in `.js`, `.mjs`, `.cjs`, `.node` or `.wasm` that no form claimed. **`truncated` and `omitted_count`**, as today.

`complete` is valid **only if** `truncated` is false, every form has `unresolved == 0`, and `unclassified_sites == 0`. Otherwise the record is `partial` and lists the sites. The scope sentence is fixed: "static loading sites in examined files". It never covers code fetched at run time.

**Evidence it would work.** The §0 overclaim, `import(p)` unresolved under "complete", would become `partial` with 1 unresolved `dynamic-import` and 1 `import.meta.resolve` site. rea already parses `MetaProperty` nodes (`rea:src/domain/javascript/javascriptSemanticAmbientWrites.ts:215`) [seen], so the census needs no new parser.

**Residual risk.** Obfuscated loaders (`globalThis["req"+"uire"]`) escape the literal sweep. Mitigation: any computed member access on `globalThis`, `module` or `process` counts as unclassified. That raises noise, which the R-2 noise falsifier measures.

**Tests.**
1. A positive fixture for each form.
2. A mutation corpus: aliases, concatenation, re-exported `import.meta.url`.
3. Resolver ablation: disable each form's resolver in turn. The census must report `unresolved > 0` and never `complete`. Ablation catches a census that silently follows the resolver. Status: **closed-by-design**. It is an upstream schema change; until then the gate treats rea's `complete` as `partial`.

### EPI-2 Calibration of observed / derived / inferred

**Unit.** The pair (producer operation, class). Confidence is set at about 106 literal sites in `src/`: 61 `observed`, 25 `derived`, 20 `inferred`, counted by grep [seen]. So the units can be enumerated.

**Labels**, kept apart by source:
1. **Closed-claim fixtures graded against oracles.** rea's evaluator already checks values, Evidence IDs, authority and confidence against a fixture oracle (`rea:docs/client-verification.md:490-497`; `rea:src/evaluation/KnownAnswerEvaluation.ts:15-22`) [seen].
2. **Independent oracles.** For example, the PCAP header oracle reads bytes, not TShark output (`rea:experiments/analysis-efficiency/packet-oracle.py:1-5`) [seen].
3. **R-2's historical replay corpus.**
4. **Cross-engine agreement** (Ghidra against objdump on the same addresses). Kept as a *weak* label and never mixed with 1–3.

**Metrics.**
- Precision per unit with a Wilson 95% interval. Invalid or unparseable outputs counted separately, never folded into wrong answers (`donors.md` row 23, my-jev pattern). Below n = 30 the unit is reported `INSUFFICIENT`, not passed (`donors.md` row 22, laya's evidence states, adapt).

**Targets.** Lower bound ≥ 0.98 for `observed` and ≥ 0.90 for `derived`. `inferred` is reported only and never gates.
- **Demotion rule** (laya's "smallest threshold that keeps error ≤ target", row 22, used as a rule and not as a model): a unit whose lower bound falls below its target emits the next weaker class. The demotion is recorded in its `analysis_profile`, so the ProbeKey and ObservationId change visibly.
- Brier score and ECE apply only if a producer states probabilities; rea's classes are ordinal.

**Evidence it would work.** The fixture expectations already pin the expected confidence and authority per claim [seen]. Today this harness is not run in CI (rea.md O19).

**Residual risk.**
- Fixtures are not representative of real targets. Errors are systematic (one parser bug flips many claims), not random, so intervals understate risk. Mitigation: stratify per format and per provider version. Our team writes the labels.

**Tests.**
- A CI job publishes the calibration report as an artifact. Seeded fault: a deliberately wrong producer must be demoted within one run. The report must refuse to state a level for `INSUFFICIENT` units. Status: **closed-by-design** for the method. The **numbers are unknown** until it runs.

## 3. Proposed forced merges

**R-1 + D-1 + L-1 → durable case file: accept, with three amendments.**
1. **Inversion (W-D1-1).** The official client (Claude Code, Codex, or an ACP client) is the host. The case file is an MCP server plus a CLI that owns probes and its own SQLite store. "Same atomic commit" then means step row + Evidence + unknown revision in one SQLite transaction inside our server. It does not need pi-durable's kernel (F2).
   - We take pi-durable's intent-before-effect and replay logic (organ 6, lift), its submission UNIQUE rule (organ 8) and its storage conformance kit (organ 16).
   - We do not take its harness or pi-ai.
   - This also resolves X-3 for this candidate: no model access and no stored credential.
2. **L-1 becomes a runner policy, not an agent choice.** Unknowns are opened from the question items (W-L1-1), and rung budgets are enforced.
3. **Identity and coverage.** X-1 ProbeKey for replay, ObservationId for records, X-6 coverage, and a single writer with a lease.

The S-1 tier 2 falsifier from W-R1-3 applies to the merged candidate.

**R-2 + L-2 + B-1 → CI sweep and delta gate: accept, with amendments.**
- Default: a single runner on SQLite. absurd and Postgres only for the fleet mode, which is the owner's multi-worker question. Gate verdicts use FindingKey across versions and X-6 fail-closed coverage. L-2 is the pre-filter, with its closure rate published. **Partly reject folding D-2 in as "the effect layer".** A static gate has almost no external effects. D-2 receipts apply only to publishing reports or tickets, and nothing more is claimed. S-1 tier 3 is the baseline arm, measured on the same corpus.

**S-2 as a mandatory layer: accept, with amendments.**
- The S-2 spec must contain the three X-1 keys, the X-6 coverage record and the EPI-2 report shape. It is versioned independently of rea's release cadence. Conformance is proven by the X-5 golden vectors. Converted prose records carry `analyst-inference` only (W-S2-4).

Without these, S-2 just restates rea's current format, including its two defects (path-dependent nested IDs, truncation-only "complete").
