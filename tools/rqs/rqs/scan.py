"""One inert pass over a repository: inventory, manifests, CI text, git metadata and pattern signals.

Nothing in the target is executed. A signal that is absent means "not found in the scanned
files"; the scan reports what it skipped (vendored trees, binaries, large and generated files)
so that absence can be weighed rather than read as a negative.
"""

from __future__ import annotations

import fnmatch
import hashlib
import json
import os
import re
import subprocess
import tomllib
from pathlib import Path

SKIP_DIRS = {".git", "node_modules", "bower_components", "vendor", "third_party", "third-party", ".repos", "dist", "build",
             "target", ".venv", "venv", "__pycache__", ".tox", ".nox", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".next",
             ".nuxt", ".svelte-kit", ".turbo", ".cache", "coverage", ".gradle", "Pods", "DerivedData", ".expo", ".parcel-cache",
             "site-packages", ".yarn", ".pnpm-store", "jspm_packages", ".dart_tool", ".terraform"}
LANG = {".py": "Python", ".pyi": "Python", ".js": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript", ".jsx": "JavaScript",
        ".ts": "TypeScript", ".tsx": "TypeScript", ".mts": "TypeScript", ".cts": "TypeScript", ".go": "Go", ".rs": "Rust",
        ".java": "Java", ".kt": "Kotlin", ".kts": "Kotlin", ".swift": "Swift", ".c": "C", ".h": "C", ".cc": "C++", ".cpp": "C++",
        ".cxx": "C++", ".hpp": "C++", ".hh": "C++", ".m": "Objective-C", ".mm": "Objective-C", ".cs": "C#", ".rb": "Ruby",
        ".php": "PHP", ".sh": "Shell", ".bash": "Shell", ".zsh": "Shell", ".ps1": "PowerShell", ".lua": "Lua", ".dart": "Dart",
        ".scala": "Scala", ".ex": "Elixir", ".exs": "Elixir", ".zig": "Zig", ".vue": "Vue", ".svelte": "Svelte", ".astro": "Astro",
        ".html": "HTML", ".htm": "HTML", ".sql": "SQL", ".java.txt": "Java"}
DOC_EXT = {".md", ".mdx", ".rst", ".txt", ".adoc", ".org"}
CONFIG_EXT = {".json", ".jsonc", ".json5", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".xml", ".gradle", ".properties", ".env", ".lock"}
CONFIG_NAMES = {"Dockerfile", "Makefile", "Justfile", "justfile", "Containerfile", "Procfile", "Gemfile", "Rakefile", "Brewfile",
                "Vagrantfile", "Jenkinsfile", ".gitignore", ".gitattributes", ".editorconfig", ".npmrc", ".nvmrc", ".prettierrc",
                ".eslintrc", "CODEOWNERS", "go.mod", "go.sum", "Package.swift"}
LOCKFILES = {"package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb", "Cargo.lock",
             "go.sum", "poetry.lock", "uv.lock", "Pipfile.lock", "pdm.lock", "Gemfile.lock", "composer.lock", "Package.resolved",
             "gradle.lockfile", "flake.lock", "deno.lock", "pixi.lock", "conda-lock.yml", "mix.lock", "pubspec.lock"}
TEST_RE = re.compile(r"(^|/)(tests?|__tests__|spec|specs|testing|testdata|test-data|fixtures?|e2e|integration[-_]tests?|testkit)(/|$)"
                     r"|[._-](test|spec|tests|e2e)\.[a-z0-9]+$|(^|/)test_[^/]+\.py$|_test\.(go|py|rs|exs?)$|(^|/)[A-Za-z0-9]*Tests?/|(^|/)src/test/", re.I)
EXAMPLE_RE = re.compile(r"(^|/)(examples?|samples?|demos?|playground|cookbook|tutorials?)(/|$)", re.I)
GEN_RE = re.compile(r"\.min\.(js|css)$|\.map$|(^|/)_?generated(/|$)|\.gen\.[a-z]+$|\.pb\.go$|_pb2\.py$|\.generated\.|(^|/)gen/", re.I)
CONFIG_KEEP = re.compile(r"(^|/)(Dockerfile[^/]*|Containerfile|[^/]*compose[^/]*\.ya?ml|\.pre-commit-config\.yaml|renovate[^/]*\.json5?|\.renovaterc[^/]*|"
                         r"dependabot\.ya?ml|tsconfig[^/]*\.json|\.npmrc|Makefile|[Jj]ustfile|mypy\.ini|pyrightconfig\.json|setup\.cfg|tox\.ini|\.gitignore)$")
MAX_FILE = 1_000_000
MAX_TOTAL = 400_000_000
MAX_LOCS = 8

# name -> (file kinds, lowercase anchors (any must occur), regex, regex flags)
SIGNALS: dict[str, tuple[set, list, str, int]] = {
    # risky operations (hints for review; reachability decides severity)
    "dyn_eval": ({"code"}, ["eval", "exec", "function"], r"(?<![\w.$])(?:eval|exec)\s*\(|\bnew\s+Function\s*\(", 0),
    "shell_true": ({"code"}, ["shell"], r"shell\s*[=:]\s*[Tt]rue", 0),
    "os_system": ({"code"}, ["os.system", "os.popen"], r"\bos\.(?:system|popen)\s*\(", 0),
    "exec_template": ({"code"}, ["exec"], r"\bexec(?:Sync)?\s*\(\s*`", 0),
    "sh_c": ({"code"}, ['"-c"', "'-c'"], r"""["'](?:ba|z)?sh["']\s*,\s*["']-c["']""", 0),
    "sql_concat": ({"code"}, ["execute", "query", "raw(", "prepare", "exec("],
                   r"""\.(?:execute|executemany|executescript)\s*\(\s*f["']|\.(?:execute|query|raw|prepare|exec)\s*\(\s*`[^`]*\$\{|"""
                   r"""\.(?:execute|query|raw|prepare)\s*\(\s*["'][^"'\n]*\b(?:select|insert|update|delete|create|drop|alter)\b[^"'\n]*["']\s*(?:\+|%\s|\.format\()""", re.I),
    "inner_html": ({"code"}, ["innerhtml", "v-html", "{@html"], r"\.innerHTML\s*=|dangerouslySetInnerHTML|\bv-html\b|\{@html", 0),
    "rust_unsafe": ({"rust"}, ["unsafe"], r"\bunsafe\s*\{", 0),
    "tls_off": ({"code", "config", "ci", "script"}, ["rejectunauthorized", "node_tls_reject_unauthorized", "verify", "_create_unverified_context",
                "danger_accept_invalid_certs", "--insecure", "curl", "strict-ssl"],
                r"rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=?\s*['\"]?0|verify\s*=\s*False|InsecureSkipVerify\s*:\s*true|"
                r"_create_unverified_context|CURLOPT_SSL_VERIFYPEER\s*,\s*(?:0|false)|danger_accept_invalid_certs|--insecure\b|\bcurl\s+-k\b|strict-ssl\s*[=:]\s*false", 0),
    "unsafe_deser": ({"code"}, ["pickle", "marshal.load", "yaml.load", "torch.load", "joblib.load", "objectinputstream", "unserialize", "node-serialize", "dill.load"],
                     r"\bpickle\.loads?\s*\(|\bmarshal\.loads?\s*\(|\byaml\.load\s*\((?![^)\n]*Loader\s*=\s*(?:yaml\.)?C?SafeLoader)|"
                     r"\btorch\.load\s*\((?![^)\n]*weights_only\s*=\s*True)|\bjoblib\.load\s*\(|\bObjectInputStream\b|\bunserialize\s*\(|node-serialize|\bdill\.loads?\s*\(", 0),
    "remote_pipe": ({"doc", "script", "ci", "code"}, ["curl", "wget", "iwr", "irm", "invoke-webrequest", "invoke-restmethod"],
                    r"(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b|(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^\n|]*\|\s*(?:iex|Invoke-Expression)", re.I),
    "checksum_verify": ({"script", "ci", "doc"}, ["sha256sum", "shasum", "cosign", "minisign", "gpg", "slsa-verifier", "attestation verify"],
                        r"sha(?:256|512)sum\s+(?:-c|--check)\b|shasum\s+(?:-a\s*\d+\s+)?(?:-c|--check)\b|cosign\s+verify|minisign\s+-V|gpg\s+--verify|slsa-verifier\s+verify|gh\s+attestation\s+verify", re.I),
    # agents and LLMs
    "llm_sdk": ({"code"}, ["openai", "anthropic", "claude_agent_sdk", "genai", "ollama", "litellm", "langchain", "llama_index", "transformers", "vllm",
                 "mlx", "coremltools", "onnxruntime", "ai-sdk", "@openai/agents", "llama_cpp", "llama-cpp"],
                r"""(?:from|import)\s+['"]?(?:openai|anthropic|@anthropic-ai/[\w-]+|claude_agent_sdk|google\.genai|@google/genai|ollama|litellm|langchain[\w.-]*|"""
                r"""llama_index|transformers|vllm|mlx(?:_lm)?|coremltools|onnxruntime|@openai/agents|@ai-sdk/[\w-]+|llama_cpp)\b|require\(\s*['"](?:openai|@anthropic-ai/sdk|ollama)['"]""", 0),
    "model_names": ({"code", "config", "doc"}, ["gpt-", "claude-", "gemini-", "qwen", "llama", "mistral", "deepseek", "grok-", "kimi", "glm-", "o3-", "o4-"],
                    r"\b(?:gpt-[45][\w.-]*|o[34]-mini|claude-[a-z0-9][\w.-]+|gemini-[\w.-]+|qwen[\w.:-]*|llama-?[234][\w.:-]*|mistral[\w.-]*|deepseek[\w.-]*|grok-[\w.-]+|kimi[\w.-]*|glm-[\w.-]+)\b", re.I),
    "mcp_server": ({"code", "config"}, ["modelcontextprotocol", "mcpserver", "fastmcp", "from mcp", "import mcp", "tools/list", "tools/call", "rmcp", "mcp-go"],
                   r"@modelcontextprotocol/sdk|\bMcpServer\b|\bFastMCP\b|^\s*(?:from|import)\s+mcp\b|['\"]tools/list['\"]|['\"]tools/call['\"]|\brmcp::|mark3labs/mcp-go|modelcontextprotocol/go-sdk", re.M),
    "mcp_tool_def": ({"code"}, [".tool", "registertool", "addtool", "inputschema"],
                     r"""\.(?:tool|registerTool|addTool)\s*\(\s*['"`]|@(?:mcp|server|app)\.tool\b|["']?inputSchema["']?\s*:""", 0),
    "a2a": ({"code", "config", "doc"}, ["agent-card", "agent.json", "well-known/agent", "a2a-sdk", "@a2a-js", "a2a.types", "a2aserver", "agentcard"],
            r"agent-card|well-known/agent(?:-card)?\.json|a2a-sdk|@a2a-js|a2a\.types|A2AServer|\bAgentCard\b", 0),
    "openapi": ({"code", "config"}, ["fastapi(", "swagger", "utoipa", "openapi", "springdoc", "drf-spectacular"],
                r"FastAPI\(|@nestjs/swagger|\butoipa\b|swagger-ui|^openapi:\s*['\"]?3|\"openapi\"\s*:\s*\"3|springdoc|drf-spectacular|fastify-swagger|zod-openapi|@hono/zod-openapi", re.M),
    "json_flag": ({"code", "doc"}, ["--json", "--format", "--output", "-o json", "--jsonl", "ndjson"],
                  r"--json\b|--format[= ]json\b|--output[= ]json\b|-o json\b|--jsonl\b|\bndjson\b", 0),
    "describe_cmd": ({"code", "doc"}, ["describe", "schema", "capabilities", "help-json", "llms.txt", "llms-full", ".well-known"],
                     r"""(?:add_parser|\bsub|\badd)\(\s*['"](?:describe|schema|capabilities)['"]|\.command\(\s*['"](?:describe|schema|capabilities)\b|\bdef (?:cmd_)?describe\s*\(|"""
                     r"""--help[- ]json|llms(?:-full)?\.txt|\.well-known/(?:mcp|agent|ai-plugin)""", 0),
    "error_codes": ({"code"}, ["code", "error", "exception"], r"""["']?\bcode["']?\s*:\s*["'][A-Za-z][A-Za-z0-9_.]{3,}["']|\bclass\s+\w+(?:Error|Exception)\b|\bTaggedError\b|\bErrorCode\b""", 0),
    "mcp_is_error": ({"code"}, ["iserror"], r"\bisError\b", 0),
    "approval": ({"code", "doc"}, ["approv", "permission", "confirm(", "ask_user", "human", "dry-run", "dry_run", "dryrun", "readonlyhint", "destructivehint"],
                 r"\b(?:approval|approve|requireApproval|requiresApproval|needsApproval|permission[_ ]?mode|confirm\(|ask_user|human[-_ ]in[-_ ]the[-_ ]loop|dry[-_]?run|readOnlyHint|destructiveHint)\b", re.I),
    "budget": ({"code"}, ["max_tokens", "maxtokens", "maxturns", "max_turns", "max_steps", "maxsteps", "budget", "cost", "rate_limit", "ratelimit", "max_iterations", "maxiterations", "usage."],
               r"\b(?:max_?tokens|maxTokens|max_?turns|maxTurns|max_?steps|maxSteps|token_?budget|tokenBudget|cost_?limit|costLimit|budget|rate_?limit|rateLimit|max_?iterations|usage\.(?:input|output)_tokens)\b", 0),
    "injection_defense": ({"code", "doc"}, ["injection", "untrusted", "not instructions", "spotlight", "sanitiz", "jailbreak"],
                          r"prompt[- ]injection|untrusted[_ -](?:content|input|data|text)|data,? not instructions|spotlighting|<untrusted|sanitiz(?:e|ation)|jailbreak", re.I),
    "isolation": ({"code", "config", "doc", "ci"}, ["seccomp", "landlock", "bubblewrap", "bwrap", "firejail", "gvisor", "runsc", "firecracker", "nsjail", "sandbox",
                   "appcontainer", "wasmtime", "isolated-vm", "docker", "podman", "cap_drop", "no-new-privileges"],
                  r"\b(?:seccomp|landlock|bubblewrap|bwrap|firejail|gvisor|runsc|firecracker|nsjail|sandbox(?:-exec|ing)?|AppContainer|wasmtime|isolated-vm|docker|podman|cap_drop|no-new-privileges)\b", re.I),
    # durability and reliability
    "checkpoint": ({"code"}, ["checkpoint", "resum", "journal", "write-ahead", "snapshot", "idempoten", "outbox", "lease", "replay", "durable"],
                   r"\b(?:checkpoint\w*|resum(?:e|able)|journal|write-ahead|snapshot\w*|idempoten\w+|outbox|lease[sd]?|replay\w*|durable)\b", re.I),
    "storage": ({"code", "config"}, ["sqlite", "postgres", "psycopg", "asyncpg", "redis", "leveldb", "rocksdb", "lmdb", "duckdb", "indexeddb", "dexie", "mongo", "prisma", "drizzle", "sqlx"],
                r"\b(?:sqlite3?|better-sqlite3|node:sqlite|bun:sqlite|rusqlite|sqlx|postgres(?:ql)?|psycopg\w*|asyncpg|redis|ioredis|leveldb|rocksdb|lmdb|duckdb|indexedDB|dexie|mongodb|mongoose|prisma|drizzle-orm)\b", re.I),
    "wal_pragma": ({"code"}, ["journal_mode"], r"journal_mode\s*=\s*'?WAL", re.I),
    "retry": ({"code"}, ["retr", "backoff", "exponential", "jitter", "circuit", "tenacity"], r"\b(?:retry\w*|retries|backoff|exponential|jitter|circuit[_ ]?breaker|tenacity)\b", re.I),
    "signals": ({"code"}, ["sigterm", "sigint", "signal.signal", "process.on", "tokio::signal", "signal.notify", "atexit", "graceful", "abortcontroller", "abortsignal"],
                r"SIGTERM|SIGINT|signal\.signal|process\.on\(\s*['\"](?:exit|beforeExit)|tokio::signal|signal\.Notify|\batexit\b|graceful[_ -]?shutdown|AbortController|AbortSignal", 0),
    # epistemics
    "provenance_fields": ({"code"}, ["sha256", "digest", "provenance", "evidence", "content-address", "content_address", "content address", "blake3"],
                          r"\b(?:sha256|digest|provenance|evidence_?id|evidence|content[-_ ]address\w*|blake3)\b", re.I),
    "uncertainty": ({"code"}, ["confidence", "probabilit", "calibrat", "brier", "ece", "abstain", "uncertain"],
                    r"\b(?:confidence|probabilit\w+|calibrat\w+|brier|ECE|abstain\w*|uncertain\w*)\b", re.I),
    "coverage_fields": ({"code"}, ["limitation", "unaccounted", "not_found", "unknown", "skipped"], r"\b(?:limitations?|unaccounted|not_found|unknown|skipped)\b", 0),
    # operability
    "doctor": ({"code", "doc"}, ["doctor", "healthcheck", "health", "self-check", "selfcheck", "diagnos"],
               r"""['"](?:doctor|healthcheck|health|self-?check|diagnose|diagnostics)['"]|/healthz?\b|\bdoctor\b""", re.I),
    "struct_log": ({"code", "config"}, ["pino", "winston", "bunyan", "structlog", "loguru", "zerolog", "zap.", "slog", "tracing", "log4j", "logback", "serilog", "json-logger", "jsonformatter", "log_level", "rust_log"],
                   r"\b(?:pino|winston|bunyan|structlog|loguru|zerolog|zap\.|slog\.|tracing::|tracing_subscriber|log4j|logback|serilog|python-json-logger|JSONFormatter)\b|LOG_LEVEL|RUST_LOG", 0),
    "otel": ({"code", "config"}, ["opentelemetry", "otel_", "gen_ai."], r"opentelemetry|OTEL_[A-Z_]+|\bgen_ai\.", re.I),
    "env_read": ({"code"}, ["process.env", "os.environ", "getenv", "env::var", "deno.env", "import.meta.env", "bun.env"],
                 r"""process\.env\.([A-Z][A-Z0-9_]{2,})|process\.env\[\s*['"]([A-Z][A-Z0-9_]{2,})['"]|os\.environ(?:\.get)?\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]|"""
                 r"""os\.environ\[\s*['"]([A-Z][A-Z0-9_]{2,})['"]|os\.getenv\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]|env::var\(\s*"([A-Z][A-Z0-9_]{2,})"|"""
                 r"""os\.Getenv\(\s*"([A-Z][A-Z0-9_]{2,})"|Deno\.env\.get\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]|import\.meta\.env\.([A-Z][A-Z0-9_]{2,})|Bun\.env\.([A-Z][A-Z0-9_]{2,})""", 0),
    # privacy
    "telemetry_lib": ({"code", "config"}, ["posthog", "segment", "analytics-node", "mixpanel", "amplitude", "sentry", "datadog", "dd-trace", "google-analytics", "gtag(",
                       "plausible", "umami", "applicationinsights", "statsig", "rudderstack", "fullstory", "logrocket"],
                      r"\b(?:posthog[\w-]*|@segment/[\w-]+|analytics-node|mixpanel|amplitude|@sentry/[\w-]+|sentry[_-]sdk|dd-trace|datadog|google-analytics|gtag\(|plausible|umami|applicationinsights|statsig|rudderstack|fullstory|logrocket)\b", re.I),
    "telemetry_word": ({"code", "doc"}, ["telemetry", "usage data", "usage statistics", "analytics"], r"\btelemetry\b|usage (?:data|statistics)|\banalytics\b", re.I),
    "telemetry_optout": ({"code", "doc", "config"}, ["telemetry", "opt-out", "opt out", "optout"],
                         r"(?:DISABLE|NO|DO_NOT)_?TELEMETRY|TELEMETRY_(?:DISABLED?|ENABLED|OPT_?OUT)|--no-telemetry|telemetry\s*[:=]\s*(?:false|off|0)|opt[- ]?out", re.I),
    "dnt": ({"code", "doc"}, ["do_not_track"], r"DO_NOT_TRACK", 0),
    "offline": ({"code", "doc", "config"}, ["offline", "local-first", "local first", "air-gap", "airgap", "air gap"],
                r"--offline|\bOFFLINE\b|HF_HUB_OFFLINE|TRANSFORMERS_OFFLINE|local[- ]first|air[- ]?gapped|offline mode|works offline", re.I),
    "net_calls": ({"code"}, ["fetch(", "axios", "requests.", "httpx", "urllib.request", "reqwest", "http.get(", "undici", "got("],
                  r"\bfetch\(|\baxios\.|\brequests\.(?:get|post|put|patch|delete)\(|\bhttpx\.|urllib\.request|reqwest::|http\.Get\(|\bundici\b", 0),
    # cryptography
    "crypto_classical": ({"code", "config"}, ["rsa", "ecdsa", "ed25519", "x25519", "ecdh", "secp256", "p-256", "prime256", "createsign", "createverify", "generatekeypair",
                          "jsonwebtoken", "jwt.", "pyjwt", "hazmat", "ring::", "rustls", "openssl", "sodium", "nacl", "crypto/"],
                         r"\b(?:RSA|ECDSA|Ed25519|X25519|ECDH|secp256[kr]1|P-256|prime256v1|createSign|createVerify|generateKeyPair(?:Sync)?|jsonwebtoken|jwt\.(?:sign|verify)|"
                         r"PyJWT|cryptography\.hazmat|ring::|rustls|openssl|libsodium|tweetnacl|crypto/(?:ecdsa|rsa|ed25519|ecdh|tls))\b", 0),
    "crypto_pqc": ({"code", "config", "doc"}, ["ml-kem", "mlkem", "ml_kem", "kyber", "ml-dsa", "mldsa", "ml_dsa", "dilithium", "slh-dsa", "sphincs", "liboqs", "oqs", "post-quantum", "pqc"],
                   r"ML-KEM|MLKEM|ml_kem|Kyber|ML-DSA|ml_dsa|MLDSA|Dilithium|SLH-DSA|SPHINCS|liboqs|\boqs\b|X25519MLKEM768|X25519Kyber768|post-quantum|\bPQC\b", re.I),
    # interfaces for people
    "a11y_attr": ({"ui"}, ["aria-", "role=", "alt="], r"\baria-[a-z]+=|\brole=|\balt=", 0),
    "a11y_tool": ({"code", "config", "ci", "doc"}, ["axe", "pa11y", "lighthouse", "jsx-a11y", "accessibility", "a11y", "wcag"],
                  r"axe-core|@axe-core/[\w-]+|jest-axe|vitest-axe|pa11y|lighthouse|eslint-plugin-jsx-a11y|vuejs-accessibility|\bWCAG\b", re.I),
    "i18n_lib": ({"code", "config"}, ["i18n", "intl", "formatjs", "lingui", "gettext", "fluent", "paraglide", "polyglot"],
                 r"\b(?:i18next|react-i18next|react-intl|@formatjs/[\w-]+|@lingui/[\w-]+|gettext|ngettext|@fluent/[\w-]+|vue-i18n|next-intl|paraglide|typesafe-i18n|node-polyglot)\b", 0),
    # flags
    "exec_code": ({"code"}, ["child_process", "spawn(", "execfile(", "subprocess", "os.exec", "exec.command", "process::command", "processbuilder", "node-pty", "pty.spawn", "playwright", "puppeteer"],
                  r"child_process|\bspawn\(|\bexecFile\(|\bsubprocess\.|\bos\.exec\w*\(|exec\.Command\(|process::Command|ProcessBuilder|node-pty|pty\.spawn|\bplaywright\b|\bpuppeteer\b", 0),
    "net_server": ({"code"}, ["listen(", "createserver(", "uvicorn", "fastapi(", "flask(", "express()", "hono", "fastify", "axum", "actix", "warp::", "listenandserve", "net.listen",
                    "websocketserver", "ws.server", "bun.serve", "deno.serve"],
                   r"\.listen\(\s*(?:\d|port|PORT)|createServer\(|\buvicorn\b|FastAPI\(|Flask\(|express\(\)|new Hono\b|[Ff]astify\(|\baxum::|actix_web|warp::serve|http\.ListenAndServe|net\.Listen\(|WebSocketServer|ws\.Server|Bun\.serve|Deno\.serve", 0),
    "parse_untrusted": ({"code"}, ["zipfile", "tarfile", "yauzl", "adm-zip", "jszip", "unzipper", "asar", "pefile", "lief", "capstone", "goblin", "html5lib", "beautifulsoup", "cheerio",
                         "jsdom", "parse5", "lxml", "xml2js", "pdf", "exif", "mach-o", "pe32", "gguf", "safetensors"],
                        r"\b(?:zipfile|tarfile|yauzl|adm-zip|jszip|unzipper|@electron/asar|pefile|lief|capstone|goblin|html5lib|BeautifulSoup|cheerio|jsdom|parse5|lxml|xml2js|pdfjs|pdf-parse|PyPDF2?|exifread|"
                        r"Mach-O|PE32|gguf|safetensors)\b", 0),
    "heavy_compute": ({"code", "config"}, ["torch", "tensorflow", "jax", "keras", "onnxruntime", "coremltools", "mlx", "llama", "ggml", "vllm", "transformers", "diffusers", "accelerate", "deepspeed", "cuda", "triton"],
                      r"\b(?:torch|tensorflow|jax|keras|onnxruntime|coremltools|mlx|llama\.cpp|llama_cpp|ggml|vllm|transformers|diffusers|accelerate|deepspeed|cuda|triton)\b", 0),
    "uses_crypto_api": ({"code"}, ["hmac", "cipher", "sign", "encrypt", "decrypt", "verify", "importkey", "fernet", "aesgcm"], r"\b(?:createHmac|createCipheriv|subtle\.(?:sign|encrypt|verify|importKey)|hmac\.new|Fernet|AESGCM|encrypt\(|decrypt\(|\.sign\(|\.verify\()", 0),
    # maintainability tooling (configs, CI, package scripts)
    "rust_test": ({"rust"}, ["#[test]", "#[cfg(test)]", "#[tokio::test]"], r"#\[(?:tokio::)?test\]|#\[cfg\(test\)\]", 0),
    "energy": ({"doc", "code"}, ["energy", "carbon", "co2", "watt", "joule", "kwh", "power draw", "power consumption", "codecarbon", "green software", "sci "],
               r"\b(?:energy|carbon|CO2e?|watts?|joules?|kWh|power (?:draw|consumption)|codecarbon|green software)\b", re.I),
    "spdx_header": ({"code"}, ["spdx-license-identifier"], r"SPDX-License-Identifier:", 0),
    "debt": ({"code"}, ["todo", "fixme", "hack", "xxx"], r"\b(?:TODO|FIXME|HACK|XXX)\b", 0),
    "arch_guard": ({"config", "ci", "code"}, ["dependency-cruiser", "boundaries", "import-linter", "importlinter", "archunit", "enforce-module-boundaries", "madge", "no-restricted-imports", "deptry", "tach"],
                   r"dependency-cruiser|eslint-plugin-boundaries|import-linter|importlinter|ArchUnit|enforce-module-boundaries|\bmadge\b|no-restricted-imports|\bdeptry\b|\btach\b", 0),
    "dupe_tool": ({"config", "ci"}, ["jscpd", "cpd", "simian", "duplicate-code", "sonar"], r"\bjscpd\b|\bcpd\b|\bsimian\b|duplicate-code|sonar-project|sonarqube|sonarcloud", re.I),
    "deadcode_tool": ({"config", "ci"}, ["knip", "ts-prune", "unused-exports", "vulture", "deadcode", "udeps", "depcheck", "unimported", "staticcheck"],
                      r"\bknip\b|ts-prune|ts-unused-exports|\bvulture\b|\bdeadcode\b|cargo[- ]udeps|\bdepcheck\b|\bunimported\b|\bstaticcheck\b", 0),
    "lint_tool": ({"config", "ci"}, ["eslint", "oxlint", "biome", "ruff", "flake8", "pylint", "clippy", "golangci", "staticcheck", "rubocop", "swiftlint", "ktlint", "detekt", "shellcheck",
                   "hadolint", "markdownlint", "stylelint", "deno lint", "vp check"],
                  r"\b(?:eslint|oxlint|biome|ruff|flake8|pylint|clippy|golangci-lint|staticcheck|rubocop|swiftlint|ktlint|detekt|shellcheck|hadolint|markdownlint|stylelint|deno lint|vp check)\b", 0),
    "format_tool": ({"config", "ci"}, ["prettier", "biome", "black", "ruff format", "rustfmt", "cargo fmt", "gofmt", "goimports", "clang-format", "dprint", "swiftformat", "ktfmt", "oxfmt", "yapf", "isort", "deno fmt", "editorconfig"],
                    r"\b(?:prettier|biome (?:format|check)|black|ruff format|rustfmt|cargo fmt|gofmt|goimports|clang-format|dprint|swiftformat|ktfmt|oxfmt|yapf|isort|deno fmt)\b", 0),
    "type_tool": ({"config", "ci"}, ["mypy", "pyright", "pyre", "pytype", "tsc", "typecheck", "type-check", "vue-tsc", "svelte-check", "flow-bin", "sorbet", "ty check", "tsgo"],
                  r"\b(?:mypy|pyright|basedpyright|pyre|pytype|tsc|tsgo|typecheck|type-check|vue-tsc|svelte-check|flow-bin|sorbet|ty check)\b", 0),
    "ts_strict": ({"config"}, ['"strict"'], r'"strict"\s*:\s*true', 0),
    "mypy_strict": ({"config"}, ["strict", "disallow_untyped", "typecheckingmode"], r"^\s*strict\s*=\s*true|disallow_untyped_defs\s*=\s*true|typeCheckingMode\s*[=:]\s*['\"]?strict", re.M | re.I),
    # tests
    "mutation": ({"config", "ci", "doc", "code"}, ["stryker", "mutmut", "mutants", "pitest", "mutation", "cosmic-ray", "mutesting"],
                 r"stryker|\bmutmut\b|cargo-mutants|\bpitest\b|mutation[- ]test\w*|cosmic-ray|go-mutesting", re.I),
    "property": ({"code", "config"}, ["hypothesis", "fast-check", "fc.", "proptest", "quickcheck", "jqwik", "testing/quick", "gopter", "rapid.", "@given"],
                 r"\bhypothesis\b|fast-check|\bfc\.(?:assert|property)\(|\bproptest!?|quickcheck|jqwik|testing/quick|gopter|rapid\.Check|@given\(", 0),
    "fuzz": ({"code", "config", "ci", "doc"}, ["fuzz", "atheris", "jazzer", "llvmfuzzer", "oss-fuzz", "clusterfuzz", "afl++", "honggfuzz"],
             r"cargo[- ]fuzz|fuzz_target!|\batheris\b|\bjazzer\b|func Fuzz\w*\(|LLVMFuzzerTestOneInput|go-fuzz|oss-fuzz|clusterfuzzlite|\bfuzz(?:ing|er)\b|libfuzzer|honggfuzz|AFL\+\+", re.I),
    "bench": ({"code", "config", "ci", "doc"}, ["bench", "criterion::", "hyperfine", "tinybench", "divan", "asv"],
              r"\bbench(?:mark)?(?:s|ing)?\b|criterion::|func Benchmark\w*\(|pytest-benchmark|hyperfine|vitest bench|tinybench|benchmark\.js|\bdivan\b", re.I),
    "golden": ({"code"}, ["golden", "snapshot", "answer_key", "answer-key", "answer key", "expected_output", "expected-output", "expected output", "fixture", "replay", "insta::", "approvaltests"],
               r"\bgolden\b|toMatchSnapshot|toMatchInlineSnapshot|insta::assert|approvaltests|answer[_ -]key|expected[_ -]output|\bfixtures?\b|\breplay\w*", re.I),
    "e2e": ({"config", "ci", "code"}, ["playwright", "cypress", "webdriver", "selenium", "puppeteer", "detox", "maestro", "e2e", "end-to-end"],
            r"@playwright/test|\bcypress\b|webdriverio|\bselenium\b|\bdetox\b|\bmaestro\b|\be2e\b|end-to-end", re.I),
    "test_cmd": ({"ci"}, ["test", "pytest", "unittest", "nextest", "vitest", "jest", "mocha", "verify", "ctest", "tox", "nox", "bats"],
                 r"\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\bpytest\b|python3?\s+-m\s+(?:unittest|pytest)|cargo\s+(?:test|nextest)|\bgo\s+test\b|\bvitest\b|\bjest\b|\bmocha\b|"
                 r"mvn\b[^\n]*\b(?:test|verify)\b|gradlew?\b[^\n]*\btest\b|swift\s+test|xcodebuild\b[^\n]*\btest\b|make\s+test|\bctest\b|\btox\b|\bnox\b|deno\s+test|vp\s+test|turbo\s+(?:run\s+)?test|\bbats\b|(?:pnpm|npm|yarn|bun)\s+run\s+[\w:-]*test", 0),
    # supply chain and release
    "provenance_ci": ({"ci", "config"}, ["provenance", "attest", "slsa", "cosign", "sigstore", "trusted", "pypi-publish", "id-token"],
                      r"--provenance|attest-build-provenance|actions/attest|slsa-github-generator|slsa-framework|\bcosign\b|sigstore|gh attestation|trusted[- ]publish\w*|pypa/gh-action-pypi-publish|\"provenance\"\s*:\s*true", re.I),
    "id_token": ({"ci"}, ["id-token"], r"id-token:\s*write", 0),
    "sbom": ({"ci", "config", "doc"}, ["syft", "cyclonedx", "spdx", "sbom", "cdxgen", "vex", "csaf"], r"\bsyft\b|cyclonedx|\bspdx(?:-|\b)|anchore/sbom-action|cdxgen|\bsbom\b|\bvex\b|openvex|csaf", re.I),
    "scans": ({"ci", "config"}, ["codeql", "semgrep", "gitleaks", "trufflehog", "trivy", "grype", "osv-scanner", "audit", "snyk", "dependency-review", "scorecard", "zizmor", "bandit",
               "gosec", "socket", "detect-secrets", "ggshield", "secretlint", "govulncheck", "cargo-deny", "cargo deny"],
              r"codeql|semgrep|gitleaks|trufflehog|\btrivy\b|\bgrype\b|osv-scanner|(?:npm|pnpm|yarn|bun) audit|pip-audit|cargo[- ](?:audit|deny)|govulncheck|\bsnyk\b|dependency-review-action|"
              r"scorecard|\bzizmor\b|\bbandit\b|\bgosec\b|socket(?:\.dev|-security)|detect-secrets|ggshield|secretlint", re.I),
    "secret_scan": ({"ci", "config"}, ["gitleaks", "trufflehog", "detect-secrets", "ggshield", "secretlint", "secret-scanning", "secret scanning"],
                    r"gitleaks|trufflehog|detect-secrets|ggshield|secretlint|secret[- ]scanning", re.I),
    "release_auto": ({"ci", "config"}, ["semantic-release", "changeset", "release-please", "goreleaser", "cargo-dist", "electron-builder", "action-gh-release", "gh release", "publish",
                      "twine", "tauri-action", "release-it"],
                     r"semantic-release|changesets/action|@changesets/cli|release-please|goreleaser|cargo-dist|electron-builder|softprops/action-gh-release|gh release create|"
                     r"(?:npm|pnpm|yarn|bun) publish|twine upload|uv publish|cargo publish|tauri-action|release-it|changeset publish|gh-action-pypi-publish", 0),
    # documentation
    "semver_word": ({"doc", "config"}, ["semver", "semantic versioning", "keep a changelog", "keepachangelog", "breaking change"],
                    r"semver|semantic versioning|keepachangelog|keep a changelog|breaking change", re.I),
    "support_policy": ({"doc"}, ["supported versions", "end of life", "end-of-life", "eol", "lts", "long-term support", "long term support", "support period", "security update", "security fix"],
                       r"supported versions|end[- ]of[- ]life|\bEOL\b|\bLTS\b|long[- ]term support|support period|security (?:updates?|fixes) (?:are|will be) (?:provided|released)", re.I),
    "platform_words": ({"doc"}, ["macos", "windows", "linux", "arm64", "aarch64", "x86_64", "amd64", "apple silicon", "freebsd", "wsl", "android", "ios"],
                       r"\b(?:macOS|Windows|Linux|arm64|aarch64|x86_64|amd64|Apple Silicon|FreeBSD|WSL2?|Android|iOS)\b", 0),
    "compliance_words": ({"doc"}, ["cyber resilience", "cra", "ai act", "vpat", "accessibility statement", "conformity", "gdpr", "hipaa", "soc 2", "soc2", "iso 27001", "iso27001", "fedramp", "section 508", "en 301 549"],
                         r"Cyber Resilience Act|\bCRA\b|\bAI Act\b|\bVPAT\b|accessibility statement|declaration of conformity|\bGDPR\b|\bHIPAA\b|SOC ?2|ISO ?27001|FedRAMP|section 508|EN 301 549", re.I),
    "threat_model": ({"doc"}, ["threat model", "threat-model", "attack surface", "trust boundar", "security model", "stride"],
                     r"threat[- ]model\w*|attack surface|trust boundar\w+|security model|\bSTRIDE\b", re.I),
    "ai_disclosure": ({"doc"}, ["ai-assisted", "ai assisted", "ai-generated", "ai generated", "generated by", "generated with", "coding agent", "llm-generated", "llm generated", "use of ai", "ai policy",
                       "ai contribution", "agent-authored", "agent authored"],
                      r"AI[- ]assisted|AI[- ]generated|generated (?:by|with) (?:AI|an LLM|Claude|Copilot|ChatGPT|Codex)|coding agents?|LLM[- ]generated|use of AI|AI policy|AI contributions?|agent[- ]authored", re.I),
    "claims_numeric": ({"doc"}, list("0123456789"),
                       r"(?:\b\d+(?:\.\d+)?\s?(?:%|x\b|×|times\b)|\b\d+(?:\.\d+)?\s?(?:ms|s|sec|seconds|minutes|MB|GB|KB|tokens|k tokens)\b)[^.\n]{0,60}?\b(?:faster|slower|fewer|less|more|smaller|"
                       r"reduction|reduces?|reduced|saves?|saving|cheaper|improve\w*|better|accuracy|accurate|lower|higher|speedup|compression|compressed)\b|"
                       r"\b(?:faster|fewer|less|reduc\w+|saves?|cuts?|cheaper|smaller|lower|beats?|outperforms?|drops?|shrinks?|trims?)\b[^.\n]{0,40}?\b\d+(?:\.\d+)?\s?(?:%|x\b|×|times)", re.I),
    "claims_superlative": ({"doc"}, ["fastest", "best", "world", "blazing", "revolutionary", "state-of-the-art", "state of the art", "unmatched", "unparalleled", "lightning", "zero-cost", "10x", "100x",
                           "game-chang", "game chang", "industry-leading", "industry leading", "most powerful", "most advanced"],
                           r"\b(?:fastest|best[- ]in[- ]class|world'?s (?:first|best|fastest)|blazing(?:ly)?[- ]fast|revolutionary|state[- ]of[- ]the[- ]art|unmatched|unparalleled|lightning[- ]fast|"
                           r"10x|100x|game[- ]chang\w+|industry[- ]leading|most (?:powerful|advanced))\b", re.I),
    "bench_ref": ({"doc"}, ["benchmark", "bench/", "reproduc", "methodology", "result"], r"\bbenchmark\w*|\bbench/|\breproduc\w+|\bmethodology\b|results?\.(?:json|csv|md)\b", re.I),
}

SECRET_PATTERNS = [
    ("aws_access_key", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"), ["akia", "asia"]),
    ("github_token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b"), ["ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_"]),
    ("slack_token", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"), ["xox"]),
    ("stripe_live_key", re.compile(r"\b[sr]k_live_[A-Za-z0-9]{20,}"), ["_live_"]),
    ("google_api_key", re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b"), ["aiza"]),
    ("llm_api_key", re.compile(r"\bsk-(?:ant-|proj-)?[A-Za-z0-9_\-]{32,}"), ["sk-"]),
    ("private_key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----"), ["private key"]),
    ("assigned_secret", re.compile(r"""(?i)\b(?:api[_-]?key|secret[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|password|passwd)\b\s*[:=]\s*['"]([A-Za-z0-9/+_\-.]{20,})['"]"""),
     ["key", "secret", "token", "password", "passwd"]),
]
PLACEHOLDER = re.compile(r"(?i)x{4,}|your[_-]|example|placeholder|dummy|sample|changeme|redacted|<|\$\{|\{\{|test|fake|mock|0{8,}|1234")


def entropy(s: str) -> float:
    import math
    n = len(s)
    return -sum(c / n * math.log2(c / n) for c in (s.count(ch) for ch in set(s))) if n else 0.0


def mask(s: str) -> str:
    return s[:4] + "…" + f"[{len(s)} chars]"


def kind_of(rel: str, name: str, ext: str) -> set:
    kinds = set()
    if rel.startswith(".github/workflows/") or rel in (".gitlab-ci.yml", "azure-pipelines.yml", "Jenkinsfile", ".travis.yml", "bitbucket-pipelines.yml") \
            or rel.startswith(".circleci/") or rel.startswith(".buildkite/"):
        kinds |= {"ci", "config"}
    elif ext in LANG:
        kinds.add("code")
        if ext in (".sh", ".bash", ".zsh", ".ps1"):
            kinds.add("script")
        if ext == ".rs":
            kinds.add("rust")
        if ext in (".jsx", ".tsx", ".vue", ".svelte", ".astro", ".html", ".htm"):
            kinds.add("ui")
    elif re.match(r"(LICEN[CS]E|COPYING|UNLICENSE|NOTICE)([.-]|$)", name, re.I):
        kinds.add("license")
    elif ext in DOC_EXT or name.upper().startswith(("README", "CHANGELOG", "CONTRIBUTING", "SECURITY", "AGENTS", "CLAUDE")):
        kinds.add("doc")
    elif ext in CONFIG_EXT or name in CONFIG_NAMES or name.startswith((".", "Dockerfile")):
        kinds.add("config")
    return kinds


class Scan:
    """Results of one pass. `files` holds every file walked (relative path, size, kinds, flags)."""

    def __init__(self, root: Path):
        self.root = root
        self.files: list[dict] = []
        self.skipped_dirs: dict[str, int] = {}
        self.signals = {n: {"count": 0, "files": 0, "nontest": 0, "doc": 0, "locs": []} for n in SIGNALS}
        self.ignored: list[str] = []
        self.env_names: set[str] = set()
        self.secrets: list[dict] = []
        self.env_files: list[str] = []
        self.langs: dict[str, dict] = {}
        self.hashes: dict[str, list] = {}
        self.largest: list[tuple[int, str]] = []
        self.size_hist = {"over_1000": 0, "over_3000": 0, "over_10000": 0}
        self.binaries: list[tuple[int, str]] = []
        self.manifests: dict[str, list] = {"package.json": [], "pyproject.toml": [], "Cargo.toml": [], "go.mod": [], "requirements": []}
        self.ci_text: dict[str, str] = {}
        self.doc_text: dict[str, str] = {}
        self.config_text: dict[str, str] = {}
        self.stats = {"files": 0, "bytes": 0, "scanned_files": 0, "scanned_bytes": 0, "binary": 0, "too_large": 0, "generated": 0, "lockfiles": 0, "truncated": False}
        self.git: dict = {}

    def has(self, pattern: str, flags: int = re.I) -> list[str]:
        rx = re.compile(pattern, flags)
        return [f["path"] for f in self.files if rx.search(f["path"])]

    def to_json(self) -> dict:
        return {"root": str(self.root), "stats": self.stats, "skipped_dirs": self.skipped_dirs, "ignored_by_rqs_ignore": self.ignored[:200]}


def _matches(text: str, low: str, anchors: list, rx: re.Pattern, aligned: bool):
    """Regex matches, run only on lines that contain an anchor (every match contains one)."""
    if not aligned:
        if any(a in low for a in anchors):
            yield from rx.finditer(text)
        return
    starts = set()
    for a in anchors:
        i = low.find(a)
        while i != -1:
            starts.add(low.rfind("\n", 0, i) + 1)
            j = low.find("\n", i)
            if j == -1:
                break
            i = low.find(a, j)
    for st in sorted(starts):
        e = text.find("\n", st)
        yield from rx.finditer(text, st, len(text) if e == -1 else e)


def _record(scan: Scan, name: str, rel: str, text: str, m: re.Match, is_test: bool, first_in_file: bool, is_doc: bool = False):
    s = scan.signals[name]
    s["count"] += 1
    if is_doc:
        s["doc"] += 1  # a mention in prose, not a practice in code, config or CI
    if first_in_file:
        s["files"] += 1
    if not is_test:
        s["nontest"] += 1
    if len(s["locs"]) < MAX_LOCS and (not is_test or len(s["locs"]) < MAX_LOCS // 2):
        line = text.count("\n", 0, m.start()) + 1
        a = text.rfind("\n", 0, m.start()) + 1
        b = text.find("\n", m.end())
        snippet = text[a: b if b != -1 else len(text)].strip()[:160]
        s["locs"].append({"path": rel, "line": line, "text": snippet, "test": is_test})


def _manifest(scan: Scan, rel: str, name: str, text: str):
    try:
        if name == "package.json":
            scan.manifests["package.json"].append({"path": rel, **json.loads(text)})
        elif name == "pyproject.toml":
            scan.manifests["pyproject.toml"].append({"path": rel, **tomllib.loads(text)})
        elif name == "Cargo.toml":
            scan.manifests["Cargo.toml"].append({"path": rel, **tomllib.loads(text)})
        elif name == "go.mod":
            req = re.findall(r"^\s*(?:require\s+)?([\w.\-/]+\.[\w.\-/]+)\s+v[\d.]+", text, re.M)
            mod = re.search(r"^module\s+(\S+)", text, re.M)
            gov = re.search(r"^go\s+([\d.]+)", text, re.M)
            scan.manifests["go.mod"].append({"path": rel, "module": mod.group(1) if mod else None, "go": gov.group(1) if gov else None, "require": req})
        elif re.fullmatch(r"requirements[\w.-]*\.txt", name):
            lines = [ln.strip() for ln in text.splitlines() if ln.strip() and not ln.strip().startswith(("#", "-"))]
            scan.manifests["requirements"].append({"path": rel, "lines": lines, "hashes": "--hash=" in text})
    except (ValueError, tomllib.TOMLDecodeError, TypeError):
        pass


def _git(root: Path) -> dict:
    if not _inside_git(root):
        return {"present": False}
    base = ["git", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-C", str(root)]

    def run(*a):
        try:
            return subprocess.run([*base, *a], capture_output=True, text=True, timeout=60).stdout
        except (OSError, subprocess.SubprocessError):
            return ""
    head = run("rev-parse", "HEAD").strip()
    shallow = run("rev-parse", "--is-shallow-repository").strip() == "true"
    log = run("log", "-n", "500", "--format=%an%x1f%ae%x1f%aI%x1f%(trailers:key=Co-authored-by,valueonly,separator=%x1d)%x1e")
    commits, authors, ai = 0, {}, 0
    ai_re = re.compile(r"claude|copilot|codex|cursor|devin|gemini|openhands|aider|jules|sweep|bot@|noreply@anthropic|chatgpt", re.I)
    first = last = None
    for rec in log.split("\x1e"):
        parts = rec.strip("\n").split("\x1f")
        if len(parts) < 4:
            continue
        commits += 1
        authors[parts[1].lower()] = authors.get(parts[1].lower(), 0) + 1
        last = last or parts[2]
        first = parts[2]
        if ai_re.search(parts[3]) or ai_re.search(parts[0]):
            ai += 1
    tags = [t for t in run("tag", "--list").splitlines() if t.strip()]
    top = max(authors.values()) if authors else 0
    return {"present": True, "head": head, "shallow": shallow, "commits_read": commits, "authors": len(authors),
            "top_author_share": round(top / commits, 3) if commits else None, "ai_coauthored_commits": ai,
            "first_commit_date": first, "last_commit_date": last, "tags": len(tags), "tag_sample": tags[-5:]}


def _tracked(root: Path) -> list[str] | None:
    """Files git tracks under root (respects .gitignore); None when root is not in a work tree."""
    try:
        p = subprocess.run(["git", "-c", "core.fsmonitor=false", "-C", str(root), "ls-files", "-z", "--cached"], capture_output=True, timeout=120)
    except (OSError, subprocess.SubprocessError):
        return None
    if p.returncode != 0:
        return None
    return sorted(x for x in p.stdout.decode("utf-8", "replace").split("\0") if x)


def _iter_files(root: Path, sc: "Scan"):
    """(relative path, full path) for each file to inventory; skipped trees are counted, not read."""
    tracked = _tracked(root) if (root / ".git").exists() or _inside_git(root) else None
    sc.stats["file_list"] = "git ls-files" if tracked is not None else "filesystem walk"
    if tracked is not None:
        for rel in tracked:
            parts = rel.split("/")
            skip = next((i for i, d in enumerate(parts[:-1]) if d in SKIP_DIRS), None)
            if skip is not None:
                key = "/".join(parts[:skip + 1])
                sc.skipped_dirs[key] = sc.skipped_dirs.get(key, 0) + 1
                continue
            full = os.path.join(root, rel)
            if not os.path.islink(full) and os.path.isfile(full):
                yield rel, full
        return
    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root)
        rel_dir = "" if rel_dir == "." else rel_dir.replace(os.sep, "/") + "/"
        keep = []
        for d in sorted(dirnames):
            full = os.path.join(dirpath, d)
            if d in SKIP_DIRS or os.path.islink(full) or os.path.exists(os.path.join(full, "pyvenv.cfg")):
                sc.skipped_dirs[rel_dir + d] = sum(len(f) for _, _, f in os.walk(full)) if d != ".git" else 0
            else:
                keep.append(d)
        dirnames[:] = keep
        for fn in sorted(filenames):
            full = os.path.join(dirpath, fn)
            if not os.path.islink(full):
                yield rel_dir + fn, full


def _ignore_patterns(root: Path) -> list[str]:
    """Patterns from <root>/.rqs-ignore (one per line, fnmatch or a directory prefix, # comments).
    Meant for files that would match rqs's own patterns without being practice, such as rule
    tables of analysis tools. What was ignored is reported in the scan."""
    p = root / ".rqs-ignore"
    if not p.is_file():
        return []
    return [ln.strip() for ln in p.read_text(encoding="utf-8", errors="replace").splitlines() if ln.strip() and not ln.lstrip().startswith("#")]


def _inside_git(root: Path) -> bool:
    return any((q / ".git").exists() for q in [root, *root.parents])


def scan(root: str | Path, max_total: int = MAX_TOTAL) -> Scan:
    root = Path(root).resolve()
    sc = Scan(root)
    by_kind: dict[str, list] = {}
    for name, (kinds, anchors, rx, flags) in SIGNALS.items():
        for k in kinds:
            by_kind.setdefault(k, []).append((name, anchors, re.compile(rx, flags)))
    ignore = _ignore_patterns(root)
    for rel, full in _iter_files(root, sc):
        fn = rel.rsplit("/", 1)[-1]
        if ignore and any(fnmatch.fnmatchcase(rel, pat) or rel.startswith(pat.rstrip("/") + "/") for pat in ignore):
            sc.ignored.append(rel)  # inventoried as ignored, never read for signals
            sc.stats["ignored"] = len(sc.ignored)
            continue
        try:
            size = os.path.getsize(full)
        except OSError:
            continue
        ext = os.path.splitext(fn)[1].lower()
        kinds = kind_of(rel, fn, ext)
        is_test = bool(TEST_RE.search(rel))
        example = not is_test and bool(EXAMPLE_RE.search(rel))
        aux = is_test or example  # tests and examples do not count as product code in "nontest" counts
        gen = bool(GEN_RE.search(rel))
        rec = {"path": rel, "size": size, "kinds": sorted(kinds), "test": is_test, "example": example, "generated": gen, "lang": LANG.get(ext)}
        sc.files.append(rec)
        sc.stats["files"] += 1
        sc.stats["bytes"] += size
        if fn in LOCKFILES:
            sc.stats["lockfiles"] += 1
            continue
        if size > MAX_FILE:
            sc.stats["too_large"] += 1
            sc.binaries.append((size, rel)) if ext not in LANG and ext not in DOC_EXT and ext not in CONFIG_EXT else None
            continue
        if sc.stats["scanned_bytes"] > max_total:
            sc.stats["truncated"] = True
            continue
        try:
            with open(full, "rb") as fh:
                raw = fh.read()
        except OSError:
            continue
        if b"\x00" in raw[:8192]:
            sc.stats["binary"] += 1
            rec["binary"] = True
            sc.binaries.append((size, rel))
            continue
        text = raw.decode("utf-8", "replace")
        if size >= 1024 and kinds & {"code", "doc", "config"}:
            sc.hashes.setdefault(hashlib.sha256(raw).hexdigest(), []).append(rel)
        if fn in ("package.json", "pyproject.toml", "Cargo.toml", "go.mod") or fn.startswith("requirements"):
            _manifest(sc, rel, fn, text)
        if "ci" in kinds:
            sc.ci_text[rel] = text
        if kinds & {"doc", "license"} and len(sc.doc_text) < 4000:
            sc.doc_text[rel] = text
        if CONFIG_KEEP.search(rel) and len(sc.config_text) < 600:
            sc.config_text[rel] = text
        lines = text.count("\n") + 1
        if rec["lang"]:
            lang = sc.langs.setdefault(rec["lang"], {"files": 0, "lines": 0, "test_files": 0, "test_lines": 0, "generated_lines": 0, "example_lines": 0})
            if gen:
                lang["generated_lines"] += lines
            elif example:
                lang["example_lines"] += lines
            elif is_test:
                lang["test_files"] += 1
                lang["test_lines"] += lines
            else:
                lang["files"] += 1
                lang["lines"] += lines
                sc.largest.append((lines, rel))
                for k in (1000, 3000, 10000):
                    sc.size_hist[f"over_{k}"] += lines > k
        if gen or (ext in (".js", ".css") and lines and size / lines > 1000):
            sc.stats["generated"] += 1
            continue
        sc.stats["scanned_files"] += 1
        sc.stats["scanned_bytes"] += size
        low = text.lower()
        aligned = len(low) == len(text)  # lower() changes the length of a few code points
        is_doc = "doc" in kinds and not kinds & {"code", "config", "ci", "script"}
        seen = set()
        for k in kinds:
            for name, anchors, rx in by_kind.get(k, []):
                if name in seen:
                    continue
                seen.add(name)
                first = True
                for m in _matches(text, low, anchors, rx, aligned):
                    if name == "env_read" and not aux:
                        sc.env_names.add(next(g for g in m.groups() if g))
                    _record(sc, name, rel, text, m, aux, first, is_doc)
                    first = False
        if fn == ".env" or fn.startswith(".env.") and not fn.endswith((".example", ".sample", ".template", ".dist", ".defaults")):
            sc.env_files.append(rel)
        for sname, rx, anchors in SECRET_PATTERNS:
            for m in _matches(text, low, anchors, rx, aligned):
                val = m.group(1) if m.groups() else m.group(0)
                if sname in ("assigned_secret", "llm_api_key") and (PLACEHOLDER.search(val) or entropy(val) < (3.5 if sname == "assigned_secret" else 3.8)):
                    continue
                if len(sc.secrets) < 200:
                    sc.secrets.append({"kind": sname, "path": rel, "line": text.count("\n", 0, m.start()) + 1, "value": mask(val), "test": aux})
    sc.largest = sorted(sc.largest, reverse=True)[:15]
    sc.binaries = sorted(sc.binaries, reverse=True)
    sc.git = _git(root)
    return sc
