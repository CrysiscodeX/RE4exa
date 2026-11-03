// The reax daemon: one per reax home, reachable only through a Unix socket (a named pipe on
// Windows) or, by opt-in, a loopback TCP port, and only with the token from its owner-only token
// file. It answers ping, status and shutdown (ADR 0007), and runs registered operations as jobs
// through the scheduler (ADR 0008; src/daemon/jobs.ts). MCP and sessions come in later slices.
//
// Start order: bind validation (before any file or socket), home safety, run/, the OS lock, the
// stale-lock diagnosis and recovery, daemon.lock (O_EXCL), clearing the socket path, the token
// (O_EXCL), listen, the post-listen address check, endpoint.json. Shutdown order: endpoint.json
// first (clients stop connecting), the server, the socket, the token, daemon.lock, then the OS
// lock; each file only while daemon.lock still names this instance. Before the files: no new
// connections, then the scheduler's close (every job cancelled with reason shutdown, the running
// ones drained for up to shutdownDrainMs).
import { randomUUID } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { CoreError, isCoreError } from "@re4exa/core/errors";
import "../errors.ts";
import { REAX_VERSION } from "../ops/probes.ts";
import { Scheduler, type SchedulerOptions } from "../sched/scheduler.ts";
import { jobCall, jobError } from "./jobs.ts";
import {
  clearSocket,
  createLock,
  DAEMON_HOOKS,
  diagnose,
  ownsLock,
  type Recovered,
  removeOrphans,
  removeStale,
  takeOsLock,
  unlinkQuiet,
} from "./lock.ts";
import { checkHome, type Endpoint, files, localEndpoint, makeRunDir, readEndpoint, writeEndpoint } from "./paths.ts";
import {
  encode,
  errorBody,
  FrameReader,
  HELLO_TIMEOUT_MS,
  JOB_METHODS,
  type JobMethod,
  MAX_CONNECTIONS,
  METHODS,
  type Method,
  PROTOCOL_VERSION,
  parseFrame,
} from "./protocol.ts";
import { newToken, tokenMatches, writeToken } from "./token.ts";

/** The longest a refused connection may stay open, whatever its peer does. */
export const DROP_AFTER_MS = 1000;
/** Every open socket, counted or draining after a refusal. */
export const MAX_SOCKETS = 2 * MAX_CONNECTIONS;
/** Reply bytes a connection may leave unread before it is disconnected. */
export const MAX_BUFFERED = 1024 * 1024;
/** How long a connection's replies may stay backed up before it is disconnected. */
export const STALL_MS = 5000;
/** Requests read but not yet handled, per connection, in UTF-16 code units (line.length): 256 Ki characters. */
export const PENDING_BYTES = 256 * 1024;
/** Per-connection log lines: at most LOG_PER_WINDOW in each LOG_WINDOW_MS. */
export const LOG_PER_WINDOW = 20;
export const LOG_WINDOW_MS = 10_000;

/** The only addresses --tcp may bind. */
export const LOOPBACK: readonly string[] = ["127.0.0.1", "::1"];

export interface DaemonOptions {
  home: string;
  /** "local": a Unix socket, or a named pipe on Windows (the default). "tcp": loopback only. */
  transport?: "local" | "tcp";
  host?: string;
  port?: number;
  /** One line per event (start, stop, refusals); never the token. */
  log?: (line: string) => void;
  /** In process only (tests): the scheduler's limits, clock, hooks and operation resolver. `reax
   * serve` never passes it, so only registered operations run there. */
  sched?: Omit<SchedulerOptions, "home" | "log">;
}

export interface DaemonHandle {
  pid: number;
  instance: string;
  startedAt: string;
  endpoint: Endpoint;
  recovered: Recovered;
  /** Settles once shutdown (by a client, a signal or close()) has removed the daemon's files. */
  closed: Promise<void>;
  close(): Promise<void>;
}

/** --tcp's host and port: exactly 127.0.0.1 or ::1, and a port in 0..65535; else daemon_bind_refused. */
export function validateBind(host: unknown, port: unknown): { host: "127.0.0.1" | "::1"; port: number } {
  if (typeof host !== "string" || !LOOPBACK.includes(host))
    throw new CoreError("daemon_bind_refused", { host: typeof host === "string" ? host : null });
  if (typeof port !== "number" || !Number.isInteger(port) || port < 0 || port > 65535)
    throw new CoreError("daemon_bind_refused", { host, port: String(port) });
  return { host: host as "127.0.0.1" | "::1", port };
}

function listen(server: Server, ep: Endpoint): Promise<void> {
  return new Promise((ok, fail) => {
    server.once("error", fail);
    const done = () => {
      server.off("error", fail);
      ok();
    };
    if (ep.transport === "tcp") server.listen({ host: ep.host, port: ep.port, exclusive: true }, done);
    else server.listen({ path: ep.path, exclusive: true }, done);
  });
}

export async function startDaemon(opts: DaemonOptions): Promise<DaemonHandle> {
  const log = opts.log ?? (() => {});
  const bind = opts.transport === "tcp" ? validateBind(opts.host ?? "127.0.0.1", opts.port ?? 0) : null;
  const home = resolve(opts.home);
  checkHome(home);
  makeRunDir(home);
  const f = files(home);
  const osLock: DatabaseSync | null = DAEMON_HOOKS.osLock ? takeOsLock(home) : null;
  const instance = randomUUID();
  const startedAt = new Date();
  let server: Server | null = null;
  let created = false;
  try {
    const d = await diagnose(home);
    await DAEMON_HOOKS.afterDiagnose?.();
    removeStale(home, d);
    if (osLock) removeOrphans(home);
    let endpoint: Endpoint = bind ? { transport: "tcp", ...bind } : localEndpoint(home);
    createLock(home, { pid: process.pid, instance, startedAt: startedAt.toISOString(), protocol: PROTOCOL_VERSION });
    created = true;
    // only the owner of daemon.lock may clear the socket path, so a losing start never unlinks a winner's
    if (endpoint.transport === "unix") clearSocket(endpoint.path);
    const token = newToken();
    writeToken(f.token, token);
    const daemon = serve(token);
    server = daemon.server;
    await listen(server, endpoint);
    if (endpoint.transport === "tcp") {
      const a = server.address();
      if (typeof a !== "object" || a === null || !LOOPBACK.includes(a.address))
        throw new CoreError("daemon_bind_refused", { host: typeof a === "object" && a ? a.address : String(a) });
      endpoint = { transport: "tcp", host: a.address as "127.0.0.1" | "::1", port: a.port };
    }
    daemon.ready(endpoint, d.recovered);
    writeEndpoint(home, { ...endpoint, pid: process.pid, instance, protocol: PROTOCOL_VERSION });
    log(
      `reax daemon: started pid ${process.pid} instance ${instance} on ${endpoint.transport}` +
        `${d.recovered ? `; recovered a stale lock (${d.recovered.reason}, pid ${d.recovered.pid})` : ""}`,
    );
    return daemon.handle;
  } catch (e) {
    server?.close();
    if (created && ownsLock(home, instance)) {
      unlinkQuiet(f.token);
      unlinkQuiet(f.lock);
    }
    osLock?.close();
    throw e;
  }

  function serve(token: string) {
    /** Connections that count toward MAX_CONNECTIONS (refused ones, and peers whose end of stream was read, leave at once). */
    const conns = new Set<Socket>();
    /** Every open socket, so shutdown can destroy refused ones that are still draining. */
    const all = new Set<Socket>();
    let stopping: Promise<void> | null = null;
    let endpoint: Endpoint | null = null;
    let recovered: Recovered = null;
    let settle: () => void = () => {};
    const sched = new Scheduler({ ...opts.sched, home, log });
    let connSeq = 0;
    const closed = new Promise<void>((r) => {
      settle = r;
    });

    const status = () => ({
      protocol: PROTOCOL_VERSION,
      version: REAX_VERSION,
      pid: process.pid,
      instance,
      startedAt: startedAt.toISOString(),
      uptimeMs: Date.now() - startedAt.getTime(),
      home,
      endpoint,
      connections: conns.size,
      recovered,
      jobs: sched.counts(),
    });

    const close = (): Promise<void> => {
      // each step is attempted even if one before it failed (a file held open on Windows), so the
      // daemon always exits; whatever is left is a stale lock for the next start to recover
      const remove = (path: string) => {
        try {
          unlinkQuiet(path);
        } catch (e) {
          log(`reax daemon: could not remove ${path}: ${(e as NodeJS.ErrnoException).code ?? "error"}`);
        }
      };
      stopping ??= (async () => {
        log(`reax daemon: stopping instance ${instance}`);
        if (readEndpoint(home)?.instance === instance) remove(f.endpoint);
        // no new connections; the scheduler cancels and drains every job before the sockets go, so
        // the jobs end with reason shutdown, not disconnect
        const serverClosed = new Promise<void>((r) => srv.close(() => r()));
        try {
          await sched.close();
        } catch (e) {
          log(`reax daemon: the scheduler did not close cleanly: ${(e as Error).message}`);
        }
        for (const s of all) s.destroy();
        await serverClosed;
        if (ownsLock(home, instance)) {
          if (endpoint?.transport === "unix") remove(endpoint.path);
          remove(f.token);
          remove(f.lock);
        }
        try {
          osLock?.close();
        } catch {
          // released by the OS at exit in any case
        }
        settle();
      })();
      return stopping;
    };

    const handle = (frame: Record<string, unknown>, conn: string): unknown => {
      const id = typeof frame.id === "number" && Number.isInteger(frame.id) ? frame.id : null;
      const method = frame.method;
      if (id === null || typeof method !== "string" || !(METHODS as readonly string[]).includes(method))
        return {
          id,
          ok: false,
          error: errorBody(new CoreError("bad_request", { method: String(method).slice(0, 64) })),
        };
      if ((JOB_METHODS as readonly string[]).includes(method)) {
        const fail = (e: unknown) => ({ id, ok: false, error: jobError(e) });
        try {
          const r = jobCall(sched, conn, method as JobMethod, frame);
          if (r instanceof Promise) return r.then((result) => ({ id, ok: true, result }), fail);
          return { id, ok: true, result: r };
        } catch (e) {
          return fail(e);
        }
      }
      switch (method as Exclude<Method, JobMethod>) {
        case "ping":
          return { id, ok: true, result: { pong: true, instance } };
        case "status":
          return { id, ok: true, result: status() };
        case "shutdown":
          return { id, ok: true, result: { stopping: true } };
      }
    };

    // Per-connection log lines are rate-limited, so a flood of refused connections cannot grow
    // the log (logs/daemon.log for a detached daemon) without bound.
    let logWindow = 0;
    let logged = 0;
    let suppressed = 0;
    const connLog = (line: string) => {
      const now = Date.now();
      if (now - logWindow >= LOG_WINDOW_MS) {
        if (suppressed) log(`reax daemon: ${suppressed} connection messages suppressed`);
        logWindow = now;
        logged = 0;
        suppressed = 0;
      }
      if (logged++ < LOG_PER_WINDOW) log(line);
      else suppressed++;
    };

    const srv = createServer((sock) => {
      // a hard cap on every open socket (refused ones still draining included), and no frame while
      // stopping
      if (stopping || all.size >= MAX_SOCKETS) {
        sock.destroy();
        return;
      }
      all.add(sock);
      DAEMON_HOOKS.onAccept?.(sock);
      // at the connection cap: one retryable daemon_busy hello frame before the peer sends anything,
      // then the socket ends; it is destroyed once flushed, or after DROP_AFTER_MS
      if (conns.size >= MAX_CONNECTIONS) {
        connLog("reax daemon: refused a connection [daemon_busy]");
        sock.on("error", () => {});
        sock.on("close", () => all.delete(sock));
        setTimeout(() => sock.destroy(), DROP_AFTER_MS).unref();
        sock.end(encode({ type: "hello", ok: false, error: errorBody(new CoreError("daemon_busy")) }), () =>
          sock.destroy(),
        );
        return;
      }
      conns.add(sock);
      const conn = `conn-${++connSeq}`;
      const reader = new FrameReader();
      let state: "hello" | "ready" | "closed" = "hello";
      /** Frames read but not yet handled (while replies are backed up); bounded by PENDING_BYTES (characters). */
      const pending: string[] = [];
      let pendingBytes = 0;
      let backedUp = false;
      let stall: NodeJS.Timeout | undefined;
      const drop = (why: string) => {
        connLog(`reax daemon: closed a connection: ${why}`);
        state = "closed";
        sock.destroy();
      };
      const timer = setTimeout(() => drop("no hello in time"), HELLO_TIMEOUT_MS);
      sock.on("error", () => {});
      // A peer that has closed stops counting toward MAX_CONNECTIONS as soon as its end of stream is
      // read: Node emits "close" only after the socket's own shutdown and handle close, at least one
      // event-loop turn later, and a new connection accepted in between would be refused as busy.
      // Until "close" it still counts toward MAX_SOCKETS, and it is destroyed after DROP_AFTER_MS
      // whatever the peer does, as a refused one is: a peer that half-closes without reading would
      // otherwise hold the socket for ever (its last replies never flush, so "close" never comes).
      // Its jobs are cancelled at that close (D-27), so at most DROP_AFTER_MS later than its end.
      sock.on("end", () => {
        conns.delete(sock);
        setTimeout(() => sock.destroy(), DROP_AFTER_MS).unref();
      });
      const cleanup = () => {
        conns.delete(sock);
        all.delete(sock);
        clearTimeout(timer);
        clearTimeout(stall);
        pending.length = 0;
        // the jobs this connection submitted are cancelled; jobs it only waited on are not
        sched.dropOwner(conn);
      };
      sock.on("close", () => (DAEMON_HOOKS.onConnClose ? DAEMON_HOOKS.onConnClose(cleanup) : cleanup()));
      // A refused connection stops counting toward MAX_CONNECTIONS at once, and is destroyed as soon
      // as its error frame is flushed, or after DROP_AFTER_MS whatever the peer does: a peer that
      // never reads or closes cannot hold a slot (a half-closed socket would otherwise stay open).
      const refuse = (e: unknown, hello: boolean) => {
        const err = isCoreError(e) ? e : new CoreError("bad_request");
        connLog(`reax daemon: refused a connection [${err.code}]`);
        state = "closed";
        clearTimeout(timer);
        conns.delete(sock);
        pending.length = 0;
        setTimeout(() => sock.destroy(), DROP_AFTER_MS).unref();
        sock.end(
          encode(
            hello
              ? { type: "hello", ok: false, error: errorBody(err) }
              : { id: null, ok: false, error: errorBody(err) },
          ),
          () => sock.destroy(),
        );
      };
      // Backpressure: when the peer is not reading, stop reading its requests until the replies
      // drain; a peer that stays backed up past STALL_MS, or lets more than MAX_BUFFERED bytes
      // queue, is disconnected.
      const send = (frame: unknown, cb?: () => void) => {
        const ok = sock.write(encode(frame), cb);
        if (sock.writableLength > MAX_BUFFERED) {
          drop("too many unread replies");
          return;
        }
        if (!ok && !backedUp) {
          backedUp = true;
          sock.pause();
          stall = setTimeout(() => drop("did not read its replies in time"), STALL_MS);
        }
      };
      sock.on("drain", () => {
        if (!backedUp) return;
        backedUp = false;
        clearTimeout(stall);
        pump();
        if (!backedUp && state !== "closed") sock.resume();
      });
      const step = (line: string): void => {
        let frame: Record<string, unknown>;
        try {
          frame = parseFrame(line);
        } catch (e) {
          refuse(e, state === "hello");
          return;
        }
        if (state === "hello") {
          if (frame.type !== "hello" || !tokenMatches(frame.token, token)) {
            refuse(new CoreError("daemon_unauthorized"), true);
            return;
          }
          if (frame.protocol !== PROTOCOL_VERSION) {
            refuse(new CoreError("daemon_protocol_mismatch", { supported: PROTOCOL_VERSION }), true);
            return;
          }
          state = "ready";
          clearTimeout(timer);
          connLog("reax daemon: hello accepted");
          send({ type: "hello", ok: true, protocol: PROTOCOL_VERSION, instance });
          return;
        }
        const reply = handle(frame, conn);
        if (reply instanceof Promise) {
          // job.wait: answered when it resolves, possibly after later requests' replies
          void reply.then((r) => {
            if (state !== "closed" && !sock.destroyed) send(r);
          });
          return;
        }
        if (frame.method === "shutdown" && (reply as { ok: boolean }).ok) {
          state = "closed";
          pending.length = 0;
          // stop even if this peer never reads the reply
          setTimeout(() => void close(), DROP_AFTER_MS).unref();
          send(reply, () => void close());
          return;
        }
        send(reply);
      };
      const pump = () => {
        while (pending.length && !backedUp && state !== "closed") {
          const line = pending.shift()!;
          pendingBytes -= line.length;
          step(line);
        }
      };
      sock.on("data", (chunk: Buffer) => {
        if (state === "closed") return;
        let lines: string[];
        try {
          lines = reader.push(chunk);
        } catch (e) {
          refuse(e, state === "hello");
          return;
        }
        for (const line of lines) {
          pending.push(line);
          pendingBytes += line.length;
        }
        if (pendingBytes > PENDING_BYTES) {
          drop("too many unhandled requests");
          return;
        }
        pump();
      });
    });
    srv.on("error", (e: NodeJS.ErrnoException) => log(`reax daemon: server error ${e.code ?? e.message}`));

    const out: DaemonHandle = {
      pid: process.pid,
      instance,
      startedAt: startedAt.toISOString(),
      endpoint: { transport: "tcp", host: "127.0.0.1", port: 0 },
      recovered: null,
      closed,
      close,
    };
    return {
      server: srv,
      handle: out,
      ready(ep: Endpoint, rec: Recovered) {
        endpoint = ep;
        recovered = rec;
        out.endpoint = ep;
        out.recovered = rec;
      },
    };
  }
}
