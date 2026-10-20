"""rex: evidence-first investigation of software artifacts, for agents.

Every command prints one JSON document. Probes are inert, idempotent and recorded
as content-addressed evidence; answers must cite evidence; coverage and
calibration say what is still unknown or unaccounted for.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from . import __version__, budget, epistemics, gate, probes
from .store import RexError, Store

PROBES = {"identify": probes.identify, "inventory": probes.inventory, "native": probes.native, "js-refs": probes.js_refs}


def _store(a) -> Store:
    return Store(a.store or os.environ.get("REX_STORE") or ".rex/rex.db")


def _probe_result(res: dict) -> dict:
    out = budget.view(res["evidence"], "full" if res["evidence"]["bytes"] < 4096 else "summary")  # small results: no point eliding
    out["reused"] = res["reused"]
    return out


def run_plan(store: Store, plan: dict) -> dict:
    """Execute a plan of probes as durable steps. Re-running a plan after a crash skips finished steps."""
    crash_after = int(os.environ.get("REX_CRASH_AFTER", "0"))  # test hook: simulate a crash
    done = []
    for i, step in enumerate(plan["steps"], 1):
        op, path = step["op"], Path(step["path"])
        if op == "find":
            res = probes.find(store, path, step["needle"])
        elif op == "external":
            res = probes.external(store, path, step["tool"], step.get("args", ["{target}"]))
        else:
            res = PROBES[op](store, path)
        done.append({"op": op, "path": str(path), "evidence_id": res["evidence"]["id"], "reused": res["reused"]})
        if crash_after == i:
            os.kill(os.getpid(), 9)
    for q in plan.get("questions", []):
        epistemics.add_question(store, q["text"], q.get("require", "observed"))
    return {"steps": done, "reused": sum(d["reused"] for d in done), "executed": sum(not d["reused"] for d in done), "coverage": epistemics.coverage(store)}


def describe() -> dict:
    return {"tool": "rex", "version": __version__, "purpose": __doc__.strip().split("\n")[0],
            "commands": {n: p.description for n, p in SUB.items()},
            "evidence_fields": ["id (ev_<sha256>)", "operation", "subject_path", "subject_sha256", "tool", "tool_version", "params", "result", "confidence", "authority", "limitations", "links", "bytes"],
            "confidence": {"observed": "read directly from the artifact or tool output", "derived": "computed from observed evidence", "inferred": "a judgement or heuristic"},
            "rules": ["Absence of a match is unknown, not a negative.", "An answer cannot claim more confidence than its strongest cited evidence.",
                      "Questions never addressed are reported as unaccounted.", "Probes never execute the target.", "Outputs are summary-first; fetch detail by evidence id."],
            "routes": probes.ROUTES}


SUB: dict[str, argparse.ArgumentParser] = {}


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="rex", description=__doc__.strip().split("\n")[0])
    p.add_argument("--store", help="evidence store (default $REX_STORE or .rex/rex.db)")
    p.add_argument("--version", action="version", version=__version__)
    sub = p.add_subparsers(dest="cmd", required=True)

    def add(name, desc):
        s = sub.add_parser(name, description=desc, help=desc)
        SUB[name] = s
        return s

    for name, desc in [("identify", "Identify a target by magic bytes and suggest the next probes"),
                       ("inventory", "Inventory an archive, npm tarball, ASAR or directory (entries, digests, package.json)"),
                       ("native", "ELF/PE/Mach-O headers, sections, exports, imports and embedded Go/Rust metadata"),
                       ("js-refs", "Sweep a JS tree for imports, resolves, asset URLs, child processes, addons, env vars")]:
        add(name, desc).add_argument("path")
    s = add("find", "Bounded byte-exact slices around a needle (instead of dumping files)")
    s.add_argument("path"); s.add_argument("needle"); s.add_argument("--context", type=int, default=80); s.add_argument("--limit", type=int, default=40)
    s = add("ext", "Run an external tool (objdump, readelf, nm, rea, go ...) and keep its raw output as evidence; {target} is replaced by PATH")
    s.add_argument("tool"); s.add_argument("path"); s.add_argument("args", nargs=argparse.REMAINDER)
    s = add("show", "View one evidence record: summary (default), full, or a page of one list inside the result")
    s.add_argument("evidence_id"); s.add_argument("--view", default="summary", choices=["summary", "full", "page"]); s.add_argument("--path")
    s.add_argument("--offset", type=int, default=0); s.add_argument("--limit", type=int, default=50)
    s = add("evidence", "List stored evidence (metadata only)")
    s.add_argument("--operation"); s.add_argument("--subject"); s.add_argument("--limit", type=int, default=50); s.add_argument("--offset", type=int, default=0)
    s = add("plan", "Declare investigation questions (add) or list them with their state")
    s.add_argument("action", choices=["add", "list"]); s.add_argument("text", nargs="?"); s.add_argument("--require", default="observed")
    s = add("answer", "Record a guarded answer revision for a declared question")
    s.add_argument("question_id"); s.add_argument("--status", default="answered"); s.add_argument("--text"); s.add_argument("--confidence")
    s.add_argument("--evidence", default="", help="comma-separated evidence ids"); s.add_argument("--rationale")
    add("coverage", "Answered / partial / unknown / unaccounted questions, with caveats")
    s = add("adjudicate", "Mark the latest (or a given) answer revision correct or incorrect")
    s.add_argument("question_id"); s.add_argument("outcome", choices=["correct", "incorrect"]); s.add_argument("--revision", type=int); s.add_argument("--note")
    s = add("calibrate", "Per-confidence-class precision, Wilson intervals, ECE and abstention advice")
    s.add_argument("--target-error", type=float, default=0.1)
    s = add("gate", "Necessity check before building: what already exists (from a dissect DB) plus the ladder")
    s.add_argument("proposal"); s.add_argument("--dissect-db", default=os.environ.get("DISSECT_DB"))
    s = add("run", "Execute a JSON plan of probes as durable, idempotent steps (resumes after a crash)")
    s.add_argument("plan")
    s = add("steps", "List durable steps, or retry parked ones")
    s.add_argument("action", nargs="?", default="list", choices=["list", "retry"]); s.add_argument("--status")
    s = add("export", "Stream the store to a JSONL bundle (no single-object size limit)"); s.add_argument("path")
    s = add("import", "Load a JSONL bundle; records whose id does not match their content are rejected"); s.add_argument("path")
    add("describe", "Machine-readable contract: commands, evidence fields, confidence classes, rules, routes")
    add("mcp", "Serve rex over MCP stdio (10 tools)")
    return p


def dispatch(a) -> dict:
    if a.cmd == "describe":
        return describe()
    if a.cmd == "gate":
        return gate.check(a.proposal, a.dissect_db)
    st = _store(a)
    if a.cmd in PROBES:
        return _probe_result(PROBES[a.cmd](st, Path(a.path)))
    if a.cmd == "find":
        return _probe_result(probes.find(st, Path(a.path), a.needle, a.context, a.limit))
    if a.cmd == "ext":
        args = a.args[1:] if a.args[:1] == ["--"] else a.args
        return _probe_result(probes.external(st, Path(a.path), a.tool, args or ["{target}"]))
    if a.cmd == "show":
        return budget.view(st.get(a.evidence_id), a.view, a.path, a.offset, a.limit)
    if a.cmd == "evidence":
        return {"rows": st.list(a.operation, a.subject, a.limit, a.offset)}
    if a.cmd == "plan":
        if a.action == "add":
            if not a.text:
                raise RexError("missing_text", "plan add needs the question text.", 'rex plan add "Which processes does it spawn?"')
            return epistemics.add_question(st, a.text, a.require)
        return epistemics.coverage(st)
    if a.cmd == "answer":
        return epistemics.answer(st, a.question_id, status=a.status, text=a.text, confidence=a.confidence,
                                 evidence_ids=[e for e in a.evidence.split(",") if e], rationale=a.rationale)
    if a.cmd == "coverage":
        return epistemics.coverage(st)
    if a.cmd == "adjudicate":
        return epistemics.adjudicate(st, a.question_id, a.outcome, a.revision, a.note)
    if a.cmd == "calibrate":
        return epistemics.calibrate(st, a.target_error)
    if a.cmd == "run":
        return run_plan(st, json.loads(Path(a.plan).read_text()))
    if a.cmd == "steps":
        return {"retried": st.retry_parked()} if a.action == "retry" else {"rows": st.steps(a.status)}
    if a.cmd == "export":
        return st.export(a.path)
    if a.cmd == "import":
        return st.import_(a.path)
    raise RexError("unknown_command", a.cmd, "See `rex describe`.")


def main(argv=None) -> int:
    a = parser().parse_args(argv)
    if a.cmd == "mcp":
        from .mcp import serve
        return serve(a.store)
    try:
        out = dispatch(a)
        code = 0
    except RexError as e:
        out, code = e.to_json(), 2
    sys.stdout.write(json.dumps(out, ensure_ascii=False, default=str) + "\n")
    return code
