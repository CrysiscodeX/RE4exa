// Reconciles reax's completion state from the repository itself and writes
// docs/implementation/CAPABILITY-MATRIX.md (generated; do not edit):
// - every rea/leanrea parity row maps to exactly one component (an unmapped or doubly mapped
//   family fails the run);
// - a row counts as "tested" when the test suite carries both its [+KEY] and [-KEY] tags. Whether
//   those tests passed on every platform is CI's parity job's verdict (scripts/parity-check.ts),
//   which this script does not repeat;
// - weak points and security notes are counted the same way.
//   node scripts/status.ts [--check]
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REAX = join(import.meta.dirname, "..");
const LEDGER = join(REAX, "docs", "ledger");
const OUT = join(REAX, "docs", "implementation", "CAPABILITY-MATRIX.md");

/** Each parity family (or leanrea row) belongs to one component; plan §8 and the readiness report. */
export const COMPONENTS: Record<string, string[]> = {
  "Tool surface, CLI and output": ["REA-C03", "REA-C04", "REA-C35", "REA-C37", "LEAN-C07", "LEAN-C09", "LEAN-C10"],
  "Native readers": [
    "REA-C07",
    "REA-C12",
    "REA-C13",
    "REA-C14",
    "REA-C45",
    "LEAN-C04",
    "LEAN-C05",
    "LEAN-C17",
    "LEAN-C21",
    "LEAN-C25",
    "LEAN-C27",
    "LEAN-C28",
    "LEAN-C29",
    "LEAN-C40",
    "LEAN-T07",
    "LEAN-T10",
    "LEAN-T11",
    "LEAN-T12",
    "LEAN-T13",
    "LEAN-T15",
  ],
  "Archives and app bundles": ["REA-C17", "LEAN-C19", "LEAN-C22", "LEAN-C35", "LEAN-T03", "LEAN-T17"],
  "JavaScript and Electron": [
    "REA-C19",
    "LEAN-C20",
    "LEAN-C23",
    "LEAN-C24",
    "LEAN-C43",
    "LEAN-T01",
    "LEAN-T04",
    "LEAN-T05",
    "LEAN-T06",
    "LEAN-T16",
  ],
  "Managed and mobile": ["REA-C23", "REA-C24", "REA-C25", "LEAN-C30", "LEAN-C31", "LEAN-C32", "LEAN-T08"],
  "Other formats": [
    "REA-C27",
    "REA-C28",
    "REA-C29",
    "LEAN-C33",
    "LEAN-C34",
    "LEAN-C36",
    "LEAN-C37",
    "LEAN-T09",
    "LEAN-T14",
  ],
  "Code-level analysis": [
    "REA-C06",
    "REA-C08",
    "REA-C09",
    "REA-C10",
    "REA-C11",
    "REA-C15",
    "LEAN-C08",
    "LEAN-C18",
    "LEAN-C26",
    "LEAN-C41",
    "LEAN-C42",
    "LEAN-C44",
    "LEAN-C45",
  ],
  "Engine adapters": ["REA-C38", "LEAN-C14", "LEAN-C46"],
  "Daemon, MCP, sessions, jobs": ["REA-C01", "REA-C02", "REA-C05", "REA-C33", "REA-C36", "REA-C39"],
  "Evidence, unknowns, verification": [
    "REA-C30",
    "REA-C31",
    "REA-C32",
    "LEAN-C11",
    "LEAN-C12",
    "LEAN-C13",
    "LEAN-C15",
    "LEAN-C16",
  ],
  Safety: ["REA-C34"],
  "Setup, skill, router": [
    "REA-C40",
    "REA-C41",
    "REA-C42",
    "REA-C44",
    "REA-C46",
    "LEAN-C01",
    "LEAN-C02",
    "LEAN-C03",
    "LEAN-C06",
    "LEAN-C47",
    "LEAN-C48",
    "LEAN-T02",
  ],
  "Runtime and devices": [
    "REA-C16",
    "REA-C18",
    "REA-C20",
    "REA-C21",
    "REA-C22",
    "REA-C26",
    "REA-C43",
    "LEAN-C38",
    "LEAN-C39",
  ],
  Benchmark: [
    "LEAN-C49",
    "LEAN-C50",
    "LEAN-C51",
    "LEAN-C52",
    "LEAN-C53",
    "LEAN-C54",
    "LEAN-C55",
    "LEAN-C56",
    "LEAN-C57",
    "LEAN-C58",
    "LEAN-C59",
  ],
};

interface Row {
  key: string;
  family?: string | null;
  phase: number;
  title: string;
}
interface Weak {
  id: string;
  category: string;
  severity: string;
  phase: number;
  title: string;
}

const jsonl = <T>(p: string): T[] =>
  readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);

/** Every [+KEY] and [-KEY] tag in reax's test files. */
export function testTags(dir = join(REAX, "test")): { plus: Set<string>; minus: Set<string> } {
  const plus = new Set<string>();
  const minus = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".test.ts")))
    for (const m of readFileSync(join(dir, f), "utf8").matchAll(/\[([+-])([A-Za-z0-9./_-]+)\]/g))
      (m[1] === "+" ? plus : minus).add(m[2]!);
  return { plus, minus };
}

export function familyOf(r: Row): string {
  return r.family ?? r.key.split("/").pop()!;
}

export function reconcile() {
  const parity = [
    ...jsonl<Row>(join(LEDGER, "parity", "rea.jsonl")),
    ...jsonl<Row>(join(LEDGER, "parity", "leanrea.jsonl")),
  ];
  const reaxRows = jsonl<Row>(join(LEDGER, "parity", "reax.jsonl"));
  const weak = readdirSync(join(LEDGER, "limitations"))
    .filter((f) => f.endsWith(".jsonl"))
    .flatMap((f) => jsonl<Weak>(join(LEDGER, "limitations", f)));
  const { plus, minus } = testTags();
  const tested = (k: string) => {
    const short = k.split("/").pop()!;
    return (plus.has(k) || plus.has(short)) && (minus.has(k) || minus.has(short));
  };
  const owner = new Map<string, string>();
  for (const [c, fams] of Object.entries(COMPONENTS))
    for (const f of fams) {
      if (owner.has(f)) throw new Error(`family ${f} is in two components: ${owner.get(f)} and ${c}`);
      owner.set(f, c);
    }
  const unmapped = parity.filter((r) => !owner.has(familyOf(r)));
  if (unmapped.length) throw new Error(`parity rows with no component: ${unmapped.map((r) => r.key).join(", ")}`);
  const components = Object.keys(COMPONENTS).map((c) => {
    const rows = parity.filter((r) => owner.get(familyOf(r)) === c);
    const phases: Record<number, number> = {};
    for (const r of rows) phases[r.phase] = (phases[r.phase] ?? 0) + 1;
    return { name: c, rows: rows.length, tested: rows.filter((r) => tested(r.key)).length, phases };
  });
  const sum = components.reduce((a, c) => a + c.rows, 0);
  if (sum !== parity.length) throw new Error(`components hold ${sum} rows, the ledger ${parity.length}`);
  const weakTested = weak.filter((w) => tested(w.id));
  const notes = readFileSync(join(REAX, "docs", "review-notes.md"), "utf8").match(/^### SR-\d+\./gm) ?? [];
  return {
    parity: { total: parity.length, tested: parity.filter((r) => tested(r.key)).length },
    reax: { total: reaxRows.length, tested: reaxRows.filter((r) => tested(r.key)).length },
    weak: {
      total: weak.length,
      tested: weakTested.length,
      openBySeverity: count(weak.filter((w) => !tested(w.id)).map((w) => w.severity)),
    },
    securityNotes: notes.length,
    components,
  };
}

function count(xs: string[]): Record<string, number> {
  const o: Record<string, number> = {};
  for (const x of xs) o[x] = (o[x] ?? 0) + 1;
  return o;
}

export function matrix(s: ReturnType<typeof reconcile>): string {
  const lines = [
    "# reax capability matrix",
    "",
    "Generated by `scripts/status.ts` from the ledgers and the test suite. Do not edit.",
    "",
    "**Tested** means the suite has both a `[+KEY]` and a `[-KEY]` test for the row. Whether they passed",
    "on every platform the row names is the CI parity job's verdict (`scripts/parity-check.ts`).",
    "",
    "| | Tested | Total |",
    "|---|---:|---:|",
    `| rea and leanrea capability rows | ${s.parity.tested} | ${s.parity.total} |`,
    `| reax's own rows | ${s.reax.tested} | ${s.reax.total} |`,
    `| Recorded weak points | ${s.weak.tested} | ${s.weak.total} |`,
    "",
    `Open weak points by severity: ${Object.entries(s.weak.openBySeverity)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}. Security review notes: ${s.securityNotes} (status in \`docs/review-notes.md\`).`,
    "",
    "| Component | Rows | Tested | By phase |",
    "|---|---:|---:|---|",
    ...s.components.map(
      (c) =>
        `| ${c.name} | ${c.rows} | ${c.tested} | ${Object.entries(c.phases)
          .map(([p, n]) => `p${p}: ${n}`)
          .join(", ")} |`,
    ),
    "",
  ];
  return `${lines.join("\n")}`;
}

if (import.meta.main) {
  const text = matrix(reconcile());
  if (process.argv.includes("--check")) {
    if (!existsSync(OUT) || readFileSync(OUT, "utf8").replaceAll("\r\n", "\n") !== text) {
      console.error("docs/implementation/CAPABILITY-MATRIX.md is stale; run node scripts/status.ts");
      process.exit(1);
    }
    console.log("capability matrix is current");
  } else {
    writeFileSync(OUT, text);
    console.log(`wrote ${OUT}`);
  }
}
