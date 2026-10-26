// Generates docs/failure-modes.md from src/errors.ts (core codes only). `--check` fails when the
// committed file differs. Apps generate their own merged tables.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CORE_FAILURE_MODES } from "../src/errors.ts";

const root = join(import.meta.dirname, "..");
const check = process.argv.includes("--check");
const rel = "docs/failure-modes.md";
const rows = Object.entries(CORE_FAILURE_MODES).map(
  ([code, m]) => `| \`${code}\` | ${m.message} | ${m.retryable ? "yes" : "no"} | ${m.fix} |`,
);
const content = [
  "# Failure modes (core)",
  "",
  "The engine-agnostic codes every app built on `@re4exa/core` can report. Apps add their own with",
  "`defineFailureModes` and may reword a code's fix for their users. Generated from `src/errors.ts` by",
  "`npm run gen-docs`; `test/failure-modes.test.ts` checks that each code is raised by a core test.",
  "",
  "| Code | Meaning | Retryable | What to do |",
  "|---|---|---|---|",
  ...rows,
  "",
].join("\n");
const p = join(root, rel);
const cur = existsSync(p) ? readFileSync(p, "utf8") : null;
if (cur !== content) {
  if (check) {
    console.error(`stale: ${rel} (run npm run gen-docs)`);
    process.exit(1);
  }
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
  console.log(`wrote ${rel}`);
}
