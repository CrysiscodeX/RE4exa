// The reference queue model for the SCH tests, written from the dispatch-rule text of the work
// order and ADR 0008, not from src/sched/scheduler.ts (it imports nothing from src/sched or
// src/daemon). It maps an event list to the expected start order, refusals and final states.
//
// The rule, as implemented here:
// - admission: an owner with maxPerOwner jobs queued or running is refused (scope "connection");
//   otherwise a job that cannot start at once is refused while maxQueued jobs are queued (scope
//   "daemon"). A refused submission takes no sequence number and is never queued;
// - a queued job is eligible when starting it keeps every running cap: total, deep, non-cheap
//   (medium plus deep) and write;
// - after every event, repeat: among the owners with an eligible job, take the one dispatched
//   longest ago (never dispatched counts as oldest; ties between those by the seq of the owner's
//   first submission); start that owner's eligible job with the lowest seq; until nothing can start;
// - an owner's first seq and last dispatch are kept for the owner's whole life: they are forgotten
//   only when the owner disconnects (an owner that is idle for a while keeps its place in the turn);
// - each job ends one at a time, in event order, and dispatch runs after each ending;
// - a timeout fires when the clock reaches start + timeoutMs; the jobs past their deadline in one
//   clock advance end in order of deadline, then of start;
// - a disconnect cancels the owner's queued jobs (in seq order), then its running ones (in seq
//   order); a cancel of a finished job changes nothing; a running job that is released ends
//   succeeded.

export type Cls = "cheap" | "medium" | "deep";
export interface ModelLimits {
  maxQueued: number;
  maxPerOwner: number;
  maxRunning: number;
  maxRunningDeep: number;
  maxRunningNonCheap: number;
  maxRunningWrite: number;
}

export type ModelEvent =
  | { t: "submit"; label: string; owner: string; cls: Cls; write: boolean; timeoutMs: number }
  | { t: "release"; label: string }
  | { t: "cancel"; label: string }
  | { t: "drop"; owner: string }
  | { t: "advance"; ms: number };

export type FinalState = "queued" | "running" | "succeeded" | "cancelled" | "timed_out";

export interface ModelOutcome {
  starts: string[];
  /** The fairness bound, checked from the dispatch history (not from the records above): while an
   * owner has an eligible job, no other owner is dispatched twice between two of its dispatches,
   * so it waits for at most (owners - 1) dispatches per turn. Each breach is listed here. */
  breaches: string[];
  refused: Record<string, "connection" | "daemon">;
  states: Record<string, { state: FinalState; reason: string | null }>;
}

interface MJob {
  label: string;
  seq: number;
  owner: string;
  cls: Cls;
  write: boolean;
  timeoutMs: number;
  state: FinalState;
  reason: string | null;
  deadline: number;
  startOrder: number;
}

export function runModel(limits: ModelLimits, events: readonly ModelEvent[]): ModelOutcome {
  let now = 0;
  let seq = 0;
  let dispatches = 0;
  const jobs = new Map<string, MJob>();
  const owners = new Map<string, { first: number; last: number | null }>();
  const starts: string[] = [];
  const refused: ModelOutcome["refused"] = {};

  const queued = () => [...jobs.values()].filter((j) => j.state === "queued").sort((a, b) => a.seq - b.seq);
  const running = () => [...jobs.values()].filter((j) => j.state === "running");
  const fits = (cls: Cls, write: boolean) => {
    const r = running();
    if (r.length >= limits.maxRunning) return false;
    if (cls === "deep" && r.filter((j) => j.cls === "deep").length >= limits.maxRunningDeep) return false;
    if (cls !== "cheap" && r.filter((j) => j.cls !== "cheap").length >= limits.maxRunningNonCheap) return false;
    if (write && r.filter((j) => j.write).length >= limits.maxRunningWrite) return false;
    return true;
  };
  const liveOf = (owner: string) =>
    [...jobs.values()].filter((j) => j.owner === owner && (j.state === "queued" || j.state === "running")).length;
  // passedBy.get(O).get(P): how often P was dispatched while O had an eligible job, since O's last
  // dispatch
  const passedBy = new Map<string, Map<string, number>>();
  const breaches: string[] = [];

  const dispatch = () => {
    for (;;) {
      const candidates = new Map<string, MJob>();
      for (const j of queued()) if (!candidates.has(j.owner) && fits(j.cls, j.write)) candidates.set(j.owner, j);
      if (candidates.size === 0) return;
      const order = [...candidates.keys()].sort((a, b) => {
        const oa = owners.get(a)!;
        const ob = owners.get(b)!;
        if (oa.last === null && ob.last === null) return oa.first - ob.first;
        if (oa.last === null) return -1;
        if (ob.last === null) return 1;
        return oa.last - ob.last;
      });
      const owner = order[0]!;
      const j = candidates.get(owner)!;
      for (const waiting of candidates.keys()) {
        if (waiting === owner) continue;
        const m = passedBy.get(waiting) ?? new Map<string, number>();
        const n = (m.get(owner) ?? 0) + 1;
        m.set(owner, n);
        passedBy.set(waiting, m);
        if (n > 1) breaches.push(`${owner} dispatched ${n} times while ${waiting} waited (${j.label})`);
      }
      passedBy.delete(owner);
      owners.get(owner)!.last = ++dispatches;
      j.state = "running";
      j.deadline = now + j.timeoutMs;
      j.startOrder = starts.length;
      starts.push(j.label);
    }
  };

  const end = (j: MJob, state: FinalState, reason: string | null) => {
    j.state = state;
    j.reason = reason;
    dispatch();
  };

  for (const e of events) {
    switch (e.t) {
      case "submit": {
        const live = liveOf(e.owner);
        if (live >= limits.maxPerOwner) {
          refused[e.label] = "connection";
          break;
        }
        if (queued().length >= limits.maxQueued && !fits(e.cls, e.write)) {
          refused[e.label] = "daemon";
          break;
        }
        const j: MJob = {
          label: e.label,
          seq: ++seq,
          owner: e.owner,
          cls: e.cls,
          write: e.write,
          timeoutMs: e.timeoutMs,
          state: "queued",
          reason: null,
          deadline: Number.POSITIVE_INFINITY,
          startOrder: -1,
        };
        jobs.set(e.label, j);
        if (!owners.has(e.owner)) owners.set(e.owner, { first: j.seq, last: null });
        dispatch();
        break;
      }
      case "release": {
        const j = jobs.get(e.label);
        if (j?.state === "running") end(j, "succeeded", null);
        break;
      }
      case "cancel": {
        const j = jobs.get(e.label);
        if (j && (j.state === "queued" || j.state === "running")) end(j, "cancelled", "client");
        break;
      }
      case "drop": {
        const mine = [...jobs.values()].filter((j) => j.owner === e.owner).sort((a, b) => a.seq - b.seq);
        for (const j of mine.filter((x) => x.state === "queued")) {
          j.state = "cancelled";
          j.reason = "disconnect";
        }
        for (const j of mine.filter((x) => x.state === "running")) end(j, "cancelled", "disconnect");
        owners.delete(e.owner);
        passedBy.delete(e.owner);
        dispatch();
        break;
      }
      case "advance": {
        now += e.ms;
        const due = running()
          .filter((j) => j.deadline <= now)
          .sort((a, b) => a.deadline - b.deadline || a.startOrder - b.startOrder);
        for (const j of due) end(j, "timed_out", null);
        break;
      }
    }
  }
  const states: ModelOutcome["states"] = {};
  for (const j of jobs.values()) states[j.label] = { state: j.state, reason: j.reason };
  return { starts, refused, states, breaches };
}

/** A small seeded PRNG (mulberry32), so every seeded run is reproducible. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random event list over a few owners. Labels are j1, j2, ...; owners are fresh after a drop. */
export function randomEvents(seed: number, n: number): ModelEvent[] {
  const r = prng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const out: ModelEvent[] = [];
  let owners = ["a", "b", "c"];
  let fresh = 0;
  let label = 0;
  const labels: string[] = [];
  const ownerOf = new Map<string, string>();
  const submit = (owner: string) => {
    const l = `j${++label}`;
    labels.push(l);
    ownerOf.set(l, owner);
    const cls = pick(["cheap", "medium", "deep"] as const);
    out.push({
      t: "submit",
      label: l,
      owner,
      cls,
      write: cls === "medium" && r() < 0.4,
      timeoutMs: pick([300, 800, 1500, 4000]),
    });
  };
  for (let i = 0; i < n; i++) {
    const x = r();
    if (x < 0.4 || labels.length === 0) submit(pick(owners));
    else if (x < 0.7) {
      const l = pick(labels);
      out.push({ t: "release", label: l });
      // an owner that keeps one job at a time: it submits again as soon as one ends
      const o = ownerOf.get(l)!;
      if (owners.includes(o) && r() < 0.5) submit(o);
    } else if (x < 0.8) out.push({ t: "cancel", label: pick(labels) });
    else if (x < 0.84) {
      const o = pick(owners);
      out.push({ t: "drop", owner: o });
      owners = owners.map((y) => (y === o ? `n${++fresh}` : y));
    } else out.push({ t: "advance", ms: pick([0, 100, 250, 500, 1000]) });
  }
  return out;
}
