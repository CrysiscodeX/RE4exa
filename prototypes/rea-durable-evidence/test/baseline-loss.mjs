// Baseline without the prototype: Evidence held by a REA process that is
// SIGKILLed is gone; a new REA process starts with an empty ledger.
// usage: node test/baseline-loss.mjs <plan.json>

import { readFileSync } from "node:fs";
import { openRea } from "../src/rea.mjs";

const plan = JSON.parse(readFileSync(process.argv[2], "utf8"));
const count = async (rea) => (JSON.stringify(await rea.call("get_evidence_bundle", { detail: "summary" })).match(/ev_[a-f0-9]{64}/g) ?? []).length;

const first = await openRea();
for (const { tool, args } of plan.calls.slice(0, 3)) await first.call(tool, args);
const before = await count(first);
process.kill(first.pid, "SIGKILL");
await first.close();

const second = await openRea();
const after = await count(second);
await second.close();
console.log(JSON.stringify({ ledger_ids_before_kill: before, ledger_ids_after_restart: after }));
