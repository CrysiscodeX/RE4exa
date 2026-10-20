// Submit a plan of REA tool calls (idempotent per run key) and wait for its result.
// usage: node src/spawn.mjs <plan.json> <run-key> [timeout-seconds]

import { readFileSync } from "node:fs";
import pg from "pg";
import { Absurd } from "absurd-sdk";

const [planPath, runKey, timeout = "600"] = process.argv.slice(2);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const app = new Absurd({ db: pool, queueName: "rea" });
const plan = JSON.parse(readFileSync(planPath, "utf8"));
const spawned = await app.spawn("rea-plan", plan, { queue: "rea", idempotencyKey: `rea-plan:${runKey}`, maxAttempts: 10 });
const result = await app.awaitTaskResult(spawned.taskID, { timeout: Number(timeout) });
console.log(JSON.stringify({ task_id: spawned.taskID, created: spawned.created, ...result }));
await app.close();
await pool.end();
