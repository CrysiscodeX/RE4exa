#!/usr/bin/env python3
"""Exploration layer over the dissection database.

1. Runs the exploration queries and writes their results to exploration.json.
2. Adds a curated layer to the graph: capabilities (the valuable, separable parts of
   each repository, anchored to real nodes), measured findings, relations between
   capabilities (complements / overlaps / fixes), first principles, the merged
   product's components and its remaining gaps.

usage: python3 explore.py <dissection.db> <findings.jsonl> <exploration.json>
"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools" / "dissect"))
from dissect.db import Writer, connect  # noqa: E402

# ---- curated capabilities ---------------------------------------------------------------
# value: how much it contributes to a 2030-35 agent product (1-5); maturity (1-5);
# portability: how cheaply it can be lifted out (1 = entangled, 5 = self-contained).
CAPABILITIES = [
    # repo, key, title, value, maturity, portability, what it is, anchors [(qualname or path)]
    ("rea", "evidence-record", "Content-addressed Evidence records", 5, 5, 3,
     "Every observation is one record: subject digest, provider, operation, parameters, result, confidence (observed/derived/inferred), authority, limitations, locations; evidence_id = sha256 of a canonical projection.",
     ["createEvidence", "src/domain/evidence.ts", "canonicalJson"]),
    ("rea", "residual-unknowns", "Hash-chained residual unknowns with qualifying-evidence guard", 5, 4, 3,
     "Open questions are first-class, revision-chained records; a 'verified' resolution needs evidence of the required authority/confidence.",
     ["ResidualUnknown", "src/domain/residualUnknown.ts", "src/domain/evidenceBundle.ts"]),
    ("rea", "artifact-parsers", "Format parsers (Go buildinfo, Rust .dep-v0, PE resources, Mach-O, ASAR integrity, Electron fuses, .NET CIL)", 4, 5, 4,
     "Self-contained static readers that return exact byte ranges and treat missing metadata as unknown.",
     ["src/go", "src/rust/RustAuditableReader.ts", "src/native/pe/PeResourceParser.ts", "src/electron/ElectronFuseReader.ts", "src/dotnet"]),
    ("rea", "js-app-graph", "JavaScript/Electron application graph", 4, 4, 2,
     "Babel-based inert analysis with resolver emulation, IPC pairing, feature traces and version pairing; heavy (18 min, 6 GB on a 32 MB tree).",
     ["src/application/javascript/JavaScriptArtifactPathResolution.ts", "src/domain/javascript/javascriptApplicationGraph.ts"]),
    ("rea", "engine-bridges", "Deep engine bridges (Ghidra, Hopper, IDA, Kuna)", 4, 4, 2,
     "Token-authenticated NDJSON bridges into decompilers with per-operation capability descriptors.",
     ["bridge/ghidra/ReaGhidraBridge.java", "bridge/hopper_bridge.py", "src/ghidra/GhidraTransport.ts"]),
    ("rea", "process-capture", "PTY process capture with filesystem snapshots", 3, 4, 3,
     "Runs a declared scenario under a PTY, samples the process tree, diffs files; comparison is timing-sensitive.",
     ["src/process/capture"]),
    ("rea", "mcp-catalog", "Large audited MCP catalog (207 tools)", 2, 4, 1,
     "Every tool has audited effects and full schemas; default tools/list is 3.16 MB (74.5% output schemas).",
     ["src/contracts/toolEffects.ts", "src/contracts/toolContracts.ts"]),
    ("leanrea", "cheap-router", "Cheapest-probe router table", 5, 3, 5,
     "Target type -> exact plain-CLI commands (file, readelf, nm, otool, go version -m, asar, rg -uu, tshark), first moves and fallbacks.",
     ["leanrea/SKILL.md"]),
    ("leanrea", "probe-rules", "Probe discipline (slice, batch, cap, seen/inferred/unknown)", 4, 3, 5,
     "Work on a copy, route by magic bytes, slice instead of dumping, batch probes, 2-4 calls, label each claim.",
     ["leanrea/SKILL.md"]),
    ("leanrea", "answer-key-bench", "Answer-key benchmark harness", 3, 2, 5,
     "Fresh workspace per cell, regex answer keys, wall/cost/turn/token metrics, context-overhead probe.",
     ["bench/run.py", "bench/tasks.json", "bench/ctx.sh"]),
    ("caveman", "ccr-store", "Content-addressed original store with retrieval handles (CCR)", 5, 4, 4,
     "Compressed views carry a handle ccr_<sha256 prefix>; the original is committed before publishing and retrievable by handle or BM25 query.",
     ["engine/ccr/store.go"]),
    ("caveman", "format-compressors", "Per-format lossy compressors with safety ladder", 4, 4, 4,
     "JSON/log/terminal/test-report/tool-schema compressors that keep errors, anomalies and change points; fail closed to pass-through.",
     ["engine/compressors/json.go", "engine/compressors/log.go", "engine/compressors/toolschema.go", "engine/safety/safety.go"]),
    ("caveman", "token-accounting", "Offline token accounting (o200k) and honest-numbers method", 4, 4, 5,
     "Embedded tokenizer for budgets; reports billed totals and lists net-negative cases.",
     ["engine/tokens/tokens.go", "docs/HONEST-NUMBERS.md"]),
    ("strix", "coverage-ledger", "Declared-intent vs recorded-outcome coverage document", 5, 4, 4,
     "Unaccounted classes are reported separately from 'tested, nothing found'; runs that did not complete are marked partial.",
     ["build_coverage_document", "strix/report/coverage.py"]),
    ("strix", "finding-dedupe", "Finding de-duplication", 3, 3, 3,
     "Model-assisted merging of duplicate reports before publication.",
     ["strix/report/dedupe.py"]),
    ("strix", "sandboxed-agents", "Sandboxed agent graph", 3, 4, 2,
     "Specialised agents in a Docker runtime sharing discoveries.",
     ["strix/runtime/docker_connection.py", "strix/agents/factory.py"]),
    ("ponytail", "necessity-ladder", "Necessity ladder (need -> reuse -> stdlib -> dependency -> one line -> minimum)", 5, 4, 5,
     "A pre-implementation gate that keeps agents from building what already exists; never cuts validation or security.",
     ["skills/ponytail/SKILL.md"]),
    ("ponytail", "audit-format", "Review/audit checklist and shortcut-debt ledger", 4, 4, 5,
     "Map first, look for bug/risk/scale/missing test/speed/lean, 'no case, no finding', shortcut: comments with upgrade triggers.",
     ["skills/ponytail-audit/SKILL.md", "skills/ponytail-review/SKILL.md", "skills/ponytail-debt/SKILL.md"]),
    ("ponytail", "bench-hygiene", "Benchmark hygiene (geomean, bootstrap CI, sign test, self-tested graders)", 4, 4, 5,
     "Statistically honest A/B evaluation of agent behaviour.",
     ["benchmarks/README.md"]),
    ("my-jev", "calibration-metrics", "Accuracy/Brier/ECE/latency/cost-per-1k harness", 3, 3, 5,
     "Small, readable implementations of decision-quality metrics.",
     ["bench.py", "train_unsloth.py"]),
    ("laya", "typed-decisions", "Typed decisions (choice/score/noul) in one forward pass", 4, 4, 3,
     "Non-generative classifier answers with calibrated probabilities; no text to parse.",
     ["laya/router.py", "laya/agent.py"]),
    ("laya", "temperature-calibration", "Per-type temperature calibration with clamps", 4, 4, 4,
     "LBFGS-fitted temperatures per question type/option bucket, clamped to [0.5, 5.0].",
     ["fit_temperature_map", "laya/calibrate.py"]),
    ("laya", "abstention", "Fitted abstention thresholds and risk-coverage metrics", 5, 4, 4,
     "Pick the smallest threshold meeting a target error; AURC and selective accuracy with tie-aware cuts.",
     ["laya/confidence.py", "laya/evals.py"]),
    ("laya", "proper-scoring", "Proper scoring rules (log, spherical, RPS)", 3, 3, 4,
     "Reward functions that make honest probabilities optimal.",
     ["proper_reward"]),
    ("laya-coreml", "port-fidelity", "Port-fidelity verification against golden outputs", 4, 4, 4,
     "Golden reference logits, argmax agreement, |dp| tolerance, byte-identical determinism over 100 calls.",
     ["benchmarks/validate.py"]),
    ("absurd", "durable-steps", "Postgres-only durable steps (tasks, runs, checkpoints, leases)", 5, 4, 4,
     "ctx.step(name, fn) checkpoints results; retries skip completed steps; idempotent spawn keys.",
     ["claim_task", "set_task_checkpoint_state", "sql/absurd.sql"]),
    ("absurd", "event-await", "Race-free event await (first emit wins)", 3, 4, 4,
     "Tasks suspend on named events whose first payload is cached.",
     ["sql/absurd.sql"]),
    ("pi", "durable-harness", "Durable agent harness (atomic commits, tasks, idempotent submissions)", 4, 3, 2,
     "Conversations, tool calls and app state committed atomically; crash-loop parking; resumable tasks.",
     ["defineTask", "packages/durable/src/harness/harness.ts"]),
    ("pi", "compaction", "Context compaction", 4, 4, 3,
     "Summarises older entries in the background or on overflow.",
     ["packages/durable/src/harness/compaction.ts", "packages/coding-agent/src/core/compaction/compaction.ts"]),
    ("pi", "code-mode", "Code mode in a QuickJS sandbox", 4, 3, 2,
     "The model writes JavaScript that calls tools inside a sandbox and resumes after restart.",
     ["packages/durable/src/codemode/codemode.ts"]),
]

# (src key, dst key, kind, rationale)
RELATIONS = [
    ("evidence-record", "ccr-store", "complements", "Both are content-addressed: an evidence_id can serve as the retrieval handle for a compressed view, so summaries never lose the original."),
    ("evidence-record", "durable-steps", "complements", "Content-addressed results make durable steps idempotent by construction: a replayed step converges on the same evidence_id (measured: prototype crash test)."),
    ("residual-unknowns", "coverage-ledger", "complements", "Unknowns record what is open; the coverage ledger records what was never accounted for. Together they bound an investigation."),
    ("residual-unknowns", "abstention", "complements", "An unknown is an abstention; fitted thresholds decide when a claim must stay unknown."),
    ("evidence-record", "temperature-calibration", "complements", "Categorical confidence classes become measurable once claims are adjudicated against outcomes."),
    ("cheap-router", "artifact-parsers", "complements", "Plain tools answer most first questions in milliseconds; REA's parsers add exact ranges and unknown semantics where they matter."),
    ("cheap-router", "js-app-graph", "overlaps", "Both answer JS/Electron questions; measured 219 ms/2.5 KB vs 1,070.7 s for the same seven questions, with the graph adding typed relations."),
    ("format-compressors", "mcp-catalog", "fixes", "Removing output schemas cuts REA's catalog by 72.7%; caveman's schema shrinker alone saves 1.2% because it skips outputSchema."),
    ("token-accounting", "mcp-catalog", "measures", "o200k counting puts the default catalog at ~833k tokens."),
    ("durable-steps", "evidence-record", "fixes", "REA's ledger dies with its process (3 -> 0 records after SIGKILL) and its 889 MB bundle cannot be re-imported; durable steps keep records outside the process."),
    ("durable-harness", "durable-steps", "overlaps", "Both checkpoint work; Absurd is a generic step engine, pi-durable an agent-conversation harness."),
    ("compaction", "format-compressors", "complements", "Compaction shrinks history; compressors shrink each new tool result."),
    ("necessity-ladder", "mcp-catalog", "fixes", "A necessity gate on tools would ask whether each of 207 tools needs its own schema."),
    ("bench-hygiene", "answer-key-bench", "fixes", "Interleaved arms, 5 reps, geomean with CI and self-tested graders fix leanrea's n=3 parallel-arm design."),
    ("port-fidelity", "evidence-record", "complements", "Golden-output and determinism checks are how evidence producers themselves get verified."),
    ("calibration-metrics", "temperature-calibration", "overlaps", "Same metrics (Brier, ECE); laya adds fitting and clamps."),
    ("coverage-ledger", "finding-dedupe", "complements", "Count once, then account for coverage."),
    ("code-mode", "cheap-router", "complements", "A sandboxed script can batch many cheap probes in one call, the 2-4 call budget leanrea recommends."),
]

PRINCIPLES = [
    ("P1-traceable-truth", "Every claim traces to reproducible evidence: bytes, method, parameters, tool identity."),
    ("P2-honest-uncertainty", "Absence is not a negative; confidence classes are calibrated against outcomes; uncertain claims abstain."),
    ("P3-attention-economy", "Tokens and turns are the scarcest resource: cheapest sufficient probe first, bounded outputs, detail on demand by handle."),
    ("P4-durability", "Work survives crashes and restarts; replays are idempotent; storage has no single-object size cliff."),
    ("P5-accounted-completeness", "An investigation knows what it did not examine and says so."),
    ("P6-minimal-surface", "Few composable tools with small self-describing schemas; one catalog an agent can hold in context."),
    ("P7-inert-by-default", "Analysis does not execute targets unless explicitly asked; runtime actions are declared and isolated."),
    ("P8-self-verification", "The tool proves itself: answer keys, golden outputs, dogfooding on its own artifact."),
]

COMPONENTS = [
    ("C1-probe", "Probe layer: magic-byte routing to the cheapest sufficient probe; deep engines as optional adapters", ["cheap-router", "probe-rules", "artifact-parsers", "engine-bridges", "code-mode"], ["P3-attention-economy", "P7-inert-by-default"]),
    ("C2-evidence", "Evidence layer: one canonical record per observation, content-addressed, single payload copy", ["evidence-record", "port-fidelity"], ["P1-traceable-truth", "P8-self-verification"]),
    ("C3-store", "Durable store: append-only, streaming (JSONL/SQLite), idempotent steps keyed by tool + canonical args", ["durable-steps", "durable-harness", "ccr-store"], ["P4-durability"]),
    ("C4-budget", "Budget layer: token estimates on every output, summary-first views, retrieval by evidence handle", ["token-accounting", "format-compressors", "compaction", "ccr-store"], ["P3-attention-economy", "P6-minimal-surface"]),
    ("C5-epistemics", "Epistemic layer: unknowns, qualifying-evidence guard, abstention thresholds, calibration report", ["residual-unknowns", "abstention", "temperature-calibration", "calibration-metrics", "proper-scoring"], ["P2-honest-uncertainty"]),
    ("C6-coverage", "Coverage layer: declared questions vs recorded answers; unaccounted vs negative; partial-run caveats", ["coverage-ledger", "finding-dedupe"], ["P5-accounted-completeness"]),
    ("C7-quality-gate", "Quality gate: necessity ladder before adding tools; audit format; benchmark hygiene for the product", ["necessity-ladder", "audit-format", "bench-hygiene", "answer-key-bench"], ["P6-minimal-surface", "P8-self-verification"]),
    ("C8-interface", "Interface: one CLI and one small MCP catalog (<= 12 tools, no output schemas), JSON everywhere, self-describing", ["mcp-catalog", "typed-decisions"], ["P6-minimal-surface"]),
]

PRODUCT_GAPS = [
    ("G1", "Semantic search is lexical (FTS5 + taxonomy); no offline embedding model is reachable here, so paraphrase matches are missed.", ["C4-budget", "C8-interface"]),
    ("G2", "Calibration needs adjudicated outcomes; until enough claims are labelled, confidence classes stay uncalibrated.", ["C5-epistemics"]),
    ("G3", "Deep decompilation still depends on external engines (Ghidra/IDA/Hopper) that cannot be bundled.", ["C1-probe"]),
    ("G4", "Evidence is unsigned; cross-machine sharing in 2030 will need signed provenance (e.g. in-toto/Sigstore style attestations).", ["C2-evidence", "C3-store"]),
    ("G5", "Multi-agent concurrency on one store needs leases or single-writer discipline; SQLite WAL handles one writer.", ["C3-store"]),
    ("G6", "Runtime probes need isolation the product does not provide by itself (containers/VMs).", ["C1-probe"]),
    ("G7", "Coverage is only as good as the declared question list; undeclared questions stay invisible.", ["C6-coverage"]),
]


def resolve_anchor(con, repo_id: int, anchor: str) -> int | None:
    row = con.execute(
        "select id from node where repo_id = ? and (qualname = ? or name = ? or path = ? or (kind = 'file' and path like ? || '/%'))"
        " order by case kind when 'symbol' then 0 when 'file' then 1 else 2 end, id limit 1",
        (repo_id, anchor, anchor, anchor, anchor)).fetchone()
    return row[0] if row else None


def curate(con, findings_path: Path) -> dict:
    con.execute("delete from edge where src in (select id from node where kind in ('capability','finding','principle','component','gap') or (kind='product' and sub='merged'))"
                " or dst in (select id from node where kind in ('capability','finding','principle','component','gap') or (kind='product' and sub='merged'))")
    con.execute("delete from node where kind in ('capability','finding','principle','component','gap') or (kind='product' and sub='merged')")
    repos = {r["name"]: r["id"] for r in con.execute("select id, name from repo")}
    w = Writer(con, None)
    cap_ids, unresolved = {}, []
    for repo, key, title, value, maturity, portability, what, anchors in CAPABILITIES:
        rid = repos[repo]
        cid = w.node("capability", title, sub=repo, qualname=f"capability:{key}", doc=what, repo_id=rid,
                     attrs={"value": value, "maturity": maturity, "portability": portability, "score": value * 2 + maturity + portability})
        cap_ids[key] = cid
        repo_node = con.execute("select id from node where kind='product' and sub='repository' and repo_id=?", (rid,)).fetchone()[0]
        w.edge(repo_node, cid, "provides")
        for a in anchors:
            nid = resolve_anchor(con, rid, a)
            if nid:
                w.edge(cid, nid, "implemented_by")
            else:
                unresolved.append(f"{repo}:{a}")
        for concept in con.execute("select c.id from node c where c.kind='concept' and c.name in (select value from json_each(?))",
                                   (json.dumps(__import__("dissect.concepts", fromlist=["tag"]).tag(title, what)),)):
            w.edge(cid, concept[0], "tagged", 2.0)
    for src, dst, kind, why in RELATIONS:
        w.edge(cap_ids[src], cap_ids[dst], kind, attrs={"why": why})
    principle_ids = {k: w.node("principle", k, sub="first-principle", qualname=f"principle:{k}", doc=d) for k, d in PRINCIPLES}
    product = w.node("product", "RE4exa Evidence Engine", sub="merged", qualname="product:re4exa-evidence-engine",
                     doc="Agent-first investigation runtime that merges the strongest separable parts of the ten studied repositories.")
    comp_ids = {}
    for key, doc, caps, principles in COMPONENTS:
        comp_ids[key] = w.node("component", key, sub="product-component", qualname=f"component:{key}", doc=doc)
        w.edge(comp_ids[key], product, "merges_into")
        for c in caps:
            w.edge(cap_ids[c], comp_ids[key], "merges_into")
        for p in principles:
            w.edge(comp_ids[key], principle_ids[p], "satisfies")
    for key, doc, comps in PRODUCT_GAPS:
        gid = w.node("gap", key, sub="product-gap", qualname=f"gap:{key}", doc=doc)
        for c in comps:
            w.edge(gid, comp_ids[c], "gap_in")
    findings = 0
    rea = repos["rea"]
    for line in findings_path.read_text().splitlines():
        if not line.strip():
            continue
        f = json.loads(line)
        fid = w.node("finding", f["id"], sub=f["verdict"], qualname=f"finding:{f['id']}", doc=f["claim"], repo_id=rea,
                     attrs={"severity": f.get("severity"), "stage": f["stage"], "evidence": f.get("evidence")})
        findings += 1
        for concept in __import__("dissect.concepts", fromlist=["tag"]).tag(f["claim"]):
            c = con.execute("select id from node where kind='concept' and name=?", (concept,)).fetchone()
            if c:
                w.edge(fid, c[0], "measures")
    # findings that motivate a component
    motivates = {"E1-1": "C8-interface", "L-caveman-1": "C4-budget", "E3-2": "C3-store", "D-1": "C3-store", "E10-4": "C5-epistemics",
                 "E10-3": "C5-epistemics", "L-strix-1": "C6-coverage", "L-leanrea-1": "C1-probe", "E6-3": "C1-probe", "E2-1": "C1-probe",
                 "L-ponytail-1": "C7-quality-gate", "E8-1": "C2-evidence", "E4-3": "C4-budget", "E4-4": "C3-store", "E3-6": "C1-probe",
                 "E4-1": "C1-probe", "E4-2": "C1-probe", "P-1": "C8-interface"}
    for fkey, comp in motivates.items():
        row = con.execute("select id from node where kind='finding' and name=?", (fkey,)).fetchone()
        if row:
            w.edge(row[0], comp_ids[comp], "motivates")
    con.commit()
    return {"capabilities": len(cap_ids), "relations": len(RELATIONS), "principles": len(PRINCIPLES), "components": len(COMPONENTS),
            "gaps": len(PRODUCT_GAPS), "findings": findings, "unresolved_anchors": unresolved}


QUERIES = {
    "totals": "select (select count(*) from node) nodes, (select count(*) from edge) edges, (select count(*) from repo) repos",
    "entrypoints_per_repo": "select r.name repo, n.sub, count(*) n from node n join repo r on r.id=n.repo_id where n.kind='entrypoint' group by 1,2 order by 1, 3 desc",
    "triggers_per_repo": "select r.name repo, t.sub, count(distinct t.id) n from edge e join node f on f.id=e.src join node t on t.id=e.dst join repo r on r.id=f.repo_id where t.kind='trigger' group by 1,2 order by 1,3 desc",
    "shared_lifecycle_phases": "select l.name phase, count(distinct s.repo_id) repos, group_concat(distinct r.name) which from edge e join node s on s.id=e.src join node l on l.id=e.dst join repo r on r.id=s.repo_id where l.kind='lifecycle' group by 1 order by 2 desc, 1",
    "shared_states": "select n.name state, count(distinct f.repo_id) repos, group_concat(distinct r.name) which from edge e join node n on n.id=e.dst join node f on f.id=e.src join repo r on r.id=f.repo_id where n.kind='state' group by 1 order by 2 desc, 1",
    "signals": "select r.name repo, t.name signal, count(*) files from edge e join node f on f.id=e.src join node t on t.id=e.dst join repo r on r.id=f.repo_id where e.kind='handles_signal' group by 1,2 order by 1",
    "duplicate_contents": "select r.name repo, count(*) files, sum(json_extract(n.attrs,'$.bytes')) bytes from node n join repo r on r.id=n.repo_id where n.kind='file' and json_extract(n.attrs,'$.bytes')>200 and json_extract(n.attrs,'$.sha256') in (select json_extract(attrs,'$.sha256') from node where kind='file' and json_extract(attrs,'$.bytes')>200 group by repo_id, json_extract(attrs,'$.sha256') having count(*)>1) group by 1 order by 3 desc",
    "cross_repo_identical_files": "select json_extract(n.attrs,'$.sha256') sha, count(distinct n.repo_id) repos, group_concat(distinct r.name || ':' || n.path) where_ from node n join repo r on r.id=n.repo_id where n.kind='file' and json_extract(n.attrs,'$.bytes')>500 and json_extract(n.attrs,'$.sha256') is not null group by 1 having repos>1 order by repos desc limit 20",
    "claims_per_repo": "select r.name repo, count(*) claims from node n join repo r on r.id=n.repo_id where n.kind='claim' group by 1 order by 2 desc",
    "most_called_symbols": "select r.name repo, n.qualname, n.path, count(*) callers from edge e join node n on n.id=e.dst join repo r on r.id=n.repo_id where e.kind='calls' group by n.id order by callers desc limit 25",
    "test_to_source_ratio": "select r.name repo, sum(n.sub='test') tests, sum(n.sub='source') sources, round(1.0*sum(n.sub='test')/max(1,sum(n.sub='source')),2) ratio from node n join repo r on r.id=n.repo_id where n.kind='file' group by 1 order by ratio desc",
    "mcp_tool_counts": "select r.name repo, count(*) tools, sum(json_extract(n.attrs,'$.source')='tools/list') exact from node n join repo r on r.id=n.repo_id where n.kind='entrypoint' and n.sub='mcp-tool' group by 1 order by 2 desc",
    "env_vars_per_repo": "select r.name repo, count(distinct t.id) env_vars from edge e join node f on f.id=e.src join node t on t.id=e.dst join repo r on r.id=f.repo_id where e.kind='uses_env' group by 1 order by 2 desc",
    "capability_ranking": "select n.qualname, r.name repo, json_extract(n.attrs,'$.value') value, json_extract(n.attrs,'$.maturity') maturity, json_extract(n.attrs,'$.portability') portability, json_extract(n.attrs,'$.score') score from node n join repo r on r.id=n.repo_id where n.kind='capability' order by score desc",
    "capability_relations": "select a.qualname src, e.kind, b.qualname dst, json_extract(e.attrs,'$.why') why from edge e join node a on a.id=e.src join node b on b.id=e.dst where a.kind='capability' and b.kind='capability'",
    "component_composition": "select c.qualname component, group_concat(cap.qualname, ', ') capabilities from edge e join node cap on cap.id=e.src join node c on c.id=e.dst where cap.kind='capability' and c.kind='component' group by 1",
    "principle_coverage": "select p.qualname principle, count(e.src) components from node p left join edge e on e.dst=p.id and e.kind='satisfies' where p.kind='principle' group by 1",
    "findings_motivating_components": "select f.name finding, f.sub verdict, c.qualname component from edge e join node f on f.id=e.src join node c on c.id=e.dst where e.kind='motivates'",
}


def main() -> None:
    db, findings, out = map(Path, sys.argv[1:4])
    con = connect(db)
    curated = curate(con, findings)
    results = {"curated": curated}
    for name, sql in QUERIES.items():
        results[name] = [dict(r) for r in con.execute(sql)]
    out.write_text(json.dumps(results, indent=1, ensure_ascii=False))
    print(json.dumps({"curated": curated, "queries": list(QUERIES)}, indent=1))


if __name__ == "__main__":
    main()
