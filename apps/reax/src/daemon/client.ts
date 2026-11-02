// The daemon's client, used by the CLI (`reax daemon ping|status|shutdown`) and by the stale-lock
// diagnosis. It finds the daemon through run/endpoint.json, reads the token from run/daemon.token at
// every call (never cached, never from an argument or the environment), refuses files another user
// could read or write, and connects only to a Unix socket, a named pipe or a loopback address.
import { connect, type Socket } from "node:net";
import { CoreError, type FailureCode } from "@re4exa/core/errors";
import { type Endpoint, readEndpoint } from "./paths.ts";
import { encode, FrameReader, type Method, PROTOCOL_VERSION, parseFrame } from "./protocol.ts";
import { readToken } from "./token.ts";

export const CALL_TIMEOUT_MS = 5000;
const MAX_FRAMES_PENDING = 16;

/** A connected socket that hands out the daemon's frames one at a time. */
class Conn {
  readonly #sock: Socket;
  readonly #reader = new FrameReader();
  #frames: Record<string, unknown>[] = [];
  #waiters: ((f: Record<string, unknown> | null) => void)[] = [];
  #closed = false;

  constructor(sock: Socket) {
    this.#sock = sock;
    sock.on("data", (chunk: Buffer) => {
      try {
        for (const line of this.#reader.push(chunk)) {
          const f = parseFrame(line);
          const w = this.#waiters.shift();
          if (w) w(f);
          else if (this.#frames.length < MAX_FRAMES_PENDING) this.#frames.push(f);
        }
      } catch {
        sock.destroy();
      }
    });
    sock.on("close", () => {
      this.#closed = true;
      for (const w of this.#waiters.splice(0)) w(null);
    });
    sock.on("error", () => {});
  }

  /** Send a frame and wait for the next one; null when the daemon closed the connection. */
  request(frame: unknown): Promise<Record<string, unknown> | null> {
    if (!this.#closed) this.#sock.write(encode(frame));
    const f = this.#frames.shift();
    if (f) return Promise.resolve(f);
    if (this.#closed) return Promise.resolve(null);
    return new Promise((r) => this.#waiters.push(r));
  }

  close(): void {
    this.#sock.destroy();
  }
}

/** Connect to an endpoint. Resolves the connection, or rejects with the socket error's code. */
export function open(ep: Endpoint, timeoutMs: number): Promise<Conn> {
  if (ep.transport === "tcp" && ep.host !== "127.0.0.1" && ep.host !== "::1")
    return Promise.reject(new CoreError("daemon_bind_refused", { host: ep.host }));
  return new Promise((resolve, reject) => {
    const sock = ep.transport === "tcp" ? connect({ host: ep.host, port: ep.port }) : connect(ep.path);
    const timer = setTimeout(() => {
      sock.destroy();
      reject(Object.assign(new Error("connect timed out"), { code: "ETIMEDOUT" }));
    }, timeoutMs);
    sock.once("connect", () => {
      clearTimeout(timer);
      resolve(new Conn(sock));
    });
    sock.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

/** The connection was refused outright: nothing listens at the endpoint. */
export const refused = (e: unknown) => {
  const code = (e as NodeJS.ErrnoException).code;
  return code === "ECONNREFUSED" || code === "ENOENT";
};

function withDeadline<T>(p: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(Object.assign(new Error("the daemon did not answer in time"), { code: "ETIMEDOUT" }));
    }, ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

function failure(frame: Record<string, unknown> | null, fallback: FailureCode): CoreError {
  const err = (frame?.error ?? null) as { code?: string } | null;
  const code = typeof err?.code === "string" ? err.code : fallback;
  try {
    return new CoreError(code as FailureCode);
  } catch {
    return new CoreError(fallback);
  }
}

/** Hello on an open connection; returns the daemon's instance id. */
async function hello(conn: Conn, token: string): Promise<string> {
  const r = await conn.request({ type: "hello", protocol: PROTOCOL_VERSION, token });
  if (r?.type !== "hello" || r.ok !== true || typeof r.instance !== "string") throw failure(r, "daemon_unauthorized");
  return r.instance;
}

/** Call one method on the daemon of this home, and return its result. */
export async function daemonCall(home: string, method: Method, timeoutMs = CALL_TIMEOUT_MS): Promise<unknown> {
  let token: string;
  try {
    token = readToken(home);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new CoreError("daemon_not_running", { home });
    throw e;
  }
  const ep = readEndpoint(home);
  if (!ep) throw new CoreError("daemon_not_running", { home });
  let conn: Conn;
  try {
    conn = await open(ep, timeoutMs);
  } catch (e) {
    if (refused(e)) throw new CoreError("daemon_not_running", { home });
    throw e;
  }
  try {
    return await withDeadline(
      (async () => {
        await hello(conn, token);
        const r = await conn.request({ id: 1, method });
        if (r?.id !== 1 || r.ok !== true) {
          // the connection closing on shutdown before the reply arrives still means it stopped
          if (r === null && method === "shutdown") return { stopping: true };
          throw failure(r, "daemon_not_running");
        }
        return r.result;
      })(),
      timeoutMs,
      () => conn.close(),
    );
  } finally {
    conn.close();
  }
}

/** What answers at an endpoint, for the stale-lock diagnosis: nothing (refused outright), no answer
 * in time, or a daemon (with its instance when the token authenticated). */
export async function probe(
  ep: Endpoint,
  token: string | null,
  timeoutMs: number,
): Promise<{ kind: "refused" } | { kind: "timeout" } | { kind: "answered"; instance: string | null }> {
  let conn: Conn;
  try {
    conn = await open(ep, timeoutMs);
  } catch (e) {
    if (refused(e)) return { kind: "refused" };
    return { kind: "timeout" };
  }
  try {
    if (token === null) return { kind: "answered", instance: null };
    const instance = await withDeadline(hello(conn, token), timeoutMs, () => conn.close());
    return { kind: "answered", instance };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ETIMEDOUT") return { kind: "timeout" };
    return { kind: "answered", instance: null };
  } finally {
    conn.close();
  }
}
