# Execution state

**Restart point.**
1. Run `bash scripts/dev/setup-node.sh`, or put `/opt/nvm/versions/node/v24.22.1/bin` first on PATH.
2. Read this file.
3. Continue with the first package under **Next**.

**Last verified checkpoint: `bc38202`.** CI green: reax run 41238955508 (all five jobs: three lanes,
fixtures, parity) and tests run 41238955465; assay did not run (its path filter excludes docs). The
parity report of that run: 39 of 357 rea and leanrea rows covered, 29 of 29 reax rows covered, 21 of
244 weak points fixed. 187 tests declared on every lane; passed: Linux 186, macOS 184, Windows
181 (1, 3 and 6 skipped by platform), and the fixtures job all 187. The baseline as reconciled at this commit is in
`BREADTH-COVERAGE.md`.

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

## Active
- **Wave 0 of the breadth plan** (documentation only; DECISION-LOG D-13 to D-17):
  `BREADTH-COVERAGE.md` (every component and supporting subsystem, its status and evidence, and
  the waves) and `MISSING-CAPABILITIES.md` (every ledger row not yet tested, by component). Done
  when reviewed and committed; nothing in it is implemented.

## Parked
- **NAT-4, ARM64 `.pdata`** (parked 2026-11-01 under the breadth rule, D-13; not committed, not
  pushed). The work is the git stash `arm64-pdata WIP (3 reviewer FAILs)`, on `bc38202`, 13 files:
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
    - (d) follow-up: the x64 (`0x8664`) `.pdata` loop has the same section-bound gap (it is
      bounded by the file, not by the section's raw bytes).
  - Its new `bench/oracle/symbols.json` entries were generated with LLVM 18.1.8 on the Mac, under
    the user's rule that CI's LLVM 18.1.3 confirms them in the fixtures job. They were never pushed,
    so that confirmation has not happened.
  - Resume: `git stash apply` the entry (by its message, not by index), fix (a) to (c), rerun the
    review; (d) is a separate item.
- **NAT-4, the rest** (deferred to after the breadth gate, D-13): the PE COFF symbol table, crash
  dumps (recorded crashes and Apple IPS), and ARM64 `.pdata` (parked above).

## Next (in order)
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
- **x64 `.pdata` walk not bounded by its section** (committed code, `src/readers/symbols.ts`, the
  `machine === 0x8664` loop): it stops only at the directory's size and the end of the file, so a
  directory larger than its section's raw bytes reads whatever follows the section as entries.
  Found by the Reviewer-Debugger while reviewing ARM64 `.pdata` (finding (d) under **Parked**); not
  yet reproduced by a committed test. A defect in committed code, so not deferred by D-13: fix it
  with a test (a directory larger than its section's raw bytes) before or with Wave 1.
- **PyYAML probe without `-I`** (`test/format.test.ts:202`): the test checks for PyYAML with
  `python3 -c "import yaml"`, without `-I`, but runs the check itself with `-I` (`:212`). With yaml
  only in the user site, the probe finds it, the isolated run cannot import it, and the test fails
  instead of skipping. Recorded only (Wave 0 implements nothing).
- **`npm run lint` checks the gitignored `bench/backends.json` locally:** biome's VCS integration is
  off (no `vcs` section in the root or reax `biome.json`), so the ignore file is not used. CI's clean
  checkout has no such file and is not affected. Recorded only.
- Otherwise none open beyond the ledgers' weak points.

## Lessons kept as rules
- A cross-check against a system tool first checks which tool it is (`--version`): macOS ships
  different `strings` semantics under the same name.
- A test of a failure path is mutation-checked: remove the fix, and the test must fail
  (the EPIPE test did not, until the pipe was closed before the child wrote).
