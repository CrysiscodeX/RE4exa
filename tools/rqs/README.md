# rqs

Evidence-first quality reviews against [RQS-2030](../../standard/RQS-2030.md), for agents and
people. `rqs probe` collects automated evidence from a checkout (85 probes, inert); `rqs template`
turns it into a review file with suggested levels; a reviewer confirms or changes each level
with evidence and adds gaps, opportunities and re-engineering actions; `rqs score` applies the
standard's formulas, red lines and gates; `rqs report` and `rqs compare` render the results.

```bash
./rqs.sh probe /path/repo --out probes.json            # brief view printed, full evidence saved
./rqs.sh probe /mono/packages/x --inherit /mono --out probes.json   # a package inside a monorepo
./rqs.sh template probes.json --out review.json        # suggestions marked "source": "auto"
#   edit review.json: level 0-5|U|NA, confidence, evidence; set "source": "review"
./rqs.sh score probes.json review.json --out card.json [--second other-review.json]
./rqs.sh report card.json > report.md
./rqs.sh compare cards/*.json --md                     # heatmap of dimensions and criteria
./rqs.sh agree review-a.json review-b.json             # inter-rater agreement (weighted kappa)
./rqs.sh criteria --dimension SEC --brief              # the standard, queryable
./rqs.sh lenses --kind opportunities
./rqs.sh mcp                                           # MCP stdio server, 8 tools
python3 -m unittest discover -s tests                  # 23 tests
```

Standard-library Python 3.11+. No dependencies, no network, no telemetry. The standard is read
from `standard/rqs-2030.json` in this checkout, or from `$RQS_STANDARD`.

## What the numbers mean

| Output | Meaning |
|---|---|
| Level 0-5, U, NA | Per criterion. 3 = today's good practice, 5 = the 2030-35 horizon anchor. U = not enough evidence (never a pass). |
| Dimension score | Weighted mean of known levels: core criteria x2, confidence weights observed 1.0, derived 0.9, inferred 0.6. |
| Quality Index (QI) | 20 x profile-weighted mean of dimension scores, 0-100. |
| Horizon Readiness (HRI) | Share of the 2030-35 bar already met: level 5 counts 1, level 4 counts 0.5. |
| Evidence coverage | Known / applicable criteria. Below 60% the grade is provisional (`?`) and capped at C. |
| Red lines | No license, live secrets, telemetry without consent, injection-prone operations on untrusted paths, claims contradicted by measurement. A confirmed red line caps the grade at D. |
| Automatic levels | Share of levels that came from probe suggestions and were not reviewed. |

## How far to trust the probes

Probes read files and git metadata; they never run the target. Each result says whether it is
`observed` (a file or manifest fact), `derived` (a pattern count by a stated rule) or `inferred`
(a heuristic reading of meaning). `found: false` means "not found in the scanned files", and the
scan reports what it skipped (vendored trees, binaries, files over 1 MB, generated code).
Known blind spots: CI that runs tests through wrapper scripts, tests inlined in Rust sources
(counted separately), shallow clones (no history), and any behaviour that only shows at runtime.
Automatic red-line suspicions are reported but do not cap a grade until a reviewer confirms them.

Practice probes (fuzzing, mutation testing, isolation, accessibility tooling) count code, config
and CI only; mentions in prose are reported separately as `in_docs`. A repository whose own files
would match rqs's patterns without being practice (rule tables of analysis tools, vocabularies)
can list them in `.rqs-ignore` (fnmatch patterns or directory prefixes). Ignored files are still
inventoried and are listed in the probe output under `ignored_by_rqs_ignore`, so a reviewer can
see what was left out.

On the fifteen reviewed targets (research/rqs-review), suggested levels matched the reviewers'
levels exactly on 49% of criteria and within one level on 91%. Treat them as a starting point.
