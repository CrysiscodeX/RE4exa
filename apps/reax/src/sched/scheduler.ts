// SCH, the scheduler (ADR 0008; D-27): registered operations run as jobs under a bounded queue.
// Pure and in process: the daemon (src/daemon/jobs.ts) puts it on the wire, one owner per connection.
//
// The dispatch rule (the reference model in test/fixtures/sched-model.ts implements the same text):
//   1. Dispatch runs synchronously after each submit, finish, cancel and disconnect, and repeats
//      until nothing more can start.
//   2. A queued job is eligible when starting it keeps every running cap: total, deep, non-cheap
//      (medium plus deep: one slot stays reserved for cheap work) and write.
//   3. The owners with an eligible job are taken in round-robin order: the owner whose last dispatch
//      is oldest goes first; an owner never dispatched counts as oldest, ties broken by their first
//      submission's seq. That owner's eligible job with the lowest seq starts. An owner's record
//      (first seq, last dispatch) lasts for the owner's life, until dropOwner (in the daemon: until
//      its connection closes), so an owner that keeps one job at a time does not jump the queue.
//   4. An ineligible job never blocks an eligible one behind it. Within one owner and one class,
//      order is FIFO.
// Admission: an owner may have maxPerOwner jobs queued or running; a job that cannot start at once
// is refused while maxQueued jobs are queued daemon-wide. Both refusals are the retryable
// job_queue_full, and a refused submission is never queued.
// Deadlines count from the start, on the injected clock. Cancellation is cooperative: the job's
// AbortSignal is aborted and the job's final state comes from how the operation settles; an
// operation that resolves is succeeded even if a cancel arrived after its last check.
import { randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { CoreError, isCoreError } from "@re4exa/core/errors";
import "../errors.ts";
import { operation as registryOperation, runOp } from "../ops/registry.ts";
import { checkInput } from "../ops/schema.ts";
import type { Operation, OpResult } from "../ops/types.ts";

export type JobClass = Operation["cost"];
export type JobState = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "timed_out";
export type CancelReason = "client" | "disconnect" | "shutdown";

export interface SchedLimits {
  /** Queued jobs, daemon-wide (job_queue_full, scope "daemon"). */
  maxQueued: number;
  /** Queued plus running jobs of one owner (job_queue_full, scope "connection"). */
  maxPerOwner: number;
  maxRunning: number;
  maxRunningDeep: number;
  /** Medium plus deep jobs running: maxRunning - 1 keeps one slot for cheap work. */
  maxRunningNonCheap: number;
  /** Jobs with effect "write" running (write serialisation). */
  maxRunningWrite: number;
  /** Default timeout by class, in ms. */
  timeoutMs: Readonly<Record<JobClass, number>>;
  maxTimeoutMs: number;
  /** Finished jobs kept for status and result; the oldest is evicted first. */
  maxRetained: number;
  /** Bytes of stored results; the oldest finished job is evicted first. */
  maxRetainedBytes: number;
  /** runOperation's budget: paged results are shortened, others refused (result_too_large). */
  resultBudget: number;
  /** Outstanding waits per waiter (a connection). */
  maxWaitsPerConnection: number;
  /** The longest one wait may last. */
  maxWaitMs: number;
  /** How long close() waits for running jobs to settle after cancelling them. */
  shutdownDrainMs: number;
}

export const SCHED_LIMITS: Readonly<SchedLimits> = Object.freeze({
  maxQueued: 64,
  maxPerOwner: 16,
  maxRunning: 4,
  maxRunningDeep: 1,
  maxRunningNonCheap: 3,
  maxRunningWrite: 1,
  timeoutMs: Object.freeze({ cheap: 60_000, medium: 300_000, deep: 900_000 }),
  maxTimeoutMs: 3_600_000,
  maxRetained: 128,
  maxRetainedBytes: 32 * 1024 * 1024,
  resultBudget: 512 * 1024,
  maxWaitsPerConnection: 8,
  maxWaitMs: 30_000,
  shutdownDrainMs: 10_000,
});

/** Every deadline goes through this, so tests can drive time (a built-in timeout signal cannot be). */
export interface Clock {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export const SYSTEM_CLOCK: Clock = {
  now: () => Date.now(),
  // unref'd: a job's deadline or a wait never keeps a process alive on its own
  setTimer: (fn, ms) => setTimeout(fn, ms).unref(),
  clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
};

/** In-process seams (tests only): awaited after a job is marked running and before op.run, and
 * after op.run settles and before the final state is set. */
export interface SchedHooks {
  beforeRun?: (job: JobInfo) => Promise<void> | void;
  afterRun?: (job: JobInfo) => Promise<void> | void;
}

export interface SchedulerOptions {
  limits?: Partial<SchedLimits>;
  /** Defaults to the registry. Test operations reach a scheduler only through this, in process. */
  resolveOperation?: (name: string) => Operation;
  clock?: Clock;
  hooks?: SchedHooks;
  /** The reax home every job runs against (OpContext.home). */
  home?: string;
  log?: (line: string) => void;
}

export interface JobInfo {
  job: string;
  operation: string;
  class: JobClass;
  effect: Operation["effect"];
  state: JobState;
  owner: string;
  submittedAt: number;
  startedAt: number | null;
  endedAt: number | null;
  timeoutMs: number;
  cancelRequested: boolean;
  reason: CancelReason | null;
  error: Record<string, unknown> | null;
}

export interface Submission {
  operation: string;
  args?: unknown;
  workspace: string;
  timeoutMs?: number;
}

interface Job {
  info: JobInfo;
  seq: number;
  op: Operation;
  args: Record<string, unknown>;
  workspace: string;
  controller: AbortController | null;
  timer: unknown;
  result: (OpResult & { operation: string }) | null;
  bytes: number;
  settled: Promise<void> | null;
  waits: Set<Wait>;
}

interface Wait {
  waiter: string;
  job: Job;
  timer: unknown;
  resolve: (r: JobInfo & { done: boolean }) => void;
}

interface Owner {
  firstSeq: number;
  /** The dispatch counter at this owner's last start; null when never dispatched. */
  lastTick: number | null;
}

const FINAL: ReadonlySet<JobState> = new Set(["succeeded", "failed", "cancelled", "timed_out"]);
export const isFinal = (s: JobState) => FINAL.has(s);
const EXCERPT = 200;
/** Owners with a round-robin record at once (records last until dropOwner). */
export const MAX_OWNERS = 1024;

/** A CoreError as stored on a job (and sent on the wire): the failure table's fields and detail. */
export function errorRecord(e: CoreError): Record<string, unknown> {
  const j = e.toJSON();
  return j.detail === undefined ? { ...j, detail: null } : j;
}

const posInt = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 1;

function checkLimits(l: SchedLimits): void {
  for (const k of [
    "maxQueued",
    "maxPerOwner",
    "maxRunning",
    "maxRunningDeep",
    "maxRunningNonCheap",
    "maxRunningWrite",
    "maxTimeoutMs",
    "maxRetained",
    "maxRetainedBytes",
    "resultBudget",
    "maxWaitsPerConnection",
    "maxWaitMs",
    "shutdownDrainMs",
  ] as const)
    if (!posInt(l[k])) throw new Error(`scheduler limit ${k} must be a positive integer`);
  if (l.maxRunningNonCheap > l.maxRunning || l.maxRunningDeep > l.maxRunningNonCheap)
    throw new Error("scheduler limits need maxRunningDeep <= maxRunningNonCheap <= maxRunning");
  if (l.maxRunningWrite > l.maxRunning) throw new Error("scheduler limits need maxRunningWrite <= maxRunning");
  for (const c of ["cheap", "medium", "deep"] as const)
    if (!posInt(l.timeoutMs[c]) || l.timeoutMs[c] > l.maxTimeoutMs)
      throw new Error(`scheduler timeout for ${c} must be 1..maxTimeoutMs`);
}

export class Scheduler {
  readonly limits: Readonly<SchedLimits>;
  readonly #resolve: (name: string) => Operation;
  readonly #clock: Clock;
  readonly #hooks: SchedHooks;
  readonly #home: string | undefined;
  readonly #log: (line: string) => void;
  /** Every job not yet evicted, by id. */
  readonly #jobs = new Map<string, Job>();
  /** Queued jobs in seq order. */
  readonly #queue: Job[] = [];
  readonly #running = new Set<Job>();
  /** Finished jobs in the order they finished (the eviction order). */
  readonly #retained = new Set<Job>();
  #retainedBytes = 0;
  readonly #owners = new Map<string, Owner>();
  readonly #waitsBy = new Map<string, number>();
  #seq = 0;
  #tick = 0;
  #closing = false;

  constructor(opts: SchedulerOptions = {}) {
    const merged: SchedLimits = { ...SCHED_LIMITS, ...opts.limits };
    // a test that shrinks maxRunning alone keeps the reserved cheap slot
    if (opts.limits?.maxRunning !== undefined && opts.limits.maxRunningNonCheap === undefined)
      merged.maxRunningNonCheap = Math.max(1, merged.maxRunning - 1);
    if (merged.maxRunningDeep > merged.maxRunningNonCheap) merged.maxRunningDeep = merged.maxRunningNonCheap;
    if (merged.maxRunningWrite > merged.maxRunning) merged.maxRunningWrite = merged.maxRunning;
    checkLimits(merged);
    this.limits = Object.freeze({ ...merged, timeoutMs: Object.freeze({ ...merged.timeoutMs }) });
    this.#resolve = opts.resolveOperation ?? registryOperation;
    this.#clock = opts.clock ?? SYSTEM_CLOCK;
    this.#hooks = opts.hooks ?? {};
    this.#home = opts.home;
    this.#log = opts.log ?? (() => {});
  }

  /** Validate, admit and queue a job, then dispatch. A refused submission is never queued. */
  submit(owner: string, s: Submission): { job: string; state: JobState; position: number | null } {
    if (this.#closing) throw new CoreError("daemon_not_running", { why: "the daemon is shutting down" });
    const op = this.#resolve(s.operation);
    const args = checkInput(op.name, op.input, s.args ?? {});
    const workspace = this.#workspace(s.workspace);
    const cls = op.cost;
    let timeoutMs = this.limits.timeoutMs[cls];
    if (s.timeoutMs !== undefined) {
      if (!posInt(s.timeoutMs) || s.timeoutMs > this.limits.maxTimeoutMs)
        throw new CoreError("bad_request", {
          field: "timeoutMs",
          why: `a whole number of ms from 1 to ${this.limits.maxTimeoutMs}`,
        });
      timeoutMs = s.timeoutMs;
    }
    // the daemon drops an owner when its connection closes, so it has at most a few dozen; an
    // in-process caller that never drops owners is stopped here
    if (!this.#owners.has(owner) && this.#owners.size >= MAX_OWNERS)
      throw new CoreError("job_queue_full", { scope: "daemon", owners: this.#owners.size, max: MAX_OWNERS });
    const live = this.#live(owner);
    if (live >= this.limits.maxPerOwner)
      throw new CoreError("job_queue_full", { scope: "connection", queued: live, max: this.limits.maxPerOwner });
    if (this.#queue.length >= this.limits.maxQueued && !this.#eligible(cls, op.effect))
      throw new CoreError("job_queue_full", {
        scope: "daemon",
        queued: this.#queue.length,
        max: this.limits.maxQueued,
      });
    const seq = ++this.#seq;
    const job: Job = {
      info: {
        job: randomUUID(),
        operation: op.name,
        class: cls,
        effect: op.effect,
        state: "queued",
        owner,
        submittedAt: this.#clock.now(),
        startedAt: null,
        endedAt: null,
        timeoutMs,
        cancelRequested: false,
        reason: null,
        error: null,
      },
      seq,
      op,
      args,
      workspace,
      controller: null,
      timer: null,
      result: null,
      bytes: 0,
      settled: null,
      waits: new Set(),
    };
    this.#jobs.set(job.info.job, job);
    this.#queue.push(job);
    if (!this.#owners.has(owner)) this.#owners.set(owner, { firstSeq: seq, lastTick: null });
    this.#dispatch();
    const position = job.info.state === "queued" ? this.#queue.indexOf(job) : null;
    return { job: job.info.job, state: job.info.state, position };
  }

  status(id: string): JobInfo {
    return this.#snapshot(this.#get(id));
  }

  list(): { jobs: JobInfo[]; counts: { queued: number; running: number; retained: number } } {
    const jobs = [...this.#jobs.values()].sort((a, b) => a.seq - b.seq).map((j) => this.#snapshot(j));
    return { jobs, counts: this.counts() };
  }

  counts(): { queued: number; running: number; retained: number } {
    return { queued: this.#queue.length, running: this.#running.size, retained: this.#retained.size };
  }

  /** The result of a succeeded job; the job's own error for the other final states; bad_request
   * while it is not final. */
  result(id: string): { job: string; result: OpResult & { operation: string } } {
    const j = this.#get(id);
    if (!isFinal(j.info.state))
      throw new CoreError("bad_request", { job: id, why: `the job is ${j.info.state}; wait for it first` });
    if (j.info.state === "succeeded" && j.result) return { job: id, result: j.result };
    const e = j.info.error ?? { code: "job_failed", detail: null };
    const code = String(e.code) as ConstructorParameters<typeof CoreError>[0];
    throw new CoreError(code, (e.detail as Record<string, unknown> | null) ?? undefined, String(e.message ?? ""));
  }

  /** Cancel a job, synchronously: a queued one is removed and never starts; a running one has its
   * signal aborted and ends as its operation settles; a finished one is unchanged. */
  cancel(id: string, reason: CancelReason): { job: string; state: JobState; cancelled: boolean } {
    const j = this.#get(id);
    let cancelled = false;
    if (j.info.state === "queued") {
      this.#queue.splice(this.#queue.indexOf(j), 1);
      j.info.cancelRequested = true;
      j.info.reason = reason;
      this.#finish(j, "cancelled", errorRecord(new CoreError("job_cancelled", { reason })));
      cancelled = true;
      this.#dispatch();
    } else if (j.info.state === "running") {
      const c = j.controller!;
      if (!c.signal.aborted) {
        j.info.cancelRequested = true;
        j.info.reason = reason;
        c.abort(new CoreError("job_cancelled", { reason }));
        cancelled = true;
      }
    }
    return { job: id, state: j.info.state, cancelled };
  }

  /** Wait until the job is final or ms pass (then done: false). Waits are capped per waiter. */
  wait(waiter: string, id: string, ms: number): Promise<JobInfo & { done: boolean }> {
    const j = this.#get(id);
    if (!Number.isInteger(ms) || ms < 0 || ms > this.limits.maxWaitMs)
      throw new CoreError("bad_request", { field: "timeoutMs", why: `0 to ${this.limits.maxWaitMs} ms` });
    if (isFinal(j.info.state)) return Promise.resolve({ ...this.#snapshot(j), done: true });
    const n = this.#waitsBy.get(waiter) ?? 0;
    if (n >= this.limits.maxWaitsPerConnection)
      throw new CoreError("bad_request", {
        why: `at most ${this.limits.maxWaitsPerConnection} outstanding waits per connection`,
      });
    return new Promise((resolve) => {
      const w: Wait = { waiter, job: j, timer: null, resolve };
      w.timer = this.#clock.setTimer(() => this.#endWait(w, false), ms);
      j.waits.add(w);
      this.#waitsBy.set(waiter, n + 1);
    });
  }

  /** A connection went away: cancel the jobs it submitted (reason disconnect) and end its waits.
   * Jobs it only waited on or cancelled are not touched. */
  dropOwner(owner: string): void {
    for (const j of [...this.#queue]) if (j.info.owner === owner) this.cancel(j.info.job, "disconnect");
    for (const j of [...this.#running].sort((a, b) => a.seq - b.seq))
      if (j.info.owner === owner) this.cancel(j.info.job, "disconnect");
    for (const j of this.#jobs.values()) for (const w of [...j.waits]) if (w.waiter === owner) this.#endWait(w, false);
    this.#owners.delete(owner);
  }

  /** Refuse new submissions, cancel every job (reason shutdown), and wait up to shutdownDrainMs
   * for the running ones to settle. Returns how many were still running then. */
  async close(): Promise<number> {
    this.#closing = true;
    for (const j of [...this.#queue]) this.cancel(j.info.job, "shutdown");
    const running = [...this.#running].sort((a, b) => a.seq - b.seq);
    for (const j of running) this.cancel(j.info.job, "shutdown");
    let timer: unknown = null;
    const left = await Promise.race([
      Promise.all(running.map((j) => j.settled)).then(() => 0),
      new Promise<number>((r) => {
        timer = this.#clock.setTimer(() => r(this.#running.size), this.limits.shutdownDrainMs);
      }),
    ]);
    this.#clock.clearTimer(timer);
    if (left > 0) this.#log(`reax daemon: ${left} job(s) still running after ${this.limits.shutdownDrainMs} ms`);
    for (const j of this.#jobs.values()) for (const w of [...j.waits]) this.#endWait(w, false);
    return left;
  }

  #get(id: unknown): Job {
    const j = typeof id === "string" ? this.#jobs.get(id) : undefined;
    if (!j) throw new CoreError("job_not_found", { job: String(id).slice(0, 64) });
    return j;
  }

  #workspace(w: unknown): string {
    if (typeof w !== "string" || !isAbsolute(w))
      throw new CoreError("bad_request", { field: "workspace", why: "an absolute path to a directory" });
    try {
      if (statSync(w).isDirectory()) return realpathSync(w);
    } catch {
      // reported below
    }
    throw new CoreError("bad_request", { field: "workspace", why: "an existing directory" });
  }

  #live(owner: string): number {
    let n = 0;
    for (const j of this.#queue) if (j.info.owner === owner) n++;
    for (const j of this.#running) if (j.info.owner === owner) n++;
    return n;
  }

  #eligible(cls: JobClass, effect: Operation["effect"]): boolean {
    const l = this.limits;
    if (this.#running.size >= l.maxRunning) return false;
    let deep = 0;
    let nonCheap = 0;
    let write = 0;
    for (const r of this.#running) {
      if (r.info.class === "deep") deep++;
      if (r.info.class !== "cheap") nonCheap++;
      if (r.info.effect === "write") write++;
    }
    if (cls === "deep" && deep >= l.maxRunningDeep) return false;
    if (cls !== "cheap" && nonCheap >= l.maxRunningNonCheap) return false;
    if (effect === "write" && write >= l.maxRunningWrite) return false;
    return true;
  }

  /** The dispatch rule (header, steps 1-4). Each round starts one job, and at most maxRunning
   * can run, so the loop is bounded. */
  #dispatch(): void {
    if (this.#closing) return;
    for (let round = 0; round <= this.limits.maxRunning; round++) {
      // each owner's eligible job with the lowest seq (the queue is in seq order)
      const firstOf = new Map<string, Job>();
      for (const j of this.#queue)
        if (!firstOf.has(j.info.owner) && this.#eligible(j.info.class, j.info.effect)) firstOf.set(j.info.owner, j);
      let pick: Job | null = null;
      let best: Owner | null = null;
      for (const [owner, j] of firstOf) {
        const o = this.#owners.get(owner)!;
        if (best === null || older(o, best)) {
          best = o;
          pick = j;
        }
      }
      if (!pick || !best) return;
      best.lastTick = ++this.#tick;
      this.#start(pick);
    }
  }

  #start(j: Job): void {
    this.#queue.splice(this.#queue.indexOf(j), 1);
    this.#running.add(j);
    j.info.state = "running";
    j.info.startedAt = this.#clock.now();
    const c = new AbortController();
    j.controller = c;
    // the deadline counts from the start
    j.timer = this.#clock.setTimer(() => {
      if (j.info.state === "running" && !c.signal.aborted)
        c.abort(new CoreError("job_timeout", { timeoutMs: j.info.timeoutMs }));
    }, j.info.timeoutMs);
    j.settled = this.#run(j, c.signal);
  }

  async #run(j: Job, signal: AbortSignal): Promise<void> {
    let ok = false;
    let err: unknown = null;
    try {
      await this.#hooks.beforeRun?.(this.#snapshot(j));
      const ctx = { workspace: j.workspace, signal, ...(this.#home ? { home: this.#home } : {}) };
      j.result = await runOp(j.op, j.args, ctx, { budget: this.limits.resultBudget });
      j.bytes = Buffer.byteLength(JSON.stringify(j.result));
      ok = true;
    } catch (e) {
      err = e;
    }
    try {
      await this.#hooks.afterRun?.(this.#snapshot(j));
    } catch {
      // a hook's failure does not change how the operation settled
    }
    this.#running.delete(j);
    if (ok) {
      // succeeded beats a late cancel: the operation passed its last check
      this.#finish(j, "succeeded", null);
    } else if (signal.aborted) {
      const why = signal.reason as CoreError;
      const timedOut = isCoreError(why, "job_timeout");
      const cause = isCoreError(err) && err !== why ? { cause: err.code } : {};
      const e = new CoreError(why.code, { ...why.detail, ...cause });
      j.result = null;
      this.#finish(j, timedOut ? "timed_out" : "cancelled", errorRecord(e));
    } else {
      j.result = null;
      const e = isCoreError(err)
        ? err
        : new CoreError("job_failed", { excerpt: String((err as Error)?.message ?? err).slice(0, EXCERPT) });
      this.#finish(j, "failed", errorRecord(e));
    }
    this.#dispatch();
  }

  #finish(j: Job, state: JobState, error: Record<string, unknown> | null): void {
    if (j.timer !== null) this.#clock.clearTimer(j.timer);
    j.timer = null;
    j.controller = null;
    j.info.state = state;
    j.info.error = error;
    j.info.endedAt = this.#clock.now();
    for (const w of [...j.waits]) this.#endWait(w, true);
    this.#retained.add(j);
    this.#retainedBytes += j.bytes;
    // bounded: each pass evicts one job
    while (
      this.#retained.size > this.limits.maxRetained ||
      (this.#retainedBytes > this.limits.maxRetainedBytes && this.#retained.size > 1)
    ) {
      const old = this.#retained.values().next().value!;
      this.#retained.delete(old);
      this.#retainedBytes -= old.bytes;
      this.#jobs.delete(old.info.job);
      old.result = null;
    }
  }

  #endWait(w: Wait, done: boolean): void {
    if (!w.job.waits.delete(w)) return;
    this.#clock.clearTimer(w.timer);
    const n = (this.#waitsBy.get(w.waiter) ?? 1) - 1;
    if (n > 0) this.#waitsBy.set(w.waiter, n);
    else this.#waitsBy.delete(w.waiter);
    w.resolve({ ...this.#snapshot(w.job), done });
  }

  #snapshot(j: Job): JobInfo {
    return { ...j.info };
  }
}

/** Round-robin order: never dispatched first (by first seq), then the oldest last dispatch. */
function older(a: Owner, b: Owner): boolean {
  if (a.lastTick === null && b.lastTick === null) return a.firstSeq < b.firstSeq;
  if (a.lastTick === null) return true;
  if (b.lastTick === null) return false;
  return a.lastTick < b.lastTick;
}
