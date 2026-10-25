# 0001 One SQLite store per process, refused to a second process

**Status:** accepted.

**Context.** The merger debate measured what happened when two processes wrote to one store:
- pi-durable: two processes silently overwrote each other's records;
- PGlite: committed rows were lost in 5 of 8 runs;
- absurd: an expired, unswept lease still accepted writes.

**Decision.**
- The store is opened with `locking_mode=EXCLUSIVE` and an immediate write, so a second process gets `store_locked`.
- Concurrency inside the process goes through leases plus a fence: every write checks that its attempt is current and its lease has not expired.
- Ids are minted per call, never from a counter cached when the store opens.

**Consequences.**
- Multi-machine or multi-process deployments need a different store, for example absurd on Postgres with the fence. That is not in 0.1.
- Tests: two-process refusal (1000/1000), fence race (0/1000), fault injection (30 kills).
