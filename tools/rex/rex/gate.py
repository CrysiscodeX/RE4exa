"""Necessity gate (ponytail's ladder, automated where it can be).

Before an agent builds something, ask: does it need to exist, does the codebase
already have it, does the standard library or an installed dependency cover it?
The gate answers the "already have it" rung from a dissect database and returns
the ladder with the evidence it found, so the agent decides with facts.
"""

from __future__ import annotations

import re
import sqlite3
from pathlib import Path

LADDER = [
    "Does it need to exist? Skip what nobody asked for and say so in one line.",
    "Is it already in the codebase (or a sibling repository)? Reuse it the way the surrounding code does.",
    "Does the standard library or platform cover it?",
    "Does an installed dependency cover it? Never add a dependency for a few lines.",
    "Can it be one line a reader gets at a glance?",
    "Otherwise: the minimum code that works, plus one small test for logic with branches.",
    "Never cut: validation at trust boundaries, error handling that prevents data loss, security, accessibility.",
]


def _fts_query(text: str) -> str:
    words = [w for w in re.findall(r"[A-Za-z][A-Za-z0-9]{2,}", text) if w.lower() not in {"the", "and", "for", "with", "that", "this", "from", "into", "tool", "function"}]
    return " OR ".join(f'"{w}"' for w in words[:8]) or '""'


def check(proposal: str, dissect_db: str | None, limit: int = 10) -> dict:
    found, capabilities, deps = [], [], []
    if dissect_db and Path(dissect_db).exists():
        con = sqlite3.connect(f"file:{dissect_db}?mode=ro", uri=True)
        con.row_factory = sqlite3.Row
        q = _fts_query(proposal)
        found = [dict(r) for r in con.execute(
            "select n.id, r.name repo, n.kind, n.sub, n.qualname, n.path, n.line, substr(n.doc,1,160) doc from node_fts join node n on n.id = node_fts.rowid"
            " left join repo r on r.id = n.repo_id where node_fts match ? and n.kind in ('symbol','entrypoint','schema') and n.path not like '%test%'"
            " order by bm25(node_fts) limit ?", (q, limit))]
        capabilities = [dict(r) for r in con.execute(
            "select n.qualname, r.name repo, n.name title, substr(n.doc,1,200) doc from node_fts join node n on n.id = node_fts.rowid left join repo r on r.id=n.repo_id"
            " where node_fts match ? and n.kind = 'capability' order by bm25(node_fts) limit 5", (q,))]
        deps = [dict(r) for r in con.execute(
            "select distinct n.name, r.name repo from node_fts join node n on n.id = node_fts.rowid left join repo r on r.id=n.repo_id"
            " where node_fts match ? and n.kind = 'dependency' limit 8", (q,))]
    verdict = "reuse-candidates-found" if found or capabilities else ("no-index" if not dissect_db else "nothing-similar-indexed")
    return {"proposal": proposal, "verdict": verdict, "ladder": LADDER, "existing_capabilities": capabilities, "existing_code": found, "dependencies": deps,
            "note": "Matches are lexical (FTS5 over names, paths and docs); read the candidates before reusing or rejecting them."}
