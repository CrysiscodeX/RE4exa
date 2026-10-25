# Spike: absurd's SQL on embedded PGlite

Written by A-absurd in debate round 2 ([round-2-a-absurd.md](../../round-2-a-absurd.md)). The moderator re-ran it on 2026-10-25 and got the same results.

```bash
npm ci --ignore-scripts
E=$PWD/node_modules/@electric-sql/pglite/dist/index.js
SQL=<absurd checkout at 3cfc64f>/sql/absurd.sql
node spike.mjs  $E $SQL   # unmodified absurd.sql: spawn, claim, checkpoints, lease expiry and reclaim, events, partitioned queues, cleanup
node spike2.mjs $E $SQL   # persistence across close and reopen
node fence.mjs  $E $SQL   # proposed lease fence (AB004) and the claim-timeout check (AB005), injected into absurd.sql
node events.mjs $E $SQL   # reused event name misfire, then the proposed sequenced topics with dedupe and gap detection
```

Notes:
- PGlite is `@electric-sql/pglite` 0.5.8, which is PostgreSQL 18.3 compiled to WASM. The exact version is pinned in `package-lock.json`.
- pg_cron is not available, and absurd reports that cleanly.
- PostgreSQL 18's `uuidv7()` ignores absurd's fake clock.
- **Not tested:** the TypeScript SDK running on PGlite, several processes sharing one store, and throughput.

`fence.mjs` and `events.mjs` are design probes, not patches to absurd.

## Two processes on one store: committed data is lost (`two-process.mjs`)

The skeptic found this in round 2b and the moderator reproduced it. Two Node processes opened the same PGlite data directory and each inserted 200 rows. Neither process got an error, and each saw only its own rows. After both had closed, the store was reopened and its contents counted.

| Who ran it | Runs | Committed rows lost |
|---|---|---|
| Skeptic | 3 | one process's 200 rows in run 1; none in run 2; 25 of 200 in run 3 |
| Moderator (table created before the processes start) | 3 | one process's 200 rows in every run |
| Moderator (each process creates the table) | 2 | none lost; the second process failed with an error that had no message |

```bash
mkdir -p /tmp/pg && node two-process.mjs $E /tmp/pg/db A 200 & node two-process.mjs $E /tmp/pg/db B 200 & wait
```

Conclusion: an embedded PGlite store is safe only when something outside PGlite guarantees that just one process opens it, for example an exclusive OS file lock taken when the store is opened.
