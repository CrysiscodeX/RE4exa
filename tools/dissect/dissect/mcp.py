"""Minimal MCP stdio server (JSON-RPC 2.0, newline-delimited) exposing dissect's
read-only commands as tools. No dependencies beyond the standard library."""

from __future__ import annotations

import argparse
import io
import json
import sys
from contextlib import redirect_stdout

from . import __version__

PROTOCOL = "2025-06-18"
STR, INT = {"type": "string"}, {"type": "integer", "minimum": 0}
TOOLS = {
    "dissect_stats": ("Repositories in the database and node/edge counts by kind.", {}, []),
    "dissect_search": ("Full-text search (FTS5) over node names, qualnames, paths and docs. Filter by kind/sub/repo.",
                       {"query": STR, "kind": STR, "sub": STR, "repo": STR, "limit": INT, "offset": INT}, ["query"]),
    "dissect_node": ("One node and its incoming/outgoing edges. ref = id, qualname (e.g. 'mcp-tool:open_binary') or 'repo:qualname'.",
                     {"ref": STR, "edge": STR, "limit": INT}, ["ref"]),
    "dissect_list": ("List nodes of one kind (entrypoint, trigger, lifecycle, state, schema, claim, concept, dependency, finding) ranked by degree.",
                     {"kind": STR, "sub": STR, "repo": STR, "limit": INT, "offset": INT}, ["kind"]),
    "dissect_query": ("Read-only SQL (SELECT/WITH) over tables repo, node, edge, node_fts and view v_capability_matrix.",
                      {"sql": STR, "limit": INT, "offset": INT}, ["sql"]),
    "dissect_matrix": ("Cross-repository capability matrix: per concept, the share of each repo's concept weight and the leading repo.", {}, []),
    "dissect_path": ("Shortest undirected connection between two node refs, optionally restricted to edge kinds (comma-separated).",
                     {"src": STR, "dst": STR, "edges": STR}, ["src", "dst"]),
    "dissect_describe": ("Contract: node and edge kinds, concept taxonomy and SQL schema.", {}, []),
}
DEFAULTS = {"limit": 25, "offset": 0, "kind": None, "sub": None, "repo": None, "edge": None, "edges": None, "max_nodes": 200_000}


def _run(db: str, max_bytes: int, name: str, args: dict) -> tuple[str, bool]:
    from . import cli
    fn = getattr(cli, "cmd_" + name.removeprefix("dissect_"))
    ns = argparse.Namespace(db=db, **{**DEFAULTS, **args})
    if name == "dissect_list" and "limit" not in args:
        ns.limit = 50
    result = fn(ns)
    buf = io.StringIO()
    with redirect_stdout(buf):
        cli.emit(result, max_bytes)
    return buf.getvalue().strip(), isinstance(result, dict) and "error" in result


def serve(db: str, max_bytes: int) -> int:
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        mid, method = msg.get("id"), msg.get("method")
        if mid is None:  # notification
            continue
        if method == "initialize":
            res = {"protocolVersion": PROTOCOL, "capabilities": {"tools": {"listChanged": False}},
                   "serverInfo": {"name": "dissect", "version": __version__},
                   "instructions": "Start with dissect_stats or dissect_matrix, find nodes with dissect_search, then expand with dissect_node / dissect_path. All tools are read-only."}
        elif method == "tools/list":
            res = {"tools": [{"name": n, "description": d, "annotations": {"readOnlyHint": True, "openWorldHint": False},
                              "inputSchema": {"type": "object", "properties": props, "required": req, "additionalProperties": False}}
                             for n, (d, props, req) in TOOLS.items()]}
        elif method == "tools/call":
            name, args = msg["params"]["name"], msg["params"].get("arguments") or {}
            if name not in TOOLS:
                res = {"isError": True, "content": [{"type": "text", "text": json.dumps({"error": "unknown_tool", "tool": name})}]}
            else:
                try:
                    text, is_error = _run(db, max_bytes, name, args)
                    res = {"isError": is_error, "content": [{"type": "text", "text": text}]}
                except Exception as e:  # report, never crash the server
                    res = {"isError": True, "content": [{"type": "text", "text": json.dumps({"error": type(e).__name__, "message": str(e)[:500]})}]}
        elif method == "ping":
            res = {}
        else:
            sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"unknown method {method}"}}) + "\n")
            sys.stdout.flush()
            continue
        sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": mid, "result": res}) + "\n")
        sys.stdout.flush()
    return 0
