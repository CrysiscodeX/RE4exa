#!/usr/bin/env node
// Run the reax CLI from a checkout: Node runs the TypeScript sources directly, resolving the
// workspace packages to their sources (--conditions=source).
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const cli = join(import.meta.dirname, "..", "src", "cli.ts");
const r = spawnSync(process.execPath, ["--conditions=source", "--disable-warning=ExperimentalWarning", cli, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);
