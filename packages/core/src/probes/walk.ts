// Bounded, deterministic directory walk. Symlinks are never followed (so a walk cannot leave the
// subject), and everything not visited is reported with a reason instead of being dropped.

import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface WalkEntry {
  /** Path relative to the walk root, with forward slashes. */
  rel: string;
  abs: string;
  size: number;
}

export interface WalkResult {
  files: WalkEntry[];
  dirs: number;
  skipped: { what: string; reason: string }[];
}

/** Directories a sweep does not descend into. */
export const SKIP_DIRS: Record<string, string> = {
  node_modules: "dependency directory not examined",
  ".git": "version-control metadata not examined",
  ".hg": "version-control metadata not examined",
  ".svn": "version-control metadata not examined",
  __pycache__: "bytecode cache not examined",
  ".venv": "virtual environment not examined",
  ".cache": "cache directory not examined",
};

export interface WalkOptions {
  maxFiles?: number;
  maxDepth?: number;
  skipDirs?: Record<string, string>;
  /** Only keep files for which this returns true (others are silently ignored, not "skipped"). */
  filter?: (rel: string) => boolean;
}

export function walkDir(root: string, opts: WalkOptions = {}): WalkResult {
  const maxFiles = opts.maxFiles ?? 2000;
  const maxDepth = opts.maxDepth ?? 8;
  const skipDirs = opts.skipDirs ?? SKIP_DIRS;
  const out: WalkResult = { files: [], dirs: 0, skipped: [] };
  let capped = false;
  const visit = (abs: string, rel: string, depth: number): void => {
    let names: string[];
    try {
      names = readdirSync(abs).sort();
    } catch (e) {
      out.skipped.push({ what: rel || ".", reason: `unreadable directory (${(e as NodeJS.ErrnoException).code})` });
      return;
    }
    for (const name of names) {
      const childRel = rel ? `${rel}/${name}` : name;
      const childAbs = join(abs, name);
      let st: ReturnType<typeof lstatSync>;
      try {
        st = lstatSync(childAbs);
      } catch {
        out.skipped.push({ what: childRel, reason: "vanished during walk" });
        continue;
      }
      if (st.isSymbolicLink()) {
        out.skipped.push({ what: childRel, reason: "symlink not followed" });
      } else if (st.isDirectory()) {
        if (skipDirs[name] !== undefined) {
          out.skipped.push({ what: `${childRel}/`, reason: skipDirs[name]! });
        } else if (depth + 1 > maxDepth) {
          out.skipped.push({ what: `${childRel}/`, reason: `depth limit (${maxDepth})` });
        } else {
          out.dirs++;
          visit(childAbs, childRel, depth + 1);
        }
      } else if (st.isFile()) {
        if (opts.filter && !opts.filter(childRel)) continue;
        if (out.files.length >= maxFiles) {
          if (!capped) out.skipped.push({ what: childRel, reason: `file cap (${maxFiles}) reached; rest not walked` });
          capped = true;
          return;
        }
        out.files.push({ rel: childRel, abs: childAbs, size: st.size });
      } else {
        out.skipped.push({ what: childRel, reason: "special file (socket, fifo or device)" });
      }
      if (capped) return;
    }
  };
  visit(root, "", 0);
  return out;
}
