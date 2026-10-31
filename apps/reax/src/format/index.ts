// One result, six renderings: text (the operation's own), json, jsonl, yaml, markdown and toon.
// List operations put their rows in `data.items`; jsonl and markdown render those rows one per line
// or one per table row, after the result's metadata.
import { toToon } from "./toon.ts";
import { toYaml } from "./yaml.ts";

export const FORMATS = ["text", "json", "jsonl", "yaml", "markdown", "toon"] as const;
export type Format = (typeof FORMATS)[number];

export interface Rendered {
  operation: string;
  coverage: "complete" | "partial";
  limitations: string[];
  data: unknown;
  text: string;
}

function items(data: unknown): unknown[] | null {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const it = (data as { items?: unknown }).items;
    if (Array.isArray(it)) return it;
  }
  return null;
}

/** The result without its rows, for formats that print the rows separately. */
function meta(r: Rendered): Record<string, unknown> {
  const data = r.data as Record<string, unknown> | null;
  const rest: Record<string, unknown> = {};
  if (data && typeof data === "object" && !Array.isArray(data))
    for (const [k, v] of Object.entries(data)) if (k !== "items") rest[k] = v;
  return { operation: r.operation, coverage: r.coverage, limitations: r.limitations, ...rest };
}

function mdCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  return s.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}

function fence(body: string, lang: string): string {
  let ticks = "```";
  while (body.includes(ticks)) ticks += "`";
  return `${ticks}${lang}\n${body}\n${ticks}`;
}

export function markdown(r: Rendered): string {
  const out = [
    `**${mdCell(r.operation)}**: coverage ${r.coverage}${r.limitations.length ? `; limitations: ${r.limitations.map(mdCell).join("; ")}` : ""}`,
    "",
  ];
  const rows = items(r.data);
  if (rows?.length && rows.every((x) => x && typeof x === "object" && !Array.isArray(x))) {
    const cols: string[] = [];
    for (const row of rows) for (const k of Object.keys(row as object)) if (!cols.includes(k)) cols.push(k);
    out.push(`| ${cols.map(mdCell).join(" | ")} |`, `|${cols.map(() => "---").join("|")}|`);
    for (const row of rows) out.push(`| ${cols.map((c) => mdCell((row as Record<string, unknown>)[c])).join(" | ")} |`);
    const m = meta(r);
    delete m.operation;
    delete m.coverage;
    delete m.limitations;
    if (Object.keys(m).length) out.push("", fence(JSON.stringify(m, null, 1), "json"));
  } else out.push(fence(JSON.stringify(r.data, null, 1), "json"));
  return out.join("\n");
}

export function render(format: Format, r: Rendered): string {
  switch (format) {
    case "text":
      return r.text;
    case "json":
      return JSON.stringify({ operation: r.operation, coverage: r.coverage, limitations: r.limitations, data: r.data });
    case "jsonl": {
      const rows = items(r.data);
      if (!rows) return JSON.stringify(meta(r));
      return [JSON.stringify(meta(r)), ...rows.map((x) => JSON.stringify(x))].join("\n");
    }
    case "yaml":
      return toYaml({ operation: r.operation, coverage: r.coverage, limitations: r.limitations, data: r.data });
    case "toon":
      return toToon({ operation: r.operation, coverage: r.coverage, limitations: r.limitations, data: r.data });
    case "markdown":
      return markdown(r);
  }
}

/** Cuts a rendering to about `tokens` tokens (4 characters each, a common estimate), on a line
 * boundary, and says so; the full result is still available with a larger limit or through paging. */
export function limitTokens(s: string, tokens: number): string {
  const max = tokens * 4;
  if (s.length <= max) return s;
  const cut = s.lastIndexOf("\n", max);
  const head = s.slice(0, cut > 0 ? cut : max);
  return `${head}\n[output cut at about ${tokens} tokens (${head.length} of ${s.length} characters); page with offset and limit, or raise --token-limit]`;
}
