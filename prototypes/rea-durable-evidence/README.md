# rea-durable-evidence (prototype)

REA ([morluto/rea](https://github.com/morluto/rea)) keeps every Evidence record in an
in-memory ledger that belongs to one MCP connection. If the REA process or its host
dies, the ledger is gone. This prototype runs REA tool calls as
[Absurd](https://github.com/earendil-works/absurd) durable steps, so completed calls
survive a crash and are not repeated.

Measured here (`test/crash-test.sh`, REA 6.7.0, Absurd 0.5.1, Postgres 16.15):

| Check | Result |
|---|---|
| Plain REA: records in ledger before SIGKILL / in a new process after | 3 / 0 |
| Worker SIGKILLed after step 3 of 6 | exit 137, 3 checkpoints committed |
| Attempts | `1:failed:$ClaimTimeout`, `2:completed` |
| Completed REA calls run twice | 0 |
| Records re-imported into the new REA process | 3 |
| Final Evidence IDs equal to an uncrashed control run | yes |
| Live REA ledger holds every checkpointed ID after resume | yes |

Full output: `../../research/rea-self-analysis/results/prototype-crash-test.json`.

## How it works

- Each `{tool, args}` in a plan becomes `ctx.step("rea:<tool>:<sha256(canonical args)>")`.
- Inside the step: call REA, store the exact Evidence JSON in `rea_evidence` (text, not
  jsonb, which rejects `\u0000`), write REA's own `export_evidence_bundle` snapshot to
  `rea_bundle`, then let the step return `{evidence_id, tool, bytes}` as its checkpoint.
  The snapshot is written before the checkpoint, so it always covers every checkpointed ID.
- Every attempt starts a fresh REA process and, if a snapshot exists, restores it with
  `import_evidence_bundle` before replaying the plan. Completed steps return their
  checkpoint without calling REA.
- REA's content-addressed `evidence_id` makes a re-run of an interrupted step converge on
  the same record (`on conflict do nothing`).

Limits: a step that was in flight when the worker died runs again (at-least-once). A
restart waits for the lease (`claimTimeout`, 10 s here) to expire. Only REA's Evidence
ledger is restored; an open native session (`open_binary`) is not, so plans that need
one must reopen it outside steps.

## Run

```bash
npm install --ignore-scripts
npm run test:crash      # starts a throwaway Postgres in .run/pg, runs baseline, control and crash
npm run pg:down         # stops and deletes it
```

Needs Node >= 22.19, Postgres 16 binaries, and `git` (the setup takes `sql/absurd.sql`
from a pinned Absurd commit, because the npm package does not ship it). As root, the
cluster runs as the `postgres` user.
