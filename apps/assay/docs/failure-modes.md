# Failure modes

Every error Assay reports carries one of these codes. Generated from `src/errors.ts` by
`node scripts/gen-docs.ts`; `test/failure-modes.test.ts` checks that each code is raised by at
least one test. Defaults fail closed: an unknown state is reported, never guessed.

| Code | Meaning | Retryable | What to do |
|---|---|---|---|
| `store_locked` | Another Assay process holds this store open | no | Stop the other `assay serve`, or set ASSAY_HOME to a different directory |
| `store_schema_newer` | The store was written by a newer Assay | no | Upgrade Assay; downgrading a store is refused |
| `lease_expired` | The attempt's lease expired before this write | no | None needed: the task is reclaimed and retried by its next attempt |
| `stale_attempt` | A newer attempt owns this task | no | None needed: only the current attempt may write |
| `invalid_lease` | Lease length must be a positive number of milliseconds | no | Pass leaseMs > 0 |
| `effect_interrupted` | An unsafe effect was interrupted and may have partly run | no | Check the target, then retry explicitly with a new key |
| `receipt_conflict` | A retry key was reused with a different payload | no | Use a new retry key for a different request |
| `evidence_invalid` | The claim record does not match the S-2 v1 schema | no | See docs/claim-format.md |
| `evidence_confidence` | Only the runner may record observed or derived evidence | no | Agents record analyst-inference; the verifier upgrades claims it can re-run |
| `evidence_missing` | A cited evidence record does not exist or was never delivered | no | Cite an observation id returned by a probe |
| `unknown_conflict` | The unknown changed since it was read | no | Read the latest revision and retry |
| `budget_exceeded` | The run's budget is spent | no | Raise the budget for this case, or stop |
| `breaker_open` | Three worker failures in a row opened the circuit breaker | no | Inspect the failures; reset the breaker from the session |
| `depth_exceeded` | Workers may not start workers of their own | no | Ask the coordinator to start the worker |
| `prompt_too_large` | The worker task text is over the prompt budget | no | Shorten the task or pass a handle to the material |
| `approval_denied` | The person denied this action | no | Ask the person, or choose an action without effects |
| `approval_expired` | Nobody answered the approval request in time | yes | Ask again when the person is at the Assay window, or choose an action without effects |
| `tool_not_permitted` | This tool is not available to this caller | no | Ask the coordinator to call it, or use `tools/list` to see the tools you may call |
| `tool_failed` | The tool failed unexpectedly | yes | Check the arguments against the tool's schema and retry; report a bug if it persists |
| `handle_unknown` | The handle is unknown, belongs to another case, or was evicted | no | Re-run the tool that produced it to get a fresh handle |
| `path_outside_workspace` | The path resolves outside the workspace | no | Use a path inside the workspace |
| `probe_unknown` | No probe with that id | no | List probes with `assay probe --list` |
| `probe_failed` | The probe could not finish | yes | See the probe's limitations; retry or use another probe |
| `provider_unavailable` | The agent client is not installed | no | Install the official CLI, then run `assay doctor` |
| `account_signed_out` | The account is not signed in | no | Sign in from the Accounts panel; Assay runs the provider's official login |
| `provider_error` | The agent client failed or broke its protocol | yes | See the error detail; check the client with `assay doctor`, then retry the turn |
| `unauthorized` | Not paired with this Assay server | no | Open the pairing link printed by `assay serve` |
| `bad_request` | The request is malformed | no | Check the request against docs/api.md |
| `not_found` | No such object | no | Check the id |
| `bundle_tampered` | The bundle's signature or digests do not verify | no | Obtain the bundle again from its producer |
