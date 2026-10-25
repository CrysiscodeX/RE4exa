# Candidate C: Claim Verifier

**Origin.** The outsider candidate O-2 ([round-2-skeptic.md §3](../04-debate/round-2-skeptic.md)), S-2 as the record format ([03-ideas/skeptic.md](../03-ideas/skeptic.md)), and leanrea's router turned into probes. The moderator chose it in [journal J-06](../journal.md). The architect who wrote this file took no part in the debate.

**Labels.** [seen] means read in the clones at the pinned commits, [inferred] means reasoned from what was seen, [unknown] means not known. Estimates are marked. Every level and size here is a design intent; nothing has been built.

**Citations.** `rea:` is `b4938ae`, `leanrea:` is `09ba4aa` and `strix:` is `aa2036f`. Anatomy organs are cited as `rea.md O5`, `donors.md row 17` and so on.

## 1. Thesis

Leave the agent's working path alone. Afterwards, a model-free verifier re-runs every `seen` claim the agent made against the artifact's digest, using pinned probes in an isolated container, and records which claims held, which failed and what nobody looked at.

## 2. Who uses it, and three usage scenarios

**Users:** reviewers who receive agent-written reports; CI jobs that accept or reject them; auditors who need proof of how a result was reached; team leads choosing between agents and models. The agent is not a user of the product's runtime; it only follows a short addendum to the skill.

**Scenario 1: a pull-request review of a new dependency.**
1. A developer asks their agent, in their own client on their own account, "what does `foo-2.3.0.tgz` do at install time, and does it ship native code?" The agent works through Tier 0: Bash and the leanrea skill.
2. Following the addendum, the agent writes `report.md` and `claims.jsonl`. Each claim states the artifact's sha256, a member path, a locator (an offset, a symbol or a JSON pointer), a predicate from a closed list, a value and a label (`seen` or `inferred`).
3. CI runs `verify --claims claims.jsonl --artifact foo-2.3.0.tgz --pack <version>`.
4. The reviewer sees a check summary. For example: "14 seen claims: 11 verified, 1 refuted (`package.json` has no `scripts.postinstall`; the agent cited `install`), 2 unverifiable (predicate `calls`: no static probe on this lane). Not examined: 37 of 41 members, including `binding.gyp`. Router rows that apply but no claim used: native addon inventory." The refuted claim is shown next to the report line it came from.

**Scenario 2: an auditor re-checks a vendor's report.**
1. A vendor delivers an agent-written analysis of its Electron app, with the claims file, the app's digest and the pack version used.
2. The auditor runs the same verifier and pack versions on the same bytes, on their own machine, and gets a byte-identical verification file (designed for; gated by K3).
3. Their attention goes to the refuted and unverifiable claims and the not-examined list, not to every claim.

**Scenario 3: a team lead looks at calibration.**
1. After three months the CI verification files are pooled; the aggregator only reads files.
2. It reports, per (client, model, predicate class, agent label), the shares verified and refuted with Wilson 95% intervals; cells with n < 30 show `INSUFFICIENT`.
3. The lead sees, say, that one model's `seen` dependency-version claims verify far less often than another's, and requires verification for that class before merge.

## 3. Anatomy of capabilities

**Repositories used.** rea and leanrea provide organs; pi-durable provides one pattern (its conformance-kit shape); **absurd provides nothing**. The verifier needs no durable execution, because a crash costs one re-run. So this candidate in practice combines **two of the four repositories** plus donors. The charter allows that answer, and it is stated plainly rather than padded out.

| Capability | Source organ | Verdict | What must change | Licence | Gap IDs |
|---|---|---|---|---|---|
| S-2 v1 record: claim and verification Evidence | `rea.md` O5 (17-file closure, 2,839 lines) | adapt | Nested records reduced to their IDs (ObservationId). Capped at the record plus two IDs (ObservationId, ProbeKey). Vendor, then check against golden vectors | MIT | X-1, X-5, N-2 |
| Answer-claim schema and failure taxonomy | `rea.md` O19: `finalAnswerSchema` `{id, value, evidence_id, confidence, authority}` and 14 failure codes (`rea:src/evaluation/KnownAnswerEvaluation.ts:37-51,100-110`); a JSON parser that rejects duplicate keys (`:126-138`) [seen] | adapt | Today it grades against configured fixture oracles and cited Evidence the agent already received (`:405-458`) [seen]. Change it to grade against a fresh probe. Add `locator` and `predicate` | MIT | W-R1-2, EPI-2 |
| Predicate pack: closed predicates, each bound to an argv probe | `leanrea.md` L5 (18 rows, `leanrea:leanrea/SKILL.md:36-55`) | adapt | Recast the rows by predicate (`contains_string`, `exports_symbol`, `imports_symbol`, `links_library`, `member_exists`, `json_value`, `header_field`, `dependency_version`, `ipc_channel`…). Each row gets `platforms`, `fixture`, `status`, `effects`, and a pinned tool or image digest | MIT | X-8, RL-4 |
| Trap rules as coverage defaults | `leanrea.md` L7 (`rg -uu`, `app.asar.unpacked/`, SQLite `-wal`; `leanrea:leanrea/SKILL.md:13`) | lift | The universe always includes dot-folders, unpacked add-ons and WAL files | MIT (notice) | X-6 |
| Agent-side addendum: labels plus a claims file | `leanrea.md` L4 (`leanrea:leanrea/SKILL.md:16`), L13 | pattern | A versioned addendum of 1–2 KB (estimate) that asks for `claims.jsonl` next to the prose | MIT | W-S2-4 |
| Hardened readers as an independent probe implementation | `rea.md` O10 (symlink reject, 500× budget, SafeOutputTree) | adapt | Add a tar/gzip reader (**new, S**). Prefer rea's readers over the binutils the agent probably used, so the check does not simply repeat the agent's own method | MIT | SEC-8 |
| Relation predicates (imports, IPC pairs, worker loads) | `rea.md` O11, through a pinned `rea` subprocess | adapt (as a dependency) | Read rea's `complete` as `partial` until the X-6 census exists | MIT | X-6 |
| Format readers (Go buildinfo, Rust, .NET, WASM, Mach-O load commands) | `rea.md` O16, O10 | leave (call through pinned rea) | — | MIT | X-8 |
| Effect allowlist for probes | `rea.md` O3 (782 lines, no imports) | lift | Admit only rows whose effects are all false apart from reading. `executesForeignCode`, `accessesNetwork` and `mutatesDevice` are refused outright | MIT | X-2, X-7 |
| Supervision of each probe | `donors.md` row 1 (Orca process-host, 30 s and 8 MiB defaults) | lift | argv only, no shell | MIT (root notice) | SEC-8 |
| Isolation container | `donors.md` row 21 (internal network, `read_only`, `cap_drop: ALL`, non-root) | pattern | `--network none`, images pinned by digest, the artifact mounted read-only at `/in/<sha256>` | no licence (pattern only) | X-2, SEC-8, N-8 |
| Closure states and citation-existence check | `donors.md` row 17. strix ends every candidate as `confirmed`, `ruled_out` or `open_proof_gap` (`strix:strix/agents/prompts/system_prompt.jinja:203`). It drops cited IDs it cannot check rather than storing them (`strix:strix/tools/reporting/tool.py:231-262`) [seen] | pattern | Map to `verified`, `refuted`, `unverifiable`, each with a reason code. strix only checks that a citation exists. Here the claim is re-run | Apache-2.0 | W-S2-4 |
| Not-examined record | `donors.md` row 18 (`agent_reported` versus `machine_observed`, "Treat it as unexamined, not as clean", `strix:strix/report/coverage.py:12-25,263`) and `rea.md` O7 | adapt | The universe comes from rea's inventory. Members never cited, router rows that apply but went unused, and unverifiable claims become open unknowns | Apache-2.0, MIT | X-6, EPI-4 |
| Calibration report | `donors.md` row 22 (laya's `INSUFFICIENT`/`UNKNOWN` states) and row 23 (my-jev: count invalid answers apart); the EPI-2 method in round-2-a-rea | adapt (logic only, no torch) | Wilson intervals for each (client, model, predicate class, label). Locator errors and unverifiable claims are counted separately, never as wrong | Apache-2.0, MIT | EPI-2 |
| Run record with input digests | `donors.md` row 24 (laya-coreml) | pattern | Record the verifier version, pack version, image digests, claims digest and artifact digest | Apache-2.0 | EPI-1, COR-5 |
| ProbeKey (cache and re-run key) | `rea.md` O5, plus the path-free `snapshotTarget` (`rea:src/domain/analysisSnapshot.ts:354-367`) [seen] | adapt | Key = (artifact digest, member digest, predicate, typed args, probe row version, image digest) | MIT | X-1 |
| Untrusted marking in the report | `donors.md` row 14 (T3 nonce envelope) and `rea.md` O3 marker | adapt | Values copied from the target carry `origin: target`. Wrapped in an envelope whenever an agent reads the report | MIT | X-2, N-3 |
| Converter from prose to claims (model-free) | **new, M** | new | Parses leanrea-style `seen (file:offset)` labels and backticked tokens. Output is `analyst-inference` only, tagged `extracted_by: converter@v`, and kept out of the agent's calibration | — | W-S2-4 |
| Verifier core: digest check, resolve, probe, compare, verdict, atomic write | **new, M**. The write follows `rea.md` O6 (atomic export) | new | Values are compared by canonical-JSON equality, as rea does (`KnownAnswerEvaluation.ts:117-124`) [seen]. A regex supplied by the agent is never accepted | — | N-1 |
| Conformance suite and golden vectors | `pi-durable.md` organ 16 (kit shape) and `rea.md` O20 | pattern | For each predicate, a true fixture and a planted false one. IDs must be byte-identical with a pinned rea | MIT | X-5, COR-1 |
| Evaluation harness for the kill criteria | `leanrea.md` L10, L11, with the X-9 fixes | adapt | Paired arms: Tier 0 against Tier 0 plus the addendum. Oracle-checked "correct and verified claims per dollar" | MIT | X-9, N-12 |
| Output adapters (SARIF; an in-toto Statement wrapper) | **new, S** | new, optional | Whether in-toto carries the record is [unknown] | — | PRV-4 |

## 4. Integration surfaces

- **CLI:** `verify` (claims plus artifact, giving `verification.s2.jsonl` and a summary); `convert` (prose to analyst-inference claims); `calibrate` (verification files to a report); `pack doctor` (which predicates run on this lane). Exit codes for CI, e.g. 2 when anything is refuted, 3 when unverifiable claims exceed a threshold.
- **MCP:** optional, a stdio `verify_claims` tool with no effects so an agent can check itself before answering. The CLI is enough, since Tier 0 has Bash. **SDK:** the S-2 reference library in TypeScript.
- **Storage: none.** Each run writes one output file named by `(claims digest, artifact digest, pack version)`. Calibration reads folders of these files; any index built from them is a disposable cache.
- **Identity and accounts:** the verifier calls no model and holds **no credentials**; nothing needs an API key. The agent runs in whatever official client the person already uses, on their own subscription or key, exactly as without this product. The product does not drive the client, so G-terms does not arise for it [inferred].
- **Other tools:** a CI step runs the CLI; the CI's existing attestation step can sign the output [inferred]; `dependency_version` claims can be cross-checked against an SBOM tool's output, recorded as provider Evidence; optional SARIF for code-scanning views.

## 5. Architecture sketch

```
 AGENT SIDE (not governed by the product)            VERIFIER SIDE (the product, model-free)
 official client + person's account                 TB-V1 claims parser: closed JSON, typed slots,
 Bash + leanrea skill + addendum (Tier 0)  claims →        predicate must be in the pack
 TB-A agent <-> target: UNENFORCED          + bytes  TB-V2 container: no network, read-only /in/<sha256>,
                                                           process-host per probe, rea pinned, effect allowlist
                                                     compare → verdict + Evidence (verified only)
                                                     coverage assembler (machine_observed / agent_reported)
                                                              │ verification.s2.jsonl
                                                              ▼
                                                     TB-V3 consumers: reviewer, CI policy, auditor,
                                                           calibration aggregator (values marked origin:target)
                                                     TB-V4 supply chain: pack version + image digests
```

**Trust boundaries:** TB-A is outside the product and C claims nothing there. TB-V1: the claims file is untrusted (the agent may have been injected). TB-V2: the artifact bytes are untrusted. TB-V3: the report carries target strings onward. TB-V4: the probes are third-party binaries.

## 6. The three critical gaps

**X-1 (identity): applies in part; two of the three keys are needed.**
- **ProbeKey** keys the cache and the determinism check; **ObservationId** identifies claim records and produced Evidence; **FindingKey is not needed**, because version-to-version claims are a scope cut in v1.
- The verifier always places the artifact at `/in/<sha256>`. That makes rea's nested `local_path` the same on every host, so this candidate's own IDs agree across hosts by construction [inferred]. It hides rea's defect rather than fixing it. The ObservationId fix is still needed so that Evidence IDs cited from elsewhere (for example a Tier 1 agent citing rea) can be compared.
- **Tests:** X-1 tests 1 and 2, limited to the pack's predicates (about 30–60, estimate) instead of rea's 208 tools.

**X-2 (untrusted content): simpler on the verifier side. Not handled on the agent side.**
- **The verifier side:** no model, no network, no effects other than writing its output file. Claim fields only fill typed slots (symbol names checked against a pattern, integer offsets, member paths resolved inside the extracted tree). A claim can choose the predicate, but only from the pack. Parser exploits are held in TB-V2. Target values in the report are marked `origin: target`.
- **The agent side** is Tier 0, so the agent's Bash session on the person's machine is exactly as exposed as it is without C. **C makes the check safe, not the work.** C has to be labelled "unenforced" for the agent session, and it is weaker here than a candidate that owns execution.
- **What C does catch:** an injection that plants a false `seen` claim is refuted, if the claim belongs to a checkable class.
- **Tests:** (a) adversarial claims files (shell metacharacters, `..` in member paths, offsets past the end, bidi text, duplicate keys) give 0 probes outside the allowlist and 0 reads outside `/in`; (b) for each of the ≥24 X-2 fixtures, verdicts match its clean twin apart from the planted values; (c) ≥95% of checkable planted false facts that agents adopt as `seen` are refuted.
- **N-3** (a second MCP server in the session) does not apply to the verifier. It applies fully to the agent session, which C does not govern.

**N-1 (store safety with several processes): does not apply.** There is no store. Outputs are written atomically and named by content, so two verifiers on the same input write identical bytes and on different inputs write different files. A calibration database, if the owner later wants one, must be a cache rebuilt from the files, opened by one process under an exclusive lock. **Test:** two concurrent verifiers on one input give byte-identical outputs and no partial file.

## 7. Other gaps

- **Resolved or not applicable:** X-3 and G-terms for the product (no model access); X-4 and N-5 (no store); X-10 (no spend); N-4 (no turn-loop durability is claimed); N-6, N-7 and N-11 (absurd and pi-ai unused); N-10, if redaction applies to the report and not to the Evidence projection.
- **Inherited:** X-5 (the S-2 library); X-6 (until the census exists, every absence claim is `unverifiable`); X-8 (reach per predicate; `codesign` entitlements not covered on Linux); SEC-1 (a smaller model, TB-V1 to TB-V4); SEC-6 (claims and reports carry secrets copied from the target; fingerprint any value matching a secret pattern); EPI-2 for the verifier's own probes; PRV-4/EVO-4; N-2; N-8 (on a macOS desktop the container needs Docker or a VM, otherwise `unverifiable`); N-12 (the skeptic's kill criterion compares against Tier 2).
- **Made worse, or new to C:**
  - **Durability.** Framing job 1, "investigations that survive", is dropped entirely.
  - **Agent-side AGT-1.** It stays at the parent's level, 1–2.
  - **C-1, emission compliance.** C depends on agents writing valid claims.
  - **C-2, cherry-picking.** Agents may emit easy, checkable trivia while the conclusion stays inferred. The summary shows, for each question item, whether any verified claim supports it.
  - **C-3, presence is not role.** A verified `contains_string` does not verify "this is the channel that starts detection".
  - **C-4, the agent's own feedback loop.** If the agent runs the verifier on itself, it can keep editing claims until they pass. The verifier records how many runs there were for each claims digest.

## 8. Target RQS-2030 levels (design intent, capped at 3; 3h = names the horizon mechanism)

**Profile: security-tool.** The main callers are CI and reviewers; it parses untrusted input and runs third-party probe binaries, never the target. `uses_llm` is not set for the verifier, because the agent belongs to the person. Weakest-parent figures are from [round-1-judge.md](../04-debate/round-1-judge.md) §2.

| Criterion | Target | Weakest parent | Note |
|---|---|---|---|
| REL-1\* | 3 (verifier) · U (the agent's work) | 2 (rea, leanrea) | Recovery means running again. Outputs are atomic. Kill-mid-run test. The agent's investigation is not claimed |
| INT-5 · COR-5 | 3h · 3h | 3 · 2 (leanrea) | ProbeKey and ObservationId; byte-identical outputs across hosts (K3) |
| EPI-1\* · EPI-2 | 3 · 3h | 2 · 3 | Agent claims get labels from a mechanical producer that is not their author. EPI-2 requires this ([gaps.md](../gaps.md)), and C meets it by construction. The probes themselves are calibrated on fixtures |
| EPI-3 · EPI-4 | 3h · 3h | 2 · 2 | A not-examined record kept apart from `agent_reported`. Absence claims are never verified before the census |
| COR-2 | 3h | 2 (leanrea L10) | False-verified and false-refuted rates are measured on planted fixtures (K2) |
| PERF-2\* | 3 | 1 (rea) | No catalog. The agent adds only the claims file (2–6 KB per answer, estimate). The verifier does not touch model context |
| AGT-1\* | NA (verifier) · 1–2 (agent session, unchanged) | 1 (leanrea) | The verifier cannot be pushed into acting. The agent is not protected |
| SEC-8 | 3 (container lane) · 2 (host only) | 1 (leanrea) | Reader budgets, process-host, pinned images, fuzzed readers |
| SEC-1\* · SEC-6 | 3h · 2 | 0 · 2 | Four boundaries. Report redaction is designed only on paper |
| AGT-6 · PRV-4 · EVO-4 | NA · U · U | — | No spend. CRA role and support period are owner decisions |
| EVO-3 | 2 | 1 (leanrea L6) | Linux container lane. macOS-only predicates are declared not covered |

## 9. What it beats the null option (S-1) on

**The capability:** an independent, model-free and re-runnable verdict on every `seen` claim an agent makes, however it reached the claim (plain Bash included), together with a record of what was not examined.

**Why S-1 cannot:**
- In S-1 Tiers 0 and 1, Bash claims are prose with labels that nobody grades (`leanrea.md` L4).
- rea writes Evidence only for its own calls. In the benchmark's REA arm, only 17 of 112 tool calls were rea tools (`leanrea.md` §4) [seen], so most claims there had no Evidence behind them.
- rea's evaluator checks claims only against configured fixture truth and against Evidence the agent was already given (`rea:src/evaluation/KnownAnswerEvaluation.ts:405-458`) [seen]. A real Evidence ID cited for a wrong value passes when no fixture covers it.

**Would upstream changes erase it? Mostly, yes.**
- rea already has the claim schema and the failure taxonomy. A `verify_claims` command upstream that re-runs probes would give S-1 Tier 1 most of C.
- What would remain: checking with an implementation other than the producer's (router pack plus several readers); the not-examined record built from the pack; the fact that **C needs nothing in the agent's path**; and ownership, as the judge's caveat states. The margin is narrow and mainly about who owns the change.

## 10. Trade-offs and risks

**Gains:** no cost added to the first answer apart from the claims file, so leanrea's turn saving is kept; any client and any account; no store, runtime or credentials; the smallest X-2 surface of the four candidates; a third party (an auditor) can re-run it. **Losses:** no durable investigations; no enforcement over the agent; no gate across versions; only claim classes with a probe; dependence on agents emitting claims.

**How large is the checkable share (estimate and method).** I classified the 25 keyed facts in leanrea's four tasks (`leanrea:bench/tasks.json:1-50`) by the predicate a static probe could check:
- 21 of 25 (84%) have an atomic core that can be checked for presence or as an attribute: an export, an import, a linked framework, a C string, a member file, buildinfo versions.
- The roles the questions ask about, such as "the channel that starts detection" or "how the peer is authenticated", are relations. Only the IPC pair (rea O11) has a static probe among them.
- 1 of 25 (use of a Unix socket) is partial: the imports can be checked, the use cannot. 3 of 25 (hash input, length prefix, JSON wire format) are protocol or behaviour facts with no static probe.

My estimate for real reports is that **45–70% of `seen` claims can be mapped** to a probe; four tasks cannot fix that number. K1 measures it: a labeller who did not write the pack splits real reports into atomic claims, and the metric is claims whose predicate has a covered probe on the lane divided by all `seen` claims, reported per class (presence, attribute, relation, behaviour, absence, interpretation).

**Risks:** C-1 to C-4 (§7). **Agreement by construction:** if the verifier runs the same `strings` the agent ran, it only confirms that the agent read the output correctly; different readers reduce this but do not remove it. **rea churn:** 38 releases with 12 BREAKING sections in 3 months (`rea.md` §4) [seen], reaching C only through pinned relation predicates.

**Trends through 2030–35:**
- **Better models produce more and cheaper answers, while a person's time per claim stays the same.** Checking costs CPU seconds per claim, whatever the model. Stronger models also follow structured-output instructions more reliably [inferred], so the checkable share and C's value grow as models improve. **The counter-case:** if models stop making presence errors, verification mostly says "verified". The value then moves to the not-examined record and to the relation and behaviour claims that C cannot check. A provider could also ship its own citation checking.
- **CRA and AI Act.** An independent re-run is stronger evidence of how a result was reached than the producer's own log [inferred]. C's own CRA role is still open.
- **Agents as the main callers.** The CLI and optional MCP tool let agents check themselves (with C-4).
- **More claims about runtime behaviour.** These need controlled replay, which runs the target, so effects and the full X-2 problem return. That stays out of v1.

## 11. Size

- **Owned code (estimate): about 7–10k lines plus fixtures, "M–L".** Vendored S-2 library about 3k; verifier core 1.5–2.5k; converter 0.6–1k; predicate pack of 30–60 rows, about 1–1.5k lines of data, each row with a true and a false fixture; tar/gzip reader 0.4–0.6k; calibration and report about 0.5k; container specification about 0.15k; harness about 0.8k. For comparison, S-2 alone was estimated at 3–5k.
- **Upstream:** rea as a pinned subprocess for relation and format predicates only (high churn, above); leanrea converted once and owned from then on (it has no versions, `leanrea.md` L13); process-host and probe tools pinned by image digest.
- **Maintainers (estimate):** one, plus part-time help keeping pack fixtures across formats and rea pin bumps. The fixtures, not the code, are the standing cost.

## 12. What would prove it wrong

- **K1 mappable share.** On at least 200 real agent reports (≥12 task types, ≥6 formats, ≥2 clients or models), kill if fewer than 50% of `seen` claims map to a covered probe (the skeptic's threshold), or if fewer than 40% of the oracle's key facts per task are supported by a verified claim.
- **K2 verifier error.** On at least 300 labelled claims, half true and half planted false, a predicate whose false-verified rate has an upper 95% bound above 2%, or whose false-refuted rate has one above 5%, is demoted. Kill the candidate if more than 20% of predicates are demoted.
- **K3 determinism.** Two hosts, the same pack and the same input. Kill if more than 0 static claims get different verdicts, or if the output bytes differ.
- **K4 converter** (S-2's own falsifier). Kill the converter, and make structured emission mandatory, if on prose answers it recovers less than 60% of the `seen` claims a human labeller finds, or more than 20% of its extracted claims are refuted because of extraction errors.
- **K5 emission.** Kill if fewer than 80% of runs produce a valid claims file with the addendum, on the two main clients.
- **K6 overhead.** Kill if the addendum raises Tier 0's cost per correct answer by more than 15% (upper 95% bound, 60 paired cells, X-9 protocol), or if verification takes more wall time than a Tier 2 run or more than 120 s median for a report of ≤30 claims on the Linux lane (estimate).
- **K7 usefulness.** In a reviewer study (at least 20 reports, reviewers blinded to the arm), kill if verification changes no review decision **and** fewer than 1% of `seen` claims are refuted. C would then be attestation only, which S-2 plus an upstream rea change already gives.

## 13. The owner decisions it depends on

[06-options.md](../06-options.md) has not been written yet. The numbers below refer to [round-2-judge.md §4](../04-debate/round-2-judge.md).

- **Judge #3, provider terms:** does not bear on the product; it applies only if a team runs its agents in CI, which is that team's own setup.
- **Judge #5, Windows:** the verifier runs in a Linux container, where static PE claims are covered. **Judge #6, host-only parsing on macOS:** allowed as a declared SEC-8 2 lane, or such claims become `unverifiable`. **Judge #9:** CRA role and support period.
- **Judge #10, the rendered skill:** for C it is the whole agent-side surface, so it must be kept and versioned.

**Decisions specific to C:**
1. Is the prose converter in scope (K4), or is structured emission mandatory?
2. May CI block a merge on a refuted claim, or does a refuted claim only warn?
3. May calibration figures for each model or provider be published?
4. Should dynamic predicates (controlled replay, `authority: controlled-replay`) ever be added? They bring back effects and the full X-2 problem.
5. Offer `verify_claims` to rea upstream first, as in candidate D, and build C only if that is declined?
6. Is a candidate that uses only rea and leanrea (plus pi-durable's test-kit shape) an acceptable answer to the charter's question of combining all four?
