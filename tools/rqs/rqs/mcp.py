"""rqs over MCP stdio (JSON-RPC 2.0, newline-delimited), standard library only.

Eight tools, input schemas only. Probing is read-only for the target; tools that take an
`out` path write that one file and nothing else.
"""

from __future__ import annotations

import argparse
import json
import sys

from . import __version__
from . import standard as STD
from .cli import dispatch

S, B = {"type": "string"}, {"type": "boolean"}
RO = {"readOnlyHint": True, "idempotentHint": True, "destructiveHint": False, "openWorldHint": False}
WR = {"readOnlyHint": False, "idempotentHint": True, "destructiveHint": False, "openWorldHint": False}
TOOLS = {
    "rqs_criteria": ("RQS-2030 criteria: question, why, fail/meets/horizon anchors, probes, refs. Filter by dimension (e.g. SEC) or ids (SEC-1,PRV-3); brief=true for one line each.",
                     {"dimension": S, "ids": S, "brief": B}, [], RO),
    "rqs_lenses": ("Gap lenses G1-G14, opportunity lenses O1-O14, re-engineering actions and opportunity criteria. kind: gaps | opportunities | reengineering | opportunity_criteria.",
                   {"kind": S}, [], RO),
    "rqs_probe": ("Collect automated evidence from a repository checkout (nothing is executed). Returns a brief view; pass out to save the full probe document for scoring. inherit: monorepo root for a package.",
                  {"path": S, "name": S, "inherit": S, "out": S}, ["path"], WR),
    "rqs_template": ("Write a review skeleton prefilled with probe-based suggestions (source auto) to out. Edit levels/evidence, set source to review, add gaps and opportunities.",
                     {"probes": S, "profile": S, "out": S}, ["probes", "out"], WR),
    "rqs_score": ("Score probes plus an optional review into a scorecard: dimension scores, Quality Index, Horizon Readiness, coverage, red lines, grade. Pass out to save it.",
                  {"probes": S, "review": S, "second": S, "out": S}, ["probes"], WR),
    "rqs_report": ("Render a saved scorecard as a Markdown report.", {"scorecard": S}, ["scorecard"], RO),
    "rqs_compare": ("Compare saved scorecards; md=true for a Markdown heatmap.", {"scorecards": {"type": "array", "items": S}, "md": B}, ["scorecards"], RO),
    "rqs_agree": ("Inter-rater agreement (exact, within-1, quadratic-weighted kappa) between two reviews of the same target.", {"review_a": S, "review_b": S}, ["review_a", "review_b"], RO),
}


def _args(name: str, a: dict) -> argparse.Namespace:
    if name == "rqs_criteria":
        return argparse.Namespace(cmd="criteria", id=a.get("ids"), dimension=a.get("dimension"), brief=a.get("brief", False))
    if name == "rqs_lenses":
        return argparse.Namespace(cmd="lenses", kind=a.get("kind"))
    if name == "rqs_probe":
        return argparse.Namespace(cmd="probe", path=a["path"], name=a.get("name"), only=None, inherit=a.get("inherit"), out=a.get("out"), brief=True)
    if name == "rqs_template":
        return argparse.Namespace(cmd="template", probes=a["probes"], profile=a.get("profile"), flag=None, out=a["out"])
    if name == "rqs_score":
        return argparse.Namespace(cmd="score", probes=a["probes"], review=a.get("review"), second=a.get("second"), out=a.get("out"))
    if name == "rqs_report":
        return argparse.Namespace(cmd="report", scorecard=a["scorecard"])
    if name == "rqs_compare":
        return argparse.Namespace(cmd="compare", scorecards=a["scorecards"], md=a.get("md", False))
    if name == "rqs_agree":
        return argparse.Namespace(cmd="agree", review_a=a["review_a"], review_b=a["review_b"])
    raise KeyError(name)


def serve(standard_path: str | None) -> int:
    std = None
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
            res = {"protocolVersion": "2025-06-18", "capabilities": {"tools": {"listChanged": False}}, "serverInfo": {"name": "rqs", "version": __version__},
                   "instructions": "Review = probe (save with out) -> template -> edit the review -> score -> report. Cite evidence for every level; U is never a pass."}
        elif method == "tools/list":
            res = {"tools": [{"name": n, "description": d, "annotations": ann, "inputSchema": {"type": "object", "properties": props, "required": req, "additionalProperties": False}}
                             for n, (d, props, req, ann) in TOOLS.items()]}
        elif method == "tools/call":
            name, a = msg["params"]["name"], msg["params"].get("arguments") or {}
            try:
                std = std or STD.load(standard_path)
                out, err = dispatch(_args(name, a), std), False
            except STD.RqsError as e:
                out, err = e.to_json(), True
            except KeyError as e:
                out, err = {"error": {"code": "bad_arguments", "message": f"missing or unknown: {e}", "fix": "Check the tool's inputSchema in tools/list."}}, True
            except Exception as e:  # never crash the server; report the cause
                out, err = {"error": {"code": type(e).__name__, "message": str(e)[:500], "fix": "Check the arguments against tools/list."}}, True
            text = out if isinstance(out, str) else json.dumps(out, ensure_ascii=False, default=str)
            res = {"isError": err, "content": [{"type": "text", "text": text}]}
        elif method == "ping":
            res = {}
        else:
            sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"unknown method {method}"}}) + "\n")
            sys.stdout.flush()
            continue
        sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": mid, "result": res}, default=str) + "\n")
        sys.stdout.flush()
    return 0
