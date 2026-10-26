// Read the JUnit XML that `node --test --test-reporter=junit` writes, enough to get each test's
// name and outcome. No XML library: the reporter's output is regular, and a malformed file fails.

export type Outcome = "pass" | "fail" | "skip";

export interface Case {
  name: string;
  file: string;
  outcome: Outcome;
}

const ENTITIES: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&apos;": "'" };
const decode = (s: string) =>
  s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m) => {
    if (m in ENTITIES) return ENTITIES[m]!;
    const n = m.startsWith("&#x") ? Number.parseInt(m.slice(3, -1), 16) : Number.parseInt(m.slice(2, -1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : m;
  });

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? decode(m[1]!) : null;
}

export function parseJunit(xml: string): Case[] {
  if (!/<testsuites[\s>]/.test(xml)) throw new Error("not a JUnit report: no <testsuites>");
  const out: Case[] = [];
  // Attribute values may hold an unescaped ">" (Node's reporter escapes only < & and "), so the
  // tag ends at the first ">" outside quotes.
  const re = /<testcase\b((?:[^>"]|"[^"]*")*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const m of xml.matchAll(re)) {
    const open = `<testcase${m[1]}>`;
    const body = m[3] ?? "";
    const name = attr(open, "name");
    if (name === null) throw new Error("a <testcase> has no name");
    const failed = /<failure\b|<error\b/.test(body) || attr(open, "failure") !== null;
    const skipped = /<skipped\b/.test(body);
    out.push({ name, file: attr(open, "file") ?? "", outcome: failed ? "fail" : skipped ? "skip" : "pass" });
  }
  return out;
}

/** Tags in a test name: `[+KEY]` proves the row works, `[-KEY]` proves a limit or refusal. */
export function tagsOf(name: string): { key: string; polarity: "+" | "-" }[] {
  return [...name.matchAll(/\[([+-])([A-Za-z0-9][A-Za-z0-9_.:/#-]{0,95})\]/g)].map((m) => ({
    polarity: m[1] as "+" | "-",
    key: m[2]!,
  }));
}
