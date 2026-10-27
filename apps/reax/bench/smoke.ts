// The smoke test, on any OS: the doctor first (nothing runs if it finds a problem), then the 5
// smoke tasks on each backend in turn, one after another (never at once), into one results
// directory, with one combined summary.
//   node bench/smoke.ts [--backends local,codex,claude,hybrid]
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values: a } = parseArgs({ options: { backends: { type: "string", default: "local,codex,claude,hybrid" } } });
const backends = a.backends.split(",").map((b) => b.trim());
const node = (script: string, args: string[]) =>
  spawnSync(process.execPath, ["--conditions=source", "--disable-warning=ExperimentalWarning", script, ...args], {
    stdio: "inherit",
    cwd: join(import.meta.dirname, ".."),
  }).status;

const want = backends.length === 1 ? backends[0]! : "all";
if (node("bench/doctor.ts", ["--backend", want]) !== 0) {
  console.error("the doctor found a problem: fix it, then run the smoke test again");
  process.exit(1);
}
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const out = join("bench", "results", `smoke-${stamp}-${process.platform}`);
let failed = 0;
for (const b of backends) {
  if (node("bench/live.ts", ["--backend", b, "--smoke", "--out", join(out, b)]) !== 0) failed++;
}
const root = join(import.meta.dirname, "..", out);
const parts = backends.map((b) => join(root, b, "summary.md")).filter((p) => existsSync(p));
writeFileSync(join(root, "summary.md"), parts.map((p) => readFileSync(p, "utf8")).join("\n"));
console.log(`results: ${join(out, "summary.md")}${failed ? ` (${failed} backend runs exited with an error)` : ""}`);
process.exit(failed ? 1 : 0);
