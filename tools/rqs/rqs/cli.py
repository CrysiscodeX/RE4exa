"""rqs: evidence-first quality reviews against the RQS-2030 standard, for agents and people.

Commands print one JSON document; `report` and `compare --md` print Markdown. Probes are
inert: nothing in the target is executed. Unknown stays unknown: an unevidenced criterion is
U, lowers evidence coverage, and never counts as a pass.
"""

from __future__ import annotations

import argparse
import datetime
import json
import sys
from pathlib import Path

from . import __version__
from . import probes as P
from . import report as R
from . import score as S
from . import standard as STD
from . import suggest
from .scan import scan


def _read(path: str) -> dict:
    p = Path(path)
    if not p.exists():
        raise STD.RqsError("file_not_found", f"{path} does not exist", "Pass the path written by `rqs probe --out`, `rqs template` or `rqs score --out`.")
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except ValueError as e:
        raise STD.RqsError("bad_json", f"{path}: {e}", "Fix the JSON syntax (a trailing comma is the usual cause).") from e


def _write(doc, path: str | None):
    if path:
        Path(path).write_text(json.dumps(doc, indent=1, ensure_ascii=False, default=str) + "\n", encoding="utf-8")


INHERITABLE = ("meta.license", "meta.notices", "meta.security_policy", "meta.contributing", "meta.agents_md", "meta.docs", "meta.changelog", "meta.codeowners",
               "meta.governance", "meta.issue_templates", "meta.compliance", "deps.lockfiles", "deps.update_bot", "evo.support", "ai.disclosure")


def probe_doc(path: str, name: str | None = None, only: list[str] | None = None, std: dict | None = None, inherit: str | None = None) -> dict:
    """Probe a checkout. inherit: the repository root of a package inside a monorepo; repository-level
    evidence (license, policies, CI, lockfiles) found there fills probes the package itself lacks."""
    std = std or STD.load()
    root = Path(path)
    if not root.is_dir():
        raise STD.RqsError("not_a_directory", f"{path} is not a directory", "Pass the root of a repository checkout.")
    sc = scan(root)
    res = P.run_all(sc, only)
    inherited = []
    if inherit:
        if not Path(inherit).is_dir():
            raise STD.RqsError("not_a_directory", f"{inherit} is not a directory", "Pass the monorepo root that contains the package.")
        rsc = scan(inherit)
        rres = P.run_all(rsc, [k for k in res if k in INHERITABLE or k.startswith("ci.")])
        for k, v in rres.items():
            if not res[k]["found"] and v["found"]:
                res[k] = {**v, "summary": "(repository) " + v["summary"], "evidence": ["^/" + e for e in v["evidence"]], "inherited_from": str(Path(inherit).resolve())}
                inherited.append(k)
        sc.ci_text = sc.ci_text or rsc.ci_text
    doc = {"rqs_probes": 1, "tool": {"name": "rqs", "version": __version__},
           "standard": {"id": std["standard"]["id"], "version": std["standard"]["version"], "sha256": std["meta"]["source_sha256"]},
           "target": {"path": str(sc.root), "name": name or sc.root.name, "head": sc.git.get("head"), "shallow": sc.git.get("shallow")},
           "scan": sc.to_json(), "git": sc.git, "inherited": inherited, "probes": res}
    if not only:
        fl = suggest.flags(res, sc)
        doc["suggested_flags"] = fl
        doc["suggested_profile"] = suggest.profile(res, fl, sc)
        doc["suggestions"] = suggest.levels(res, fl)
    return doc


def brief(doc: dict) -> dict:
    """Compact view of a probe document: what was found, flags, profile and suggested levels."""
    return {"target": doc["target"], "scan": doc["scan"]["stats"], "suggested_profile": doc.get("suggested_profile"),
            "suggested_flags": {k: v["value"] for k, v in (doc.get("suggested_flags") or {}).items()},
            "found": sorted(k for k, v in doc["probes"].items() if v["found"]), "not_found": sorted(k for k, v in doc["probes"].items() if not v["found"]),
            "suggested_levels": {k: v["level"] for k, v in (doc.get("suggestions") or {}).items()}}


def template(std: dict, pdoc: dict, profile: str | None = None, flags: dict | None = None) -> dict:
    fl = {k: v["value"] for k, v in (pdoc.get("suggested_flags") or {}).items()}
    fl.update(flags or {})
    sug = pdoc.get("suggestions") or {}
    scores = {}
    for c in STD.criteria(std):
        if not STD.applicable(c, fl):
            continue
        s = sug.get(c["id"])
        scores[c["id"]] = ({"level": s["level"], "confidence": s["confidence"], "evidence": s["evidence"], "note": s["basis"], "source": "auto"} if s
                           else {"level": "U", "confidence": "inferred", "evidence": [], "note": "", "source": "auto"})
    return {"rqs_review": 1, "target": pdoc.get("target", {}), "profile": profile or (pdoc.get("suggested_profile") or {}).get("profile"),
            "flags": fl, "reviewer": {"id": "", "kind": "agent", "conflicts": ""}, "date": datetime.date.today().isoformat(),
            "scores": scores, "gaps": [], "opportunities": [], "reengineering": [], "questions": [], "not_examined": [], "time_minutes": None,
            "_help": {"scores": "Set level (0-5, U, NA), confidence (observed|derived|inferred), evidence (path:line, command, measurement) and change source to "
                                "\"review\". Entries left with source \"auto\" count as unreviewed suggestions.",
                      "gap": {"lens": "G1-G14", "title": "", "case": "concrete reproduction or file:line", "impact": "", "fix": "", "severity": "critical|high|medium|low",
                              "evidence": []},
                      "opportunity": {"lens": "O1-O14", "criterion": "OPP-1..7", "title": "", "description": "", "value": "1-5", "reach": "1-5",
                                      "confidence": "observed|derived|inferred", "horizon_fit": "1.0-1.5", "effort": "1-5", "action": "keep|harden|refactor|extract|consolidate|"
                                      "re-platform|re-cut-interface|rewrite|replace|retire", "evidence": []},
                      "reengineering": {"action": "", "component": "", "gain": "", "measure": ""}}}


def describe(std: dict) -> dict:
    return {"tool": "rqs", "version": __version__, "purpose": __doc__.strip().split("\n")[0],
            "standard": {"id": std["standard"]["id"], "version": std["standard"]["version"], "dimensions": [d["id"] for d in std["dimensions"]],
                         "criteria": sum(len(d["criteria"]) for d in std["dimensions"]), "profiles": list(std["profiles"]), "flags": list(std["applicability_flags"])},
            "commands": {n: p.description for n, p in SUB.items()}, "probes": sorted(P.PROBES),
            "workflow": ["rqs probe <repo> --out probes.json", "rqs template probes.json --out review.json", "edit review.json: levels, evidence, gaps, opportunities",
                         "rqs score probes.json review.json --out scorecard.json", "rqs report scorecard.json > report.md", "rqs compare cards/*.json --md"],
            "rules": ["Probes never execute the target.", "found=false means not found in the scanned files, not absent.",
                      "U is never a pass; coverage below 60% makes the grade provisional and caps it at C.",
                      "Automatic red-line suspicions do not cap the grade until a reviewer confirms them or the evidence is observed."]}


def dispatch(a, std: dict | None = None):
    std = std or STD.load(getattr(a, "standard", None))
    if a.cmd == "describe":
        return describe(std)
    if a.cmd == "criteria":
        cs = [c for c in STD.criteria(std) if (not a.id or c["id"] in a.id.split(",")) and (not a.dimension or c["dimension"] == a.dimension.upper())]
        if not cs:
            raise STD.RqsError("no_match", "no criteria match", "Use a dimension id (e.g. SEC) or criterion ids (e.g. SEC-1,PRV-3).")
        if a.brief:
            cs = [{k: c.get(k) for k in ("id", "title", "question", "core", "red_line", "applies_if")} for c in cs]
        return {"criteria": cs, "count": len(cs)}
    if a.cmd == "lenses":
        lz = std["lenses"]
        return {k: v for k, v in {"gaps": lz["gaps"], "opportunities": lz["opportunities"], "reengineering": std["reengineering"],
                                   "opportunity_criteria": std["opportunity_dimension"]["criteria"]}.items() if not a.kind or k == a.kind}
    if a.cmd == "probe":
        doc = probe_doc(a.path, a.name, a.only.split(",") if a.only else None, std, getattr(a, "inherit", None))
        if a.out:
            _write(doc, a.out)
            return {"wrote": a.out, **brief(doc)}
        return brief(doc) if a.brief else doc
    if a.cmd == "template":
        flags = {f.split("=")[0]: f.split("=")[1].lower() in ("1", "true", "yes") for f in (a.flag or [])}
        doc = template(std, _read(a.probes), a.profile, flags)
        if a.out:
            _write(doc, a.out)
            return {"wrote": a.out, "criteria": len(doc["scores"]), "profile": doc["profile"], "flags": doc["flags"]}
        return doc
    if a.cmd == "score":
        review = _read(a.review) if a.review else None
        card = S.score(std, _read(a.probes) if a.probes != "-" else None, review)
        if a.second:
            card["agreement"] = S.agree(std, review or {}, _read(a.second))
        if a.out:
            _write(card, a.out)
            return {"wrote": a.out, "summary": card["summary"], "dimensions": {d["id"]: d["score"] for d in card["dimensions"]}}
        return card
    if a.cmd == "report":
        return R.report(_read(a.scorecard))
    if a.cmd == "compare":
        cmp = R.compare([_read(p) for p in a.scorecards])
        return R.compare_md(cmp) if a.md else cmp
    if a.cmd == "agree":
        return S.agree(std, _read(a.review_a), _read(a.review_b))
    raise STD.RqsError("unknown_command", a.cmd, "Run `rqs describe`.")


SUB: dict = {}


def parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="rqs", description=__doc__.strip().split("\n")[0])
    ap.add_argument("--standard", help="path to rqs-2030.json (default: standard/rqs-2030.json in this checkout, or $RQS_STANDARD)")
    sp = ap.add_subparsers(dest="cmd", required=True)

    def sub(name, help_):
        p = sp.add_parser(name, help=help_, description=help_)
        SUB[name] = p
        return p
    sub("describe", "Machine-readable contract: commands, probes, workflow and rules.")
    p = sub("criteria", "List criteria (question, anchors, probes, refs).")
    p.add_argument("--id")
    p.add_argument("--dimension")
    p.add_argument("--brief", action="store_true")
    p = sub("lenses", "Gap and opportunity lenses, re-engineering actions and opportunity criteria.")
    p.add_argument("--kind", choices=["gaps", "opportunities", "reengineering", "opportunity_criteria"])
    p = sub("probe", "Collect automated evidence from a repository checkout (inert).")
    p.add_argument("path")
    p.add_argument("--name")
    p.add_argument("--only", help="comma-separated probe ids")
    p.add_argument("--inherit", help="monorepo root whose repository-level evidence (license, policies, CI) applies to this package")
    p.add_argument("--out", help="write the full probe document here and print a brief view")
    p.add_argument("--brief", action="store_true")
    p = sub("template", "Write a review skeleton prefilled with probe-based suggestions.")
    p.add_argument("probes")
    p.add_argument("--profile")
    p.add_argument("--flag", action="append", help="override a flag, e.g. --flag uses_llm=true")
    p.add_argument("--out")
    p = sub("score", "Score a review (and probes) into a scorecard. Use '-' for probes to score a review alone.")
    p.add_argument("probes")
    p.add_argument("review", nargs="?")
    p.add_argument("--second", help="a second reviewer's review of the same target, for agreement")
    p.add_argument("--out")
    p = sub("report", "Render a scorecard as a Markdown report.")
    p.add_argument("scorecard")
    p = sub("compare", "Compare scorecards (JSON, or a Markdown heatmap with --md).")
    p.add_argument("scorecards", nargs="+")
    p.add_argument("--md", action="store_true")
    p = sub("agree", "Inter-rater agreement between two reviews of the same target.")
    p.add_argument("review_a")
    p.add_argument("review_b")
    sub("mcp", "Serve rqs over MCP stdio.")
    return ap


def main(argv=None) -> int:
    a = parser().parse_args(argv)
    if a.cmd == "mcp":
        from .mcp import serve
        return serve(a.standard)
    try:
        res = dispatch(a)
    except STD.RqsError as e:
        print(json.dumps(e.to_json()))
        return 2
    except Exception as e:  # report the cause instead of a traceback
        print(json.dumps({"error": {"code": type(e).__name__, "message": str(e)[:500], "fix": "Check the arguments with `rqs describe`."}}))
        return 1
    if isinstance(res, str):
        print(res)
    else:
        print(json.dumps(res, indent=1, ensure_ascii=False, default=str))
    return 0
