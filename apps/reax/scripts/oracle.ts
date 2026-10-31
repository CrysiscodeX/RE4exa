// Answer keys for reax's byte-level operations, from tools that share no code with reax:
// - ASCII strings: llvm-strings (LLVM 18), `-a -t d -n 4`;
// - UTF-16LE strings: GNU strings (binutils), `-a -e l -t d -n 4`;
// - byte search: Python's `re`, a lookahead per offset so overlapping matches are all found.
// The keys are committed (bench/oracle/) and re-derived in CI's fixtures job with --check, so the
// tests on macOS and Windows compare against them without the tools (DECISION-LOG D-4).
//   node scripts/oracle.ts [--check]
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { entropyKey, type LayoutKey, layoutKey, sectionRanges } from "./oracle-layout.ts";

const REAX = join(import.meta.dirname, "..");
const BIN = join(REAX, "fixtures", "bin");
export const ORACLE_DIR = join(REAX, "bench", "oracle");
export const STRINGS_KEY = join(ORACLE_DIR, "strings.json");
export const SEARCH_KEY = join(ORACLE_DIR, "search.json");
export const LAYOUT_KEY = join(ORACLE_DIR, "layout.json");
export const ENTROPY_KEY = join(ORACLE_DIR, "entropy.json");

/** Where each slice of a universal binary starts, from llvm-objdump (0 for a thin file). */
function sliceBases(path: string, format: string): number[] {
  if (format !== "macho-fat") return [0];
  const out = run(["llvm-objdump-18", "llvm-objdump"], ["--macho", "--universal-headers", path]).out;
  return [...out.matchAll(/^\s*offset (\d+)$/gm)].map((m) => Number(m[1]));
}

function run(cands: string[], args: string[]): { bin: string; out: string } {
  for (const bin of cands) {
    const r = spawnSync(bin, args, { encoding: "latin1", maxBuffer: 1 << 28 });
    if (r.error) continue;
    if (r.status !== 0) throw new Error(`${bin} ${args.join(" ")}: ${r.stderr.trim()}`);
    return { bin, out: r.stdout };
  }
  throw new Error(`none of ${cands.join(", ")} is installed`);
}

/** `strings -t d` lines: a right-aligned decimal offset, one space, the string. */
function parseStrings(out: string): [number, string][] {
  const rows: [number, string][] = [];
  for (const line of out.split("\n")) {
    if (line === "") continue;
    const m = /^ *(\d+) (.*)$/s.exec(line);
    if (!m) throw new Error(`unexpected strings line: ${JSON.stringify(line)}`);
    rows.push([Number(m[1]), m[2]!]);
  }
  return rows;
}

export function oracleStrings(path: string): { ascii: [number, string][]; utf16le: [number, string][] } {
  return {
    ascii: parseStrings(run(["llvm-strings-18", "llvm-strings"], ["-a", "-t", "d", "-n", "4", path]).out),
    utf16le: parseStrings(run(["strings"], ["-a", "-e", "l", "-t", "d", "-n", "4", path]).out),
  };
}

/** A long list as its count, digest and first rows (the corpus keys, which must stay small). */
export function digestRows<T>(rows: T[]): { count: number; sha256: string; first: T[] } {
  return {
    count: rows.length,
    sha256: createHash("sha256")
      .update(rows.map((r) => JSON.stringify(r)).join("\n"))
      .digest("hex"),
    first: rows.slice(0, 16),
  };
}

export interface SearchCase {
  hex?: string;
  text?: string;
  ignore_case?: boolean;
}

/** The same patterns on every fixture: selective ones and ones that match overlapping runs. */
export const SEARCH_CASES: SearchCase[] = [
  { text: "reax" },
  { text: "REAX_", ignore_case: true },
  { hex: "48 89 e5" },
  { hex: "ff 25 ?? ?? ?? ??" },
  { hex: "00 00 00 00" },
  { hex: "?? 00 ?? 00 ?? 00 ?? 00" },
  { text: "lib" },
];

const PY = `
import json, re, sys
cases = json.loads(sys.argv[2])
data = open(sys.argv[1], 'rb').read()
out = []
for c in cases:
    if 'hex' in c:
        toks = c['hex'].split()
        pat = b''.join(b'.' if t == '??' else re.escape(bytes([int(t, 16)])) for t in toks)
        flags = re.S
    else:
        pat = re.escape(c['text'].encode('utf-8'))
        flags = re.S | (re.I if c.get('ignore_case') else 0)
    out.append([m.start() for m in re.finditer(b'(?=' + pat + b')', data, flags)])
print(json.dumps(out))
`;

export function oracleSearch(path: string, cases = SEARCH_CASES): number[][] {
  const r = spawnSync("python3", ["-I", "-c", PY, path, JSON.stringify(cases)], {
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  if (r.error || r.status !== 0) throw new Error(`python3 search oracle: ${r.error?.message ?? r.stderr}`);
  return JSON.parse(r.stdout) as number[][];
}

function versions(): Record<string, string> {
  // the line that carries the version (llvm-strings prints its own name first)
  const first = (s: string) => (s.split("\n").find((l) => /\d+\.\d+/.test(l)) ?? "").trim();
  return {
    "llvm-strings": first(run(["llvm-strings-18", "llvm-strings"], ["--version"]).out),
    strings: first(run(["strings"], ["--version"]).out),
    python3: first(run(["python3"], ["--version"]).out),
  };
}

export function build(): Record<"strings" | "search" | "layout" | "entropy", string> {
  const files = readdirSync(BIN).sort();
  const v = versions();
  const strings: Record<string, ReturnType<typeof oracleStrings>> = {};
  const search: Record<string, ReturnType<typeof digestRows<number>>[]> = {};
  const layouts: Record<string, LayoutKey & { format: string; bases: number[] }> = {};
  const entropy: Record<string, ReturnType<typeof entropyKey>> = {};
  // the format of each native fixture, as LLVM read it for the benchmark's answer key
  const formats = JSON.parse(readFileSync(join(REAX, "bench", "oracle-facts.json"), "utf8")).facts as Record<
    string,
    { format: string }
  >;
  for (const f of files) {
    const p = join(BIN, f);
    strings[f] = oracleStrings(p);
    search[f] = oracleSearch(p).map((offs) => digestRows(offs));
    const format = formats[f]?.format;
    if (format) {
      const bases = sliceBases(p, format);
      const key = layoutKey(p, format);
      layouts[f] = { format, bases, ...key };
      entropy[f] = entropyKey(p, sectionRanges(key, format, bases));
    } else entropy[f] = entropyKey(p, []);
  }
  const note = "Generated by scripts/oracle.ts from independent tools; do not edit.";
  return {
    strings: `${JSON.stringify({ note, tools: { ascii: v["llvm-strings"], utf16le: v.strings }, min: 4, files: strings })}\n`,
    search: `${JSON.stringify({ note, tool: v.python3, cases: SEARCH_CASES, files: search }, null, 1)}\n`,
    layout: `${JSON.stringify({ note, tool: "llvm-readobj 18 (--sections, --program-headers, --macho-segment); llvm-objdump --universal-headers", files: layouts })}\n`,
    entropy: `${JSON.stringify({ note, tool: v.python3, block: 4096, files: entropy })}\n`,
  };
}

if (import.meta.main) {
  const out = build();
  const pairs: [string, string][] = [
    [STRINGS_KEY, out.strings],
    [SEARCH_KEY, out.search],
    [LAYOUT_KEY, out.layout],
    [ENTROPY_KEY, out.entropy],
  ];
  if (process.argv.includes("--check")) {
    // tool versions may differ between machines; the answers may not
    const strip = (s: string) => {
      const j = JSON.parse(s) as Record<string, unknown>;
      delete j.tools;
      delete j.tool;
      return JSON.stringify(j);
    };
    const stale = pairs.filter(([p, s]) => !existsSync(p) || strip(readFileSync(p, "utf8")) !== strip(s));
    for (const [p] of stale) console.error(`${p} is not the tools' current answer; run node scripts/oracle.ts`);
    if (stale.length) process.exit(1);
    console.log(`the byte-level answer keys match the tools (${readdirSync(BIN).length} fixtures)`);
  } else {
    mkdirSync(ORACLE_DIR, { recursive: true });
    for (const [p, s] of pairs) writeFileSync(p, s);
    console.log(`wrote ${pairs.map(([p]) => p).join(", ")}`);
  }
}
