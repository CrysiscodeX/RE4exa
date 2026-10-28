// Build reax's library for installed use: compile src/ (without the benchmark harness) to dist/,
// relative .ts imports rewritten to .js. Apps that use reax's operations (Assay) run this before
// their own build, as they do for @re4exa/core.
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
rmSync(join(root, "dist"), { recursive: true, force: true });
const r = spawnSync("npx", ["tsc", "-p", "tsconfig.build.json"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (r.status !== 0) process.exit(r.status ?? 1);
console.log("built apps/reax/dist");
