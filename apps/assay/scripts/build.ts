// Build the installable package: compile src/ to dist/ (relative .ts imports rewritten to .js),
// copy the JSON data files, and build the UI. `npm pack` runs this through prepack.
import { spawnSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const run = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
rmSync(join(root, "dist"), { recursive: true, force: true });
run("npx", ["tsc", "-p", "tsconfig.build.json"]);
cpSync(join(root, "src", "probes", "router-pack.json"), join(root, "dist", "probes", "router-pack.json"));
run("npx", ["vite", "build", "ui"]);
console.log("built dist/ and ui/dist/");
