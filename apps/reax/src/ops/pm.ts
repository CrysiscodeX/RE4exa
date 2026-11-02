// The program model's operations (PM, W1-3; D-23):
// - session.index stores what inventory.symbols reads from a target (every slice, every page) in
//   pm.db under the SHA-256 of the file's bytes. The same digest with the same reader version is not
//   read again (reused); another reader version replaces that target's rows in one transaction.
// - search.symbols reads a stored target back, paged, in the reader's order; with `query` it returns
//   the symbols whose names contain the text (FTS5, trigram), the query bound as one quoted phrase
//   so FTS5 syntax in it is literal. A query containing NUL is refused (bad_request): FTS5's parser
//   stops at NUL, so the phrase could not be closed.
// Both run in process (no child process, so no sandbox), on the reax home's pm.db (OpContext.home,
// else $REAX_HOME, else <home>/.reax).
import { createHash } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";
import { CoreError } from "@re4exa/core/errors";
import "../errors.ts";
import type { DatabaseSync } from "node:sqlite";
import { openPm, pmCall, reaxHome } from "../pm/db.ts";
import { target } from "./file.ts";
import { inventoryNative } from "./native.ts";
import { PAGE_INPUT, PAGE_MAX } from "./page.ts";
import { checkInput } from "./schema.ts";
import { inventorySymbols } from "./symbols.ts";
import type { JsonSchema, OpContext, Operation, OpResult } from "./types.ts";

const ALL = ["linux", "darwin", "win32"] as const;
const PATH: JsonSchema = { type: "string", description: "File path inside the workspace", maxLength: 4096 };
const READER = "inventory.symbols";
export const QUERY_MIN = 3;
export const QUERY_MAX = 256;
const MAX_SLICES = 64;
const MAX_PAGES = 10_000;
const CHUNK = 1 << 20;

/** SHA-256 of a file, read in 1 MiB chunks. */
function digestFile(abs: string): { digest: string; size: number } {
  const h = createHash("sha256");
  const fd = openSync(abs, "r");
  const buf = Buffer.alloc(CHUNK);
  let size = 0;
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, CHUNK, size);
      if (n === 0) break;
      h.update(buf.subarray(0, n));
      size += n;
    }
  } finally {
    closeSync(fd);
  }
  return { digest: h.digest("hex"), size };
}

interface Row {
  name: string;
  addr: string | null;
  size: number | null;
  kind: string;
  bind: string;
  defined: boolean;
  section: string | null;
  library: string | null;
  source: string;
}

/** Every symbol of one slice, all pages, through the inventory.symbols operation itself. */
async function readSlice(ctx: OpContext, path: string, arch: string): Promise<{ format: string; rows: Row[] }> {
  const rows: Row[] = [];
  let format = "";
  for (let offset = 0, n = 0; n < MAX_PAGES; n++) {
    const args = checkInput(READER, inventorySymbols.input, { path, arch, offset, limit: PAGE_MAX });
    const d = (await inventorySymbols.run(ctx, args)).data as {
      format: string;
      items: Row[];
      page: { next: number | null };
    };
    format = d.format;
    rows.push(...d.items);
    if (d.page.next === null) break;
    offset = d.page.next;
  }
  return { format, rows };
}

/** Test seam: called after the reads and before the second hash (a test changes the file there). */
export const PM_HOOKS: { afterRead?: (abs: string) => void } = {};

const sliceCount = (db: DatabaseSync, digest: string) =>
  Number((db.prepare("SELECT count(*) AS n FROM pm_symbol WHERE target = ?").get(digest) as { n: number }).n);

export const sessionIndex: Operation = {
  tool: "session",
  name: "session.index",
  summary:
    "Store a target's symbols (inventory.symbols, every slice and page) in the program model, keyed by the SHA-256 of its bytes, for search.symbols. Indexing the same bytes again with the same reader is a no-op (reused).",
  input: {
    type: "object",
    properties: { path: PATH },
    required: ["path"],
    additionalProperties: false,
  },
  effect: "write",
  cost: "medium",
  untrusted: true,
  platforms: [...ALL],
  examples: [
    {
      title: "Index a C program's symbols",
      workspace: "fixtures",
      args: { path: "hello-x86_64-linux-gnu.2.28-g" },
      expect: {
        digest: "b208698b31ba7dccf93d56b6376a132ca047db873af1c6311196ba1af802c293",
        symbols: 24,
      },
    },
  ],
  covers: [],
  async run(ctx, args): Promise<OpResult> {
    // loaded here, not at module load: probes.ts imports the registry, which imports this module
    const { REAX_VERSION } = await import("./probes.ts");
    const t = target(ctx, args.path);
    const { digest, size } = digestFile(t.abs);
    const db = openPm(reaxHome(ctx.home));
    const have = pmCall(() => db.prepare("SELECT reader_version FROM pm_target WHERE digest = ?").get(digest)) as
      | { reader_version: string }
      | undefined;
    if (have?.reader_version === REAX_VERSION) {
      const n = pmCall(() => sliceCount(db, digest));
      return {
        data: { file: t.rel, digest, symbols: n, reused: true },
        text: `${t.rel}: already indexed as ${digest} (${n} symbols)`,
        coverage: "complete",
        limitations: [],
      };
    }
    // read everything first: a target the reader refuses stores nothing
    const native = (
      await inventoryNative.run(
        ctx,
        checkInput("inventory.native", inventoryNative.input, { path: args.path, limit: 1 }),
      )
    ).data as { slices: { arch: string }[] };
    const slices: { arch: string; rows: Row[] }[] = [];
    let format = "";
    for (const s of native.slices.slice(0, MAX_SLICES)) {
      const r = await readSlice(ctx, String(args.path), s.arch);
      format = r.format;
      slices.push({ arch: s.arch, rows: r.rows });
    }
    // the bytes read must be the bytes hashed: hash again, and store nothing if the file changed
    PM_HOOKS.afterRead?.(t.abs);
    const now = digestFile(t.abs).digest;
    if (now !== digest) throw new CoreError("pm_target_changed", { path: t.rel, before: digest, after: now });
    const ins = db.prepare(
      "INSERT INTO pm_symbol (target, slice, arch, name, addr, size, kind, bind, defined, section, library, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    pmCall(() => db.exec("BEGIN IMMEDIATE"));
    try {
      db.prepare("DELETE FROM pm_symbol WHERE target = ?").run(digest);
      db.prepare("DELETE FROM pm_target WHERE digest = ?").run(digest);
      db.prepare(
        "INSERT INTO pm_target (digest, size, format, reader, reader_version, indexed_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(digest, size, format, READER, REAX_VERSION, new Date().toISOString());
      slices.forEach((s, i) => {
        for (const x of s.rows)
          ins.run(
            digest,
            i,
            s.arch,
            x.name,
            x.addr,
            x.size,
            x.kind,
            x.bind,
            x.defined ? 1 : 0,
            x.section,
            x.library,
            x.source,
          );
      });
      pmCall(() => db.exec("COMMIT"));
    } catch (e) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw e;
    }
    const n = slices.reduce((a, s) => a + s.rows.length, 0);
    return {
      data: { file: t.rel, digest, symbols: n, reused: false },
      text: `${t.rel}: indexed ${n} symbols as ${digest}`,
      coverage: native.slices.length > MAX_SLICES ? "partial" : "complete",
      limitations:
        native.slices.length > MAX_SLICES
          ? [`only the first ${MAX_SLICES} of ${native.slices.length} slices are indexed`]
          : [],
    };
  },
};

/** An FTS5 query that matches `text` literally: one quoted phrase, inner quotes doubled. */
export const ftsPhrase = (text: string) => `"${text.replaceAll('"', '""')}"`;

export const searchSymbols: Operation = {
  tool: "read",
  name: "search.symbols",
  summary:
    "Read back the symbols session.index stored for a target (by path or digest), paged in the reader's order; with query, only those whose names contain the text (case-insensitive, 3 to 256 characters, matched literally; a query containing NUL is refused).",
  input: {
    type: "object",
    properties: {
      path: PATH,
      digest: { type: "string", maxLength: 64, description: "The target's SHA-256 (hex), instead of path" },
      query: {
        type: "string",
        // the schema counts UTF-16 units; the 3 to 256 limit is checked in characters (code points)
        maxLength: QUERY_MAX * 2,
        description: "Keep names containing this text (3 to 256 characters, no NUL)",
      },
      ...PAGE_INPUT,
    },
    additionalProperties: false,
  },
  effect: "read",
  cost: "cheap",
  untrusted: true,
  platforms: [...ALL],
  examples: [
    {
      title: "The indexed symbols of a C program whose names contain reax_",
      workspace: "fixtures",
      args: { path: "hello-x86_64-linux-gnu.2.28-g", query: "reax_" },
      expect: { page: { total: 2 } },
    },
  ],
  covers: [],
  async run(ctx, args): Promise<OpResult> {
    if ((args.path === undefined) === (args.digest === undefined))
      throw new CoreError("bad_request", { field: "path", why: "exactly one of path or digest" });
    let digest: string;
    let file: string | null = null;
    if (args.path !== undefined) {
      const t = target(ctx, args.path);
      file = t.rel;
      digest = digestFile(t.abs).digest;
    } else {
      digest = String(args.digest).toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(digest)) throw new CoreError("bad_request", { field: "digest", why: "64 hex digits" });
    }
    const q = args.query as string | undefined;
    if (q !== undefined) {
      const chars = [...q].length;
      if (chars < QUERY_MIN || chars > QUERY_MAX)
        throw new CoreError("bad_request", { field: "query", why: `${QUERY_MIN} to ${QUERY_MAX} characters` });
      // FTS5 stops reading the query at NUL, so the quoted phrase would never be closed
      if (q.includes("\u0000")) throw new CoreError("bad_request", { field: "query", why: "no NUL character" });
    }
    // a read never creates the store
    const db = openPm(reaxHome(ctx.home), undefined, { create: false });
    if (!db || !pmCall(() => db.prepare("SELECT 1 FROM pm_target WHERE digest = ?").get(digest)))
      throw new CoreError("pm_not_indexed", { digest, ...(file ? { path: file } : {}) });
    const offset = (args.offset as number | undefined) ?? 0;
    const limit = (args.limit as number | undefined) ?? 200;
    const cols = "s.arch, s.name, s.addr, s.size, s.kind, s.bind, s.defined, s.section, s.library, s.source";
    // count and rows in one read transaction, so the total matches the items
    pmCall(() => db.exec("BEGIN"));
    let count: unknown;
    let rows: unknown;
    try {
      [count, rows] = pmCall(() =>
        q === undefined
          ? [
              db.prepare("SELECT count(*) AS n FROM pm_symbol s WHERE s.target = ?").get(digest),
              db
                .prepare(`SELECT ${cols} FROM pm_symbol s WHERE s.target = ? ORDER BY s.id LIMIT ? OFFSET ?`)
                .all(digest, limit, offset),
            ]
          : [
              db
                .prepare(
                  "SELECT count(*) AS n FROM pm_symbol_fts f JOIN pm_symbol s ON s.id = f.rowid WHERE f.pm_symbol_fts MATCH ? AND s.target = ?",
                )
                .get(ftsPhrase(q), digest),
              db
                .prepare(
                  `SELECT ${cols} FROM pm_symbol_fts f JOIN pm_symbol s ON s.id = f.rowid WHERE f.pm_symbol_fts MATCH ? AND s.target = ? ORDER BY s.id LIMIT ? OFFSET ?`,
                )
                .all(ftsPhrase(q), digest, limit, offset),
            ],
      );
      pmCall(() => db.exec("COMMIT"));
    } finally {
      if (db.isTransaction) db.exec("ROLLBACK");
    }
    const total = Number((count as { n: number }).n);
    const items = (rows as (Omit<Row, "defined"> & { arch: string; defined: number })[]).map((r) => ({
      ...r,
      defined: r.defined === 1,
    }));
    const end = offset + items.length;
    const page = { offset, limit, total, next: end < total ? end : null };
    return {
      data: { file, digest, query: q ?? null, items, page },
      text: [
        `${file ?? digest}: ${total} symbols${q !== undefined ? ` containing "${q}"` : ""}${page.next !== null ? `; next offset ${page.next}` : ""}`,
        ...items.map((x) => `  ${x.addr ?? "undefined"}  ${x.kind} ${x.bind}  ${x.name}  [${x.arch}]`),
      ].join("\n"),
      coverage: "complete",
      limitations: [],
    };
  },
};
