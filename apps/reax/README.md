# reax

A clean-room replacement for rea and leanrea, in development. **Phase 0b of the plan: nothing here
analyses software yet.** What exists is the record of what reax must do and the gate that decides
when something counts as done.

| Part | What it is |
|---|---|
| `docs/ledger/limitations/*.jsonl` | The limitation register: every known weakness of rea (112 rows), leanrea (83) and the donor projects whose code or lessons reax takes, pi-durable, absurd, Orca and T3 Code (49). Seeded mechanically from [`docs/profiles`](../../docs/profiles). |
| `docs/ledger/parity/*.jsonl` | The parity ledger: rea's 46 capability families, its 229 tool names and 6 prompts at 6.8.0, leanrea's capabilities and traps, and reax's own infrastructure rows. |
| `docs/ledger/phase-map.json` | Which phase's gate each family or tool falls in. Reviewable data. |
| `docs/ledger/sources/rea-6.8.0-tools.json` | rea's public tool names and annotation hints, captured over MCP `tools/list`. No descriptions, schemas or code. |
| `scripts/seed-register.ts` | Re-seeds the ledger from the profiles. Keeps triage, marks vanished rows orphaned. |
| `scripts/parity-check.ts` | Computes each row's status from the JUnit reports of every CI lane. |
| `docs/decisions/` | Decisions that deviate from or refine the plan. |
| `docs/review-notes.md` | Security items recorded for review. |

## Status rules (ADR 0001)

A row is covered only when tests tagged `[+KEY]` and `[-KEY]` both passed on every platform the row
names, in one CI run. Skipped tests count as not run; a failing tagged test makes the row
regressed; a tag that names no row fails the check. Status is never committed.

Not done yet:
- the limitation rows are untriaged (`phase: null`, `fix: null`);
- `docs/operations.md` and the operation registry arrive in phase 1;
- the phase 0c benchmark harness, which leanrea's benchmark rows wait on.

## Commands (Node 24.15+, from a checkout after `npm ci` at the repository root)

```bash
npm run seed            # refresh docs/ledger from docs/profiles
npm run seed:check      # fail when the committed ledger differs from a fresh seed
npm test                # unit tests
npm run test:lane       # tests, writing reports/<platform>.xml
npm run parity -- --gate-phase 0 --gate-kind reax-infra
```

Licence: Apache-2.0.
