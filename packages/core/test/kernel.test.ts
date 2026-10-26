import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { isCoreError } from "../src/errors.ts";
import { Kernel } from "../src/kernel/kernel.ts";
import { FakeClock, lcg, openTemp, tmp } from "../src/testing/helpers.ts";

const HOLDER = join(import.meta.dirname, "fixtures", "hold-store.ts");

function startHolder(path: string, rows: number): Promise<{ child: ReturnType<typeof spawn>; done: Promise<number> }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", HOLDER, path, String(rows)], {
      stdio: ["pipe", "pipe", "inherit"],
    });
    const done = new Promise<number>((r) => child.on("exit", (code) => r(code ?? -1)));
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (d: string) => {
      if (d.includes("ready")) resolve({ child, done });
    });
    child.on("error", reject);
  });
}

test("a second process is refused while the store is open, and no committed row is lost (M6)", async () => {
  const t = tmp();
  const path = join(t.dir, "assay.db");
  const { child, done } = await startHolder(path, 200);
  let refused = 0;
  for (let i = 0; i < 1000; i++) {
    try {
      Kernel.open({ path }).close();
    } catch (e) {
      if (isCoreError(e, "store_locked")) refused++;
      else throw e;
    }
  }
  child.stdin!.end("write\n");
  assert.equal(await done, 0);
  assert.equal(refused, 1000);
  const k = Kernel.open({ path });
  assert.equal(k.get<{ n: number }>("SELECT COUNT(*) AS n FROM mailbox")!.n, 200);
  k.close();
  t.cleanup();
});

test("a store from a newer schema is refused", () => {
  const t = tmp();
  const path = join(t.dir, "assay.db");
  Kernel.open({ path }).close();
  const raw = new DatabaseSync(path);
  raw.exec("UPDATE meta SET v='999' WHERE k='schema_version'");
  raw.close();
  assert.throws(
    () => Kernel.open({ path }),
    (e) => isCoreError(e, "store_schema_newer"),
  );
  t.cleanup();
});

test("lease must be positive; the fence refuses expired and superseded attempts (M7)", async () => {
  const clock = new FakeClock();
  const { k, cleanup } = openTemp(clock);
  assert.throws(
    () => k.claimTask("q", "w", 0),
    (e) => isCoreError(e, "invalid_lease"),
  );
  assert.throws(
    () => k.claimTask("q", "w", -5),
    (e) => isCoreError(e, "invalid_lease"),
  );
  k.spawnTask({ queue: "q", kind: "x" });
  const a1 = k.claimTask("q", "w1", 1000)!;
  await k.checkpoint(a1, "s1", () => 1);
  clock.advance(1000);
  // expired but not yet swept: every write is refused
  await assert.rejects(
    k.checkpoint(a1, "s2", () => 2),
    (e) => isCoreError(e, "lease_expired"),
  );
  assert.throws(
    () => k.extendLease(a1, 1000),
    (e) => isCoreError(e, "lease_expired"),
  );
  assert.throws(
    () => k.completeTask(a1, "done"),
    (e) => isCoreError(e, "lease_expired"),
  );
  const a2 = k.claimTask("q", "w2", 1000)!;
  assert.equal(a2.n, 2);
  assert.equal(await k.checkpoint(a2, "s1", () => 99), 1, "first write wins across attempts");
  assert.throws(
    () => k.completeTask(a1, "late"),
    (e) => isCoreError(e, "stale_attempt"),
  );
  k.completeTask(a2, "ok");
  assert.equal(k.getTask(a2.taskId)!.result, "ok");
  cleanup();
});

test("fence race: 1,000 interleavings never accept a stale write", () => {
  const clock = new FakeClock();
  const { k, cleanup } = openTemp(clock);
  let accepted = 0;
  let rejected = 0;
  const rnd = lcg(7);
  for (let i = 0; i < 1000; i++) {
    const { task } = k.spawnTask({ queue: "race", kind: "x" });
    const a1 = k.claimTask("race", "old", 100)!;
    assert.equal(a1.taskId, task.id);
    clock.advance(100 + Math.floor(rnd() * 50));
    const a2 = rnd() < 0.5 ? k.claimTask("race", "new", 100) : null;
    try {
      k.commitStep(a1, "w", () => "old");
      accepted++;
    } catch (e) {
      assert.ok(isCoreError(e, "lease_expired") || isCoreError(e, "stale_attempt"));
      rejected++;
    }
    if (a2) k.completeTask(a2, "new");
    else k.cancelTask(task.id);
  }
  assert.equal(accepted, 0);
  assert.equal(rejected, 1000);
  cleanup();
});

test("a task that keeps crashing is parked after 5 crashes, and can be unparked", () => {
  const clock = new FakeClock();
  const { k, cleanup } = openTemp(clock);
  const { task } = k.spawnTask({ queue: "q", kind: "x", maxAttempts: 100 });
  for (let i = 0; i < 5; i++) {
    assert.ok(k.claimTask("q", "w", 10));
    clock.advance(11);
  }
  assert.equal(k.claimTask("q", "w", 10), null);
  assert.equal(k.getTask(task.id)!.state, "parked");
  k.unparkTask(task.id);
  assert.ok(k.claimTask("q", "w", 10));
  cleanup();
});

test("failTask retries until max attempts, then fails", () => {
  const { k, cleanup } = openTemp(new FakeClock());
  const { task } = k.spawnTask({ queue: "q", kind: "x", maxAttempts: 2 });
  assert.equal(k.failTask(k.claimTask("q", "w", 100)!, new Error("boom")), "pending");
  assert.equal(k.failTask(k.claimTask("q", "w", 100)!, new Error("boom")), "failed");
  assert.equal((k.getTask(task.id)!.error as { message: string }).message, "boom");
  cleanup();
});

test("spawnTask is idempotent by key", () => {
  const { k, cleanup } = openTemp();
  const a = k.spawnTask({ queue: "q", kind: "x", idempotencyKey: "same" });
  const b = k.spawnTask({ queue: "q", kind: "x", idempotencyKey: "same" });
  assert.equal(a.task.id, b.task.id);
  assert.equal(b.created, false);
  cleanup();
});

test("effects: safe re-runs, keyed re-runs with the same key, unsafe settles as interrupted", async () => {
  const clock = new FakeClock();
  const { k, cleanup } = openTemp(clock);
  for (const replay of ["safe", "keyed", "unsafe"] as const) {
    k.spawnTask({ queue: replay, kind: "x" });
    const a1 = k.claimTask(replay, "w", 100)!;
    const keys: string[] = [];
    // first attempt: the effect starts, then the lease runs out before it settles (a crash)
    await assert.rejects(
      k.runEffect(a1, { name: "fx", replay, args: { n: 1 } }, (key) => {
        keys.push(key);
        clock.advance(200);
        return "first";
      }),
      (e) => isCoreError(e, "lease_expired"),
    );
    const a2 = k.claimTask(replay, "w", 100)!;
    if (replay === "unsafe") {
      await assert.rejects(
        k.runEffect(a2, { name: "fx", replay, args: { n: 1 } }, () => "second"),
        (e) => isCoreError(e, "effect_interrupted"),
      );
      assert.equal(keys.length, 1);
    } else {
      const out = await k.runEffect(a2, { name: "fx", replay, args: { n: 1 } }, (key) => {
        keys.push(key);
        return "second";
      });
      assert.equal(out, "second");
      assert.equal(keys.length, 2);
      assert.equal(keys[0], keys[1], "the same idempotency key is reused");
      // settled: a third call returns the stored result without running
      assert.equal(await k.runEffect(a2, { name: "fx", replay }, () => "third"), "second");
    }
  }
  cleanup();
});

test("receipts replay the first result and refuse a reused key with a different payload", async () => {
  const { k, cleanup } = openTemp();
  let runs = 0;
  const r1 = await k.withReceipt("r1", { a: 1 }, () => ++runs);
  const r2 = await k.withReceipt("r1", { a: 1 }, () => ++runs);
  assert.deepEqual([r1.result, r1.replayed, r2.result, r2.replayed, runs], [1, false, 1, true, 1]);
  await assert.rejects(
    k.withReceipt("r1", { a: 2 }, () => ++runs),
    (e) => isCoreError(e, "receipt_conflict"),
  );
  cleanup();
});

test("sequenced topics dedupe redeliveries and never return an old payload to a new wait", () => {
  const { k, cleanup } = openTemp();
  assert.deepEqual(k.publish("release:app", "1.0", { v: "1.0" }), { seq: 1, created: true });
  assert.deepEqual(k.publish("release:app", "1.0", { v: "1.0" }), { seq: 1, created: false });
  assert.deepEqual(k.readTopic("release:app", 1), []);
  k.publish("release:app", "1.1", { v: "1.1" });
  assert.deepEqual(k.readTopic("release:app", 1), [{ seq: 2, payload: { v: "1.1" } }]);
  cleanup();
});

test("mailbox delivers, acks, and keeps acked history", () => {
  const { k, cleanup } = openTemp();
  const id = k.send({ to: "coord", from: "w1", kind: "worker_done", body: { ok: true } });
  assert.equal(k.inbox("coord").length, 1);
  k.ack("coord", [id]);
  assert.equal(k.inbox("coord").length, 0);
  assert.equal(k.inbox("coord", { includeAcked: true }).length, 1);
  cleanup();
});

test("budgets stop spending before a limit is crossed", () => {
  const { k, cleanup } = openTemp();
  k.setBudget("case:1", { usd: 1, calls: 3 });
  k.checkBudget("case:1", { usd: 0.5 });
  k.spend("case:1", { usd: 0.9, calls: 1 });
  assert.throws(
    () => k.checkBudget("case:1", { usd: 0.2 }),
    (e) => isCoreError(e, "budget_exceeded"),
  );
  k.checkBudget("unbudgeted", { usd: 1e9 });
  cleanup();
});

test("case log is hash-chained, detects tampering, and can be forked at any step", () => {
  const { k, cleanup } = openTemp();
  const c = k.createCase({ title: "pkg", workspace: "/w" });
  for (let i = 1; i <= 5; i++) k.appendEvent(c.id, "msg", { i });
  assert.equal(k.verifyChain(c.id), null);
  const fork = k.forkCase(c.id, 3);
  assert.equal(k.events(fork.id).length, 3);
  assert.equal(k.getCase(fork.id)!.parent_case, c.id);
  assert.equal(k.verifyChain(fork.id), null);
  k.run("UPDATE case_events SET body=? WHERE case_id=? AND seq=2", JSON.stringify({ i: 42 }), c.id);
  assert.equal(k.verifyChain(c.id), 2);
  cleanup();
});

test("usage is recorded and summarised per account", () => {
  const { k, cleanup } = openTemp();
  k.recordUsage({ provider: "claude", accountId: "a1", inputTokens: 10, outputTokens: 5, costUsd: 0.01 });
  k.recordUsage({ provider: "claude", accountId: "a1", inputTokens: 1, outputTokens: 1, costUsd: 0.02, resent: true });
  const [row] = k.usageSummary("account_id");
  assert.equal(row!.key, "a1");
  assert.equal(row!.turns, 2);
  assert.equal(row!.resent, 1);
  cleanup();
});

test("claimTaskById claims only the named task and respects live leases", () => {
  const clock = new FakeClock();
  const { k, cleanup } = openTemp(clock);
  const a = k.spawnTask({ queue: "q", kind: "x" }).task;
  const b = k.spawnTask({ queue: "q", kind: "x" }).task;
  const att = k.claimTaskById(b.id, "w", 100)!;
  assert.equal(att.taskId, b.id);
  assert.equal(k.getTask(a.id)!.state, "pending");
  assert.equal(k.claimTaskById(b.id, "w2", 100), null, "live lease");
  clock.advance(101);
  assert.equal(k.claimTaskById(b.id, "w2", 100)!.n, 2, "expired lease is reclaimed");
  assert.equal(k.claimTaskById("task_missing", "w", 100), null);
  assert.throws(
    () => k.claimTaskById(a.id, "w", 0),
    (e) => isCoreError(e, "invalid_lease"),
  );
  cleanup();
});

test("ids minted in the same millisecond sort in minting order", async () => {
  const { newId } = await import("../src/kernel/ids.ts");
  const ids = Array.from({ length: 5000 }, () => newId("x", 1_800_000_000_000));
  assert.deepEqual([...ids].sort(), ids);
  assert.equal(new Set(ids).size, ids.length);
});

test("readers open alongside the owner, see committed rows only, and cannot write", () => {
  const t = tmp();
  const path = join(t.dir, "store.db");
  const owner = Kernel.open({ path });
  const reader = Kernel.open({ path, mode: "reader" });
  try {
    owner.send({ to: "r", from: "o", kind: "k", body: 1 });
    assert.equal(reader.inbox("r").length, 1, "a committed row is visible to a reader");
    owner.tx(() => {
      owner.send({ to: "r", from: "o", kind: "k", body: 2 });
      assert.equal(reader.inbox("r").length, 1, "an uncommitted row is not");
    });
    assert.equal(reader.inbox("r").length, 2);
    assert.throws(
      () => reader.send({ to: "r", from: "x", kind: "k", body: 3 }),
      (e) => isCoreError(e, "store_read_only"),
    );
    assert.throws(
      () => reader.tx(() => 1),
      (e) => isCoreError(e, "store_read_only"),
    );
    assert.throws(
      () => Kernel.open({ path: ":memory:", mode: "reader" }),
      (e) => isCoreError(e, "store_read_only"),
    );
  } finally {
    reader.close();
    owner.close();
  }
  const raw = new DatabaseSync(path);
  raw.exec("UPDATE meta SET v='0' WHERE k='schema_version'");
  raw.close();
  assert.throws(
    () => Kernel.open({ path, mode: "reader" }),
    (e) => isCoreError(e, "store_schema_mismatch"),
    "a reader never migrates; the owner must open the store first",
  );
  t.cleanup();
});

test("checkpoints are capped in size and in number per task", async () => {
  const clock = new FakeClock();
  const t = tmp();
  const k = Kernel.open({
    path: join(t.dir, "s.db"),
    clock: clock.now,
    maxCheckpointBytes: 64,
    maxCheckpointsPerTask: 2,
  });
  try {
    k.spawnTask({ queue: "q", kind: "x" });
    const a = k.claimTask("q", "w", 10_000)!;
    await assert.rejects(
      k.checkpoint(a, "big", () => "x".repeat(100)),
      (e) => isCoreError(e, "checkpoint_too_large"),
    );
    assert.equal(k.get<{ n: number }>("SELECT COUNT(*) AS n FROM checkpoints")!.n, 0, "nothing is stored");
    await k.checkpoint(a, "c1", () => 1);
    k.commitStep(a, "c2", () => 2);
    assert.throws(
      () => k.commitStep(a, "c3", () => 3),
      (e) => isCoreError(e, "checkpoint_too_large"),
    );
    assert.equal(
      k.commitStep(a, "c2", () => 99),
      2,
      "an existing checkpoint is still read back",
    );
  } finally {
    k.close();
    t.cleanup();
  }
});

test("namespaced migrations commit with their version or not at all, after a backup; exports copy pages", async () => {
  const t = tmp();
  const path = join(t.dir, "s.db");
  const k = Kernel.open({ path });
  try {
    assert.deepEqual(k.migrateNamespace("app", ["CREATE TABLE a1 (x)"]), { from: 0, to: 1, backup: null });
    k.run("INSERT INTO a1 VALUES (1)");
    assert.throws(() => k.migrateNamespace("app", ["CREATE TABLE a1 (x)", "CREATE TABLE a2 (y)", "NOT SQL"]));
    assert.equal(k.meta("schema_version:app"), "1", "a failing migration leaves the version");
    assert.equal(k.get("SELECT name FROM sqlite_master WHERE name='a2'"), undefined, "and no partial table");
    const r = k.migrateNamespace("app", ["CREATE TABLE a1 (x)", "CREATE TABLE a2 (y)"]);
    assert.equal(r.to, 2);
    assert.ok(r.backup && existsSync(r.backup), "the store was copied aside first");
    const old = new DatabaseSync(r.backup!, { readOnly: true });
    assert.equal((old.prepare("SELECT v FROM meta WHERE k='schema_version:app'").get() as { v: string }).v, "1");
    old.close();
    assert.throws(
      () => k.migrateNamespace("app", ["CREATE TABLE a1 (x)"]),
      (e) => isCoreError(e, "store_schema_newer"),
    );
    assert.throws(
      () => k.migrateNamespace("Bad Name", []),
      (e) => isCoreError(e, "store_schema_mismatch"),
    );
    const dest = join(t.dir, "export.db");
    assert.ok((await k.exportTo(dest)).pages >= 0);
    const copy = Kernel.open({ path: dest, mode: "reader" });
    assert.equal(copy.get<{ n: number }>("SELECT COUNT(*) AS n FROM a1")!.n, 1);
    copy.close();
    await assert.rejects(k.exportTo(dest), (e) => isCoreError(e, "path_exists"));
  } finally {
    k.close();
    t.cleanup();
  }
});
