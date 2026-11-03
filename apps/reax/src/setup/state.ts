// Reading the client's file without following links or reading past the cap, writing it
// atomically with a digest re-check just before the rename, and setup's records under the reax
// home (<REAX_HOME>/setup/<client>.json). The backup of the original bytes stays beside the
// configuration, never in the reax home: the file may hold account data (ADR 0012).
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { CoreError } from "@re4exa/core/errors";
import "../errors.ts";
import { MAX_CONFIG_BYTES, type MalformedReason } from "./jsonedit.ts";

export const POSIX = process.platform !== "win32";

export type Current =
  | { kind: "absent" }
  | { kind: "refused"; reason: MalformedReason }
  | { kind: "file"; bytes: Buffer; mode: number; digest: string };

export function sha256(b: Uint8Array): string {
  return createHash("sha256").update(b).digest("hex");
}

/** A failed file operation as a coded failure (never a raw errno); a CoreError passes through. */
export function ioFail(op: string, target: string, e: unknown, extra: Record<string, unknown> = {}): CoreError {
  if (e instanceof CoreError) return e;
  const errno = (e as NodeJS.ErrnoException | null)?.code;
  return new CoreError("setup_io_failed", {
    op,
    target,
    errno: typeof errno === "string" ? errno : "unknown",
    ...extra,
  });
}

/** `fn()`, with a failed file operation turned into setup_io_failed. */
export function io<T>(op: string, target: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw ioFail(op, target, e);
  }
}

/** Unlinks `path` if present; false (never a throw) when that fails: used only on the way out of a failure. */
export function removeQuiet(path: string): boolean {
  try {
    removeIfPresent(path);
    return true;
  } catch {
    return false;
  }
}

/** O_NOFOLLOW where the OS has it (POSIX): a link swapped in after the lstat is not followed. */
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

/** At most `max` + 1 bytes of `path`, so a file that grew past the cap is seen as too large; null if
 * it is no longer a regular file when opened. */
function readBounded(path: string, max: number): Buffer | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | NOFOLLOW);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ELOOP") return null;
    throw ioFail("open", path, e);
  }
  try {
    if (!fstatSync(fd).isFile()) return null;
    const buf = Buffer.alloc(Math.min(max + 1, 1 << 16));
    const parts: Buffer[] = [];
    let total = 0;
    while (total <= max) {
      const n = readSync(fd, buf, 0, Math.min(buf.length, max + 1 - total), null);
      if (n === 0) break;
      parts.push(Buffer.from(buf.subarray(0, n)));
      total += n;
    }
    return Buffer.concat(parts);
  } catch (e) {
    throw ioFail("read", path, e);
  } finally {
    try {
      closeSync(fd);
    } catch {
      // a read-only descriptor: nothing was written through it
    }
  }
}

/** The file as it is now: absent, refused (a link, not a file, over the cap), or its bytes. */
export function readCurrent(path: string): Current {
  let st: ReturnType<typeof lstatSync>;
  try {
    st = lstatSync(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" };
    throw ioFail("lstat", path, e);
  }
  if (st.isSymbolicLink()) return { kind: "refused", reason: "symlink" };
  if (!st.isFile()) return { kind: "refused", reason: "not_file" };
  if (st.size > MAX_CONFIG_BYTES) return { kind: "refused", reason: "too_large" };
  const bytes = readBounded(path, MAX_CONFIG_BYTES);
  if (bytes === null) return { kind: "refused", reason: "symlink" };
  if (bytes.length > MAX_CONFIG_BYTES) return { kind: "refused", reason: "too_large" };
  return { kind: "file", bytes, mode: st.mode & 0o777, digest: sha256(bytes) };
}

/** Internal test seams (never set by the CLI). */
export interface Hooks {
  /** Called after the new bytes are on disk in the temp file, before the re-check and rename. */
  beforeRename?: (path: string) => void;
  /** Called after the configuration is written, just before the record's temp file is renamed. */
  beforeRecord?: (recordPath: string) => void;
}

/** The file's digest now, or null when absent; a link or non-file counts as changed. */
function digestNow(path: string): string | null | "changed" {
  const c = readCurrent(path);
  if (c.kind === "absent") return null;
  if (c.kind === "refused") return "changed";
  return c.digest;
}

/** Fails with config_changed (and nothing written) unless the file still has digest `expect`
 * (null: still absent). */
export function assertUnchanged(path: string, expect: string | null): void {
  const now = digestNow(path);
  if (now !== expect) throw new CoreError("config_changed", { path });
}

/** Writes `data` to `path` through a temp file in the same directory: fsync, re-check that the file
 * still has digest `expect` (null: still absent), rename. `mode` is set on the new file. */
export function writeAtomic(
  path: string,
  data: Uint8Array,
  mode: number,
  expect: string | null,
  hooks: Hooks = {},
): void {
  const tmp = join(dirname(path), `.${basename(path)}.reax-${process.pid}-${randomBytes(4).toString("hex")}.tmp`);
  writeCopy(tmp, data, mode, false);
  try {
    hooks.beforeRename?.(path);
    assertUnchanged(path, expect);
    io("rename", path, () => renameSync(tmp, path));
  } catch (e) {
    removeQuiet(tmp);
    throw e;
  }
}

/** What is at `path`, without following a link. */
export function kindAt(path: string): "absent" | "file" | "other" {
  try {
    return lstatSync(path).isFile() ? "file" : "other";
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return "absent";
    throw ioFail("lstat", path, e);
  }
}

/** A new file at `path` holding `bytes`, with `mode`. Always created exclusively (O_EXCL never
 * follows a link): with `replace`, a regular file already there is unlinked first; anything else
 * there (a link, a directory) is the caller's to refuse, and makes the open fail. A file it created
 * and could not fill is unlinked again. Failures are setup_io_failed. */
export function writeCopy(path: string, bytes: Uint8Array, mode: number, replace: boolean): void {
  if (replace && kindAt(path) === "file") removeIfPresent(path);
  const fd = io("create", path, () => openSync(path, "wx", mode));
  let open = true;
  try {
    // the umask may have narrowed the mode given to open
    if (POSIX) fchmodSync(fd, mode);
    let off = 0;
    while (off < bytes.length) off += writeSync(fd, bytes, off, bytes.length - off);
    fsyncSync(fd);
    open = false;
    closeSync(fd);
  } catch (e) {
    if (open)
      try {
        closeSync(fd);
      } catch {
        // already failing; the unlink below is what matters
      }
    removeQuiet(path);
    throw ioFail("write", path, e);
  }
}

export function removeIfPresent(path: string): void {
  try {
    unlinkSync(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw ioFail("unlink", path, e);
  }
}

/** What setup wrote, so update and uninstall know which entry and which bytes are reax's. */
export interface SetupRecord {
  version: 1;
  client: string;
  path: string;
  existedBefore: boolean;
  createdServers: boolean;
  sha256Before: string | null;
  sha256After: string;
  backup: string | null;
  /** false once an update ran over edits made after setup: uninstall then edits, never restores */
  restorable: boolean;
  entry: unknown;
}

export function recordPath(reaxHome: string, client: string): string {
  return join(reaxHome, "setup", `${client}.json`);
}

const DIGEST = /^[0-9a-f]{64}$/;

/** The record, or null when there is none. One that is not a regular file, or whose fields are not
 * exactly what setup writes for this path (the backup can only be `backup`), is config_conflict:
 * uninstall acts on the record's paths, so a tampered one must not steer it. */
export function readRecord(reaxHome: string, client: string, path: string, backup: string): SetupRecord | null {
  const rp = recordPath(reaxHome, client);
  const kind = kindAt(rp);
  if (kind === "absent") return null;
  const bad = (reason: string) => new CoreError("config_conflict", { path, reason, record: rp });
  if (kind !== "file") throw bad("record_not_file");
  const bytes = readBounded(rp, 1 << 20);
  if (bytes === null) throw bad("record_not_file");
  let r: SetupRecord;
  try {
    r = JSON.parse(bytes.toString("utf8")) as SetupRecord;
  } catch {
    throw bad("record_invalid");
  }
  const ok =
    r !== null &&
    typeof r === "object" &&
    r.version === 1 &&
    r.client === client &&
    r.path === path &&
    typeof r.existedBefore === "boolean" &&
    typeof r.createdServers === "boolean" &&
    typeof r.restorable === "boolean" &&
    typeof r.sha256After === "string" &&
    DIGEST.test(r.sha256After) &&
    (r.existedBefore
      ? r.backup === backup && typeof r.sha256Before === "string" && DIGEST.test(r.sha256Before)
      : r.backup === null && r.sha256Before === null);
  if (!ok) throw bad("record_invalid");
  return r;
}

/** Refuses a link or file in the setup directory's place (it would send the record elsewhere);
 * setup calls it before writing anything, and writeRecord again. */
export function checkRecordDir(reaxHome: string, path: string): void {
  const dir = join(reaxHome, "setup");
  let st: ReturnType<typeof lstatSync>;
  try {
    st = lstatSync(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw ioFail("lstat", dir, e);
  }
  if (!st.isDirectory())
    throw new CoreError("config_conflict", { path, reason: "record_dir_not_directory", record: dir });
}

/** The record's first half, done before setup touches the configuration: the setup directory made
 * and checked, the record written to its temp file. Returns the temp file's path; on failure nothing
 * but the (empty) directory is left. */
export function prepareRecord(reaxHome: string, r: SetupRecord): string {
  const dir = join(reaxHome, "setup");
  checkRecordDir(reaxHome, r.path);
  io("mkdir", dir, () => mkdirSync(dir, { recursive: true, mode: 0o700 }));
  checkRecordDir(reaxHome, r.path);
  const tmp = `${recordPath(reaxHome, r.client)}.${process.pid}.tmp`;
  // a leftover temp file or a link planted at its name is unlinked (never followed), then created anew
  removeIfPresent(tmp);
  writeCopy(tmp, Buffer.from(`${JSON.stringify(r, null, 1)}\n`), 0o600, false);
  return tmp;
}

/** The record's second half: the temp file renamed over the record (setup_io_failed if that fails). */
export function commitRecord(reaxHome: string, client: string, tmp: string): void {
  const p = recordPath(reaxHome, client);
  io("rename", p, () => renameSync(tmp, p));
}

export function removeRecord(reaxHome: string, client: string): void {
  removeIfPresent(recordPath(reaxHome, client));
}
