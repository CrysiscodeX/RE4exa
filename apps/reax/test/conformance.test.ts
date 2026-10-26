// The core conformance kit, as reax relies on it: store ownership and durability, the single
// write path, leases and checkpoints, idempotency, topics and the mailbox. Each test is tagged
// with the limitation row (rea, leanrea or donor) whose failure it proves reax does not have.
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { MessageChannel, Worker } from "node:worker_threads";
import { isCoreError } from "@re4exa/core/errors";
import { makeRecord, probeKey, subjectDigest } from "@re4exa/core/evidence/record";
import { Kernel } from "@re4exa/core/kernel/kernel";
import { WriteBatcher } from "@re4exa/core/kernel/writer";

const CHILD = join(import.meta.dirname, "fixtures", "store-child.ts");
const WORKER = join(import.meta.dirname, "fixtures", "writer-worker.ts");

function temp() {
  const dir = mkdtempSync(join(tmpdir(), "reax-conf-"));
  return { dir, path: join(dir, "store.db"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

class Clock {
  t = 1_800_000_000_000;
  now = () => this.t;
}

/** Start a child; resolve once a stdout line matches `until`, with every line seen so far. */
function child(
  mode: string,
  path: string,
  until: RegExp,
): Promise<{ p: ChildProcess; lines: string[]; exit: Promise<number | null> }> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", CHILD, mode, path], {
      stdio: ["pipe", "pipe", "inherit"],
    });
    const lines: string[] = [];
    const exit = new Promise<number | null>((r) => p.on("exit", (code) => r(code)));
    let buf = "";
    let done = false;
    p.stdout!.setEncoding("utf8");
    p.stdout!.on("data", (d: string) => {
      buf += d;
      let i = buf.indexOf("\n");
      while (i >= 0) {
        lines.push(buf.slice(0, i).trim());
        buf = buf.slice(i + 1);
        if (!done && until.test(lines[lines.length - 1]!)) {
          done = true;
          resolve({ p, lines, exit });
        }
        i = buf.indexOf("\n");
      }
    });
    p.on("error", reject);
    exit.then((c) => !done && reject(new Error(`child ${mode} exited ${c} before ${until}`)));
  });
}

async function readerCount(path: string): Promise<number> {
  const c = await child("read", path, /^\d+$/);
  await c.exit;
  return Number(c.lines.at(-1));
}

test("[+PD-1] a second owner is refused while one process holds the store; readers in other processes still read", async () => {
  const t = temp();
  try {
    const k = Kernel.open({ path: t.path });
    k.send({ to: "a", from: "b", kind: "k", body: 1 });
    const second = await child("own", t.path, /./).catch((e: Error) => e);
    assert.ok(second instanceof Error, "the child could not become owner");
    assert.throws(
      () => Kernel.open({ path: t.path }),
      (e) => isCoreError(e, "store_locked"),
    );
    assert.equal(await readerCount(t.path), 1, "a reader in another process sees the committed row");
    k.close();
  } finally {
    t.cleanup();
  }
});

test("[-PD-1] killing the owner releases the store; the next owner gets every committed row", async () => {
  const t = temp();
  try {
    const c = await child("commit-loop", t.path, /^committed 50$/);
    c.p.kill("SIGKILL");
    await c.exit;
    const k = Kernel.open({ path: t.path });
    assert.ok(k.inbox("loop").length >= 50);
    k.close();
  } finally {
    t.cleanup();
  }
});

test("[+REA-A5.1] [+PD-6] a SIGKILL during a stream of commits loses no committed row and leaves an intact store", async () => {
  const t = temp();
  try {
    const c = await child("commit-loop", t.path, /^committed 300$/);
    c.p.kill("SIGKILL");
    await c.exit;
    const reported = Math.max(...c.lines.map((l) => Number(l.match(/^committed (\d+)$/)?.[1] ?? 0)));
    const raw = new DatabaseSync(t.path);
    assert.equal((raw.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check, "ok");
    const n = (raw.prepare("SELECT COUNT(*) AS n FROM mailbox").get() as { n: number }).n;
    raw.close();
    assert.ok(n >= reported, `${n} rows on disk, ${reported} reported committed`);
  } finally {
    t.cleanup();
  }
});

test("[-REA-A5.1] [-PD-6] a row in a transaction open when the owner dies is not on disk; durability is FULL", async () => {
  const t = temp();
  try {
    const c = await child("open-tx", t.path, /^inserted$/);
    c.p.kill("SIGKILL");
    await c.exit;
    const k = Kernel.open({ path: t.path });
    assert.equal(k.inbox("tx").length, 0);
    assert.equal(k.get<{ synchronous: number }>("PRAGMA synchronous")!.synchronous, 2, "synchronous=FULL");
    assert.equal(k.get<{ journal_mode: string }>("PRAGMA journal_mode")!.journal_mode, "wal");
    k.close();
  } finally {
    t.cleanup();
  }
});

const handlers = {
  send: (k: Kernel, a: unknown) => k.send(a as Parameters<Kernel["send"]>[0]),
  fail: () => {
    throw new Error("handler failed");
  },
};

test("[+PD-7] [+OR-2] worker threads write only through the owner's batcher; every row lands once, in order per sender", async () => {
  const t = temp();
  const k = Kernel.open({ path: t.path });
  const w = new WriteBatcher(k, handlers, { maxRows: 64, maxMs: 2 });
  try {
    const results = await Promise.all(
      ["w1", "w2", "w3", "w4"].map(
        (id) =>
          new Promise<{ id: string; seen: number; writeRefused: boolean }>((resolve, reject) => {
            const ch = new MessageChannel();
            w.attach(ch.port1);
            const worker = new Worker(WORKER, {
              workerData: { path: t.path, port: ch.port2, id, n: 100 },
              transferList: [ch.port2],
            });
            worker.once("message", (m) => {
              ch.port1.close();
              resolve(m);
            });
            worker.once("error", reject);
          }),
      ),
    );
    for (const r of results) {
      assert.equal(r.seen, 100, `${r.id}: its reader saw all its rows as soon as its writes resolved`);
      assert.ok(r.writeRefused, `${r.id}: a direct write from the worker's reader is refused`);
    }
    const rows = k.inbox("box");
    assert.equal(rows.length, 400);
    assert.equal(new Set(rows.map((r) => r.id)).size, 400);
    for (const id of ["w1", "w2", "w3", "w4"]) {
      const bodies = rows.filter((r) => r.from === id).map((r) => r.body as number);
      assert.deepEqual(
        bodies,
        [...bodies].sort((a, b) => a - b),
        `${id}'s rows keep their order`,
      );
    }
    assert.ok(w.stats.largestBatch <= 64);
  } finally {
    w.close();
    k.close();
    t.cleanup();
  }
});

test("[-PD-7] nothing is visible before its batch commits, and a failing request leaves no rows", async () => {
  const t = temp();
  const k = Kernel.open({ path: t.path });
  const reader = Kernel.open({ path: t.path, mode: "reader" });
  const w = new WriteBatcher(k, handlers, { maxRows: 8, maxMs: 2 });
  try {
    const ok = w.submit([{ op: "send", args: { to: "v", from: "a", kind: "k", body: 1 } }]);
    const bad = w.submit([{ op: "send", args: { to: "v", from: "b", kind: "k", body: 2 } }, { op: "fail" }]);
    assert.equal(reader.inbox("v").length, 0, "not yet committed");
    await ok;
    await assert.rejects(bad, /handler failed/);
    assert.deepEqual(
      reader.inbox("v").map((m) => m.body),
      [1],
    );
  } finally {
    w.close();
    reader.close();
    k.close();
    t.cleanup();
  }
});

test("[-OR-2] an ack from another recipient changes nothing; acked messages are not delivered again", () => {
  const t = temp();
  const k = Kernel.open({ path: t.path });
  try {
    const id = k.send({ to: "me", from: "x", kind: "k", body: 1 });
    k.ack("someone-else", [id]);
    assert.equal(k.inbox("me").length, 1);
    k.ack("me", [id]);
    k.ack("me", [id]);
    assert.equal(k.inbox("me").length, 0);
    assert.equal(k.inbox("me", { includeAcked: true }).length, 1);
  } finally {
    k.close();
    t.cleanup();
  }
});

function withTask(clock: Clock) {
  const t = temp();
  const k = Kernel.open({ path: t.path, clock: clock.now });
  k.spawnTask({ queue: "q", kind: "x" });
  return { t, k };
}

test("[+AB-P1] every write from an attempt whose lease has expired is refused", async () => {
  const clock = new Clock();
  const { t, k } = withTask(clock);
  try {
    const a = k.claimTask("q", "w1", 1000)!;
    clock.t += 1000;
    const expired = (e: unknown) => isCoreError(e, "lease_expired");
    await assert.rejects(
      k.checkpoint(a, "c", () => 1),
      expired,
    );
    assert.throws(() => k.commitStep(a, "s", () => 1), expired);
    assert.throws(() => k.extendLease(a, 1000), expired);
    assert.throws(() => k.completeTask(a, "done"), expired);
    assert.throws(() => k.failTask(a, "x"), expired);
    assert.equal(k.get<{ n: number }>("SELECT COUNT(*) AS n FROM checkpoints")!.n, 0);
  } finally {
    k.close();
    t.cleanup();
  }
});

test("[-AB-P1] a superseded attempt stays refused after the task is reclaimed; the new attempt writes", async () => {
  const clock = new Clock();
  const { t, k } = withTask(clock);
  try {
    const a1 = k.claimTask("q", "w1", 1000)!;
    clock.t += 1001;
    const a2 = k.claimTask("q", "w2", 1000)!;
    assert.ok(a2 && a2.n === 2);
    assert.throws(
      () => k.completeTask(a1, "old"),
      (e) => isCoreError(e, "stale_attempt"),
    );
    k.completeTask(a2, "new");
    assert.equal(k.getTask(a2.taskId)!.result, "new");
  } finally {
    k.close();
    t.cleanup();
  }
});

test("[+AB-P4] a lease of zero, below zero, NaN or Infinity is refused everywhere a lease is set", () => {
  const clock = new Clock();
  const { t, k } = withTask(clock);
  try {
    const bad = [0, -1, Number.NaN, Number.POSITIVE_INFINITY];
    const invalid = (e: unknown) => isCoreError(e, "invalid_lease");
    for (const ms of bad) assert.throws(() => k.claimTask("q", "w", ms), invalid, `claimTask ${ms}`);
    const a = k.claimTask("q", "w", 1000)!;
    for (const ms of bad) assert.throws(() => k.extendLease(a, ms), invalid, `extendLease ${ms}`);
  } finally {
    k.close();
    t.cleanup();
  }
});

test("[-AB-P4] a 1 ms lease is valid until its millisecond passes, then expires", () => {
  const clock = new Clock();
  const { t, k } = withTask(clock);
  try {
    const a = k.claimTask("q", "w", 1)!;
    k.fence(a);
    clock.t += 1;
    assert.throws(
      () => k.fence(a),
      (e) => isCoreError(e, "lease_expired"),
    );
  } finally {
    k.close();
    t.cleanup();
  }
});

test("[+AB-P6] a checkpoint from an attempt that lost its lease is refused and not stored", async () => {
  const clock = new Clock();
  const { t, k } = withTask(clock);
  try {
    const a = k.claimTask("q", "w", 1000)!;
    let computed = 0;
    clock.t += 2000;
    await assert.rejects(k.checkpoint(a, "c", () => ++computed));
    assert.equal(k.get<{ n: number }>("SELECT COUNT(*) AS n FROM checkpoints WHERE task_id=?", a.taskId)!.n, 0);
    assert.equal(computed, 0, "the computation does not run for an attempt that lost its lease");
  } finally {
    k.close();
    t.cleanup();
  }
});

test("[-AB-P6] a checkpoint written by one attempt is read back, not recomputed, by the next", async () => {
  const clock = new Clock();
  const { t, k } = withTask(clock);
  try {
    const a1 = k.claimTask("q", "w1", 1000)!;
    assert.equal(await k.checkpoint(a1, "c", () => "first"), "first");
    clock.t += 1001;
    const a2 = k.claimTask("q", "w2", 1000)!;
    assert.equal(await k.checkpoint(a2, "c", () => "second"), "first");
  } finally {
    k.close();
    t.cleanup();
  }
});

test("[+AB-P8] lease arithmetic uses only the injected clock: a frozen clock keeps a lease alive", async () => {
  const clock = new Clock();
  const { t, k } = withTask(clock);
  try {
    const a = k.claimTask("q", "w", 5)!;
    await new Promise((r) => setTimeout(r, 30));
    k.fence(a);
  } finally {
    k.close();
    t.cleanup();
  }
});

test("[-AB-P8] moving the injected clock past the lease expires it at once, with no real wait", () => {
  const clock = new Clock();
  const { t, k } = withTask(clock);
  try {
    const a = k.claimTask("q", "w", 3_600_000)!;
    clock.t += 3_600_000;
    assert.throws(
      () => k.fence(a),
      (e) => isCoreError(e, "lease_expired"),
    );
  } finally {
    k.close();
    t.cleanup();
  }
});

test("[+AB-P12] catching the lease error does not let the attempt write: every later write is refused too", () => {
  const clock = new Clock();
  const { t, k } = withTask(clock);
  try {
    const a = k.claimTask("q", "w", 1000)!;
    clock.t += 1000;
    try {
      k.commitStep(a, "s1", () => 1);
    } catch {
      // user code swallows the error and carries on
    }
    assert.throws(() => k.commitStep(a, "s2", () => 2));
    assert.throws(() => k.completeTask(a, "done"));
    assert.equal(k.get<{ n: number }>("SELECT COUNT(*) AS n FROM checkpoints")!.n, 0);
  } finally {
    k.close();
    t.cleanup();
  }
});

test("[-AB-P12] the swallowed error leaves the task reclaimable, and the next attempt completes it", () => {
  const clock = new Clock();
  const { t, k } = withTask(clock);
  try {
    const a = k.claimTask("q", "w1", 1000)!;
    clock.t += 1000;
    try {
      k.completeTask(a, "x");
    } catch {
      // swallowed
    }
    const b = k.claimTask("q", "w2", 1000)!;
    k.completeTask(b, "ok");
    assert.equal(k.getTask(b.taskId)!.state, "completed");
  } finally {
    k.close();
    t.cleanup();
  }
});

test("[+PD-5] a repeated request id returns the first task instead of creating a second", () => {
  const t = temp();
  const k = Kernel.open({ path: t.path });
  try {
    const a = k.spawnTask({ queue: "q", kind: "x", idempotencyKey: "req-1" });
    const b = k.spawnTask({ queue: "q", kind: "x", idempotencyKey: "req-1" });
    assert.equal(a.task.id, b.task.id);
    assert.deepEqual([a.created, b.created], [true, false]);
  } finally {
    k.close();
    t.cleanup();
  }
});

test("[-PD-5] the store itself refuses a duplicate request id (a UNIQUE index, not only a lookup)", () => {
  const t = temp();
  const k = Kernel.open({ path: t.path });
  try {
    k.spawnTask({ queue: "q", kind: "x", idempotencyKey: "req-1" });
    assert.throws(
      () =>
        k.run(
          "INSERT INTO tasks(id,queue,kind,state,idem_key,attempts,crash_count,max_attempts,available_at,created_at,updated_at) VALUES('t2','q','x','pending','req-1',0,0,1,0,0,0)",
        ),
      /UNIQUE/,
    );
  } finally {
    k.close();
    t.cleanup();
  }
});

const probe = { id: "file.identify", version: "1" };
function recordFor(bytes: string, params: Record<string, unknown> | null = null) {
  const digest = subjectDigest(new TextEncoder().encode(bytes));
  return makeRecord(
    {
      probe,
      probe_key: probeKey(probe, params as never, digest),
      predicate: "file.identify",
      subject: { digest },
      params: params as never,
      result: { format: "text" } as never,
      confidence: "observed",
      producer: { kind: "runner", id: "reax-runner" },
    },
    1,
  );
}

test("[+REA-A3.1] the same bytes give the same evidence id wherever the file lives", () => {
  // The record holds the content digest, never a path, so two copies at different paths match.
  assert.equal(recordFor("same bytes").observation_id, recordFor("same bytes").observation_id);
});

test("[-REA-A3.1] different bytes give different ids, and an absolute path in params is refused", () => {
  assert.notEqual(recordFor("a").observation_id, recordFor("b").observation_id);
  assert.throws(
    () => recordFor("a", { path: "/home/user/file" }),
    (e) => isCoreError(e, "evidence_invalid"),
  );
});

test("[+AB-P2] a topic event is stored once per dedupe key and each reader's cursor sees it once", () => {
  const t = temp();
  const k = Kernel.open({ path: t.path });
  try {
    assert.equal(k.publish("t", "e1", 1).created, true);
    assert.equal(k.publish("t", "e1", 1).created, false);
    k.publish("t", "e2", 2);
    for (const cursor of [0, 0]) {
      const page1 = k.readTopic("t", cursor, 1);
      const page2 = k.readTopic("t", page1.at(-1)!.seq, 10);
      assert.deepEqual(
        [...page1, ...page2].map((e) => e.payload),
        [1, 2],
      );
    }
  } finally {
    k.close();
    t.cleanup();
  }
});

test("[-AB-P2] reading past the last event returns nothing; a new key gets the next sequence number", () => {
  const t = temp();
  const k = Kernel.open({ path: t.path });
  try {
    const { seq } = k.publish("t", "e1", 1);
    assert.deepEqual(k.readTopic("t", seq), []);
    assert.equal(k.publish("t", "e2", 2).seq, seq + 1);
  } finally {
    k.close();
    t.cleanup();
  }
});

test("[+AB-P11] a checkpoint over the size cap, or past the per-task count cap, is refused", async () => {
  const t = temp();
  const k = Kernel.open({ path: t.path, maxCheckpointBytes: 32, maxCheckpointsPerTask: 1 });
  try {
    k.spawnTask({ queue: "q", kind: "x" });
    const a = k.claimTask("q", "w", 60_000)!;
    await assert.rejects(
      k.checkpoint(a, "big", () => "x".repeat(64)),
      (e) => isCoreError(e, "checkpoint_too_large"),
    );
    k.commitStep(a, "one", () => 1);
    assert.throws(
      () => k.commitStep(a, "two", () => 2),
      (e) => isCoreError(e, "checkpoint_too_large"),
    );
  } finally {
    k.close();
    t.cleanup();
  }
});

test("[-AB-P11] checkpoints within the caps are stored and read back", async () => {
  const t = temp();
  const k = Kernel.open({ path: t.path, maxCheckpointBytes: 32, maxCheckpointsPerTask: 2 });
  try {
    k.spawnTask({ queue: "q", kind: "x" });
    const a = k.claimTask("q", "w", 60_000)!;
    assert.equal(await k.checkpoint(a, "c1", () => "x".repeat(20)), "x".repeat(20));
    assert.equal(
      k.commitStep(a, "c2", () => 2),
      2,
    );
  } finally {
    k.close();
    t.cleanup();
  }
});

test("[+AB-P14] a migration that fails part-way leaves the version and the schema as they were", () => {
  const t = temp();
  const k = Kernel.open({ path: t.path });
  try {
    k.migrateNamespace("reax", ["CREATE TABLE r1 (x)"]);
    assert.throws(() => k.migrateNamespace("reax", ["CREATE TABLE r1 (x)", "CREATE TABLE r2 (y)", "BROKEN"]));
    assert.equal(k.meta("schema_version:reax"), "1");
    assert.equal(k.get("SELECT name FROM sqlite_master WHERE name='r2'"), undefined);
  } finally {
    k.close();
    t.cleanup();
  }
});

test("[-AB-P14] a successful migration bumps the version once, after copying the store aside", () => {
  const t = temp();
  const k = Kernel.open({ path: t.path });
  try {
    k.migrateNamespace("reax", ["CREATE TABLE r1 (x)"]);
    const r = k.migrateNamespace("reax", ["CREATE TABLE r1 (x)", "CREATE TABLE r2 (y)"]);
    assert.deepEqual([r.from, r.to], [1, 2]);
    assert.ok(r.backup);
    assert.deepEqual(k.migrateNamespace("reax", ["CREATE TABLE r1 (x)", "CREATE TABLE r2 (y)"]), {
      from: 2,
      to: 2,
      backup: null,
    });
  } finally {
    k.close();
    t.cleanup();
  }
});

test("[+REA-A2.2] [+REA-C30-LIMIT] a store is exported page by page and the copy opens with every row", async () => {
  const t = temp();
  const k = Kernel.open({ path: t.path });
  try {
    k.tx(() => {
      for (let i = 0; i < 5000; i++) k.send({ to: "big", from: "x", kind: "k", body: "y".repeat(200) });
    });
    const dest = join(t.dir, "copy.db");
    await k.exportTo(dest);
    const copy = Kernel.open({ path: dest, mode: "reader" });
    assert.equal(copy.inbox("big").length, 5000);
    copy.close();
  } finally {
    k.close();
    t.cleanup();
  }
});

test("[-REA-A2.2] [-REA-C30-LIMIT] an export never overwrites an existing file", async () => {
  const t = temp();
  const k = Kernel.open({ path: t.path });
  try {
    const dest = join(t.dir, "copy.db");
    await k.exportTo(dest);
    await assert.rejects(k.exportTo(dest), (e) => isCoreError(e, "path_exists"));
  } finally {
    k.close();
    t.cleanup();
  }
});
