#!/usr/bin/env python3
"""Build the RQS-2030 Review Bench page: the template plus the standard and the review results.

usage: build_page.py [out.html]   (default: review-bench.html next to this file)
Also checks that the page's JavaScript scorer agrees with tools/rqs on every bundled review
(needs node; skipped with a message when node is missing).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT / "tools" / "rqs"))
from rqs import score as S  # noqa: E402
from rqs import standard as STD  # noqa: E402


def js(obj) -> str:
    # safe inside <script>: no "</" sequences, no U+2028/2029 surprises
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "review-bench.html"
    std = STD.load()
    results = json.loads(Path(os.environ.get("RQS_RESULTS") or HERE.parent / "results.json").read_text())
    notes = json.loads((HERE / "notes.json").read_text())
    page_results = {**{k: results[k] for k in ("targets", "lens_counts", "top_opportunities", "agreement")}, **notes}
    page = (HERE / "bench.template.html").read_text()
    page = page.replace("/*__STD__*/null", js(std), 1).replace("/*__RESULTS__*/null", js(page_results), 1)
    out.write_text(page, encoding="utf-8")
    print(f"wrote {out} ({len(page.encode()) // 1024} KB)")
    check(page, std, results)


def check(page: str, std: dict, results: dict) -> None:
    """Run the page's score() in node on each bundled review and compare with tools/rqs."""
    node = shutil.which("node")
    if not node:
        print("node not found: skipped the JavaScript scorer check")
        return
    start = page.index("// Python-compatible round(x, nd)")
    end = page.index("/* ---------------- state ---------------- */")
    consts = page[page.index('const CRIT = STD.dimensions'):page.index("// Python-compatible round(x, nd)")]
    reviews = [t["review"] for t in results["targets"]]
    prog = ("const STD = " + js(std) + ";\n" + consts + page[start:end] +
            "\nconst R = " + js(reviews) + ";\nprocess.stdout.write(JSON.stringify(R.map(r => { const s = score(r); return [s.grade, s.qi, s.hri, s.cov, s.dims.map(d => d.score)]; })));")
    p = subprocess.run([node, "-"], input=prog, capture_output=True, text=True, timeout=60)
    if p.returncode:
        raise SystemExit("JavaScript scorer failed:\n" + p.stderr[-2000:])
    got = json.loads(p.stdout)
    bad = []
    for r, g in zip(reviews, got):
        card = S.score(std, None, r)
        want = [card["summary"]["grade"], card["summary"]["quality_index"], card["summary"]["horizon_index"], card["summary"]["evidence_coverage"],
                [d["score"] for d in card["dimensions"]]]
        if want != g:
            bad.append((r["target"]["name"], want, g))
    if bad:
        raise SystemExit("page scorer disagrees with tools/rqs:\n" + "\n".join(map(str, bad)))
    print(f"page scorer matches tools/rqs on {len(reviews)} reviews")


if __name__ == "__main__":
    main()
