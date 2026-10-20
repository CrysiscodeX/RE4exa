#!/usr/bin/env python3
"""Measure the rex numbers quoted in README.md section 6 and write results/rex-measurements.json.

usage: measure_rex.py <rea-agents-6.7.0.tgz> [<out.json>]
  get the package with `npm pack rea-agents@6.7.0`. Each timing is the median of 5 runs of the
  rex CLI as a fresh process (store in a temporary directory), so it includes Python start-up.
"""

from __future__ import annotations

import hashlib
import json
import platform
import statistics
import subprocess
import sys
import tarfile
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REX = HERE.parents[1] / "tools" / "rex" / "rex.sh"


def run(*args: str, store: str) -> tuple[float, dict]:
    t = time.perf_counter()
    p = subprocess.run([str(REX), "--store", store, *args], capture_output=True, text=True, timeout=300)
    dt = time.perf_counter() - t
    if p.returncode:
        raise SystemExit(f"rex {' '.join(args)} failed: {p.stdout[-500:]} {p.stderr[-500:]}")
    return dt, json.loads(p.stdout)


def timed(*args: str, n: int = 5) -> tuple[float, dict]:
    times, out = [], None
    for _ in range(n):
        with tempfile.TemporaryDirectory() as t:
            dt, out = run(*args, store=str(Path(t) / "rex.db"))
            times.append(dt)
    return round(statistics.median(times), 3), out


def catalog_bytes() -> dict:
    msgs = [{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}, {"jsonrpc": "2.0", "id": 2, "method": "tools/list"}]
    p = subprocess.run([str(REX), "mcp"], input="\n".join(json.dumps(m) for m in msgs) + "\n", capture_output=True, text=True, timeout=60)
    res = [json.loads(line) for line in p.stdout.splitlines()]
    tools = next(r["result"] for r in res if r["id"] == 2)
    return {"tools": len(tools["tools"]), "bytes": len(json.dumps(tools, separators=(",", ":")).encode()),
            "method": "length of the tools/list result serialized as compact JSON"}


def main() -> None:
    tgz = Path(sys.argv[1]).resolve()
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / "results" / "rex-measurements.json"
    res = {"rex_measurements": 1, "package": tgz.name, "package_sha256": hashlib.sha256(tgz.read_bytes()).hexdigest(),
           "python": platform.python_version(), "platform": platform.platform(), "runs_per_timing": 5}
    t, inv = timed("inventory", str(tgz))
    r = inv["result"]
    res["inventory_tgz"] = {"median_seconds": t, "entries": r["count"], "integrity_mismatches": len(r["integrity_mismatches"]), "evidence_id": inv["evidence"]["id"]}
    with tempfile.TemporaryDirectory() as d:
        with tarfile.open(tgz) as tf:
            m = tf.getmember("package/native/windows/build/rea-windows-x64.node")
            tf.extractall(d, members=[m], filter="data")
        addon = Path(d) / m.name
        t, nat = timed("native", str(addon))
        nr = nat["result"]
        res["native_windows_addon"] = {"median_seconds": t, "sha256": hashlib.sha256(addon.read_bytes()).hexdigest(), "evidence_id": nat["evidence"]["id"],
                                       "format": nr.get("format"), "exports": len(nr.get("exports") or []), "imports": len(nr.get("imports") or [])}
    res["mcp_catalog"] = catalog_bytes()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(res, indent=1) + "\n")
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
