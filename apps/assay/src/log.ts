// Structured logs: one JSON object per line on stderr. Level from ASSAY_LOG (error|warn|info|debug,
// default warn, and `assay serve` sets info; "off" silences). Each record carries a trace id when the caller has one (a turn,
// a request), so a turn can be followed across server, orchestrator and provider.
// Logs never contain secrets: values pass through the same redactor as stored evidence.

import { redactString } from "@re4exa/core/policy/redact";

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;
export type Level = keyof typeof LEVELS;

function threshold(): number {
  const v = (process.env.ASSAY_LOG ?? "warn").toLowerCase();
  if (v === "off") return -1;
  return v in LEVELS ? LEVELS[v as Level] : LEVELS.warn;
}

let sink: (line: string) => void = (line) => process.stderr.write(`${line}\n`);

/** Tests capture logs here. */
export function setLogSink(s: (line: string) => void): void {
  sink = s;
}

export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  if (LEVELS[level] > threshold()) return;
  const record: Record<string, unknown> = { t: new Date().toISOString(), level, event };
  for (const [k, v] of Object.entries(fields)) record[k] = typeof v === "string" ? redactString(v).text : v;
  try {
    sink(JSON.stringify(record));
  } catch {
    sink(JSON.stringify({ t: record.t, level, event, note: "unserialisable fields dropped" }));
  }
}
