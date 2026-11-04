// A child for test/bounded.test.ts. Modes:
//   tree   start a grandchild (same process group), print `grandchild=<pid>`, then wait
//   trap   ignore SIGTERM, print `ready`, then wait
//   leave  start a grandchild, print `grandchild=<pid>`, then exit 0 (the grandchild stays)
//   exit N exit with code N
// Every wait is bounded (5 minutes), so nothing outlives a broken test for long.
import { spawn } from "node:child_process";

const [mode, arg] = process.argv.slice(2);
const LIFE_MS = 300_000;

function grandchild() {
  const g = spawn(process.execPath, ["-e", `setTimeout(() => {}, ${LIFE_MS})`], { stdio: "ignore" });
  process.stdout.write(`grandchild=${g.pid}\n`);
  return g;
}

if (mode === "tree") {
  grandchild();
  setTimeout(() => {}, LIFE_MS);
} else if (mode === "trap") {
  process.on("SIGTERM", () => {});
  process.stdout.write("ready\n");
  setTimeout(() => {}, LIFE_MS);
} else if (mode === "leave") {
  const g = grandchild();
  g.unref();
  process.exit(0);
} else if (mode === "escape") {
  // a grandchild in a new session (setsid): outside the runner's group
  const g = spawn(process.execPath, ["-e", `setTimeout(() => {}, ${LIFE_MS})`], { stdio: "ignore", detached: true });
  process.stdout.write(`grandchild=${g.pid}\n`);
  g.unref();
  process.exit(0);
} else if (mode === "exit") {
  process.exit(Number(arg));
} else {
  process.stderr.write(`bounded-child: unknown mode ${mode}\n`);
  process.exit(9);
}
