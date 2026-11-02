// The sandbox tests' tripwire child. One action per run, its outcome as one JSON line on stdout:
//   read <path>            {"op":"read","ok":true,"sha256":"..."} or {"ok":false,"code":"EPERM"}
//   write <path> <text>    {"op":"write","ok":true} or {"ok":false,"code":"..."}
//   connect <port>         TCP connect to 127.0.0.1:<port>, at most 5 s
//   tree <path>            starts a grandchild that never exits, writes its pid to <path> (a file in
//                          scratch, so the test can see it even if stdout is cut), then waits
//   setsid <path>          the same, but the grandchild is spawned detached (its own session)
//   background <path>      the same as tree, but the child exits at once (a normal exit)
//   escape <path>          a double fork: a detached middle process starts a detached grandchild
//                          that holds this child's stdout, writes its pid to <path> and exits;
//                          the child then waits
//   setsid-exit <path>     a detached grandchild that holds this child's stdout; the child writes
//                          its pid to <path>, its own pid to <path>.root, and exits at once
//   env <name>             {"op":"env","ok":true,"value":<the variable or null>}
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";

const [op, a, b] = process.argv.slice(2);
const out = (o) => process.stdout.write(`${JSON.stringify({ op, ...o })}\n`);
const fail = (e) => out({ ok: false, code: e.code ?? String(e.message) });

if (op === "read") {
  try {
    out({ ok: true, sha256: createHash("sha256").update(readFileSync(a)).digest("hex") });
  } catch (e) {
    fail(e);
  }
} else if (op === "write") {
  try {
    writeFileSync(a, b ?? "");
    out({ ok: true });
  } catch (e) {
    fail(e);
  }
} else if (op === "connect") {
  const s = connect({ host: "127.0.0.1", port: Number(a) });
  const t = setTimeout(() => {
    s.destroy();
    out({ ok: false, code: "TIMEOUT" });
  }, 5000);
  s.once("connect", () => {
    clearTimeout(t);
    s.end();
    out({ ok: true });
  });
  s.once("error", (e) => {
    clearTimeout(t);
    fail(e);
  });
} else if (op === "tree") {
  const g = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  writeFileSync(a, String(g.pid));
  out({ ok: true, grandchild: g.pid });
  setInterval(() => {}, 1000);
} else if (op === "setsid" || op === "background") {
  const g = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
    detached: op === "setsid",
  });
  writeFileSync(a, String(g.pid));
  out({ ok: true, grandchild: g.pid });
  if (op === "setsid") setInterval(() => {}, 1000);
  else process.exit(0);
} else if (op === "escape") {
  const middle = `const g = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", "inherit", "inherit"], detached: true });
    require("node:fs").writeFileSync(${JSON.stringify(a)}, String(g.pid));
    process.exit(0);`;
  spawn(process.execPath, ["-e", middle], { stdio: ["ignore", "inherit", "inherit"], detached: true });
  setInterval(() => {}, 1000);
} else if (op === "setsid-exit") {
  const g = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
  });
  writeFileSync(a, String(g.pid));
  writeFileSync(`${a}.root`, String(process.pid));
  process.exit(0);
} else if (op === "env") {
  out({ ok: true, value: process.env[a] ?? null });
} else {
  out({ ok: false, code: "USAGE" });
  process.exitCode = 2;
}
