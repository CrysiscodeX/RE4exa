import type { Recipe } from "../server/api-types.ts";

export const RECIPES: Recipe[] = [
  {
    id: "investigate-package",
    title: "Investigate a package",
    description: "What does this npm package, archive or folder do when installed? Install scripts, native code, network endpoints.",
    prompt: "Investigate {path}. Start with assay_sweep. Report what it does when installed and run: install scripts, native add-ons, network endpoints and dynamic loading. Record every seen claim.",
    needsPath: true,
  },
  {
    id: "audit-electron",
    title: "Audit a desktop app",
    description: "Electron or native app: entry points, IPC, bundled code, native modules, update and network behaviour.",
    prompt: "Audit the app at {path}. Sweep it first, then use workers for independent parts (bundled JavaScript, native modules, configuration). Record seen claims and list what was not examined.",
    needsPath: true,
  },
  {
    id: "compare-versions",
    title: "Compare two versions",
    description: "What changed in behaviour between two versions: new dependencies, endpoints, native libraries, install scripts.",
    prompt: "Compare the two versions under {path}. Sweep each, then report capability changes only (dependencies, endpoints, native libraries, install scripts), each as a recorded claim.",
    needsPath: true,
  },
  {
    id: "review-diff",
    title: "Review a change",
    description: "Review a diff or a branch in the workspace with claims that can be re-run (tests pass, symbols exist).",
    prompt: "Review the change in {path}. For anything you state about tests or behaviour, record a claim with predicate cmd.exit or file.contains so it can be re-run.",
    needsPath: true,
  },
  {
    id: "coding-task",
    title: "Coding task with checked results",
    description: "Workers in separate git worktrees; 'tests pass' is a claim Assay re-runs before you trust it.",
    prompt: "Do this task in the workspace: {path}. Use assay_spawn_worker with worktree:true for independent parts. When you say tests pass, record a cmd.exit claim with the exact test command.",
    needsPath: true,
  },
];
