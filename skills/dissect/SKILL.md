---
name: dissect
description: Take one or more source repositories apart into a queryable knowledge graph (files, functions/classes, entrypoints such as CLI commands, MCP tools, skills, CI workflows and npm scripts, triggers such as env vars, signals, events, cron, lifecycles, states, schemas, dependencies, documented numeric claims, and cross-repo concepts). Use it to understand an unfamiliar codebase quickly, compare several repositories, find where a capability already exists before re-implementing it, or trace how two things connect.
---

# dissect: repositories as a knowledge graph

`tools/dissect/dissect.sh --db <file> <command>` (or `dissect mcp` - 8 read-only MCP tools).
Every command prints one JSON document; `--max-bytes` bounds output and sets `truncated` + `next_offset`.

## Build the index (once per repo version)

```bash
dissect --db repos.db scan /abs/repo-a=a /abs/repo-b=b      # inert: nothing in the repos is executed
dissect --db repos.db import-mcp a tools-list.json          # optional: exact MCP tools from a live tools/list
```
JS/TS (Babel), Python (ast) and Go (go/parser) are parsed; Rust, Java, C#, Swift, Kotlin, shell, SQL, C/C++ use patterns.

## Ask, in this order

1. **Orient:** `dissect stats`, then `dissect matrix` - which repo leads on which concept.
2. **Find:** `dissect search "checkpoint OR resume" --kind symbol --repo a` (FTS5 syntax).
3. **Expand:** `dissect node <id | qualname | repo:qualname>` - incoming and outgoing edges.
   Useful qualnames: `mcp-tool:<name>`, `skill:<name>`, `cli-command:<name>`, `phase:checkpoint`, `env:<VAR>` (per repo), `signal:SIGTERM`, `value:running`.
4. **Connect:** `dissect path <ref> <ref> [--edges calls,imports]` - shortest link between two things.
5. **List by kind:** `dissect list entrypoint --sub skill`, `dissect list trigger --sub env --repo a`, `dissect list claim`.
6. **Anything else:** `dissect query "select ..."` (read-only SQL; tables `repo`, `node`, `edge`, `node_fts`, view `v_capability_matrix`; `dissect describe` has the schema).

## Read results carefully

- Call edges are resolved by name (same file first, then a unique definition); receiver-qualified calls stay
  within their file. They are a map, not a proof.
- Concept tags are lexical rules over identifiers, paths and first doc lines - good for orientation, noisy for scoring.
- `claim` nodes are numeric sentences from docs: what a project says about itself, not measurements.
- Shared vocabulary (`phase:*`, `value:*`, `signal:*`, `cron:*`, `ci-event:*`) is global, so one hop shows every repo that uses it.
