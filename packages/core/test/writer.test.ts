import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { isCoreError } from "../src/errors.ts";
import { Kernel } from "../src/kernel/kernel.ts";
import { WriteBatcher } from "../src/kernel/writer.ts";
import { tmp } from "../src/testing/helpers.ts";

const handlers = {
  send: (k: Kernel, a: unknown) => k.send(a as Parameters<Kernel["send"]>[0]),
  fail: () => {
    throw new Error("handler failed");
  },
};

test("the batcher commits requests in bounded batches and resolves only after commit", async () => {
  const t = tmp();
  const path = join(t.dir, "s.db");
  const k = Kernel.open({ path });
  const reader = Kernel.open({ path, mode: "reader" });
  const w = new WriteBatcher(k, handlers, { maxRows: 10, maxMs: 2 });
  try {
    const pending = Array.from({ length: 25 }, (_, i) =>
      w.submit([{ op: "send", args: { to: "r", from: "w", kind: "k", body: i } }]),
    );
    assert.equal(reader.inbox("r").length, 0, "nothing is visible before the batch commits");
    const bad = w.submit([{ op: "send", args: { to: "r", from: "w", kind: "k", body: "half" } }, { op: "fail" }]);
    await Promise.all(pending);
    await assert.rejects(bad, /handler failed/);
    const bodies = reader.inbox("r").map((m) => m.body);
    assert.equal(bodies.length, 25, "the failing request left no rows, the others all committed");
    assert.ok(!bodies.includes("half"));
    assert.ok(w.stats.largestBatch <= 10);
    await assert.rejects(w.submit([{ op: "nope" }]), (e) => isCoreError(e, "write_op_unknown"));
    assert.throws(
      () => new WriteBatcher(reader, handlers),
      (e) => isCoreError(e, "store_read_only"),
    );
  } finally {
    w.close();
    reader.close();
    k.close();
    t.cleanup();
  }
});
