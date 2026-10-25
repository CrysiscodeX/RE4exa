# Changelog

## How versions are numbered

Assay follows Semantic Versioning, with these meanings.

| Change | Before 1.0 | From 1.0 on |
|---|---|---|
| Something users or integrations rely on breaks: CLI flags, HTTP API, MCP tool names or arguments, claim format, store schema | Minor version | Major version |
| Fix | Patch version | Patch version |

What each contract promises:

- **Store.** Migrations only move forward. An Assay that is older than the store refuses to open it (`store_schema_newer`).
- **Claim format.** The version is in each record (`spec`). `assay.claim/1` records stay readable by every later version.
- **Migration guides.** Every breaking change ships with one, in this file.

## 0.1.0 (unreleased)

The first version.

- **Durable kernel** on SQLite:
  - one process per store;
  - leases with a write fence;
  - intents recorded before effects, with replay policies;
  - receipts, sequenced topics, a mailbox, budgets, usage;
  - a hash-chained case log that can be forked.
- **S-2 claim records** with ProbeKey, ObservationId and FindingKey; honest coverage; revisioned unknowns; calibration.
- **Model-free probes** for files, archives, packages, JavaScript loading forms, endpoints, ELF, PE, Mach-O and wasm, plus leanrea's router as data.
- **A verifier** that re-runs `seen` claims, using 10 predicates.
- **Policy**: untrusted-content envelopes, session taint, approvals, secret redaction.
- **MCP server** over HTTP with bearer tokens, plus a stdio proxy.
- **Providers**: Claude Agent SDK, codex app-server and ACP, all through delegated sign-in; and a fake provider for tests and demos.
- **Coordinator and workers**: worktrees, mailbox, circuit breaker, depth 1, receipts, recovery after a crash.
- **Web UI in Orca's layout**: chat, worker tree, approvals, evidence inspector, palette and wizard.
- **Exports**: S-2 JSONL, SARIF, CycloneDX, Markdown, signed bundles with `assay verify --bundle`.
