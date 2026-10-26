# 0001. Ledger files are JSONL per source, and status exists only in CI output

Status: accepted (phase 0b). Deviates from plan §1 and §2 in the two points below.

## Context

The plan asked for one YAML file per family, and for `parity-check.ts` to rewrite each row's
status into the ledger, with a drift check in CI and a committed `docs/parity.md` summary.

## Decision

1. **Format.** One JSONL file per source (`limitations/{rea,leanrea,donors}.jsonl`,
   `parity/{rea,leanrea,reax}.jsonl`), one row per line, sorted by key in natural order.
   - A change to one row is a one-line diff, and two agents changing different rows merge cleanly,
     which was the reason for one file per family.
   - JSON needs no parser dependency (YAML would be the app's first) and has one canonical form.
   - New sources get new files; nothing requires one file per family.
2. **Status is never written to the repository.** `parity-check.ts` computes it from the JUnit
   reports of the lanes in one CI run and writes `reports/parity.md` and the job summary.
   - A committed status would be the result of one run on one set of lanes. It would go stale on
     the next commit, and a drift check would fail every time a test is added, or pass with
     numbers nobody re-derived.
   - Nothing hand-editable says "covered": the only way to change a status is to change a test.
   - `docs/parity.md` is therefore not committed; the CI report is the published summary.

## Rules this sets

- Tags: `[+KEY]` in a test name is a positive test for row KEY, `[-KEY]` a negative or limit test.
  A tag naming no row fails the check.
- A skipped or todo test counts as not run. A failing tagged test makes the row `regressed`.
- A row is `covered` (`fixed` for a limitation) only when, on every platform the row names, a
  lane of that platform ran in this CI run with at least one passing `[+KEY]` and one passing
  `[-KEY]` test, and any operation the row names is in `docs/operations.md`.
- Lanes are named `<platform>[-suffix]` (linux, darwin, win32, linux-engines), from the report's
  file name.
- Rows the seeder owns are refreshed from the profiles; triage fields survive a re-seed. A row whose
  profile entry disappears is marked `orphaned` and fails the check until someone reviews it.
- The phase 0b gate checks reax's own rows (`--gate-phase 0 --gate-kind reax-infra`). The full
  phase 0 gate adds leanrea's benchmark rows (LEAN-C49..C59) once the phase 0c harness exists.

## Consequences

- Limitation rows carry `phase: null` until triaged, and the report counts triaged rows, so an
  untriaged register is visible rather than silently ungated.
- Locally, `npm run test:lane` writes only this platform's report, so every row stays `partial`;
  only CI, with all three lanes, can mark a row covered.
