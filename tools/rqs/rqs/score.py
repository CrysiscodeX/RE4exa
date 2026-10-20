"""Score a review against RQS-2030. Every weight, band and gate is read from the standard.

Levels come from the review when a reviewer set them, otherwise from the probe-based
suggestion (source "auto"), otherwise U. Red lines are confirmed only by a reviewer's level
or by observed evidence; an automatic suspicion is reported but does not cap the grade.
"""

from __future__ import annotations

import re

from . import standard as stdmod

SEVERITY = {"critical": 0, "high": 1, "medium": 2, "low": 3}
OPP_CONF = {"observed": 1.0, "derived": 0.8, "inferred": 0.5}  # standard: scoring.opportunity_priority


def _level(x):
    if x is None:
        return "U"
    if isinstance(x, str):
        x = x.strip().upper()
        if x in ("U", "NA"):
            return x
        if x.isdigit():
            x = int(x)
        else:
            raise stdmod.RqsError("bad_level", f"level {x!r} is not 0-5, U or NA", "Use an integer 0-5, \"U\" or \"NA\".")
    if isinstance(x, (int, float)) and 0 <= x <= 5:
        return int(x)
    raise stdmod.RqsError("bad_level", f"level {x!r} is not 0-5, U or NA", "Use an integer 0-5, \"U\" or \"NA\".")


def resolve(std: dict, probes_doc: dict | None, review: dict | None) -> dict:
    """Merge review, suggestions and the standard into criterion records."""
    review = review or {}
    probes_doc = probes_doc or {}
    sug_flags = {k: v["value"] for k, v in (probes_doc.get("suggested_flags") or {}).items()}
    flags = {**sug_flags, **(review.get("flags") or {})}
    profile = review.get("profile") or (probes_doc.get("suggested_profile") or {}).get("profile") or "agent-tool"
    if profile not in std["profiles"]:
        raise stdmod.RqsError("unknown_profile", f"profile {profile!r} is not defined", f"Use one of: {', '.join(std['profiles'])}.")
    auto = probes_doc.get("suggestions") or {}
    scores = review.get("scores") or {}
    unknown = sorted(set(scores) - {c["id"] for c in stdmod.criteria(std)})
    if unknown:
        raise stdmod.RqsError("unknown_criteria", f"review scores unknown criteria {unknown}", "Run `rqs criteria` for valid ids.")
    recs = []
    for c in stdmod.criteria(std):
        r = scores.get(c["id"]) or {}
        src = "review" if r.get("level") is not None and r.get("source") != "auto" else None
        a = auto.get(c["id"]) if src is None else None
        if src is None and r.get("level") is not None:  # an untouched template entry
            a = r
        level = _level(r["level"]) if src else _level(a["level"]) if a else "U"
        conf = (r.get("confidence") if src else (a or {}).get("confidence")) or "inferred"
        if conf not in std["confidence"]:
            raise stdmod.RqsError("bad_confidence", f"{c['id']}: confidence {conf!r}", f"Use one of: {', '.join(std['confidence'])}.")
        applicable = stdmod.applicable(c, flags) and level != "NA"
        note = r.get("note") if src else (a or {}).get("basis")
        if not stdmod.applicable(c, flags):
            level, note = "NA", f"applies only if {c['applies_if']}"
        recs.append({"id": c["id"], "dimension": c["dimension"], "title": c["title"], "level": level, "confidence": conf,
                     "source": src or ("auto" if a else "none"), "applicable": applicable, "core": bool(c.get("core")), "red_line": bool(c.get("red_line")),
                     "evidence": (r.get("evidence") if src else (a or {}).get("evidence")) or [], "note": note or ""})
    return {"flags": flags, "profile": profile, "criteria": recs}


def score(std: dict, probes_doc: dict | None, review: dict | None) -> dict:
    review = review or {}
    res = resolve(std, probes_doc, review)
    crit = res["criteria"]
    W = std["profiles"][res["profile"]]["weights"]
    cw = {k: v["weight"] for k, v in std["confidence"].items()}
    dims = []
    for d in std["dimensions"]:
        rs = [r for r in crit if r["dimension"] == d["id"] and r["applicable"]]
        known = [r for r in rs if isinstance(r["level"], int)]
        num = sum((2 if r["core"] else 1) * cw[r["confidence"]] * r["level"] for r in known)
        den = sum((2 if r["core"] else 1) * cw[r["confidence"]] for r in known)
        dims.append({"id": d["id"], "name": d["name"], "weight": W[d["id"]], "score": round(num / den, 2) if den else None,
                     "known": len(known), "applicable": len(rs), "coverage": round(len(known) / len(rs), 2) if rs else None,
                     "auto": sum(r["source"] == "auto" for r in known)})
    scored = [d for d in dims if d["score"] is not None]
    qi = round(20 * sum(d["weight"] * d["score"] for d in scored) / sum(d["weight"] for d in scored), 1) if scored else None
    known = [r for r in crit if r["applicable"] and isinstance(r["level"], int)]
    appl = [r for r in crit if r["applicable"]]
    hri = round(100 * sum(1.0 if r["level"] == 5 else 0.5 if r["level"] == 4 else 0.0 for r in known) / len(known), 1) if known else None
    cov = round(len(known) / len(appl), 2) if appl else None
    red, suspected = [], []
    by_id = {r["id"]: r for r in crit}
    for rule in std["red_lines"]["rules"]:
        r = by_id[rule["criterion"]]
        m = re.match(r"level (\d)( or below)?", rule["condition"])
        lim, below = int(m.group(1)), bool(m.group(2))
        if isinstance(r["level"], int) and (r["level"] <= lim if below else r["level"] == lim):
            item = {"id": rule["id"], "criterion": r["id"], "text": rule["text"], "level": r["level"], "source": r["source"]}
            (red if r["source"] == "review" or r["confidence"] == "observed" else suspected).append(item)
    bands = sorted(std["scoring"]["grade_bands"].items(), key=lambda x: -x[1])
    order = [g for g, _ in bands]
    band = next((g for g, v in bands if qi is not None and qi >= v), order[-1])
    grade, gates = band, []
    if red and order.index(grade) < order.index("D"):
        grade = "D"
        gates.append("red line: grade capped at D")
    provisional = cov is not None and cov < 0.6
    if provisional and order.index(grade) < order.index("C"):
        grade = "C"
    if provisional:
        gates.append("evidence coverage below 60%: provisional, capped at C")
    blocking = [{"dimension": d["id"], "weight": d["weight"], "score": d["score"]} for d in dims if d["weight"] >= 2.5 and d["score"] is not None and d["score"] < 2]
    opps = []
    for o in review.get("opportunities") or []:
        try:
            pr = o["value"] * o["reach"] * OPP_CONF.get(o.get("confidence", "inferred"), 0.5) * o.get("horizon_fit", 1.0) / max(1, o["effort"])
        except (KeyError, TypeError):
            pr = None
        opps.append({**o, "priority": round(pr, 2) if pr is not None else None})
    opps.sort(key=lambda o: -(o["priority"] or 0))
    gaps = sorted(review.get("gaps") or [], key=lambda g: SEVERITY.get(str(g.get("severity", "low")).lower(), 9))
    auto_share = round(sum(r["source"] == "auto" for r in known) / len(known), 2) if known else None
    meta = probes_doc.get("target") if probes_doc else {}
    return {"rqs_scorecard": 1,
            "standard": {"id": std["standard"]["id"], "version": std["standard"]["version"], "sha256": std["meta"]["source_sha256"]},
            "target": {**(meta or {}), **(review.get("target") or {})}, "profile": res["profile"], "flags": res["flags"],
            "reviewer": review.get("reviewer") or {"id": "rqs-auto", "kind": "tool"}, "date": review.get("date"),
            "summary": {"grade": grade + ("?" if provisional else ""), "band": band, "quality_index": qi, "horizon_index": hri, "evidence_coverage": cov,
                        "provisional": provisional, "red_lines": red, "suspected_red_lines": suspected, "gates": gates, "blocking": blocking,
                        "criteria": {"applicable": len(appl), "known": len(known), "auto": sum(r["source"] == "auto" for r in known), "auto_share": auto_share}},
            "dimensions": dims, "criteria": crit, "gaps": gaps, "opportunities": opps,
            "reengineering": review.get("reengineering") or [], "questions": review.get("questions") or [],
            "not_examined": review.get("not_examined") or [], "time_minutes": review.get("time_minutes")}


def agree(std: dict, a: dict, b: dict) -> dict:
    """Inter-rater agreement on criteria both reviews scored 0-5 (quadratic-weighted kappa)."""
    sa, sb = a.get("scores") or {}, b.get("scores") or {}
    pairs, mismatch = [], []
    for c in stdmod.criteria(std):
        if c["id"] in sa and c["id"] in sb:
            la, lb = _level(sa[c["id"]].get("level")), _level(sb[c["id"]].get("level"))
            if isinstance(la, int) and isinstance(lb, int):
                pairs.append((c["id"], la, lb))
            elif la != lb:
                mismatch.append({"id": c["id"], "a": la, "b": lb})
    n = len(pairs)
    if not n:
        raise stdmod.RqsError("no_overlap", "the two reviews share no numerically scored criteria", "Score at least a few of the same criteria in both reviews.")
    k = 6
    obs = [[0] * k for _ in range(k)]
    for _, x, y in pairs:
        obs[x][y] += 1
    ra = [sum(row) for row in obs]
    rb = [sum(obs[i][j] for i in range(k)) for j in range(k)]
    w = [[(i - j) ** 2 / (k - 1) ** 2 for j in range(k)] for i in range(k)]
    num = sum(w[i][j] * obs[i][j] for i in range(k) for j in range(k))
    den = sum(w[i][j] * ra[i] * rb[j] / n for i in range(k) for j in range(k))
    kappa = round(1 - num / den, 3) if den else None
    diffs = [abs(x - y) for _, x, y in pairs]
    return {"pairs": n, "exact": round(sum(d == 0 for d in diffs) / n, 3), "within_1": round(sum(d <= 1 for d in diffs) / n, 3),
            "mean_abs_diff": round(sum(diffs) / n, 3), "quadratic_weighted_kappa": kappa,
            "disagreements": sorted([{"id": i, "a": x, "b": y} for i, x, y in pairs if abs(x - y) >= 2], key=lambda d: -abs(d["a"] - d["b"])),
            "unknown_or_na_mismatch": mismatch,
            "note": "kappa is unstable below ~20 pairs; report it with the pair count" if n < 20 else ""}
