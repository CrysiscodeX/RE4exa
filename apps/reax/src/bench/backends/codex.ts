// Codex CLI as a backend: `codex exec --json` under the user's own Codex sign-in, in the cell's
// workspace, with a read-only sandbox. reax never touches Codex's credentials.
import { type BenchConfig, DEFAULTS } from "./config.ts";
import { jsonLines, runCli, signInNeeded } from "./proc.ts";
import type { Backend, BackendContext, BackendResult } from "./types.ts";

export function codexArgv(cfg: BenchConfig["codex"], ctx: BackendContext, prompt: string): string[] {
  return [
    ...cfg.cmd,
    "exec",
    "--json",
    "--model",
    cfg.model,
    "-c",
    `model_reasoning_effort="${cfg.effort}"`,
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "-C",
    ctx.workspace,
    ...cfg.extraArgs,
    prompt,
  ];
}

export function parseCodex(stdout: string, requested: string, effort: string) {
  let answer = "";
  let toolCalls = 0;
  let turns = 0;
  let model = requested;
  const tokens = { input_uncached: 0, input_cached: 0, output: 0 };
  for (const e of jsonLines(stdout)) {
    if (typeof e.model === "string") model = e.model;
    const item = e.item as { type?: string; text?: string } | undefined;
    if (e.type === "item.completed" && item?.type === "agent_message" && typeof item.text === "string")
      answer = item.text;
    if (e.type === "item.completed" && (item?.type === "command_execution" || item?.type === "mcp_tool_call"))
      toolCalls++;
    if (e.type === "turn.completed") {
      turns++;
      const u = (e.usage ?? {}) as { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number };
      tokens.input_cached += u.cached_input_tokens ?? 0;
      tokens.input_uncached += (u.input_tokens ?? 0) - (u.cached_input_tokens ?? 0);
      tokens.output += u.output_tokens ?? 0;
    }
  }
  return { answer, toolCalls, turns, model, tokens, effort: `-c model_reasoning_effort="${effort}"` };
}

export function codexBackend(cfg: BenchConfig["codex"] = DEFAULTS.codex): Backend {
  return {
    name: "codex",
    async run(prompt: string, ctx: BackendContext): Promise<BackendResult> {
      const env = { ...process.env, PATH: `${ctx.toolsDir}:${process.env.PATH ?? ""}` };
      const r = await runCli(codexArgv(cfg, ctx, prompt), { cwd: ctx.workspace, env, deadline: ctx.deadline });
      const p = parseCodex(r.stdout, cfg.model, cfg.effort);
      const failed = r.code !== 0 && !p.answer;
      return {
        answer: p.answer,
        transcript: r.stdout + (r.stderr ? `\n--- stderr\n${r.stderr}` : ""),
        run: {
          model: p.model,
          requested_model: cfg.model,
          effort: p.effort,
          turns: p.turns,
          tool_calls: p.toolCalls,
          tokens: p.tokens,
          cost_usd: 0,
          ms: r.ms,
        },
        timed_out: r.timedOut,
        ...(failed
          ? {
              error: signInNeeded(r.stderr + r.stdout) ? "sign-in needed: run `codex login`" : `codex exited ${r.code}`,
            }
          : {}),
      };
    },
  };
}
