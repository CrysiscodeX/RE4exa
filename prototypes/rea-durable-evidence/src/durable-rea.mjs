// REA tool calls as Absurd durable steps.
//
// REA keeps Evidence in an in-memory ledger owned by one MCP connection, so a
// crash loses every record. Here each tool call is an Absurd step: its Evidence
// record goes to Postgres (as text: jsonb rejects \u0000), a fresh ledger
// snapshot (REA's own export_evidence_bundle) is stored before the checkpoint
// commits, and a restarted attempt re-imports that snapshot into a new REA
// process before replaying the plan. Completed steps return their checkpoint
// and are not called again.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openRea } from "./rea.mjs";

const canonical = (v) =>
  Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`
  : JSON.stringify(v);

export const stepKey = (tool, args) =>
  `rea:${tool}:${createHash("sha256").update(canonical(args)).digest("hex").slice(0, 24)}`;

export function registerReaPlan(app, db, { runDir, crashAfterStep = 0 }) {
  mkdirSync(runDir, { recursive: true });

  app.registerTask({ name: "rea-plan", defaultMaxAttempts: 10 }, async (params, ctx) => {
    const rea = await openRea();
    const log = (step, phase) =>
      db.query("insert into rea_call_log (task_id, step_name, phase, pid, rea_pid) values ($1, $2, $3, $4, $5)",
        [ctx.taskID, step, phase, process.pid, rea.pid]);
    try {
      // Restore the ledger a previous attempt built (runs on every attempt; not a step).
      const saved = await db.query("select bundle_text from rea_bundle where task_id = $1", [ctx.taskID]);
      let restoredRecords = 0;
      if (saved.rows.length) {
        const path = join(runDir, `${ctx.taskID}-restore.json`);
        writeFileSync(path, saved.rows[0].bundle_text);
        await rea.call("import_evidence_bundle", { path });
        restoredRecords = JSON.parse(saved.rows[0].bundle_text).records.length;
        await log("(restore)", `imported ${restoredRecords}`);
      }

      const results = [];
      for (const [index, { tool, args }] of params.calls.entries()) {
        const key = stepKey(tool, args);
        results.push(await ctx.step(key, async () => {
          await log(key, "start");
          const heartbeat = setInterval(() => ctx.heartbeat().catch(() => {}), 3_000);
          try {
            const evidence = await rea.call(tool, args);
            const recordText = JSON.stringify(evidence);
            await db.query(
              `insert into rea_evidence (evidence_id, task_id, step_name, tool, args_canonical, record_text)
               values ($1, $2, $3, $4, $5, $6) on conflict (evidence_id) do nothing`,
              [evidence.evidence_id, ctx.taskID, key, tool, canonical(args), recordText]);
            const bundlePath = join(runDir, `${ctx.taskID}-bundle.json`);
            await rea.call("export_evidence_bundle", { path: bundlePath, overwrite: true });
            await db.query(
              `insert into rea_bundle (task_id, step_name, bundle_text) values ($1, $2, $3)
               on conflict (task_id) do update set step_name = excluded.step_name, bundle_text = excluded.bundle_text, updated_at = now()`,
              [ctx.taskID, key, readFileSync(bundlePath, "utf8")]);
            await log(key, "end");
            return { evidence_id: evidence.evidence_id, tool, bytes: recordText.length };
          } finally {
            clearInterval(heartbeat);
          }
        }));
        if (crashAfterStep === index + 1) process.kill(process.pid, "SIGKILL"); // crash test only
      }

      // The live ledger must now hold every checkpointed record.
      const summary = await rea.call("get_evidence_bundle", { detail: "summary" });
      const ledgerIds = new Set(JSON.stringify(summary).match(/ev_[a-f0-9]{64}/g) ?? []);
      return {
        evidence_ids: results.map((r) => r.evidence_id),
        restored_records: restoredRecords,
        ledger_has_all: results.every((r) => ledgerIds.has(r.evidence_id)),
      };
    } finally {
      await rea.close();
    }
  });
}
