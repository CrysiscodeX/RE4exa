// node bench/live.ts --backend local|codex|claude|hybrid [--smoke] [--tasks id,id] [--reps 1] [--out dir]
import { join } from "node:path";
import { parseArgs } from "node:util";
import { BACKENDS, type BackendName, runLive, SMOKE_TASKS } from "../src/bench/live.ts";
import { loadTasks } from "../src/bench/run.ts";

const REAX = join(import.meta.dirname, "..");
const { values: a } = parseArgs({
  options: {
    backend: { type: "string" },
    smoke: { type: "boolean", default: false },
    tasks: { type: "string" },
    reps: { type: "string", default: "1" },
    out: { type: "string" },
  },
});
if (!BACKENDS.includes(a.backend as BackendName)) {
  console.error(`--backend is one of ${BACKENDS.join(", ")}`);
  process.exit(2);
}
const ids = a.tasks?.split(",") ?? (a.smoke ? SMOKE_TASKS : null);
const tasks = loadTasks(join(REAX, "bench", "tasks")).filter((t) => !ids || ids.includes(t.id));
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const out = a.out ?? join(REAX, "bench", "results", `${a.smoke ? "smoke" : "live"}-${stamp}`, a.backend!);
const cells = await runLive({
  backend: a.backend as BackendName,
  tasks,
  reps: Number(a.reps),
  fixturesBin: join(REAX, "fixtures", "bin"),
  out,
  onCell: (c) =>
    console.log(`${c.backend} ${c.task}: accuracy ${c.grade.accuracy.toFixed(2)}${c.error ? ` (${c.error})` : ""}`),
});
console.log(`${cells.length} cells -> ${out}`);
