# Architecture

Assay is one Node process that owns one SQLite store. It serves a loopback web UI and an MCP endpoint, and it drives agent clients that run on the person's own accounts.

```
 browser (UI) ──HTTP/WS, paired cookie──┐
                                        ▼
 official agent clients ◀──spawn── ┌──────────── assay serve ─────────────┐
 (Claude SDK, codex app-server,     │ server/      routes, pairing, WS     │
  ACP agents) ──MCP over HTTP──────▶│ mcp/         tool registry + policy  │
       │  bearer token per caller   │ orchestrator/ coordinator + workers  │
       │                            │ verifier/    re-runs claims          │
       └── their own sign-in and    │ probes/      model-free readers      │
           config home per account  │ policy/      taint, approvals, redact│
                                    │ evidence/    S-2 records, unknowns   │
                                    │ kernel/      SQLite: leases, fence,  │
                                    │              intents, topics, log    │
                                    └──────────────────────────────────────┘
                                                     │ exclusive lock
                                                ASSAY_HOME/assay.db
```

## Modules

Each module states its invariant in its header comment.

| Module | Job | Origin |
|---|---|---|
| `kernel/` | The durable store. It provides tasks, attempts and leases with a write **fence**; first-write-wins checkpoints; intent recorded before each effect, with replay policies; receipts; sequenced topics; a mailbox; budgets; usage; and a hash-chained case log with fork | absurd's state machine and pi-durable's effect rule, re-implemented on SQLite. The fixes come from the merger debate: the fence, the exclusive open lock, and ids never minted from a counter cached when the store opens |
| `evidence/` | The S-2 claim record and its three keys, revisioned unknowns, agent claims and verdicts, and calibration | The model of rea's Evidence and its residual unknowns, with identity redesigned (X-1) |
| `probes/` | Model-free, bounded readers. The router pack is leanrea's table turned into data. Includes the sweep, the reach table and finding diffs | leanrea's router; rea's parsers in spirit, but new code |
| `verifier/` | Re-runs `seen` claims, using 10 predicates | strix's discipline that a finding closes only with evidence; new code |
| `policy/` | Untrusted-content envelopes, session taint, the decision table, the approval queue and the secret redactor | T3 Code's envelope; rea's effect classes |
| `mcp/` | The JSON-RPC MCP server, tool registry, handles, stdio proxy, client configs and capability statement | New code |
| `providers/` | Adapters for the official clients: Claude Agent SDK, codex app-server, ACP, and a deterministic fake | T3 Code's delegation pattern |
| `accounts/` | Account registry: one config home per account, the official login, status from the official tool, and usage | T3 Code and Orca |
| `orchestrator/` | Coordinator and workers. Covers worktrees, the mailbox, the circuit breaker, depth 1, the prompt budget, receipts, liveness, turn serialisation, and recovery after a crash | Orca |
| `server/`, `app/` | The HTTP and WebSocket server, and the composition root | T3 Code's pairing and tickets |
| `export/` | S-2 JSONL, SARIF, CycloneDX, Markdown, and signed bundles | New code |
| `vendor/orca-process-host` | Bounded subprocesses with process-tree kill | Orca, MIT, vendored with notes on what changed |
| `ui/` | React UI with Orca's layout and status vocabulary | Orca's design tokens, credited |

## Flows

**A turn**
1. `POST /messages` records the user event.
2. A `turns` task is spawned and claimed.
3. `runEffect(model-turn, unsafe)` sends the text to the provider session.
4. Tool calls come back over MCP. The policy decides whether each one may proceed, and `assay_record_claim` stores claims.
5. When the turn ends, the claims are linked to the assistant message and the verifier runs.
6. Verdicts are pushed to the UI.

If the server dies during a turn, `recover()` settles the turn as interrupted. It is never re-sent automatically, because model requests cannot be deduplicated.

**A worker**
1. `assay_spawn_worker` is coordinator-only and needs a retry id with a receipt.
2. A `workers` task is created. The worker gets its own MCP token, and an optional git worktree.
3. The worker runs its first turn, then reports with `worker_done`, which goes to the mailbox and back to `assay_check_workers`.
4. If the server restarts, a running worker becomes `unverifiable` and is never restarted automatically.

**Evidence**
1. The engine resolves and guards the path, then computes the **ProbeKey before running**.
2. If the store already holds evidence for that key, the evidence is reused.
3. Otherwise the engine runs the probe with a timeout and redacts the result.
4. It then makes the record, which computes the ObservationId, and stores it.

## Decisions

The reasoning behind the design is in [docs/decisions/](docs/decisions/). The debate that produced it is in [../../docs/merger/](../../docs/merger/).
