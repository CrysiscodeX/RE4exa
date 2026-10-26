// node bench/run.ts --arm fake [--reps 1] [--out reports/bench] [--tasks id,id]
import { join } from "node:path";
import { parseArgs } from "node:util";
import { ARMS, type Arm, loadTasks, runCells } from "../src/bench/run.ts";

const REAX = join(import.meta.dirname, "..");
const { values: a } = parseArgs({
  options: {
    arm: { type: "string", default: "fake" },
    reps: { type: "string", default: "1" },
    out: { type: "string", default: join(REAX, "reports", "bench") },
    tasks: { type: "string" },
  },
});
if (!ARMS.includes(a.arm as Arm)) {
  console.error(`--arm is one of ${ARMS.join(", ")}`);
  process.exit(2);
}
const only = a.tasks?.split(",");
const tasks = loadTasks(join(REAX, "bench", "tasks")).filter((t) => !only || only.includes(t.id));
try {
  const cells = runCells({
    arm: a.arm as Arm,
    tasks,
    reps: Number(a.reps),
    fixturesBin: join(REAX, "fixtures", "bin"),
    out: a.out!,
  });
  console.log(`${cells.length} cells -> ${a.out}`);
} catch (e) {
  console.error((e as Error).message);
  process.exit(2);
}
