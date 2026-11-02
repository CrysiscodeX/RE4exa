// The program model's schema (pm.db), as versioned migrations. Each step is a list of SQL
// statements; db.ts applies every pending step and the user_version bump in one transaction.
// - pm_target: one row per target file, keyed by the SHA-256 of its bytes (the same file at another
//   path is the same target; a changed file is a new one).
// - pm_symbol: the symbols a reader found, in the reader's order (id), per slice.
// - pm_symbol_fts: an FTS5 index over symbol names, external content (pm_symbol), trigram
//   tokenizer (case-insensitive substring search for queries of 3 or more characters), kept in step
//   by insert and delete triggers.

export interface Migration {
  version: number;
  sql: string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: [
      `CREATE TABLE pm_target (
        digest TEXT PRIMARY KEY,
        size INTEGER NOT NULL,
        format TEXT NOT NULL,
        reader TEXT NOT NULL,
        reader_version TEXT NOT NULL,
        indexed_at TEXT NOT NULL
      )`,
      `CREATE TABLE pm_symbol (
        id INTEGER PRIMARY KEY,
        target TEXT NOT NULL REFERENCES pm_target(digest) ON DELETE CASCADE,
        slice INTEGER NOT NULL,
        arch TEXT NOT NULL,
        name TEXT NOT NULL,
        addr TEXT,
        size INTEGER,
        kind TEXT NOT NULL,
        bind TEXT NOT NULL,
        defined INTEGER NOT NULL,
        section TEXT,
        library TEXT,
        source TEXT NOT NULL
      )`,
      "CREATE INDEX pm_symbol_target ON pm_symbol(target)",
      `CREATE VIRTUAL TABLE pm_symbol_fts USING fts5(
        name, content='pm_symbol', content_rowid='id', tokenize='trigram'
      )`,
      `CREATE TRIGGER pm_symbol_ai AFTER INSERT ON pm_symbol BEGIN
        INSERT INTO pm_symbol_fts(rowid, name) VALUES (new.id, new.name);
      END`,
      `CREATE TRIGGER pm_symbol_ad AFTER DELETE ON pm_symbol BEGIN
        INSERT INTO pm_symbol_fts(pm_symbol_fts, rowid, name) VALUES ('delete', old.id, old.name);
      END`,
    ],
  },
];

/** The version this code writes: the last migration's. */
export const PM_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;
