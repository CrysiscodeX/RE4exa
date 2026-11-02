// PM: the program model (pm.db). The store's version is read through a separate node:sqlite
// connection; the stored symbols are checked against inventory.symbols itself (which CI checks
// against LLVM's keys), and FTS5 against an independent case-insensitive substring filter written
// here. Every test uses a temporary reax home (never the real one): passed as OpContext.home, and
// REAX_HOME also points at a temporary directory for the whole file. The default location is
// checked only in a child process whose HOME (USERPROFILE on Windows) is a temporary directory.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { isCoreError } from "@re4exa/core/errors";
import { PAGE_MAX } from "../src/ops/page.ts";
import { PM_HOOKS } from "../src/ops/pm.ts";
import { runOperation } from "../src/ops/registry.ts";
import { closePm, MIGRATE_HOOKS, migrate, openPm, PM_FILE, PM_LIMITS } from "../src/pm/db.ts";
import { MIGRATIONS, PM_VERSION } from "../src/pm/schema.ts";

const REAX = join(import.meta.dirname, "..");
const BIN = join(REAX, "fixtures", "bin");
const EXTRA = join(REAX, "fixtures", "extra");
const SRC = (...p: string[]) => pathToFileURL(join(REAX, "src", ...p)).href;

// anything that falls back to REAX_HOME lands in a temporary directory too
const savedHome = process.env.REAX_HOME;
const fallback = mkdtempSync(join(tmpdir(), "reax-home-fallback-"));
process.env.REAX_HOME = fallback;
after(() => {
  closePm();
  if (savedHome === undefined) delete process.env.REAX_HOME;
  else process.env.REAX_HOME = savedHome;
  rmSync(fallback, { recursive: true, force: true });
});

function homeDir() {
  const home = mkdtempSync(join(tmpdir(), "reax-home-"));
  return {
    home,
    db: join(home, PM_FILE),
    done: () => {
      closePm(home);
      rmSync(home, { recursive: true, force: true });
    },
  };
}
const ctxFor = (home: string, workspace = BIN) => ({ workspace, home });

/** A separate connection, for reading what the store holds independently of reax's handle. */
function peek<T>(file: string, f: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return f(db);
  } finally {
    db.close();
  }
}
const version = (file: string) =>
  peek(file, (db) => Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version));
const schema = (file: string) =>
  peek(file, (db) =>
    (db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all() as { name: string }[]).map((r) =>
      JSON.stringify(r),
    ),
  );
const counts = (file: string) =>
  peek(file, (db) => ({
    targets: Number((db.prepare("SELECT count(*) AS n FROM pm_target").get() as { n: number }).n),
    symbols: Number((db.prepare("SELECT count(*) AS n FROM pm_symbol").get() as { n: number }).n),
  }));
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

interface Sym {
  name: string;
  addr: string | null;
  size: number | null;
  kind: string;
  bind: string;
  defined: boolean;
  section: string | null;
  library: string | null;
}
const FIELDS = ["name", "addr", "size", "kind", "bind", "defined", "section", "library"] as const;
const pick = (x: Sym & { arch: string }) => JSON.stringify([x.arch, ...FIELDS.map((k) => x[k])]);

/** The oracle: inventory.symbols itself, every slice (architecture) and every page. */
async function expected(workspace: string, path: string): Promise<string[] | null> {
  let arches: string[];
  try {
    const n = await runOperation("inventory.native", { path, limit: 1 }, { workspace });
    arches = (n.data as { slices: { arch: string }[] }).slices.map((s) => s.arch);
  } catch {
    return null;
  }
  const out: string[] = [];
  for (const arch of arches) {
    for (let offset = 0; ; ) {
      let r: Awaited<ReturnType<typeof runOperation>>;
      try {
        r = await runOperation("inventory.symbols", { path, arch, offset, limit: PAGE_MAX }, { workspace });
      } catch {
        return null;
      }
      const d = r.data as { items: Sym[]; page: { next: number | null } };
      out.push(...d.items.map((x) => pick({ ...x, arch })));
      if (d.page.next === null) break;
      offset = d.page.next;
    }
  }
  return out;
}

/** Every row search.symbols returns, all pages of `limit` rows. */
async function readBack(ctx: { workspace: string; home: string }, args: Record<string, unknown>, limit = 7) {
  const rows: string[] = [];
  let total = -1;
  for (let offset = 0, n = 0; n < 100_000; n++) {
    const r = await runOperation("search.symbols", { ...args, offset, limit }, ctx);
    const d = r.data as { items: (Sym & { arch: string })[]; page: { total: number; next: number | null } };
    total = d.page.total;
    assert.equal(d.items.length, Math.min(limit, total - offset), `page at ${offset} of ${total}, limit ${limit}`);
    rows.push(...d.items.map(pick));
    if (d.page.next === null) break;
    offset = d.page.next;
  }
  assert.equal(rows.length, total, "the pages add up to the total");
  return rows;
}
const nameOf = (row: string) => (JSON.parse(row) as string[])[1]!;

test(`node:sqlite (SQLite ${peek(":memory:", (db) => (db.prepare("SELECT sqlite_version() AS v").get() as { v: string }).v)}) has FTS5 and the trigram tokenizer`, () => {
  const db = new DatabaseSync(":memory:");
  try {
    const opts = (db.prepare("PRAGMA compile_options").all() as { compile_options: string }[]).map(
      (r) => r.compile_options,
    );
    assert.ok(opts.includes("ENABLE_FTS5"), opts.join(" "));
    db.exec("CREATE VIRTUAL TABLE t USING fts5(name, tokenize='trigram')");
    db.prepare("INSERT INTO t(name) VALUES (?)").run("Reax_Mul");
    assert.equal((db.prepare("SELECT count(*) AS n FROM t WHERE t MATCH ?").get('"eax_"') as { n: number }).n, 1);
  } finally {
    db.close();
  }
});

// ------------------------------------------------------------------------------------- the store

test("[+RX-PM/store] a fresh home gets pm.db at the current version; migrating again changes nothing", async () => {
  const h = homeDir();
  try {
    assert.equal(existsSync(h.db), false);
    const r = await runOperation("session.index", { path: "hello-x86_64-linux-gnu.2.28-g" }, ctxFor(h.home));
    assert.equal((r.data as { reused: boolean }).reused, false);
    assert.equal(version(h.db), PM_VERSION);
    assert.equal(
      peek(h.db, (db) => (db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode),
      "wal",
    );
    assert.ok(schema(h.db).some((s) => s.includes('"pm_symbol_fts"')));
    const before = { schema: schema(h.db), counts: counts(h.db) };
    assert.equal(migrate(openPm(h.home)), PM_VERSION);
    closePm(h.home);
    openPm(h.home);
    assert.deepEqual({ schema: schema(h.db), counts: counts(h.db) }, before);
    assert.equal(version(h.db), PM_VERSION);
  } finally {
    h.done();
  }
});

test("[+RX-PM/store] the stored symbols survive into another process, which reads the same rows", async () => {
  const h = homeDir();
  try {
    const path = "shapes-x86_64-linux-gnu.2.28-g";
    await runOperation("session.index", { path }, ctxFor(h.home));
    const mine = await readBack(ctxFor(h.home), { path }, PAGE_MAX);
    // a second Node process, with its own connection, while this one keeps its own open
    const script = `
      const { runOperation } = await import(${JSON.stringify(SRC("ops", "registry.ts"))});
      const r = await runOperation("search.symbols", { path: ${JSON.stringify(path)}, limit: ${PAGE_MAX} }, { workspace: ${JSON.stringify(BIN)} });
      process.stdout.write(JSON.stringify(r.data));`;
    const c = spawnSync(
      process.execPath,
      ["--conditions=source", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", script],
      { encoding: "utf8", env: { ...process.env, REAX_HOME: h.home }, timeout: 60_000 },
    );
    assert.equal(c.status, 0, c.stderr);
    const theirs = (JSON.parse(c.stdout) as { items: (Sym & { arch: string })[] }).items.map(pick);
    assert.ok(mine.length > 10);
    assert.deepEqual(theirs, mine);
  } finally {
    h.done();
  }
});

test("[+RX-PM/store] with no REAX_HOME, pm.db is <home>/.reax/pm.db (checked in a child process with a temporary home)", () => {
  const fake = mkdtempSync(join(tmpdir(), "reax-fakehome-"));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: fake, USERPROFILE: fake };
    delete env.REAX_HOME;
    const script = `
      const { openPm, reaxHome } = await import(${JSON.stringify(SRC("pm", "db.ts"))});
      const { join } = await import("node:path");
      const home = reaxHome();
      openPm(home);
      process.stdout.write(join(home, "pm.db"));`;
    const c = spawnSync(
      process.execPath,
      ["--conditions=source", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", script],
      { encoding: "utf8", env, timeout: 60_000 },
    );
    assert.equal(c.status, 0, c.stderr);
    assert.equal(c.stdout, join(fake, ".reax", "pm.db"));
    assert.ok(existsSync(join(fake, ".reax", "pm.db")));
  } finally {
    rmSync(fake, { recursive: true, force: true });
  }
});

test("[+RX-PM/store] a migration done by another connection between the version read and the lock is seen inside the transaction: nothing runs twice", () => {
  const h = homeDir();
  try {
    mkdirSync(h.home, { recursive: true });
    const a = new DatabaseSync(h.db);
    let other: string[] = [];
    try {
      assert.equal(Number((a.prepare("PRAGMA user_version").get() as { user_version: number }).user_version), 0);
      // after a reads version 0 and before it locks, b migrates the same file
      MIGRATE_HOOKS.afterSeen = () => {
        delete MIGRATE_HOOKS.afterSeen;
        const b = new DatabaseSync(h.db);
        try {
          assert.equal(migrate(b), PM_VERSION);
        } finally {
          b.close();
        }
        other = schema(h.db);
      };
      assert.equal(migrate(a), PM_VERSION);
    } finally {
      delete MIGRATE_HOOKS.afterSeen;
      a.close();
    }
    assert.ok(other.length > 0, "the other connection migrated");
    assert.equal(version(h.db), PM_VERSION);
    assert.deepEqual(schema(h.db), other);
  } finally {
    h.done();
  }
});

test("[-RX-PM/store] a migration step that fails leaves the previous version and schema", async () => {
  const h = homeDir();
  try {
    openPm(h.home);
    closePm(h.home);
    const before = schema(h.db);
    const db = new DatabaseSync(h.db);
    try {
      const steps = [...MIGRATIONS, { version: PM_VERSION + 1, sql: ["CREATE TABLE pm_probe (x)", "THIS IS NOT SQL"] }];
      assert.throws(() => migrate(db, steps), /syntax error/);
    } finally {
      db.close();
    }
    assert.equal(version(h.db), PM_VERSION);
    assert.deepEqual(schema(h.db), before, "pm_probe was not created");
  } finally {
    h.done();
  }
});

test("[-RX-PM/store] a store newer than this code is refused with store_schema_newer, and its bytes are unchanged", async () => {
  const h = homeDir();
  try {
    await runOperation("session.index", { path: "hello-x86_64-linux-gnu.2.28-g" }, ctxFor(h.home));
    closePm(h.home);
    const db = new DatabaseSync(h.db);
    db.exec(`PRAGMA user_version = ${PM_VERSION + 1}`);
    db.close();
    const files = readdirSync(h.home).sort();
    const bytes = sha(h.db);
    await assert.rejects(
      runOperation("search.symbols", { path: "hello-x86_64-linux-gnu.2.28-g" }, ctxFor(h.home)),
      (e) => isCoreError(e, "store_schema_newer"),
    );
    assert.throws(
      () => openPm(h.home),
      (e) => isCoreError(e, "store_schema_newer"),
    );
    assert.equal(sha(h.db), bytes);
    assert.deepEqual(readdirSync(h.home).sort(), files);
    assert.equal(version(h.db), PM_VERSION + 1);
  } finally {
    h.done();
  }
});

test("[-RX-PM/store] a path outside the workspace is refused, and nothing is stored", async () => {
  const h = homeDir();
  try {
    await assert.rejects(runOperation("session.index", { path: "../manifest.json" }, ctxFor(h.home)), (e) =>
      isCoreError(e, "path_outside_workspace"),
    );
    assert.equal(existsSync(h.db), false);
  } finally {
    h.done();
  }
});

// ------------------------------------------------------------------------------ index and search

test("[+RX-PM/index-search] for every native fixture, search.symbols returns what inventory.symbols reads, and FTS5 finds exactly the names containing the text", async () => {
  const h = homeDir();
  let indexed = 0;
  try {
    for (const [workspace, files] of [
      [BIN, readdirSync(BIN)],
      [EXTRA, readdirSync(EXTRA)],
    ] as const) {
      for (const path of files.filter((f) => f !== "manifest.json").sort()) {
        const want = await expected(workspace, path);
        if (want === null) continue; // not a target inventory.symbols reads
        const ctx = ctxFor(h.home, workspace);
        const r = (await runOperation("session.index", { path }, ctx)).data as {
          digest: string;
          symbols: number;
          reused: boolean;
        };
        assert.equal(r.digest, sha(join(workspace, path)), path);
        assert.equal(r.symbols, want.length, path);
        assert.equal(r.reused, false, path);
        assert.deepEqual(await readBack(ctx, { path }), want, `${path}: read-back`);
        assert.deepEqual(await readBack(ctx, { digest: r.digest }, 1000), want, `${path}: by digest`);
        const fragment = want
          .map(nameOf)
          .find((n) => [...n].length >= 5)
          ?.slice(1, 4);
        for (const q of ["main", "reax_", "lib", ...(fragment ? [fragment] : [])]) {
          const filtered: string[] = want.filter((row) => nameOf(row).toLowerCase().includes(q.toLowerCase()));
          assert.deepEqual(await readBack(ctx, { path, query: q }, 5), filtered, `${path}: query ${q}`);
        }
        const again = (await runOperation("session.index", { path }, ctx)).data as { reused: boolean; symbols: number };
        const rows = counts(h.db).symbols;
        assert.deepEqual(again, { file: path, digest: r.digest, symbols: want.length, reused: true });
        assert.equal(counts(h.db).symbols, rows);
        indexed++;
      }
    }
    assert.ok(indexed >= 15, `${indexed} targets indexed`);
  } finally {
    h.done();
  }
});

test("[-RX-PM/index-search] a digest that was never indexed gives pm_not_indexed (a read creates no store); a query under 3 or over 256 characters, or with NUL, is refused", async () => {
  const h = homeDir();
  try {
    const ctx = ctxFor(h.home);
    await assert.rejects(runOperation("search.symbols", { digest: "0".repeat(64) }, ctx), (e) =>
      isCoreError(e, "pm_not_indexed"),
    );
    assert.deepEqual(readdirSync(h.home), [], "a read created no pm.db");
    await assert.rejects(runOperation("search.symbols", { digest: "0".repeat(64) }, ctx), (e) =>
      isCoreError(e, "pm_not_indexed"),
    );
    await assert.rejects(runOperation("search.symbols", { path: "hello-x86_64-macos-g" }, ctx), (e) =>
      isCoreError(e, "pm_not_indexed"),
    );
    await runOperation("session.index", { path: "hello-x86_64-macos-g" }, ctx);
    for (const query of ["ma", "x".repeat(257), "\u{1F600}".repeat(257), "ma\0in", "main\0"])
      await assert.rejects(
        runOperation("search.symbols", { path: "hello-x86_64-macos-g", query }, ctx),
        (e) => isCoreError(e, "bad_request") && (e.detail as { field: string }).field === "query",
        query,
      );
    await assert.rejects(runOperation("search.symbols", { query: "main" }, ctx), (e) => isCoreError(e, "bad_request"));
  } finally {
    h.done();
  }
});

test("[-RX-PM/index-search] FTS5 syntax in a query is matched literally; a query with NUL is refused with bad_request, never a raw SQLite error", async () => {
  const h = homeDir();
  try {
    const ctx = ctxFor(h.home);
    const path = "hello-x86_64-linux-gnu.2.28-g";
    await runOperation("session.index", { path }, ctx);
    const want = (await expected(BIN, path))!;
    for (const q of [
      'ma"in',
      "mai*",
      "re*x",
      "-main",
      "NEAR",
      "NEAR(main reax)",
      "main:",
      ":ma",
      'reax_" OR "main',
      "reax OR main",
      "^main",
    ]) {
      const filtered = want.filter((row) => nameOf(row).toLowerCase().includes(q.toLowerCase()));
      assert.deepEqual(await readBack(ctx, { path, query: q }), filtered, q);
    }
  } finally {
    h.done();
  }
});

test("[-RX-PM/index-search] a changed file at the same path is a new digest: the old symbols are not returned for it", async () => {
  const h = homeDir();
  const ws = mkdtempSync(join(tmpdir(), "reax-pm-ws-"));
  try {
    const ctx = ctxFor(h.home, ws);
    copyFileSync(join(BIN, "hello-x86_64-linux-gnu.2.28-g"), join(ws, "target"));
    await runOperation("session.index", { path: "target" }, ctx);
    const old = await readBack(ctx, { path: "target" });
    copyFileSync(join(BIN, "shapes-x86_64-linux-gnu.2.28-g"), join(ws, "target"));
    await assert.rejects(runOperation("search.symbols", { path: "target" }, ctx), (e) =>
      isCoreError(e, "pm_not_indexed"),
    );
    await runOperation("session.index", { path: "target" }, ctx);
    const now = await readBack(ctx, { path: "target" });
    assert.deepEqual(now, await expected(ws, "target"));
    assert.ok(
      old.some((r) => !now.includes(r)),
      "the two files differ",
    );
    assert.equal(counts(h.db).targets, 2, "both digests are kept, each with its own symbols");
  } finally {
    h.done();
    rmSync(ws, { recursive: true, force: true });
  }
});

test("[-RX-PM/index-search] a target that is not a binary is refused by session.index, and nothing is stored", async () => {
  const h = homeDir();
  const ws = mkdtempSync(join(tmpdir(), "reax-pm-ws-"));
  try {
    const ctx = ctxFor(h.home, ws);
    mkdirSync(join(ws, "d"));
    writeFileSync(join(ws, "notes.txt"), "not a binary\n");
    copyFileSync(join(BIN, "hello-x86_64-macos-g"), join(ws, "ok"));
    await runOperation("session.index", { path: "ok" }, ctx);
    const before = counts(h.db);
    await assert.rejects(runOperation("session.index", { path: "notes.txt" }, ctx), (e) =>
      isCoreError(e, "bad_request"),
    );
    await assert.rejects(runOperation("session.index", { path: "d" }, ctx), (e) => isCoreError(e, "bad_request"));
    assert.deepEqual(counts(h.db), before);
  } finally {
    h.done();
    rmSync(ws, { recursive: true, force: true });
  }
});

test("a query of 200 emoji (400 UTF-16 units) is accepted: the query limit counts characters", async () => {
  const h = homeDir();
  try {
    const ctx = ctxFor(h.home);
    await runOperation("session.index", { path: "hello-x86_64-macos-g" }, ctx);
    const r = await runOperation(
      "search.symbols",
      { path: "hello-x86_64-macos-g", query: "\u{1F600}".repeat(200) },
      ctx,
    );
    assert.equal((r.data as { page: { total: number } }).page.total, 0);
    const three = await runOperation(
      "search.symbols",
      { path: "hello-x86_64-macos-g", query: "\u{1F600}".repeat(256) },
      ctx,
    );
    assert.equal((three.data as { page: { total: number } }).page.total, 0);
  } finally {
    h.done();
  }
});

test("[+RX-PM/index-search] a target stored by another reader version is replaced: the old rows and their FTS entries are gone", async () => {
  const h = homeDir();
  try {
    const ctx = ctxFor(h.home);
    const path = "shapes-x86_64-linux-gnu.2.28-g";
    const first = (await runOperation("session.index", { path }, ctx)).data as { digest: string; symbols: number };
    const rows = counts(h.db).symbols;
    // an older reader's rows: another version, other names, the FTS index rebuilt to match
    const db = new DatabaseSync(h.db);
    try {
      db.prepare("UPDATE pm_target SET reader_version = 'old' WHERE digest = ?").run(first.digest);
      db.exec("DROP TRIGGER pm_symbol_ad");
      db.prepare("UPDATE pm_symbol SET name = 'zzz_old' || name WHERE target = ?").run(first.digest);
      db.exec("INSERT INTO pm_symbol_fts(pm_symbol_fts) VALUES('rebuild')");
      db.exec(`CREATE TRIGGER pm_symbol_ad AFTER DELETE ON pm_symbol BEGIN
        INSERT INTO pm_symbol_fts(pm_symbol_fts, rowid, name) VALUES ('delete', old.id, old.name);
      END`);
    } finally {
      db.close();
    }
    assert.equal((await readBack(ctx, { path, query: "zzz_old" })).length, rows, "the old rows are searchable");
    const again = (await runOperation("session.index", { path }, ctx)).data as { reused: boolean; symbols: number };
    assert.equal(again.reused, false);
    assert.equal(counts(h.db).symbols, rows);
    const want = (await expected(BIN, path))!;
    assert.deepEqual(await readBack(ctx, { path }), want);
    for (const q of ["main", "reax_", "zzz_old", "old"]) {
      const filtered: string[] = want.filter((row) => nameOf(row).toLowerCase().includes(q.toLowerCase()));
      assert.deepEqual(await readBack(ctx, { path, query: q }), filtered, q);
    }
    assert.deepEqual(await readBack(ctx, { path, query: "zzz_old" }), []);
    closePm(h.home);
    const check = new DatabaseSync(h.db);
    try {
      check.exec("INSERT INTO pm_symbol_fts(pm_symbol_fts) VALUES('integrity-check')");
    } finally {
      check.close();
    }
  } finally {
    h.done();
  }
});

test("[-RX-PM/index-search] a file that changes while it is read is refused with pm_target_changed, and nothing is stored", async () => {
  const h = homeDir();
  const ws = mkdtempSync(join(tmpdir(), "reax-pm-ws-"));
  try {
    const ctx = ctxFor(h.home, ws);
    copyFileSync(join(BIN, "hello-x86_64-macos-g"), join(ws, "ok"));
    await runOperation("session.index", { path: "ok" }, ctx);
    const before = counts(h.db);
    copyFileSync(join(BIN, "hello-x86_64-linux-gnu.2.28-g"), join(ws, "target"));
    PM_HOOKS.afterRead = (abs) => copyFileSync(join(BIN, "shapes-x86_64-linux-gnu.2.28-g"), abs);
    try {
      await assert.rejects(runOperation("session.index", { path: "target" }, ctx), (e) =>
        isCoreError(e, "pm_target_changed"),
      );
    } finally {
      delete PM_HOOKS.afterRead;
    }
    assert.deepEqual(counts(h.db), before);
  } finally {
    h.done();
    rmSync(ws, { recursive: true, force: true });
  }
});

/** A process of the test's own that holds pm.db's write lock until the test lets it go. */
async function lockHolder(file: string) {
  const script = `
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(${JSON.stringify(file)});
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("BEGIN IMMEDIATE");
    db.prepare("INSERT INTO pm_target (digest, size, format, reader, reader_version, indexed_at) VALUES ('lock', 0, 'x', 'x', 'x', 'x')").run();
    process.stdout.write("locked\\n");
    process.stdin.on("data", () => {});
    process.stdin.on("end", () => { db.exec("ROLLBACK"); db.close(); process.exit(0); });
    setTimeout(() => process.exit(2), 30000);`;
  const c = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e", script], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let err = "";
  c.stderr.on("data", (d) => {
    err += d;
  });
  await new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error(`the lock holder did not start: ${err}`)), 20_000);
    c.stdout.on("data", (d) => {
      if (String(d).includes("locked")) {
        clearTimeout(t);
        res();
      }
    });
    c.once("exit", (code) => rej(new Error(`the lock holder exited ${code}: ${err}`)));
  }).catch((e) => {
    // a holder that never reported its lock is ended before the error, so its home can be removed
    c.kill();
    throw e;
  });
  return {
    release: async () => {
      if (c.exitCode !== null || c.signalCode !== null) return;
      const gone = new Promise((r) => c.once("exit", r));
      c.stdin.end();
      const t = setTimeout(() => c.kill("SIGKILL"), 5000);
      await gone;
      clearTimeout(t);
    },
  };
}

test("[+RX-PM/store] a read does not wait for another process's write transaction on a migrated store", async () => {
  const h = homeDir();
  try {
    const path = "hello-x86_64-linux-gnu.2.28-g";
    await runOperation("session.index", { path }, ctxFor(h.home));
    const want = await readBack(ctxFor(h.home), { path });
    closePm(h.home);
    const lock = await lockHolder(h.db);
    try {
      const t0 = Date.now();
      assert.deepEqual(await readBack(ctxFor(h.home), { path }), want);
      assert.ok(Date.now() - t0 < 2000, `the read took ${Date.now() - t0} ms`);
    } finally {
      await lock.release();
    }
  } finally {
    h.done();
  }
});

test("[-RX-PM/store] a write that waits past the busy timeout gives pm_busy (retryable), and stores nothing", async () => {
  const h = homeDir();
  try {
    await runOperation("session.index", { path: "hello-x86_64-macos-g" }, ctxFor(h.home));
    closePm(h.home);
    const before = counts(h.db);
    const lock = await lockHolder(h.db);
    PM_LIMITS.busyTimeoutMs = 200;
    try {
      await assert.rejects(
        runOperation("session.index", { path: "shapes-x86_64-linux-gnu.2.28-g" }, ctxFor(h.home)),
        (e) => {
          assert.ok(isCoreError(e, "pm_busy"), String(e));
          assert.equal(e.retryable, true);
          return true;
        },
      );
    } finally {
      PM_LIMITS.busyTimeoutMs = 5000;
      closePm(h.home);
      await lock.release();
    }
    assert.deepEqual(counts(h.db), before);
  } finally {
    h.done();
  }
});
