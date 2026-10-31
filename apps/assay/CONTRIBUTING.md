# Contributing

1. **Open an issue first** for any change to the claim format, the store schema, the MCP tool surface or the account handling. These are contracts that other tools and stored data depend on.
2. **Keep pull requests small**, with tests that would have failed without the change. Run every check in [AGENTS.md](AGENTS.md) before asking for review.
3. **Schema changes** add a new migration to `packages/core/src/kernel/schema.ts` (the shared engine). Never edit an existing one. A store written by a newer Assay is refused, so downgrades are safe.
4. **Claim format changes** follow `re4exa.claim/2` (records written as `assay.claim/1` stay readable; see docs/decisions/0004). Adding a field that is not hashed is a minor change. Changing which fields are hashed requires a new spec version and a converter.
5. **Security issues** are reported privately, never in a public issue. See [SECURITY.md](SECURITY.md).
6. **AI-assisted contributions** are welcome and must say so in the PR description. They are reviewed like any other change. See [docs/ai-development.md](docs/ai-development.md).

RE4exa has no licence; all rights are reserved by the owner. Contributions are accepted only with the owner's agreement.
