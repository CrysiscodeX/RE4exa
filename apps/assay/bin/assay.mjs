#!/usr/bin/env node
// Launcher. Installed packages run the built JavaScript (dist/); a source checkout without a build
// runs the TypeScript directly with Node's type stripping (Node 22.12+).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const built = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const source = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const entry = existsSync(built) ? built : source;
const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", entry, ...process.argv.slice(2)], { stdio: "inherit" });
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => child.kill(s));
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
