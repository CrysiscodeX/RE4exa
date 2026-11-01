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
| SBX | Sandbox and safety | NOT_BUILT | 1 |
| ENG | Engine adapters and provider registry | NOT_BUILT | 1 |
| COD | Code-level analysis | NOT_BUILT | 2 |
| RUN | Runtime and devices | NOT_BUILT (Frida and ADB parts BLOCKED_EXTERNAL) | 2 |
| MOB | Managed and mobile | NOT_BUILT (JEB part BLOCKED_EXTERNAL) | 2 |
| SET | Setup, skill, router | NOT_BUILT | 2 |
| DMN | Daemon, MCP, sessions, jobs | NOT_BUILT | 2 |
| ARC | Archives and app bundles | NOT_BUILT | 3 |
| JSE | JavaScript and Electron | NOT_BUILT | 3 |
| EVD | Evidence, unknowns, verification | NOT_BUILT | 3 |
| OTH | Other formats | NOT_BUILT | 3 |
| PM | Program model | NOT_BUILT | 1 |
| SCH | Scheduler | NOT_BUILT | 2 |
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

**Counts (34 items):** PARTIAL_VERIFIED 7 (NAT, CLI, BEN, PROC, FIX, KEY, LED);
NOT_BUILT 27; SCAFFOLDED 0; PARTIAL_UNVERIFIED 0; COMPLETE_UNVERIFIED 0; COMPLETE_VERIFIED 0;
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

### SBX, sandbox and safety: NOT_BUILT
- **Evidence:** no sandbox code. Related, under other rows: the untrusted-content envelope (D-6,
  RX-1/output-formats), workspace refusal in probes (RX-1/assay-probes), core's
  `policy/{taint,redact,approvals}.ts` (core tests). The ledger row is REA-C34; the weak points
  include 30 open security rows, 19 blocking.
- **Gaps:** everything in MASTER-PLAN SBX; ADR 0006 is not written.
- **Next (Wave 1, first):** ADR 0006 and the sandbox interface, with macOS `sandbox-exec` first (the
  development machine), Linux (Landlock helper or bubblewrap where user namespaces are allowed) and
  a Windows Job Object; network off; results labelled `unenforced` where no sandbox applies. A new
  reax row (for example RX-2/sandbox-tripwire). Positive: a well-behaved child runs and returns its
  output. Negative: a tripwire child that writes outside scratch, connects to a listener the test
  owns, or exceeds its memory limit is stopped, on each OS lane. Oracle: the OS (the file is absent,
  the listener records no connection). Weak points it targets: REA-C15-LIMIT (with ENG).

### ENG, engine adapters and provider registry: NOT_BUILT
- **Evidence:** no adapter code; LLVM runs today only as an oracle (`scripts/oracle*.ts`). Related:
  core's `ProbeContext.exec` (argv, no shell, bounded time and output) in `probes/engine.ts` and
  `probes/router.ts`. Rows: REA-C38, LEAN-C14, LEAN-C46.
- **Next (Wave 1, after SBX):** the adapter contract (plan §3.6: id, version, binary digest,
  availability and remediation, operations served, resource class, a streamed, cancellable run) and
  the provider registry, with LLVM 18 as the first provider, run under SBX and PROC. A missing engine
  gives a typed error with an install line and never installs (LEAN-C14, LEAN-C46). Positive: the
  adapter's `llvm-nm` list equals NAT's built-in reader on every fixture; the binary digest equals
  `shasum -a 256`. Negative: a missing binary, a wrong version and a cancelled run (no child left).
  A live LLVM lane in CI (RCI).

### PM, program model: NOT_BUILT
- **Evidence:** none in reax. Core's kernel (`kernel/kernel.ts`, SQLite) is the storage precedent.
- **Next (Wave 1, beside ENG):** `pm.db` (node:sqlite) with `pm_target` keyed by digest, and symbols,
  functions, strings and segments filled from NAT's operations; FTS5 over strings and symbols; cache
  keys that include the reader or engine version. Positive: the stored rows equal the operations'
  results (themselves checked against LLVM keys); an FTS query equals a linear filter; the store
  survives a process restart. Negative: a changed engine or reader version is not served from the
  cache; a digest mismatch is refused. The daemon becomes its owner in Wave 2 (D-14).

### COD, code-level analysis: NOT_BUILT
- **Evidence:** none. Builds on `inventory.procedures` and `read.symbol` (NAT). 63 rows, 56 of them
  phase 2.
- **Next (Wave 2):** disassembly of one procedure through the LLVM provider, written once to a file
  in the work directory and sliced (procedure_assembly, read_function_instructions, LEAN-C08,
  LEAN-C18). Positive: each instruction's address and bytes equal `read.bytes` at the procedure's
  file offset; boundaries match NAT's procedure table; mnemonics equal the compiler's `-S` output for
  the zig fixture sources. Negative: an address in no procedure, a non-code section, a missing engine.

### RUN, runtime and devices: NOT_BUILT; Frida and ADB parts BLOCKED_EXTERNAL
- **Evidence:** none. Related: core's approval queue (`policy/approvals.ts`), the process host.
  71 rows. Frida (REA-C16, 10 rows) and ADB (REA-C26, 25 rows) are blocked: no fixture device.
  Unblock: a fixture device or emulator cleared with the user (for ADB), and the same or a local
  Frida install confined to /tmp cleared with the user (for Frida).
- **Next (Wave 2):** capture and compare a test-started process (capture_process_scenario,
  compare_process_captures): argv, exit code, output, child tree, files written in scratch, under
  SBX, off by default and approval-gated. Positive: the capture of a fixture program equals what its
  source does. Negative: no approval, no run; a PID reax did not start is refused; a failed run
  leaves no process. Only test-started processes are inspected.

### MOB, managed and mobile: NOT_BUILT; JEB part BLOCKED_EXTERNAL
- **Evidence:** none in reax. 29 rows. REA-C25 (JEB, 5 rows) is blocked: JEB is commercial and not
  licensed or installed. Unblock: a licence, or the user's decision to mark the rows `wont`.
- **Next (Wave 2):** .NET metadata from a PE's CLI header (inspect_managed_artifact, LEAN-C30) and
  framework markers in an APK listing (LEAN-T08), read in memory with core's zip listing, no
  extraction. Fixtures built by a .NET SDK confined to /tmp. Oracle: `System.Reflection.Metadata` in a
  small checked-in program, and Python `zipfile`. Negative: a non-.NET PE, a damaged table (partial,
  never invented).

### SET, setup, skill and router: NOT_BUILT
- **Evidence:** none in reax. Related: core's `probes/router-pack.json` (leanrea's router as data,
  used by Assay). 18 rows.
- **Next (Wave 2, after DMN's stdio server):** `reax setup` and `reax uninstall` for two clients
  (Claude Code and Codex) and `reax doctor`, only against a temporary HOME. A new reax row (for
  example RX-2/setup-clients); REA-C40 stays open until its full client list. Positive: install twice
  equals install once; uninstall restores the original files byte for byte. Negative: a malformed
  existing configuration is left untouched and reported. Oracle: JSON and Python `tomllib` parsers.

### DMN, daemon, MCP, sessions and jobs: NOT_BUILT
- **Evidence:** none in reax. Related: core's `mcp/{handles,paths,suggest}.ts` (Assay's). 11 rows,
  two owned by SNAP (REA-C33) and PROC (REA-C39).
- **Next (Wave 2):** `reax serve` over stdio exposing the registry's operations (REA-C01), then
  streamable HTTP bound to loopback with a bearer token (REA-C02). Positive: the official MCP SDK
  client (dev-only, pinned) lists and calls every operation; `tools/list` measured at or under
  16 KiB. Negative: a non-loopback bind, a missing token and a wrong token are refused. Weak points
  it targets: REA-A6.3, REA-C02-LIMIT.

### ARC, archives and app bundles: NOT_BUILT
- **Evidence:** none in reax. Related: core's `probes/builtin/archive.ts` (`archive.list`: zip,
  zip64, tar, pax, gzip-wrapped tar, ASAR; listing only), tested in core. 14 rows.
- **Next (Wave 3, first in it):** `inventory.archive` on core's listing, and plist XML and binary
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

### SCH, scheduler: NOT_BUILT
- **Evidence:** no scheduler. Core's kernel has tasks, attempts, leases and checkpoints, verified
  through reax's `conformance.test.ts` (AB-P1, P4, P6, P8, P12, PD-5 `fixed`); that is the
  substrate, not a scheduler.
- **Next (Wave 2):** an in-process scheduler with resource classes, a reserved cheap lane,
  single-flight by cache key, and aging. Positive: a flood of deep jobs does not delay cheap ones
  past a bound; duplicate keys run once. Negative: submissions over quota are refused. Oracle: an
  injected clock and a reference queue model written separately.

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
  SBX and RUN, SR-9 with DMN; the rest in Wave 4, each with a test where the note allows one.

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
  for reax rows.
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
| 3 | ARC, then JSE; EVD; OTH; CLI; BEN | ARC: SBX (for extraction). JSE: ARC. EVD: core's store. OTH: FW, SBX. CLI: DMN (schema profiles). BEN: DMN, SET |
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

- **ARC, JSE, EVD, DMN: NOT_BUILT, though core has tested code.** Core's archive listing, JS probes,
  evidence store, verifier and MCP handles work and are tested, mostly in `packages/core`. No reax
  operation exposes them, and none of these components' rows is tagged, so they count as foundations,
  not status.
- **SCH: NOT_BUILT, though the kernel's lease machinery is verified.** The verified part is the
  state machine a scheduler would use; nothing schedules.
- **PROC: PARTIAL_VERIFIED.** It rests on reax's own code (`src/bench/backends/proc.ts`, on core's
  vendored process host) with positive and negative tests: RX-1/bench-process and RX-1/bench-close
  `covered`, REA-A7.2 `fixed`.
- **FAIL and XST: NOT_BUILT, though core's kernel tests pass in reax's CI.** Their only evidence
  (REA-A5.1, PD-6, PD-1, AB-P6) is core kernel code that no reax operation uses, so under D-13 it is
  a foundation, as for EVD and SCH. (Corrected after review: Wave 0's first draft rated both
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
