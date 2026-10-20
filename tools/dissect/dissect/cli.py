"""dissect: take repositories apart into a queryable knowledge graph.

Agent-first: every command prints one JSON document (or JSON lines), output is
bounded by --max-bytes with an explicit `truncated` marker and `next_offset`, and
`dissect describe` returns the full command and schema contract.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import deque
from pathlib import Path

from . import __version__
from .concepts import CONCEPTS
from .db import SCHEMA, connect

DEFAULT_DB = "dissection.db"


def emit(obj, max_bytes: int = 200_000) -> None:
    text = json.dumps(obj, ensure_ascii=False, default=str)
    if len(text.encode()) > max_bytes and isinstance(obj, dict) and isinstance(obj.get("rows"), list):
        rows = obj["rows"]
        lo, hi = 0, len(rows)
        while lo < hi:  # largest prefix of rows that fits
            mid = (lo + hi + 1) // 2
            trial = dict(obj, rows=rows[:mid], truncated=True, next_offset=obj.get("offset", 0) + mid)
            if len(json.dumps(trial, ensure_ascii=False, default=str).encode()) <= max_bytes:
                lo = mid
            else:
                hi = mid - 1
        obj = dict(obj, rows=rows[:lo], truncated=True, next_offset=obj.get("offset", 0) + lo, returned=lo)
        text = json.dumps(obj, ensure_ascii=False, default=str)
    sys.stdout.write(text + "\n")


def rows_of(cur) -> list[dict]:
    out = []
    for r in cur.fetchall():
        d = dict(r)
        if isinstance(d.get("attrs"), str):
            try:
                d["attrs"] = json.loads(d["attrs"])
            except ValueError:
                pass
        out.append(d)
    return out


# ---- commands (each returns a JSON-serializable dict) ---------------------------------

def cmd_scan(a) -> dict:
    from .extract import Scanner
    con = connect(a.db)
    results = {}
    for spec in a.roots:
        root, _, name = spec.partition("=")
        root = Path(root)
        name = name or root.name
        results[name] = Scanner(con, root, name, log=lambda *x: print(*x, file=sys.stderr)).scan()
    con.execute("insert into node_fts(node_fts) values ('optimize')")
    con.commit()
    return {"db": str(a.db), "scanned": results}


def cmd_import_mcp(a) -> dict:
    """Load a live MCP tools/list result (JSON with a `tools` array) as exact entrypoints."""
    from .concepts import CONCEPTS as C, tag
    from .db import Writer
    con = connect(a.db)
    row = con.execute("select id from repo where name = ?", (a.repo,)).fetchone()
    if row is None:
        return {"error": "unknown_repo", "repo": a.repo, "hint": "scan the repository first"}
    w = Writer(con, row[0])
    tools = json.loads(Path(a.catalog).read_text())["tools"]
    for t in tools:
        eid = w.node("entrypoint", t["name"], sub="mcp-tool", qualname=f"mcp-tool:{t['name']}", doc=(t.get("description") or "")[:1000],
                     attrs={"annotations": t.get("annotations"), "input_bytes": len(json.dumps(t.get("inputSchema", {}))),
                            "output_bytes": len(json.dumps(t.get("outputSchema", {}))), "source": "tools/list"})
        for concept in tag(t["name"], (t.get("description") or "")[:300]):
            cid = w.node("concept", concept, sub=C[concept][0], doc=C[concept][1], repo_id=None)
            w.edge(eid, cid, "tagged", 3.0)
    con.commit()
    return {"repo": a.repo, "imported_tools": len(tools)}


def cmd_stats(a) -> dict:
    con = connect(a.db, readonly=True)
    q = lambda sql, *p: rows_of(con.execute(sql, p))
    return {
        "repos": q("select name, url, commit_sha, license, file_count, languages from repo order by name"),
        "nodes_by_kind": q("select kind, sub, count(*) n from node group by kind, sub order by n desc limit 80"),
        "edges_by_kind": q("select kind, count(*) n from edge group by kind order by n desc"),
        "totals": q("select (select count(*) from node) nodes, (select count(*) from edge) edges, (select count(*) from repo) repos")[0],
    }


def cmd_search(a) -> dict:
    con = connect(a.db, readonly=True)
    where, params = ["node_fts match ?"], [a.query]
    if a.kind:
        where.append("n.kind = ?"); params.append(a.kind)
    if a.sub:
        where.append("n.sub = ?"); params.append(a.sub)
    if a.repo:
        where.append("r.name = ?"); params.append(a.repo)
    sql = (f"select n.id, r.name repo, n.kind, n.sub, n.name, n.qualname, n.path, n.line, substr(n.doc, 1, 240) doc, round(bm25(node_fts), 3) score"
           f" from node_fts join node n on n.id = node_fts.rowid left join repo r on r.id = n.repo_id where {' and '.join(where)}"
           f" order by score limit ? offset ?")
    return {"query": a.query, "offset": a.offset, "rows": rows_of(con.execute(sql, (*params, a.limit, a.offset)))}


def _resolve(con, ref: str) -> dict | None:
    """A ref is a node id, an exact qualname/name (e.g. mcp-tool:open_binary), or repo:qualname."""
    base = "select n.*, r.name repo from node n left join repo r on r.id = n.repo_id where "
    if ref.isdigit():
        return rows_of_one(con.execute(base + "n.id = ?", (int(ref),)).fetchone())
    row = con.execute(base + "n.qualname = ? or n.name = ? order by n.kind = 'file', n.id limit 1", (ref, ref)).fetchone()
    if row is None and ":" in ref:
        repo, rest = ref.split(":", 1)
        row = con.execute(base + "(n.qualname = ? or n.name = ?) and r.name = ? order by n.kind = 'file', n.id limit 1", (rest, rest, repo)).fetchone()
    return rows_of_one(row)


def rows_of_one(row):
    if row is None:
        return None
    d = dict(row)
    if isinstance(d.get("attrs"), str):
        d["attrs"] = json.loads(d["attrs"])
    return d


def cmd_node(a) -> dict:
    con = connect(a.db, readonly=True)
    node = _resolve(con, a.ref)
    if node is None:
        return {"error": "not_found", "ref": a.ref, "hint": "use `dissect search` to find a node id or qualname"}
    nb = "select e.kind, e.weight, n.id, n.kind node_kind, n.sub, n.name, n.qualname, n.path, n.line, r.name repo from edge e join node n on n.id = e.{other} left join repo r on r.id = n.repo_id where e.{self} = ? {k} order by e.weight desc, n.id limit ?"
    k = "and e.kind = ?" if a.edge else ""
    p = (node["id"], a.edge, a.limit) if a.edge else (node["id"], a.limit)
    return {"node": node,
            "out": rows_of(con.execute(nb.format(other="dst", self="src", k=k), p)),
            "in": rows_of(con.execute(nb.format(other="src", self="dst", k=k), p))}


def cmd_query(a) -> dict:
    sql = a.sql.strip().rstrip(";")
    if not re.match(r"(?is)^\s*(select|with|explain)\b", sql):
        return {"error": "read_only", "message": "only SELECT/WITH/EXPLAIN statements are allowed"}
    con = connect(a.db, readonly=True)
    cur = con.execute(f"select * from ({sql}) limit ? offset ?", (a.limit, a.offset))
    return {"offset": a.offset, "columns": [d[0] for d in cur.description], "rows": rows_of(cur)}


def cmd_matrix(a) -> dict:
    con = connect(a.db, readonly=True)
    rows = rows_of(con.execute("select repo, concept, hits, round(weight, 1) weight from v_capability_matrix"))
    repos = sorted({r["repo"] for r in rows})
    concepts = sorted({r["concept"] for r in rows})
    w = {(r["repo"], r["concept"]): r["weight"] for r in rows}
    totals = {r: sum(w.get((r, c), 0) for c in concepts) or 1 for r in repos}
    # share of each repo's tagged weight that goes to the concept, so large repos do not dominate
    share = {(r, c): round(100 * w.get((r, c), 0) / totals[r], 2) for r in repos for c in concepts}
    leaders = {c: max(repos, key=lambda r: share[(r, c)]) for c in concepts}
    return {"metric": "percent of each repo's concept weight", "repos": repos,
            "rows": [{"concept": c, "domain": CONCEPTS.get(c, ("?",))[0], "leader": leaders[c], **{r: share[(r, c)] for r in repos}} for c in concepts]}


def cmd_path(a) -> dict:
    con = connect(a.db, readonly=True)
    src, dst = _resolve(con, a.src), _resolve(con, a.dst)
    if not src or not dst:
        return {"error": "not_found", "src": bool(src), "dst": bool(dst)}
    kinds = a.edges.split(",") if a.edges else None
    prev = {src["id"]: None}
    q = deque([src["id"]])
    while q and dst["id"] not in prev and len(prev) < a.max_nodes:
        cur = q.popleft()
        sql = "select dst nb, kind from edge where src = ? union all select src nb, kind from edge where dst = ?"
        for nb, kind in con.execute(sql, (cur, cur)):
            if nb not in prev and (kinds is None or kind in kinds):
                prev[nb] = (cur, kind)
                q.append(nb)
    if dst["id"] not in prev:
        return {"found": False, "explored": len(prev)}
    chain, cur = [], dst["id"]
    while prev[cur]:
        p, kind = prev[cur]
        chain.append(kind)
        cur = p
    ids, cur = [dst["id"]], dst["id"]
    while prev[cur]:
        cur = prev[cur][0]
        ids.append(cur)
    ids.reverse()
    nodes = {r["id"]: r for r in rows_of(con.execute(f"select n.id, n.kind, n.sub, n.name, n.qualname, r.name repo from node n left join repo r on r.id = n.repo_id where n.id in ({','.join('?' * len(ids))})", ids))}
    return {"found": True, "hops": len(ids) - 1, "path": [nodes[i] for i in ids], "edge_kinds": list(reversed(chain))}


def cmd_list(a) -> dict:
    con = connect(a.db, readonly=True)
    where, params = ["n.kind = ?"], [a.kind]
    if a.sub:
        where.append("n.sub = ?"); params.append(a.sub)
    if a.repo:
        where.append("r.name = ?"); params.append(a.repo)
    sql = (f"select n.id, r.name repo, n.sub, n.name, n.qualname, n.path, n.line, substr(n.doc,1,200) doc,"
           f" (select count(*) from edge e where e.src = n.id or e.dst = n.id) degree"
           f" from node n left join repo r on r.id = n.repo_id where {' and '.join(where)} order by degree desc, n.id limit ? offset ?")
    return {"kind": a.kind, "offset": a.offset, "rows": rows_of(con.execute(sql, (*params, a.limit, a.offset)))}


def cmd_describe(a) -> dict:
    return {
        "tool": "dissect", "version": __version__,
        "purpose": "Take repositories apart into one SQLite knowledge graph of files, symbols, entrypoints, triggers, lifecycles, states, schemas, dependencies, docs, claims and concepts; query it with FTS, SQL, neighbors, paths and a cross-repo capability matrix.",
        "commands": {name: (p.description or "") for name, p in SUBPARSERS.items()},
        "node_kinds": ["file", "symbol", "entrypoint", "trigger", "lifecycle", "state", "schema", "dependency", "doc", "claim", "concept", "capability", "finding", "product"],
        "edge_kinds": ["contains", "defines", "imports", "calls", "depends_on", "fires", "implemented_by", "implements", "uses_env", "handles_signal", "emits", "listens", "uses_timer", "has_state", "tagged", "documents", "claims", "measures", "provides", "complements", "overlaps", "gap_in", "merges_into", "related"],
        "concepts": {k: {"domain": v[0], "description": v[1]} for k, v in CONCEPTS.items()},
        "schema_sql": SCHEMA,
        "conventions": {"output": "one JSON document per command", "budget": "--max-bytes truncates `rows` and sets truncated/next_offset",
                        "refs": "a node ref is an id, a qualname (e.g. mcp-tool:open_binary) or repo:qualname"},
    }


SUBPARSERS: dict[str, argparse.ArgumentParser] = {}


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="dissect", description=__doc__.split("\n")[0])
    p.add_argument("--db", default=DEFAULT_DB, help="SQLite database path")
    p.add_argument("--max-bytes", type=int, default=200_000, help="output budget in bytes")
    p.add_argument("--version", action="version", version=__version__)
    sub = p.add_subparsers(dest="cmd", required=True)

    def add(name, fn, desc):
        sp = sub.add_parser(name, description=desc, help=desc)
        sp.set_defaults(fn=fn)
        SUBPARSERS[name] = sp
        return sp

    s = add("scan", cmd_scan, "Dissect one or more repository roots (ROOT or ROOT=name) into the database")
    s.add_argument("roots", nargs="+")
    s = add("import-mcp", cmd_import_mcp, "Import a live MCP tools/list JSON as exact mcp-tool entrypoints of a scanned repo")
    s.add_argument("repo"); s.add_argument("catalog")
    add("stats", cmd_stats, "Repositories and node/edge counts by kind")
    s = add("search", cmd_search, "Full-text search over node names, paths and docs (FTS5 syntax)")
    s.add_argument("query"); s.add_argument("--kind"); s.add_argument("--sub"); s.add_argument("--repo")
    s.add_argument("--limit", type=int, default=25); s.add_argument("--offset", type=int, default=0)
    s = add("node", cmd_node, "One node with its incoming and outgoing edges")
    s.add_argument("ref"); s.add_argument("--edge"); s.add_argument("--limit", type=int, default=50)
    s = add("list", cmd_list, "List nodes of a kind (entrypoint, trigger, lifecycle, schema, claim, ...) ranked by degree")
    s.add_argument("kind"); s.add_argument("--sub"); s.add_argument("--repo")
    s.add_argument("--limit", type=int, default=50); s.add_argument("--offset", type=int, default=0)
    s = add("query", cmd_query, "Read-only SQL (SELECT/WITH) against the schema in `describe`")
    s.add_argument("sql"); s.add_argument("--limit", type=int, default=200); s.add_argument("--offset", type=int, default=0)
    add("matrix", cmd_matrix, "Cross-repo capability matrix: share of each repo's concept weight per concept")
    s = add("path", cmd_path, "Shortest connection between two nodes (undirected BFS)")
    s.add_argument("src"); s.add_argument("dst"); s.add_argument("--edges", help="comma-separated edge kinds to follow")
    s.add_argument("--max-nodes", type=int, default=200_000)
    add("describe", cmd_describe, "Machine-readable contract: commands, node/edge kinds, concepts, SQL schema")
    add("mcp", None, "Serve the read-only commands as MCP tools over stdio")
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if args.cmd == "mcp":
        from .mcp import serve
        return serve(args.db, args.max_bytes)
    result = args.fn(args)
    emit(result, args.max_bytes)
    return 1 if isinstance(result, dict) and "error" in result else 0
