# Governance

- **Owner.** The RE4exa repository owner, CrysiscodeX, decides on releases, security disclosures and the licence.
- **Maintainers.** There is one maintainer today. That is a known risk for long-term support, and it is recorded in [docs/debt.md](docs/debt.md). The way to reduce it is to add a second maintainer with commit rights and to give two people access to the security reporting channel.
- **Decisions.** Contract changes are decided in an issue and recorded in [docs/decisions/](docs/decisions/). These cover the claim format, the store schema, the MCP surface and account handling.
- **Code ownership.** `.github/CODEOWNERS` assigns `apps/assay/` to the owner. Security-relevant paths (`src/policy`, `src/providers`, `src/accounts`, `src/server`, `src/mcp`) need the owner's review.
