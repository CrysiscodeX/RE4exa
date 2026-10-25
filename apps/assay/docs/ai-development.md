# How AI agents contributed to Assay

Assay was designed and written with Claude Code agents, working for the repository owner:

- **Design.** A multi-agent debate (`docs/merger/`) took the four source repositories apart and argued over what to merge. Its findings became requirements: the identity scheme, the lease fence, the store lock, and the taint boundary.
- **Build.** One lead agent wrote the kernel, the evidence model, the orchestrator, the server and the integration. Four agents built the probes, the policy and MCP layer, the providers and accounts, and the UI in parallel, each in its own directories and against shared contracts (`src/contracts.ts`).
- **Review.** The lead re-ran every subsystem's tests and checked a sample of its claims against source before committing. The live benchmark was run, its failures were diagnosed, and they were fixed (`bench/live.ts`; commit history).

How AI-written changes are checked, the same way as any other change:
- CI runs typecheck, lint, tests with coverage gates, docs freshness, the dependency budget and audit, the browser end-to-end tests, the benchmark gates and self-application.
- The guardrails (no credential reading, enforced mode, approvals) are covered by tests that grep the source.
- Commits made with AI assistance carry a `Co-Authored-By` trailer.
