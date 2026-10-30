// LearnHarness (github.com/amosblomqvist/learnharness) as a real project for Assay to investigate:
// an Electron + Next.js desktop app with agent instructions (AGENTS.md, skills/) in its tree.
// Nothing from it is committed. The tree is fetched at the pinned commit, checked, copied
// without .git, and cached by commit; tests read it and never run it.
//
//   node --conditions=source scripts/learnharness.ts fetch [dir]    print the tree's path
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const LEARNHARNESS = {
  repo: "https://github.com/amosblomqvist/learnharness",
  release: "0.4.0",
  commit: "dc4c398d5167865b84b0ccb3ec809eb88bf8f65f",
} as const;

/** The cache directory: ASSAY_LH_DIR, else one under the system temp directory. */
export function learnharnessDir(): string {
  return process.env.ASSAY_LH_DIR ?? join(tmpdir(), "assay-learnharness");
}

function git(args: string[], cwd: string): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 300_000 });
  if (r.error) throw new Error(`git is needed to fetch LearnHarness: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

/**
 * The tree at `commit`, without .git. A cached tree counts only if its marker names the commit;
 * a fetch that lands on any other commit is refused.
 */
export function fetchLearnHarness(dir = learnharnessDir(), commit: string = LEARNHARNESS.commit): string {
  const tree = join(dir, commit, "learnharness");
  const marker = join(dir, commit, "COMMIT");
  if (existsSync(marker) && readFileSync(marker, "utf8").trim() === commit && existsSync(tree)) return tree;
  mkdirSync(dir, { recursive: true });
  const work = mkdtempSync(join(dir, "fetch-"));
  try {
    const clone = join(work, "clone");
    mkdirSync(clone);
    git(["init", "-q"], clone);
    git(["fetch", "-q", "--depth", "1", LEARNHARNESS.repo, commit], clone);
    git(["-c", "advice.detachedHead=false", "checkout", "-q", "FETCH_HEAD"], clone);
    const head = git(["rev-parse", "HEAD"], clone);
    if (head !== commit) throw new Error(`fetched ${head}, not the pinned LearnHarness commit ${commit}`);
    const staged = join(work, "learnharness");
    cpSync(clone, staged, { recursive: true, filter: (src) => !/[\\/]\.git([\\/]|$)/.test(src.slice(clone.length)) });
    rmSync(join(dir, commit), { recursive: true, force: true });
    mkdirSync(join(dir, commit));
    renameSync(staged, tree);
    writeFileSync(marker, `${commit}\n`);
    return tree;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "fetch") console.log(fetchLearnHarness(arg ?? learnharnessDir()));
  else {
    console.error("usage: learnharness.ts fetch [dir]");
    process.exit(2);
  }
}
