// DMN: one daemon per home, and recovery from a stale lock. Racing starts are real child processes;
// the O_EXCL and diagnosis paths are also driven in process through DAEMON_HOOKS (the OS lock off,
// or a pause between the diagnosis and the lock's creation). Oracles: the test's own ChildProcess
// handles and exit codes, the lock file's bytes (SHA-256) before and after, directory listings, and
// a raw wire client that does not use src/daemon.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { after, test } from "node:test";
import { isCoreError } from "@re4exa/core/errors";
import { DAEMON_HOOKS } from "../src/daemon/lock.ts";
import { type DaemonHandle, startDaemon } from "../src/daemon/server.ts";
import {
  type Box,
  type Child,
  call,
  exitWithin,
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
} from "./fixtures/daemon-wire.ts";

const POSIX = process.platform !== "win32";
/** No DMN test may hang the suite: each fails after this long instead. */
const LIMIT = { timeout: 120_000 };

after(async () => {
  assert.deepEqual(await survivors(), [], "every child this file started is gone");
});

const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const runListing = (box: Box) => readdirSync(join(box.home, "run")).sort();
const isRunning = (e: unknown) => isCoreError(e, "daemon_running");

/** A pid that existed and has exited: a child this test started and waited for. */
async function deadPid(box: Box): Promise<number> {
  const c = spawnNode(box, ["-e", ""]);
  await c.exit;
  return c.pid;
}

/** An endpoint nothing listens at (connecting gives ENOENT). */
const deadEndpoint = (box: Box) =>
  POSIX
    ? { transport: "unix", path: runFile(box, "daemon.sock") }
    : { transport: "pipe", path: `\\\\.\\pipe\\reax-test-${randomUUID()}` };

/** Plant a previous daemon's files: its lock (text or record), token and endpoint; optionally aged. */
function plant(
  box: Box,
  lock: string | { pid: number; instance?: string },
  opts: { ageS?: number; endpoint?: object } = {},
) {
  mkdirSync(join(box.home, "run"), { recursive: true, mode: 0o700 });
  const instance = typeof lock === "string" ? "x" : (lock.instance ?? randomUUID());
  const text =
    typeof lock === "string"
      ? lock
      : JSON.stringify({ pid: lock.pid, instance, startedAt: new Date().toISOString(), protocol: 1 });
  writeFileSync(runFile(box, "daemon.lock"), text, { mode: 0o600 });
  writeFileSync(runFile(box, "daemon.token"), "old-token-old-token-old-token-old-token-old", { mode: 0o600 });
  writeFileSync(
    runFile(box, "endpoint.json"),
    JSON.stringify({
      ...(opts.endpoint ?? deadEndpoint(box)),
      pid: typeof lock === "string" ? 1 : lock.pid,
      instance,
      protocol: 1,
    }),
    { mode: 0o600 },
  );
  if (opts.ageS) {
    const t = new Date(Date.now() - opts.ageS * 1000);
    utimesSync(runFile(box, "daemon.lock"), t, t);
  }
}

async function up(box: Box): Promise<{ c: Child; ready: NonNullable<Awaited<Child["ready"]>> }> {
  const c = serve(box);
  const ready = await c.ready;
  assert.ok(ready, `serve became ready (stderr: ${c.err()})`);
  return { c, ready };
}

/** Every in-process daemon a test started, closed at the end of the test even if it should never
 * have started (a listening server would otherwise keep the test process alive). */
const inProcessHandles: DaemonHandle[] = [];

/** A start that must be refused: the error it was refused with (a handle that did start is kept for
 * closing, and the test then fails on the assertion). */
async function refusal(p: Promise<DaemonHandle>): Promise<unknown> {
  try {
    inProcessHandles.push(await p);
    return null;
  } catch (e) {
    return e;
  }
}

/** Run body with in-process hooks set, and always restore them and close what it started. */
async function inProcess(box: Box, body: (handles: DaemonHandle[]) => Promise<void>) {
  const handles: DaemonHandle[] = [];
  try {
    await body(handles);
  } finally {
    DAEMON_HOOKS.osLock = true;
    delete DAEMON_HOOKS.afterDiagnose;
    for (const h of [...handles, ...inProcessHandles.splice(0)]) await h.close();
    box.done();
  }
}

// --- single instance --------------------------------------------------------------------------------

test(
  "[+RX-DMN/single-instance] two homes run two daemons at once, each with its own endpoint and instance",
  LIMIT,
  async () => {
    const a = tempBox();
    const b = tempBox();
    const da = await up(a);
    const db = await up(b);
    try {
      assert.notEqual(da.ready.instance, db.ready.instance);
      assert.notDeepEqual(da.ready.endpoint, db.ready.endpoint);
      assert.equal(((await call(a, "ping")).result as { instance: string }).instance, da.ready.instance);
      assert.equal(((await call(b, "ping")).result as { instance: string }).instance, db.ready.instance);
      assert.equal(await shutdown(a, da.c), 0);
      assert.equal(await shutdown(b, db.c), 0);
    } finally {
      await reap(da.c);
      await reap(db.c);
      a.done();
      b.done();
    }
  },
);

test(
  "[-RX-DMN/single-instance] a second serve on a live home exits 1 with daemon_running; the lock and the first instance are unchanged",
  LIMIT,
  async () => {
    const box = tempBox();
    const first = await up(box);
    try {
      const before = sha(runFile(box, "daemon.lock"));
      const second = serve(box);
      assert.equal(await exitWithin(second), 1);
      assert.match(second.err(), /\[daemon_running\]/);
      assert.match(second.err(), new RegExp(first.ready.instance), "the refusal names the running instance");
      assert.equal(sha(runFile(box, "daemon.lock")), before);
      assert.equal(((await call(box, "status")).result as { instance: string }).instance, first.ready.instance);
      assert.equal(await shutdown(box, first.c), 0);
    } finally {
      await reap(first.c);
      box.done();
    }
  },
);

test(
  "[-RX-DMN/single-instance] racing starts (5 rounds on fresh homes, 3 on a planted stale lock), 4 at a time: exactly one daemon each round",
  LIMIT,
  async (t) => {
    for (let round = 0; round < 8; round++) {
      const stale = round >= 5;
      const box = tempBox();
      const kids: Child[] = [];
      try {
        if (stale) plant(box, { pid: await deadPid(box) });
        for (let i = 0; i < 4; i++) kids.push(serve(box));
        const outcome = await Promise.all(
          kids.map(async (k) => ({ k, ready: await Promise.race([k.ready, sleep(15_000).then(() => "timeout")]) })),
        );
        const winners = outcome.filter((o) => o.ready && o.ready !== "timeout");
        assert.equal(winners.length, 1, `round ${round}: exactly one ready line`);
        const win = winners[0]!;
        for (const o of outcome) {
          if (o === win) continue;
          assert.equal(await exitWithin(o.k), 1, `round ${round}: a loser exits 1`);
          assert.match(o.k.err(), /\[daemon_running\]/);
        }
        const ready = win.ready as { instance: string; recovered: { reason: string } | null };
        assert.equal(readLockFile(box).instance, ready.instance, "the winner owns daemon.lock");
        if (stale) assert.equal(ready.recovered?.reason, "pid-dead");
        assert.equal(await shutdown(box, win.k), 0);
      } finally {
        for (const k of kids) await reap(k);
        box.done();
      }
    }
    t.diagnostic("8 rounds of 4 racing starts: one daemon each");
  },
);

test(
  "[-RX-DMN/single-instance] without the OS lock (test seam), O_EXCL alone refuses a second in-process start, also when both pass the diagnosis together",
  LIMIT,
  async () => {
    const box = tempBox();
    await inProcess(box, async (handles) => {
      DAEMON_HOOKS.osLock = false;
      // both starts diagnose an empty run/, then meet at a barrier before creating daemon.lock
      let arrived = 0;
      let open: () => void = () => {};
      const gate = new Promise<void>((r) => {
        open = r;
      });
      DAEMON_HOOKS.afterDiagnose = async () => {
        if (++arrived === 2) open();
        await gate;
      };
      const both = await Promise.allSettled([startDaemon({ home: box.home }), startDaemon({ home: box.home })]);
      const won = both
        .filter((r) => r.status === "fulfilled")
        .map((r) => (r as PromiseFulfilledResult<DaemonHandle>).value);
      handles.push(...won);
      assert.equal(won.length, 1, "exactly one owner");
      const lost = both.find((r) => r.status === "rejected") as PromiseRejectedResult;
      assert.ok(isRunning(lost.reason), String(lost.reason));
      assert.equal(readLockFile(box).instance, won[0]!.instance, "the owner's instance is in daemon.lock");
      assert.equal(((await call(box, "ping")).result as { instance: string }).instance, won[0]!.instance);

      // and a later start, while the owner is live, is refused by the diagnosis
      delete DAEMON_HOOKS.afterDiagnose;
      const before = sha(runFile(box, "daemon.lock"));
      assert.ok(isRunning(await refusal(startDaemon({ home: box.home }))), "refused with daemon_running");
      assert.equal(sha(runFile(box, "daemon.lock")), before);
    });
  },
);

// --- stale lock -------------------------------------------------------------------------------------

test(
  "[+RX-DMN/stale-lock] a lock whose pid is dead is recovered as pid-dead, and the report says so",
  LIMIT,
  async () => {
    const box = tempBox();
    try {
      const pid = await deadPid(box);
      plant(box, { pid });
      const { c, ready } = await up(box);
      try {
        assert.deepEqual(ready.recovered, { reason: "pid-dead", pid });
        const st = (await call(box, "status")).result as { recovered: unknown };
        assert.deepEqual(st.recovered, { reason: "pid-dead", pid });
        assert.notEqual(readTokenFile(box), "old-token-old-token-old-token-old-token-old");
        assert.equal(await shutdown(box, c), 0);
        assert.deepEqual(runListing(box), ["daemon.oslock"]);
      } finally {
        await reap(c);
      }
    } finally {
      box.done();
    }
  },
);

test(
  "[+RX-DMN/stale-lock] a lock whose pid is alive but whose endpoint refuses is recovered as unreachable; an old unparsable lock as unreadable",
  LIMIT,
  async () => {
    const box = tempBox();
    try {
      // this test process is alive; nothing listens at the planted endpoint
      plant(box, { pid: process.pid }, { ageS: 60 });
      const a = await up(box);
      assert.deepEqual(a.ready.recovered, { reason: "unreachable", pid: process.pid });
      assert.equal(await shutdown(box, a.c), 0);

      plant(box, "{not json", { ageS: 60 });
      const b = await up(box);
      assert.deepEqual(b.ready.recovered, { reason: "unreadable", pid: null });
      assert.equal(await shutdown(box, b.c), 0);
      await reap(a.c);
      await reap(b.c);
    } finally {
      box.done();
    }
  },
);

test(
  "[+RX-DMN/stale-lock] a daemon killed outright leaves its files; the next serve recovers them, replaces the socket, and refuses the old token",
  LIMIT,
  async () => {
    const box = tempBox();
    try {
      const first = await up(box);
      const oldToken = readTokenFile(box);
      const oldEp = readEndpointFile(box);
      first.c.proc.kill("SIGKILL"); // TerminateProcess on Windows
      await first.c.exit;
      const left = runListing(box);
      for (const f of ["daemon.lock", "daemon.token", "endpoint.json"])
        assert.ok(left.includes(f), `${f} is left behind`);
      if (POSIX) assert.ok(lstatSync(oldEp.path).isSocket(), "the dead daemon's socket is left behind");

      const second = await up(box);
      try {
        assert.deepEqual(second.ready.recovered, { reason: "pid-dead", pid: first.c.pid });
        if (POSIX) assert.ok(lstatSync(String(second.ready.endpoint.path)).isSocket(), "a fresh socket is listening");
        const raw = await rawConnect(readEndpointFile(box));
        const r = await raw.call({ type: "hello", protocol: 1, token: oldToken });
        assert.equal((r as { error?: { code: string } }).error?.code, "daemon_unauthorized");
        raw.end();
        assert.equal(((await call(box, "ping")).result as { instance: string }).instance, second.ready.instance);
        assert.equal(await shutdown(box, second.c), 0);
        assert.deepEqual(runListing(box), ["daemon.oslock"]);
      } finally {
        await reap(second.c);
      }
    } finally {
      box.done();
    }
  },
);

test(
  "[-RX-DMN/stale-lock] a live daemon's lock is never broken, by a second process or (without the OS lock) in process",
  LIMIT,
  async () => {
    const box = tempBox();
    const first = await up(box);
    try {
      const before = sha(runFile(box, "daemon.lock"));
      const second = serve(box);
      assert.equal(await exitWithin(second), 1);
      assert.match(second.err(), /\[daemon_running\]/);
      assert.equal(sha(runFile(box, "daemon.lock")), before);
      // the diagnosis path alone (the OS lock off in this process) also sees the live daemon
      DAEMON_HOOKS.osLock = false;
      try {
        assert.ok(isRunning(await refusal(startDaemon({ home: box.home }))), "refused with daemon_running");
      } finally {
        DAEMON_HOOKS.osLock = true;
      }
      assert.equal(sha(runFile(box, "daemon.lock")), before);
      assert.equal(((await call(box, "ping")).result as { instance: string }).instance, first.ready.instance);
      assert.equal(await shutdown(box, first.c), 0);
    } finally {
      for (const h of inProcessHandles.splice(0)) await h.close();
      await reap(first.c);
      box.done();
    }
  },
);

test(
  "[-RX-DMN/stale-lock] a live holder whose endpoint accepts but never answers counts as alive: the start is refused after the probe timeout",
  LIMIT,
  async () => {
    const box = tempBox();
    const ep = POSIX
      ? { transport: "unix", path: join(box.root, "silent.sock") }
      : { transport: "pipe", path: `\\\\.\\pipe\\reax-silent-${randomUUID()}` };
    const held = new Set<import("node:net").Socket>();
    // accepts, reads and never answers; its sockets are destroyed at the end so close() can finish
    const silent: Server = createServer((sock) => {
      held.add(sock);
      sock.resume();
    });
    await new Promise<void>((r) => silent.listen(ep.path, r));
    await inProcess(box, async () => {
      plant(box, { pid: process.pid }, { ageS: 60, endpoint: ep });
      const before = sha(runFile(box, "daemon.lock"));
      const t0 = Date.now();
      assert.ok(isRunning(await refusal(startDaemon({ home: box.home }))), "refused with daemon_running");
      assert.ok(Date.now() - t0 >= 1500, "it waited for the probe");
      assert.equal(sha(runFile(box, "daemon.lock")), before, "the lock is untouched");
    }).finally(
      () =>
        new Promise<void>((r) => {
          for (const x of held) x.destroy();
          silent.close(() => r());
        }),
    );
  },
);

test(
  "[-RX-DMN/stale-lock] a regular file at the socket path is not removed, and the start is refused with daemon_home_unsafe",
  LIMIT,
  async (t) => {
    const box = tempBox();
    try {
      mkdirSync(join(box.home, "run"), { mode: 0o700 });
      writeFileSync(runFile(box, "daemon.sock"), "keep me");
      if (POSIX) {
        const c = serve(box);
        assert.equal(await exitWithin(c), 1);
        assert.match(c.err(), /\[daemon_home_unsafe\]/);
        assert.deepEqual(runListing(box), ["daemon.oslock", "daemon.sock"], "nothing else is left");
      } else {
        // on Windows the endpoint is a pipe: the file is not in the way, and is still left alone
        t.diagnostic("win32: the endpoint is a named pipe; a file named daemon.sock is unrelated");
        const { c } = await up(box);
        assert.equal(await shutdown(box, c), 0);
      }
      assert.equal(readFileSync(runFile(box, "daemon.sock"), "utf8"), "keep me");
    } finally {
      box.done();
    }
  },
);

test(
  "[-RX-DMN/stale-lock] two in-process recoverers of one stale lock, one paused between diagnosis and creation: exactly one owner, the first",
  LIMIT,
  async () => {
    const box = tempBox();
    await inProcess(box, async (handles) => {
      plant(box, { pid: await deadPid(box) });
      let release: () => void = () => {};
      let paused: () => void = () => {};
      const reached = new Promise<void>((r) => {
        paused = r;
      });
      const gate = new Promise<void>((r) => {
        release = r;
      });
      let calls = 0;
      DAEMON_HOOKS.afterDiagnose = async () => {
        if (++calls > 1) return;
        paused();
        await gate;
      };
      const a = startDaemon({ home: box.home });
      await reached;
      // A holds the OS lock and has diagnosed the stale lock; B must not get past the OS lock
      const b = await startDaemon({ home: box.home }).then(
        (h) => {
          handles.push(h);
          return h;
        },
        (e: unknown) => e,
      );
      release();
      const ha = await a;
      handles.push(ha);
      assert.ok(isRunning(b), `the second recoverer is refused: ${String(b)}`);
      assert.equal(ha.recovered?.reason, "pid-dead");
      assert.equal(readLockFile(box).instance, ha.instance);
      assert.equal(((await call(box, "ping")).result as { instance: string }).instance, ha.instance);
    });
  },
);
