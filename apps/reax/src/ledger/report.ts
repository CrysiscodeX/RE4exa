// The parity report: counts per ledger file and status, the gate result, and every row that is not
// planned. Written to reports/parity.md and to the CI step summary; never committed, because the
// numbers belong to one CI run.

import type { Lane, RowStatus } from "./status.ts";

export interface ReportInput {
  files: { file: string; statuses: RowStatus[] }[];
  lanes: Lane[];
  gate: { phase: number; kind: string | null; failures: RowStatus[] } | null;
  problems: string[];
  notes: string[];
}

const ORDER = ["covered", "fixed", "partial", "planned", "regressed", "wont"] as const;
const esc = (s: string) => s.replaceAll("|", "\\|").replaceAll("\n", " ");

export function renderReport(r: ReportInput): string {
  const out: string[] = ["# reax parity report", ""];
  out.push(
    `Lanes: ${r.lanes.map((l) => `${l.name} (${l.cases.length} tests)`).join(", ") || "none"}.`,
    "Status is computed from this run's JUnit reports; a skipped test counts as not run.",
    "",
  );
  out.push(`| Ledger | Rows | ${ORDER.join(" | ")} | Triaged (phase set) |`);
  out.push(`|---|---:|${ORDER.map(() => "---:").join("|")}|---:|`);
  const total: Record<string, number> = {};
  let rows = 0;
  let triaged = 0;
  for (const f of r.files) {
    const n: Record<string, number> = {};
    for (const s of f.statuses) n[s.status] = (n[s.status] ?? 0) + 1;
    for (const k of ORDER) total[k] = (total[k] ?? 0) + (n[k] ?? 0);
    const t = f.statuses.filter((s) => s.phase !== null).length;
    rows += f.statuses.length;
    triaged += t;
    out.push(`| ${f.file} | ${f.statuses.length} | ${ORDER.map((k) => n[k] ?? 0).join(" | ")} | ${t} |`);
  }
  out.push(`| **all** | ${rows} | ${ORDER.map((k) => total[k] ?? 0).join(" | ")} | ${triaged} |`, "");
  if (r.gate) {
    const n = r.gate.failures.length;
    const what = `${r.gate.kind ? `${r.gate.kind} ` : ""}row`;
    out.push(
      n
        ? `**Gate failed:** ${n} ${what}${n === 1 ? "" : "s"} of phase ≤ ${r.gate.phase} ${n === 1 ? "is" : "are"} not covered, fixed or a reviewed wont.`
        : `**Gate passed:** every ${what} of phase ≤ ${r.gate.phase} is covered, fixed or a reviewed wont.`,
      "",
    );
  }
  if (r.problems.length) out.push("## Problems", "", ...r.problems.map((p) => `- ${esc(p)}`), "");
  if (r.notes.length) out.push("## Notes", "", ...r.notes.map((p) => `- ${esc(p)}`), "");
  const shown = r.files.flatMap((f) => f.statuses.filter((s) => s.status !== "planned"));
  if (shown.length) {
    out.push("## Rows with test evidence or a decision", "", "| Key | Phase | Status | Why |", "|---|---:|---|---|");
    for (const s of shown) out.push(`| ${esc(s.key)} | ${s.phase ?? "–"} | ${s.status} | ${esc(s.why)} |`);
    out.push("");
  }
  if (r.gate?.failures.length) {
    out.push("## Gate failures", "", "| Key | Phase | Status | Why |", "|---|---:|---|---|");
    for (const s of r.gate.failures) out.push(`| ${esc(s.key)} | ${s.phase} | ${s.status} | ${esc(s.why)} |`);
    out.push("");
  }
  return out.join("\n");
}
