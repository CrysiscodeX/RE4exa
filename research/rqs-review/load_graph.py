#!/usr/bin/env python3
"""Load the RQS-2030 review results into a dissect database, next to the code graph.

usage: load_graph.py <dissection.db> [results.json]

Adds, per reviewed target: a review node (grade, QI, HRI, coverage, red lines) linked to the
target's repository node; `scored` edges to the 62 criterion nodes (weight = level); gap and
opportunity nodes with `via` edges to their lens; and `relates_to` edges when a gap or an
opportunity names another reviewed target. Targets that were never scanned get a repository
node without code. Re-running replaces the review layer.

Example queries afterwards:
  dissect --db X query "select c.name, avg(e.weight) from edge e join node c on c.id=e.dst where e.kind='scored' group by c.name order by 2 limit 10"
  dissect --db X query "select s.name, d.name, e.attrs from edge e join node s on s.id=e.src join node d on d.id=e.dst where e.kind='relates_to'"
"""

from __future__ import annotations

import datetime
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "tools" / "dissect"))
sys.path.insert(0, str(HERE.parents[1] / "tools" / "rqs"))
from dissect.db import Writer, connect  # noqa: E402
from rqs import standard as STD  # noqa: E402

LAYER = ("review", "criterion", "lens", "opportunity", "reengineering")


def main() -> None:
    db = sys.argv[1]
    res = json.loads(Path(sys.argv[2] if len(sys.argv) > 2 else HERE / "results.json").read_text())
    std = STD.load()
    con = connect(db)
    layer = "select id from node where kind in ({}) or (kind='finding' and sub='rqs-gap')".format(",".join("?" * len(LAYER)))
    con.execute(f"delete from edge where src in ({layer}) or dst in ({layer})", LAYER + LAYER)
    con.execute(f"delete from node where id in ({layer})", LAYER)
    w = Writer(con, None)
    crit = {c["id"]: w.node("criterion", c["id"], sub=c["dimension"], qualname=f"rqs:{c['id']}", doc=c["title"] + ". " + c["question"],
                            attrs={"core": bool(c.get("core")), "red_line": bool(c.get("red_line")), "applies_if": c.get("applies_if")}) for c in STD.criteria(std)}
    lens = {g["id"]: w.node("lens", g["id"], sub="gap", qualname=f"rqs:{g['id']}", doc=g["name"] + ": " + g["ask"]) for g in std["lenses"]["gaps"]}
    lens.update({g["id"]: w.node("lens", g["id"], sub="opportunity", qualname=f"rqs:{g['id']}", doc=g["name"] + ": " + g["heuristic"]) for g in std["lenses"]["opportunities"]})
    products = {}
    for t in res["targets"]:
        row = con.execute("select id from repo where name = ?", (t["name"],)).fetchone()
        if row is None:
            rid = con.execute("insert into repo(name, url, commit_sha, root, scanned_at) values (?,?,?,?,?)",
                              (t["name"], f"https://github.com/{t['repo'].split(' ')[0]}" if t["repo"] else None, t.get("head"), "(review only, not scanned)",
                               datetime.date.today().isoformat())).lastrowid
        else:
            rid = row[0]
        products[t["name"]] = w.node("product", t["name"], sub="repository", qualname=f"repo:{t['name']}", repo_id=rid)
    counts = {"reviews": 0, "scored": 0, "gaps": 0, "opportunities": 0, "relations": 0}
    for t in res["targets"]:
        rid = con.execute("select id from repo where name = ?", (t["name"],)).fetchone()[0]
        s = t["summary"]
        rv = w.node("review", t["name"], sub=t["profile"], qualname=f"review:{t['name']}", repo_id=rid,
                    doc=t.get("scope_notes") or "", attrs={"grade": s["grade"], "qi": s["quality_index"], "hri": s["horizon_index"], "coverage": s["evidence_coverage"],
                                                          "red_lines": [r["criterion"] for r in s["red_lines"]], "dims": t["dims"]})
        w.edge(rv, products[t["name"]], "reviews")
        counts["reviews"] += 1
        for cid, lvl in t["levels"].items():
            if isinstance(lvl, int):
                w.edge(rv, crit[cid], "scored", float(lvl))
                counts["scored"] += 1
        for i, g in enumerate(t["gaps"]):
            gid = w.node("finding", g["title"] or f"gap {i}", sub="rqs-gap", qualname=f"gap:{t['name']}:{i}", repo_id=rid,
                         doc=" ".join(str(g.get(k) or "") for k in ("impact", "fix")), attrs={k: g.get(k) for k in ("severity", "lens", "case")})
            w.edge(products[t["name"]], gid, "has_gap")
            if str(g.get("lens") or "").split()[0:1] and str(g["lens"]).split()[0] in lens:
                w.edge(gid, lens[str(g["lens"]).split()[0]], "via")
            counts["gaps"] += 1
        for i, o in enumerate(t["opps"]):
            oid = w.node("opportunity", o["title"] or f"opportunity {i}", sub=o.get("action"), qualname=f"opp:{t['name']}:{i}", repo_id=rid,
                         doc=o.get("description") or "", attrs={k: o.get(k) for k in ("priority", "value", "reach", "confidence", "horizon_fit", "effort", "criterion", "lens")})
            w.edge(products[t["name"]], oid, "offers", float(o.get("priority") or 1))
            if str(o.get("lens") or "").split()[0:1] and str(o["lens"]).split()[0] in lens:
                w.edge(oid, lens[str(o["lens"]).split()[0]], "via")
            counts["opportunities"] += 1
    for ref in res.get("cross_references", []):
        if ref["from"] in products and ref["to"] in products:
            w.edge(products[ref["from"]], products[ref["to"]], "relates_to", attrs={"kind": ref["kind"], "title": ref["title"]})
            counts["relations"] += 1
    con.commit()
    print(json.dumps(counts))


if __name__ == "__main__":
    main()
