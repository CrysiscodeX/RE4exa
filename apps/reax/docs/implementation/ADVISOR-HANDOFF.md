# Advisor handoff

Read this first when a new conversation takes over advising on RE4exa. It says how the work is run
and where everything is. It holds no counts: take every number from the files named below.

## How the work is run
- **The builder** is a Claude Code CLI session on the user's MacBook, in auto mode, in `~/RE4exa`.
  It acts as the Orchestrator and runs three subagents defined in `.claude/agents/`: task-master,
  coding-agent and reviewer-debugger.
- **The advisor** (a separate conversation, often a cloud session on the same branch) reads the
  CLI's pasted reports, checks them against the repository, and gives the user the next command
  to paste. The advisor may commit to the branch too. Its pushes make the CLI pull with
  `git pull --no-rebase` before its next push.
- **The user** pastes commands into the CLI, answers its questions, and runs the steps agents may
  not do: anything touching the real home folder, `claude mcp add`, and live runs with their own
  Claude account.
- **The branch** is `claude/admiring-volta-uc87nj`. There are no pull requests.

## Where the state is
| Need | File |
|---|---|
| Standing rules (hard limits, loop, verdicts, proof, checklist) | `CLAUDE.md` at the repository root |
| What is done, active, next, parked; open follow-ups; incidents | `EXECUTION-STATE.md` (this folder) |
| Every decision, D-1 onwards, with the user's words | `DECISION-LOG.md` |
| Breadth items and their status | `BREADTH-COVERAGE.md` |
| Row counts (generated; never edited by hand) | `CAPABILITY-MATRIX.md` |
| Per-item review history and costs | `AGENT-SCORECARD.md` |
| Work outstanding after 0.1.0 | `FULL-IMPLEMENTATION.md` (written in milestone item M5) |
| Parked work | `apps/reax/docs/parked/*.patch`, each with its base commit and last findings |
| The Mac first-run runbook | `apps/reax/docs/FIRST-RUN-MAC.md` (written in M4) |
| A visual status page for the user | the reax Readiness Report artifact, https://claude.ai/artifact/TD5Qbswhj4bRPETfcJC5vf |

## The current direction
- **Milestone:** the Mac first run, reax 0.1.0 (D-57): M1 `reax mcp`, M2 the `reax` command and
  install rehearsal, M3 `reax doctor`, M4 the runbook and its path test, M5
  `FULL-IMPLEMENTATION.md`. Then the version commit, and stop.
- **Working style (D-58):** reviews fail only on blockers; reversible choices are decided without
  asking; each item has a 4-hour time box; low-risk changes get one review pass. The hard limits in
  `CLAUDE.md` §1 are unchanged.
- **After 0.1.0:** re-triage the parked items under the severity rule, then SBX-W (Windows engine
  enforcement, design first), then Wave 3 of the breadth plan.

## How to advise
- Check claims against the branch (`git fetch`, then read the files), not only the pasted report.
- Give one recommendation, then a command in a single copy-paste block. Keep the command short and
  calm; long all-capitals directives have been stopped by safety classifiers before.
- After each command, name the two or three things to check in the next report.
- Report rows as covered and tested-partial separately (D-30).
- The user wants plain, direct answers: no praise, no marketing language, no sugar-coating.
