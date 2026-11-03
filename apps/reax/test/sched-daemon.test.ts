// SCH through the daemon: the job.* methods over the wire, engine runs killed on cancel, timeout,
// disconnect and shutdown, pm.db writes rolled back or refused with pm_busy, the busy hello frame,
// and `reax daemon run|jobs|cancel` end to end. Oracles are independent of the code under test: the
// raw wire client (fixtures/daemon-wire.ts, hand-written frames), the fake engine's own pids.json
// and process.kill(pid, 0), the test's own read-only node:sqlite connection for what pm.db holds,
// a lock held by a process the test starts (not reax code), and runOperation run directly on a
// second home for results. Test operations (fixtures/sched-ops.ts) reach only in-process daemons
// (startDaemon({ sched })); a child `reax serve` refuses them. Every home is a tempBox; every
// process is started here and checked gone in the after hook. There is no sleep in this file:
// "held running" is a gate, and only process exit and file appearance are polled (10 s or more).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";
import { isCoreError } from "@re4exa/core/errors";
import { daemonCall } from "../src/daemon/client.ts";
import { type DaemonHandle, startDaemon } from "../src/daemon/server.ts";
import { PM_HOOKS } from "../src/ops/pm.ts";
import { runOperation } from "../src/ops/registry.ts";
import { closePm, PM_LIMITS } from "../src/pm/db.ts";
import { type Clock, type SchedHooks, type SchedLimits, Scheduler } from "../src/sched/scheduler.ts";
import {
  alive,
  authed,
  type Box,
  type Child,
  call,
  cli,
  failCode,
  gone,
  ok,
  type Raw,
  rawConnect,
  readEndpointFile,
  reap,
  serve,
  shutdown,
  spawnNode,
  survivors,
  tempBox,
} from "./fixtures/daemon-wire.ts";
import { GateBoard, testOps } from "./fixtures/sched-ops.ts";

const POSIX = process.platform !== "win32";
const LIMIT = { timeout: 120_000 };
const BIN = join(import.meta.dirname, "..", "fixtures", "bin");
const HELLO = "hello-x86_64-linux-gnu.2.28-g";

/** Every engine pid read from a pids.json, so the after hook can check that each is gone. */
const enginePids = new Set<number>();
const savedHome = process.env.REAX_HOME;
let fallback: Box;
before(() => {
  // anything that falls back to REAX_HOME lands in a temporary directory
  fallback = tempBox("fallback");
  process.env.REAX_HOME = fallback.home;
});
after(async () => {
  closePm();
  if (savedHome === undefined) delete process.env.REAX_HOME;
  else process.env.REAX_HOME = savedHome;
  const left: number[] = [];
  for (const pid of enginePids) if (!(await gone(pid, 10_000))) left.push(pid);
  // a failed run must not leave engines behind: survivors (pids the fake engine wrote, under
  // this test's own daemons) are stopped by exact pid, as engines.test.ts does, after being recorded
  for (const pid of left) if (pid > 1 && alive(pid)) process.kill(pid, "SIGKILL");
  const children = await survivors();
  assert.deepEqual(left, [], "every engine process is gone");
  assert.deepEqual(children, [], "every child this file started is gone");
});

// --- helpers --------------------------------------------------------------------------------------------

interface InProc {
  box: Box;
  board: GateBoard;
  h: DaemonHandle;
  done(): Promise<void>;
}

/** An in-process daemon whose scheduler can run the test operations. */
async function inProc(limits: Partial<SchedLimits> = {}, hooks: SchedHooks = {}, clock?: Clock): Promise<InProc> {
  const box = tempBox();
  const board = new GateBoard();
  const { resolveOperation } = testOps(board);
  const h = await startDaemon({
    home: box.home,
    sched: { limits, hooks, resolveOperation, ...(clock ? { clock } : {}) },
  });
  return {
    box,
    board,
    h,
    done: async () => {
      await h.close();
      closePm(box.home);
      box.done();
    },
  };
}

const gate = (kind: string, tag: string, extra: Record<string, unknown> = {}, ws = BIN) => ({
  operation: `test.gate.${kind}`,
  args: { tag, ...extra },
  workspace: ws,
});

async function submit(
  raw: Raw,
  params: Record<string, unknown>,
): Promise<{ job: string; state: string; position: number | null }> {
  return ok(await raw.job("job.submit", params));
}

/** A fresh scratch directory for one fake engine run. */
function scratch(box: Box): string {
  const d = join(box.tmp, `scratch-${randomUUID().slice(0, 8)}`);
  mkdirSync(d);
  return d;
}

/** The fake engine's pids.json (root and grandchild); polled for its appearance, up to 20 s. */
async function enginePidsIn(dir: string): Promise<{ root: number; grandchild: number }> {
  const f = join(dir, "pids.json");
  for (let i = 0; i < 400 && !existsSync(f); i++) await new Promise((r) => setTimeout(r, 50));
  for (let i = 0; i < 40; i++) {
    try {
      const p = JSON.parse(readFileSync(f, "utf8")) as { root: number; grandchild: number };
      enginePids.add(p.root);
      enginePids.add(p.grandchild);
      return p;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  assert.fail(`no pids.json in ${dir}`);
}

async function assertEngineGone(p: { root: number; grandchild: number }) {
  assert.ok(p.root > 1 && p.grandchild > 1, JSON.stringify(p));
  assert.equal(await gone(p.root, 10_000), true, "the engine is gone");
  assert.equal(await gone(p.grandchild, 10_000), true, "its grandchild is gone");
}

/** The test's own read-only view of pm.db. */
function peek<T>(home: string, f: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(join(home, "pm.db"), { readOnly: true });
  try {
    return f(db);
  } finally {
    db.close();
  }
}
const counts = (home: string) =>
  peek(home, (db) => ({
    targets: Number((db.prepare("SELECT count(*) AS n FROM pm_target").get() as { n: number }).n),
    symbols: Number((db.prepare("SELECT count(*) AS n FROM pm_symbol").get() as { n: number }).n),
  }));
const targetRow = (home: string, digest: string) =>
  peek(home, (db) => db.prepare("SELECT reader_version FROM pm_target WHERE digest = ?").get(digest)) as
    | { reader_version: string }
    | undefined;

/** A process of the test's own holding pm.db's write lock (BEGIN IMMEDIATE and an uncommitted
 * insert) until the test reaps it through its handle; the OS then releases the lock, rolled back. */
async function lockHolder(box: Box): Promise<Child> {
  const file = join(box.home, "pm.db");
  const script = `
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(${JSON.stringify(file)});
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("BEGIN IMMEDIATE");
    db.prepare("INSERT INTO pm_target (digest, size, format, reader, reader_version, indexed_at) VALUES ('lock', 0, 'x', 'x', 'x', 'x')").run();
    process.stdout.write(JSON.stringify({ ready: true, pid: process.pid }) + "\\n");
    setInterval(() => {}, 1000);
    setTimeout(() => process.exit(2), 110000);`;
  const c = spawnNode(box, ["--input-type=module", "-e", script]);
  assert.ok(await c.ready, `the lock holder started: ${c.err()}`);
  return c;
}

const runListing = (box: Box) => readdirSync(join(box.home, "run")).sort();

/** A clock whose timers of exactly holdMs (a job's deadline) fire only when the test says; every
 * other timer (job.wait, the drain) is real. */
class HeldClock implements Clock {
  readonly held = new Set<() => void>();
  readonly holdMs: number;
  constructor(holdMs: number) {
    this.holdMs = holdMs;
  }
  now = () => Date.now();
  setTimer = (fn: () => void, ms: number): unknown => {
    if (ms !== this.holdMs) return setTimeout(fn, ms);
    this.held.add(fn);
    return { held: fn };
  };
  clearTimer = (h: unknown) => {
    if (h && typeof h === "object" && "held" in h) this.held.delete((h as { held: () => void }).held);
    else clearTimeout(h as NodeJS.Timeout);
  };
  fire(): void {
    for (const f of [...this.held]) {
      this.held.delete(f);
      f();
    }
  }
}

// --- queue ----------------------------------------------------------------------------------------------

test("[+RX-SCH/queue] over the wire: the reserved cheap slot, and round-robin across connections", LIMIT, async () => {
  const d = await inProc({ maxRunning: 5 });
  try {
    const a = await authed(d.box);
    const b = await authed(d.box);
    const c = await authed(d.box);
    for (let i = 0; i < 3; i++) assert.equal((await submit(a, gate("medium", `m${i}`))).state, "running");
    assert.equal((await submit(a, gate("deep", "d"))).state, "running");
    for (let i = 0; i < 15; i++) assert.equal((await submit(b, gate("deep", `qb${i}`))).state, "queued");
    for (let i = 0; i < 15; i++) assert.equal((await submit(c, gate("deep", `qc${i}`))).state, "queued");
    const x = await authed(d.box);
    const cheap = await submit(x, gate("cheap", "cheap"));
    assert.equal(cheap.state, "running", "30 deep jobs queued, every non-cheap slot held: the cheap job runs");
    assert.equal(cheap.position, null);
    for (const r of [a, b, c, x]) r.end();
  } finally {
    await d.done();
  }

  const r = await inProc({ maxRunning: 1 });
  try {
    const a = await authed(r.box);
    const b = await authed(r.box);
    const ids = new Map<string, string>();
    for (let i = 1; i <= 6; i++) ids.set(`A${i}`, (await submit(a, gate("cheap", `A${i}`))).job);
    for (let i = 1; i <= 2; i++) ids.set(`B${i}`, (await submit(b, gate("cheap", `B${i}`))).job);
    const watcher = await authed(r.box);
    // release whatever runs, one at a time: the start order is the dispatch order
    for (let i = 0; i < 8; i++) {
      const tag = r.board.starts.at(-1)!;
      r.board.open(tag);
      const w = ok<{ state: string; done: boolean }>(await watcher.job("job.wait", { job: ids.get(tag) }));
      // the next job started in the same turn as this one finished, before the reply was written
      assert.equal(w.state, "succeeded");
    }
    assert.deepEqual(r.board.starts, ["A1", "B1", "A2", "B2", "A3", "A4", "A5", "A6"]);
    const list = ok<{ jobs: { job: string }[] }>(await watcher.job("job.list"));
    assert.deepEqual(
      list.jobs.map((j) => j.job),
      [...ids.values()],
      "job.list is in submission (seq) order",
    );
    for (const x of [a, b, watcher]) x.end();
  } finally {
    await r.done();
  }
});

test(
  "[-RX-SCH/queue] over the wire: the 17th job of a connection and the 65th queued job are refused, retryably; invalid submits are not queued",
  LIMIT,
  async () => {
    const d = await inProc();
    try {
      const conns: Raw[] = [];
      for (let i = 0; i < 5; i++) conns.push(await authed(d.box));
      for (let i = 0; i < 16; i++) await submit(conns[0]!, gate("deep", `a${i}`));
      const full = await conns[0]!.job("job.submit", gate("deep", "a16"));
      assert.equal(failCode(full), "job_queue_full");
      const e = full.error as { retryable: boolean; detail: { scope: string; max: number } };
      assert.equal(e.retryable, true);
      assert.equal(e.detail.scope, "connection");
      assert.equal(e.detail.max, 16);
      assert.equal((await submit(conns[1]!, gate("deep", "b0"))).state, "queued", "a second connection still submits");
      for (let i = 1; i < 16; i++) await submit(conns[1]!, gate("deep", `b${i}`));
      for (let i = 0; i < 16; i++) await submit(conns[2]!, gate("deep", `c${i}`));
      for (let i = 0; i < 16; i++) await submit(conns[3]!, gate("deep", `d${i}`));
      const last = await submit(conns[4]!, gate("deep", "e0"));
      assert.equal(last.position, 63, "the 64th queued job");
      const over = await conns[4]!.job("job.submit", gate("deep", "e1"));
      assert.equal(failCode(over), "job_queue_full");
      assert.equal((over.error as { detail: { scope: string } }).detail.scope, "daemon");
      assert.equal((over.error as { retryable: boolean }).retryable, true);
      assert.equal(ok<{ cancelled: boolean }>(await conns[4]!.job("job.cancel", { job: last.job })).cancelled, true);
      assert.equal((await submit(conns[4]!, gate("deep", "e2"))).state, "queued", "a place is free again");

      const before = ok<{ counts: unknown }>(await conns[4]!.job("job.list")).counts;
      const bad: [Record<string, unknown>, string][] = [
        [{ operation: "no.such.op", args: {}, workspace: BIN }, "operation_unknown"],
        [{ operation: "test.gate.cheap", args: { tag: 1 }, workspace: BIN }, "bad_request"],
        [{ operation: "test.gate.cheap", args: { tag: "x" }, workspace: "fixtures/bin" }, "bad_request"],
        [{ operation: "test.gate.cheap", args: { tag: "x" }, workspace: join(d.box.root, "missing") }, "bad_request"],
        [{ operation: "test.gate.cheap", args: { tag: "x" }, workspace: BIN, timeoutMs: 0 }, "bad_request"],
        [{ operation: "test.gate.cheap", args: { tag: "x" }, workspace: BIN, timeoutMs: 3_600_001 }, "bad_request"],
      ];
      for (const [p, code] of bad)
        assert.equal(failCode(await conns[4]!.job("job.submit", p)), code, JSON.stringify(p));
      assert.deepEqual(ok<{ counts: unknown }>(await conns[4]!.job("job.list")).counts, before, "nothing was queued");
      for (const c of conns) c.end();
    } finally {
      await d.done();
    }
  },
);

// --- protocol -------------------------------------------------------------------------------------------

test(
  "[+RX-SCH/protocol] the raw client sees every method's documented fields; job.wait times out without an error; status counts jobs; a paged result is shortened",
  LIMIT,
  async () => {
    const d = await inProc({ resultBudget: 20_000 });
    try {
      const raw = await authed(d.box);
      const s = await submit(raw, gate("cheap", "g"));
      assert.deepEqual(Object.keys(s).sort(), ["job", "position", "state"]);
      assert.equal(s.state, "running");
      const info = ok(await raw.job("job.status", { job: s.job }));
      assert.deepEqual(Object.keys(info).sort(), [
        "cancelRequested",
        "class",
        "effect",
        "endedAt",
        "error",
        "job",
        "operation",
        "owner",
        "reason",
        "startedAt",
        "state",
        "submittedAt",
        "timeoutMs",
      ]);
      assert.equal(info.class, "cheap");
      assert.equal(info.effect, "read");
      assert.equal(info.timeoutMs, 60_000);
      const w = ok<{ done: boolean; state: string }>(await raw.job("job.wait", { job: s.job, timeoutMs: 100 }));
      assert.equal(w.done, false, "a wait that times out is not an error");
      assert.equal(w.state, "running");
      assert.equal(failCode(await raw.job("job.result", { job: s.job })), "bad_request", "result while running");
      const st = ok<{ jobs: unknown }>(await raw.job("status"));
      assert.deepEqual(st.jobs, { queued: 0, running: 1, retained: 0 });
      const list = ok<{ jobs: unknown[]; counts: unknown; limits: { maxQueued: number } }>(await raw.job("job.list"));
      assert.equal(list.jobs.length, 1);
      assert.equal(list.limits.maxQueued, 64);
      const waiting = raw.request("job.wait", { job: s.job });
      d.board.open("g");
      const done = ok<{ done: boolean; state: string }>(await raw.reply(waiting));
      assert.deepEqual([done.done, done.state], [true, "succeeded"]);
      const res = ok<{ job: string; result: { data: { tag: string }; coverage: string } }>(
        await raw.job("job.result", { job: s.job }),
      );
      assert.equal(res.job, s.job);
      assert.equal(res.result.data.tag, "g");
      const c = ok(await raw.job("job.cancel", { job: s.job }));
      assert.deepEqual(c, { job: s.job, state: "succeeded", cancelled: false });

      const p = await submit(raw, gate("cheap", "paged", { fill: 60_000, paged: true }));
      d.board.open("paged");
      ok(await raw.job("job.wait", { job: p.job }));
      const pr = ok<{ result: { data: { items: unknown[]; page: { next: number | null } }; limitations: string[] } }>(
        await raw.job("job.result", { job: p.job }),
      );
      assert.ok(pr.result.data.items.length < 60, "the page was shortened");
      assert.notEqual(pr.result.data.page.next, null);
      assert.ok(pr.result.limitations.some((l) => /page shortened/.test(l)));
      raw.end();
    } finally {
      await d.done();
    }
  },
);

test(
  "[-RX-SCH/protocol] job.* before the hello is unauthorized; bad params, unknown ids, oversize results and a ninth wait are refused",
  LIMIT,
  async () => {
    const d = await inProc({ resultBudget: 20_000 });
    try {
      const pre = await rawConnect(readEndpointFile(d.box));
      const r = await pre.call({ id: 1, method: "job.submit", params: gate("cheap", "pre") });
      assert.ok(r && r !== "timeout");
      assert.equal((r.error as { code: string }).code, "daemon_unauthorized");
      assert.equal(await pre.next(5000), null, "the connection closes");
      const raw = await authed(d.box);
      assert.deepEqual(ok<{ counts: unknown }>(await raw.job("job.list")).counts, {
        queued: 0,
        running: 0,
        retained: 0,
      });
      assert.equal(d.board.calls.size, 0, "nothing ran");

      assert.equal(failCode(await raw.job("job.status", [1])), "bad_request", "params not an object");
      assert.equal(failCode(await raw.job("job.status", "x")), "bad_request");
      assert.equal(failCode(await raw.job("job.status", { job: "x", extra: 1 })), "bad_request", "unknown key");
      assert.equal(failCode(await raw.job("job.list", { all: true })), "bad_request");
      assert.equal(failCode(await raw.job("job.status", { job: randomUUID() })), "job_not_found");
      assert.equal(failCode(await raw.job("job.cancel", { job: randomUUID() })), "job_not_found");
      assert.equal(failCode(await raw.job("job.result", { job: randomUUID() })), "job_not_found");
      assert.equal(failCode(await raw.job("job.wait", { job: randomUUID() })), "job_not_found");

      const big = await submit(raw, gate("cheap", "big", { fill: 40_000 }));
      d.board.open("big");
      assert.equal(ok<{ state: string }>(await raw.job("job.wait", { job: big.job })).state, "failed");
      assert.equal(failCode(await raw.job("job.result", { job: big.job })), "result_too_large");

      const held = await submit(raw, gate("cheap", "held"));
      const waits = Array.from({ length: 8 }, () => raw.request("job.wait", { job: held.job }));
      const ninth = await raw.job("job.wait", { job: held.job });
      assert.equal(failCode(ninth), "bad_request", "a ninth outstanding wait");
      assert.equal(failCode(await raw.job("job.wait", { job: held.job, timeoutMs: 30_001 })), "bad_request");
      d.board.open("held");
      for (const id of waits) assert.equal(ok<{ done: boolean }>(await raw.reply(id)).done, true);
      raw.end();
    } finally {
      await d.done();
    }
  },
);

test(
  "[+RX-SCH/protocol] through a child reax serve: daemon run of session.index and search.symbols equals runOperation and the PM key; daemon jobs and cancel work; test operations are refused",
  LIMIT,
  async () => {
    const box = tempBox();
    const other = tempBox("other");
    const c = serve(box);
    try {
      assert.ok(await c.ready, c.err());
      const idx = await cli(
        box,
        "daemon",
        "run",
        "session.index",
        `path=${HELLO}`,
        "--workspace",
        BIN,
        "--format",
        "json",
      );
      assert.equal(idx.code, 0, idx.err);
      const q = await cli(
        box,
        "daemon",
        "run",
        "search.symbols",
        `path=${HELLO}`,
        "query=reax_",
        "--workspace",
        BIN,
        "--format",
        "json",
      );
      assert.equal(q.code, 0, q.err);
      const ctx = { workspace: BIN, home: other.home };
      const wantIdx = await runOperation("session.index", { path: HELLO }, ctx);
      const wantQ = await runOperation("search.symbols", { path: HELLO, query: "reax_" }, ctx);
      const gotIdx = JSON.parse(idx.out) as { data: { symbols: number } };
      const gotQ = JSON.parse(q.out) as { data: { page: { total: number } } };
      assert.deepEqual(gotIdx.data, wantIdx.data);
      assert.deepEqual(gotQ.data, wantQ.data);
      assert.equal(gotIdx.data.symbols, 24, "the PM example's key");
      assert.equal(gotQ.data.page.total, 2, "the PM example's key");

      const jobs = await cli(box, "daemon", "jobs");
      assert.equal(jobs.code, 0, jobs.err);
      const listed = JSON.parse(jobs.out) as { jobs: { job: string; operation: string; state: string }[] };
      assert.deepEqual(
        listed.jobs.map((j) => [j.operation, j.state]),
        [
          ["session.index", "succeeded"],
          ["search.symbols", "succeeded"],
        ],
      );
      const cancel = await cli(box, "daemon", "cancel", listed.jobs[0]!.job);
      assert.equal(cancel.code, 0, cancel.err);
      assert.deepEqual(JSON.parse(cancel.out), { job: listed.jobs[0]!.job, state: "succeeded", cancelled: false });
      const missing = await cli(box, "daemon", "cancel", randomUUID());
      assert.equal(missing.code, 1);
      assert.match(missing.err, /\[job_not_found\]/);
      const usage = await cli(box, "daemon", "run");
      assert.equal(usage.code, 2);

      const raw = await authed(box);
      const t = await raw.job("job.submit", gate("cheap", "x"));
      assert.equal(failCode(t), "operation_unknown", "reax serve cannot run test operations");
      const viaCli = await cli(box, "daemon", "run", "test.engine", "scratch=/x", "--workspace", BIN);
      assert.equal(viaCli.code, 1);
      assert.match(viaCli.err, /\[operation_unknown\]/);
      raw.end();
      assert.equal(await shutdown(box, c), 0);
    } finally {
      await reap(c);
      closePm(other.home);
      other.done();
      box.done();
    }
  },
);

// --- cancel ---------------------------------------------------------------------------------------------

test(
  "[+RX-SCH/cancel] a queued job cancelled never runs; a running engine job cancelled from another connection is killed, root and grandchild",
  LIMIT,
  async () => {
    const d = await inProc();
    try {
      const a = await authed(d.box);
      const b = await authed(d.box);
      const dir = scratch(d.box);
      const eng = await submit(a, { operation: "test.engine", args: { scratch: dir }, workspace: BIN });
      assert.equal(eng.state, "running");
      const q = await submit(a, gate("deep", "queued"));
      assert.equal(q.state, "queued", "one deep job at a time");
      const qc = ok<{ state: string; cancelled: boolean }>(await b.job("job.cancel", { job: q.job }));
      assert.deepEqual([qc.state, qc.cancelled], ["cancelled", true]);
      const qi = ok<{ reason: string }>(await b.job("job.status", { job: q.job }));
      assert.equal(qi.reason, "client");
      const pids = await enginePidsIn(dir);
      const waiting = b.request("job.wait", { job: eng.job });
      assert.equal(ok<{ cancelled: boolean }>(await b.job("job.cancel", { job: eng.job })).cancelled, true);
      const end = ok<{ state: string; reason: string; error: { code: string; detail: { cause: string } } }>(
        await b.reply(waiting, 30_000),
      );
      assert.equal(end.state, "cancelled");
      assert.equal(end.reason, "client");
      assert.equal(end.error.code, "job_cancelled");
      assert.equal(end.error.detail.cause, "engine_cancelled");
      await assertEngineGone(pids);
      assert.equal(d.board.count("queued"), 0, "the cancelled queued job never ran");
      a.end();
      b.end();
    } finally {
      await d.done();
    }
  },
);

test(
  "[+RX-SCH/cancel] session.index cancelled inside its write transaction is rolled back; cancelled after its reads stores nothing",
  LIMIT,
  async () => {
    const box = tempBox();
    let s: Scheduler | null = null;
    let id = "";
    try {
      s = new Scheduler({ home: box.home });
      const first = s.submit("t", { operation: "session.index", args: { path: HELLO }, workspace: BIN });
      assert.equal((await s.wait("t", first.job, 30_000)).state, "succeeded");
      const digest = (s.result(first.job).result.data as { digest: string }).digest;
      // the test's own connection marks the stored rows as another reader version's
      const w = new DatabaseSync(join(box.home, "pm.db"));
      w.prepare("UPDATE pm_target SET reader_version = 'old-version' WHERE digest = ?").run(digest);
      w.close();
      const before = counts(box.home);
      PM_HOOKS.inTransaction = () => {
        // inside the transaction, after the inserts: the scheduler's cancel is synchronous
        assert.equal(s!.cancel(id, "client").cancelled, true);
      };
      try {
        id = s.submit("t", { operation: "session.index", args: { path: HELLO }, workspace: BIN }).job;
        const end = await s.wait("t", id, 30_000);
        assert.equal(end.state, "cancelled");
      } finally {
        delete PM_HOOKS.inTransaction;
      }
      assert.deepEqual(counts(box.home), before, "the rows are the old ones: rolled back, not merely not inserted");
      assert.equal(targetRow(box.home, digest)?.reader_version, "old-version");

      const other = "shapes-x86_64-linux-gnu.2.28-g";
      PM_HOOKS.afterRead = () => {
        assert.equal(s!.cancel(id, "client").cancelled, true);
      };
      try {
        id = s.submit("t", { operation: "session.index", args: { path: other }, workspace: BIN }).job;
        const end = await s.wait("t", id, 30_000);
        assert.equal(end.state, "cancelled");
      } finally {
        delete PM_HOOKS.afterRead;
      }
      assert.deepEqual(counts(box.home), before, "nothing stored for the new target");
    } finally {
      await s?.close();
      closePm(box.home);
      box.done();
    }
  },
);

test(
  "[+RX-SCH/cancel] a disconnect cancels that connection's running engine job and queued job, and nothing of anyone else's",
  LIMIT,
  async () => {
    const d = await inProc();
    try {
      const owner = await authed(d.box);
      const other = await authed(d.box);
      const dir = scratch(d.box);
      const eng = await submit(owner, { operation: "test.engine", args: { scratch: dir }, workspace: BIN });
      const q = await submit(owner, gate("deep", "q"));
      assert.equal(q.state, "queued");
      const mine = await submit(other, gate("cheap", "mine"));
      const pids = await enginePidsIn(dir);
      const w1 = other.request("job.wait", { job: eng.job });
      const w2 = other.request("job.wait", { job: q.job });
      owner.end();
      for (const w of [w1, w2]) {
        const end = ok<{ state: string; reason: string }>(await other.reply(w, 30_000));
        assert.deepEqual([end.state, end.reason], ["cancelled", "disconnect"]);
      }
      await assertEngineGone(pids);
      assert.equal(d.board.count("q"), 0, "the queued gate never ran");
      assert.equal(ok<{ state: string }>(await other.job("job.status", { job: mine.job })).state, "running");
      d.board.open("mine");
      assert.equal(ok<{ state: string }>(await other.job("job.wait", { job: mine.job })).state, "succeeded");
      other.end();
    } finally {
      await d.done();
    }
  },
);

test(
  "[+RX-SCH/cancel] a wire shutdown cancels and drains every job (reason shutdown), kills the engine and leaves only daemon.oslock",
  LIMIT,
  async () => {
    const d = await inProc();
    let closed = false;
    try {
      const a = await authed(d.box);
      const watcher = await authed(d.box);
      const dir = scratch(d.box);
      const eng = await submit(a, { operation: "test.engine", args: { scratch: dir }, workspace: BIN });
      const q = await submit(a, gate("deep", "q"));
      const pids = await enginePidsIn(dir);
      const w1 = watcher.request("job.wait", { job: eng.job });
      const w2 = watcher.request("job.wait", { job: q.job });
      assert.deepEqual((await call(d.box, "shutdown")).result, { stopping: true });
      for (const w of [w1, w2]) {
        const end = ok<{ state: string; reason: string }>(await watcher.reply(w, 30_000));
        assert.deepEqual([end.state, end.reason], ["cancelled", "shutdown"]);
      }
      await d.h.closed;
      closed = true;
      await assertEngineGone(pids);
      assert.equal(d.board.count("q"), 0);
      assert.deepEqual(runListing(d.box), ["daemon.oslock"]);
    } finally {
      if (!closed) await d.h.close();
      await d.done();
    }
  },
);

test(
  "[+RX-SCH/cancel] a child serve with a session.index running while another process holds pm.db's write lock exits 0 on shutdown, storing nothing",
  LIMIT,
  async () => {
    const box = tempBox();
    const c = serve(box);
    let holder: Child | null = null;
    try {
      assert.ok(await c.ready, c.err());
      const first = await cli(
        box,
        "daemon",
        "run",
        "session.index",
        "path=hello-x86_64-macos-g",
        "--workspace",
        BIN,
        "--format",
        "json",
      );
      assert.equal(first.code, 0, first.err);
      const before = counts(box.home);
      holder = await lockHolder(box);
      const raw = await authed(box);
      const j = await submit(raw, {
        operation: "session.index",
        args: { path: "shapes-x86_64-linux-gnu.2.28-g" },
        workspace: BIN,
      });
      assert.equal(j.state, "running");
      assert.equal(await shutdown(box, c), 0);
      await reap(holder);
      assert.deepEqual(counts(box.home), before, "nothing was stored");
      assert.deepEqual(runListing(box), ["daemon.oslock"]);
    } finally {
      if (holder) await reap(holder);
      await reap(c);
      box.done();
    }
  },
);

test(
  "[+RX-SCH/cancel] in process, a session.index that is waiting in withImmediate when shutdown comes ends cancelled (reason shutdown), storing nothing",
  LIMIT,
  async () => {
    const d = await inProc();
    let holder: Child | null = null;
    let closed = false;
    try {
      PM_LIMITS.busyTimeoutMs = 60_000;
      const a = await authed(d.box);
      const first = await submit(a, {
        operation: "session.index",
        args: { path: "hello-x86_64-macos-g" },
        workspace: BIN,
      });
      assert.equal(ok<{ state: string }>(await a.job("job.wait", { job: first.job })).state, "succeeded");
      const before = counts(d.box.home);
      holder = await lockHolder(d.box);
      // afterRead is the last step before withImmediate, which then runs synchronously to its first
      // failed BEGIN and awaits its retry timer: once the hook has run and the event loop has turned,
      // the job is waiting for the lock
      const reached = new Promise<void>((r) => {
        PM_HOOKS.afterRead = () => r();
      });
      const j = await submit(a, {
        operation: "session.index",
        args: { path: "shapes-x86_64-linux-gnu.2.28-g" },
        workspace: BIN,
      });
      await reached;
      await new Promise<void>((r) => setImmediate(r));
      const watcher = await authed(d.box);
      assert.equal(ok<{ state: string }>(await watcher.job("job.status", { job: j.job })).state, "running");
      const waiting = watcher.request("job.wait", { job: j.job });
      assert.deepEqual((await call(d.box, "shutdown")).result, { stopping: true });
      const end = ok<{ state: string; reason: string }>(await watcher.reply(waiting, 30_000));
      assert.deepEqual([end.state, end.reason], ["cancelled", "shutdown"]);
      await d.h.closed;
      closed = true;
      await reap(holder);
      assert.deepEqual(counts(d.box.home), before, "nothing was stored");
      assert.deepEqual(runListing(d.box), ["daemon.oslock"]);
    } finally {
      delete PM_HOOKS.afterRead;
      PM_LIMITS.busyTimeoutMs = 5000;
      if (holder) await reap(holder);
      if (!closed) await d.h.close();
      await d.done();
    }
  },
);

test(
  "[+RX-SCH/protocol] reax daemon jobs shows a running job, and reax daemon cancel stops it, end to end",
  LIMIT,
  async () => {
    const d = await inProc();
    try {
      const a = await authed(d.box);
      const j = await submit(a, gate("cheap", "held"));
      assert.equal(j.state, "running");
      const jobs = await cli(d.box, "daemon", "jobs");
      assert.equal(jobs.code, 0, jobs.err);
      const listed = JSON.parse(jobs.out) as { jobs: { job: string; state: string }[] };
      assert.deepEqual(
        listed.jobs.map((x) => [x.job, x.state]),
        [[j.job, "running"]],
      );
      const waiting = a.request("job.wait", { job: j.job });
      const r = await cli(d.box, "daemon", "cancel", j.job);
      assert.equal(r.code, 0, r.err);
      assert.deepEqual(JSON.parse(r.out), { job: j.job, state: "running", cancelled: true });
      const end = ok<{ state: string; reason: string }>(await a.reply(waiting, 30_000));
      assert.deepEqual([end.state, end.reason], ["cancelled", "client"]);
      a.end();
    } finally {
      await d.done();
    }
  },
);

test(
  "[-RX-SCH/cancel] a cancel arriving after the operation resolved leaves it succeeded; a waiter that disconnects cancels nothing",
  LIMIT,
  async () => {
    let canceller: Raw | null = null;
    const seen: string[] = [];
    const d = await inProc(
      {},
      {
        afterRun: async (j) => {
          if (j.operation !== "test.gate.cheap" || !canceller) return;
          const r = ok<{ cancelled: boolean }>(await canceller.job("job.cancel", { job: j.job }));
          seen.push(`${j.job}:${r.cancelled}`);
        },
      },
    );
    try {
      const a = await authed(d.box);
      canceller = await authed(d.box);
      const j = await submit(a, gate("cheap", "late"));
      d.board.open("late");
      const end = ok<{ state: string; cancelRequested: boolean }>(await a.job("job.wait", { job: j.job }));
      assert.deepEqual([end.state, end.cancelRequested], ["succeeded", true]);
      assert.deepEqual(seen, [`${j.job}:true`]);
      const res = ok<{ result: { data: { tag: string } } }>(await a.job("job.result", { job: j.job }));
      assert.equal(res.result.data.tag, "late");
      canceller = null;

      const w = await submit(a, gate("medium", "waited"));
      const watcher = await authed(d.box);
      watcher.request("job.wait", { job: w.job });
      watcher.end();
      await watcher.done;
      // a later request on the owner's connection is the synchronisation point: the daemon has
      // handled the watcher's close by then or not, and either way the job must still run
      assert.equal(ok<{ state: string }>(await a.job("job.status", { job: w.job })).state, "running");
      d.board.open("waited");
      assert.equal(ok<{ state: string }>(await a.job("job.wait", { job: w.job })).state, "succeeded");
      a.end();
    } finally {
      await d.done();
    }
  },
);

// --- timeout --------------------------------------------------------------------------------------------

test(
  "[+RX-SCH/timeout] an engine job past its deadline ends timed_out with job_timeout, and its process tree is gone",
  LIMIT,
  async () => {
    // the 300 ms deadline is held until the engine's pids are seen, so it cannot fire before the
    // engine started; it is then the only way the job can end
    const clock = new HeldClock(300);
    const d = await inProc({}, {}, clock);
    try {
      const a = await authed(d.box);
      const dir = scratch(d.box);
      const eng = await submit(a, { operation: "test.engine", args: { scratch: dir }, workspace: BIN, timeoutMs: 300 });
      const pids = await enginePidsIn(dir);
      const waiting = a.request("job.wait", { job: eng.job });
      assert.equal(clock.held.size, 1, "the job's deadline is armed");
      clock.fire();
      const end = ok<{ state: string; error: { code: string; detail: { timeoutMs: number } } }>(
        await a.reply(waiting, 30_000),
      );
      assert.equal(end.state, "timed_out");
      assert.equal(end.error.code, "job_timeout");
      assert.equal(end.error.detail.timeoutMs, 300);
      assert.equal(failCode(await a.job("job.result", { job: eng.job })), "job_timeout");
      await assertEngineGone(pids);
      a.end();
    } finally {
      await d.done();
    }
  },
);

// --- write-busy -----------------------------------------------------------------------------------------

test(
  "[+RX-SCH/write-busy] write jobs run one at a time; a lock held by another process does not block the daemon, and the job succeeds once it is released",
  LIMIT,
  async () => {
    const d = await inProc();
    let holder: Child | null = null;
    try {
      const a = await authed(d.box);
      const b = await authed(d.box);
      const w1 = await submit(a, gate("write", "w1"));
      const w2 = await submit(b, gate("write", "w2"));
      assert.deepEqual([w1.state, w2.state], ["running", "queued"]);
      assert.equal((await submit(b, gate("cheap", "c"))).state, "running");
      d.board.open("w1");
      ok(await a.job("job.wait", { job: w1.job }));
      assert.equal(ok<{ state: string }>(await b.job("job.status", { job: w2.job })).state, "running");
      d.board.open("w2");
      d.board.open("c");

      // set before pm.db is first opened, so the shared connection's own busy timeout is 60 s too:
      // a BEGIN that waited on it would block the whole process, this ping included, until the
      // lock went, and the test releases the lock only after the ping is answered
      PM_LIMITS.busyTimeoutMs = 60_000;
      const first = await submit(a, {
        operation: "session.index",
        args: { path: "hello-x86_64-macos-g" },
        workspace: BIN,
      });
      assert.equal(ok<{ state: string }>(await a.job("job.wait", { job: first.job })).state, "succeeded");
      holder = await lockHolder(d.box);
      const reached = new Promise<void>((r) => {
        PM_HOOKS.afterRead = () => r();
      });
      const j = await submit(a, { operation: "session.index", args: { path: HELLO }, workspace: BIN });
      assert.equal(j.state, "running");
      await reached;
      // the job is waiting for the lock now; another connection is answered meanwhile
      assert.equal(ok<{ pong: boolean }>(await b.job("ping", undefined, 20_000)).pong, true);
      assert.equal(ok<{ state: string }>(await b.job("job.status", { job: j.job })).state, "running");
      const waiting = b.request("job.wait", { job: j.job });
      await reap(holder);
      const end = ok<{ state: string }>(await b.reply(waiting, 30_000));
      assert.equal(end.state, "succeeded");
      a.end();
      b.end();
    } finally {
      delete PM_HOOKS.afterRead;
      PM_LIMITS.busyTimeoutMs = 5000;
      if (holder) await reap(holder);
      await d.done();
    }
  },
);

test(
  "[-RX-SCH/write-busy] a lock held past the budget fails the job with the retryable pm_busy; a job waiting for the lock can be cancelled; nothing is stored",
  LIMIT,
  async () => {
    const d = await inProc();
    let holder: Child | null = null;
    try {
      const a = await authed(d.box);
      const first = await submit(a, {
        operation: "session.index",
        args: { path: "hello-x86_64-macos-g" },
        workspace: BIN,
      });
      ok(await a.job("job.wait", { job: first.job }));
      const before = counts(d.box.home);
      holder = await lockHolder(d.box);
      PM_LIMITS.busyTimeoutMs = 200;
      const j = await submit(a, { operation: "session.index", args: { path: HELLO }, workspace: BIN });
      const end = ok<{ state: string; error: { code: string; retryable: boolean } }>(
        await a.job("job.wait", { job: j.job }, 30_000),
      );
      assert.equal(end.state, "failed");
      assert.equal(end.error.code, "pm_busy");
      assert.equal(end.error.retryable, true);
      assert.equal(failCode(await a.job("job.result", { job: j.job })), "pm_busy");

      PM_LIMITS.busyTimeoutMs = 60_000;
      const reached = new Promise<void>((r) => {
        PM_HOOKS.afterRead = () => r();
      });
      const k = await submit(a, {
        operation: "session.index",
        args: { path: "shapes-x86_64-linux-gnu.2.28-g" },
        workspace: BIN,
      });
      await reached;
      const waiting = a.request("job.wait", { job: k.job });
      assert.equal(ok<{ cancelled: boolean }>(await a.job("job.cancel", { job: k.job })).cancelled, true);
      const kend = ok<{ state: string }>(await a.reply(waiting, 30_000));
      assert.equal(kend.state, "cancelled");
      // released only now
      await reap(holder);
      assert.deepEqual(counts(d.box.home), before, "nothing was stored");
      a.end();
    } finally {
      delete PM_HOOKS.afterRead;
      PM_LIMITS.busyTimeoutMs = 5000;
      if (holder) await reap(holder);
      await d.done();
    }
  },
);

// --- the busy hello frame (DMN follow-up) --------------------------------------------------------------

test(
  "[+RX-DMN/busy] at the connection cap a new connection gets a retryable daemon_busy frame unasked; reax daemon ping says daemon_busy; a freed slot answers",
  LIMIT,
  async () => {
    const box = tempBox();
    const c = serve(box);
    try {
      assert.ok(await c.ready, c.err());
      const conns: Raw[] = [];
      for (let i = 0; i < 32; i++) conns.push(await authed(box));
      const extra = await rawConnect(readEndpointFile(box));
      const f = await extra.next(10_000);
      assert.ok(f && f !== "timeout", "a frame arrives without sending anything");
      assert.equal(f.type, "hello");
      assert.equal(f.ok, false);
      assert.equal((f.error as { code: string }).code, "daemon_busy");
      assert.equal((f.error as { retryable: boolean }).retryable, true);
      assert.equal(await extra.next(10_000), null, "then it is closed");
      const ping = await cli(box, "daemon", "ping");
      assert.equal(ping.code, 1);
      assert.match(ping.err, /\[daemon_busy\]/);
      // the daemon frees a slot itself (an oversized frame is refused and closed): when its error frame
      // arrives, the slot is already free
      const big = conns.pop()!;
      const r = await big.call(`{"id":9,"method":"${"x".repeat(65 * 1024)}"}\n`);
      assert.ok(r && r !== "timeout" && (r.error as { code: string }).code === "bad_request");
      const again = await cli(box, "daemon", "ping");
      assert.equal(again.code, 0, again.err);
      for (const x of conns) x.end();
      assert.equal(await shutdown(box, c), 0);
    } finally {
      await reap(c);
      box.done();
    }
  },
);

test(
  "[-RX-DMN/busy] a wrong token at the cap's edge is daemon_unauthorized; a close before the hello reply makes the client report daemon_busy",
  LIMIT,
  async () => {
    const box = tempBox();
    const c = serve(box);
    try {
      assert.ok(await c.ready, c.err());
      const conns: Raw[] = [];
      for (let i = 0; i < 31; i++) conns.push(await authed(box));
      const wrong = await rawConnect(readEndpointFile(box));
      const r = await wrong.call({ type: "hello", protocol: 1, token: "x".repeat(43) });
      assert.ok(r && r !== "timeout");
      assert.equal((r.error as { code: string }).code, "daemon_unauthorized");
      for (const x of conns) x.end();
      assert.equal(await shutdown(box, c), 0);
    } finally {
      await reap(c);
      box.done();
    }

    // a stub written here: accepts and closes at once, behind a planted endpoint.json and token file
    const stub = tempBox();
    let server: Server | null = null;
    try {
      const run = join(stub.home, "run");
      mkdirSync(run, { mode: 0o700 });
      if (POSIX) chmodSync(run, 0o700);
      const path = POSIX ? join(stub.root, "s.sock") : `\\\\.\\pipe\\reax-stub-${randomUUID()}`;
      server = createServer((s) => s.destroy());
      await new Promise<void>((ok2, fail) => {
        server!.once("error", fail);
        server!.listen(path, () => ok2());
      });
      writeFileSync(join(run, "daemon.token"), "t".repeat(43), { mode: 0o600 });
      if (POSIX) chmodSync(join(run, "daemon.token"), 0o600);
      writeFileSync(
        join(run, "endpoint.json"),
        JSON.stringify({ transport: POSIX ? "unix" : "pipe", path, pid: process.pid, instance: "stub", protocol: 1 }),
        { mode: 0o600 },
      );
      await assert.rejects(daemonCall(stub.home, "ping"), (e) => {
        assert.ok(isCoreError(e, "daemon_busy"), String(e));
        assert.equal(e.retryable, true);
        return true;
      });
    } finally {
      await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
      stub.done();
    }
  },
);

test("no test process is left: every engine pid seen so far is gone", () => {
  for (const pid of enginePids) assert.equal(alive(pid), false, `engine pid ${pid}`);
});
