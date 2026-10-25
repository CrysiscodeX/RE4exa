// Generates docs that must stay in sync with the code: the failure-mode register (from
// src/errors.ts), the capability statement (src/mcp/capabilities.ts) and the reach table
// (src/probes/reach.ts). `--check` fails when a committed file differs.
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
    "Every error Assay reports carries one of these codes. Generated from `src/errors.ts` by",
    "`node scripts/gen-docs.ts`; `test/failure-modes.test.ts` checks that each code is raised by at",
    "least one test. Defaults fail closed: an unknown state is reported, never guessed.",
    "",
    "| Code | Meaning | Retryable | What to do |",
    "|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

emit("docs/failure-modes.md", failureModes());

const extra = [
  ["src/mcp/capabilities.ts", "docs/capabilities.json"],
  ["src/probes/reach.ts", "docs/reach.json"],
] as const;
for (const [mod, out] of extra) {
  if (!existsSync(join(root, mod))) continue;
  const m = (await import(join(root, mod))) as { generate?: () => unknown | Promise<unknown> };
  if (typeof m.generate !== "function") continue;
  emit(out, `${JSON.stringify(await m.generate(), null, 2)}\n`);
}
if (stale) process.exit(1);
