// Where the daemon keeps its files under the reax home, and the checks that make them safe to
// trust (ADR 0007):
//   <home>/run/            0700: daemon.oslock, daemon.lock, daemon.token, endpoint.json, daemon.sock
//   <home>/logs/daemon.log 0600 (a detached start only)
// The socket lives in run/ when its path fits (sun_path is 104 bytes on macOS, 108 on Linux);
// otherwise in <tmpdir>/reax-<uid>/ (0700, checked), named by a hash of the home. On Windows the
// endpoint is a named pipe named by a hash of the home; Windows has no mode bits that Node can set,
// so the POSIX checks below do not run there (D-25).
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  type Stats,
  statSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoreError } from "@re4exa/core/errors";
import "../errors.ts";

export const POSIX = process.platform !== "win32";
/** The longest socket path used in run/; longer ones move to the temp-directory fallback. */
export const MAX_SOCKET_PATH = 100;
/** sun_path less its terminating NUL, on the stricter of the two (macOS: 104 bytes). */
export const MAX_SOCKET_FALLBACK = 103;
/** The largest endpoint.json or daemon.lock read back (they are a few hundred bytes). */
export const MAX_STATE_FILE = 4096;

export const runDir = (home: string) => join(home, "run");
export const files = (home: string) => {
  const run = runDir(home);
  return {
    run,
    osLock: join(run, "daemon.oslock"),
    lock: join(run, "daemon.lock"),
    token: join(run, "daemon.token"),
    endpoint: join(run, "endpoint.json"),
    socket: join(run, "daemon.sock"),
    logs: join(home, "logs"),
    log: join(home, "logs", "daemon.log"),
  };
};

export type Endpoint =
  | { transport: "unix"; path: string }
  | { transport: "pipe"; path: string }
  | { transport: "tcp"; host: "127.0.0.1" | "::1"; port: number };

/** What endpoint.json holds: where to connect, and which daemon instance wrote it. */
export type EndpointRecord = Endpoint & { pid: number; instance: string; protocol: number };

const uid = () => process.getuid?.() ?? -1;
const mode = (s: Stats) => s.mode & 0o777;
const unsafe = (path: string, why: string, s?: Stats) =>
  new CoreError("daemon_home_unsafe", {
    path,
    why,
    ...(s ? { mode: mode(s).toString(8).padStart(3, "0"), owner: s.uid } : {}),
  });

/** POSIX: refuse a directory that another user owns or can write (`deny` is the forbidden bits). */
function checkDir(path: string, s: Stats, deny: number): void {
  if (!POSIX) return;
  if (s.isSymbolicLink() || !s.isDirectory()) throw unsafe(path, "not a directory", s);
  if (s.uid !== uid()) throw unsafe(path, "owned by another user", s);
  if (mode(s) & deny) throw unsafe(path, deny === 0o022 ? "group- or world-writable" : "readable by others", s);
}

/** Server side, before anything is created: the home and run/ (if they exist) are this user's and
 * not group- or world-writable. A missing home is created 0700. */
export function checkHome(home: string): void {
  let hs: Stats;
  try {
    hs = statSync(home);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    mkdirSync(home, { recursive: true, mode: 0o700 });
    hs = statSync(home);
  }
  checkDir(home, hs, 0o022);
  const run = runDir(home);
  try {
    checkDir(run, lstatSync(run), 0o022);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

/** Create run/ (0700 whatever the umask: mkdir's mode is narrowed by umask, chmod is not). */
export function makeRunDir(home: string): string {
  const run = runDir(home);
  try {
    mkdirSync(run, { mode: 0o700 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  if (POSIX) chmodSync(run, 0o700);
  checkDir(run, lstatSync(run), 0o077);
  return run;
}

/** Client side: run/ and the token file must be this user's and closed to everyone else. */
export function checkClientFiles(home: string): void {
  if (!POSIX) return;
  const f = files(home);
  checkDir(f.run, lstatSync(f.run), 0o077);
  const s = lstatSync(f.token);
  if (s.isSymbolicLink() || !s.isFile()) throw unsafe(f.token, "not a regular file", s);
  if (s.uid !== uid()) throw unsafe(f.token, "owned by another user", s);
  if (mode(s) & 0o077) throw unsafe(f.token, "readable or writable by others", s);
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

/** The Windows pipe for this home. */
export function pipeName(home: string): string {
  return `\\\\.\\pipe\\reax-${hash(realpathSync(home).toLowerCase()).slice(0, 32)}`;
}

/** The socket path for this home: in run/ when short enough, else the checked temp fallback. */
export function socketPath(home: string): string {
  const own = files(home).socket;
  if (Buffer.byteLength(own, "utf8") <= MAX_SOCKET_PATH) return own;
  const dir = join(tmpdir(), `reax-${uid()}`);
  try {
    mkdirSync(dir, { mode: 0o700 });
    chmodSync(dir, 0o700);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  const s = lstatSync(dir);
  if (s.isSymbolicLink() || !s.isDirectory()) throw unsafe(dir, "the socket fallback is not a directory", s);
  if (s.uid !== uid()) throw unsafe(dir, "the socket fallback is owned by another user", s);
  if (mode(s) !== 0o700) throw unsafe(dir, "the socket fallback is not mode 0700", s);
  const path = join(dir, `${hash(realpathSync(home)).slice(0, 16)}.sock`);
  const n = Buffer.byteLength(path, "utf8");
  if (n > MAX_SOCKET_FALLBACK)
    throw new Error(
      `the daemon's socket path ${path} is ${n} bytes, over the ${MAX_SOCKET_FALLBACK} this OS allows; use a shorter TMPDIR, or --tcp`,
    );
  return path;
}

/** The local endpoint for this platform: a Unix socket, or a named pipe on Windows. */
export function localEndpoint(home: string): Endpoint {
  return POSIX ? { transport: "unix", path: socketPath(home) } : { transport: "pipe", path: pipeName(home) };
}

/** Read a small state file; null when absent. Only the first MAX_STATE_FILE + 1 bytes are read, so
 * an oversized file reads as garbage rather than filling memory. */
export function readSmall(path: string): string | null {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  try {
    const buf = Buffer.alloc(MAX_STATE_FILE + 1);
    let n = 0;
    for (let i = 0; i < 64 && n < buf.length; i++) {
      const r = readSync(fd, buf, n, buf.length - n, null);
      if (r === 0) break;
      n += r;
    }
    return buf.subarray(0, n).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/** endpoint.json, parsed and shape-checked; null when absent or not a valid record. */
export function readEndpoint(home: string): EndpointRecord | null {
  const text = readSmall(files(home).endpoint);
  if (text === null) return null;
  try {
    const r = JSON.parse(text) as EndpointRecord;
    if (typeof r.instance !== "string" || !Number.isInteger(r.pid)) return null;
    if ((r.transport === "unix" || r.transport === "pipe") && typeof r.path === "string") return r;
    if (r.transport === "tcp" && (r.host === "127.0.0.1" || r.host === "::1") && Number.isInteger(r.port)) return r;
    return null;
  } catch {
    return null;
  }
}

/** Write endpoint.json atomically (a temp file, then rename), 0600. */
export function writeEndpoint(home: string, rec: EndpointRecord): void {
  const f = files(home);
  const tmp = `${f.endpoint}.${process.pid}.tmp`;
  const fd = openSync(tmp, "w", 0o600);
  try {
    writeSync(fd, JSON.stringify(rec));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, f.endpoint);
}
