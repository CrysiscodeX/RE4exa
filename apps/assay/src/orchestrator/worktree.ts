// One git worktree per worker (Orca's pattern): parallel agents never edit the same checkout.

import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { AssayError } from "../errors.ts";
import { runProcess } from "../vendor/orca-process-host/run-process.ts";

const SAFE = /[^a-zA-Z0-9._-]+/g;

export function worktreeName(caseId: string, workerId: string): string {
  return `${caseId}-${workerId}`.replace(SAFE, "-").slice(0, 80);
}

async function git(cwd: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const r = await runProcess({ program: "git", args, cwd, timeoutMs: 120_000, maxOutputBytes: 1 << 20 });
  return { code: r.code, stdout: r.stdout, stderr: r.stderr };
}

export async function isGitRepo(dir: string): Promise<boolean> {
  if (!existsSync(dir)) return false;
  const r = await git(dir, ["rev-parse", "--is-inside-work-tree"]);
  return r.code === 0 && r.stdout.trim() === "true";
}

/** Create `<root>/<name>` as a worktree of `repo` on branch `assay/<name>`. The path is kept inside root. */
export async function addWorktree(repo: string, root: string, name: string): Promise<string> {
  mkdirSync(root, { recursive: true });
  const base = realpathSync(root);
  const target = resolve(base, name.replace(SAFE, "-"));
  const rel = relative(base, target);
  if (rel.startsWith("..") || rel.includes(`..${sep}`) || rel === "")
    throw new AssayError("path_outside_workspace", { target });
  const r = await git(repo, ["worktree", "add", "-b", `assay/${name}`, target]);
  if (r.code !== 0)
    throw new AssayError(
      "probe_failed",
      { step: "git worktree add", stderr: r.stderr.slice(0, 500) },
      "Could not create the worker's worktree",
    );
  return target;
}

export async function removeWorktree(repo: string, path: string): Promise<void> {
  await git(repo, ["worktree", "remove", "--force", path]);
}

export function worktreeRoot(home: string): string {
  return join(home, "worktrees");
}
