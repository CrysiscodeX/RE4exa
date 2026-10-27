// One interface for every live backend: the local model (llama.cpp), Codex CLI, Claude Code CLI,
// and the hybrid that combines them. A backend gets the task prompt and a workspace and returns
// the answer plus what it cost; the runner grades the answer the same way for every backend.

export interface Usage {
  input_uncached: number;
  input_cached: number;
  output: number;
}

export interface RoleRun {
  /** The model id as the backend reported it; the requested id when it reports none. */
  model: string;
  requested_model: string;
  /** How effort was applied (or "not applied: <why>"), so a silent default never looks like medium. */
  effort: string;
  turns: number;
  tool_calls: number;
  tokens: Usage;
  cost_usd: number;
  ms: number;
}

export interface BackendResult {
  answer: string;
  transcript: string;
  run: RoleRun;
  /** Per role, for the hybrid: plan, worker, codex_review, opus_review, worker_revision. */
  roles?: Record<string, RoleRun>;
  /** The worker's first answer, graded too, so the reviewers' effect is measured (hybrid). */
  first_answer?: string;
  memory?: { allocated_mib: number; peak_rss_mib: number; cap_mib: number };
  /** A stop that is not the model's fault: sign-in needed, memory cap, timeout, missing tool. */
  error?: string;
  timed_out?: boolean;
}

export interface BackendContext {
  /** The cell's workspace: copies of the subject files and any extra files. */
  workspace: string;
  /** Directory holding a `reax` command for the agent (a shim on PATH). */
  toolsDir: string;
  /** Hard limit for the whole cell. */
  deadline: number;
}

export interface Backend {
  name: string;
  run(prompt: string, ctx: BackendContext): Promise<BackendResult>;
}

export const zeroUsage = (): Usage => ({ input_uncached: 0, input_cached: 0, output: 0 });
