# 0005. Store concurrency: one owner, many readers, one write path

Status: accepted (WP-1). Refines plan §3.2.

## Context

Core's kernel opened the store with `locking_mode=EXCLUSIVE` and `timeout: 0`. That made a second
process fail fast with `store_locked` (good: two writers on one store was pi-durable's data-loss
bug), but it also shut out every other connection, so worker threads could not read and a CLI
could not inspect a store a server had open.

## Decision

- **Ownership by a sidecar lock.** The owner holds an exclusive lock on `<store>.lock`, a tiny
  SQLite file opened in exclusive mode. A second owner gets `store_locked`. The operating system
  drops the lock when the owner exits or is killed, so a crash never leaves the store stuck and
  no stale-pid logic is needed.
- **The store is WAL, not exclusive.** `journal_mode=WAL`, `synchronous=FULL`, foreign keys on.
  Readers (`Kernel.open({mode: "reader"})`) open read-only with a busy timeout, in any process or
  worker thread. A reader never migrates, refuses a store at another schema version
  (`store_schema_mismatch` / `store_schema_newer`) and refuses every write (`store_read_only`).
- **One write path.** `WriteBatcher` (core `kernel/writer.ts`) runs on the owner's main thread
  and holds the only write connection. Workers send typed operations over a MessagePort
  (`writerClient`). Requests are committed in batches of at most 256 operations or 5 ms, each
  request in its own savepoint; a request's promise resolves only after its batch commits, and a
  failing request is rejected without affecting the others.
  - Deviation from the plan: the plan said "one writer thread". The writer is the owner's main
    thread instead, because the kernel's API is synchronous and used that way by Assay; moving
    writes to another thread would have changed every caller. Bounded batches keep each write
    transaction short, and readers do their work off the main thread.
- **Namespaced migrations.** Core keeps `schema_version`; apps and components call
  `migrateNamespace(ns, migrations)` and get `schema_version:<ns>`. Pending migrations and the
  version bump commit in one transaction. Before migrating an existing store, it is copied to
  `<store>.pre-<ns>-v<from>.bak` with `VACUUM INTO`.
- **Export by pages.** `exportTo(dest)` uses SQLite's online backup, so an export never holds the
  store in memory as one string, and it never overwrites an existing file.
- **Checkpoint caps.** At most 1 MiB per checkpoint and 10,000 per task by default
  (`checkpoint_too_large`). `checkpoint()` checks the lease before running the computation as
  well as inside the transaction.
- **Lease errors stay exceptions.** The plan's §14 asked for suspension and cancellation as
  returned values. We kept exceptions but verified the property that matters: once an attempt's
  lease is lost, every later write from it is refused, even if user code catches the error, and
  the task stays reclaimable.

## Consequences

- Phase-0 rows proved by `apps/reax/test/conformance.test.ts`: PD-1, PD-5, PD-6, PD-7, OR-2,
  AB-P1, AB-P2, AB-P4, AB-P6, AB-P8, AB-P11, AB-P12, AB-P14, REA-A2.2, REA-A3.1, REA-A5.1,
  REA-C30-LIMIT.
- Still open: probes in worker threads writing through the batcher (WP-4); `pm.db` at
  `synchronous=NORMAL` (WP-5, with the program-model tables); fixture stores from earlier
  versions opened in CI (there is only one schema version so far).
