// The single write path (ADR 0005). Only the owner process writes; worker threads and other
// readers send typed write operations here over a MessagePort. The batcher commits queued requests
// in bounded batches (at most `maxRows` operations, or after `maxMs`), each request in its own
// savepoint, so one bad request is rejected without losing the others. A request's promise
// resolves only after the transaction holding it has committed: nothing is reported as stored
// before it is (pi-durable's main branch weakened this).

import type { MessagePort } from "node:worker_threads";
import { CoreError, isCoreError } from "../errors.ts";
import type { Kernel } from "./kernel.ts";

export interface WriteOp {
  op: string;
  args?: unknown;
}
export type WriteHandler = (k: Kernel, args: unknown) => unknown;

export interface WriterOptions {
  /** Most operations committed in one transaction. Default 256. */
  maxRows?: number;
  /** Longest a request waits for its batch to fill, in ms. Default 5. */
  maxMs?: number;
}

interface Pending {
  ops: WriteOp[];
  resolve: (results: unknown[]) => void;
  reject: (e: unknown) => void;
}

export interface WriterStats {
  batches: number;
  committed: number;
  rejected: number;
  largestBatch: number;
}

export class WriteBatcher {
  readonly stats: WriterStats = { batches: 0, committed: 0, rejected: 0, largestBatch: 0 };
  readonly #k: Kernel;
  readonly #handlers: Record<string, WriteHandler>;
  readonly #maxRows: number;
  readonly #maxMs: number;
  #queue: Pending[] = [];
  #queuedRows = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #closed = false;

  constructor(kernel: Kernel, handlers: Record<string, WriteHandler>, opts: WriterOptions = {}) {
    if (kernel.mode !== "owner") throw new CoreError("store_read_only", { path: kernel.path });
    this.#k = kernel;
    this.#handlers = handlers;
    this.#maxRows = opts.maxRows ?? 256;
    this.#maxMs = opts.maxMs ?? 5;
  }

  submit(ops: WriteOp[]): Promise<unknown[]> {
    if (this.#closed)
      return Promise.reject(new CoreError("store_read_only", { path: this.#k.path, reason: "writer closed" }));
    const unknown = ops.find((o) => !Object.hasOwn(this.#handlers, o.op));
    if (unknown) return Promise.reject(new CoreError("write_op_unknown", { op: unknown.op }));
    return new Promise((resolve, reject) => {
      this.#queue.push({ ops, resolve, reject });
      this.#queuedRows += ops.length;
      if (this.#queuedRows >= this.#maxRows) this.#schedule(0);
      else this.#schedule(this.#maxMs);
    });
  }

  #schedule(ms: number): void {
    if (this.#timer && ms > 0) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.flush();
    }, ms);
  }

  /** Commit one batch now. Further queued requests are scheduled after yielding to the event loop. */
  flush(): void {
    if (!this.#queue.length) return;
    const batch: Pending[] = [];
    let rows = 0;
    while (this.#queue.length && (batch.length === 0 || rows + this.#queue[0]!.ops.length <= this.#maxRows)) {
      const p = this.#queue.shift()!;
      batch.push(p);
      rows += p.ops.length;
    }
    this.#queuedRows -= rows;
    const outcomes: ({ ok: true; results: unknown[] } | { ok: false; error: unknown })[] = [];
    try {
      this.#k.tx(() => {
        for (const p of batch) {
          try {
            outcomes.push({
              ok: true,
              results: this.#k.tx(() => p.ops.map((o) => this.#handlers[o.op]!(this.#k, o.args))),
            });
          } catch (error) {
            outcomes.push({ ok: false, error });
          }
        }
      });
    } catch (error) {
      for (const p of batch) p.reject(error);
      this.stats.rejected += batch.length;
      this.#next();
      return;
    }
    this.stats.batches++;
    this.stats.largestBatch = Math.max(this.stats.largestBatch, rows);
    batch.forEach((p, i) => {
      const o = outcomes[i]!;
      if (o.ok) {
        this.stats.committed++;
        p.resolve(o.results);
      } else {
        this.stats.rejected++;
        p.reject(o.error);
      }
    });
    this.#next();
  }

  #next(): void {
    if (this.#queue.length) setImmediate(() => this.flush());
  }

  /** Serve write requests arriving on a port (from a worker thread's `writerClient`). */
  attach(port: MessagePort): void {
    port.on("message", (m: { id: number; ops: WriteOp[] }) => {
      this.submit(m.ops).then(
        (results) => port.postMessage({ id: m.id, ok: true, results }),
        (e) => port.postMessage({ id: m.id, ok: false, error: toWire(e) }),
      );
    });
  }

  /** Commit everything still queued, then refuse new requests. */
  close(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    while (this.#queue.length) this.flush();
    this.#closed = true;
  }
}

function toWire(e: unknown): { code: string | null; detail: unknown; message: string } {
  if (isCoreError(e)) return { code: e.code, detail: e.detail, message: e.message };
  return { code: null, detail: null, message: String((e as Error)?.message ?? e) };
}

/** The worker-thread side: send write operations to the owner and wait for them to commit. */
export function writerClient(port: MessagePort): { submit(ops: WriteOp[]): Promise<unknown[]>; close(): void } {
  let next = 0;
  const waiting = new Map<number, Pending>();
  port.on("message", (m: { id: number; ok: boolean; results?: unknown[]; error?: ReturnType<typeof toWire> }) => {
    const p = waiting.get(m.id);
    if (!p) return;
    waiting.delete(m.id);
    if (m.ok) p.resolve(m.results ?? []);
    else
      p.reject(
        m.error?.code
          ? new CoreError(m.error.code as never, m.error.detail as never, m.error.message)
          : new Error(m.error?.message),
      );
  });
  return {
    submit(ops) {
      const id = ++next;
      return new Promise((resolve, reject) => {
        waiting.set(id, { ops, resolve, reject });
        port.postMessage({ id, ops });
      });
    },
    close() {
      port.close();
    },
  };
}
