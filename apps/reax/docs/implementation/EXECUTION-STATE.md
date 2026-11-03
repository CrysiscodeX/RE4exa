# Execution state

**Restart point.**
1. Run `bash scripts/dev/setup-node.sh`, or put `/opt/nvm/versions/node/v24.22.1/bin` first on PATH.
2. Read this file.
3. Continue with the first package under **Next**.

**Last verified checkpoint: `b2f9be8`** (Wave 2 item 4, the DMN flake fix; see **Wave 2
checkpoint**). CI green: reax run 41633622213 (fixtures, three lanes, parity), tests 41633622047.
Rows (D-30's two numbers): rea and leanrea covered 39 of 357, tested, partial 0 (unchanged); reax's
own rows 49 of 50 tested on every listed platform, tested, partial 0 (`RX-SBX/windows-engines`
planned); weak points 21 of 244 fixed (unchanged). The previous checkpoint was `681fae9` (Wave 2
item 3, COD Part A; reax run 41597961652). The baseline reconciled at `bc38202` is in `BREADTH-COVERAGE.md`.

## Hard limits
These come from the user and outrank any session's memory (a subset is also in DECISION-LOG D-16 and `BREADTH-COVERAGE.md`; this list is the complete one).
- Push only to claude/admiring-volta-uc87nj. No pull requests, tags, releases or npm publish. Never force-push, rebase, reset --hard or git clean.
- No system-wide installs. Toolchains go only under /tmp or the project, pinned.
- Never kill a process this session didn't start, and never by pattern; only by exact verified pid.
- Never read or write the real ~/.claude, ~/.codex, ~/.config, ~/.kube or ~/.reax. Tests use temporary homes.
- ~/.reax: only the Orchestrator checks it, only for existence, with `test ! -e "$HOME/.reax"` at
  checkpoints. Subagents never name the path in any command. The repository's
  `.claude/settings.local.json` denies Read and Edit on ~/.reax as a backstop.
- No live model runs and no API keys. No credential stores or tokens.
- The daemon and MCP listen on loopback or local sockets only, with a token.
- RUN inspects only processes that reax's own tests start. ADB and Frida stay BLOCKED_EXTERNAL.
- Never push a commit that fails the local pre-push checks. After 2 CI failures with the same cause, stop that item.
- The loop: work order, then coding-agent, then reviewer-debugger. After 3 FAILs, park the item. D-21 applies.
  An item parked after 3 FAILs stays parked until the breadth gate: D-35 (COD Part B) was the last
  exception of its kind.
- Work orders follow `WORK-ORDER-TEMPLATE.md` (this directory). Every work order for code that
  parses an external tool's output lists the adversarial cases up front, and the reviewer gets the
  same list (D-36): truncated output; missing sections or records; ambiguous lines (newlines,
  separators); records split across lines; entries starting inside another entry; and differences
  between the local tool version and CI's.
- GitHub research gives ideas only: no copied code, record licences, and GPL tools only as separate processes.
- Each report lists computer-use actions ("none" expected).
- Run-time limits (D-47), in the user's words:
  - Time budgets per pass: coding-agent 60 minutes, reviewer-debugger 30, task-master 15. When an agent passes its budget, ask it for a 3-line status (what is running, which PIDs, when it expects to finish). If it can't finish within 10 more minutes, stop it, record its state in EXECUTION-STATE, and split the item. That doesn't count as a FAIL.
  - Every test command has a hard timeout: node's --test-timeout for each test, plus the Bash tool's timeout for the whole command. No background command runs without an explicit timeout. An agent never waits on a background run longer than its remaining budget.
  - Mutation checks: each work order lists at most 15 mutants, and each mutant runs only the test files that cover the changed code, not the full suite. The full suite runs once at the end.
  - Resuming: an agent is resumed at most once per item. After that, a fresh agent starts from a handoff file in the scratchpad (the work order, every FAIL list, `git diff --stat`, and the open questions).
  - Processes: every agent lists, in its report, the PIDs of the processes it started and confirms that none are still running. Before each commit, you [the Orchestrator] check those PIDs. A survivor is a finding, never something to kill silently.
  - Each item report adds a line: wall time and approximate tokens for each agent.
  - The .claude/agents/ changes take effect in the next session; the Orchestrator applies the rules in this session from now on.

**Incidents against these limits (recorded plainly; none had a lasting effect):**
- W2-3 Part B, Coding Agent: it ran an oracle step by accident that rewrote existing answer keys
  (only the Python version strings in `bench/oracle/strings.json`, `search.json` and
  `entropy.json`), and restored them with `git checkout --` on those three files; verified
  byte-identical afterwards.
- W2-3 Part B, Coding Agent: it once ran `ls ~/.reax` (printed nothing). This breaks the
  "never read the real ~/.reax" limit.
- W2-3 Part B, round-3 Reviewer-Debugger: one command included `ls ~/.reax` by mistake; the
  permission system denied it and nothing was read.
- W2-3 Part B, Coding Agent: it edited `.github/workflows/reax.yml` (out of scope); the Orchestrator
  had it reverted before review. Nothing was committed from it.
- W2-3 Part B (D-35 round), Reviewer-Debugger: it ran `scripts/status.ts` once without `--check`,
  which rewrote `CAPABILITY-MATRIX.md`; the rewrite was byte-identical, so it had no effect.
- W2-6 MOB, round-1 Reviewer-Debugger: it looked up the working directory of an unrelated process
  (pid 22145, a 15-day-old node test from another project) to identify it: inspection of a process
  the session did not start. Nothing was signalled or changed.
- W2-6 MOB, round-2 Reviewer-Debugger: it ran `pgrep -f` once, which scans every process's command
  line; it matched nothing, and the reviewer disclosed it. Both are now forbidden in every brief:
  never inspect a process the agent did not start (no `pgrep -f`, no cwd, command line or
  environment of another process).

## Open follow-ups
The single list of every open follow-up and advisory, gathered from the **Done**, **Parked** and
**Blocked** entries (which keep their detail). Items are open unless marked closed; "closed" is used
only where an entry below already records the closure.
- **NAT-3 / NAT-4 (deferred to after the breadth gate, D-13):**
  - the PE COFF symbol table;
  - `LC_FUNCTION_STARTS` against an oracle: closed by NAT-4 part 4b (`d5285e7`);
  - Rust `.dep-v0` (D-11): no real ELF, PE or wasm fixture; `features` checked only on a synthetic
    document; ELF, PE and fat Mach-O checked by hand only, with no committed test.
- **Wave 1 item 0, x64 `.pdata`:** mutant M6 survives; needs a case with the `.pdata` directory
  partway into its section (the `- (pd.rva - sec.rva)` term).
- **SBX:**
  - A1: the "cannot have been reused" comment on an unreaped root's pid can be wrong (libuv batch
    reaping); defer with `setImmediate` and re-check, or reword;
  - A2: G3 and G4 are unreachable on POSIX and not exercised on windows-2025; add a
    `forceBackend: "none"` deadline test on Windows, or label them Windows-only;
  - `src/errors.ts`: `sandbox_unavailable`'s "nothing was started" is inaccurate on the Landlock
    exit-125 path;
  - escaped-grandchild confinement: prove an escaped grandchild is still sandboxed;
  - the Linux helper as `PR_SET_CHILD_SUBREAPER`;
  - UDP and other non-TCP sockets are not controlled on Linux (Landlock ABI 4);
  - the macOS `mach-lookup` DNS side channel (mDNSResponder reachable; ADR 0006);
  - Windows enforcement (and read restriction, memory limits) not in scope yet;
  - the two pre-push environment notes: closed by W2-0 (`ac70493`).
- **Reporting rule (D-30, the user's):** every report gives rea and leanrea rows as two numbers:
  "covered" (passing on every listed platform) and "tested, partial" (with the missing platform
  named). A row whose platforms are narrowed is never counted as covered. The 39 stay covered. The
  COD rows of W2-3 count only as "tested, partial (missing: win32)". Built as the `deferred` field
  (D-33, `681fae9`); no row uses it on HEAD yet, because COD Part B is parked.
- **SBX-W, Windows engine enforcement** (planned, D-30; Wave 3 item 0; key
  `RX-SBX/windows-engines`): a Job Object plus AppContainer through a small pinned helper, with no
  system-wide install. It would complete the rows deferred on win32 by D-30: procedure_assembly,
  read_function_instructions, LEAN-C08 (and LEAN-C18 if tagged).
- **ENG:**
  - closed by `681fae9` (COD Part A): the `parseNm` newline forgery (framing per run, D-31; the
    pinned test flipped); M16 (an abort after exit 0 now gives `engine_cancelled`, tested);
  - advisory (Part A review): an archive form that passes the magic check (a fat Mach-O archive, AIX
    `<bigaf>`) with no defined symbols returns an empty, complete list; nothing is forgeable;
  - the symlink test's title ("REAX_LLVM_BIN is used first: …") overclaims; reword;
  - two `RX-ENG/contract` tests use the real llvm-nm while the row says "against fake engines";
    retitle the row or retag the tests;
  - the A5 install grep: accepted by the Orchestrator (no action).
- **PM:**
  - P3: test the ROLLBACK in `search.symbols`' `finally`;
  - P3b: the count-and-rows transaction has no deterministic test;
  - P4: test the busy mapping of the version reads in rollback mode (expecting `pm_busy`);
  - the exported mutable test seams (`MIGRATE_HOOKS`, `PM_LIMITS`, `PM_HOOKS`): mark `@internal` or
    freeze;
  - NOHOME is not testable with the fake;
  - closed: bench shim quoting and the Windows `reax.cmd` `REAX_HOME` test (W2-0, `ac70493`); the
    digest race (re-hashing).
- **W2-0:**
  - the NUL refusal in `src/bench/live.ts` has no test of its own;
  - P2c: closed by the content assertion on every lane, but the behavioural kill on Windows (the
    mutant run under `cmd.exe /v:on`) was never run; not proven.
- **DMN:**
  - the 1000 ms refusal deadline is not triggered by any test (backstop; accepted);
  - M18a, M18b and M19b survive as defence-in-depth halves (accepted);
  - the fallback socket path refusal (over 103 bytes) has no failure code;
  - ADR 0007 nit: the no-frame close also applies while stopping and at the 64-socket cap;
  - the Windows ACL limit (D-25, SR-9);
  - later slices: MCP over stdio and HTTP (REA-C01, REA-C02), sessions (REA-C05), jobs, progress and
    cancellation (REA-C36), `tools/list` measured, ownership of `pm.db`;
  - closed by SCH (`40467bd`): `daemon_busy` at the connection cap; the `run/` chmod mutant;
  - closed by W2-4 (`32b13c6`, `b2f9be8`): the macOS flake (a closed peer's slot is freed on
    `'end'`); the ADR 0007 half-close text (W2);
  - a peer that never reads and never closes keeps its slot while below the backpressure threshold
    (no idle timeout); it stays within the 32 cap;
  - on Windows named pipes a half-closing peer also holds its slot until it closes (no half-close on
    pipes; ADR 0007), within the 32 cap; the half-close test is skipped on win32 (W1);
  - surviving harmless mutants of W2-4: destroying at once on `'end'`; the 1 s destroy timer not
    `unref`'d; `dropOwner` moved to `'end'`.
- **SCH:**
  - nothing tests that `dropOwner` forgets the owner's record, or the `MAX_OWNERS` cap; the mutation
    removing `this.#owners.delete(owner)` (`src/sched/scheduler.ts:378`) survives;
  - ADR 0008's Bound says "at most 32 owners ahead"; the tight figure is 31;
  - `test/sched-daemon.test.ts:746` (and :910, :963) restore `PM_LIMITS.busyTimeoutMs` to a literal
    5000, not the saved value;
  - no end-to-end SIGINT or SIGTERM test for `reax daemon run`;
  - the child-`serve` shutdown test cannot prove the job waited in `withImmediate`;
  - aging (or "joins at the back") and priorities are a later slice; single-flight needs SNAP.
- **COD Part B, disassembly** (parked until the breadth gate after the D-35 round's FAIL, the 4th;
  see **Parked**): the three tests (Yhitcov, Ycutcomplete, Yfirst) and the two text fixes are done in
  the stash "cod-partB WIP after D-35 round (4th FAIL; parked to breadth gate)" (stash@{2} since MOB
  was stashed; refer to it by message) but not committed; open: the Yfirst cut-dump bypass (`src/cod/disasm.ts:427-431` in the
  stash: on a cut dump `procedureInsns` returns before the procedure-start check), with its proposed
  fix and a cut-dump test and mutant; advisory Ycomment survives (a comment line before any
  instruction throws TypeError rather than a clean refusal; both refuse); advisory Ylast looks
  unreachable; the CI fixtures step name (`.github` is out of scope); CI against binutils 2.42 never
  ran for Part B. D-32 and D-34 are PROPOSED only.
- **RUN, first slice** (parked until the breadth gate after 3 reviewer FAILs, D-35's rule; see
  **Parked**): round 3's two test gaps (FAIL-1, the "listed twice" guard, `src/run/tree.ts:236-241`
  in the stash; FAIL-2, the "null name means partial" guard, `tree.ts:360`); the ADR 0010 text at
  lines 76-77 (procps-ng repeating a format field is expected, confirmed only by CI's Linux lane, not
  by its docs); the advisory hardening at `tree.ts:181-184` (skip pgid members in the names query
  when `rootRow` is present at exit); Linux behaviour (procps's repeated column, `?` escaping) never
  run, as no CI lane ran RUN; D-37 to D-41 PROPOSED only; a production approval channel (CLI,
  daemon) is a later slice.
- **MOB, first slice** (parked until the breadth gate after 3 reviewer FAILs; see **Parked**):
  round 3's code FAIL (a result over the 1 MiB response budget is refused with `result_too_large`
  instead of returned partial; proposed fix: a running total-characters cap on IPA info and the APK
  manifest, with a note and tests of the serialized size); the untested "two app bundles" note cap
  (`apps.slice`); text nits in `scripts/oracle-mob-crosscheck.py:9` and `src/readers/mobile.ts:270`
  (stash line numbers); D-42 to D-46 PROPOSED only; the `packages/core` `zipEntryData` export (D-43)
  is in the stash, not committed, so assay CI never ran on it.
- **DMN macOS flake:** closed by W2-4 (`32b13c6`, `b2f9be8`; see **Done** and **Known defects**).
- **Parked ARM64 `.pdata` stash** (stash@{4} now; see **Parked**): findings (a), (b) and the advisory (c) open;
  (d) closed for x64 by `175f614`; its oracle entries never confirmed by CI's LLVM 18.1.3.
- **Blocked and BLOCKED_EXTERNAL** (see **Blocked**): PE certificates (no signed sample); Frida
  (REA-C16, 10 rows) and ADB (REA-C26, 25 rows) BLOCKED_EXTERNAL (D-16); JEB (REA-C25, 5 rows)
  BLOCKED_EXTERNAL (no licence; the user has not ruled); the automatic session hook (D-5); the local
  machine's toolchain differences.

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
  - Open within NAT-3's scope (all consolidated under **Open follow-ups**):
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
  - Known gaps (D-11; also under **Open follow-ups**): ELF, PE and wasm `.dep-v0` have no real fixture (the host has only the
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
  - Follow-up (also under **Open follow-ups**): mutant M6 survives. Every case puts the `.pdata` directory at the start of its
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
    environment notes (both closed by Wave 2 item 0, `ac70493`):
    - core's readelf differential test is meant for Linux and skips without readelf; on macOS it
      fails only if Homebrew binutils is on PATH;
    - Assay's LearnHarness tests are Linux-only; CI's check job runs them.
  - The SBX stash is dropped; the ARM64 `.pdata` stash remains.
  - Open advisories and follow-ups (all consolidated under **Open follow-ups**):
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
  - Follow-ups and advisories (all consolidated under **Open follow-ups**):
    - (Closed by `681fae9`, D-31.) **Before COD exposes symbols to callers:** mitigate the newline forgery, for example by
      cross-checking against `--format=just-symbols`, or llvm-readobj JSON for ELF; then flip the
      pinned test.
    - (Closed by `681fae9`.) M16 survives: an abort that arrives after the engine exits 0 is reported as success. Fix with a
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
  - Follow-ups (all consolidated under **Open follow-ups**):
    - P2c: `reax.cmd` without `setlocal` (Windows only). Closed by Wave 2 item 0 (`ac70493`), see
      there for what is and is not proven.
    - P3: test the ROLLBACK in `search.symbols`' `finally` (drop `pm_symbol_fts`, then search
      twice).
    - P3b: the count-and-rows transaction has no deterministic test.
    - P4: test the busy mapping of the version reads in rollback mode (`BEGIN EXCLUSIVE` on a non-WAL
      store, a 200 ms timeout, expecting `pm_busy`).
    - Bench shim quoting (closed by Wave 2 item 0, `ac70493`).
    - The exported mutable test seams (`MIGRATE_HOOKS`, `PM_LIMITS`, `PM_HOOKS`): mark them
      `@internal`, or freeze them.
    - NOHOME is not testable with the fake. The Windows end-to-end test that `reax.cmd` honours
      `REAX_HOME` is closed by Wave 2 item 0 (`ac70493`).
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

- **Wave 2, item 0: platform-correct test gates and bench shim quoting** (`ac70493`; D-24). Work
  order W2-0. No rows move: rea and leanrea 39 of 357, reax 35 of 35; `RX-1/bench-live` gains tests.
  Computer use: none.
  - What changed:
    - core `test/probes-differential.test.ts`: the readelf differential compares only subjects whose
      first four bytes are the ELF magic; a non-ELF subject is reported "skipped, not an ELF file
      (magic cafebabe)". `test/probes-engine.test.ts`: the skip reason names the platform.
    - Assay `test/helpers.ts`: `learnharnessSkip()`, gating per test by platform as well as
      `ASSAY_LEARNHARNESS=1` (D-24).
    - reax `src/bench/live.ts` (`toolsDir`): the sh shim single-quotes the run directory, node path
      and script path; `reax.cmd` starts `@setlocal DisableDelayedExpansion` and doubles `%`; `"`,
      CR, LF and NUL are refused on every platform before anything is written (a stated limit: also
      refused on macOS and Linux); the backslash rewrite is win32-only (it turned `a\b` into `a/b` on
      macOS). `test/fixtures/reax-cmd.d.mts` gained one type line.
    - New `[+RX-1/bench-live]` and `[-RX-1/bench-live]` tests in `test/live.test.ts`, with a
      directory named with `$HOME`, backticks, `$()`, `%CD%`, `!PATH!` and `^&`, run through sh on
      POSIX and through real `cmd.exe /d /v:on` on windows-2025; both passed in CI.
  - CI on `ac70493`, all green: reax run 41521374732 (fixtures, three lanes, parity); tests
    41521374941; assay 41521374728 (check with `ASSAY_LEARNHARNESS=1`: all four LearnHarness tests
    passed on Linux; macos-15 and windows-2025 lanes green).
  - Review: PASS in round 1. The reviewer reproduced A1, A2 (under D-24) and A5 (the full pre-push,
    with binutils on the main PATH and `ASSAY_LEARNHARNESS=1`: exit 0, all 23 steps). Mutations M-a,
    M-b, M-c1, M-c3, M-c4, M-c5 and M-c7 were all killed.
  - Closed follow-ups:
    - PM's bench shim quoting;
    - PM's Windows end-to-end test that `reax.cmd` honours `REAX_HOME`: the windows-2025 test runs
      `reax.cmd` under `cmd.exe` with the caller's `REAX_HOME` set elsewhere, and asserts `pm.db`
      is at exactly `join(run directory, .reax-home)` and the caller's directory stays empty
      (`test/live.test.ts`, checked by the Task Master);
    - SBX's two pre-push environment notes: the local pre-push needs no special PATH or environment
      beyond the oracle steps;
    - PM's P2c (drop `setlocal`): the mutant is killed on every lane by the content assertion that
      the first line of `reax.cmd` is exactly `@setlocal DisableDelayedExpansion` (`test/live.test.ts`,
      in both shim tests). A behavioural kill on Windows (without it, `!PATH!` in the directory name
      would expand under `/v:on`, so `pm.db` would land elsewhere) follows from the test but the
      mutant was never run on Windows; not proven.
  - Advisory (also under **Open follow-ups**): the NUL refusal has no test of its own (the `[-RX-1/bench-live]` test covers `"` and
    LF).

- **Wave 2, item 1: DMN, the daemon, first slice** (`69dde2e`; D-25, D-26; ADR 0007, now accepted).
  **PARTIAL_VERIFIED** on reax's own rows. Work order W2-1. Computer use: none.
  - What it is:
    - `reax serve` (foreground, one JSON ready line) and `reax daemon start|ping|status|shutdown`;
      `src/daemon/{paths,lock,token,protocol,server,client}.ts`, six failure codes in
      `src/errors.ts`. Internal API only: no operation, so the registry, `docs/operations.md` and
      `docs/tools.json` are unchanged.
    - One daemon per `REAX_HOME`: a node:sqlite owner lock on `run/daemon.oslock` decides
      (reimplemented in reax; core does not export `takeOwnerLock`); O_EXCL `daemon.lock` and
      `daemon.token` plus the pid and endpoint diagnosis are defence in depth and the source of the
      `recovered` report.
    - Endpoints: a Unix socket on Linux and macOS (a `TMPDIR` fallback for long paths), a named pipe
      on Windows (D-25), opt-in `--tcp` on `127.0.0.1` or `::1` only, any other host refused before a
      file or socket exists.
    - A per-start token (0600 on POSIX), checked in constant time on every connection's hello; never
      in argv, logs, status, errors or the lock and endpoint files.
    - Bounded resources: refused peers closed within 1 s; reply backpressure with a 1 MiB / 5 s cap;
      pending input capped (UTF-16 code units); 32 connections, 64 sockets; log lines rate-limited
      (20 per 10 s); shutdown proceeds after 1 s.
  - Tests: `test/daemon.test.ts`, `test/daemon-lock.test.ts`, with the independent raw wire client
    `test/fixtures/daemon-wire.ts` and `test/fixtures/umask-serve.mjs`; temporary homes only.
  - CI on `69dde2e`, all green: reax run 41540866637 (fixtures, macos-15, ubuntu-24.04,
    windows-2025, parity); tests 41540866667. Every RX-DMN test passed on all four lanes, including
    win32's single-instance and racing-start tests (pipe exclusivity), auth, loopback, stale-lock and
    lifecycle.
  - Parity report (run 41540866637): darwin 277, linux-fixtures 277, linux 277, win32 275 tests; gate
    passed; `RX-DMN/lifecycle`, `auth`, `single-instance`, `stale-lock`, `loopback` and `token-file`
    all "covered: all required lanes passed + and - tests" (`token-file` names linux and darwin
    only); reax rows 41 of 41 covered; rea and leanrea 39 of 357 (rea 28, leanrea 11); weak points 21
    fixed, unchanged.
  - Rows newly tested: the six RX-DMN rows (reax 35 to 41). No rea or leanrea row moved. Weak points
    SR-9, REA-C01-LIMIT and REA-C02-LIMIT are advanced, not fixed.
  - Review history:
    1. FAIL (code): refused peers were half-closed, so 32 open refused peers locked out the owner.
    2. FAIL (code): an authenticated peer that never read grew the daemon's RSS from 109 to 488 MB
       (no backpressure); (test) the "no listener" check ran after the pid had died.
    3. PASS: all prior fixes reproduced; the DMN tests run three times and once under full CPU load;
       the security mutations killed.
    - Then D-21 text-only fixes (the pending cap counts UTF-16 code units; the wrong-token close
      timing; the stated limit at the connection cap), and a narrow check: PASS.
  - Pre-push on macOS: all 23 steps exit 0 (core, Assay, reax including the oracle steps).
  - Process note: during implementation the Coding Agent stopped, by exact pid only, processes it had
    started itself (a stray smoke-test daemon, hung test runs, children of mutated runs); one first
    kill attempt was denied by the auto-mode check. No other process was touched. `~/.reax` was never
    created.
  - Follow-ups (all consolidated under **Open follow-ups**):
    - At the 32-connection cap the client is told `daemon_unauthorized`, not busy (stated limit in
      ADR 0007). **To fix in SCH**, with a retryable busy code or frame.
    - Test gap: the mutation "remove `run/`'s chmod and loosen its check" survives. **To add in SCH.**
    - The 1000 ms refusal deadline is not triggered by any test (a backstop; accepted).
    - M18a, M18b and M19b survive as the defence-in-depth halves of a two-part check (accepted).
    - The fallback socket path refusal (over 103 bytes) has no failure code.
    - ADR nit: the no-frame close also applies while stopping and at the 64-socket cap; ADR 0007 names
      it only at the 32-connection cap.
    - The Windows ACL limit (D-25, SR-9).
    - Later DMN slices: MCP over stdio and HTTP (REA-C01, REA-C02), sessions (REA-C05), jobs,
      progress and cancellation (REA-C36), `tools/list` measured, ownership of `pm.db`.

- **Wave 2, item 2: SCH, the scheduler, first slice** (`40467bd`; D-27, D-28, D-29; ADR 0008, now
  accepted). **PARTIAL_VERIFIED** on reax's own rows. Work order W2-2. Computer use: none.
  - What it is:
    - `src/sched/scheduler.ts`: registered operations run as jobs; classes from `Operation.cost`;
      64 queued per daemon, 16 per connection, 4 running, one cheap slot reserved, one write job at a
      time; a full queue is refused with the retryable `job_queue_full` (D-27).
    - Dispatch: round-robin by connection, lowest sequence first within each, no head-of-line
      blocking across classes; an owner's round-robin record lasts for the connection (dropped in
      `dropOwner`); in-process callers are refused past 1024 owners.
    - Deadlines count from the start of the run (`job_timeout`, distinct from `job_cancelled`);
      cancellation is cooperative: a queued job never starts, a running job's `AbortSignal` kills a
      sandboxed engine's process tree and rolls back a `pm.db` write; an op that resolves after a
      cancel request is `succeeded`. A disconnect cancels only that connection's jobs; shutdown
      cancels and drains all. No retries, persistence, single-flight or aging.
    - Protocol version 1, additive: `job.submit`, `status`, `list`, `wait`, `result`, `cancel`
      after an authenticated hello; results capped at 512 KiB; CLI `reax daemon run|jobs|cancel`;
      `daemon_busy` at the connection cap (D-28).
    - `session.index` takes the `pm.db` write lock without blocking the event loop (D-29).
    - `serve` installs its signal handlers before printing the ready line (a DMN SIGTERM test had
      flaked once under load with exit `null`).
  - Tests: `test/sched.test.ts`, `test/sched-daemon.test.ts`, `test/daemon.test.ts` (busy, and a
    pre-existing 0755 `run/` made 0700 at `test/daemon.test.ts:545`), with the independent reference
    queue model `test/fixtures/sched-model.ts` (checks the fairness bound at every dispatch; hand
    cases and 50 seeds) and the raw wire client `test/fixtures/daemon-wire.ts`.
  - CI on `40467bd`, all green: reax run 41565482186 (fixtures, macos-15, ubuntu-24.04,
    windows-2025, parity); tests 41565482171. No RX-SCH or RX-DMN test failed or was skipped on any
    lane, Windows engine cancel and timeout included.
  - Parity report (run 41565482186): darwin 311, linux-fixtures 311, linux 311, win32 307 tests; gate
    passed; `RX-SCH/queue`, `cancel`, `timeout`, `protocol`, `write-busy` and `RX-DMN/busy` all
    "covered: all required lanes passed + and - tests"; reax rows 47 of 47 covered; rea and leanrea
    39 of 357 (rea 28, leanrea 11); weak points 21 fixed, unchanged.
  - Rows newly tested: the five RX-SCH rows and `RX-DMN/busy` (reax 41 to 47). No rea or leanrea row
    moved. Weak points AB-P10, LEAN-C05-LIMIT and REA-C36-LIMIT are advanced, not fixed.
  - Deviations from the work order, accepted by the reviewer:
    - the `pm.db` lock holder in tests is an inline node:sqlite child (`writer-worker.ts` is core's
      kernel worker; the order's "(exists)" was wrong);
    - the DMN status-keys assertion includes `jobs`;
    - the wire timeout test holds the 300 ms deadline until `pids.json` appears;
    - the rollback and `afterRead` tests use an in-process `Scheduler`;
    - job times are epoch ms.
  - Orchestrator decisions: single-flight by cache key and aging are left out of this slice
    (follow-ups).
  - DMN follow-ups closed: `daemon_busy` at the connection cap (`RX-DMN/busy`); the `run/` chmod
    mutant is now killed by the pre-existing-0755 test (present at `test/daemon.test.ts:545`).
  - Review history:
    1. FAIL (code and tests): `#finish` deleted an owner's record once it had no live job, so an
       owner keeping one job in flight always went first: starvation, reproduced. The reference
       model shared the flaw; the text (F2) overclaimed "nothing can starve".
    2. PASS: with the round-1 bug put into both scheduler and model at once, the per-dispatch bound
       check alone still failed; S1 to S26 killed; engine root and grandchild pids verified gone after
       cancel and timeout (`job_cancelled` / `job_timeout` with cause `engine_cancelled`).
  - Pre-push on macOS: all steps exit 0.
  - Process note: the Coding Agent stopped, by exact pid, two test-runner processes it had started
    (orphaned by its own script timeout); busy-loop load generators were killed through their own
    handles. Nothing else was touched. `~/.reax` was never created.
  - Follow-ups (all consolidated under **Open follow-ups**):
    - Test gap: nothing tests that `dropOwner` forgets the owner's record, or the `MAX_OWNERS` cap.
      The mutation removing `this.#owners.delete(owner)` (`src/sched/scheduler.ts:378`) survives;
      without that line a long-lived daemon would refuse every submit after 1024 connections.
    - ADR 0008's Bound says "at most 32 owners ahead"; the tight figure is 31.
    - `test/sched-daemon.test.ts:746` (and the other restores, e.g. :910, :963) reset
      `PM_LIMITS.busyTimeoutMs` to a literal 5000, not the saved value.
    - No end-to-end test of SIGINT or SIGTERM for `reax daemon run`.
    - The child-`serve` shutdown test cannot prove the job waited in `withImmediate` (an in-process
      test does).
    - A stream of short-lived connections can keep delaying a job of an older connection: aging (or
      "joins at the back") and priorities are a later slice; single-flight needs SNAP.

- **Wave 2, item 3, Part A: unforgeable llvm-nm framing; deferred platforms and two-number status**
  (`681fae9`; D-30, D-31, D-33). Work order W2-3. This is ENG and LED work done for COD; COD's own
  capability is Part B, which is parked, so COD stays **NOT_BUILT**. Computer use: none.
  - What it is:
    - llvm-nm output is framed per run with an unguessable `-A` path prefix; continuation lines join
      the name; unframed output gives `engine_output_invalid`; a name that is not valid UTF-8 gives
      `partial`; archives are refused with `bad_request` (D-31). Row `RX-ENG/nm-names`.
    - The ledger's optional `deferred {platforms, decision, until}` with its loader refusals, seed
      preservation, and the two-number reports "covered" / "tested, partial (missing: …)" in
      `scripts/status.ts`, the parity report and `CAPABILITY-MATRIX.md` (D-33). Row `RX-0b/deferred`.
      Planned row `RX-SBX/windows-engines` added (D-30).
    - ENG M16 closed: an abort after exit 0 gives `engine_cancelled`, with a test.
  - Answer key: `bench/oracle/names.json`, a new key generated on the Mac with LLVM 18.1.8 and
    re-derived by CI's fixtures job (`oracle.ts --check`, LLVM 18.1.3): equal.
  - CI on `681fae9`, all green: reax run 41597961652 (fixtures, macos-15, ubuntu-24.04, windows-2025,
    parity); tests 41597961651. `RX-ENG/nm-names` passed + and - on linux and darwin; on win32 the
    four engine-based tests skip by design (no sandbox) and the two in-process ones pass.
  - Parity report: darwin 324, linux-fixtures 324, linux 324, win32 320 tests; rea and leanrea
    covered 39 of 357, tested, partial 0. `scripts/status.ts` at HEAD: reax rows 49 of 50 tested on
    every listed platform, 0 partial (`RX-SBX/windows-engines` planned); weak points 21 of 244.
  - Rows newly tested: `RX-ENG/nm-names`, `RX-0b/deferred` (reax 47 to 49 of 50). No rea or leanrea
    row moved.
  - Follow-ups closed: the ENG newline forgery (pinned test flipped); ENG M16.
  - Review history:
    1. FAIL, text only (D-21): the `RX-ENG/nm-names` title claimed archive members give `partial`;
       fixed.
    2. Narrow confirmation: PASS.
  - Advisory: an archive form that passes the magic check (fat Mach-O archive, AIX `<bigaf>`) with no
    defined symbols returns an empty complete list; nothing forgeable (under **Open follow-ups**).

- **Wave 2, item 4: the DMN macOS flake** (`32b13c6`, `b2f9be8`; amendment to D-26). Work order
  W2-4. Computer use: none.
  - Root cause: the daemon freed a connection slot only on the socket's `'close'`, at least one
    event-loop turn after it read the peer's end of stream; a connection accepted in between still
    counted 32 and got `daemon_busy` (macos-15, reax run 41612759551 attempt 1). Evidence: an
    in-process probe gave `daemon_busy` 100 of 100 times without the `'end'` release and 0 of 100
    with it; a trace showed an accept after 32 `'end'` events but before 31 of the 32 `'close'`
    events. It never reproduced naturally (0 of 300).
  - The fix (`32b13c6`): a slot is freed on `'end'`, and the socket gets a 1 s destroy deadline (as
    refused connections do); the 64-socket cap still counts closing sockets; in-process seams
    `DAEMON_HOOKS.onConnClose` and `onAccept`; jobs are still cancelled on `'close'`, at most 1 s
    after `'end'` (D-27 intact). ADR 0007 updated.
  - Tests added: a held `'close'` does not block a new hello; a closed peer frees exactly one slot;
    the 64-socket cap; a half-closed peer that does not read is destroyed and its slot freed; the
    original test's final ping retries only on a `daemon_busy` hello.
  - `b2f9be8`: the half-close test reads the daemon's socket after the hello (not right after the
    client's connect), and is skipped on win32: Windows named pipes have no half-close (libuv
    delivers `'end'` only through its EOF timer while a read is pending). ADR 0007 limits the
    half-close guarantee to Unix sockets and `--tcp`, and says a Windows-pipe peer holds its slot
    like one that stays open, within the 32.
  - CI:
    - `32b13c6`: reax run 41630305393 FAILED on windows-2025 only: the half-close test read the
      daemon's socket (through `onAccept`) right after the client's connect, before the daemon had
      accepted it, so a TypeError at `test/daemon.test.ts:512`. A test race on every platform, seen
      only on Windows (CI failure 1 of this cause). Tests run 41630305410 green.
    - `b2f9be8`, all green: reax run 41633622213 (fixtures, macos-15, ubuntu-24.04, windows-2025,
      parity); tests 41633622047. `RX-DMN/busy` still has 2 + and 3 - tests passing on
      windows-2025.
  - Rows: none new; `RX-DMN/busy` and `RX-DMN/lifecycle` gain tests. reax 49 of 50 covered
    (`RX-SBX/windows-engines` planned); rea and leanrea covered 39 of 357, tested, partial 0.
  - Review history:
    1. FAIL (code): freeing on `'end'` let a half-closed peer that never reads hold a socket outside
       the 32 cap (64 sockets held, no `daemon_busy`); also no 64-socket-cap test, a hook leak, and
       the old final ping still racy.
    2. PASS: the probe left 0 sockets, 32 accepted and 8 `daemon_busy`; 7 mutations killed; jobs
       still cancelled on `'close'` at most 1 s after `'end'`; no reax client half-closes.
       Advisories W1 (Windows pipes) and W2 (ADR text), both addressed by `b2f9be8`, reviewed PASS.
  - Process note: the Coding Agent's first CPU-load loop (zsh) did not stop its busy loops; it
    verified each pid's command line as its own and stopped them by exact pid. Nothing else was
    touched.
  - Follow-ups (under **Open follow-ups**, DMN): a peer that never reads and never closes keeps its
    slot below the backpressure threshold (no idle timeout); a half-closing peer on Windows pipes
    holds its slot; three harmless surviving mutants.

## Active
- **SET, first slice** (Wave 2 item 7, work order W2-7, issued 2026-11-03; not started). `reax
  setup`, `reax doctor` and `reax uninstall` for two clients (Claude Code, Codex), developed and
  tested only against a temporary HOME (the user's constraint: "SET works only against a temporary
  HOME."). Proposed decisions D-48 onwards are in the work order, not decided. RUN and MOB are
  parked (see **Parked**).

## Wave 2 checkpoint
- **Items and commits:**
  - W2-0: `ac70493` (docs `bccf882`).
  - DMN: `69dde2e` (docs `e7f2988`).
  - SCH: `40467bd` (docs `9f5220a`).
  - The user's hard limits and the consolidated follow-ups (docs): `d2800d4`.
  - D-30, COD rows narrowed with win32 deferred, two-number reporting; SBX-W planned (docs): `acb55c9`.
  - COD Part A: `681fae9`.
  - COD Part B: parked after 3 reviewer FAILs, not committed (`git stash`, "cod-partB WIP (3 reviewer
    FAILs)"); resumed under D-35 for one bounded round, which failed review (4th FAIL); parked again
    until the breadth gate (stash "cod-partB WIP after D-35 round (4th FAIL; parked to breadth
    gate)"). Not committed, so no CI.
  - The COD Part A outcome, D-31, D-33 and this checkpoint (docs): `9d486ce`.
  - D-35, D-36 and the ~/.reax rule (docs): `f7160f3`.
  - COD Part B parked after the D-35 round (docs): `2b6c987`.
  - The DMN flake (W2-4): `32b13c6`, then `b2f9be8`.
  - RUN (W2-5): parked after 3 reviewer FAILs, until the breadth gate (D-35's rule); not committed
    (`git stash` "run WIP (3 reviewer FAILs; parked to breadth gate)"), so no CI.
  - D-47, the run-time limits (docs and agent files): `2db83e8`.
  - MOB (W2-6): parked after 3 reviewer FAILs, until the breadth gate; not committed (`git stash`
    "mob WIP (3 reviewer FAILs; parked to breadth gate)", which includes the `packages/core`
    `zipEntryData` export), so no CI.
- **CI per commit, all green in the end; no capacity re-runs in Wave 2; one re-run for a flake:**
  - `ac70493`: reax 41521374732, tests 41521374941, assay 41521374728.
  - `69dde2e`: reax 41540866637, tests 41540866667.
  - `40467bd`: reax 41565482186, tests 41565482171.
  - `9f5220a`: reax 41591538116, tests 41591537790.
  - `681fae9`: reax 41597961652, tests 41597961651.
  - `9d486ce` (docs only): tests 41612759424 green. reax 41612759551 attempt 1 failed: lane
    macos-15 failed on `[-RX-DMN/lifecycle] … a 33rd connection gets daemon_busy and is closed`
    (`test/daemon.test.ts:287-319`; the final ping got `daemon_busy`), and parity failed with it;
    fixtures, ubuntu-24.04 and windows-2025 passed. The failed jobs were re-run once (attempt 2):
    green. A known defect (see **Known defects**), not a capacity re-run; nothing in a docs-only
    commit can cause it. Fixed by W2-4.
  - `32b13c6`: reax 41630305393 failed on windows-2025 only (a test race in the new half-close
    test; see **Done**); tests 41630305410 green. Fixed by `b2f9be8`, not by a re-run.
  - `b2f9be8`: reax 41633622213, tests 41633622047.
- **Review histories:** W2-0 PASS; DMN FAIL, FAIL, PASS (plus a D-21 text fix); SCH FAIL, PASS; COD
  Part A text-only FAIL, narrow PASS; COD Part B FAIL, FAIL, FAIL, parked; D-35 round FAIL, parked
  until the breadth gate; DMN flake FAIL, PASS (and PASS for `b2f9be8`); RUN FAIL, FAIL, FAIL,
  parked until the breadth gate; MOB FAIL, FAIL, FAIL, parked until the breadth gate.
- **Rows:** reax's own rows 35 to 47 at SCH, then 49 of 50 at `681fae9` (`RX-ENG/nm-names`,
  `RX-0b/deferred`; `RX-SBX/windows-engines` planned). rea and leanrea covered 39 of 357, tested,
  partial 0: unchanged through Wave 2. Weak points 21 of 244 fixed: unchanged.
- **Breadth:** DMN and SCH became PARTIAL_VERIFIED; 12 of 34 items PARTIAL_VERIFIED. COD stays
  NOT_BUILT; RUN NOT_BUILT (parked); MOB NOT_BUILT (parked); SET active (W2-7).
- **Incidents:** seven under **Hard limits**: five during COD Part B, two during MOB's reviews.
- **Computer use:** none in Wave 2.
- **Next:** SET (**Active**); SBX-W is Wave 3 item 0. COD Part B, RUN and MOB are parked until
  the breadth gate (D-35's rule).

## Parked
- **MOB, first slice** (Wave 2 item 6, work order W2-6; parked 2026-11-03 after 3 reviewer FAILs,
  until the breadth gate under D-35's rule; not committed, not pushed, so no CI). The work is the
  git stash "mob WIP (3 reviewer FAILs; parked to breadth gate)" (stash@{0} at `2db83e8`; refer to
  it by message); it includes the `packages/core` change (`zipEntryData`, D-43). Work order
  `workorder-w2-6-mob.md` and handoff `handoff-w2-6-mob.md` in the session scratchpad. Proposed
  D-42 to D-46 stay PROPOSED (`DECISION-LOG.md`). BREADTH-COVERAGE's MOB stays NOT_BUILT.
  - What it was: in-memory APK and IPA readers (`inventory.apk`, `inventory.ipa`; zip entries
    through core's `zipEntryData`, no extraction): the binary `AndroidManifest.xml`, `Info.plist`
    in XML and binary form, framework markers. 54 new fixtures. The key `bench/oracle/mob.json`
    from Python's stdlib, equal under Python 3.9.6 and 3.12.13. A third-party cross-check with
    pyaxmlparser 0.3.31 (Apache-2.0; its dependencies lxml 5.3.0 BSD-3, click 8.1.7 BSD-3,
    asn1crypto 1.5.1 MIT) in a hash-locked venv under /tmp, as a separate process: every positive
    APK agrees except `mob-idswap.apk`, where pyaxmlparser matches attributes by name and Android
    by resource id (reax follows Android). Literal tags for `leanrea/LEAN-T08` and
    `leanrea/LEAN-T17` (row text checked to match); with them rea and leanrea would have been
    covered 41. Not verified in CI.
  - Review history (Reviewer-Debugger):
    1. FAIL (code): shared references in a binary plist amplified N by N and crashed
       `inventory.ipa` (RangeError); tags built at run time were invisible to `status.ts`; an
       over-long URL scheme became `""`; no third-party AXML cross-check (judged weak
       independence).
    2. FAIL (code): amplification still possible through non-string or over-long items that did not
       advance the scheme counter (a 105 KB IPA ran V8 out of memory; 200 KB took 26 s); untested
       guards (the 50-note cap, `break outer`, dedup); text overclaims; dependency licences not
       recorded.
    3. FAIL (code): a result over the 1 MiB response budget is refused outright
       (`result_too_large` from `fitPage`, `src/ops/registry.ts:73` and `:81`) instead of returned
       partial: the per-list caps allow 1000 items of 65,536 characters. Repros in
       `/tmp/rv3-mob`: `fan.ipa` (70 KB, 65.5 MB of output), `priv.ipa`, `xml17.ipa` (1.1 MB, 17
       distinct long schemes, no amplification). Proposed fix: a running total-characters cap (for
       example 512 KiB) on IPA info and the APK manifest, items past it omitted with one note,
       tests asserting a partial result whose serialized size is within the budget. Also: the "two
       app bundles" note cap (at most 10, `apps.slice`) is untested; text nits in
       `scripts/oracle-mob-crosscheck.py:9` and `src/readers/mobile.ts:270`. Round 3's extra fixes
       held: an AXML note cap (after a crash on 1M chunks) and a byte-claim limit on binary-plist
       objects (after an overlap case that took 16.8 s and 3.9 GB).
  - Process: round 2 used the one resume; round 3 was a fresh agent from the handoff file (D-47).
    The round-1 and round-2 coding agents did not list their PIDs (a D-47 finding); the round-3
    coding agent did, and the Orchestrator confirmed each gone with `ps -p`. Two incidents against
    **Hard limits** (the round-1 reviewer's cwd lookup of pid 22145; the round-2 reviewer's
    `pgrep -f`); see there. Computer use: none.
  - Cost (approximate): coding round 1 ~30 min, ~246k tokens; round 2 (resume) ~10 min, ~60k;
    round 3 (fresh) ~12 min, ~115k. Reviewers ~13 min, ~117k; ~7 min, ~73k; ~8 min, ~82k.
  - Rows: none moved. rea and leanrea covered 39 of 357, tested, partial 0; reax 49 of 50.
  - To resume after the breadth gate: `git stash apply` the entry by message; add the total-size
    cap with its tests, the `apps.slice` test and the two text fixes; then a full review, and CI
    including assay's (for the core export) and the fixtures job's `oracle.ts --check` of
    `mob.json`.
- **RUN, first slice** (Wave 2 item 5, work order W2-5; parked 2026-11-03 after 3 reviewer FAILs,
  until the breadth gate under D-35's rule: "an item parked after 3 FAILs stays parked until the
  breadth gate"; not committed, not pushed, so no CI). The work is the git stash "run WIP (3 reviewer
  FAILs; parked to breadth gate)" (stash@{1} since MOB was stashed; made at `fbcec73`; refer to it
  by message). ADR 0010 is in
  the stash. Proposed D-37 to D-41 stay PROPOSED (`DECISION-LOG.md`).
  - What it was: `observe.process`, a sandboxed capture of a workspace Node fixture, approval-gated
    and off by default (the CLI and the daemon cannot supply an approval in this slice), and
    `compare.process`. `process_not_owned` before any ps run or signal. The global ps reads pid,
    ppid and pgid only; names are queried only for the root's descendants (`ucomm` on darwin, procps
    `comm` on Linux), framed as `pid=,ppid=,pgid=,<name>=,pid=`.
  - Review history (Reviewer-Debugger):
    1. FAIL: F1 children of a reused root pid in the names query, untested (code and tests); F2
       procps `name <defunct>` not treated as stale (code); F3 macOS `ps -o comm` reads argv[0] (part
       of the command line), switched to `ucomm`; F4 the synthetic-pair doctest title (text).
    2. FAIL (code): a 16-byte `ucomm` holding a newline forged a vanished pid's record, so a tree
       was served complete with fragment names. Fixed by the framed query; names that are not valid
       UTF-8 now give null.
    3. FAIL (tests only; the reviewer judged the code right):
       - FAIL-1: the "listed twice" guard (`src/run/tree.ts:236-241` in the stash) is untested: on
         macOS, member 301 with `ucomm` `" 301\n301 1 300 y"` gives two valid frames for 301; the
         mutant names it "y" (the tree stays partial).
       - FAIL-2: the "null name means partial" guard (`tree.ts:360`) is untested: a member shown
         only as `node <defunct>` gives `complete: true` with a null name under the mutant
         (reachable on Linux).
       - Text: ADR 0010:76-77 says procps-ng's docs allow a format list to repeat a field; unverified.
         It should say "expected; confirmed only by CI's Linux lane".
       - Observation: `tree.ts:181-184`, pgid members of a pid reused within the exit turn could
         still be names-queried (`ucomm` only; the tree is already partial; practically
         unreachable). Harden by skipping pgid members when `rootRow` is present at exit.
       - Fuzz: 22.3M forged names, 0 wrong names, 0 complete trees.
  - Never run: Linux behaviour (procps's repeated column, `?` escaping); no CI lane ran RUN.
  - Process notes: the Coding Agent stopped only its own processes, by exact pid (a manual trial's
    child and grandchild; 14 load loops left running about 3 minutes by a zsh word-split bug). One
    mutant (M15) left a fixture child and grandchild unkilled, relying on the fixtures' own 300 s
    safety exits (`child.mjs:9`, `grandchild.mjs:6`, `scenario.mjs:44`); nobody scanned for them
    afterwards. The Reviewer's in-place mutation was blocked by the permission system; mutations ran
    on scratch copies. Not incidents against **Hard limits** (no process outside the session's own
    was touched), but recorded. Computer use: none.
  - Rows: none moved. reax stays 49 of 50 covered; rea and leanrea covered 39 of 357, tested,
    partial 0. RUN stays NOT_BUILT.
  - To resume after the breadth gate: `git stash apply` the entry by message; add the FAIL-1 and
    FAIL-2 tests (each killing its mutant), the ADR 0010 text fix and the `tree.ts:181-184`
    hardening; then a full review and CI with a Linux lane that runs the capture tests.
- **COD Part B, disassembly** (Wave 2 item 3; parked 2026-11-03 after 3 reviewer FAILs, resumed
  for the one D-35 round, which failed; parked again until the breadth gate; not committed, not
  pushed). The work is the git stash "cod-partB WIP after D-35 round (4th FAIL; parked to breadth
  gate)" (stash@{2} since MOB was stashed, made at `f7160f3`; refer to it by message); it includes round 4's
  three tests and text fixes. The earlier stash "cod-partB WIP (3 reviewer FAILs)" (stash@{3}) is superseded by it; kept,
  not dropped. Scope: an llvm-objdump provider in the sandbox, dumped once and
  sliced; `read.disassembly` and `search.disassembly`; the answer key `bench/oracle/disasm.json` from
  GNU objdump and GNU readelf; rows `rea.tool/procedure_assembly`,
  `rea.tool/read_function_instructions`, `leanrea/LEAN-C08` deferred on win32 (D-30). Its rows are not
  tagged on HEAD.
  - Review history (Reviewer-Debugger):
    1. FAIL (code): LLVM prefix-only lines (`lock` alone before a REX prefix) were counted as
       instructions while coverage said complete (musl `0x100a9e5`, PE `0x14000125a`); the musl and
       PE count gaps (36 and 2) were those prefix-only lines plus one `fwait`, not "data in `.text`";
       test gaps (cache re-verification on serve, B10, combined integrity cases); an overclaiming
       title.
    2. FAIL (code): `verifyDump` did not require every code section (a cache without `.plt` was served
       as complete: 110 of 122); `cut` was conflated with coverage `partial` (a false "ends at the
       cut" note, end checks skipped).
    3. FAIL (tests only; the reviewer found the code correct): three checks have no test, and their
       mutants survive:
       - Yhitcov (`disasm.ts:319`, cache-hit coverage forced to complete: a cut dump read back from
         cache reported complete). Fix: touch the cache file's mtime in the cut test; assert partial
         and a cache hit.
       - Ycutcomplete (`disasm.ts:228`, the guard against a forged header `{cut: true, coverage:
         "complete"}`). Fix: a forgeCache case with that header and no `.plt`, expecting a re-dump
         (122).
       - Yfirst (`disasm.ts:431`, a procedure whose start is inside an instruction). Fix: a procedure
         starting 1 byte inside a multi-byte instruction, expecting `engine_output_invalid`.
       - Text: ADR 0009 says one map entry is byte-limited (two are: `66 90` and `f348ab`);
         `search.disassembly` says each hit names its procedure, but a hit outside a sized procedure
         gets null; the CI fixtures step name was not changed (`.github` is out of scope).
  - What held at round 3: every required mutation killed; forged caches refused (cut and partial
    without the first section; cut and complete; uncut missing the last section or instruction; a
    duplicate section); the key comes from GNU tools only (separate processes, `scripts/` only, no
    Capstone); the `ctx.engine` seam is unreachable in production; existing keys and fixtures
    byte-identical; nothing outside `apps/reax`; the maps are genuine notation differences
    (`MNEMONIC_EQUIV` 7 entries, `BOUNDARY_EQUIV` 1). Its local figures would have been rea and
    leanrea covered 39, tested, partial 3 (missing: win32: procedure_assembly,
    read_function_instructions, LEAN-C08); reax 52 of 53. Not verified in CI.
  - Proposed, not recorded as decisions: D-32 (GNU objdump key) and D-34 (COD names, cache, refusal
    doctests), in `DECISION-LOG.md` as PROPOSED.
  - Resumed (2026-11-03): the user chose one bounded round, D-35 (work order W2-3B-R).
    4. FAIL (code), the D-35 round. The Coding Agent stayed in scope: three tests (Yhitcov,
       Ycutcomplete, Yfirst), each killing its mutant; ADR 0009 names both byte-limited map entries
       (`66 90`, `f3 48 ab`); the `search.disassembly` description says "or null where no sized
       procedure holds it". All checks exited 0 locally; 353 tests, 350 pass, 0 fail; the prior
       mutation set all killed. The fresh reviewer's finding: `src/cod/disasm.ts:427-431` (stash
       line numbers): on a cut dump `procedureInsns` returns before the procedure-start check, so a
       procedure starting inside an instruction is listed from the next boundary, labelled only
       `partial` with the false reason "cut before this procedure's end: only the instructions before
       the cut are listed" (its start instruction is missing too). Reproduced end to end on a copy of
       the hello fixture with main's `.eh_frame` FDE moved from `0x10015c0` to `0x10015c2` (inside
       `mov ebp,esp` at `0x10015c1`): uncut gives `engine_output_invalid`; with `maxOutputBytes` 2048
       it is served `partial`, first item `0x10015c4`. llvm-objdump restarts at symtab symbols, so a
       symbol start is caught as an overlap, but starts that come only from `.eh_frame`, `.pdata` or
       function starts are not; the default cap is 256 MiB, so a large target needs no forged cap.
       This is D-36's case "entries starting inside another entry". Advisory: Ycomment survives (a
       comment line before any instruction throws TypeError rather than a clean refusal; both
       refuse); Ylast looks unreachable. CI against binutils 2.42 never ran for Part B.
    - Outcome (D-35): stashed again and parked until the breadth gate. No rea or leanrea row moved;
      COD stays NOT_BUILT.
  - To resume after the breadth gate: `git stash apply` the D-35-round entry (by message); run the
    start check before the cut return (`if (out.length && out[0]!.addr !== start) invalid(...)`; an
    empty list on a cut dump stays `partial`), with a cut-dump test and its mutant; then a full
    review and CI including the fixtures job's `oracle.ts --check` of `bench/oracle/disasm.json`
    against binutils 2.42. This is the reviewer's proposed fix, not yet reviewed.
- **NAT-4, ARM64 `.pdata`** (parked 2026-11-01 under the breadth rule, D-13; not committed, not
  pushed). The work is the git stash `arm64-pdata WIP (3 reviewer FAILs)` (stash@{4} since MOB was
  stashed; refer to it by message), on `bc38202`, 13 files. Applying it is expected to conflict with `175f614` in
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
  - Open findings, to fix before it is resumed (all consolidated under **Open follow-ups**):
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
Wave 1 is complete; Wave 2 items 0, 1 (DMN) and 2 (SCH) are done; item 3 (COD) Part A is done, and
Part B is parked until the breadth gate after its D-35 round failed review (see **Parked**); item 4
(the DMN macOS flake) is done; items 5 (RUN) and 6 (MOB) are parked until the breadth gate.
The Wave 2 queue, in order:
1. ~~DMN macOS flake~~: done (`32b13c6`, `b2f9be8`; see **Done**).
2. ~~RUN~~: parked until the breadth gate after 3 reviewer FAILs (see **Parked**). RUN inspects
   only processes that its own tests start.
3. ~~MOB~~: parked until the breadth gate after 3 reviewer FAILs (see **Parked**). MOB builds
   static APK and IPA readers only; ADB and Frida stay BLOCKED_EXTERNAL.
4. **SET (Active, work order W2-7).** SET works only against a temporary HOME.
SBX-W is Wave 3 item 0.
The breadth plan in `BREADTH-COVERAGE.md` (waves and dependencies there; D-13, D-14):
1. **Wave 1:** SBX, the sandbox foundation; then ENG, the adapter registry with LLVM as the first
   provider; the program model (PM) beside them.
2. **Wave 2:** DMN, then the scheduler (SCH); COD, RUN, MOB and SET.
3. **Wave 3:** SBX-W (Windows engine enforcement, D-30); ARC, then JSE; EVD, OTH, CLI and BEN.
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
- **DMN macOS flake (closed by `32b13c6` and `b2f9be8`):** `[-RX-DMN/lifecycle] … a 33rd
  connection gets daemon_busy and is closed` (`test/daemon.test.ts:287-319`) failed once on
  macos-15 (reax run 41612759551 attempt 1, commit `9d486ce`, docs only): the final ping got
  `daemon_busy`. Root cause: a closed peer's slot was freed only on `'close'`, a turn after its
  `'end'`; now freed on `'end'` (see **Done**, Wave 2 item 4). CI green on `b2f9be8`.
- Otherwise none beyond the ledgers' weak points (the three Wave 0 defects were fixed by `175f614`;
  see **Done**).

## Lessons kept as rules
- A re-run attempt uploads a second artifact with the same name: `gh run download -n reax-parity`
  can fetch the first attempt's report. Take the parity report of the attempt that passed, by its
  artifact id (`gh api repos/{owner}/{repo}/actions/runs/<run>/artifacts`).
- A cross-check against a system tool first checks which tool it is (`--version`): macOS ships
  different `strings` semantics under the same name.
- A test of a failure path is mutation-checked: remove the fix, and the test must fail
  (the EPIPE test did not, until the pipe was closed before the child wrote).
