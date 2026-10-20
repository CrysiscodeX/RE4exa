# Reviewer brief: RQS-2030 re-review of 14 repositories and RE4exa

Each review applies [RQS-2030 v1.0.0](../../standard/RQS-2030.md) to one target and writes one
review file. The same brief went to every reviewer (independent agents, run in parallel, each
blind to the others' files).

## Inputs

| Input | Where |
|---|---|
| Standard (people / tools) | `standard/RQS-2030.md`, `standard/rqs-2030.json`; `tools/rqs/rqs.sh criteria --id X` prints one criterion |
| Lenses and actions | `tools/rqs/rqs.sh lenses` (G1-G14, O1-O14, OPP-1..7, re-engineering actions) |
| Automated evidence | `rqs probe` output per target (84 probes; `found: false` means "not found in the scanned files") |
| Review template | `rqs template` output per target: every applicable criterion prefilled with a suggestion marked `"source": "auto"` |
| Prior notes | Earlier deep reads and lens experiments. They are leads to verify, not evidence |
| Target checkout | `GitHub_Repos_Dump/<owner>__<repo>` (shallow clones at the commits in the probe files) |

## What a review must contain

1. `profile` and `flags` set deliberately, with a one-line reason in `scope_notes`.
2. Every applicable criterion scored: `level` (0-5, `U`, or `NA` with a reason), `confidence`
   (observed / derived / inferred), `evidence` (file:line, a command and its output, or a
   measurement), a short `note`, and `"source": "review"`. No `auto` entries may remain.
   Use `U` when the evidence is not there; never guess a level to avoid it.
3. An explicit decision on each red-line criterion (SEC-6, SEC-7, EPI-5, PRV-1, PRV-3) and on
   every `suspected_red_lines` entry in the automatic scorecard.
4. Gaps (5-12): lens id, title, case (file:line or a reproduction), impact, fix, severity
   (critical / high / medium / low). No case, no finding.
5. Opportunities (3-8): lens, OPP criterion, title, description, value 1-5, reach 1-5,
   confidence, horizon_fit 1.0-1.5, effort 1-5, action, evidence. Cross-repository
   consolidation or composition with other reviewed repositories is in scope.
6. Re-engineering (2-5): action, component, expected gain, how the gain is measured.
7. `questions` the review answered, `not_examined`, `time_minutes`, and
   `reviewer: {id, kind: "agent", conflicts}`.

## Rules

- Static review: read files, run `rqs`, `git`, `rg`, `jq` and similar read-only tools. Do not
  install, build or run the target's code, and change nothing in the target checkout.
- Score what ships at the reviewed commit, not roadmaps.
- Security findings stay defensive: the missing or weak control, where it is, the impact
  category, and the fix. No exploit steps, payloads or bypass techniques.
- No style preferences, no "consider ..." findings, no marketing language. Numbers carry
  their source.
- Validate the file with `tools/rqs/rqs.sh score <probes> <review> --out <tmp card>`; it must
  score without errors and report `auto_share` 0.
- Do not read other reviewers' files.
