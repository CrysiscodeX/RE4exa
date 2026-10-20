"""Automated evidence for RQS-2030. One function per probe id the standard cites.

Each probe returns {"id", "found", "summary", "value", "evidence", "confidence"}:
- found: the thing looked for was seen. False means "not found in the scanned files", never "absent".
- evidence: up to 8 "path" or "path:line" references a reviewer can open.
- confidence: observed (files and manifest facts), derived (pattern counts by a stated rule),
  inferred (heuristic readings of meaning, e.g. "probably an MCP server").
"""

from __future__ import annotations

import re

from .scan import Scan

PROBES: dict = {}


def probe(pid: str):
    def reg(fn):
        PROBES[pid] = fn
        return fn
    return reg


def out(pid, found, summary, value=None, evidence=None, confidence="derived"):
    return {"id": pid, "found": bool(found), "summary": summary, "value": value if value is not None else {},
            "evidence": list(dict.fromkeys(evidence or []))[:8], "confidence": confidence}


def sig(sc: Scan, name: str) -> dict:
    s = sc.signals[name]
    return {"count": s["count"], "files": s["files"], "nontest": s["nontest"], "in_docs": s["doc"], "practice": s["count"] - s["doc"]}


def locs(sc: Scan, *names: str, nontest: bool = False) -> list[str]:
    res = []
    for n in names:
        res += [f"{x['path']}:{x['line']}" for x in sc.signals[n]["locs"] if not (nontest and x["test"])]
    return res


def paths(sc: Scan, pattern: str, flags: int = re.I) -> list[str]:
    return sc.has(pattern, flags)


def root_file(sc: Scan, pattern: str, dirs=("", ".github/", "docs/")) -> list[str]:
    rx = re.compile(pattern, re.I)
    return [f["path"] for f in sc.files if any(f["path"].startswith(d) and rx.fullmatch(f["path"][len(d):]) for d in dirs)]


def ci_find(sc: Scan, pattern: str, flags: int = re.I) -> list[str]:
    rx = re.compile(pattern, flags)
    hits = []
    for path, text in sc.ci_text.items():
        for m in rx.finditer(text):
            hits.append(f"{path}:{text.count(chr(10), 0, m.start()) + 1}")
    return hits


def cfg_find(sc: Scan, pattern: str, flags: int = re.I) -> list[str]:
    rx = re.compile(pattern, flags)
    return [p for p, t in sc.config_text.items() if rx.search(t)]


def pkg_scripts(sc: Scan) -> dict:
    res = {}
    for m in sc.manifests["package.json"]:
        for k, v in (m.get("scripts") or {}).items():
            if isinstance(v, str):
                res[f"{m['path']}#{k}"] = v
    return res


def _pyname(d: str) -> str:
    return re.split(r"[\s<>=!~;\[(@]", d.strip(), 1)[0].lower()


def deps_by_ecosystem(sc: Scan, product_only: bool = False) -> dict:
    """ecosystem -> {name: spec} across every manifest of that ecosystem (product_only: skip tests and examples)."""
    from .scan import EXAMPLE_RE, TEST_RE
    eco = {"npm": {}, "python": {}, "cargo": {}, "go": {}}
    skip = (lambda m: bool(TEST_RE.search(m["path"]) or EXAMPLE_RE.search(m["path"]))) if product_only else (lambda m: False)
    for m in sc.manifests["package.json"]:
        if skip(m):
            continue
        for key in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
            for k, v in (m.get(key) or {}).items():
                eco["npm"].setdefault(k, v if isinstance(v, str) else str(v))
    for m in sc.manifests["pyproject.toml"]:
        if skip(m):
            continue
        proj = m.get("project") or {}
        groups = [proj.get("dependencies") or []] + list((proj.get("optional-dependencies") or {}).values()) + list((m.get("dependency-groups") or {}).values())
        for g in groups:
            for d in g:
                if isinstance(d, str):
                    eco["python"].setdefault(_pyname(d), d)
        for k, v in (((m.get("tool") or {}).get("poetry") or {}).get("dependencies") or {}).items():
            if k.lower() != "python":
                eco["python"].setdefault(k.lower(), str(v))
    for m in sc.manifests["requirements"]:
        for ln in m["lines"]:
            eco["python"].setdefault(_pyname(ln), ln)
    for m in sc.manifests["Cargo.toml"]:
        tables = [m.get(k) or {} for k in ("dependencies", "dev-dependencies", "build-dependencies")] + [((m.get("workspace") or {}).get("dependencies") or {})]
        for t in tables:
            for k, v in t.items():
                eco["cargo"].setdefault(k, v if isinstance(v, str) else (v.get("version", "") if isinstance(v, dict) else str(v)))
    for m in sc.manifests["go.mod"]:
        for r in m["require"]:
            eco["go"].setdefault(r, "")
    return eco


def all_deps(sc: Scan, product_only: bool = False) -> dict:
    return {k: v for e in deps_by_ecosystem(sc, product_only).values() for k, v in e.items()}


def text_any(sc: Scan, names: list[str], pattern: str, flags: int = re.I) -> bool:
    rx = re.compile(pattern, flags)
    return any(rx.search(sc.doc_text.get(n, "")) for n in names)


# ---------------------------------------------------------------- meta

@probe("meta.readme_sections")
def readme_sections(sc):
    readme = root_file(sc, r"README(\.(md|mdx|rst|txt|adoc))?", dirs=("",))
    if not readme:
        return out("meta.readme_sections", False, "no README at the repository root", confidence="observed")
    text = sc.doc_text.get(readme[0], "")
    heads = [h.strip().lower() for h in re.findall(r"^#{1,4}\s+(.+)$", text, re.M)] or [h.lower() for h in re.findall(r"^(.+)\n[=\-~^]{3,}\s*$", text, re.M)]
    topics = {"start": r"install|getting started|quick ?start|usage|setup|how to use|run",
              "limits": r"limitation|non-goal|known issue|caveat|faq|not (?:for|supported)|scope|trade-?off",
              "license": r"licen[cs]e", "contributing": r"contribut", "security": r"security|privacy",
              "architecture": r"architecture|design|how it works|internals", "benchmarks": r"bench|performance|results|evaluation",
              "agents": r"agent|mcp|llm|skill|claude|codex"}
    has = {k: any(re.search(v, h) for h in heads) for k, v in topics.items()}
    body = text.lower()
    has["mentions_agents"] = bool(re.search(r"\b(agents?|mcp|llms?)\b", body))
    has["mentions_limits"] = has["limits"] or bool(re.search(r"\blimitations?\b|\bnon-goals?\b|\bnot (?:yet )?supported\b", body))
    return out("meta.readme_sections", True, f"README {len(text)} chars, {len(heads)} headings; start={has['start']} limits={has['mentions_limits']}",
               {"path": readme[0], "chars": len(text), "headings": len(heads), "has": has}, readme, "observed")


SPDX_TEXT = [("AGPL-3.0", r"GNU AFFERO GENERAL PUBLIC LICENSE"), ("LGPL", r"GNU LESSER GENERAL PUBLIC LICENSE"),
             ("GPL-3.0", r"GNU GENERAL PUBLIC LICENSE\s+Version 3"), ("GPL-2.0", r"GNU GENERAL PUBLIC LICENSE\s+Version 2"),
             ("Apache-2.0", r"Apache License,?\s+Version 2\.0"), ("MPL-2.0", r"Mozilla Public License,?\s+(?:Version|v\.?)\s*2\.0"),
             ("BUSL-1.1", r"Business Source License"), ("Elastic-2.0", r"Elastic License 2\.0"), ("FSL", r"Functional Source License"),
             ("Unlicense", r"free and unencumbered software released into the public domain"), ("ISC", r"\bISC License\b|Permission to use, copy, modify, and/or distribute"),
             ("BSD-3-Clause", r"Redistribution and use in source and binary forms[\s\S]{0,1500}Neither the name"),
             ("BSD-2-Clause", r"Redistribution and use in source and binary forms"), ("MIT", r"Permission is hereby granted, free of charge"),
             ("CC0-1.0", r"CC0 1\.0|Creative Commons Zero")]


@probe("meta.license")
def license_(sc):
    files = root_file(sc, r"(LICEN[CS]E|COPYING|UNLICENSE)([.-][\w.-]+)?", dirs=("",)) + [f["path"] for f in sc.files if f["path"].startswith("LICENSES/")]
    detected = []
    for f in files[:6]:
        text = sc.doc_text.get(f) or ""
        for spdx, rx in SPDX_TEXT:
            if re.search(rx, text, re.I):
                modified = spdx == "MIT" and len(text) > 1400
                detected.append({"path": f, "spdx": spdx, "modified": modified})
                break
        else:
            detected.append({"path": f, "spdx": "unrecognised", "modified": None})
    declared = []
    for m in sc.manifests["package.json"]:
        if m.get("license") and not m.get("private"):
            declared.append({"path": m["path"], "license": m["license"]})
    for m in sc.manifests["pyproject.toml"]:
        lic = (m.get("project") or {}).get("license")
        if lic:
            declared.append({"path": m["path"], "license": lic if isinstance(lic, str) else lic.get("text") or lic.get("file")})
    for m in sc.manifests["Cargo.toml"]:
        lic = (m.get("package") or {}).get("license")
        if lic:
            declared.append({"path": m["path"], "license": lic if isinstance(lic, str) else str(lic)})
    readme = root_file(sc, r"README(\.(md|mdx|rst|txt))?", dirs=("",))
    claims = re.findall(r"\b(MIT|Apache[- ]2\.0|GPL[- ]?v?[23]|BSD|MPL|AGPL)\b[^\n]{0,30}licen[cs]e", sc.doc_text.get(readme[0], "") if readme else "", re.I)
    reuse = paths(sc, r"^(\.reuse/dep5|REUSE\.toml)$")
    spdx_headers = sig(sc, "spdx_header")["files"]
    found = bool(files)
    summary = (", ".join(f"{d['path']}={d['spdx']}{' (modified)' if d['modified'] else ''}" for d in detected) if found
               else "no LICENSE file" + (f"; README claims {sorted(set(claims))}" if claims else ""))
    return out("meta.license", found, summary, {"files": detected, "declared": declared[:10], "readme_claims": sorted(set(claims)), "reuse": bool(reuse),
                                                 "files_with_spdx_headers": spdx_headers}, files + reuse, "observed")


@probe("meta.notices")
def notices(sc):
    f = paths(sc, r"(^|/)(NOTICE|THIRD[_-]?PARTY[\w.-]*|ThirdPartyNotices[\w.-]*|third_party_licenses[\w.-]*|CREDITS|ATTRIBUTIONS?)(\.\w+)?$")
    return out("meta.notices", f, f"{len(f)} notice/attribution files" if f else "no NOTICE or third-party license file", {"files": f[:20]}, f, "observed")


@probe("meta.security_policy")
def security_policy(sc):
    f = root_file(sc, r"SECURITY(\.(md|rst|txt|adoc))?")
    text = sc.doc_text.get(f[0], "") if f else ""
    contact = bool(re.search(r"@[\w-]+\.\w+|security/advisories|private vulnerability|report a vulnerability|hackerone|bugcrowd|security\.txt", text, re.I))
    versions = bool(re.search(r"supported versions|version\s*\|", text, re.I))
    stxt = paths(sc, r"(^|/)\.well-known/security\.txt$|(^|/)security\.txt$")
    return out("meta.security_policy", f, (f"{f[0]}: contact={contact}, supported-versions={versions}" if f else "no SECURITY policy file"),
               {"files": f, "contact": contact, "supported_versions": versions, "security_txt": stxt, "threat_model_mentions": sig(sc, "threat_model")["count"]},
               f + stxt + locs(sc, "threat_model"), "observed")


@probe("meta.contributing")
def contributing(sc):
    f = root_file(sc, r"CONTRIBUTING(\.(md|rst|txt|adoc))?")
    return out("meta.contributing", f, f[0] if f else "no CONTRIBUTING guide", {"files": f}, f, "observed")


@probe("meta.agents_md")
def agents_md(sc):
    f = paths(sc, r"(^|/)(AGENTS\.md|CLAUDE\.md|GEMINI\.md|\.cursorrules|\.windsurfrules|\.clinerules|CONVENTIONS\.md|copilot-instructions\.md)$|^\.cursor/rules/")
    skills = paths(sc, r"(^|/)SKILL\.md$")
    return out("meta.agents_md", f, f"{len(f)} agent instruction files, {len(skills)} SKILL.md" if f or skills else "no agent instruction files",
               {"files": f[:20], "skills": len(skills), "skill_sample": skills[:5]}, f + skills, "observed")


@probe("meta.docs")
def docs(sc):
    md = [f["path"] for f in sc.files if f["path"].startswith(("docs/", "doc/", "documentation/", "website/", "site/")) and f["path"].endswith((".md", ".mdx", ".rst", ".adoc"))]
    site = paths(sc, r"(^|/)(mkdocs\.ya?ml|docusaurus\.config\.\w+|book\.toml|conf\.py|typedoc\.json|\.vitepress/config\.\w+|astro\.config\.\w+|mint\.json|docs\.json)$")
    adr = paths(sc, r"(^|/)(adrs?|decisions|architecture/decisions|rfcs?)/[^/]+\.(md|rst)$")
    return out("meta.docs", md or site, f"{len(md)} doc pages, {len(adr)} decision records, site config: {bool(site)}", {"pages": len(md), "site": site[:5], "decision_records": len(adr)},
               (site + adr + md)[:8], "observed")


@probe("meta.changelog")
def changelog(sc):
    f = paths(sc, r"^(CHANGELOG|CHANGES|HISTORY|NEWS|RELEASES?)(\.\w+)?$|^\.changeset/|(^|/)releases?/[^/]+\.md$|^docs/(changelog|releases?)")
    return out("meta.changelog", f, f"{len(f)} changelog/release-note files" if f else "no changelog or release notes in the repository", {"files": f[:10], "count": len(f)}, f, "observed")


@probe("meta.codeowners")
def codeowners(sc):
    f = root_file(sc, r"CODEOWNERS")
    return out("meta.codeowners", f, f[0] if f else "no CODEOWNERS", {"files": f}, f, "observed")


@probe("meta.governance")
def governance(sc):
    f = paths(sc, r"^(GOVERNANCE|MAINTAINERS|OWNERS|CODE_OF_CONDUCT)(\.\w+)?$|^\.github/(GOVERNANCE|CODE_OF_CONDUCT|MAINTAINERS)(\.\w+)?$")
    g = sc.git
    return out("meta.governance", f, f"{len(f)} governance files; git authors in history read: {g.get('authors')} (shallow={g.get('shallow')})",
               {"files": f, "git": {k: g.get(k) for k in ("authors", "top_author_share", "commits_read", "shallow")}}, f, "observed")


@probe("meta.issue_templates")
def issue_templates(sc):
    f = paths(sc, r"^\.github/(ISSUE_TEMPLATE/|PULL_REQUEST_TEMPLATE|pull_request_template)|^(PULL_REQUEST_TEMPLATE|pull_request_template)\.md$|^docs/(PULL_REQUEST_TEMPLATE|pull_request_template)")
    return out("meta.issue_templates", f, f"{len(f)} issue/PR templates" if f else "no issue or PR templates", {"files": f[:10]}, f, "observed")


@probe("meta.translations")
def translations(sc):
    f = paths(sc, r"(^|/)(locales?|i18n|lang|translations|messages)/[^/]+\.(json|ya?ml|po|xliff|arb|ftl|properties|ts|js)$|\.(po|xliff|arb|ftl)$|^README[._-][a-z]{2}([-_][A-Za-z]{2,4})?\.md$")
    codes = sorted({m.group(1) for p in f for m in [re.search(r"(?:^|/|[._-])([a-z]{2}(?:[-_][A-Za-z]{2,4})?)\.(?:json|ya?ml|po|xliff|arb|ftl|md|ts|js|properties)$", p)] if m})
    return out("meta.translations", f, f"{len(f)} translation files, ~{len(codes)} locale codes" if f else "no translation files found", {"files": len(f), "locales": codes[:30]}, f, "derived")


@probe("meta.compliance")
def compliance(sc):
    f = paths(sc, r"(^|/)(VPAT|ACCESSIBILITY|COMPLIANCE|CONFORMITY|PRIVACY|DPA)[\w.-]*\.(md|pdf|txt|html)$|(^|/)docs/(compliance|legal|privacy)")
    s = sig(sc, "compliance_words")
    return out("meta.compliance", f or s["count"], f"{len(f)} compliance documents; {s['count']} regulation mentions in docs", {"files": f[:10], "mentions": s},
               f + locs(sc, "compliance_words"), "derived")


# ---------------------------------------------------------------- CI

@probe("ci.workflows")
def workflows(sc):
    f = sorted(sc.ci_text)
    providers = sorted({"github" if p.startswith(".github/") else p.split("/")[0] for p in f})
    return out("ci.workflows", f, f"{len(f)} CI files ({', '.join(providers) or 'none'})", {"files": f[:40], "count": len(f), "providers": providers}, f, "observed")


@probe("ci.tests_in_ci")
def tests_in_ci(sc):
    hits = ci_find(sc, SIGNAL_RX("test_cmd"), 0)
    scripts = {k: v for k, v in pkg_scripts(sc).items() if k.endswith(("#test", "#check", "#ci", "#verify"))}
    return out("ci.tests_in_ci", hits, f"{len(hits)} test commands in CI" if hits else ("no test command found in CI" if sc.ci_text else "no CI configuration"),
               {"commands": len(hits), "package_test_scripts": dict(list(scripts.items())[:8])}, hits, "derived")


def SIGNAL_RX(name):
    from .scan import SIGNALS
    return SIGNALS[name][2]


@probe("ci.os_matrix")
def os_matrix(sc):
    oss = {}
    for p, t in sc.ci_text.items():
        for m in re.finditer(r"\b(ubuntu|macos|windows|self-hosted|arm64|blacksmith|buildjet|namespace-profile|depot)[\w.-]*", t, re.I):
            k = m.group(1).lower()
            oss.setdefault(k, []).append(p)
    return out("ci.os_matrix", oss, ", ".join(f"{k}x{len(v)}" for k, v in sorted(oss.items())) or "no runner OS found",
               {"runners": {k: len(v) for k, v in oss.items()}}, [v[0] for v in oss.values()], "derived")


@probe("ci.pinned_actions")
def pinned_actions(sc):
    total = pinned = 0
    branch, tag = [], []
    for p, t in sc.ci_text.items():
        for m in re.finditer(r"^\s*-?\s*uses:\s*['\"]?([^\s'\"#]+)", t, re.M):
            ref = m.group(1)
            if ref.startswith("./") or ref.startswith(".github/"):
                continue
            total += 1
            line = f"{p}:{t.count(chr(10), 0, m.start()) + 1}"
            if ref.startswith("docker://"):
                (pinned := pinned + 1) if "@sha256:" in ref else tag.append(line)
                continue
            at = ref.rsplit("@", 1)[1] if "@" in ref else ""
            if re.fullmatch(r"[0-9a-f]{40}", at):
                pinned += 1
            elif at in ("main", "master", "dev", "develop", "trunk", "latest", "") or not re.match(r"v?\d", at):
                branch.append(f"{line} {ref}")
            else:
                tag.append(f"{line} {ref}")
    ratio = round(pinned / total, 3) if total else None
    return out("ci.pinned_actions", total, f"{pinned}/{total} third-party action references pinned to a full SHA; {len(branch)} on branches" if total else "no third-party actions",
               {"total": total, "sha_pinned": pinned, "tag_pinned": len(tag), "branch_or_unversioned": len(branch), "ratio": ratio, "branch_refs": branch[:6]},
               branch[:4] + tag[:4], "observed")


@probe("ci.permissions")
def permissions(sc):
    wf = {p: t for p, t in sc.ci_text.items() if p.startswith(".github/workflows/")}
    top = [p for p, t in wf.items() if re.search(r"^permissions:", t, re.M)]
    anyp = [p for p, t in wf.items() if re.search(r"^\s*permissions:", t, re.M)]
    write_all = [p for p, t in wf.items() if re.search(r"permissions:\s*write-all", t)]
    contents_write = [p for p, t in wf.items() if re.search(r"contents:\s*write", t)]
    none = sorted(set(wf) - set(anyp))
    return out("ci.permissions", wf, f"{len(top)}/{len(wf)} workflows set top-level permissions; {len(none)} set none; write-all in {len(write_all)}" if wf else "no GitHub workflows",
               {"workflows": len(wf), "top_level": len(top), "any_level": len(anyp), "none": none[:10], "write_all": write_all, "contents_write": contents_write[:10]},
               write_all + none[:4] + contents_write[:2], "observed")


@probe("ci.pull_request_target")
def prt(sc):
    risky, privileged = [], []
    for p, t in sc.ci_text.items():
        if re.search(r"^\s*(pull_request_target|workflow_run)\s*:", t, re.M) or re.search(r"on:\s*\[?[^\]\n]*pull_request_target", t):
            privileged.append(p)
            if re.search(r"github\.event\.pull_request\.head\.(sha|ref)|github\.head_ref|refs/pull/", t):
                risky.append(p)
    return out("ci.pull_request_target", risky, (f"{len(risky)} privileged-trigger workflows check out pull-request code" if risky else
                                                  f"{len(privileged)} privileged-trigger workflows; none check out pull-request code"),
               {"privileged_trigger": privileged, "checks_out_pr_code": risky}, risky + privileged, "derived")


@probe("ci.provenance")
def provenance(sc):
    hits = ci_find(sc, SIGNAL_RX("provenance_ci"))
    idt = ci_find(sc, r"id-token:\s*write")
    pkg = [m["path"] for m in sc.manifests["package.json"] if (m.get("publishConfig") or {}).get("provenance")]
    return out("ci.provenance", hits or pkg, f"{len(hits)} provenance/signing steps in CI; id-token in {len(idt)} places" if hits or pkg else "no provenance or signing found in CI",
               {"steps": len(hits), "id_token_write": len(idt), "package_publish_provenance": pkg}, hits + pkg + idt[:2], "derived")


@probe("ci.release_automation")
def release_automation(sc):
    hits = ci_find(sc, SIGNAL_RX("release_auto"), 0)
    tags = ci_find(sc, r"^\s*tags:\s*(\n\s*-|\[)|^\s*release:\s*$|types:\s*\[?\s*published", re.M)
    cfg = [k for k, v in pkg_scripts(sc).items() if re.search(SIGNAL_RX("release_auto"), v)]
    return out("ci.release_automation", hits or tags or cfg, f"{len(hits)} release steps, {len(tags)} tag/release triggers" if hits or tags or cfg else "no automated release found",
               {"steps": len(hits), "triggers": len(tags), "package_scripts": cfg[:5]}, hits + tags, "derived")


@probe("ci.sbom")
def sbom(sc):
    hits = ci_find(sc, r"\bsyft\b|cyclonedx|anchore/sbom-action|cdxgen|--sbom\b|\bspdx\b|sbom")
    vex = ci_find(sc, r"\bvex\b|openvex|csaf")
    return out("ci.sbom", hits, f"{len(hits)} SBOM steps in CI, VEX {len(vex)}" if hits else "no SBOM generation in CI", {"sbom_steps": len(hits), "vex_steps": len(vex),
               "doc_mentions": sig(sc, "sbom")["count"]}, hits + vex, "derived")


@probe("ci.security_scans")
def security_scans(sc):
    rx = SIGNAL_RX("scans")
    tools = {}
    for p, t in {**sc.ci_text, **sc.config_text}.items():
        for m in re.finditer(rx, t, re.I):
            tools.setdefault(m.group(0).lower(), p)
    secret = [t for t in tools if re.search(SIGNAL_RX("secret_scan"), t, re.I)]
    return out("ci.security_scans", tools, f"scanners: {', '.join(sorted(tools)) or 'none found'}", {"tools": sorted(tools), "secret_scanners": secret}, list(tools.values()), "derived")


# ---------------------------------------------------------------- dependencies

@probe("deps.lockfiles")
def lockfiles(sc):
    from .scan import LOCKFILES
    f = [x["path"] for x in sc.files if x["path"].rsplit("/", 1)[-1] in LOCKFILES]
    hashed = [m["path"] for m in sc.manifests["requirements"] if m["hashes"]]
    return out("deps.lockfiles", f or hashed, f"{len(f)} lockfiles" if f else "no lockfiles", {"files": f[:20], "requirements_with_hashes": hashed}, f + hashed, "observed")


@probe("deps.counts")
def dep_counts(sc):
    eco = deps_by_ecosystem(sc)
    runtime = {k for m in sc.manifests["package.json"] for k in (m.get("dependencies") or {})}
    total = sum(len(v) for v in eco.values())
    return out("deps.counts", total, f"{total} unique declared dependencies ({', '.join(f'{k} {len(v)}' for k, v in eco.items() if v) or 'none'}) across "
               f"{sum(len(v) for v in sc.manifests.values())} manifests",
               {"unique": total, "by_ecosystem": {k: len(v) for k, v in eco.items()}, "npm_runtime_unique": len(runtime), "manifests": {k: len(v) for k, v in sc.manifests.items()}},
               [m["path"] for v in sc.manifests.values() for m in v][:8], "observed")


@probe("deps.pinning")
def pinning(sc):
    exact = ranged = special = 0
    for m in sc.manifests["package.json"]:
        for key in ("dependencies", "devDependencies", "optionalDependencies"):
            for v in (m.get(key) or {}).values():
                v = str(v)
                if re.match(r"^(workspace:|file:|link:|portal:|catalog:|npm:)", v):
                    special += 1
                elif re.fullmatch(r"=?v?\d+\.\d+\.\d+(-[\w.]+)?", v):
                    exact += 1
                else:
                    ranged += 1
    req_pinned = sum(1 for m in sc.manifests["requirements"] for ln in m["lines"] if "==" in ln)
    req_total = sum(len(m["lines"]) for m in sc.manifests["requirements"])
    images = {"digest": 0, "tag": 0, "latest_or_untagged": 0}
    loose = []
    for p, t in sc.config_text.items():
        for m in re.finditer(r"^\s*(?:FROM(?:\s+--platform=\S+)?|image:)\s+['\"]?([^\s'\"]+)", t, re.M | re.I):
            ref = m.group(1)
            if ref.lower() == "scratch" or ref.startswith("$"):
                continue
            if "@sha256:" in ref:
                images["digest"] += 1
            elif ":" in ref.rsplit("/", 1)[-1] and not ref.endswith(":latest"):
                images["tag"] += 1
            else:
                images["latest_or_untagged"] += 1
                loose.append(f"{p}:{t.count(chr(10), 0, m.start()) + 1} {ref}")
    return out("deps.pinning", exact + ranged + req_total + sum(images.values()),
               f"npm exact {exact} / ranged {ranged}; python pinned {req_pinned}/{req_total}; images digest {images['digest']}, tag {images['tag']}, latest/untagged {images['latest_or_untagged']}",
               {"npm_exact": exact, "npm_ranged": ranged, "npm_workspace_or_local": special, "requirements_pinned": req_pinned, "requirements_total": req_total,
                "container_images": images, "loose_images": loose[:6]}, loose, "observed")


@probe("deps.update_bot")
def update_bot(sc):
    f = paths(sc, r"^\.github/dependabot\.ya?ml$|(^|/)(renovate\.json5?|\.renovaterc(\.json5?)?)$|^\.github/renovate\.json5?$")
    pkg = [m["path"] for m in sc.manifests["package.json"] if m.get("renovate")]
    return out("deps.update_bot", f or pkg, ", ".join(f + pkg) or "no Dependabot or Renovate configuration", {"files": f + pkg}, f + pkg, "observed")


# ---------------------------------------------------------------- tests

TEST_FW = {"jest": r"^jest$|^@jest/", "vitest": r"^vitest$|^@vitest/", "mocha": r"^mocha$", "ava": r"^ava$", "playwright": r"^@playwright/test$|^playwright$",
           "cypress": r"^cypress$", "pytest": r"^pytest", "hypothesis": r"^hypothesis$", "fast-check": r"^fast-check$|^@fast-check/", "tap": r"^tap$|^node-tap$",
           "uvu": r"^uvu$", "proptest": r"^proptest$", "criterion": r"^criterion$", "insta": r"^insta$", "testify": r"stretchr/testify", "bun-test": r"^bun-types$|^@types/bun$"}


@probe("test.frameworks")
def frameworks(sc):
    deps = all_deps(sc)
    fw = sorted({n for n, rx in TEST_FW.items() for d in deps if re.search(rx, d)})
    files = paths(sc, r"(^|/)(jest|vitest|playwright|cypress|ava|karma)\.config\.\w+$|(^|/)(pytest\.ini|conftest\.py|tox\.ini|noxfile\.py|\.mocharc\.\w+)$")
    if any(f["path"].endswith("_test.go") for f in sc.files):
        fw.append("go-test")
    if any(re.search(r"(^|/)tests?/test_\w+\.py$", f["path"]) for f in sc.files) and "pytest" not in fw:
        fw.append("python-unittest-or-pytest")
    if sc.signals["rust_test"]["count"]:
        fw.append(f"cargo-test ({sc.signals['rust_test']['count']} inline test markers)")
    tests = sum(1 for f in sc.files if f["test"] and f["lang"])
    return out("test.frameworks", fw or files or tests, f"{', '.join(fw) or 'no framework dependency found'}; {tests} test files", {"frameworks": fw, "configs": files[:8], "test_files": tests},
               files, "derived")


@probe("test.ratio")
def ratio(sc):
    src = sum(v["lines"] for v in sc.langs.values())
    tst = sum(v["test_lines"] for v in sc.langs.values())
    inline = sc.signals["rust_test"]["count"]
    files_src = sum(v["files"] for v in sc.langs.values())
    files_tst = sum(v["test_files"] for v in sc.langs.values())
    r = round(tst / src, 3) if src else None
    return out("test.ratio", tst, f"test lines / source lines = {r} ({tst}/{src}); test files {files_tst}, source files {files_src}",
               {"source_lines": src, "test_lines": tst, "ratio": r, "source_files": files_src, "test_files": files_tst,
                "rust_inline_test_markers": inline,
                "by_language": {k: {"lines": v["lines"], "test_lines": v["test_lines"]} for k, v in sorted(sc.langs.items(), key=lambda x: -x[1]["lines"])[:8]}},
               [], "derived")


@probe("test.e2e")
def e2e(sc):
    f = paths(sc, r"(^|/)(playwright|cypress|wdio|detox)\.config\.\w+$|(^|/)(e2e|integration|tests/e2e|tests/integration|smoke)(/|$)|\.e2e\.\w+$")
    s = sig(sc, "e2e")
    return out("test.e2e", f or s["count"], f"{len(f)} end-to-end/integration files; {s['count']} mentions", {"files": len(f), "sample": f[:8], "mentions": s}, f + locs(sc, "e2e"), "derived")


@probe("test.golden")
def golden(sc):
    f = paths(sc, r"(^|/)(__snapshots__|golden|goldens|testdata|fixtures?|__fixtures__|expected|answer[-_]?keys?|replays?)/|\.(snap|golden)$|(^|/)[^/]*answer[-_]?key[^/]*\.(json|jsonl|mjs|js|py|md)$")
    s = sig(sc, "golden")
    return out("test.golden", f or s["count"], f"{len(f)} golden/fixture/snapshot files; {s['count']} references", {"files": len(f), "sample": f[:8], "references": s},
               f + locs(sc, "golden"), "derived")


@probe("test.mutation")
def mutation(sc):
    f = paths(sc, r"(^|/)(stryker\.conf\w*\.\w+|\.?stryker\.\w+|mutants\.toml|\.mutmut\w*|setup\.cfg)$")
    f = [p for p in f if "setup.cfg" not in p or "mutmut" in sc.config_text.get(p, "")]
    s = sig(sc, "mutation")
    return out("test.mutation", f or s["practice"], f"mutation testing: {len(f)} configs, {s['practice']} references in code/config/CI, {s['in_docs']} in docs" if f or s["count"] else "no mutation testing found",
               {"configs": f, "mentions": s}, f + locs(sc, "mutation"), "derived")


@probe("test.property")
def prop(sc):
    s = sig(sc, "property")
    return out("test.property", s["count"], f"{s['count']} property-based testing references in {s['files']} files" if s["count"] else "no property-based testing found", s, locs(sc, "property"), "derived")


@probe("test.fuzz")
def fuzz(sc):
    f = paths(sc, r"(^|/)(fuzz|fuzzing|fuzz_targets|fuzzers)/|_fuzz(er)?\.\w+$|(^|/)\.clusterfuzzlite/|(^|/)project\.yaml$")
    s = sig(sc, "fuzz")
    return out("test.fuzz", f or s["practice"], f"fuzzing: {len(f)} files, {s['practice']} references in code/config/CI, {s['in_docs']} in docs" if f or s["count"] else "no fuzzing found",
               {"files": f[:8], "references": s},
               f + locs(sc, "fuzz"), "derived")


@probe("test.bench")
def bench(sc):
    f = paths(sc, r"(^|/)(bench|benches|benchmarks?|perf|evals?|evaluation)/|\.(bench|perf)\.\w+$|_bench(mark)?\.\w+$|(^|/)scripts?/[^/]*(bench|measure|eval|score|crash[-_]test|answer[-_]key)[^/]*$")
    results = [p for p in f if re.search(r"\.(json|jsonl|csv|tsv|md|txt)$", p) and re.search(r"result|report|summary|score|\d{4}", p, re.I)]
    results += [p for p in paths(sc, r"(^|/)results?/[^/]+\.(json|jsonl|csv|tsv)$") if p not in results]
    s = sig(sc, "bench")
    return out("test.bench", f, f"{len(f)} benchmark/eval files, {len(results)} result files" if f else f"no benchmark directory; {s['count']} mentions",
               {"files": len(f), "result_files": results[:10], "sample": f[:8], "mentions": s}, results + f, "derived")


# ---------------------------------------------------------------- static analysis and size

def _tooling(sc, pid, signal, file_rx, label):
    f = paths(sc, file_rx)
    in_ci = sorted({m.group(0).lower() for t in sc.ci_text.values() for m in re.finditer(SIGNAL_RX(signal), t)})
    in_scripts = sorted({m.group(0).lower() for v in pkg_scripts(sc).values() for m in re.finditer(SIGNAL_RX(signal), v)})
    pyproj = sorted({k for m in sc.manifests["pyproject.toml"] for k in (m.get("tool") or {}) if re.search(SIGNAL_RX(signal), k)})
    found = f or in_ci or in_scripts or pyproj
    return out(pid, found, f"{label}: configs {len(f)}, in CI {in_ci or '-'}, package scripts {in_scripts or '-'}, pyproject {pyproj or '-'}",
               {"configs": f[:10], "ci": in_ci, "scripts": in_scripts, "pyproject_tools": pyproj}, f, "derived")


@probe("static.lint")
def lint(sc):
    return _tooling(sc, "static.lint", "lint_tool", r"(^|/)(\.eslintrc[\w.]*|eslint\.config\.\w+|\.oxlintrc[\w.]*|biome\.jsonc?|ruff\.toml|\.ruff\.toml|\.flake8|\.pylintrc|clippy\.toml|"
                    r"\.golangci\.\w+|\.rubocop\.yml|\.swiftlint\.yml|\.shellcheckrc|\.markdownlint[\w.]*|\.stylelintrc[\w.]*|deno\.jsonc?)$", "linters")


@probe("static.format")
def fmt(sc):
    return _tooling(sc, "static.format", "format_tool", r"(^|/)(\.prettierrc[\w.]*|prettier\.config\.\w+|\.editorconfig|rustfmt\.toml|\.rustfmt\.toml|\.clang-format|dprint\.json|"
                    r"\.oxfmtrc[\w.]*|biome\.jsonc?|\.swiftformat)$", "formatters")


@probe("static.types")
def types(sc):
    strict = [p for p, t in sc.config_text.items() if p.rsplit("/", 1)[-1].startswith("tsconfig") and re.search(r'"strict"\s*:\s*true', t)]
    ts = [p for p in sc.config_text if p.rsplit("/", 1)[-1].startswith("tsconfig")]
    py = sorted({k for m in sc.manifests["pyproject.toml"] for k in (m.get("tool") or {}) if k in ("mypy", "pyright", "basedpyright", "pyre", "pytype", "ty")})
    py_strict = [m["path"] for m in sc.manifests["pyproject.toml"]
                 if (((m.get("tool") or {}).get("mypy") or {}).get("strict")) or (((m.get("tool") or {}).get("pyright") or {}).get("typeCheckingMode") == "strict")]
    ci = sorted({m.group(0).lower() for t in sc.ci_text.values() for m in re.finditer(SIGNAL_RX("type_tool"), t)})
    scripts = sorted({m.group(0).lower() for v in pkg_scripts(sc).values() for m in re.finditer(SIGNAL_RX("type_tool"), v)})
    compiled = sorted(k for k in sc.langs if k in ("Go", "Rust", "Java", "Kotlin", "Swift", "C#", "Scala", "Zig", "Dart"))
    found = strict or py or ci or scripts or compiled
    return out("static.types", found, f"tsconfig strict {len(strict)}/{len(ts)}; python checkers {py or '-'} (strict {len(py_strict)}); CI {ci or '-'}; statically typed languages {compiled or '-'}",
               {"tsconfig_strict": len(strict), "tsconfig_total": len(ts), "python_checkers": py, "python_strict": py_strict, "ci": ci, "scripts": scripts, "compiled_languages": compiled},
               strict[:4] + py_strict[:2], "derived")


@probe("static.arch_guards")
def arch_guards(sc):
    f = paths(sc, r"(^|/)(\.dependency-cruiser\.\w+|\.importlinter|importlinter\.\w+|tach\.toml|\.madgerc)$")
    s = sig(sc, "arch_guard")
    return out("static.arch_guards", f or s["count"], f"architecture rules: {len(f)} configs, {s['count']} references" if f or s["count"] else "no enforced architecture rules found",
               {"configs": f, "references": s}, f + locs(sc, "arch_guard"), "derived")


@probe("static.dupe_tools")
def dupe_tools(sc):
    f = paths(sc, r"(^|/)(\.jscpd\.json|jscpd\.json|sonar-project\.properties)$")
    s = sig(sc, "dupe_tool")
    return out("static.dupe_tools", f or s["count"], f"duplication tooling: {len(f)} configs, {s['count']} references" if f or s["count"] else "no duplication detection configured",
               {"configs": f, "references": s}, f + locs(sc, "dupe_tool"), "derived")


@probe("static.deadcode_tools")
def deadcode_tools(sc):
    f = paths(sc, r"(^|/)(knip\.(json|jsonc|ts|js|config\.\w+)|\.knip\.json|\.vulture\w*)$")
    s = sig(sc, "deadcode_tool")
    return out("static.deadcode_tools", f or s["count"], f"dead-code tooling: {len(f)} configs, {s['count']} references" if f or s["count"] else "no dead-code detection configured",
               {"configs": f, "references": s}, f + locs(sc, "deadcode_tool"), "derived")


@probe("static.debt_markers")
def debt(sc):
    s = sig(sc, "debt")
    src = sum(v["lines"] for v in sc.langs.values()) or 1
    ledger = paths(sc, r"(^|/)(TECH[_-]?DEBT|DEBT|TODO)\.md$")
    return out("static.debt_markers", s["count"], f"{s['nontest']} TODO/FIXME/HACK/XXX markers outside tests ({round(1000 * s['nontest'] / src, 2)} per 1k lines); ledger files {len(ledger)}",
               {**s, "per_kloc": round(1000 * s["nontest"] / src, 2), "ledger": ledger}, ledger + locs(sc, "debt", nontest=True), "derived")


@probe("size.duplicates")
def duplicates(sc):
    size = {f["path"]: f["size"] for f in sc.files}
    groups = [sorted(v) for v in sc.hashes.values() if len(v) > 1]
    wasted = sum(size[g[0]] * (len(g) - 1) for g in groups)
    groups.sort(key=lambda g: -size[g[0]] * (len(g) - 1))
    return out("size.duplicates", groups, f"{len(groups)} groups of identical files (>=1 KB), {sum(len(g) for g in groups)} files, {wasted} duplicated bytes",
               {"groups": len(groups), "files": sum(len(g) for g in groups), "duplicated_bytes": wasted, "top": [{"bytes": size[g[0]], "copies": len(g), "paths": g[:4]} for g in groups[:8]]},
               [g[0] for g in groups[:4]] + [g[1] for g in groups[:4]], "observed")


@probe("size.largest")
def largest(sc):
    big = [{"path": p, "lines": n} for n, p in sc.largest]
    allf = [f["path"] for f in sc.files if f["lang"] and not f["test"] and not f["generated"]]
    bins = [{"path": p, "bytes": n} for n, p in sc.binaries[:10]]
    return out("size.largest", True, f"{sc.stats['files']} files, {sc.stats['bytes']} bytes; largest source file {big[0]['lines'] if big else 0} lines; "
               f"{len(sc.binaries)} binary files ({sum(n for n, _ in sc.binaries)} bytes)",
               {"files": sc.stats["files"], "bytes": sc.stats["bytes"], "source_files": len(allf), "largest": big[:10], "source_files_over_lines": sc.size_hist,
                "binaries": len(sc.binaries), "binary_bytes": sum(n for n, _ in sc.binaries), "largest_binaries": bins, "skipped_dirs": dict(list(sc.skipped_dirs.items())[:10])},
               [b["path"] for b in big[:4]] + [b["path"] for b in bins[:4]], "observed")


# ---------------------------------------------------------------- risk

@probe("risk.secrets")
def secrets(sc):
    real = [s for s in sc.secrets if not s["test"]]
    kinds = {}
    for s in real:
        kinds[s["kind"]] = kinds.get(s["kind"], 0) + 1
    gi = sc.config_text.get(".gitignore", "")
    return out("risk.secrets", real or sc.env_files, f"{len(real)} possible secrets outside tests ({kinds}), {len(sc.secrets) - len(real)} in tests; committed .env files {len(sc.env_files)}"
               if real or sc.env_files else f"no secret patterns outside tests ({len(sc.secrets)} in test fixtures)",
               {"outside_tests": len(real), "in_tests": len(sc.secrets) - len(real), "kinds": kinds, "env_files": sc.env_files[:10], "gitignore_env": bool(re.search(r"^\.env", gi, re.M)),
                "sample": [{k: s[k] for k in ("kind", "path", "line", "value")} for s in real[:8]]},
               [f"{s['path']}:{s['line']}" for s in real] + sc.env_files, "derived")


@probe("risk.patterns")
def patterns(sc):
    names = ["dyn_eval", "shell_true", "os_system", "exec_template", "sh_c", "sql_concat", "inner_html", "rust_unsafe"]
    v = {n: sig(sc, n) for n in names}
    total = sum(x["nontest"] for x in v.values())
    return out("risk.patterns", total, f"{total} risky-construct sites outside tests: " + ", ".join(f"{n}={x['nontest']}" for n, x in v.items() if x["nontest"]), v,
               locs(sc, *names, nontest=True), "derived")


@probe("risk.tls_off")
def tls_off(sc):
    s = sig(sc, "tls_off")
    return out("risk.tls_off", s["nontest"], f"{s['nontest']} places that may disable TLS verification outside tests" if s["nontest"] else "no TLS-verification bypass found outside tests", s,
               locs(sc, "tls_off", nontest=True), "derived")


@probe("risk.unsafe_deser")
def unsafe_deser(sc):
    s = sig(sc, "unsafe_deser")
    return out("risk.unsafe_deser", s["nontest"], f"{s['nontest']} unsafe-deserialization calls outside tests" if s["nontest"] else "no unsafe deserialization found outside tests", s,
               locs(sc, "unsafe_deser", nontest=True), "derived")


@probe("risk.remote_script")
def remote_script(sc):
    s = sig(sc, "remote_pipe")
    v = sig(sc, "checksum_verify")
    return out("risk.remote_script", s["nontest"], f"{s['nontest']} pipe-to-shell install lines outside tests; verification steps (checksum check, signature verify) {v['nontest']}"
               if s["nontest"] else "no pipe-to-shell installs outside tests", {"pipe_to_shell": s, "verification": v},
               locs(sc, "remote_pipe", nontest=True) + locs(sc, "checksum_verify", nontest=True), "derived")


# ---------------------------------------------------------------- agents

@probe("agent.mcp")
def mcp(sc):
    s, t = sig(sc, "mcp_server"), sig(sc, "mcp_tool_def")
    deps = [d for d in all_deps(sc, product_only=True) if re.search(r"modelcontextprotocol|^mcp$|^fastmcp$|^rmcp$|mcp-go|mcp-sdk", d)]
    cfg = paths(sc, r"(^|/)(\.mcp\.json|mcp\.json|server\.json|[\w-]+\.mcp\.json)$")
    found = s["nontest"] or deps
    return out("agent.mcp", found, f"MCP: {s['nontest']} server markers, ~{t['nontest']} tool-definition sites (estimate), deps {deps or '-'}" if found else "no MCP server found",
               {"server_markers": s, "tool_definition_sites": t, "deps": deps, "configs": cfg[:5]}, cfg + locs(sc, "mcp_server", nontest=True), "inferred")


@probe("agent.a2a")
def a2a(sc):
    s = sig(sc, "a2a")
    return out("agent.a2a", s["count"], f"{s['count']} A2A references" if s["count"] else "no A2A agent card or SDK found", s, locs(sc, "a2a"), "derived")


@probe("agent.openapi")
def openapi(sc):
    f = paths(sc, r"(^|/)(openapi|swagger)[\w.-]*\.(ya?ml|json)$")
    s = sig(sc, "openapi")
    return out("agent.openapi", f or s["count"], f"{len(f)} OpenAPI documents, {s['count']} generator references" if f or s["count"] else "no OpenAPI description found",
               {"files": f[:8], "references": s}, f + locs(sc, "openapi"), "derived")


@probe("agent.json_output")
def json_output(sc):
    s = sig(sc, "json_flag")
    return out("agent.json_output", s["count"], f"{s['count']} machine-readable output flags/formats (--json, ndjson…)" if s["count"] else "no JSON output flag found", s, locs(sc, "json_flag"), "derived")


@probe("agent.describe")
def describe(sc):
    f = paths(sc, r"(^|/)(llms(-full)?\.txt|server\.json|agent(-card)?\.json|capabilities\.json|\.well-known/[\w.-]+)$")
    s = sig(sc, "describe_cmd")
    skills = paths(sc, r"(^|/)SKILL\.md$")
    return out("agent.describe", f or s["count"] or skills, f"self-description: {len(f)} manifest files, {s['count']} describe/schema commands, {len(skills)} SKILL.md",
               {"files": f[:8], "commands": s, "skills": len(skills)}, f + locs(sc, "describe_cmd") + skills[:2], "derived")


@probe("agent.structured_errors")
def structured_errors(sc):
    e, i = sig(sc, "error_codes"), sig(sc, "mcp_is_error")
    return out("agent.structured_errors", e["nontest"], f"{e['nontest']} typed-error/code sites outside tests; MCP isError {i['count']}", {"error_codes": e, "mcp_is_error": i},
               locs(sc, "error_codes", nontest=True), "inferred")


@probe("agent.approval")
def approval(sc):
    s = sig(sc, "approval")
    return out("agent.approval", s["count"], f"{s['nontest']} approval/permission/dry-run references outside tests" if s["count"] else "no approval or dry-run mechanism found", s,
               locs(sc, "approval", nontest=True), "inferred")


@probe("agent.budget")
def budget_(sc):
    s = sig(sc, "budget")
    return out("agent.budget", s["nontest"], f"{s['nontest']} budget/limit references outside tests" if s["nontest"] else "no token/step/cost budget found", s, locs(sc, "budget", nontest=True), "inferred")


@probe("agent.llm_usage")
def llm_usage(sc):
    s, m = sig(sc, "llm_sdk"), sig(sc, "model_names")
    deps = sorted(d for d in all_deps(sc, product_only=True) if re.search(r"^(openai|anthropic|@anthropic-ai/[\w-]+|claude[-_]agent[-_]sdk|@google/genai|google-genai|ollama|litellm|langchain[\w.-]*|@langchain/[\w-]+|"
                                                       r"llama[-_]index|transformers|vllm|mlx(-lm)?|coremltools|onnxruntime[\w-]*|@openai/agents|ai|@ai-sdk/[\w-]+|llama-cpp-python|@cursor/sdk|@opencode-ai/sdk)$", d))
    return out("agent.llm_usage", s["nontest"] or deps, f"LLM SDK imports {s['nontest']}, model-name strings {m['count']}, deps {deps[:8] or '-'}", {"sdk_imports": s, "model_names": m, "deps": deps},
               locs(sc, "llm_sdk", nontest=True) + locs(sc, "model_names"), "derived")


@probe("agent.prompt_injection")
def prompt_injection(sc):
    s = sig(sc, "injection_defense")
    return out("agent.prompt_injection", s["count"], f"{s['count']} prompt-injection / untrusted-content handling references" if s["count"] else "no prompt-injection handling found", s,
               locs(sc, "injection_defense"), "inferred")


@probe("agent.sandbox")
def sandbox(sc):
    s = sig(sc, "isolation")
    return out("agent.sandbox", s["practice"], f"{s['practice']} isolation/containment references in code/config/CI, {s['in_docs']} in docs" if s["count"] else "no isolation mechanism referenced",
               s, locs(sc, "isolation"), "inferred")


@probe("ai.disclosure")
def ai_disclosure(sc):
    s = sig(sc, "ai_disclosure")
    g = sc.git
    agents = paths(sc, r"(^|/)(AGENTS\.md|CLAUDE\.md|GEMINI\.md|copilot-instructions\.md)$")
    return out("ai.disclosure", s["count"] or agents or g.get("ai_coauthored_commits"), f"AI-development disclosure mentions {s['count']}; agent instruction files {len(agents)}; "
               f"AI-co-authored commits {g.get('ai_coauthored_commits')} of {g.get('commits_read')} read (shallow={g.get('shallow')})",
               {"mentions": s, "agent_files": agents[:5], "git": {k: g.get(k) for k in ("ai_coauthored_commits", "commits_read", "shallow")}}, agents + locs(sc, "ai_disclosure"), "derived")


# ---------------------------------------------------------------- durability and epistemics

def _sig_probe(pid, name, label, conf="inferred"):
    @probe(pid)
    def fn(sc):
        s = sig(sc, name)
        return out(pid, s["nontest"], f"{s['nontest']} {label} references outside tests in {s['files']} files" if s["nontest"] else f"no {label} references found outside tests", s,
                   locs(sc, name, nontest=True), conf)
    return fn


_sig_probe("dur.checkpoint", "checkpoint", "checkpoint/resume/idempotency")
_sig_probe("dur.retry", "retry", "retry/backoff")
_sig_probe("epi.evidence", "provenance_fields", "provenance/digest/evidence")
_sig_probe("epi.uncertainty", "uncertainty", "confidence/calibration/abstention")
_sig_probe("epi.coverage", "coverage_fields", "limitations/unknown/skipped")
_sig_probe("obs.doctor", "doctor", "doctor/health-check")
_sig_probe("obs.logging", "struct_log", "structured-logging")
_sig_probe("obs.otel", "otel", "OpenTelemetry", "derived")
_sig_probe("obs.signals", "signals", "signal-handling/shutdown")
_sig_probe("priv.dnt", "dnt", "DO_NOT_TRACK", "derived")
_sig_probe("perf.energy", "energy", "energy/carbon", "derived")


@probe("dur.storage")
def storage(sc):
    s, w = sig(sc, "storage"), sig(sc, "wal_pragma")
    return out("dur.storage", s["nontest"], f"{s['nontest']} durable-storage references outside tests; WAL pragma {w['count']}" if s["nontest"] else "no durable storage found",
               {"storage": s, "wal": w}, locs(sc, "storage", nontest=True) + locs(sc, "wal_pragma"), "inferred")


@probe("claims.count")
def claims(sc):
    n, s = sig(sc, "claims_numeric"), sig(sc, "claims_superlative")
    samples = [{"at": f"{x['path']}:{x['line']}", "text": x["text"]} for x in sc.signals["claims_numeric"]["locs"] + sc.signals["claims_superlative"]["locs"]][:10]
    return out("claims.count", n["count"] + s["count"], f"{n['count']} numeric performance/value claims and {s['count']} superlatives in docs", {"numeric": n, "superlative": s, "samples": samples},
               [x["at"] for x in samples], "derived")


@probe("claims.harness")
def claims_harness(sc):
    b = bench(sc)
    r = sig(sc, "bench_ref")
    return out("claims.harness", b["found"], f"harness files {b['value'].get('files', 0)}, result files {len(b['value'].get('result_files', []))}, doc references to benchmarks/reproduction {r['count']}",
               {"harness_files": b["value"].get("files", 0), "result_files": b["value"].get("result_files", []), "doc_references": r}, b["evidence"] + locs(sc, "bench_ref"), "derived")


# ---------------------------------------------------------------- evolution

@probe("evo.semver")
def semver(sc):
    versions = [{"path": m["path"], "version": m.get("version")} for m in sc.manifests["package.json"] if m.get("version") and not m.get("private")]
    versions += [{"path": m["path"], "version": (m.get("project") or {}).get("version")} for m in sc.manifests["pyproject.toml"] if (m.get("project") or {}).get("version")]
    versions += [{"path": m["path"], "version": (m.get("package") or {}).get("version")} for m in sc.manifests["Cargo.toml"] if isinstance((m.get("package") or {}).get("version"), str)]
    pre1 = [v for v in versions if str(v["version"]).startswith("0.")]
    w = sig(sc, "semver_word")
    return out("evo.semver", versions or sc.git.get("tags"), f"{len(versions)} published version fields ({len(pre1)} pre-1.0); git tags {sc.git.get('tags')}; semver/breaking-change mentions {w['count']}",
               {"versions": versions[:10], "pre_1_0": len(pre1), "tags": sc.git.get("tags"), "tag_sample": sc.git.get("tag_sample"), "mentions": w}, [v["path"] for v in versions] + locs(sc, "semver_word"), "observed")


@probe("evo.platforms")
def platforms(sc):
    eng = [{"path": m["path"], "engines": m.get("engines"), "os": m.get("os"), "cpu": m.get("cpu")} for m in sc.manifests["package.json"] if m.get("engines") or m.get("os") or m.get("cpu")]
    py = [{"path": m["path"], "requires_python": (m.get("project") or {}).get("requires-python")} for m in sc.manifests["pyproject.toml"] if (m.get("project") or {}).get("requires-python")]
    rs = [{"path": m["path"], "rust_version": (m.get("package") or {}).get("rust-version")} for m in sc.manifests["Cargo.toml"] if (m.get("package") or {}).get("rust-version")]
    go = [{"path": m["path"], "go": m["go"]} for m in sc.manifests["go.mod"] if m["go"]]
    w = sig(sc, "platform_words")
    return out("evo.platforms", eng or py or rs or go or w["count"], f"runtime constraints: npm {len(eng)}, python {len(py)}, rust {len(rs)}, go {len(go)}; platform mentions in docs {w['count']}",
               {"npm": eng[:5], "python": py[:5], "rust": rs[:5], "go": go[:5], "doc_mentions": w}, [x["path"] for x in eng + py + rs + go][:6], "observed")


@probe("evo.support")
def support(sc):
    s = sig(sc, "support_policy")
    return out("evo.support", s["count"], f"{s['count']} support-period / EOL / LTS statements in docs" if s["count"] else "no support period or EOL policy stated", s, locs(sc, "support_policy"), "derived")


# ---------------------------------------------------------------- operability and privacy

@probe("obs.env_vars")
def env_vars(sc):
    names = sorted(sc.env_names)
    docs = "\n".join(sc.doc_text.values())
    documented = [n for n in names if n in docs]
    return out("obs.env_vars", names, f"{len(names)} environment variables read; {len(documented)} appear in docs" if names else "no environment variables read",
               {"count": len(names), "documented": len(documented), "ratio": round(len(documented) / len(names), 3) if names else None,
                "undocumented_sample": [n for n in names if n not in documented][:15]}, locs(sc, "env_read"), "derived")


@probe("priv.telemetry")
def telemetry(sc):
    lib, word, opt = sig(sc, "telemetry_lib"), sig(sc, "telemetry_word"), sig(sc, "telemetry_optout")
    deps = sorted(d for d in all_deps(sc) if re.search(r"posthog|segment|mixpanel|amplitude|sentry|datadog|dd-trace|statsig|rudderstack|logrocket|plausible|applicationinsights|honeycomb", d, re.I))
    docs = paths(sc, r"(^|/)(TELEMETRY|PRIVACY)[\w.-]*\.(md|mdx|rst|txt)$|(^|/)docs/[\w/-]*(telemetry|privacy)[\w.-]*\.(md|mdx)$")
    found = lib["nontest"] or deps
    return out("priv.telemetry", found, f"telemetry/analytics SDK references {lib['nontest']}, deps {deps or '-'}; opt-out references {opt['count']}; telemetry/privacy docs {len(docs)}" if found
               else f"no telemetry SDK found; telemetry mentions {word['count']}", {"sdk": lib, "deps": deps, "mentions": word, "opt_out": opt, "docs": docs[:5], "dnt": sig(sc, "dnt")},
               docs + locs(sc, "telemetry_lib", nontest=True) + locs(sc, "telemetry_optout"), "derived")


@probe("priv.offline")
def offline(sc):
    o, n = sig(sc, "offline"), sig(sc, "net_calls")
    return out("priv.offline", o["count"], f"offline/local-first references {o['count']}; network call sites outside tests {n['nontest']}", {"offline": o, "network_calls": n},
               locs(sc, "offline") + locs(sc, "net_calls", nontest=True), "inferred")


# ---------------------------------------------------------------- crypto and UI

@probe("crypto.classical")
def classical(sc):
    c, a = sig(sc, "crypto_classical"), sig(sc, "uses_crypto_api")
    return out("crypto.classical", c["nontest"], f"{c['nontest']} classical public-key / TLS library references outside tests; crypto API calls {a['nontest']}", {"classical": c, "crypto_api": a},
               locs(sc, "crypto_classical", nontest=True), "derived")


@probe("crypto.pqc")
def pqc(sc):
    s = sig(sc, "crypto_pqc")
    return out("crypto.pqc", s["count"], f"{s['count']} post-quantum references" if s["count"] else "no post-quantum algorithms referenced", s, locs(sc, "crypto_pqc"), "derived")


@probe("ui.a11y")
def a11y(sc):
    a, t = sig(sc, "a11y_attr"), sig(sc, "a11y_tool")
    ui_files = sum(1 for f in sc.files if "ui" in f["kinds"])
    return out("ui.a11y", t["practice"] or a["count"], f"{ui_files} UI files; accessibility attributes {a['count']}; accessibility tooling references {t['practice']} (plus {t['in_docs']} in docs)",
               {"ui_files": ui_files, "attributes": a, "tooling": t}, locs(sc, "a11y_tool") + locs(sc, "a11y_attr"), "derived")


@probe("ui.i18n")
def i18n(sc):
    s = sig(sc, "i18n_lib")
    tr = translations(sc)
    return out("ui.i18n", s["count"] or tr["found"], f"i18n library references {s['count']}; translation files {tr['value']['files']}", {"library": s, "translations": tr["value"]},
               locs(sc, "i18n_lib") + tr["evidence"], "derived")


def run_all(sc: Scan, only: list[str] | None = None) -> dict:
    res = {}
    for pid, fn in PROBES.items():
        if only and pid not in only:
            continue
        try:
            res[pid] = fn(sc)
        except Exception as e:  # a probe failure is reported, never fatal
            res[pid] = {"id": pid, "found": False, "summary": f"probe error: {type(e).__name__}: {e}"[:300], "value": {}, "evidence": [], "confidence": "inferred", "error": True}
    return res
