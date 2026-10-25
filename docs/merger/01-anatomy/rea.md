# 01 Anatomy: rea (advocate A-rea)

Source: `morluto/rea` at `b4938aed` (2026-10-20), MIT © 2026 morluto, plus `THIRD_PARTY_NOTICES.md` and `licenses/`. Citations are `rea:path:line` at that commit. Labels: **[seen]** read in code or docs, or measured by me; **[inferred]** reasoned from what was seen; **[unknown]**. Review findings come from `research/rqs-review/reports/rea.md`. Each one used here was re-checked against source or by running the code. Findings whose evidence sits only in excluded directories are marked *unconfirmed*.

Method for measurements: I copied the clone to a scratch directory, ran `npm ci --ignore-scripts` and `npx turbo run artifacts:mcp-catalog` (TypeScript build plus bundling), then drove `node scripts/rea.mjs mcp` over stdio with a raw JSON-RPC client. I also ran a few CLI commands on small local inputs. Host: Linux x64, Node 22.22.0, no Ghidra, Hopper, IDA or browser installed. The original clone was not modified.

## 1. What it really is

rea is a local Node.js program (TypeScript, about 352k production lines) with two front ends: an MCP server (stdio by default, streamable HTTP as an opt-in) and a one-shot CLI. Both call the same application layer. That layer reads shipped software (native binaries, JavaScript and Electron apps, .NET, APK, WASM, EVM, SQLite, captures and more), either with its own parsers or by driving external engines the user installs (Ghidra, Hopper, IDA, Rizin, GDB, JADX, tshark and others). Every successful answer is wrapped in an "Evidence" record: a strict JSON object that names the subject's SHA-256, the provider and its version, the parameters, a confidence class (observed, derived or inferred), an authority class, limitations and coverage, under an ID that is a hash of that content. Records and open questions ("residual unknowns") are kept in an in-memory ledger for one connection. They can be exported to and imported from JSON bundles. rea calls no language model. Its users are coding agents, and people at a terminal. [seen: rea:README.md:61-66, rea:docs/architecture.mermaid, rea:src/domain/evidence.ts:127-145, rea:src/application/investigation/EvidenceLedger.ts:44-47]

## 2. Organs

Summary (details below):

| # | Organ | Verdict | One-line reason |
|---|---|---|---|
| 1 | MCP adapter and transports | adapt | Sound SDK use and lifecycle; HTTP needs authentication before any shared use |
| 2 | Tool catalog (208 tools) and schema profiles | adapt | Contracts are good; the default advertisement is about 3.2 MB |
| 3 | Effect audit and untrusted-content marker | **lift** | One 782-line file, no imports; a host policy can use it directly |
| 4 | Result encoding and response budget | pattern | The idea (fail before building an oversized string, then point to a page) travels; results are sent twice |
| 5 | Evidence record and content-addressed ID | **lift** | Small (17-file closure), provider-neutral, the best claim format among the four repos |
| 6 | Evidence ledger, bundles, snapshots | adapt | Correct merge rules; held in memory and lost when the process dies |
| 7 | Residual-unknown registry | **lift** | Revisioned, hash-chained open questions with resolution rules; nothing similar in the other three |
| 8 | Error algebra and error contract | adapt | Typed `Result` and a 20-code schema; the retry advice is wrong for `invalid_request` |
| 9 | Provider process supervision | pattern | Owned process groups and Job Objects; the import closure is 116 files |
| 10 | Artifact readers and inventory graph | adapt | Hardened ZIP/ASAR/DMG readers with a decompression budget; no tar/gzip |
| 11 | JavaScript/Electron static analysis | adapt | rea's largest and most specialised asset; misses some modern loading forms |
| 12 | Browser, Electron and V8 runtime observation | leave | Large, depends on the host and runs targets; use it through rea's tools |
| 13 | Process capture and comparison | adapt | Useful PTY capture; the comparison counts timing jitter as a change |
| 14 | Provider port and session routing | pattern | A clean `AnalysisProvider` port and a "no fallback" selection rule |
| 15 | Native engine bridges | leave | Engine-specific Java/Python/Swift; keep them behind rea |
| 16 | Specialist format and device providers | leave | Breadth (Go, Rust, .NET, WASM, EVM, ADB, pcap…) best consumed as tools |
| 17 | CLI adapter (155 commands) | pattern | JSON/TOON output and token windows are good ideas; the surface is too wide |
| 18 | Setup, doctor, installer | pattern | Read-only `doctor` with remediation; setup touches client configs and engines |
| 19 | Agent skill, prompts, agent evaluation | adapt | Closed-claim grading against oracles; it is not run in CI and has no injection cases |
| 20 | Tests and CI apparatus | pattern | Strong gates and real-tool lanes; too heavy to carry as-is |

Licence for all rows is MIT (rea), except where a row says otherwise.

### O1 MCP adapter and transports
- **Function:** `scripts/rea.mjs` sends `mcp` to the server and everything else to the CLI [seen: rea:scripts/rea.mjs:15-17]. stdio through `@modelcontextprotocol/server/stdio` [seen: rea:src/main.ts:8,39]. HTTP is loaded lazily [seen: rea:src/main.ts:47-60]. Server instructions say target content is data [seen: rea:src/server/createServer.ts:267; rea:src/server/toolResultEncoding.ts:25-26].
- **Interfaces:** MCP protocol `2025-11-25`, server `rea 6.7.0`, 6 prompts [seen, measured; rea:src/contracts/promptContracts.ts:96-363].
- **State and lifecycle:** one process per client. HTTP is stateful and serves one client at a time [seen: rea:docs/mcp-contracts.md:465]. SIGINT and SIGTERM map to exit codes 130 and 143 [seen: rea:src/main/processShutdown.ts:1-6].
- **Depends on:** Node ^22.19, ^24.11 or >=26; `@modelcontextprotocol/server` 2.3.1 [seen: rea:package.json:328-329].
- **RQS:** INT-1 = 4, confirmed (stdio default and HTTP opt-in seen). OPS-3 = 3, confirmed.
- **Carried defects:** HTTP has no TLS and no client authentication. A non-loopback bind only logs a warning and relaxes Host checks [seen: rea:docs/mcp-contracts.md:459-463; rea:src/server/http/serveStreamableHttp.ts:98-104,589-593].
- **Verdict:** adapt. Keep the stdio path. Add a per-instance bearer token, as the engine bridges already use, before any multi-user or remote use.

### O2 Tool catalog and schema profiles
- **Function:** 208 tool contracts. Each is bound to an effect audit entry [seen: rea:src/contracts/toolContracts.ts:40; rea:src/contracts/toolEffects.ts:55-716]. Verb mix: 48 `inspect_*`, 21 `list_*`, 11 `compare_*`, 10 `trace_*` [seen, counted].
- **Interfaces:** `tools/list`; env `REA_MCP_INPUT_SCHEMA_PROFILE` = `full` (default) or `compact`, and `REA_MCP_OUTPUT_SCHEMA_PROFILE` = `full` (default) or `off` [seen: rea:src/config/mcpInputSchemaProfile.ts:11-24; rea:src/config/mcpOutputSchemaProfile.ts:7,14].
- **State and lifecycle:** static, fixed at startup.
- **Depends on:** zod 4.4.3, ajv.
- **RQS:** PERF-2 = 1, confirmed by my measurement (§5). INT-3 = 1, confirmed (208 tools). INT-2 = 4, confirmed (208/208 tools advertise an `outputSchema` by default).
- **Carried defects:** the default `tools/list` is 3,211,385 bytes, and output schemas are 74.7% of it [seen, measured]. All 208 tools are listed even where the host cannot run them: macOS-only tools appear on Linux [seen, measured; `rea providers` reports `unsupported_host`]. *Unconfirmed:* 832,930 o200k tokens (a 6.7.0 figure; its evidence is in an excluded directory).
- **Verdict:** adapt. Make compact plus output-off the default (222,396 bytes, measured) and filter the list by host availability.

### O3 Effect audit and untrusted-content marker
- **Function:** declares ten effect booleans per tool (`mutatesTarget`, `launchesProcess`, `accessesNetwork`, `executesForeignCode`, `mutatesDevice`, and others) [seen: rea:src/contracts/toolEffects.ts:1-22]. MCP hints are derived only from these effects [seen: rea:src/contracts/toolEffects.ts:718-741]. The untrusted marker is on unless a tool has been audited out, and unknown names count as untrusted [seen: rea:src/contracts/toolEffects.ts:743-766].
- **Interfaces:** TS record. `_meta.provenance.untrusted_content` on results [seen: rea:src/server/toolResultEncoding.ts:28-33].
- **State and lifecycle:** none (pure data).
- **Depends on:** nothing; 782 lines, zero imports [seen, measured].
- **RQS:** AGT-2 = 2, confirmed. readOnlyHint is true for 5/208 tools and destructiveHint for 31/208 [seen, measured]. AGT-1 = 2, confirmed (`TARGET_CONTENT_FREE_TOOLS` holds 2 names).
- **Carried defects:** `mutatesSession` counts in-memory Evidence recording as a mutation, so almost no tool is read-only [seen: rea:src/contracts/toolEffects.ts:4,47-53,722-733]. A host that auto-approves read-only tools would prompt on nearly every call [inferred].
- **Verdict:** lift. Split `mutatesSession` into a "records Evidence only" class. This is the organ a merged harness can enforce as policy.

### O4 Result encoding and response budget
- **Function:** builds complete results within a 10 MiB budget, counting both representations. When a result cannot fit, it returns `resource_constraint` with an Evidence reference and a ready-to-call paging request [seen: rea:docs/mcp-contracts.md:94-118; rea:src/config/mcpResponseBudget.ts:9].
- **Interfaces:** `REA_MCP_MAX_RESPONSE_BYTES`; `inspect_analysis_view` paging.
- **State and lifecycle:** per call; references point into O6.
- **Depends on:** O6.
- **RQS:** REL-3 = 4. *Unconfirmed* at runtime here (no large target run). REL-2 = 2, *unconfirmed* (the 889 MB bundle evidence is excluded).
- **Carried defects:** successful results carry the same JSON twice, as `structuredContent` and as escaped text [seen: rea:src/server/toolResultEncoding.ts:53-57; rea:docs/mcp-contracts.md:12-13]. Feature traces copy every parent-graph limitation [seen: rea:src/domain/javascript/javascriptFeatureTrace.ts:151-154]. A 3-file JS app produced an 85,449-byte result [seen, measured].
- **Verdict:** pattern. Keep "refuse early, return a reference and a continuation". Do not send results twice.

### O5 Evidence record and content-addressed ID
- **Function:** a strict zod schema with subject {name, sha256, local_path, format, architecture}, provider {id, name, version}, analysis_profile, predicate_type, operation, parameters, raw_result, normalized_result, confidence ∈ {observed, derived, inferred}, authority ∈ {shipped-artifact, controlled-replay, historical-reference, external-service, analyst-inference}, environment (with isolation level), limitations, relationship_coverage, locations, evidence_links [seen: rea:src/domain/evidence.ts:112-145]. The ID is `ev_` + SHA-256 over canonical JSON of a projection without `name` and `local_path`, and a tampered ID is rejected on parse [seen: rea:src/domain/evidence.ts:251-288; rea:src/domain/canonicalDigest.ts:1-28].
- **Interfaces:** JSON. The 28-value subject format enum [seen: rea:src/domain/evidence.ts:42-71].
- **State and lifecycle:** immutable values (WeakMap-sealed snapshots) [seen: rea:src/domain/evidence.ts:193].
- **Depends on:** zod, canonicalize, node:crypto, node:path. The closure of evidence + bundle + unknown is 17 files and 2,839 lines [seen, measured with an import walk].
- **RQS:** EPI-1 = 4, confirmed. COR-5 = 3, confirmed (two runs on the same ELF gave the same ID). INT-5 = 4, partly confirmed; see the defect below.
- **Carried defects:** the path exclusion holds only at the top level. Composite records embed child Evidence, including `subject.local_path`, inside `normalized_result`. So the same bytes at a different path got a different top-level ID (`inspect-artifact` on a copy of `/bin/true`: `ev_0425…` vs `ev_b74d…`, while the child ID stayed the same) [seen, measured]. Confidence classes are not calibrated against outcomes [inferred from the review's O8; no calibration code found].
- **Verdict:** lift, with the nested-path fix. This should be the merged product's common claim format.

### O6 Evidence ledger, bundles and snapshots
- **Function:** the session ledger keeps three in-memory Maps [seen: rea:src/application/investigation/EvidenceLedger.ts:44-47]. Recording is idempotent and conflicting content is rejected [seen: rea:src/application/investigation/EvidenceLedger.ts:48-70]. Bundle import is validated whole and merged atomically [seen: rea:src/application/investigation/EvidenceLedger.ts:72-140]. Exports are written atomically [seen: rea:src/application/EvidenceBundleFiles.ts:114-115]. The streaming JSON reader is new since 6.7.0 [seen: rea:src/application/JsonInputFile.ts:250-282]. Snapshots reuse exact-key results across CLI calls [seen: rea:docs/cli.md:177-206].
- **Interfaces:** MCP `export_evidence_bundle`, `import_evidence_bundle`, `get_evidence_bundle`; CLI `evidence-import`, `evidence-export`, `compare`.
- **State and lifecycle:** per connection. Retained references do not cross connections [seen: rea:docs/cli.md:230-232; rea:docs/mcp-contracts.md:306,334]. Nothing is written until an explicit export or snapshot save.
- **Depends on:** O5, O7, stream-json, write-file-atomic.
- **RQS:** REL-1 = 2, confirmed (in-memory). INT-7 = 3, confirmed. *Unconfirmed:* the SIGKILL loss test and the failure to re-import the 889 MB bundle (excluded evidence).
- **Carried defects:** a crash loses the whole session [seen in code; runtime *unconfirmed*]. The streaming reader still assembles one full JS value (`streamValues()`), so very large bundles stay limited by memory [inferred from rea:src/application/JsonInputFile.ts:279]. An unknown that fails resolution validation surfaces as "state changed … try again" [seen: rea:src/application/investigation/EvidenceLedger.ts:436; rea:src/domain/analysisErrorPresentation.ts:274-275].
- **Verdict:** adapt. Keep the merge and conflict rules. Back them with an append-only durable log (SQLite WAL or a durable-step engine), replayed by Evidence ID.

### O7 Residual-unknown registry
- **Function:** each open question has an ID derived from question, domain and scope; a revision with `previous_revision_digest` and `revision_digest`; a status in {open, investigating, blocked, contradicted, resolved}; a severity; required authority, confidence and environment; recommended probes; relationships {depends-on, related-to, contradicts}; and a resolution {verified with ≥1 Evidence ID, withdrawn, out-of-scope} [seen: rea:src/domain/residualUnknown.ts:63-118,151-165]. A resolution must cite qualifying supporting Evidence [seen: rea:src/domain/evidenceBundle.ts:400-412].
- **Interfaces:** MCP `record_unknown`, `update_unknown`, `list_unknowns`, `verify_unknown_resolution`; prompt `audit_residual_unknowns`.
- **State and lifecycle:** in O6's Maps; hash-chained revisions.
- **Depends on:** O5.
- **RQS:** EPI-3 = 4 and EPI-4 = 4, confirmed in source.
- **Carried defects:** shares O6's lack of durability. There is no coverage document for a whole investigation [inferred; the review's O3].
- **Verdict:** lift. It turns "unknown" into a tracked work item, which a durable harness can schedule.

### O8 Error algebra and error contract
- **Function:** tagged errors with `Result` [seen: rea:src/domain/result.ts]. A generated schema of 20 codes, each with category, retryable flag and remediation [seen: rea:docs/error-contract.schema.json; rea:docs/user-visible-errors.csv].
- **Interfaces:** JSON error objects (example measured: `target_unavailable`, `retryable:false`, `details.constraint:"file_format_rejected"`).
- **State and lifecycle:** none.
- **Depends on:** a 94-file import closure from `analysisErrorProjection.ts` [seen, measured], so the module is entangled with other code.
- **RQS:** INT-4 = 2, confirmed.
- **Carried defects:** `invalid_request` is always retryable [seen: rea:src/domain/analysisErrorProjection.ts:569-576].
- **Verdict:** adapt. Keep the code, retryable and remediation shape. Derive `retryable` from the cause.

### O9 Provider process supervision
- **Function:** spawns each provider in its own POSIX process group or Windows Job Object [seen: rea:src/process/ProviderProcess.ts:224-232]. On Windows this uses `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, with an optional memory limit [seen: rea:native/windows/src/process.cc:22-35]. Deadlines, bounded reads and cleanup that keeps ownership when it fails [seen: rea:AGENTS.md:19].
- **Interfaces:** TS API. Native Node-API addon on Windows.
- **State and lifecycle:** owns child process trees and private roots; retries cleanup.
- **Depends on:** node:child_process. Windows: a MinGW-built addon that carries GPLv3 and GCC Runtime Exception notices [seen: rea:THIRD_PARTY_NOTICES.md:21].
- **RQS:** REL-4 = 5. Mechanism confirmed; behaviour not run here.
- **Carried defects:** the import closure is 116 files and 23,216 lines [seen, measured], so it cannot be lifted alone. It is not a sandbox [seen: rea:SECURITY.md:33-36].
- **Verdict:** pattern. Copy the ownership rules ("a PID alone does not prove ownership"), not the code.

### O10 Artifact readers and inventory graph
- **Function:** ZIP-family, ASAR, DMG, Mach-O slice and directory readers [seen: rea:src/artifacts/]. Symlinks are rejected on open [seen: rea:src/artifacts/ZipArtifactReader.ts:81]. Decompression is capped at 500× the compressed size, with a 256 MiB floor [seen: rea:src/domain/artifactDecompressionBudget.ts:18-35]. The inventory graph has manifest and graph digests [seen, measured output].
- **Interfaces:** `inspect_artifact`, `extract_artifact`, `inspect_desktop_application`…
- **State and lifecycle:** read-only. Extraction goes into an absent directory through SafeOutputTree.
- **Depends on:** `@zip.js/zip.js`, `@electron/asar`, plist; macOS for DMG mounts.
- **RQS:** SEC-8 = 3, confirmed (the budget is seen).
- **Carried defects:** `.tgz` is rejected ("unsupported binary format") [seen, measured]. The ZIP-family list has no tar or gzip [seen: rea:src/domain/zipPackageFormat.ts:2-11]. So rea cannot inventory npm tarballs, its own distribution form. Import closure: 120 files [seen, measured].
- **Verdict:** adapt. Add tar/gzip under the same budget.

### O11 JavaScript/Electron static analysis
- **Function:** builds application and semantic graphs from inert ASTs (Babel 8), covering modules, imports, source maps, Electron windows, preload scripts, contextBridge and IPC pairing, native add-ons, and Webpack/Rspack factories. It also traces features and compares versions [seen: rea:src/domain/javascript/ (42,070 lines); rea:src/application/javascript/ (13,391 lines); rea:docs/javascript-application-workflows.md].
- **Interfaces:** `analyze_javascript_application`, `trace_application_feature`, `compare_application_versions`, and others. Heavy work runs in workers (`#javascript-analysis-worker`) [seen: rea:package.json:37-40].
- **State and lifecycle:** results are retained in O6; runs on caller-selected heap limits [seen: rea:src/application/javascript/JavaScriptArtifactReconstruction.ts:164].
- **Depends on:** @babel/parser, @babel/types, @jridgewell/trace-mapping, parse5; Linux needs a procps-style `ps` [seen: rea:README.md:188].
- **RQS:** PUR-2 = 3, confirmed by reading `docs/verification/javascript-module-references-2026-10-15.md`.
- **Carried defects:** `new URL("./worker.js", import.meta.url)` produced no edge to `worker.js`, while coverage said `complete, truncated:false` [seen, measured on a 3-file fixture]. The source has no `import.meta.resolve` handling [seen: no match in rea:src/domain/javascript or rea:src/application/javascript]. A plain Node package's `main` was labelled an `electron-main` node [seen, measured; whether this is only naming is unknown]. The run took 2.4 s and produced 85 KB of output for 3 files [seen, measured]. **[Correction, round 2]:** the fixture read `worker.js` through `readFile`, which rea does not count as a load; `new Worker(new URL(...))` does resolve. The overclaim that stands is an unresolved `import(p)` after `import.meta.resolve` under coverage "complete", because "complete" only means not truncated (`javascriptApplicationEvidenceSchemas.ts:197-203`). See [round-2-a-rea.md](../04-debate/round-2-a-rea.md).
- **Verdict:** adapt. This is the most distinctive capability. Transplant it as a provider behind O5, and fix the literal loading forms and the coverage claim.

### O12 Browser, Electron and V8 runtime observation
- **Function:** CDP and Playwright page capture, Electron script and worker capture, passive V8 Inspector discovery, Electron fuse reading [seen: rea:src/browser/ (25,251 lines); rea:src/inspector/; rea:src/electron/ElectronFuseProvider.ts]. `environment-serve` replays a recorded web capture as an MCP environment [seen: rea:docs/agent-environments.md:1-30].
- **Interfaces:** MCP and CLI tools; HTTP for environment-serve.
- **State and lifecycle:** launches or attaches to processes, and can run the target (`executesForeignCode`).
- **Depends on:** a Chrome-family browser, playwright-core 1.58.2, ws.
- **RQS:** SEC-7 = 3. *Unconfirmed* at runtime (no browser here).
- **Carried defects:** runs targets with the user's privileges and no sandbox [seen: rea:SECURITY.md:33-36]. No prompt-injection tests [seen: rea:tests/boundary/mcp/targetContentFramingMcp.test.ts checks the marker only, per review; no directives found in rea:src/evaluation/].
- **Verdict:** leave. Call it through rea in an isolated environment.

### O13 Process capture and comparison
- **Function:** captures a process scenario in a PTY (terminal frames, exit, settlement, filesystem before and after), then compares two captures [seen: rea:docs/process-capture.md:49-90].
- **Interfaces:** `capture_process`, `compare_process_captures`.
- **State and lifecycle:** owned child process. Output is limited by byte budgets.
- **Depends on:** @lydell/node-pty, @xterm/headless.
- **RQS:** COR-5 = 3, partly confirmed.
- **Carried defects:** frames are compared together with `at_ms` [seen: rea:src/domain/process/processObservation.ts:9-13], and exit is compared together with settlement timing [seen: rea:src/domain/process/processComparison.ts:416-424]. Two captures of `node -e console.log("ready")` returned `status:"changed"`, with the first divergence at at_ms 50 vs 40 and the same data [seen, measured].
- **Verdict:** adapt. Compare content and timing as separate dimensions.

### O14 Provider port and session routing
- **Function:** an `AnalysisProvider` port with identity, capabilities, profile resolution and a client factory [seen: rea:src/application/AnalysisProvider.ts:277-289]. It is implemented by Ghidra, Hopper, IDA, Kuna, .NET, macOS-native, artifact and composite providers [seen]. The session router keeps one immutable deep binding per target, and the registry selects deterministically with no fallback [seen: rea:src/application/binary/SessionProviderRouter.ts:37; rea:src/application/binary/AnalysisProviderRegistry.ts:98; rea:docs/architecture.mermaid].
- **Interfaces:** TS. Capability descriptors carry effects and limitations [seen: rea:src/application/AnalysisProvider.ts:270-274].
- **State and lifecycle:** per session.
- **Depends on:** O9, O5.
- **RQS:** MNT-1 = 4, confirmed (boundary rules in rea:scripts/lib/module-boundaries.mjs:6-21).
- **Carried defects:** none found specific to the port.
- **Verdict:** pattern. "One target, one bound engine, no silent fallback" is a rule worth keeping.

### O15 Native engine bridges
- **Function:** a Ghidra HeadlessScript bridge (4,911 lines in one file) with about 30 operations (procedures, pseudocode, xrefs, bytes, strings) [seen: rea:bridge/ghidra/ReaGhidraBridge.java:118,431-463]. Also Hopper Python, Cutter, JADX, LLDB, pwntools and pwndbg bridges, and IDA through the external ida-pro-mcp [seen: rea:bridge/; rea:docs/architecture.mermaid].
- **Interfaces:** Unix sockets with per-session capability tokens. Windows Ghidra uses authenticated loopback TCP [seen: rea:SECURITY.md:27-32].
- **State and lifecycle:** ephemeral Ghidra projects, deleted on close [seen: rea:SECURITY.md:38-43].
- **Depends on:** engines the user installs. Hopper and IDA are proprietary. Ghidra is Apache-2.0. JADX is Apache-2.0.
- **RQS:** SEC-9 = 1 (HMAC and SHA-1 integrity checks only). Internals not reviewed (review scope note) [unknown].
- **Carried defects:** Python `exec` of rea's own bridge files and of a gdbinit the operator configures [seen per review: rea:bridge/pwndbg/core_context.py:29; not re-read in depth].
- **Verdict:** leave. These are engine-specific and their value depends on the engine; reach them through rea's MCP tools.

### O16 Specialist format and device providers
- **Function:** static readers for Go build info, Rust cargo-auditable data, .NET metadata and IL, WASM (with WABT supplied by the caller), EVM (evmole in a worker), SQLite, Flutter, Apple bundles and PE resources. Device and capture adapters for ADB, Apktool, JADX, Frida (optional dependency), tshark, sigrok, mitmproxy and binwalk/unblob [seen: rea:README.md:183-205; rea:src/{go,rust,dotnet,wasm,evm,sqlite,flutter,adb,pcap,signals,firmware,frida}/].
- **Interfaces:** about 120 of the 208 tools [inferred from verb and prefix counts].
- **State and lifecycle:** mostly stateless; ADB and Frida can change a device (`mutatesDevice`).
- **Depends on:** per-tool host binaries; many are Linux x64 only (EVM, pwntools, tshark+prlimit).
- **RQS:** EVO-3 = 4. *Unconfirmed* (CI lane results not visible).
- **Carried defects:** Frida's optional dependency carries an LGPL-2.0 notice gap [seen: rea:THIRD_PARTY_NOTICES.md:31-36].
- **Verdict:** leave. This breadth is why rea is worth keeping; it does not belong in the core.

### O17 CLI adapter
- **Function:** 155 one-shot commands, built on `incur` [seen: rea:src/cliCommandNames.ts:2-257; rea:package.json:343]. Output formats are toon, json, yaml, md and jsonl, with `--token-limit`, `--filter-output` and `--llms` manifests [seen: rea:src/cliOutput.ts:2-10; `rea capture-process --help`].
- **Interfaces:** shell, with stdout JSON and progress on stderr [seen, measured].
- **State and lifecycle:** stateless per call, plus optional snapshot files (O6).
- **Depends on:** O1's application layer.
- **RQS:** INT-6 = 4, confirmed.
- **Carried defects:** a 1.3–2.3 s start-up cost per call (*unconfirmed* 6.7.0 figure). Here: 2.1–2.2 s for `inspect-artifact` on a 27 KB ELF [seen, measured, n=2].
- **Verdict:** pattern. Token-windowed, structured output is right; 155 commands is not.

### O18 Setup, doctor, installer
- **Function:** `rea doctor` is read-only and every failed check carries remediation [seen: rea:src/application/Doctor.ts:191-196]. Setup publishes client configuration additively, with backups [seen: rea:AGENTS.md:11; rea:src/application/ClientConfigurationPublication.ts]. It can install Hopper after approval, using a checksum check that relies on SHA-1 [seen: rea:SECURITY.md:50]. `install.sh` has a guard against a truncated download [seen: rea:install.sh:1-10].
- **Interfaces:** CLI.
- **State and lifecycle:** writes agent client configuration files and the package install.
- **Depends on:** npm; apt, dnf or pacman through pkexec.
- **RQS:** OPS-1 = 5 and OPS-4 = 3, confirmed in source.
- **Carried defects:** none new. It edits other applications' configuration files, which needs approval [seen: rea:AGENTS.md:11].
- **Verdict:** pattern. Copy the doctor shape. A merged product should own its setup.

### O19 Agent skill, prompts, agent evaluation
- **Function:** `reverse-engineer-anything` skill: a 23,510-byte SKILL.md plus 6 references, 76 KB in total [seen, measured]. 6 MCP prompts [seen]. Closed-claim grading against fixture oracles [seen: rea:src/evaluation/KnownAnswerEvaluation.ts:1-25].
- **Interfaces:** Markdown skill; `npm run verify:agent` drives the Codex CLI [seen: rea:package.json:230].
- **State and lifecycle:** none.
- **Depends on:** a real agent CLI for evaluation.
- **RQS:** AGT-4 = 2, confirmed (`verify:agent` has no match under rea:.github).
- **Carried defects:** not run in CI. There are no adversarial cases with directives planted in target content [seen: no match in rea:src/evaluation/].
- **Verdict:** adapt. The grader is reusable for any merged product's claims.

### O20 Tests and CI apparatus
- **Function:** 1,689 `*.test.*` files [seen, measured]. Coverage thresholds of 65/60/60/68 overall, 80/75/75/80 for domain and 85/80/80/85 for contracts [seen: rea:vitest.config.ts:163-182]. 30 workflows, 16 of them `real-*` engine lanes [seen, measured]. Third-party actions are SHA-pinned and a test enforces it [seen per review]. A daily mutation sweep that does not block [seen per review: rea:stryker.config.mjs:20].
- **Interfaces:** vitest, turbo, GitHub Actions.
- **State and lifecycle:** CI only.
- **Depends on:** self-hosted runners for some lanes (Windows Ghidra) [seen per review].
- **RQS:** COR-1 = 4, confirmed. COR-3 = 2, confirmed. SEC-5 = 4, *unconfirmed* (not re-run).
- **Carried defects:** no Dependabot or Renovate, no vulnerability or secret scanner, no SBOM [seen: `.github` has no update-bot configuration]. My `npm audit` on 2026-10-25 found zod 4.4.3 (high, a direct runtime dependency) and fast-uri (moderate) among production dependencies [seen, measured].
- **Verdict:** pattern. Keep real-engine lanes and boundary rules as practice; the merged product cannot inherit 500k lines of tests.

## 3. Environmental assumptions and blind spots

- **OS:** Linux and macOS first. Windows is partial: native addon, Ghidra "P0 experimental", a curated CI job [seen: rea:README.md:219; rea:docs/windows-ghidra-p0.md]. Many tools are Linux x64 only (EVM, pwntools, tshark+prlimit, sigrok), and DMG, Mach-O and native UI tools are macOS only [seen: rea:README.md:183-205].
- **Runtime:** Node ^22.19, ^24.11 or >=26; SQLite tools need Node ≥24.15 [seen: rea:package.json:46; rea:README.md:186]. 40 runtime npm dependencies [seen: rea:package.json:321-362].
- **External engines:** the user brings Ghidra, IDA, Rizin, GDB, WABT, Apktool, adb, tshark, sigrok and JEB. Hopper can be installed with approval [seen: rea:AGENTS.md:11; rea:SECURITY.md:45-50].
- **Trust model:** single user, single local client, the user's privileges, not a sandbox [seen: rea:SECURITY.md:33-36].
- **Blind spots:**
  - No durable state across crashes [seen].
  - No multi-user or authenticated remote use [seen].
  - No model calls, so the quality of conclusions depends on the host agent [seen: rea:README.md:313-314].
  - No tar/gzip [seen].
  - Literal URL-relative JS loads are missed [seen].
  - Timing jitter is read as a behaviour change [seen].
  - No investigation-wide coverage document [inferred].
  - Confidence classes are not calibrated [inferred].
  - No prompt-injection evaluation [seen].
  - The catalog is not shaped by host capability [seen].
  - Real-engine CI results are not visible to a static reader [unknown].

## 4. What rea should contribute, and what it should not

**Contribute (strongest first):**
1. **The Evidence record (O5) and the residual-unknown registry (O7) as the merged product's claim and question format.** They take 17 files, need no provider, are content-addressed and reject tampering, and keep "observed / derived / inferred" and authority separate. None of the other three repos is built to record a reverse-engineering claim with this provenance [inferred; the comparison is for the layer-2 debate]. A durable engine (absurd or pi durable) supplies what rea lacks. The Evidence ID gives it idempotent replay keys at no extra cost [inferred].
2. **The effect vocabulary and untrusted marker (O3)** as a policy input. A harness with approvals on can gate `executesForeignCode` and `mutatesDevice` once untrusted content has been read. It is one file with no imports [seen].
3. **JS/Electron static analysis (O11) and the hardened artifact readers (O10)** as the analysis capability that leanrea's shell recipes do not offer [inferred]. Take them as providers behind O5, not as 200 tools.
4. **Patterns:** owned process trees (O9), one bound engine with no fallback (O14), refusing early and returning a continuation (O4), read-only doctor with remediation (O18), closed-claim agent grading (O19).

**Should not contribute:**
- The 208-tool, 3.2 MB default catalog as the agent-facing surface (O2), or the duplicated result encoding (O4). Both are rea's worst trait for agents [seen, measured].
- The in-memory ledger as the source of truth (O6).
- The HTTP transport without authentication, for anything beyond loopback (O1).
- The 155-command CLI (O17), the engine installers (O18) and the 30-workflow CI (O20). They are product-specific weight.
- The breadth providers (O15, O16) inside the core. Keep them in rea and call them as tools.

**Concessions:**
- rea is large: 352k production lines and about 502k test lines [seen, measured]. Organs other than O3, O5 and O7 have import closures of 90–120 files [seen, measured], so most "transplants" are rewrites.
- Its release policy shipped breaking changes in minor versions. The changelog has 38 releases from 2026-07-12 to 2026-10-18 and 12 BREAKING CHANGES sections [seen, counted in rea:CHANGELOG.md].
- One maintainer appears on 527 of the 893 commits recorded for 6.5.0 (59%) [seen, measured from rea:docs/releases/6.5.0.contributions.json; the review says 537].
- Several review findings I could not re-run (crash loss, the 889 MB bundle, latency figures) remain *unconfirmed* here.

## 5. Measured facts

| Fact | Value | Source and method |
|---|---|---|
| Tracked files | 4,553 | `git ls-files \| wc -l` |
| Production TS in `src/` (non-test) | 1,596 files, 352,402 lines | `git ls-files 'src/*.ts'` minus `*.test.ts`, `wc -l` |
| Largest production areas | domain 104,777 (of which javascript 42,070); application 56,492; browser 25,251; process 14,740; artifacts 14,725; ghidra 14,004 lines | per-directory `wc -l` |
| Colocated tests in `src/` | 608 files, 182,131 lines | `src/*.test.ts` |
| Tests in `tests/` (TS) | 1,200 files, 319,697 lines | `tests/*.ts` |
| Test files (`*.test.{ts,mjs,mts}`) | 1,689 | `git ls-files` (the review says 2,004 with a different rule) |
| Test cases (estimate) | ≈9,803 `it(`/`test(` call sites | regex count, static estimate |
| Bridge code | Java 14 files / 6,479 lines; Python 15 / 4,927; Swift 4 / 630; C++ addon 1,486 lines | `wc -l` |
| Build and verify scripts | 421 files, 71,062 `.mjs` lines | `scripts/` |
| Docs pages | 118 Markdown files in `docs/` | `git ls-files` |
| CI workflows | 30, of which 16 `real-*` | `.github/workflows` |
| Runtime npm dependencies | 40 direct, plus optional `frida` | rea:package.json:321-399 |
| Packages installed by `npm ci` | 548 | install log |
| `npm audit` (2026-10-25) | all deps: 3 (2 high, 1 moderate); production only: 2 (zod high, fast-uri moderate) | `npm audit --json` on the scratch copy |
| MCP tools | 208 audited = 208 listed | rea:src/contracts/toolEffects.ts:55-716; `tools/list` |
| CLI commands | 155 | rea:src/cliCommandNames.ts |
| MCP prompts | 6 | rea:src/contracts/promptContracts.ts |
| `tools/list` bytes, default | 3,211,385 (output schemas 2,397,933 = 74.7%; input 674,251; descriptions 94,366) | stdio JSON-RPC, one page |
| `tools/list` bytes, output schemas off | 810,124 | `REA_MCP_OUTPUT_SCHEMA_PROFILE=off` |
| `tools/list` bytes, compact + off | 222,396 (−93.1%) | plus `REA_MCP_INPUT_SCHEMA_PROFILE=compact` |
| Catalog tokens | unknown; ≈800k by a bytes/4 *estimate*; the review's 832,930 o200k (6.7.0) is *unconfirmed* | no tokenizer available |
| Server instructions | 952 bytes | `initialize` result |
| Hints | readOnly 5/208, destructive 31/208 | `tools/list` annotations |
| Evidence core closure | 17 files, 2,839 lines; external: zod, canonicalize, node:crypto, node:path, node:util | import walk from evidence, bundle, residualUnknown |
| Other closures | toolEffects 1 file/782; ProviderProcess 116/23,216; ZipArtifactReader 120/20,536; analysisErrorProjection 94/16,907 | same walk (regex, includes type-only imports) |
| `inspect-artifact` on a 26,936-byte ELF | 2.08 s and 2.19 s wall; 5,691 bytes; same Evidence ID both runs | CLI, n=2 |
| Same bytes, different path | top-level Evidence ID differs; child ID same | CLI diff |
| `analyze-javascript-application`, 3 files | 2.40 s; 85,449 bytes; 12 edges; `readFile(new URL(…))` not counted as a load (correct, see correction above); coverage "complete" | CLI, n=1 |
| `.tgz` inventory | rejected, `target_unavailable` / `file_format_rejected` | CLI |
| Identical process captures compared | `status:"changed"` (at_ms 50 vs 40) | `capture-process` ×2, then `compare-process-captures` |
| Releases in CHANGELOG | 38 (0.2.0 on 2026-07-12 to 6.7.0 on 2026-10-18); 12 BREAKING sections | `grep` on rea:CHANGELOG.md |
