# Master plan

Work packages in build order (DECISION-LOG D-2). Each lists its rows (ledger keys or families),
what it depends on, and its acceptance criteria. Architecture details are in `../plan.md`; this
file says what is built when, and how it counts as done.

**Every package is done only when:**
- its operations are registered, so the CLI, docs, `tools.json` and ledger mappings are generated;
- each covered row has `[+KEY]` and `[-KEY]` tests, checked against an independent answer key where
  the row reads a format;
- CI is green on every platform the rows name, and the parity job reports the rows covered;
- `scripts/status.ts` is regenerated, and `EXECUTION-STATE.md` updated.

| WP | Scope | Rows (examples) | Depends on | Acceptance beyond the common bar |
|---|---|---|---|---|
| **FW** | Operation framework: `offset`/`limit` paging with `page.next`; output formats text, json, jsonl, yaml, markdown and toon; the answer-key pipeline (`scripts/oracle.ts`, re-derived in the fixtures job) | REA-C03, C04, C35; LEAN-C07, C09, C10 | — | Each format round-trips or is checked against a reference parser; a paged result reassembles to the unpaged one |
| **NAT-1** | Strings and bytes: `read.strings` (ASCII and UTF-16LE, offsets, minimum length, search), `read.bytes`, `search.bytes` | list_strings, search_strings, read_bytes, search_bytes | FW | Strings equal LLVM's `llvm-strings` set (ASCII) on every fixture and corpus file |
| **NAT-2** | Layout: `inventory.segments` (ELF program headers and sections, PE sections, Mach-O segments and sections), `read.address` (address ↔ file offset), `read.entropy` | list_segments, inspect_binary_layout, address_to_file_offset, inspect_byte_entropy | FW | Equal to `llvm-readobj` sections and segments; entropy equal to an independent computation |
| **NAT-3** | Symbols and procedures: full ELF `.symtab` and `.dynsym`, Mach-O `LC_SYMTAB`, PE exports and COFF symbols; `inventory.symbols`, `search.procedures`, `read.procedure` (address ↔ name, the containing procedure) | list_names, list_procedures, search_procedures, procedure_address, procedure_info, address_name, resolve_containing_procedure | NAT-2 | Equal to `llvm-nm`, with sizes |
| **NAT-4** | Format depth: ELF notes and mitigations; PE resources, certificates, load config and debug directory; Mach-O load commands, code signature and entitlements; ObjC classes and protocols; Go build info; Rust `.dep-v0`; recorded crashes; Apple IPS; GGUF and safetensors | the C12, C13, C14 and C45 rows | NAT-2 | Each checked against `llvm-readobj` (or `go version -m`, or a format's reference reader) on new fixtures |
| **ARC** | Archives and bundles: inventory and controlled extraction for zip, tar, tar.gz, ASAR, .app, IPA, APK, AppImage and DMG (listing); plist (XML and binary), keyed archives, nib, asset catalogs; comparing artifacts | the C17 rows, LEAN-C19, C22, C35, T03, T17 | FW | Traversal, symlink, bomb and depth tripwires; the extraction quota enforced |
| **JS** | JavaScript and Electron: the module graph with resolution status; endpoints; obfuscation; source maps; Electron IPC pairing; fuses; the security checklist | the C19 rows, LEAN-C20, C23, C24, C43, T01, T04–T06, T16 | ARC | Checked on the LearnHarness tree and the ASAR fixtures |
| **MAN** | .NET metadata (ECMA-335 tables); APK manifest (binary XML), DEX header and strings, signatures (v1 to v3); Flutter, Hermes and IL2CPP markers | the C23 and C24 phase-1 rows, LEAN-C30–C32, T08 | ARC | New fixtures built in CI (dotnet SDK, Android tools) with an independent reader as the answer key |
| **FMT** | SQLite schema, PDF structure, pyc, BEAM, devicetree, kernel modules, GPU code objects, EVM selectors, pcap and HAR metadata, firmware regions | the C27, C28, C29 and C45 rows, LEAN-C33, C34, C36, C37, T09, T14 | FW | Each against its format's reference tool |
| **EVD** | Evidence, unknowns and verification as reax operations, on core's store: bundles, paged views, unknown records, reconstruction verification, obligations | the C30, C31 and C32 rows, LEAN-C11–C13, C15, C16 | FW | Round-trip through a signed bundle; verdicts from core's verifier |
| **SBX** | The sandbox interface (ADR 0006): Linux Landlock and seccomp (bubblewrap where allowed), macOS sandbox-exec, Windows Job Object; network off; an `unenforced` label where none is available | SR-6, SR-7, the 19 security blockers | — | A tripwire child that tries to write outside its scratch space, open a socket or exceed memory is stopped on each OS |
| **DMN** | `reax serve`: the store owner, socket and token, sessions and targets, job model (deadlines, progress, cancel), MCP stdio and HTTP (bearer token, loopback only) | C01, C02, C05, C33, C36, C39; SR-9 | FW | `tools/list` ≤ 16 KiB measured; MCP conformance against the official SDK client |
| **SCH** | Scheduler: pools, the cheap lane, memory-aware admission, single-flight, fair queues, stall watchdog | plan §3.7; scale and state weak points | DMN | Load tests: no starvation; RSS limits hold |
| **PM** | The program model `pm.db`: symbols, functions, xrefs, strings, modules; FTS5; cache keys with the engine version; annotations with read-back | plan §3.5 | DMN, NAT-3 | Survives a daemon restart; annotation read-back |
| **ENG** | The engine adapter contract and the provider registry; LLVM objdump, capstone, rizin, Ghidra headless, JADX, Apktool, ILSpy, capa, FLOSS, yara-x, binwalk or unblob, tshark | C38, LEAN-C14, C46 | SBX, SCH | Each adapter: contract tests always, plus a live lane in `reax-real.yml` where the engine installs |
| **CODE** | Disassembly, decompiling, xrefs, call graphs, navigation, annotations, comparison and diffing | C06, C08–C11, C15, LEAN-C08, C18, C26, C41, C42, C44, C45 | ENG, PM | Differential against a second engine where two exist |
| **RT** | Runtime and devices, off by default: Frida, CDP and browser, Electron/V8, process capture, ADB, native UI, debuggers | C16, C18, C20–C22, C26, C43 | SBX, DMN | Zero runtime operations without explicit approval; cleanup after failures |
| **SET** | Setup, doctor, update and uninstall for agent clients; the generated skill; leanrea's router as data; the six prompts; reference-source import; logging | C40–C42, C44, C46, LEAN-C01–C03, C06, C47, C48, T02 | DMN | Idempotent install and uninstall; existing client configuration left intact |
| **BEN** | Benchmark validity A1–A9; the rea 6.8.0 and leanrea Tier 0 arms; context-overhead probe; MCP sizer | LEAN-C49–C59 | DMN, SET | A fair comparison with a pre-registered analysis |
| **FAIL** | Deterministic failure injection across the runner, daemon and adapters; retries, breakers, checkpoints | the state, errors and scale weak points | DMN, SCH | Seeded fault plans reproduce; no duplicate side effects |
| **REL** | Release workflow, SBOM, provenance attestation, versioning, support policy | the governance weak points, AB-P17, PD-12 | all | A tagged dry run produces attested artifacts |
