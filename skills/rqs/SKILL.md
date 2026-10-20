---
name: rqs
description: Review a software repository against the RQS-2030 quality standard - score 62 criteria across purpose, correctness, reliability, efficiency, security, agent safety, interfaces, epistemic integrity, maintainability, evolution, operability, privacy/licensing and sustainability; find gaps and hidden opportunities (extract, consolidate, re-platform, re-cut interfaces); produce a scorecard and report. Use when asked to judge, audit, compare or improve a repository, decide what to adopt or rebuild, or prepare a project for 2030-35 expectations. Not for reviewing a single diff.
---

# rqs: quality reviews against RQS-2030

The standard is `standard/RQS-2030.md` (people) and `standard/rqs-2030.json` (tools). Each
criterion has a question, why it matters, and anchors for failing (0-1), today's good
practice (3) and the 2030-35 horizon (5). Run `tools/rqs/rqs.sh <command>` or `rqs mcp`.

## Workflow

1. **Scope.** Note the target, commit, profile (agent-tool, agent-harness, skill-pack,
   workflow-engine, security-tool, ml-system, application) and the questions the review must
   answer. For a package in a monorepo, probe the package with `--inherit <repo root>`.
2. **Evidence.** `rqs probe <repo> --out probes.json`. Read the brief view; open the cited
   files for anything that will change a level.
3. **Template.** `rqs template probes.json --out review.json`. Every entry starts as
   `"source": "auto"` with the rule that produced it in `note`.
4. **Score.** For each criterion read its anchors (`rqs criteria --id X`), check the evidence,
   set `level`, `confidence`, `evidence` (file:line, command and output, or measurement) and
   `"source": "review"`. Use `U` when you could not establish it; use `NA` only with a reason.
5. **Gaps.** Apply the gap lenses (`rqs lenses --kind gaps`, G1-G14). Each gap needs a case
   (a reproduction or file:line), the impact, a fix and a severity. No case, no finding.
6. **Opportunities.** Apply O1-O14 and the OPP criteria: what to extract, consolidate,
   substitute, delete, re-platform, re-cut or standardize. Give value, reach, confidence,
   horizon fit and effort; `rqs score` computes the priority.
7. **Re-engineering.** Choose the least disruptive action that fixes the root cause, with the
   expected gain and how it will be measured.
8. **Score and report.** `rqs score probes.json review.json --out card.json`, then
   `rqs report card.json`. Compare several targets with `rqs compare cards/*.json --md`.

## Rules

- Cite evidence for every level; prefer observed over inferred. Score what ships today.
- U is honest. Do not pick a level to avoid it; low coverage is reported, not hidden.
- Confirm or reject every automatic red-line suspicion (`suspected_red_lines` in the scorecard).
- No style preferences and no "consider ..." findings.
- Keep security findings defensive: name the missing control, where, the impact and the fix.
  Do not write exploit steps or bypass techniques.
- Disclose conflicts of interest. A review of your own work needs an independent second
  reviewer; compare with `rqs agree` and report the agreement.
