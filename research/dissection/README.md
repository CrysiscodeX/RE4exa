# Dissection of ten repositories, and the product merged from them

**Question:** how can these repositories be taken apart, and their most valuable parts
combined into one product where each part strengthens the others?

**Method:**
1. Dissect all ten repositories into one knowledge graph with
   [`tools/dissect`](../../tools/dissect).
2. Query the graph for capabilities, overlaps and complements.
3. Add a curated layer that the graph itself records: capabilities, relations,
   first principles, components and gaps.
4. Build the merged product ([`tools/rex`](../../tools/rex)) and evaluate it on the same
   answer key that was used to evaluate REA.

| File | What it is |
|---|---|
| `dissection.db.gz` | The SQLite database (49 MB unpacked). `gunzip -k dissection.db.gz`, then `tools/dissect/dissect.sh --db dissection.db stats` |
| `build.sh` | Rebuilds the database from clones and re-runs the exploration layer (about 50 s) |
| `explore.py` | The exploration queries plus the curated layer (capabilities, relations, principles, components, gaps) |
| `exploration.json` | Results of every exploration query |
| `scan-result.json` | Per-repository extraction counts |

## 1. What was dissected

The database holds 94,731 nodes and 271,843 edges from 10,955 files across ten repositories.

| Node kind | Count | What it captures |
|---|---|---|
| symbol | 68,359 | Functions, methods, classes, types and interfaces, with first doc line, line range and export flag. Parsers: Babel for JS/TS, `ast` for Python, `go/parser` for Go; patterns for Rust, Java, C#, Swift, Kotlin, shell, SQL and C/C++ |
| file | 10,955 | Role (source, test, doc, config, ci, skill, fixture, bench), language and sha256 |
| doc | 10,052 | Markdown sections |
| schema | 1,504 | zod objects, TypeBox types, dataclasses, pydantic models, SQL tables |
| trigger | 1,259 | Env vars (per repo), events, OS signals, timers, CI events, cron schedules, agent hooks |
| entrypoint | 1,125 | bins, npm scripts, CLI commands, MCP tools (REA's 207 imported exactly from its live `tools/list`), skills, CI workflows, make targets, Go mains, agent plugins |
| dependency | 657 | Declared (runtime, dev, extras) and imported (standard libraries excluded) |
| claim | 603 | Numeric sentences in docs: what each project says about itself |
| lifecycle / state | 45 / 31 | Global vocabulary shared across repos: phases (start, checkpoint, retry, …) and state values (pending, running, failed, …) |
| concept | 41 | Cross-repo taxonomy (analysis, epistemics, durability, agents, ml, quality, security, ops, interface) |
| capability, finding, principle, component, gap, product | 30, 36, 8, 8, 7, 11 | The curated layer below |

Edge kinds: `calls`, `defines`, `tagged`, `imports`, `contains`, `documents`,
`implements`, `has_state`, `uses_env`, `listens`, `emits`, `implemented_by`,
`uses_timer`, `claims`, `depends_on`, `fires`, `handles_signal`, plus the curated
`provides`, `complements`, `overlaps`, `fixes`, `measures`, `merges_into`, `satisfies`,
`gap_in` and `motivates`.

## 2. What the graph shows (queries in `explore.py`, results in `exploration.json`)

**Capability matrix**: each repo's share of its own concept weight, so large repos don't dominate. The leaders:

| Concept | Leader | Share | | Concept | Leader | Share |
|---|---|---|---|---|---|---|
| queue-scheduling | absurd | 18.5% | | binary-analysis | rea | 9.9% |
| durable-execution | absurd | 9.4% | | runtime-observation | rea | 12.1% |
| output-compression | caveman | 7.6% | | evidence-provenance | rea | 6.4% |
| agent-orchestration | pi | 12.4% | | verification | rea | 7.8% |
| on-device-inference | laya-coreml | 11.4% | | code-review | ponytail | 8.2% |
| model-routing | laya-coreml | 10.1% | | agent-skill | ponytail | 20.0% |
| confidence-calibration | my-jev | 9.8% | | model-training | my-jev | 16.4% |
| security-testing | strix | 5.1% | | context-budget | leanrea | 13.1% |

**Shared vocabulary:**
- Every repo except leanrea has a `run` phase, 8 have `start`, and 7 have `checkpoint`, `spawn`, `restore` and `stop`.
- The state values `failed`, `timeout` and `active` occur in 7 repos.
- These are one hop apart in the graph (`dissect node phase:checkpoint`), which is how durable-execution designs in Go, SQL, TypeScript and Python meet.

**Hubs:**
- REA's `createEvidence` (186 callers) and `parseEvidence` (135) are the centre of its codebase. The Evidence record is REA's core.
- caveman's hub is its wire parser (651 callers).
- pi's most-called non-test symbols are a fake model provider used by tests and examples (`fauxAssistantMessage`, 71) and a TUI width helper (51).

**Duplication:**
- laya has 158 duplicated files (2.7 MB).
- caveman has 86 (570 KB); for example, every skill exists under both `skills/` and `plugins/caveman/skills/`.
- The same Apache-2.0 text appears in 25 caveman directories.

**Self-description vs evidence:**
- laya makes 194 numeric claims, REA 101, laya-coreml 98, caveman 88.
- Test-to-source ratios run from 1.53 (laya) and 1.32 (caveman) to 0 (my-jev, leanrea).

**MCP surface:**
- REA: 207 exact tools.
- pi: 97 pattern-detected tools.
- caveman, laya and laya-coreml: about 10–12 each.
- `rex`: 10 tools in 4,302 bytes (compact JSON of the `tools/list` result, [`results/rex-measurements.json`](results/rex-measurements.json)).

## 3. The valuable parts

There are 30 curated capabilities, each anchored to real nodes; every anchor resolved. The score is 2×value + maturity + portability. These are the top ones:

| Score | Capability | From | Why it matters |
|---|---|---|---|
| 19 | Necessity ladder | ponytail | Stops agents rebuilding what exists; never cuts validation or security |
| 18 | Content-addressed Evidence records | rea | Every claim traces to bytes, method and parameters |
| 18 | Durable steps (tasks, runs, checkpoints, leases) | absurd | Work survives crashes; completed steps are not redone |
| 18 | Content-addressed originals with retrieval handles (CCR) | caveman | Summaries never lose the original |
| 18 | Fitted abstention and risk-coverage metrics | laya | Decides when a claim must stay unknown |
| 18 | Cheapest-probe router | leanrea | Answers most first questions in milliseconds |
| 18 | Declared-intent vs recorded-outcome coverage | strix | Separates "unaccounted" from "tested, nothing found" |
| 17 | Residual unknowns with a qualifying-evidence guard | rea | Open questions are first-class |
| 17 | Format parsers (Go, Rust, PE, Mach-O, ASAR, fuses, .NET) | rea | Exact byte ranges; missing metadata means unknown |
| 17 | Offline token accounting and honest-numbers method | caveman | Budgets, and reporting billed totals |
| 17 | Audit format, debt ledger, benchmark hygiene | ponytail | Honest evaluation of the product itself |

Lowest is REA's 207-tool catalog (score 9). It has value, but it costs about 833k o200k tokens when fully loaded.

**How the parts fit**: 18 relations, with the reasons stored on the edges.
- **Content addressing ties three of them together.** An REA `evidence_id` can be caveman's retrieval handle. It also makes Absurd's steps idempotent by construction, and the crash test measured this: the same 6 IDs came back after the crash.
- **Unknowns plus the coverage ledger plus abstention bound what an investigation knows.**
- **Fixes, measured and proposed:**
  - Measured: durable steps restore REA's ledger, which went from 3 records to 0 after a SIGKILL; the Absurd prototype brought back the same 6 evidence IDs ([`prototype-crash-test.json`](../rea-self-analysis/results/prototype-crash-test.json)).
  - Measured: removing output schemas cuts REA's catalog by 72.7% (lens-caveman results).
  - Proposed, not measured: streamed bundles for REA's 889 MB bundle that could not be re-imported.
  - Proposed, not measured: bench hygiene (interleaved arms, geomean with CI) for leanrea's n=3 parallel-arm benchmark.

## 4. First principles for an agent investigating software (2030–35)

| Principle | Statement | Components that satisfy it |
|---|---|---|
| P1 Traceable truth | Every claim traces to reproducible evidence: bytes, method, parameters, tool identity | C2 |
| P2 Honest uncertainty | Absence is not a negative; confidence classes are calibrated; uncertain claims abstain | C5 |
| P3 Attention economy | Tokens and turns are the scarcest resource: cheapest sufficient probe, bounded output, detail by handle | C1, C4 |
| P4 Durability | Work survives crashes; replays are idempotent; storage has no single-object size cliff | C3 |
| P5 Accounted completeness | The investigation knows what it did not examine | C6 |
| P6 Minimal surface | Few composable tools, small self-describing schemas | C4, C7, C8 |
| P7 Inert by default | Targets are not executed unless explicitly requested and isolated | C1 |
| P8 Self-verification | The tool proves itself on answer keys, golden outputs and its own artifact | C2, C7 |

## 5. The merged product: RE4exa Evidence Engine

| Component | Built from | In the prototype |
|---|---|---|
| C1 Probe | leanrea router and rules, REA parsers, pi code-mode idea | `rex identify/inventory/native/js-refs/find/ext`; native ELF/PE/Mach-O/ZIP/tgz/ASAR/Go/Rust readers; REA and binutils as optional engines |
| C2 Evidence | REA Evidence model, laya-coreml fidelity checks | `ev_<sha256>` records with one payload copy, confidence, authority, limitations and links |
| C3 Store | Absurd durable steps, pi-durable, caveman CCR | SQLite (WAL) steps keyed by operation + canonical args + subject digest; streamed JSONL bundles; tampered records rejected |
| C4 Budget | caveman token accounting and compressors, pi compaction | Every output carries bytes and a token estimate; summary-first views; pages fetched by evidence id |
| C5 Epistemics | REA unknowns, laya abstention and calibration, my-jev metrics | Answers must cite evidence and can't claim more than it supports; refusals name the cause and the fix; Wilson intervals, ECE, abstention advice |
| C6 Coverage | strix coverage ledger | Declared questions; answered, partial, unknown and unaccounted kept separate; caveats for failed probes |
| C7 Quality gate | ponytail ladder, audit and bench hygiene; leanrea answer keys | `rex gate` checks the dissect index for existing capabilities and code before anything is built |
| C8 Interface | lessons from REA's catalog; typed-decision idea from laya | A CLI plus a 10-tool MCP server (4.3 KB catalog, input schemas only, honest read-only hints); SKILL.md files in `skills/` |

## 6. The product evaluated again on REA's own answer key

Full results are in [`../rea-self-analysis/results/product-eval.json`](../rea-self-analysis/results/product-eval.json); the rex timings and catalog size were re-measured with [`measure_rex.py`](measure_rex.py) (median of 5 fresh CLI processes, so Python start-up is included) and are in [`results/rex-measurements.json`](results/rex-measurements.json). REA's timings are from the earlier study.

| | REA 6.7.0 | rex 0.1.0 |
|---|---|---|
| Inventory of the published npm `.tgz` | refused (unsupported format) | 1,775/1,775 files, 0 digest mismatches, 0.61 s |
| Package directory | refused by `open_binary` | inventoried and swept |
| Windows addon headers, exports and imports | correct (1.3–2.3 s per CLI call) | correct, 0.10 s (2 exports, 5 imported DLLs) |
| `#subpath` workers, bridge files via `new URL`, `.node` loads | missed by the application graph (gaps 3–5) | found by the reference sweep (labelled seen strings) |
| Seven answer-key questions, end to end | JS analysis alone took 1,070.7 s | 7/7 correct, 4.48 s, 25.8 KB read by the agent |
| Runtime-only question (spawned processes) | — | recorded as **unknown**, not guessed |
| Question never addressed | not tracked | reported as **unaccounted** |
| Crash in the middle of work | ledger lost (3 → 0) | resumed: 2 steps reused, 2 executed |
| MCP catalog | 3,158,368 bytes, 207 tools | 4,302 bytes, 10 tools |

`rex` doesn't replace REA's depth. Decompilation, the typed JS application graph and
runtime capture stay REA's; `rex ext rea …` runs REA as an engine and keeps REA's
`evidence_id` as provenance. The merge keeps REA's evidence discipline and replaces
the parts that measured badly: catalog size, cost per call, durability, and the
formats it refuses.

## 7. Remaining gaps (re-evaluated from first principles)

| Gap | Affects | Next step |
|---|---|---|
| G1 Search is lexical (FTS5 plus taxonomy); paraphrases are missed | C4, C8 | Add an offline embedding model when one is reachable; keep lexical search as the fallback |
| G2 Calibration needs adjudicated outcomes; the evaluation had 5/1/1 per class (`insufficient-data`) | C5 | Adjudicate every answer-key run; trust or abstain only once a class has at least 10 adjudicated answers |
| G3 Deep decompilation still needs external engines | C1 | Keep them as adapters (REA, Ghidra) with tool identity in the evidence |
| G4 Evidence is unsigned | C2, C3 | Sign bundles (in-toto/Sigstore-style attestations) for cross-machine sharing |
| G5 One writer per store | C3 | Leases (Absurd) or one store per agent, merged by evidence id |
| G6 Runtime probes need isolation the product doesn't provide | C1 | Run runtime probes only inside a container or VM, and declare that environment in the evidence |
| G7 Coverage only knows declared questions | C6 | Seed questions from the target type (routes) and from the dissect matrix |
| G8 `js-refs` is pattern-based: it counted 24 child-process calls against 18 AST-confirmed sites | C1 | Keep it as the cheap first pass; promote its hits to the AST-backed REA graph or dissect when exact edges matter |
