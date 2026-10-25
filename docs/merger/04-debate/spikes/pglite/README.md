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
