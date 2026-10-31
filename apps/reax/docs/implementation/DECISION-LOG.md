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
