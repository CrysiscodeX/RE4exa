"""SQLite storage for dissections: typed nodes, typed edges, full-text search."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

SCHEMA_VERSION = 1

SCHEMA = """
create table if not exists meta (key text primary key, value text not null);
create table if not exists repo (
  id integer primary key,
  name text not null unique,
  url text, commit_sha text, license text, root text not null,
  scanned_at text not null, file_count integer, languages text
);
-- One row per thing worth reasoning about. kind is the top level type; sub refines it.
-- kinds: file, symbol, entrypoint, trigger, lifecycle, state, schema, dependency,
--        doc, claim, concept, capability, finding, product
create table if not exists node (
  id integer primary key,
  repo_id integer references repo(id),
  kind text not null, sub text,
  name text not null, qualname text,
  path text, line integer, end_line integer, lang text,
  doc text, attrs text
);
create index if not exists node_kind on node(kind, sub);
create index if not exists node_repo on node(repo_id, kind);
create index if not exists node_name on node(name);
create unique index if not exists node_identity on node(coalesce(repo_id, 0), kind, coalesce(sub, ''), coalesce(qualname, name), coalesce(path, ''), coalesce(line, 0));
-- kinds: contains, defines, imports, calls, depends_on, fires, implements, uses_env,
--        handles_signal, emits, listens, has_state, tagged, documents, claims, measures,
--        provides, complements, overlaps, gap_in, merges_into, related
create table if not exists edge (
  src integer not null references node(id),
  dst integer not null references node(id),
  kind text not null, weight real not null default 1, attrs text,
  primary key (src, dst, kind)
) without rowid;
create index if not exists edge_dst on edge(dst, kind);
create virtual table if not exists node_fts using fts5(
  name, qualname, path, doc, kind, sub, content='node', content_rowid='id', tokenize='porter unicode61'
);
create trigger if not exists node_ai after insert on node begin
  insert into node_fts(rowid, name, qualname, path, doc, kind, sub) values (new.id, new.name, new.qualname, new.path, new.doc, new.kind, new.sub);
end;
create trigger if not exists node_ad after delete on node begin
  insert into node_fts(node_fts, rowid, name, qualname, path, doc, kind, sub) values ('delete', old.id, old.name, old.qualname, old.path, old.doc, old.kind, old.sub);
end;
create trigger if not exists node_au after update on node begin
  insert into node_fts(node_fts, rowid, name, qualname, path, doc, kind, sub) values ('delete', old.id, old.name, old.qualname, old.path, old.doc, old.kind, old.sub);
  insert into node_fts(rowid, name, qualname, path, doc, kind, sub) values (new.id, new.name, new.qualname, new.path, new.doc, new.kind, new.sub);
end;
create view if not exists v_capability_matrix as
  select r.name as repo, c.name as concept, count(*) as hits, sum(e.weight) as weight
  from edge e join node n on n.id = e.src join node c on c.id = e.dst and c.kind = 'concept'
  join repo r on r.id = n.repo_id
  where e.kind = 'tagged' group by r.name, c.name;
"""


_READONLY: dict[str, sqlite3.Connection] = {}


def connect(path: str | Path, readonly: bool = False) -> sqlite3.Connection:
    path = Path(path)
    if readonly:  # one shared read-only connection per database (the MCP server reuses it across calls)
        key = str(path.resolve())
        if key not in _READONLY:
            con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, check_same_thread=False)
            con.execute("pragma query_only = on")
            con.row_factory = sqlite3.Row
            _READONLY[key] = con
        return _READONLY[key]
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        con = sqlite3.connect(path)
        con.execute("pragma journal_mode = wal")
        con.execute("pragma synchronous = normal")
        con.executescript(SCHEMA)
        con.execute("insert or ignore into meta(key, value) values ('schema_version', ?)", (str(SCHEMA_VERSION),))
    con.row_factory = sqlite3.Row
    return con


class Writer:
    """Batch writer with node identity de-duplication."""

    def __init__(self, con: sqlite3.Connection, repo_id: int | None):
        self.con = con
        self.repo_id = repo_id

    def node(self, kind: str, name: str, *, sub=None, qualname=None, path=None, line=None,
             end_line=None, lang=None, doc=None, attrs=None, repo_id: int | None | str = "self") -> int:
        rid = self.repo_id if repo_id == "self" else repo_id
        row = self.con.execute(
            "select id from node where coalesce(repo_id, 0) = coalesce(?, 0) and kind = ? and coalesce(sub, '') = coalesce(?, '')"
            " and coalesce(qualname, name) = coalesce(?, ?) and coalesce(path, '') = coalesce(?, '') and coalesce(line, 0) = coalesce(?, 0)",
            (rid, kind, sub, qualname, name, path, line)).fetchone()
        if row:
            return row[0]
        cur = self.con.execute(
            "insert into node(repo_id, kind, sub, name, qualname, path, line, end_line, lang, doc, attrs) values (?,?,?,?,?,?,?,?,?,?,?)",
            (rid, kind, sub, name, qualname, path, line, end_line, lang, (doc or None) and doc[:1000],
             json.dumps(attrs, separators=(",", ":"), default=str) if attrs else None))
        return cur.lastrowid

    def edge(self, src: int, dst: int, kind: str, weight: float = 1.0, attrs=None) -> None:
        if src == dst:
            return
        self.con.execute(
            "insert into edge(src, dst, kind, weight, attrs) values (?,?,?,?,?)"
            " on conflict(src, dst, kind) do update set weight = edge.weight + excluded.weight",
            (src, dst, kind, weight, json.dumps(attrs, separators=(",", ":")) if attrs else None))
