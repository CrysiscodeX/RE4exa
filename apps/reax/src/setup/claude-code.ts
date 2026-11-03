// Claude Code's user-scope MCP entry: mcpServers.reax in <home>/.claude.json. setup adds it (and
// replaces an entry reax recorded, which is the update), uninstall takes it out again: the original
// bytes when the file is as setup left it, else only the entry. A file that is malformed, holds a
// reax entry reax did not write, or changes while setup works is left as it is (ADR 0012).
// The entry follows Claude Code's documented user-scope format; it is not checked against a live
// client, which would read the real home.
import { join } from "node:path";
import { CoreError } from "@re4exa/core/errors";
import "../errors.ts";
import { type Env, homeFrom, reaxHomeFrom } from "./home.ts";
import {
  type JsonObject,
  jsonEqual,
  type Layout,
  NEW_FILE_LAYOUT,
  parseConfig,
  serialise,
  setKey,
} from "./jsonedit.ts";
import {
  assertUnchanged,
  type Current,
  checkRecordDir,
  commitRecord,
  type Hooks,
  ioFail,
  kindAt,
  POSIX,
  prepareRecord,
  readCurrent,
  readRecord,
  recordPath,
  removeIfPresent,
  removeQuiet,
  removeRecord,
  type SetupRecord,
  sha256,
  writeAtomic,
  writeCopy,
} from "./state.ts";

export const CLIENT = "claude-code";
export const CONFIG_NAME = ".claude.json";
export const BACKUP_SUFFIX = ".reax-backup";

/** The entry setup writes: the planned `reax mcp` stdio command (not built yet; D-50). */
export function defaultEntry(): JsonObject {
  return {
    type: "stdio",
    command: process.execPath,
    args: [join(import.meta.dirname, "..", "..", "bin", "reax.mjs"), "mcp"],
  };
}

export interface SetupOptions {
  env: Env;
  /** without it, nothing is written: the result is the plan */
  yes?: boolean;
  /** internal: the entry to write (tests use a fixed one) */
  entry?: JsonObject;
  /** internal test seams */
  hooks?: Hooks;
  platform?: NodeJS.Platform;
}

export interface Paths {
  home: string;
  reaxHome: string;
  path: string;
  backup: string;
}

export function pathsFor(env: Env, platform?: NodeJS.Platform): Paths {
  const home = homeFrom(env, platform);
  const path = join(home, CONFIG_NAME);
  return { home, reaxHome: reaxHomeFrom(env, home), path, backup: `${path}${BACKUP_SUFFIX}` };
}

/** The file now, parsed; a refusal throws config_malformed and touches nothing. */
function load(path: string): { cur: Current; value: JsonObject; layout: Layout } {
  const cur = readCurrent(path);
  if (cur.kind === "refused") throw new CoreError("config_malformed", { path, reason: cur.reason });
  if (cur.kind === "absent") return { cur, value: {}, layout: NEW_FILE_LAYOUT };
  const p = parseConfig(cur.bytes);
  if (!p.ok) throw new CoreError("config_malformed", { path, reason: p.reason });
  return { cur, value: p.value, layout: p.layout };
}

function serversOf(value: JsonObject): JsonObject | undefined {
  return Object.hasOwn(value, "mcpServers") ? (value.mcpServers as JsonObject) : undefined;
}

function entryOf(value: JsonObject): unknown {
  const s = serversOf(value);
  return s && Object.hasOwn(s, "reax") ? s.reax : undefined;
}

export type SetupStatus = "plan" | "installed" | "updated" | "unchanged";

export interface SetupResult {
  client: string;
  status: SetupStatus;
  path: string;
  written: boolean;
  before: unknown;
  after: unknown;
  note: string;
}

const MCP_NOTE = "the entry runs `reax mcp`, which is not built yet: the client will not start it until it lands";

export function setup(o: SetupOptions): SetupResult {
  const p = pathsFor(o.env, o.platform);
  const entry = o.entry ?? defaultEntry();
  const { cur, value, layout } = load(p.path);
  const record = readRecord(p.reaxHome, CLIENT, p.path, p.backup);
  const before = entryOf(value);
  const base = { client: CLIENT, path: p.path, before: before ?? null, after: entry, note: MCP_NOTE };
  if (before !== undefined && record === null)
    throw new CoreError("config_conflict", { path: p.path, reason: "unrecorded_entry" });
  if (before !== undefined && record !== null && !jsonEqual(before, record.entry))
    throw new CoreError("config_conflict", { path: p.path, reason: "entry_edited" });
  if (before !== undefined && jsonEqual(before, entry)) return { ...base, status: "unchanged", written: false };
  const update = before !== undefined;
  // only a record of a file that existed names the backup as reax's own
  const recordedBackup = record !== null && record.backup === p.backup;
  // a fresh install keeps the original bytes; another program's file in the backup's place is a conflict
  // and a link or directory there is never written through, recorded or not
  const backupKind = kindAt(p.backup);
  if (!update && (backupKind === "other" || (backupKind === "file" && !recordedBackup)))
    throw new CoreError("config_conflict", {
      path: p.path,
      reason: backupKind === "file" ? "backup_exists" : "backup_not_file",
      backup: p.backup,
    });
  let servers = serversOf(value);
  const createdServers = servers === undefined;
  if (servers === undefined) {
    servers = {};
    setKey(value, "mcpServers", servers);
  }
  setKey(servers, "reax", entry);
  const out = Buffer.from(serialise(value, layout));
  if (!o.yes) return { ...base, status: "plan", written: false };
  checkRecordDir(p.reaxHome, p.path);
  const digest = cur.kind === "file" ? cur.digest : null;
  const mode = cur.kind === "file" ? cur.mode : 0o600;
  let rec: SetupRecord;
  if (update && record) {
    rec = {
      ...record,
      sha256After: sha256(out),
      entry,
      restorable: record.restorable && digest === record.sha256After,
    };
  } else {
    rec = {
      version: 1,
      client: CLIENT,
      path: p.path,
      existedBefore: cur.kind === "file",
      createdServers,
      sha256Before: digest,
      sha256After: sha256(out),
      backup: cur.kind === "file" ? p.backup : null,
      restorable: true,
      entry,
    };
  }
  // Order (ADR 0012): the record's temp file first, so a reax home that cannot take it stops setup
  // before the configuration is touched; then the backup, the configuration, and last the record's
  // rename. A failure after the configuration changed rolls it back.
  const recTmp = prepareRecord(p.reaxHome, rec);
  const wroteBackup = !update && cur.kind === "file";
  try {
    // replaces only a regular backup of reax's own (a recorded install whose entry was removed by hand)
    if (wroteBackup) writeCopy(p.backup, cur.bytes, cur.mode, recordedBackup);
  } catch (e) {
    removeQuiet(recTmp);
    throw e;
  }
  try {
    writeAtomic(p.path, out, mode, digest, o.hooks);
  } catch (e) {
    if (wroteBackup) removeQuiet(p.backup);
    removeQuiet(recTmp);
    throw e;
  }
  try {
    o.hooks?.beforeRecord?.(recordPath(p.reaxHome, CLIENT));
    commitRecord(p.reaxHome, CLIENT, recTmp);
  } catch (e) {
    const rolledBack = rollBack(p.path, cur, rec.sha256After);
    // the backup goes only once the original is back: until then it is the only copy
    if (rolledBack && wroteBackup) removeQuiet(p.backup);
    removeQuiet(recTmp);
    throw new CoreError("setup_io_failed", {
      ...ioFail("record", recordPath(p.reaxHome, CLIENT), e).detail,
      rolled_back: rolledBack,
    });
  }
  return { ...base, status: update ? "updated" : "installed", written: true };
}

/** Puts back what setup replaced (the original bytes, or no file) if the file still has the digest
 * setup gave it; true when the configuration is as it was before. */
function rollBack(path: string, cur: Current, after: string): boolean {
  try {
    if (cur.kind === "file") writeAtomic(path, cur.bytes, cur.mode, after);
    else {
      assertUnchanged(path, after);
      removeIfPresent(path);
    }
    return true;
  } catch {
    return false;
  }
}

export type UninstallStatus =
  | "plan"
  | "not_installed"
  | "restored"
  | "deleted"
  | "removed"
  | "entry_missing"
  | "file_missing";

export interface UninstallResult {
  client: string;
  status: UninstallStatus;
  path: string;
  written: boolean;
  /** what happens (or happened) to the file */
  action: "none" | "restore_backup" | "delete_file" | "remove_entry";
  note: string;
}

export function uninstall(o: SetupOptions): UninstallResult {
  const p = pathsFor(o.env, o.platform);
  const record = readRecord(p.reaxHome, CLIENT, p.path, p.backup);
  const base = { client: CLIENT, path: p.path };
  if (record === null)
    return {
      ...base,
      status: "not_installed",
      written: false,
      action: "none",
      note: "no setup record; nothing changed",
    };
  const cur = readCurrent(p.path);
  if (cur.kind === "refused") throw new CoreError("config_malformed", { path: p.path, reason: cur.reason });
  // after the configuration is dealt with: the backup, then the record (a record left behind is
  // harmless, uninstall runs again and finds the entry gone; a backup left without one blocks setup)
  const finish = (config: string) => {
    try {
      // readRecord allows only p.backup here
      if (record.backup === p.backup) removeIfPresent(p.backup);
      removeRecord(p.reaxHome, CLIENT);
    } catch (e) {
      const d = e instanceof CoreError ? e.detail : undefined;
      throw new CoreError("setup_io_failed", { ...ioFail("cleanup", p.path, e).detail, ...d, config });
    }
  };
  if (cur.kind === "absent") {
    if (o.yes) finish("missing");
    return {
      ...base,
      status: o.yes ? "file_missing" : "plan",
      written: false,
      action: "none",
      note: "the file is gone",
    };
  }
  if (cur.digest === record.sha256After && record.restorable) {
    if (!record.existedBefore) {
      if (!o.yes)
        return { ...base, status: "plan", written: false, action: "delete_file", note: "setup created the file" };
      o.hooks?.beforeRename?.(p.path);
      assertUnchanged(p.path, record.sha256After);
      removeIfPresent(p.path);
      finish("deleted");
      return { ...base, status: "deleted", written: true, action: "delete_file", note: "setup created the file" };
    }
    const backup = record.backup === p.backup ? readCurrent(p.backup) : ({ kind: "absent" } as Current);
    if (backup.kind !== "file" || backup.digest !== record.sha256Before)
      throw new CoreError("config_conflict", { path: p.path, reason: "backup_changed", backup: record.backup });
    if (!o.yes)
      return { ...base, status: "plan", written: false, action: "restore_backup", note: "unchanged since setup" };
    writeAtomic(p.path, backup.bytes, backup.mode, cur.digest, o.hooks);
    finish("restored");
    return { ...base, status: "restored", written: true, action: "restore_backup", note: "unchanged since setup" };
  }
  const parsed = parseConfig(cur.bytes);
  if (!parsed.ok) throw new CoreError("config_malformed", { path: p.path, reason: parsed.reason });
  const servers = serversOf(parsed.value);
  if (!servers || !Object.hasOwn(servers, "reax")) {
    if (o.yes) finish("unchanged");
    return { ...base, status: o.yes ? "entry_missing" : "plan", written: false, action: "none", note: "no reax entry" };
  }
  delete servers.reax;
  if (record.createdServers && Object.keys(servers).length === 0) delete parsed.value.mcpServers;
  const note = "the file changed since setup: only the reax entry is removed, the rest is kept";
  if (!o.yes) return { ...base, status: "plan", written: false, action: "remove_entry", note };
  writeAtomic(p.path, Buffer.from(serialise(parsed.value, parsed.layout)), cur.mode, cur.digest, o.hooks);
  finish("entry_removed");
  return { ...base, status: "removed", written: true, action: "remove_entry", note };
}

export type ClientState = "absent" | "not_configured" | "configured" | "configured_differently" | "malformed";

/** Read-only: the client's state, with no file or directory created. */
export function inspect(env: Env, entry: JsonObject = defaultEntry(), platform?: NodeJS.Platform) {
  const p = pathsFor(env, platform);
  // a record setup would refuse is reported, not thrown: doctor only reads
  let recorded: boolean | "invalid";
  try {
    recorded = readRecord(p.reaxHome, CLIENT, p.path, p.backup) !== null;
  } catch {
    recorded = "invalid";
  }
  const cur = readCurrent(p.path);
  const out = { client: CLIENT, path: p.path, recorded };
  if (cur.kind === "absent") return { ...out, state: "absent" as ClientState };
  if (cur.kind === "refused") return { ...out, state: "malformed" as ClientState, reason: cur.reason };
  const parsed = parseConfig(cur.bytes);
  if (!parsed.ok) return { ...out, state: "malformed" as ClientState, reason: parsed.reason };
  const e = entryOf(parsed.value);
  const state: ClientState =
    e === undefined ? "not_configured" : jsonEqual(e, entry) ? "configured" : "configured_differently";
  return { ...out, state };
}

export { POSIX };
