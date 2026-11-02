# Execution state

**Restart point.**
1. Run `bash scripts/dev/setup-node.sh`, or put `/opt/nvm/versions/node/v24.22.1/bin` first on PATH.
2. Read this file.
3. Continue with the first package under **Next**.

**Last verified checkpoint: `d804135`.** CI green: reax run 41480699513 (all five jobs, on attempt 2
after a macOS runner-capacity cancellation), tests 41480699456; assay last ran on `fb1e03e` (run
41459082047, green). The parity report of attempt 2: 39 of 357 rea and leanrea rows covered, 35 of 35
reax rows covered, 21 of 244 weak points fixed. 247 tests declared on every lane; passed: Linux 246,
macOS 244, Windows 228 (1, 3 and 19 skipped by platform), and the fixtures job all 247. The baseline
reconciled at `bc38202` is in `BREADTH-COVERAGE.md`.

## Done (verified in CI)
- **Baseline re-measured:** see `BASELINE.md`.
- **Workspace and reconciliation:** this folder; `scripts/status.ts` generates `CAPABILITY-MATRIX.md`.
- **FW, the operation framework** (DECISION-LOG D-6; CI green on `196ba41`, all three workflows):
  - six output formats, fuzzed against four independent decoders;
  - `--filter-output`, `--token-limit` and `--llms`;
  - stateless paging (`src/ops/page.ts`);
  - the response budget and `result_too_large`.
  - Rows tagged: RX-1/output-formats, RX-1/paging, REA-C35, LEAN-C10.
  - `scripts/oracle.ts` moves to NAT-1, the first package with a new answer key.

- **NAT-1, strings and bytes** (`53f3909`; its macOS lane failed on a test that ran macOS's own
  `strings` as an oracle, fixed in the next commit):
  - `read.strings` (ASCII and UTF-16LE at any offset, search, case folding, paging), `read.bytes`
    and `search.bytes` (hex with `??`, text, overlapping matches), all streamed through a 1 MiB
    window;
  - answer keys from llvm-strings, GNU strings and Python's `re` (`scripts/oracle.ts`,
    `bench/oracle/`), re-derived in CI's fixtures job;
  - rows tagged: list_strings, search_strings, read_bytes, search_bytes, LEAN-C07;
  - byte-level operations are not Assay sweep probes (D-7).

- **NAT-2, layout and entropy** (`32754e0`, CI green on all three workflows; the macOS fix
  `96f9db9` with it):
  - `inventory.segments` (reax's own reader, `src/readers/layout.ts`: ELF sections and program
    headers, PE sections, Mach-O segments and sections in every slice, wasm sections);
  - `read.address` (address to file offset and back, memory-only ranges named);
  - `read.entropy` (whole file, per block and per section);
  - keys from llvm-readobj 18 and Python (`bench/oracle/layout.json`, `entropy.json`);
  - the CLI ends quietly when its reader closes the pipe (`reax ... | head`).
  - Rows tagged: list_segments, inspect_binary_layout, address_to_file_offset,
    inspect_byte_entropy.

- **NAT-3, symbols and procedures** (`68e61f4`; CI green on all three workflows: reax run
  41195870946, assay 41195870983, tests 41195871039):
  - `inventory.symbols` (ELF .symtab and .dynsym with GNU versions; PE exports, imports and
    delay-load imports; Mach-O nlist with each undefined symbol's dylib; wasm);
  - `inventory.procedures`, merged from symbols, ELF `.eh_frame` (stripped binaries too), PE
    `.pdata` (x64), Mach-O nlist and `LC_FUNCTION_STARTS`, and wasm bodies;
  - `read.symbol` (name to address, size, section and file offset; address to the containing
    procedure plus offset);
  - `inventory.overview`, with entry points from ELF, PE and Mach-O `LC_MAIN`;
  - answer key `bench/oracle/symbols.json` from llvm-nm, llvm-readobj, llvm-objdump and
    llvm-dwarfdump;
  - rows tagged: list_names, list_procedures, search_procedures, procedure_address,
    procedure_info, address_name, resolve_containing_procedure, binary_overview.
  - Open within NAT-3's scope:
    - the PE COFF symbol table and ARM64 `.pdata`;
    - `LC_FUNCTION_STARTS` against an oracle (the zig fixtures carry an empty table; the
      LearnHarness dylibs carry real ones).

- **NAT-4, part 1** (`505677d`, CI green on all workflows, Go key re-derived in CI):
  - `inventory.notes`: GNU build ID, ABI tag, x86 and AArch64 property notes, Go build ID, FDO
    packaging; checked against llvm-readobj;
  - `inventory.go`: build information and pclntab functions (stripped binaries); checked against
    Go's own `debug/buildinfo` and `debug/gosym`;
  - the extra fixtures (D-8);
  - rows tagged: inspect_elf_notes, inspect_go_binary, LEAN-C21, LEAN-C28, LEAN-T10.
  - Found by the Go key: function names are UTF-8, not Latin-1 (fixed here and in the layout
    reader).

- **NAT-4, part 2** (`23162f6`; CI green on all three workflows: reax run 41197039347, assay
  41197039366, tests 41197039327):
  - `inventory.resources`: the PE resource tree, plus version information, string tables and
    the manifest;
  - checked against llvm-readobj (the tree) and pefile 2024.8.26, pinned by hash in
    `scripts/oracle-requirements.txt` (the decoded contents);
  - a zig-built PE with resources joins the extra fixtures;
  - row tagged: inspect_pe_resources.

- **NAT-4, part 3** (`e2d1579`, CI green on all three workflows):
  - `inventory.macho`: header and load commands, checked against llvm-objdump;
  - the code signature (blobs, CodeDirectory identifier, team, flags, hash type, entitlements),
    with every code page and special slot re-hashed over the file;
  - rows tagged: inspect_macho, inspect_signature.

- **NAT-4, part 4a, PE load configuration** (`2d46a8d`, CI green on all three workflows):
  - `inventory.pe`: header mitigations (ASLR, high-entropy, DEP, CFG, SafeSEH, forced integrity)
    and the load configuration directory, PE32 and PE32+;
  - checked against llvm-readobj 18: the zig and extra PEs, the four MSVC-built LearnHarness
    DLLs (`bench/corpus/pesec.facts.json`), and synthetic PE32 and PE32+ images with a different
    value in every field and every guard flag (`scripts/pe-synth.ts`); the synthetic images found
    the `CF_FUNCTION_TABLE_SIZE_nBYTES` flag and an LLVM/pefile disagreement (D-9);
  - row tagged: inspect_pe_load_config.
  - Only `CF_INSTRUMENTED` occurs in real files here; the other guard flags are checked on
    synthetic images only.

- **NAT-4, part 4b** (`d5285e7`; CI green on all three workflows: reax run 41212075905, assay
  41212075899, tests 41212075897):
  - `inventory.model`: GGUF (v2 and v3, both byte orders) and safetensors headers of files of any
    size: metadata, tensor table, parameter count, quantisation mix, problems (cut files,
    misaligned offsets); every scan bounded;
  - key from a stdlib parser cross-checked against the gguf package and a real 9B model (D-10);
    fixtures written by the gguf and safetensors packages (`node scripts/extra-fixtures.ts models`
    adds only those, keeping the other fixtures' digests);
  - row tagged: inspect_model_artifact;
  - `LC_FUNCTION_STARTS` checked against llvm-objdump on the LearnHarness dylib and two addons
    (`bench/corpus/functionstarts.facts.json`): 51,569 addresses equal. This found that a number in
    the table could be read past the table's end; fixed, with a test.

- **NAT-4, part 4c, Rust `.dep-v0`** (`b2367cf`; CI green: reax run 41238279650, all five jobs, with
  assay run 41238279683 and tests run 41238279662):
  - `inventory.rust`: the cargo-auditable dependency data in ELF `.dep-v0`, Mach-O `__DATA,.dep-v0`
    (every slice), PE `.dep-v0` and wasm: packages with version, source, kind and root, dependency
    edges, and the rustc commit hash from `/rustc/<hash>/` paths, so a Rust binary built without
    cargo-auditable is still named Rust. The inflate and the package and edge counts are capped; a
    damaged or oversized section gives partial coverage with a limitation, never an error;
  - key: rust-audit-info 0.5.4's JSON (`bench/oracle/rust.json`), re-derived in CI's fixtures job,
    which installs it with `cargo install --locked` (D-11);
  - fixture `rust-deps-aarch64-apple-darwin`, sources and `Cargo.lock` in `fixtures/extra-src/rust-deps`;
  - not an Assay sweep probe, on cost (D-12);
  - rows tagged: rea.tool/inspect_rust_binary, LEAN-C29, LEAN-T13.
  - Known gaps (D-11): ELF, PE and wasm `.dep-v0` have no real fixture (the host has only the
    aarch64-apple-darwin std, and no cross route is cleared); wasm is covered only by a synthetic unit
    test; cargo-auditable 0.7.7 records no features, so `features` is checked only against a synthetic
    document. ELF, PE and fat Mach-O were checked by hand only (the real blob spliced into copies of
    the zig ELF and PE fixtures with llvm-objcopy; a lipo'd fat file); no committed test covers them.
  - Correction: `2e07cb7` recorded this item as blocked for lack of a Rust toolchain. That was
    wrong: Homebrew rustc and cargo 1.99.1 are installed, and cargo-auditable 0.7.7 and
    rust-audit-info 0.5.4 are in `/tmp/reax-cargo`.

- **Wave 0 of the breadth plan** (`9f76fb7`, documentation only, D-13 to D-17; CI green: reax run
  41292788262, all five jobs; tests 41292788332): `BREADTH-COVERAGE.md` and `MISSING-CAPABILITIES.md`.

- **Wave 1, item 0: the three Wave 0 defects** (`175f614`; CI green: reax run 41295523548, all five
  jobs (three lanes, fixtures, parity), assay 41295523509 (check, and platforms on macos-15 and
  windows-2025), tests 41295523549; Reviewer-Debugger PASS in one round):
  - the x64 (`0x8664`) `.pdata` walk in `src/readers/symbols.ts` stops at the raw bytes of the
    section holding the table. A directory that overruns the section, or a section cut by the end of
    the file, gives partial coverage with a note in the parked ARM64 form. Tests in
    `test/pdata-x64.test.ts` on an in-memory PE, tagged `[+rea.tool/list_procedures]` and
    `[-rea.tool/list_procedures]`; the expected values come from the builder, and llvm-readobj agrees
    on the valid entries;
  - `test/format.test.ts` probes for PyYAML with `python3 -I`, as it runs the check;
  - `biome.json` excludes the gitignored, machine-local `bench/backends.json` from lint.
  - Reviewer's evidence: procedures, symbols and overview for every committed fixture are unchanged
    by a before/after dump, and no key or fixture changed. The four LearnHarness x64 DLLs also dumped
    unchanged (38,444 procedures). That direct dump is the corpus evidence, because
    `test/corpus-lh.test.ts` does not exercise procedures. Mutations of the bound and of both notes
    fail the tests.
  - Follow-up: mutant M6 survives. Every case puts the `.pdata` directory at the start of its
    section, so the `- (pd.rva - sec.rva)` term in the room computation is untested. It needs a case
    with the directory partway into the section.
  - Parked ARM64 finding (d) is fixed for x64 by this commit.

- **Wave 1, item 1: SBX, the sandbox foundation** (`1001fd7`; D-18, D-19, D-20, D-21). **PARTIAL_VERIFIED**:
  enforced on Linux and macOS, fail-closed on all three platforms.
  - CI green:
    - reax run 41440711064, all five jobs; tests 41440710879; assay 41440711018 (check, and
      platforms on macos-15 and windows-2025).
    - Infrastructure re-run: the first attempt of the reax and assay runs was cancelled because
      GitHub had no macOS arm64 runner capacity ("The job was not acquired by Runner of type
      hosted"), with zero steps run. The failed jobs were re-run (attempt 2) and passed. Not an SBX
      failure.
    - Parity report (run 41440711064): 203 tests on each of darwin, linux-fixtures, linux and win32;
      gate passed; `RX-SBX/enforced` (platforms linux, darwin) and `RX-SBX/fail-closed` (linux,
      darwin, win32) both "covered: all required lanes passed + and - tests"; reax rows 31 of 31
      covered.
    - Linux: the backend test reads "landlock (Landlock ABI 8)", the first real Linux run; all 13
      sandbox tests passed.
    - Windows: the fail-closed rows passed; the enforcement tests skip by design (14 skips on win32
      in all).
  - What it is:
    - `runSandboxed(argv, SandboxPolicy, opts)` in `src/sandbox/`: reads allowed, writes only
      beneath `scratch`, no network. Backends: macOS `sandbox-exec` (deny-default SBPL profile);
      Linux Landlock through `landlock.py`, run by the system `python3 -I` (ABI 4 or later; TCP
      connect and bind denied).
    - Elsewhere, `required: true` throws `sandbox_unavailable` before anything starts, and
      `required: false` runs labelled `enforcement: "none"`.
    - The environment is an allowlist (`SANDBOX_ENV`, plus `passEnv`; HOME and TMPDIR are the
      scratch).
    - A deadline (`timeoutMs`), an abort signal, and an output cap.
    - reax kills the tree while the root is unreaped; core's termination barrier is off on POSIX
      (D-20). ADR 0006 is `docs/decisions/0006-sandbox.md`.
    - Core gained an `onSpawn` hook in the vendored orca process host.
  - Review history:
    - FAIL 1 to 3: process cleanup.
    - FAIL 4: one false doc comment, B1.
    - Under D-21: a text-only fix (B1 and five more overclaims), then a narrow check, PASS. It found
      one token difference, in a test-title string.
  - Pre-push checks on macOS: core, Assay (`assay.yml`'s check steps) and reax all exit 0. Two
    environment notes:
    - core's readelf differential test is meant for Linux and skips without readelf; on macOS it
      fails only if Homebrew binutils is on PATH;
    - Assay's LearnHarness tests are Linux-only; CI's check job runs them.
  - The SBX stash is dropped; the ARM64 `.pdata` stash remains.
  - Open advisories and follow-ups:
    - A1: libuv reaps a batch of children before emitting their exit events, so the comment that an
      unreaped root's pid "cannot have been reused" can be wrong for a synchronous abort of run B
      inside run A's callback (`rootLive()` true for an already-reaped B; hit in 2 of 220
      iterations, B still a zombie). Fix: defer with `setImmediate` and re-check, or reword to "has
      not emitted exit".
    - A2: G3 and G4 (the `finally` stdio destroy and the ref'd hold timer) are unreachable on POSIX
      and not exercised on the windows-2025 lane. Add a `forceBackend: "none"` deadline test that runs
      on Windows, or label them Windows-only.
    - `src/errors.ts`: `sandbox_unavailable`'s fix text says "nothing was started", which is
      inaccurate on the Landlock exit-125 path (the helper started, and failed before exec).
    - Escaped-grandchild confinement: prove an escaped grandchild is still sandboxed.
    - The Linux helper as `PR_SET_CHILD_SUBREAPER`.
    - UDP and other non-TCP sockets are not controlled on Linux (Landlock ABI 4 covers TCP only).
    - The macOS `mach-lookup` DNS side channel (mDNSResponder is reachable; ADR 0006).
    - Not in scope yet: Windows enforcement, read restriction, memory limits.

- **Wave 1, item 2: ENG, the engine adapter contract and provider registry, LLVM first**
  (`95c82c1`; D-14, D-15, D-22). **PARTIAL_VERIFIED.**
  - CI green:
    - reax run 41450134753, all five jobs; tests 41450134853; assay 41450135019 (check, macos-15,
      windows-2025).
    - Parity report: 225 tests on each of darwin, linux-fixtures, linux and win32; gate passed;
      `RX-ENG/contract` (linux, darwin, win32) and `RX-ENG/llvm` (linux, darwin) both "covered: all
      required lanes passed + and - tests"; reax rows 33 of 33 covered.
    - Discovery, as the JUnit test names record it:
      - linux: `/usr/lib/llvm-18/bin/llvm-nm`, 18.1.3, landlock;
      - darwin: `/opt/homebrew/Cellar/llvm@18/18.1.8/bin/llvm-nm`, 18.1.8, sandbox-exec;
      - win32: `C:\Program Files\LLVM\bin\llvm-nm.exe`, 20.1.8, enforcement none.
      This was CI's first sight of Windows LLVM discovery. Windows runs on targets fail closed
      (D-22).
  - Review history: round 1 FAIL (four missing tests), round 2 PASS.
  - What it is:
    - `src/engines/contract.ts`: the `EngineProvider` contract. Availability is the real path,
      version, SHA-256 of the binary, and the sandbox label discovery ran under, or unavailable with
      a reason and an install line;
    - `src/engines/registry.ts`: one provider per id;
    - `src/engines/run.ts`: the command-engine runner, and `mapRun` from a `SandboxResult` to results
      and errors;
    - `src/engines/llvm.ts`: the LLVM provider.
      - Discovery order: `REAX_LLVM_BIN`, then PATH `llvm-nm-18`, then PATH `llvm-nm`, then fixed
        directories. No install.
      - LLVM 18 or later.
      - `llvm-nm -P` runs through `runSandboxed`, always with `required: true` (`alwaysRequired`,
        D-22), and is parsed by reax's own `parseNm`.
  - Public additions:
    - five failure codes: `engine_unavailable`, `engine_failed`, `engine_timeout`,
      `engine_cancelled`, `engine_output_invalid` (`sandbox_unavailable` passes through);
    - the environment variable `REAX_LLVM_BIN` (D-22). No operation or MCP change.
  - Tests in `test/engines.test.ts`, with the fake engine `test/fixtures/fake-engine.mjs`. The key
    for `RX-ENG/llvm` is `bench/oracle/symbols.json`.
  - Known limit, in `docs/engines-known-limits.md`: a symbol name containing a newline makes
    `parseNm` forge symbols, and the result still says `complete`. A test pins the current forged
    result, so the fix will flip it.
  - LEAN-C14 and LEAN-C46 stay untagged: reax has no consent-gated install step, only an install line.
  - Follow-ups and advisories:
    - **Before COD exposes symbols to callers:** mitigate the newline forgery, for example by
      cross-checking against `--format=just-symbols`, or llvm-readobj JSON for ELF; then flip the
      pinned test.
    - M16 survives: an abort that arrives after the engine exits 0 is reported as success. Fix with a
      deterministic `mapRun` test (code 0 with an aborted signal gives `engine_cancelled`).
    - The symlink test's title ("REAX_LLVM_BIN is used first: …") overclaims the discovery order it
      proves; reword it.
    - Two tests tagged `RX-ENG/contract` use the real llvm-nm, while the row title says "against fake
      engines": retitle the row or retag the tests.
    - The A5 install grep matches only remediation strings and two "Homebrew LLVM version" fixture
      strings; accepted by the Orchestrator.

- **Wave 1, item 3: PM, the program model** (`fb1e03e`, with the test-only fix `d804135`; D-23).
  **PARTIAL_VERIFIED.**
  - What it is:
    - `src/pm/{db,schema}.ts`: `pm.db` over `node:sqlite`, with reax's own migration runner (every
      step and the version bump in one transaction; a newer store refused with core's
      `store_schema_newer`), a target table keyed by sha256, the symbols, and an FTS5 trigram index;
    - `src/ops/pm.ts`: `session.index` (write; every slice of the file under its digest) and
      `search.symbols` (read; paged read-back, or an FTS5 search bound as one quoted phrase);
    - storage under `REAX_HOME` (default `<home>/.reax`);
    - failure codes `pm_not_indexed`, `pm_busy` and `pm_target_changed` (both retryable).
    - No sandbox and no engine: it populates from the in-process `inventory.symbols` (D-23).
  - CI:
    - `fb1e03e`: assay run 41459082047 (all three jobs) and tests run 41459082114 passed. reax run
      41459082118 failed only on windows-2025, in `[+RX-1/bench-live]`: the fake Codex's regex for
      `reax.cmd`. Every RX-PM test passed there.
    - `d804135` (test-only fix): the win32 fake Codex parses the new `reax.cmd`. Its patterns are
      shared in `test/fixtures/reax-cmd.mjs`, and every platform checks the `reax.cmd` format.
      - reax run 41480699513 passed all five jobs on attempt 2. On attempt 1, GitHub gave the
        macOS lane no runner (capacity, zero steps), which is infrastructure.
      - tests run 41480699456 passed. assay was not triggered (test-only change).
    - Parity (attempt 2's report): darwin, linux-fixtures, linux and win32, 247 tests each; gate
      passed; `RX-PM/store`, `RX-PM/index-search` and `RX-1/bench-live` all covered; reax rows 35 of
      35.
  - Review history:
    1. FAIL: a NUL query raised a raw SQLite error; the delete-trigger/reader-version and page-limit
       tests were missing.
    2. FAIL: the migration re-check and the bench `callTool` refusal were untested.
    3. PASS: 41 of 45 mutants killed.
    - The CI-fix review (`d804135`): PASS.
  - Safety:
    - reads never create a store;
    - the local bench offers only read operations, and uses a per-run home;
    - the live-arm reax shim sets a per-run `REAX_HOME`;
    - `~/.reax` was never created during this work.
  - Follow-ups:
    - P2c: `reax.cmd` without `setlocal` (Windows only).
    - P3: test the ROLLBACK in `search.symbols`' `finally` (drop `pm_symbol_fts`, then search
      twice).
    - P3b: the count-and-rows transaction has no deterministic test.
    - P4: test the busy mapping of the version reads in rollback mode (`BEGIN EXCLUSIVE` on a non-WAL
      store, a 200 ms timeout, expecting `pm_busy`).
    - Bench shim quoting: single-quote the values, because `"`, `$` and backticks in a live run's
      output directory are expanded.
    - The exported mutable test seams (`MIGRATE_HOOKS`, `PM_LIMITS`, `PM_HOOKS`): mark them
      `@internal`, or freeze them.
    - NOHOME is not testable with the fake. A Windows end-to-end test is still needed to show that
      `reax.cmd` honours `REAX_HOME`.
    - The digest race is now guarded by re-hashing (closed).

- **Wave 1 summary** (complete at `d804135`):
  | Item | Commits | CI (reax run) | Review | Rows newly tested |
  |---|---|---|---|---|
  | 0: three Wave 0 defects | `175f614` | 41295523548 | PASS in round 1 | none (`rea.tool/list_procedures` already covered) |
  | 1: SBX | `1001fd7` | 41440711064 (attempt 2: runner capacity) | FAIL ×4, then D-21's narrow check PASS | `RX-SBX/enforced`, `RX-SBX/fail-closed` |
  | 2: ENG | `95c82c1` | 41450134753 | FAIL, then PASS | `RX-ENG/contract`, `RX-ENG/llvm` |
  | 3: PM | `fb1e03e`, `d804135` | 41459082118 (failed on win32 bench-live), then 41480699513 (attempt 2: runner capacity) | FAIL ×2, PASS; CI-fix review PASS | `RX-PM/store`, `RX-PM/index-search` |
  - Rows newly tested since `9f76fb7`: 6, all reax rows. Tested rows went from 68 to 74 (rea and
    leanrea 39 of 357, unchanged; reax 29 → 35 of 35). Weak points are unchanged: 21 of 244 fixed.
  - Breadth: SBX, ENG and PM are PARTIAL_VERIFIED, making 10 of 34 items.
  - Still open:
    - every follow-up and advisory recorded under SBX, ENG and PM above, notably ENG's
      newline-forgery limit, which must be mitigated before COD exposes symbols;
    - Windows sandbox enforcement;
    - the parked ARM64 `.pdata` stash (**Parked**), with the rest of NAT-4 deferred to after the
      breadth gate;
    - the PE certificates and device blocks (**Blocked**);
    - Waves 2 to 4.

## Active
- **Wave 1 is complete** (summary under **Done**), and waits for the user. Wave 2 (DMN, then SCH;
  COD, RUN, MOB, SET) does not start without the user.

## Parked
- **NAT-4, ARM64 `.pdata`** (parked 2026-11-01 under the breadth rule, D-13; not committed, not
  pushed). The work is the git stash `arm64-pdata WIP (3 reviewer FAILs)` (now second in the stash
  list; refer to it by message), on `bc38202`, 13 files. Applying it is expected to conflict with `175f614` in
  `src/readers/symbols.ts` (not tried). The files:
  - new: `fixtures/extra/pdata-hello-aarch64-windows-gnu.exe`,
    `fixtures/extra/pdata-lib-aarch64-windows-gnu.dll`, their sources
    `fixtures/extra-src/pdata/hello.c` and `lib.c`, `scripts/pe-synth-arm64.ts`,
    `test/pdata-arm64.test.ts`;
  - changed: `src/readers/symbols.ts`, `scripts/oracle.ts`, `scripts/oracle-symbols.ts`,
    `scripts/extra-fixtures.ts`, `fixtures/extra/manifest.json`, `bench/oracle/symbols.json`,
    `test/symbols.test.ts`.
  - Review history (Reviewer-Debugger):
    1. FAIL: the `.xdata` file-bound guard had no test, and a note was wrong.
    2. FAIL: the walk was not bounded by the section's raw bytes.
    3. FAIL: the open findings below.
  - Open findings, to fix before it is resumed:
    - (a) `src/readers/symbols.ts:556-557` (stash line numbers): when the `.pdata` directory RVA has
      no file bytes (a virtual-only tail, no section, or `SizeOfRawData` 0), `.pdata` is skipped
      silently, with no procedures and no note. That leaves the `sec ? … : 0` fallback in
      `arm64Pdata` as dead code.
    - (b) the mutant `Math.floor` → `Math.ceil` in the room computation survives; it needs a test
      with `SizeOfRawData` 15.
    - (c) advisory: the length-mask mutants P7b and P8b survive.
    - (d) follow-up: the x64 (`0x8664`) `.pdata` loop had the same section-bound gap. Fixed for x64
      in `175f614`.
  - Its new `bench/oracle/symbols.json` entries were generated with LLVM 18.1.8 on the Mac, under
    the user's rule that CI's LLVM 18.1.3 confirms them in the fixtures job. They were never pushed,
    so that confirmation has not happened.
  - Resume: `git stash apply` the entry (by its message, not by index), fix (a) to (c), rerun the
    review; (d) is a separate item.
- **NAT-4, the rest** (deferred to after the breadth gate, D-13): the PE COFF symbol table, crash
  dumps (recorded crashes and Apple IPS), and ARM64 `.pdata` (parked above).

## Next (in order)
Wave 1 resumed under D-21 (**Active**).
The breadth plan in `BREADTH-COVERAGE.md` (waves and dependencies there; D-13, D-14):
1. **Wave 1:** SBX, the sandbox foundation; then ENG, the adapter registry with LLVM as the first
   provider; the program model (PM) beside them.
2. **Wave 2:** DMN, then the scheduler (SCH); COD, RUN, MOB and SET.
3. **Wave 3:** ARC, then JSE; EVD, OTH, CLI and BEN.
4. **Wave 4:** the supporting infrastructure, then the breadth gate.

`docs/tools.json` is the tool catalog: 6,294 bytes at `bc38202`, against the 16 KiB `tools/list`
target (DMN measures the real `tools/list`).

## Blocked
- **PE certificates (`inspect_pe_certificates`):** none of the four PE files in the LearnHarness
  corpus is signed (their certificate directory is empty) and no signing tool is installed, so
  there is no sample to check a reader against. The row stays untested.
- **Local machine (macOS arm64, 2026-10-31):** Node is 24.18.0, not the pinned 24.22.1 (no nvm at
  `/opt/nvm`); Go is 1.27.3, not 1.24.x; the pinned zig wheel is the Linux one, so the zig rebuild
  test cannot run here. LLVM 18 and binutils come from Homebrew, pefile from the pinned hash. The
  keys regenerate identically except tool-version labels (the Python label differs: leave
  `entropy.json`, `search.json` and `strings.json` as CI wrote them).
  - Rust: Homebrew rustc and cargo 1.99.1 (host std only, aarch64-apple-darwin); cargo-auditable
    0.7.7 and rust-audit-info 0.5.4 in `/tmp/reax-cargo`.
  - zig 0.15.2 for macOS arm64 (2026-11-01), for the ARM64 `.pdata` item, in `/tmp/zigmac`. Its wheel,
    `ziglang-0.15.2-py3-none-macosx_12_0_arm64.whl` (92,993,702 bytes), has sha256
    `acae2a9ce67ed249ad68d42c21bc73b5f9d51a33ba5ea42f609f78683e8d9bb7`, equal to PyPI's published
    digest; the unpacked tree is byte-identical to a fresh unzip, and `zig version` prints 0.15.2.
    Whether it rebuilds the zig corpus byte for byte is not checked.
- **Frida rows (REA-C16, 10 rows) and ADB rows (REA-C26, 25 rows):** BLOCKED_EXTERNAL under the
  user's rule (D-16): no fixture device. Unblock: a fixture device or emulator cleared with the user;
  for Frida's local half, a Frida install confined to /tmp cleared with the user.
- **JEB rows (REA-C25, 5 rows):** BLOCKED_EXTERNAL: JEB is commercial and neither licensed nor
  installed here. Unblock: a licence, or the user's decision to mark the rows `wont`. This reading is
  the Task Master's; the user has not ruled on it.
- **The automatic session hook:** refused by the session's permission policy (DECISION-LOG D-5).
  The setup script stands in for it.

## Known defects
- None open beyond the ledgers' weak points (the three Wave 0 defects were fixed by `175f614`;
  see **Done**).

## Lessons kept as rules
- A re-run attempt uploads a second artifact with the same name: `gh run download -n reax-parity`
  can fetch the first attempt's report. Take the parity report of the attempt that passed, by its
  artifact id (`gh api repos/{owner}/{repo}/actions/runs/<run>/artifacts`).
- A cross-check against a system tool first checks which tool it is (`--version`): macOS ships
  different `strings` semantics under the same name.
- A test of a failure path is mutation-checked: remove the fix, and the test must fail
  (the EPIPE test did not, until the pipe was closed before the child wrote).
