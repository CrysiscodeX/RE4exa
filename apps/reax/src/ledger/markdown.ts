// Just enough Markdown reading to seed the ledgers from docs/profiles: find a section by its
// heading, read its table rows by column name, and read its list items.

export interface Section {
  heading: string;
  /** 1-based line number of the heading. */
  line: number;
  lines: string[];
}

/** The section whose heading starts with `prefix` (e.g. "### 9A."), up to the next heading of the
 * same or higher level. Throws when the heading is missing, so a renamed profile fails loudly. */
export function section(text: string, prefix: string): Section {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith(prefix));
  if (start < 0) throw new Error(`no heading starting with "${prefix}"`);
  const level = (lines[start]!.match(/^#+/)?.[0] ?? "").length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i]!.match(/^(#+)\s/);
    if (m && m[1]!.length <= level) {
      end = i;
      break;
    }
  }
  return { heading: lines[start]!, line: start + 1, lines: lines.slice(start + 1, end) };
}

/** Split a table row into cells. `\|` is a literal pipe, not a separator. */
export function cells(row: string): string[] {
  const parts = row.replaceAll("\\|", "\u0000").split("|").slice(1, -1);
  return parts.map((c) => c.replaceAll("\u0000", "|").trim());
}

export interface Table {
  header: string[];
  rows: { cells: Record<string, string>; raw: string[]; line: number }[];
}

/** Every Markdown table in the section, in order. A table starts at a header row followed by a
 * `|---|` separator. */
export function tables(s: Section): Table[] {
  const out: Table[] = [];
  for (let i = 0; i < s.lines.length - 1; i++) {
    if (!s.lines[i]!.startsWith("|") || !/^\|\s*:?-{3,}/.test(s.lines[i + 1]!)) continue;
    const header = cells(s.lines[i]!);
    const rows: Table["rows"] = [];
    let j = i + 2;
    for (; j < s.lines.length && s.lines[j]!.startsWith("|"); j++) {
      const raw = cells(s.lines[j]!);
      const rec: Record<string, string> = {};
      header.forEach((h, k) => {
        rec[h] = raw[k] ?? "";
      });
      rows.push({ cells: rec, raw, line: s.line + 1 + j });
    }
    out.push({ header, rows });
    i = j;
  }
  return out;
}

export interface Item {
  text: string;
  indent: number;
  marker: string;
  line: number;
}

/** List items (`- x`, `* x`, `1. x`) in the section, with their indent, joined across wrapped lines. */
export function items(s: Section): Item[] {
  const out: Item[] = [];
  s.lines.forEach((l, i) => {
    const m = l.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (m) out.push({ indent: m[1]!.length, marker: m[2]!, text: m[3]!, line: s.line + 1 + i });
    else if (out.length && l.trim() && /^\s+\S/.test(l) && !l.trim().startsWith("|"))
      out[out.length - 1]!.text += ` ${l.trim()}`;
  });
  return out;
}

/** Plain text: Markdown links reduced to their label, emphasis and code ticks removed. */
export function plain(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\W)\*([^*]+)\*(\W|$)/g, "$1$2$3")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function slug(s: string): string {
  return plain(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}
