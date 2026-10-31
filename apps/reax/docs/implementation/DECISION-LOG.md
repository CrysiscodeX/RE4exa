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
