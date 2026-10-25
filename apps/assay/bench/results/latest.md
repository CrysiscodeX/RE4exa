# Assay benchmark (2026-10-25T22:48:46.790Z, linux, Node v22.22.0)

| | Measure | Baseline | Target | Result | | How |
|---|---|---|---|---|---|---|
| M1 | Work lost per SIGKILL | rea: the whole session ledger (in-memory) | 0 lost evidence, ≤1 step re-run per kill, 30 kills | kills=30 re-executed-steps=0 unsafe-interrupted=0 steps-done-at-kill=[0,1,2,7,2,9,9] | pass | test/fault-injection.test.ts |
| M6 | Two processes on one store | PGlite: committed rows lost in 5 of 8 runs | 1000/1000 second opens refused, 0 rows lost | 1000/1000 refused, 0 rows lost | pass | test/kernel.test.ts (two-process test) |
| M7 | Stale-lease writes accepted | absurd: expired, unswept leases accept writes | 0 of 1000 | 0 of 1000 | pass | test/kernel.test.ts (fence race) |
| M8 | Identity stable across paths and hosts | rea: nested ids change with the path | 100% equal keys | 100% (ProbeKey, ObservationId, FindingKey) | pass | test/evidence.test.ts, test/probes-engine.test.ts |
| M9 | False 'complete' coverage | rea: 'complete' with unresolved imports | 0 on the ablation corpus | 0 of 300 | pass | test/probes-js.test.ts |
| M10 | Time to first evidence (warm, per fixture) | rea CLI start 2.1–2.2 s per call | median ≤ 1000 ms | per-fixture identify/sweep ms: elf=0.6/2.0 pe=0.4/1.3 pe-dll=0.3/1.2 macho=0.3/1.2 macho-fat=0.3/1.3 wasm=0.4/1.4 zip=0.4/1.4 jar=0.3/1.1 apk=0.4/1.2 vsix=0.5/1.7 crx=0.5/1.6 tar=0.5/1.6 tar.gz=0.7/1.6 npm-tgz=0.4/2.5 asar=0.3/1.2 gzip=0.4/0.8 sqlite=0.3/0.8 pdf=0.3/3.8 png=0.3/0.9 jpeg=0.3/0.8 hermes-bytecode=0.3/0.8 plist=0.3/0.8 pcap=0.3/0.9 java-class=0.3/1.0 unknown=0.3/0.8 script=0.3/2.0 javascript=0.4/2.9 typescript=0.4/2.1 json=0.4/1.3 package-json=0.3/1.4 text=0.3/0.6 npm-package=0.6/7.3 directory=0.5/3.0 | pass | test/probes-engine.test.ts |
| M5 | Effects executed from planted instructions | no parent measured it | 0 executed, 100% routed to approval (24 fixtures) | fixtures=24 attempts=26 executed=0 approval-routed=26 | pass | test/tripwire.test.ts (adversarial fake agent) |
| M2 | Bytes an agent loads to start (tools/list) | rea default catalog 3,211,385 B | ≤ 12,288 B | 7565 B (20 tools) | pass | MCP wire capture |
| M3 | Bytes per tool result (median) | rea sends each result twice (178,983 B vs 20,829 B summary) | median ≤ 8,192 B, one copy | median 545.5 B, max 2505 B over 36 calls; duplicated payloads: 0 | pass | MCP wire capture on the bench fixtures |
| M4 | Verifier on oracle claims | Tier 0 / leanrea: labels only, 0 machine-verified | false-verified 0; agreement with oracle ≥ 95% | 60/60 agree with the oracle; 38 verified; false-verified 0 | pass | bench/tasks/*.json oracles through the verifier |
| M11 | Speed-up from 4 parallel workers | serial | ≥ 2.5× | 3.60× (serial 1203 ms, parallel 334 ms; synthetic 300 ms turns) | pass | orchestrator with a 300 ms stub provider |
| M13 | Server start to first verified claim (browser) | — | ≤ 60,000 ms after `npm ci && npm run build:ui && assay serve` | 1063 ms | pass | test/e2e/run.ts |
| M12 | Cost per correct-and-verified answer vs Tier 0 (live) | Tier 0: model + Bash + leanrea skill | ≤ 1.0× | model haiku, 8 tasks × 3: Tier 0 90/105 facts, $0.09, 0 machine-verified; Assay 90/105 facts, $0.0515, 16 machine-verified; cost per correct fact ratio Assay/Tier0 = 0.57 [95% bootstrap 0.46–0.69, 24 paired cells] | pass | bench/live.ts |
