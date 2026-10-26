# 0004 The engine moves to a shared package; claims are written as `re4exa.claim/2`

**Status:** accepted (2026-10-26).

**Decision.**
- The kernel, evidence records, probes, verifier, policy, path and handle utilities, the vendored process host and the base failure codes move to `packages/core` (`@re4exa/core`). Assay and reax both build on it. Assay keeps its providers, accounts, orchestrator, server, MCP server and registry, exports and UI.
- New claim records are written with spec `re4exa.claim/2`. Records written as `assay.claim/1` are still read and still verify.
- The producer **id** (`assay-runner`, `reax-runner`, …) stays outside the observation-id hash, as it already was; only the producer **kind** is hashed.
- Apps add their own failure codes with `defineFailureModes`, declared for the type checker by augmenting `AppFailureCodes`.

**Why.**
- Two apps carrying their own copies of the engine would drift. The coverage review found exactly this risk.
- The spec string is part of the observation-id hash (`semantic()` in `packages/core/src/evidence/record.ts`). A record therefore hashes its own `spec`, and a legacy record verifies under the spec it was written with. No re-keying is needed for the records to stay valid.
- Assay 0.1.0 is unreleased, so no deployed stores or bundles exist that would need an alias table from old ids to new ones. If a store with `assay.claim/1` evidence is later merged with new evidence of the same observation, the two records have different ids. Deduplicating them would then need an alias table keyed by `(probe_key, result digest)`. That is recorded as debt, not built.

**Consequences.**
- Ids of new records differ from ids the same observation had under `assay.claim/1`.
- From a source checkout, Node must run with `--conditions=source` so `@re4exa/core` resolves to TypeScript. `scripts/with-source.mjs` sets it for tests and their children; `bin/assay.mjs` sets it when no build exists. The built package needs nothing.
- `@re4exa/core` is published as its own package; Assay's install rehearsal packs and installs both.
- Node 24.15 is the floor (`node:sqlite` is a release candidate there; Node 22 reaches end of life in April 2027).
