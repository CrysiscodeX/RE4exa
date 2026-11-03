# Breadth coverage

Every component of reax and every supporting subsystem, with its status, the evidence for it, what
works, what is missing, and the next work package. Written in Wave 0 of the breadth plan
(DECISION-LOG D-13): before deep work resumes on any one component, every component that is not
built gets a genuine, tested initial implementation. Measured at `bc38202`.

Sources: `MASTER-PLAN.md`, `CAPABILITY-MATRIX.md` (generated), the ledgers in `../ledger/`, the
test files, and the CI parity report of reax run 41238955508 (`bc38202`). The rows not yet built are
listed one by one in `MISSING-CAPABILITIES.md`.

## Rules

**Partial means working and tested.** An item is PARTIAL only if it has real working
functionality, with positive and negative tests that pass in CI. Interfaces, stubs, generated
documentation, or code in `packages/core` that no reax operation uses, count at most as
SCAFFOLDED, and are named under "exists to build on", not as status.

**Status vocabulary, mapped onto the ledger.** The ledger schema is unchanged. Its rows get a
computed status from CI (`scripts/parity-check.ts`): `planned`, `partial`, `covered` (capability
rows), `fixed` (weak points), `regressed`, `wont`. An item's breadth status is derived from the
rows that evidence it:

| Breadth status | Meaning | Ledger evidence |
|---|---|---|
| NOT_BUILT | No working reax code for the item | Every row `planned`, and none carries tags |
| SCAFFOLDED | Interfaces, stubs or generated text only; nothing works on real input | Every row `planned`; a stub never carries `[+KEY]`/`[-KEY]` tags |
| PARTIAL_UNVERIFIED | Working code with positive and negative tests, not yet green in CI | Tags present (`status.ts` counts the row tested), CI status not yet `covered`/`fixed` |
| PARTIAL_VERIFIED | Working code; at least one evidencing row green in a CI parity report; others missing | At least one row `covered` or `fixed`, others `planned` |
| COMPLETE_UNVERIFIED | Every row tagged, not all green in CI | Every row tested by `status.ts`; some not `covered` |
| COMPLETE_VERIFIED | Every row green in CI | Every row `covered`, `fixed` or a reviewed `wont` |
| BLOCKED_EXTERNAL | Cannot proceed for a reason outside the repository (no device, licence or sample) | Rows stay `planned`; the reason and the unblock are in `EXECUTION-STATE.md` (**Blocked**). The ledger has no blocked status, and none is added |

A `regressed` row drops its item to PARTIAL_UNVERIFIED at best until it is fixed. For supporting
subsystems that have no capability rows, the evidencing rows are reax's own (`reax.jsonl`, the
RX-* keys) and weak points (`limitations/*.jsonl`). A breadth package that needs a new reax row adds
it to `reax.jsonl` in the existing format.

**Tag only what the row says.** A package tags a ledger row only when its tests cover what the
row's source text describes. A first slice that covers less gets a narrower reax row instead
(D-13).

## Baseline at `bc38202`, reconciled

| Measure | User's figure | Measured | Source |
|---|---|---|---|
| Registered operations | 19 | 19 | `OPERATIONS` in `src/ops/registry.ts` |
| rea and leanrea rows tested | 39 / 357 | 39 / 357 | `status.ts --check` (exit 0, matrix current); CI parity: 28 rea + 11 leanrea `covered` |
| reax's own rows | 29 / 29 | 29 / 29 | `status.ts`; CI parity: 29 `covered` |
| Declared tests | 187 in 21 files | 187 in 21 files | top-level `test(` in `test/*.test.ts`; CI JUnit (run 41238955508): 187 declared on every lane; passed: Linux 186, macOS 184, Windows 181 (1, 3 and 6 skipped by platform), fixtures job 187 |
| Weak points | 21 / 244 fixed, 223 open, 41 use-blocking | 21 / 244, 223 open (blocks 41, degrades 150, cosmetic 32) | `status.ts`; CI parity: 21 `fixed` |
| Tool catalog | 6.3 KiB of 16 KiB | 6,294 bytes: 6.1 KiB (6.3 kB) | `wc -c docs/tools.json` |
| CI for `d5285e7` (NAT-4, part 4b) | green on all three | green: reax 41212075905, assay 41212075899, tests 41212075897 | `gh run list --branch claude/admiring-volta-uc87nj` |

**Differences.** One, of units: `docs/tools.json` is 6,294 bytes, which is 6.1 KiB (6.3 kB). The
16 KiB target is in KiB (16,384 bytes); the catalog uses 38% of it. "Fixed" for weak points is CI's
word; `status.ts` calls the same 21 rows "tested". The EXECUTION-STATE entry for `d5285e7` said
"CI to confirm"; it is corrected. NAT-3 (`68e61f4`) and NAT-4 part 2 (`23162f6`) had no CI result
recorded; both were green on all three workflows, now recorded.

## Inventory

| ID | Name | Status | Wave |
|---|---|---|---|
| NAT | Native readers | PARTIAL_VERIFIED | (deferred: deep work) |
| CLI | Tool surface, CLI and output | PARTIAL_VERIFIED | 3 |
| BEN | Benchmark | PARTIAL_VERIFIED | 3 |
| SBX | Sandbox and safety | PARTIAL_VERIFIED (since `1001fd7`) | 1 |
| ENG | Engine adapters and provider registry | PARTIAL_VERIFIED (since `95c82c1`) | 1 |
| COD | Code-level analysis | NOT_BUILT | 2 |
| RUN | Runtime and devices | NOT_BUILT (first slice parked to the breadth gate; Frida and ADB parts BLOCKED_EXTERNAL) | 2 |
| MOB | Managed and mobile | NOT_BUILT (first slice parked to the breadth gate; JEB part BLOCKED_EXTERNAL) | 2 |
| SET | Setup, skill, router | NOT_BUILT (first slice active, W2-7) | 2 |
| DMN | Daemon, MCP, sessions, jobs | PARTIAL_VERIFIED (since `69dde2e`) | 2 |
| ARC | Archives and app bundles | NOT_BUILT | 3 |
| JSE | JavaScript and Electron | NOT_BUILT | 3 |
| EVD | Evidence, unknowns, verification | NOT_BUILT | 3 |
| OTH | Other formats | NOT_BUILT | 3 |
| PM | Program model | PARTIAL_VERIFIED (since `fb1e03e`/`d804135`) | 1 |
| SCH | Scheduler | PARTIAL_VERIFIED (since `40467bd`) | 2 |
| SNAP | Snapshot cache | NOT_BUILT | 4 |
| POOL | Resource pools | NOT_BUILT | 4 |
| PROC | Process supervision | PARTIAL_VERIFIED | 1 (with SBX) |
| RCI | Real-engine CI | NOT_BUILT | 1 (LLVM lane), 4 |
| FIX | Fixtures | PARTIAL_VERIFIED | each wave, 4 |
| KEY | Independent answer keys | PARTIAL_VERIFIED | each wave, 4 |
| CSF | Client schema fixtures | NOT_BUILT | 4 |
| SKL | Generated skill and prompts | NOT_BUILT | 4 |
| REL | Release workflow | NOT_BUILT | 4 |
| SBOM | Software bill of materials | NOT_BUILT | 4 |
| ATT | Provenance attestations | NOT_BUILT | 4 |
| SEC | Security-review remediation | NOT_BUILT | 4 (and with SBX, DMN, RUN) |
| FAIL | Failure injection | NOT_BUILT | 4 |
| WFC | Workflow-compatibility tests | NOT_BUILT | 4 |
| OBS | Observability (logging, identity, doctor counts) | NOT_BUILT | 4 |
| XST | Execution-state persistence | NOT_BUILT | 2 (with DMN), 4 |
| LED | Ledger, parity and status machinery | PARTIAL_VERIFIED | 4 |
| GATE | Breadth gate and completeness checker | NOT_BUILT | 4 (last) |

**Counts (34 items, updated at `681fae9`, unchanged since `40467bd`):** PARTIAL_VERIFIED 12 (NAT, CLI, BEN, PROC, FIX, KEY,
LED, SBX, ENG, PM, DMN, SCH); NOT_BUILT 22; SCAFFOLDED 0; PARTIAL_UNVERIFIED 0; COMPLETE_UNVERIFIED 0; COMPLETE_VERIFIED 0;
BLOCKED_EXTERNAL 0 as whole items, with three blocked parts inside RUN, MOB and NAT (41 ledger rows:
Frida 10, ADB 25, JEB 5, PE certificates 1).

## Components

Each entry: status; evidence (source, entry point, positive and negative tests, CI); what works;
gaps; the next work package. "CI green" means reax run 41238955508 at `bc38202`, all three lanes,
the fixtures job and the parity job, unless another run is named.

### NAT, native readers: PARTIAL_VERIFIED
- **Evidence:** `src/readers/{layout,symbols,notes,go,resources,macho,peconfig,model,rust}.ts`,
  `src/ops/{native,layout,symbols,formats,model,rust,bytes}.ts`; entry `reax op <operation>`, all
  19 registered operations; tests `ops`, `bytes`, `layout`, `symbols`, `formats`, `pe`, `model`,
  `rust`, `macho-starts`, `corpus-lh`, `assay-probes`; 35 of 69 rows `covered` in CI.
- **Works:** identify; architectures; ELF, PE, Mach-O and wasm layout, symbols, procedures, exports,
  imports and overview; strings, bytes, search, entropy, address mapping; ELF notes; Go build info
  and pclntab; PE resources and load configuration; Mach-O load commands and code signatures; GGUF
  and safetensors headers; Rust `.dep-v0`. Each against an independent key.
- **Gaps:** 34 rows (MISSING-CAPABILITIES, NAT): ObjC, Swift, dyld resolution, crashes and Apple IPS,
  PE certificates (blocked: no signed sample), the PE COFF symbol table, ARM64 `.pdata` (parked), and
  the x64 `.pdata` section-bound defect. The REA-C07 and REA-C14 family rows have every named member
  covered but carry no family tag; whether they may be tagged needs review.
- **Next:** none in the breadth waves (deep work, D-13), except fixing the x64 `.pdata` defect,
  which is a defect in committed code (EXECUTION-STATE, **Known defects**).

### CLI, tool surface, CLI and output: PARTIAL_VERIFIED
- **Evidence:** `src/cli.ts`, `src/format/*`, `src/ops/{page,registry,schema}.ts`, `src/errors.ts`,
  `scripts/gen.ts`; entry `reax op …`, `reax --llms`; tests `format.test.ts` (RX-1/output-formats,
  RX-1/paging, REA-C35, LEAN-C10), `ops.test.ts` (RX-1/op-registry) and `bytes.test.ts` (LEAN-C07,
  tagged with `read.bytes`'s tests); 3 of 7 rows
  `covered`, the three reax rows `covered`.
- **Works:** six output formats checked against independent decoders; stateless paging; the 1 MiB
  response budget; `--token-limit`, `--filter-output`, `--llms`; one registry generating
  `operations.md`, `tools.json` and the ledger mappings.
- **Gaps:** REA-C03 (rea's command surface), REA-C04 (schema profiles, needs DMN), REA-C37 (the
  error contract: reax adds 3 codes to core's table), LEAN-C09 (batched calls).
- **Next (Wave 3):** the error contract and batched calls (REA-C37, LEAN-C09). Oracle: a static scan
  of every `CoreError(` call site must find each code in the table with category, retryable and
  remediation; a batch with a failing member reports it and runs the rest.

### BEN, benchmark: PARTIAL_VERIFIED
- **Evidence:** `src/bench/**`, `bench/{run,live,setup,smoke,doctor}.ts`, `bench/tasks`,
  `bench/PREREG.md`; tests `bench.test.ts`, `live.test.ts`, `setup.test.ts`; LEAN-C56 and the 11
  benchmark reax rows (RX-0c/bench-*, RX-1/bench-*) `covered`; LEAN-C49-LIMIT `fixed`.
- **Works:** one grader for every arm; 30 tasks pinned by digest with LLVM-derived oracle facts; the
  fake-arm harness; live backends (local llama.cpp, Codex CLI, Claude CLI) tested against fakes;
  local model setup and context fitting.
- **Gaps:** 10 rows (LEAN-C49 to C55, C57 to C59); validity checks A1 to A9; the rea 6.8.0 and
  leanrea Tier 0 arms; the context-overhead probe; the MCP sizer.
- **Next (Wave 3, after DMN):** model-free only: the one-cell runner on the fake arm (LEAN-C49), the
  MCP sizer over DMN's `tools/list` (LEAN-C58), the context-overhead probe (LEAN-C57). Oracle: byte
  counts by an independent serializer. No live model runs.

### SBX, sandbox and safety: PARTIAL_VERIFIED (since `1001fd7`)
- **Evidence:** `src/sandbox/{index,policy,macos,linux,tree}.ts` and `src/sandbox/landlock.py`;
  entry `runSandboxed(argv, policy, opts)` (internal; no operation yet); ADR 0006
  (`docs/decisions/0006-sandbox.md`); tests `test/sandbox.test.ts`. CI: reax run 41440711064, where
  `RX-SBX/enforced` (linux, darwin) and `RX-SBX/fail-closed` (linux, darwin, win32) are covered; Linux
  ran Landlock ABI 8.
- **Works:**
  - a real child under an enforced policy on macOS (`sandbox-exec`) and Linux (Landlock through the
    system `python3 -I`): reads allowed, writes only beneath scratch (a symlink out is refused too),
    TCP connect refused, each checked from outside the child;
  - fail closed with `sandbox_unavailable` where nothing is enforced (Windows), or a run labelled
    `none` when the caller does not require the sandbox;
  - an allowlisted environment, a deadline, abort, and an output cap; the tree is killed while the
    root is unreaped.
- **Gaps:**
  - Windows enforcement;
  - UDP and other non-TCP sockets on Linux;
  - a descendant that escapes its group after its parent exits (ADR 0006's limit), and proof that an
    escaped grandchild is still confined;
  - read restriction; memory, CPU and process-count limits;
  - the macOS `mach-lookup` DNS side channel;
  - REA-C34 (effect audit, MCP hints), which needs DMN;
  - the open advisories in EXECUTION-STATE (A1, A2, the `sandbox_unavailable` fix text).
- **Next:** Windows engine enforcement is now the breadth item SBX-W (Wave 3, item 0; D-30), below.
  The other gaps above are deep work after the breadth gate (D-13).

### SBX-W, Windows engine enforcement: NOT_BUILT (planned by D-30)
- **Why:** under D-22, engine runs on targets fail closed on Windows. So rows that need an engine
  cannot pass a positive test on win32. By D-30, such rows defer win32 in the ledger until this item
  lands, and they count only as "tested, partial (missing: win32)".
- **Scope:** Windows backend for `runSandboxed`. A Job Object (kill on close, process count, memory)
  plus an AppContainer (no write outside scratch, no network capability). It runs through a small
  helper that is pinned (by digest, built or vendored in the project, licence recorded), with **no
  system-wide install**, as the user's hard limits require. Engines run under it with `required: true`
  as on Linux and macOS (D-22 unchanged in spirit: the fail-closed rule stays where the helper is
  unavailable).
- **Ledger key:** `RX-SBX/windows-engines` (platform win32; added by work order W2-3 as planned).
- **Rows it would complete** (deferred on win32 by D-30; each must then pass `[+KEY]` and `[-KEY]` on
  windows-2025, and its deferral is removed):
  - `rea.tool/procedure_assembly`, `rea.tool/read_function_instructions`, `leanrea/LEAN-C08`
    (W2-3);
  - `leanrea/LEAN-C18`, if W2-3 tags it;
  - any later row deferred under D-30 (the ledger's `deferred.until` lists them: a row whose
    `until` is `RX-SBX/windows-engines`).
  - It would also let the linux+darwin reax rows `RX-ENG/llvm` and `RX-COD/*` be widened to win32.
- **Acceptance:** a tripwire child on windows-2025 that writes outside scratch, opens a socket, or
  exceeds its memory or process limit is stopped and seen from outside. A helper that is missing or
  altered fails closed with `sandbox_unavailable`. The deferred rows pass on win32, and the parity
  report counts them as covered.
- **Wave:** 3, item 0, before ARC (ARC's extraction on Windows benefits too), and before the breadth
  gate.

### ENG, engine adapters and provider registry: PARTIAL_VERIFIED (since `95c82c1`)
- **Evidence:** `src/engines/{contract,registry,run,llvm}.ts`; tests `test/engines.test.ts` with
  `test/fixtures/fake-engine.mjs`; key `bench/oracle/symbols.json`. Internal API, no operation. CI:
  reax run 41450134753, where `RX-ENG/contract` (linux, darwin, win32) and `RX-ENG/llvm` (linux,
  darwin) are covered; discovery found LLVM 18.1.3 (linux), 18.1.8 (darwin) and 20.1.8 (win32).
- **Works:**
  - the contract and registry: discovery (real path, version, SHA-256, sandbox label), timeout,
    cancellation, and five typed errors (`engine_unavailable`, `engine_failed`, `engine_timeout`,
    `engine_cancelled`, `engine_output_invalid`);
  - the LLVM provider, found through `REAX_LLVM_BIN`, then PATH, then fixed directories. It runs
    `llvm-nm` inside the sandbox and fails closed where none is enforced (D-22).
- **Gaps:**
  - LEAN-C14, LEAN-C46 and REA-C38 stay open;
  - one provider and one LLVM tool;
  - closed by `681fae9` (COD Part A; reax run 41597961652, where `RX-ENG/nm-names` passed + and -
    on linux and darwin): the newline-forgery limit (framing per run, D-31) and M16;
  - Windows engine runs are refused (no enforcement);
  - the nightly real-engine workflow (RCI).
- **Next:** COD (Wave 2) exposes it through operations; the forgery mitigation is done (`681fae9`).

### PM, program model: PARTIAL_VERIFIED (since `fb1e03e`/`d804135`)
- **Evidence:** `src/pm/{db,schema}.ts`, `src/ops/pm.ts`; entry `reax op session.index` and
  `reax op search.symbols` (registered operations); tests `test/pm.test.ts`. CI: reax run 41480699513
  (attempt 2), where `RX-PM/store` and `RX-PM/index-search` are covered on all three lanes.
- **Works:**
  - `pm.db` over `node:sqlite`, with migrations in one transaction and a newer store refused
    (`store_schema_newer`);
  - `session.index` stores every slice's symbols from `inventory.symbols` under the file's sha256,
    and reuses an unchanged target;
  - `search.symbols` gives a paged read-back and an FTS5 trigram search, the query bound as one
    phrase;
  - typed `pm_not_indexed`, `pm_busy` and `pm_target_changed`;
  - survives a restart in another process;
  - tests never touch the real home.
- **Gaps:**
  - only symbols: functions, xrefs, strings, modules, annotations and coverage records (plan §3.5)
    are not stored;
  - no cache keys by engine version beyond the reader version;
  - DMN ownership;
  - the follow-ups in EXECUTION-STATE (P2c, P3, P3b, P4, shim quoting, test seams, a Windows
    `REAX_HOME` end-to-end test).
- **Next:** COD (Wave 2) adds functions and xrefs; DMN takes ownership.

### COD, code-level analysis: NOT_BUILT
- **Evidence:** none of its rows is tagged on HEAD, so by the rules above it is NOT_BUILT. Builds on
  `inventory.procedures` and `read.symbol` (NAT). 63 rows, 56 of them phase 2.
  - W2-3 Part A (`681fae9`, green CI) is real, tested work done for COD, but it evidences ENG and LED
    rows (`RX-ENG/nm-names`, `RX-0b/deferred`), not COD's.
  - W2-3 Part B (the disassembly below) is parked after 3 reviewer FAILs, in `git stash` "cod-partB
    WIP (3 reviewer FAILs)"; not committed (`EXECUTION-STATE.md`, **Parked**).
- **Next (Wave 2):** disassembly of one procedure through the LLVM provider, written once to a file
  in the work directory and sliced (procedure_assembly, read_function_instructions, LEAN-C08,
  LEAN-C18). Positive: each instruction's address and bytes equal `read.bytes` at the procedure's
  file offset; boundaries match NAT's procedure table; mnemonics equal the compiler's `-S` output for
  the zig fixture sources. Negative: an address in no procedure, a non-code section, a missing engine.
  - Amended by W2-3: the key is GNU objdump, run as a process in the fixtures job. It is not the
    compiler's `-S` output, and not Capstone, which derives from LLVM. The rows defer win32 (D-30)
    until SBX-W.

### RUN, runtime and devices: NOT_BUILT; Frida and ADB parts BLOCKED_EXTERNAL
- **Evidence:** none. Related: core's approval queue (`policy/approvals.ts`), the process host.
  71 rows. Frida (REA-C16, 10 rows) and ADB (REA-C26, 25 rows) are blocked: no fixture device.
  Unblock: a fixture device or emulator cleared with the user (for ADB), and the same or a local
  Frida install confined to /tmp cleared with the user (for Frida).
  - W2-5 (the first slice below) is parked until the breadth gate after 3 reviewer FAILs (D-35's
    rule), in `git stash` "run WIP (3 reviewer FAILs; parked to breadth gate)"; not committed, so no
    row is tagged and RUN stays NOT_BUILT (`EXECUTION-STATE.md`, **Parked**).
- **Next (after the breadth gate):** capture and compare a test-started process (capture_process_scenario,
  compare_process_captures): argv, exit code, output, child tree, files written in scratch, under
  SBX, off by default and approval-gated. Positive: the capture of a fixture program equals what its
  source does. Negative: no approval, no run; a PID reax did not start is refused; a failed run
  leaves no process. Only test-started processes are inspected.

### MOB, managed and mobile: NOT_BUILT; JEB part BLOCKED_EXTERNAL
- **Evidence:** none in reax. 29 rows. REA-C25 (JEB, 5 rows) is blocked: JEB is commercial and not
  licensed or installed. Unblock: a licence, or the user's decision to mark the rows `wont`.
- **The user's constraint (2026-11-03):** "MOB builds static APK and IPA readers only; ADB and Frida
  stay BLOCKED_EXTERNAL."
- **Next (Wave 2, work order W2-6; amended to the user's constraint):** static APK and IPA readers,
  in memory, with core's zip listing and no extraction, on untrusted input with bounds. APK: the
  listing, the binary `AndroidManifest.xml` (package, version code and name, min and target SDK,
  permissions, components) and framework markers (`lib/<abi>/libflutter.so`, `libhermes.so`; row
  LEAN-T08). IPA: `Payload/<name>.app/Info.plist`, XML and binary (bundle id, version, minimum OS,
  URL schemes, privacy strings; row LEAN-T17), and framework markers. Fixtures hand-built
  byte-exact by a script; the key from Python's stdlib (`zipfile`, `plistlib`) and a separately
  written binary-XML decoder.
  - Moved out by the constraint: the .NET metadata reader (inspect_managed_artifact, LEAN-C30) that
    this entry planned before. It is not an APK or IPA reader; it waits for a later MOB slice
    (after the breadth gate, or sooner if the user says so).
  - Outcome (2026-11-03): parked until the breadth gate after 3 reviewer FAILs (git stash "mob WIP
    (3 reviewer FAILs; parked to breadth gate)"); status stays NOT_BUILT. Detail in
    `EXECUTION-STATE.md` **Parked**.

### SET, setup, skill and router: NOT_BUILT
- **Evidence:** none in reax. Related: core's `probes/router-pack.json` (leanrea's router as data,
  used by Assay). 18 rows.
- **Next (Wave 2, after DMN's stdio server):** `reax setup` and `reax uninstall` for two clients
  (Claude Code and Codex) and `reax doctor`, only against a temporary HOME. A new reax row (for
  example RX-2/setup-clients); REA-C40 stays open until its full client list. Positive: install twice
  equals install once; uninstall restores the original files byte for byte. Negative: a malformed
  existing configuration is left untouched and reported. Oracle: JSON and Python `tomllib` parsers.
  - Work order W2-7 (2026-11-03) narrows the first slice to Claude Code only (JSON; key from
    Python's `json`); Codex waits for a TOML decision (proposed D-49). No rea or leanrea row is
    satisfied by it; five new RX-SET rows.

### DMN, daemon, MCP, sessions and jobs: PARTIAL_VERIFIED (since `69dde2e`)
- **Evidence:** `src/daemon/{paths,lock,token,protocol,server,client}.ts`; entry `reax serve` and
  `reax daemon start|ping|status|shutdown` (CLI commands; internal API, no operation); ADR 0007
  (`docs/decisions/0007-daemon.md`), D-25, D-26; tests `test/daemon.test.ts` and
  `test/daemon-lock.test.ts`, with the independent raw wire client `test/fixtures/daemon-wire.ts`.
  CI: reax run 41540866637, where `RX-DMN/lifecycle`, `auth`, `single-instance`, `stale-lock` and
  `loopback` (linux, darwin, win32) and `RX-DMN/token-file` (linux, darwin) are covered;
  `RX-DMN/busy` covered since `40467bd` (reax run 41565482186, D-28). Jobs over the daemon: see SCH.
- **Works:**
  - one daemon per `REAX_HOME`, decided by a node:sqlite owner lock; racing starts leave exactly one;
    a lock left by a dead or unreachable daemon is recovered and reported;
  - a Unix socket (Linux, macOS) or named pipe (Windows), and opt-in `--tcp` on loopback only, any
    other host refused before a file or socket is created;
  - a per-start token, owner-only on POSIX, checked in constant time; missing, wrong, stale and late
    tokens refused; the token in no argv, log, reply or file other than its own;
  - ping, status and shutdown, with cleanup of the lock, endpoint, socket and token;
  - a retryable `daemon_busy` at the connection cap (since `40467bd`, D-28);
  - bounded resources (connections, sockets, pending input, reply backpressure, log rate).
- **Gaps:**
  - the 11 capability rows are all open (none moved): MCP over stdio and HTTP (REA-C01, REA-C02),
    sessions and targets (REA-C05 and its five tools), progress and cancellation (REA-C36); REA-C33
    and REA-C39 are owned by SNAP and PROC;
  - `tools/list` is not measured yet (no MCP);
  - the daemon does not own `pm.db` (D-23's reopen trigger untouched);
  - Windows: no ACL on the token file or pipe (D-25); SR-9 open;
  - the other follow-ups in EXECUTION-STATE.
  - Weak points advanced, not fixed: SR-9, REA-C01-LIMIT, REA-C02-LIMIT.
- **Next (a later DMN slice):** `reax serve` over stdio exposing the registry's operations (REA-C01),
  then streamable HTTP bound to loopback with a bearer token (REA-C02), both as clients of this
  daemon. Positive: the official MCP SDK client (dev-only, pinned) lists and calls every operation;
  `tools/list` measured at or under 16 KiB. Negative: a non-loopback bind, a missing token and a
  wrong token are refused. Weak points it targets: REA-A6.3, REA-C02-LIMIT.

### ARC, archives and app bundles: NOT_BUILT
- **Evidence:** none in reax. Related: core's `probes/builtin/archive.ts` (`archive.list`: zip,
  zip64, tar, pax, gzip-wrapped tar, ASAR; listing only), tested in core. 14 rows.
- **Next (Wave 3, after SBX-W):** `inventory.archive` on core's listing, and plist XML and binary
  (inspect_artifact if the slice matches the row, inspect_plist, LEAN-T17, LEAN-T03). Oracle: Python
  `zipfile`, `tarfile`, `plistlib`; `@electron/asar` (dev-only, pinned). Negative: traversal, symlink,
  bomb and depth tripwires reported, never followed. Extraction waits for SBX's check in this wave.

### JSE, JavaScript and Electron: NOT_BUILT
- **Evidence:** none in reax. Related: core's `js.imports`, `js.endpoints`, `code.obfuscation`,
  tested in core. 20 rows.
- **Next (Wave 3, after ARC):** source maps (LEAN-T16), Electron fuses (inspect_electron_fuses,
  LEAN-T05) and the needle slicer (LEAN-C20). Oracle: Mozilla `source-map` and `@electron/fuses`
  (dev-only, pinned). Negative: a map without `sourcesContent`, a binary without the fuse sentinel.

### EVD, evidence, unknowns and verification: NOT_BUILT
- **Evidence:** no reax operation. Core's evidence store and verifier are exercised by reax's tests
  (RX-1/verify-native, REA-A3.1 and REA-C30-LIMIT fixed), but they are core's. 19 rows.
- **Next (Wave 3):** `unknown.*` operations on core's store (record_unknown, update_unknown,
  list_unknowns, verify_unknown_resolution, LEAN-C12). Positive: a paged list reassembles; resolution
  is decided by core's verifier. Negative: an unknown is never reported as absent; a resolution the
  verifier refutes is refused.

### OTH, other formats: NOT_BUILT
- **Evidence:** none for its rows. NAT already reads wasm sections and symbols (untagged here).
  21 rows, 11 of them phase 2.
- **Next (Wave 3):** SQLite schema, read-only (inspect_sqlite_database, LEAN-C34, LEAN-T09) and the
  wasm artifact view (inspect_wasm_artifact, LEAN-C33). Oracle: Python `sqlite3`; `llvm-readobj` for
  wasm. Negative: a non-database, a database with a `-wal` sibling (said so), a cut file.

## Supporting infrastructure

### PROC, process supervision: PARTIAL_VERIFIED
- **Evidence:** core's vendored `orca-process-host` (`run-process`, `process-tree-termination`),
  `src/bench/backends/proc.ts`; tests `process-host.test.ts` (REA-A7.2 `fixed`: a timed-out tree is
  killed, grandchild included; a missing tool fails instead of hanging), `setup.test.ts`
  (RX-1/bench-process, RX-1/bench-close `covered`).
- **Gaps:** REA-C39 (owned supervision; Windows Job Objects), per-child RSS limits, supervision of
  engine and sandboxed children.
- **Next (Wave 1, with SBX):** every sandboxed child runs supervised; the memory tripwire doubles as
  the RSS limit test.

### SCH, scheduler: PARTIAL_VERIFIED (since `40467bd`)
- **Evidence:** `src/sched/scheduler.ts`, `src/daemon/jobs.ts`; the job methods in
  `src/daemon/{protocol,server,client}.ts`; CLI `reax daemon run|jobs|cancel`; ADR 0008
  (`docs/decisions/0008-scheduler.md`), D-27, D-28, D-29; tests `test/sched.test.ts` and
  `test/sched-daemon.test.ts`, with the independent reference queue model
  `test/fixtures/sched-model.ts` and the raw wire client `test/fixtures/daemon-wire.ts`. CI: reax run
  41565482186, where `RX-SCH/queue`, `cancel`, `timeout`, `protocol` and `write-busy` are covered.
  Below it, core's kernel (tasks, attempts, leases, checkpoints; AB-P1, P4, P6, P8, P12, PD-5
  `fixed`) is still not used by the scheduler.
- **Works:**
  - registered operations as jobs, classed by `Operation.cost`; caps of 64 queued per daemon, 16 per
    connection, 4 running, one reserved cheap slot, one write job at a time; `job_queue_full`
    (retryable) past them;
  - round-robin by connection, oldest first within each, no head-of-line blocking; the reference
    model checks the fairness bound at every dispatch (hand cases and 50 seeds);
  - deadlines from the start of the run (`job_timeout`) and cooperative cancellation
    (`job_cancelled`): a cancelled queued job never starts; a running engine's process tree is
    killed (root and grandchild verified gone, Windows included) and an open `pm.db` write rolled
    back; a disconnect cancels only that connection's jobs;
  - `session.index` waits for the `pm.db` write lock without blocking the event loop (D-29).
- **Gaps:**
  - no single-flight by cache key (needs SNAP), no aging or priorities: a stream of short-lived
    connections can keep delaying a job of an older connection;
  - no memory- or disk-aware admission (POOL), no stall watchdog, no retries, no job persistence
    (XST); the MASTER-PLAN check "RSS limits hold" is not met;
  - no test that `dropOwner` forgets an owner's record or of the `MAX_OWNERS` cap (a surviving
    mutant), and the other follow-ups in EXECUTION-STATE;
  - weak points advanced, not fixed: AB-P10, LEAN-C05-LIMIT, REA-C36-LIMIT. SCH owns no rea or
    leanrea capability row; REA-C36 (progress and cancellation) stays open under DMN.
- **Next (a later SCH slice):** aging (or "joins at the back") with a test that a stream of new
  connections cannot delay a waiting job past a bound; single-flight by cache key once SNAP exists
  (duplicate keys run once). Oracle: the injected clock and the reference queue model.

### SNAP, snapshot cache: NOT_BUILT
- REA-C33 (exact-key reuse across CLI calls). Related: content-addressed probe keys in core
  (`evidence/record.ts`, REA-A3.1). **Next (Wave 4, on PM):** reuse by exact key under `REAX_HOME`;
  a key that differs in engine version misses.

### POOL, resource pools: NOT_BUILT
- Memory- and disk-aware admission, warm pools (plan §3.7). **Next (Wave 4, on SCH and ENG):**
  admission from cgroup v2 `memory.max` or the Windows job limit; a child over its RSS limit returns a
  typed partial result.

### RCI, real-engine CI: NOT_BUILT
- No `reax-real.yml`. CI's fixtures job runs LLVM, Go, pefile and rust-audit-info, but as answer-key
  oracles (KEY), not as engines behind reax. **Next:** an LLVM lane with ENG in Wave 1; the full
  nightly real-engine workflow in Wave 4.

### FIX, fixtures: PARTIAL_VERIFIED
- **Evidence:** `fixtures/bin` (zig corpus, `fixtures/manifest.json`), `fixtures/extra` (D-8),
  the LearnHarness corpus (`scripts/corpus.ts`, SR-15); tests `fixtures.test.ts` (RX-0c/fixtures-*
  `covered`), `formats.test.ts` (RX-1/extra-fixtures), `corpus-lh.test.ts`.
- **Gaps:** no fixtures for archives, JS/Electron, .NET, APK/DEX, SQLite, pcap, firmware, crash
  dumps, a signed PE, or ELF and PE Rust; the zig rebuild check cannot run on macOS.
- **Next:** each breadth package adds its own fixtures, pinned by digest.

### KEY, independent answer keys: PARTIAL_VERIFIED
- **Evidence:** `scripts/oracle*.ts`, `scripts/oracle-*.py`, `scripts/oracle-go`, `bench/oracle/*`,
  `bench/oracle-facts.json`; re-derived in CI's fixtures job (`oracle.ts --check`).
- **Gaps:** keys exist only for NAT and BEN; the parked ARM64 `.pdata` key entries (LLVM 18.1.8) are
  unconfirmed by CI's 18.1.3.
- **Next:** each breadth package names its oracle (above) and adds it to the fixtures job.

### CSF, client schema fixtures: NOT_BUILT
- Weak points REA-A8.4 and REA-ISS-4620 (both blocking). **Next (Wave 4, after DMN):** per-client
  schema fixtures generated from the registry, and a schema lint that rejects empty-string `const`
  enums; oracle: the MCP SDK's schema validation.

### SKL, generated skill and prompts: NOT_BUILT
- `scripts/gen.ts` generates `operations.md`, `tools.json` and the ledger mappings, but no skill.
  Rows REA-C41 and the six `rea.prompt/*`, LEAN-C01, C47, C48. **Next (Wave 4):** `gen-skill.ts`
  writing the skill from the registry, with `--check` in CI.

### REL, SBOM and ATT, release, SBOM and attestations: NOT_BUILT
- `scripts/build.ts` builds `dist` for packing; there is no release workflow, SBOM or attestation.
  **Next (Wave 4):** a tagged dry run producing the package, an SBOM (`npm sbom`) and an
  attestation from SHA-pinned `actions/attest`; oracle: `gh attestation verify` on the artifact.

### SEC, security-review remediation: NOT_BUILT
- `docs/review-notes.md` holds 15 notes; none is closed. SR-1 to SR-5 are open; SR-6 to SR-12 are
  design inputs; SR-13 to SR-15 record mitigations "for review". **Next:** SR-6 and SR-7 close with
  SBX and RUN, SR-9 with DMN (advanced by `69dde2e`, not closed: no Windows ACL, D-25); the rest
  in Wave 4, each with a test where the note allows one.

### FAIL, failure injection: NOT_BUILT
- **Evidence:** no failure injection over any reax code. **Exists to build on** (foundations, not
  status, D-13): core's `test/fault-injection.test.ts` (SIGKILL at random moments), and reax's
  `test/conformance.test.ts`, which exercises core's kernel (REA-A5.1 and PD-6 `fixed`: a SIGKILL
  during commits loses no committed row). No reax operation uses the kernel.
- **Gaps:** seeded fault plans across the runner, daemon and adapters; retries and breakers.
- **Next (Wave 4):** seeded fault plans over DMN, SCH and ENG; the same seed reproduces the same run.

### WFC, workflow-compatibility tests: NOT_BUILT
- End-to-end tests that rea's and leanrea's user workflows (rea's six prompts, leanrea's one-call
  recipes such as LEAN-C17 and LEAN-C19) run on reax and reach the same answers. **Next (Wave 4).**

### OBS, observability: NOT_BUILT
- REA-C46 (logging and identity); `doctor` reporting `unenforced` runs; job progress. **Next
  (Wave 4).**

### XST, execution-state persistence: NOT_BUILT
- **Evidence:** no reax operation or job persists run state. **Exists to build on** (foundations,
  not status, D-13): core's kernel, exercised only by reax's `test/conformance.test.ts` (PD-1 store
  ownership, PD-6 durability, AB-P6 a checkpoint read back by the next attempt, all `fixed`); no file
  under `src/` imports it. The work-state documents (this folder, `status.ts --check` in CI's Linux
  lane) belong to LED, and `status.ts` has no positive and negative tests of its own.
- **Gaps:** everything: jobs and checkpoints that survive a restart (needs DMN); `EXECUTION-STATE.md`
  is maintained by hand and checked by review only.
- **Next:** job persistence with DMN in Wave 2.

### LED, ledger, parity and status: PARTIAL_VERIFIED
- **Evidence:** `src/ledger/*`, `scripts/{seed-register,parity-check,status}.ts`; tests
  `parity.test.ts`, `register.test.ts`; the 8 RX-0b rows `covered`; the parity job's phase 0 gate
  for reax rows. Since `681fae9` (green CI): the `deferred` field and the two-number reports (D-30,
  D-33; row `RX-0b/deferred`, tested by `status.ts`).
- **Gaps:** the full phase-0 gate (adding leanrea's benchmark rows) is not on; no generator for
  `MISSING-CAPABILITIES.md`.

### GATE, breadth gate and completeness checker: NOT_BUILT
- **Next (Wave 4, last):** a generator and `--check` for `MISSING-CAPABILITIES.md` (key, phase and
  component columns from the ledger), run in CI; and a gate that fails while any item here is below
  PARTIAL_VERIFIED without a recorded external block. Changing `scripts/status.ts` or adding a
  script needs the Orchestrator's go-ahead first.

## Waves

Each wave starts when the previous one's items are PARTIAL_VERIFIED (or blocked externally with
the reason recorded). Within a wave, items run in the order given. Dependencies are the ones an
item's next package needs, not its full MASTER-PLAN dependencies.

| Wave | Items, in order | Needs |
|---|---|---|
| 0 | This inventory and `MISSING-CAPABILITIES.md` (documentation only) | — |
| 1 | SBX (with PROC), then ENG with LLVM as the first provider (with an RCI LLVM lane); PM beside them | SBX: PROC. ENG: SBX, PROC. PM: NAT |
| 2 | DMN, then SCH; COD; RUN; MOB; SET | DMN: FW. SCH: core's kernel. COD: ENG, PM. RUN: SBX, PROC, core's approvals. MOB: NAT, core's zip listing. SET: DMN |
| 3 | SBX-W (Windows engine enforcement, D-30); ARC, then JSE; EVD; OTH; CLI; BEN | SBX-W: SBX, ENG. ARC: SBX (for extraction). JSE: ARC. EVD: core's store. OTH: FW, SBX. CLI: DMN (schema profiles). BEN: DMN, SET |
| 4 | Supporting infrastructure: SNAP, POOL, RCI (nightly), CSF, SKL, REL, SBOM, ATT, SEC, FAIL, WFC, OBS, XST, LED, FIX and KEY gaps; then GATE | the components they serve |

After Wave 4 the breadth gate runs, and deep work resumes, starting with the parked and deferred
NAT-4 items.

**Hard limits (the user's), and where they bite:**
- **RUN** inspects only processes the tests start. ADB and Frida stay BLOCKED_EXTERNAL without a
  fixture device. (Wave 2)
- **SET** is tested only against a temporary HOME. (Wave 2)
- **BEN** runs no live model. (Wave 3)
- **DMN's** MCP server listens on loopback only, with a token. (Wave 2)
- **No system-wide installs.** Tools and SDKs live under /tmp or a temporary directory. Rust cross
  targets use a rustup confined to /tmp. (MOB's .NET SDK, any Android tools, and NAT's later ELF and
  PE Rust fixtures)
- **GPL tools** (for example binutils, gdb) run only as separate processes, never linked or
  imported. (ENG, COD)

## Where a status was a judgement

- **ARC, JSE, EVD: NOT_BUILT, though core has tested code.** Core's archive listing, JS probes,
  evidence store and verifier work and are tested, mostly in `packages/core`. No reax operation
  exposes them, and none of these components' rows is tagged, so they count as foundations, not
  status.
- **DMN: PARTIAL_VERIFIED on reax's own rows only** (since `69dde2e`; until then it was listed with
  ARC, JSE and EVD above). The six RX-DMN rows are covered in CI; all 11 of its capability rows stay
  open, as SBX's REA-C34 does. Core's MCP handles are still Assay's, not a reax server.
- **SCH: PARTIAL_VERIFIED on reax's own rows only** (since `40467bd`; NOT_BUILT before it). The
  five RX-SCH rows are covered in CI; SCH owns no rea or leanrea capability row, and single-flight,
  aging and memory-aware admission are not built. Core's kernel lease machinery is still a
  foundation the scheduler does not use.
- **PROC: PARTIAL_VERIFIED.** It rests on reax's own code (`src/bench/backends/proc.ts`, on core's
  vendored process host) with positive and negative tests: RX-1/bench-process and RX-1/bench-close
  `covered`, REA-A7.2 `fixed`.
- **FAIL and XST: NOT_BUILT, though core's kernel tests pass in reax's CI.** Their only evidence
  (REA-A5.1, PD-6, PD-1, AB-P6) is core kernel code that no reax operation uses, so under D-13 it is
  a foundation, as for EVD and for the kernel substrate under SCH. (Corrected after review: Wave 0's first draft rated both
  PARTIAL_VERIFIED.)
- **XST and WFC: the names were interpreted.** XST is read as run state (jobs and checkpoints that
  survive a restart); the work state (this folder and `status.ts --check`) belongs to LED. WFC is read as end-to-end
  reproduction of rea's and leanrea's user workflows. If either means something else, its status may
  change.
- **SEC: NOT_BUILT, though mitigations exist.** SR-13 to SR-15 describe mitigations (digests, no
  shell, hash checks), some covered by tests under other rows, but no note is closed.
- **LED: PARTIAL_VERIFIED, not COMPLETE.** All 8 of its rows are covered, but the full phase-0 gate
  and the missing-capabilities checker are not built.
- **MOB's JEB part: BLOCKED_EXTERNAL** is this inventory's reading (a commercial tool with no
  licence here); the user has not ruled on it.
- **Frida:** blocked per the user's rule. Frida can also attach to local, test-started processes;
  if the user clears a /tmp-confined install, the local half could move into RUN's scope.
- **Family rows REA-C07 and REA-C14:** every member their titles name is covered, but the family
  rows themselves are untagged. Tagging them is a review decision, not made here.
