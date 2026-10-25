// The durable kernel. One SQLite file, owned by one process at a time.
//
// - Ownership: `locking_mode=EXCLUSIVE` plus an immediate write at open, so a second process is
//   refused with `store_locked` instead of silently losing rows (the PGlite failure, N-1).
// - Tasks, attempts, leases and checkpoints follow absurd's state machine; every write made on
//   behalf of an attempt goes through `fence()`, which refuses expired or superseded leases
//   (absurd accepted writes from an expired, unswept lease).
// - Effects record their intent before running and settle by replay policy (pi-durable).
// - IDs are minted fresh per call, never from a counter cached at open (pi-durable defect).

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AssayError } from "../errors.ts";
import { canonicalize } from "../evidence/jcs.ts";
import { newId, sha256 } from "./ids.ts";
import { MIGRATIONS, SCHEMA_VERSION } from "./schema.ts";

export type Clock = () => number;
export type TaskState = "pending" | "running" | "completed" | "failed" | "cancelled" | "parked";
export type ReplayPolicy = "safe" | "keyed" | "unsafe";

export interface TaskRow {
  id: string;
  queue: string;
  kind: string;
  params: unknown;
  state: TaskState;
  case_id: string | null;
  parent_id: string | null;
  idem_key: string | null;
  attempts: number;
  crash_count: number;
  max_attempts: number;
  result: unknown;
  error: unknown;
  available_at: number;
  created_at: number;
  updated_at: number;
}

export interface Attempt {
  id: string;
  taskId: string;
  n: number;
  worker: string;
  leaseUntil: number;
}

export interface CaseRow {
  id: string;
  title: string;
  workspace: string | null;
  parent_case: string | null;
  forked_at: number | null;
  status: string;
  created_at: number;
  meta: Record<string, unknown>;
}

export interface CaseEvent {
  case_id: string;
  seq: number;
  kind: string;
  body: unknown;
  at: number;
  prev_hash: string;
  hash: string;
}

export interface KernelOptions {
  path: string;
  clock?: Clock;
  maxCrashes?: number;
}

type Row = Record<string, unknown>;

const GENESIS = "0".repeat(64);

function parse(v: unknown): unknown {
  return typeof v === "string" ? JSON.parse(v) : v;
}

export class Kernel {
  readonly db: DatabaseSync;
  readonly path: string;
  readonly now: Clock;
  readonly maxCrashes: number;
  #depth = 0;
  #closed = false;

  private constructor(db: DatabaseSync, path: string, clock: Clock, maxCrashes: number) {
    this.db = db;
    this.path = path;
    this.now = clock;
    this.maxCrashes = maxCrashes;
  }

  static open(opts: KernelOptions): Kernel {
    if (opts.path !== ":memory:") mkdirSync(dirname(opts.path), { recursive: true });
    const db = new DatabaseSync(opts.path, { timeout: 0 });
    try {
      db.exec("PRAGMA locking_mode=EXCLUSIVE");
      db.exec("PRAGMA journal_mode=WAL");
      db.exec("PRAGMA synchronous=FULL");
      db.exec("PRAGMA foreign_keys=ON");
      // Take the exclusive lock now; it is held until close or process death.
      db.exec("BEGIN IMMEDIATE");
      db.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
      db.exec("COMMIT");
    } catch (e) {
      try {
        db.close();
      } catch {
        // already closed
      }
      if (/locked|busy/i.test(String((e as Error).message))) throw new AssayError("store_locked", { path: opts.path });
      throw e;
    }
    const k = new Kernel(db, opts.path, opts.clock ?? Date.now, opts.maxCrashes ?? 5);
    k.#migrate();
    return k;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.db.close();
  }

  get closed(): boolean {
    return this.#closed;
  }

  #migrate(): void {
    const cur = Number(this.get<{ v: string }>("SELECT v FROM meta WHERE k='schema_version'")?.v ?? 0);
    if (cur > SCHEMA_VERSION) {
      this.close();
      throw new AssayError("store_schema_newer", { store: cur, code: SCHEMA_VERSION });
    }
    this.tx(() => {
      for (let v = cur + 1; v <= SCHEMA_VERSION; v++) this.db.exec(MIGRATIONS[v - 1]!);
      this.run(
        "INSERT INTO meta(k,v) VALUES('schema_version',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
        String(SCHEMA_VERSION),
      );
    });
  }

  // ---------- low-level helpers ----------

  run(sql: string, ...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint } {
    return this.db.prepare(sql).run(...(params as never[]));
  }

  get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
    return this.db.prepare(sql).get(...(params as never[])) as T | undefined;
  }

  all<T = Row>(sql: string, ...params: unknown[]): T[] {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }

  /** Synchronous transaction; nested calls use savepoints. */
  tx<T>(fn: () => T): T {
    const sp = `sp${this.#depth}`;
    this.db.exec(this.#depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${sp}`);
    this.#depth++;
    try {
      const out = fn();
      this.#depth--;
      this.db.exec(this.#depth === 0 ? "COMMIT" : `RELEASE ${sp}`);
      return out;
    } catch (e) {
      this.#depth--;
      this.db.exec(this.#depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
      throw e;
    }
  }

  meta(k: string): string | undefined {
    return this.get<{ v: string }>("SELECT v FROM meta WHERE k=?", k)?.v;
  }

  setMeta(k: string, v: string): void {
    this.run("INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", k, v);
  }

  // ---------- cases and the hash-chained event log ----------

  createCase(input: {
    title: string;
    workspace?: string | null;
    meta?: Record<string, unknown>;
    id?: string;
  }): CaseRow {
    const id = input.id ?? newId("case", this.now());
    const now = this.now();
    this.run(
      "INSERT INTO cases(id,title,workspace,parent_case,forked_at,status,created_at,meta) VALUES(?,?,?,?,?,?,?,?)",
      id,
      input.title,
      input.workspace ?? null,
      null,
      null,
      "open",
      now,
      JSON.stringify(input.meta ?? {}),
    );
    return this.getCase(id)!;
  }

  getCase(id: string): CaseRow | undefined {
    const r = this.get<Row>("SELECT * FROM cases WHERE id=?", id);
    return r ? ({ ...r, meta: parse(r.meta) } as unknown as CaseRow) : undefined;
  }

  listCases(): CaseRow[] {
    return this.all<Row>("SELECT * FROM cases ORDER BY created_at DESC").map(
      (r) => ({ ...r, meta: parse(r.meta) }) as unknown as CaseRow,
    );
  }

  updateCase(id: string, patch: { title?: string; status?: string; meta?: Record<string, unknown> }): void {
    const c = this.getCase(id);
    if (!c) throw new AssayError("not_found", { case: id });
    this.run(
      "UPDATE cases SET title=?, status=?, meta=? WHERE id=?",
      patch.title ?? c.title,
      patch.status ?? c.status,
      JSON.stringify({ ...c.meta, ...(patch.meta ?? {}) }),
      id,
    );
  }

  appendEvent(caseId: string, kind: string, body: unknown): CaseEvent {
    return this.tx(() => {
      const last = this.get<{ seq: number; hash: string }>(
        "SELECT seq, hash FROM case_events WHERE case_id=? ORDER BY seq DESC LIMIT 1",
        caseId,
      );
      const seq = (last?.seq ?? 0) + 1;
      const prev = last?.hash ?? GENESIS;
      const at = this.now();
      const hash = sha256(canonicalize({ case_id: caseId, seq, kind, body: body as never, at, prev }));
      this.run(
        "INSERT INTO case_events(case_id,seq,kind,body,at,prev_hash,hash) VALUES(?,?,?,?,?,?,?)",
        caseId,
        seq,
        kind,
        JSON.stringify(body),
        at,
        prev,
        hash,
      );
      return { case_id: caseId, seq, kind, body, at, prev_hash: prev, hash };
    });
  }

  events(caseId: string, afterSeq = 0, limit = 10_000): CaseEvent[] {
    return this.all<Row>(
      "SELECT * FROM case_events WHERE case_id=? AND seq>? ORDER BY seq LIMIT ?",
      caseId,
      afterSeq,
      limit,
    ).map((r) => ({ ...r, body: parse(r.body) }) as unknown as CaseEvent);
  }

  /** Recompute the chain; returns the first broken seq, or null when intact. */
  verifyChain(caseId: string): number | null {
    let prev = GENESIS;
    for (const e of this.events(caseId)) {
      const h = sha256(
        canonicalize({ case_id: caseId, seq: e.seq, kind: e.kind, body: e.body as never, at: e.at, prev }),
      );
      if (e.prev_hash !== prev || e.hash !== h) return e.seq;
      prev = e.hash;
    }
    return null;
  }

  /** Fork a case at event `atSeq`: a new case whose log is a re-chained copy of events 1..atSeq. */
  forkCase(caseId: string, atSeq: number, title?: string): CaseRow {
    const src = this.getCase(caseId);
    if (!src) throw new AssayError("not_found", { case: caseId });
    return this.tx(() => {
      const fork = this.createCase({
        title: title ?? `${src.title} (fork @${atSeq})`,
        workspace: src.workspace,
        meta: src.meta,
      });
      this.run("UPDATE cases SET parent_case=?, forked_at=? WHERE id=?", caseId, atSeq, fork.id);
      for (const e of this.events(caseId).filter((x) => x.seq <= atSeq)) this.appendEvent(fork.id, e.kind, e.body);
      this.run(
        "INSERT OR IGNORE INTO case_evidence(case_id,observation_id,delivered,at) SELECT ?,observation_id,delivered,at FROM case_evidence WHERE case_id=? AND (event_seq IS NULL OR event_seq<=?)",
        fork.id,
        caseId,
        atSeq,
      );
      this.run(
        "INSERT INTO unknowns(id,rev,case_id,body,prev_hash,hash,at) SELECT id,rev,?,body,prev_hash,hash,at FROM unknowns WHERE case_id=? AND (event_seq IS NULL OR event_seq<=?)",
        fork.id,
        caseId,
        atSeq,
      );
      return this.getCase(fork.id)!;
    });
  }

  // ---------- tasks, attempts, leases ----------

  spawnTask(input: {
    queue: string;
    kind: string;
    params?: unknown;
    caseId?: string | null;
    parentId?: string | null;
    idempotencyKey?: string | null;
    maxAttempts?: number;
    availableAt?: number;
  }): { task: TaskRow; created: boolean } {
    return this.tx(() => {
      if (input.idempotencyKey) {
        const existing = this.get<Row>("SELECT id FROM tasks WHERE idem_key=?", input.idempotencyKey);
        if (existing) return { task: this.getTask(existing.id as string)!, created: false };
      }
      const now = this.now();
      const id = newId("task", now);
      this.run(
        "INSERT INTO tasks(id,queue,kind,params,state,case_id,parent_id,idem_key,attempts,crash_count,max_attempts,available_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,0,0,?,?,?,?)",
        id,
        input.queue,
        input.kind,
        JSON.stringify(input.params ?? null),
        "pending",
        input.caseId ?? null,
        input.parentId ?? null,
        input.idempotencyKey ?? null,
        input.maxAttempts ?? 3,
        input.availableAt ?? now,
        now,
        now,
      );
      return { task: this.getTask(id)!, created: true };
    });
  }

  getTask(id: string): TaskRow | undefined {
    const r = this.get<Row>("SELECT * FROM tasks WHERE id=?", id);
    return r
      ? ({ ...r, params: parse(r.params), result: parse(r.result), error: parse(r.error) } as unknown as TaskRow)
      : undefined;
  }

  listTasks(filter: { queue?: string; caseId?: string; parentId?: string; state?: TaskState } = {}): TaskRow[] {
    const where: string[] = [];
    const args: unknown[] = [];
    const cols: [string, unknown][] = [
      ["queue", filter.queue],
      ["case_id", filter.caseId],
      ["parent_id", filter.parentId],
      ["state", filter.state],
    ];
    for (const [col, val] of cols) {
      if (val === undefined) continue;
      where.push(`${col}=?`);
      args.push(val);
    }
    const sql = `SELECT id FROM tasks ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at`;
    return this.all<{ id: string }>(sql, ...args).map((r) => this.getTask(r.id)!);
  }

  /**
   * Claim the next runnable task. A running task whose lease has expired counts as crashed:
   * its attempt is closed, its crash count rises, and after `maxCrashes` it is parked.
   */
  claimTask(queue: string, worker: string, leaseMs: number): Attempt | null {
    if (!(leaseMs > 0) || !Number.isFinite(leaseMs)) throw new AssayError("invalid_lease", { leaseMs });
    return this.tx(() => {
      const now = this.now();
      for (const r of this.all<Row>(
        "SELECT t.id FROM tasks t JOIN attempts a ON a.task_id=t.id AND a.n=t.attempts WHERE t.queue=? AND t.state='running' AND a.lease_until<=?",
        queue,
        now,
      )) {
        const id = r.id as string;
        this.run("UPDATE attempts SET state='expired', ended_at=? WHERE task_id=? AND state='running'", now, id);
        const t = this.getTask(id)!;
        const crashes = t.crash_count + 1;
        const parked = crashes >= this.maxCrashes;
        this.run(
          "UPDATE tasks SET state=?, crash_count=?, updated_at=? WHERE id=?",
          parked ? "parked" : "pending",
          crashes,
          now,
          id,
        );
      }
      const next = this.get<Row>(
        "SELECT id, attempts FROM tasks WHERE queue=? AND state='pending' AND available_at<=? ORDER BY available_at, created_at LIMIT 1",
        queue,
        now,
      );
      if (!next) return null;
      const n = Number(next.attempts) + 1;
      const id = newId("att", now);
      const leaseUntil = now + leaseMs;
      this.run(
        "INSERT INTO attempts(id,task_id,n,worker,lease_until,state,started_at) VALUES(?,?,?,?,?,'running',?)",
        id,
        next.id,
        n,
        worker,
        leaseUntil,
        now,
      );
      this.run("UPDATE tasks SET state='running', attempts=?, updated_at=? WHERE id=?", n, now, next.id);
      return { id, taskId: next.id as string, n, worker, leaseUntil };
    });
  }

  /** The fence: refuse any write from an attempt that is not current or whose lease has expired. */
  fence(att: Attempt): void {
    const r = this.get<Row>(
      "SELECT t.state AS tstate, t.attempts AS cur, a.state AS astate, a.lease_until AS lease FROM attempts a JOIN tasks t ON t.id=a.task_id WHERE a.id=?",
      att.id,
    );
    if (!r) throw new AssayError("stale_attempt", { attempt: att.id });
    if (Number(r.cur) !== att.n || r.astate !== "running" || r.tstate !== "running")
      throw new AssayError("stale_attempt", { attempt: att.id, task: att.taskId });
    if (Number(r.lease) <= this.now())
      throw new AssayError("lease_expired", { attempt: att.id, leaseUntil: Number(r.lease), now: this.now() });
  }

  extendLease(att: Attempt, leaseMs: number): Attempt {
    if (!(leaseMs > 0)) throw new AssayError("invalid_lease", { leaseMs });
    return this.tx(() => {
      this.fence(att);
      const leaseUntil = this.now() + leaseMs;
      this.run("UPDATE attempts SET lease_until=? WHERE id=?", leaseUntil, att.id);
      return { ...att, leaseUntil };
    });
  }

  /** First write wins: a checkpoint computed once is reused by every later attempt. */
  async checkpoint<T>(att: Attempt, name: string, compute: () => T | Promise<T>): Promise<T> {
    const prior = this.get<{ value: string }>(
      "SELECT value FROM checkpoints WHERE task_id=? AND name=?",
      att.taskId,
      name,
    );
    if (prior) return JSON.parse(prior.value) as T;
    const value = await compute();
    return this.tx(() => {
      this.fence(att);
      this.run(
        "INSERT INTO checkpoints(task_id,name,value,attempt_id,created_at) VALUES(?,?,?,?,?) ON CONFLICT(task_id,name) DO NOTHING",
        att.taskId,
        name,
        JSON.stringify(value ?? null),
        att.id,
        this.now(),
      );
      const stored = this.get<{ value: string }>(
        "SELECT value FROM checkpoints WHERE task_id=? AND name=?",
        att.taskId,
        name,
      )!;
      return JSON.parse(stored.value) as T;
    });
  }

  /** Run `body` inside the fence so its writes and the checkpoint land in one transaction. */
  commitStep<T>(att: Attempt, name: string, body: () => T): T {
    return this.tx(() => {
      this.fence(att);
      const prior = this.get<{ value: string }>(
        "SELECT value FROM checkpoints WHERE task_id=? AND name=?",
        att.taskId,
        name,
      );
      if (prior) return JSON.parse(prior.value) as T;
      const value = body();
      this.run(
        "INSERT INTO checkpoints(task_id,name,value,attempt_id,created_at) VALUES(?,?,?,?,?)",
        att.taskId,
        name,
        JSON.stringify(value ?? null),
        att.id,
        this.now(),
      );
      return value;
    });
  }

  completeTask(att: Attempt, result: unknown): void {
    this.tx(() => {
      this.fence(att);
      const now = this.now();
      this.run("UPDATE attempts SET state='completed', ended_at=? WHERE id=?", now, att.id);
      this.run(
        "UPDATE tasks SET state='completed', result=?, updated_at=? WHERE id=?",
        JSON.stringify(result ?? null),
        now,
        att.taskId,
      );
    });
  }

  failTask(att: Attempt, error: unknown, opts: { retryDelayMs?: number; final?: boolean } = {}): TaskState {
    return this.tx(() => {
      this.fence(att);
      const now = this.now();
      const t = this.getTask(att.taskId)!;
      const final = opts.final === true || t.attempts >= t.max_attempts;
      const err =
        error instanceof AssayError ? error.toJSON() : { message: String((error as Error)?.message ?? error) };
      this.run("UPDATE attempts SET state='failed', ended_at=? WHERE id=?", now, att.id);
      const state: TaskState = final ? "failed" : "pending";
      this.run(
        "UPDATE tasks SET state=?, error=?, available_at=?, updated_at=? WHERE id=?",
        state,
        JSON.stringify(err),
        now + (opts.retryDelayMs ?? 0),
        now,
        att.taskId,
      );
      return state;
    });
  }

  cancelTask(taskId: string): void {
    this.tx(() => {
      const now = this.now();
      this.run("UPDATE attempts SET state='cancelled', ended_at=? WHERE task_id=? AND state='running'", now, taskId);
      this.run(
        "UPDATE tasks SET state='cancelled', updated_at=? WHERE id=? AND state NOT IN ('completed','failed')",
        now,
        taskId,
      );
    });
  }

  unparkTask(taskId: string): void {
    this.run(
      "UPDATE tasks SET state='pending', crash_count=0, updated_at=? WHERE id=? AND state='parked'",
      this.now(),
      taskId,
    );
  }

  // ---------- effects: intent before effect ----------

  /**
   * Record intent, run the effect, record the outcome. After a crash between the two records,
   * the next attempt applies the replay policy: `safe` re-runs, `keyed` re-runs with the same
   * idempotency key (the target must dedupe), `unsafe` settles as interrupted and throws.
   */
  async runEffect<T>(
    att: Attempt,
    spec: { name: string; replay: ReplayPolicy; key?: string; args?: unknown },
    fn: (key: string) => Promise<T> | T,
  ): Promise<T> {
    const argsHash = sha256(canonicalize(spec.args ?? null));
    const key = spec.key ?? `fx_${sha256(`${att.taskId}\u0000${spec.name}\u0000${argsHash}`).slice(0, 32)}`;
    const decision = this.tx(
      (): { done: true; result: unknown } | { interrupted: true; key: string } | { run: true; key: string } => {
        this.fence(att);
        const prior = this.get<Row>("SELECT * FROM intents WHERE task_id=? AND name=?", att.taskId, spec.name);
        if (prior) {
          if (prior.state === "done") return { done: true as const, result: parse(prior.result) };
          if (prior.state === "interrupted")
            throw new AssayError("effect_interrupted", { name: spec.name, key: prior.key });
          if (prior.state === "pending" && prior.replay === "unsafe" && prior.attempt_id !== att.id) {
            this.run("UPDATE intents SET state='interrupted', settled_at=? WHERE id=?", this.now(), prior.id);
            return { interrupted: true as const, key: prior.key as string };
          }
          this.run("UPDATE intents SET state='pending', attempt_id=?, replays=replays+1 WHERE id=?", att.id, prior.id);
          return { run: true as const, key: prior.key as string };
        }
        this.run(
          "INSERT INTO intents(id,task_id,attempt_id,name,key,replay,args_hash,state,replays,created_at) VALUES(?,?,?,?,?,?,?,'pending',0,?)",
          newId("fx", this.now()),
          att.taskId,
          att.id,
          spec.name,
          key,
          spec.replay,
          argsHash,
          this.now(),
        );
        return { run: true as const, key };
      },
    );
    if ("done" in decision) return decision.result as T;
    if ("interrupted" in decision) throw new AssayError("effect_interrupted", { name: spec.name, key: decision.key });
    let result: T;
    try {
      result = await fn(decision.key);
    } catch (e) {
      this.tx(() => {
        this.fence(att);
        this.run(
          "UPDATE intents SET state='failed', result=?, settled_at=? WHERE task_id=? AND name=?",
          JSON.stringify({ error: String((e as Error)?.message ?? e) }),
          this.now(),
          att.taskId,
          spec.name,
        );
      });
      throw e;
    }
    this.tx(() => {
      this.fence(att);
      this.run(
        "UPDATE intents SET state='done', result=?, settled_at=? WHERE task_id=? AND name=?",
        JSON.stringify(result ?? null),
        this.now(),
        att.taskId,
        spec.name,
      );
    });
    return result;
  }

  intents(taskId: string): Row[] {
    return this.all("SELECT * FROM intents WHERE task_id=? ORDER BY created_at", taskId);
  }

  // ---------- receipts: idempotent replay of requests (Orca) ----------

  async withReceipt<T>(
    key: string,
    payload: unknown,
    fn: () => Promise<T> | T,
  ): Promise<{ result: T; replayed: boolean }> {
    const ph = sha256(canonicalize(payload ?? null));
    const prior = this.get<Row>("SELECT * FROM receipts WHERE key=?", key);
    if (prior) {
      if (prior.payload_hash !== ph) throw new AssayError("receipt_conflict", { key });
      return { result: parse(prior.result) as T, replayed: true };
    }
    const result = await fn();
    this.tx(() => {
      const again = this.get<Row>("SELECT payload_hash FROM receipts WHERE key=?", key);
      if (again && again.payload_hash !== ph) throw new AssayError("receipt_conflict", { key });
      this.run(
        "INSERT OR IGNORE INTO receipts(key,payload_hash,result,created_at) VALUES(?,?,?,?)",
        key,
        ph,
        JSON.stringify(result ?? null),
        this.now(),
      );
    });
    return {
      result: parse(this.get<Row>("SELECT result FROM receipts WHERE key=?", key)!.result) as T,
      replayed: false,
    };
  }

  // ---------- sequenced topics (fix for absurd's first-emit-wins event names) ----------

  publish(topic: string, dedupeKey: string, payload: unknown): { seq: number; created: boolean } {
    return this.tx(() => {
      const prior = this.get<{ seq: number }>(
        "SELECT seq FROM topics WHERE topic=? AND dedupe_key=?",
        topic,
        dedupeKey,
      );
      if (prior) return { seq: prior.seq, created: false };
      const last = this.get<{ s: number | null }>("SELECT MAX(seq) AS s FROM topics WHERE topic=?", topic);
      const seq = (last?.s ?? 0) + 1;
      this.run(
        "INSERT INTO topics(topic,seq,dedupe_key,payload,created_at) VALUES(?,?,?,?,?)",
        topic,
        seq,
        dedupeKey,
        JSON.stringify(payload ?? null),
        this.now(),
      );
      return { seq, created: true };
    });
  }

  readTopic(topic: string, afterSeq: number, limit = 100): { seq: number; payload: unknown }[] {
    return this.all<Row>(
      "SELECT seq, payload FROM topics WHERE topic=? AND seq>? ORDER BY seq LIMIT ?",
      topic,
      afterSeq,
      limit,
    ).map((r) => ({
      seq: Number(r.seq),
      payload: parse(r.payload),
    }));
  }

  // ---------- mailbox (coordinator loop) ----------

  send(msg: { to: string; from: string; kind: string; body: unknown; caseId?: string | null }): number {
    const r = this.run(
      "INSERT INTO mailbox(recipient,sender,kind,body,case_id,created_at) VALUES(?,?,?,?,?,?)",
      msg.to,
      msg.from,
      msg.kind,
      JSON.stringify(msg.body ?? null),
      msg.caseId ?? null,
      this.now(),
    );
    return Number(r.lastInsertRowid);
  }

  inbox(
    recipient: string,
    opts: { includeAcked?: boolean } = {},
  ): { id: number; from: string; kind: string; body: unknown; at: number }[] {
    return this.all<Row>(
      `SELECT * FROM mailbox WHERE recipient=? ${opts.includeAcked ? "" : "AND acked_at IS NULL"} ORDER BY id`,
      recipient,
    ).map((r) => ({
      id: Number(r.id),
      from: r.sender as string,
      kind: r.kind as string,
      body: parse(r.body),
      at: Number(r.created_at),
    }));
  }

  ack(recipient: string, ids: number[]): void {
    this.tx(() => {
      for (const id of ids)
        this.run("UPDATE mailbox SET acked_at=? WHERE id=? AND recipient=?", this.now(), id, recipient);
    });
  }

  // ---------- budgets and usage ----------

  setBudget(scope: string, limit: { usd?: number; tokens?: number; calls?: number }): void {
    this.run(
      "INSERT INTO budgets(scope,limit_json,spent_json) VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET limit_json=excluded.limit_json",
      scope,
      JSON.stringify(limit),
      JSON.stringify({ usd: 0, tokens: 0, calls: 0 }),
    );
  }

  budget(scope: string):
    | {
        limit: { usd?: number; tokens?: number; calls?: number };
        spent: { usd: number; tokens: number; calls: number };
      }
    | undefined {
    const r = this.get<Row>("SELECT * FROM budgets WHERE scope=?", scope);
    return r ? { limit: parse(r.limit_json) as never, spent: parse(r.spent_json) as never } : undefined;
  }

  /** Throws `budget_exceeded` before spending when the delta would cross a limit. */
  checkBudget(scope: string, delta: { usd?: number; tokens?: number; calls?: number }): void {
    const b = this.budget(scope);
    if (!b) return;
    for (const k of ["usd", "tokens", "calls"] as const) {
      const lim = b.limit[k];
      if (lim !== undefined && b.spent[k] + (delta[k] ?? 0) > lim)
        throw new AssayError("budget_exceeded", { scope, kind: k, limit: lim, spent: b.spent[k] });
    }
  }

  spend(scope: string, delta: { usd?: number; tokens?: number; calls?: number }): void {
    this.tx(() => {
      const b = this.budget(scope);
      if (!b) return;
      const spent = {
        usd: b.spent.usd + (delta.usd ?? 0),
        tokens: b.spent.tokens + (delta.tokens ?? 0),
        calls: b.spent.calls + (delta.calls ?? 0),
      };
      this.run("UPDATE budgets SET spent_json=? WHERE scope=?", JSON.stringify(spent), scope);
    });
  }

  recordUsage(u: {
    caseId?: string | null;
    accountId?: string | null;
    provider: string;
    model?: string | null;
    workerId?: string | null;
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number | null;
    resent?: boolean;
  }): void {
    this.run(
      "INSERT INTO usage(id,at,case_id,account_id,provider,model,worker_id,input_tokens,output_tokens,cost_usd,resent) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      newId("use", this.now()),
      this.now(),
      u.caseId ?? null,
      u.accountId ?? null,
      u.provider,
      u.model ?? null,
      u.workerId ?? null,
      u.inputTokens ?? 0,
      u.outputTokens ?? 0,
      u.costUsd ?? null,
      u.resent ? 1 : 0,
    );
  }

  usageSummary(by: "account_id" | "provider" | "case_id" | "worker_id" = "account_id"): Row[] {
    return this.all(
      `SELECT ${by} AS key, provider, COUNT(*) AS turns, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(COALESCE(cost_usd,0)) AS cost_usd, SUM(resent) AS resent FROM usage GROUP BY ${by}, provider ORDER BY cost_usd DESC`,
    );
  }
}
