#!/usr/bin/env node
// Run a command with NODE_OPTIONS=--conditions=source, so every Node process it starts (test
// files, CLIs the tests spawn, coverage) resolves workspace packages to their TypeScript source.
// Works on Windows, where `VAR=value cmd` in an npm script does not.
//   node ../../scripts/with-source.mjs node --test "test/*.test.ts"
import { spawnSync } from "node:child_process";

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("usage: with-source.mjs <command> [args...]");
  process.exit(2);
}
const opts = (process.env.NODE_OPTIONS ?? "").split(/\s+/).filter(Boolean);
if (!opts.includes("--conditions=source")) opts.push("--conditions=source");
const program = cmd === "node" ? process.execPath : cmd;
const r = spawnSync(program, args, {
  stdio: "inherit",
  env: { ...process.env, NODE_OPTIONS: opts.join(" ") },
  shell: process.platform === "win32" && program !== process.execPath,
});
if (r.error) {
  console.error(String(r.error));
  process.exit(1);
}
process.exit(r.status ?? 1);
