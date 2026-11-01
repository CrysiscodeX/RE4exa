# Missing capabilities

Every rea and leanrea capability row that reax does not yet have, from the parity ledger
(`../ledger/parity/rea.jsonl` and `leanrea.jsonl`), grouped by component. At `bc38202`: 357 rows,
39 tested, **318 listed here**. Every row is listed by its stable ledger key; none is summarised
into a range.

**Derived, not invented.** A row is listed exactly when the test suite lacks its `[+KEY]` or its
`[-KEY]` tag (the rule `scripts/status.ts` uses). Its component is the one `scripts/status.ts`
(`COMPONENTS`) gives its family. The CI parity report of reax run 41238955508 (`bc38202`) computes
every listed row as `planned`: none is `partial` or `regressed`.

**Hand-written columns.** Key, phase and component come from the ledger. Description is the
ledger's title, cut at 90 characters, or "(tool of the same name)" when the title is the tool's
name. Owner, priority and "code today" are planning annotations, not ledger data:
- **Owner** is the breadth-inventory item that will build the row (`BREADTH-COVERAGE.md`), where
  that differs from the ledger's component (for example `inspect_python_pyc` sits in the ledger's
  Native readers but is built by OTH).
- **Pri:** A, in the component's breadth package (`BREADTH-COVERAGE.md`, Waves 1 to 3); B, a phase
  0 or 1 row after the breadth gate; C, phase 2; D, phase 3 or 4; X, blocked externally (the reason
  is in the last column and in `EXECUTION-STATE.md`).
- **Code today** names related code that already exists. It does not make the row partial: a row
  counts only when its own `[+KEY]` and `[-KEY]` tests pass in CI.

**Status of each row.** The ledger status is `planned` for all 318. In the breadth vocabulary
(`BREADTH-COVERAGE.md`) each row is NOT_BUILT, except the 41 rows with priority X, which are
BLOCKED_EXTERNAL. The component's own status is given above each table.

**Repeatable check.** From `apps/reax`, this lists the open rows per component and exits 1 if this
file lists a row that is not open, misses one that is, lists one twice, gives a row a phase other
than the ledger's, or puts a row under a section other than the component that the ledger's family
and `scripts/status.ts`'s `COMPONENTS` assign it. It does not check the hand-written columns
(description, owner, priority, code today) or the component blocks:

```bash
node --disable-warning=ExperimentalWarning --input-type=module -e '
import { readFileSync } from "node:fs";
const { COMPONENTS, testTags, familyOf } = await import("./scripts/status.ts");
const rows = ["rea", "leanrea"].flatMap((f) => readFileSync(`docs/ledger/parity/${f}.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
const { plus, minus } = testTags();
const has = (s, k) => s.has(k) || s.has(k.split("/").pop());
const owner = new Map(Object.entries(COMPONENTS).flatMap(([c, fs]) => fs.map((f) => [f, c])));
const want = new Map(rows.filter((r) => !(has(plus, r.key) && has(minus, r.key))).map((r) => [r.key, { phase: r.phase, comp: owner.get(familyOf(r)) }]));
const listed = new Map(), bad = [];
let comp = null;
for (const line of readFileSync("docs/implementation/MISSING-CAPABILITIES.md", "utf8").split("\n")) {
  const h = line.match(/^## [A-Z]+: (.+) \(\d+ open\)$/);
  if (h) comp = h[1];
  const m = line.match(/^\| `((?:rea\.(?:tool|family|prompt)|leanrea)\/[A-Za-z0-9_.-]+)` \|[^|]*(?:\\\|[^|]*)*\| (\d+) \|/);
  if (!m) continue;
  if (listed.has(m[1])) bad.push(`twice ${m[1]}`);
  listed.set(m[1], { phase: Number(m[2]), comp });
}
for (const [k, w] of want) { const l = listed.get(k); if (!l) bad.push(`missing ${k}`); else { if (l.phase !== w.phase) bad.push(`phase ${k}: file ${l.phase}, ledger ${w.phase}`); if (l.comp !== w.comp) bad.push(`section ${k}: file ${l.comp}, ledger ${w.comp}`); } }
for (const k of listed.keys()) if (!want.has(k)) bad.push(`not open ${k}`);
for (const c of Object.keys(COMPONENTS)) console.log(`${c}: ${[...want.values()].filter((w) => w.comp === c).length} open`);
console.log(`open ${want.size}, listed ${listed.size}, problems ${bad.length}`);
for (const b of bad) console.log(b);
process.exit(bad.length ? 1 : 0);'
```

At `bc38202` it prints `open 318, listed 318, problems 0` and exits 0. Changing one row's phase,
moving one row to another section, or deleting one row each makes it exit 1 (tried on Wave 0's file). Rerun it after any
change to the ledger or to the tests' tags, and update this file until it passes.

**Planned: a generator and checker.** Running the check above is manual. A script that writes this
file's key, phase and component columns from the ledger and fails CI when the file is stale (as
`status.ts --check` does for the capability matrix) is a planned work item, GATE in
`BREADTH-COVERAGE.md` (Wave 4, the automated completeness check). Until it exists, this file can
fall behind the ledger between checks; the check above is how to tell.

**Weak points** are tracked separately: 223 of the 244 rows in `../ledger/limitations/` are open
(blocks 41, degrades 150, cosmetic 32). By category, open and blocking: security 30 and 19,
correctness 30 and 10, coverage 32 and 3, tests 20 and 0, state 18 and 2, install 18 and 1, context
16 and 4, scale 14 and 0, governance 12 and 0, enforcement 12 and 0, question 12 and 0, errors 8 and
2, other 1 and 0. They are not listed here; `scripts/status.ts` counts them, and the breadth packages in
`BREADTH-COVERAGE.md` name the ones they target.

## Totals

| Priority | Rows |
|---|---:|
| A, in a breadth package | 36 |
| B, phase 0 or 1, after the gate | 119 |
| C, phase 2 | 89 |
| D, phase 3 or 4 | 33 |
| X, blocked externally | 41 |
| **All open rows** | **318** |


## CLI: Tool surface, CLI and output (4 open)

- **Component status:** PARTIAL_VERIFIED (3 of 7 rows covered).
- **Required implementation:** the error contract (every failure code with category, retryable and remediation, the same code for the same mistake in every operation); batched calls (several operations in one call, each result marked); schema profiles once DMN exposes schemas; the rest of rea's command surface arrives with each component's operations.
- **Dependencies:** FW (done); DMN for REA-C04.
- **Acceptance criteria:** `[+KEY]` and `[-KEY]` tests for REA-C37 and LEAN-C09; every registered failure code has category, retryable and remediation; a batch keeps going past a failing member and reports it; plus the common bar in `MASTER-PLAN.md`.
- **Verification:** `format.test.ts`/`ops.test.ts` style tests on the three lanes; the oracle for the error contract is the registry itself (every code an operation can throw, found by a static scan of `CoreError(` call sites, appears in the table).

| Key | Description | Ph | Owner | Pri | Code today |
|---|---|---:|---|---|---|
| `rea.family/REA-C03` | One-shot CLI, 155 commands; formats toon/json/yaml/md/jsonl; --token-limit, --filter-outp… | 1 | CLI | B | 19 operations, six formats, token limit, filter, --llms (FW) |
| `rea.family/REA-C04` | Schema profiles: input full/compact (HEAD default compact), output full/off | 1 | CLI | B | none |
| `rea.family/REA-C37` | Error contract: 20 codes with category, retryable, remediation | 1 | CLI | A | 3 reax codes on core's error table |
| `leanrea/LEAN-C09` | Batch probes, echo '--- name' markers | 1 | CLI | A | none |


## NAT: Native readers (34 open)

- **Component status:** PARTIAL_VERIFIED (35 of 69 rows covered).
- **Required implementation:** ObjC classes and protocols; Swift demangling and types; dyld resolution; native API, data type, dispatch and load-image views; recorded crashes and Apple IPS; PE certificates (blocked); the PE COFF symbol table; ARM64 `.pdata` (parked); and review of the REA-C07 and REA-C14 family rows, whose named members are all covered.
- **Dependencies:** NAT-2, NAT-3 (done); the rows owned elsewhere (OTH, MOB, ARC, ENG) follow those components.
- **Acceptance criteria:** as MASTER-PLAN NAT-4: each reader equal to `llvm-readobj`/`llvm-objdump` or the format's reference reader on new fixtures; plus the common bar in `MASTER-PLAN.md`.
- **Verification:** answer keys under `bench/oracle/`, re-derived in CI's fixtures job.
- **Note:** Deferred until the breadth gate (D-13), except the x64 `.pdata` defect in EXECUTION-STATE.

| Key | Description | Ph | Owner | Pri | Code today |
|---|---|---:|---|---|---|
| `rea.family/REA-C07` | Native inventory: binary_overview, list_procedures, search_procedures, list_segments, lis… | 1 | NAT | B | all 15 members named in its title covered; family tag not reviewed |
| `rea.family/REA-C12` | Apple/Mach-O static: inspect_macho, inspect_signature, trace_dylib_resolution (dyld path… | 1 | NAT | B | members covered: inspect_macho, inspect_signature |
| `rea.family/REA-C13` | ELF layout and recorded crashes: inspect_binary_layout, inspect_recorded_crash | 1 | NAT | B | member covered: inspect_binary_layout |
| `rea.family/REA-C14` | Go / Rust / PE resources: inspect_go_binary (.go.buildinfo), inspect_rust_binary (cargo-a… | 1 | NAT | B | all three members covered (go, rust, pe resources); family tag not reviewed |
| `rea.family/REA-C45` | HEAD-only formats (+21 tools): PE imports/certificates/load config, native exports, ELF n… | 1 | NAT | B | members covered: PE imports, load config, native exports, ELF notes, model artifact |
| `rea.tool/analyze_swift_types` | (tool of the same name) | 1 | NAT | B | none |
| `rea.tool/demangle_swift` | (tool of the same name) | 1 | NAT | B | none |
| `rea.tool/get_objc_classes` | (tool of the same name) | 1 | NAT | B | none |
| `rea.tool/get_objc_protocols` | (tool of the same name) | 1 | NAT | B | none |
| `rea.tool/inspect_analysis_settings` | (tool of the same name) | 2 | ENG | C | none |
| `rea.tool/inspect_apk_signature` | (tool of the same name) | 1 | MOB | B | none |
| `rea.tool/inspect_apple_ips` | (tool of the same name) | 1 | NAT | B | none |
| `rea.tool/inspect_devicetree` | (tool of the same name) | 1 | OTH | B | none |
| `rea.tool/inspect_erlang_beam` | (tool of the same name) | 1 | OTH | B | none |
| `rea.tool/inspect_gpu_code_objects` | (tool of the same name) | 1 | OTH | B | none |
| `rea.tool/inspect_il2cpp_metadata` | (tool of the same name) | 1 | MOB | B | none |
| `rea.tool/inspect_kernel_module` | (tool of the same name) | 1 | OTH | B | none |
| `rea.tool/inspect_native_api` | (tool of the same name) | 1 | NAT | B | none |
| `rea.tool/inspect_native_data_type` | (tool of the same name) | 1 | NAT | B | none |
| `rea.tool/inspect_native_dispatch_metadata` | (tool of the same name) | 1 | NAT | B | none |
| `rea.tool/inspect_native_load_image` | (tool of the same name) | 1 | NAT | B | none |
| `rea.tool/inspect_pe_certificates` | (tool of the same name) | 1 | NAT | X | blocked: no signed PE sample, no signing tool |
| `rea.tool/inspect_python_pyc` | (tool of the same name) | 1 | OTH | B | none |
| `rea.tool/inspect_recorded_crash` | (tool of the same name) | 1 | NAT | B | none |
| `rea.tool/open_bundle_resources` | (tool of the same name) | 1 | ARC | B | none |
| `rea.tool/trace_dylib_resolution` | (tool of the same name) | 1 | NAT | B | none |
| `rea.tool/update_analysis_settings` | (tool of the same name) | 2 | ENG | C | none |
| `leanrea/LEAN-C05` | Cheap inventory before decompile | 1 | NAT | B | inventory.overview, inventory.native |
| `leanrea/LEAN-C17` | Mach-O one-call inventory: file, lipo, otool -L, exports, imports, strings (≤400), full d… | 1 | NAT | B | inventory.overview, symbols, read.strings (no disassembly to file) |
| `leanrea/LEAN-C25` | Mach-O | 1 | NAT | B | identify.file, inventory.macho |
| `leanrea/LEAN-C27` | ELF / PE | 1 | NAT | B | identify.file, inventory.segments, inventory.pe |
| `leanrea/LEAN-C40` | Strings + imports + exports first; often enough with no disassembly | 1 | NAT | B | read.strings, inventory.native, inventory.symbols |
| `leanrea/LEAN-T07` | NativeAOT / IL2CPP builds are native: use native rows | 1 | NAT | B | none |
| `leanrea/LEAN-T12` | otool labels string literals and stubs inline, "often enough" without a decompiler | 1 | NAT | B | none |


## ARC: Archives and app bundles (14 open)

- **Component status:** NOT_BUILT (core's `archive.list` exists and is tested in `packages/core` only).
- **Required implementation:** `inventory.archive` on core's zip, tar, tar.gz and ASAR listing; plist (XML and binary); later keyed archives, nib, asset catalogs, .app, IPA, APK, AppImage and DMG listing, controlled extraction with quota, and artifact comparison.
- **Dependencies:** FW; SBX before extraction (extraction writes files).
- **Acceptance criteria:** listing equals the oracle on new fixtures; traversal, symlink, bomb and depth tripwires reported, never followed; extraction quota enforced; plus the common bar in `MASTER-PLAN.md`.
- **Verification:** Python's `zipfile`, `tarfile` and `plistlib` (standard library) as the key; `@electron/asar` (dev-only, pinned) for ASAR.

| Key | Description | Ph | Owner | Pri | Code today |
|---|---|---:|---|---|---|
| `rea.family/REA-C17` | Artifact inventory and extraction: inspect_artifact, extract_artifact, compare_artifacts,… | 1 | ARC | B | core archive.list (core tests only) |
| `rea.tool/compare_artifacts` | (tool of the same name) | 1 | ARC | B | none |
| `rea.tool/decode_interface_builder` | (tool of the same name) | 1 | ARC | B | none |
| `rea.tool/extract_artifact` | (tool of the same name) | 1 | ARC | B | none |
| `rea.tool/inspect_artifact` | (tool of the same name) | 1 | ARC | A | core archive.list (core tests only) |
| `rea.tool/inspect_asset_catalog` | (tool of the same name) | 1 | ARC | B | none |
| `rea.tool/inspect_desktop_application` | (tool of the same name) | 1 | ARC | B | none |
| `rea.tool/inspect_keyed_archive` | (tool of the same name) | 1 | ARC | B | none |
| `rea.tool/inspect_plist` | (tool of the same name) | 1 | ARC | A | none |
| `leanrea/LEAN-C19` | Electron one-call: asar extract, package.json name/version/main, JS/.node file list (≤60)… | 1 | ARC | B | none |
| `leanrea/LEAN-C22` | Electron (*.app/Contents/Resources/app.asar) | 1 | ARC | B | none |
| `leanrea/LEAN-C35` | plist / nib / car | 1 | ARC | B | none |
| `leanrea/LEAN-T03` | Native addons sit in app.asar.unpacked/ | 1 | ARC | A | none |
| `leanrea/LEAN-T17` | Info.plist holds bundle id, URL schemes, privacy strings | 1 | ARC | A | none |


## JSE: JavaScript and Electron (20 open)

- **Component status:** NOT_BUILT (core's `js.imports`, `js.endpoints` and `code.obfuscation` probes exist, tested in core only).
- **Required implementation:** source maps with `sourcesContent`; Electron fuses; the needle slicer; then the module graph with resolution status, endpoints, IPC pairing and the security checklist.
- **Dependencies:** ARC's listing for ASAR input; core's JS tokenizer.
- **Acceptance criteria:** fuses equal the oracle's reading of the fuse wire; source map sources equal the map's own `sourcesContent`; the slicer's hits equal a reference search with the same window and cap; plus the common bar in `MASTER-PLAN.md`.
- **Verification:** `@electron/fuses` and Mozilla's `source-map` (dev-only, pinned) as keys; Node's own resolver for the module graph.

| Key | Description | Ph | Owner | Pri | Code today |
|---|---|---:|---|---|---|
| `rea.family/REA-C19` | JS/Electron static analysis: analyze_javascript_application, trace_application_feature, t… | 1 | JSE | B | core js.imports, js.endpoints (core tests only) |
| `rea.tool/analyze_javascript_application` | (tool of the same name) | 1 | JSE | B | none |
| `rea.tool/analyze_web_bundle` | (tool of the same name) | 1 | JSE | B | none |
| `rea.tool/compare_application_versions` | (tool of the same name) | 2 | JSE | C | none |
| `rea.tool/compare_bundles` | (tool of the same name) | 2 | JSE | C | none |
| `rea.tool/compare_javascript_export_shapes` | (tool of the same name) | 2 | JSE | C | none |
| `rea.tool/compare_source_to_bundle` | (tool of the same name) | 2 | JSE | C | none |
| `rea.tool/inspect_electron_fuses` | (tool of the same name) | 1 | JSE | A | none |
| `rea.tool/recover_javascript_sources` | (tool of the same name) | 2 | JSE | C | none |
| `rea.tool/trace_application_feature` | (tool of the same name) | 1 | JSE | B | none |
| `rea.tool/trace_javascript_semantics` | (tool of the same name) | 1 | JSE | B | none |
| `leanrea/LEAN-C20` | Needle slicer across bundle (±250 chars, ≤20 hits) | 1 | JSE | A | none |
| `leanrea/LEAN-C23` | Web bundle / minified JS | 1 | JSE | B | none |
| `leanrea/LEAN-C24` | Hermes / bytenode / V8 | 1 | JSE | B | none |
| `leanrea/LEAN-C43` | JS: native/JS boundary inward (native call → caller class → IPC registration → renderer/p… | 1 | JSE | B | none |
| `leanrea/LEAN-T01` | rg skips hidden/ignored files; bundlers hide code in .webpack/, .vite/; use rg -uu | 1 | JSE | B | none |
| `leanrea/LEAN-T04` | App-specific IPC wrappers hide channel names: grep "ns:verb" strings | 1 | JSE | B | none |
| `leanrea/LEAN-T05` | Fuses gate --inspect / RunAsNode | 1 | JSE | A | none |
| `leanrea/LEAN-T06` | bytenode .jsc cannot be decompiled: use strings and runtime hooks | 1 | JSE | B | none |
| `leanrea/LEAN-T16` | Source maps: sourcesContent holds the original sources | 1 | JSE | A | none |


## MOB: Managed and mobile (29 open)

- **Component status:** NOT_BUILT; REA-C25 (JEB) BLOCKED_EXTERNAL.
- **Required implementation:** .NET metadata (CLI header, ECMA-335 tables) from a PE; Flutter, Hermes and IL2CPP markers in an APK listing; then the APK manifest (binary XML), DEX header and strings, signatures v1 to v3.
- **Dependencies:** NAT's PE reader; core's zip listing (in memory, no extraction) until ARC; a .NET SDK and Android build tools confined to /tmp for fixtures.
- **Acceptance criteria:** metadata tables equal the oracle on a fixture built by the .NET SDK; marker detection equals the archive's actual entries; a non-.NET PE and a damaged table are refused or partial, never invented; plus the common bar in `MASTER-PLAN.md`.
- **Verification:** `System.Reflection.Metadata` in a small checked-in program run under the /tmp SDK; Python `zipfile` for listings.

| Key | Description | Ph | Owner | Pri | Code today |
|---|---|---:|---|---|---|
| `rea.family/REA-C23` | .NET managed: inspect_managed_artifact, inspect_managed_members, compare_managed_members,… | 1 | MOB | B | none |
| `rea.family/REA-C24` | Android/Flutter/Harmony static: inspect_android_package, search_android_classes, inspect_… | 1 | MOB | B | none |
| `rea.family/REA-C25` | JEB client: inspect_jeb_client, open_jeb_project, list_jeb_units, decompile_jeb_item | 2 | MOB | X | blocked: JEB is commercial; no licence or install |
| `rea.tool/compare_managed_members` | (tool of the same name) | 1 | MOB | B | none |
| `rea.tool/decode_android_resources` | (tool of the same name) | 2 | MOB | C | none |
| `rea.tool/decompile_jeb_item` | (tool of the same name) | 2 | MOB | X | blocked: JEB is commercial; no licence or install |
| `rea.tool/identify_flutter_build` | (tool of the same name) | 1 | MOB | B | none |
| `rea.tool/import_managed_reconstruction` | (tool of the same name) | 1 | MOB | B | none |
| `rea.tool/inspect_android_class` | (tool of the same name) | 2 | MOB | C | none |
| `rea.tool/inspect_android_method` | (tool of the same name) | 2 | MOB | C | none |
| `rea.tool/inspect_android_package` | (tool of the same name) | 1 | MOB | B | none |
| `rea.tool/inspect_apktool_client` | (tool of the same name) | 2 | MOB | C | none |
| `rea.tool/inspect_dart_aot` | (tool of the same name) | 2 | MOB | C | none |
| `rea.tool/inspect_jeb_client` | (tool of the same name) | 2 | MOB | X | blocked: JEB is commercial; no licence or install |
| `rea.tool/inspect_managed_artifact` | (tool of the same name) | 1 | MOB | A | none |
| `rea.tool/inspect_managed_members` | (tool of the same name) | 1 | MOB | B | none |
| `rea.tool/inspect_managed_native_boundaries` | (tool of the same name) | 1 | MOB | B | none |
| `rea.tool/list_jeb_units` | (tool of the same name) | 2 | MOB | X | blocked: JEB is commercial; no licence or install |
| `rea.tool/open_jeb_project` | (tool of the same name) | 2 | MOB | X | blocked: JEB is commercial; no licence or install |
| `rea.tool/project_android_application_graph` | (tool of the same name) | 2 | MOB | C | none |
| `rea.tool/project_harmony_application_graph` | (tool of the same name) | 1 | MOB | B | none |
| `rea.tool/project_managed_application_graph` | (tool of the same name) | 1 | MOB | B | none |
| `rea.tool/search_android_classes` | (tool of the same name) | 2 | MOB | C | none |
| `rea.tool/trace_android_references` | (tool of the same name) | 2 | MOB | C | none |
| `rea.tool/verify_managed_native_boundaries` | (tool of the same name) | 1 | MOB | B | none |
| `leanrea/LEAN-C30` | .NET (file: Mono/.Net) | 1 | MOB | A | none |
| `leanrea/LEAN-C31` | Android APK | 1 | MOB | B | none |
| `leanrea/LEAN-C32` | Flutter snapshot hash | 1 | MOB | B | none |
| `leanrea/LEAN-T08` | lib/*/libflutter.so → Flutter (blutter); libhermes.so → React Native/Hermes | 1 | MOB | A | none |


## OTH: Other formats (21 open)

- **Component status:** NOT_BUILT (NAT already reads wasm sections and symbols, untagged for these rows).
- **Required implementation:** SQLite schema (read-only, `-wal` noted); a wasm artifact view; then pcap and HAR metadata, firmware regions, EVM selectors.
- **Dependencies:** FW; SBX before firmware extraction.
- **Acceptance criteria:** schema equals the oracle on a fixture database; a file with a `-wal` sibling says so; a non-database is refused; plus the common bar in `MASTER-PLAN.md`.
- **Verification:** Python's `sqlite3` (standard library) as the key; `llvm-readobj`/`llvm-objdump` for wasm.

| Key | Description | Ph | Owner | Pri | Code today |
|---|---|---:|---|---|---|
| `rea.family/REA-C27` | Firmware: inspect_firmware_regions, extract_firmware | 2 | OTH | C | none |
| `rea.family/REA-C28` | Captures and signals: inspect_pcap_client, inspect_pcap_capture, inspect_packet_capture,… | 2 | OTH | C | none |
| `rea.family/REA-C29` | WASM / EVM / SQLite: inspect_wasm_artifact, compare_wasm_interfaces, inspect_evm_interfac… | 1 | OTH | B | none |
| `rea.tool/compare_wasm_interfaces` | (tool of the same name) | 1 | OTH | B | none |
| `rea.tool/decode_signal_recording` | (tool of the same name) | 2 | OTH | C | none |
| `rea.tool/extract_firmware` | (tool of the same name) | 2 | OTH | C | none |
| `rea.tool/inspect_evm_interface` | (tool of the same name) | 2 | OTH | C | none |
| `rea.tool/inspect_firmware_regions` | (tool of the same name) | 2 | OTH | C | none |
| `rea.tool/inspect_packet_capture` | (tool of the same name) | 2 | OTH | C | none |
| `rea.tool/inspect_packet_fields` | (tool of the same name) | 2 | OTH | C | none |
| `rea.tool/inspect_pcap_capture` | (tool of the same name) | 2 | OTH | C | none |
| `rea.tool/inspect_pcap_client` | (tool of the same name) | 2 | OTH | C | none |
| `rea.tool/inspect_signal_decoders` | (tool of the same name) | 2 | OTH | C | none |
| `rea.tool/inspect_sqlite_database` | (tool of the same name) | 1 | OTH | A | none |
| `rea.tool/inspect_wasm_artifact` | (tool of the same name) | 1 | OTH | A | wasm sections and symbols in NAT readers |
| `leanrea/LEAN-C33` | WASM | 1 | OTH | A | identify.file and NAT readers read wasm |
| `leanrea/LEAN-C34` | SQLite | 1 | OTH | A | none |
| `leanrea/LEAN-C36` | pcap / HAR | 1 | OTH | B | none |
| `leanrea/LEAN-C37` | Firmware | 1 | OTH | B | none |
| `leanrea/LEAN-T09` | SQLite: copy the -wal file too; open read-only | 1 | OTH | A | none |
| `leanrea/LEAN-T14` | Firmware: re-route every extracted binary through the table | 1 | OTH | B | none |


## COD: Code-level analysis (63 open)

- **Component status:** NOT_BUILT.
- **Required implementation:** disassembly of one procedure through the LLVM provider, dumped once to a file and sliced; then xrefs, call graphs, navigation, annotations, comparison and the CLI-engine adapters (rizin, gdb).
- **Dependencies:** ENG (LLVM provider), PM (functions and cache), NAT-3's procedures.
- **Acceptance criteria:** each instruction's address and bytes equal the file's bytes at the procedure's file offset; boundaries match NAT's procedure table; an address outside every procedure is refused; plus the common bar in `MASTER-PLAN.md`.
- **Verification:** differential: the instruction bytes are checked against `read.bytes`, and the mnemonics against the compiler's own `-S` output for the zig fixture sources (a second disassembler when one is installed under /tmp).

| Key | Description | Ph | Owner | Pri | Code today |
|---|---|---:|---|---|---|
| `rea.family/REA-C06` | Hopper-style navigation and bookmarks: current_address, current_procedure, goto_address,… | 2 | COD | C | none |
| `rea.family/REA-C08` | Decompile/disassemble: procedure_pseudo_code, procedure_assembly, batch_decompile, analyz… | 2 | COD | C | none |
| `rea.family/REA-C09` | Xrefs and call relations: xrefs, find_xrefs_to_name, procedure_callers, procedure_callees… | 2 | COD | C | none |
| `rea.family/REA-C10` | Annotation (writes): set_address_name, set_addresses_names, set_comment, set_inline_comme… | 2 | COD | C | none |
| `rea.family/REA-C11` | Native comparison: compare_functions, find_changed_behavior (HEAD adds match_native_funct… | 2 | COD | C | none |
| `rea.family/REA-C15` | CLI-engine adapters: inspect_with_objdump, execute_rizin_command, rizin debug sessions (s… | 2 | COD | C | none |
| `rea.tool/analyze_function` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/annotate_native_function` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/batch_decompile` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/build_call_path` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/close_gdb_session` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/close_rizin_debug_session` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/comment` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/compare_functions` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/current_address` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/current_procedure` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/cutter_command` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/decompile_all` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/execute_rizin_command` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/find_changed_behavior` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/find_xrefs_to_name` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/gdb_console` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/gdb_session_status` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/get_call_graph` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/get_navigation_context` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/goto_address` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/inline_comment` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/inspect_address_context` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/inspect_native_instruction` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/inspect_with_objdump` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/list_bookmarks` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/list_cutter_sessions` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/match_native_functions` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/next_address` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/prev_address` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/procedure_assembly` | (tool of the same name) | 2 | COD | A | none |
| `rea.tool/procedure_callees` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/procedure_callers` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/procedure_pseudo_code` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/procedure_references` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/read_function_instructions` | (tool of the same name) | 2 | COD | A | none |
| `rea.tool/resolve_native_call_targets` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/rizin_debug_command` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/rizin_debug_session_status` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/set_address_name` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/set_addresses_names` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/set_bookmark` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/set_comment` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/set_inline_comment` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/start_gdb_session` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/start_rizin_debug_session` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/trace_call_path` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/trace_feature` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/trace_native_values` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/unset_bookmark` | (tool of the same name) | 2 | COD | C | none |
| `rea.tool/xrefs` | (tool of the same name) | 2 | COD | C | none |
| `leanrea/LEAN-C08` | Dump disassembly once, grep file | 1 | COD | A | none |
| `leanrea/LEAN-C18` | Read one function: awk between labels, filter bl/b./cmp/literal | 1 | COD | A | none |
| `leanrea/LEAN-C26` | Native code logic | 1 | COD | B | none |
| `leanrea/LEAN-C41` | Find a string's user via otool "literal pool for" comments, then the enclosing label | 1 | COD | B | none |
| `leanrea/LEAN-C42` | A C++/libc name in a bl target tells the protocol; read call sequences | 1 | COD | B | none |
| `leanrea/LEAN-C44` | Compare versions: diff inventories before code | 1 | COD | B | none |
| `leanrea/LEAN-C45` | Rebuild: minimal reimplementation, test against original (same inputs/outputs) | 1 | COD | B | none |


## ENG: Engine adapters (3 open)

- **Component status:** NOT_BUILT.
- **Required implementation:** the adapter contract and provider registry; LLVM as the first provider; a missing engine gives a typed error with an install line, never a silent fallback or an install.
- **Dependencies:** SBX (engines run sandboxed), PROC.
- **Acceptance criteria:** contract tests on every lane (availability, version, binary digest, a cancelled run leaves no child); a live LLVM lane in CI; plus the common bar in `MASTER-PLAN.md`.
- **Verification:** the adapter's `llvm-nm` symbol list equals NAT's built-in reader on every fixture (NAT is itself checked against LLVM keys); the binary digest equals `shasum -a 256`.

| Key | Description | Ph | Owner | Pri | Code today |
|---|---|---:|---|---|---|
| `rea.family/REA-C38` | Provider registry and engines: Hopper (macOS/Linux, can be installed after approval), Ghi… | 2 | ENG | C | none |
| `leanrea/LEAN-C14` | Missing tool → row fallback or brew install with consent | 1 | ENG | A | none |
| `leanrea/LEAN-C46` | Install line (brew, npm -g, dotnet tool, cargo install), "only on request" | 1 | ENG | A | none |


## DMN: Daemon, MCP, sessions, jobs (11 open)

- **Component status:** NOT_BUILT (core's MCP handle store is Assay's, not a reax server).
- **Required implementation:** `reax serve` over stdio, then streamable HTTP on loopback with a bearer token; sessions and targets; progress and cancellation; the job model.
- **Dependencies:** FW and the registry; SBX for anything that runs a child.
- **Acceptance criteria:** `tools/list` measured at or under 16 KiB; a non-loopback bind, a missing token and a wrong token are refused; every registered operation is callable; plus the common bar in `MASTER-PLAN.md`.
- **Verification:** the official MCP SDK client (dev-only, pinned) as the conformance oracle.

| Key | Description | Ph | Owner | Pri | Code today |
|---|---|---:|---|---|---|
| `rea.family/REA-C01` | MCP server, stdio default | 1 | DMN | A | core mcp handles (Assay's server, not reax's) |
| `rea.family/REA-C02` | Streamable HTTP transport (opt-in rea mcp --http) | 1 | DMN | A | none |
| `rea.family/REA-C05` | Session and target lifecycle: binary_session, open_binary, close_binary, list_documents,… | 1 | DMN | B | none |
| `rea.family/REA-C33` | Snapshot cache (exact-key reuse across CLI calls; MCP open_binary/close_binary snapshot_p… | 2 | SNAP | C | none |
| `rea.family/REA-C36` | Progress and cancellation | 1 | DMN | B | none |
| `rea.family/REA-C39` | Owned process supervision (Unix groups, Windows Job Objects via Node-API addon) | 1 | PROC | B | core process host kills timed-out trees (REA-A7.2 fixed) |
| `rea.tool/binary_session` | (tool of the same name) | 1 | DMN | B | none |
| `rea.tool/close_binary` | (tool of the same name) | 1 | DMN | B | none |
| `rea.tool/current_document` | (tool of the same name) | 1 | DMN | B | none |
| `rea.tool/list_documents` | (tool of the same name) | 1 | DMN | B | none |
| `rea.tool/open_binary` | (tool of the same name) | 1 | DMN | B | none |


## EVD: Evidence, unknowns, verification (19 open)

- **Component status:** NOT_BUILT (core's evidence store and verifier exist and are exercised by reax's tests, but no reax operation).
- **Required implementation:** `unknown.*` operations (record, update, list paged, verify resolution); then evidence bundles and views, and reconstruction verification and obligations.
- **Dependencies:** FW; core's store.
- **Acceptance criteria:** an unknown is never reported as absent; a paged list reassembles; resolution is verified by core's verifier, not by the caller's word; plus the common bar in `MASTER-PLAN.md`.
- **Verification:** round trip through core's store, with verdicts from core's verifier.

| Key | Description | Ph | Owner | Pri | Code today |
|---|---|---:|---|---|---|
| `rea.family/REA-C30` | Evidence bundles and views: get_evidence_bundle (summary/filters), export_evidence_bundle… | 1 | EVD | B | core evidence store; REA-C30-LIMIT fixed |
| `rea.family/REA-C31` | Residual unknowns: record_unknown, update_unknown, list_unknowns (paged), verify_unknown_… | 1 | EVD | B | none |
| `rea.family/REA-C32` | Reconstruction verification: verify_reconstruction, build_reconstruction_obligation_ledge… | 1 | EVD | B | core verifier (core tests; RX-1/verify-native) |
| `rea.tool/build_reconstruction_obligation_ledger` | (tool of the same name) | 1 | EVD | B | none |
| `rea.tool/evaluate_reconstruction_coverage` | (tool of the same name) | 1 | EVD | B | none |
| `rea.tool/export_evidence_bundle` | (tool of the same name) | 1 | EVD | B | none |
| `rea.tool/get_evidence_bundle` | (tool of the same name) | 1 | EVD | B | none |
| `rea.tool/import_evidence_bundle` | (tool of the same name) | 1 | EVD | B | none |
| `rea.tool/inspect_analysis_view` | (tool of the same name) | 1 | EVD | B | none |
| `rea.tool/list_unknowns` | (tool of the same name) | 1 | EVD | A | none |
| `rea.tool/record_unknown` | (tool of the same name) | 1 | EVD | A | none |
| `rea.tool/update_unknown` | (tool of the same name) | 1 | EVD | A | none |
| `rea.tool/verify_reconstruction` | (tool of the same name) | 1 | EVD | B | none |
| `rea.tool/verify_unknown_resolution` | (tool of the same name) | 1 | EVD | A | none |
| `leanrea/LEAN-C11` | Label claims seen/inferred, cite file:offset or symbol | 1 | EVD | B | Assay probes cite and mark target text (RX-1/assay-probes) |
| `leanrea/LEAN-C12` | Unknown ≠ absent | 1 | EVD | A | none |
| `leanrea/LEAN-C13` | Static ≠ observed execution | 1 | EVD | B | none |
| `leanrea/LEAN-C15` | Turn budget 2–4 calls; stop when every asked item has evidence | 1 | EVD | B | none |
| `leanrea/LEAN-C16` | Do not re-verify | 1 | EVD | B | none |


## SBX: Safety (1 open)

- **Component status:** NOT_BUILT (the untrusted-content envelope and workspace refusal exist under other rows).
- **Required implementation:** the sandbox interface (ADR 0006): macOS `sandbox-exec`, Linux Landlock or bubblewrap, Windows Job Object; network off; `unenforced` where none is available; the effect audit and MCP hints of REA-C34 arrive with DMN.
- **Dependencies:** PROC.
- **Acceptance criteria:** a tripwire child that writes outside its scratch space, opens a socket or exceeds its memory is stopped on each OS lane; a well-behaved child completes; plus the common bar in `MASTER-PLAN.md`.
- **Verification:** the operating system as the oracle: the forbidden file is absent, a listener the test owns records no connection.
- **Note:** Tracked mostly through weak points (security: 30 open, 19 blocking); the one capability row is REA-C34.

| Key | Description | Ph | Owner | Pri | Code today |
|---|---|---:|---|---|---|
| `rea.family/REA-C34` | Effect audit, MCP hints and untrusted marker | 1 | SBX | B | untrusted-content envelope (D-6, RX-1/output-formats) |


## SET: Setup, skill, router (18 open)

- **Component status:** NOT_BUILT (core's `router-pack.json` holds leanrea's router as data, for Assay).
- **Required implementation:** setup, doctor, update and uninstall for agent clients, idempotent, leaving existing configuration intact; the generated skill and prompts (SKL); reference-source import; logging.
- **Dependencies:** DMN (the server a client is pointed at).
- **Acceptance criteria:** install twice equals install once; uninstall restores the original configuration byte for byte; a malformed existing configuration is left untouched and reported; plus the common bar in `MASTER-PLAN.md`.
- **Verification:** only against a temporary HOME; the written files parsed by independent parsers (JSON, Python `tomllib`).

| Key | Description | Ph | Owner | Pri | Code today |
|---|---|---:|---|---|---|
| `rea.family/REA-C40` | Setup / doctor / update / uninstall for 15+ agent clients (Claude Code, Claude Desktop, C… | 1 | SET | B | none |
| `rea.family/REA-C41` | Agent skill reverse-engineer-anything (23,510-byte SKILL.md + references) and 6 MCP promp… | 2 | SKL | C | none |
| `rea.family/REA-C42` | Agent evaluation (closed-claim grading against fixture oracles; npm run verify:agent driv… | 4 | BEN | D | none |
| `rea.family/REA-C44` | Reference-source import (import-reference-source) for comparing older source to artifacts | 1 | SET | B | none |
| `rea.family/REA-C46` | Logging and identity | 1 | SET | B | none |
| `rea.prompt/audit_residual_unknowns` | (tool of the same name) | 2 | SKL | C | none |
| `rea.prompt/compare_application_versions` | (tool of the same name) | 2 | SKL | C | none |
| `rea.prompt/investigate_feature` | (tool of the same name) | 2 | SKL | C | none |
| `rea.prompt/prepare_bounded_process_capture` | (tool of the same name) | 2 | SKL | C | none |
| `rea.prompt/trace_crash` | (tool of the same name) | 2 | SKL | C | none |
| `rea.prompt/verify_reconstruction` | (tool of the same name) | 2 | SKL | C | none |
| `leanrea/LEAN-C01` | Activation by description | 1 | SET | B | none |
| `leanrea/LEAN-C02` | Work on a copy | 1 | SET | B | none |
| `leanrea/LEAN-C03` | Per-target work dir + reuse | 1 | SET | B | none |
| `leanrea/LEAN-C06` | Search hidden trees (rg -uu) | 1 | SET | B | none |
| `leanrea/LEAN-C47` | skills CLI install/update to many agents | 1 | SET | B | none |
| `leanrea/LEAN-C48` | Manual copy or paste into any agent's rules | 1 | SET | B | none |
| `leanrea/LEAN-T02` | zsh expands a bare ==x: quote the echo '--- name' markers | 1 | SET | B | none |


## RUN: Runtime and devices (71 open)

- **Component status:** NOT_BUILT; Frida (REA-C16) and ADB (REA-C26) BLOCKED_EXTERNAL.
- **Required implementation:** process capture and comparison of a test-started process; then Electron/V8 and browser observation of test-started targets, native UI, environment bundles; everything off by default and approval-gated.
- **Dependencies:** SBX, PROC, core's approval queue; SR-12 decided before any observation with network.
- **Acceptance criteria:** zero runtime operations without approval; a PID reax did not start is refused; cleanup after a failure leaves no process; plus the common bar in `MASTER-PLAN.md`.
- **Verification:** a fixture program whose behaviour is fixed by its source: the capture must equal what the source does.

| Key | Description | Ph | Owner | Pri | Code today |
|---|---|---:|---|---|---|
| `rea.family/REA-C16` | Frida runtime instrumentation: 9 tools (list_frida_devices … instrument_with_frida) | 3 | RUN | X | blocked: no fixture device (Frida) |
| `rea.family/REA-C18` | Apple app graph and native UI: project_apple_application_graph, observe_native_ui, trace_… | 3 | RUN | D | none |
| `rea.family/REA-C20` | Browser observation: 14 tools (list_browser_targets, inspect_web_page, observe_web_sessio… | 3 | RUN | D | none |
| `rea.family/REA-C21` | Electron/V8 runtime: list_electron_targets, inspect_electron_page, capture_electron_scena… | 3 | RUN | D | none |
| `rea.family/REA-C22` | Process capture and comparison: capture_process_scenario, compare_process_captures | 3 | RUN | D | none |
| `rea.family/REA-C26` | ADB device ops: 24 tools (list/inspect device, packages, processes, files, logcat, settin… | 3 | RUN | X | blocked: no fixture device (ADB) |
| `rea.family/REA-C43` | Agent environments: environment-serve (replay a recorded web capture as an MCP environmen… | 3 | RUN | D | none |
| `rea.tool/capture_adb_screen` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (ADB) |
| `rea.tool/capture_browser_scenario` | (tool of the same name) | 3 | RUN | D | none |
| `rea.tool/capture_electron_scenario` | (tool of the same name) | 3 | RUN | D | none |
| `rea.tool/capture_native_ui_scenario` | (tool of the same name) | 3 | RUN | D | none |
| `rea.tool/capture_process_scenario` | (tool of the same name) | 3 | RUN | A | none |
| `rea.tool/capture_web_screenshot` | (tool of the same name) | 3 | RUN | D | none |
| `rea.tool/close_frida_session` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (Frida) |
| `rea.tool/collect_adb_bugreport` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (ADB) |
| `rea.tool/compare_process_captures` | (tool of the same name) | 3 | RUN | A | none |
| `rea.tool/compare_web_captures` | (tool of the same name) | 3 | RUN | D | none |
| `rea.tool/compare_web_screenshots` | (tool of the same name) | 3 | RUN | D | none |
| `rea.tool/correlate_static_and_runtime` | (tool of the same name) | 3 | RUN | D | none |
| `rea.tool/discover_webmcp_tools` | (tool of the same name) | 3 | RUN | D | none |
| `rea.tool/export_environment_bundle` | (tool of the same name) | 3 | RUN | D | none |
| `rea.tool/export_web_scripts` | (tool of the same name) | 3 | RUN | D | none |
| `rea.tool/frida_session_status` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (Frida) |
| `rea.tool/inspect_adb_client` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (ADB) |
| `rea.tool/inspect_adb_device` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (ADB) |
| `rea.tool/inspect_adb_display` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (ADB) |
| `rea.tool/inspect_adb_package` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (ADB) |
| `rea.tool/inspect_adb_window` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (ADB) |
| `rea.tool/inspect_electron_page` | (tool of the same name) | 3 | RUN | D | none |
| `rea.tool/inspect_web_event_listeners` | (tool of the same name) | 3 | RUN | D | none |
| `rea.tool/inspect_web_network_capture` | (tool of the same name) | 3 | RUN | D | none |
| `rea.tool/inspect_web_page` | (tool of the same name) | 3 | RUN | D | none |
| `rea.tool/install_adb_package` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (ADB) |
| `rea.tool/instrument_with_frida` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (Frida) |
| `rea.tool/list_adb_devices` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (ADB) |
| `rea.tool/list_adb_directory` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (ADB) |
| `rea.tool/list_adb_features` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (ADB) |
| `rea.tool/list_adb_packages` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (ADB) |
| `rea.tool/list_adb_processes` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (ADB) |
| `rea.tool/list_adb_services` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (ADB) |
| `rea.tool/list_browser_targets` | (tool of the same name) | 3 | RUN | D | none |
| `rea.tool/list_electron_targets` | (tool of the same name) | 3 | RUN | D | none |
| `rea.tool/list_frida_devices` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (Frida) |
| `rea.tool/list_frida_processes` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (Frida) |
| `rea.tool/list_javascript_runtime_targets` | (tool of the same name) | 3 | RUN | D | none |
| `rea.tool/load_frida_script` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (Frida) |
| `rea.tool/observe_javascript_runtime` | (tool of the same name) | 3 | RUN | D | none |
| `rea.tool/observe_native_calls` | (tool of the same name) | 3 | RUN | D | none |
| `rea.tool/observe_native_ui` | (tool of the same name) | 3 | RUN | D | none |
| `rea.tool/observe_web_execution` | (tool of the same name) | 3 | RUN | D | none |
| `rea.tool/observe_web_session` | (tool of the same name) | 3 | RUN | D | none |
| `rea.tool/project_apple_application_graph` | (tool of the same name) | 3 | RUN | D | none |
| `rea.tool/pull_adb_file` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (ADB) |
| `rea.tool/pull_adb_package` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (ADB) |
| `rea.tool/push_adb_file` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (ADB) |
| `rea.tool/read_adb_logcat` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (ADB) |
| `rea.tool/read_adb_setting` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (ADB) |
| `rea.tool/reconcile_javascript_runtime` | (tool of the same name) | 3 | RUN | D | none |
| `rea.tool/resolve_adb_packages` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (ADB) |
| `rea.tool/resume_frida_session` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (Frida) |
| `rea.tool/start_adb_activity` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (ADB) |
| `rea.tool/start_adb_app` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (ADB) |
| `rea.tool/start_frida_session` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (Frida) |
| `rea.tool/stop_adb_app` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (ADB) |
| `rea.tool/trace_native_ui_action` | (tool of the same name) | 3 | RUN | D | none |
| `rea.tool/trace_web_module_imports` | (tool of the same name) | 3 | RUN | D | none |
| `rea.tool/trace_web_source_location` | (tool of the same name) | 3 | RUN | D | none |
| `rea.tool/uninstall_adb_package` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (ADB) |
| `rea.tool/unload_frida_script` | (tool of the same name) | 3 | RUN | X | blocked: no fixture device (Frida) |
| `leanrea/LEAN-C38` | Website | 1 | RUN | B | none |
| `leanrea/LEAN-C39` | Running app / runtime | 1 | RUN | B | none |


## BEN: Benchmark (10 open)

- **Component status:** PARTIAL_VERIFIED (1 of 11 rows covered, plus 11 reax benchmark rows).
- **Required implementation:** the one-cell runner, the context-overhead probe and the MCP sizer, all model-free; then the rea 6.8.0 and leanrea Tier 0 arms and the A1 to A9 validity checks.
- **Dependencies:** DMN (the sizer measures `tools/list`), SET.
- **Acceptance criteria:** no live model runs; the sizer's byte count equals the serialized `tools/list`; plus the common bar in `MASTER-PLAN.md`.
- **Verification:** the fake arm and the committed tasks; byte counts by an independent serializer.

| Key | Description | Ph | Owner | Pri | Code today |
|---|---|---:|---|---|---|
| `leanrea/LEAN-C49` | One-cell runner | 0 | BEN | A | fake-arm harness (RX-0c/bench-harness covered) |
| `leanrea/LEAN-C50` | Full run, arms side by side | 0 | BEN | B | fake arm only |
| `leanrea/LEAN-C51` | Target setup | 0 | BEN | B | none |
| `leanrea/LEAN-C52` | Task electron | 0 | BEN | B | none |
| `leanrea/LEAN-C53` | Task native | 0 | BEN | B | none |
| `leanrea/LEAN-C54` | Task go | 0 | BEN | B | none |
| `leanrea/LEAN-C55` | Task deep | 0 | BEN | B | none |
| `leanrea/LEAN-C57` | Context-overhead probe | 0 | BEN | A | none |
| `leanrea/LEAN-C58` | MCP sizer | 0 | BEN | A | none |
| `leanrea/LEAN-C59` | Committed results | 0 | BEN | B | none |
