# rex

Evidence-first investigation of shipped software for agents: identify, inventory,
native headers/exports, JS reference sweeps and bounded `find`. Every probe is inert,
idempotent and recorded as content-addressed evidence. Answers must cite evidence;
`coverage` and `calibrate` report what is unknown, unaccounted or untrustworthy.

```bash
./rex.sh describe                 # machine-readable contract
./rex.sh identify <path>          # format + next probes
./rex.sh mcp                      # MCP stdio server, 10 tools
python3 -m unittest discover -s tests
```
Standard-library Python 3.11+. No dependencies or telemetry. Usage guide for agents: [`../../skills/rex/SKILL.md`](../../skills/rex/SKILL.md).
Design and evaluation: [`../../research/dissection/README.md`](../../research/dissection/README.md) sections 5–7.
