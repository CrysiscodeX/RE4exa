"""Probes: the cheapest sufficient observation for a target, recorded as evidence.

Routing follows leanrea's rule (identify by magic bytes, inventory before code,
slice instead of dump). Native readers are pure Python; external engines (REA,
GNU binutils) are optional adapters whose raw output is kept with tool identity.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

from . import formats
from .store import RexError, Store, file_sha256

INERT = "Read as bytes; the target was not executed."


def _subject(path: Path) -> tuple[str, str | None]:
    return str(path.resolve()), file_sha256(path) if path.is_file() else _dir_digest(path)


def _dir_digest(path: Path) -> str | None:
    """Digest over sorted (relative path, file digest) pairs, ignoring node_modules/.git."""
    import hashlib
    if not path.is_dir():
        return None
    h = hashlib.sha256()
    for p in sorted(path.rglob("*")):
        rel = p.relative_to(path)
        if p.is_file() and not any(part in ("node_modules", ".git") for part in rel.parts):
            h.update(rel.as_posix().encode() + b"\x00" + (file_sha256(p) or "").encode() + b"\n")
    return h.hexdigest()


def _require(path: Path) -> Path:
    if not path.exists():
        raise RexError("target_missing", f"{path} does not exist.", "Pass an existing absolute path.", path=str(path))
    return path


def identify(store: Store, path: Path) -> dict:
    path = _require(path)
    sp, sha = _subject(path)
    def run():
        info = formats.identify(path)
        route = ROUTES.get(info["format"], [])
        return store.put(operation="identify", tool="rex.formats", params={}, result={**info, "next_probes": route},
                         confidence="observed", authority="shipped-artifact", limitations=[INERT, "Format is decided by magic bytes and container structure, not file name."],
                         subject_path=sp, subject_sha256=sha)
    return store.step("identify", {}, sha, run)


def inventory(store: Store, path: Path) -> dict:
    path = _require(path)
    sp, sha = _subject(path)
    fmt = formats.identify(path)["format"]
    if fmt not in ("directory", "npm-package-dir", "zip", "npm-tarball", "tar.gz", "asar"):
        raise RexError("unsupported_target", f"inventory reads archives and directories; this target is {fmt}.",
                       f"Use one of: {', '.join(ROUTES.get(fmt, ['identify']))}.", format=fmt)
    def run():
        inv = formats.inventory(path, fmt)
        lim = [INERT, *inv.pop("limitations")]
        return store.put(operation="inventory", tool="rex.formats", params={"format": fmt}, result=inv, confidence="observed",
                         authority="shipped-artifact", limitations=lim, subject_path=sp, subject_sha256=sha)
    return store.step("inventory", {"format": fmt}, sha, run)


def native(store: Store, path: Path) -> dict:
    """Headers, sections, exports, imports/needed and embedded Go/Rust metadata."""
    path = _require(path)
    sp, sha = _subject(path)
    fmt = formats.identify(path)["format"]
    readers = {"elf": formats.elf, "pe": formats.pe, "macho": formats.macho}
    if fmt not in readers:
        raise RexError("unsupported_target", f"native reads ELF, PE and Mach-O; this target is {fmt}.", "Run `rex identify` to route it.", format=fmt)
    def run():
        info = readers[fmt](path)
        raw = info.pop("_raw")
        go = formats.go_buildinfo(raw)
        rust = formats.rust_dep_v0(info) if fmt == "elf" else None
        for k in [k for k in info if k.startswith("_")]:
            info.pop(k)
        lims = [INERT, "Exports are the dynamic symbol table / export directory; static or stripped symbols are not listed."]
        lims.append("Go build info: not found; this does not establish the binary is not Go." if go is None else "Go build info decoded from the inline (>= 1.18) record.")
        if fmt == "elf":
            lims.append("Rust cargo-auditable .dep-v0: not present; absence does not mean no dependencies." if rust is None else "Rust dependencies read from .dep-v0.")
        return store.put(operation="native", tool="rex.formats", params={"format": fmt}, result={"format": fmt, **info, "go_buildinfo": go, "rust_dependencies": rust},
                         confidence="observed", authority="shipped-artifact", limitations=lims, subject_path=sp, subject_sha256=sha)
    return store.step("native", {"format": fmt}, sha, run)


JS_PATTERNS = {
    "static_import": r"""(?:^|[;\s])import\s[^'"]*?from\s*['"]([^'"]+)['"]""",
    "dynamic_import": r"""\bimport\(\s*['"]([^'"]+)['"]""",
    "require": r"""\brequire\(\s*['"]([^'"]+)['"]\s*\)""",
    "import_meta_resolve": r"""import\.meta\.resolve\(\s*['"]([^'"]+)['"]""",
    "url_relative_asset": r"""new URL\(\s*['"]([^'"]+)['"]\s*,\s*(?:new URL\([^)]*\)\.href|import\.meta\.url)""",
    "child_process_call": r"""(?<![\w$.])(spawn|spawnSync|execFile|execFileSync|fork)\(""",  # bare exec() is left out: too often RegExp.exec
    "child_process_member_call": r"""\bchild_process\.(spawn\w*|exec\w*|fork)\(""",
    "native_addon_ref": r"""['"]([^'"]+\.node)['"]""",
    "env_var": r"""process\.env\.([A-Z][A-Z0-9_]+)""",
    "source_map_comment": r"""^//[#@] sourceMappingURL=(\S+)""",
}


def js_refs(store: Store, path: Path, max_samples: int = 12) -> dict:
    """leanrea-style reference sweep over a JS tree: counts plus file:line samples."""
    path = _require(path)
    if not path.is_dir():
        raise RexError("unsupported_target", "js-refs sweeps a directory of JavaScript.", "Inventory the archive, extract it, then sweep the directory.")
    sp, sha = _subject(path)
    def run():
        compiled = {k: re.compile(v, re.M) for k, v in JS_PATTERNS.items()}
        out = {k: {"count": 0, "distinct": {}, "samples": []} for k in JS_PATTERNS}
        files = 0
        for f in sorted(path.rglob("*")):
            rel = f.relative_to(path)
            if not f.is_file() or f.suffix not in (".js", ".mjs", ".cjs", ".ts", ".mts", ".cts") or any(p in ("node_modules", ".git") for p in rel.parts):
                continue
            files += 1
            text = f.read_text(errors="replace")
            for k, rx in compiled.items():
                for m in rx.finditer(text):
                    val = m.group(1)
                    o = out[k]
                    o["count"] += 1
                    o["distinct"][val] = o["distinct"].get(val, 0) + 1
                    if len(o["samples"]) < max_samples:
                        o["samples"].append({"file": rel.as_posix(), "line": text.count("\n", 0, m.start()) + 1, "value": val})
        for o in out.values():
            o["distinct"] = dict(sorted(o["distinct"].items(), key=lambda kv: -kv[1])[:200])
        return store.put(operation="js-refs", tool="rex.probes", params={"patterns": sorted(JS_PATTERNS)}, result={"files": files, "refs": out},
                         confidence="observed", authority="shipped-artifact",
                         limitations=[INERT, "Pattern matches over source text are 'seen strings'; they do not resolve modules or prove execution.",
                                      "node_modules/ and .git/ are skipped."], subject_path=sp, subject_sha256=sha)
    return store.step("js-refs", {"patterns": sorted(JS_PATTERNS)}, sha, run)


def find(store: Store, path: Path, needle: str, context: int = 80, limit: int = 40) -> dict:
    """Slice matches with bounded context instead of dumping files (leanrea's `rg -o '.{0,N}X.{0,N}'`)."""
    path = _require(path)
    sp, sha = _subject(path)
    params = {"needle": needle, "context": context, "limit": limit}
    def run():
        hits, scanned = [], 0
        files = [path] if path.is_file() else sorted(p for p in path.rglob("*") if p.is_file() and not any(x in ("node_modules", ".git") for x in p.relative_to(path).parts))
        rx = re.compile(re.escape(needle.encode()))
        for f in files:
            if f.stat().st_size > 256 << 20:
                continue
            data = f.read_bytes()
            scanned += 1
            for m in rx.finditer(data):
                a, b = max(0, m.start() - context), min(len(data), m.end() + context)
                hits.append({"file": f.relative_to(path).as_posix() if path.is_dir() else f.name, "offset": m.start(),
                             "slice": data[a:b].decode("utf-8", "replace")})
                if len(hits) >= limit:
                    break
            if len(hits) >= limit:
                break
        return store.put(operation="find", tool="rex.probes", params=params, result={"files_scanned": scanned, "hits": hits, "truncated": len(hits) >= limit},
                         confidence="observed", authority="shipped-artifact",
                         limitations=[INERT, "Byte-exact match; a missing match in a truncated scan does not establish absence."], subject_path=sp, subject_sha256=sha)
    return store.step("find", params, sha, run)


def external(store: Store, path: Path, tool: str, args: list[str]) -> dict:
    """Adapter for an external CLI (objdump, readelf, nm, rea, go): raw output kept as evidence."""
    path = _require(path)
    exe = shutil.which(tool)
    if exe is None:
        raise RexError("tool_unavailable", f"{tool} is not on PATH.", f"Install {tool} or use a built-in probe (`rex native`, `rex inventory`).", tool=tool)
    sp, sha = _subject(path)
    version = (subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=30).stdout or "").splitlines()[:1]
    argv = [a.replace("{target}", str(path)) for a in args]
    params = {"tool": tool, "tool_version": version[0] if version else None, "argv": argv}  # a new tool version is a new step
    def run():
        proc = subprocess.run([exe, *argv], capture_output=True, text=True, timeout=600)
        out = proc.stdout
        parsed = None
        if tool == "rea":
            try:
                parsed = json.loads(out)
            except ValueError:
                pass
        result = {"exit": proc.returncode, "stdout": out[:4 << 20], "stderr": proc.stderr[-20000:], "stdout_truncated": len(out) > 4 << 20,
                  "rea_evidence_id": (parsed or {}).get("evidence_id")}
        return store.put(operation=f"external:{tool}", tool=tool, tool_version=version[0] if version else None, params=params, result=result,
                         confidence="observed", authority="external-tool",
                         limitations=["Output of an external program; its own limitations apply.", "Exit status is recorded; a non-zero exit is not hidden."],
                         subject_path=sp, subject_sha256=sha)
    return store.step(f"external:{tool}", params, sha, run)


ROUTES = {
    "elf": ["native", "find", "external readelf/objdump"], "pe": ["native", "find", "external objdump"], "macho": ["native", "find"],
    "zip": ["inventory"], "npm-tarball": ["inventory"], "tar.gz": ["inventory"], "asar": ["inventory"],
    "npm-package-dir": ["inventory", "js-refs", "find"], "directory": ["inventory", "js-refs", "find"],
    "wasm": ["find", "external wasm-objdump"], "sqlite": ["external sqlite3"], "json": ["find"], "text": ["find"], "script": ["find"], "data": ["find"],
    "hermes-bytecode": ["find (strings)"], "java-class": ["find", "external javap"],
}
