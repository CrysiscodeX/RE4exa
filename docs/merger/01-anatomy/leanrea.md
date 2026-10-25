# 01 Anatomy: leanrea

Advocate: A-leanrea. Source: `aicodeking/leanrea` at `09ba4aa0217f82cd880f855a60b877f59f39b22b` (2026-10-17), MIT, © 2026 AICodeKing (leanrea:LICENSE:1-3). All `leanrea:` citations are at that commit. `rea:` citations are at `b4938aed` (rea-agents 6.7.0, rea:package.json). leanrea's benchmark used rea-agents 6.5.0 (leanrea:bench/setup.sh:15), so any check against the rea clone is a check against a later version.

Labels: **[seen]** read in code or docs; **[inferred]** reasoned from what was seen; **[unknown]**. Review findings from `research/rqs-review/reports/leanrea.md` are used only after a re-check against the source. The review's COR-4 evidence rests on an excluded directory and is not used here.

## 1. What it really is

[seen] leanrea is one Markdown file of 8,374 bytes and 66 lines (leanrea:leanrea/SKILL.md:1-66) plus a benchmark folder of about 120 lines of shell and Python (leanrea:bench/). The file is a prompt. It contains no code that runs by itself and no tool definitions. It gives the agent a few working rules, an 18-row table that maps an artifact type to the command to run first, two copy-and-run recon one-liners, and a list of known traps. The agent then runs ordinary local tools through its own shell (leanrea:leanrea/SKILL.md:8, leanrea:README.md:5). [seen] The README frames it as a replacement for REA (leanrea:README.md:3), and the benchmark compares it with REA's MCP server and with no skill at all (leanrea:bench/BENCHMARK.md:5-9). [inferred] It is best read as condensed expert knowledge about which command answers which question cheaply, written for a model that already knows the tools. It has no state, no evidence store, no integrity checks and no safety boundary of its own. Whatever rules it states depend on the model following prose.

## 2. Organs

Summary (records follow):

| # | Organ | One job | Verdict |
|---|---|---|---|
| L1 | Activation frontmatter | Let a host decide when to load the skill | pattern |
| L2 | Attention and turn-budget rules | Keep tool output and turn count small | adapt |
| L3 | Workspace convention | Put extractions on a copy, in a per-target folder, and reuse them | pattern |
| L4 | Evidence labels (seen/inferred/unknown) | Make each answer claim state its basis | pattern (wording: lift) |
| L5 | Router: `file`/magic detection plus 18-row command table | Map an artifact type to the cheapest first command | adapt |
| L6 | First-move recon one-liners | Collect a whole inventory in one shell call | adapt |
| L7 | Trap catalogue and speed patterns | Pass on known pitfalls and search heuristics | lift (text, with notice) |
| L8 | Runtime and dynamic-analysis row | Point to attach/launch tools | leave |
| L9 | Install line | List tool installs | leave |
| L10 | Benchmark harness (run.py, run_all.sh, tasks.json) | Run arms × tasks × reps and grade answers by regex | adapt |
| L11 | Context-overhead probe and MCP sizer (ctx.sh, mcp_list.py) | Measure what a skill or MCP server costs in context | adapt |
| L12 | Committed results (final.jsonl, BENCHMARK.md) | Evidence for the claims | leave (cite only) |
| L13 | Packaging and distribution | Install via skills CLI, manual copy or paste | pattern |

Licence for every organ: MIT, © 2026 AICodeKing (leanrea:LICENSE:1-3). A lift keeps that notice. [seen] README credits REA as the source of "most of the gotchas" and states no code was copied (leanrea:README.md:111). REA is MIT too (sources.md:9), so no licence conflict follows [inferred].

### L1 Activation frontmatter
- **Function** [seen]: YAML `name` and a `description` that lists target types and uses (leanrea:leanrea/SKILL.md:1-4). Hosts use it to choose the skill.
- **Interfaces**: SKILL.md frontmatter convention; slash invocation `/leanrea` (leanrea:README.md:73).
- **State and lifecycle**: none. Loaded into context when invoked; [seen] +3.1k tokens measured for a trivial prompt (leanrea:bench/BENCHMARK.md:60), raw output not committed.
- **Depends on**: a host that supports skills, or manual pasting (leanrea:README.md:69).
- **RQS**: INT-1 = 2, INT-2 = 2 (confirmed: no version field, output contract in prose only, leanrea:leanrea/SKILL.md:1-4,16).
- **Carried defects**: no version, no platform scope (the description claims coverage of PE, ELF, firmware and websites, leanrea:leanrea/SKILL.md:3, but only macOS targets were benchmarked).
- **Verdict**: pattern. A merged product needs a description generated from its real capability list, with platform and version.

### L2 Attention and turn-budget rules
- **Function** [seen]: never `cat` large or minified files, slice with `rg -o '.{0,200}NEEDLE.{0,200}'`, dump disassembly once and grep the file (leanrea:leanrea/SKILL.md:14); batch independent probes into one call with `echo '--- name'` markers and cap output with `head`/`-m` (:15); "Turns cost more than bytes", aim for 2-4 tool calls, stop when each asked item has evidence (:18).
- **Interfaces**: prose only.
- **State and lifecycle**: none. [seen] Nothing enforces the budget. [seen] In the 12 committed leanrea runs, logged tool calls ranged 1-6 (turns 2-7), and more than 4 tool calls occurred in 5 of 12 runs (leanrea:bench/results/final.jsonl:1-36, counted).
- **Depends on**: model compliance; `rg`, `head`.
- **RQS**: PERF-2 = 3, REL-2 = 3, AGT-6 = 3 (confirmed for the rule text; not measured for compliance).
- **Carried defects**: prose cannot block an uncapped command. The `echo '--- name'` advice mentions zsh (:15), a macOS-default assumption [inferred].
- **Verdict**: adapt. Keep the rules; enforce output caps and call counts in the product's tool layer or host hooks, not in prose.

### L3 Workspace convention
- **Function** [seen]: work on a copy (`cp -c`, APFS clone), one directory per extraction under `$TMPDIR/re/<name>`, reuse if present (leanrea:leanrea/SKILL.md:11). The Electron move resets it with `rm -rf $X` (:29).
- **Interfaces**: filesystem paths.
- **State and lifecycle**: [seen] directories are never cleaned up and carry no record of what produced them, from which input, or whether they are complete. "Reuse an extraction if one exists" (:11) and "reset before reuse" (:29) contradict each other for the Electron case [seen].
- **Depends on**: macOS APFS for `cp -c`; `$TMPDIR` set (macOS sets it; many Linux hosts do not [inferred, general knowledge]).
- **RQS**: REL-1 = 2, INT-5 = 3 (confirmed for the text).
- **Carried defects**: with `$TMPDIR` unset, `X=$TMPDIR/re/asar; rm -rf $X` targets `/re/asar` (:29) [seen in text; consequence inferred]. Variables are unquoted, so a path with spaces such as `Foo App.app` splits (:23,:29) [inferred]. Reuse by name, not by content hash, can reuse a stale extraction of a different build [inferred].
- **Verdict**: pattern. The idea (copy first, one folder per target, reuse) is right; a merged product should key work folders by content digest and record provenance. rea already has content-addressed artifact graphs (rea:src/contracts/artifactToolContracts.ts:83).

### L4 Evidence labels
- **Function** [seen]: "mark each claim as seen (cite file:offset, or a symbol/string) or inferred. A fact you did not find is unknown, not absent. Static reading is not observed execution." (leanrea:leanrea/SKILL.md:16). Plus the coverage trap that makes "not found" unreliable: `rg` hides dot-folders, so search with `rg -uu` (:13).
- **Interfaces**: answer prose.
- **State and lifecycle**: none; labels exist only in the final text.
- **Depends on**: model compliance.
- **RQS**: EPI-2 = 3, EPI-3 = 3, REL-3 = 3, EPI-1 = 2 (confirmed: rule present; no record of target identity, skill version or tool versions).
- **Carried defects**: [seen] the benchmark never grades labels; tasks.json has no key for them (leanrea:bench/tasks.json:1-50). [unknown] how often agents apply them or label correctly. No rule to state what was not examined (EPI-4 = 2, confirmed).
- **Verdict**: pattern, with the sentence at :16 lifted as wording. A merged product should store the label as a field on each finding, next to the ledger entry, and test it.

### L5 Router
- **Function** [seen]: step order "route by `file -b T` and the magic bytes first, cheapest inventory next, decompile last" (leanrea:leanrea/SKILL.md:12), then an 18-row table (:36-55): Electron/asar, web bundle and source maps, Hermes/bytenode/V8 snapshot, Mach-O, native code logic, ELF/PE, Go, Rust, .NET, Android APK, Flutter snapshot hash, WASM, SQLite, plist/nib/car, pcap/HAR, firmware, website, running app.
- **How much is magic-byte routing** [seen]: only two magic values are given, Hermes `c6 1f bc 03` (:40) and Flutter/Dart `f5 f5 dc dc` (:48), plus section names for Go (`__go_buildinfo`, `.go.buildinfo`, :44) and Rust (`.dep-v0`, :45). Everything else is routed by `file(1)` output or by path pattern (:38,:41,:46,:47). [inferred] Detection is delegated to libmagic; the table is a command map more than a detector.
- **Interfaces**: Markdown table; commands are in inline code spans.
- **State and lifecycle**: none.
- **Depends on**: per row: `npx`/Node, `jq`, `rg`, Xcode tools, binutils, Go, cargo-audit, ilspycmd/.NET, jadx, apktool, WABT, sqlite3, plutil/assetutil, tshark, binwalk/unblob, Ghidra or r2, curl, Playwright, lldb/dtrace, adb/frida.
- **RQS**: INT-3 = 3 (confirmed). The review's "machine-readable router table" opportunity (report:128) is consistent with what I see.
- **Carried defects**:
  - [seen] Pipes inside table code spans are written `\|` (:38,:41,:42,:44,:45,:52). Copied raw into a shell, `\|` is a literal argument, not a pipe [inferred]. Whether models unescape it reliably is [unknown].
  - [seen] Nine rows were never exercised by the benchmark (it covers Electron, Mach-O native code and Go only, leanrea:bench/tasks.json:3,14,28,38).
  - [unknown] Correctness of several commands was not checked here, for example the Ghidra `-postScript DecompileAll.java` script name (:42) and "32 hex chars at +20" for the Flutter snapshot hash (:48). The Hermes and Dart magic values match the formats as I know them [inferred, not checked on a file].
  - [seen] Rows that run network or remote code: `npx -y` (:38,:39), `curl -sL URL` (:54).
- **Verdict**: adapt. Convert to data (detect rule, command, fallback, output cap, platform, network yes/no, needs-consent yes/no), test each row against a fixture, render the prose from the data. This is leanrea's highest-value organ for transplant.

### L6 First-move recon one-liners
- **Function** [seen]: Mach-O first move: `file`, `lipo -info`, `otool -L`, exports `nm -gU | head -150`, imports `nm -u`, `strings -a -n 6 | head -400`, full disassembly to a file, function labels (leanrea:leanrea/SKILL.md:23); a one-function reader with `awk` (:25). Electron first move: asar extract, `jq` on package.json, file list, unpacked addons, `exposeInMainWorld` search (:29) and a needle slicer (:31). Go: `go version -m` (:33).
- **Interfaces**: copy-and-run shell lines in fenced blocks.
- **State and lifecycle**: writes `$D/dis.txt` and `$X`; no cleanup.
- **Depends on**: macOS (lipo, otool, `nm -gU` BSD semantics, xcrun) for the native line; Node/npx, jq, rg for Electron.
- **RQS**: INT-6 = 2, EVO-3 = 1 (confirmed: native line is macOS-only and this is not stated).
- **Carried defects**: [seen] no Linux or Windows first move. [seen] up to roughly 700 lines (estimate from the `head` caps) of target-derived text (exports, imports, strings, labels) enter the context in one call (:23); no rule says that text is data. [seen] unpinned `npx -y @electron/asar` (:29). [inferred] the benchmark shows the lines were used verbatim in some runs: tool logs begin `T=./mac_utils.node;` or `A=./app.asar;` (leanrea:bench/results/final.jsonl:4,25,28), but most runs log only `Bash:cd`, so actual commands are [unknown].
- **Verdict**: adapt. Keep the "one batched inventory call per artifact type" pattern; generate per-platform lines from the L5 data, quote variables, default the work directory, pin packages.

### L7 Trap catalogue and speed patterns
- **Function** [seen]: specific traps: bundlers hide code in `.webpack/`, `.vite/` (leanrea:leanrea/SKILL.md:13); `app.asar.unpacked/` holds `.node` addons (:38); app-specific IPC wrappers hide channel names, so also grep `"ns:verb"` strings (:38); fuses gate `--inspect` (:55); bytenode `.jsc` cannot be decompiled (:40); NativeAOT and IL2CPP are native (:46); copy the SQLite `-wal` file and open read-only (:50); Go symbols survive stripping (:44); "unknown is not absent" (:16). Speed patterns: strings and imports first; find a string's user via otool literal-pool comments; read call sequences, not every instruction; go from the native/JS boundary inward; diff inventories before code; rebuild then test against the original (:57-63).
- **Interfaces**: prose.
- **State and lifecycle**: none.
- **Depends on**: nothing beyond the tools named.
- **RQS**: no criterion scores this directly; EPI-3 = 3 covers the hidden-folder trap (confirmed).
- **Carried defects**: [inferred] the literal-pool trick (:59) is specific to `otool -tV` output on Mach-O. [seen] none of the traps is tested.
- **Verdict**: lift (with the MIT notice) as content for the merged product's guidance or tool descriptions. It is short, specific and cheap to carry.

### L8 Runtime and dynamic-analysis row
- **Function** [seen]: `lldb -p PID`, `dtrace`, `fs_usage`, `log stream`, Electron `--inspect`, `adb logcat`, `frida -U -f pkg -l hook.js` (leanrea:leanrea/SKILL.md:55); headless browser for websites (:54).
- **State and lifecycle**: [seen] starts or attaches to processes with no consent step, no stop or cleanup guidance.
- **RQS**: AGT-2 = 2, AGT-3 = 2, SEC-7 = 2, REL-4 = 2 (confirmed against :55).
- **Carried defects**: running an untrusted target on the analyst's host; no isolation, no approval gate.
- **Verdict**: leave. A merged product needs a gated, sandboxed runtime layer; this row offers only names of tools.

### L9 Install line
- **Function** [seen]: `brew install ...`, `npm i -g @electron/asar`, `dotnet tool install -g ilspycmd`, `cargo install cargo-audit`, "only on request" (leanrea:leanrea/SKILL.md:65-66); missing tool falls back or asks before `brew install` (:17).
- **RQS**: SEC-2 = 1 (confirmed: no versions; the benchmark pins `rea-agents@6.5.0 --ignore-scripts`, leanrea:bench/setup.sh:15, the skill does not).
- **Verdict**: leave. The consent rule is worth keeping as a pattern; the unpinned list is not.

### L10 Benchmark harness
- **Function** [seen]: `run.py` runs one cell: copies targets into a fresh workspace (leanrea:bench/run.py:10-14), runs `claude -p` headless with stream-json, `--strict-mcp-config`, `--max-budget-usd 4`, allowed tools `Bash,Read,Grep,Glob,Write,Skill,mcp__rea` (:15-17), installs the arm's skill and MCP config (:19-26), times the subprocess (:27-29), parses the result event and tool_use names (:31-42), grades the final answer text with case-insensitive regex keys (:43-44), writes one row (:46-51). `run_all.sh` runs the three arms of each task concurrently, then waits (leanrea:bench/run_all.sh:5-7). `tasks.json` holds 4 prompts and hand-made keys (leanrea:bench/tasks.json:1-50). `setup.sh` copies Notion's `app.asar`, `app.asar.unpacked`, `mac_utils.node` and Homebrew `gh` (leanrea:bench/setup.sh:7-14).
- **Interfaces**: CLI (`python3 -I run.py <arm> <task> <rep>`), env `LEANREA_WORK`, `BENCH_MODEL`, `REPS`; JSONL out.
- **State and lifecycle**: one workspace and one answer JSON per cell under the gitignored `bench/work/` (leanrea:bench/run.py:50, leanrea:.gitignore:1).
- **Depends on**: macOS (`cp -c`, `cp -cR` at leanrea:bench/run.py:13-14), Notion.app installed, `gh`, Node, Claude Code logged in (leanrea:README.md:99).
- **RQS**: PUR-2 = 3, COR-2 = 2, COR-3 = 0, COR-5 = 2, AGT-4 = 2 (confirmed below).
- **Carried defects**:
  - [seen] Lenient keys: `"hash": "hash"`, `"sock": "\\.sock"`, `"json": "JSON"` pass any answer that mentions the word (leanrea:bench/tasks.json:43,45,48). No key is checked against a known-wrong answer.
  - [seen] A timeout raises `TimeoutExpired` from `subprocess.run` (leanrea:bench/run.py:28) with no handler, so a timed-out cell writes no row [inferred: such cells would silently drop out of the results].
  - [seen] With no `result` event, the "answer" becomes the last 2,000 characters of raw stdout and stderr (:30) and is still regex-graded (:43-44). Raw stream-json includes tool output, so a target's own strings could satisfy a key [inferred]. It is flagged `err: true`; all 36 committed rows have `err: false` (leanrea:bench/results/final.jsonl:1-36), so this did not affect the committed data [seen].
  - [seen] Tool logging keeps only the first word of a Bash command (:42), so most rows say `Bash:cd`; the commands an arm ran cannot be reconstructed.
  - [seen] Arms run concurrently on one machine (leanrea:bench/run_all.sh:6); [inferred] CPU and API contention can shift wall times between arms.
  - [seen] Grading reads only the final message; nothing grades the seen/inferred/unknown labels or the citations.
- **Verdict**: adapt. The shape (fresh copy per cell, headless agent, budget cap, per-run JSONL with cost, turns, tokens and tool list) is reusable for evaluating a merged product. Fix: interleave arms, at least 5 reps, self-test every key with good and bad answers, record timeouts as failures, commit answers or their hashes, log full commands, record skill commit and target digest per row.

### L11 Context-overhead probe and MCP sizer
- **Function** [seen]: `ctx.sh` sends "Reply with exactly OK." under five configurations and reports cost and input + cache tokens (leanrea:bench/ctx.sh:8-15), including `ENABLE_TOOL_SEARCH=false` (:15). `mcp_list.py` speaks MCP over stdio, pages `tools/list`, and reports tool count and byte sizes of definitions, input schemas, output schemas, descriptions and instructions (leanrea:bench/mcp_list.py:13-25).
- **Interfaces**: shell, MCP JSON-RPC over stdio, writes `rea_tools.json` to the working directory (:24).
- **Depends on**: Claude Code, jq, Python 3.
- **Carried defects**: [seen] `recv` exits on EOF (:10) before `p.kill()` (:21); stderr discarded (:5); no timeout on `readline` [inferred: a server that never answers hangs the script]. Raw outputs of both scripts are not committed (review "Not examined", confirmed: no such files in leanrea:bench/results/).
- **Verdict**: adapt. `mcp_list.py` is a generic, 25-line way to measure the context weight of any MCP server; a merged product with an MCP face should run it in CI against a size budget.

### L12 Committed results
- **Function** [seen]: 36 rows: arms `lean`, `none`, `rea`; tasks electron, native, go, deep; reps 11-13 (leanrea:bench/results/final.jsonl:1-36). BENCHMARK.md tabulates them (leanrea:bench/BENCHMARK.md:16-39).
- **Carried defects**: [seen] the committed file is not the output of the committed harness: `run.py` writes the arm name as given, `leanrea` (leanrea:bench/run.py:46, :24), but the file says `lean` (acknowledged at leanrea:bench/BENCHMARK.md:7); `run_all.sh` numbers reps from 1 (leanrea:bench/run_all.sh:5) but the file has 11-13; one tool string contains a `<work>` placeholder (leanrea:bench/results/final.jsonl:17), so paths were edited after the run. [unknown] whether other reps were run and dropped.
- **Verdict**: leave. Cite as evidence of one experiment; do not build on it.

### L13 Packaging and distribution
- **Function** [seen]: `npx skills add aicodeking/leanrea` with agent and scope flags; `npx skills update`; manual `git clone` and copy; paste into any agent's rules (leanrea:README.md:50-69).
- **RQS**: EVO-1 = 0, EVO-2 = 0, SEC-3 = 1, OPS-4 = 2 (confirmed: no tags, no changelog, no version; update pulls the head).
- **Carried defects**: users cannot pin a known-good version except by manual clone at a commit.
- **Verdict**: pattern. "Install as a plain-text skill into any agent, no server" is a real distribution advantage; a merged product should ship its guidance this way too, but versioned and signed.

## 3. Environmental assumptions, blind spots, untrusted content

**Environment** [seen unless marked]:
- macOS: `cp -c` APFS clones (leanrea:leanrea/SKILL.md:11; leanrea:bench/run.py:13-14), lipo, otool, `nm -gU`, xcrun dyld_info and swift-demangle, codesign (:23,:41), plutil, assetutil (:51), lldb, dtrace, fs_usage, `log stream` (:55), Homebrew (:17,:66), zsh (:15). The benchmark ran only on macOS arm64 (leanrea:bench/BENCHMARK.md:3).
- `$TMPDIR` is set (:11,:23,:29). [inferred] Often unset on Linux; then paths start at `/re/`.
- `rg` and `jq` are present; no fallback is given for either (:13,:29). [unknown] whether a given host puts `rg` on PATH.
- Network access for `npx -y` (:29,:38,:39) and `curl` (:54).
- A capable model that already knows the tools (:8; leanrea:README.md:46 concedes "the plain model is already good at this").

**Blind spots** [seen unless marked]:
- No Linux or Windows first move; ELF/PE have one row each (:43).
- No integrity check on archives. [seen] REA fails closed on an asar integrity mismatch by default (rea:src/cli/artifactCommands.ts:199-201, rea:src/contracts/artifactToolContracts.ts:83). leanrea's benchmark reports this as a failure of REA (leanrea:bench/BENCHMARK.md:73); [inferred] it is a deliberate safety default, and the raw `asar extract` path skips the check entirely.
- No persistence across sessions: no record of what was examined, by which command, on which input digest. Answers are the only output.
- No coverage accounting: the stop rule is "every asked item has evidence" (:18), not "here is what was not examined".
- No legal or authorised-use note (review PRV-4 = 0, confirmed by search of README.md and SKILL.md).
- [seen] Nothing about large inputs beyond output caps; the `otool -tV > dis.txt` dump (:23) runs on the whole binary regardless of size.

**Untrusted content** [seen]: the skill routes third-party strings, minified bundle slices, web pages and capture contents into the agent's context (:23,:31,:52,:54) and gives no rule that this text is data and never instructions. `grep -n -i -E 'untrusted|inject|instruction'` over SKILL.md matches only line 60, where "instruction" means a machine instruction (re-run for this file). Extractors and parsers (`binwalk -e`, `unblob -e`, jadx, apktool, :47,:53) and runtime attach/launch (:55) run on the host without sandbox or consent. The only protections are "work on a copy" (:11) and read-only SQLite (:50). The benchmark has no injection case (leanrea:bench/tasks.json:1-50). This confirms the review's high gap (report:112) and AGT-1 = 1, SEC-8 = 1. [inferred] For a merged product this is the largest single reason not to transplant leanrea's commands without a tool layer around them.

## 4. The benchmark

**What it measured** [seen]: for each run, wall time of the `claude -p` subprocess, `num_turns`, `total_cost_usd`, tokens = input + cache-write + cache-read + output, regex score of the final answer, and the list of tool names (leanrea:bench/run.py:27-49). Host Claude Code 2.1.301, model Sonnet 5.5, macOS arm64, REA 6.5.0 with deferred tool search (leanrea:bench/BENCHMARK.md:3,76).

**Sample** [seen]: 3 arms × 4 tasks × 3 reps = 36 runs (leanrea:bench/results/final.jsonl:1-36), on 3 targets from 2 sources (Notion's asar and native addon, Homebrew `gh`; leanrea:bench/setup.sh:7-14). One model, one host, one machine, one date (2026-10-16).

**Do the numbers reproduce from committed files?** Recomputed for this document from final.jsonl [seen, my computation]:

| arm | wall s (sum) | cost $ | turns | tokens M | raw score |
|---|---|---|---|---|---|
| lean | 387.7 | 2.168 | 55 | 2.402 | 74/75 |
| none | 478.8 | 2.207 | 81 | 3.111 | 66/75 |
| rea | 627.4 | 3.357 | 124 | 5.931 | 75/75 |

These match leanrea:bench/BENCHMARK.md:37-39 and leanrea:README.md:20-22, except that "none" is 66/75 raw; BENCHMARK.md reports 67/75 after a hand correction of one go answer (leanrea:bench/BENCHMARK.md:41; leanrea:bench/results/final.jsonl:19). Per-task medians and means also match (leanrea:bench/BENCHMARK.md:20-31). The context-overhead and tool microbenchmark tables (leanrea:bench/BENCHMARK.md:57-73) have no committed raw data and are **unconfirmed**. The "one refusal" on none/deep (leanrea:bench/BENCHMARK.md:30) is **unconfirmed**: the row shows 0/8 in 5 turns with `err: false` (leanrea:bench/results/final.jsonl:22), but answers are not committed. The 74/75 miss reason ("named the v1 channel", leanrea:README.md:24) is likewise unconfirmed; only `miss: ["event ch"]` is visible (leanrea:bench/results/final.jsonl:25). Running the harness again needs macOS, Notion 7.35.1 and a `gh` built with go1.27.1 (leanrea:bench/setup.sh:18); I did not run it.

**Uncertainty** (estimate; my paired bootstrap over the 12 task×rep cells, 10,000 resamples, ratio of sums, 95% interval):
- lean/rea: wall 0.62 [0.49, 0.78], cost 0.65 [0.58, 0.71], turns 0.44 [0.37, 0.51]. leanrea was faster and cheaper than REA in all 12 paired cells [seen, counted].
- lean/none: wall 0.81 [0.62, 1.04], cost 0.98 [0.87, 1.13], turns 0.68 [0.56, 0.85]. Only the turn reduction excludes "no change". The review reports 0.87 [0.70, 1.05] for wall with a different method; both include 1.

**Details that change the reading** [seen unless marked]:
- 81% of leanrea's and 89% of REA's counted tokens are cache reads [my computation from final.jsonl]. "60% fewer tokens" is mostly cheap cached input; the 35% cost difference is the better measure.
- REA's MCP tools were called 17 times out of 112 tool calls in the REA arm; 2 of 12 REA runs called no REA tool at all (leanrea:bench/results/final.jsonl:15,30). Most REA-arm work was Bash. Two REA runs read Claude Code transcript files under `~/.claude/projects` (leanrea:bench/results/final.jsonl:21,33) and one ran `python3` four times after REA calls (:27). [inferred] Much of REA's extra cost came from handling large tool results and from the longer REA skill steering the agent, not from REA's tools being slow per call. [unknown] which share is which.
- With deferred tool search, REA's context overhead was +3.5k tokens against leanrea's +3.1k (leanrea:bench/BENCHMARK.md:60-61, unconfirmed raw). The large gap (+369k) appears only with tool search off (:63). [inferred] On hosts that load tools on demand, "heavy MCP costs context" is mostly not true at rest; the cost appears per call, in result size.
- The microbenchmark compares REA building a content-addressed, integrity-checked graph (rea:src/contracts/artifactToolContracts.ts:83) with a bare extract plus grep (leanrea:bench/BENCHMARK.md:73). [inferred] They do different work; the timing shows the price of REA's extra guarantees, not waste alone.
- Lenient keys (leanrea:bench/tasks.json:43,45,48) mean "same accuracy" is accuracy on keywords.

**What it proves** [inferred]: for short, single-question tasks on known macOS artifact types, with one strong model, a 66-line prompt plus Bash reached the same keyword-level answers as REA-plus-skill in less time, money and turns, and that result held in every paired cell. It also shows the bare model already does most of this work; the skill's measurable gain over no skill is fewer turns, not lower cost.

**What it does not prove** [inferred]: that leanrea "does what REA does" (leanrea:README.md:3). No task tests provenance, reproducible evidence records, integrity checking, resumption across sessions, multi-step investigations, large or adversarial targets, Linux/Windows, other models, or the accuracy of seen/inferred/unknown labels. It says nothing about thin-skill against heavy-MCP designs where the value is durable state or checkable evidence rather than the first answer. n=3 per cell, one model and one date cannot separate leanrea from no skill on wall time.

## 5. What leanrea should and should not contribute

**Should contribute** (argued for):
1. **The router as data** (L5, adapt). It is the most compact statement in the four repos of "for this artifact type, this is the cheapest command that answers most questions". Turned into a tested table, it can drive the first step of any merged design: a cheap triage pass before any heavy tool or durable workflow starts. [inferred]
2. **The trap catalogue and speed patterns** (L7, lift). Short, specific, licence-clean, and each line saves a turn or a wrong "absent" conclusion. [inferred]
3. **The attention discipline** (L2, adapt) as enforced limits on tool output size and call counts. The benchmark's turn reduction against both other arms is the one effect that survives the uncertainty estimate. [seen, estimate above]
4. **The evidence-label vocabulary** (L4, pattern). The same three words this brainstorm uses. A merged product should make them fields on stored findings, which leanrea cannot do alone.
5. **The evaluation harness shape and MCP sizer** (L10, L11, adapt). A merged product will need to show it beats "skill plus Bash" on cost per answer; leanrea's harness is the natural baseline arm, and keeping that arm honest is a design discipline in itself.
6. **The distribution model** (L13, pattern): a plain-text skill that installs into any agent with no server. The thin entry point should stay available even if a heavier core exists behind it.

**Should not contribute** (conceded):
1. **Its commands as-is.** They are macOS-first, use unquoted variables and an unset-able `$TMPDIR`, contain markdown-escaped pipes, and pull unpinned packages (L3, L5, L6, L9).
2. **Its trust model.** It has none: no untrusted-content rule, no sandbox, no consent before launching targets (section 3). Any transplant must sit behind the product's tool layer and approval gates (charter guardrail "agents start with approvals on").
3. **Its claim of equivalence with REA.** The benchmark does not support it (section 4). leanrea has no evidence ledger, no integrity checks, no durable state and no reproducibility record; on those jobs it contributes nothing, and rea, pi durable and absurd are the relevant donors.
4. **Its committed results as proof.** They are not the committed harness's output and cannot be audited (L12).
5. **Its runtime row** (L8). Naming lldb and frida is not a design for safe dynamic analysis.

**Honest position for the debate** [inferred]: leanrea's main contribution is a constraint, not a component. Any merged product has to beat "a strong model, Bash and 8 KB of notes" on cost and time for first answers, or route first answers through exactly that path. It should not be asked to carry provenance, durability or safety, because it has none of them.
