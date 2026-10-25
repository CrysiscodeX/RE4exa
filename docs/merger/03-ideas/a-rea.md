# 03 Ideas: A-rea (advocate for rea)

Two concept cards. Each is built around what rea contributes, using organs from the other three core repos and from donors. Organ references are `file organ-id (verdict)` and point into `01-anatomy/`. Labels follow the same convention: [seen], [inferred], [unknown].

## Techniques used
- **Inversion.** What would make rea obsolete? Two things would. First, frontier models are getting good at driving `file`, `strings`, `objdump` and `unzip` directly. Second, leanrea's benchmark shows only 17 of 112 tool calls in the REA arm were REA tools (journal J-02) [seen]. Under that pressure the 208-tool catalog dies first (rea O2, 3.2 MB). What does not die is the part no shell tool produces: a checkable claim with provenance, plus a tracked list of what is still unknown (rea O5, O7). Card R-1 follows from this.
- **Combination matrix (organ × organ).** Pairing rea's knowledge organs with the survival and donor organs, only a few cells produce something neither side has alone:

  | rea organ ↓ / partner → | absurd O2–O4 steps, leases | pi-durable 6 intent/replay | leanrea L5 router | strix D18 coverage.json | orca D4 receipts |
  |---|---|---|---|---|---|
  | O5 Evidence record | **step key = Evidence ID** | intent carries the expected Evidence ID | raw CLI output recorded as `observed` Evidence | — | receipt = Evidence ID |
  | O7 Unknown registry | **an open unknown becomes a scheduled task** | — | the cheap probe is tried first | **unknown + negative space = investigation coverage** | — |
  | O11 JS/Electron graph and version compare | fan-out per package/version | — | — | coverage per loading form | — |
  Bold cells are used below.
- **Constraint shift: zero model calls in the critical path.** Card R-2 runs unattended in CI with no model at all. A model is optional, only for summaries, and only through sanctioned delegation.

## R-1: Case file — a durable investigation record that agents and people resume

**Thesis.** The product is the investigation record itself: content-addressed Evidence and tracked unknowns, durable, resumable by anyone. Analysis tools are interchangeable probes that write into it, cheap ones first.

**Users and scenario.** A security reviewer asks their coding agent, "What does this VS Code extension's bundled native helper do on install?"
1. The agent calls `case.open(target)`. The case is keyed by root SHA-256.
2. The leanrea router runs `file` and `unzip -l` first. Their raw output is stored as `observed`, `shipped-artifact` Evidence.
3. Two unknowns are recorded: "does the helper reach the network?" and "which IPC channel triggers it?"
4. The laptop sleeps and the session dies. Next morning a different agent, or the reviewer at the CLI, runs `case.resume`. It sees 2 open unknowns, 9 Evidence records, and which probes already ran.
5. It calls rea's JS graph probe only for the open IPC question. The resolution has to cite qualifying Evidence (rea O7).
6. The exported case file is attached to the review ticket.
**Organs used.**
- **Claim format:** rea.md O5 Evidence record (lift, with the nested-path fix) and O7 unknown registry (lift).
- **Merge rules:** rea.md O6 ledger semantics (adapt). The in-memory Maps are replaced.
- **Durability:** pi-durable.md 6 tool-task intent/replay (lift) and 8 submissions/inbox (lift, plus a UNIQUE constraint) for the embedded single-writer mode. absurd.md O2–O4 task/checkpoint, claim and lease, events (lift, lease fixes) only if the owner answers "yes" to multi-worker (journal J-02).
- **Cheap-first probing:** leanrea.md L5 router (adapt) and L4 labels (pattern, mapped onto the `confidence` field).
- **Policy:** rea.md O3 effect audit (lift). A probe with `executesForeignCode` needs approval, and approvals are on by default.
- **Coverage:** strix coverage.json, donors.md row 18 (adapt), for case-level negative space. It must also list the loading forms checked, after rea's `import.meta` miss.
- **Idempotent writes:** orca mutation receipts, donors.md row 4 (adapt). caveman content-addressed handles, row 16 (pattern), for expandable references instead of 85 KB inline results.

**Genuinely new vs the null option.** Composing the parts as they are gives an agent rea plus a pi-durable harness. rea's ledger still dies with the rea process, and pi-durable keeps only the transcript.
- **New: the Evidence ID becomes the durable step key.** A replayed probe that yields the same ID is a no-op by construction. This is not true of either engine's request IDs [inferred].
- **New: unknowns are first-class scheduled work** with required authority and confidence.
- **New: one case outlives tools, agents and machines.**

These three cannot be had by side-by-side use without writing the adapter, and that adapter is the product [inferred].
**Integration surfaces.**
- **MCP:** about 8 tools: open, resume, record, list_unknowns, update_unknown, run_probe, coverage, export. Budget ≤ 15 KB catalog; to measure.
- **CLI:** the same verbs.
- **SDK:** TypeScript library over O5 and O7.
- **Storage:** SQLite WAL locally. Postgres via absurd when shared.
- **Probes:** rea MCP (compact profile), plain CLI tools.
- **Identity:** none stored. The case calls no model; the host agent does.

**2030–35 fit.**
- Agents as callers: a small surface, idempotent calls.
- Provenance pressure (CRA, AI Act): every conclusion cites hashed evidence with tool versions.
- Local-first with an optional shared store.
- Long runs that must survive crashes and handover.

**My top 3 weak spots.**
1. **The null option may be enough.** A thin "write Evidence JSONL to disk" patch to rea (rea O6 adapt) plus pi-durable may deliver 80% of the value without a new product [inferred].
2. **Agents may not record faithfully.** leanrea's labels are prose and nothing enforces them. If agents skip `record` or mislabel `inferred` as `observed`, the case file looks rigorous and is not. Confidence classes are uncalibrated (rea.md O5).
3. **Content addressing is not yet true.** Composite IDs depend on paths, and nested records bloat cases. Large bundles failed to re-import on 6.7.0 (unconfirmed). The case store could inherit both.

**What would prove it wrong.**
- **Kill test:** kill -9 at step k on a 30-probe investigation. If resume repeats more than 1 probe or changes any Evidence ID, the core claim fails.
- **Paired benchmark against leanrea-only, using leanrea L10:** if cross-session tasks show no gain in correct-and-cited answers, or the gain costs more than 1.5× tokens, drop it.
- **Agent audit:** if agents leave more than 20% of answer claims without an Evidence ID in an audit, the record is not doing its job.

## R-2: Release delta gate — evidence-backed "what changed in behaviour" for every dependency and app update

**Thesis.** For each new version of a package, extension or desktop app, produce an unattended, model-free diff of declared capabilities. It covers new endpoints, native add-ons, IPC channels, install scripts, Electron fuses and entitlements. Each line is backed by Evidence, and what was not examined is stated explicitly. CI can gate on it.

**Users and scenario.** A platform team's CI sees a lockfile bump: 41 changed npm packages and one Electron app update.
1. Each `(old, new)` pair is enqueued as a durable task.
2. Workers claim pairs under leases. Each worker inventories both artifacts (rea O10, plus the missing tar/gzip reader), builds the JS/Electron graphs (O11) and runs `compare_application_versions`.
3. The gate fails on one package: it gained a `postinstall`, a `child_process` call path and a new literal host.
4. The report lists 3 unknowns, among them "dynamic `require` in `lib/x.js`: not resolved". It does not say "clean".
5. A reviewer opens the case. Optionally, a summary is written by the team's own Codex or Claude account through the official CLI/SDK (delegated, nothing stored).
**Organs used.**
- **Analysis:** rea.md O10 artifact readers (adapt: add tar/gzip), O11 JS/Electron analysis (adapt: fix the literal loading forms and the coverage claim), O16 specialist providers for Go, Rust and .NET build facts (leave; called as tools).
- **Records:** rea.md O5 and O7 (lift).
- **Gating rules:** rea.md O3 effect audit (lift). Only static probes are allowed in the gate, so `executesForeignCode` is forbidden there.
- **Durable fan-out:** absurd.md O1–O5 queue, task state, claim and lease, retries (adapt/lift with lease fixes) and O8 TypeScript SDK (adapt). Here the multi-worker answer is "yes".
- **Process control:** orca process-host, donors.md row 1 (lift), and the liveness vocabulary, row 5 (pattern: lost contact means `unverifiable`, never `exited`).
- **Negative space:** strix coverage.json, row 18 (adapt).
- **Measurement record:** laya-coreml, row 24 (pattern), for gate results with input digests.
- **Isolation:** agent-sandbox-lockdown, row 21 (pattern), for the optional runtime lane.
- **Optional summaries:** t3code delegated sign-in, row 9 (adapt), with one configuration home per account, row 10 (pattern). pi-ai's Claude OAuth path is excluded.

**Genuinely new vs the null option.** Today the null option is a CI script that calls `rea` per package and greps JSON. That approach has no leases or retries without duplicate work, no stated negative space, and no stable identity for "this exact finding was already reviewed last week". New here:
- **Findings keyed by Evidence ID across versions,** so a reviewed finding stays reviewed.
- **Unknowns that block or warn by policy.**
- **Model-free determinism,** so the gate result is reproducible from digests [inferred].
**Integration surfaces.**
- **CLI and a CI action:** `delta-gate old.tgz new.tgz --policy p.yaml`. Exit code plus a JSON report.
- **SDK:** a TypeScript worker on absurd.
- **Storage:** Postgres (absurd) for fleets. SQLite for a single runner.
- **MCP:** read-only `case.*` tools for reviewing agents.
- **Outputs:** SARIF or in-toto attestation (to decide).
- **Identity:** no stored model credentials. A model is used only via delegated official tooling, and the gate never needs one.

**2030–35 fit.**
- CRA vulnerability handling and SBOM duties push teams to explain what changed, not just which version.
- Software ships as Electron, WASM, native and packages; format reach plus declared non-coverage.
- Bounded, unattended cost.
- Attestation expectations (framing §4).

**My top 3 weak spots.**
1. **False "no change" is the worst failure, and rea already showed one.** It missed a literal `new URL(…, import.meta.url)` edge while reporting coverage "complete" (rea.md O11). A gate built on that misleads people. Coverage has to name the loading forms checked, or the gate must warn on everything it cannot resolve. That produces noise.
2. **Narrow reach where it matters.** The deep native analysis needs Ghidra, IDA or Hopper, which CI runners rarely have. So native-heavy updates get "unknown" lines, and the gate is mostly a JS/Electron product [inferred].
3. **Crowded market and heavy operations.** Dependency-behaviour scanners already exist [unknown how good they are; not in our evidence]. The fleet mode needs Postgres and absurd's lease fixes before it is safe (journal J-02). The value over the null CI script may not justify that.

**What would prove it wrong.**
- **Replay test:** over 50+ historical package updates with publicly known behaviour changes (malicious or not), recall below 90% on the declared capability classes means it fails.
- **Noise test:** more than 1 false-positive "changed" line per 10 benign updates means it fails.
- **Determinism:** two runs on the same pair must give the same Evidence IDs and verdict.
- **Cost:** median wall time per pair above 60 s on a standard CI runner is too slow.
- **Adoption:** if teams switch it to warn-only within a month, it has failed as a gate.
