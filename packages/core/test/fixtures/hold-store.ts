// Opens a store, announces "ready", waits for a line on stdin, writes N rows, exits.
import { Kernel } from "../../src/kernel/kernel.ts";

const [path, rows] = process.argv.slice(2);
const k = Kernel.open({ path: path! });
process.stdout.write("ready\n");
process.stdin.setEncoding("utf8");
process.stdin.once("data", () => {
  for (let i = 0; i < Number(rows); i++) k.send({ to: "x", from: "holder", kind: "row", body: i });
  k.close();
  process.exit(0);
});
