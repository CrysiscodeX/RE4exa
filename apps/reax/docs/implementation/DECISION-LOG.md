# Decision log

Newest last. Each entry: the decision, the reason, and what would reopen it.

## D-1 (2026-10-31) All capability families are in scope
The owner's directive resolves the readiness report's four questions: all families, including
phase 2 (engines) and phase 3 (runtime and devices); engines may be installed in development and
isolated CI; the sandbox comes before high-risk engines; phase 3 is in, disabled by default.
**Reopen if** the owner narrows scope.

## D-2 (2026-10-31) Build order follows dependencies, not phases
1. The shared operation framework (paging, output formats, the answer-key pipeline).
2. Built-in readers, which need no engine and no sandbox.
3. The sandbox, before any engine runs on untrusted input.
4. The daemon and MCP, the scheduler and the program model.
5. Engines and code analysis.
6. Runtime and devices.
Benchmark validity runs alongside, once operations exist to measure.

**Why.** Readers raise verified coverage fastest and carry no new attack surface beyond parsing.
Engines widen the attack surface, so they wait for the sandbox (Decision 3).

## D-3 (2026-10-31) Paging is stateless, by offset
List operations take `offset` and `limit` and return `page: {offset, limit, total, next}`. The
target is content-addressed and the result deterministic, so an offset is a valid continuation
token: nothing to store, and nothing to expire.
**Reopen if** a result is non-deterministic or too costly to recompute; that case needs
server-side handles, which arrive with the daemon.

## D-4 (2026-10-31) Every new operation is checked against an independent tool
New readers get an answer key generated from an independent tool (LLVM 18 first; LIEF, WABT,
JADX and others as they arrive), committed, and re-derived in CI's fixtures job, as
`bench/oracle-facts.json` and the LearnHarness corpus already are. Tests on every lane compare
against the committed key, so macOS and Windows need no LLVM.

## D-5 (2026-10-31) No self-installing session hook
Registering a SessionStart hook in `.claude/settings.json` was refused by the session's permission
policy. Node is pinned in `.nvmrc`, and `scripts/dev/setup-node.sh` installs and selects it; the
owner can set it as the cloud environment's setup script.
**Reopen if** the owner enables the hook.

## D-6 (2026-10-31) Output formats, the response budget and their limits
- **Formats.** text (the operation's own), json, jsonl, yaml, markdown and toon, all rendered from
  one result. TOON and YAML are reax's own encoders, so the runtime gains no dependency; the TOON
  reference package and `yaml` are dev-only oracles (pinned, both over two weeks old).
- **YAML** is written to read the same under YAML 1.2 and 1.1: ambiguous strings are quoted;
  C1 controls, U+2028 and U+2029 are escaped; exponent numbers get a decimal point. PyYAML found
  the last two in the fuzz.
- **Envelope.** Target-derived text reaches a model inside `<untrusted-content>` in every format
  except json and jsonl, where it stays inside JSON strings (as `--format json` already did). The
  token limit cuts the body before the envelope is added, so the envelope always closes.
- **Budget.** 1 MiB of JSON data per result (rea: 10 MiB). Common MCP clients cut tool results
  far below 10 MiB, so a smaller budget with a continuation serves them better; it is a parameter
  of `runOperation`. A paged result over budget is shortened and continues at `page.next`; any
  other is refused with `result_too_large`.
- **Ledger.** REA-C35 (budget and continuation) and LEAN-C10 (cap every output) are tagged.
  REA-C03 is not: it also names rea's 155 commands, and reax has 2 operations.
**Reopen if** a client needs a larger budget, or measurement shows TOON costs more tokens than
JSON on reax's results.

## D-7 (2026-10-31) Byte-level operations are not Assay sweep probes
`read.strings`, `read.bytes` and `search.bytes` need an argument to be useful (a search, a range, a
pattern). As sweep probes they would run on every file of a case and store a page of strings per
file. Only `identify.file` and `inventory.native` are swept (`SWEEP_OPERATIONS` in
`src/ops/probes.ts`). The byte-level operations reach agents through the reax CLI now, and through
reax's MCP tools in DMN.
**Reopen if** Assay gains an agent tool that calls reax operations with arguments.

## D-8 (2026-10-31) Extra fixtures, pinned by digest, not rebuilt in CI
The zig corpus has no GNU build ID or property notes and no Go code. `fixtures/extra/` holds:
- a gcc 13.3 binary with both notes;
- a stripped Go 1.24.7 program with a local module dependency, for Linux and Windows.

They total 2.9 MB and are not in the npm package. `scripts/extra-fixtures.ts` records how each
was built, and `--check` pins them by sha256. The answer keys are re-derived from the committed
bytes in CI's fixtures job, so a rebuild (and its toolchain) is never needed to check reax. The
Go key uses Go's own `debug/buildinfo` and `debug/gosym` (`scripts/oracle-go`), with the Go that
GitHub's Ubuntu image provides.
**Reopen if** the repository's size matters more than these checks, or a fixture needs a
rebuild check of its own.

## D-9 (2026-10-31) PE32 load configuration: pefile arbitrates where LLVM 18 differs
In the 32-bit load configuration LLVM 18 reads `ProcessAffinityMask` at 0x2C and `ProcessHeapFlags`
at 0x30; pefile (and the Windows SDK header, as the layout is documented there) has them the other
way round. A synthetic PE32 with a different value in every field (`scripts/pe-synth.ts`) shows
it. reax follows pefile for those two fields; the key stores pefile's reading beside LLVM's and the
test compares those two fields against pefile only. Every other field, in both widths, is compared
with LLVM. Real files almost always hold zero in both, so the choice rarely shows.
**Reopen if** LLVM changes the order, or a signed Windows binary with non-zero values settles it.

## D-10 (2026-10-31) Model files: a stdlib parser is the key, cross-checked once against the packages
The gguf package needs numpy, pyyaml and tqdm, and numpy's wheels differ per platform, so it cannot
be a hash-pinned oracle that runs identically on every machine. The answer key for
`inventory.model` is `scripts/oracle-model.py`, a GGUF and safetensors header parser in Python's
standard library, written from the formats' specifications. It was cross-checked against the gguf
package's `GGUFReader` (`scripts/oracle-model-crosscheck.py`, by hand in a virtualenv) on the three
GGUF fixtures and on a real 5.7 GB Qwen3.5-9B file: 427 tensors, 46 keys, equal in offsets, shapes,
types and sizes. The fixtures themselves are written by the gguf and safetensors packages
(`scripts/model-fixtures.py`), so reax, the key and the writer share no code.
- gguf-py gives `Q8_1` 40 bytes per block; ggml's C struct has 36. The key and reax use 36. The type
  does not occur in model files.
- GGUF version 1 (before August 2023) is reported as unread.
- reax's own reading of the real 9B file equals the key (170 ms, 99 MB resident); that run is by
  hand, as the file is not in the repository.
**Reopen if** the gguf package becomes installable from hashed wheels on every CI platform (then use
it as the key), or a model format reader needs a type this table lacks.

## D-11 (2026-11-01) Rust `.dep-v0`: rust-audit-info is the key, re-derived in CI
The answer key for `inventory.rust` is the JSON that RustSec's rust-audit-info 0.5.4 prints for the
committed fixture. `scripts/oracle-rust.ts` runs it on the fixture bytes and stores the output as
printed in `bench/oracle/rust.json`. CI's fixtures job installs it with
`cargo install --locked --version 0.5.4 rust-audit-info --root /tmp/reax-cargo` and re-derives the
key with `oracle.ts --check`. On the Mac only `oracle.ts rust` writes. Option A, approved by the user.
- The one real fixture is `rust-deps-aarch64-apple-darwin` (Mach-O `__DATA,.dep-v0`). It was built
  with Homebrew rustc 1.99.1 (commit 58cf8f9c35b355199727627d07ae34a4e2846d67), cargo 1.99.1 and
  cargo-auditable 0.7.7, using `--remap-path-prefix` and `cargo auditable build --release --locked`.
  Its sources and `Cargo.lock` are in `fixtures/extra-src/rust-deps`.
- Known gaps:
  - ELF, PE and wasm `.dep-v0` have no real fixture: the host has only the aarch64-apple-darwin std,
    and no cross route has been cleared with the user.
  - wasm is covered only by a synthetic unit test.
  - cargo-auditable 0.7.7 does not record features, so `features` is checked only against a synthetic
    document.
- No committed test exercises ELF, PE or fat Mach-O `.dep-v0`. The reviewer checked them by hand: the
  fixture's real blob was spliced into copies of the zig ELF and PE fixtures with llvm-objcopy, and
  reax matched rust-audit-info; for a lipo'd fat file, reax read the aarch64 slice at the correct
  offset (rust-audit-info refuses fat files).
**Reopen if** a cross route (a /tmp-only rustup, or build-std) is cleared with the user, so ELF and PE
fixtures can be built, or rust-audit-info's output changes for the same bytes.

## D-12 (2026-11-01) Assay sweep: a cost criterion; `inventory.rust` stays out
The D-7 criterion does not exclude `inventory.rust`. It has a read effect and takes only a path, so it
is eligible under the probe rule in `src/ops/probes.ts` (probes still run only if listed in
`SWEEP_OPERATIONS`). D-12 adds a cost criterion. An operation joins the Assay sweep only if, on files
it does not apply to, its p95 is at most `inventory.native`'s p95, and it scans a small, bounded part
of the file. `inventory.rust` is kept out of the sweep on cost:
- On 30 non-Rust files (`fixtures/bin`, the non-Rust `fixtures/extra` files and the LearnHarness
  corpus), its p95 is 0.84 ms; `inventory.native`'s is 0.23 ms over the 25 of those files it accepts.
  `inventory.rust`'s p95 is also 0.84 ms on those 25. The medians are 0.10 ms and 0.07 ms.
- Its marker scan is capped at 8 MiB of read-only data, but can still cover up to 53% of a file
  (811,520 B of the Go PE's `.rdata`).
- Its output is at most 550 B on non-Rust files (median 389 B), and 1688 B on the Rust fixture.

Agents reach it through reax's inventory tool. Nothing in Assay changes.
**Reopen if** the marker scan is limited to a small fixed window, or skipped on files without Rust
evidence, so that its p95 on non-Rust files falls to `inventory.native`'s.

## D-13 (2026-11-01) Breadth first: every component gets a tested first implementation
The user's direction: every component that is not built gets a genuine, tested initial
implementation, at least partial, before deep work resumes on any single component.
- **Partial** means real working functionality with positive and negative tests, green in CI.
  Interfaces and stubs count only as SCAFFOLDED; code in `packages/core` that no reax operation uses
  is a foundation, not status.
- **Status vocabulary.** NOT_BUILT, SCAFFOLDED, PARTIAL_UNVERIFIED, PARTIAL_VERIFIED,
  COMPLETE_UNVERIFIED, COMPLETE_VERIFIED, BLOCKED_EXTERNAL. Each is derived from the ledger's computed
  statuses (`planned`, `partial`, `covered`, `fixed`, `regressed`, `wont`) of the rows that evidence
  the item; the mapping is in `BREADTH-COVERAGE.md`. The ledger schema is unchanged; BLOCKED_EXTERNAL
  lives in `EXECUTION-STATE.md`, not in the ledger.
- **A row is tagged only when its tests cover what the row says.** A first slice that covers less
  gets a narrower reax row (`reax.jsonl`, existing format).
- **Deferred:** the rest of NAT-4 (the PE COFF symbol table, crash dumps). ARM64 `.pdata` is parked
  as a stash with its review findings (`EXECUTION-STATE.md`, **Parked**). Defects in committed
  code are not deferred: the x64 `.pdata` section-bound gap is fixed as a defect.
**Reopen if** the user ends the breadth phase early, or a component cannot reach partial without
deep work on another.

## D-14 (2026-11-01) The breadth waves, and the sandbox before risky parsing and engines
Wave 1: SBX, then ENG with LLVM, and PM. Wave 2: DMN, SCH, COD, RUN, MOB, SET. Wave 3: ARC, JSE, EVD,
OTH, CLI, BEN. Wave 4: the supporting infrastructure, then the breadth gate.
- **SBX moves first.** D-2 put built-in readers before the sandbox. That suited readers that only
  parse in process. The coming packages extract archives, run engines on untrusted input, and start
  processes (ENG, COD, RUN, ARC's extraction), so the sandbox and process
  supervision come before all of them. ARC, which was first in EXECUTION-STATE's previous **Next**
  list, moves to Wave 3.
- **Order inside waves follows dependencies,** which changes two of the user's listed orders:
  DMN runs first in Wave 2 (SET points clients at DMN's server; SCH's first slice can run before it,
  in process); ARC runs first in Wave 3 (JSE reads ASAR through ARC's listing).
- **Early slices that run before a planned dependency:**
  - ENG before SCH: one adapter run at a time, under PROC, with no pools.
  - PM before DMN: `pm.db` is opened by the process that uses it; the daemon becomes its owner in
    Wave 2.
  - MOB before ARC: APK entries are listed in memory with core's zip reader; nothing is extracted.
**Reopen if** a wave's first item cannot reach partial, or the user reorders.

## D-15 (2026-11-01) LLVM is the first engine provider
LLVM 18 is installed on the development machine (Homebrew) and preinstalled on CI's ubuntu-24.04
runners (`/usr/bin/llvm-readobj-18`); the fixtures job installs `llvm-18` only if it is missing, and
the macOS and Windows lanes do not use it. It is the answer key for most of NAT, so its adapter can
be checked against NAT's verified readers
(differential: the adapter's `llvm-nm` list against `inventory.symbols`). It runs as a separate
process under SBX. GPL tools (binutils, gdb) are also only ever run as separate processes, never
linked or imported.
**Reopen if** LLVM's licence terms change for this use, or a second engine is needed for COD's
differential before Wave 2.

## D-16 (2026-11-01) The user's hard limits on the breadth waves
- RUN inspects only processes the tests start. ADB and Frida are BLOCKED_EXTERNAL without a fixture
  device.
- SET is tested only against a temporary HOME.
- BEN runs no live model.
- DMN's MCP server listens on loopback only, and requires a token.
- No system-wide installs: SDKs and tools live under /tmp or a temporary directory; Rust cross
  targets use a rustup confined to /tmp.
**Reopen if** the user lifts a limit.

## D-17 (2026-11-01) MISSING-CAPABILITIES.md is derived from the ledger, by a documented check
It lists every one of the 318 untested rea and leanrea rows by key. A row is listed when it lacks
its `[+KEY]` or `[-KEY]` tag (`scripts/status.ts`'s rule), under the section of the component that
`COMPONENTS` gives its family. A check command in the file exits 1 when the set of listed keys
differs from the untested set, a key is listed twice, a row's phase differs from the ledger's, or a
row sits under the wrong component's section. It does not check the hand-written columns
(description, owner, priority, code today) or the per-component text. Running it is manual for now; a generator with `--check` in CI is planned (GATE, Wave 4).
No generator under `scripts/` changed in Wave 0.
**Reopen when** GATE lands; the file then becomes generated.

## D-18 (2026-11-01) SBX: Landlock through system Python on Linux, sandbox-exec on macOS, fail closed elsewhere
The Orchestrator's decision under the user's no-questions directive.
- **Linux:** Landlock, applied by a small helper that the system `python3 -I` runs. The helper uses
  `ctypes` to set no-new-privileges and restrict itself, then execs the child. No install, no sysctl
  change, no new npm package. bubblewrap is not used: it is not installed, and Ubuntu 24.04's
  AppArmor restriction on unprivileged user namespaces could only be lifted by changing a system
  setting.
- **macOS:** `sandbox-exec` with a deny-default profile; no system setting changed.
- **Windows:** no enforcement yet. Work that requires the sandbox fails closed with the new failure
  code `sandbox_unavailable`, before any process starts.
- The system `python3` is a host tool, not a package dependency. Where it is missing, or Landlock is
  absent, the Linux backend counts as unavailable and the same fail-closed rule applies.
**Reopen if** Landlock's ABI on the ubuntu-24.04 runner is too old for network control (TCP connect
rules need ABI 4).

## D-19 (2026-11-02) SBX gets a fourth review round: a one-time exception to the 3-FAIL rule
The user's decision, in their words: "Option 1, as a one-time exception to the 3-FAIL rule. I'm
granting it, not the loop. … SBX gets a 4th review because the findings narrowed every round, all of
them were in process cleanup, and enforcement passed all three times. There will be no 5th round."
- **Scope:** SBX (Wave 1, item 1) only, and only one extra round. The loop's rule is unchanged: an
  item that fails review three times is parked. The exception sets no precedent; the Task Master,
  the Orchestrator and the agents cannot grant it.
- **Why:** each round's findings were narrower than the last; all were in process cleanup (escaped
  grandchildren, a stale pid signalled after the reap, core's stop path signalling a reaped group);
  enforcement passed in all three reviews.
- **If the fourth review fails:** SBX is stashed with its review history, as ARM64 `.pdata` was, and
  Wave 1 stops until the user decides how to proceed.
**Reopen:** not reopenable by anyone but the user. A fifth round would need a new decision from the
user.

## D-20 (2026-11-02) The D-19 round failed; SBX is parked and Wave 1 stops. The SBX design kept for resumption
**Outcome of D-19.** The fourth review of SBX failed on one blocking finding, B1: the doc comment on
`SandboxResult.timedOut` claimed the whole process tree is killed at the deadline, while a measured
timed-out run can keep an escaped grandchild alive and return the root's own exit code. As the user
instructed, SBX is stashed (`EXECUTION-STATE.md`, **Parked**) and Wave 1 stops. ENG and PM, which
depend on SBX, are not started. The 3-FAIL rule is unchanged. A fifth round, though B1 is a one-line
fix, needs a new decision from the user.

**Design decisions made during SBX**, recorded here so they survive while the code is in the stash:
- **Option 3, process cleanup ownership.** Core's termination barrier is off on POSIX
  (`terminationBarrier: !posix`), so core sends no pid-addressed signal there. reax owns the tree kill,
  and only while the root is unreaped; once the root is reaped, nothing signals its pid or group,
  apart from the documented exit-turn residual. Windows keeps core's barrier.
- **Descendants are listed with `ps -A -o pid=,ppid=`** at kill time. A descendant that escaped its
  group and the snapshot can survive: ADR 0006's known limit.
- **The child's environment is an allowlist**, not the parent's environment minus a denylist.
- **Rejected: a kill gate** (reax vetoing core's tree kills after the reap). Core's
  `setProcessTreeKillGate` replaces a module-private gate, and there is no getter. So reax could not
  compose its gate with one a host process might already have installed; it could only overwrite it.
  Probing the installed gate through `admitProcessTreeKill` would recurse or cause side effects.
- **Core change:** an `onSpawn` hook in the vendored orca process host (`process-spec.ts`,
  `run-process.ts`, its README), with the MIT notice kept and `api-snapshot.txt` updated.
**Reopen when** the user decides on SBX: a fifth round, a redesign, or a different order for Wave 1.

## D-21 (2026-11-02) A review whose only findings are false text gets a narrow confirmation, not a round
The user's decision, in their words: "Option 1. My decision, recorded as D-21: SBX's 4th review passed
every functional and safety criterion, and its only finding was false text. So this is a narrow
confirmation, not a 5th full review. From now on, the same applies to every item: when a review's
only findings are false comments or docs and all functional criteria pass, coding-agent fixes the
text and reviewer-debugger confirms it with a narrow check. That does not count as a round. A finding
in code or tests always counts as a round."
- **The rule, for every item:** if a review passes every functional and safety criterion and its only
  findings are false comments or documentation, the Coding Agent fixes the text and the
  Reviewer-Debugger confirms it with a narrow check. The narrow check is not a review round and does
  not count toward the 3-FAIL rule. Any finding in code or tests counts as a round.
- **SBX now:** B1 (the false `SandboxResult.timedOut` comment) is such a finding, so SBX resumes from
  its stash for a narrow confirmation. This supersedes D-20's outcome; D-20's design record stands.
  The procedure:
  - apply, not pop, the stash selected by its message; drop it only after the commit is pushed and CI
    is green;
  - fix B1, and sweep every SBX text for the same overclaim;
  - narrow check by the Reviewer-Debugger. A FAIL there means: stash again and stop;
  - before the push: core's suite and API snapshot check, Assay's CI check steps as `assay.yml` runs
    them, and reax's checks;
  - the Linux Landlock test fails rather than skips, failures are diagnosed from the logs, and the
    2-same-cause rule applies;
  - the 2-same-cause rule is the user's directive, section 21.5: "If CI fails twice for the same
    cause, stop pushing that work item. Record the failure, and move to another item.";
  - the parity report must show the SBX rows covered on Linux and macOS.
**Reopen if** the user changes the rule, or a narrow check turns out to hide a code or test defect.

## D-22 (2026-11-02) ENG: no ambient sandbox opt-out; `REAX_LLVM_BIN` kept
The Orchestrator's decision under the user's no-questions directive, on the Task Master's
recommendation.
- **`REAX_SANDBOX=allow-unenforced` is dropped.** An ambient environment variable could switch the
  sandbox off for every engine run, which contradicts fail-closed and the requirement that engines run
  inside the sandbox.
  - Engine runs on targets always use `required: true`, so on Windows they fail closed with
    `sandbox_unavailable`.
  - Discovery (`--version`) and the contract tests use an explicit, labelled `required: false`.
  - Any future opt-in must be per call and logged, and would come with DMN's configuration or with
    Windows enforcement.
- **`REAX_LLVM_BIN` is kept** as a public environment variable. It only directs discovery to a
  directory. The binaries found there still run under the sandbox, so it cannot weaken enforcement.
  - Discovery records the resolved absolute path and its digest.
  - Without the variable, discovery uses PATH (`llvm-nm-18`, then `llvm-nm`) and then the fixed
    directory list.
**Reopen if** Windows gains enforcement, DMN brings per-call configuration, or `REAX_LLVM_BIN` is
found to change what runs in a way the sandbox does not cover.

## D-23 (2026-11-02) PM: public names, storage, and no sandbox or engine
The Orchestrator's decision under the user's no-questions directive, on the Task Master's
recommendation (W1-3 work order).
- **Operations:**
  - `session.index` (tool `session`, effect `write`): stores `inventory.symbols` for a target under
    its sha256;
  - `search.symbols` (tool `read`, effect `read`): with no query, the stored symbols paged (the
    read-back); with a query, an FTS5 search, always bound as one quoted phrase.
- **Storage:** `pm.db` under `REAX_HOME`, defaulting to `<home>/.reax`. `OpContext.home` is internal
  (the operation context), not visible to MCP clients.
- **Failure codes:** one new code, `pm_not_indexed`. A store newer than the code reuses core's
  existing `store_schema_newer`.
- **No sandbox and no engine for PM.** It populates from reax's in-process `inventory.symbols`, never
  from llvm-nm, because of llvm-nm's newline-forgery limit (`docs/engines-known-limits.md`). A
  built-in reader starts no child process, so there is nothing to sandbox.
- **Migrations:** reax's own runner over `node:sqlite`, with core's rules: every pending step and the
  version bump in one transaction; a newer store refused unmodified. Not core's `Kernel`: its tables
  and owner lock belong to the store's owner, and that ownership arrives with DMN.
- **Amendment (the same day), the Orchestrator's decision on the Coding Agent's deviation from the
  work order:** `session.index` takes only `{ path }`, with no `arch?`. It indexes every slice of the
  file under its content digest, and each row carries its arch; `search.symbols` returns all slices,
  in order. This keeps `reused` meaningful, because one digest covers the whole file.
- **Amendment (2026-11-02), approved by the Orchestrator:** two more failure codes, both retryable:
  - `pm_busy`: the store stayed locked past its timeout;
  - `pm_target_changed`: the file changed while it was being indexed (the digest re-check).

  `store_schema_newer` is still reused, and `pm_not_indexed` stands.
**Reopen if** DMN takes ownership of `pm.db`, SET needs another default location, or COD needs
engine-derived data in the program model.

## D-24 (2026-11-03) Assay LearnHarness tests: gated per test by platform
The Orchestrator's decision (Wave 2 item 0, work order W2-0), taken when three of the four tests were
found to pass on darwin.
- Each LearnHarness test is gated by platform as well as by `ASSAY_LEARNHARNESS=1`, through one
  helper, `learnharnessSkip()` in `apps/assay/test/helpers.ts`.
- **The sweep test runs on Linux only.** On darwin `plutil` is available, so
  `entitlements.mac.plist` is "available; not run by the sweep", not "unsupported format" or "tool
  missing" (verified by the reviewer's mutation M-b).
- **demo, claims and wrong-commit run on Linux and darwin** (3 of 4 passed on darwin when tried).
- **All four skip on win32** with a stated reason: "cause unknown", because they were never run
  there.
- **Why:** gating all four on darwin would hide three passing tests.
**Reopen if** the sweep's expectations become platform-aware, or the tests are run on Windows (the
skip reason must then state the observed cause, or the gate is lifted).

## D-25 (2026-11-03) DMN on Windows: a named pipe by default, and no ACL
The Orchestrator's decision (Wave 2 item 1, work order W2-1), recorded after the Reviewer-Debugger's
PASS and green CI on `69dde2e`. ADR 0007 (`docs/decisions/0007-daemon.md`).
- **Transport:** a named pipe `\\.\pipe\reax-<32 hex of sha256(lowercased realpath(home))>` by
  default; `--tcp` is opt-in and binds loopback only (`127.0.0.1` or `::1`), as on every platform.
  Rejected: loopback TCP as the Windows default, because every local user can reach it and the token
  would be the only barrier.
- **Enforced and tested on Windows (windows-2025, reax run 41540866637):** O_EXCL creation of the
  lock and the token; token rotation; every authentication refusal; single instance, with pipe
  exclusivity confirmed by CI (the single-instance and racing-start tests passed on windows-2025);
  stale-lock recovery; cleanup.
- **Not enforced (stated limit):** reax sets no ACL (Node has no ACL API, and `src/` runs no host
  tool). The token file inherits the ACL of `REAX_HOME`; the pipe keeps Windows' default DACL; the
  home-safety checks are POSIX-only. Plan §3.3's "pipe ACL to the user's SID" is not met, and **SR-9
  stays open**. The tests print `icacls` for the token file as a diagnostic only.
**Reopen if** Node gains an ACL API, SET or SEC brings a vetted helper, or a user puts `REAX_HOME` on
a shared directory.

## D-26 (2026-11-03) DMN: names, run directory and lock
The Orchestrator's decision (W2-1), recorded after review and CI on `69dde2e`.
- **CLI:** `reax serve [--tcp [--host 127.0.0.1|::1] [--port N]]` (foreground, one JSON ready line
  without the token) and `reax daemon start|ping|status|shutdown`. Rejected: `daemon stop`, `mcp`.
- **Failure codes:** `daemon_running`, `daemon_not_running` (retryable), `daemon_unauthorized`,
  `daemon_bind_refused`, `daemon_home_unsafe`, `daemon_protocol_mismatch`. Malformed frames reuse
  core's `bad_request`.
- **No new environment variable.** `REAX_HOME` selects the home; clients find the daemon through
  `run/endpoint.json`. No variable or flag accepts the token.
- **Layout:** `run/` (0700) with `daemon.oslock`, `daemon.lock`, `daemon.token`, `endpoint.json` and
  (POSIX) `daemon.sock`, as in ADR 0007.
- **Lock:** a node:sqlite owner lock on `run/daemon.oslock` decides. Core does not export
  `takeOwnerLock`, so the technique is reimplemented in reax and core is unchanged. The O_EXCL
  `daemon.lock` and token files, with the pid and endpoint diagnosis, are defence in depth and the
  source of the `recovered` report. `daemon.oslock` is kept after shutdown by design.
- **Test seam:** `DAEMON_HOOKS`, in process only (as PM's `MIGRATE_HOOKS`); no environment seam.
- **Approved deviations from the work order:** the Orchestrator approved the lock design and the
  eight deviations listed in the Coding Agent's report:
  - the raw wire client is a typed fixture, `test/fixtures/daemon-wire.ts` (not `.mjs`);
  - the socket path is cleared after the lock is taken, by its owner only;
  - a pid that is alive, with no endpoint for its instance and a lock older than 10 s, counts as
    `unreachable`;
  - a fallback socket path over 103 bytes is refused with a plain error (no failure code);
  - `daemon.oslock` is created 0600;
  - the token is checked before the protocol version;
  - `--host` or `--port` without `--tcp` is a usage error (exit 2);
  - ADR 0007 was committed as "proposed" and becomes "accepted" once D-25 and D-26 are recorded
    (done with this entry).
- **Caps added by the Coding Agent's own audit** (in ADR 0007): at most 64 sockets at once, refused
  ones still draining included; a permanent server `error` handler; per-connection log lines limited
  to 20 per 10 s; shutdown proceeds after 1 s.
**Reopen if** the MCP slice needs another transport, DMN takes `pm.db`, or auto-start needs an idle
timeout.

## D-27 (2026-11-03) SCH: the job model, limits and dispatch rule
The Orchestrator's decision (Wave 2 item 2, work order W2-2), recorded after the Reviewer-Debugger's
PASS and green CI on `40467bd` (reax run 41565482186). ADR 0008 (`docs/decisions/0008-scheduler.md`).
- **Jobs:** registered operations run as jobs; the class (cheap, medium, deep) comes from
  `Operation.cost`. No operation is added.
- **Caps:** 64 queued per daemon, 16 per connection, 4 running, one slot reserved for cheap work, one
  write job at a time. A full queue is refused with the retryable `job_queue_full`.
- **Dispatch:** round-robin by connection, lowest sequence first within each; no head-of-line blocking
  across classes. An owner's round-robin record lasts for the connection and is dropped in
  `dropOwner`; in-process callers are refused past `MAX_OWNERS` (1024). Each new connection goes ahead
  once, so a stream of short-lived connections can keep delaying a job of an older connection (aging
  is a follow-up).
- **Deadlines** count from the start of the run, not the submit. **Cancellation** is cooperative; an
  operation that resolves is `succeeded` even after a cancel request. A disconnect cancels only that
  connection's jobs.
- **Left out of this slice (the Orchestrator's decision):** retries, job persistence, single-flight by
  cache key, aging and priorities.
**Reopen if** priorities are needed, single-flight arrives (SNAP), memory-aware admission arrives
(POOL), or jobs must survive a restart (XST).

## D-28 (2026-11-03) SCH: `daemon_busy` and the additive job protocol
The Orchestrator's decision (W2-2), recorded after review and CI on `40467bd`.
- **`daemon_busy`:** at the connection cap the daemon sends a retryable busy hello frame instead of
  `daemon_unauthorized`; a close before the hello reply is reported to the client as `daemon_busy`.
  This closes DMN's follow-up (row `RX-DMN/busy`).
- **Job methods** `job.submit`, `job.status`, `job.list`, `job.wait`, `job.result`, `job.cancel`,
  added under protocol version 1 (no version bump), after an authenticated hello. Results are capped
  at 512 KiB.
- **CLI:** `reax daemon run|jobs|cancel`.
**Reopen if** clients need feature negotiation.

## D-29 (2026-11-03) PM: `session.index` takes the `pm.db` write lock without blocking the event loop
The Orchestrator's decision (W2-2), recorded after review and CI on `40467bd`. Amends D-23.
- `session.index` acquires the write lock through `withImmediate`, which is async and cancellable, so
  a lock held by another process does not block the daemon's other connections.
- **Amends D-23's `pm_busy`:** same code, same 5 s budget; only the wait is now non-blocking.
- **No `await` between BEGIN and COMMIT:** a transaction body that returns a promise is refused and
  rolled back.
**Reopen if** the daemon takes ownership of `pm.db`, or another write operation arrives.

## D-30 (2026-11-03) COD's rows on Windows: required platforms narrowed by a recorded deferral, and two numbers in every report
The user's decision (Wave 2 item 3, work order W2-3), relayed by the Orchestrator: option 1 of the
Task Master's feasibility analysis, "with two conditions".
- **The facts it answers.** A row is `covered` only when its `[+KEY]` and `[-KEY]` tests passed on
  every platform it lists (`src/ledger/status.ts`). Every rea and leanrea row lists linux, darwin and
  win32. Under D-22 an engine run on a target fails closed on Windows, so no COD disassembly row can
  pass a positive test there.
- **The decision.** The COD rows of this slice (`rea.tool/procedure_assembly`,
  `rea.tool/read_function_instructions`, `leanrea/LEAN-C08`; `leanrea/LEAN-C18` only if it is built
  honestly) have their required platforms narrowed to linux and darwin. win32 stays in the ledger as a
  recorded deferred platform, naming this decision and the item that would lift it. It is not
  dropped.
- **Condition 1, two numbers.** From now on every report gives rea and leanrea rows as two separate
  numbers: "covered" (passing on every listed platform, deferred ones included) and "tested,
  partial" (with the missing platform named). A row whose platforms are narrowed is never counted as
  covered. The 39 stay "covered" until a row also passes on Windows. The COD rows count only under
  "tested, partial (missing: win32)". This applies to EXECUTION-STATE, the parity report,
  `scripts/status.ts` and the generated `CAPABILITY-MATRIX.md`.
- **Condition 2, Windows engine enforcement.** Windows engine enforcement becomes a planned breadth
  item, SBX-W: Job Object plus AppContainer, through a small pinned helper, with no system-wide
  install. It is placed in Wave 3, as item 0, before the breadth gate (`BREADTH-COVERAGE.md`). Its
  ledger key is `RX-SBX/windows-engines`. It would complete the rows deferred on win32 by this
  decision.
- **The answer key is unchanged.** It still comes from a tool that shares no code with llvm-objdump:
  GNU objdump, run as a separate process. Capstone is excluded because it derives from LLVM's MC
  tables.
- **No D-22 exception.** Engine runs on targets on Windows still fail closed until SBX-W.
- **Mechanism.** The work order W2-3 designs the ledger field (an optional `deferred` with
  platforms, decision and `until`). The `platforms` list is kept as the original. The computed status
  is never `covered` while a deferred platform is missing. The mechanism is recorded as its own
  decision after review.
**Reopen if** SBX-W lands (lift the deferrals; the rows must then pass on win32 to count as covered),
or the user changes the reporting rule.

## D-31 (2026-11-03) ENG: llvm-nm output is framed per run
The Orchestrator's decision (Wave 2 item 3, work order W2-3, Part A), recorded after the
Reviewer-Debugger's narrow PASS and green CI on `681fae9` (reax run 41597961652). Row
`RX-ENG/nm-names`. Closes the newline-forgery limit (`docs/engines-known-limits.md`); the pinned test
is flipped.
- **Framing:** each run passes llvm-nm an unguessable path prefix through `-A`, so every record starts
  with it. A line without the prefix is a continuation and joins the previous name (names with line
  breaks, spaces or control bytes are read exactly).
- **Unframed output** gives `engine_output_invalid`.
- **A name that is not valid UTF-8** makes the result `partial`.
- **Archives** are refused with `bad_request`. Advisory: an archive form that passes the magic check
  (fat Mach-O archive, AIX `<bigaf>`) with no defined symbols returns an empty complete list; nothing
  is forgeable.
- **Answer key:** `bench/oracle/names.json`, new, generated with LLVM 18.1.8 on the Mac and re-derived
  by CI with LLVM 18.1.3 (equal).
**Reopen if** llvm-nm's `-A` output format changes.

## D-32 (PROPOSED, not decided) COD: GNU objdump and GNU readelf as the disassembly key
Proposed in COD Part B (parked; `git stash` "cod-partB WIP (3 reviewer FAILs)"). The answer key
`bench/oracle/disasm.json` comes from GNU objdump and GNU readelf, run as separate processes from
`scripts/` only, never Capstone (D-30). Not recorded as a decision: Part B was not committed or
verified in CI. To be decided when Part B passes review.

## D-33 (2026-11-03) LED: the `deferred` mechanism, as built
The Orchestrator's decision (W2-3 Part A), recorded after review and green CI on `681fae9`. It is the
mechanism D-30 asked for. Row `RX-0b/deferred`.
- **Field:** an optional `deferred {platforms, decision, until}` on a ledger row; `platforms` stays the
  original list.
- **The loader refuses:** an empty `deferred.platforms`; one that is not a subset of the row's
  platforms; one that lists all of them; a malformed `decision`; an unknown `until`; `deferred`
  together with `wont`.
- **The seed** (`scripts/seed-register.ts`) preserves it.
- **Status:** a row is `covered` only when every listed platform, the deferred ones included, passed
  both polarities.
- **Reports** (`scripts/status.ts`, the parity report, `CAPABILITY-MATRIX.md`) print "covered" and
  "tested, partial (missing: …)" as separate numbers.
- **Scope:** it also applies to reax's own rows and to weak points.
- On HEAD no row is deferred yet (the COD rows are in the parked Part B).
**Reopen if** SBX-W lands (D-30), or the user changes the reporting rule.

## D-34 (PROPOSED, not decided) COD: operation names, the dump cache, and refusal doctests
Proposed in COD Part B (parked): the names `read.disassembly` and `search.disassembly`; one dump per
target, cached and re-verified before it is served (every code section, first and last instruction,
no duplicate section; a `cut` dump is never complete); refusals documented by doctests. Not recorded
as a decision for the same reason as D-32.

## D-35 (2026-11-03) COD Part B: one bounded resumption, and the last exception to the 3-FAIL rule
The user's decision, in their words: "COD Part B: one bounded resumption, recorded as D-35. Reason:
Part B is Wave 2's only path to moving a capability row, and round 3's findings were test gaps and
text, not code defects. This is the last exception of this kind. From now on, an item parked after 3
FAILs stays parked until the breadth gate."
- **Scope:** "exactly round 3's findings: the three missing tests (including output that is both
  truncated and reported complete, and a procedure that starts inside an instruction) and the two
  text fixes. No other changes." That is: Yhitcov (`src/cod/disasm.ts:319`), Ycutcomplete (`:228`)
  and Yfirst (`:431`) each get a test that kills its mutant; ADR 0009 names both byte-limited map
  entries (`66 90` and `f348ab`); `search.disassembly`'s description says a hit outside a sized
  procedure has no procedure (null). The CI fixtures step name stays open (`.github` is out of
  scope).
- **On PASS:** pre-push, commit, push, CI including the fixtures job's `oracle.ts --check` of
  `bench/oracle/disasm.json` against CI's binutils 2.42; the stash entry is dropped only after CI is
  green. D-32 and D-34 are then decided on the evidence.
- **On FAIL:** stash again, record it, move on; Part B stays parked until the breadth gate.
- **The rule from now on:** an item parked after 3 FAILs stays parked until the breadth gate. No
  further exception round of this kind (D-19, D-35) will be granted. D-21 (narrow confirmation for
  text-only findings) is unchanged.

## D-36 (2026-11-03) Work orders for parsers of external tool output list the adversarial cases up front
The user's rule, in their words: "every work order for code that parses an external tool's output
lists these adversarial cases up front, and the reviewer gets the same list. The cases: truncated
output; missing sections or records; ambiguous lines (newlines, separators); records split across
lines; entries starting inside another entry; and differences between the local tool version and
CI's."
- **Where:** `WORK-ORDER-TEMPLATE.md` (this directory) has the section; `EXECUTION-STATE.md`'s
  **Hard limits** points to it.
- **How:** for each case the work order names the test that covers it, or the new test to add, or
  why the case cannot arise for that tool (with evidence); the Reviewer-Debugger checks each one and
  mutation-checks the guards.
- **Why:** COD Part B's three FAILs were each one of these cases found late (prefix-only lines split
  across records; a missing section served as complete; a cut dump reported complete; a procedure
  starting inside an instruction).
