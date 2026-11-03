// Opening the program model, pm.db, under the reax home ($REAX_HOME, or <home>/.reax), with Node's
// built-in node:sqlite. Migrations follow core's rules (its Kernel is not used here: it owns core's
// tables and takes an owner lock; that arrives with DMN):
// - pragma user_version holds the version;
// - every pending step and the version bump run in one BEGIN IMMEDIATE transaction, so a failure
//   leaves the previous version and schema;
// - a store newer than this code is refused, unmodified, with core's store_schema_newer;
// - WAL, and a 5 s busy timeout, so two processes indexing at once wait rather than fail;
// - session.index's write takes its lock through withImmediate (D-29): never blocking the event
//   loop while another process holds the lock, cancellable, the same 5 s budget, then pm_busy.
// One connection per store per process.
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CoreError } from "@re4exa/core/errors";
import "../errors.ts";
import { MIGRATIONS, type Migration, PM_VERSION } from "./schema.ts";

export const PM_FILE = "pm.db";
export const BUSY_TIMEOUT_MS = 5000;
const MAX_OPEN = 16;

/** The reax home: the explicit one, else $REAX_HOME, else <home>/.reax. */
export function reaxHome(explicit?: string): string {
  if (explicit) return resolve(explicit);
  if (process.env.REAX_HOME) return resolve(process.env.REAX_HOME);
  return join(homedir(), ".reax");
}

/** Test seam: called between migrate's unlocked version read and its BEGIN IMMEDIATE. */
export const MIGRATE_HOOKS: { afterSeen?: (db: DatabaseSync) => void } = {};

/** Test seam: the busy timeout new connections get (BUSY_TIMEOUT_MS unless a test shortens it). */
export const PM_LIMITS = { busyTimeoutMs: BUSY_TIMEOUT_MS };

const userVersion = (db: DatabaseSync) =>
  Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);

/** SQLITE_BUSY (5) or SQLITE_LOCKED (6): another connection holds the lock past the busy timeout. */
function isBusy(e: unknown): boolean {
  const x = e as { code?: string; errcode?: number; message?: string } | null;
  if (x?.code !== "ERR_SQLITE_ERROR") return false;
  const primary = (x.errcode ?? 0) & 0xff;
  return primary === 5 || primary === 6 || /database is (locked|busy)/i.test(x.message ?? "");
}

/** Run a store operation; a lock held past the busy timeout becomes the retryable pm_busy. */
export function pmCall<T>(f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (isBusy(e)) throw new CoreError("pm_busy", { store: PM_FILE, timeoutMs: PM_LIMITS.busyTimeoutMs });
    throw e;
  }
}

/** Apply the pending steps of `steps` (all, and the version bump, in one transaction). The version
 * is read first without a lock: an up-to-date store takes no write lock at all; a pending migration
 * takes BEGIN IMMEDIATE and checks the version again inside it. */
export function migrate(db: DatabaseSync, steps: readonly Migration[] = MIGRATIONS): number {
  const latest = steps[steps.length - 1]?.version ?? 0;
  const seen = pmCall(() => userVersion(db));
  if (seen > latest) throw new CoreError("store_schema_newer", { store: "pm.db", version: seen, supported: latest });
  if (seen === latest) return latest;
  // another process may migrate between the read above and the lock: hence the check inside
  MIGRATE_HOOKS.afterSeen?.(db);
  pmCall(() => db.exec("BEGIN IMMEDIATE"));
  try {
    const from = userVersion(db);
    if (from > latest) throw new CoreError("store_schema_newer", { store: "pm.db", version: from, supported: latest });
    for (const m of steps) if (m.version > from) for (const sql of m.sql) db.exec(sql);
    if (latest > from) db.exec(`PRAGMA user_version = ${latest}`);
    db.exec("COMMIT");
    return latest;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** The longest pause between two attempts at the write lock. */
export const LOCK_RETRY_MS = 50;

/** One attempt at BEGIN IMMEDIATE that never waits: busy_timeout is 0 for this statement only,
 * then restored. True when the transaction is open. */
function tryBegin(db: DatabaseSync): boolean {
  const prev = Number((db.prepare("PRAGMA busy_timeout").get() as { timeout: number }).timeout);
  db.exec("PRAGMA busy_timeout = 0");
  try {
    db.exec("BEGIN IMMEDIATE");
    return true;
  } catch (e) {
    if (isBusy(e)) return false;
    throw e;
  } finally {
    db.exec(`PRAGMA busy_timeout = ${prev}`);
  }
}

/** A pause of ms that an abort ends early, rejecting with the signal's reason. */
function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(t);
      reject(signal!.reason);
    };
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Run body in a BEGIN IMMEDIATE transaction without blocking the event loop while another
 * connection holds the write lock: each attempt does not wait (busy_timeout 0), and between attempts
 * a timer of at most LOCK_RETRY_MS is awaited, which the signal can end. Past budgetMs (default
 * PM_LIMITS.busyTimeoutMs) it throws the retryable pm_busy; an abort while waiting throws the
 * signal's reason. Once BEGIN succeeds, body, COMMIT and ROLLBACK run synchronously in the same
 * tick: the connection is shared by every job of a process, so an await inside the transaction
 * would let another job's statements run in it. body must therefore be synchronous. */
export async function withImmediate<T>(
  db: DatabaseSync,
  opts: { signal?: AbortSignal; budgetMs?: number },
  body: (db: DatabaseSync) => T,
): Promise<T> {
  const budget = opts.budgetMs ?? PM_LIMITS.busyTimeoutMs;
  const start = Date.now();
  // each pause is at least 1 ms, so this many attempts always outlast the budget
  for (let attempt = 0; ; attempt++) {
    opts.signal?.throwIfAborted();
    if (tryBegin(db)) break;
    const left = budget - (Date.now() - start);
    if (left <= 0 || attempt > budget + 1) throw new CoreError("pm_busy", { store: PM_FILE, timeoutMs: budget });
    await pause(Math.max(1, Math.min(LOCK_RETRY_MS, left)), opts.signal);
  }
  // from here to COMMIT or ROLLBACK: no await
  try {
    const out = body(db);
    if (out instanceof Promise) throw new Error("withImmediate's body must be synchronous");
    pmCall(() => db.exec("COMMIT"));
    return out;
  } catch (e) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw e;
  }
}

const open = new Map<string, DatabaseSync>();

/** The open pm.db under `home`, created and migrated on first use. With create: false (reads), a
 * home without pm.db gives null and nothing is created. */
export function openPm(home: string, steps?: readonly Migration[]): DatabaseSync;
export function openPm(
  home: string,
  steps: readonly Migration[] | undefined,
  opts: { create: false },
): DatabaseSync | null;
export function openPm(
  home: string,
  steps: readonly Migration[] = MIGRATIONS,
  opts: { create?: boolean } = {},
): DatabaseSync | null {
  const file = join(home, PM_FILE);
  const have = open.get(file);
  if (have) return have;
  if (opts.create === false && !existsSync(file)) return null;
  mkdirSync(home, { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec(`PRAGMA busy_timeout = ${PM_LIMITS.busyTimeoutMs}`);
    // refuse a newer store before anything writes to it
    const v = pmCall(() => userVersion(db));
    const latest = steps[steps.length - 1]?.version ?? PM_VERSION;
    if (v > latest) throw new CoreError("store_schema_newer", { store: "pm.db", version: v, supported: latest });
    const mode = (db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode;
    if (mode !== "wal") pmCall(() => db.exec("PRAGMA journal_mode = WAL"));
    db.exec("PRAGMA foreign_keys = ON");
    migrate(db, steps);
  } catch (e) {
    db.close();
    throw e;
  }
  if (open.size >= MAX_OPEN) closePm(open.keys().next().value!);
  open.set(file, db);
  return db;
}

/** Close one store (by its pm.db path or home), or every open one. */
export function closePm(fileOrHome?: string): void {
  for (const [file, db] of [...open]) {
    if (fileOrHome && file !== fileOrHome && file !== join(fileOrHome, PM_FILE)) continue;
    db.close();
    open.delete(file);
  }
}
