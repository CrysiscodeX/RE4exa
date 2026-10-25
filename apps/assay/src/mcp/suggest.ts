// "Did you mean …?" for paths that do not exist: agents guess paths, and a bare not_found sends
// them guessing again (seen in the live benchmark). Bounded walk; skips heavy directories.
import { readdirSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { AssayError } from "../errors.ts";

const SKIP = new Set(["node_modules", ".git", ".hg", ".svn", "dist", "build", ".assay"]);

function distance(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]!;
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j]!;
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length]!;
}

/** Up to `max` workspace-relative paths whose name resembles the last segment of `wanted`. */
export function suggestPaths(root: string, wanted: string, max = 5, limit = 5000): string[] {
  const want = basename(wanted).toLowerCase();
  if (!want) return [];
  const scored: { path: string; score: number }[] = [];
  const stack = [root];
  let seen = 0;
  while (stack.length && seen < limit) {
    const dir = stack.pop()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (++seen > limit) break;
      const abs = join(dir, e.name);
      const name = e.name.toLowerCase();
      const score =
        name === want
          ? 0
          : name.includes(want) || want.includes(name)
            ? 1
            : distance(name, want) <= Math.max(1, Math.floor(want.length / 4))
              ? 2
              : -1;
      if (score >= 0) scored.push({ path: relative(root, abs) || ".", score });
      if (e.isDirectory() && !SKIP.has(e.name)) stack.push(abs);
    }
  }
  return scored
    .sort((a, b) => a.score - b.score || a.path.length - b.path.length || a.path.localeCompare(b.path))
    .slice(0, max)
    .map((s) => s.path);
}

/** The path_not_found error, with suggestions in both the detail and the message the agent reads. */
export function pathNotFound(root: string, wanted: string): AssayError {
  const suggestions = suggestPaths(root, wanted);
  return new AssayError(
    "path_not_found",
    { path: wanted, suggestions },
    suggestions.length
      ? `No such path: ${wanted}. Did you mean: ${suggestions.join(", ")}?`
      : `No such path: ${wanted}`,
  );
}
