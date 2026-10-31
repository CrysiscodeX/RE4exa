// Build @re4exa/core for installed use: compile src/ to dist/ (relative .ts imports rewritten to
// .js) and copy the JSON data files. Apps that bundle core (Assay) run this before their own build.
import { spawnSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
rmSync(join(root, "dist"), { recursive: true, force: true });
const r = spawnSync("npx", ["tsc", "-p", "tsconfig.build.json"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (r.status !== 0) process.exit(r.status ?? 1);
cpSync(join(root, "src", "probes", "router-pack.json"), join(root, "dist", "probes", "router-pack.json"));
// The package carries copied third-party code (the Orca process host, leanrea's router data), so it
// carries the repository's one credit file too; the copy is git-ignored.
cpSync(join(root, "..", "..", "THIRD_PARTY_NOTICES"), join(root, "THIRD_PARTY_NOTICES"));
console.log("built packages/core/dist");
