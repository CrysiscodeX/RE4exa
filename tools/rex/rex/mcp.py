"""rex over MCP stdio (JSON-RPC 2.0, newline-delimited), standard library only.

Ten tools, input schemas only. Probes are annotated read-only and idempotent: they
never modify the target, and repeated calls return the stored evidence.
"""

from __future__ import annotations

import argparse
import json
import sys

from . import __version__
from .cli import dispatch
from .store import RexError

S, I = {"type": "string"}, {"type": "integer", "minimum": 0}
RO = {"readOnlyHint": True, "idempotentHint": True, "destructiveHint": False, "openWorldHint": False}
RW = {"readOnlyHint": False, "idempotentHint": False, "destructiveHint": False, "openWorldHint": False}
TOOLS = {
    "rex_identify": ("Identify a local file or directory by magic bytes; returns format and the next probes to run.", {"path": S}, ["path"], RO),
    "rex_probe": ("Run one inert probe and record evidence. op: inventory (archives, npm tgz, ASAR, dirs) | native (ELF/PE/Mach-O, Go/Rust metadata) | js-refs (JS tree) | find (needle slices).",
                  {"path": S, "op": {"type": "string", "enum": ["inventory", "native", "js-refs", "find"]}, "needle": S}, ["path", "op"], RO),
    "rex_show": ("View one evidence record. view: summary (default) | full | page (with path to a list, offset, limit).",
                 {"evidence_id": S, "view": {"type": "string", "enum": ["summary", "full", "page"]}, "path": S, "offset": I, "limit": I}, ["evidence_id"], RO),
    "rex_evidence": ("List stored evidence metadata, optionally by operation or subject digest/path.", {"operation": S, "subject": S, "limit": I, "offset": I}, [], RO),
    "rex_plan": ("Declare a question the investigation must answer (counts toward coverage). require: observed | derived | inferred.", {"text": S, "require": S}, ["text"], RW),
    "rex_answer": ("Record an answer revision. status: answered | partial | unknown. Non-unknown answers must cite evidence_ids and a confidence no stronger than that evidence.",
                   {"question_id": S, "status": S, "text": S, "confidence": S, "evidence_ids": {"type": "array", "items": S}, "rationale": S}, ["question_id", "status"], RW),
    "rex_coverage": ("Report answered / partial / unknown / unaccounted questions and caveats.", {}, [], RO),
    "rex_calibrate": ("Per-confidence-class precision of adjudicated answers, Wilson intervals, ECE and abstention advice.", {"target_error": {"type": "number"}}, [], RO),
    "rex_gate": ("Before building something: list existing capabilities/code that already do it (dissect index) and the necessity ladder.", {"proposal": S}, ["proposal"], RO),
    "rex_export": ("Stream the evidence store to a JSONL bundle at path.", {"path": S}, ["path"], RW),
}


def _args(name: str, a: dict, store: str | None) -> argparse.Namespace:
    base = {"store": store}
    if name == "rex_identify":
        return argparse.Namespace(**base, cmd="identify", path=a["path"])
    if name == "rex_probe":
        if a["op"] == "find":
            return argparse.Namespace(**base, cmd="find", path=a["path"], needle=a.get("needle") or "", context=80, limit=40)
        return argparse.Namespace(**base, cmd=a["op"], path=a["path"])
    if name == "rex_show":
        return argparse.Namespace(**base, cmd="show", evidence_id=a["evidence_id"], view=a.get("view", "summary"), path=a.get("path"), offset=a.get("offset", 0), limit=a.get("limit", 50))
    if name == "rex_evidence":
        return argparse.Namespace(**base, cmd="evidence", operation=a.get("operation"), subject=a.get("subject"), limit=a.get("limit", 50), offset=a.get("offset", 0))
    if name == "rex_plan":
        return argparse.Namespace(**base, cmd="plan", action="add", text=a["text"], require=a.get("require", "observed"))
    if name == "rex_answer":
        return argparse.Namespace(**base, cmd="answer", question_id=a["question_id"], status=a["status"], text=a.get("text"), confidence=a.get("confidence"),
                                  evidence=",".join(a.get("evidence_ids") or []), rationale=a.get("rationale"))
    if name == "rex_coverage":
        return argparse.Namespace(**base, cmd="coverage")
    if name == "rex_calibrate":
        return argparse.Namespace(**base, cmd="calibrate", target_error=a.get("target_error", 0.1))
    if name == "rex_gate":
        import os
        return argparse.Namespace(**base, cmd="gate", proposal=a["proposal"], dissect_db=os.environ.get("DISSECT_DB"))
    if name == "rex_export":
        return argparse.Namespace(**base, cmd="export", path=a["path"])
    raise KeyError(name)


def serve(store: str | None) -> int:
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        mid, method = msg.get("id"), msg.get("method")
        if mid is None:
            continue
        if method == "initialize":
            res = {"protocolVersion": "2025-06-18", "capabilities": {"tools": {"listChanged": False}}, "serverInfo": {"name": "rex", "version": __version__},
                   "instructions": "Identify first, then probe; cite evidence ids in answers; check rex_coverage before concluding. Outputs are summaries: use rex_show for detail."}
        elif method == "tools/list":
            res = {"tools": [{"name": n, "description": d, "annotations": ann, "inputSchema": {"type": "object", "properties": props, "required": req, "additionalProperties": False}}
                             for n, (d, props, req, ann) in TOOLS.items()]}
        elif method == "tools/call":
            name, a = msg["params"]["name"], msg["params"].get("arguments") or {}
            try:
                out, err = dispatch(_args(name, a, store)), False
            except RexError as e:
                out, err = e.to_json(), True
            except Exception as e:  # never crash the server; report the cause
                out, err = {"error": {"code": type(e).__name__, "message": str(e)[:500], "fix": "Check the arguments against tools/list."}}, True
            res = {"isError": err, "content": [{"type": "text", "text": json.dumps(out, ensure_ascii=False, default=str)}]}
        elif method == "ping":
            res = {}
        else:
            sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"unknown method {method}"}}) + "\n")
            sys.stdout.flush()
            continue
        sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": mid, "result": res}, default=str) + "\n")
        sys.stdout.flush()
    return 0
