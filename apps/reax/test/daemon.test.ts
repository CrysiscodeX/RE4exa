// DMN, the daemon (first slice): lifecycle, authentication, the token file and loopback-only TCP.
// The single-instance and stale-lock tests are in daemon-lock.test.ts. Oracles are independent of
// the code under test: a raw wire client written for the tests (fixtures/daemon-wire.ts), the
// system's stat and id for permissions, the OS listener table for bind addresses, and the test's
// own ChildProcess handles for process facts. Every home is temporary; every child is stopped
// through its own handle, and the after hook checks each recorded pid is gone.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { isCoreError } from "@re4exa/core/errors";
import { DAEMON_HOOKS } from "../src/daemon/lock.ts";
import { type DaemonHandle, startDaemon } from "../src/daemon/server.ts";
import {
  alive,
  authed,
  type Box,
  type Child,
  call,
  cli,
  exitWithin,
  type Frame,
  gone,
  rawConnect,
  readEndpointFile,
  readLockFile,
  readTokenFile,
  reap,
  runFile,
  serve,
  shutdown,
  sleep,
  spawnNode,
  survivors,
  tempBox,
  UMASK_SERVE,
} from "./fixtures/daemon-wire.ts";

const POSIX = process.platform !== "win32";
/** No DMN test may hang the suite: each fails after this long instead. */
const LIMIT = { timeout: 120_000 };

/** Detached daemons (from `daemon start`): their pid, and the instance status confirmed for it. */
const detached = new Map<number, string>();

after(async () => {
  assert.deepEqual(await survivors(), [], "every child this file started is gone");
  for (const pid of detached.keys()) assert.ok(await gone(pid, 5000), `detached daemon ${pid} is gone`);
});

/** A daemon child on a fresh box, ready; the caller shuts it down. */
async function up(box: Box, extra: string[] = []): Promise<{ c: Child; ready: NonNullable<Awaited<Child["ready"]>> }> {
  const c = serve(box, extra);
  const ready = await c.ready;
  assert.ok(ready, `serve became ready (stderr: ${c.err()})`);
  return { c, ready };
}

/** Run body with a ready daemon on a fresh box; always shut down, reap and remove the box. */
async function withDaemon(extra: string[], body: (box: Box, c: Child, ready: Frame) => Promise<void>) {
  const box = tempBox();
  const { c, ready } = await up(box, extra);
  try {
    await body(box, c, ready as unknown as Frame);
  } finally {
    if (c.proc.exitCode === null) {
      try {
        await shutdown(box, c);
      } catch {
        // the body may have stopped it already
      }
    }
    await reap(c);
    box.done();
  }
}

const errCode = (f: Frame | null | "timeout") =>
  f && f !== "timeout" ? ((f.error as { code?: string } | undefined)?.code ?? null) : null;

const runListing = (box: Box) => readdirSync(join(box.home, "run")).sort();

// --- A1: transport facts --------------------------------------------------------------------------

test(
  `transport facts on ${process.platform}: ${POSIX ? "a Unix socket" : "a named pipe"}, held exclusively while the daemon runs`,
  LIMIT,
  async (t) => {
    await withDaemon([], async (box) => {
      const ep = readEndpointFile(box);
      assert.equal(ep.transport, POSIX ? "unix" : "pipe");
      t.diagnostic(`transport ${ep.transport}, endpoint ${Buffer.byteLength(ep.path, "utf8")} bytes`);
      // a second listener on the same socket path or pipe name must be refused
      const err = await new Promise<NodeJS.ErrnoException | null>((r) => {
        const s: Server = createServer();
        s.once("error", (e) => r(e));
        s.listen(ep.path, () => s.close(() => r(null)));
      });
      assert.equal(err?.code, "EADDRINUSE", `a second listen on ${POSIX ? "the socket" : "the pipe"} is refused`);
      t.diagnostic(`second listen: ${err?.code}`);
      if (!POSIX) {
        const r = spawnSync("icacls", [runFile(box, "daemon.token")], { encoding: "utf8", windowsHide: true });
        t.diagnostic(`icacls daemon.token (informational, D-25): ${(r.stdout ?? "").trim() || r.error}`);
      }
    });
  },
);

// --- lifecycle --------------------------------------------------------------------------------------

test(
  "[+RX-DMN/lifecycle] serve prints a ready line; ping and status answer over the wire and through the CLI; shutdown leaves only the OS lock",
  LIMIT,
  async () => {
    const box = tempBox();
    const { c, ready } = await up(box);
    try {
      assert.equal(ready.ready, true);
      assert.equal(ready.pid, c.pid);
      assert.equal(ready.recovered, null);
      assert.deepEqual(Object.keys(ready).sort(), ["endpoint", "instance", "pid", "ready", "recovered"]);
      const ping = await call(box, "ping");
      assert.deepEqual(ping, { id: 1, ok: true, result: { pong: true, instance: ready.instance } });
      const st = (await call(box, "status")).result as Record<string, unknown>;
      assert.deepEqual(Object.keys(st).sort(), [
        "connections",
        "endpoint",
        "home",
        "instance",
        // added by SCH (ADR 0008): the job counts
        "jobs",
        "pid",
        "protocol",
        "recovered",
        "startedAt",
        "uptimeMs",
        "version",
      ]);
      assert.deepEqual(st.jobs, { queued: 0, running: 0, retained: 0 });
      assert.equal(st.pid, c.pid);
      assert.equal(st.home, box.home);
      assert.equal(st.instance, ready.instance);
      assert.equal(st.protocol, 1);
      assert.match(String(st.version), /^\d+\.\d+\.\d+/);
      assert.deepEqual(st.endpoint, ready.endpoint);
      assert.equal(st.recovered, null);
      assert.ok(typeof st.uptimeMs === "number" && st.uptimeMs >= 0);
      assert.ok(Number(st.connections) >= 1);

      const p = await cli(box, "daemon", "ping");
      assert.equal(p.code, 0, p.err);
      assert.deepEqual(JSON.parse(p.out), { pong: true, instance: ready.instance });
      const s = await cli(box, "daemon", "status");
      assert.equal(s.code, 0, s.err);
      assert.equal(JSON.parse(s.out).instance, ready.instance);
      assert.equal(JSON.parse(s.out).pid, c.pid);

      const eight = await Promise.all(Array.from({ length: 8 }, () => call(box, "status")));
      for (const r of eight) assert.equal((r.result as { instance: string }).instance, ready.instance);

      assert.equal(await shutdown(box, c), 0, "the daemon exits 0 after shutdown");
      assert.deepEqual(runListing(box), ["daemon.oslock"]);

      // a new daemon on the same home starts at once
      const again = await up(box);
      assert.notEqual(again.ready.instance, ready.instance);
      assert.equal(again.ready.recovered, null);
      assert.equal(await shutdown(box, again.c), 0);
      assert.deepEqual(runListing(box), ["daemon.oslock"]);
    } finally {
      await reap(c);
      box.done();
    }
  },
);

test(
  "[+RX-DMN/lifecycle] daemon start runs it detached until daemon shutdown; the printed pid is gone afterwards",
  LIMIT,
  async () => {
    const box = tempBox();
    let pid = 0;
    try {
      const s = await cli(box, "daemon", "start");
      assert.equal(s.code, 0, s.err);
      const st = JSON.parse(s.out) as { pid: number; instance: string; home: string };
      pid = st.pid;
      assert.ok(pid > 0 && pid !== process.pid);
      assert.equal(st.home, box.home);
      // the pid is only trusted (and killable by this test) once status on its endpoint names it
      const check = (await call(box, "status")).result as { pid: number; instance: string };
      assert.equal(check.pid, pid);
      assert.equal(check.instance, st.instance);
      detached.set(pid, st.instance);
      const token = readTokenFile(box);
      const sd = await cli(box, "daemon", "shutdown");
      assert.equal(sd.code, 0, sd.err);
      assert.deepEqual(JSON.parse(sd.out), { stopping: true });
      assert.ok(await gone(pid), "the detached daemon exited");
      assert.deepEqual(runListing(box), ["daemon.oslock"]);
      const log = readFileSync(join(box.home, "logs", "daemon.log"), "utf8");
      assert.match(log, /started pid/);
      for (const text of [log, s.out, s.err, sd.out, sd.err]) assert.ok(!text.includes(token), "no token in the log");
      if (POSIX) assert.equal(statSync(join(box.home, "logs", "daemon.log")).mode & 0o777, 0o600);
    } finally {
      // only a pid whose status named the instance this test started is ever signalled
      if (pid && detached.has(pid) && alive(pid)) process.kill(pid, "SIGKILL");
      await gone(pid, 3000);
      box.done();
    }
  },
);

test(
  "[+RX-DMN/lifecycle] SIGTERM runs the same cleanup as shutdown (POSIX; Windows has no SIGTERM to deliver)",
  LIMIT,
  async (t) => {
    const box = tempBox();
    const { c } = await up(box);
    try {
      if (POSIX) {
        c.proc.kill("SIGTERM");
        assert.equal(await exitWithin(c), 0);
      } else {
        t.diagnostic("win32: no SIGTERM delivery; the shutdown request is the stop path");
        assert.equal(await shutdown(box, c), 0);
      }
      assert.deepEqual(runListing(box), ["daemon.oslock"]);
    } finally {
      await reap(c);
      box.done();
    }
  },
);

test(
  "[+RX-DMN/lifecycle] a home whose socket path would pass 100 bytes uses the temp-directory fallback, and works",
  LIMIT,
  async (t) => {
    const probe = tempBox();
    const pad = Math.max(1, 101 - Buffer.byteLength(join(probe.root, "/run/daemon.sock"), "utf8"));
    probe.done();
    const box = tempBox("h".repeat(pad));
    const { c, ready } = await up(box);
    try {
      if (POSIX) {
        const path = String(ready.endpoint.path);
        assert.ok(Buffer.byteLength(join(box.home, "run", "daemon.sock")) > 100);
        assert.ok(path.startsWith(join(box.tmp, `reax-${process.getuid!()}`)), path);
        assert.ok(Buffer.byteLength(path) <= 103, `fallback ${path} fits sun_path`);
        t.diagnostic(`fallback socket ${Buffer.byteLength(path)} bytes`);
      } else assert.equal(ready.endpoint.transport, "pipe");
      assert.equal(((await call(box, "ping")).result as { pong: boolean }).pong, true);
      assert.equal(await shutdown(box, c), 0);
      if (POSIX) assert.equal(existsSync(String(ready.endpoint.path)), false, "the fallback socket is removed");
    } finally {
      await reap(c);
      box.done();
    }
  },
);

test(
  "[-RX-DMN/lifecycle] with no daemon, daemon ping exits 1 with daemon_not_running; after shutdown the old endpoint refuses",
  LIMIT,
  async () => {
    const box = tempBox();
    try {
      const r = await cli(box, "daemon", "ping");
      assert.equal(r.code, 1);
      assert.match(r.err, /\[daemon_not_running\]/);
      const { c } = await up(box);
      const ep = readEndpointFile(box);
      assert.equal(await shutdown(box, c), 0);
      await assert.rejects(rawConnect(ep), "the old endpoint refuses connections");
      const r2 = await cli(box, "daemon", "status");
      assert.equal(r2.code, 1);
      assert.match(r2.err, /\[daemon_not_running\]/);
    } finally {
      box.done();
    }
  },
);

test(
  "[-RX-DMN/lifecycle] an unknown method is bad_request and the connection still answers; a 65 KiB frame is bad_request and closes; a 33rd connection gets daemon_busy and is closed",
  LIMIT,
  async () => {
    await withDaemon([], async (box) => {
      const raw = await authed(box);
      const bad = await raw.call({ id: 7, method: "explode" });
      assert.equal(errCode(bad), "bad_request");
      assert.equal((bad as Frame).id, 7);
      assert.deepEqual(((await raw.call({ id: 8, method: "ping" })) as Frame).result, {
        pong: true,
        instance: readLockFile(box).instance,
      });
      raw.end();

      const big = await authed(box);
      const r = await big.call(`{"id":9,"method":"${"x".repeat(65 * 1024)}"}\n`);
      assert.equal(errCode(r), "bad_request");
      assert.equal(await big.next(3000), null, "the connection closes after an oversized frame");
      assert.equal(((await call(box, "ping")).result as { pong: boolean }).pong, true);

      const conns = [];
      for (let i = 0; i < 32; i++) conns.push(await authed(box));
      const extra = await rawConnect(readEndpointFile(box));
      const busy = await extra.next(3000);
      assert.ok(busy && busy !== "timeout", "the 33rd connection gets a frame");
      assert.equal((busy.error as { code: string }).code, "daemon_busy");
      assert.equal(await extra.next(3000), null, "the 33rd connection is then closed");
      for (const x of conns) x.end();
      await Promise.all(conns.map((x) => x.done));
      // the clients' `done` says nothing about the daemon (a separate process): a close it has not
      // read yet still counts (ADR 0007), so the signal is its own hello reply, busy ones retried
      assert.equal(((await callPastBusy(box, "ping")).result as { pong: boolean }).pong, true);
    });
  },
);

/** One call on a fresh connection, retried (at most `tries` times) only while the daemon's hello
 * reply is daemon_busy; each retry starts after the refused connection has closed. */
async function callPastBusy(box: Box, method: string, tries = 100): Promise<Frame> {
  for (let i = 0; i < tries; i++) {
    const raw = await rawConnect(readEndpointFile(box));
    try {
      const h = await raw.call({ type: "hello", protocol: 1, token: readTokenFile(box) });
      assert.ok(h && h !== "timeout", "the hello is answered");
      if (h.ok !== true && errCode(h) === "daemon_busy") {
        assert.equal(await raw.next(3000), null, "a busy connection is closed");
        continue;
      }
      assert.equal(h.ok, true, `hello accepted: ${JSON.stringify(h)}`);
      const r = await raw.call({ id: 1, method });
      assert.ok(r && r !== "timeout", `${method} answered`);
      return r;
    } finally {
      raw.end();
    }
  }
  assert.fail(`still daemon_busy after ${tries} tries`);
}

// --- a closed peer's slot (the macOS flake of reax run 41612759551) ----------------------------------
// The client's `done` resolves on its own socket's close, which needs nothing from the daemon. The
// daemon learns of it when it reads the end of stream; its socket's "close" comes at least one
// event-loop turn later. DAEMON_HOOKS.onConnClose holds that close clean-up (a barrier, no timing),
// so a new connection is judged exactly in the window where the flake's final ping was.

/** An in-process daemon whose connection close clean-ups are held until release(). */
async function heldCloses(): Promise<{
  box: Box;
  h: DaemonHandle;
  /** Resolves once the daemon's socket "close" has fired for n connections (n ≤ 64). */
  closed(n: number): Promise<void>;
  release(): void;
  done(): Promise<void>;
}> {
  const box = tempBox();
  const held: (() => void)[] = [];
  let want = 0;
  let wake: () => void = () => {};
  const release = () => {
    delete DAEMON_HOOKS.onConnClose;
    for (const f of held.splice(0, held.length)) f();
  };
  DAEMON_HOOKS.onConnClose = (cleanup) => {
    held.push(cleanup);
    if (held.length >= want) wake();
  };
  let h: DaemonHandle;
  try {
    h = await startDaemon({ home: box.home });
  } catch (e) {
    release();
    box.done();
    throw e;
  }
  return {
    box,
    h,
    closed: (n) => {
      assert.ok(n >= 1 && n <= 64, "a bounded barrier");
      want = n;
      return held.length >= n ? Promise.resolve() : new Promise<void>((r) => (wake = r));
    },
    release,
    done: async () => {
      release();
      await h.close();
      box.done();
    },
  };
}

test(
  "[+RX-DMN/busy] a peer that has closed frees its slot before the daemon's socket close: with 32 closes held at the barrier, the next hello is accepted",
  LIMIT,
  async () => {
    const d = await heldCloses();
    try {
      const conns = [];
      for (let i = 0; i < 32; i++) conns.push(await authed(d.box));
      for (const x of conns) x.end();
      await Promise.all(conns.map((x) => x.done));
      await d.closed(32);
      // the daemon has read all 32 ends of stream and has not run one close clean-up
      const r = await call(d.box, "status");
      assert.equal(r.ok, true, `the hello after 32 closed peers is accepted: ${JSON.stringify(r)}`);
      assert.equal((r.result as { connections: number }).connections, 1, "only the status connection counts");
    } finally {
      await d.done();
    }
  },
);

test(
  "[-RX-DMN/busy] with closes held, a closed peer frees exactly its own slot: 31 live plus one new fill the cap, the next gets daemon_busy, and releasing the held close frees nothing more",
  LIMIT,
  async () => {
    const d = await heldCloses();
    try {
      const conns = [];
      for (let i = 0; i < 32; i++) conns.push(await authed(d.box));
      const gone1 = conns.shift()!;
      gone1.end();
      await gone1.done;
      await d.closed(1);
      conns.push(await authed(d.box));
      const busyOf = async () => {
        const extra = await rawConnect(readEndpointFile(d.box));
        const f = await extra.next(3000);
        assert.ok(f && f !== "timeout", "the connection past the cap gets a frame");
        assert.equal((f.error as { code: string }).code, "daemon_busy", "32 live connections are the cap");
        assert.equal(await extra.next(3000), null, "and is then closed");
      };
      await busyOf();
      d.release();
      await busyOf();
      for (const x of conns) x.end();
      await Promise.all(conns.map((x) => x.done));
    } finally {
      await d.done();
    }
  },
);

test(
  "[-RX-DMN/busy] closing sockets still count toward the 64-socket cap: with 32 closes held and 32 live connections, the next socket is closed without a frame; once the closes finish, the next gets daemon_busy",
  LIMIT,
  async () => {
    const d = await heldCloses();
    try {
      const closing = [];
      for (let i = 0; i < 32; i++) closing.push(await authed(d.box));
      for (const x of closing) x.end();
      await Promise.all(closing.map((x) => x.done));
      await d.closed(32);
      const live = [];
      for (let i = 0; i < 32; i++) live.push(await authed(d.box));
      const over = await rawConnect(readEndpointFile(d.box));
      assert.equal(await over.next(3000), null, "64 open sockets: the next is closed without a frame");
      d.release();
      const extra = await rawConnect(readEndpointFile(d.box));
      const f = await extra.next(3000);
      assert.ok(f && f !== "timeout", "with the closing sockets gone, the next gets a frame");
      assert.equal(errCode(f), "daemon_busy");
      assert.equal(await extra.next(3000), null);
      for (const x of live) x.end();
      await Promise.all(live.map((x) => x.done));
    } finally {
      await d.done();
    }
  },
);

test("[+RX-DMN/busy] a peer that half-closes without reading its replies is destroyed within the deadline; its slot and socket are freed and the next connection is served", {
  ...LIMIT,
  // libuv named pipes have no half-close and never complete a write synchronously, so neither
  // the stuck reply below 16 KiB nor a non-reading peer's end of stream exists there (ADR 0007)
  skip: POSIX ? false : "Windows named pipes have no half-close",
}, async () => {
  const box = tempBox();
  const seen: Socket[] = [];
  DAEMON_HOOKS.onAccept = (s) => {
    if (seen.length < 4) seen.push(s);
  };
  let h: DaemonHandle | null = null;
  let peer: Socket | null = null;
  try {
    h = await startDaemon({ home: box.home });
    const ep = readEndpointFile(box);
    peer = await new Promise<Socket>((ok, fail) => {
      const s = connect({ path: ep.path, allowHalfOpen: true });
      s.once("connect", () => ok(s));
      s.once("error", fail);
    });
    peer.on("error", () => {});
    const helloReply = new Promise<void>((ok) => peer!.once("data", () => ok()));
    peer.write(`${JSON.stringify({ type: "hello", protocol: 1, token: readTokenFile(box) })}\n`);
    await helloReply;
    // read only now: the client's "connect" can fire before the daemon has accepted the socket
    // (it did on windows-2025), but a hello reply means the daemon has
    const daemonSide = seen[0];
    assert.ok(daemonSide, "the daemon accepted the connection");
    peer.pause();
    // pings unread until a reply is stuck in the daemon's own write queue, below the 16 KiB at
    // which backpressure (and its stall timer) would start; bounded
    let stuck = false;
    for (let i = 0; i < 200_000 && !stuck; i++) {
      peer.write('{"id":3,"method":"ping"}\n');
      await new Promise((r) => setImmediate(r));
      stuck = daemonSide.writableLength > 0;
    }
    assert.ok(stuck, "a reply is stuck in the daemon's write queue");
    assert.ok(daemonSide.writableLength < 16 * 1024, "below the backpressure threshold");
    const gone = new Promise<void>((ok) => daemonSide.once("close", () => ok()));
    peer.end();
    let timer: NodeJS.Timeout | undefined;
    const r = await Promise.race([
      gone.then(() => "closed"),
      new Promise<string>((ok) => {
        timer = setTimeout(() => ok("still open"), 10_000);
      }),
    ]);
    clearTimeout(timer);
    assert.equal(r, "closed", "the half-closed peer's socket is destroyed by the deadline");
    const st = await call(box, "status");
    assert.equal((st.result as { connections: number }).connections, 1, "only the status connection counts");
    assert.equal(((await call(box, "ping")).result as { pong: boolean }).pong, true);
  } finally {
    delete DAEMON_HOOKS.onAccept;
    peer?.destroy();
    await h?.close();
    box.done();
  }
});

// --- auth -------------------------------------------------------------------------------------------

test(
  "[+RX-DMN/auth] the token from the file authenticates; each start writes a new 43-character token; it is in no output, file, reply or argv",
  LIMIT,
  async () => {
    const box = tempBox();
    const tokens: string[] = [];
    try {
      for (let i = 0; i < 2; i++) {
        const { c, ready } = await up(box);
        const token = readTokenFile(box);
        assert.match(token, /^[A-Za-z0-9_-]{43}$/);
        tokens.push(token);
        const st = await call(box, "status");
        const texts = [
          JSON.stringify(ready),
          JSON.stringify(st),
          readFileSync(runFile(box, "daemon.lock"), "utf8"),
          readFileSync(runFile(box, "endpoint.json"), "utf8"),
          c.args.join(" "),
        ];
        if (process.platform === "linux") texts.push(readFileSync(`/proc/${c.pid}/cmdline`, "utf8"));
        const p = await cli(box, "daemon", "status");
        texts.push(p.out, p.err);
        assert.equal(await shutdown(box, c), 0);
        texts.push(c.out(), c.err());
        for (const s of texts) assert.ok(!s.includes(token), "the token appears nowhere but its file");
      }
      assert.notEqual(tokens[0], tokens[1], "a new token on each start");
    } finally {
      box.done();
    }
  },
);

test(
  "[-RX-DMN/auth] missing, wrong, other-length, non-string, early and late tokens are refused, and the daemon stays up",
  LIMIT,
  async () => {
    await withDaemon([], async (box, c) => {
      const token = readTokenFile(box);
      const replies: Frame[] = [];
      const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1);
      const cases: [string, Frame, string][] = [
        ["no token", { type: "hello", protocol: 1 }, "daemon_unauthorized"],
        ["wrong token, same length", { type: "hello", protocol: 1, token: flip(token) }, "daemon_unauthorized"],
        ["token of another length", { type: "hello", protocol: 1, token: `${token}x` }, "daemon_unauthorized"],
        ["a prefix of the token", { type: "hello", protocol: 1, token: token.slice(0, 20) }, "daemon_unauthorized"],
        ["non-string token", { type: "hello", protocol: 1, token: 42 }, "daemon_unauthorized"],
        ["object token", { type: "hello", protocol: 1, token: { token } }, "daemon_unauthorized"],
        ["ping before hello", { id: 1, method: "ping" }, "daemon_unauthorized"],
        ["protocol 2", { type: "hello", protocol: 2, token }, "daemon_protocol_mismatch"],
      ];
      for (const [what, hello, want] of cases) {
        const raw = await rawConnect(readEndpointFile(box));
        const r = await raw.call(hello);
        assert.equal(errCode(r), want, what);
        replies.push(r as Frame);
        // the same socket gets no pong after a failed hello: it is closed
        raw.send({ id: 2, method: "ping" });
        assert.equal(await raw.next(3000), null, `${what}: the connection closes, with no pong`);
        assert.equal(((await call(box, "ping")).result as { pong: boolean }).pong, true, `${what}: daemon still up`);
      }
      // silence past the hello deadline closes the connection
      const quiet = await rawConnect(readEndpointFile(box));
      const t0 = Date.now();
      assert.equal(await quiet.next(6000), null, "a silent connection is closed");
      assert.ok(Date.now() - t0 >= 1500, "not before the 2 s hello deadline");
      for (const r of replies) assert.ok(!JSON.stringify(r).includes(token), "no token in an error reply");
      assert.ok(!c.err().includes(token) && !c.out().includes(token));
    });
  },
);

test("[-RX-DMN/auth] the previous instance's token is refused after a restart", LIMIT, async () => {
  const box = tempBox();
  try {
    const first = await up(box);
    const old = readTokenFile(box);
    assert.equal(await shutdown(box, first.c), 0);
    const second = await up(box);
    try {
      const raw = await rawConnect(readEndpointFile(box));
      const r = await raw.call({ type: "hello", protocol: 1, token: old });
      assert.equal(errCode(r), "daemon_unauthorized");
      assert.ok(!JSON.stringify(r).includes(old));
      raw.end();
      assert.equal(((await call(box, "ping")).result as { pong: boolean }).pong, true);
      assert.equal(await shutdown(box, second.c), 0);
    } finally {
      await reap(second.c);
    }
  } finally {
    box.done();
  }
});

test(
  "[-RX-DMN/auth] 32 refused peers that stay open and never read cannot lock out a valid client, on the local endpoint and on --tcp",
  LIMIT,
  async () => {
    for (const args of [[], ["--tcp"]]) {
      await withDaemon(args, async (box, c) => {
        const pid = c.pid;
        const ep = readEndpointFile(box);
        const held: Socket[] = [];
        try {
          for (let i = 0; i < 32; i++) {
            const s = ep.transport === "tcp" ? connect({ host: ep.host, port: ep.port }) : connect(ep.path);
            s.on("error", () => {});
            await new Promise((r) => s.once("connect", r));
            s.write(`${JSON.stringify({ type: "hello", protocol: 1, token: "nope" })}\n`);
            s.pause(); // never reads the refusal, never closes
            held.push(s);
          }
          await sleep(200);
          const t0 = Date.now();
          const raw = await rawConnect(ep);
          const r = await raw.call({ type: "hello", protocol: 1, token: readTokenFile(box) }, 3000);
          raw.end();
          assert.ok(
            r && r !== "timeout" && r.ok === true,
            `${ep.transport}: a valid hello is answered: ${JSON.stringify(r)}`,
          );
          assert.ok(Date.now() - t0 < 3000);
          // and the daemon closes its own end of every refused connection (not merely half-closes
          // it), seen in the OS's socket table for its pid: POSIX tools list sockets by open fd
          if (ep.transport === "tcp" && POSIX) {
            let open = tcpConnsOf(pid);
            for (let i = 0; i < 60 && open.length; i++) {
              await sleep(50);
              open = tcpConnsOf(pid);
            }
            assert.deepEqual(open, [], "no refused connection is left open in the daemon");
          }
        } finally {
          for (const s of held) s.destroy();
        }
      });
    }
  },
);

test(
  "[-RX-DMN/lifecycle] an authenticated client that pipelines requests and never reads its replies is disconnected; other clients are served throughout",
  LIMIT,
  async () => {
    for (const args of [[], ["--tcp"]]) {
      await withDaemon(args, async (box) => {
        const ep = readEndpointFile(box);
        const s = ep.transport === "tcp" ? connect({ host: ep.host, port: ep.port }) : connect(ep.path);
        s.on("error", () => {});
        await new Promise((r) => s.once("connect", r));
        const closed = new Promise<void>((r) => s.once("close", () => r()));
        s.write(`${JSON.stringify({ type: "hello", protocol: 1, token: readTokenFile(box) })}\n`);
        const hello = await new Promise<string>((r) => s.once("data", (b: Buffer) => r(b.toString("utf8"))));
        assert.match(hello, /"ok":true/);
        s.pause(); // from here on, no reply is read
        const batch = `${JSON.stringify({ id: 1, method: "status" })}\n`.repeat(1000);
        let done = false;
        void closed.then(() => {
          done = true;
        });
        const flood = (async () => {
          // up to 300,000 status requests, while the connection stays open
          for (let i = 0; i < 300 && !done; i++) {
            s.write(batch);
            await sleep(5);
          }
        })();
        // another client is served while the flood is on
        assert.equal(((await call(box, "status")).result as { pid: number }).pid, readLockFile(box).pid);
        const outcome = await Promise.race([closed.then(() => "closed"), sleep(15_000).then(() => "open")]);
        done = true;
        await flood;
        s.destroy();
        assert.equal(outcome, "closed", `${ep.transport}: the daemon disconnects a client that does not read`);
        const st = (await call(box, "status")).result as { connections: number };
        assert.equal(st.connections, 1, "only the status caller is connected");
      });
    }
  },
);

// --- token file (POSIX only: the row names linux and darwin; D-25) ------------------------------------

/** The system's stat, not Node's: permission bits (octal) and owner uid. */
function sysStat(path: string): string {
  const r =
    process.platform === "darwin"
      ? spawnSync("stat", ["-f", "%Lp %u", path], { encoding: "utf8" })
      : spawnSync("stat", ["-c", "%a %u", path], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

if (POSIX) {
  const uid = () => spawnSync("id", ["-u"], { encoding: "utf8" }).stdout.trim();

  test(
    "[+RX-DMN/token-file] the token and lock files are 0600 and run/ 0700, owned by the user, also under umask 000",
    LIMIT,
    async () => {
      for (const script of ["cli", "umask"]) {
        const box = tempBox();
        const c = script === "cli" ? serve(box) : spawnNode(box, [UMASK_SERVE]);
        try {
          assert.ok(await c.ready, `ready (${script}): ${c.err()}`);
          const me = uid();
          assert.equal(sysStat(runFile(box, "daemon.token")), `600 ${me}`, `${script}: daemon.token`);
          assert.equal(sysStat(runFile(box, "daemon.lock")), `600 ${me}`, `${script}: daemon.lock`);
          assert.equal(sysStat(join(box.home, "run")), `700 ${me}`, `${script}: run/`);
          assert.equal(await shutdown(box, c), 0);
        } finally {
          await reap(c);
          box.done();
        }
      }
    },
  );

  test(
    "[+RX-DMN/token-file] a run/ pre-created 0755 (allowed by the home check) is made 0700 before the start goes on",
    LIMIT,
    async () => {
      const box = tempBox();
      const run = join(box.home, "run");
      mkdirSync(run);
      chmodSync(run, 0o755);
      assert.equal(sysStat(run), `755 ${uid()}`, "the precondition, by the system's stat");
      const c = serve(box);
      try {
        assert.ok(await c.ready, `ready: ${c.err()}`);
        assert.equal(sysStat(run), `700 ${uid()}`, "run/ is 0700");
        assert.equal(await shutdown(box, c), 0);
      } finally {
        await reap(c);
        box.done();
      }
    },
  );

  test(
    "[-RX-DMN/token-file] a run/ pre-created 0775 is refused with daemon_home_unsafe, and nothing is created in it",
    LIMIT,
    async () => {
      const box = tempBox();
      const run = join(box.home, "run");
      mkdirSync(run);
      chmodSync(run, 0o775);
      const c = serve(box);
      try {
        assert.equal(await exitWithin(c), 1);
        assert.match(c.err(), /\[daemon_home_unsafe\]/);
        assert.deepEqual(readdirSync(run), [], "nothing is created in run/");
        assert.equal(sysStat(run), `775 ${uid()}`, "run/ is left as it was");
      } finally {
        await reap(c);
        box.done();
      }
    },
  );

  test(
    "[-RX-DMN/token-file] a world-writable home is refused before anything is created; a readable token makes the client refuse; a planted fallback file is refused",
    LIMIT,
    async () => {
      const box = tempBox();
      try {
        chmodSync(box.home, 0o777);
        const c = serve(box);
        assert.equal(await exitWithin(c), 1);
        assert.match(c.err(), /\[daemon_home_unsafe\]/);
        assert.deepEqual(readdirSync(box.home), [], "nothing is created in an unsafe home");
        chmodSync(box.home, 0o700);

        const { c: d } = await up(box);
        try {
          chmodSync(runFile(box, "daemon.token"), 0o644);
          const r = await cli(box, "daemon", "ping");
          assert.equal(r.code, 1);
          assert.match(r.err, /\[daemon_home_unsafe\]/);
          assert.doesNotMatch(d.err(), /hello/, "the client refused before connecting");
          chmodSync(runFile(box, "daemon.token"), 0o600);
          assert.equal(await shutdown(box, d), 0);
        } finally {
          await reap(d);
        }
      } finally {
        box.done();
      }

      const pad = (b: Box) => Math.max(1, 101 - Buffer.byteLength(join(b.root, "/run/daemon.sock"), "utf8"));
      const probe = tempBox();
      const n = pad(probe);
      probe.done();
      const long = tempBox("h".repeat(n));
      try {
        writeFileSync(join(long.tmp, `reax-${uid()}`), "not a directory");
        const c = serve(long);
        assert.equal(await exitWithin(c), 1);
        assert.match(c.err(), /\[daemon_home_unsafe\]/);
        assert.equal(readFileSync(join(long.tmp, `reax-${uid()}`), "utf8"), "not a directory");
      } finally {
        long.done();
      }
    },
  );
}

// --- loopback ---------------------------------------------------------------------------------------

/** The local addresses the OS lists as listening on this port, for this pid where the tool can filter. */
function listening(pid: number, port: number, v6: boolean): string[] {
  const suffix = `:${port}`;
  if (process.platform === "linux") {
    const r = spawnSync("ss", ["-ltnH"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout
      .split("\n")
      .map((l) => l.trim().split(/\s+/)[3] ?? "")
      .filter((a) => a.endsWith(suffix));
  }
  if (process.platform === "darwin") {
    const r = spawnSync("lsof", ["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN"], { encoding: "utf8" });
    return r.stdout
      .split("\n")
      .slice(1)
      .map((l) => l.trim().split(/\s+/).at(-2) ?? "")
      .filter((a) => a.endsWith(suffix));
  }
  const r = spawnSync("netstat", ["-ano", "-p", v6 ? "TCPv6" : "TCP"], { encoding: "utf8", windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .filter((f) => f[3] === "LISTENING" && f[1]?.endsWith(suffix) && f[4] === String(pid))
    .map((f) => f[1]!);
}

/** The pid's TCP sockets that are not listeners, by open fd (ss -p or lsof: not Node). POSIX only:
 * netstat on Windows lists orphaned connections differently. */
function tcpConnsOf(pid: number): string[] {
  if (process.platform === "linux") {
    const r = spawnSync("ss", ["-tanpH"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.split("\n").filter((l) => l.includes(`pid=${pid},`) && !l.startsWith("LISTEN"));
  }
  const r = spawnSync("lsof", ["-nP", "-a", "-p", String(pid), "-iTCP"], { encoding: "utf8" });
  assert.ok(r.status === 0 || r.status === 1, r.stderr);
  return r.stdout
    .split("\n")
    .slice(1)
    .filter((l) => l.trim() && !l.includes("(LISTEN)"));
}

/** Every TCP listener the OS reports for this pid (ss, lsof or netstat: not Node). */
function listenersOf(pid: number): string[] {
  if (process.platform === "linux") {
    const r = spawnSync("ss", ["-ltnpH"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.split("\n").filter((l) => l.includes(`pid=${pid},`));
  }
  if (process.platform === "darwin") {
    // lsof exits 1 when nothing matches
    const r = spawnSync("lsof", ["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN"], { encoding: "utf8" });
    assert.ok(r.status === 0 || r.status === 1, r.stderr);
    return r.stdout
      .split("\n")
      .slice(1)
      .filter((l) => l.trim());
  }
  const r = spawnSync("netstat", ["-ano"], { encoding: "utf8", windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .filter((f) => f[0]?.startsWith("TCP") && f[3] === "LISTENING" && f[4] === String(pid))
    .map((f) => f.join(" "));
}

/** The hosts --tcp must refuse: wildcards, names, other loopbacks, the mapped form, a LAN address. */
const badHosts = (lan: string[]) => [
  "0.0.0.0",
  "::",
  "localhost",
  "127.0.0.2",
  "::ffff:127.0.0.1",
  "example.com",
  "",
  ...lan.slice(0, 1),
];

const lanV4 = () =>
  Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal)
    .map((a) => a!.address);

async function v6Works(): Promise<boolean> {
  return new Promise((r) => {
    const s = createServer();
    s.once("error", () => r(false));
    s.listen({ host: "::1", port: 0 }, () => s.close(() => r(true)));
  });
}

test(
  "[+RX-DMN/loopback] serve --tcp binds 127.0.0.1 (and --host ::1 binds ::1) only, and answers an authenticated ping",
  LIMIT,
  async (t) => {
    const hosts: [string, string[]][] = [["127.0.0.1", ["--tcp"]]];
    if (await v6Works()) hosts.push(["::1", ["--tcp", "--host", "::1"]]);
    else t.diagnostic("::1 cannot be listened on here; the IPv4 part still runs");
    for (const [host, args] of hosts) {
      await withDaemon(args, async (box, c, ready) => {
        const ep = ready.endpoint as { transport: string; host: string; port: number };
        assert.equal(ep.transport, "tcp");
        assert.equal(ep.host, host);
        assert.ok(ep.port > 0);
        assert.equal(((await call(box, "ping")).result as { pong: boolean }).pong, true);
        const seen = listening(c.pid, ep.port, host === "::1");
        t.diagnostic(`listener table for port ${ep.port}: ${seen.join(", ")}`);
        const want = host === "::1" ? `[::1]:${ep.port}` : `127.0.0.1:${ep.port}`;
        assert.ok(seen.length >= 1, "the listener appears");
        for (const a of seen) assert.equal(a, want, "only the loopback address listens");
      });
    }
  },
);

test(
  "[-RX-DMN/loopback] any other --host is refused with daemon_bind_refused before run/ exists; other addresses cannot reach a --tcp daemon",
  LIMIT,
  async (t) => {
    const lan = lanV4();
    const bad = badHosts(lan);
    if (!lan[0]) t.diagnostic("no non-internal IPv4 address on this machine");
    const box = tempBox();
    const kids = bad.map((host) => ({ host, c: serve(box, ["--tcp", "--host", host]) }));
    try {
      for (const { host, c } of kids) {
        assert.equal(await exitWithin(c), 1, `--host ${JSON.stringify(host)} exits 1`);
        assert.match(c.err(), /\[daemon_bind_refused\]/, `--host ${JSON.stringify(host)}`);
        assert.equal(c.out(), "", "no ready line");
      }
      assert.equal(existsSync(join(box.home, "run")), false, "run/ is never created");
    } finally {
      // every child is stopped before its home is removed, so none can recreate files in it
      for (const { c } of kids) await reap(c);
      box.done();
    }
    await withDaemon(["--tcp"], async (_box, c, ready) => {
      const port = (ready.endpoint as { port: number }).port;
      // the oracle's positive control: the live daemon's own listener is seen by the same tool
      assert.ok(listenersOf(c.pid).length >= 1, "the listener oracle sees a live daemon's port");
      for (const addr of lan)
        await assert.rejects(rawConnect({ transport: "tcp", host: addr, port }), `${addr}:${port} is unreachable`);
      t.diagnostic(`checked ${lan.length} non-internal address(es) at port ${port}`);
    });
  },
);

test(
  "[-RX-DMN/loopback] in process, every refused host leaves the process's listener table unchanged and creates no run/",
  LIMIT,
  async () => {
    const bad = badHosts(lanV4());
    // in process, so the listener table is read while the process that would bind is alive: each
    // refusal leaves this process's listeners exactly as they were, and creates no run/
    const inBox = tempBox();
    const baseline = listenersOf(process.pid);
    const leaked: DaemonHandle[] = [];
    try {
      for (const host of bad) {
        let err: unknown = null;
        try {
          leaked.push(await startDaemon({ home: inBox.home, transport: "tcp", host }));
        } catch (e) {
          err = e;
        }
        assert.ok(
          isCoreError(err, "daemon_bind_refused"),
          `in process, --host ${JSON.stringify(host)}: ${String(err)}`,
        );
        assert.deepEqual(listenersOf(process.pid), baseline, `--host ${JSON.stringify(host)}: no listener appeared`);
      }
      assert.equal(existsSync(join(inBox.home, "run")), false, "run/ is never created in process either");
    } finally {
      for (const h of leaked) await h.close();
      inBox.done();
    }
  },
);
