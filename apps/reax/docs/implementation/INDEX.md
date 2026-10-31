# reax implementation workspace

The durable state of the work to complete reax, so any session can resume from the last verified
checkpoint without re-analysing the repository. Start with `EXECUTION-STATE.md`.

| File | What it holds | Source of truth it points to |
|---|---|---|
| [EXECUTION-STATE.md](EXECUTION-STATE.md) | Done, active, blocked and next work packages; the restart point | itself |
| [MASTER-PLAN.md](MASTER-PLAN.md) | Every work package: requirements, dependencies, acceptance criteria | `../plan.md` (architecture) |
| [BASELINE.md](BASELINE.md) | The verified starting state and how it was measured | ledgers, test suite, CI |
| [DECISION-LOG.md](DECISION-LOG.md) | Engineering decisions and their reasons | itself |
| [CAPABILITY-MATRIX.md](CAPABILITY-MATRIX.md) | Rows, tests and weak points per component (**generated** by `scripts/status.ts`) | `../ledger/` |

Other registers live where they already are, rather than in copies here:

| Register | Where |
|---|---|
| Capability rows (357 rea and leanrea, plus reax's own) | `../ledger/parity/*.jsonl` |
| Weak points (244) | `../ledger/limitations/*.jsonl` |
| Security notes (SR-1 to SR-15 and later) | `../review-notes.md` |
| Per-row status from CI (covered, regressed, fixed) | CI parity job, `scripts/parity-check.ts` |
| Architecture and phases | `../plan.md` |
| Engine choices and licences | `../engine-research.md` |
| Operation reference (generated) | `../operations.md`, `../tools.json` |

**Rules.** A component counts as done only when its tests pass in CI on every platform its rows
name. Nothing here is marked done by hand: the matrix is generated, and per-row status comes from
CI.
