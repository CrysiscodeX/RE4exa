"""Concept taxonomy and lexical tagging rules.

Concepts give the dissection a semantic layer that is shared across repositories:
two functions in different languages that both do "checkpointing" meet at the same
concept node. Rules match whole words in split identifiers, paths and first doc
lines; they are deliberately conservative (precision over recall).
"""

from __future__ import annotations

import re

# concept -> (domain, description, regex over normalized text)
CONCEPTS: dict[str, tuple[str, str, str]] = {
    # Reverse engineering and analysis
    "binary-analysis": ("analysis", "Native binary formats, disassembly, decompilation", r"\b(elf|pe32|mach ?o|macho|disassembl\w*|decompil\w*|objdump|ghidra|hopper|ida|rizin|radare\w*|pseudocode|xrefs?|opcode\w*|dwarf|symbols? table)\b"),
    "js-static-analysis": ("analysis", "Inert parsing of JavaScript/TypeScript bundles and apps", r"\b(babel|bundles?|webpack|rollup|rolldown|esbuild|source ?maps?|asar|electron|minif\w*|unminif\w*)\b"),
    "runtime-observation": ("analysis", "Observing running programs: CDP, inspectors, captures, instrumentation", r"\b(cdp|devtools|inspector|playwright|puppeteer|frida|instrument\w*|pty|capture\w*|observe\w*|observation\w*)\b"),
    "artifact-inventory": ("analysis", "Inventories of archives and packages", r"\b(inventor\w*|archives?|zip|apk|ipa|dmg|tarball|occurrences?)\b"),
    "network-traffic": ("analysis", "Recorded network traffic and HTTP interception", r"\b(pcap|har|tshark|mitm\w*|qlog|saz|proxy|intercept\w*)\b"),
    "managed-code": ("analysis", ".NET/JVM managed code metadata", r"\b(dotnet|cil|msil|clr|nativeaot|jvm|bytecode|dex)\b"),
    "decompiler-bridge": ("analysis", "Bridges into external analysis engines", r"\b(bridge|headless|analyzeheadless|engine bridge)\b"),
    # Evidence and epistemics
    "evidence-provenance": ("epistemics", "Evidence records, provenance, content addressing, ledgers", r"\b(evidence|provenance|ledger|attest\w*|content ?address\w*|digest)\b"),
    "confidence-calibration": ("epistemics", "Confidence values, calibration, proper scoring", r"\b(calibrat\w*|confidence|brier|ece|temperature|probabilit\w*|reliabilit\w*|scoring rules?|proper reward)\b"),
    "abstention-unknowns": ("epistemics", "Explicit unknowns, abstention, low-confidence gates", r"\b(unknowns?|abstain\w*|abstention|min confidence|low confidence|residual)\b"),
    "verification": ("epistemics", "Verifying results against references, parity, reconstruction", r"\b(verif\w*|fidelity|parity|reconstruct\w*|golden|oracle|reproduc\w*)\b"),
    "coverage-accounting": ("epistemics", "Coverage and completeness accounting", r"\b(coverage|completeness|unaccounted|complete within)\b"),
    "deduplication": ("epistemics", "Deduplicating findings or records", r"\b(dedup\w*|duplicates?)\b"),
    # Durability and state
    "durable-execution": ("durability", "Checkpointed, resumable, idempotent execution", r"\b(durable|checkpoints?|resum\w*|replay\w*|idempoten\w*|leases?|claim\w*)\b"),
    "retry-backoff": ("durability", "Retries, attempts and backoff", r"\b(retr(y|ies)\w*|backoff|attempts?)\b"),
    "queue-scheduling": ("durability", "Queues, workers, schedules, cron", r"\b(queues?|schedul\w*|cron|workers?|sleep until|wake\w*)\b"),
    "events-signals": ("durability", "Events, emitters, listeners and OS signals", r"\b(events?|emit\w*|listeners?|sig(term|int|hup|kill)|signals?)\b"),
    "storage": ("durability", "Databases and persisted storage", r"\b(sqlite|postgres\w*|sql|jsonl|database|migrat\w*|storage)\b"),
    "lifecycle-cleanup": ("durability", "Resource lifecycles: open/close, cleanup, shutdown", r"\b(cleanup|shutdown|teardown|dispose|close|drain)\b"),
    # Agents and LLMs
    "mcp": ("agents", "Model Context Protocol servers and clients", r"\b(mcp|model context protocol|call ?tool|register ?tool|tools list)\b"),
    "agent-skill": ("agents", "Agent skills, prompts, rules files and plugins", r"\b(skills?|prompts?|rules files?|plugins?|slash commands?)\b"),
    "agent-orchestration": ("agents", "Agents, subagents, multi-agent graphs, delegation", r"\b(agents?|subagents?|orchestrat\w*|multi agent|delegat\w*|harness)\b"),
    "context-budget": ("agents", "Context windows, budgets, truncation and compaction", r"\b(context|compaction|compact\w*|budgets?|truncat\w*|tokens?)\b"),
    "output-compression": ("agents", "Compressing tool output or prompts", r"\b(compress\w*|shrink\w*|elision|elide\w*|toon|terse)\b"),
    "model-routing": ("agents", "Routing requests to models or handlers", r"\b(rout(er|ing)|model select\w*|effort)\b"),
    "llm-provider": ("agents", "LLM provider clients", r"\b(openai|anthropic|claude|gemini|litellm|llm|vllm)\b"),
    "typed-decisions": ("agents", "Typed classification decisions with probabilities", r"\b(classif\w*|typed decisions?|choice|noul|label\w*)\b"),
    "model-training": ("ml", "Training and fine-tuning", r"\b(lora|fine ?tun\w*|train\w*|unsloth|grpo|reinforce|reward)\b"),
    "on-device-inference": ("ml", "On-device and optimized inference", r"\b(coreml|ane|neural engine|mlx|quantiz\w*|onnx|fp16|palette)\b"),
    "telemetry": ("ops", "Usage telemetry, spans and metrics", r"\b(telemetry|posthog|analytics|spans?|metrics?)\b"),
    # Engineering quality
    "testing": ("quality", "Tests, fixtures and test runners", r"\b(tests?|vitest|pytest|fixtures?|mocks?)\b"),
    "mutation-testing": ("quality", "Mutation testing", r"\b(stryker|mutation|mutants?)\b"),
    "benchmarking": ("quality", "Benchmarks and performance measurement", r"\b(bench\w*|latency|throughput|p50|p99|percentiles?)\b"),
    "code-review": ("quality", "Code review, audits, debt and necessity checks", r"\b(review\w*|audit\w*|lint\w*|debt|shortcut|necessity|yagni)\b"),
    "security-testing": ("security", "Security testing and vulnerability findings", r"\b(vulnerab\w*|pentest\w*|exploit\w*|xss|sqli|ssrf|csrf|cve|owasp|cvss)\b"),
    "isolation": ("security", "Sandboxes, containers, resource limits, isolation", r"\b(sandbox\w*|docker|container\w*|isolat\w*|namespaces?|prlimit|job objects?)\b"),
    "process-supervision": ("ops", "Owning, supervising and killing child processes", r"\b(spawn\w*|child process\w*|subprocess\w*|pid|kill\w*|ownership|supervis\w*)\b"),
    "setup-config": ("ops", "Setup, installation, doctor checks, configuration", r"\b(setup|install\w*|doctor|onboard\w*|config\w*)\b"),
    "cli": ("interface", "Command-line interfaces", r"\b(cli|commands?|argv|subcommands?|argparse|typer|click|cobra|incur)\b"),
    "http-api": ("interface", "HTTP servers and APIs", r"\b(http|endpoints?|fastapi|express|rest|webhooks?)\b"),
    "ui": ("interface", "Terminal or web user interfaces", r"\b(tui|dashboard|viewer|ui|react|component)\b"),
}

_COMPILED = {k: re.compile(v[2], re.I) for k, v in CONCEPTS.items()}
_CAMEL = re.compile(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])")


def normalize(*parts: str | None) -> str:
    """Split identifiers and paths into lower-case words."""
    text = " ".join(p for p in parts if p)
    text = _CAMEL.sub(" ", text)
    return re.sub(r"[_\-./\\:#@`'\"(){}\[\],;]+", " ", text).lower()


def tag(*parts: str | None) -> list[str]:
    text = normalize(*parts)
    return [k for k, rx in _COMPILED.items() if rx.search(text)]
