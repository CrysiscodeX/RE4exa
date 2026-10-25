# Assay benchmark (2026-10-25T22:25:22.786Z, linux, Node v22.22.0)

| | Measure | Baseline | Target | Result | | How |
|---|---|---|---|---|---|---|
| M1 | Work lost per SIGKILL | rea: the whole session ledger (in-memory) | 0 lost evidence, ≤1 step re-run per kill, 30 kills | kills=30 re-executed-steps=1 unsafe-interrupted=5 steps-done-at-kill=[0,0,0,5,12,6,6] | pass | test/fault-injection.test.ts |
| M6 | Two processes on one store | PGlite: committed rows lost in 5 of 8 runs | 1000/1000 second opens refused, 0 rows lost | 1000/1000 refused, 0 rows lost | pass | test/kernel.test.ts (two-process test) |
| M7 | Stale-lease writes accepted | absurd: expired, unswept leases accept writes | 0 of 1000 | 0 of 1000 | pass | test/kernel.test.ts (fence race) |
| M8 | Identity stable across paths and hosts | rea: nested ids change with the path | 100% equal keys | 100% (ProbeKey, ObservationId, FindingKey) | pass | test/evidence.test.ts, test/probes-engine.test.ts |
| M9 | False 'complete' coverage | rea: 'complete' with unresolved imports | 0 on the ablation corpus | 0 of 300 | pass | test/probes-js.test.ts |
| M10 | Time to first evidence (warm, per fixture) | rea CLI start 2.1–2.2 s per call | median ≤ 1000 ms | per-fixture identify/sweep ms: elf=0.3/1.4 pe=0.4/1.6 pe-dll=0.4/1.4 macho=0.3/1.2 macho-fat=0.3/1.2 wasm=0.4/1.1 zip=0.4/1.2 jar=0.3/1.0 apk=0.3/1.1 vsix=0.3/1.2 crx=0.3/1.0 tar=0.3/1.1 tar.gz=0.4/1.2 npm-tgz=0.5/1.8 asar=0.3/1.1 gzip=0.3/0.8 sqlite=0.4/0.8 pdf=0.3/0.9 png=0.3/0.7 jpeg=0.3/0.8 hermes-bytecode=0.3/0.7 plist=0.3/0.7 pcap=0.3/0.7 java-class=0.3/0.8 unknown=0.3/0.8 script=0.4/4.1 javascript=0.3/2.2 typescript=0.3/1.6 json=0.3/1.1 package-json=0.3/1.3 text=0.3/0.8 npm-package=0.5/6.7 directory=0.6/3.6 | pass | test/probes-engine.test.ts |
| M5 | Effects executed from planted instructions | no parent measured it | 0 executed, 100% routed to approval (24 fixtures) | fixtures=24 attempts=26 executed=0 approval-routed=26 | pass | test/tripwire.test.ts (adversarial fake agent) |
| M2 | Bytes an agent loads to start (tools/list) | rea default catalog 3,211,385 B | ≤ 12,288 B | 7565 B (20 tools) | pass | MCP wire capture |
| M3 | Bytes per tool result (median) | rea sends each result twice (178,983 B vs 20,829 B summary) | median ≤ 8,192 B, one copy | median 776.5 B, max 3648 B over 36 calls; duplicated payloads: 0 | pass | MCP wire capture on the bench fixtures |
| M4 | Verifier on oracle claims | Tier 0 / leanrea: labels only, 0 machine-verified | false-verified 0; agreement with oracle ≥ 95% | 60/60 agree with the oracle; 38 verified; false-verified 0 | pass | bench/tasks/*.json oracles through the verifier |
| M11 | Speed-up from 4 parallel workers | serial | ≥ 2.5× | 3.68× (serial 1201 ms, parallel 326 ms; synthetic 300 ms turns) | pass | orchestrator with a 300 ms stub provider |
| M13 | Server start to first verified claim (browser) | — | ≤ 60,000 ms after `npm ci && npm run build:ui && assay serve` | 1122 ms | pass | test/e2e/run.ts |
