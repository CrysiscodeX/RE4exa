// Generates docs/failure-modes.md from src/errors.ts (core codes plus Assay's own). `--check` fails when the committed file differs.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FAILURE_MODES } from "../src/errors.ts";

const root = join(dirname(new URL(import.meta.url).pathname), "..");
const check = process.argv.includes("--check");
let stale = 0;

function emit(rel: string, content: string): void {
  const p = join(root, rel);
  const cur = existsSync(p) ? readFileSync(p, "utf8") : null;
  if (cur === content) return;
  if (check) {
    console.error(`stale: ${rel} (run node scripts/gen-docs.ts)`);
    stale++;
  } else {
    writeFileSync(p, content);
    console.log(`wrote ${rel}`);
  }
}

function failureModes(): string {
  const rows = Object.entries(FAILURE_MODES).map(
    ([code, m]) => `| \`${code}\` | ${m.message} | ${m.retryable ? "yes" : "no"} | ${m.fix} |`,
  );
  return [
    "# Failure modes",
    "",
    "Every error Assay reports carries one of these codes: the shared engine's codes",
    "(`@re4exa/core/errors`) and Assay's own. Generated from `src/errors.ts` by `node scripts/gen-docs.ts`.",
    "Each code is raised by at least one test (core codes in `packages/core/test`, Assay codes in",
    "`test/`). Defaults fail closed: an unknown state is reported, never guessed.",
    "",
    "| Code | Meaning | Retryable | What to do |",
    "|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

emit("docs/failure-modes.md", failureModes());

// docs/capabilities.json and docs/reach.json have their own staleness tests
// (test/mcp-config.test.ts, test/probes-reach.test.ts) and writers (--write on their modules).
if (stale) process.exit(1);
