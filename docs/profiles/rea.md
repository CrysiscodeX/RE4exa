# Profile: rea (morluto/rea)

Labels used throughout:
- **author says**: README, docs, CHANGELOG, commit or issue text by the maintainer.
- **users report**: issue threads by non-maintainers, or third-party write-ups.
- **code shows**: `path:line @ commit`. `@b4938ae` is the pinned commit and `@7d36d17` is HEAD.
- **prior internal**: measured earlier by this project, in `docs/merger/01-anatomy/rea.md` (on 2026-10-25, at the pinned commit) or `research/rea-self-analysis/` (on the published 6.7.0).
- **inferred**: my reasoning, with the reason given.

All web access was on 2026-10-26.

## 1. Identity card

| Field | Value | Source |
|---|---|---|
| Repo | https://github.com/morluto/rea ("REA: Reverse Engineer Anything") | README.md:9 @b4938ae |
| npm package | `rea-agents` (binaries `rea`, `rea-agents`); sole npm maintainer `morluto` | registry.npmjs.org/rea-agents, read 2026-10-26 |
| Pinned commit | `b4938aed58737293a6987630476632619713f5cd`: "feat(artifacts): triage desktop installation directories (#5207)", authored by gensokyo-dev, 2026-10-20; package.json version 6.7.0; shipped in 6.8.0 | GitHub commit page; docs/releases/6.8.0.contributions.json @7d36d17 |
| Current HEAD | `7d36d172ab9b1718630a8e8646f87e7dfdbfc71a` (main, 2026-10-26): "fix(evidence): consolidate retained view and verifier ownership", by morluto; package.json 6.8.0 | `git ls-remote`; GitHub commits page |
| Pin → HEAD | 1,780 commits, 4,638 files changed, 39 contributors in 6 days | GitHub compare page, 2026-10-26 |
| Latest release | 6.8.0 (npm 2026-10-25T09:07Z; tag `rea-agents-6.8.0` = `160d821a`). Previous: 6.7.0 on 2026-10-18. 6.6.0 was tagged but never published | npm time map; CHANGELOG.md:3,105,113 @7d36d17 |
| Release history | 39 CHANGELOG entries from 0.2.0 (2026-07-12) to 6.8.0 (2026-10-25); 34 versions on npm; 13 "BREAKING CHANGES" sections; no releases between 3.1.0 (2026-08-09) and 3.2.0 (2026-10-03) | CHANGELOG.md @7d36d17 |
| Licence | MIT, © 2026 morluto. Third-party material keeps its own licences (`THIRD_PARTY_NOTICES.md`, `licenses/`). Commercial engines (IDA, Hopper, JEB) need the user's own licence | README.md:389-404 @b4938ae |
| Author | GitHub `morluto` (bio "member of technically staff", 10.9k followers, 259 public repos, links to x.com/morluto and morluto.bearblog.dev) | github.com/morluto, 2026-10-26 |
| Language / size | TypeScript on Node.js, plus Java, Python, Swift and C++ bridges. About 352k production TS lines, about 502k test lines, 4,553 tracked files (prior internal, pinned) | docs/merger/01-anatomy/rea.md §5 |
| Runtime | Node `^22.19 \|\| ^24.11 \|\| >=26` at the pin; `^22.23.4 \|\| ^24.22.1 \|\| >=26.12.1` at HEAD; 40 → 42 direct dependencies plus optional `frida` | package.json @b4938ae, @7d36d17 |
| Surface | MCP: 208 tools at the pin, 229 at HEAD; 6 prompts. CLI: 155 commands at the pin, 175 at HEAD | src/contracts/toolEffects.ts:55-716 @b4938ae, :55-749 @7d36d17; src/cliCommandNames.ts @both; src/contracts/promptContracts.ts |
| Stars / forks | 387.4k stars, 97.0k forks, 1.4k watchers (GitHub page 2026-10-26). The README claims "300,000 GitHub stars" | github.com/morluto/rea; README.md:357 @b4938ae |
| Issues / PRs | 3,248 issues in total (navigation shows 574 open); PRs 536 open and 3,283 closed; highest number #7218 | GitHub issue and PR pages, 2026-10-26 |
| Downloads | **Not obtained.** api.npmjs.org and npmjs.com were blocked from this session. One secondary article cites 19,743 downloads for 2026-09-09 to 2026-10-08, but it names version 6.3.0, which npm dates to 2026-10-10, so the figure is doubtful | capitalandcompute.net (search snippet only) |
| Other channels | rea.tools website (Cloudflare Workers), Discord, skills.sh skill listing, MCP Registry entry (`server.json`), README in 21 languages | README.md:1-28 @b4938ae; CONTRIBUTING.md:254-257 |

**Note on popularity numbers (inferred):** 387k stars and 97k forks in about 3.5 months is extreme by GitHub standards. No source I found shows the stars were bought. The one careful secondary source (pasqualepillitteri.it) found none. But stars should not be read as a measure of use. Downloads were not measurable here.

## 2. Purpose and origin

- **author says:** "See a feature in an app that you want in your own product? Ask your agent to investigate it with REA. It can inspect the app without its source code, explain how the feature works, show the evidence, and build a version for your project." (README.md:61 @b4938ae). "Analysis runs locally, and results include the evidence and limitations behind each conclusion." (README.md:63)
- **author says:** it is "a local-only reverse-engineering tool with shared CLI/MCP workflows" that must "distinguish observations, derivations, inferences, and unknowns" (AGENTS.md:5 @b4938ae). Its intended use is "lawful research, education, interoperability, software preservation, and analysis of software you own or are authorized to examine" (README.md:376-377).
- **author says:** the packaged skill tells agents to "skip REA for ordinary source-repository analysis" (.agents/skills/reverse-engineer-anything/SKILL.md:3,10-14 @b4938ae).
- **Origin story:** I found **no first-person account** by morluto of why REA was built. The blog and X account were unreachable from this session, and searches returned only third-party articles. **users report** (secondary, unverified): the repo was created on 2026-04-14 and a Show HN in July drew about 3 points. Attention surged around 2026-10-08 to 2026-10-10, with a Hacker News front-page thread (item 50028275) reported as 768 points / 326 comments or 805 / 337 depending on the source. The figures conflict and I could not open the thread.
- **Showcases (author says):** DX-Ball sound-pan reconstruction (passes "3,205 original-x86 cases", reproduces "all 63 compiled function bytes"), the Notion Electron clipboard bridge, and a TH04 PC-98 bullet-ring calculation (README.md:231-254). The DX-Ball and TH04 reconstruction repositories belong to N0zoM1z0, a top contributor, not to a third party.

## 3. Public reception

**Sample:** 12 GitHub issue threads read through GitHub page summaries, 4 issue listings, the PR listing, and about 30 third-party pages seen only as **search-result snippets**. Every non-GitHub host (dev.to, HN, YouTube, Medium, blogs, npmjs.com) failed DNS or returned 403, so I read none of them in full. Treat the third-party items below as "reported by a snippet", not verified.

### 3.1 GitHub (users report, unless marked as maintainer)
| Date | Item | What it says | Confirmed in code? |
|---|---|---|---|
| 2026-10-06→ (open) | [#723](https://github.com/morluto/rea/issues/723) Reduce MCP discovery and result repetition | 4.0.1: tools/list 1,949,695 B for 117 tools. A 3-file JS fixture gives 759,454 MCP bytes, and the result repeats `normalized_result`. 2026-10-13 (wu546526): a client with a 1 MB stdio line cap loaded **0 tools** from 6.4.0. 2026-10-15 (pablodiazjorge): a Claude Code study of 72+72 runs had a median of 300,695 input tokens with REA vs 112,967 without (about 2.3×), with similar accuracy (68 vs 71 of 72) | Yes: dual encoding (docs/mcp-contracts.md:12-14 @b4938ae and :16-18 @7d36d17) |
| 2026-10-08→ (open, P1) | [#1065](https://github.com/morluto/rea/issues/1065) MCP usability under bounded resources | 6.0.0: a 3,020 B fixture gives a 3,559,384 B result (4.2× its Evidence); a ReadBuffer overflow at 10 MiB; cancellation lags; on Windows the first `binary_overview` timed out at 60 s. 2026-10-21: 212 tools = 3,484,718 B | Partly: budget at docs/mcp-contracts.md:94-105 @b4938ae |
| 2026-10-13 (open) | [#2512](https://github.com/morluto/rea/issues/2512) Output-schema-light tools/list | pi-web-ui caps lines at 1,048,576 chars, so 6.4.0 (1,954,727 B) loads 0 tools | `REA_MCP_OUTPUT_SCHEMA_PROFILE=off` exists at the pin, but full stays the default at HEAD (src/config/mcpOutputSchemaProfile.ts:14 @7d36d17). PR #7218 for a compact output profile is open |
| 2026-10-16 → closed 2026-10-26 | [#4620](https://github.com/morluto/rea/issues/4620) Gemini CLI 400 INVALID_ARGUMENT | The trigger was an empty-string `const` (`enum: [""]`) in the `trace_application_feature` schema, after an earlier boolean-`const` fix. The reporter confirmed it fixed in 6.8.0 | Not re-checked |
| 2026-10-18 (open) | [#4973](https://github.com/morluto/rea/issues/4973) compare_web_* fail in Claude Desktop | First `$ref` handling (fixed). A connector warning remains, possibly linked to the ~166 KB `compare_web_captures` input schema (unconfirmed) | No |
| 2026-10-17 (open) | [#4893](https://github.com/morluto/rea/issues/4893) Minified bundle always "partial" | In 6.5.0, coverage is `partial` with `limits: []` for ordinary minified bundles (6.1.0 said `complete`). `omitted_count` changed from 0 to null. In 6.6/6.7, large bundles are skipped for heap (#4348). Fix PR #4915 unmerged; the reporter stays on 6.1.0 | No (test A3) |
| 2026-10-22 (open) | [#6344](https://github.com/morluto/rea/issues/6344) analyze-web-bundle out of memory | A 172,834-byte react-dom chunk exhausts a 4 GiB heap (and 12 GiB): exit 134 with no Evidence. On main it now stops at a 1 GiB worker limit with a partial result (contributor report) | No (test A2) |
| 2026-10-14 → closed 2026-10-24 | [#3756](https://github.com/morluto/rea/issues/3756) extract_firmware "complete" with nothing extracted | Fixed to "partial" with a full-range gap (commit 1545064) | No |
| 2026-10-10 → closed | [#1462](https://github.com/morluto/rea/issues/1462) JS analysis blocks MCP ping/cancel | Ping waits of up to 17.7 s on a Notion ASAR. Cooperative yields added (#1525/#1542/#1545/#1557); the opener said it "should stay open" | The docs still say single-file parsing blocks (docs/mcp-contracts.md:597-600 @b4938ae) |
| 2026-10-15 (open, triage) | [#4230](https://github.com/morluto/rea/issues/4230) Agent-eval scenario for instructions planted in target content | Proposal only; no maintainer reply | Yes: no such scenario (prior internal) |
| 2026-10-23 (open) | [#6480](https://github.com/morluto/rea/issues/6480) Supply-chain audit follow-up | Dependabot alerts disabled; code scanning "no analysis found"; no approving review required on main; 9 transitive packages resolved differently from the lockfile on a fresh 6.7.0 install | Yes: no dependabot.yml/CODEOWNERS at HEAD (404) |
| 2026-10-10 (open, P3) | [#1551](https://github.com/morluto/rea/issues/1551) Binary Ninja backend | No maintainer scope decision; 3 draft PRs | n/a |
| (open) | [#724](https://github.com/morluto/rea/issues/724) Separate content, exit and timing in process comparisons | Matches the timing false positive | Yes: src/domain/process/processObservation.ts:12 @7d36d17 still carries `at_ms` |
| 2026-10-26 (open PR) | [#7184](https://github.com/morluto/rea/pull/7184) bump zod 4.4.3 → 4.6.6 (GHSA-mrhx-c7xc-m3w5) | A vulnerable direct dependency | Yes: package.json:382 @7d36d17 = 4.4.3 |

Other one-line items from the listings: #7027 (2026-10-24), first start after setup times out because the pinned `npx` cold install exceeds the MCP startup deadline; #5723 (2026-10-24), Windows Smart App Control blocks `rea-windows-x64.node`; #1701 (open), the Windows native authority self-test fails on real Windows; #1048 (open), open a pre-imported Ghidra project to avoid startup deadlines; #6176 (open, by morluto), make hard-coded admission ceilings configurable.

### 3.2 Outside GitHub (search snippets only, not opened)
- **Praise:** a HackerNoon tester found the static JS/Electron analysis "genuinely good and fast" (hackernoon.com/i-tested-rea-…). Another tester reports an independent reimplementation matching an original small Electron app across 14 test cases (snippet in a search summary, source not named).
- **Criticism:** it is a "bundler"/"connector", not an analyser: its value depends on the engine you already have (note.com/zephel01; hysenlabs.com). On a 100 MB Electron app, preload counts were reported as zero when they were not. Against a plain agent on a simple Mac app the gap was narrow and REA was slower. Some frontier models refuse reverse-engineering requests. Several sites say "not a paradigm shift" (search summaries across ai.miraheze.org, piyushai.com, pasqualepillitteri.it).
- **Security incident (not rea's code):** a lookalike repo under a "rea-tools" organisation offered an 82.6 MB "Windows .exe" (reported 2026-10-13, 172 downloads). Defender flagged it as Wacatac and 8/45 VirusTotal engines detected it (pasqualepillitteri.it, secondary). This is why README.md:30-34 now warns about official sources.
- **Star scepticism:** dev.to/max_quimby argues that 10k→248k stars in 8 days looks like drive-by starring. pasqualepillitteri.it finds no evidence of inflation.

**Summary:** public discussion is large in volume but mostly secondary: aggregator blogs repeat the README and star counts. The useful, specific criticism is on GitHub, and it centres on three things: context cost (catalog and result size), heap exhaustion and coverage labels on real JS bundles, and client schema incompatibilities. Many triage comments come from a small group of active contributors (CassieFox23, XinwangTao, N0zoM1z0, kaoru0822-kitauji). The maintainer account mostly relabels and merges. Sample: 12 issues read, ~30 snippets; no full third-party article read.

## 4. Architecture and mechanics (decisions, reasons, consequences)

| # | Decision | Why | Consequence / trade-off |
|---|---|---|---|
| D1 | One application layer behind two adapters (MCP server + one-shot CLI); `scripts/rea.mjs` routes `mcp` to the server and everything else to the CLI | **author says** "shared CLI/MCP workflows" (AGENTS.md:5); "Dependencies flow inward: domain…contracts, provider adapters, shared application workflows, then CLI/MCP adapters" (AGENTS.md:17), enforced by `scripts/lib/module-boundaries.mjs` in lint (CONTRIBUTING.md:17-18) | Same results from shell and agent. But each CLI call pays the start-up cost: 2.1–2.2 s on a 27 KB ELF (prior internal, n=2). CLI calls cannot share MCP retained references (docs/mcp-contracts.md:339-346) |
| D2 | **Evidence record** for every success: subject SHA-256, provider and version, parameters, raw and normalized result, confidence ∈ {observed, derived, inferred}, authority (5 classes), environment, limitations, coverage, links; ID = `ev_` + SHA-256 over canonical JSON (RFC 8785) excluding display path | **author says** "Distinguish observations, derivations, inferences, and unknowns; preserve Evidence provenance" (AGENTS.md:5); "Missing coverage is unknown, not absence" (docs/tool-design.md:55) | Claims are auditable and dedupe by construction. Cost: the records are large. 46.8% of inventory result bytes are 64-hex IDs (prior internal, caveman lens). The ID excludes the path only at top level, so the same bytes at another path get a new top-level ID (prior internal) |
| D3 | **In-memory, per-connection ledger** (3 Maps), with explicit export/import and snapshots | inferred: keeps the server stateless and local, and avoids a storage dependency. author says references "belong to the current connection's Evidence ledger" (docs/mcp-contracts.md:328-337) | A crash or restart loses everything not exported (prior internal SIGKILL test: 3 → 0 records). No sharing across connections. Large bundles hit V8 limits (889 MB export could not be re-imported on 6.7.0) |
| D4 | **Complete catalog, always**: every tool is listed even if unavailable; availability is reported through `binary_session` | **author says** "Keep the catalog complete; report capability/session availability instead of truncating schemas. Serialized bytes alone do not establish agent usability." (docs/tool-design.md:11-12); docs/mcp-contracts.md:356-359 | Discovery is stable, but large: 3.21 MB default at the pin (prior internal). Some clients load 0 tools (#2512, #723). HEAD made compact input the default; output schemas are still full |
| D5 | **Effect audit per tool** (10 booleans) → MCP hints derived only from effects; target content marked untrusted by default | **author says** "Declare process, filesystem, network, UI, and mutation effects truthfully" (docs/tool-design.md:65-66); code shows src/contracts/toolEffects.ts:1-53 @b4938ae | Honest and machine-readable. But `mutatesSession` counts in-memory Evidence recording, so only 5/208 tools are readOnly (prior internal), and hosts that auto-approve read-only tools prompt on almost everything |
| D6 | **Bring-your-own engines** (Ghidra, IDA, Hopper, Rizin, GDB, JADX, tshark…) behind an `AnalysisProvider` port; one immutable deep binding per target; deterministic selection with **no fallback** | **author says** "Installers must not install or upgrade unrelated software… Ghidra and IDA are bring-your-own" (AGENTS.md:11); docs/architecture.mermaid:21-22 ("one immutable deep binding per target", "deterministic selection, no fallback") | No hidden engine switching, so results are reproducible. But native depth depends on what the user has installed, and many lanes are host-specific (README.md:177-202). Users call it a "connector" (§3.2) |
| D7 | **Engines are read-only or ephemeral**: Ghidra uses a temporary project deleted on close; IDA is never saved | **author says** AGENTS.md:9; SECURITY.md:38-43 | Safe for the user's projects. But annotations do not persist across sessions the way ReVa, GhidraMCP or ida-pro-mcp let an agent build up a database (see §9C) |
| D8 | **Owned process supervision**: POSIX process groups, Windows Job Objects, deadlines, bounded reads; never kill an unproven PID | **author says** "REA never kills a process it cannot prove it owns" (docs/mcp-contracts.md:605-606); docs/tool-design.md "Own the lifecycle" | Robust cleanup. The cost is a large import closure (116 files, prior internal) and the Linux `ps` prerequisite (README.md:69-73) |
| D9 | **Refuse early on size**: results must fit a 10 MiB budget (counting both encodings); otherwise `resource_constraint` with an Evidence reference and a continuation | **author says** docs/mcp-contracts.md:94-114 | Honest behaviour instead of silent truncation. But results are still sent twice (text + structuredContent), which halves the effective budget (inferred from :94-96) |
| D10 | **Agent-first performance order**: tokens, then time, then CPU/memory | **author says** AGENTS.md:37-58 | A stated priority. The measured defaults still go against it (D4, D9). HEAD moves toward it: compact input default, `analyze_function` summary default (CHANGELOG.md:13,23 @7d36d17) |
| D11 | **Fail-closed scope gate** for runtime, injection and protection-related capabilities; explicit exclusions (DRM/anti-cheat bypass, exploit automation) | **author says** CONTRIBUTING.md:129-168 | Keeps the project defensible. It also slows provider additions (Binary Ninja waits for a decision, #1551) |
| D12 | **Always-bump-minor releases**: "a minor increment does not promise backward compatibility" | **author says** docs/releasing.md:145-148 @b4938ae | Rapid shipping (6.0 → 6.8 in 17 days; 21 breaking bullets in 6.8.0). Callers that follow `@latest` (README.md:107) get breaking contract changes |
| D13 | **No model calls**; quality of conclusions is left to the host agent | **author says** README.md:313-314 | No API keys and no data leaves the machine from REA itself. Whether results are used well depends on the agent's model; the #723 study suggests ~2.3× tokens for similar accuracy |
| D14 | **Human-owned AI contributions**: PRs need a named human owner and a readiness declaration, checked by a workflow | **author says** CONTRIBUTING.md:51-104; AGENTS.md:94-112 | Fits a project where many commits carry agent co-authors (6.8.0: `claude` on 119 commits, `cursoragent` on 58; computed from docs/releases/6.8.0.contributions.json @7d36d17). The check verifies the declaration is filled in, not that a review happened (CONTRIBUTING.md:89-91) |

## 5. Capability inventory (pinned commit b4938ae unless noted)

"Reproduce" says what a successor must build, which binaries it needs, which rules or data, how much it depends on a model, and the licence implications. All rea code is MIT. No capability depends on a model inside rea.

| ID | Capability | Implementation (paths @b4938ae) | Inputs → outputs | Limits | To reproduce elsewhere |
|---|---|---|---|---|---|
| REA-C01 | MCP server, stdio default | src/main.ts, src/server/createServer.ts; SDK `@modelcontextprotocol/server` 2.3.1 | JSON-RPC (protocol 2025-11-25) | One process per client | SDK plus lifecycle and signal handling (src/main/processShutdown.ts). Small |
| REA-C02 | Streamable HTTP transport (opt-in `rea mcp --http`) | src/server/http/serveStreamableHttp.ts | `/mcp`, `Mcp-Session-Id` | No TLS and no client auth; one client at a time (docs/mcp-contracts.md:459-470) | Add a bearer token (r2mcp has one) |
| REA-C03 | One-shot CLI, 155 commands; formats toon/json/yaml/md/jsonl; `--token-limit`, `--filter-output`, `--llms` | src/cli.ts, src/cliCommandNames.ts, src/cliOutput.ts; `incur` | shell → stdout JSON, progress on stderr | ~2 s start-up per call (prior internal) | CLI framework + shared app layer. Medium |
| REA-C04 | Schema profiles: input `full`/`compact` (HEAD default compact), output `full`/`off` | src/config/mcpInputSchemaProfile.ts:13-24; mcpOutputSchemaProfile.ts:7-14 | env vars | Output default full at both commits | Schema projection code, plus client compatibility testing (Gemini, Claude Desktop, pi-web-ui issues) |
| REA-C05 | Session and target lifecycle: `binary_session`, `open_binary`, `close_binary`, `list_documents`, `current_document` | src/application/binary/SessionProviderRouter.ts, BinarySession | path → session + `tool_availability` groups | One deep binding per target | Router + registry. Medium |
| REA-C06 | Hopper-style navigation and bookmarks: `current_address`, `current_procedure`, `goto_address`, `next_address`, `prev_address`, `get_navigation_context`, `list_bookmarks`, `set_bookmark`, `unset_bookmark` | src/hopper/, bridge/hopper_bridge.py | address ↔ UI state | Hopper only; changes UI state | Hopper (proprietary) Python API |
| REA-C07 | Native inventory: `binary_overview`, `list_procedures`, `search_procedures`, `list_segments`, `list_strings`, `search_strings`, `list_names`, `address_name`, `procedure_address`, `procedure_info`, `resolve_containing_procedure`, `address_to_file_offset`, `read_bytes`, `search_bytes`, `list_architectures` | providers: src/ghidra/, src/hopper/, src/ida/; bridge/ghidra/ReaGhidraBridge.java (4,911 lines) | target → Evidence lists | Engine startup deadlines (`REA_GHIDRA_STARTUP_TIMEOUT_MS`, README.md:221-222) | Ghidra (Apache-2.0, needs a JDK) or IDA/Hopper (paid). Bridge script per engine |
| REA-C08 | Decompile/disassemble: `procedure_pseudo_code`, `procedure_assembly`, `batch_decompile`, `analyze_function` (dossier with facet availability), `read_function_instructions`, `inspect_native_instruction`, `inspect_address_context` (HEAD adds `decompile_all`) | same + docs/mcp-contracts.md:47-66 | function → pseudocode, asm, facets | Oversized dossiers → continuation paging (docs/mcp-contracts.md:107-114) | Engine decompiler; facet-availability contract is new design work |
| REA-C09 | Xrefs and call relations: `xrefs`, `find_xrefs_to_name`, `procedure_callers`, `procedure_callees`, `procedure_references`, `get_call_graph`, `trace_call_path`, `build_call_path` (offline reverse BFS → shortest paths), `resolve_native_call_targets`, `trace_native_values` (Ghidra high p-code def-use), `trace_feature` | src/application/binary/, Ghidra bridge | function/name → typed edges, `relationship_coverage`, `residual_unknowns`, `goal_status` | "complete" covers only provider-observed direct edges (docs/tool-design.md:60-64) | Engine xref API + graph search; value tracing needs Ghidra p-code |
| REA-C10 | Annotation (writes): `set_address_name`, `set_addresses_names`, `set_comment`, `set_inline_comment`, `comment`, `inline_comment`, `annotate_native_function` | Hopper bridge; snapshots invalidated on write (docs/cli.md:184-186) | name/comment → engine state | Ghidra ephemeral, IDA read-only (AGENTS.md:9) | Engine write APIs; decide on persistence |
| REA-C11 | Native comparison: `compare_functions`, `find_changed_behavior` (HEAD adds `match_native_functions`) | src/domain/ comparisons | two dossiers → per-dimension deltas, `unknown` when facets are missing | Needs inline Evidence | Pure TS on top of C08 |
| REA-C12 | Apple/Mach-O static: `inspect_macho`, `inspect_signature`, `trace_dylib_resolution` (dyld path emulation), `inspect_native_load_image`, `inspect_native_data_type`, `inspect_native_api`, `inspect_native_dispatch_metadata`, `get_objc_classes`, `get_objc_protocols`, `analyze_swift_types`, `demangle_swift` | src/native/, Swift bridge | Mach-O → load commands, chained fixups, ObjC/Swift metadata | Several macOS-only (README.md:201) | Own Mach-O parser; Swift demangling needs `swift-demangle` or a port |
| REA-C13 | ELF layout and recorded crashes: `inspect_binary_layout`, `inspect_recorded_crash` | src/native/pwntools/, src/native/pwndbg/ | ELF/core → sections, symbols, mitigations, thread registers | Caller-supplied pwntools on Linux x64 (README.md:181,187) | pwntools (MIT) + Python env; optional GDB/pwndbg (GPL; external process) |
| REA-C14 | Go / Rust / PE resources: `inspect_go_binary` (`.go.buildinfo`), `inspect_rust_binary` (cargo-auditable `.dep-v0`), `inspect_pe_resources` | src/go/, src/rust/, src/native/ | binary → build info, deps, resource tree | Absence reported as unknown (prior internal E6) | Small format parsers; public format specs. Easy |
| REA-C15 | CLI-engine adapters: `inspect_with_objdump`, `execute_rizin_command`, rizin debug sessions (start/command/status/close), `list_cutter_sessions`, `cutter_command`, GDB/MI sessions (`start_gdb_session`, `gdb_console`, `gdb_session_status`, `close_gdb_session`) | src/objdump/, src/rizin/, src/gdb/, bridge/cutter | commands → Evidence | Raw-command tools are `executesForeignCode`/`mutatesTarget` (toolEffects.ts:56-80) | Binaries: binutils (GPL, external), rizin (LGPL), GDB (GPL). Process supervision needed |
| REA-C16 | Frida runtime instrumentation: 9 tools (`list_frida_devices` … `instrument_with_frida`) | src/frida/; optional dep `frida` | process + script → observations | Runs foreign code; LGPL notice gap (prior internal) | frida (wxWindows/LGPL-style); scope review needed |
| REA-C17 | Artifact inventory and extraction: `inspect_artifact`, `extract_artifact`, `compare_artifacts`, `inspect_desktop_application`, `inspect_plist`, `inspect_keyed_archive`, `decode_interface_builder`, `inspect_asset_catalog` | src/artifacts/ (ZIP family, ASAR, DMG, Mach-O slices, directories); src/domain/artifactDecompressionBudget.ts | path → inventory graph with manifest/graph digests and scoped coverage | ZIP family = zip/ipa/apk/msix/appx/hap/hsp/app-pack (zipPackageFormat.ts:2-11); **no tar/gzip**; 500× / 256 MiB decompression cap; symlinks rejected | `@zip.js/zip.js`, `@electron/asar`, `plist` (all permissive); the hardening rules are the real work |
| REA-C18 | Apple app graph and native UI: `project_apple_application_graph`, `observe_native_ui`, `trace_native_ui_action`, `capture_native_ui_scenario`, `observe_native_calls` | src/native/, Swift bridge | app → graph, UI tree, call observations | macOS only; drives UI | macOS accessibility APIs; Swift helper |
| REA-C19 | JS/Electron static analysis: `analyze_javascript_application`, `trace_application_feature`, `trace_javascript_semantics`, `compare_application_versions`, `compare_source_to_bundle`, `compare_javascript_export_shapes`, `compare_bundles`, `recover_javascript_sources`, `analyze_web_bundle`, `inspect_electron_fuses` | src/domain/javascript/ (42k lines), src/application/javascript/ (13k), Babel 8 in heap-capped worker, `@jridgewell/trace-mapping` | dir/ASAR → `jag_` application graph: modules, imports (ESM/CJS resolver emulation incl. `exports`), source maps, Webpack/Rspack factories, preload/contextBridge/IPC pairing, native add-ons | Misses literal `import.meta.resolve`/`createRequire(new URL)` forms (prior internal); heap exhaustion on some bundles (#6344, #4348); "complete" = not truncated | **Largest rebuild cost.** Needs a JS parser (Babel, MIT), a Node resolver emulator, a bundler-runtime fingerprint table (data), and IPC pairing rules. No model needed |
| REA-C20 | Browser observation: 14 tools (`list_browser_targets`, `inspect_web_page`, `observe_web_session`, `observe_web_execution`, `inspect_web_event_listeners`, `trace_web_source_location`, `trace_web_module_imports`, `export_web_scripts`, `capture_web_screenshot`, `compare_web_screenshots`, `capture_browser_scenario`, `compare_web_captures`, `discover_webmcp_tools`, `inspect_web_network_capture` (HAR/SAZ)) | src/browser/ (25k lines); own CDP client; `playwright-core` 1.58.2 | loopback CDP endpoint → page, scripts, network, screenshots | Chrome-family browser; accesses the network | Chrome + CDP client; HAR/SAZ parsers |
| REA-C21 | Electron/V8 runtime: `list_electron_targets`, `inspect_electron_page`, `capture_electron_scenario`, `list_javascript_runtime_targets`, `observe_javascript_runtime` (passive V8 Inspector), `reconcile_javascript_runtime`, `correlate_static_and_runtime` | src/inspector/, src/electron/ | inspector endpoint → scripts, locations; static↔runtime join | Runs the target with user privileges, no sandbox (SECURITY.md:33-36) | CDP/Inspector protocol; join logic on top of C19 |
| REA-C22 | Process capture and comparison: `capture_process_scenario`, `compare_process_captures` | src/process/; `@lydell/node-pty`, `@xterm/headless` | command + actions → frames, exit, filesystem before/after | Timing counted as behaviour (prior internal; #724) | PTY lib + headless terminal + filesystem snapshot |
| REA-C23 | .NET managed: `inspect_managed_artifact`, `inspect_managed_members`, `compare_managed_members`, `inspect_managed_native_boundaries`, `verify_managed_native_boundaries`, `import_managed_reconstruction`, `project_managed_application_graph` | src/dotnet/ (own CIL/metadata reader) | PE/CLI → metadata, IL, P/Invoke boundaries | Static only (README.md:191) | ECMA-335 reader. Medium |
| REA-C24 | Android/Flutter/Harmony static: `inspect_android_package`, `search_android_classes`, `inspect_android_class`, `inspect_android_method`, `trace_android_references`, `project_android_application_graph`, `decode_android_resources` (Apktool), `inspect_apktool_client`, `identify_flutter_build`, `inspect_dart_aot`, `project_harmony_application_graph` | src/android/, src/flutter/ | APK → manifest, classes, decompiled methods, references | Headless JADX + full JDK (README.md:192); Apktool supplied by the caller | JADX (Apache-2.0), Apktool (Apache-2.0), JDK |
| REA-C25 | JEB client: `inspect_jeb_client`, `open_jeb_project`, `list_jeb_units`, `decompile_jeb_item` | src/jeb/ | `REA_JEB_MCP_URL` → units, pseudocode | Caller-started JEB MCP (README.md:194) | JEB (commercial) |
| REA-C26 | ADB device ops: 24 tools (list/inspect device, packages, processes, files, logcat, settings, bugreport, screen; install/uninstall/start/stop app, push/pull) | src/adb/ (AdbProvider.ts 3,232 lines) | device → observations; changes the device | `mutatesDevice` on writes | adb (Apache-2.0); device |
| REA-C27 | Firmware: `inspect_firmware_regions`, `extract_firmware` | src/firmware/ | image → regions, extraction, gaps | Binwalk/Unblob on Linux (README.md:197) | binwalk (MIT) / unblob (MIT) |
| REA-C28 | Captures and signals: `inspect_pcap_client`, `inspect_pcap_capture`, `inspect_packet_capture`, `inspect_packet_fields`, `inspect_signal_decoders`, `decode_signal_recording` | src/pcap/, src/captures/, src/signals/ | pcap / sigrok files → fields, summaries | tshark 4.x + prlimit; sigrok-cli 0.7.2 (Linux) | tshark (GPL, external), sigrok (GPL, external) |
| REA-C29 | WASM / EVM / SQLite: `inspect_wasm_artifact`, `compare_wasm_interfaces`, `inspect_evm_interface`, `inspect_sqlite_database` | src/wasm/ (WABT supplied by caller), src/evm/ (evmole in a prlimit'd worker), src/sqlite/ (node:sqlite) | file → sections/WAT, selectors, schema/rows | WABT 1.0.42; EVM Linux x64; SQLite needs Node ≥24.15 (README.md:184-186) | WABT (Apache-2.0); evmole (MIT); node:sqlite |
| REA-C30 | Evidence bundles and views: `get_evidence_bundle` (summary/filters), `export_evidence_bundle` (streamed, atomic), `import_evidence_bundle` (validate whole, atomic merge), `inspect_analysis_view` (summary/section/page of retained Evidence) | src/application/investigation/EvidenceLedger.ts:44-140; src/application/EvidenceBundleFiles.ts; src/application/JsonInputFile.ts | Evidence ↔ canonical JSON files | In memory; V8 string limit on huge imports (prior internal) | ~17-file closure (prior internal); zod + canonicalize. **Easy to lift** |
| REA-C31 | Residual unknowns: `record_unknown`, `update_unknown`, `list_unknowns` (paged), `verify_unknown_resolution` | src/domain/residualUnknown.ts; src/domain/evidenceBundle.ts | question → hash-chained revisions; resolution needs qualifying Evidence | Unknown scoped to the open target, not the cited Evidence (prior internal E10); unclear refusal text | Pure TS. **Easy to lift** |
| REA-C32 | Reconstruction verification: `verify_reconstruction`, `build_reconstruction_obligation_ledger`, `evaluate_reconstruction_coverage` | src/domain/ reconstruction; docs/reconstruction-obligation-ledgers.md | declared claims + verifier outcomes → ledger | Passes only declared claims; 6.8.0 tightened proof records (CHANGELOG.md:18 @7d36d17) | Pure TS + a test-runner contract |
| REA-C33 | Snapshot cache (exact-key reuse across CLI calls; MCP `open_binary`/`close_binary snapshot_path`) | AnalysisSnapshotCache; docs/cli.md:177-215 | target bytes + op + params + provider + settings → cached result | Mutations/cursors excluded; owner-only files | Content-addressed cache. Small |
| REA-C34 | Effect audit, MCP hints and untrusted marker | src/contracts/toolEffects.ts (782 lines, no imports); src/server/toolResultEncoding.ts | tool → 10 effects → 4 hints; `_meta.provenance.untrusted_content` | readOnly hint on only 5/208 | **Lift as is** (one file) |
| REA-C35 | Response budget and continuation | src/config/mcpResponseBudget.ts; docs/mcp-contracts.md:94-128 | result → inline, or `resource_constraint` + reference + continuation | 10 MiB; both encodings counted | Pattern only |
| REA-C36 | Progress and cancellation | docs/mcp-contracts.md:537-606 | progress tokens (≤1 update / 100 ms); AbortSignal to providers; `partial_observation` | Synchronous parse phases still block (:597-600) | Pattern; needs worker offload |
| REA-C37 | Error contract: 20 codes with category, retryable, remediation | src/domain/analysisErrorProjection.ts; docs/error-contract.schema.json; docs/user-visible-errors.csv | failure → JSON in text content, `isError: true` | `invalid_request` retryable at the pin (:569-576), fixed at HEAD (:635-641) | Schema + projection; 94-file closure (prior internal) |
| REA-C38 | Provider registry and engines: Hopper (macOS/Linux, can be installed after approval), Ghidra (incl. Windows "P0 experimental", 16-bit DOS), IDA via external ida-pro-mcp, Kuna | src/application/AnalysisProvider.ts:277-289; AnalysisProviderRegistry.ts; docs/ghidra-provider.md, docs/ida-provider.md, docs/kuna-provider.md | `--provider` / auto | `auto` with two usable providers → `ambiguous` (prior internal) | Port interface + per-engine bridge |
| REA-C39 | Owned process supervision (Unix groups, Windows Job Objects via Node-API addon) | src/process/ProviderProcess.ts; native/windows/src/process.cc | spawn → owned tree | 116-file closure; Windows addon built with MinGW (GPLv3 + GCC Runtime Exception notices) | Pattern; OS-specific code |
| REA-C40 | Setup / doctor / update / uninstall for 15+ agent clients (Claude Code, Claude Desktop, Codex, Cursor, Gemini CLI, Windsurf, Devin, OpenCode, Antigravity, Copilot CLI, VS Code, Grok…) | src/application/Doctor.ts, ClientConfigurationPublication.ts, Setup*; install.sh | dry-run plan → approved additive edits with backups | Edits other apps' configs; Hopper install uses vendor checksums | Per-client config dialects (JSON/JSONC/TOML), the most fiddly part |
| REA-C41 | Agent skill `reverse-engineer-anything` (23,510-byte SKILL.md + references) and 6 MCP prompts (`investigate_feature`, `compare_application_versions`, `verify_reconstruction`, `trace_crash`, `audit_residual_unknowns`, `prepare_bounded_process_capture`) | .agents/skills/reverse-engineer-anything/; src/contracts/promptContracts.ts | instructions | Skill version "42" | Prose. **Model-dependent**: its value depends on how the host model follows instructions |
| REA-C42 | Agent evaluation (closed-claim grading against fixture oracles; `npm run verify:agent` drives Codex CLI) | src/evaluation/KnownAnswerEvaluation.ts; docs/client-verification.md:446-560 | transcripts → graded claims | Not in CI; no injection scenario (#4230) | Grader is portable. Needs a real agent CLI and API spend |
| REA-C43 | Agent environments: `environment-serve` (replay a recorded web capture as an MCP environment); at HEAD, derived state with evidence-gated writes, `export_environment_bundle` | docs/agent-environments.md; CHANGELOG.md:7,22,38-42 @7d36d17 | capture/manifest → MCP server | HTTP; replay fidelity bounded by recordings | New work; capture → state-learning rules |
| REA-C44 | Reference-source import (`import-reference-source`) for comparing older source to artifacts | src/reference/; docs/cli.md:234+ | source tree → outline Evidence | Bounded traversal | Filesystem walker + language detection |
| REA-C45 | HEAD-only formats (+21 tools): PE imports/certificates/load config, native exports, ELF notes, kernel modules, devicetree, BEAM, Python pyc, IL2CPP, GPU code objects, GGUF/safetensors (`inspect_model_artifact`), APK signatures, Apple IPS, byte entropy, Godot PCK / PyInstaller / Node SEA (`open_bundle_resources`), `inspect/update_analysis_settings`, `decompile_all`, `match_native_functions` | toolEffects.ts @7d36d17; CHANGELOG.md:43-52 | — | Not in the pinned commit | Per-format parsers |
| REA-C46 | Logging and identity | src/logger.ts (pino JSON on stderr, `REA_LOG_LEVEL`); toolLogging.ts (duration and status, never input); catalog digests in doctor/`binary_session` | — | No metrics or tracing | Small |

Count: **46 capability entries**, covering all 208 pinned MCP tools (checked by script: every tool falls in C05–C32, none twice), plus the cross-cutting surfaces C01–C04 and C33–C46.

## 6. Workloads

- **Concurrency.** One server process per client (stdio). HTTP serves one client at a time and keeps one shared active target (docs/mcp-contracts.md:465-470 @b4938ae). Each target has exactly one deep provider binding (docs/architecture.mermaid:21). Heavy JS analysis runs in a heap-capped worker (`#javascript-analysis-worker`, `max_heap_mb`); EVM and SQLite run in bounded workers. **inferred:** there is no job queue, scheduler or parallel fan-out across targets. Parallelism belongs to the agent, which would have to start several servers, each with its own ledger.
- **Long jobs.** JS analysis of a real package took 1,000–1,070 s with a ~6.3 GB worker (prior internal, 6.7.0). Cold Ghidra can exceed client waits: there are startup-deadline env vars (README.md:221-222) and a feature request to pre-import projects (#1048). Progress notifications are rate-bounded with no fake percentages (docs/mcp-contracts.md:539-549). Cancellation reaches providers. Synchronous parse phases still delay ping and cancel (docs/mcp-contracts.md:597-600; #1462 measured up to 17.7 s before fixes).
- **Sessions.** Evidence and unknowns live per connection in memory (EvidenceLedger.ts:44-47). `close_binary` clears them; opening another target keeps them (docs/mcp-contracts.md:328-337). Nothing is persisted unless exported or saved as a snapshot.
- **Caching.** (a) The snapshot cache reuses an exact result keyed by target bytes, operation, parameters, provider and settings; it excludes mutations and cursors, and a metadata write invalidates it (docs/cli.md:179-186). (b) Retained Evidence references let follow-up tools skip re-running producers (docs/mcp-contracts.md:303-326). (c) HEAD reuses validation of authenticated immutable parents (CHANGELOG.md:57 @7d36d17). (d) Validator reuse cut first-call compilation (#723: median 6.286 s → 0.724 s in isolated tests).
- **Failure handling.** Typed `Result` errors with 20 codes. `partial_observation` is kept on failure. `cleanup_incomplete` lists the remaining owned resources. Publication receipts (`details.published`) separate a committed write from a failed one (docs/mcp-contracts.md:550-575). Raw partial observations are **not** recorded in the bundle, and "an empty bundle does not prove that no partial work or side effect occurred" (:576-583).
- **Duplicate and overlapping work.** Recording is idempotent by Evidence ID: same content returns "duplicate", and different content under the same ID is rejected (EvidenceLedger.ts:48-72). Bundle import validates everything first, then merges atomically, rejecting conflicts and replacing records whose only differences are metadata (:74-128). Repeating the same workflow result does not create a new unknown, and explicit `record_unknown` rejects duplicate creation (docs/mcp-contracts.md:136-140). Across processes there is no merge except by exporting and importing bundles. **inferred:** two servers on the same target do the same work twice.

## 7. Organisation

- **Maintainers.** One owner, `morluto`, who is also the only npm maintainer. A few highly active collaborators and contributors: N0zoM1z0 (assignee on #1065), kaoru0822-kitauji, gensokyo-dev. There are no CODEOWNERS or GOVERNANCE files (404 at HEAD).
- **Concentration (computed from docs/releases/*.contributions.json @7d36d17):**

| Release | Commits | morluto as first author | morluto anywhere in authors | Distinct commit authors | PRs | Distinct PR authors |
|---|---|---|---|---|---|---|
| 6.5.0 | 893 | 373 (41.8%) | 534 (59.8%) | 205 | 529 | 163 |
| 6.6.0 | 571 | 334 (58.5%) | 339 (59.4%) | 112 | 236 | 66 |
| 6.8.0 | 1,740 | 1,295 (74.4%) | 1,401 (80.5%) | 157 | 497 | 134 |

  Correction to prior notes: "527/537 of 893" counted any-author appearances. First-author share in 6.5.0 is 41.8%. Agent co-authors: `claude` appears on 118/88/119 commits, `cursoragent` on 58 (6.8.0), `factory-droid[bot]` on 46 (6.5.0).
- **Cadence.** Release Please with always-bump-minor (CONTRIBUTING.md:372-375; docs/releasing.md:145-148). 39 changelog entries in 105 days; 9 releases between 2026-10-03 and 2026-10-14. "REA changes quickly" (README.md:126).
- **Triage.** 5 issue forms, a `triage` label, and P1/P2/P3 labels. The maintainer often only relabels; community members do most diagnosis (seen in #723, #2512, #4893, #3756, #1551). Many large threads have no maintainer comment.
- **Roadmap.** docs/roadmap.md points to tracker issues #32, #48 and #39, plus 5 priorities and admission criteria. Large design threads stay open (#740, #1065, #723, #4227).
- **Contribution process.** Conventional Commits; a human owner and readiness declaration enforced by a check; a fail-closed scope gate; real-provider lanes for provider claims (CONTRIBUTING.md:53-168, 281-306). Branch protection has required checks but no required approving review (#6480, user report).

## 8. Documentation, notes and metadata

- **Evidence records**: see D2, src/domain/evidence.ts. **Unknowns**: hash-chained revisions. **Obligation ledgers**: docs/reconstruction-obligation-ledgers.md.
- **Contracts**: a generated tool catalog (docs/mcp-contracts.md "Generated catalog"), docs/error-contract.schema.json, docs/user-visible-errors.csv, catalog and schema digests reported by `doctor` and `binary_session`.
- **Release records**: CHANGELOG with migration notes per breaking change (checked in CI per review: .github/workflows/release.yml:275-283), and machine-readable `docs/releases/<v>.contributions.json` (commits, bodies, co-authors, PRs).
- **Verification notes**: docs/verification/*.md and *.json, with base revision, artifact SHA-256, alternating samples and stated limits (e.g. javascript-module-references-2026-10-15).
- **Logs**: pino JSON on stderr. Request arguments, bridge tokens and environment are redacted (CONTRIBUTING.md:352-356). Snapshot files use owner-only permissions (docs/cli.md:182).
- **Docs size**: 118 Markdown files in docs/ (prior internal); a VitePress site; README in 21 languages, checked for consistency by a test.
- **What is not recorded**: no investigation-level coverage document; no persistent audit log of tool calls; no decision records (ADRs); debt lives in issues because TODO markers fail CI.

## 9. Limitations

### 9A. Limitations shown by the code (tests: **TO RUN**, see plan §2)

Severity: **blocks** / **degrades** / **cosmetic**. Kind: **design** (intended) or **accident**.

| # | Area | Limitation | Evidence (code) | Test / measurement | Severity | Kind |
|---|---|---|---|---|---|---|
| A1.1 | Formats | No tar/gzip/tgz in the ZIP family or the subject formats, so rea cannot inventory npm tarballs | zipPackageFormat.ts:2-11 @b4938ae; evidence.ts:42-71 @b4938ae and :44+ @7d36d17 (adds godot-pck, pyinstaller, node-sea; still no tar) | prior internal: `.tgz` → `target_unavailable`/`file_format_rejected`. **TO RUN** at HEAD | blocks (for npm packages) | accident (inferred: no stated reason) |
| A1.2 | Formats | Native depth needs an external engine. Without Ghidra/IDA/Hopper only static readers work; rizin, tshark, sigrok, WABT, pwntools, JADX and Apktool are BYO | README.md:177-211 @b4938ae; AGENTS.md:11 | **TO RUN**: `execute-rizin-command` with rizin absent; `providers` | degrades | design |
| A1.3 | Platform | Many lanes are single-host: EVM, pwntools, tshark+prlimit, sigrok on Linux x64; DMG/Mach-O UI on macOS; Windows Ghidra "experimental" | README.md:181-202,219 | **TO RUN**: `providers` lists `unsupported_host` entries | degrades | design |
| A2.1 | Scale | JS analysis memory: ~6.3 GB worker and 1,070 s for a real package (prior internal); OOM on a 173 KB react-dom chunk (#6344) | JavaScriptArtifactReconstruction.ts:164 (`max_heap_mb`) | **TO RUN**: 1/10/50 MB bundles, wall time and RSS | blocks (on some bundles) | accident |
| A2.2 | Scale | Large bundles hit the V8 string limit: an 889 MB export could not be re-imported on 6.7.0. The streaming reader is new at the pin but still assembles one JS value | JsonInputFile.ts:250-282 @b4938ae (prior internal) | **TO RUN**: optional synthetic large bundle | blocks (large sessions) | accident |
| A2.3 | Scale | Decompression bomb guard: 500× compressed size, 256 MiB floor | artifactDecompressionBudget.ts:18-35 | **TO RUN**: 1 GiB-zeros zip; nested depth 5; 10k entries | — (a strength; check behaviour) | design |
| A3.1 | Correctness | Same bytes at another path → different top-level Evidence ID, because nested child Evidence embeds `local_path` | evidence.ts:251-288 @b4938ae | prior internal: `ev_0425…` vs `ev_b74d…` on `/bin/true` copies. **TO RUN** at HEAD | degrades (dedupe, caching) | accident |
| A3.2 | Correctness | Coverage "complete" means "not truncated", not "every load resolved"; unresolved `import(p)` can sit under "complete" | javascriptApplicationEvidenceSchemas.ts:197-203 (prior internal round 2) | **TO RUN**: minified fixture | degrades | design wording |
| A3.3 | Correctness | Modern literal loading forms missed: `import.meta.resolve('#…')`, `createRequire(new URL(…))`, bridges via `new URL(…, import.meta.url)` | no match in src/domain/javascript @b4938ae (prior internal); not checked at HEAD | prior internal E3-E4 on REA's own package. **TO RUN** | degrades | accident |
| A3.4 | Correctness | Process comparison counts timing jitter as change | processObservation.ts:12 (@both); processComparison.ts:416-424 | prior internal: `status:"changed"` at 50 vs 40 ms. **TO RUN** at HEAD | degrades (false positives) | design choice with accidental effect (#724 open) |
| A3.5 | Correctness | Coverage regressions in releases: minified bundle "partial" with `limits: []` (#4893); firmware "complete" with nothing extracted (#3756, fixed) | — | users report | degrades | accident |
| A4.1 | Agent cost | Default catalog 3,211,385 B at the pin (output schemas 74.7%). Compact+off = 222,396 B. HEAD defaults input to compact, but output schemas stay full | mcpInputSchemaProfile.ts:24 @b4938ae → :18 @7d36d17; mcpOutputSchemaProfile.ts:14 @both | prior internal at the pin. **TO RUN** at HEAD (229 tools) | blocks (frame-capped clients load 0 tools: #2512) / degrades | design (D4) |
| A4.2 | Agent cost | Each success is sent twice (text + structuredContent); traces copy every parent limitation (a 3-node trace = 1.42 MB, 98.8% limitations) | docs/mcp-contracts.md:12-14 @b4938ae, :16-18 @7d36d17; javascriptFeatureTrace.ts:151-154 | prior internal. **TO RUN**: bytes of text vs structured for one call | degrades | design (compatibility) |
| A4.3 | Agent cost | 2.3× input tokens for similar accuracy in a 144-run Claude Code study | — | users report (#723, 2026-10-15) | degrades | — |
| A5.1 | State | Ledger is in memory; a crash loses the session | EvidenceLedger.ts:44-47 @b4938ae; :58-60 @7d36d17 | prior internal: SIGKILL 3 → 0. **TO RUN** at HEAD | blocks (long investigations) | design (D3) |
| A5.2 | State | No sharing between processes; retained references are per connection; HTTP serves one client | docs/mcp-contracts.md:328-337, 465-470 | **TO RUN**: two processes, same snapshot path | degrades | design |
| A5.3 | State | Unknowns are scoped to the open target, not the cited Evidence | — | prior internal E10 | degrades | accident |
| A6.1 | Security | Runtime tools execute targets with user privileges; not a sandbox | SECURITY.md:33-36; toolEffects.ts `executesForeignCode` | static | blocks (for untrusted targets without a VM) | design |
| A6.2 | Security | Prompt injection: content is marked untrusted, but nothing is filtered and there is no adversarial evaluation | toolResultEncoding.ts:25-33 (prior internal); #4230 open | **TO RUN**: planted-instruction fixture, check marker | degrades | design (marker) + gap (no eval) |
| A6.3 | Security | HTTP transport has no TLS or authentication; a non-loopback bind only warns | docs/mcp-contracts.md:459-463 @b4938ae, :753-754 @7d36d17; no auth/bearer strings in serveStreamableHttp.ts @both | **TO RUN**: loopback `tools/list` without a credential | blocks (shared hosts) | design (opt-in) |
| A6.4 | Security | Secrets are not detected or redacted in target output ("do not infer secrecy from names or text patterns") | AGENTS.md:13 | **TO RUN**: fake token echoed? | degrades | design |
| A6.5 | Security | Supply chain: zod 4.4.3 (advisory GHSA-mrhx-c7xc-m3w5, PR #7184 open); no Dependabot, scanners or SBOM | package.json:382 @7d36d17; .github/dependabot.yml 404 @7d36d17 | prior internal `npm audit` (zod high) | degrades | accident |
| A7.1 | Install | Node floor raised at HEAD to `^22.23.4 \|\| ^24.22.1 \|\| >=26.12.1`; Node 23/25 unsupported; the installer does not upgrade Node | package.json @7d36d17; CHANGELOG.md:20 | **TO RUN**: this host's Node 22.22.0 vs 6.8.0 | blocks (older hosts) | design (security floor) |
| A7.2 | Install | Linux needs procps `ps`; Windows source checkouts lack the native addon; Smart App Control can block it (#5723); a cold `npx` install can exceed the MCP startup deadline (#7027) | README.md:69-73; CONTRIBUTING.md:224-240 | **TO RUN**: `doctor --json` | degrades | mixed |
| A8.1 | Ergonomics | `invalid_request` always retryable at the pin, so a missing file says "retry" | analysisErrorProjection.ts:569-576 @b4938ae | prior internal. Fixed at HEAD (:635-641). **TO RUN** both | degrades | accident (fixed) |
| A8.2 | Ergonomics | The same mistake gives different codes from sibling tools (`invalid_request` vs `capability_unavailable`); a rejected unknown resolution shows "Evidence state changed… try again" | EvidenceLedger.ts:436; analysisErrorPresentation.ts:274-275 @b4938ae | prior internal. **TO RUN** | degrades | accident |
| A8.3 | Ergonomics | 208–229 tools listed whether or not usable on this host; availability needs an extra `binary_session` call | docs/mcp-contracts.md:356-371 | prior internal | degrades | design (D4) |
| A8.4 | Ergonomics | Client schema incompatibilities: Gemini 400 (#4620, fixed 6.8.0), Claude Desktop connector warning (#4973 open), Muse Spark `$ref` depth (#919) | — | users report | blocks (per client) | accident |
| A9.1 | Tests/CI | `verify:agent` not in CI; no injection scenario; mutation testing non-blocking and narrow (9 files); results of 16 real-engine lanes not visible to a static reader | stryker.config.mjs:20 (prior internal); no `verify:agent` in .github (prior internal) | **TO RUN**: recount at HEAD | degrades | design / gap |

### 9B. Limitations reported publicly
See the §3.1 table. Each row there gives URL, date, and whether the code confirms it. More, from search snippets only (unconfirmed): wrong zero preload counts on a 100 MB Electron app; slower than a plain agent on a simple Mac app; frontier models refusing RE prompts; output is pseudocode, not original source (README.md:304-306 agrees). The README's own "not supported" notes are the host-requirement table (README.md:177-202), the "release availability" caveat (README.md:224-225), and SECURITY.md:33-36 ("not a sandbox").

### 9C. Limitations by comparison (capability only, from each tool's own README, read 2026-10-26)
| Tool | What it does that rea does not (or does differently) | rea status |
|---|---|---|
| [GhidraMCP](https://github.com/LaurieWired/GhidraMCP) (Apache-2.0) | Renames methods and data in a live Ghidra project; headless mode saves changes between runs | rea's Ghidra projects are temporary and deleted on close (SECURITY.md:38-43). No persistent annotation |
| [ReVa](https://github.com/cyberkaida/reverse-engineering-assistant) (Apache-2.0) | Renames variables and fixes data types inside Ghidra; works across many programs in one project; optional PyGhidra scripting; small tool results with links to limit "context rot" | No Ghidra write-back; one deep binding per target per connection; large default results (A4) |
| [ida-pro-mcp](https://github.com/mrexodia/ida-pro-mcp) (MIT) | Patching (`patch`, `patch_asm`), `set_type`/`declare_type`, `idb_save`, `py_eval`; headless supervisor with up to 4 database workers; debugger extension | rea uses ida-pro-mcp as its IDA backend but keeps IDA read-only (AGENTS.md:9) |
| [Binary Ninja MCP](https://github.com/fosdickio/binary_ninja_mcp) (GPL-3.0) | Binary Ninja IL levels (HLIL/MLIL/LLIL, SSA); retyping, prototypes, byte patching; switching between several open binaries | No Binary Ninja provider (#1551 open, P3) |
| [radare2-mcp](https://github.com/radareorg/radare2-mcp) (MIT) | Read-only mode (`-R`); per-tool enable/disable; sandbox settings; supervisor approvals; **HTTP bearer auth**; per-session multiplexing | rea has no tool allow-list (none found in the docs I read), no HTTP auth, one HTTP client at a time |
| [binwalk](https://github.com/ReFirmLabs/binwalk) v3 (MIT, Rust) | Own signature scanner over many formats; entropy analysis; usable as a Rust library | rea calls binwalk/unblob for firmware; byte entropy arrives only at HEAD (`inspect_byte_entropy`) |
| [jadx](https://github.com/skylot/jadx) (Apache-2.0) | GUI with search and usages, smali debugger, deobfuscation with mapping files, Gradle project export, plugin marketplace | rea uses headless JADX for classes and methods; mapping-file deobfuscation and project export not found in rea docs read |
| [semgrep](https://github.com/semgrep/semgrep) (LGPL-2.1) | Rule-based semantic pattern matching over 30+ languages; taint (single-file in CE); 2,000+ community rules; `semgrep mcp` | rea has no rule engine or rule registry; its JS semantics are fixed code, not user-written rules |
| [electronegativity](https://github.com/doyensec/electronegativity) (Apache-2.0, archived; successor ElectroNG) | Grades Electron apps against the Electron security checklist (contextIsolation, dangerous functions, CSP…); outputs CSV/SARIF; accepts directories and ASAR | rea maps preload/contextBridge/IPC/fuses as Evidence but does not grade against a checklist; no SARIF output (CLI formats are toon/json/yaml/md/jsonl, src/cliOutput.ts:2-10) |

### 9D. Movement since the pinned commit (b4938ae, 2026-10-20 → 7d36d17, 2026-10-26)
- **Fixed or improved at HEAD:**
  - compact input schemas are the default (mcpInputSchemaProfile.ts:18 @7d36d17; CHANGELOG.md:23);
  - `invalid_request` is no longer retryable (analysisErrorProjection.ts:635-641 @7d36d17);
  - Gemini 400 (#4620, closed after the 6.8.0 test);
  - `analyze_function` defaults to a retained summary (CHANGELOG.md:13);
  - Ghidra raw results omitted, plus retained summaries for Frida, GDB and objdump (CHANGELOG.md:58);
  - firmware coverage gap reported (#3756);
  - +21 format tools (C45) and +20 CLI commands;
  - JSONL row framing.
- **Still present at HEAD:**
  - output schemas full by default (mcpOutputSchemaProfile.ts:14);
  - dual result encoding (docs/mcp-contracts.md:16-18);
  - in-memory ledger (EvidenceLedger.ts:58-60);
  - no tar/gzip;
  - timing in process frames (processObservation.ts:12);
  - HTTP without auth (docs/mcp-contracts.md:753-754);
  - zod 4.4.3; no Dependabot, CODEOWNERS or governance file.
- **New:**
  - Node floor raised, so Node 22.19–22.23.3, 24.11–24.22.0 and 26.0–26.12.0 are refused;
  - catalog grows to 229 tools (more bytes unless compact);
  - 21 breaking changes in one minor release (6.8.0);
  - environment serving adds evidence-gated **write** tools (`environment-serve` default changed, CHANGELOG.md:22).
- **Not checked at HEAD:** the JS literal-loading forms (A3.3) and the nested-path Evidence ID (A3.1). Both need the clone (plan §2).

## 10. Known problems and open questions
- **Problems:**
  - the context cost of the catalog and results (A4);
  - durability (A5.1);
  - large-bundle memory (A2.1/A2.2);
  - coverage wording (A3.2/A3.5);
  - timing false positives (A3.4);
  - schema incompatibilities across clients (A8.4);
  - HTTP auth (A6.3);
  - supply-chain hygiene (A6.5);
  - Windows native authority (#1701, #287 open since 2026-07-16).
- **Open questions:**
  - Why was durability left out? Unknown: no ADRs, and #4276 ("broader retention decision") is open.
  - Do real-engine CI lanes pass? Results are not visible to a static reader.
  - What is real use? npm download figures were not reachable.
  - Will there be a stable/LTS line? SECURITY.md:5 supports only the latest release.
  - Are stars meaningful? See the §1 note.

## 11. Lessons for a successor
**Keep**
- The Evidence record with content-addressed ID and separate confidence and authority (C30), because it makes claims auditable and dedupe free. Fix the nested-path ID.
- Residual unknowns as tracked, hash-chained work items (C31), because "unknown" becomes something to schedule.
- The effect vocabulary and untrusted marker (C34): one file a host can enforce as policy.
- "Refuse early, return a reference and a continuation" (C35), because it is honest about size.
- One bound engine with no silent fallback (D6), for reproducibility.
- Owned-process rules (C39), for safe cleanup.
- Read-only `doctor` with remediation (C40).
- Closed-claim grading (C42).

**Avoid**
- A full catalog with output schemas by default, and duplicated results (A4), because clients break and agents pay ~2× tokens.
- An in-memory-only ledger (A5.1). Use an append-only durable log keyed by Evidence ID.
- Breaking changes in minor versions (D12).
- HTTP without auth (A6.3).
- Treating timing as behaviour (A3.4).
- Coverage labels that mean only "not truncated" (A3.2).
- 200+ near-duplicate tools instead of a few composable primitives (INT-3).

**Unknown**
- Whether JS/Electron graph analysis (C19) beats cheap probes on real tasks. The #723 study says equal accuracy at higher cost, but one study is not enough.
- Whether the always-latest support model is sustainable with one owner (80% of 6.8.0 commits).
- How much of the community triage is agent-generated, and how reliable it is. Not assessable from summaries.

## 12. How I researched this
- **Code:**
  - `git ls-remote https://github.com/morluto/rea` gave HEAD, 168 branches, tags `rea-agents-*` and PR refs up to #7218;
  - streamed files from `raw.githubusercontent.com/morluto/rea/<sha>/…` at both commits, with no clone (plan mode): README, AGENTS, CONTRIBUTING, SECURITY, CHANGELOG, docs/roadmap, tool-design, architecture.mermaid, mcp-contracts, cli, releasing, SKILL.md, package.json, toolEffects.ts, cliCommandNames.ts, promptContracts.ts, mcpInput/OutputSchemaProfile.ts, zipPackageFormat.ts, evidence.ts, analysisErrorProjection.ts, EvidenceLedger.ts, processObservation.ts, serveStreamableHttp.ts, docs/releases/{6.5.0,6.6.0,6.8.0}.contributions.json;
  - in-memory Python for counts (the tool grouping check, contributor shares).
- **Web (WebFetch):** github.com pages worked (repo, profile, issues, PRs, compare, commit pages, comparison-tool READMEs). Failed (DNS or 403): api.npmjs.org, npmjs.com, hn.algolia.com, news.ycombinator.com, dev.to, note.com, youtube.com, morluto.bearblog.dev, hysenlabs.com, aicoder.com, developersdigest.tech, tcubed.group, hoangyell.com. The GitHub REST API refused this session (repo not attached); add_repo reported read-only anonymous git only.
- **Web search queries:**
  - `"rea-agents" OR "morluto/rea" reverse engineering MCP`
  - `REA reverse engineer anything morluto review criticism problems`
  - `morluto rea Hacker News OR reddit`
  - `morluto rea github stars fake OR inflated`
  - `news.ycombinator.com REA … Show HN`
  - `morluto author REA why I built`
  - `"rea-tools" fake REA repository trojan`
  - `systemdesign.academy REA … Electron preload`
  - `REA rea-agents token cost catalog`
  - `"morluto" x.com OR twitter REA`
  - `"rea-agents" npm weekly downloads`
- **Not run:** nothing was installed or executed (plan mode). All runtime figures are prior internal measurements or user reports, labelled as such.
- **Not reached:** npm download counts; the HN thread; any full third-party article; X posts; the YouTube video; GitHub settings.

## 13. Sources (all accessed 2026-10-26)
- https://github.com/morluto/rea, plus /commits/main, /compare/b4938aed…7d36d172, /commit/7d36d172…, /commit/b4938aed…, /pulls, and /issues (sorted by comments; searches for "tgz OR tarball", "prompt injection", "persist evidence ledger restart")
- Issues: https://github.com/morluto/rea/issues/723, /1065, /1462, /1551, /2512, /3756, /4230, /4620, /4893, /4973, /6344, /6480 (and, from listings: /724, /1048, /1701, /287, /5723, /6176, /7027, /4348, /4276); PRs /7184, /7218, /4915
- https://raw.githubusercontent.com/morluto/rea/b4938aed58737293a6987630476632619713f5cd/<files listed in §12> and …/7d36d172ab9b1718630a8e8646f87e7dfdbfc71a/<same>
- https://registry.npmjs.org/rea-agents
- https://github.com/morluto
- https://github.com/LaurieWired/GhidraMCP ; https://github.com/cyberkaida/reverse-engineering-assistant ; https://github.com/mrexodia/ida-pro-mcp ; https://github.com/fosdickio/binary_ninja_mcp ; https://github.com/radareorg/radare2-mcp ; https://github.com/ReFirmLabs/binwalk ; https://github.com/skylot/jadx ; https://github.com/semgrep/semgrep ; https://github.com/doyensec/electronegativity
- Search snippets only (not opened): https://pasqualepillitteri.it/en/news/23845/rea-reverse-engineer-anything-github-true-false ; https://dev.to/max_quimby/rea-hit-248k-stars-the-real-story-is-scarier-2m12 ; https://dev.to/hassann/what-is-rea-reverse-engineer-anything-the-mcp-server-that-hit-115k-github-stars-in-a-week-1coc ; https://note.com/zephel01/n/n9d2ed82dcd4d ; https://hysenlabs.com/projects/morluto-rea ; https://hackernoon.com/i-tested-rea-githubs-viral-reverse-engineering-tool-on-a-real-electron-app ; https://ai.miraheze.org/wiki/Reverse_Engineer_Anything ; https://piyushai.com/rea-reverse-engineer-anything-github-explained/ ; https://aicoder.com/news/news-20261008-rea-reverse-engineer-anything-mcp-agents ; https://www.developersdigest.tech/blog/reverse-engineer-anything-rea-mcp-agents-guide-2026 ; https://news.ycombinator.com/item?id=50028275 ; https://capitalandcompute.net/blog/what-is-rea-reverse-engineer-anything/ ; https://socket.dev/npm/package/rea-agents ; https://dev.to/gabrielanhaia/before-you-npx-an-mcp-server-8-checks-that-would-have-caught-the-fake-rea-repo-300o
- Internal: /home/user/RE4exa/docs/merger/01-anatomy/rea.md ; /home/user/RE4exa/research/rqs-review/reports/rea.md ; /home/user/RE4exa/research/rea-self-analysis/README.md ; /home/user/RE4exa/docs/merger/sources.md
