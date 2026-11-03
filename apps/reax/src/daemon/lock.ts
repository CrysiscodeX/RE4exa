// One daemon per reax home (ADR 0007). In order:
// 1. The OS-held lock decides. run/daemon.oslock is opened with node:sqlite and held in an exclusive
//    transaction lock for the daemon's life (the owner-lock technique of core's kernel, which does
//    not export it). The OS drops it when the process dies, so racing starts and crashed daemons
//    need no clean-up to be decided. The file is never deleted: unlinking a lock file that another
//    process may be opening would recreate the race.
// 2. run/daemon.lock, if present, is diagnosed. It is defence in depth (filesystems without
//    locking) and the source of the recovery report. It is stale only when its pid is dead, or its
//    pid is alive but its endpoint refuses outright (a reused pid), or it is unparsable and older
//    than STALE_AFTER_MS. Anything else, including a ping that times out, counts as a live daemon.
// 3. daemon.lock is created with O_EXCL, so of two starts that both got past step 2 only one owns it.
// Plain O_EXCL alone cannot recover a stale lock safely: there is no atomic "delete it if it is still
// the stale one", so two recoverers could each remove the other's fresh lock. Here the stale file is
// re-read just before it is removed, and only removed if it still has the diagnosed bytes; the OS
// lock in step 1 is what makes the whole sequence single-owner.
import { createHash } from "node:crypto";
import { chmodSync, closeSync, fsyncSync, lstatSync, openSync, statSync, unlinkSync, writeSync } from "node:fs";
import type { Socket } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { CoreError } from "@re4exa/core/errors";
import { probe } from "./client.ts";
import { type Endpoint, files, POSIX, readEndpoint, readSmall } from "./paths.ts";
import { MAX_TOKEN_CHARS } from "./token.ts";

/** Test seam (in process only, like PM's MIGRATE_HOOKS): turn off step 1, or pause after step 2.
 * `onConnClose` (server.ts) receives each accepted connection's close clean-up and decides when
 * to run it, so a test can hold the daemon between a peer's end of stream and its socket's close;
 * `onAccept` sees each socket the daemon keeps (counted or refused), so a test can observe it. */
export const DAEMON_HOOKS: {
  osLock: boolean;
  afterDiagnose?: () => Promise<void> | void;
  onConnClose?: (cleanup: () => void) => void;
  onAccept?: (sock: Socket) => void;
} = { osLock: true };

/** An unparsable lock younger than this may be a start in progress, so it is left alone. */
export const STALE_AFTER_MS = 10_000;
/** How long the diagnosis waits for a live daemon's answer; no answer counts as alive. */
export const PROBE_TIMEOUT_MS = 2000;

export interface LockRecord {
  pid: number;
  instance: string;
  startedAt: string;
  protocol: number;
}

export type Recovered = null | { reason: "pid-dead" | "unreachable" | "unreadable"; pid: number | null };

/** Step 1: hold the OS lock, or fail with daemon_running. */
export function takeOsLock(home: string): DatabaseSync {
  const lock = new DatabaseSync(files(home).osLock, { timeout: 0 });
  try {
    lock.exec("PRAGMA locking_mode=EXCLUSIVE");
    lock.exec("BEGIN IMMEDIATE");
    lock.exec("CREATE TABLE IF NOT EXISTS owner (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    lock
      .prepare("INSERT INTO owner(k,v) VALUES('pid',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v")
      .run(String(process.pid));
    lock.exec("COMMIT");
    if (POSIX) chmodSync(files(home).osLock, 0o600);
    return lock;
  } catch (e) {
    try {
      lock.close();
    } catch {
      // already closed
    }
    if (/locked|busy/i.test(String((e as Error).message))) throw running(home);
    throw e;
  }
}

/** daemon_running, with what is known of the running daemon (never its token). */
export function running(home: string): CoreError {
  const rec = parseLock(readSmall(files(home).lock));
  const ep = readEndpoint(home);
  const endpoint = ep && (!rec || ep.instance === rec.instance) ? endpointOf(ep) : null;
  return new CoreError("daemon_running", { pid: rec?.pid ?? null, instance: rec?.instance ?? null, endpoint });
}

export function endpointOf(ep: Endpoint): Endpoint {
  return ep.transport === "tcp"
    ? { transport: "tcp", host: ep.host, port: ep.port }
    : { transport: ep.transport, path: ep.path };
}

export function parseLock(text: string | null): LockRecord | null {
  if (text === null) return null;
  try {
    const r = JSON.parse(text) as LockRecord;
    if (Number.isInteger(r.pid) && r.pid > 0 && typeof r.instance === "string") return r;
  } catch {
    // unparsable
  }
  return null;
}

/** Alive means signal 0 reaches it, or it exists under another user (EPERM). */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

const ageMs = (path: string) => Date.now() - statSync(path).mtimeMs;

export interface Diagnosis {
  recovered: Recovered;
  /** The bytes of the stale lock, so that removal can check it is still the same file. */
  stale: string | null;
}

/** Step 2: is a lock present, and if so, is it stale? Throws daemon_running for a live one. */
export async function diagnose(home: string): Promise<Diagnosis> {
  const f = files(home);
  const text = readSmall(f.lock);
  if (text === null) return { recovered: null, stale: null };
  const rec = parseLock(text);
  if (!rec) {
    if (ageMs(f.lock) > STALE_AFTER_MS) return { recovered: { reason: "unreadable", pid: null }, stale: text };
    throw running(home);
  }
  if (!pidAlive(rec.pid)) return { recovered: { reason: "pid-dead", pid: rec.pid }, stale: text };
  const ep = readEndpoint(home);
  if (!ep || ep.instance !== rec.instance) {
    // a start in progress has its lock but no endpoint yet
    if (ageMs(f.lock) > STALE_AFTER_MS) return { recovered: { reason: "unreachable", pid: rec.pid }, stale: text };
    throw running(home);
  }
  let token: string | null = readSmall(f.token);
  if (token !== null && (token.length === 0 || token.length > MAX_TOKEN_CHARS)) token = null;
  const seen = await probe(endpointOf(ep), token, PROBE_TIMEOUT_MS);
  if (seen.kind === "refused") return { recovered: { reason: "unreachable", pid: rec.pid }, stale: text };
  throw running(home);
}

export function unlinkQuiet(path: string): void {
  try {
    unlinkSync(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

/** Refuse anything at the socket path that is not a socket; remove a socket (we own the home now). */
export function clearSocket(path: string): void {
  if (!POSIX) return;
  let s: ReturnType<typeof lstatSync>;
  try {
    s = lstatSync(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  if (!s.isSocket())
    throw new CoreError("daemon_home_unsafe", { path, why: "a file that is not a socket is at the socket path" });
  unlinkQuiet(path);
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Remove a stale daemon's files, only if daemon.lock still holds the bytes that were diagnosed. */
export function removeStale(home: string, d: Diagnosis): void {
  const f = files(home);
  if (d.stale === null) return;
  const now = readSmall(f.lock);
  if (now === null || sha(now) !== sha(d.stale)) throw running(home);
  // the endpoint's socket is cleared only when the endpoint belongs to the stale instance; this
  // start's own socket path is cleared after it owns daemon.lock in any case
  const ep = readEndpoint(home);
  const staleInstance = parseLock(d.stale)?.instance;
  if (ep?.transport === "unix" && staleInstance !== undefined && ep.instance === staleInstance) clearSocket(ep.path);
  unlinkQuiet(f.endpoint);
  unlinkQuiet(f.token);
  unlinkQuiet(f.lock);
}

/** With the OS lock held there is no live daemon: leftovers without a lock (a start that died
 * between its files) are removed. Without the OS lock (a test seam) they are left alone. */
export function removeOrphans(home: string): void {
  const f = files(home);
  if (readSmall(f.lock) !== null) return;
  unlinkQuiet(f.endpoint);
  unlinkQuiet(f.token);
}

/** Step 3: create daemon.lock exclusively; EEXIST means another start won. */
export function createLock(home: string, rec: LockRecord): void {
  let fd: number;
  try {
    fd = openSync(files(home).lock, "wx", 0o600);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") throw running(home);
    throw e;
  }
  try {
    writeSync(fd, JSON.stringify(rec));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Remove a file of ours: only while daemon.lock still names this instance. */
export function ownsLock(home: string, instance: string): boolean {
  return parseLock(readSmall(files(home).lock))?.instance === instance;
}
