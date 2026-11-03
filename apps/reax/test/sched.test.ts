// SCH, the scheduler, in process: the dispatch rule against a separately written reference model
// (fixtures/sched-model.ts) on hand cases and 50 fixed seeds, admission caps, cancellation, the
// "succeeded beats a late cancel" rule, timeouts on an injected clock, and close(). Every job here
// is a test gate (fixtures/sched-ops.ts) that ends only when the test opens it or aborts it, so
// "held running" is a gate, and "did not start" is read from the scheduler's state at a
// synchronisation point. There is no sleep in this file; the clock is injected.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { isCoreError } from "@re4exa/core/errors";
import {
  type Clock,
  type JobInfo,
  SCHED_LIMITS,
  type SchedHooks,
  type SchedLimits,
  Scheduler,
} from "../src/sched/scheduler.ts";
import { tempBox } from "./fixtures/daemon-wire.ts";
import { type Cls, type ModelEvent, type ModelLimits, randomEvents, runModel } from "./fixtures/sched-model.ts";
import { GateBoard, testOps } from "./fixtures/sched-ops.ts";

// the one place the tests make a home: REAX_HOME, HOME, TMPDIR and the rest inside a mkdtemp root
const box = tempBox();
const root = box.root;
const WS = join(root, "ws");
const HOME = box.home;
mkdirSync(WS);
after(() => box.done());

/** A clock the test drives: timers fire only in advance(), in order of due time, then of arming. */
class FakeClock implements Clock {
  t = 1_000_000;
  #id = 0;
  readonly timers = new Map<number, { due: number; fn: () => void }>();
  now = () => this.t;
  setTimer = (fn: () => void, ms: number) => {
    const id = ++this.#id;
    this.timers.set(id, { due: this.t + ms, fn });
    return id;
  };
  clearTimer = (h: unknown) => {
    this.timers.delete(h as number);
  };
  advance(ms: number): void {
    this.t += ms;
    // bounded: each pass fires and removes one timer that was due
    for (let n = this.timers.size; n > 0; n--) {
      let best: [number, { due: number; fn: () => void }] | null = null;
      for (const e of this.timers) if (e[1].due <= this.t && (!best || e[1].due < best[1].due)) best = e;
      if (!best) return;
      this.timers.delete(best[0]);
      best[1].fn();
    }
  }
}

/** One macrotask turn: every microtask chain started by the last event (a gate opened or aborted,
 * the job's settlement, the dispatch after it) has run. The gates do no I/O. */
const flush = () => new Promise<void>((r) => setImmediate(r));

function harness(limits: Partial<SchedLimits> = {}, hooks: SchedHooks = {}) {
  const board = new GateBoard();
  const clock = new FakeClock();
  const { resolveOperation } = testOps(board);
  const s = new Scheduler({ limits, clock, resolveOperation, hooks, home: HOME });
  const submit = (owner: string, kind: string, tag: string, timeoutMs?: number) =>
    s.submit(owner, {
      operation: `test.gate.${kind}`,
      args: { tag },
      workspace: WS,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    });
  return { s, board, clock, submit };
}

const kindOf = (cls: Cls, write: boolean) => (write ? "write" : cls);

/** Drive the real scheduler with a model event list; returns the same shape as runModel. */
async function drive(limits: ModelLimits, events: ModelEvent[]) {
  const h = harness({ ...limits, maxRetained: 10_000 });
  const ids = new Map<string, string>();
  const labelOf = new Map<string, string>();
  const refused: Record<string, string> = {};
  const starts: string[] = [];
  // the gates record their starts by tag (= label)
  for (const e of events) {
    switch (e.t) {
      case "submit":
        try {
          const r = h.submit(e.owner, kindOf(e.cls, e.write), e.label, e.timeoutMs);
          ids.set(e.label, r.job);
          labelOf.set(r.job, e.label);
        } catch (err) {
          assert.ok(isCoreError(err, "job_queue_full"), String(err));
          assert.equal(err.retryable, true);
          refused[e.label] = String(err.detail?.scope);
        }
        break;
      case "release": {
        const id = ids.get(e.label);
        if (id && h.s.status(id).state === "running") h.board.open(e.label);
        break;
      }
      case "cancel": {
        const id = ids.get(e.label);
        if (id) h.s.cancel(id, "client");
        break;
      }
      case "drop":
        h.s.dropOwner(e.owner);
        break;
      case "advance":
        h.clock.advance(e.ms);
        break;
    }
    await flush();
  }
  starts.push(...h.board.starts);
  const states: Record<string, { state: string; reason: string | null }> = {};
  for (const [label, id] of ids) {
    const i = h.s.status(id);
    states[label] = { state: i.state, reason: i.state === "timed_out" ? null : i.reason };
  }
  return { h, out: { starts, refused, states }, ids };
}

const SMALL: ModelLimits = {
  maxQueued: 5,
  maxPerOwner: 4,
  maxRunning: 3,
  maxRunningDeep: 1,
  maxRunningNonCheap: 2,
  maxRunningWrite: 1,
};

const sub = (label: string, owner: string, cls: Cls, write = false, timeoutMs = 60_000): ModelEvent => ({
  t: "submit",
  label,
  owner,
  cls,
  write,
  timeoutMs,
});

test("[+RX-SCH/queue] the model and the scheduler agree on hand-written cases", async () => {
  const cases: [string, ModelLimits, ModelEvent[]][] = [
    [
      "round-robin, one slot: A1 B1 A2 B2 A3 A4 A5 A6",
      { ...SMALL, maxQueued: 64, maxPerOwner: 16, maxRunning: 1, maxRunningNonCheap: 1 },
      [
        ...[1, 2, 3, 4, 5, 6].map((i) => sub(`A${i}`, "A", "cheap")),
        sub("B1", "B", "cheap"),
        sub("B2", "B", "cheap"),
        ...["A1", "B1", "A2", "B2", "A3", "A4", "A5", "A6"].map((l): ModelEvent => ({ t: "release", label: l })),
      ],
    ],
    [
      "a blocked deep job does not hold back later cheap and medium jobs",
      SMALL,
      [
        sub("d1", "A", "deep"),
        sub("d2", "A", "deep"),
        sub("c1", "A", "cheap"),
        sub("m1", "B", "medium"),
        { t: "release", label: "d1" },
      ],
    ],
    [
      "writes run one at a time; a cheap job still starts",
      SMALL,
      [
        sub("w1", "A", "medium", true),
        sub("w2", "B", "medium", true),
        sub("c1", "C", "cheap"),
        { t: "release", label: "w1" },
      ],
    ],
    [
      "timeouts count from the start, and end in deadline order",
      SMALL,
      [
        sub("x", "A", "medium", false, 1000),
        sub("y", "B", "medium", false, 500),
        sub("z", "C", "medium", false, 100),
        { t: "advance", ms: 499 },
        { t: "advance", ms: 1 },
        { t: "advance", ms: 100 },
        { t: "advance", ms: 400 },
      ],
    ],
    [
      "a disconnect cancels only that owner's jobs",
      SMALL,
      [
        sub("a1", "A", "medium"),
        sub("a2", "A", "medium"),
        sub("a3", "A", "medium"),
        sub("b1", "B", "cheap"),
        { t: "drop", owner: "A" },
      ],
    ],
    [
      "an owner that keeps one job at a time does not jump the queue: A2 starts once B and C have had one turn each",
      { ...SMALL, maxQueued: 64, maxPerOwner: 16, maxRunning: 1, maxRunningNonCheap: 1 },
      [
        sub("A1", "A", "cheap"),
        sub("A2", "A", "cheap"),
        sub("B1", "B", "cheap"),
        sub("C1", "C", "cheap"),
        { t: "release", label: "A1" },
        { t: "release", label: "B1" },
        sub("B2", "B", "cheap"),
        { t: "release", label: "C1" },
        sub("C2", "C", "cheap"),
        { t: "release", label: "A2" },
        { t: "release", label: "B2" },
        sub("B3", "B", "cheap"),
        { t: "release", label: "C2" },
        sub("C3", "C", "cheap"),
      ],
    ],
  ];
  for (const [name, limits, events] of cases) {
    const { breaches, ...want } = runModel(limits, events);
    assert.deepEqual(breaches, [], `${name}: the fairness bound`);
    const { out } = await drive(limits, events);
    assert.deepEqual(out, want, name);
  }
  // A1 then the never-dispatched owners B and C (one turn each), then A2: no owner twice ahead of A2
  assert.deepEqual(runModel(cases[5]![1], cases[5]![2]).starts, ["A1", "B1", "C1", "A2", "B2", "C2", "B3"]);
  const rr = runModel(cases[0]![1], cases[0]![2]);
  assert.deepEqual(rr.starts, ["A1", "B1", "A2", "B2", "A3", "A4", "A5", "A6"], "the documented example");
});

test("[+RX-SCH/queue] the model and the scheduler agree on 50 seeds x 300 random events, and every admitted job starts", async (t) => {
  const seen = { starts: 0, connection: 0, daemon: 0, timed_out: 0, cancelled: 0, disconnect: 0, succeeded: 0 };
  for (let seed = 1; seed <= 50; seed++) {
    const events = randomEvents(seed, 300);
    const { h, ids } = await drive(SMALL, events);
    // drain: open every running gate until nothing is queued or running (bounded by the job count)
    for (let round = 0; round <= ids.size; round++) {
      const running = h.s.list().jobs.filter((j) => j.state === "running");
      if (running.length === 0) break;
      for (const j of running) {
        const label = [...ids].find(([, id]) => id === j.job)![0];
        events.push({ t: "release", label });
      }
      for (const j of running) h.board.open([...ids].find(([, id]) => id === j.job)![0]);
      await flush();
    }
    // the full list, drain included, through both sides
    const { breaches, ...want } = runModel(SMALL, events);
    // the bound, checked at every dispatch of the run (drain included), not only at the end
    assert.deepEqual(breaches, [], `seed ${seed}: the fairness bound`);
    const { out } = await drive(SMALL, events);
    assert.deepEqual(out, want, `seed ${seed}`);
    seen.starts += out.starts.length;
    for (const scope of Object.values(want.refused)) seen[scope]++;
    for (const [label, s] of Object.entries(want.states)) {
      if (s.state === "timed_out" || s.state === "cancelled" || s.state === "succeeded") seen[s.state]++;
      if (s.reason === "disconnect") seen.disconnect++;
      assert.notEqual(s.state, "queued", `seed ${seed}: ${label} never left the queue`);
      assert.notEqual(s.state, "running", `seed ${seed}: ${label} is still running`);
      if (s.state === "succeeded" || s.state === "timed_out")
        assert.ok(out.starts.includes(label), `seed ${seed}: ${label} started`);
    }
  }
  t.diagnostic(`50 seeds agree: ${JSON.stringify(seen)}`);
  // the seeds exercise every path the rule has, so agreement is not vacuous
  for (const [k, v] of Object.entries(seen)) assert.ok(v > 0, `the seeds produce ${k}`);
});

test("[+RX-SCH/queue] the reserved cheap slot: with every non-cheap slot held and 30 deep jobs queued, a cheap job starts at once", async () => {
  // defaults: 4 running, 3 of them non-cheap
  const d = harness({ maxPerOwner: 64 });
  for (let i = 0; i < 3; i++) assert.equal(d.submit("A", "medium", `m${i}`).state, "running");
  assert.equal(d.submit("A", "deep", "d0").state, "queued", "a fourth non-cheap job waits although 4 may run");
  for (let i = 0; i < 30; i++) assert.equal(d.submit("B", "deep", `q${i}`).state, "queued");
  assert.equal(d.submit("C", "cheap", "c").state, "running", "the reserved slot");
  // the work order's shape: 3 medium and 1 deep held (maxRunning 5, so 4 non-cheap)
  const h = harness({ maxRunning: 5, maxPerOwner: 64 });
  for (let i = 0; i < 3; i++) assert.equal(h.submit("A", "medium", `m${i}`).state, "running");
  assert.equal(h.submit("A", "deep", "d").state, "running");
  for (let i = 0; i < 30; i++) assert.equal(h.submit("B", "deep", `q${i}`).state, "queued");
  assert.equal(h.submit("B", "medium", "m9").state, "queued", "no non-cheap slot is left");
  const c = h.submit("C", "cheap", "c");
  assert.equal(c.state, "running", "the cheap slot is free");
  assert.equal(c.position, null);
});

test("[-RX-SCH/queue] per-owner and daemon-wide caps refuse with the retryable job_queue_full; a cancel frees a place", async () => {
  const h = harness({ maxQueued: 64, maxPerOwner: 16 });
  for (let i = 0; i < 16; i++) h.submit("A", "deep", `a${i}`);
  assert.throws(
    () => h.submit("A", "cheap", "a16"),
    (e) => isCoreError(e, "job_queue_full") && e.retryable && e.detail?.scope === "connection" && e.detail.max === 16,
  );
  assert.equal(h.submit("B", "deep", "b0").state, "queued", "another owner still submits");
  for (const o of ["C", "D", "E"]) for (let i = 0; i < 16; i++) h.submit(o, "deep", `${o}${i}`);
  // 1 deep running (a0); queued: 15 + 1 + 48 = 64
  assert.equal(h.s.counts().queued, 64);
  assert.throws(
    () => h.submit("F", "deep", "f0"),
    (e) => isCoreError(e, "job_queue_full") && e.retryable && e.detail?.scope === "daemon" && e.detail.queued === 64,
  );
  const victim = h.s.list().jobs.find((j) => j.state === "queued" && j.owner === "C")!;
  assert.equal(h.s.cancel(victim.job, "client").cancelled, true);
  assert.equal(h.submit("F", "deep", "f0").state, "queued", "a submit succeeds again after a cancel");
});

test("[-RX-SCH/queue] invalid submissions are refused and never queued", () => {
  const h = harness();
  const before = h.s.counts();
  const refuse = (sub: Parameters<Scheduler["submit"]>[1], code: string) =>
    assert.throws(
      () => h.s.submit("A", sub),
      (e) => isCoreError(e) && e.code === code,
      JSON.stringify(sub),
    );
  refuse({ operation: "no.such.op", args: {}, workspace: WS }, "operation_unknown");
  refuse({ operation: "test.gate.cheap", args: { tag: 5 }, workspace: WS }, "bad_request");
  refuse({ operation: "test.gate.cheap", args: { tag: "x", extra: 1 }, workspace: WS }, "bad_request");
  refuse({ operation: "test.gate.cheap", args: { tag: "x" }, workspace: "relative/dir" }, "bad_request");
  refuse({ operation: "test.gate.cheap", args: { tag: "x" }, workspace: join(root, "missing") }, "bad_request");
  refuse({ operation: "test.gate.cheap", args: { tag: "x" }, workspace: WS, timeoutMs: 0 }, "bad_request");
  refuse(
    { operation: "test.gate.cheap", args: { tag: "x" }, workspace: WS, timeoutMs: SCHED_LIMITS.maxTimeoutMs + 1 },
    "bad_request",
  );
  refuse({ operation: "test.gate.cheap", args: { tag: "x" }, workspace: WS, timeoutMs: 1.5 }, "bad_request");
  assert.deepEqual(h.s.counts(), before);
  assert.equal(h.board.starts.length, 0);
});

// --- cancel -------------------------------------------------------------------------------------------

test("[+RX-SCH/cancel] a queued job, cancelled, never starts; a running one is aborted and ends cancelled", async () => {
  const h = harness({ maxRunning: 1 });
  const a = h.submit("A", "cheap", "a");
  const b = h.submit("A", "cheap", "b");
  assert.equal(b.state, "queued");
  const r = h.s.cancel(b.job, "client");
  assert.deepEqual(r, { job: b.job, state: "cancelled", cancelled: true });
  const run = h.s.cancel(a.job, "client");
  assert.deepEqual(run, { job: a.job, state: "running", cancelled: true });
  await flush();
  const ia = h.s.status(a.job);
  assert.equal(ia.state, "cancelled");
  assert.equal(ia.reason, "client");
  assert.equal((ia.error as { code: string }).code, "job_cancelled");
  assert.equal(h.board.count("b"), 0, "the cancelled queued job never ran");
  assert.equal(h.s.status(b.job).startedAt, null);
  assert.equal(h.clock.timers.size, 0, "no deadline is left armed");
});

test("[-RX-SCH/cancel] a cancel that arrives after the operation resolved leaves it succeeded, with cancelRequested", async () => {
  let id = "";
  let s: Scheduler | null = null;
  const hooks: SchedHooks = {
    afterRun: (j: JobInfo) => {
      if (j.job === id) assert.equal(s!.cancel(id, "client").cancelled, true);
    },
  };
  const h = harness({}, hooks);
  s = h.s;
  id = h.submit("A", "cheap", "late").job;
  h.board.open("late");
  await flush();
  const i = h.s.status(id);
  assert.equal(i.state, "succeeded");
  assert.equal(i.cancelRequested, true);
  assert.equal(h.s.result(id).result.data && (h.s.result(id).result.data as { tag: string }).tag, "late");
  assert.deepEqual(h.s.cancel(id, "client"), { job: id, state: "succeeded", cancelled: false });
  assert.throws(
    () => h.s.cancel("no-such-job", "client"),
    (e) => isCoreError(e, "job_not_found"),
  );
});

test("[+RX-SCH/cancel] a disconnect cancels the owner's queued and running jobs, and only those", async () => {
  const h = harness({ maxRunning: 2, maxRunningNonCheap: 2 });
  const a1 = h.submit("A", "cheap", "a1");
  const b1 = h.submit("B", "cheap", "b1");
  const a2 = h.submit("A", "cheap", "a2");
  const w = h.s.wait("C", b1.job, 1000);
  h.s.dropOwner("A");
  await flush();
  assert.equal(h.s.status(a1.job).state, "cancelled");
  assert.equal(h.s.status(a1.job).reason, "disconnect");
  assert.equal(h.s.status(a2.job).state, "cancelled");
  assert.equal(h.board.count("a2"), 0);
  assert.equal(h.s.status(b1.job).state, "running", "B's job is untouched");
  // the waiter C goes; B's job is not cancelled by it
  h.s.dropOwner("C");
  const r = await w;
  assert.equal(r.done, false);
  h.board.open("b1");
  await flush();
  assert.equal(h.s.status(b1.job).state, "succeeded");
});

test("[+RX-SCH/cancel] close() refuses submits, cancels every job (reason shutdown) and drains the running ones", async () => {
  const h = harness({ maxRunning: 1 });
  const a = h.submit("A", "cheap", "a");
  const b = h.submit("A", "cheap", "b");
  let left = -1;
  const closing = h.s.close().then((n) => {
    left = n;
  });
  await flush();
  // the drain ends because the running job settled, not because the (unadvanced) clock ran out
  const drained = left;
  if (left === -1) h.clock.advance(h.s.limits.shutdownDrainMs);
  await closing;
  assert.equal(drained, 0, "drained once the running job settled");
  for (const j of [a, b]) {
    assert.equal(h.s.status(j.job).state, "cancelled");
    assert.equal(h.s.status(j.job).reason, "shutdown");
  }
  assert.equal(h.board.count("b"), 0);
  assert.throws(
    () => h.submit("A", "cheap", "c"),
    (e) => isCoreError(e, "daemon_not_running") && e.retryable,
  );
  assert.equal(h.clock.timers.size, 0);
});

// --- timeout ------------------------------------------------------------------------------------------

test("[+RX-SCH/timeout] a job ends timed_out when the clock passes start + timeoutMs; the deadline counts from the start", async () => {
  const h = harness({ maxRunning: 1 });
  const first = h.submit("A", "cheap", "first");
  const j = h.submit("A", "cheap", "t", 1000);
  assert.equal(j.state, "queued");
  h.clock.advance(5000);
  await flush();
  assert.equal(h.s.status(j.job).state, "queued", "queued time does not count");
  assert.equal(h.s.status(first.job).state, "running", "60 s default not reached");
  h.board.open("first");
  await flush();
  assert.equal(h.s.status(j.job).state, "running");
  h.clock.advance(999);
  await flush();
  assert.equal(h.s.status(j.job).state, "running", "not yet at start + 999");
  h.clock.advance(1);
  await flush();
  const i = h.s.status(j.job);
  assert.equal(i.state, "timed_out");
  assert.equal(i.endedAt! - i.startedAt!, 1000);
  const e = i.error as { code: string; detail: { timeoutMs: number } };
  assert.equal(e.code, "job_timeout");
  assert.equal(e.detail.timeoutMs, 1000);
  assert.throws(
    () => h.s.result(j.job),
    (x) => isCoreError(x, "job_timeout"),
  );
});

test("[-RX-SCH/timeout] a gate opened before its deadline succeeds, and its deadline timer is gone", async () => {
  const h = harness();
  const j = h.submit("A", "cheap", "ok", 1000);
  h.clock.advance(500);
  h.board.open("ok");
  await flush();
  assert.equal(h.s.status(j.job).state, "succeeded");
  assert.equal(h.clock.timers.size, 0, "the deadline timer was cleared at the end");
  h.clock.advance(10_000);
  await flush();
  assert.equal(h.s.status(j.job).state, "succeeded");
});

test("[-RX-SCH/timeout] a cancelled job's code is job_cancelled, a timed-out one's job_timeout", async () => {
  const h = harness();
  const c = h.submit("A", "cheap", "c", 1000);
  const t = h.submit("A", "cheap", "t", 1000);
  h.s.cancel(c.job, "client");
  await flush();
  h.clock.advance(1000);
  await flush();
  assert.equal(h.s.status(c.job).state, "cancelled");
  assert.equal((h.s.status(c.job).error as { code: string }).code, "job_cancelled");
  assert.equal(h.s.status(t.job).state, "timed_out");
  assert.equal((h.s.status(t.job).error as { code: string }).code, "job_timeout");
  assert.throws(
    () => h.submit("A", "cheap", "x", SCHED_LIMITS.maxTimeoutMs + 1),
    (e) => isCoreError(e, "bad_request"),
  );
});

// --- protocol-level unit checks -----------------------------------------------------------------------

test("[-RX-SCH/protocol] a job evicted past maxRetained is job_not_found; result on a running job is bad_request; waits are capped", async () => {
  const h = harness({ maxRetained: 2, maxWaitsPerConnection: 2 });
  const ids = ["e1", "e2", "e3"].map((t) => h.submit("A", "cheap", t).job);
  assert.throws(
    () => h.s.result(ids[0]!),
    (e) => isCoreError(e, "bad_request"),
  );
  void h.s.wait("W", ids[0]!, 100);
  void h.s.wait("W", ids[1]!, 100);
  assert.throws(
    () => h.s.wait("W", ids[2]!, 100),
    (e) => isCoreError(e, "bad_request"),
  );
  for (const t of ["e1", "e2", "e3"]) h.board.open(t);
  await flush();
  assert.throws(
    () => h.s.status(ids[0]!),
    (e) => isCoreError(e, "job_not_found"),
  );
  assert.equal(h.s.status(ids[2]!).state, "succeeded");
  assert.equal(h.s.counts().retained, 2);
});
