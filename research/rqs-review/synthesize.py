#!/usr/bin/env python3
"""Score every review, compare the targets, and write the cross-repository synthesis.

usage: synthesize.py [--probes-dir DIR] [--rerun-dir DIR]
  --probes-dir   rqs probe documents the reviewers used (written to probes.jsonl.gz; default: read it)
  --rerun-dir    probe documents from a later rqs version, to measure how its suggestions compare

Reads   reviews/*.review.json (primary reviews), second/*.review.json (second reviewer),
        probes.jsonl.gz or DIR/*.json (rqs probe documents)
Writes  probes.jsonl.gz (when --probes-dir is given), reports/<name>.md, results.json, tables.md
"""

from __future__ import annotations

import gzip
import json
import re
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "tools" / "rqs"))
from rqs import report as R  # noqa: E402
from rqs import score as S  # noqa: E402
from rqs import standard as STD  # noqa: E402

REPOS = {"rea": "morluto/rea", "caveman": "JuliusBrussee/caveman", "leanrea": "aicodeking/leanrea", "strix": "usestrix/strix",
         "ponytail": "DietrichGebert/ponytail", "my-jev": "PromptEngineer48/my-jev", "pi-durable": "earendil-works/pi (packages/durable)",
         "absurd": "earendil-works/absurd", "laya-coreml": "mizorewww/laya-coreml", "laya": "NandhaKishorM/laya", "orca": "stablyai/orca",
         "t3code": "pingdotgg/t3code", "pandacode": "aicodeking/pandacode", "agent-sandbox-lockdown": "PromptEngineer48/agent-sandbox-lockdown",
         "re4exa": "CrysiscodeX/RE4exa"}
NAME_RX = {n: re.compile(r"\b" + re.escape(n).replace(r"\-", r"[- ]?") + r"\b", re.I) for n in REPOS}
NAME_RX["pi-durable"] = re.compile(r"\bpi[- ]?durable\b|\bpi/packages/durable\b|\bpi durable\b", re.I)
NAME_RX["rea"] = re.compile(r"\bREA\b(?!d)")


def load_probes(probes_dir: str | None) -> dict:
    bundle = HERE / "probes.jsonl.gz"
    docs = {}
    if probes_dir:
        for p in sorted(Path(probes_dir).glob("*.json")):
            d = json.loads(p.read_text())
            docs[d["target"]["name"]] = d
        with gzip.open(bundle, "wt", encoding="utf-8") as f:
            for name in sorted(docs):
                f.write(json.dumps(docs[name], ensure_ascii=False, separators=(",", ":")) + "\n")
    else:
        with gzip.open(bundle, "rt", encoding="utf-8") as f:
            for line in f:
                d = json.loads(line)
                docs[d["target"]["name"]] = d
    return docs


def mentions(text: str, self_name: str) -> list[str]:
    return sorted(n for n, rx in NAME_RX.items() if n != self_name and rx.search(text or ""))


def main() -> None:
    probes_dir = sys.argv[sys.argv.index("--probes-dir") + 1] if "--probes-dir" in sys.argv else None
    rerun_dir = sys.argv[sys.argv.index("--rerun-dir") + 1] if "--rerun-dir" in sys.argv else None
    std = STD.load()
    probes = load_probes(probes_dir)
    crit = STD.criteria(std)
    (HERE / "reports").mkdir(exist_ok=True)
    targets, cards = [], {}
    auto_cmp = []
    for path in sorted((HERE / "reviews").glob("*.review.json")):
        name = path.name.split(".")[0]
        review = json.loads(path.read_text())
        pdoc = probes.get(name)
        review.setdefault("target", {})
        review["target"] = {**(pdoc or {}).get("target", {}), **review["target"], "name": name, "repo": REPOS.get(name, "")}
        review["target"].pop("path", None)
        card = S.score(std, pdoc, review)
        card["target"].pop("path", None)
        second = HERE / "second" / f"{name}.review.json"
        if second.exists():
            card["agreement"] = S.agree(std, review, json.loads(second.read_text()))
        cards[name] = card
        (HERE / "reports" / f"{name}.md").write_text(R.report(card) + "\n", encoding="utf-8")
        # how well the automatic suggestions predicted the reviewer
        for cid, sug in ((pdoc or {}).get("suggestions") or {}).items():
            r = (review.get("scores") or {}).get(cid) or {}
            a, b = S._level(sug.get("level")), S._level(r.get("level"))
            if isinstance(a, int) and isinstance(b, int):
                auto_cmp.append((name, cid, a, b))
        gaps = card["gaps"]
        opps = card["opportunities"]
        targets.append({
            "name": name, "repo": REPOS.get(name, ""), "head": card["target"].get("head"), "profile": card["profile"],
            "scope_notes": review.get("scope_notes"), "summary": card["summary"],
            "dims": {d["id"]: d["score"] for d in card["dimensions"]},
            "levels": {r["id"]: r["level"] for r in card["criteria"]},
            "gaps": [{k: g.get(k) for k in ("lens", "title", "case", "impact", "fix", "severity")} for g in gaps],
            "opps": [{k: o.get(k) for k in ("lens", "criterion", "title", "description", "value", "reach", "confidence", "horizon_fit", "effort", "action", "priority")} for o in opps],
            "reeng": [{k: r.get(k) for k in ("action", "component", "gain", "measure")} for r in card["reengineering"]],
            "flags": card["flags"], "reviewer": card["reviewer"], "date": card["date"],
        })
    targets.sort(key=lambda t: -(t["summary"]["quality_index"] or 0))

    # cross-target views
    lens_names = {g["id"]: g["name"] for g in std["lenses"]["gaps"]}
    lens_counts = {}
    sev = {}
    for t in targets:
        for g in t["gaps"]:
            k = str(g.get("lens") or "?").split()[0].strip(",;:")
            lens_counts[k] = lens_counts.get(k, 0) + 1
            s = str(g.get("severity") or "?").lower()
            sev[s] = sev.get(s, 0) + 1
    all_opps = sorted(([{**o, "target": t["name"]} for t in targets for o in t["opps"]]), key=lambda o: -(o["priority"] or 0))
    dims_mean = {d: round(statistics.mean(v), 2) for d in [x["id"] for x in std["dimensions"]]
                 if (v := [t["dims"][d] for t in targets if t["dims"][d] is not None])}
    per_crit = []
    for c in crit:
        vals = [(t["name"], t["levels"][c["id"]]) for t in targets if isinstance(t["levels"].get(c["id"]), int)]
        if not vals:
            continue
        best = max(v for _, v in vals)
        per_crit.append({"id": c["id"], "title": c["title"], "n": len(vals), "mean": round(statistics.mean(v for _, v in vals), 2),
                         "at_or_above_3": sum(v >= 3 for _, v in vals), "best": best, "exemplars": [n for n, v in vals if v == best and best >= 3]})
    references = []
    for t in targets:
        for kind, items in (("gap", t["gaps"]), ("opportunity", t["opps"])):
            for it in items:
                for other in mentions(" ".join(str(it.get(k) or "") for k in ("title", "description", "case", "impact", "fix")), t["name"]):
                    references.append({"from": t["name"], "to": other, "kind": kind, "title": it.get("title")})
    agreement = [{"target": n, **{k: c["agreement"][k] for k in ("pairs", "exact", "within_1", "mean_abs_diff", "quadratic_weighted_kappa")},
                  "disagreements": c["agreement"]["disagreements"], "na_or_u_mismatch": c["agreement"]["unknown_or_na_mismatch"]}
                 for n, c in cards.items() if c.get("agreement")]
    pooled = None
    if agreement:
        pa, pb = {"scores": {}}, {"scores": {}}
        for n, c in cards.items():
            if not c.get("agreement"):
                continue
            prim = json.loads((HERE / "reviews" / f"{n}.review.json").read_text())["scores"]
            sec = json.loads((HERE / "second" / f"{n}.review.json").read_text())["scores"]
            for cid in set(prim) & set(sec):
                pa["scores"][f"{n}:{cid}"] = prim[cid]
                pb["scores"][f"{n}:{cid}"] = sec[cid]
        pooled = _pooled_agreement(pa, pb)
    auto = _auto_stats(auto_cmp)
    if rerun_dir:
        rer = []
        for path in sorted((HERE / "reviews").glob("*.review.json")):
            name = path.name.split(".")[0]
            sug = (json.loads((Path(rerun_dir) / f"{name}.json").read_text()).get("suggestions") or {}) if (Path(rerun_dir) / f"{name}.json").exists() else {}
            scores = json.loads(path.read_text()).get("scores") or {}
            for cid, sv in sug.items():
                a, b = S._level(sv.get("level")), S._level((scores.get(cid) or {}).get("level"))
                if isinstance(a, int) and isinstance(b, int):
                    rer.append((name, cid, a, b))
        rerun = {"all": _auto_stats(rer), "excluding_re4exa": _auto_stats([x for x in rer if x[0] != "re4exa"]),
                 "note": "re4exa was changed after its review (fixes from that review), so its rerun is not like-for-like"}
    else:
        rerun = None
    res = {"rqs_results": 1, "standard": {"id": std["standard"]["id"], "version": std["standard"]["version"], "sha256": std["meta"]["source_sha256"]},
           "date": max((t["date"] or "") for t in targets) if targets else None,
           "targets": targets, "dimension_means": dims_mean, "criteria": per_crit, "lens_counts": sorted(
               [{"lens": k, "name": lens_names.get(k, ""), "count": v} for k, v in lens_counts.items()], key=lambda x: -x["count"]),
           "severity_counts": sev, "top_opportunities": [{k: o.get(k) for k in ("target", "title", "description", "priority", "action", "lens")} for o in all_opps[:15]],
           "cross_references": references, "agreement": agreement, "agreement_pooled": pooled, "auto_vs_reviewer": auto,
           "auto_vs_reviewer_excluding_re4exa": _auto_stats([x for x in auto_cmp if x[0] != "re4exa"]), "auto_vs_reviewer_rerun": rerun}
    (HERE / "results.json").write_text(json.dumps(res, indent=1, ensure_ascii=False, default=str) + "\n", encoding="utf-8")
    cmp = R.compare(list(cards.values()))
    (HERE / "tables.md").write_text("# RQS-2030 scores of the fifteen reviewed targets\n\nGenerated by `synthesize.py` from `reviews/`; "
                                    "levels per criterion below the dimension table (NA = not applicable, U = not established).\n\n"
                                    + R.compare_md(cmp) + "\n", encoding="utf-8")
    print(json.dumps({"targets": len(targets), "gaps": sum(len(t["gaps"]) for t in targets), "opportunities": len(all_opps), "agreement": agreement and [
        {k: a[k] for k in ("target", "pairs", "exact", "within_1", "quadratic_weighted_kappa")} for a in agreement], "pooled": pooled,
        "auto_vs_reviewer": auto and {k: auto[k] for k in ("pairs", "exact", "within_1", "mean_reviewer_minus_auto")},
        "rerun": rerun and {k: rerun[k] and {kk: rerun[k][kk] for kk in ("pairs", "exact", "within_1")} for k in ("all", "excluding_re4exa")}}, indent=1))


def _auto_stats(rows: list) -> dict | None:
    """How well probe-based suggestions predicted the reviewers' levels."""
    if not rows:
        return None
    diffs = [b - a for _, _, a, b in rows]
    by_c = {}
    for _, cid, a, b in rows:
        by_c.setdefault(cid, []).append(b - a)
    worst = sorted(((cid, round(statistics.mean(d), 2), sum(abs(x) >= 2 for x in d), len(d)) for cid, d in by_c.items() if len(d) >= 5), key=lambda x: -abs(x[1]))[:10]
    best = sorted(((cid, round(sum(x == 0 for x in d) / len(d), 2), len(d)) for cid, d in by_c.items() if len(d) >= 8), key=lambda x: -x[1])[:8]
    return {"pairs": len(diffs), "exact": round(sum(d == 0 for d in diffs) / len(diffs), 3), "within_1": round(sum(abs(d) <= 1 for d in diffs) / len(diffs), 3),
            "mean_reviewer_minus_auto": round(statistics.mean(diffs), 2),
            "most_biased": [{"id": c, "mean_diff": m, "off_by_2_or_more": k, "pairs": n} for c, m, k, n in worst],
            "most_reliable": [{"id": c, "exact": e, "pairs": n} for c, e, n in best]}


def _pooled_agreement(a: dict, b: dict) -> dict:
    pairs = []
    for k in set(a["scores"]) & set(b["scores"]):
        x, y = S._level(a["scores"][k].get("level")), S._level(b["scores"][k].get("level"))
        if isinstance(x, int) and isinstance(y, int):
            pairs.append((x, y))
    n = len(pairs)
    if not n:
        return None
    k = 6
    obs = [[0] * k for _ in range(k)]
    for x, y in pairs:
        obs[x][y] += 1
    ra = [sum(r) for r in obs]
    rb = [sum(obs[i][j] for i in range(k)) for j in range(k)]
    w = [[(i - j) ** 2 / (k - 1) ** 2 for j in range(k)] for i in range(k)]
    num = sum(w[i][j] * obs[i][j] for i in range(k) for j in range(k))
    den = sum(w[i][j] * ra[i] * rb[j] / n for i in range(k) for j in range(k))
    d = [abs(x - y) for x, y in pairs]
    return {"pairs": n, "exact": round(sum(v == 0 for v in d) / n, 3), "within_1": round(sum(v <= 1 for v in d) / n, 3),
            "quadratic_weighted_kappa": round(1 - num / den, 3) if den else None}


if __name__ == "__main__":
    main()
