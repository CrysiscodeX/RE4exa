// A separate process acting on a store, for the conformance tests.
//   own <path>          open as owner, print "ready", close when a line arrives on stdin
//   commit-loop <path>  open as owner and commit one row at a time, printing "committed <n>"
//   open-tx <path>      open as owner, insert a row inside a transaction left open, print "inserted"
//   read <path>         open as a reader, print the mailbox row count, exit
import { Kernel } from "@re4exa/core/kernel/kernel";

const [mode, path] = process.argv.slice(2) as [string, string];
const out = (s: string) => process.stdout.write(`${s}\n`);
if (mode === "own") {
  const k = Kernel.open({ path });
  out("ready");
  process.stdin.once("data", () => {
    k.close();
    process.exit(0);
  });
} else if (mode === "commit-loop") {
  const k = Kernel.open({ path });
  let n = 0;
  const step = () => {
    k.send({ to: "loop", from: "child", kind: "row", body: n });
    n++;
    out(`committed ${n}`);
    setImmediate(step);
  };
  step();
} else if (mode === "open-tx") {
  const k = Kernel.open({ path });
  k.db.exec("BEGIN IMMEDIATE");
  k.db.prepare("INSERT INTO mailbox(recipient,sender,kind,body,created_at) VALUES('tx','child','row','x',0)").run();
  out("inserted");
  setInterval(() => {}, 1000);
} else if (mode === "read") {
  const k = Kernel.open({ path, mode: "reader" });
  out(String(k.get<{ n: number }>("SELECT COUNT(*) AS n FROM mailbox")!.n));
  k.close();
} else {
  console.error(`unknown mode ${mode}`);
  process.exit(2);
}
