// A fake command-line engine for the engine contract tests (test/engines.test.ts). Its outputs are
// fixed here, so the tests know what each mode must produce:
//   [--claim-version X] --version   prints "fake-engine version X" (X defaults to 18.2.0)
//   ok        two symbols in llvm-nm -P form: "alpha T 1000 10" and "beta D 2000 8"
//   sleep     starts one grandchild in this process's group (not detached),
//             writes {"root":<pid>,"grandchild":<pid>} to pids.json in the working directory, then
//             waits forever
//   fail      writes 5000 bytes to stderr (starting "fake failure: ") and exits 3
//   garbage   prints a line that is not llvm-nm -P output, exits 0
//   big <n>   prints at least <n> bytes of valid lines ("s<i> T <hex> 1"), exits 0
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

let args = process.argv.slice(2);
let version = "18.2.0";
if (args[0] === "--claim-version") {
  version = args[1];
  args = args.slice(2);
}
const [mode, n] = args;

if (mode === "--version") {
  process.stdout.write(`fake-engine version ${version}\n`);
} else if (mode === "ok") {
  process.stdout.write("alpha T 1000 10\nbeta D 2000 8\n");
} else if (mode === "sleep") {
  const g = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  writeFileSync("pids.json", JSON.stringify({ root: process.pid, grandchild: g.pid }));
  setInterval(() => {}, 1000);
} else if (mode === "fail") {
  process.stderr.write(`fake failure: ${"x".repeat(5000 - 14)}`);
  process.exitCode = 3;
} else if (mode === "garbage") {
  process.stdout.write("this is not llvm-nm output\n");
} else if (mode === "big") {
  const want = Number(n);
  const lines = [];
  let bytes = 0;
  for (let i = 0; bytes < want && i < 10_000_000; i++) {
    const l = `s${i} T ${(0x1000 + i).toString(16)} 1\n`;
    lines.push(l);
    bytes += l.length;
  }
  process.stdout.write(lines.join(""));
} else {
  process.stderr.write(`fake-engine: unknown mode ${mode}\n`);
  process.exitCode = 2;
}
