// Helpers for the DMN tests. The wire client here is written for the tests from the protocol's
// description and does not import src/daemon, so a bug in reax's client cannot hide one in the
// server. Every home is a temporary directory; every process is started here, recorded, and stopped
// only through its own handle.
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REAX = join(import.meta.dirname, "..", "..");
export const CLI = join(REAX, "src", "cli.ts");
export const UMASK_SERVE = join(import.meta.dirname, "umask-serve.mjs");
const NODE_FLAGS = ["--conditions=source", "--disable-warning=ExperimentalWarning"];
/** How long a child may take to print its ready line, or to exit when it is expected to. */
export const READY_WAIT_MS = 20_000;

/** A temporary root with the reax home, HOME and the temp directory all inside it. */
export interface Box {
  root: string;
  home: string;
  tmp: string;
  env: NodeJS.ProcessEnv;
  done(): void;
}

/** The one place the DMN tests make a home: REAX_HOME, HOME, USERPROFILE, TMPDIR, TEMP and TMP all
 * point into a fresh mkdtemp directory, removed by done(). */
export function tempBox(homeName = "home"): Box {
  const root = mkdtempSync(join(tmpdir(), "reax-dmn-"));
  const home = join(root, homeName);
  const user = join(root, "u");
  const tmp = join(root, "t");
  for (const d of [home, user, tmp]) mkdirSync(d, { mode: 0o700 });
  if (process.platform !== "win32") for (const d of [root, home, user, tmp]) chmodSync(d, 0o700);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    REAX_HOME: home,
    HOME: user,
    USERPROFILE: user,
    TMPDIR: tmp,
    TEMP: tmp,
    TMP: tmp,
  };
  const box: Box = {
    root,
    home,
    tmp,
    env,
    done: () => {
      boxes.delete(box);
      rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    },
  };
  boxes.add(box);
  return box;
}

/** Boxes not yet removed: a test that failed before its finally leaves one; the after hook removes it. */
const boxes = new Set<Box>();

export const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait up to ms for pid to be gone; true when it is. */
export async function gone(pid: number, ms = 10_000): Promise<boolean> {
  for (let i = 0; i < ms / 50 && alive(pid); i++) await sleep(50);
  return !alive(pid);
}

export interface Ready {
  ready: true;
  pid: number;
  instance: string;
  endpoint: { transport: string; path?: string; host?: string; port?: number };
  recovered: null | { reason: string; pid: number | null };
}

/** A child the test started, with its output and its exit. */
export interface Child {
  proc: ChildProcess;
  pid: number;
  args: string[];
  out: () => string;
  err: () => string;
  /** The ready line, or null when the child exited first. */
  ready: Promise<Ready | null>;
  exit: Promise<number | null>;
}

/** Every child a test file started, so its after hook can check that none is left. */
export const started = new Set<Child>();

/** The after hook: which children are still running (each is then stopped through its own handle, so
 * a failed test cannot leave a daemon behind or hang the run), and then every box a failed test left
 * is removed. Callers assert the list is empty. */
export async function survivors(): Promise<number[]> {
  const left: number[] = [];
  for (const c of started) {
    if (await gone(c.pid, 2000)) continue;
    left.push(c.pid);
    await reap(c);
  }
  for (const b of [...boxes]) b.done();
  return left;
}

export function spawnNode(box: Box, args: string[]): Child {
  const full = [...NODE_FLAGS, ...args];
  const proc = spawn(process.execPath, full, { env: box.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const pid = proc.pid ?? 0;
  assert.ok(pid > 0, "the child started");
  let out = "";
  let err = "";
  proc.stdout!.on("data", (b: Buffer) => {
    out += b.toString("utf8");
  });
  proc.stderr!.on("data", (b: Buffer) => {
    err += b.toString("utf8");
  });
  const exit = new Promise<number | null>((r) => proc.on("exit", (code) => r(code)));
  const ready = new Promise<Ready | null>((r) => {
    const look = () => {
      const nl = out.indexOf("\n");
      if (nl >= 0) {
        proc.stdout!.off("data", look);
        r(JSON.parse(out.slice(0, nl)) as Ready);
      }
    };
    proc.stdout!.on("data", look);
    void exit.then(() => setTimeout(() => r(null), 50));
    // a child that neither becomes ready nor exits must not hang the test: it reads as not ready
    setTimeout(() => r(null), READY_WAIT_MS).unref();
  });
  const child: Child = { proc, pid, args: [process.execPath, ...full], out: () => out, err: () => err, ready, exit };
  started.add(child);
  return child;
}

/** `reax serve` (or the umask fixture) as a direct child: never through bin/reax.mjs, whose
 * grandchild a kill would orphan. */
export const serve = (box: Box, extra: string[] = [], script = CLI) =>
  spawnNode(box, script === CLI ? [CLI, "serve", ...extra] : [script, ...extra]);

/** Run a CLI command to completion. */
export async function cli(box: Box, ...args: string[]): Promise<{ code: number | null; out: string; err: string }> {
  const c = spawnNode(box, [CLI, ...args]);
  const code = await c.exit;
  return { code, out: c.out(), err: c.err() };
}

/** Stop a child the test started, through its own handle, if it is still running. */
export async function reap(c: Child): Promise<void> {
  if (c.proc.exitCode === null && c.proc.signalCode === null) {
    c.proc.kill("SIGKILL");
    await c.exit;
  }
}

/** The child's exit code, waiting at most ms; a child still running then is killed through its
 * handle and reported as "still running". */
export async function exitWithin(c: Child, ms = READY_WAIT_MS): Promise<number | null | "still running"> {
  let timer: NodeJS.Timeout | undefined;
  const r = await Promise.race([
    c.exit,
    new Promise<"still running">((ok) => {
      timer = setTimeout(() => ok("still running"), ms);
    }),
  ]);
  clearTimeout(timer);
  if (r === "still running") await reap(c);
  return r;
}

/** The test's own reading of the run directory's files. */
export const runFile = (box: Box, name: string) => join(box.home, "run", name);
export const readEndpointFile = (box: Box) => JSON.parse(readFileSync(runFile(box, "endpoint.json"), "utf8"));
export const readTokenFile = (box: Box) => readFileSync(runFile(box, "daemon.token"), "utf8");
export const readLockFile = (box: Box) => JSON.parse(readFileSync(runFile(box, "daemon.lock"), "utf8"));

export type Frame = Record<string, unknown>;

/** A raw protocol connection: hand-written frames over node:net. */
export class Raw {
  readonly sock: Socket;
  #buf = "";
  #frames: Frame[] = [];
  #wait: ((f: Frame | null) => void) | null = null;
  closed = false;
  readonly done: Promise<void>;

  constructor(sock: Socket) {
    this.sock = sock;
    sock.setEncoding("utf8");
    sock.on("data", (s: string) => {
      this.#buf += s;
      for (let nl = this.#buf.indexOf("\n"); nl >= 0; nl = this.#buf.indexOf("\n")) {
        const f = JSON.parse(this.#buf.slice(0, nl)) as Frame;
        this.#buf = this.#buf.slice(nl + 1);
        if (this.#wait) {
          const w = this.#wait;
          this.#wait = null;
          w(f);
        } else this.#frames.push(f);
      }
    });
    sock.on("error", () => {});
    this.done = new Promise((r) =>
      sock.on("close", () => {
        this.closed = true;
        this.#wait?.(null);
        this.#wait = null;
        r();
      }),
    );
  }

  send(frame: Frame | string): void {
    if (!this.closed) this.sock.write(typeof frame === "string" ? frame : `${JSON.stringify(frame)}\n`);
  }

  /** The next frame; null when the connection closed; "timeout" after ms. */
  next(ms = 5000): Promise<Frame | null | "timeout"> {
    const f = this.#frames.shift();
    if (f) return Promise.resolve(f);
    if (this.closed) return Promise.resolve(null);
    return new Promise((r) => {
      const t = setTimeout(() => {
        this.#wait = null;
        r("timeout");
      }, ms);
      this.#wait = (x) => {
        clearTimeout(t);
        r(x);
      };
    });
  }

  async call(frame: Frame | string, ms = 5000): Promise<Frame | null | "timeout"> {
    this.send(frame);
    return this.next(ms);
  }

  end(): void {
    this.sock.destroy();
  }
}

/** Connect to an endpoint as written in endpoint.json. Rejects with the socket error. */
export function rawConnect(ep: { transport: string; path?: string; host?: string; port?: number }): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const sock = ep.transport === "tcp" ? connect({ host: ep.host!, port: ep.port! }) : connect(ep.path!);
    sock.once("connect", () => resolve(new Raw(sock)));
    sock.once("error", reject);
  });
}

/** A connection that has said hello with the token read from the file. */
export async function authed(box: Box): Promise<Raw> {
  const raw = await rawConnect(readEndpointFile(box));
  const r = await raw.call({ type: "hello", protocol: 1, token: readTokenFile(box) });
  assert.ok(r && r !== "timeout" && r.ok === true, `hello accepted: ${JSON.stringify(r)}`);
  return raw;
}

/** One authenticated call on a fresh connection. */
export async function call(box: Box, method: string): Promise<Frame> {
  const raw = await authed(box);
  try {
    const r = await raw.call({ id: 1, method });
    assert.ok(r && r !== "timeout", `${method} answered`);
    return r;
  } finally {
    raw.end();
  }
}

/** Shut a daemon down over the wire and wait for its child to exit; returns the exit code. */
export async function shutdown(box: Box, c: Child): Promise<number | null | "still running"> {
  const r = await call(box, "shutdown");
  assert.deepEqual(r.result, { stopping: true });
  return exitWithin(c);
}
