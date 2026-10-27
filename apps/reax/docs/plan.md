<!-- The reax plan as approved for execution. Changes after approval are in §14 and in docs/decisions/. -->

# Plan: reax, a clean-room replacement for rea and leanrea (revised after review)

## Context

You asked for **reax**: a complete replacement for rea and leanrea, with nothing left behind, every weak point fixed, and correct, stable and trustworthy architecture. It should capture more meaning, balance load intelligently, and be faster and more accurate. Every limitation must be found and documented.

Your decisions:
- shared `packages/core`, reax at `apps/reax`, Assay switches to reax;
- a clean-room rewrite, with pi-durable's and absurd's lessons built in and leanrea integrated cleanly;
- adapters for every engine, with the focus on open source and research into open replacements for the commercial ones;
- documented breadth first, so nothing is marked done unless it is tested.

You then asked me to evaluate and improve the draft without further questions, using research-backed decisions. Three independent reviews were run, and this revision absorbs them:
1. **Coverage audit:** 44 findings (5 critical), 12 gaps in autonomy and intelligence, and about 50 profile limitations the draft did not address.
2. **Technical verification** against current documentation (October 2026).
3. **Open-source survey:** about 120 candidates, a shortlist of 15, and a list to avoid.

### What the review changed, and why
- **Limitation ids.** The draft cited "L01–L119 / LR-01–LR-90 / 209 rows". Those ids came from research summaries, not from files in the repo. The register is now seeded mechanically from the profiles' own ids, with a test that every profile row is present.
- **Evidence ids.** The draft was self-contradictory. The spec string is part of the observation-id hash (`apps/assay/src/evidence/record.ts:73-86`), so ids cannot be both "byte-identical" and "`reax.claim/1`". Fix: one shared spec, `re4exa.claim/2`, with the app recorded as the producer outside the hash, plus a re-keying migration with an alias table.
- **Concurrency.** The exclusive SQLite lock (`kernel.ts:101-118`, timeout 0) blocks every second connection, worker threads included. Replace it with an owner lease, WAL read connections, one writer thread that commits in bounded batches, and a latency target for the event loop.
- **Completion integrity.** Skipped tests, single-lane results and trivial tests could all have counted as "covered". The gate now merges every CI lane, treats a skip as not run, and requires a positive and a negative test for each row.
- **Platform and protocol facts, all verified:**
  - MCP is now at **2026-07-28**: no `initialize` handshake or sessions, `server/discover`, sampling deprecated, tasks moved to an extension.
  - Node 22 reaches end of life on 2027-04-30, and `node:sqlite` is a release candidate only from **Node 24.15**.
  - bubblewrap fails by default on Ubuntu 24.04 (AppArmor setting `apparmor_restrict_unprivileged_userns`).
  - Landlock and seccomp need an exec helper.
  - The `macos-14` CI image retires on 2026-11-02.
  - Ghidra 12.2 needs JDK 25.
  - hermes-dec is AGPL and unicorn is GPL.
  - LIEF has no Node binding.
  - yara-x ships an official wasm build.
- **Families with no phase** (setup, prompts, environments, reference import, Hopper navigation, native UI, sigrok, EVM, CLI formats, verification) now each have a landing (§8).
- **Autonomy and intelligence** were missing. Added: an investigation planner, a next-step recommender, capability detection, full-text and semantic search, deterministic summaries, an optional local model, knowledge reuse across targets, watch and batch modes, and reports (§5).
- **Write-back** is limited to **annotations** (rename, retype, comment, bookmark), with set semantics and a read-back check. Byte-level modification of binaries is out of scope.

**Scale, stated plainly.**
- rea is about 352k production lines.
- reax reproduces rea's **behaviour contract** and **capability coverage**, not its line count. It does so through deep built-in readers plus open engines behind one adapter contract, exposed as a small set of tools.
- The ledger keeps the long tail visible.
- **The first execution delivers Phases 0a–0c.** Each later phase is committed only on a green gate.

## 0. Baseline decisions (with evidence)
- **Runtime:** Node **≥ 24.15**, tested on 24 and 26 (Node 26 becomes LTS on 2026-10-28). Assay moves to the same floor.
  - Release jobs use npm ≥ 11.5.1, which trusted publishing needs.
- **MCP protocol:**
  - Serve **2026-07-28 and 2025-11-25**, on the official TypeScript SDK v2 (`@modelcontextprotocol/server`, Apache-2.0, two dependencies). The SDK's client also runs in CI as a conformance oracle.
  - Do not build approvals or models on sampling or elicitation. The daemon's approval queue and job handles stay authoritative.
- **Licence:** reax and core are Apache-2.0, with NOTICE files. GPL, LGPL and AGPL tools run **only as separate processes**, are never linked, and are listed in `third-party.md`.
- **Client limits as design inputs.** Claude Code warns at 10k tokens, caps at 25k, and saves any text over 50,000 characters to a file. Error text over about 11k characters is cut. HTTP fails above 16 MiB. So:
  - `inventory` stays under 10k tokens and 50k characters;
  - error text stays under 8k characters;
  - more detail is reached through handles and `resource_link`.

## 1. Discovery and the limitation register
- **Seeding from the profiles, mechanically.** `apps/reax/scripts/seed-register.ts` extracts every row from the profiles' own sections, and a test fails if any profile row is missing from the register:
  - rea profile §3.1, §9A–9D and §10, plus the "Limits" column of the capability table (ids such as `REA-A1.1`, `REA-ISS-723`, `REA-9C-*`, `REA-Cnn-limit`);
  - leanrea profile §9 (`LEAN-A-*`, `LEAN-9B-*`, `LEAN-9C-*`, `LEAN-Cnn-limit`, the traps).
- **Donor rows.** Core inherits pi-durable, absurd, Orca and T3 Code code paths, so their known problems get rows (`PD-*`, `AB-*`, `OR-*`, `T3-*`):
  - pi-durable §9: a non-UNIQUE request id, one-way migrations, no retention API, a missing tarball licence;
  - absurd: event payloads never consumed, clock skew, the watchdog killing the whole process, unbounded checkpoint growth, non-atomic migrations;
  - Orca: liveness confused with turn state, no enforcement of overlapping work;
  - T3 Code: telemetry on by default.
- **reax's own rows (`RX-*`)** are generated from every `wont`, skip, unenforced sandbox and partial-coverage limit, and published with each release.
- **Four methods for finding new rows (`N-*`):**
  1. A behaviour audit of rea **6.8.0 pinned**, run in a container with Node 24. A separate spec agent records observed behaviour only.
  2. Issue mining (`tools/mine-issues.ts`).
  3. The adversarial checklist (`docs/audit/adversarial.md`).
  4. Differential tests against oracle tools: LIEF in Python, llvm-readobj, llvm-dwarfdump, llvm-pdbutil, Ghidra, JADX and WABT.
- **Layout.** One YAML file per family: `apps/reax/docs/ledger/limitations/<category>.yaml` and `ledger/parity/<family>.yaml`. A generated aggregate means parallel work never conflicts on one big file.
- **Fields per row:**
  - id, source, category, title, evidence;
  - severity, kind (design or accident);
  - fix, acceptance tests (positive and negative), platforms and engines;
  - status, computed only.

## 2. Completion integrity (status cannot be hand-claimed)
- **Every lane is collected.** `apps/reax/scripts/parity-check.ts` runs as a CI aggregation job:
  - It collects the JUnit reports from every lane: Linux, macOS, Windows and the real-engine lane.
  - A skipped, todo or missing test counts as **not run**.
- **What "covered" means.** A row is `covered` only when, on its declared platforms and engines:
  - at least one positive test and one negative or limit test, each tagged with the row id, passed;
  - the operation is documented in the generated `docs/operations.md`;
  - that page's examples ran as doctests.
- **Status values:** `planned`, `partial`, `covered`, `fixed`, `regressed`, and `wont`. A `wont` needs a reason and a reviewer.
- **Statuses are computed, never edited.** The script rewrites them, and CI fails on drift. It also fails if:
  - a row links a test that doesn't exist;
  - a test is tagged with an unknown row;
  - an operation in the registry has no row (no orphans).
- **Mutation testing has a floor in core.** Trivial tests cannot make a row look covered.
- **Published summary:** `docs/parity.md`, in the form "N of 229 rea tool names covered…".

## 3. Architecture

### 3.1 Core extraction
- **Workspace setup:**
  - root `package.json` with npm workspaces, and `tsconfig.base.json` with project references;
  - `packages/core` takes Assay's kernel, evidence, probes, verifier, policy, mcp, vendored process host and errors;
  - `export/` moves too, and is made to stream.
- **Six known blockers, and their fixes:**
  - Move `ApprovalView` into core.
  - `defineFailureModes()` makes the error table extensible.
  - Inject the spec, prefix and server name as parameters.
  - Replace the hard-coded untrusted-output list with an `untrustedOutput` flag on each tool.
  - Pass in an explicit `packageRoot` instead of module-relative paths.
  - Build each package separately.
- **Evidence ids (ADR 0004).** One shared spec, `re4exa.claim/2`. The producing app sits outside the hash. A migration re-keys `assay.claim/1` rows and keeps an alias table from old to new ids. Golden vectors pin the ids.
- **Migrations are namespaced:** core vN, the program model vK, and each app vM.
  - The store is backed up automatically before any migration. Downgrading is possible only through export and import.
  - A CI matrix opens every earlier version's fixture store and bundle.
- **API stability.** A diff of core's `.d.ts` files is checked in CI.
- **The process host stops needing `ps`.** On Linux it reads `/proc`; on macOS it uses `sysctl`/`proc_listpids`. A test runs with only `node` on `PATH`.

### 3.2 Store concurrency (replaces the exclusive lock, ADR 0005)
- **Ownership:**
  - An owner-lease row plus a lock file prove that one daemon owns the store.
  - WAL mode allows **read-only connections from worker threads**, with a timeout above 0.
- **Writing:**
  - One writer thread holds the only write connection.
  - Workers and child processes never write; they send typed rows over a message port.
  - The writer commits in bounded batches: at most N rows or 5 ms per transaction.
- **Storage layout:**
  - Program-model tables go in an attached `pm.db` with `synchronous=NORMAL`, since they can be rebuilt.
  - The ledger and kernel tables stay at `synchronous=FULL`.
- **Export and deltas:** `VACUUM INTO` or `backup()` for snapshots, and the Session/changeset API for deltas.
- **Event-loop target:** ping p99 under 100 ms while a 1M-row import runs.

### 3.3 The daemon and its clients
- **Starting and stopping:**
  - `reax serve` owns the store.
  - The CLI starts the real daemon on `REAX_HOME` automatically, detached, with an idle timeout. `--ephemeral` is opt-in.
  - Every connection begins with a version handshake.
- **Socket and token:**
  - The socket lives under `$XDG_RUNTIME_DIR`, or at a short hashed path to stay within macOS's 104-byte limit. The directory is 0700 and the token file 0600.
  - On Windows, the named pipe's ACL is set to the user's SID.
  - Homes that are group- or world-writable are refused.
- **Crash recovery:**
  - Each engine child's pid, start time, process group and an environment nonce are stored in the kernel. After a restart, only exact matches are reaped.
  - A poisoned job is parked before the daemon restarts.
  - Clients reconnect with backoff. An interrupted call returns `daemon_restarted` and the job handle.
- **Supervision:** `reax setup` can generate an optional systemd or launchd unit.
- **MCP over stdio and HTTP** are clients. HTTP requires a bearer token and binds loopback by default; any other bind requires TLS and an explicit flag.
- **Consent, sandbox and budget checks** are enforced in the engine and the scheduler, so every client gets them.
- **Hygiene:**
  - all scratch space lives under `REAX_HOME/tmp/<job>` and is swept at start;
  - a disk quota and LRU retention apply to blobs, projects and extractions;
  - retention is on by default.

### 3.4 Tool surface
Fourteen tools, each taking an `operation`:
- `identify`, `inventory`, `read`, `extract`, `analyze`, `compare`;
- `evidence`, `unknown`, `verify`, `fetch`, `doctor`, `session`;
- `annotate`, which replaces `write`;
- `observe`.

Changes after review:
- **Read and write split.** Mutating operations are in separate tools (`evidence_admin`, `unknown_write`, `annotate`). Effect hints stay honest, so read tools are marked read-only.
- **Discovery on demand.** `session describe {operation}` returns that operation's schema, limits, effects and an example.
- **Hiding unavailable operations.** Operations not available on this host are hidden or marked.
- **Consistent errors.** The same mistake gets the same code in every operation, and the message names the operation and the field.
- **Job model:**
  - Every call has a deadline: 20 s by default, or the client's own.
  - Past the deadline the call returns `{job, status, eta, queue_position, continuation}`.
  - `session job` handles wait and cancel.
  - Progress notifications are sent while a job runs.
  - The optional MCP tasks extension is supported.
- **Catalog and results:**
  - `tools/list` stays at or under 16 KiB, with no output schemas by default. If a schema is declared, the spec requires both copies of the result.
  - Each result is sent once.
  - Handles are also published as a resource template and as `resource_link`.
- **Generated from one source.** A single operation registry generates the MCP schemas, the CLI commands and help, `operations.md`, the ledger stubs, the per-client schema fixtures and the skill.
- **CLI output** in toon, json, yaml, md or jsonl, with `--token-limit` and `--filter-output`.

### 3.5 Program model, caching and annotations
- **Tables in `pm.db`:**
  - `pm_target`, keyed by content digest;
  - symbols, functions, xrefs, strings (UTF-8 and UTF-16), segments, types, imports, exports, resources, signatures, notes, bookmarks, capabilities;
  - `pm_module` and `pm_module_edge` (each edge records how it loads and whether it resolved), and `pm_ipc`;
  - `blob`, content-addressed;
  - FTS5 indexes over strings, symbols, decompiled text and notes.
- **Coverage** is recorded per target and operation. "Complete" means nothing is truncated and nothing is unresolved, and every `complete` states its scope (for example, "direct edges observed").
- **Cache keys** combine the probe, params, digest, profile, `{engine, version, binary digest}` and `project_rev`. Annotations bump `project_rev`, so stale results are never served.
- **Annotations** (rename, retype, comment, bookmark):
  - set semantics, with a read-back check before replay;
  - a write lock per project;
  - a snapshot of the project before each write session;
  - persistent projects under `REAX_HOME/projects/<digest>/<engine>/`, with the engine version pinned per project.
- **Secrets** found in targets are stored encrypted at rest. Model-facing output shows only a fingerprint and the type. Revealing a value is an approval-gated operation.
- **When engines disagree,** both answers are kept and labelled. The target's binding sets the default engine; `compare {engines:[a,b]}` is the explicit cross-check.
- **Calibration** applies to a cell only when n ≥ 30, pooling question classes when samples are fewer. Results show the interval, not a point value. Calibration drives three things: the confidence shown, the router's preferences, and how often the verifier samples a producer.

### 3.6 Engines and isolation
- **Adapter contract** (`packages/core/src/probes/adapter.ts`):
  - id, version and binary digest;
  - availability and remediation;
  - the operations it serves;
  - resource class and whether it can be preempted;
  - an optional warm pool, recycled when the binary changes;
  - a progress heartbeat;
  - a streamed, cancellable run.
- **Ghidra** runs through a long-lived pyghidra 3.x worker speaking JSON lines, on JDK 25. ReVa (Apache-2.0) is used as prior art and as a differential check.
- **Sandbox interface** (ADR 0006), always with the network off:
  - **Linux:** a small exec helper applies Landlock and seccomp. bubblewrap is used where user namespaces are allowed, and `doctor` detects the AppArmor restriction and explains the fix.
  - **macOS:** the `sandbox-exec` command, with a canary check in CI on each image.
  - **Windows:** a helper that sets up a Job Object plus AppContainer.
  - **Implementations:** `@anthropic-ai/sandbox-runtime` or landstrip behind reax's own interface, pinned exactly, since both are pre-1.0.
  - A host with no sandbox labels its results `unenforced`, and `doctor` reports how many such runs there were.

### 3.7 Scheduler (intelligent load balancing)
- **Admission:**
  - Resource classes with separate pools. Engines whose jobs cannot be preempted (Ghidra, JADX, ILSpy) are never preempted.
  - **A reserved cheap lane** (about 1 CPU and 512 MB) is kept for `identify`, `inventory` and `read`.
  - **Memory- and disk-aware admission:**
    - starting estimates per operation and input size; for an engine, its `-Xmx` plus a margin;
    - the real limit read from cgroup v2 `memory.max` or the Windows job;
    - memory held by warm pools counted against the budget, and idle pools evicted under pressure;
    - an RSS limit on each child process, which returns a typed partial result;
    - limits that can be overridden in configuration.
- **Ordering:**
  - Single-flight deduplication by cache key.
  - Cheap work first, with aging so deep jobs are not starved.
  - Weighted fair queuing per client session, with queue quotas.
  - A cost model built from `sched_history` gives each job an ETA. When the deep operation cannot meet the deadline, the scheduler suggests a cheaper one.
- **Failure handling:**
  - A stall watchdog marks a silent job `stalled`, but does not kill it.
  - The breaker counts failed starts per task.
  - Crash safety follows the lessons from pi-durable, absurd, Orca and T3 Code:
    - intent before effect;
    - ids minted inside the transaction;
    - no writes from a stale lease;
    - a lease of 0 or less is refused;
    - a timeout writes a checkpoint;
    - process state is tracked separately from turn state;
    - stale completions are rejected;
    - work tied to a dead process is cancelled, not replayed.
- **Isolation of heavy work:**
  - built-in readers run in worker threads;
  - JS bundles and large archives run in child processes with an RSS limit;
  - native parser memory (oxc) is outside the V8 heap, so only child processes can bound it.

### 3.8 JavaScript and Electron
- **Parsing and resolution:**
  - Parser: oxc-parser and oxc-resolver (MIT), with meriyah or acorn as a fallback that needs no native code.
  - enhanced-resolve is a differential oracle in tests.
  - Source maps: trace-mapping.
  - Files are processed one at a time, each with a budget, and the graph is stored in tables.
- **What the graph records:**
  - every loading form gets a node with its resolution status;
  - IPC pairing, bundler fingerprints and source maps;
  - whether the entry point is plain Node or Electron's main process, decided from evidence.
- **Electron archives:** `@electron/asar` and `@electron/fuses`, read-only.
- **Bundle unpacking:** webcrack (MIT) and wakaru (Apache-2.0), in sandboxed child processes.
- **Security checklist:** a reax-authored Electron checklist, credited to the archived electronegativity project.

## 4. Integrating leanrea
- **Router as data.** leanrea's router, traps and rules become data under the MIT credit, extended for zip, tar and npm and corrected:
  - trap T10 for Go builds made with `-s -w`;
  - T16, `sourcesContent`;
  - the Flutter offset, tested;
  - `llvm-objdump --macho` as the Linux fallback for Mach-O.
- **Prose rules become enforcement:** caps and handles in the tools, labels as fields, the untrusted-content envelope, and the approval gate.
- **Generated skill (about 2k tokens or less):**
  - It says: inventory first, stop once every question has evidence.
  - Without reax, it falls back to plain commands that are correct on every platform.
  - It is tested on Linux, macOS and Windows and on at least two model tiers.
  - It is published, pinned by tag, to the skills directory and the MCP Registry.
- **Turn discipline is measured** in the benchmark: turns and tool calls are recorded for every arm.

## 5. The intelligence and autonomy layer
- **`analyze investigate {goal, budget}`** is a deterministic planner. It runs inventory, deepens using the router and the open unknowns, verifies, and returns a dossier with its stop reasons. The six MCP prompts are generated from these plans.
- **Next-step recommender.** Every unknown carries `resolvable_by` (operation, cost, engine), and `unknown next` ranks them.
- **Capability detection:**
  - `yara-x` (official wasm, BSD-3) in-process, with redistributable rule packs (ReversingLabs MIT; signature-base with attribution);
  - capa ≥ 10 (Apache-2.0) and FLOSS (Apache-2.0) as processes;
  - Detect It Easy (MIT) as a second opinion for identification;
  - results are stored in `pm_capability`.
- **Search.** FTS5 in Phase 1. Optional local embeddings come later, from permissive models only: transformers.js or node-llama-cpp, plus sqlite-vec, with a fallback that needs neither.
- **Summaries.** Deterministic summaries per function, module and target are built from stored facts and labelled `derived`.
- **Optional local model,** off by default:
  - any OpenAI-compatible endpoint (Ollama, llama-server or LM Studio), loopback only unless `--allow-remote-model`;
  - it proposes names and summaries only, stored as notes labelled `suggested`;
  - applying a suggestion still goes through `annotate` approval.
- **Knowledge reuse across targets:**
  - Ghidra FunctionID and BSim (H2 file database);
  - BinExport and BinDiff (Apache-2.0);
  - FLIRT `.sig` data used unmodified with its licence;
  - annotations carried forward through `match-functions`.
- **Library and dependency facts:**
  - GoReSym (MIT);
  - symbolic by Sentry (MIT: demangling plus DWARF/PDB);
  - cargo-auditable data;
  - OSV-Scanner (offline database) and retire.js for known vulnerable dependencies.
- **Watch and batch:**
  - `reax watch <path>`: when the content digest changes, re-run inventory, compare, and open unknowns on the deltas;
  - `reax batch <manifest>`: fair scheduling across targets and a summary report.
- **Reports:** Markdown, SARIF and CycloneDX.

## 6. Open-source components: integrate or avoid
- **Linked into reax (permissive licences):**
  - the MCP SDK v2, oxc, meriyah/acorn, trace-mapping;
  - yara-x wasm, capstone wasm 5.x, kaitai-struct runtime with per-format licence checks;
  - @electron/asar and @electron/fuses, @ast-grep/napi for reax-authored rules;
  - transformers.js (optional), sqlite-vec (optional).
- **Separate processes:**
  - Ghidra/pyghidra, rizin and rz-ghidra, LLVM tools;
  - JADX, Apktool, Vineflower, ILSpy, androguard, ipsw;
  - capa, FLOSS, diec, GoReSym, symbolic, unblob, OSV-Scanner;
  - angr (optional);
  - processes only because of their licence: hermes-dec (AGPL), pycdc and PyLingual (GPL), ghidriff (GPL), quark-engine and APKiD (GPL).
- **Avoid:**
  - OFRAK (proprietary);
  - Semgrep registry rules (no redistribution) and CodeQL against third-party targets;
  - TrID (non-commercial only);
  - Diaphora (AGPL, built around IDA);
  - Kùzu (archived);
  - non-commercial embedding models;
  - Codestral- or DeepSeek-based decompiler models;
  - GPL rule data (Yara-Rules, ImHex patterns);
  - keystone; linking unicorn; firejail; MCP sampling;
  - npm packages that only share a name with the real project (`lief`, `humanify`).

## 7. Clean-room process
- **Why:** rea is MIT-licensed, so the goal is design independence, not legal necessity.
- **Who does what:**
  - A spec agent writes behaviour specs only: no code, no identifiers beyond public tool names and error codes.
  - Implementer agents run in a sandbox with no rea checkout, and their file reads are logged.
- **Similarity check:** a winnowing check over normalised tokens, with a threshold, an allow-list and a human review queue. Tests and data are excluded.

## 8. Landing table, one row per capability family
Every rea family (C01–C46, and the HEAD-only C45 subfamilies) lands on a tool, an operation and a phase. The full per-tool-name table lives in `docs/parity.md`; the summary:

| Phase | Families and where they land |
|---|---|
| **1 (built-in static reading)** | C03 CLI and output formats; C04 schema profiles; C07 native inventory (ELF/PE/Mach-O readers, symbols, strings, segments); C12/C14 Go, Rust, PE resources, Mach-O load commands, ObjC/Swift, codesign, entitlements; C13 recorded crashes (core, minidump), mitigations; C17 artifacts, plist, keyed archive, nib, asset catalog, desktop app; C19 JS/Electron graph (in tables); C23 .NET metadata; C24 Dart/Harmony identifiers; C29 SQLite and WASM structure; C30 evidence bundles and paged views; C31 unknowns; C32 verification and obligation ledger; C34 effect audit; C35 budgets and continuation; C36 progress; C37 error contract; C40 setup/doctor/uninstall; C44 reference-source import; C45 PE imports/certs/load-config, native exports, ELF notes, kernel modules, devicetree, BEAM, pyc, IL2CPP, GGUF/safetensors, APK signatures, Apple IPS, entropy, Godot/PyInstaller/Node SEA |
| **2 (engine depth)** | C06 Hopper navigation/bookmarks (bookmarks as `pm_bookmark`, navigation on the Hopper adapter); C08 decompile/disassemble; C09 xrefs, call graph, call paths, value tracing; C10 annotations (via `annotate`); C11 function comparison and matching; C15 objdump/rizin/Cutter/GDB sessions (raw commands approval-gated); C19 deep (bundle recovery, version/export comparison); C23 ILSpy depth; C24 JADX/Apktool/blutter; C27 firmware (binwalk/unblob); C28 pcap/tshark and EVM; C29 EVM selectors; C33 snapshot cache; C38 provider registry; C41 the 6 prompts (generated from the planner); C44 source-to-artifact comparison; C45 `match_functions`, analysis settings, `decompile_all`; capability detection (capa, FLOSS, yara-x) |
| **3 (runtime and devices, off by default)** | C16 Frida; C18 native UI observation and app graph; C20 browser/CDP, HAR/SAZ (static HAR under `read`); C21 Electron/V8 runtime and static↔runtime correlation; C22 process capture and comparison (timing separated from content); C26 ADB device operations (`reax.device`, mutating); C28 sigrok signals; C43 agent environments (`environment-serve`) |
| **Cross-cutting** | C01/C02 MCP stdio and HTTP; C05 sessions and targets; C39 owned-process supervision; C46 logging, catalog digests, optional metrics |
| **Reviewed `wont`** | Binary Ninja provider (no open equal; recorded with a reason); commercial engines (IDA, Hopper, JEB) available only on a detected licensed install. (Kuna was listed here by mistake: it is an open Apache-2.0 decompiler; see §14.) |

## 9. Phases and gates (documented breadth first)
Each phase is committed only when its gate is green, and the parity and limitation ledgers are regenerated at each gate. **The first execution covers 0a–0c.**

- **0a — workspace and core.** Root workspace, `packages/core` extracted, Assay green on it. *Gate:* Assay's full suite and the core conformance kit (including the donor crash cases) pass; the `.d.ts` stability diff is clean.
- **0b — ledgers and the integrity gate.** `seed-register.ts`, both ledgers, `parity-check.ts`, the documentation and no-orphan gates. *Gate:* every profile and donor row is present; statuses compute from the test report; the drift check passes.
- **0c — research, fixtures, harness.** `engine-research.md`; the fixture corpus generated with `zig cc` from public-domain and permissive sources; the benchmark harness. *Gate:* fixtures build reproducibly with pinned digests; the harness runs on the fake arm.
- **1 — built-in readers for every format**, CLI formatters, setup, verify, FTS search, the leanrea skill. *Gate:* fixture and differential tests pass; the injection and secret tripwires show 0 leaks and 0 effects; size and latency gates pass; reax beats rea and leanrea Tier 0 on the cheap-question subset.
- **2 — engine depth,** annotations, reconciliation, capability detection, similarity, reports; commercial adapters behind ownership gates and protocol fakes. *Gate:* the real-engine lane is green for the open engines; annotations survive a daemon restart; the no-silent-fallback test passes; the engine version is in the cache key.
- **3 — runtime and devices,** off by default, approval- and sandbox-gated, network off. *Gate:* 0 runtime operations without approval; sandbox-enforcement tests pass; timing jitter is not reported as change.
- **4 — Assay switch-over and release.** Assay runs reax in a shadow mode (its probes and reax in parallel, results diffed, behind a flag) for several releases; old tool names become aliases; a re-keying migration moves existing claims; rollback is one flag. Release uses SHA-pinned `actions/attest`, a reusable workflow (SLSA Build L3), an SBOM, a signed artifact, `npm-shrinkwrap.json`, a support period and a CRA position. *Gate:* Assay's full suite passes in both modes; the pre-registered benchmark rules are met.

## 10. Benchmarks
Three arms: reax; rea pinned at 6.8.0 in a Node 24 container; leanrea Tier 0 (a model with Bash and the skill). At least 30 oracle tasks and 60 paired cells, on generated uncontaminated fixtures, including a resume task and an adversarial task, every arm in the same sandbox with a filtered environment.
- The grader (`bench/grade.ts`) is identical across arms, grades each answer's own claims against oracle predicates, normalises vocabulary (fixing the `macho-fat`/`gzip` artefacts), penalises refuted claims, grades labels, and has a self-test.
- Every cell commits its raw transcript, model id, skill commit, target digest, tool versions, turn and tool-call counts and the cached-vs-uncached token split. Timed-out cells are kept. Arms run one after another, never concurrently on one machine.
- `bench/PREREG.md`, committed before the run, names the model tiers (Haiku- and Sonnet-class), a non-inferiority margin and test on accuracy, the cost definition, and the speed, memory and context budgets as gates.
- CI runs only the model-free gates; live runs are a manual or scheduled workflow. Misses are published as misses, and `bench/results/` is never hand-edited.

## 11. Files
- **New:** root `package.json`, `tsconfig.base.json`; `packages/core/**` (with `spec.ts`, `probes/adapter.ts`); `apps/reax/src/{daemon,clients,scheduler,engines,router,readers,tools,sandbox,model}/`; `apps/reax/docs/{ledger/,parity.md,operations.md,engine-research.md,cleanroom.md,scope.md,third-party.md,debt.md,decisions/}`; `apps/reax/scripts/{seed-register.ts,parity-check.ts,gen-skill.ts,cleanroom-check.ts,new-operation.ts,new-adapter.ts}`; `apps/reax/skills/reax/`; `apps/reax/bench/`; `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, `GOVERNANCE.md`, `CODEOWNERS`, `AGENTS.md`; `.github/workflows/{reax.yml,reax-real.yml}`.
- **Changed:** `apps/assay/**` imports switch to `@re4exa/core`; Assay's package and tsconfig; `assay.yml`'s path filter adds `packages/core/**`; the CI matrix moves to macos-15/26, windows-2025 and ubuntu-24.04/26.04; Assay and reax move to Node 24.15.
- **Reused (moved, not rewritten):** Assay's kernel, evidence, probes and builtin readers, verifier, policy, mcp registry/handles/paths/suggest, vendored process host, and the fuzz, differential, tripwire and fault-injection harnesses.

## 12. Verification
- `npm test` at the root writes a JUnit report that `parity-check.ts` consumes.
- `reax.yml` (Linux, full): typecheck, lint, coverage, the parity/limitation/documentation gates, the dependency budget and audit plus CodeQL, gitleaks and OSV-Scanner, SBOM, fixtures, tripwires, benchmark gates, self-application (`reax inventory` on its own package), and the size and latency gates.
- macOS and Windows lanes: unit tests, platform readers, the sandbox canary.
- `reax-real.yml` (nightly, and on engine changes): pinned engine images built weekly and cached by digest; open engines run the depth and differential tests; commercial adapters test against fakes.
- The MCP SDK v2 client runs against the core server as a conformance oracle.
- `reax doctor` output is a fixture.

## 13. Governance, scope and delivery
- **Agent-driven development.** Work packages each declare the paths they own, and CI fails a PR that touches paths outside them. One ledger file per family avoids conflicts; the ledger is the work queue, with a lease per row. Each writing agent uses its own worktree; stop is not delete. The lead re-runs the full suite before merging.
- **Developer experience.** The one operation registry (§3.4) generates schemas, CLI, docs, ledger stubs and fixtures. `new-operation` and `new-adapter` scaffold a stub, a fixture entry, a ledger row and a test skeleton. Fast lanes: unit under 2 minutes, then fixtures, then the nightly real-engine lane; tests run in parallel with one temporary `REAX_HOME` each.
- **Governance.** Semver with a versioned tool and operation contract and a deprecation window — no breaking change in a patch release, unlike rea. ADRs in `docs/decisions/`. Required review in `CODEOWNERS`. No telemetry by default. A support period and a CRA position at release.
- **Scope (`scope.md`, fail-closed).** Lawful analysis, interoperability, preservation, and software you own or are authorised to examine. Excluded: DRM or anti-cheat bypass, exploit automation, credential or key extraction, and binary patching for redistribution. Runtime and device tools stay off by default and need approval each time.
- **Delivery risk.** rea's breadth cannot be matched line for line. The ledger keeps the remaining tail visible, and the early phases deliver the cheap-question win first, where reax already beats both tools. If the whole programme is not funded, Phases 0–1 alone are a usable, honest replacement for leanrea and for rea's static-reading majority.
## 14. Plan changes found by triaging the register (phase 0b)

Every limitation row now has a phase, a fix, a severity and a kind (drafted by an agent from the
plan and profiles, spot-checked by the lead on 19 rows; not yet reviewed by a person). 49 fixes
named something this plan did not cover; checking them against core showed six were already
implemented there (PD-5, AB-P14, AB-P6, REA-A3.1, and in part PD-8 and AB-P8). They still need a
reax-tagged test before they count. The rest change the plan as follows. Row ids are in brackets.

**Core kernel and scheduler (phase 0-1)**
- Cap each job's checkpoint size and load only the latest checkpoint [AB-P11].
- Signal suspension and cancellation by returned status, never by exceptions user code can
  catch [AB-P12].
- State the delivery contract in ADR 0005 and operations.md: at-least-once execution, exactly-once
  record of committed steps [AB-P16]; a result is returned only after its evidence rows commit,
  despite writer batching [PD-7].
- Route every sleep and backoff through the kernel's injectable clock [AB-P8].
- Conformance tests for the mailbox (consume once, wake) [OR-2] and for any future wait
  primitive [AB-P2].
- Identify a poisoned job by charging only the attempts in flight at a crash, once per start
  [PD-3].
- A user-facing purge for a target and its evidence in `evidence_admin` [PD-10].
- Record optional local-model requests as intents with a re-send counter [PD-2].

**Isolation, environment and configuration**
- Every engine adapter uses the allow-listed environment probes already use [PD-8].
- A CI test that a default run makes no outbound connection [T3-7].
- The daemon re-reads its token file and engine licence paths on change [T3-2].
- A per-operation allow-list in configuration [REA-9C-radare2].
- `reax setup` shows a diff, keeps a backup and asks before editing each client's
  configuration [REA-C40].
- **Open design question (phase 3):** live browser and page observation need network, but the
  sandbox is network-off [REA-C20, LEAN-C38]. Candidate: a separate approval-gated profile that
  allows only the target origin through a recording proxy, with the CDP port on loopback. Decide
  before phase 3 starts; recorded as review item SR-12.

**Readers and analysis (phase 1-2)**
- A built-in DEX and binary-AXML reader, so APK inventory works without a JDK [REA-C24].
- Magic detection for Hermes bytecode, bytenode and V8 snapshots in `identify` [LEAN-C24].
- A decompression-ratio cap and a nested-archive depth setting, stated in §8 C17 [REA-A2.3, REA-C17].
- Unknowns scoped to the evidence ids they cite, not to the open target; refusal text with a code
  naming the operation and field [REA-A5.3, REA-C31].
- `verify` flags claims in a reconstruction that cite no evidence [REA-C32].
- Limitations referenced by id in traces, not copied into each node [REA-A4.2].
- A test that static output never carries an `observed` runtime label [LEAN-C13].
- Deep operations run (or reuse) inventory first [LEAN-C05].
- JADX mapping-file input and Gradle export [REA-9C-jadx]; user-supplied ast-grep rule files
  [REA-9C-semgrep]; per-job tracing spans exposed through `doctor` or `session` [REA-C46].

**Skill, benchmark and release**
- shellcheck the generated fallback commands [LEAN-9B-3]; pin package versions instead of `npx -y`
  [LEAN-A-7]; review what the third-party skills CLI writes [LEAN-C47].
- Add the resume and adversarial tasks to the phase 1 gate [LEAN-Q-6]; record model refusals per
  arm and state the scope in the skill and tool descriptions [REA-9B-3]; the tools/list size
  probe uses the SDK client with a read timeout and kills the server in `finally` [LEAN-C58].
- A release check that LICENSE and NOTICE are in every tarball [AB-P17, PD-12]; Dependabot or
  Renovate and a lockfile-drift check [REA-A6.5, REA-ISS-6480]; a per-file size lint [T3-1];
  public npm download counts in release notes [REA-Q-3]; a ledger row's lease is released only
  when its PR merges [OR-6].
- The Windows helper: signed for Smart App Control, built with a toolchain whose runtime needs no
  GPL notice, and daemon start kept within MCP client startup deadlines after a cold install
  [REA-A7.2, REA-C39].

**Wont candidates awaiting a person's review** (their rows stay gated until then):
REA-9B-4 (decompilers cannot recover original source; reax labels pseudocode), REA-9C-binary-ninja
and REA-ISS-1551 (commercial, no open equal, already in §8), REA-Q-5 (star counts), LEAN-Q-5
(upstream merge decisions), OR-3 (Orca's product labelling), T3-3 (reax uses no metered provider),
T3-5 (reax delegates no work to sub-agents).

**Scope question:** approval-gated reveal of secrets found in targets [REA-A6.4] sits close to the
§13 exclusion of credential extraction. Recorded as SR-8; decide before phase 1 ships reveal.

**Engines (from docs/engine-research.md, phase 0c)**
- Kuna (Noelo-Lab/kuna, Apache-2.0, Rust, v1.982 on 2026-10-26) is open source, not commercial.
  It becomes a phase 2 adapter for ELF and thin Mach-O (decompile, assembly, call edges, exact
  xrefs, strings) and a second decompiler to cross-check Ghidra. Pin the version and run it with
  one job: more than one job changes 40-60% of function bodies (per its author and rea).
- Ghidra 12.2 needs JDK 25, but its own Dockerfile installs JDK 21: reax builds its own engine
  image. No tagged BinExport build exists for Ghidra 12, and ReVa's newest release targets Ghidra
  12.1.3, so the ReVa differential check pins that Ghidra until a 12.2 build appears.
- angr's pyvex dependency includes GPL-2.0-or-later code: angr runs only as a separate process.
- A publicly distributed engine image carries OpenJDK's GPL-with-classpath-exception notice in
  third-party.md.
- Gaps with no open equal (G1-G8 in engine-research.md) stay commercial-only adapters or
  reviewed wonts: IDA Lumina and vendor FLIRT, scripted Windows and remote debugging, Hopper's
  shared GUI cursor, JEB's combined Dalvik analysis and debugger, and JEB's WASM, EVM, PLC and
  SASS decompilers.

## 15. Live benchmark backends (2026-10-27)

Four backends, run on the user's machines (Mac first, then Windows) under the user's own sign-ins
(`bench/setup.ts`, `bench/doctor.ts`, `bench/smoke.ts`, all cross-platform): `local` (llama.cpp, Qwen3-4B Q4_K_M, a 4096 MiB cap
enforced from llama.cpp's buffer report and sampled RSS), `codex` (Codex CLI, gpt-6.1-sol,
medium), `claude` (Claude Code CLI, Opus 5.5, `--effort medium` when offered) and `hybrid`
(Opus plans and decides, the local model works, Codex reviews, one revision). Rules:
`bench/PREREG-v2-smoke.md`. Tested here against a stub llama-server and fake CLIs
([±RX-1/bench-live], [±RX-1/bench-hybrid], [±LEAN-C49-LIMIT]); no live cell has run. reax never
reads, copies or refreshes a CLI's credentials and identifies only as itself.

**Cross-platform setup (2026-10-27).**
- `bench/setup.ts` picks llama.cpp's own release build at tag `b11923` from the hardware it
  detects, tests it, and falls back to the next build. It supports:
  - Metal;
  - CUDA, choosing by driver version;
  - ROCm;
  - Vulkan;
  - Adreno OpenCL;
  - SYCL, only when chosen;
  - CPU.
- The CLIs start on Windows without a shell, with prompts on stdin
  ([±RX-1/bench-setup], [±RX-1/bench-process], on all three CI lanes).
- **Not covered by CI:**
  - real GPUs;
  - real downloads, since the container's network policy blocks Hugging Face, and the GitHub
    API covers only this session's repositories;
  - Codex's read-only sandbox on Windows.

  These count only once a run on the user's machine records them.

**After the first Mac run (2026-10-27, PREREG amendment 2.1).**
- codex and claude scored 5/5 each.
- The local backend went over the cap: resident memory reached 4160–4213 MiB at a 16k
  context, though llama.cpp's buffer report was under 4096 MiB. Its remaining cells were missing
  with no record.
- **Fixes:**
  - Setup measures the largest context that fits the cap ([±RX-1/bench-fit]).
  - Cells that were not run are written and counted.
  - Each cell records the machine's load.
- The cause of the 0.00 scores on the local cells that did run waits on those cells'
  transcripts.

**Local model switched to Qwen3.5-9B (2026-10-27, PREREG amendment 2.2).**
- **The change.** At your direction, the local model is your own Qwen3.5-9B Q4_K_M, under a
  12 GB cap for the temporary test runs.
- **Setup** accepts a model file or folder and pins it by sha256.
- **Shutdown.** Model servers are closed cleanly and the close is confirmed, including after an
  interruption ([±RX-1/bench-close]). The doctor reports any server left running.
