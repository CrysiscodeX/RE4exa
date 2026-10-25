#!/usr/bin/env node
// Launcher: runs the TypeScript sources with Node's type stripping (Node 22.12+).
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", cli, ...process.argv.slice(2)], { stdio: "inherit" });
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => child.kill(s));
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
