# The PE resource answer key for reax (scripts/oracle.ts runs it): pefile's reading of version
# information and string tables. Run with -I and PYTHONPATH set to the pinned pefile install.
#   python3 scripts/oracle-pe.py <file.exe>   prints JSON on stdout
import json
import sys

import pefile

pe = pefile.PE(sys.argv[1], fast_load=False)
out = {"version": None, "strings": [], "manifest": None}
for fi in getattr(pe, "FileInfo", None) or []:
    for entry in fi:
        if entry.Key == b"StringFileInfo":
            for table in entry.StringTable:
                key = table.LangID.decode() if isinstance(table.LangID, bytes) else table.LangID
                out.setdefault("_strings", {})[key.lower()] = {k.decode(): v.decode() for k, v in table.entries.items()}
        elif entry.Key == b"VarFileInfo":
            for var in entry.Var:
                for k, v in var.entry.items():
                    if k == b"Translation" or k == "Translation":
                        out.setdefault("_translations", []).extend(
                            t.replace("0x", "").replace(" ", "") for t in [v] if isinstance(v, str)
                        )
if getattr(pe, "VS_FIXEDFILEINFO", None):
    f = pe.VS_FIXEDFILEINFO[0]
    ver = lambda hi, lo: f"{hi >> 16}.{hi & 0xffff}.{lo >> 16}.{lo & 0xffff}"
    out["version"] = {
        "fileVersion": ver(f.FileVersionMS, f.FileVersionLS),
        "productVersion": ver(f.ProductVersionMS, f.ProductVersionLS),
        "fileOs": f.FileOS,
        "fileType": f.FileType,
        "strings": out.pop("_strings", {}),
        "translations": out.pop("_translations", []),
    }
for t in getattr(pe, "DIRECTORY_ENTRY_RESOURCE", None).entries if hasattr(pe, "DIRECTORY_ENTRY_RESOURCE") else []:
    if t.id == 6:
        # pefile keeps a block's strings on its name directory, keyed by string id
        for n in t.directory.entries:
            lang = n.directory.entries[0].id if n.directory.entries else 0
            for sid, text in sorted(getattr(n.directory, "strings", {}).items()):
                out["strings"].append({"id": sid, "language": lang, "text": text})
    if t.id == 24 and out["manifest"] is None:
        e = t.directory.entries[0].directory.entries[0].data.struct
        out["manifest"] = pe.get_data(e.OffsetToData, e.Size).decode("utf-8")
print(json.dumps(out))
