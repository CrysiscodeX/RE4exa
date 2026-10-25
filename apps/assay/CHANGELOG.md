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

Fixed before release. These were found by two independent RQS-2030 reviews and reproduced before fixing:
- The verifier marked "app.js does NOT use eval" verified, because it checked only the predicate. A claim whose text negates its predicate is now unverifiable; `negate: true` checks an absence.
- External-tool probes marked `consent: approval` ran without asking, with Assay's full environment. They now ask every time and get the allow-listed environment. `@electron/asar` is pinned.
- A write to `docs/hooks/x`, where `docs` links to `.git`, landed in `.git/hooks`; `.GIT/` was also accepted. Both are refused.
- `assay verify --bundle` accepted a bundle re-signed with any key. It now reports integrity only and exits 3 unless `--key` is given. `assay key` prints the public key.
- Output of commands the verifier re-ran was stored unredacted. It is now redacted, and the command gets the allow-listed environment.
- `assay sweep --json` piped into another program was cut at 64 KiB.
- Worker reports reached the coordinator outside the untrusted-content envelope.
- `assay_release_worker` was declared read-only.
- Approval cards cut arguments at 2,000 characters. They now show up to 256 KiB, and say when they show less.
- Workers had no spend cap; they now get what is left of the case budget.
- The live benchmark graded the two arms differently and read its baseline from outside the repository.

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
