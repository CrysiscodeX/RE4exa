"""Markdown renderings: one review report (the standard's report template) and a comparison."""

from __future__ import annotations


def _c(s) -> str:
    return str(s if s is not None else "").replace("|", "\\|").replace("\n", " ")


def _pct(x) -> str:
    return "-" if x is None else f"{round(100 * x)}%"


def report(sc: dict) -> str:
    s, t = sc["summary"], sc["target"]
    L = []
    w = L.append
    w(f"# RQS-2030 review: {t.get('name') or t.get('path') or 'target'}")
    w("")
    w(" · ".join(x for x in [t.get("repo") or t.get("path", ""), f"commit `{t['head'][:12]}`" if t.get("head") else "", f"profile `{sc['profile']}`",
                             f"reviewed {sc['date']}" if sc.get("date") else "", f"by {sc['reviewer'].get('id')} ({sc['reviewer'].get('kind', '')})" if sc["reviewer"].get("id") else "not yet reviewed (automatic suggestions only)",
                             f"standard {sc['standard']['id']} v{sc['standard']['version']}"] if x))
    w("")
    w("## Summary")
    w("")
    w("| Grade | Quality Index | Horizon Readiness | Evidence coverage | Red lines | Automatic levels |")
    w("| --- | ---: | ---: | ---: | --- | ---: |")
    rl = ", ".join(f"{r['id']} ({r['criterion']})" for r in s["red_lines"]) or "none"
    if s["suspected_red_lines"]:
        rl += "; suspected: " + ", ".join(f"{r['id']} ({r['criterion']})" for r in s["suspected_red_lines"])
    w(f"| **{s['grade']}** | {s['quality_index']} | {s['horizon_index']} | {_pct(s['evidence_coverage'])} | {_c(rl)} | {_pct(s['criteria']['auto_share'])} |")
    w("")
    for g in s["gates"]:
        w(f"- Gate: {g}")
    if s["blocking"]:
        w("- Blocking weaknesses (weight >= 2.5, score < 2): " + ", ".join(f"{b['dimension']} {b['score']}" for b in s["blocking"]))
    gaps, opps = sc["gaps"][:3], sc["opportunities"][:3]
    if gaps:
        w("- Biggest gaps: " + "; ".join(f"**{_c(g.get('title'))}** ({g.get('severity', '?')})" for g in gaps))
    if opps:
        w("- Biggest opportunities: " + "; ".join(f"**{_c(o.get('title'))}** (priority {o.get('priority')})" for o in opps))
    w("")
    w("## Scope")
    w("")
    w("Flags: " + ", ".join(f"`{k}`" for k, v in sorted(sc["flags"].items()) if v) + ". Not set: " + (", ".join(f"`{k}`" for k, v in sorted(sc["flags"].items()) if not v) or "none") + ".")
    w("")
    if sc.get("scope_notes"):
        w(f"{_c(sc['scope_notes'])}")
        w("")
    for q in sc["questions"]:
        w(f"- Question: {_c(q)}")
    if sc["not_examined"]:
        w("- Not examined: " + "; ".join(_c(x) for x in sc["not_examined"]))
    w("")
    w("## Scorecard")
    w("")
    w("| Dimension | Weight | Score (0-5) | Coverage | Known / applicable | Automatic |")
    w("| --- | ---: | ---: | ---: | ---: | ---: |")
    for d in sc["dimensions"]:
        w(f"| {d['id']} {_c(d['name'])} | {d['weight']} | {d['score'] if d['score'] is not None else 'U'} | {_pct(d['coverage'])} | {d['known']}/{d['applicable']} | {d['auto']} |")
    w("")
    w("| ID | Criterion | Level | Confidence | Source | Evidence / note |")
    w("| --- | --- | --- | --- | --- | --- |")
    for r in sc["criteria"]:
        tag = (" *core*" if r["core"] else "") + (" *red line*" if r["red_line"] else "")
        ev = ", ".join(f"`{e}`" for e in r["evidence"][:3])
        w(f"| {r['id']} | {_c(r['title'])}{tag} | {r['level']} | {r['confidence']} | {r['source']} | {_c((ev + ' ' if ev else '') + (r['note'] or ''))[:300]} |")
    w("")
    if sc["gaps"]:
        w("## Gaps")
        w("")
        w("| Severity | Lens | Gap | Case | Impact | Fix |")
        w("| --- | --- | --- | --- | --- | --- |")
        for g in sc["gaps"]:
            w(f"| {g.get('severity', '')} | {g.get('lens', '')} | {_c(g.get('title'))} | {_c(g.get('case'))} | {_c(g.get('impact'))} | {_c(g.get('fix'))} |")
        w("")
    if sc["opportunities"]:
        w("## Opportunities")
        w("")
        w("| Priority | Lens | Opportunity | V x R x C x H / E | Action |")
        w("| ---: | --- | --- | --- | --- |")
        for o in sc["opportunities"]:
            w(f"| {o.get('priority')} | {o.get('lens', '')} | **{_c(o.get('title'))}**: {_c(o.get('description'))} | {o.get('value')} x {o.get('reach')} x {o.get('confidence')} x "
              f"{o.get('horizon_fit', 1.0)} / {o.get('effort')} | {o.get('action', '')} |")
        w("")
    if sc["reengineering"]:
        w("## Re-engineering plan")
        w("")
        w("| Action | Component | Expected gain | Measured by |")
        w("| --- | --- | --- | --- |")
        for r in sc["reengineering"]:
            w(f"| {r.get('action', '')} | {_c(r.get('component'))} | {_c(r.get('gain'))} | {_c(r.get('measure'))} |")
        w("")
    w("## Integrity")
    w("")
    rv = sc["reviewer"]
    w(f"- Reviewer: {rv.get('id')} ({rv.get('kind', '')}); conflicts: {rv.get('conflicts', 'not stated')}.")
    w(f"- Levels: {s['criteria']['known']} known of {s['criteria']['applicable']} applicable; {s['criteria']['auto']} came from automatic suggestions and were not reviewed.")
    if sc.get("time_minutes"):
        w(f"- Time spent: {sc['time_minutes']} minutes.")
    if sc.get("agreement"):
        a = sc["agreement"]
        w(f"- Second reviewer: {a['pairs']} shared criteria, exact {_pct(a['exact'])}, within one level {_pct(a['within_1'])}, weighted kappa {a['quadratic_weighted_kappa']}.")
    w("")
    return "\n".join(L)


def compare(cards: list[dict]) -> dict:
    rows = []
    for sc in cards:
        s = sc["summary"]
        rows.append({"name": sc["target"].get("name") or sc["target"].get("path"), "profile": sc["profile"], "grade": s["grade"], "quality_index": s["quality_index"],
                     "horizon_index": s["horizon_index"], "evidence_coverage": s["evidence_coverage"], "red_lines": [r["criterion"] for r in s["red_lines"]],
                     "suspected_red_lines": [r["criterion"] for r in s["suspected_red_lines"]],
                     "dimensions": {d["id"]: d["score"] for d in sc["dimensions"]}, "criteria": {r["id"]: r["level"] for r in sc["criteria"]}})
    rows.sort(key=lambda r: -(r["quality_index"] or 0))
    return {"rqs_comparison": 1, "targets": rows}


def compare_md(cmp: dict) -> str:
    rows = cmp["targets"]
    if not rows:
        return "No scorecards."
    dims = list(rows[0]["dimensions"])
    L = ["| Target | Profile | Grade | QI | HRI | Coverage | Red lines | " + " | ".join(dims) + " |",
         "| --- | --- | --- | ---: | ---: | ---: | --- | " + " | ".join("---:" for _ in dims) + " |"]
    for r in rows:
        red = ", ".join(r["red_lines"]) or "-"
        if r["suspected_red_lines"]:
            red += " (suspected " + ", ".join(r["suspected_red_lines"]) + ")"
        L.append(f"| {_c(r['name'])} | {r['profile']} | {r['grade']} | {r['quality_index']} | {r['horizon_index']} | {_pct(r['evidence_coverage'])} | {red} | "
                 + " | ".join("U" if r["dimensions"][d] is None else f"{r['dimensions'][d]:.1f}" for d in dims) + " |")
    crit = list(rows[0]["criteria"])
    L += ["", "| Criterion | " + " | ".join(_c(r["name"]) for r in rows) + " |", "| --- | " + " | ".join("---" for _ in rows) + " |"]
    for c in crit:
        L.append(f"| {c} | " + " | ".join(str(r["criteria"].get(c, "")) for r in rows) + " |")
    return "\n".join(L)
