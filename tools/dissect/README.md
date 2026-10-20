# dissect

Repositories as a queryable knowledge graph: files, symbols, entrypoints (CLI commands,
MCP tools, skills, CI workflows, npm scripts), triggers (env vars, signals, events,
cron), lifecycles, states, schemas, dependencies, documented claims and cross-repo
concepts, in one SQLite database with FTS5.

```bash
npm install --prefix helpers                                    # Babel parser for JS/TS
(cd helpers && go build -o ../.bin/go_extract go_extract.go)    # optional Go parser
./dissect.sh --db repos.db scan /abs/repo=name ...
./dissect.sh --db repos.db matrix | search | node | path | list | query | describe
./dissect.sh --db repos.db mcp                                  # 8 read-only MCP tools
python3 -m unittest discover -s tests
```
Usage guide for agents: [`../../skills/dissect/SKILL.md`](../../skills/dissect/SKILL.md). Example database: [`../../research/dissection/`](../../research/dissection).
