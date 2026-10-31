# Execution state

**Restart point.**
1. Run `bash scripts/dev/setup-node.sh`, or put `/opt/nvm/versions/node/v24.22.1/bin` first on PATH.
2. Read this file.
3. Continue with the first package under **Next**.

## Done (verified in CI)
- **Baseline re-measured:** see `BASELINE.md`.
- **Workspace and reconciliation:** this folder; `scripts/status.ts` generates `CAPABILITY-MATRIX.md`.

## Active
- **FW: the operation framework.**
  - offset/limit paging with `page.next`;
  - output formats text, json, jsonl, yaml, markdown and toon;
  - `scripts/oracle.ts` for new answer keys.

## Next (in order)
1. NAT-1, strings and bytes.
2. NAT-2, layout and entropy.
3. NAT-3, symbols and procedures.
4. NAT-4, format depth.
5. ARC, archives and bundles.
6. SBX, the sandbox.
7. DMN, the daemon and MCP.

## Blocked
- **The automatic session hook:** refused by the session's permission policy (DECISION-LOG D-5).
  The setup script stands in for it.

## Known defects
- None open beyond the ledgers' weak points.
