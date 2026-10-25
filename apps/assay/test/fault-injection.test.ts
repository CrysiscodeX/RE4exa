// M1: SIGKILL a worker at random moments, resume, and check what survived.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { caseEvidence } from "../src/evidence/store.ts";
import { Kernel } from "../src/kernel/kernel.ts";
import { lcg, tmp } from "./helpers.ts";

const WORKER = join(import.meta.dirname, "fixtures", "fault-worker.ts");

function runOnce(
  db: string,
  log: string,
  offset: number,
  killAfterMs: number | null,
): Promise<{ out: string; killed: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", WORKER, db, log, String(offset)], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    let out = "";
    let killed = false;
    child.stdout.on("data", (d) => (out += d));
    const timer =
      killAfterMs === null
        ? null
        : setTimeout(() => {
            killed = true;
            child.kill("SIGKILL");
          }, killAfterMs);
    child.on("exit", () => {
      if (timer) clearTimeout(timer);
      resolve({ out, killed: killed && !out.includes("done") });
    });
  });
}

test("fault injection: 30 SIGKILLs lose no evidence, re-run at most one step per kill, never duplicate keyed effects", {
  timeout: 240_000,
}, async () => {
  let totalKills = 0;
  const rnd = lcg(11);
  const killedAt: number[] = [];
  const runs: { kills: number; reexec: number; unsafeRuns: number; interrupted: number }[] = [];
  while (totalKills < 30) {
    const t = tmp();
    const db = join(t.dir, "assay.db");
    const log = join(t.dir, "log");
    let offset = 0;
    let kills = 0;
    for (let round = 0; round < 50; round++) {
      // processes start in ~150-300 ms; steps take ~30 ms, so kills land across the whole run
      const r = await runOnce(db, log, offset, kills < 3 ? 180 + Math.floor(rnd() * 350) : null);
      offset += 10_000; // the next process sees the dead holder's lease as expired
      if (r.killed) {
        kills++;
        const progress = existsSync(log)
          ? readFileSync(log, "utf8")
              .split("\n")
              .filter((l) => l.startsWith("exec ")).length
          : 0;
        killedAt.push(progress);
      }
      if (r.out.includes("done") || r.out.includes("nothing")) break;
    }
    const lines = readFileSync(log, "utf8").trim().split("\n");
    const execs = lines.filter((l) => l.startsWith("exec ")).length;
    const target = existsSync(`${log}.target`) ? readFileSync(`${log}.target`, "utf8").trim().split("\n") : [];
    const k = Kernel.open({ path: db });
    const c = k.listCases()[0]!;
    const ev = caseEvidence(k, c.id);
    const task = k.listTasks({ queue: "fault" })[0]!;
    assert.equal(task.state, "completed");
    assert.equal(ev.length, 6, "all six evidence records are present");
    assert.equal(new Set(target).size, target.length, "the keyed target never saw a duplicate key");
    assert.equal(target.length, 6);
    const unsafeRuns = lines.filter((l) => l === "unsafe run").length;
    assert.ok(unsafeRuns <= 1, "the unsafe effect ran at most once");
    assert.ok(execs - 6 <= kills, `re-executed steps (${execs - 6}) ≤ kills (${kills})`);
    runs.push({
      kills,
      reexec: execs - 6,
      unsafeRuns,
      interrupted: lines.filter((l) => l === "unsafe interrupted").length,
    });
    totalKills += kills;
    k.close();
    t.cleanup();
  }
  const reexec = runs.reduce((a, r) => a + r.reexec, 0);
  const interrupted = runs.reduce((a, r) => a + r.interrupted, 0);
  const hist = [0, 1, 2, 3, 4, 5, 6].map((n) => killedAt.filter((x) => x === n).length);
  process.stdout.write(
    `# M1 kills=${totalKills} re-executed-steps=${reexec} unsafe-interrupted=${interrupted} steps-done-at-kill=${JSON.stringify(hist)}\n`,
  );
  assert.ok(
    hist.slice(1, 6).some((n) => n > 0),
    "some kills landed mid-run",
  );
});
