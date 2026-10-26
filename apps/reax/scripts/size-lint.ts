// Fail when a source file grows past a line limit, so no module turns into a several-thousand-line
// orchestrator that nobody can review (T3 Code's main orchestrator; donor row T3-1).
//   node scripts/size-lint.ts [--max 1200] [dir...]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const MAX_LINES = 1200;
const REPO = join(import.meta.dirname, "..", "..", "..");
export const DEFAULT_ROOTS = [
  "packages/core/src",
  "apps/reax/src",
  "apps/reax/scripts",
  "apps/reax/bench",
  "apps/reax/test",
].map((d) => join(REPO, d));

export function oversized(roots: string[], max = MAX_LINES): { file: string; lines: number }[] {
  const out: { file: string; lines: number }[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d).sort()) {
      const p = join(d, f);
      if (f === "node_modules" || f === "vendor") continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|mjs|js)$/.test(f)) {
        const lines = readFileSync(p, "utf8").split("\n").length;
        if (lines > max) out.push({ file: relative(REPO, p).replaceAll("\\", "/"), lines });
      }
    }
  };
  for (const r of roots) walk(r);
  return out;
}

if (import.meta.main) {
  const i = process.argv.indexOf("--max");
  const max = i > 0 ? Number(process.argv[i + 1]) : MAX_LINES;
  const dirs = process.argv.slice(2).filter((a, j, all) => a !== "--max" && all[j - 1] !== "--max");
  const bad = oversized(dirs.length ? dirs : DEFAULT_ROOTS, max);
  for (const b of bad) console.error(`${b.file}: ${b.lines} lines (limit ${max}); split it`);
  console.log(bad.length ? `${bad.length} files over ${max} lines` : `no source file over ${max} lines`);
  process.exit(bad.length ? 1 : 0);
}
