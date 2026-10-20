"""Repository scanner: turns a source tree into nodes and edges.

Nothing in the scanned repository is executed. JS/TS and Go are parsed by the
helpers in ../helpers (Babel, go/parser); Python by the stdlib ast module; other
languages by conservative patterns.
"""

from __future__ import annotations

import ast
import hashlib
import json
import os
import re
import shutil
import subprocess
import tomllib
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

try:  # optional: without PyYAML a small reader handles front matter and workflow triggers
    import yaml
except ImportError:  # pragma: no cover - exercised by the fallback test
    yaml = None

from .concepts import CONCEPTS, tag
from .db import Writer

HERE = Path(__file__).resolve().parent.parent
COMMON_CALLS = set("""append extend insert pop push shift unshift map filter reduce forEach find findIndex some every includes indexOf join split slice splice
concat sort reverse keys values entries items get set has add delete clear update copy then catch finally resolve reject toString valueOf
str int len list dict tuple bool float print format replace strip lstrip rstrip lower upper startswith endswith encode decode read write close
open next iter send emit on off once call apply bind parse stringify assign create freeze test match exec trim from of is equal error log
info warn debug Error String Number Boolean Array Object Promise Map Set Date JSON Math require import super self this new make len cap
writeFile readFile mkdir rmdir unlink rename stat lstat readdir access exists dirname basename relative normalize spawn execFile fetch""".split())
PY_STDLIB = set(__import__("sys").stdlib_module_names) | {"__future__"}
SKIP_DIRS = {".git", "node_modules", "vendor", "__pycache__", ".venv", "venv", "dist", "build", ".next", "target", ".turbo", ".cache", "coverage", ".pytest_cache", ".mypy_cache"}
TEXT_LIMIT = 2 * 1024 * 1024
LANG = {".ts": "ts", ".tsx": "ts", ".mts": "ts", ".cts": "ts", ".js": "js", ".jsx": "js", ".mjs": "js", ".cjs": "js",
        ".py": "py", ".go": "go", ".rs": "rust", ".java": "java", ".cs": "csharp", ".swift": "swift", ".kt": "kotlin",
        ".sh": "sh", ".bash": "sh", ".zsh": "sh", ".ps1": "powershell", ".sql": "sql", ".md": "md", ".mdx": "md",
        ".yml": "yaml", ".yaml": "yaml", ".json": "json", ".jsonl": "jsonl", ".toml": "toml", ".c": "c", ".cc": "cpp", ".cpp": "cpp", ".h": "c", ".hpp": "cpp"}
CLAIM_RX = re.compile(r"(?:\d[\d,.]*\s?(?:%|×|x faster|x cheaper|ms|s\b|seconds|minutes|tokens?|k tokens|MB|GB|KB|\$)|\$\s?\d[\d,.]*|\b\d+(?:\.\d+)?x\b)", re.I)
STATE_WORDS = {"pending", "running", "completed", "failed", "cancelled", "canceled", "sleeping", "queued", "succeeded", "aborted", "timeout", "open", "closed", "resolved", "blocked", "investigating", "contradicted", "idle", "busy", "active", "parked", "faulted", "suspended", "ready", "starting", "stopping", "stopped", "exited", "expired", "retrying"}
LIFECYCLE_RX = re.compile(r"^_*(start|stop|close|dispose|cleanup|shutdown|teardown|setup|init|initialize|open|resume|retry|restart|reconnect|heartbeat|checkpoint|commit|rollback|abort|cancel|drain|flush|claim|release|acquire|spawn|kill|terminate|attach|detach|connect|disconnect|recover|restore|migrate|compact|expire|evict|schedule|tick|poll|run|serve|listen|watch)", re.I)
WEIGHT = {"entrypoint": 3.0, "trigger": 1.5, "symbol": 1.0, "schema": 1.0, "doc": 1.0, "lifecycle": 1.0, "claim": 1.0, "file": 0.5, "dependency": 0.5}


def role_of(rel: str) -> str:
    low = rel.lower()
    name = low.rsplit("/", 1)[-1]
    if low.startswith(".github/workflows/"):
        return "ci"
    if name == "skill.md" or "/skills/" in f"/{low}" or low.startswith("skills/"):
        return "skill"
    if re.search(r"(^|/)(tests?|__tests__|spec|e2e|testdata)(/|$)", low) or re.search(r"(\.test\.|\.spec\.|_test\.go$|^test_.*\.py$|_test\.py$)", name):
        return "test"
    if re.search(r"(^|/)(fixtures?|examples?|samples?)(/|$)", low):
        return "fixture"
    if re.search(r"(^|/)(bench|benchmarks?)(/|$)", low):
        return "bench"
    if name.endswith((".md", ".mdx", ".txt", ".rst")):
        return "doc"
    if name.endswith((".json", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".lock")) or name in {"makefile", "dockerfile", ".gitignore"}:
        return "config"
    return "source"


def _git(root: Path, *args: str) -> str | None:
    try:
        return subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, timeout=30).stdout.strip() or None
    except Exception:
        return None



def load_yaml(text: str):
    """PyYAML when installed, else mini_yaml. None when the text does not parse."""
    if yaml is not None:
        try:
            return yaml.safe_load(text)
        except yaml.YAMLError:
            return None
    return mini_yaml(text)


BLOCK_SCALAR = ("|", ">", "|-", ">-", "|+", ">+")


def mini_yaml(text: str):
    """Block-style YAML subset: nested mappings and lists, quoted and flow-list scalars, block
    scalars. Enough for SKILL.md front matter and CI workflow names, triggers and crons."""
    lines = [(len(r) - len(r.lstrip(" ")), r.strip()) for r in text.splitlines()
             if r.strip() and not r.lstrip().startswith("#") and r.strip() not in ("---", "...")]

    def scalar(v: str):
        v = v.split(" #", 1)[0].strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
            return v[1:-1]
        if v.startswith("[") and v.endswith("]"):
            return [scalar(x) for x in v[1:-1].split(",") if x.strip()]
        return {"true": True, "false": False, "null": None, "~": None}.get(v, v)

    def block(i: int, ind: int):
        if lines[i][1].startswith("-"):
            out = []
            while i < len(lines) and lines[i][0] == ind and lines[i][1].startswith("-"):
                item = lines[i][1][1:].strip()
                i += 1
                if re.match(r"[\w.-]+:(\s|$)", item):
                    k, _, v = item.partition(":")
                    k, v, col = k.strip(), v.strip(), ind + 2  # col: where this item's keys start
                    if v.startswith("&"):
                        v = v.split(None, 1)[1] if " " in v else ""
                    if v in BLOCK_SCALAR:
                        parts = []
                        while i < len(lines) and lines[i][0] > col:
                            parts.append(lines[i][1])
                            i += 1
                        d = {k: ("\n" if v[0] == "|" else " ").join(parts)}
                    elif v:
                        d = {k: scalar(v)}
                    elif i < len(lines) and lines[i][0] > col:
                        sub, i = block(i, lines[i][0])
                        d = {k: sub}
                    else:
                        d = {k: None}
                    if i < len(lines) and lines[i][0] > ind:  # the item's other keys
                        sub, i = block(i, lines[i][0])
                        if isinstance(sub, dict):
                            d.update(sub)
                    out.append(d)
                else:
                    out.append(scalar(item))
            return out, i
        out = {}
        while i < len(lines) and lines[i][0] == ind:
            key, _, val = lines[i][1].partition(":")
            key, val = key.strip().strip("'\""), val.strip()
            if val.startswith("&"):  # an anchor: the value follows on the next lines
                val = val.split(None, 1)[1] if " " in val else ""
            i += 1
            if val in BLOCK_SCALAR:
                parts = []
                while i < len(lines) and lines[i][0] > ind:
                    parts.append(lines[i][1])
                    i += 1
                out[key] = ("\n" if val[0] == "|" else " ").join(parts)
            elif val:
                out[key] = scalar(val)
            elif i < len(lines) and (lines[i][0] > ind or lines[i][0] == ind and lines[i][1].startswith("- ")):
                out[key], i = block(i, lines[i][0])  # nested block, or a list written at the key's own indentation
            else:
                out[key] = None
        return out, i

    try:
        return block(0, lines[0][0])[0] if lines else None
    except (IndexError, ValueError):
        return None


class Scanner:
    def __init__(self, con, root: Path, name: str, url: str | None = None, log=print):
        self.con, self.root, self.name, self.url, self.log = con, root.resolve(), name, url, log
        self.files: dict[str, int] = {}          # rel path -> node id
        self.symbols_by_name: dict[str, list[int]] = defaultdict(list)
        self.symbols_by_file: dict[str, dict[str, int]] = defaultdict(dict)
        self.pending_calls: list[tuple[int, str, str, bool]] = []  # (caller id, callee name, rel, same-file only)
        self.pending_imports: list[tuple[str, str, str]] = []  # (rel, spec, lang)
        self.shared: dict[tuple[str, str, str], int] = {}  # (kind, sub, name) -> node id
        self.stats = Counter()

    # ---- helpers -------------------------------------------------------------------
    # Vocabulary that means the same thing in every repo is stored once, globally,
    # so cross-repo questions ("who else has a 'checkpoint' phase?") are one hop.
    GLOBAL_SUBS = {"phase", "value", "signal", "cron", "ci-event", "timer", "agent-hook"}

    def shared_node(self, kind: str, sub: str, name: str, **kw) -> int:
        key = (kind, sub, name)
        if key not in self.shared:
            scope = None if sub in self.GLOBAL_SUBS else "self"
            self.shared[key] = self.w.node(kind, name, sub=sub, qualname=f"{sub}:{name}", repo_id=scope, **kw)
        return self.shared[key]

    def tag_node(self, nid: int, kind: str, *texts: str | None) -> None:
        for concept in tag(*texts):
            cid = self.w.node("concept", concept, sub=CONCEPTS[concept][0], doc=CONCEPTS[concept][1], repo_id=None)
            self.w.edge(nid, cid, "tagged", WEIGHT.get(kind, 1.0))

    def add_symbol(self, rel: str, lang: str, s: dict) -> int:
        parent = s.get("parent")
        qual = f"{parent}.{s['name']}" if parent else s["name"]
        nid = self.w.node("symbol", s["name"], sub=s["kind"], qualname=qual, path=rel, line=s.get("line"), end_line=s.get("end"), lang=lang,
                          doc=s.get("doc"), attrs={k: s[k] for k in ("exported", "params", "async", "decorators", "bases") if s.get(k) not in (None, False, [])} or None)
        self.w.edge(self.files[rel], nid, "defines")
        self.symbols_by_name[s["name"]].append(nid)
        self.symbols_by_file[rel].setdefault(s["name"], nid)
        if parent and parent in self.symbols_by_file[rel]:
            self.w.edge(self.symbols_by_file[rel][parent], nid, "contains")
        self.tag_node(nid, "symbol", s["name"], parent, s.get("doc"))
        self.stats["symbols"] += 1
        if s["kind"] in ("function", "method") and LIFECYCLE_RX.match(s["name"]):
            phase = LIFECYCLE_RX.match(s["name"]).group(1).lower()
            lid = self.shared_node("lifecycle", "phase", phase, doc=f"Functions whose name starts with '{phase}'")
            self.w.edge(nid, lid, "implements")
        return nid

    def add_facts(self, rel: str, fid: int, data: dict) -> None:
        for env in data.get("env", []):
            self.w.edge(fid, self.shared_node("trigger", "env", env), "uses_env")
        for sig in data.get("signals", []):
            self.w.edge(fid, self.shared_node("trigger", "signal", sig), "handles_signal")
        for ev in data.get("events", [])[:60]:
            op = "emits" if ev["op"] in ("emit", "dispatchEvent") else "listens"
            self.w.edge(fid, self.shared_node("trigger", "event", ev["name"]), op)
        if data.get("timers") or data.get("goroutines"):
            self.w.edge(fid, self.shared_node("trigger", "timer", "timers"), "uses_timer", float(data.get("timers", 0)) or 1.0)
        for st in data.get("states", []):
            self.w.edge(fid, self.shared_node("state", "value", st), "has_state")
        for sch in data.get("schemas", []):
            sid = self.w.node("schema", sch["name"], sub=sch.get("lib", "schema"), qualname=sch["name"], path=rel, line=sch.get("line"))
            self.w.edge(fid, sid, "defines")
            self.tag_node(sid, "schema", sch["name"])
        for tool in data.get("tools", []):
            eid = self.w.node("entrypoint", tool, sub="mcp-tool", qualname=f"mcp-tool:{tool}", path=rel, attrs={"source": "pattern"})
            self.w.edge(eid, fid, "implemented_by")
            self.tag_node(eid, "entrypoint", tool, "mcp")
        for cmd in data.get("commands", []):
            if cmd == "main":
                eid = self.w.node("entrypoint", rel.rsplit("/", 2)[-2] if "/" in rel else rel, sub="go-main", qualname=f"go-main:{rel}", path=rel)
            else:
                eid = self.w.node("entrypoint", cmd, sub="cli-command", qualname=f"cli-command:{cmd}", path=rel)
            self.w.edge(eid, fid, "implemented_by")
            self.tag_node(eid, "entrypoint", cmd, "cli")

    # ---- per-language --------------------------------------------------------------
    def run_helper(self, cmd: list[str], rels: list[str], lang: str) -> None:
        if not rels:
            return
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, cwd=HERE / "helpers")
        payload = "\n".join(str(self.root / r) for r in rels) + "\n"
        out, _ = proc.communicate(payload, timeout=3600)
        prefix = str(self.root) + "/"
        for line in out.splitlines():
            data = json.loads(line)
            rel = data["path"][len(prefix):]
            if rel not in self.files:
                continue
            if data.get("errors"):
                self.stats[f"{lang}_errors"] += 1
            for s in data.get("symbols") or []:
                nid = self.add_symbol(rel, lang, s)
            for c in data.get("calls") or []:
                caller = self.symbols_by_file[rel].get(c.get("from") or "")
                if caller:
                    to = c["to"]
                    local_only = "." in to and not to.startswith(("this.", "self.", "super."))  # obj.method(): receiver unknown
                    self.pending_calls.append((caller, to.split(".")[-1], rel, local_only))
            for spec in data.get("imports") or []:
                self.pending_imports.append((rel, spec, lang))
            self.add_facts(rel, self.files[rel], data)

    def python_file(self, rel: str, text: str) -> None:
        try:
            tree = ast.parse(text)
        except SyntaxError:
            self.stats["py_errors"] += 1
            return
        data = {"env": [], "signals": [], "states": [], "schemas": [], "tools": [], "commands": [], "events": [], "timers": 0}
        fid = self.files[rel]

        def deco_names(node):
            out = []
            for d in getattr(node, "decorator_list", []):
                target = d.func if isinstance(d, ast.Call) else d
                out.append(ast.unparse(target)[:60])
            return out

        def walk(node, parent=None):
            for child in ast.iter_child_nodes(node):
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    kind = "class" if isinstance(child, ast.ClassDef) else ("method" if parent and parent[1] == "class" else "function")
                    doc = (ast.get_docstring(child) or "").strip().split("\n")[0][:240] or None
                    decos = deco_names(child)
                    bases = [ast.unparse(b)[:60] for b in getattr(child, "bases", [])]
                    s = {"kind": kind, "name": child.name, "line": child.lineno, "end": getattr(child, "end_lineno", None), "doc": doc,
                         "parent": parent[0] if parent else None, "exported": not child.name.startswith("_"), "decorators": decos, "bases": bases,
                         "params": len(child.args.args) if hasattr(child, "args") else None, "async": isinstance(child, ast.AsyncFunctionDef)}
                    nid = self.add_symbol(rel, "py", s)
                    if kind == "class" and any(re.search(r"(BaseModel|TypedDict|Schema|Enum|NamedTuple)$", b) for b in bases):
                        data["schemas"].append({"name": child.name, "lib": "pydantic" if "BaseModel" in " ".join(bases) else "python", "line": child.lineno})
                    if any(re.search(r"dataclass", d) for d in decos):
                        data["schemas"].append({"name": child.name, "lib": "dataclass", "line": child.lineno})
                    for d in decos:
                        if re.search(r"\.(tool|mcp_tool)$|^tool$", d):
                            data["tools"].append(child.name)
                        if re.search(r"(\.command|^command|\.group)$", d):
                            data["commands"].append(child.name.replace("_", "-"))
                    for sub in ast.walk(child):
                        if isinstance(sub, ast.Call):
                            f = sub.func
                            name = f.attr if isinstance(f, ast.Attribute) else f.id if isinstance(f, ast.Name) else None
                            local_only = isinstance(f, ast.Attribute) and not (isinstance(f.value, ast.Name) and f.value.id in ("self", "cls"))
                            if name and len(self.pending_calls) < 2_000_000:
                                self.pending_calls.append((nid, name, rel, local_only))
                    walk(child, (child.name, kind))
                else:
                    walk(child, parent)

        walk(tree)
        for node in ast.walk(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                mod = node.module if isinstance(node, ast.ImportFrom) else None
                names = [mod] if mod else [a.name for a in node.names]
                for n in names:
                    if n:
                        self.pending_imports.append((rel, ("." * getattr(node, "level", 0)) + n, "py"))
            elif isinstance(node, ast.Call):
                f = node.func
                full = ast.unparse(f)[:80] if isinstance(f, (ast.Attribute, ast.Name)) else ""
                a0 = node.args[0].value if node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str) else None
                if full in ("os.getenv", "os.environ.get", "environ.get", "getenv") and a0:
                    data["env"].append(a0)
                elif full == "signal.signal" and node.args:
                    data["signals"].append(ast.unparse(node.args[0]).split(".")[-1])
                elif full.endswith(("add_parser", "add_typer")) and a0:
                    data["commands"].append(a0)
                elif full.endswith(("threading.Timer", "asyncio.sleep", "sched.scheduler")):
                    data["timers"] += 1
                elif full.endswith((".emit", ".on", ".connect")) and a0 and len(a0) < 80:
                    data["events"].append({"op": "emit" if full.endswith(".emit") else "on", "name": a0})
            elif isinstance(node, ast.Subscript) and ast.unparse(node.value) in ("os.environ", "environ"):
                if isinstance(node.slice, ast.Constant) and isinstance(node.slice.value, str):
                    data["env"].append(node.slice.value)
            elif isinstance(node, ast.Constant) and isinstance(node.value, str) and node.value in STATE_WORDS:
                data["states"].append(node.value)
        for k in ("env", "signals", "states", "commands", "tools"):
            data[k] = sorted(set(data[k]))
        self.add_facts(rel, fid, data)

    PATTERNS = {
        "rust": [("function", r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)"), ("class", r"^\s*(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)")],
        "java": [("class", r"^\s*(?:public|protected|private|abstract|final|static|\s)*(?:class|interface|enum|record)\s+([A-Za-z_]\w*)"),
                 ("method", r"^\s*(?:public|protected|private)\s+(?:static\s+)?(?:final\s+)?[\w<>\[\], ?]+\s+([a-z]\w*)\s*\(")],
        "csharp": [("class", r"^\s*(?:public|internal|private|protected|sealed|static|abstract|partial|\s)*(?:class|interface|record|struct|enum)\s+([A-Za-z_]\w*)"),
                   ("method", r"^\s*(?:public|internal|private|protected)\s+(?:static\s+|async\s+|override\s+|virtual\s+)*[\w<>\[\],? ]+\s+([A-Z]\w*)\s*\(")],
        "swift": [("function", r"^\s*(?:public\s+|private\s+|fileprivate\s+|internal\s+|static\s+)*func\s+([A-Za-z_]\w*)"), ("class", r"^\s*(?:public\s+|final\s+)*(?:class|struct|enum|protocol|actor)\s+([A-Za-z_]\w*)")],
        "kotlin": [("function", r"^\s*(?:\w+\s+)*fun\s+([A-Za-z_]\w*)"), ("class", r"^\s*(?:\w+\s+)*(?:class|object|interface)\s+([A-Za-z_]\w*)")],
        "sh": [("function", r"^\s*(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{")],
        "sql": [("function", r"(?i)^\s*create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+([\w.\"]+)\s*\("), ("table", r"(?i)^\s*create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?([\w.\"]+)")],
        "c": [("function", r"^[A-Za-z_][\w\s\*]*\s\**([A-Za-z_]\w*)\s*\([^;]*\)\s*\{?\s*$")],
        "cpp": [("function", r"^[A-Za-z_][\w\s\*:<>,&]*\s[\*&]*([A-Za-z_][\w:]*)\s*\([^;]*\)\s*(?:const\s*)?\{?\s*$")],
    }

    def pattern_file(self, rel: str, lang: str, text: str) -> None:
        for kind, rx in self.PATTERNS.get(lang, []):
            for m in re.finditer(rx, text, re.M):
                line = text.count("\n", 0, m.start()) + 1
                name = m.group(1).strip('"').split(".")[-1]
                if lang == "sql" and kind == "table":
                    sid = self.w.node("schema", name, sub="sql-table", qualname=m.group(1).strip('"'), path=rel, line=line, lang=lang)
                    self.w.edge(self.files[rel], sid, "defines")
                    self.tag_node(sid, "schema", name, "sql")
                else:
                    self.add_symbol(rel, lang, {"kind": kind, "name": name, "line": line})
        if lang == "sh":
            for m in re.finditer(r"\$\{?([A-Z][A-Z0-9_]{2,})\}?", text):
                if m.group(1) not in {"PATH", "HOME", "PWD", "USER"}:
                    self.w.edge(self.files[rel], self.shared_node("trigger", "env", m.group(1)), "uses_env")

    def markdown_file(self, rel: str, text: str, role: str) -> None:
        fid = self.files[rel]
        fm = None
        if text.startswith("---\n"):
            end = text.find("\n---", 4)
            if end > 0:
                fm = load_yaml(text[4:end]) or None
        if (rel.lower().endswith("skill.md") or role == "skill") and isinstance(fm, dict) and fm.get("name"):
            eid = self.w.node("entrypoint", str(fm["name"]), sub="skill", qualname=f"skill:{fm['name']}", path=rel, doc=str(fm.get("description", ""))[:1000],
                              attrs={k: fm[k] for k in fm if k not in ("name", "description")} or None)
            self.w.edge(eid, fid, "implemented_by")
            self.tag_node(eid, "entrypoint", str(fm["name"]), str(fm.get("description", "")), "skill")
        heading = None
        for i, line in enumerate(text.splitlines(), 1):
            if line.startswith("#"):
                heading = line.lstrip("#").strip()[:200]
                if heading and len(heading) > 2 and self.stats["doc_sections"] < 200_000:
                    did = self.w.node("doc", heading, sub="section", qualname=f"{rel}#{heading}", path=rel, line=i)
                    self.w.edge(fid, did, "documents")
                    self.tag_node(did, "doc", heading)
                    self.stats["doc_sections"] += 1
            elif role in ("doc", "skill", "bench") and CLAIM_RX.search(line) and 20 < len(line) < 600 and not line.lstrip().startswith(("|---", "```", "-->", "<")):
                if re.search(r"\b(faster|cheaper|fewer|less|more|reduc\w*|sav\w*|cost|latency|accuracy|score|tokens?|ms|p50|p99|ratio|%)\b", line, re.I):
                    cid = self.w.node("claim", line.strip()[:300], sub="numeric", qualname=f"{rel}:{i}", path=rel, line=i, doc=heading)
                    self.w.edge(fid, cid, "claims")
                    self.tag_node(cid, "claim", line, heading)
                    self.stats["claims"] += 1

    def workflow_file(self, rel: str, text: str) -> None:
        doc = load_yaml(text)
        if not isinstance(doc, dict):
            return
        triggers = doc.get(True, doc.get("on"))  # PyYAML parses bare `on` as True
        wid = self.w.node("entrypoint", str(doc.get("name") or rel.rsplit("/", 1)[-1]), sub="ci-workflow", qualname=f"ci-workflow:{rel}", path=rel,
                          attrs={"jobs": sorted((doc.get("jobs") or {}).keys())[:50]})
        self.w.edge(wid, self.files[rel], "implemented_by")
        self.tag_node(wid, "entrypoint", str(doc.get("name") or ""), rel)
        items = triggers if isinstance(triggers, dict) else {t: None for t in (triggers if isinstance(triggers, list) else [triggers]) if t}
        for event, cfg in items.items():
            tid = self.shared_node("trigger", "ci-event", str(event))
            self.w.edge(tid, wid, "fires")
            if event == "schedule" and isinstance(cfg, list):
                for c in cfg:
                    if isinstance(c, dict) and c.get("cron"):
                        cron = self.shared_node("trigger", "cron", c["cron"])
                        self.w.edge(cron, wid, "fires")

    def manifest(self, rel: str, text: str) -> None:
        name = rel.rsplit("/", 1)[-1]
        fid = self.files[rel]
        deps: dict[str, tuple[str, str]] = {}
        entry: list[tuple[str, str, str]] = []  # (sub, name, target)
        try:
            if name == "package.json":
                d = json.loads(text)
                for kind in ("dependencies", "optionalDependencies", "peerDependencies"):
                    for k, v in (d.get(kind) or {}).items():
                        deps[k] = (str(v), "runtime")
                for k, v in (d.get("devDependencies") or {}).items():
                    deps[k] = (str(v), "dev")
                bins = d.get("bin")
                if isinstance(bins, str):
                    entry.append(("bin", d.get("name", rel), bins))
                elif isinstance(bins, dict):
                    entry += [("bin", k, v) for k, v in bins.items()]
                for k, v in (d.get("scripts") or {}).items():
                    entry.append(("npm-script", k, str(v)[:300]))
            elif name == "pyproject.toml":
                d = tomllib.loads(text)
                proj = d.get("project", {})
                for spec in proj.get("dependencies", []):
                    deps[re.split(r"[<>=!~\[; ]", spec, 1)[0]] = (spec, "runtime")
                for group, specs in (proj.get("optional-dependencies") or {}).items():
                    for spec in specs:
                        deps.setdefault(re.split(r"[<>=!~\[; ]", spec, 1)[0], (spec, f"extra:{group}"))
                entry += [("bin", k, v) for k, v in (proj.get("scripts") or {}).items()]
            elif name == "go.mod":
                for m in re.finditer(r"^\s*(?:require\s+)?([\w./-]+\.[\w./-]+)\s+(v[\w.+-]+)", text, re.M):
                    deps[m.group(1)] = (m.group(2), "runtime")
            elif name == "Cargo.toml":
                d = tomllib.loads(text)
                for k, v in (d.get("dependencies") or {}).items():
                    deps[k] = (v if isinstance(v, str) else str(v.get("version", "")), "runtime")
            elif name in ("plugin.json", "gemini-extension.json", "plugin.yaml", "server.json", "hooks.json", "mcp.json", ".mcp.json"):
                d = json.loads(text) if name.endswith(".json") else load_yaml(text)
                if isinstance(d, dict):
                    sub = "mcp-registry" if name == "server.json" else "hooks" if name == "hooks.json" else "mcp-config" if "mcp" in name else "agent-plugin"
                    entry.append((sub, str(d.get("name") or rel), rel))
                    for hook_event in (d.get("hooks") or {}) if isinstance(d.get("hooks"), dict) else []:
                        tid = self.shared_node("trigger", "agent-hook", hook_event)
                        self.w.edge(tid, fid, "fires")
        except Exception:
            self.stats["manifest_errors"] += 1
            return
        for dep, (ver, kind) in deps.items():
            did = self.w.node("dependency", dep, sub=kind, qualname=f"{kind}:{dep}", attrs={"version": ver}, path=rel)
            self.w.edge(fid, did, "depends_on")
            self.tag_node(did, "dependency", dep)
        for sub, n, target in entry:
            eid = self.w.node("entrypoint", n, sub=sub, qualname=f"{sub}:{n}", path=rel, doc=target)
            self.w.edge(eid, fid, "implemented_by")
            self.tag_node(eid, "entrypoint", n, target if sub != "npm-script" else None)

    # ---- driver --------------------------------------------------------------------
    def scan(self) -> dict:
        commit = _git(self.root, "rev-parse", "HEAD")
        url = self.url or _git(self.root, "remote", "get-url", "origin")
        lic = next((p.name for p in self.root.iterdir() if re.match(r"(?i)^(license|licence|copying)", p.name)), None)
        lic_text = (self.root / lic).read_text(errors="replace")[:400] if lic else ""
        license_id = next((k for k, rx in {"MIT": r"MIT License", "Apache-2.0": r"Apache License", "GPL-3.0": r"GNU GENERAL PUBLIC LICENSE"}.items() if re.search(rx, lic_text)), lic)
        old = self.con.execute("select id from repo where name = ?", (self.name,)).fetchone()
        if old:  # a rescan replaces the repo's nodes and edges; global vocabulary nodes stay
            self.con.execute("delete from edge where src in (select id from node where repo_id = ?) or dst in (select id from node where repo_id = ?)", (old[0], old[0]))
            self.con.execute("delete from node where repo_id = ?", (old[0],))
            self.con.execute("delete from repo where id = ?", (old[0],))
        cur = self.con.execute("insert into repo(name, url, commit_sha, license, root, scanned_at) values (?,?,?,?,?,?)",
                               (self.name, url, commit, license_id, str(self.root), datetime.now(timezone.utc).isoformat(timespec="seconds")))
        self.w = Writer(self.con, cur.lastrowid)
        rid = self.w.node("product", self.name, sub="repository", qualname=f"repo:{self.name}", doc=url)
        langs = Counter()
        by_lang: dict[str, list[str]] = defaultdict(list)
        for dirpath, dirs, names in os.walk(self.root):
            dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not d.startswith(".") or d in {".github", ".agents", ".claude-plugin", ".codex", ".cursor", ".pi"})
            for fname in sorted(names):
                abs_path = Path(dirpath) / fname
                rel = abs_path.relative_to(self.root).as_posix()
                try:
                    size = abs_path.stat().st_size
                except OSError:
                    continue
                ext = abs_path.suffix.lower()
                lang = LANG.get(ext, "makefile" if fname == "Makefile" else "dockerfile" if fname == "Dockerfile" else None)
                role = role_of(rel)
                if lang is None and size > 64 * 1024:
                    continue
                langs[lang or "other"] += 1
                digest = hashlib.sha256(abs_path.read_bytes()).hexdigest() if size <= TEXT_LIMIT else None
                fid = self.w.node("file", fname, sub=role, qualname=rel, path=rel, lang=lang, attrs={"bytes": size, "sha256": digest})
                self.files[rel] = fid
                self.w.edge(rid, fid, "contains")
                self.tag_node(fid, "file", rel)
                self.stats["files"] += 1
                if size > TEXT_LIMIT or lang is None and fname not in ("Makefile", "Dockerfile"):
                    continue
                if lang in ("ts", "js"):
                    by_lang["js"].append(rel)
                    continue
                if lang == "go":
                    by_lang["go"].append(rel)
                    continue
                text = abs_path.read_text(errors="replace")
                if fname in ("package.json", "pyproject.toml", "go.mod", "Cargo.toml", "plugin.json", "gemini-extension.json", "plugin.yaml", "server.json", "hooks.json", "mcp.json", ".mcp.json"):
                    self.manifest(rel, text)
                if lang == "py":
                    self.python_file(rel, text)
                elif lang == "md":
                    self.markdown_file(rel, text, role)
                elif lang == "yaml" and role == "ci":
                    self.workflow_file(rel, text)
                elif lang in self.PATTERNS:
                    self.pattern_file(rel, lang, text)
                elif fname == "Makefile":
                    for m in re.finditer(r"^([a-zA-Z][\w.-]*):(?!=)", text, re.M):
                        eid = self.w.node("entrypoint", m.group(1), sub="make-target", qualname=f"make-target:{m.group(1)}", path=rel)
                        self.w.edge(eid, self.files[rel], "implemented_by")
        if shutil.which("node") and (HERE / "helpers" / "node_modules" / "@babel" / "parser").exists():
            self.run_helper(["node", "js_extract.mjs"], by_lang["js"], "js")
        elif by_lang["js"]:
            self.stats["js_files_without_parser"] = len(by_lang["js"])  # file-level facts only; see README
        go_bin = HERE / ".bin" / "go_extract"
        if go_bin.exists():
            self.run_helper([str(go_bin)], by_lang["go"], "go")
        elif by_lang["go"]:
            self.stats["go_files_without_parser"] = len(by_lang["go"])
        self.resolve()
        self.con.execute("update repo set file_count = ?, languages = ? where id = ?", (self.stats["files"], json.dumps(dict(langs.most_common())), self.w.repo_id))
        self.con.commit()
        return dict(self.stats)

    def resolve(self) -> None:
        # Calls: same file first, then a unique definition elsewhere in the repo. Names that
        # are also common builtin/container methods are never resolved across files.
        for caller, callee, rel, local_only in self.pending_calls:
            if callee in COMMON_CALLS or len(callee) < 3:
                continue
            target = self.symbols_by_file[rel].get(callee)
            if target is None and not local_only:
                cands = self.symbols_by_name.get(callee, [])
                target = cands[0] if len(cands) == 1 else None
            if target is not None:
                self.w.edge(caller, target, "calls")
                self.stats["calls"] += 1
        # Imports: relative paths resolve to files; bare names to dependency packages.
        deps = {r["name"]: r["id"] for r in self.con.execute("select id, name from node where repo_id = ? and kind = 'dependency'", (self.w.repo_id,))}
        exts = ["", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", "/index.ts", "/index.js", "/__init__.py", ".d.ts"]
        for rel, spec, lang in self.pending_imports:
            src = self.files[rel]
            if spec.startswith("."):
                if lang == "py":
                    level = len(spec) - len(spec.lstrip("."))
                    base = Path(rel).parent
                    for _ in range(level - 1):
                        base = base.parent
                    stem = (base / spec.lstrip(".").replace(".", "/")).as_posix()
                else:
                    stem = os.path.normpath(Path(rel).parent / spec).replace("\\", "/")
                    stem = re.sub(r"\.(m|c)?js$", "", stem) if lang == "js" and not (self.root / stem).exists() else stem
                hit = next((self.files[stem + e] for e in exts if stem + e in self.files), None)
                if hit:
                    self.w.edge(src, hit, "imports")
                    self.stats["imports_internal"] += 1
                continue
            name = spec.split("/")[0] if not spec.startswith("@") else "/".join(spec.split("/")[:2])
            if lang == "py":
                name = spec.split(".")[0]
                local = next((self.files[f] for f in (f"{spec.replace('.', '/')}.py", f"{spec.replace('.', '/')}/__init__.py") if f in self.files), None)
                if local:
                    self.w.edge(src, local, "imports")
                    self.stats["imports_internal"] += 1
                    continue
            if lang == "go":
                if "." not in spec.split("/")[0]:
                    continue  # Go standard library
                name = spec
            if lang == "py" and name in PY_STDLIB:
                continue
            did = deps.get(name)
            if did is None and not name.startswith("node:"):
                did = self.w.node("dependency", name, sub="imported", qualname=f"imported:{name}")
                deps[name] = did
            if did is not None:
                self.w.edge(src, did, "imports")
                self.stats["imports_external"] += 1
