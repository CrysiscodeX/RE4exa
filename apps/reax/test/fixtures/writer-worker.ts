// A worker thread that reads through its own reader connection and writes only through the
// owner's WriteBatcher, over the port it is given.
import { parentPort, workerData } from "node:worker_threads";
import { Kernel } from "@re4exa/core/kernel/kernel";
import { writerClient } from "@re4exa/core/kernel/writer";

const { path, port, id, n } = workerData as {
  path: string;
  port: import("node:worker_threads").MessagePort;
  id: string;
  n: number;
};
const reader = Kernel.open({ path, mode: "reader" });
const w = writerClient(port);
let writeRefused = false;
try {
  reader.send({ to: "x", from: id, kind: "k", body: 0 });
} catch {
  writeRefused = true;
}
await Promise.all(
  Array.from({ length: n }, (_, i) => w.submit([{ op: "send", args: { to: "box", from: id, kind: "k", body: i } }])),
);
const seen = reader.get<{ n: number }>("SELECT COUNT(*) AS n FROM mailbox WHERE sender=?", id)!.n;
reader.close();
w.close();
parentPort!.postMessage({ id, seen, writeRefused });
