# Execution state

**Restart point.**
1. Run `bash scripts/dev/setup-node.sh`, or put `/opt/nvm/versions/node/v24.22.1/bin` first on PATH.
2. Read this file.
3. Continue with the first package under **Next**.

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

- **NAT-3, symbols and procedures** (`68e61f4`):
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

- **NAT-4, part 2** (`23162f6`):
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

- **NAT-4, part 4b** (CI to confirm on the commit that adds it):
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

## Active
- **NAT-4, part 4 (rest):**
  - Rust (`.dep-v0`, needs cargo-auditable);
  - crash dumps;
  - the PE COFF symbol table and ARM64 `.pdata`.

## Next (in order)
1. ARC, archives and bundles.
2. SBX, the sandbox.
3. DMN, the daemon and MCP (`docs/tools.json` is the tool catalog: watch its size against the
   16 KiB `tools/list` target).

## Blocked
- **PE certificates (`inspect_pe_certificates`):** none of the four PE files in the LearnHarness
  corpus is signed (their certificate directory is empty) and no signing tool is installed, so
  there is no sample to check a reader against. The row stays untested.
- **Local machine (macOS arm64, 2026-10-31):** Node is 24.18.0, not the pinned 24.22.1 (no nvm at
  `/opt/nvm`); Go is 1.27.3, not 1.24.x; the pinned zig wheel is the Linux one, so the zig rebuild
  test cannot run here. LLVM 18 and binutils come from Homebrew, pefile from the pinned hash. The
  keys regenerate identically except tool-version labels (the Python label differs: leave
  `entropy.json`, `search.json` and `strings.json` as CI wrote them).
- **The automatic session hook:** refused by the session's permission policy (DECISION-LOG D-5).
  The setup script stands in for it.

## Known defects
- None open beyond the ledgers' weak points.

## Lessons kept as rules
- A cross-check against a system tool first checks which tool it is (`--version`): macOS ships
  different `strings` semantics under the same name.
- A test of a failure path is mutation-checked: remove the fix, and the test must fail
  (the EPIPE test did not, until the pipe was closed before the child wrote).
