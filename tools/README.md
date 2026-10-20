# RE4exa tools

Three agent-first tools. rex and rqs are standard-library Python; dissect also uses small Node
and Go parser helpers and PyYAML when it is installed (without it, a built-in reader handles
front matter and CI workflows). All work offline, send no telemetry, print one JSON document per
command, and serve the same functions over MCP stdio.

| Tool | What it answers | Interfaces | Tests |
|---|---|---|---|
| [`rex`](rex) | "What does this shipped artifact contain, load, export or reference, and how sure are we?" Evidence-first probes for binaries, npm packages, archives, ASAR and JS trees, with durable steps, coverage, calibration and a necessity gate | `rex.sh <cmd>`, `rex.sh mcp` (10 tools, 4.3 KB catalog) | `python3 -m unittest discover -s rex/tests` (15) |
| [`rqs`](rqs) | "How good is this repository against the 2030-35 bar, where are its gaps, and what should be extracted, merged or rebuilt?" 85 inert probes, suggested levels, scoring with the [RQS-2030](../standard/RQS-2030.md) formulas, red lines and gates, reports, comparisons and inter-rater agreement | `rqs.sh <cmd>`, `rqs.sh mcp` (8 tools) | `python3 -m unittest discover -s rqs/tests` (23) |
| [`dissect`](dissect) | "How is this codebase (or these ten) built, and where does a capability already exist?" Repositories as a knowledge graph of symbols, entrypoints, triggers, lifecycles, states, schemas, dependencies, claims and concepts | `dissect.sh <cmd>`, `dissect.sh mcp` (8 read-only tools) | `python3 -m unittest discover -s dissect/tests` (8) |

They work together:
- `rqs` reviews a repository against the standard; its opportunity lenses point at `dissect` queries (hubs, duplicates, complements) and at `rex gate`.
- `rex gate "<plan>"` searches a dissect index (`DISSECT_DB`) for existing capabilities and code before anything is built.
- `rex ext rea …` runs REA as a deep engine and keeps REA's own `evidence_id` as provenance.

## Design choices for agents (2030–35)

| Choice | Why |
|---|---|
| Content-addressed evidence (`ev_<sha256>`) | Two agents, or the same agent after a restart, get the same id for the same observation. Ids are safe to share, cache and cite |
| Tiny tool catalogs, input schemas only | A tool surface is paid for on every turn. REA's default catalog is 3.16 MB; rex's is 4.3 KB |
| Summary first, detail by handle | Every output states its byte and token cost; large results come back elided with the command that fetches the rest |
| Refusals name the cause and the fix | `{"error": {"code", "message", "fix"}}`: an agent can repair its call without guessing |
| Unknown and unaccounted are first-class | Answers can't claim more than their evidence; coverage separates "never examined" from "checked, nothing found" |
| Calibration from adjudicated outcomes | Confidence labels become measurable; below the data floor the tool says "insufficient data" rather than pretending |
| Durable, idempotent steps; streamed bundles | Crashes resume without repeating work; no single-object size limits |
| Inert by default | Probes read bytes; nothing in a target or a scanned repo is executed |
| `describe` command | The contract (commands, fields, rules, routes or schema) is machine-readable |

Agent skills: [`../skills/rex/SKILL.md`](../skills/rex/SKILL.md), [`../skills/dissect/SKILL.md`](../skills/dissect/SKILL.md), [`../skills/rqs/SKILL.md`](../skills/rqs/SKILL.md).

## Quick start

```bash
tools/rex/rex.sh identify /path/to/app.tgz            # -> format + next probes
tools/rex/rex.sh inventory /path/to/app.tgz           # entries, digests, package.json facts
tools/rex/rex.sh plan add "Does it load native code?"
tools/rex/rex.sh answer q_… --confidence observed --evidence ev_… --text "…"
tools/rex/rex.sh coverage

tools/dissect/dissect.sh --db repos.db scan /path/repo-a=a /path/repo-b=b
tools/dissect/dissect.sh --db repos.db matrix
tools/dissect/dissect.sh --db repos.db search "checkpoint OR resume" --kind symbol
```

dissect needs `node` for JS/TS (install the helper's parser once: `npm install --prefix tools/dissect/helpers`)
and `go` to build the Go helper (`cd tools/dissect/helpers && go build -o ../.bin/go_extract go_extract.go`).
Without them, those languages fall back to file-level facts.
