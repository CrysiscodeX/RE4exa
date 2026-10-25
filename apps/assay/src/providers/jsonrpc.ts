// Newline-delimited JSON-RPC 2.0 over a child's stdio, as `codex app-server` speaks it: one JSON
// object per line, requests in both directions (the server asks the client for approvals).

import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { AssayError } from "../errors.ts";
import { spawnProcess } from "../vendor/orca-process-host/run-process.ts";

export interface RpcMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class RpcError extends Error {
  readonly code: number;
  readonly data: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
  }
}

export interface RpcPeerOptions {
  program: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  onNotification(method: string, params: unknown): void;
  /** Answer a server-initiated request; throw RpcError to reply with an error. */
  onRequest(method: string, params: unknown): Promise<unknown>;
  onExit?(code: number | null, signal: string | null, stderrTail: string): void;
  /** Spawner (tests may replace it). */
  spawn?: (spec: {
    program: string;
    args: string[];
    env: Record<string, string>;
    cwd?: string;
  }) => ChildProcessWithoutNullStreams;
}

export class RpcPeer {
  readonly child: ChildProcessWithoutNullStreams;
  #next = 1;
  #pending = new Map<number | string, { resolve(v: unknown): void; reject(e: unknown): void; method: string }>();
  #stderr = "";
  #exited = false;
  #opts: RpcPeerOptions;
  readonly exited: Promise<void>;

  constructor(opts: RpcPeerOptions) {
    this.#opts = opts;
    const spawn =
      opts.spawn ??
      ((s: { program: string; args: string[]; env: Record<string, string>; cwd?: string }) =>
        spawnProcess({ program: s.program, args: s.args, env: s.env, cwd: s.cwd, stdio: "pipe" }));
    this.child = spawn({ program: opts.program, args: opts.args, env: opts.env, cwd: opts.cwd });
    for (const s of [this.child.stdin, this.child.stdout, this.child.stderr]) s.on("error", () => {});
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (d: string) => {
      this.#stderr = (this.#stderr + d).slice(-4000);
    });
    const rl = createInterface({ input: this.child.stdout });
    rl.on("line", (line) => this.#line(line));
    this.exited = new Promise((resolve) => {
      const done = (code: number | null, signal: NodeJS.Signals | null): void => {
        if (this.#exited) return;
        this.#exited = true;
        const err = new AssayError(
          "provider_error",
          { program: opts.program, code, signal, stderr: this.#stderr.slice(-500) },
          `The client process exited (${signal ?? code})`,
        );
        for (const p of this.#pending.values()) p.reject(err);
        this.#pending.clear();
        opts.onExit?.(code, signal, this.#stderr);
        resolve();
      };
      this.child.on("exit", done);
      this.child.on("error", (e) => {
        this.#stderr += `\n${(e as Error).message}`;
        done(null, null);
      });
    });
  }

  get stderrTail(): string {
    return this.#stderr;
  }

  #write(m: RpcMessage): void {
    if (this.#exited) return;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
  }

  #line(line: string): void {
    const t = line.trim();
    if (!t) return;
    let m: RpcMessage;
    try {
      m = JSON.parse(t) as RpcMessage;
    } catch {
      return; // not protocol output (a log line); ignore
    }
    if (m.method !== undefined && m.id !== undefined) {
      const id = m.id;
      this.#opts.onRequest(m.method, m.params).then(
        (result) => this.#write({ id, result: result ?? null }),
        (e: unknown) => {
          const code = e instanceof RpcError ? e.code : -32603;
          this.#write({ id, error: { code, message: (e as Error).message ?? String(e) } });
        },
      );
    } else if (m.method !== undefined) {
      this.#opts.onNotification(m.method, m.params);
    } else if (m.id !== undefined) {
      const p = this.#pending.get(m.id);
      if (!p) return;
      this.#pending.delete(m.id);
      if (m.error) p.reject(new RpcError(m.error.code, m.error.message, m.error.data));
      else p.resolve(m.result);
    }
  }

  request<T = unknown>(method: string, params?: unknown, timeoutMs = 120_000): Promise<T> {
    if (this.#exited)
      return Promise.reject(
        new AssayError("provider_error", { method, stderr: this.#stderr.slice(-500) }, "The client process has exited"),
      );
    const id = this.#next++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new AssayError("provider_error", { method }, `No reply to ${method} within ${timeoutMs} ms`));
      }, timeoutMs);
      timer.unref?.();
      this.#pending.set(id, {
        method,
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.#write(params === undefined ? { id, method } : { id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.#write(params === undefined ? { method } : { method, params });
  }

  async close(graceMs = 2000): Promise<void> {
    if (this.#exited) return;
    this.child.stdin.end();
    const t = setTimeout(() => this.child.kill("SIGTERM"), graceMs);
    const t2 = setTimeout(() => this.child.kill("SIGKILL"), graceMs * 2);
    await this.exited;
    clearTimeout(t);
    clearTimeout(t2);
  }
}
