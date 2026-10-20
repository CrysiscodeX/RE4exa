"""Inert, dependency-free readers for the formats agents meet first.

Each reader returns plain data plus the limitations that bound it. Missing metadata
is reported as unknown (None), never as a negative.
"""

from __future__ import annotations

import io
import json
import struct
import tarfile
import zipfile
import zlib
from pathlib import Path

MAGIC = [
    (b"\x7fELF", "elf"), (b"MZ", "pe"), (b"\xcf\xfa\xed\xfe", "macho"), (b"\xce\xfa\xed\xfe", "macho"),
    (b"\xfe\xed\xfa\xcf", "macho"), (b"\xfe\xed\xfa\xce", "macho"), (b"\xca\xfe\xba\xbe", "macho-fat"),
    (b"PK\x03\x04", "zip"), (b"PK\x05\x06", "zip"), (b"\x1f\x8b", "gzip"), (b"\x00asm", "wasm"),
    (b"SQLite format 3\x00", "sqlite"), (b"%PDF", "pdf"), (b"\xc6\x1f\xbc\x03", "hermes-bytecode"),
]


def identify(path: Path) -> dict:
    if path.is_dir():
        kind = "npm-package-dir" if (path / "package.json").is_file() else "directory"
        return {"format": kind, "bytes": None}
    with path.open("rb") as f:
        head = f.read(4096)
    size = path.stat().st_size
    fmt = next((name for magic, name in MAGIC if head.startswith(magic)), None)
    if fmt == "macho-fat" and len(head) >= 8 and struct.unpack(">I", head[4:8])[0] > 40:
        fmt = "java-class"  # 0xCAFEBABE with a large count is a class file, not a fat Mach-O
    if fmt == "gzip":
        try:
            with tarfile.open(path, "r:gz") as t:
                names = t.getnames()[:2000]
            fmt = "npm-tarball" if any(n == "package/package.json" for n in names) else "tar.gz"
        except (tarfile.TarError, OSError, EOFError):
            pass
    if fmt is None and len(head) >= 16 and struct.unpack("<I", head[:4])[0] == 4 and path.suffix == ".asar":
        fmt = "asar"
    if fmt is None and head[:1] in (b"{", b"["):
        try:
            json.loads(path.read_text())
            fmt = "json"
        except (ValueError, UnicodeDecodeError):
            pass
    if fmt is None:
        try:
            head.decode("utf-8")
            fmt = "script" if head.startswith(b"#!") else "text"
        except UnicodeDecodeError:
            fmt = "data"
    return {"format": fmt, "bytes": size}


# ---- archives -----------------------------------------------------------------------------

def _package_json(text: str) -> dict:
    try:
        d = json.loads(text)
    except ValueError:
        return {"parse": "failed"}
    keep = ("name", "version", "main", "module", "type", "bin", "exports", "imports", "engines", "dependencies", "optionalDependencies", "scripts")
    out = {k: d[k] for k in keep if k in d}
    if "dependencies" in out:
        out["dependencies"] = sorted(out["dependencies"])
    if "scripts" in out:
        out["scripts"] = sorted(out["scripts"])
    return out


def inventory(path: Path, fmt: str, limit: int = 100000) -> dict:
    """Entries with sizes and digests; package.json facts when present."""
    import hashlib
    entries, pkg = [], None
    if fmt in ("directory", "npm-package-dir"):
        for p in sorted(path.rglob("*")):
            if any(part in ("node_modules", ".git") for part in p.relative_to(path).parts):
                continue
            if p.is_file():
                data = p.read_bytes()
                rel = p.relative_to(path).as_posix()
                entries.append({"path": rel, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
                if rel == "package.json":
                    pkg = _package_json(data.decode("utf-8", "replace"))
            if len(entries) >= limit:
                break
        lim = ["node_modules/ and .git/ are not inventoried."]
    elif fmt == "zip":
        with zipfile.ZipFile(path) as z:
            for info in z.infolist()[:limit]:
                if info.is_dir():
                    continue
                data = z.read(info)
                entries.append({"path": info.filename, "bytes": info.file_size, "sha256": hashlib.sha256(data).hexdigest()})
                if info.filename.endswith("package.json") and info.filename.count("/") <= 1:
                    pkg = _package_json(data.decode("utf-8", "replace"))
        lim = ["Central-directory entries only; bytes outside entries are not inventoried."]
    elif fmt in ("npm-tarball", "tar.gz"):
        with tarfile.open(path, "r:gz") as t:
            for m in t:
                if not m.isfile():
                    continue
                data = t.extractfile(m).read()
                entries.append({"path": m.name, "bytes": m.size, "sha256": hashlib.sha256(data).hexdigest()})
                if m.name == "package/package.json":
                    pkg = _package_json(data.decode("utf-8", "replace"))
                if len(entries) >= limit:
                    break
        lim = ["Regular files only; links and devices are not followed."]
    elif fmt == "asar":
        raw = path.read_bytes()
        header_len = struct.unpack("<I", raw[12:16])[0]
        header = json.loads(raw[16:16 + header_len])
        base = 8 + struct.unpack("<I", raw[4:8])[0]

        def walk(node, prefix=""):
            for name, child in node.get("files", {}).items():
                p = f"{prefix}{name}"
                if "files" in child:
                    walk(child, p + "/")
                elif child.get("unpacked"):
                    entries.append({"path": p, "bytes": child.get("size"), "sha256": None, "unpacked": True})
                else:
                    off = base + int(child.get("offset", 0))
                    data = raw[off:off + int(child.get("size", 0))]
                    entries.append({"path": p, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                                    "declared_sha256": (child.get("integrity") or {}).get("hash")})
        walk(header)
        lim = ["Unpacked entries are listed without content digests."]
    else:
        raise ValueError(f"no inventory reader for {fmt}")
    kinds: dict[str, int] = {}
    for e in entries:
        ext = Path(e["path"]).suffix.lower() or "(none)"
        kinds[ext] = kinds.get(ext, 0) + 1
    mismatches = [e["path"] for e in entries if e.get("declared_sha256") and e["sha256"] and e["declared_sha256"] != e["sha256"]]
    return {"entries": entries, "count": len(entries), "by_extension": dict(sorted(kinds.items(), key=lambda kv: -kv[1])),
            "package_json": pkg, "integrity_mismatches": mismatches, "truncated": len(entries) >= limit, "limitations": lim}


# ---- native executables -------------------------------------------------------------------

ELF_MACHINE = {3: "x86", 62: "x86_64", 40: "arm", 183: "arm64", 243: "riscv", 8: "mips", 20: "ppc", 21: "ppc64"}
PE_MACHINE = {0x14C: "x86", 0x8664: "x86_64", 0x1C4: "armnt", 0xAA64: "arm64"}


def elf(path: Path) -> dict:
    data = path.read_bytes()
    is64, little = data[4] == 2, data[5] == 1
    e = "<" if little else ">"
    if is64:
        (e_type, e_machine, _, _, _, e_shoff, _, _, _, _, e_shentsize, e_shnum, e_shstrndx) = struct.unpack(e + "HHIQQQIHHHHHH", data[16:64])
    else:
        (e_type, e_machine, _, _, _, e_shoff, _, _, _, _, e_shentsize, e_shnum, e_shstrndx) = struct.unpack(e + "HHIIIIIHHHHHH", data[16:52])
    sections = []
    for i in range(e_shnum):
        off = e_shoff + i * e_shentsize
        if is64:
            name, typ, flags, addr, offset, size, link, info, align, entsize = struct.unpack(e + "IIQQQQIIQQ", data[off:off + 64])
        else:
            name, typ, flags, addr, offset, size, link, info, align, entsize = struct.unpack(e + "IIIIIIIIII", data[off:off + 40])
        sections.append({"name_off": name, "type": typ, "offset": offset, "size": size, "link": link, "entsize": entsize})
    shstr = sections[e_shstrndx] if e_shstrndx < len(sections) else None
    for s in sections:
        s["name"] = _cstr(data, shstr["offset"] + s["name_off"]) if shstr else ""
    by_name = {s["name"]: s for s in sections}
    exports, needed = [], []
    dynsym, dynstr = by_name.get(".dynsym"), by_name.get(".dynstr")
    if dynsym and dynstr:
        step = 24 if is64 else 16
        for off in range(dynsym["offset"] + step, dynsym["offset"] + dynsym["size"], step):
            if is64:
                st_name, st_info, _, st_shndx, _, _ = struct.unpack(e + "IBBHQQ", data[off:off + 24])
            else:
                st_name, _, _, st_info, _, st_shndx = struct.unpack(e + "IIIBBH", data[off:off + 16])
            if st_shndx != 0 and (st_info >> 4) in (1, 2) and st_name:  # defined GLOBAL/WEAK
                exports.append(_cstr(data, dynstr["offset"] + st_name))
    dyn = by_name.get(".dynamic")
    if dyn and dynstr:
        step = 16 if is64 else 8
        for off in range(dyn["offset"], dyn["offset"] + dyn["size"], step):
            tag, val = struct.unpack(e + ("qQ" if is64 else "iI"), data[off:off + step])
            if tag == 0:
                break
            if tag == 1:
                needed.append(_cstr(data, dynstr["offset"] + val))
    return {"class": 64 if is64 else 32, "endian": "little" if little else "big", "type": {1: "relocatable", 2: "executable", 3: "shared-object", 4: "core"}.get(e_type, e_type),
            "machine": ELF_MACHINE.get(e_machine, e_machine), "sections": [s["name"] for s in sections if s["name"]],
            "exports": sorted(set(exports)), "needed": needed,
            "markers": {"go_buildinfo": ".go.buildinfo" in by_name, "rust_dep_v0": ".dep-v0" in by_name, "debug_info": ".debug_info" in by_name,
                        "node_addon": any(x.startswith("napi_register_module") or x == "node_register_module_v1" or x.startswith("_ZN4Napi") for x in exports)},
            "_raw": data, "_sections": by_name, "_e": e}


def pe(path: Path) -> dict:
    data = path.read_bytes()
    lfanew = struct.unpack("<I", data[0x3C:0x40])[0]
    if data[lfanew:lfanew + 4] != b"PE\x00\x00":
        raise ValueError("MZ header without a PE signature")
    machine, nsec, _, _, _, opt_size, chars = struct.unpack("<HHIIIHH", data[lfanew + 4:lfanew + 24])
    opt = lfanew + 24
    magic = struct.unpack("<H", data[opt:opt + 2])[0]
    plus = magic == 0x20B
    dd = opt + (112 if plus else 96)
    ndd = struct.unpack("<I", data[dd - 4:dd])[0]
    dirs = [struct.unpack("<II", data[dd + 8 * i: dd + 8 * i + 8]) for i in range(min(ndd, 16))]
    sec_off = opt + opt_size
    sections = []
    for i in range(nsec):
        s = data[sec_off + 40 * i: sec_off + 40 * (i + 1)]
        name = s[:8].rstrip(b"\x00").decode("latin-1")
        vsize, va, rsize, raw = struct.unpack("<IIII", s[8:24])
        sections.append({"name": name, "va": va, "vsize": vsize, "raw": raw, "rsize": rsize})

    def rva(r):
        for s in sections:
            if s["va"] <= r < s["va"] + max(s["vsize"], s["rsize"]):
                return s["raw"] + r - s["va"]
        return None

    exports, imports, cli = [], [], False
    if dirs and dirs[0][0]:
        off = rva(dirs[0][0])
        if off is not None:  # IMAGE_EXPORT_DIRECTORY: NumberOfNames at +24, AddressOfNames at +32
            n_names = struct.unpack("<I", data[off + 24:off + 28])[0]
            names_off = rva(struct.unpack("<I", data[off + 32:off + 36])[0])
            for i in range(min(n_names, 100000)):
                exports.append(_cstr(data, rva(struct.unpack("<I", data[names_off + 4 * i: names_off + 4 * i + 4])[0])))
    if len(dirs) > 1 and dirs[1][0]:
        off = rva(dirs[1][0])
        while off is not None and off + 20 <= len(data):
            name_rva = struct.unpack("<I", data[off + 12:off + 16])[0]
            if name_rva == 0:
                break
            imports.append(_cstr(data, rva(name_rva)))
            off += 20
    if len(dirs) > 14 and dirs[14][0]:
        cli = True
    return {"format": "pe32+" if plus else "pe32", "machine": PE_MACHINE.get(machine, hex(machine)), "dll": bool(chars & 0x2000),
            "sections": [s["name"] for s in sections], "exports": sorted(exports), "imports": imports,
            "markers": {"managed_cli_header": cli, "resources": bool(len(dirs) > 2 and dirs[2][0]), "go_buildinfo": b"\xff Go buildinf:" in data,
                        "node_addon": any(x.startswith("napi_register_module") or x == "node_register_module_v1" for x in exports)},
            "_raw": data}


def macho(path: Path) -> dict:
    data = path.read_bytes()
    magic = struct.unpack("<I", data[:4])[0]
    e = "<" if magic in (0xFEEDFACF, 0xFEEDFACE) else ">"
    is64 = magic in (0xFEEDFACF, 0xCFFAEDFE)
    cputype, _, filetype, ncmds, _, _ = struct.unpack(e + "iiIIII", data[4:28])
    off = 32 if is64 else 28
    dylibs, rpaths = [], []
    for _ in range(ncmds):
        cmd, size = struct.unpack(e + "II", data[off:off + 8])
        if cmd in (0xC, 0x80000018, 0x8000001F, 0x80000023):  # LOAD_DYLIB, LOAD_WEAK, REEXPORT, LAZY
            name_off = struct.unpack(e + "I", data[off + 8:off + 12])[0]
            dylibs.append(_cstr(data, off + name_off))
        elif cmd == 0x8000001C:  # RPATH
            rpaths.append(_cstr(data, off + struct.unpack(e + "I", data[off + 8:off + 12])[0]))
        off += size
    return {"cpu": {7: "x86", 0x01000007: "x86_64", 12: "arm", 0x0100000C: "arm64"}.get(cputype, cputype),
            "filetype": {1: "object", 2: "executable", 6: "dylib", 8: "bundle"}.get(filetype, filetype),
            "dylibs": dylibs, "rpaths": rpaths, "_raw": data}


def go_buildinfo(data: bytes) -> dict | None:
    """Go >= 1.18 inline build info: version and module lines. None means not found (unknown, not 'not Go')."""
    i = data.find(b"\xff Go buildinf:")
    if i < 0 or len(data) < i + 32:
        return None
    flags = data[i + 15]
    if not flags & 0x2:
        return {"version": None, "modinfo": None, "note": "pre-1.18 pointer format not decoded"}
    pos = i + 32
    out = []
    for _ in range(2):
        n, shift = 0, 0
        while True:
            b = data[pos]; pos += 1
            n |= (b & 0x7F) << shift; shift += 7
            if b < 0x80:
                break
        out.append(data[pos:pos + n].decode("utf-8", "replace")); pos += n
    version, mod = out
    if len(mod) >= 33:
        mod = mod[16:-16]
    lines = [l.split("\t") for l in mod.splitlines()]
    return {"version": version, "path": next((l[1] for l in lines if l[0] == "path"), None),
            "main": next((l[1:] for l in lines if l[0] == "mod"), None), "deps": [l[1:] for l in lines if l[0] == "dep"],
            "settings": dict(l[1].split("=", 1) for l in lines if l[0] == "build" and "=" in l[1])}


def rust_dep_v0(info: dict) -> dict | None:
    s = info.get("_sections", {}).get(".dep-v0")
    if not s:
        return None
    raw = info["_raw"][s["offset"]:s["offset"] + s["size"]]
    return json.loads(zlib.decompress(raw, bufsize=64 << 20))


def _cstr(data: bytes, off: int | None) -> str:
    if off is None or off >= len(data):
        return ""
    end = data.find(b"\x00", off)
    return data[off:end if end >= 0 else len(data)].decode("utf-8", "replace")
