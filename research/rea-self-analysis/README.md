# REA on REA: techniques, self-analysis, gaps, and what to build instead

This study ran REA ([morluto/rea](https://github.com/morluto/rea), npm `rea-agents`)
against its own **published package**, 6.7.0, with 6.5.0 for version comparison. It
scored every result against an answer key built independently from the package bytes
and the source (`scripts/answer-key.mjs`). Nine further repositories were then used
as lenses to find gaps and to design and build replacements for the weakest parts.

Two rules governed it:
- **Target the published artifact, not the source.** REA's own skill says to skip it
  for source-repository analysis, so the target is `rea-agents-6.7.0.tgz`: 1,775 files,
  28.6 MB, with a PE32+ Windows addon and node-pty ELF prebuilds.
- **Results first, conclusions second.** Each claim below is tagged *run* (measured
  here) or *source* (read in code only).

Related outputs:
- [`../dissection/`](../dissection): the ten-repository knowledge graph and the merge design.
- [`../../tools/rex`](../../tools/rex): the merged product.
- [`../../tools/dissect`](../../tools/dissect): the dissection tool.
- [`../../prototypes/rea-durable-evidence`](../../prototypes/rea-durable-evidence): Absurd-backed durability for REA.
- [`../../skills`](../../skills): agent skills.

Environment: Linux x64 container, Node 22.22.0, GNU objdump 2.42, gdb 15.1, procps `ps`,
Postgres 16.15, running as root. This session's network policy blocked Ghidra and the
laya model weights.

## A. What REA is

REA is a TypeScript MCP server and CLI, MIT licensed.

| Measure | Value |
|---|---|
| Non-test TypeScript | about 352k lines |
| Test code | about 487k lines |
| Published 6.7.0 | 207 MCP tools, 6 prompts, 153 CLI commands |
| Release history | 38 releases from 0.2.0 (2026-07-12) to 6.7.0 (2026-10-18), under `always-bump-minor` |

The `always-bump-minor` policy means breaking changes ship as minor versions: there
are 12 "BREAKING CHANGES" sections. The architecture is ports and adapters, loosely
enforced, with these pieces:
- **Evidence:** content-addressed records (`ev_`+sha256), kept in a per-connection, in-memory `EvidenceLedger`.
- **Provider registry:** chooses between Hopper, Ghidra, IDA and Kuna. With `auto` and two usable providers it returns `ambiguous` (source).
- **Engine bridges:** NDJSON over Unix sockets with bearer tokens.
- **Process ownership:** proven via `ps` and `/proc/<pid>/environ`.
- **HTTP mode:** a single session slot (source).

## B. Techniques REA uses

- **JS/Electron:**
  - Babel 8 inert parsing in a heap-capped worker.
  - ESM/CJS resolver emulation, including `exports` conditions and exact-key `#imports`.
  - webpack/rspack/esbuild module tables and `babel-ast-v3` fingerprints.
  - ASAR per-entry integrity checks and an Electron fuse sentinel scan.
  - IPC pairing on unique literal channels; a semantic IR including `child_process` sites.
  - The `jag_` application graph (RFC 8785), literal-seed feature traces, and tiered version pairing.
- **Artifacts:**
  - Magic-byte inventory, Mach-O dyld path emulation and chained fixups.
  - PE resource trees, Go `.go.buildinfo`, Rust `.dep-v0`, the Dart snapshot hash.
  - Its own .NET CIL reader; WASM via WABT; EVM via evmole in a prlimit'd worker.
- **Native:**
  - Provider dossiers, Ghidra high p-code def-use, and value tracing across calls.
  - Offline call paths (reverse BFS, then all shortest paths).
  - A snapshot cache keyed by target bytes, operation, parameters and profile digest.
- **Runtime:** its own CDP client, attach-only V8 inspector, an Electron hook, PTY capture with filesystem snapshots, Frida, pwndbg, rizin.
- **Epistemics:**
  - Absence is unknown, not a negative.
  - Authority is kept separate from state.
  - Residual unknowns are hash-chained.
  - Obligation ledgers; `verify_reconstruction` passes only the claims declared.
  - Correlation is not treated as causation.
- **Self-engineering:** Stryker (non-gating), conformance fixtures, catalog digests, doc-fact checks, architecture guards, real-tool CI lanes.

## C. REA run on its own package

Every finding is in [`results/findings.jsonl`](results/findings.jsonl) with its evidence
pointer. Verdicts are one of: confirmed, gap, false positive, declared limit, measured.

| # | Stage | Result | Verdict |
|---|---|---|---|
| E0 | `mcp doctor` as root in a container | healthy; 207 tools; catalog digest `96d8f6e6…441c` (source HEAD has 208) | confirmed |
| E1 | `tools/list` on the wire | **3,158,368 bytes**: output schemas 2,353,893 (74.5%), inputs 667,642, descriptions 92,270, ~833k o200k tokens. The opt-in compact profile is 219,226 bytes (−93%) but is not the default | gap (high) |
| E1 | annotations | `readOnlyHint` true on 5 of 207 tools (ledger writes count as mutation) | design |
| E1 | errors | text-only JSON as documented; bad input (relative path, ENOENT) marked `retryable: true` | gap (low) |
| E2 | inventory of its own `.tgz` | **refused** ("unsupported binary format"); the package directory is also refused; only a ZIP repack works | gap (high) |
| E2 | ZIP repack | 1,775/1,775 occurrences, **0 digest mismatches**, 1 PE native addon, 0 source maps | confirmed |
| E3 | JS application analysis, 6.7.0 tree with prod deps | **1,070.7 s**, worker about 6.3 GB at `max_heap_mb` 6144, 5,883 JS files parsed, 29 parse failures, coverage partial, 65,530 semantic unknowns | measured |
| E3 | native addon detection | `native_addon_bindings: 0`, although REA loads `rea-windows-x64.node` via `createRequire(...)(fileURLToPath(new URL(...)))` | gap |
| E3 | Electron | 68 `sender_validation_observations` in a package with no BrowserWindow or IPC | suspect |
| E3 | persistence | `export_evidence_bundle` wrote **889 MB**; `import_evidence_bundle` then failed after 107 s with "**Invalid string length**" (V8 max string), at 5.56 GB peak | gap (high) |
| E6 | PE resources / Go / Rust / fuses / managed / objdump on both `.node` files | all correct; absence labelled unknown | confirmed |
| E6 | wrong-format input | `inspect_pe_resources` gives `invalid_request, retryable: true`; `inspect_managed_artifact` gives `capability_unavailable, retryable: false` for the same mistake | gap (low) |
| E6 | cost per call | REA CLI 1.3–2.3 s and 2–3 KB; `objdump`/`nm`/`strings` 4–26 ms | measured |
| E8 | `compare_process_captures` on two runs of a deterministic command | **`changed`**, although terminal bytes and exit (0/0) are identical; only frame timing differs (1,480 vs 1,740 ms) | false positive |
| E8 | process sampling | 1 sample for a ~1.7 s run; both children (`ps`, `objdump`) missed | declared limit |
| E9 | passive V8 inspector on an idle REA MCP server | 937 scripts observed (185 excluded), 72 own modules loaded at startup | measured |
| E10 | `compare_artifacts` 6.5.0 → 6.7.0 | 883 unchanged, 287 added, 162 removed, 606 changed: equal to the answer key; `verify_reconstruction` fails as it should | confirmed |
| E10 | `compare_artifacts` input | rejects retained-evidence references; needs complete inline Evidence (2 MB each) | gap (low) |
| E10 | `record_unknown` scope | bound to the *currently open* target, not the cited evidence (a 6.7.0 question was scoped to 6.5.0) | gap |
| E10 | guarded resolution | correctly refuses to verify an observed/controlled-replay unknown with static evidence, **but** reports "Evidence state changed… try again" with `{reason: integrity}`. The cause (`has no qualifying resolution evidence`, `src/domain/evidenceBundle.ts:409`) is lost | confirmed + gap |
| E10 | ledger growth | records unbounded (3 → 853); RSS 418 → 930 MB plateau while the ledger exports to 7.5 MB | measured |
| D | SIGKILL with plain REA | ledger 3 → 0 records in the new process | gap (fixed by prototype) |
| E7 | Ghidra deep analysis | not testable: release assets blocked by network policy | env |

### E3–E5: the application graph scored against the answer key

Both analyses and all queries ran in one live REA session:
- **6.7.0:** 1,000.9 s.
- **6.5.0:** 924.2 s.
- **Peak REA memory:** 4.14 GB.
- **Graph size:** 36,196 module rows (27,547 modules, 5,530 assets, 3,119 source modules).

Details are in [`results/e3-e5-live.json`](results/e3-e5-live.json).

| Prediction from source | Run | Verdict |
|---|---|---|
| 1. The `bin` entry is not analysed | `scripts/rea.mjs` is an asset with `unavailable-static-analysis` scope. The outgoing trace reaches 3 nodes and 2 containment edges, none of its 6 dynamic imports | **confirmed** |
| 2. Vendor substring false positives on REA's own pattern table | Not visible in the views retrieved; the answer key shows the substrings in 6–192 files | source only |
| 3. `#subpath` workers missed | `javascriptAnalysisWorkerProcess.js` has only containment edges incoming; none from the 3 `import.meta.resolve("#javascript-analysis-worker")` sites | **confirmed** |
| 4. Bridges via `new URL(..., import.meta.url)` invisible | Seed `hopper_bridge.py` matches no graph entity (11 bridge files are referenced this way) | **confirmed** |
| 5. Windows `.node` loaded via `createRequire` not linked | `native_addon_bindings: 0` | **confirmed** |
| 6. Hash-named chunks pair only by content | `compare_application_versions` exceeded a **64 MiB** MCP response budget after 153.2 s, so it couldn't be inspected | not testable over MCP |

Other measured problems:
- **Traces copy all of the parent's limitations.** A 3-node trace is **1,424,753 bytes**, and 98.8% of that is the parent graph's 5,595 limitation strings, copied into every trace.
- **Some answers can't be retrieved at all.** The `rea-windows-x64.node` string trace also exceeded 64 MiB (86.6 s). Because a session that large also can't be exported and re-imported (E3), the complete results of both operations are unreachable.

## D. Lens experiments

| Lens | Experiment | Result |
|---|---|---|
| leanrea | Same answer-key questions with its plain-CLI recipe (`jq`, `rg -uu`) | 219 ms, 2.5 KB, all 7 answered as raw string hits. Its benchmark also reports REA +38% time and +35% cost, and failing on Notion's ASAR unless `--integrity-policy record-and-continue` is passed |
| caveman (Go engine built from source, telemetry-free) | o200k token accounting and compression | Catalog shrinker −1.2% (it skips `outputSchema`); dropping output schemas −72.7%; JSON compressor 0–0.5% on REA results, because **46.8%** of the inventory result bytes are 64-hex identifiers (14,129 digests); objdump Evidence stores `raw_result` == `normalized_result` (21,710 bytes each) |
| ponytail | Necessity audit of the shipped package | 15.7 MB of bundles **plus** 10.2 MB (1,505 files) of per-module `tsc` output that the workers load by path; 163 files (694 KB) statically unreachable; 0 TODO markers but 228 "for now / temporary / later" phrases |
| strix (read only) | Coverage accounting | strix's `coverage.json` separates unaccounted classes from "tested, nothing found" and marks partial runs; REA has no session-level completeness accounting |
| absurd / pi-durable | Kill REA mid-session | Ledger lost. The Absurd prototype restores it: worker SIGKILLed after 3/6 steps, attempt 2 completed, **0** repeated calls, same 6 Evidence IDs as an uncrashed control |
| my-jev / laya / laya-coreml | Calibration of confidence classes, applied to REA's own claims in this study | **observed:** 9/9 correct (Wilson 95% 0.70–1.00). **derived:** 3/4 (0.30–0.95); the miss is `compare_process_captures` "changed". Both are below a 10-claim floor, so there's no calibration verdict yet. REA's wording ("missing findings do not establish absence") makes its recall gaps (E3-4, E4-1/2) boundaries rather than miscalibration. The method now lives in `rex calibrate`. laya's weights were unreachable (huggingface.co and modelscope.cn blocked) |

## E. Gap list (ranked)

1. **Catalog size is the default** (E1). Fix: ship the compact profile by default; drop output schemas or serve them lazily.
2. **Persistence and retrieval break for large sessions** (E3, E4). The export can't be re-imported (889 MB, V8 string limit), a crash loses everything (D), and version comparison and a string trace exceed even a 64 MiB response. Fix: stream bundles (JSONL); keep evidence outside the process (see the prototype); page every large result.
3. **Its own distribution format is refused** (E2): npm `.tgz` and package directories. Fix: tar/gzip reader and directory inventory.
4. **Static graph blind spots on modern Node packaging** (E3): native addons loaded through `createRequire(new URL)`, workers through `import.meta.resolve("#…")`, bridges through `new URL(…, import.meta.url)`. Fix: resolve those literal patterns (rex's sweep finds all three).
5. **Behavioural comparison treats timing as behaviour** (E8). Fix: compare normalized content separately from timing; report timing as its own dimension.
6. **Epistemic tools hide their reasons** (E10): misleading refusal text, unknowns scoped to the open target. Fix: surface the validator's message; scope unknowns to cited evidence.
7. **Payload duplication** (lens caveman, E4): the result is sent twice over MCP (text and `structuredContent`), `raw_result` == `normalized_result`, 47% of inventory bytes are identifiers, and every trace copies all of the parent's limitations (98.8% of a 1.4 MB trace). Fix: one payload copy; short handles in views; limitations by reference.
8. **Cost per call** (E6, leanrea): 1.3–2.3 s and kilobytes for answers plain tools give in milliseconds. Fix: route cheap questions to cheap probes; reserve the graph for typed relations.
9. **Small contract inconsistencies** (E1, E6, E10): retryable flags, error codes for the same mistake, inline-only inputs.
10. **Release churn** (A): breaking changes in minor versions. Fix: pin exact versions; check `server_identity.catalog`.

## F. What was built

| Artifact | Purpose | Verified by |
|---|---|---|
| `tools/rex` | The merged product: evidence-first probes, durable steps, coverage, calibration, necessity gate, CLI and 10-tool MCP | 14 unit/integration tests; product evaluation 7/7 on the REA answer key in 4.48 s (`results/product-eval.json`) |
| `tools/dissect` | Repos into a knowledge graph (SQLite and FTS5), CLI and 8-tool MCP | 7 tests; 10 repos dissected in about 50 s |
| `prototypes/rea-durable-evidence` | REA tool calls as Absurd durable steps | crash test (`results/prototype-crash-test.json`) |
| `skills/rex`, `skills/dissect` | Agent instructions | — |
| `scripts/` | Everything that produced these numbers | — |

Reproduce:
1. `scripts/answer-key.mjs <pkg> <old-pkg> <out>`
2. `scripts/e1-contract.mjs`, `e2-e3-analyze.mjs`, `e3-e5-query.mjs live …`
3. `e6-native.sh`, `e10-ledger-growth.mjs`, `lens-*.sh`
4. `product-eval.py`

The setup steps are at the top of each script.
