// SET: reax setup and uninstall for Claude Code (ADR 0012), on temporary homes only
// (test/set-helpers.ts). Install, the unchanged second run, update, the plan without --yes, the
// byte-exact restore, structural removal after a user edit, and the refusals that need a file
// system (links, modes, a file changed between read and rename, a reax entry reax did not write).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { isCoreError } from "@re4exa/core/errors";
import { doctor, homeFrom, setup, uninstall } from "../src/setup/index.ts";
import { writeCopy } from "../src/setup/state.ts";
import { assertTemp, CLI, canonical, childEnv, FIXTURES, KEY, REAX, sha256, tempHome, tree } from "./set-helpers.ts";

const ENTRY = KEY.entry;
const POSIX = process.platform !== "win32";
const NODE_ARGS = ["--conditions=source", "--disable-warning=ExperimentalWarning"];

function withFixture(f: string) {
  const t = tempHome();
  copyFileSync(join(FIXTURES, f), t.config);
  return t;
}

function code(fn: () => unknown): string {
  try {
    fn();
    return "ok";
  } catch (e) {
    assert.ok(isCoreError(e), String(e));
    // the reason (or, for a failed file operation, the operation) is part of what is asserted
    if (e.code === "setup_io_failed") return `setup_io_failed/${String(e.detail?.op)}`;
    return e.detail?.reason === undefined ? e.code : `${e.code}/${String(e.detail.reason)}`;
  }
}

test("[+RX-SET/idempotent] setup adds one mcpServers.reax entry; a second run writes nothing; a recorded entry that differs is replaced", () => {
  const t = withFixture("servers-other.json");
  const r = setup({ env: t.env, yes: true, entry: ENTRY });
  assert.equal(r.status, "installed");
  const v = JSON.parse(readFileSync(t.config, "utf8")) as { mcpServers: Record<string, unknown>; userID: string };
  assert.deepEqual(Object.keys(v.mcpServers).sort(), ["other", "reax"]);
  assert.deepEqual(v.mcpServers.reax, ENTRY);
  assert.equal(canonical(v), KEY.files["servers-other.json"]!.after);
  const bytes = readFileSync(t.config);
  const ino = statSync(t.config, { bigint: true });
  const again = setup({ env: t.env, yes: true, entry: ENTRY });
  assert.equal(again.status, "unchanged");
  assert.equal(again.written, false);
  assert.deepEqual(readFileSync(t.config), bytes);
  const st = statSync(t.config, { bigint: true });
  assert.equal(st.ino, ino.ino);
  assert.equal(st.mtimeNs, ino.mtimeNs);
  // update: a new entry replaces the recorded one, and the rest is kept
  const next = { ...ENTRY, args: ["REAX_BIN_2", "mcp"] };
  const u = setup({ env: t.env, yes: true, entry: next });
  assert.equal(u.status, "updated");
  const v2 = JSON.parse(readFileSync(t.config, "utf8")) as { mcpServers: Record<string, unknown> };
  assert.deepEqual(v2.mcpServers.reax, next);
  assert.ok(v2.mcpServers.other);
  // and uninstall after the update still gives back the original bytes
  assert.equal(uninstall({ env: t.env, yes: true }).status, "restored");
  assert.equal(sha256(readFileSync(t.config)), KEY.files["servers-other.json"]!.sha256);
});

test("[-RX-SET/idempotent] without --yes setup and uninstall print the plan and write nothing", () => {
  const t = withFixture("no-servers.json");
  const before = tree(t.home);
  const plan = setup({ env: t.env, entry: ENTRY });
  assert.equal(plan.status, "plan");
  assert.equal(plan.written, false);
  assert.deepEqual(plan.after, ENTRY);
  assert.equal(plan.before, null);
  assert.equal(sha256(readFileSync(t.config)), KEY.files["no-servers.json"]!.sha256);
  assert.deepEqual(tree(t.home), before);
  setup({ env: t.env, yes: true, entry: ENTRY });
  const installed = readFileSync(t.config);
  const after = tree(t.home);
  assert.equal(uninstall({ env: t.env }).status, "plan");
  assert.deepEqual(readFileSync(t.config), installed);
  assert.deepEqual(tree(t.home), after);
});

test("[-RX-SET/idempotent] the CLI: setup without --yes writes nothing; with --yes it installs; doctor sees it; uninstall deletes the file it created", () => {
  const t = tempHome();
  const cli = (...a: string[]) =>
    spawnSync(process.execPath, [...NODE_ARGS, CLI, ...a], { env: childEnv(t), encoding: "utf8", timeout: 60_000 });
  const plan = cli("setup", "--json");
  assert.equal(plan.status, 0, plan.stderr);
  assert.equal((JSON.parse(plan.stdout) as { status: string }).status, "plan");
  assert.deepEqual(tree(t.home), []);
  const text = cli("setup");
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /<untrusted-content/);
  assert.match(text.stdout, /nothing was written/);
  assert.deepEqual(tree(t.home), []);
  const yes = cli("setup", "--yes", "--json", "--client", "claude-code");
  assert.equal(yes.status, 0, yes.stderr);
  const entry = (JSON.parse(readFileSync(t.config, "utf8")) as { mcpServers: { reax: { args: string[] } } }).mcpServers
    .reax;
  assert.equal(entry.args[0], join(REAX, "bin", "reax.mjs"));
  const doc = JSON.parse(cli("doctor", "--json").stdout) as { mcp_server: string; clients: { state: string }[] };
  assert.equal(doc.mcp_server, "not_built");
  assert.equal(doc.clients[0]!.state, "configured");
  const un = cli("uninstall", "--yes", "--json");
  assert.equal(un.status, 0, un.stderr);
  assert.equal((JSON.parse(un.stdout) as { status: string }).status, "deleted");
  assert.equal(existsSync(t.config), false);
  assert.equal(cli("setup", "--client", "codex").status, 2);
});

test("[+RX-SET/uninstall-restore] uninstall restores the original bytes when the file is unchanged since setup (CRLF and no final newline too), and deletes a file setup created", () => {
  for (const f of ["crlf.json", "tabs.json", "servers-empty.json", "proto.json"]) {
    const t = withFixture(f);
    setup({ env: t.env, yes: true, entry: ENTRY });
    assert.notEqual(sha256(readFileSync(t.config)), KEY.files[f]!.sha256);
    assert.equal(uninstall({ env: t.env, yes: true }).status, "restored", f);
    assert.equal(sha256(readFileSync(t.config)), KEY.files[f]!.sha256, f);
    assert.deepEqual(tree(t.home), [".claude.json", "reax-home", "reax-home/setup"], f);
  }
  const t = tempHome();
  setup({ env: t.env, yes: true, entry: ENTRY });
  assert.equal(existsSync(t.config), true);
  assert.equal(uninstall({ env: t.env, yes: true }).status, "deleted");
  assert.equal(existsSync(t.config), false);
  assert.equal(uninstall({ env: t.env, yes: true }).status, "not_installed");
});

test("[-RX-SET/uninstall-restore] after a user edit, uninstall removes only the reax entry and keeps every other value, also in a file setup created", () => {
  const t = withFixture("servers-other.json");
  setup({ env: t.env, yes: true, entry: ENTRY });
  const v = JSON.parse(readFileSync(t.config, "utf8")) as Record<string, unknown>;
  v.added = { by: "user", n: [1, 2] };
  writeFileSync(t.config, `${JSON.stringify(v, null, 2)}\n`);
  const r = uninstall({ env: t.env, yes: true });
  assert.equal(r.status, "removed");
  const left = JSON.parse(readFileSync(t.config, "utf8")) as Record<string, unknown>;
  const orig = JSON.parse(readFileSync(join(FIXTURES, "servers-other.json"), "utf8")) as Record<string, unknown>;
  assert.equal(canonical(left), canonical({ ...orig, added: { by: "user", n: [1, 2] } }));
  assert.equal(existsSync(`${t.config}.reax-backup`), false);
  // a file setup created, then added to: kept, with the user's value and without reax's
  const c = tempHome();
  setup({ env: c.env, yes: true, entry: ENTRY });
  const cv = JSON.parse(readFileSync(c.config, "utf8")) as Record<string, unknown>;
  cv.theme = "light";
  writeFileSync(c.config, JSON.stringify(cv));
  assert.equal(uninstall({ env: c.env, yes: true }).status, "removed");
  assert.deepEqual(JSON.parse(readFileSync(c.config, "utf8")), { theme: "light" });
});

test("[+RX-SET/config-intact] a reax entry reax did not write is a config_conflict, untouched", () => {
  const t = withFixture("reax-present.json");
  assert.equal(
    code(() => setup({ env: t.env, yes: true, entry: ENTRY })),
    "config_conflict/unrecorded_entry",
  );
  assert.equal(sha256(readFileSync(t.config)), KEY.files["reax-present.json"]!.sha256);
  assert.deepEqual(tree(t.home), [".claude.json"]);
});

test("[+RX-SET/config-intact] a parse failure is never replaced by a fresh object, by setup or by uninstall", () => {
  const t = withFixture("no-servers.json");
  setup({ env: t.env, yes: true, entry: ENTRY });
  const bad = '{"mcpServers": {"reax": {}}, "mcpServers": {}}\n';
  writeFileSync(t.config, bad);
  assert.equal(
    code(() => uninstall({ env: t.env, yes: true })),
    "config_malformed/duplicate_key",
  );
  assert.equal(readFileSync(t.config, "utf8"), bad);
  const s = withFixture("truncated.json");
  assert.equal(
    code(() => setup({ env: s.env, yes: true, entry: ENTRY })),
    "config_malformed/syntax",
  );
  assert.equal(sha256(readFileSync(s.config)), KEY.files["truncated.json"]!.sha256);
});

test("[+RX-SET/config-intact] a file that changes between read and rename is config_changed, and the other writer's bytes are kept", () => {
  const t = withFixture("no-servers.json");
  const other = '{"written": "by the client"}\n';
  const hooks = { beforeRename: (p: string) => writeFileSync(p, other) };
  assert.equal(
    code(() => setup({ env: t.env, yes: true, entry: ENTRY, hooks })),
    "config_changed",
  );
  assert.equal(readFileSync(t.config, "utf8"), other);
  // no backup and no record; the (empty) setup directory made before the write may stay
  assert.deepEqual(tree(t.home), [".claude.json", "reax-home", "reax-home/setup"]);
  // the same during uninstall's restore
  const u = withFixture("no-servers.json");
  setup({ env: u.env, yes: true, entry: ENTRY });
  assert.equal(
    code(() => uninstall({ env: u.env, yes: true, hooks })),
    "config_changed",
  );
  assert.equal(readFileSync(u.config, "utf8"), other);
});

test("[+RX-SET/config-intact] a symlinked .claude.json is refused as symlink and its target is untouched", (t) => {
  const h = tempHome();
  const target = join(h.home, "real.json");
  copyFileSync(join(FIXTURES, "no-servers.json"), target);
  try {
    symlinkSync(target, h.config);
  } catch (e) {
    // Windows without the symlink privilege (Developer Mode off)
    if (!POSIX && (e as NodeJS.ErrnoException).code === "EPERM") return t.skip("symlinks need a privilege here");
    throw e;
  }
  assert.equal(
    code(() => setup({ env: h.env, yes: true, entry: ENTRY })),
    "config_malformed/symlink",
  );
  assert.equal(lstatSync(h.config).isSymbolicLink(), true);
  assert.equal(sha256(readFileSync(target)), KEY.files["no-servers.json"]!.sha256);
  assert.deepEqual(tree(h.home), [".claude.json", "real.json"]);
});

test("[+RX-SET/uninstall-restore] a 0600 file keeps 0600 after setup and after uninstall, and so does the backup", {
  skip: !POSIX,
}, () => {
  const t = withFixture("no-servers.json");
  chmodSync(t.config, 0o600);
  setup({ env: t.env, yes: true, entry: ENTRY });
  assert.equal(statSync(t.config).mode & 0o777, 0o600);
  assert.equal(statSync(`${t.config}.reax-backup`).mode & 0o777, 0o600);
  uninstall({ env: t.env, yes: true });
  assert.equal(statSync(t.config).mode & 0o777, 0o600);
  // and a 0644 file stays 0644
  const p = withFixture("no-servers.json");
  chmodSync(p.config, 0o644);
  setup({ env: p.env, yes: true, entry: ENTRY });
  assert.equal(statSync(p.config).mode & 0o777, 0o644);
});

test("[+RX-SET/temp-home] the home is HOME from the environment passed in (USERPROFILE on Windows); REAX_HOME holds the record", () => {
  const t = tempHome();
  assert.equal(homeFrom({ HOME: t.home }, "linux"), t.home);
  assert.equal(homeFrom({ USERPROFILE: t.home, HOME: "/elsewhere" }, "win32"), t.home);
  assert.equal(homeFrom({ HOME: t.home }, "win32"), t.home);
  setup({ env: t.env, yes: true, entry: ENTRY });
  assert.deepEqual(tree(t.home), [".claude.json", "reax-home", "reax-home/setup", "reax-home/setup/claude-code.json"]);
});

test("[-RX-SET/temp-home] with neither HOME nor USERPROFILE set, setup, uninstall and doctor refuse with home_unset and write nothing, even in the process's own home", () => {
  for (const env of [{}, { HOME: "" }, { HOME: "relative/dir" }, { USERPROFILE: "x" }]) {
    assert.equal(
      code(() => setup({ env, yes: true, entry: ENTRY })),
      "home_unset",
    );
    assert.equal(
      code(() => uninstall({ env, yes: true })),
      "home_unset",
    );
  }
  // a child whose own HOME and USERPROFILE are a second temporary directory: nothing may appear there
  const own = mkdtempSync(join(tempHome().home, "own-"));
  assertTemp(own);
  const src = join(REAX, "src", "setup", "index.ts").replaceAll("\\", "/");
  const script = `const m = await import(${JSON.stringify(`file://${src.startsWith("/") ? "" : "/"}${src}`)});
for (const f of [() => m.setup({ env: {}, yes: true }), () => m.uninstall({ env: {}, yes: true }), () => m.doctor({})]) {
  try { f(); console.log("ok"); } catch (e) { console.log(e.code); }
}`;
  const r = spawnSync(process.execPath, [...NODE_ARGS, "--input-type=module", "-e", script], {
    env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", HOME: own, USERPROFILE: own },
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split(/\r?\n/), ["home_unset", "home_unset", "home_unset"]);
  assert.deepEqual(tree(own), []);
});

/** A link at `at` to `to`; false (after skipping) on Windows without the symlink privilege. */
function link(t: { skip: (m: string) => void }, to: string, at: string, type?: "dir"): boolean {
  try {
    symlinkSync(to, at, type === "dir" ? "junction" : undefined);
    return true;
  } catch (e) {
    if (!POSIX && (e as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("symlinks need a privilege here");
      return false;
    }
    throw e;
  }
}

/** A file outside the home under test, in another temporary directory. */
function outsideFile(): { dir: string; file: string; bytes: string } {
  const dir = tempHome().home;
  const file = join(dir, "outside.txt");
  writeFileSync(file, "outside\n");
  return { dir, file, bytes: "outside\n" };
}

test("[+RX-SET/config-intact] a link at the backup path is never written through, with a record (entry removed by hand) or without one", (t) => {
  const h = withFixture("no-servers.json");
  setup({ env: h.env, yes: true, entry: ENTRY });
  writeFileSync(h.config, '{"a": 2}\n');
  const out = outsideFile();
  rmSync(`${h.config}.reax-backup`);
  if (!link(t, out.file, `${h.config}.reax-backup`)) return;
  assert.equal(
    code(() => setup({ env: h.env, yes: true, entry: ENTRY })),
    "config_conflict/backup_not_file",
  );
  assert.equal(readFileSync(out.file, "utf8"), out.bytes);
  assert.equal(readFileSync(h.config, "utf8"), '{"a": 2}\n');
  // no record: a link (even a dangling one) is refused the same way
  for (const target of [out.file, join(out.dir, "missing.txt")]) {
    const f = withFixture("no-servers.json");
    link(t, target, `${f.config}.reax-backup`);
    assert.equal(
      code(() => setup({ env: f.env, yes: true, entry: ENTRY })),
      "config_conflict/backup_not_file",
    );
    assert.equal(sha256(readFileSync(f.config)), KEY.files["no-servers.json"]!.sha256);
    assert.equal(existsSync(join(out.dir, "missing.txt")), false);
  }
  assert.equal(readFileSync(out.file, "utf8"), out.bytes);
});

test("[+RX-SET/config-intact] a link planted at the record's temp name or in the setup directory's place is not followed", (t) => {
  const h = withFixture("no-servers.json");
  const out = outsideFile();
  mkdirSync(join(h.reaxHome, "setup"), { recursive: true });
  const rec = join(h.reaxHome, "setup", "claude-code.json");
  if (!link(t, out.file, `${rec}.${process.pid}.tmp`)) return;
  assert.equal(setup({ env: h.env, yes: true, entry: ENTRY }).status, "installed");
  assert.equal(readFileSync(out.file, "utf8"), out.bytes);
  assert.equal(lstatSync(rec).isFile(), true);
  // the setup directory itself a link: refused before anything is written
  const d = withFixture("no-servers.json");
  mkdirSync(d.reaxHome);
  link(t, out.dir, join(d.reaxHome, "setup"), "dir");
  assert.equal(
    code(() => setup({ env: d.env, yes: true, entry: ENTRY })),
    "config_conflict/record_dir_not_directory",
  );
  assert.equal(sha256(readFileSync(d.config)), KEY.files["no-servers.json"]!.sha256);
  assert.deepEqual(tree(out.dir).sort(), ["outside.txt"]);
});

test("[-RX-SET/uninstall-restore] a tampered record cannot steer uninstall: a backup path other than the file's own is refused and nothing is deleted", () => {
  const h = withFixture("no-servers.json");
  setup({ env: h.env, yes: true, entry: ENTRY });
  const installed = readFileSync(h.config);
  const out = outsideFile();
  const rec = join(h.reaxHome, "setup", "claude-code.json");
  const r = JSON.parse(readFileSync(rec, "utf8")) as Record<string, unknown>;
  for (const bad of [
    { backup: out.file },
    { backup: null },
    { sha256Before: "x" },
    { existedBefore: "yes" },
    { path: out.file },
    { sha256After: "x" },
    { restorable: "yes" },
  ]) {
    writeFileSync(rec, JSON.stringify({ ...r, ...bad }));
    assert.equal(
      code(() => uninstall({ env: h.env, yes: true })),
      "config_conflict/record_invalid",
      JSON.stringify(bad),
    );
    assert.equal(
      code(() => setup({ env: h.env, yes: true, entry: ENTRY })),
      "config_conflict/record_invalid",
    );
    assert.equal(readFileSync(out.file, "utf8"), out.bytes);
    assert.deepEqual(readFileSync(h.config), installed);
    assert.equal(existsSync(`${h.config}.reax-backup`), true);
    assert.equal(doctor(h.env, ENTRY).clients[0]!.recorded, "invalid");
  }
  // the genuine record still works
  writeFileSync(rec, JSON.stringify(r));
  assert.equal(uninstall({ env: h.env, yes: true }).status, "restored");
});

test("[-RX-SET/uninstall-restore] a record of a file setup created cannot name a backup or a before-digest", () => {
  const h = tempHome();
  setup({ env: h.env, yes: true, entry: ENTRY });
  const created = readFileSync(h.config);
  const rec = join(h.reaxHome, "setup", "claude-code.json");
  const r = JSON.parse(readFileSync(rec, "utf8")) as Record<string, unknown>;
  for (const bad of [{ backup: `${h.config}.reax-backup` }, { sha256Before: sha256(created) }]) {
    writeFileSync(rec, JSON.stringify({ ...r, ...bad }));
    assert.equal(
      code(() => uninstall({ env: h.env, yes: true })),
      "config_conflict/record_invalid",
      JSON.stringify(bad),
    );
    assert.deepEqual(readFileSync(h.config), created);
  }
  writeFileSync(rec, JSON.stringify(r));
  // a regular file at the backup path is not reax's when the record says setup created the file
  writeFileSync(h.config, '{"a": 1}\n');
  writeFileSync(`${h.config}.reax-backup`, "not reax's\n");
  assert.equal(
    code(() => setup({ env: h.env, yes: true, entry: ENTRY })),
    "config_conflict/backup_exists",
  );
  assert.equal(readFileSync(`${h.config}.reax-backup`, "utf8"), "not reax's\n");
  assert.equal(readFileSync(h.config, "utf8"), '{"a": 1}\n');
  assert.equal(uninstall({ env: h.env, yes: true }).status, "entry_missing");
});

test("[+RX-SET/config-intact] a regular file at the backup path with no record is backup_exists, both files untouched", () => {
  const h = withFixture("no-servers.json");
  writeFileSync(`${h.config}.reax-backup`, "another program's\n");
  assert.equal(
    code(() => setup({ env: h.env, yes: true, entry: ENTRY })),
    "config_conflict/backup_exists",
  );
  assert.equal(readFileSync(`${h.config}.reax-backup`, "utf8"), "another program's\n");
  assert.equal(sha256(readFileSync(h.config)), KEY.files["no-servers.json"]!.sha256);
  assert.deepEqual(tree(h.home), [".claude.json", ".claude.json.reax-backup"]);
});

test("[+RX-SET/config-intact] every new file is created exclusively: an existing file or a link there is never written through", (t) => {
  const h = tempHome();
  const out = outsideFile();
  const at = join(h.home, "copy");
  writeFileSync(at, "kept\n");
  assert.equal(
    code(() => writeCopy(at, Buffer.from("new\n"), 0o600, false)),
    "setup_io_failed/create",
  );
  assert.equal(readFileSync(at, "utf8"), "kept\n");
  const l = join(h.home, "link");
  if (!link(t, out.file, l)) return;
  assert.equal(
    code(() => writeCopy(l, Buffer.from("new\n"), 0o600, false)),
    "setup_io_failed/create",
  );
  assert.equal(readFileSync(out.file, "utf8"), out.bytes);
});

const ROOT = POSIX && process.getuid?.() === 0;

test("[-RX-SET/config-intact] a reax home that cannot take the record stops setup before the configuration changes, with a coded failure", {
  skip: !POSIX || ROOT ? "needs POSIX permissions and a non-root user" : false,
}, () => {
  const h = withFixture("no-servers.json");
  mkdirSync(h.reaxHome, { mode: 0o500 });
  chmodSync(h.reaxHome, 0o500);
  try {
    let err: unknown;
    try {
      setup({ env: h.env, yes: true, entry: ENTRY });
    } catch (e) {
      err = e;
    }
    assert.ok(isCoreError(err, "setup_io_failed"), String(err));
    assert.equal(err.detail?.op, "mkdir");
    assert.equal(err.detail?.errno, "EACCES");
    assert.equal(sha256(readFileSync(h.config)), KEY.files["no-servers.json"]!.sha256);
    assert.deepEqual(tree(h.home), [".claude.json", "reax-home"]);
    // the CLI reports the code, never a raw errno
    const r = spawnSync(process.execPath, [...NODE_ARGS, CLI, "setup", "--yes"], {
      env: childEnv(h),
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /\[setup_io_failed\]/);
    assert.equal(sha256(readFileSync(h.config)), KEY.files["no-servers.json"]!.sha256);
    assert.deepEqual(tree(h.home), [".claude.json", "reax-home"]);
  } finally {
    chmodSync(h.reaxHome, 0o700);
  }
  // once the reax home is writable, setup and uninstall work as usual
  assert.equal(setup({ env: h.env, yes: true, entry: ENTRY }).status, "installed");
  assert.equal(uninstall({ env: h.env, yes: true }).status, "restored");
  assert.equal(sha256(readFileSync(h.config)), KEY.files["no-servers.json"]!.sha256);
});

test("[-RX-SET/config-intact] a directory at the record's temp name stops setup before the configuration changes, with a coded failure", () => {
  const h = withFixture("no-servers.json");
  const tmp = join(h.reaxHome, "setup", `claude-code.json.${process.pid}.tmp`);
  mkdirSync(tmp, { recursive: true });
  assert.equal(
    code(() => setup({ env: h.env, yes: true, entry: ENTRY })),
    "setup_io_failed/unlink",
  );
  assert.equal(sha256(readFileSync(h.config)), KEY.files["no-servers.json"]!.sha256);
  assert.deepEqual(tree(h.home), [
    ".claude.json",
    "reax-home",
    "reax-home/setup",
    `reax-home/setup/claude-code.json.${process.pid}.tmp`,
  ]);
  // not a conflict reax cannot undo: no entry without a record, so uninstall has nothing to do
  assert.equal(uninstall({ env: h.env, yes: true }).status, "not_installed");
  rmSync(tmp, { recursive: true });
  assert.equal(setup({ env: h.env, yes: true, entry: ENTRY }).status, "installed");
});

function eio(): never {
  throw Object.assign(new Error("injected"), { code: "EIO" });
}

test("[+RX-SET/config-intact] a record that cannot be written after the configuration changed rolls the configuration back", () => {
  // an existing file: the original bytes are back, the backup and the temp record are gone
  const h = withFixture("no-servers.json");
  let err: unknown;
  try {
    setup({ env: h.env, yes: true, entry: ENTRY, hooks: { beforeRecord: eio } });
  } catch (e) {
    err = e;
  }
  assert.ok(isCoreError(err, "setup_io_failed"), String(err));
  assert.equal(err.detail?.op, "record");
  assert.equal(err.detail?.errno, "EIO");
  assert.equal(err.detail?.rolled_back, true);
  assert.equal(sha256(readFileSync(h.config)), KEY.files["no-servers.json"]!.sha256);
  assert.deepEqual(tree(h.home), [".claude.json", "reax-home", "reax-home/setup"]);
  assert.equal(setup({ env: h.env, yes: true, entry: ENTRY }).status, "installed");
  // a file setup would have created: removed again
  const n = tempHome();
  assert.equal(
    code(() => setup({ env: n.env, yes: true, entry: ENTRY, hooks: { beforeRecord: eio } })),
    "setup_io_failed/record",
  );
  assert.deepEqual(tree(n.home), ["reax-home", "reax-home/setup"]);
  // an update: the installed bytes are back and the old record still undoes the install
  const u = withFixture("servers-other.json");
  setup({ env: u.env, yes: true, entry: ENTRY });
  const installed = readFileSync(u.config);
  const next = { ...ENTRY, args: ["REAX_BIN_2", "mcp"] };
  assert.equal(
    code(() => setup({ env: u.env, yes: true, entry: next, hooks: { beforeRecord: eio } })),
    "setup_io_failed/record",
  );
  assert.deepEqual(readFileSync(u.config), installed);
  assert.equal(setup({ env: u.env, yes: true, entry: ENTRY }).status, "unchanged");
  assert.equal(uninstall({ env: u.env, yes: true }).status, "restored");
  assert.equal(sha256(readFileSync(u.config)), KEY.files["servers-other.json"]!.sha256);
});

test("[-RX-SET/config-intact] when another writer changed the file before the rollback, its bytes and the backup are both kept", () => {
  const h = withFixture("no-servers.json");
  const other = '{"written": "by the client"}\n';
  let err: unknown;
  try {
    setup({
      env: h.env,
      yes: true,
      entry: ENTRY,
      hooks: {
        beforeRecord: () => {
          writeFileSync(h.config, other);
          eio();
        },
      },
    });
  } catch (e) {
    err = e;
  }
  assert.ok(isCoreError(err, "setup_io_failed"), String(err));
  assert.equal(err.detail?.rolled_back, false);
  assert.equal(readFileSync(h.config, "utf8"), other);
  assert.equal(sha256(readFileSync(`${h.config}.reax-backup`)), KEY.files["no-servers.json"]!.sha256);
});

test("[+RX-SET/config-intact] a real rename failure of the record (setup directory made read-only) is rolled back too", {
  skip: !POSIX || ROOT ? "needs POSIX permissions and a non-root user" : false,
}, () => {
  const h = withFixture("no-servers.json");
  const dir = join(h.reaxHome, "setup");
  let err: unknown;
  try {
    setup({ env: h.env, yes: true, entry: ENTRY, hooks: { beforeRecord: () => chmodSync(dir, 0o500) } });
  } catch (e) {
    err = e;
  } finally {
    chmodSync(dir, 0o700);
  }
  assert.ok(isCoreError(err, "setup_io_failed"), String(err));
  assert.equal(err.detail?.op, "rename");
  assert.equal(err.detail?.errno, "EACCES");
  assert.equal(err.detail?.rolled_back, true);
  // the temp record could not be unlinked from the read-only directory; the next setup replaces it
  assert.equal(sha256(readFileSync(h.config)), KEY.files["no-servers.json"]!.sha256);
  assert.deepEqual(tree(h.home), [
    ".claude.json",
    "reax-home",
    "reax-home/setup",
    `reax-home/setup/claude-code.json.${process.pid}.tmp`,
  ]);
  assert.equal(setup({ env: h.env, yes: true, entry: ENTRY }).status, "installed");
});

test("[-RX-SET/uninstall-restore] a record uninstall cannot remove is a coded failure after the file is dealt with, and uninstall can run again", {
  skip: !POSIX || ROOT ? "needs POSIX permissions and a non-root user" : false,
}, () => {
  const h = tempHome();
  setup({ env: h.env, yes: true, entry: ENTRY });
  const dir = join(h.reaxHome, "setup");
  chmodSync(dir, 0o500);
  let err: unknown;
  try {
    uninstall({ env: h.env, yes: true });
  } catch (e) {
    err = e;
  } finally {
    chmodSync(dir, 0o700);
  }
  assert.ok(isCoreError(err, "setup_io_failed"), String(err));
  assert.equal(err.detail?.op, "unlink");
  assert.equal(err.detail?.config, "deleted");
  assert.equal(existsSync(h.config), false);
  assert.equal(uninstall({ env: h.env, yes: true }).status, "file_missing");
  assert.deepEqual(tree(h.home), ["reax-home", "reax-home/setup"]);
});
