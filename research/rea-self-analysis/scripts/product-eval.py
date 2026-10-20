#!/usr/bin/env python3
"""Evaluate the merged product (rex) on the same answer key used for REA.

rex answers questions about REA's published package through its own probes,
every answer is adjudicated against the independent answer key, and the run
reports coverage, calibration, wall time and output size.

usage: python3 product-eval.py <rea-agents-6.7.0.tgz> <extracted package dir> <answer-key.json> <store.db> <out.json>
"""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "tools" / "rex"))
from rex import epistemics, probes  # noqa: E402
from rex.budget import view  # noqa: E402
from rex.store import Store  # noqa: E402

tgz, pkg, key_path, store_path, out_path = map(Path, sys.argv[1:6])
key = json.loads(key_path.read_text())
store_path.unlink(missing_ok=True)
st = Store(store_path)
t0 = time.perf_counter()
out_bytes = 0


def seen(res):
    global out_bytes
    out_bytes += view(res["evidence"])["cost"]["bytes"]  # what an agent would read
    return res["evidence"]


Q = {k: epistemics.add_question(st, text, req)["id"] for k, text, req in [
    ("ship", "Which files does the published package ship, with digests?", "observed"),
    ("entry", "What are the declared entry points?", "observed"),
    ("workers", "Which worker entry points are reached through package.json imports?", "derived"),
    ("bridges", "Which bridge files can the JavaScript reach?", "inferred"),
    ("addon", "Does the package load a native Node addon, and what does it export?", "observed"),
    ("pty_needed", "Which shared libraries does the bundled node-pty addon need?", "observed"),
    ("sourcemaps", "Does the package ship source maps?", "observed"),
    ("spawns", "Which child processes does it start at runtime?", "observed"),
    ("network", "Which network endpoints does it contact at runtime?", "observed"),
]}

inv = seen(probes.inventory(st, tgz))
refs = seen(probes.js_refs(st, pkg))
win = seen(probes.native(st, pkg / "native/windows/build/rea-windows-x64.node"))
pty = seen(probes.native(st, pkg / "node_modules/@lydell/node-pty-linux-x64/pty.node"))
derived_workers = st.put(operation="derive:subpath-workers", tool="product-eval", params={"from": [inv["id"], refs["id"]]},
                         result={"specs": sorted(k for k in refs["result"]["refs"]["import_meta_resolve"]["distinct"] if k.startswith("#")),
                                 "imports_map": inv["result"]["package_json"].get("imports")},
                         confidence="derived", authority="shipped-artifact", limitations=["Joins seen resolve() specifiers with the package imports map."],
                         links=[inv["id"], refs["id"]], subject_sha256=inv["subject_sha256"])

answers = {}
files = {e["path"].removeprefix("package/"): e["sha256"] for e in inv["result"]["entries"]}
answers["ship"] = ("answered", f"{inv['result']['count']} files", "observed", [inv["id"]])
answers["entry"] = ("answered", json.dumps(inv["result"]["package_json"].get("bin")), "observed", [inv["id"]])
workers = [inv["result"]["package_json"]["imports"][s] for s in derived_workers["result"]["specs"]]
answers["workers"] = ("answered", json.dumps(workers), "derived", [derived_workers["id"]])
bridge_specs = sorted({v.split("bridge/", 1)[1] for v in refs["result"]["refs"]["url_relative_asset"]["distinct"] if "bridge/" in v})
answers["bridges"] = ("answered", json.dumps(bridge_specs), "inferred", [refs["id"]])
answers["addon"] = ("answered", json.dumps({"addon": "native/windows/build/rea-windows-x64.node", "exports": win["result"]["exports"]}), "observed", [win["id"], refs["id"]])
answers["pty_needed"] = ("answered", json.dumps(pty["result"]["needed"]), "observed", [pty["id"]])
maps = [p for p in files if p.endswith(".map")]
answers["sourcemaps"] = ("answered", "no .map files and no sourceMappingURL comments" if not maps and refs["result"]["refs"]["source_map_comment"]["count"] == 0 else json.dumps(maps),
                         "observed", [inv["id"], refs["id"]])
answers["spawns"] = ("unknown", None, None, [])  # static probes cannot observe runtime; left honest
# "network" is deliberately left unaccounted to exercise coverage.
for k, (status, text, conf, evs) in answers.items():
    epistemics.answer(st, Q[k], status=status, text=text, confidence=conf, evidence_ids=evs)
elapsed = time.perf_counter() - t0

# Adjudicate against the independent answer key.
truth = {
    "ship": inv["result"]["count"] == key["inventory"]["file_count"] and all(files.get(p) == d["sha256"] for p, d in key["file_digests"].items()),
    "entry": inv["result"]["package_json"].get("bin") == key["package"]["bin"],
    "workers": workers == [key["package"]["imports"]["#javascript-analysis-worker"]],
    "bridges": set(bridge_specs) >= {t["target"].split("bridge/", 1)[1] for t in key["javascript"]["url_refs_to_bridges"]},
    "addon": [x.split("] ")[1] for x in key["native"]["windows_addon"]["pe_exports"]] == win["result"]["exports"],
    "pty_needed": pty["result"]["needed"] == key["native"]["node_pty_linux_x64"]["needed"],
    "sourcemaps": not key["javascript"]["source_map_files"] and not key["javascript"]["source_mapping_url_comments"] and not maps,
}
for k, ok in truth.items():
    epistemics.adjudicate(st, Q[k], "correct" if ok else "incorrect")
result = {"elapsed_seconds": round(elapsed, 2), "agent_visible_bytes": out_bytes, "probes": 4, "evidence_records": len(st.list(limit=1000)),
          "adjudication": truth, "coverage": epistemics.coverage(st), "calibration": epistemics.calibrate(st)}
out_path.write_text(json.dumps(result, indent=1))
print(json.dumps({k: result[k] for k in ("elapsed_seconds", "agent_visible_bytes", "adjudication")}, indent=1))
print(json.dumps({k: result["coverage"][k] for k in ("total", "answered", "partial", "unknown", "unaccounted", "complete", "caveats")}, indent=1))
print(json.dumps(result["calibration"]["classes"], indent=1))
