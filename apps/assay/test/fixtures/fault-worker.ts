// A worker the fault-injection test kills with SIGKILL at random moments.
// It runs one task of 6 probe steps. Each step commits its evidence and checkpoint in one
// transaction (commitStep) and performs a keyed effect on an external "target" (a log file that
// dedupes by key). Step 3 also performs an unsafe effect.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { isAssayError } from "../../src/errors.ts";
import { makeRecord, probeKey, subjectDigest } from "../../src/evidence/record.ts";
import { putEvidence } from "../../src/evidence/store.ts";
import { Kernel } from "../../src/kernel/kernel.ts";

const [path, log, offsetMs] = process.argv.slice(2);
const offset = Number(offsetMs);
const k = Kernel.open({ path: path!, clock: () => Date.now() + offset });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const note = (line: string) => appendFileSync(log!, `${line}\n`);

let c = k.listCases()[0];
if (!c) c = k.createCase({ title: "fault" });
k.spawnTask({ queue: "fault", kind: "probe-run", caseId: c.id, idempotencyKey: "fault-run" });
const att = k.claimTask("fault", `pid${process.pid}`, 5_000);
if (!att) {
  process.stdout.write("nothing\n");
  process.exit(0);
}
for (let i = 0; i < 6; i++) {
  k.commitStep(att, `probe-${i}`, () => {
    note(`exec ${i}`);
    const bytes = new TextEncoder().encode(`subject-${i}`);
    const digest = subjectDigest(bytes);
    const probe = { id: "test.echo", version: "1" };
    const rec = makeRecord(
      {
        probe,
        probe_key: probeKey(probe, { i }, digest),
        predicate: "test.echo",
        subject: { digest },
        params: { i },
        result: { i },
        confidence: "observed",
        producer: { kind: "runner", id: "fault" },
      },
      k.now(),
    );
    putEvidence(k, c.id, rec);
    return rec.observation_id;
  });
  await sleep(15);
  await k.runEffect(att, { name: `notify-${i}`, replay: "keyed", args: { i } }, (key) => {
    note(`try ${key}`);
    const seen = existsSync(`${log}.target`) ? readFileSync(`${log}.target`, "utf8").split("\n") : [];
    if (!seen.includes(key)) appendFileSync(`${log}.target`, `${key}\n`);
    return key;
  });
  if (i === 3) {
    try {
      await k.runEffect(att, { name: "unsafe-3", replay: "unsafe" }, async () => {
        note("unsafe run");
        await sleep(20);
        return true;
      });
    } catch (e) {
      if (!isAssayError(e, "effect_interrupted")) throw e;
      note("unsafe interrupted");
    }
  }
  await sleep(15);
}
k.completeTask(att, "done");
k.close();
process.stdout.write("done\n");
