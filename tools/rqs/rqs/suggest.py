"""Turn probe evidence into suggestions: applicability flags, a profile, and criterion levels.

Suggestions are a starting point for a reviewer, not a verdict. Each carries its rule and
confidence, and a criterion without a rule stays U (unknown) until someone looks.
"""

from __future__ import annotations

import re


def _f(p, pid):
    return p.get(pid) or {"found": False, "value": {}, "evidence": [], "summary": ""}


def _v(p, pid, *keys, default=0):
    x = _f(p, pid)["value"]
    for k in keys:
        if not isinstance(x, dict):
            return default
        x = x.get(k, default)
    return x if x is not None else default


def flags(p: dict, sc) -> dict:
    """Applicability flags, each with the rule that set it (inferred; a reviewer confirms)."""
    s = sc.signals
    deps = " ".join(_v(p, "agent.llm_usage", "deps", default=[]) or [])
    res = {}

    def put(name, on, why):
        res[name] = {"value": bool(on), "why": why}

    code_lines = sum(v["lines"] for v in sc.langs.values())
    put("uses_llm", _f(p, "agent.llm_usage")["found"] or _f(p, "agent.mcp")["found"] or (_v(p, "meta.agents_md", "skills") > 0 and code_lines < 3000),
        f"LLM SDK imports {s['llm_sdk']['nontest']}, LLM deps {deps[:60] or '-'}; MCP {_f(p, 'agent.mcp')['found']}; SKILL.md {_v(p, 'meta.agents_md', 'skills')}")
    put("has_ui", _v(p, "ui.a11y", "ui_files") >= 10, f"{_v(p, 'ui.a11y', 'ui_files')} UI files (jsx/tsx/vue/svelte/html)")
    put("executes_code", s["exec_code"]["nontest"] > 0, f"{s['exec_code']['nontest']} process/browser execution sites outside tests")
    put("network_service", s["net_server"]["nontest"] > 0, f"{s['net_server']['nontest']} server listen/serve sites outside tests")
    put("parses_untrusted", s["parse_untrusted"]["nontest"] > 0 or s["exec_code"]["nontest"] > 0 and s["net_calls"]["nontest"] > 0,
        f"{s['parse_untrusted']['nontest']} archive/binary/document/HTML parser sites; network fetch sites {s['net_calls']['nontest']}")
    put("uses_crypto", s["uses_crypto_api"]["nontest"] > 5 or s["crypto_classical"]["nontest"] > 5,
        f"crypto API calls {s['uses_crypto_api']['nontest']}, classical PK/TLS references {s['crypto_classical']['nontest']}")
    put("heavy_compute", bool(re.search(r"torch|tensorflow|onnxruntime|coremltools|mlx|vllm|transformers|llama", deps)) or s["heavy_compute"]["nontest"] > 20,
        f"ML deps {deps[:60] or '-'}; ML/GPU references {s['heavy_compute']['nontest']}")
    put("distributed", _f(p, "evo.semver")["found"] or _f(p, "ci.release_automation")["found"],
        f"published version fields {len(_v(p, 'evo.semver', 'versions', default=[]))}, release automation {_f(p, 'ci.release_automation')['found']}")
    return res


def profile(p: dict, fl: dict, sc) -> dict:
    readme = " ".join(t for k, t in sc.doc_text.items() if k.lower().startswith("readme")).lower()
    code_lines = sum(v["lines"] for v in sc.langs.values() if v)
    skills = _v(p, "meta.agents_md", "skills")
    if re.search(r"penetration|pentest|vulnerabilit(?:y|ies) (?:scan|discovery|assessment)|security testing|red[- ]team", readme):
        return {"profile": "security-tool", "why": "README describes security testing"}
    if skills and code_lines < 3000:
        return {"profile": "skill-pack", "why": f"{skills} SKILL.md files and {code_lines} code lines"}
    if fl["heavy_compute"]["value"] and re.search(r"\bmodel\b|train|fine-?tun|inference|dataset", readme):
        return {"profile": "ml-system", "why": "ML dependencies and a model-centred README"}
    intro = re.sub(r"<[^>]+>", " ", readme)[:1500]
    if re.search(r"durable|workflow|job queue|task queue|orchestration engine|scheduler", intro) and _f(p, "dur.storage")["found"]:
        return {"profile": "workflow-engine", "why": "README introduces a durable/workflow engine with storage"}
    if fl["has_ui"]["value"] and fl["executes_code"]["value"] and re.search(r"\bagents?\b", readme):
        return {"profile": "agent-harness", "why": "UI that runs processes and talks about agents"}
    if fl["uses_llm"]["value"] and not fl["has_ui"]["value"]:
        return {"profile": "agent-tool", "why": "agent-facing interfaces without a UI"}
    if fl["has_ui"]["value"]:
        return {"profile": "application", "why": "has a UI"}
    return {"profile": "agent-tool", "why": "default"}


def _lvl(level, conf, why, ev=None):
    return {"level": level, "confidence": conf, "basis": why, "evidence": (ev or [])[:6]}


def levels(p: dict, fl: dict) -> dict:
    """criterion id -> suggested {level, confidence, basis, evidence}. Missing ids stay U."""
    on = {k: v["value"] for k, v in fl.items()}
    S = {}
    found = lambda pid: _f(p, pid)["found"]  # noqa: E731
    ev = lambda *pids: [e for pid in pids for e in _f(p, pid)["evidence"]]  # noqa: E731

    # PUR
    if not found("meta.readme_sections"):
        S["PUR-1"] = _lvl(0, "observed", "no README", [])
    else:
        h = _v(p, "meta.readme_sections", "has", default={})
        chars = _v(p, "meta.readme_sections", "chars")
        lvl = 1 if chars < 600 else 3 if h.get("start") and h.get("mentions_limits") else 2
        if lvl == 3 and _v(p, "agent.describe", "files", default=[]):
            lvl = 4
        S["PUR-1"] = _lvl(lvl, "derived", f"README {chars} chars; quick start {h.get('start')}; limits {h.get('mentions_limits')}", ev("meta.readme_sections"))
    nclaims = _v(p, "claims.count", "numeric", "count") + _v(p, "claims.count", "superlative", "count")
    harness = _v(p, "claims.harness", "harness_files")
    results = len(_v(p, "claims.harness", "result_files", default=[]))
    if nclaims:
        lvl = 1 if not harness else 2 if not results else 3
        S["PUR-2"] = _lvl(lvl, "inferred", f"{nclaims} claims; harness files {harness}; result files {results}", ev("claims.count", "claims.harness"))
        S["EPI-5"] = _lvl(1 if not harness else 2, "inferred", f"{nclaims} numeric/superlative claims, harness files {harness} (a reviewer must check claims against measurements)", ev("claims.count"))
    else:
        S["EPI-5"] = _lvl(3, "derived", "no numeric or superlative claims found in docs", [])

    # COR
    tests = _v(p, "test.ratio", "test_files") + (1 if _v(p, "test.ratio", "rust_inline_test_markers") else 0)
    ratio = _v(p, "test.ratio", "ratio") or 0
    in_ci = _v(p, "ci.tests_in_ci", "commands")
    oss = len(_v(p, "ci.os_matrix", "runners", default={}))
    if not tests:
        S["COR-1"] = _lvl(0, "derived", "no test files found", [])
    else:
        lvl = 3 if in_ci and ratio >= 0.3 else 2 if in_ci or ratio >= 0.3 else 1
        if lvl == 3 and oss >= 2 and ratio >= 0.5:
            lvl = 4
        S["COR-1"] = _lvl(lvl, "derived", f"{tests} test files, test/source lines {ratio}, test commands in CI {in_ci}, CI OS kinds {oss} "
                          "(override if CI runs tests through a wrapper script)", ev("ci.tests_in_ci"))
    S["COR-2"] = _lvl(2 if found("test.golden") or found("test.e2e") else 1, "inferred",
                      f"golden/fixture files {_v(p, 'test.golden', 'files')}, e2e files {_v(p, 'test.e2e', 'files')} (independence of the oracle needs review)", ev("test.golden", "test.e2e"))
    strong = [x for x in ("test.mutation", "test.property", "test.fuzz") if found(x)]
    S["COR-3"] = _lvl({0: 1, 1: 2, 2: 3, 3: 4}[len(strong)], "derived", f"strength techniques present: {strong or 'none'}", ev(*strong))

    # REL
    if on.get("executes_code") or on.get("network_service"):
        S["REL-4"] = _lvl(3 if found("obs.signals") else 1, "inferred", _f(p, "obs.signals")["summary"], ev("obs.signals"))
    # PERF
    S["PERF-1"] = _lvl(3 if results and harness else 2 if harness else 1, "derived", f"benchmark files {harness}, result files {results}", ev("test.bench"))
    if on.get("heavy_compute"):
        S["PERF-3"] = _lvl(2 if found("perf.energy") else 1, "inferred", _f(p, "perf.energy")["summary"], ev("perf.energy"))

    # SEC
    if not found("meta.security_policy"):
        S["SEC-1"] = _lvl(0, "observed", "no SECURITY policy", [])
    else:
        c = _v(p, "meta.security_policy", "contact", default=False)
        t = _v(p, "meta.security_policy", "threat_model_mentions")
        S["SEC-1"] = _lvl(3 if c and t else 2 if c else 1, "derived", f"policy present; contact {c}; threat-model mentions {t}", ev("meta.security_policy"))
    ndeps = _v(p, "deps.counts", "unique")
    lock, bot, scans = found("deps.lockfiles"), found("deps.update_bot"), bool(_v(p, "ci.security_scans", "tools", default=[]))
    if ndeps:
        lvl = 4 if lock and bot and scans else 3 if lock and (bot or scans) else 2 if lock else 1
        S["SEC-2"] = _lvl(lvl, "derived", f"{ndeps} deps; lockfiles {lock}; update bot {bot}; scanners {scans}", ev("deps.lockfiles", "deps.update_bot", "ci.security_scans"))
    if on.get("distributed"):
        prov, rel = found("ci.provenance"), found("ci.release_automation")
        S["SEC-3"] = _lvl(3 if prov and rel else 2 if rel or prov else 1, "derived", f"provenance/signing {prov}; release automation {rel}", ev("ci.provenance", "ci.release_automation"))
        S["SEC-4"] = _lvl((4 if _v(p, "ci.sbom", "vex_steps") else 3) if found("ci.sbom") else 1, "derived", _f(p, "ci.sbom")["summary"], ev("ci.sbom"))
        S["EVO-4"] = _lvl(3 if found("evo.support") else 1, "derived", _f(p, "evo.support")["summary"], ev("evo.support"))
        S["PRV-4"] = _lvl(2 if found("meta.compliance") else 1, "inferred", _f(p, "meta.compliance")["summary"], ev("meta.compliance"))
    wf = _v(p, "ci.permissions", "workflows")
    if wf:
        r = _v(p, "ci.pinned_actions", "ratio") or 0
        perm = _v(p, "ci.permissions", "top_level") / wf
        if found("ci.pull_request_target"):
            S["SEC-5"] = _lvl(0, "inferred", "privileged trigger checks out pull-request code (confirm)", ev("ci.pull_request_target"))
        else:
            lvl = 4 if r >= 0.9 and perm >= 0.9 else 3 if r >= 0.5 and perm >= 0.5 else 2 if r > 0 or perm > 0 else 1
            S["SEC-5"] = _lvl(lvl, "derived", f"SHA-pinned actions {r}; workflows with top-level permissions {round(perm, 2)}", ev("ci.pinned_actions", "ci.permissions"))
    sec = _f(p, "risk.secrets")
    if sec["found"]:
        S["SEC-6"] = _lvl(0, "inferred", sec["summary"] + " (confirm each hit before treating it as a leak)", sec["evidence"])
    else:
        S["SEC-6"] = _lvl(3 if _v(p, "ci.security_scans", "secret_scanners", default=[]) else 2, "derived",
                          f"no secret patterns outside tests; secret scanner in CI: {bool(_v(p, 'ci.security_scans', 'secret_scanners', default=[]))}", [])
    risky = _v(p, "risk.tls_off", "nontest") + _v(p, "risk.unsafe_deser", "nontest")
    S["SEC-7"] = _lvl(1 if risky else 3, "inferred" if risky else "derived",
                      f"TLS-bypass or unsafe-deserialization sites outside tests: {risky} (reachability from untrusted input decides 0 vs 1-2)" if risky else "no TLS bypass or unsafe deserialization outside tests",
                      ev("risk.tls_off", "risk.unsafe_deser"))
    if on.get("parses_untrusted"):
        S["SEC-8"] = _lvl(3 if found("test.fuzz") else 1, "inferred", _f(p, "test.fuzz")["summary"], ev("test.fuzz"))
    if on.get("uses_crypto"):
        S["SEC-9"] = _lvl(3 if found("crypto.pqc") else 1, "inferred", _f(p, "crypto.pqc")["summary"], ev("crypto.pqc"))

    # AGT (only when uses_llm)
    if on.get("uses_llm"):
        S["AGT-1"] = _lvl(2 if found("agent.prompt_injection") else 1, "inferred", _f(p, "agent.prompt_injection")["summary"], ev("agent.prompt_injection"))
        S["AGT-2"] = _lvl(2 if found("agent.approval") else 1, "inferred", _f(p, "agent.approval")["summary"], ev("agent.approval"))
        S["AGT-3"] = _lvl(2 if found("agent.approval") else 1, "inferred", _f(p, "agent.approval")["summary"], ev("agent.approval"))
        S["AGT-4"] = _lvl(2 if harness else 1, "inferred", f"benchmark/eval files {harness}", ev("test.bench"))
        S["AGT-6"] = _lvl(2 if found("agent.budget") else 1, "inferred", _f(p, "agent.budget")["summary"], ev("agent.budget"))

    # INT
    proto = [x for x in ("agent.mcp", "agent.openapi", "agent.a2a") if found(x)]
    library = bool(_v(p, "evo.semver", "versions", default=[])) and found("meta.docs")
    S["INT-1"] = _lvl(3 if proto else 2 if found("agent.json_output") or library else 1, "inferred",
                      f"protocols {proto or '-'}; JSON output {found('agent.json_output')}; published library with docs {library}", ev(*proto, "agent.json_output"))
    S["INT-2"] = _lvl(3 if _v(p, "agent.describe", "files", default=[]) or _v(p, "agent.describe", "commands", "count") else 2 if _v(p, "agent.describe", "skills") else 1, "inferred",
                      _f(p, "agent.describe")["summary"], ev("agent.describe"))
    S["INT-4"] = _lvl(2 if found("agent.structured_errors") else 1, "inferred", _f(p, "agent.structured_errors")["summary"], ev("agent.structured_errors"))
    if on.get("has_ui"):
        t, a = _v(p, "ui.a11y", "tooling", "count"), _v(p, "ui.a11y", "attributes", "count")
        S["INT-6"] = _lvl(3 if t else 2 if a else 1, "inferred", _f(p, "ui.a11y")["summary"], ev("ui.a11y"))

    # EPI
    S["EPI-1"] = _lvl(2 if _v(p, "epi.evidence", "nontest") >= 10 else 1, "inferred", _f(p, "epi.evidence")["summary"], ev("epi.evidence"))
    S["EPI-2"] = _lvl(2 if found("epi.uncertainty") else 1, "inferred", _f(p, "epi.uncertainty")["summary"], ev("epi.uncertainty"))

    # MNT
    src = _v(p, "test.ratio", "source_lines")
    if src < 300:
        for cid in ("MNT-1", "MNT-2", "MNT-3"):
            S[cid] = {"level": "NA", "confidence": "observed", "basis": f"only {src} lines of code", "evidence": []}
    else:
        if found("static.arch_guards"):
            S["MNT-1"] = _lvl(4, "derived", _f(p, "static.arch_guards")["summary"], ev("static.arch_guards"))
        biggest = (_v(p, "size.largest", "largest", default=[{}]) or [{}])[0].get("lines", 0)
        dup = _v(p, "size.duplicates", "duplicated_bytes")
        textbytes = max(1, _v(p, "size.largest", "bytes") - _v(p, "size.largest", "binary_bytes"))
        share = dup / textbytes
        lvl = 1 if biggest > 5000 or share > 0.05 else 2 if biggest > 2000 or share > 0.01 else 3
        if lvl == 3 and (found("static.dupe_tools") or found("static.deadcode_tools")):
            lvl = 4
        S["MNT-2"] = _lvl(lvl, "derived", f"largest source file {biggest} lines; duplicated bytes {dup} ({round(100 * share, 2)}% of text)", ev("size.largest", "size.duplicates"))
        have = [x for x in ("static.lint", "static.format", "static.types") if found(x)]
        in_ci = [x for x in have if _v(p, x, "ci", default=[])]
        lvl = 4 if len(in_ci) == 3 else 3 if len(have) == 3 else len(have)
        S["MNT-3"] = _lvl(lvl, "derived", f"configured {have or '-'}; enforced in CI {in_ci or '-'}", ev(*have))
    docs = [x for x in ("meta.contributing", "meta.agents_md", "meta.docs") if found(x)]
    S["MNT-4"] = _lvl({0: 1 if found("meta.readme_sections") else 0, 1: 1, 2: 2, 3: 3}[len(docs)], "derived", f"maintainer docs present: {docs or '-'}", ev(*docs))
    nd = _v(p, "static.debt_markers", "nontest")
    if nd:
        S["MNT-5"] = _lvl(3 if _v(p, "static.debt_markers", "ledger", default=[]) else 2, "derived", _f(p, "static.debt_markers")["summary"], ev("static.debt_markers"))

    # EVO
    if found("evo.semver") or found("meta.changelog"):
        S["EVO-1"] = _lvl(3 if found("meta.changelog") and _v(p, "evo.semver", "versions", default=[]) else 2, "derived",
                          f"changelog {found('meta.changelog')}; versions {len(_v(p, 'evo.semver', 'versions', default=[]))}; tags {_v(p, 'evo.semver', 'tags')}", ev("meta.changelog", "evo.semver"))
    if on.get("distributed"):
        S["EVO-2"] = _lvl(3 if found("ci.release_automation") and found("meta.changelog") else 2 if found("ci.release_automation") else 1, "derived",
                          f"release automation {found('ci.release_automation')}; changelog {found('meta.changelog')}", ev("ci.release_automation", "meta.changelog"))
    if wf:
        S["EVO-3"] = _lvl(4 if oss >= 3 else 3 if oss == 2 else 2, "derived", _f(p, "ci.os_matrix")["summary"], ev("ci.os_matrix"))

    # OPS
    S["OPS-1"] = _lvl(3 if found("obs.doctor") else 1, "inferred", _f(p, "obs.doctor")["summary"], ev("obs.doctor"))
    S["OPS-2"] = _lvl(4 if found("obs.logging") and found("obs.otel") else 3 if found("obs.logging") else 1, "inferred",
                      f"structured logging {found('obs.logging')}; OpenTelemetry {found('obs.otel')}", ev("obs.logging", "obs.otel"))
    if _v(p, "obs.env_vars", "count"):
        r = _v(p, "obs.env_vars", "ratio") or 0
        S["OPS-3"] = _lvl(3 if r >= 0.8 else 2 if r >= 0.5 else 1, "derived", _f(p, "obs.env_vars")["summary"], ev("obs.env_vars"))
    if found("risk.remote_script"):
        S["OPS-4"] = _lvl(3 if _v(p, "risk.remote_script", "verification", "count") else 1, "derived", _f(p, "risk.remote_script")["summary"], ev("risk.remote_script"))

    # PRV
    tel = _f(p, "priv.telemetry")
    if tel["found"]:
        opt, dnt, tdocs = _v(p, "priv.telemetry", "opt_out", "count"), _v(p, "priv.telemetry", "dnt", "count"), _v(p, "priv.telemetry", "docs", default=[])
        lvl = 3 if opt and dnt and tdocs else 2 if opt else 1
        S["PRV-1"] = _lvl(lvl, "inferred", tel["summary"] + "; default on/off and collected fields need review", tel["evidence"])
    else:
        S["PRV-1"] = _lvl(3, "derived", "no telemetry SDK found in scanned code", [])
    lic = _f(p, "meta.license")
    if not lic["found"]:
        S["PRV-3"] = _lvl(0, "observed", lic["summary"], [])
    else:
        files = _v(p, "meta.license", "files", default=[])
        known = [f for f in files if f.get("spdx") not in (None, "unrecognised")]
        modified = any(f.get("modified") for f in files)
        lvl = 2 if modified or not known else 3
        if lvl == 3 and found("meta.notices") and (_v(p, "meta.license", "reuse", default=False) or _v(p, "meta.license", "files_with_spdx_headers") > 10):
            lvl = 4
        S["PRV-3"] = _lvl(lvl, "observed" if not modified else "derived", lic["summary"] + ("; modified or non-standard terms" if modified else ""), lic["evidence"])

    # SUS
    gov = [x for x in ("meta.codeowners", "meta.governance") if found(x)]
    S["SUS-1"] = _lvl({0: 1, 1: 2, 2: 3}[len(gov)], "derived", f"{gov or 'no CODEOWNERS/governance'}; {_f(p, 'meta.governance')['summary']}", ev(*gov))
    pipe = [x for x in ("meta.issue_templates", "ci.tests_in_ci") if found(x)]
    S["SUS-2"] = _lvl({0: 1, 1: 2, 2: 3}[len(pipe)], "derived", f"present: {pipe or '-'}", ev(*pipe))
    if found("meta.agents_md") or found("ai.disclosure"):
        ment = _v(p, "ai.disclosure", "mentions", "count")
        S["SUS-3"] = _lvl(3 if found("meta.agents_md") and ment else 2 if found("meta.agents_md") or ment else 1, "inferred", _f(p, "ai.disclosure")["summary"], ev("ai.disclosure"))
    return S
