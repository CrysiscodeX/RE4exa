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

- **NAT-3, symbols and procedures** (CI to confirm on the commit that adds it):
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

## Active
- **NAT-4, format depth:** ELF notes, PE resources, certificates and load config, Mach-O code
  signature and entitlements, Go and Rust metadata, crash dumps, GGUF.

## Next (in order)
1. ARC, archives and bundles.
2. SBX, the sandbox.
3. DMN, the daemon and MCP (`docs/tools.json` is the tool catalog: watch its size against the
   16 KiB `tools/list` target).

## Blocked
- **The automatic session hook:** refused by the session's permission policy (DECISION-LOG D-5).
  The setup script stands in for it.

## Known defects
- None open beyond the ledgers' weak points.

## Lessons kept as rules
- A cross-check against a system tool first checks which tool it is (`--version`): macOS ships
  different `strings` semantics under the same name.
- A test of a failure path is mutation-checked: remove the fix, and the test must fail
  (the EPIPE test did not, until the pipe was closed before the child wrote).
