// Compute every ledger row's status from the JUnit reports of the CI lanes, and fail on anything
// that would let "complete" be claimed without evidence.
//   npm run parity -- [--reports dir] [--ledger dir] [--gate-phase N] [--gate-kind reax-infra] [--out file]
//
// Fails (exit 1) when:
//   - a ledger row is malformed or a key appears twice;
//   - a test is tagged with a key no row has (a typo would otherwise prove nothing);
//   - a tagged test failed (the row is regressed);
//   - a row is orphaned (its profile entry is gone and nobody has reviewed it);
//   - with --gate-phase, a row of that phase or earlier is not covered, fixed or a reviewed wont.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { parseJunit } from "../src/ledger/junit.ts";
import { loadLedger } from "../src/ledger/load.ts";
import { renderReport } from "../src/ledger/report.ts";
import { computeStatus, gateFailures, type Lane, laneOf } from "../src/ledger/status.ts";

const REAX = join(import.meta.dirname, "..");
const { values: args } = parseArgs({
  options: {
    reports: { type: "string", default: join(REAX, "reports") },
    ledger: { type: "string", default: join(REAX, "docs", "ledger") },
    "gate-phase": { type: "string" },
    "gate-kind": { type: "string" },
    out: { type: "string", default: join(REAX, "reports", "parity.md") },
  },
});

const ledger = loadLedger(args.ledger!);
const problems: string[] = [];
const notes: string[] = [];

const reportDir = args.reports!;
const xmls = existsSync(reportDir) ? readdirSync(reportDir).filter((f) => f.endsWith(".xml")) : [];
if (!xmls.length) {
  console.error(`no JUnit reports (*.xml) in ${reportDir}; run npm run test:lane first`);
  process.exit(1);
}
const lanes: Lane[] = xmls
  .sort()
  .map((f) => laneOf(basename(f, ".xml"), parseJunit(readFileSync(join(reportDir, f), "utf8"))));

const opsDoc = join(REAX, "docs", "operations.md");
const opsText = existsSync(opsDoc) ? readFileSync(opsDoc, "utf8") : "";
const documented = (op: string) =>
  new RegExp(`^#+ \`${op.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\``, "m").test(opsText);
if (!opsText) notes.push("docs/operations.md does not exist yet (the operation registry lands in phase 1)");

const groups = new Map<
  string,
  (typeof ledger.limitations)[number]["row"][] | (typeof ledger.parity)[number]["row"][]
>();
for (const { file, row } of ledger.limitations) {
  const g = (groups.get(`limitations/${file}`) ?? []) as (typeof row)[];
  g.push(row);
  groups.set(`limitations/${file}`, g);
}
for (const { file, row } of ledger.parity) {
  const g = (groups.get(`parity/${file}`) ?? []) as (typeof row)[];
  g.push(row);
  groups.set(`parity/${file}`, g);
}
const all = [...ledger.limitations.map((x) => x.row), ...ledger.parity.map((x) => x.row)];
const { rows: statuses, unknownTags } = computeStatus(all, lanes, documented);
const byKey = new Map(statuses.map((s) => [s.key, s]));

for (const t of unknownTags) problems.push(`a test is tagged with ${t}, which no ledger row has`);
for (const s of statuses) if (s.status === "regressed") problems.push(`${s.key} regressed: ${s.why}`);
for (const r of all)
  if (r.orphaned) problems.push(`${"id" in r ? r.id : r.key} is orphaned: its profile entry is gone`);

let gate: { phase: number; kind: string | null; failures: typeof statuses } | null = null;
if (args["gate-phase"] !== undefined) {
  const phase = Number(args["gate-phase"]);
  if (!Number.isInteger(phase) || phase < 0 || phase > 4) {
    console.error("--gate-phase is 0-4");
    process.exit(2);
  }
  const kind = args["gate-kind"] ?? null;
  const inScope = kind ? new Set(ledger.parity.filter((p) => p.row.kind === kind).map((p) => p.row.key)) : null;
  const failures = gateFailures(statuses, phase).filter((s) => !inScope || inScope.has(s.key));
  gate = { phase, kind, failures };
}

const md = renderReport({
  files: [...groups.entries()].map(([file, rows]) => ({
    file,
    statuses: rows.map((r) => byKey.get("id" in r ? r.id : r.key)!),
  })),
  lanes,
  gate,
  problems,
  notes,
});
mkdirSync(dirname(args.out!), { recursive: true });
writeFileSync(args.out!, md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
console.log(md);
if (problems.length || gate?.failures.length) process.exit(1);
