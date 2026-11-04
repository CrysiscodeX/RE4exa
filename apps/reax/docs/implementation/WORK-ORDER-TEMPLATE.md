# Work-order template

The Task Master writes every work order in this shape (`.claude/agents/task-master.md`). The
Coding Agent implements it; the Reviewer-Debugger gets the same work order, including the
adversarial-case list, and checks every item in it.

1. **ID and goal:** one item from `EXECUTION-STATE.md` **Next**, and what it delivers.
2. **Ledger keys:** the rows it covers (`[+KEY]` and `[-KEY]` tests for each), and any `deferred`
   platforms (D-30, D-33).
3. **Scope:** the files likely touched; what is out of scope (always: anything outside `apps/reax`,
   `.github` unless stated, the real home directories in **Hard limits**).
4. **Independent oracle:** the answer key and the tool that makes it, which shares no code with the
   tool reax runs; how CI re-derives it (`scripts/oracle.ts --check`).
5. **Adversarial cases (required when the code parses an external tool's output; D-36).** List each
   case up front, with the test that covers it, the new test to add, or why it cannot arise for this
   tool (with evidence). The reviewer mutation-checks the guard behind each one.
   - truncated output (including output that is cut and still reported complete);
   - missing sections or records;
   - ambiguous lines (newlines, separators, control bytes in names);
   - records split across lines;
   - entries starting inside another entry;
   - differences between the local tool version and CI's (which fields are compared, which are
     labels; how `--check` in CI confirms it);
   - amplification through shared references (one object or array reached by several paths:
     counted, cut and reported once per path, never changed for the others silently) (D-54);
   - caps that must advance on every item examined (each loop, search or retry makes progress or
     stops, and an item already handled is not revisited) (D-54);
   - total output size against the 1 MiB response budget (the final result, notes and
     limitations included, re-measured after every cut) (D-54).
6. **Mutations that must die (D-47):** at most 15 mutants, each a guard whose removal or inversion
   a test must catch. For each mutant, name the test files that cover the changed code; the mutant
   runs only those files, not the full suite. The full suite runs once at the end.
7. **Acceptance criteria and the commands that prove each:** at least `npm run` pre-push (as in
   the repository's hook), the named tests, `scripts/status.ts --check`, and CI green on every
   platform the rows name, including the fixtures job's oracle check. Every test command carries a
   hard timeout (D-47): node's `--test-timeout` for each test, plus the Bash tool's timeout for the
   whole command; no background command runs without an explicit timeout.
8. **Reviewer inputs:** earlier FAIL lists for the item (if resumed), this adversarial-case list,
   and the scope check (the diff touches only the files in 3).
9. **Report:** computer-use actions ("none" expected), incidents against **Hard limits**, the PIDs
   of every process the agent started with confirmation that none is still running (D-47), and one
   line with wall time and approximate tokens for each agent.
