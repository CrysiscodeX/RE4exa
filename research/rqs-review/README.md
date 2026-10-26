# RQS-2030 re-review: fourteen repositories and RE4exa

Fifteen targets were scored against [RQS-2030](../../standard/RQS-2030.md): the fourteen
repositories in the task and RE4exa itself. Each review covers 62 criteria, a gap sweep
(lenses G1-G14), an opportunity sweep (O1-O14) and a re-engineering plan. The results are in:

- [`tables.md`](tables.md): the dimension table, and every criterion for every target.
- [`reports/`](reports): one report per target.
- [`results.json`](results.json): everything in machine-readable form.

The **Review Bench** page lets you score a repository with the same formulas and browse these
results ([`page/`](page)).

## How the reviews were made

- **Evidence.** `rqs probe` ran 85 inert probes on each checkout (shallow clones at the commits in
  [`probes.jsonl.gz`](probes.jsonl.gz)); `rqs template` turned them into suggested levels.
- **Review.** Ten independent reviewer agents worked in parallel from the same [brief](BRIEF.md).
  Each read the code and docs and set every applicable criterion with evidence (file:line,
  command output or measurement). No automatic level was left in any review: 886 numeric levels,
  1 U and 43 NA in total.
- **Agreement check.** A blind second reviewer re-scored 16 criteria for absurd, caveman and
  t3code without seeing the primary reviews ([`second/`](second)).
- **Self-review.** RE4exa was reviewed by an adversarial reviewer, because the same system
  wrote the standard, the tools and this study.
- **Scope.** All reviews are static: nothing in the targets was built or run. Runtime numbers
  come from earlier measured studies where cited.

## Results

| Target | Profile | Grade | QI | HRI | Blocking weaknesses |
|---|---|---|---:|---:|---|
| caveman | agent-tool | C | 59.3 | 4.9 | – |
| rea | agent-tool | C | 58.5 | 18.0 | – |
| pi-durable | agent-harness | C | 57.5 | 14.4 | AGT |
| ponytail | skill-pack | C | 56.4 | 4.2 | – |
| laya | ml-system | C | 54.5 | 9.0 | – |
| t3code | agent-harness | C | 54.4 | 9.0 | – |
| laya-coreml | ml-system | C | 53.1 | 6.6 | – |
| orca | agent-harness | C | 51.2 | 9.0 | SEC, AGT |
| strix | security-tool | D | 47.5 | 3.3 | – |
| absurd | workflow-engine | D | 44.7 | 4.7 | SEC |
| pandacode | agent-harness | D | 44.2 | 1.6 | AGT |
| leanrea | skill-pack | D | 40.3 | 0.0 | – |
| re4exa (at 0bdc987) | agent-tool | D | 38.1 | 0.0 | COR, SEC |
| my-jev | ml-system | D | 35.7 | 0.0 | COR |
| agent-sandbox-lockdown | security-tool | E | 30.8 | 0.0 | COR, SEC, AGT, EPI |

How to read the columns:
- **QI** is the Quality Index, 0-100.
- **HRI** is the Horizon Readiness Index: the share of the 2030-35 bar already met.
- **Blocking weaknesses** are dimensions weighted at least 2.5 in the target's profile that score below 2.

Evidence coverage is 98-100% for every target. Per-dimension scores are in [`tables.md`](tables.md).

## What the numbers say

**1. Nobody is at the 2030-35 bar.**
- No target reaches grade B. The mean QI is 48.4 and the mean HRI is 5.6.
- Of the 886 numeric levels, 47.7% meet today's good practice (level 3 or above), 94 are level 4,
  and only 4 are level 5:
  - REA: lifecycle hygiene and diagnostics.
  - pi durable: enforced module boundaries.
  - absurd: telemetry consent, since it has no telemetry at all.

**2. The widest gaps are dated obligations.** These are the weakest criteria:

| Criterion | Mean level | At level 3 or above | Why it matters |
|---|---:|---:|---|
| PRV-4 Regulatory readiness | 0.69 | 0 of 13 | EU CRA reporting applies since 11 Sep 2026; main obligations from 11 Dec 2027 |
| EVO-4 Support commitments | 1.08 | 1 of 13 | The CRA requires a declared support period |
| COR-3 Test strength is measured | 1.13 | 1 of 15 | Mutation, property and fuzz testing are rare |
| SUS-1 Maintainer resilience | 1.33 | 0 of 15 | Every target has thin or no governance |
| SEC-1 Security policy and threat model | 1.47 | 6 of 15 | Nine of the fifteen ship no SECURITY policy file |
| SEC-4 SBOM and VEX | 1.50 | 1 of 12 | Only caveman meets it (CycloneDX SBOMs per release) |
| SEC-9 Post-quantum readiness | 1.71 | 0 of 7 | NIST IR 8547 (draft) deprecates quantum-vulnerable algorithms after 2030 |

One reusable release pipeline would lift most targets on PRV-4, EVO-4, SEC-1, SEC-3 and SEC-4
together. It would produce an SBOM, VEX, provenance or signatures, a SECURITY.md, a support
statement and a regulatory position. caveman already has most of these parts.

**3. Agent harnesses default to maximum agency.** All four agent-harness targets start agents
with broad powers:
- orca passes every agent's permission-bypass flag and pre-writes folder trust.
- t3code and pandacode start new tasks in Full access. pandacode's docs say the opposite.
- pi durable enables every extension and passes the full host environment to model-chosen commands.

AGT-2 (least agency) averages 1.86 and AGT-1 (prompt-injection resilience) 1.93. Most of the
parts needed to fix this already exist in the reviewed set:
- REA's per-tool effect declarations.
- t3code's nonce-tagged framing of untrusted text.
- agent-sandbox-lockdown's deny-by-default egress layer.
- orca's VM recipes.
- laya and my-jev's calibrated typed decisions, for routing approvals.

**4. The most common gaps are claims versus evidence and the supply chain.** Of the 148 gaps,
1 is critical, 31 high, 84 medium and 32 low. The most-used lenses:
- G1 claims versus evidence: 24.
- G9 supply chain and CI: 24.
- G10 compliance horizon: 19.
- G8 static/dynamic blind spots: 14.
- G11 agent-user gaps: 14.

Typical cases are headline numbers with no committed harness (laya's 0.766, ponytail's review
benchmark figures, caveman's 33.2% and 54%, which its own docs say have no harness in the repository) and docs that contradict code (pandacode's Ask
default, orca's sandbox wording). Supply-chain cases are GitHub Actions pinned by tag (orca 15 of
570 references pinned by SHA, t3code 20 of 116, absurd 0 of 37) and unsigned checksums.

**5. Red lines.** Only RE4exa had confirmed red lines:
- **No LICENSE.** Still open: choosing a licence is the owner's decision.
- **`rex import` built SQL names from file content.** Fixed after the review (see below).

Near misses, all scored 1 rather than 0:
- agent-sandbox-lockdown declares MIT in its README but has no LICENSE file.
- Its URL tool reads any scheme.
- orca and t3code make claims without sources.

No target crossed the telemetry red line. Telemetry is on by default in orca, t3code, strix and
caveman, but each discloses it and none collects user content.

**6. Where to learn from.** These are the targets that score best on each criterion:

| Area | Best evidence in the set |
|---|---|
| Lifecycle, diagnostics, evidence | REA (REL-4 5, OPS-1 5, EPI 3.68): evidence records, doctor, coverage |
| Boundaries and durability | pi durable (MNT-1 5, REL-1 4), t3code (leased outbox, receipts, 91 replay fixtures) |
| Supply chain | caveman (CycloneDX SBOMs, cosign, govulncheck, OpenSSF Scorecard, honest-numbers rules) |
| Coverage accounting | strix (`coverage.json` separates tested-clean from unexamined) |
| Measured claims and energy | laya-coreml (every checked headline number matches committed results, 0.154 J per decision) |
| Benchmark hygiene | ponytail (README headline reproduces from the per-task table with intervals), leanrea (totals reproduce; paired bootstrap 0.63 [0.51-0.76] vs REA) |
| Safe loopback MCP host | pandacode (bearer token, Host check, size and rate limits) |

## Opportunities across repositories

85 opportunities were recorded. Priority is value x reach x confidence x horizon fit / effort.
These are the highest:

| Priority | Target | Action | Opportunity |
|---:|---|---|---|
| 16.3 | rea | re-cut-interface | Compact catalog by default, output schemas on request (default `tools/list` is 3,158,368 bytes) |
| 13.0 | caveman | extract | The CCR recovery store (content-addressed, SQLite WAL, idempotent) as its own package |
| 13.0 | strix | extract | The coverage-accounting record as a shared standard |
| 10.8 | re4exa | refactor | Scoring parameters as data in the standard (done, see below) |
| 9.6 | ponytail | extract | The codebase map and reuse detector |
| 9.6 | pandacode | extract | The hardened loopback MCP host |
| 9.0 | pi-durable, orca, absurd | harden | CRA evidence (SBOM, VEX, provenance, security and support statements) from existing release pipelines |
| 8.96 | rea | extract | The effect vocabulary and untrusted-content marker as a policy for agent hosts |
| 8.8 | orca | extract | `@orca/process-host` (no runtime dependencies, process-tree termination) as a package |
| 8.32 | laya | re-cut-interface | The typed-decision record as a versioned JSON Schema |
| 8.32 | agent-sandbox-lockdown | extract | The egress layer as a reusable compose module |

Taken together, the reviews converge on eight foundation components. Most already exist in
one of the reviewed repositories and are held back by their host. The pieces are reused, not
written again; RE4exa's rex, dissect and rqs only show how they fit together.

| Foundation | Built from | What it fixes across the set |
|---|---|---|
| F1 Evidence record and retrieval handle | REA `evidence_id`, caveman CCR, strix tool-output spill, rex bundles | One content-addressed id for an observation, a cached result and a citation (G6, EPI-1) |
| F2 Coverage record | strix `coverage.json`, rex coverage, REA residual unknowns | "Not found" separated from "not examined" (EPI-3, EPI-4) |
| F3 Durable execution kernel | absurd (Postgres claims), pi durable (SQLite), t3code outbox and receipts, orca orchestration ledger | Four implementations of idempotent steps; one interface with storage adapters, and the exclusive lease pi durable lacks (REL-1) |
| F4 Safe-by-default agent execution | REA effect declarations, t3code untrusted framing, agent-sandbox-lockdown egress, orca VM recipes, `@orca/process-host`, laya/my-jev decisions | The full-access defaults in all four harnesses (AGT-1, AGT-2, AGT-3) |
| F5 Agent interface economy | REA compact catalog, rex 4.3 KB catalog, orca `nextSteps` errors, pandacode schemas | Catalog cost (REA 833k tokens, t3code about 38 KB of tool text) and repairable errors (PERF-2, INT-3, INT-4) |
| F6 Calibrated decisions | laya typed decisions, laya-coreml energy and hash identity, my-jev ECE, rex calibrate | ECE is implemented twice with different results; one schema and one calibration module (EPI-2) |
| F7 Compliance pipeline | caveman release workflow, laya scanners, orca signing | The CRA and SBOM gaps above (PRV-4, EVO-4, SEC-1, SEC-3, SEC-4) |
| F8 Verification as a product | t3code replay fixtures, pandacode recorded frames, ponytail benchmark hygiene, orca reliability gates, answer keys | Claims without harnesses (G1, PUR-2, EPI-5) |

The reviews also name 129 cross-repository relations: a gap or opportunity in one target that
names another. They are loaded into the dissection graph by [`load_graph.py`](load_graph.py),
next to the code-level knowledge graph, so the clusters above can be queried:

```bash
python3 research/rqs-review/load_graph.py <dissection.db>
tools/dissect/dissect.sh --db <dissection.db> query "select c.name, round(avg(e.weight),2) from edge e join node c on c.id=e.dst where e.kind='scored' group by c.name order by 2 limit 7"
```

## How far to trust this

- **Inter-rater agreement.** On 47 paired criterion scores, the blind second reviewer agreed
  exactly on 70.2% and within one level on 95.7% (quadratic-weighted kappa 0.80).
  - absurd: kappa 0.88.
  - t3code: kappa 0.93.
  - caveman: kappa 0.30. The two reviewers differed by two levels on INT-1 (3 vs 5) and EVO-1
    (2 vs 4). The second reviewer credited caveman's protocol negotiation and 12-month
    compatibility window more.
- **Automatic suggestions.** Compared with the reviewers' levels, rqs suggestions matched
  exactly on 49.2% of 593 pairs and within one level on 91.4%. Reviewers scored 0.21 levels
  higher on average.
  - Least reliable: COR-2 independent oracles (+0.93), EPI-2 calibration (+0.92) and SEC-8
    parsing safety (+0.83). Here the probes under-read, because the evidence is semantic.
  - Over-read: EVO-3 platforms (−0.82) and COR-3 test strength (−0.80).
  - Most reliable: EVO-1 (82% exact), SEC-2, SEC-7, MNT-4 and AGT-1 (73%).
- **The reviewers.** All are AI agents of one model family, so their biases are correlated. The
  agreement figures measure consistency, not correctness. Static review cannot see runtime
  behaviour, and shallow clones hide history (SUS criteria).
- **Profiles.** Profile choices shift QI by a few points. pi durable is 57.5 as an agent-harness
  and would be 62.0 as a workflow-engine.

## What changed in RE4exa after its review

The adversarial review is kept as written, for commit `0bdc987`. These changes were made since:

| Finding | Change |
|---|---|
| RL-4: `rex import` built SQL table and column names from the bundle | Names must exist in the schema. Question ids must match their text. Answers must keep their hash chain, cite stored evidence and respect the confidence guard. A hostile-bundle test was added |
| Claims that disagreed with results (4.0 s vs 4.48 s; unmeasured rex numbers; "measured fixes" that were not measured) | Re-measured with [`measure_rex.py`](../dissection/measure_rex.py) ([results](../dissection/results/rex-measurements.json)); READMEs now match; proposals are labelled as such |
| Undeclared PyYAML; dissect tests failing on a clean checkout | PyYAML is optional (a built-in reader agrees with it on 273 of 274 workflow and SKILL.md files here); missing parser helpers are reported, not fatal; tests pass without PyYAML or node |
| No CI | [`.github/workflows/tests.yml`](../../.github/workflows/tests.yml): read-only token, no third-party actions; first run green |
| Hard-coded scoring constants | Standard 1.1.0 holds them as data (`scoring.parameters`, red-line `max_level`); rqs and the page read them |
| rqs matching its own rule tables; prose counted as practice | rqs 1.1: `.rqs-ignore`, prose reported separately, results and answer keys found, SQL-from-strings signal. Re-probing the 14 external targets left suggestion accuracy unchanged (48.8% to 47.6% exact). The fixes remove false evidence, not reviewer disagreement |
| No LICENSE (RL-1), single maintainer | Open: these are the owner's decisions |

## Corrections after publication

- **leanrea router size.** `reports/leanrea.md` (opportunity O9) says "19-row router". SKILL.md has 18 data rows (lines 38-55). The report is generated from the review, so the correction lives here. See [docs/profiles/leanrea.md](../../docs/profiles/leanrea.md) (2026-10-26).

## Files and reproduction

| File | Contents |
|---|---|
| [`BRIEF.md`](BRIEF.md) | The reviewer brief, as sent |
| `reviews/*.review.json`, `second/*.review.json` | The reviews (input to `rqs score`) |
| `probes.jsonl.gz` | The rqs 1.0 probe documents the reviewers used |
| `reports/*.md`, `tables.md`, `results.json` | Generated by `synthesize.py` |
| `load_graph.py`, `dissect-targets.sh` | The review graph in a dissect database; dissection of the five added targets |
| `page/` | Review Bench template, its notes and its build script, which checks the page's scorer against rqs |

```bash
python3 research/rqs-review/synthesize.py          # reports, tables.md, results.json from reviews/ and probes.jsonl.gz
python3 research/rqs-review/page/build_page.py     # page/review-bench.html
tools/rqs/rqs.sh score <(zcat research/rqs-review/probes.jsonl.gz | sed -n 1p) research/rqs-review/reviews/absurd.review.json
```
