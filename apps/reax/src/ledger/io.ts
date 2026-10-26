// JSONL ledger files: one row per line, sorted by key, so a change to one row is a one-line diff
// and parallel work on different rows merges without conflicts.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const out: T[] = [];
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (!line.trim()) return;
      try {
        out.push(JSON.parse(line) as T);
      } catch (e) {
        throw new Error(`${file}:${i + 1}: not JSON (${(e as Error).message})`);
      }
    });
  return out;
}

export function writeJsonl<T>(file: string, rows: T[], keyOf: (r: T) => string): void {
  mkdirSync(dirname(file), { recursive: true });
  const sorted = [...rows].sort((a, b) => cmpKey(keyOf(a), keyOf(b)));
  writeFileSync(file, sorted.map((r) => JSON.stringify(r)).join("\n") + (sorted.length ? "\n" : ""));
}

/** Every row in every *.jsonl file of a directory, with the file each came from. */
export function readDir<T>(dir: string): { file: string; row: T }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .flatMap((f) => readJsonl<T>(join(dir, f)).map((row) => ({ file: f, row })));
}

/** Natural order: "REA-C9" < "REA-C10", "A1.2" < "A1.10". */
export function cmpKey(a: string, b: string): number {
  const pa = a.split(/(\d+)/);
  const pb = b.split(/(\d+)/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "";
    const y = pb[i] ?? "";
    if (x === y) continue;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) - Number(y);
    return x < y ? -1 : 1;
  }
  return 0;
}
