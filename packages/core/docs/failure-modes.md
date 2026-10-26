# Failure modes (core)

The engine-agnostic codes every app built on `@re4exa/core` can report. Apps add their own with
`defineFailureModes` and may reword a code's fix for their users. Generated from `src/errors.ts` by
`npm run gen-docs`; `test/failure-modes.test.ts` checks that each code is raised by a core test.

| Code | Meaning | Retryable | What to do |
|---|---|---|---|
| `store_locked` | Another process holds this store open | no | Stop the other process that owns this store, or use a different home directory |
| `store_schema_newer` | The store was written by a newer version | no | Upgrade; opening a store with an older version is refused (downgrade only through export and import) |
| `store_schema_mismatch` | The store has not been migrated to this version yet | no | Open it once as the owner (start the server or run any command), then open readers |
| `store_read_only` | This store connection is a reader and cannot write | no | Send the write to the store's owner process |
| `lease_expired` | The attempt's lease expired before this write | no | None needed: the task is reclaimed and retried by its next attempt |
| `stale_attempt` | A newer attempt owns this task | no | None needed: only the current attempt may write |
| `invalid_lease` | Lease length must be a positive number of milliseconds | no | Pass leaseMs > 0 |
| `write_op_unknown` | The writer has no handler for this write operation | no | Register a handler for the operation with the owner's WriteBatcher |
| `checkpoint_too_large` | A checkpoint is larger than the store allows, or the task has too many | no | Store large results as evidence or blobs and checkpoint a reference to them |
| `effect_interrupted` | An unsafe effect was interrupted and may have partly run | no | Check the target, then retry explicitly with a new key |
| `receipt_conflict` | A retry key was reused with a different payload | no | Use a new retry key for a different request |
| `evidence_invalid` | The claim record does not match the claim-record schema | no | See the claim-format document of the app that wrote it |
| `evidence_confidence` | Only the runner may record observed or derived evidence | no | Agents record analyst-inference; the verifier upgrades claims it can re-run |
| `evidence_missing` | A cited evidence record does not exist or was never delivered | no | Cite an observation id returned by a probe |
| `unknown_conflict` | The unknown changed since it was read | no | Read the latest revision and retry |
| `budget_exceeded` | The run's budget is spent | no | Raise the budget for this case, or stop |
| `approval_denied` | The person denied this action | no | Ask the person, or choose an action without effects |
| `approval_expired` | Nobody answered the approval request in time | yes | Ask again when the person can answer, or choose an action without effects |
| `handle_unknown` | The handle is unknown, belongs to another case, or was evicted | no | Re-run the tool that produced it to get a fresh handle |
| `path_outside_workspace` | The path resolves outside the workspace | no | Use a path inside the workspace |
| `path_exists` | The destination already exists | no | Choose a new destination path, or remove the existing file first |
| `path_not_found` | No such path in the workspace | no | Use one of the suggested paths, or list the folder |
| `probe_unknown` | No probe with that id | no | List the available probes |
| `probe_failed` | The probe could not finish | yes | See the probe's limitations; retry or use another probe |
| `bad_request` | The request is malformed | no | Check the request against the API documentation |
| `not_found` | No such object | no | Check the id |
