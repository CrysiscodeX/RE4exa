// Worker process: claims rea-plan tasks and runs them.
// env: DATABASE_URL, RUN_DIR, CRASH_AFTER_STEP (crash test only)

import pg from "pg";
import { Absurd } from "absurd-sdk";
import { registerReaPlan } from "./durable-rea.mjs";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const app = new Absurd({ db: pool, queueName: "rea" });
registerReaPlan(app, pool, {
  runDir: process.env.RUN_DIR ?? ".run",
  crashAfterStep: Number(process.env.CRASH_AFTER_STEP ?? 0),
});
const worker = await app.startWorker({ claimTimeout: 10, concurrency: 1, pollInterval: 0.25 });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await worker.close(); await app.close(); await pool.end(); process.exit(0); });
