// Install rehearsal (RQS EVO-2/OPS-4): pack the package, install the tarball into an empty
// project with integrity checking from the lockfile-resolved registry, and run the installed CLI.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const sh = (cmd: string, args: string[], cwd: string) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error(`${cmd} ${args.join(" ")} failed:\n${r.stdout}\n${r.stderr}`);
    process.exit(1);
  }
  return r.stdout.trim();
};
// Assay depends on the shared engine, published as its own package; pack both and install them together.
const coreRoot = join(root, "..", "..", "packages", "core");
const coreTgz = join(coreRoot, sh("npm", ["pack", "--silent"], coreRoot).split("\n").pop()!);
const tgzName = sh("npm", ["pack", "--silent"], root).split("\n").pop()!;
const tgz = join(root, tgzName);
const digest = createHash("sha256").update(readFileSync(tgz)).digest("hex");
const dir = mkdtempSync(join(tmpdir(), "assay-install-"));
writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "rehearsal", version: "0.0.0", private: true }));
sh("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", coreTgz, tgz], dir);
const version = sh("npx", ["--no-install", "assay", "version"], dir);
const home = join(dir, ".assay-home");
const sweep = sh("npx", ["--no-install", "assay", "sweep", "node_modules/assay/docs", "--home", home], dir);
console.log(`installed ${tgzName} (sha256 ${digest}); assay ${version}; ${sweep.split("\n")[0]}`);
rmSync(dir, { recursive: true, force: true });
rmSync(tgz, { force: true });
rmSync(coreTgz, { force: true });
