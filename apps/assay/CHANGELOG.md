# Changelog

## How versions are numbered

Assay follows Semantic Versioning, with these meanings.

| Change | Before 1.0 | From 1.0 on |
|---|---|---|
| Something users or integrations rely on breaks: CLI flags, HTTP API, MCP tool names or arguments, claim format, store schema | Minor version | Major version |
| Fix | Patch version | Patch version |

What each contract promises:

- **Store.** Migrations only move forward. An Assay that is older than the store refuses to open it (`store_schema_newer`).
- **Claim format.** The version is in each record (`spec`). New records use `re4exa.claim/2`; `assay.claim/1` records stay readable by every later version.
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
- The sidebar's verdict counts missed the last claim checked in a turn until the page was reloaded (found in a visual run of the demo).
- While an account was still being checked at start-up, the composer said it was signed out. It now says the sign-in is being checked, and Send turns on when the check ends.
- `native.exports` claims about a Linux library with more than 64 exports were always unverifiable, true or false: the ELF reader kept only the first 64 names (PE kept 4,096). All three native readers now keep up to 100,000. Found on LearnHarness's libvips (3,500 exports).
- JSX (in `.tsx`, `.jsx` and `.js`) was read as plain JavaScript: a closing tag such as `</div>` started a regex, the rest of the file was marked "may be misread", and claims about its imports could never be refuted. On LearnHarness that was 94 of 152 `.tsx` files (1,287 entries). The tokenizer now reads JSX, including comments inside tags, and TypeScript's `x! / y`. Hostile JSX-like input stays linear.
- `assay sweep`, `probe`, `export` and `forget` took an option's value for the subject when the option came first (`assay sweep --workspace w pkg` swept `.`; `assay forget --home h id` also tried to delete `h`).
- CLI errors now name what they are about, for example `No such object [not_found] {"case":"case_x"}`.

- **Durable kernel** on SQLite:
  - one process per store;
  - leases with a write fence;
  - intents recorded before effects, with replay policies;
  - receipts, sequenced topics, a mailbox, budgets, usage;
  - a hash-chained case log that can be forked.
- **S-2 claim records** with ProbeKey, ObservationId and FindingKey; honest coverage; revisioned unknowns; calibration.
- **Model-free probes** for files, archives, packages, JavaScript loading forms, endpoints, ELF, PE, Mach-O and wasm, plus leanrea's router as data.
- **A verifier** that re-runs `seen` claims, using 12 predicates. These include `native.arch` and `native.exports`, checked with core's own readers.
- **reax inside Assay**: reax's read-only operations are probes (`reax.identify.file`, `reax.inventory.native`), and the **Examine a binary** recipe uses them. The demo runbook is `docs/demo-0.1.0.md`.
- **Policy**: untrusted-content envelopes, session taint, approvals, secret redaction.
- **MCP server** over HTTP with bearer tokens, plus a stdio proxy.
- **Providers**: Claude Agent SDK, codex app-server and ACP, all through delegated sign-in; and a fake provider for tests and demos.
- **Coordinator and workers**: worktrees, mailbox, circuit breaker, depth 1, receipts, recovery after a crash.
- **Web UI in Orca's layout**: chat, worker tree, approvals, evidence inspector, palette and wizard.
- **Exports**: S-2 JSONL, SARIF, CycloneDX, Markdown (each claim with its verdict and the reason), signed bundles with `assay verify --bundle`.
- **`assay cases`** lists cases with their claims counted by verdict.
