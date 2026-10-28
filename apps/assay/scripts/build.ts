// Build the installable package: build the bundled shared engine (@re4exa/core) and reax's
// operations (the reax.* probes), compile src/ to
// dist/ (relative .ts imports rewritten to .js), and build the UI. `npm pack` runs this through
// prepack. Core is a bundled dependency, so the tarball carries its dist/.
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const run = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run(process.execPath, [
  "--disable-warning=ExperimentalWarning",
  join(root, "..", "..", "packages", "core", "scripts", "build.ts"),
]);
// reax's operations are Assay's reax.* probes; build them the same way.
run(process.execPath, ["--disable-warning=ExperimentalWarning", join(root, "..", "reax", "scripts", "build.ts")]);
rmSync(join(root, "dist"), { recursive: true, force: true });
run("npx", ["tsc", "-p", "tsconfig.build.json"]);
run("npx", ["vite", "build", "ui"]);
console.log("built dist/ and ui/dist/");
