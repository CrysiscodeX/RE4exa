# Engine research: open replacements for rea's commercial engines

Status: desk research for plan §9 phase 0c. Written 2026-10-26. No engine was installed or run.

## 0. Scope, method and labels

**Question.** rea's deep families (REA-C06–C11, C15, C24, C25, C38 in `docs/profiles/rea.md` §5) depend on engines. Four are named as commercial: IDA Pro (through ida-pro-mcp), Hopper, JEB, and Kuna. For each capability rea takes from them, which open engine can replace it, and where does nothing open match?

**Method.**
- rea's own provider docs were read at HEAD `7d36d17` (2026-10-26).
- Engine facts come from four places:
  - release tags, read with `git ls-remote` and shallow fetches;
  - GitHub release pages;
  - licence files and source read at the release tag;
  - package registries (PyPI, Maven Central, NuGet, Docker Hub).
- The vendor sites for Hopper, JEB, IDA, GDB and LLVM (hopperapp.com, pnfsoftware.com, hex-rays.com, sourceware.org, releases.llvm.org) and Wikipedia were blocked from this session. Facts from those hosts come from **search snippets only**, and each one is marked that way.

**Labels.**
- **verified** means the fact was read in a primary source at the URL given.
- **snippet** means a search-result summary of the cited page. The page itself was not opened.
- **unverified** means it was not confirmed.
- Where only a tag commit date was available, the date is marked **tag date**. This is the date of the tagged commit, which can be a few days before the release.

## 1. What rea uses each engine for

| rea family | Engine(s) | What rea uses | Source |
|---|---|---|---|
| REA-C06 navigation and bookmarks | Hopper only | `current_address`, `current_procedure`, `goto_address`, `next_address`, `prev_address`, `get_navigation_context`, `list_bookmarks`, `set_bookmark`, `unset_bookmark`. All of these change Hopper's UI state | profile §5 C06; [native-investigation.md "Hopper analysis behavior"](https://github.com/morluto/rea/blob/7d36d172ab9b1718630a8e8646f87e7dfdbfc71a/docs/native-investigation.md) |
| REA-C07 native inventory | Ghidra, Hopper, IDA, Kuna | procedures, segments, strings, names, address↔procedure, bytes | profile §5 C07 |
| REA-C08 decompile and disassemble | Ghidra, Hopper, IDA, Kuna | pseudocode, assembly, `batch_decompile`, `analyze_function`; HEAD adds `decompile_all` | profile §5 C08, C45 |
| REA-C09 xrefs, call graph, value tracing | Ghidra (full), IDA and Kuna (partial), Hopper | xrefs, callers/callees, call paths. `trace_native_values` uses **Ghidra high p-code def-use only** | profile §5 C09; [ghidra-provider.md](https://github.com/morluto/rea/blob/7d36d172ab9b1718630a8e8646f87e7dfdbfc71a/docs/ghidra-provider.md) "P-code value flow" |
| REA-C10 annotations | Hopper (live document), Ghidra (ephemeral database) | rename, comment, inline comment, `annotate_native_function`. IDA is never written. Nothing is persisted across sessions | profile §5 C10, D7; [ida-provider.md](https://github.com/morluto/rea/blob/7d36d172ab9b1718630a8e8646f87e7dfdbfc71a/docs/ida-provider.md) "mutation… outside this adapter's coverage" |
| REA-C11 comparison and matching | none: pure TypeScript over C08 dossiers; HEAD adds `match_native_functions` | per-dimension deltas | profile §5 C11 |
| REA-C15 CLI engines | GNU objdump, rizin, Cutter, GDB/MI | raw commands, rizin and GDB debugger sessions | [reverse-engineering-tools.md](https://github.com/morluto/rea/blob/7d36d172ab9b1718630a8e8646f87e7dfdbfc71a/docs/reverse-engineering-tools.md) |
| REA-C24 Android | JADX, Apktool | classes, methods, references, resources | profile §5 C24 |
| REA-C25 JEB client | JEB (caller-started MCP) | `inspect_jeb_client`, `open_jeb_project`, `list_jeb_units`, `decompile_jeb_item`. The engine's renames, comments and `save_project` are "intentionally not exposed yet" | [jeb-analysis.md](https://github.com/morluto/rea/blob/7d36d172ab9b1718630a8e8646f87e7dfdbfc71a/docs/jeb-analysis.md) |
| REA-C38 provider registry | Hopper, Ghidra, IDA, Kuna | one deep binding per target. `auto` with two usable providers returns `ambiguous` | profile §5 C38; [kuna-provider.md](https://github.com/morluto/rea/blob/7d36d172ab9b1718630a8e8646f87e7dfdbfc71a/docs/kuna-provider.md) |

## 2. What Kuna is

**Kuna is not commercial.** It is an open-source decompiler under **Apache-2.0**. The plan's §8 "Reviewed `wont`" row lists it with the commercial engines; that row needs correcting.

- **What it is.** rea's guide calls it "an Apache-2.0 decompiler distributed as one `kuna` executable" ([kuna-provider.md](https://github.com/morluto/rea/blob/7d36d172ab9b1718630a8e8646f87e7dfdbfc71a/docs/kuna-provider.md)). The repository is [github.com/Noelo-Lab/kuna](https://github.com/Noelo-Lab/kuna). Its LICENSE file is Apache License 2.0 (verified at `main`). Its README says Kuna "is written in Rust and was originally ported from Ghidra", and calls the project "an *experiment*" in autonomous refinement of decompilers.
- **Who.** The organisation is Noelo-Lab. The README's acknowledgements name sponsors, including the Air Force Research Lab ([README](https://github.com/Noelo-Lab/kuna/blob/main/README.md)).
- **Interfaces:**
  - CLI subcommands: `decompile --addr`, `decompile-project` (writes `.c`, `.h` and `.asm`), and `install-skill` (README). rea also calls `functions --json`, `strings --json`, `decompile-graph` and `xrefs --to … --json` ([kuna-provider.md](https://github.com/morluto/rea/blob/7d36d172ab9b1718630a8e8646f87e7dfdbfc71a/docs/kuna-provider.md)).
  - A Ghidra extension that replaces Ghidra's `decompile` binary. Headless use was "tested with Ghidra 12.1.2 and REA 3.1.0" (README).
  - A WebAssembly build that runs in the browser (README).
- **Release.** v1.982 was released on 2026-10-26 ([release](https://github.com/Noelo-Lab/kuna/releases/tag/v1.982); verified). Tags v1.978–v1.982 cover 2026-10-21 to 2026-10-26, so releases come almost daily.
  - Assets: `kuna-v1.982-linux-x86_64.tar.gz`, `-linux-x86_64-musl`, `-linux-arm64`, `-macos-x86_64`, `-macos-arm64`, `-windows-x86_64.zip`, `-specs.tar.gz`, and a Ghidra extension built for `ghidra_12.1.2` ([assets](https://github.com/Noelo-Lab/kuna/releases/expanded_assets/v1.982)).
  - rea verified its adapter against Kuna 1.833 (kuna-provider.md).
- **Scope in rea.** ELF and thin Mach-O for x86-64, AArch64 and ARM. rea's adapter rejects PE and universal Mach-O, and does not support Windows hosts. It has no annotations, no type recovery, no typed references and no basic blocks (kuna-provider.md). Whether Kuna itself accepts PE is **unverified**.
- **Determinism.** `--jobs` > 1 "change[s] about 40–60% of function bodies on the measured binaries" (kuna-provider.md). reax must pin `--jobs 1` and put the job count in the cache key.
- **Author claims (not checked).** The README claims the "top position on DecBench" and "a 19MB binary in under 3 minutes". The DecBench site was blocked from this session.

So Kuna is an **open candidate**, not a gap. reax can run it as a separate process (its licence would allow linking) behind the same adapter contract as Ghidra.

## 3. The commercial engines (facts for the adapters behind ownership gates)

| Engine | Latest known | Licence | Interface rea drives | Hosts | Source |
|---|---|---|---|---|---|
| IDA Pro | 9.3 (build 9.3.260213, Feb 2026); 9.4 in beta | proprietary | ida-pro-mcp (MIT): an attached GUI profile (legacy 1.4.0 tools), or a headless `idalib-mcp` supervisor (`idb_open`/`idb_list`/`idb_close`), checked at upstream commit `c133c385` | Win/macOS/Linux | snippet: [release notes 9.3](https://docs.hex-rays.com/ida-9.3/release-notes/9_3), [idalib overview](https://docs.hex-rays.com/ida-9.3/core/idalib/overview); [ida-provider.md](https://github.com/morluto/rea/blob/7d36d172ab9b1718630a8e8646f87e7dfdbfc71a/docs/ida-provider.md) |
| ida-pro-mcp | last tag 1.5.0 (tag date 2025-11-18); rea relies on untagged "2.0.0" builds | MIT | Tools include `decompile`, `disasm`, `xrefs_to`, `callees`, `callgraph`, `rename`, `set_comments`, `set_type`, `add_bookmark`, `idb_save`, `patch`, `py_eval`, and `dbg_*` (behind `?ext=dbg`). Needs IDA Pro 8.3+; "IDA Free is not supported" | — | [README](https://github.com/mrexodia/ida-pro-mcp) (verified) |
| Hopper | 6.5.0 per Homebrew cask (snippet, **unverified**) | proprietary (paid or demo) | An embedded Python bridge (`bridge/hopper_bridge.py`) launched by Hopper. The vendor site mentions "an integrated MCP server" (snippet) | macOS 12+; official Linux packages are x86_64 only | [installation.md#hopper](https://github.com/morluto/rea/blob/7d36d172ab9b1718630a8e8646f87e7dfdbfc71a/docs/installation.md); snippet: [hopperapp.com](https://www.hopperapp.com), [Homebrew](https://formulae.brew.sh/cask/hopper-disassembler) |
| JEB | 5.48, 2026-10-07 (snippet). rea names CE build `5.48.0.202610071539` | proprietary (Pro; free CE with fewer decompilers) | JEB's own MCP server (streamable HTTP, default `127.0.0.1:8425`). Headless CE: `java -jar bin/app/jeb.jar -c --mcp`, JDK 21+. 5.42 added `save_project`/`run_script` (snippet) | Win/macOS/Linux (JVM) | [jeb-analysis.md](https://github.com/morluto/rea/blob/7d36d172ab9b1718630a8e8646f87e7dfdbfc71a/docs/jeb-analysis.md); snippet: [changelog](https://pnfsoftware.com/jeb/changelog), [decompilers](https://pnfsoftware.com/jeb/manual/decompiling/), [CE](https://pnfsoftware.com/jebce) |

JEB Pro decompiles Dalvik, x86/x64, ARM/AArch64, MIPS, RISC-V, WebAssembly, EVM, S7 PLC, Nvidia SASS and Java classfiles. CE ships "the x86 (32-bit, 64-bit) decompiler modules" (snippet, [manual](https://pnfsoftware.com/jeb/manual/decompiling/), [CE](https://pnfsoftware.com/jebce)). The exact CE boundary is **unverified**.

## 4. Candidate open engines

### 4.1 Licence, version, date

| Engine | SPDX licence (source) | Latest stable, date | Version source |
|---|---|---|---|
| Ghidra | Apache-2.0 ([LICENSE](https://github.com/NationalSecurityAgency/ghidra/blob/Ghidra_12.2_build/LICENSE)) | 12.2, 2026-10-22. Asset `ghidra_12.2_PUBLIC_20261016.zip`, 543 MB; SHA-256 on the page `2c2cd776…a7be67` | [release](https://github.com/NationalSecurityAgency/ghidra/releases/tag/Ghidra_12.2_build), [assets](https://github.com/NationalSecurityAgency/ghidra/releases/expanded_assets/Ghidra_12.2_build) |
| pyghidra | Apache-2.0 (PyPI) | 3.2.0, 2026-10-22; also shipped inside the Ghidra zip (`Ghidra/Features/PyGhidra/pypkg/dist`, per the Dockerfile) | [PyPI](https://pypi.org/project/pyghidra/3.2.0/) |
| Kuna | Apache-2.0 ([LICENSE](https://github.com/Noelo-Lab/kuna/blob/main/LICENSE)) | v1.982, 2026-10-26 | [release](https://github.com/Noelo-Lab/kuna/releases/tag/v1.982) |
| rizin | LGPL-3.0-only (SPDX header in [librz/main/rizin.c](https://github.com/rizinorg/rizin/blob/v0.9.1/librz/main/rizin.c); [COPYING.LESSER](https://github.com/rizinorg/rizin/blob/v0.9.1/COPYING.LESSER)) | v0.9.1, 2026-06-29 | [release](https://github.com/rizinorg/rizin/releases/tag/v0.9.1) |
| rz-ghidra | LGPL-3.0-or-later (SPDX header in [src/core_ghidra.cpp](https://github.com/rizinorg/rz-ghidra/blob/v0.9.0/src/core_ghidra.cpp)); its embedded Ghidra decompiler is Apache-2.0 | v0.9.0, 2026-06-21 ("compatible with the Rizin v0.9.x series") | [release](https://github.com/rizinorg/rz-ghidra/releases/tag/v0.9.0) |
| radare2 | "Most of radare2 is licensed under the LGPLv3"; some plugins are GPL, which `--without-gpl` excludes ([COPYING.md](https://github.com/radareorg/radare2/blob/6.2.4/COPYING.md)). SPDX: LGPL-3.0-only for the core (**unverified**: no SPDX header seen) | 6.2.4, 2026-10-05 | [release](https://github.com/radareorg/radare2/releases/tag/6.2.4) |
| r2ghidra | LGPL-3.0-only ([README](https://github.com/radareorg/r2ghidra/blob/master/README.md#license)) | 6.2.4 (tag) | `git ls-remote` |
| angr | BSD-2-Clause (PyPI). Its required dependency pyvex is "BSD-2-Clause AND GPL-2.0-or-later" ([PyPI](https://pypi.org/project/pyvex/10.0.5/)). The optional `unicorn` extra is GPL-2.0 upstream ([COPYING](https://github.com/unicorn-engine/unicorn/blob/master/COPYING)) | 10.0.5, 2026-10-22 | [PyPI](https://pypi.org/project/angr/10.0.5/) |
| JADX | Apache-2.0 ([LICENSE](https://github.com/skylot/jadx/blob/v1.5.6/LICENSE)) | 1.5.6, 2026-07-10 | [release](https://github.com/skylot/jadx/releases/tag/v1.5.6); Maven `io.github.skylot:jadx-core` |
| Apktool | Apache-2.0 ([LICENSE.md](https://github.com/iBotPeaches/Apktool/blob/v3.0.3/LICENSE.md)) | v3.0.3, tag date 2026-07-19 | [tag](https://github.com/iBotPeaches/Apktool/releases/tag/v3.0.3) |
| androguard | Apache-2.0 ([README §Licenses](https://github.com/androguard/androguard/blob/v4.1.4/README.md); PyPI classifier says "Other/Proprietary", which is wrong metadata) | 4.1.4, 2026-06-01 | [PyPI](https://pypi.org/project/androguard/4.1.4/) |
| Vineflower | Apache-2.0 ([LICENSE.md](https://github.com/Vineflower/vineflower/blob/1.12.0/LICENSE.md)) | 1.12.0, 2026-04-29 | [Maven Central](https://repo1.maven.org/maven2/org/vineflower/vineflower/) |
| CFR | MIT ([LICENSE](https://github.com/leibnitz27/cfr/blob/0.152/LICENSE)) | 0.152, 2021-12-11 (no release since) | [Maven Central](https://repo1.maven.org/maven2/org/benf/cfr/) |
| ILSpy / ilspycmd | MIT ([LICENSE](https://github.com/icsharpcode/ILSpy/blob/v11.1/LICENSE); NuGet licence expression `MIT`) | ILSpy v11.1 (tag date 2026-09-22); ilspycmd 11.1.0.9782, 2026-09-23 | [NuGet](https://www.nuget.org/packages/ilspycmd/11.1.0.9782) |
| LLVM tools (llvm-objdump, llvm-readobj, llvm-dwarfdump, llvm-pdbutil) and LLDB | Apache-2.0 WITH LLVM-exception ([LICENSE.TXT](https://github.com/llvm/llvm-project/blob/llvmorg-23.1.4/LICENSE.TXT)) | 23.1.4, tag date 2026-10-19 (23.1.0: 2026-08-25) | [release](https://github.com/llvm/llvm-project/releases/tag/llvmorg-23.1.4) |
| capstone | BSD-3-Clause ([LICENSE.TXT](https://github.com/capstone-engine/capstone/blob/5.0.9/LICENSE.TXT)) | 5.0.9, 2026-05-28. 6.0.0-Alpha11 (2026-09-21) is a pre-release | [PyPI](https://pypi.org/project/capstone/5.0.9/) |
| GDB | GPL-3.0-or-later (snippet, [gdb](https://sourceware.org/gdb/)) | 17.2, 2026-05-10 (snippet). A GDB 18 branch was created 2026-08-06; whether 18.1 is released is **unverified** | snippet: [news](https://www.sourceware.org/gdb/news/), [announcement](https://sourceware.org/pipermail/gdb/2026-May/052178.html) |
| BinDiff / BinExport | Apache-2.0 ([bindiff LICENSE](https://github.com/google/bindiff/blob/main/LICENSE)) | BinDiff tag v8 (2023-09-25). The newest BinExport tag is `v12-20240417-ghidra_11.0.3`, so there is **no tagged build for Ghidra 12** | `git ls-remote` of [binexport](https://github.com/google/binexport) |
| ReVa (prior art and differential check, plan §3.6) | Apache-2.0 (profile §9C) | v7.3.1, 2026-09-03; builds for Ghidra 12.0/12.1/12.1.3, **none for 12.2** listed | [release](https://github.com/cyberkaida/reverse-engineering-assistant/releases/tag/v7.3.1) |
| WABT | Apache-2.0 ([LICENSE](https://github.com/WebAssembly/wabt/blob/1.0.42/LICENSE)) | 1.0.42, tag date 2026-09-15 | `git ls-remote` |
| wasm-tools | **unverified** (the LICENSE fetch matched nothing) | v1.262.0, tag date 2026-10-13 | `git ls-remote` |
| Cutter (rea C15 only) | GPL-3.0-only ([COPYING](https://github.com/rizinorg/cutter/blob/v2.5.0/COPYING)) | v2.5.0, tag date 2026-06-30 | `git ls-remote` |

### 4.2 Runtime, interface, platforms, CI install, cost

| Engine | Runtime | Interface reax would drive | Platforms | CI-pinnable install | Cold start / memory |
|---|---|---|---|---|---|
| Ghidra 12.2 + pyghidra 3.2.0 | **JDK 25+** (`application.java.min=25`, [application.properties](https://github.com/NationalSecurityAgency/ghidra/blob/Ghidra_12.2_build/Ghidra/application.properties); [WhatsNew](https://github.com/NationalSecurityAgency/ghidra/blob/Ghidra_12.2_build/Ghidra/Configurations/Public_Release/src/global/docs/WhatsNew.md)). Python 3.9–3.15 listed; the Debugger needs Python 3.9–3.14 | Long-lived pyghidra worker speaking JSON lines (plan §3.6); `DecompInterface`, `ReferenceManager`, `BookmarkManager` ([source](https://github.com/NationalSecurityAgency/ghidra/blob/Ghidra_12.2_build/Ghidra/Framework/SoftwareModeling/src/main/java/ghidra/program/model/listing/BookmarkManager.java)), `GhidraScript.setAnalysisOption(s)` ([source](https://github.com/NationalSecurityAgency/ghidra/blob/Ghidra_12.2_build/Ghidra/Features/Base/src/main/java/ghidra/app/script/GhidraScript.java)); project save | Linux, macOS, Windows (x64/arm64; native decompiler per OS) | Release zip + the SHA-256 published on the release page. A JDK 25 tarball with checksum. Ghidra ships `docker/` with `MODE=headless\|pyghidra`, **but its Dockerfile at the 12.2 tag installs `openjdk21` on `alpine:3.20`** ([Dockerfile](https://github.com/NationalSecurityAgency/ghidra/blob/Ghidra_12.2_build/docker/Dockerfile)), below the JDK 25 minimum. So build our own image. Third-party `blacktop/ghidra` is at 12.1.4 ([Docker Hub](https://hub.docker.com/r/blacktop/ghidra/tags)) | Not published. rea has startup-deadline settings and an open issue about cold Ghidra exceeding client waits (profile §6, #1048). Measure in the lane |
| Kuna | None; "a single self-contained binary" (README) | CLI with JSON output: `functions`, `strings`, `decompile`, `decompile-project`, `decompile-graph`, `xrefs` (rea doc) | Linux x86_64 (glibc, musl), Linux arm64, macOS x86_64/arm64, Windows x86_64 | Release tarball per platform. **No checksum file seen** among the assets, so reax records its own SHA-256 in the lock file | Author: a 19 MB binary in under 3 min. rea: a 53 MB binary's call graph took about a minute of walking, with 157 MB of JSON and about 93 MB retained (kuna-provider.md) |
| rizin 0.9.1 + rz-ghidra 0.9.0 | None (C) | `rizin -q0` through rzpipe-style JSON commands (`*j` variants); projects `Ps`/`Po` ([cmd_project.yaml](https://github.com/rizinorg/rizin/blob/v0.9.1/librz/core/cmd_descs/cmd_project.yaml)); seek history `sh`, `shr` ([cmd_seek.yaml](https://github.com/rizinorg/rizin/blob/v0.9.1/librz/core/cmd_descs/cmd_seek.yaml)) | Linux, macOS, Windows, Android | `rizin-v0.9.1-static-x86_64.tar.xz` ([assets](https://github.com/rizinorg/rizin/releases/expanded_assets/v0.9.1)) or image `rizin/rizin:v0.9.1` ([Docker Hub](https://hub.docker.com/r/rizin/rizin/tags)). rz-ghidra ships only `rz-ghidra-src-v0.9.0.tar.gz` (77.2 MB), so it must be built in the image | Not published |
| radare2 6.2.4 (+ r2ghidra) | None (C) | `r2 -q0` / r2pipe (MIT, [PyPI](https://pypi.org/project/r2pipe/)); r2mcp exists (profile §9C) | Linux, macOS, Windows, Android, iOS, WASI | `.deb` packages with `checksums.txt` ([assets](https://github.com/radareorg/radare2/releases/expanded_assets/6.2.4)); image `radare/radare2:6.2.4` ([Docker Hub](https://hub.docker.com/r/radare/radare2/tags)) | Not published |
| angr 10.0.5 | Python ≥ 3.12 (PyPI) | Python worker: `CFGFast`, decompiler, VSA, symbolic execution ([README](https://github.com/angr/angr/blob/v10.0.5/README.md)) | Linux, macOS, Windows (**unverified** per platform) | `pip install --require-hashes` from a lock file | Not published. Known to be memory-heavy (**unverified**) |
| JADX 1.5.6 | Java 11+ ([README](https://github.com/skylot/jadx/blob/v1.5.6/README.md)) | `jadx` CLI (`--export-gradle`, `--deobf`, `--mappings-path`), or `jadx-core` from Maven in a JVM worker | Any JVM | `jadx-1.5.6.zip` from the release (no checksum asset seen; record our own), or Maven Central `jadx-core` (which ships `.sha1`) | Not published |
| Apktool 3.0.3 | JRE 8+ (the build targets Java 1.8, [build.gradle.kts](https://github.com/iBotPeaches/Apktool/blob/v3.0.3/build.gradle.kts)); runtime minimum **unverified** | CLI `apktool d` | Any JVM (bundles aapt2 per OS) | Release jar + recorded SHA-256 | Not published |
| androguard 4.1.4 | Python ≥ 3.9 | Python worker: DEX/AXML parsing, xrefs, DAD decompiler ("Basic Decompiler for DEX/ODEX files", README) | Any Python | pip with hashes | Not published |
| Vineflower 1.12.0 | Java 17+ ("1.11+ requires Java 17 or higher", [README](https://github.com/Vineflower/vineflower/blob/1.12.0/README.md)) | CLI jar or library | Any JVM | Maven Central jar + checksum | Not published |
| CFR 0.152 | Java 6+ ("written entirely in Java 6", [README](https://github.com/leibnitz27/cfr/blob/0.152/README.md)) | CLI jar | Any JVM | Maven Central jar + checksum | Not published |
| ilspycmd 11.1 | **.NET 10** runtime (`tfm: net10.0` in the package's `runtimeconfig.json`, read from the nupkg) | CLI: whole assembly or per type, to C# or project | Linux, macOS, Windows | NuGet package, pinned by version, with the registry SHA-512 | Not published |
| LLVM 23.1.4 tools, LLDB | None | `llvm-objdump`, `llvm-readobj --elf-output-style=JSON`, `llvm-dwarfdump`, `llvm-pdbutil`. LLDB: SB API (Python), `lldb-dap`, and a built-in MCP server (`protocol-server start MCP …`, single `lldb_command` tool at introduction; snippet, [lldb MCP](https://lldb.llvm.org/use/mcp.html)) | Linux x64/arm64, macOS arm64, Windows x64/arm64 | `LLVM-23.1.4-Linux-X64.tar.xz` with a `.jsonl` sidecar per asset (an attestation bundle; format **unverified**) ([assets](https://github.com/llvm/llvm-project/releases/expanded_assets/llvmorg-23.1.4)). Whether this tarball includes `lldb` is **unverified** | Small per call (**unverified**) |
| capstone 5.0.9 | None (linked as wasm, plan §6) | In-process disassembly of byte ranges | All | npm/PyPI by exact version | In-process |
| GDB 17.2 | None | GDB/MI3 over pipes (rea's approach, reverse-engineering-tools.md) | Linux (rea's sessions are Linux-only) | Distro package by exact version, or the source tarball with the SHA-256 from the announcement | Not published |

## 5. Capability matrix

Cells describe what the **engine** can do through the interface named in §3. "rea: …" notes where rea uses less than that.

| Operation | IDA (ida-pro-mcp) | Hopper (Python bridge) | JEB (MCP) | Kuna (CLI) | Best open replacement(s) |
|---|---|---|---|---|---|
| Decompile one function | supported (`decompile`; Hex-Rays licence per architecture) | supported (pseudo-code; rea `procedure_pseudo_code`) | supported (`decompile_jeb_item`: types and methods) | supported (ELF and thin Mach-O, x86-64/AArch64/ARM, in rea) | **Ghidra** (broadest SLEIGH processor set); Kuna; rz-ghidra / r2ghidra (Ghidra's decompiler core inside rizin/r2); angr (partial: output quality **unverified**) |
| Disassemble | supported (`disasm`) | supported | supported | supported (export `.asm`; only after the whole-program export finishes) | Ghidra, rizin, llvm-objdump, capstone (in-process) |
| Xrefs | supported (`xrefs_to`, `xrefs_to_field`) | supported | partial: in the engine API, but not among rea's four tools; MCP tool names **unverified** | partial: incoming references to one exact address; no typed references, no cursor | **Ghidra** (typed references over function bodies, as rea uses); rizin `axt`/`axf` |
| Call graph, callers, callees | partial: `callgraph`/`callees`. rea: direct callers unavailable in the modern and native profiles | partial: callers and callees per procedure | **unverified** through MCP | partial: call edges only; indirect calls make coverage partial | **Ghidra**; rizin (`agC`); angr `CFGFast` |
| Value tracing (def-use) | partial: Hex-Rays microcode is reachable only through `py_eval`; there is no dedicated tool | no | **unverified** (IR in the engine API) | no | **Ghidra** high p-code def-use (rea's only source); angr VSA and reaching definitions; rizin ESIL emulation (partial) |
| Function matching and diffing | partial: FLIRT/Lumina inside IDA, plus BinDiff through BinExport; not in ida-pro-mcp | no | no (**unverified**) | no | Ghidra FunctionID, BSim (local H2 database), Version Tracking; BinDiff + BinExport (no tagged Ghidra 12 build, §4.1); rz-diff/radiff2; ghidriff (GPL-3.0, process only) |
| Rename / retype / comment / bookmark, persisted | supported (`rename`, `set_type`, `set_comments`, `add_bookmark`, `idb_save`). rea: read-only, never saved | partial: names, comments and bookmarks in the live document, with read-back checks. rea does not save `.hop`; database targets are declined on macOS | partial: renames, comments and `save_project` exist in the engine. rea does not expose them; retype **unverified** | no | **Ghidra** persistent project (all four; bookmarks through `BookmarkManager`); rizin projects `Ps`/`Po` (rename, comment, types; bookmarks only as flags); JADX renames only through mapping files (`--mappings-path`) |
| Navigation state (cursor, next/prev, history) | supported in the GUI only; rea does not request GUI navigation | supported (GUI cursor; snaps to object starts) | no (**unverified**) | no | rizin seek and seek history (`s`, `sh`, `shr`), headless. Otherwise a reax-owned cursor and history in the session, with bookmarks in `pm_bookmark` (plan §8). Ghidra has a cursor only in the GUI |
| DEX/APK decompile | no Dalvik decompiler (**unverified**) | no | supported (JEB's primary use) | no | **JADX**; androguard DAD (partial); Apktool (resources and smali, not Java); Ghidra (DEX loader; quality **unverified**) |
| .NET decompile | no (disassembly only, **unverified**) | no | no (not in JEB's decompiler list, snippet) | no | **ILSpy / ilspycmd** |
| Debugger sessions | supported (`dbg_*` extension; IDA's local and remote debuggers) | partial: Hopper has a debugger (third-party listing; **unverified**); rea does not use it | **unverified** for MCP (JEB has debuggers per vendor material); rea does not use it | no | **GDB/MI** (Linux); **LLDB** (macOS; Linux; Windows partial); rizin/r2 debuggers; Ghidra Debugger (drives gdb/lldb; GUI-oriented) |
| Analysis settings | partial: idalib open options; not a dedicated ida-pro-mcp tool | partial: loader overrides (rea uses "configured loader overrides") | **unverified** | partial: `--option` (decompile), `--jobs` (must stay 1) | **Ghidra** `setAnalysisOption(s)`, headless flags; rizin `e anal.*` |
| `decompile_all` | partial: `export_funcs`, or a full-program Hex-Rays export through idalib (**unverified** via MCP) | partial: loop over procedures | **unverified** (engine export) | supported (`decompile-project`) | **Ghidra** script over all functions; Kuna `decompile-project`; JADX whole-project export; ilspycmd project export |

## 6. Replacement per commercial engine

### IDA → Ghidra (default), with Kuna and rizin as cross-checks
- **Covered by Ghidra:** inventory, decompile, disassemble, typed xrefs, the call graph, value tracing, analysis settings, `decompile_all`, and persistent annotations (rename, retype, comment, bookmark). Ghidra exceeds what rea takes from IDA: rea's IDA adapter has no direct callers in two profiles, no CFG, no typed references, and no mutation (ida-provider.md "Coverage and evidence").
- **Not covered:** see §8 G1–G3.

### Hopper → rizin plus reax state (navigation), Ghidra (bookmarks and annotations)
- **Navigation.** rea's Hopper navigation tools are a read and write of a cursor. reax can own that state per session, persisted in the store (plan §8 C06), and resolve "next/prev object" from the program model or a rizin session. What is lost is a cursor shared live with a human's Hopper window (G4).
- **Bookmarks.** Use `pm_bookmark` in reax, mirrored into the Ghidra project's `BookmarkManager` when Ghidra is bound.
- **Annotation.** Use Ghidra project writes with read-back; rizin projects are the second option.

### JEB → JADX + Apktool + androguard (Android), Ghidra (native in APKs), WABT (WASM)
- **What rea uses.** Only projects, units and decompile (C25). For APKs, JADX covers decompile and Apktool covers resources. androguard covers DEX xrefs and call graphs in Python.
- **The project/unit model.** JEB's model maps to reax's own `pm_module` tables. No open engine copies it, and none needs to.
- **Not covered:** see G5–G7.

### Kuna → keep Kuna (open), with Ghidra as the reference
Kuna is open. reax adds it as an optional open adapter for ELF and thin Mach-O decompilation. It is useful as a fast, second decompiler, and as a `compare {engines:[ghidra,kuna]}` differential check (rea already ships `verify:kuna --compare-ghidra`).

## 7. Recommended defaults

The binding is explicit, with no silent fallback (rea D6; plan §3.5 "when engines disagree"). "Second" means an explicit `compare` engine, or the engine used when the default is unavailable **and the result is labelled with the engine that produced it**.

### 7.1 Per operation

| Operation | Default | Second | Notes |
|---|---|---|---|
| Header, section, symbol and DWARF/PDB facts | reax built-in readers | LLVM tools (differential oracle, plan §1) | Phase 1; no engine |
| Small-range disassembly | capstone wasm (in-process) | llvm-objdump | cheap lane |
| Function disassembly and decompile | Ghidra | Kuna (ELF and thin Mach-O x86-64/AArch64/ARM); rz-ghidra | Kuna `--jobs 1`; record the engine digest in the cache key |
| Xrefs, call graph, call paths | Ghidra | rizin | Coverage scope stated as "provider-observed direct edges" |
| Value tracing | Ghidra (high p-code) | angr (optional, heavy) | Bounded, as rea's limits are (3,000 ops / 12,000 edges) |
| Function matching and diffing | Ghidra FunctionID + BSim (H2) | BinDiff/BinExport (once a Ghidra 12 build exists); rz-diff | ghidriff only as a GPL process |
| Annotations with persistence | Ghidra project under `REAX_HOME/projects/<digest>/ghidra/` | rizin project | set semantics plus read-back (plan §3.5) |
| Navigation and bookmarks | reax session state + `pm_bookmark` | rizin seek history | engine-independent |
| Analysis settings | Ghidra `setAnalysisOption(s)` | rizin `e anal.*` | settings go into the cache key |
| `decompile_all` | Ghidra (job; cannot be preempted) | Kuna `decompile-project` | streamed to blobs, not inline |
| DEX/APK decompile | JADX | androguard DAD | Apktool for resources |
| JVM classes and jars | Vineflower | CFR (no release since 2021; modern Java support **unverified**), JADX | |
| .NET | ilspycmd | built-in ECMA-335 reader (facts only) | |
| Debugger | GDB/MI on Linux; LLDB on macOS | rizin debugger | phase 3, approval-gated (plan §8 C15) |

### 7.2 Per target class

| Target class | Default engine(s) | Cross-check | Debugger | Notes |
|---|---|---|---|---|
| ELF native | Ghidra 12.2 | Kuna; rizin + rz-ghidra | GDB 17.x | LLVM tools as oracle |
| PE native | Ghidra 12.2 | rizin + rz-ghidra (rea's Kuna adapter rejects PE) | LLDB (partial on Windows) or none | Windows sandbox per ADR 0006 |
| Mach-O native | Ghidra 12.2 | Kuna (thin slices only); rizin | LLDB | universal binaries: pick a slice first |
| Android (APK/DEX) | JADX + Apktool | androguard | none in phase 2 (ADB is phase 3) | native `.so` → ELF row |
| .NET | ilspycmd (.NET 10) | built-in metadata reader | none | mixed-mode native parts → PE row |
| JVM | Vineflower | CFR; JADX | none | |
| WASM | built-in reader + WABT (`wasm2wat`, `wasm-decompile`) | wasm-tools | none | Ghidra WASM support needs a third-party extension (version for 12.2 **unverified**) |
| Firmware | unblob/binwalk for extraction, then Ghidra (raw binary with an explicit language and load address) | rizin | none | processor coverage follows SLEIGH |

## 8. Gaps: where no open engine matches

| # | Commercial capability | Closest open option | Why it falls short |
|---|---|---|---|
| G1 | IDA **Lumina** (shared function metadata) and the vendor's FLIRT signature library | Ghidra FunctionID and BSim with local databases; FLIRT `.sig` files used with their licence (plan §5) | No open, hosted, cross-user function-name service exists. reax's knowledge is limited to databases it builds or imports |
| G2 | IDA's **remote and Windows debuggers** from one tool, scriptable through ida-pro-mcp `dbg_*` | GDB (Linux), LLDB (macOS; Windows partial) | No open headless Windows user-mode debugger with a stable scripting API was found. x64dbg is GUI-first, and its licence and status were **not checked** |
| G3 | Hex-Rays **output quality on some architectures**, e.g. the new V850 decompiler in 9.3 (snippet, [release notes](https://docs.hex-rays.com/ida-9.3/release-notes/9_3)) | Ghidra/SLEIGH; Kuna | Per-architecture parity is **unverified**; no head-to-head measurement was found from an independent source |
| G4 | Hopper's **live GUI cursor shared with a human** (C06 changes UI state) | reax session cursor; rizin seek history | The open options are headless. Moving a person's view in a running GUI has no open equal except Ghidra plus a GUI plugin (GhidraMCP), which needs a GUI session |
| G5 | JEB's **Dalvik decompiler with global analysis** and its Android debugger | JADX (+ `--deobf`, mapping files) | JADX covers decompilation. Comparative quality on obfuscated code is **unverified**. No open tool combines Dalvik decompilation and debugging in one engine |
| G6 | JEB's **WebAssembly decompiler** | WABT `wasm-decompile` | wasm-decompile emits a low-level pseudo-syntax, not C-like recovered code with types (**unverified** depth comparison) |
| G7 | JEB's **EVM decompiler**, S7 PLC and Nvidia SASS decompilers | evmole (selectors only, used by rea C29) | No open EVM decompiler was evaluated here. Candidates were not checked (**unverified**). No open S7 or SASS decompiler was found |
| G8 | A persisted **project/unit model with engine-side save** (JEB `save_project`, IDA `idb_save`) driven over MCP | Ghidra project save from the pyghidra worker | Functionally covered, but only through reax's own worker. No open engine offers it over a stable vendor MCP surface (ReVa and GhidraMCP are third-party) |

Not gaps:
- Kuna (it is open).
- .NET (no commercial engine was used, and ILSpy is the reference tool).
- Value tracing (rea already takes it from Ghidra).
- Function comparison (rea's C11 is pure TypeScript).

## 9. Licence handling (plan §0)

reax and core are Apache-2.0. GPL, LGPL and AGPL code runs **only as a separate process** and is never linked.

| Component | Licence | How reax runs it | Notes |
|---|---|---|---|
| capstone (wasm) | BSD-3-Clause | linked in-process | NOTICE entry |
| Ghidra, pyghidra, JADX, Apktool, androguard, Vineflower, Kuna, BinDiff/BinExport, WABT | Apache-2.0 | separate processes (resource isolation, plan §3.7) | NOTICE entries when bundled in images |
| CFR, ilspycmd | MIT | process | |
| LLVM tools, LLDB | Apache-2.0 WITH LLVM-exception | process | |
| OpenJDK 25 (runtime for the JVM engines) | GPL-2.0 WITH Classpath-exception-2.0 (**unverified** for the chosen build; check the vendor's LICENSE) | process | an image that ships it must carry its licence and source pointer |
| rizin, rz-ghidra, radare2 core, r2ghidra | LGPL-3.0-only / LGPL-3.0-or-later | process, over a pipe with reax's own client (no `librz` binding) | r2: build `--without-gpl`, or document its GPL plugins |
| angr | BSD-2-Clause, but pyvex includes GPL-2.0-or-later code; unicorn (optional) is GPL-2.0 | process only; never install the `unicorn` extra in a reax-distributed image unless GPL obligations are met | plan §6 already avoids linking unicorn |
| GDB | GPL-3.0-or-later | process (GDB/MI) | reax parses MI itself |
| Cutter | GPL-3.0-only | not used; rea's `cutter_command` maps to rizin | |
| ghidriff | GPL-3.0 | process only, optional | plan §6 |
| IDA, Hopper, JEB | proprietary | only on a detected licensed install; never bundled, downloaded or activated by reax; fakes in CI | plan §8 `wont` row |

Rules for the real-engine images:
- If the images are pushed to a public registry, that is distribution. GDB, the JDK and any GPL plugin need their licence texts, plus source (or a written offer) in the image.
- Keeping the images in a private GHCR package for CI use only avoids this.
- `third-party.md` lists each component, its licence, the process boundary and the image digest.

## 10. CI plan for `reax-real.yml`

**Triggers.**
- Nightly.
- On changes to `apps/reax/src/engines/**`, `engines.lock` or the image recipes (plan §12).
- Never on PRs from forks, which have no secrets and no self-hosted runners.

**Pinning.**
- One lock file, `apps/reax/engines/engines.lock`. Each entry records name, version, URL, SHA-256, and licence (SPDX).
- Source of the SHA-256: the vendor's published value where there is one (Ghidra release page, radare2 `checksums.txt`, GDB announcement, Maven/NuGet registry hashes). Otherwise, one computed at the first pin and reviewed in the PR (Kuna, JADX, Apktool, rizin).
- LLVM's `.jsonl` sidecars are checked as attestations once their format is confirmed.

**Images.** Built weekly, pushed to GHCR, and referenced **by digest** in the workflow:

| Image | Contents | Approx. size |
|---|---|---|
| `reax-engine-jvm` | Temurin/OpenJDK 25, Ghidra 12.2 (with its pyghidra 3.2.0 wheel and Python 3.13), JADX 1.5.6, Apktool 3.0.3, Vineflower 1.12.0, CFR 0.152 | > 1 GB (Ghidra zip alone is 543 MB) |
| `reax-engine-native` | rizin 0.9.1 static, rz-ghidra 0.9.0 built from its source tarball, Kuna v1.982 (linux-x86_64), LLVM 23.1.4 tools, GDB (Ubuntu 24.04 package at a pinned version, or 17.2 built from source) | **unverified** |
| `reax-engine-dotnet` | .NET 10 runtime + ilspycmd 11.1.0.9782 | **unverified** |
| `reax-engine-py` (optional, weekly only) | androguard 4.1.4, angr 10.0.5 (no `unicorn` extra), hash-locked | **unverified** |

**Caching.**
- Images are pulled by digest, so the runner cache works per digest.
- Ghidra analysis of each fixture is cached in `actions/cache`, keyed by `{image digest, fixture digest, analysis-settings hash}`. The tests then reuse a pre-analysed project; this answers rea #1048, where a cold Ghidra exceeded client deadlines.
- One job runs cold on purpose each night, to measure cold-start time and peak RSS. Those numbers feed the scheduler's starting estimates (plan §3.7) and fill the "not published" cells in §4.2.

**Jobs**, run in parallel on `ubuntu-24.04` (4 vCPU / 16 GB on standard GitHub-hosted runners for public repositories; **unverified** for this org's plan). All times are estimates, not measurements:

| Job | Tests | Est. time |
|---|---|---|
| ghidra | decompile, xrefs, call graph, p-code tracing, annotations surviving a daemon restart, bookmarks, settings, `decompile_all` on the `zig cc` corpus; ReVa differential (pinned to the newest ReVa-supported Ghidra until a 12.2 build exists) | 20–30 min |
| native-cli | rizin/rz-ghidra, Kuna (`--jobs 1`), LLVM differential, GDB/MI session lifecycle | 8–12 min |
| android-jvm | JADX, Apktool, androguard, Vineflower/CFR on generated APK/JAR fixtures | 8–12 min |
| dotnet | ilspycmd on generated assemblies | 3–5 min |
| compare | `compare {engines:[ghidra,kuna]}` and `[ghidra,rizin]` on the same functions; disagreement is kept and labelled, not failed | 5–10 min |
| commercial-fakes | IDA, JEB and Hopper adapters against recorded protocol fakes (`tools/list` plus replies) | < 5 min |
| aggregate | JUnit upload for `parity-check.ts` (plan §2) | < 2 min |

**Wall time.** About 30–40 min nightly, bounded by the Ghidra job; about 70–90 runner-minutes in all (estimate).

**Other lanes.**
- **macOS:** weekly, Ghidra + LLDB on `macos-15` arm64. `macos-14` retires on 2026-11-02 (plan Context).
- **Windows:** weekly, a Ghidra smoke test only.
- **Licensed engines:** an optional manual workflow on a self-hosted runner can exercise IDA, JEB or Hopper. Its results feed the ledger only through the same JUnit path.

## 11. Could not verify

- Hopper's current version (6.5.0 comes only from a Homebrew snippet), its official Linux support beyond rea's docs, its debugger, and its integrated MCP server.
- JEB 5.48's exact date and MCP tool list (snippet and rea's docs only), and the CE decompiler boundary.
- IDA 9.3's date (snippet), whether ida-pro-mcp offers a Dalvik or .NET decompiler, and how analysis settings or `decompile_all` are exposed over MCP.
- GDB 17.2 and whether GDB 18.1 has been released (snippet; sourceware blocked).
- The licence of wasm-tools.
- The licence of the OpenJDK build to be chosen.
- The exact SPDX identifier of radare2's core.
- Whether the LLVM Linux tarball includes `lldb`, and the format of its `.jsonl` sidecars.
- Apktool's runtime minimum Java version.
- BinExport support for Ghidra 12.
- Ghidra's WASM extension for 12.2.
- Kuna's PE support outside rea's adapter.
- All quality comparisons between decompilers: no independent benchmark was read, and DecBench was blocked.
- All cold-start and memory figures, except the Kuna figures quoted from its author and from rea.
- The CI time estimates in §10.

**Blocked hosts:** hopperapp.com, pnfsoftware.com, hex-rays.com, sourceware.org, releases.llvm.org, formulae.brew.sh, en.wikipedia.org, glama.ai, decbench.com. The GitHub REST API was also refused. Release data came from github.com pages and git instead.
