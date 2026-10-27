// Claude Code CLI as a backend: `claude -p --output-format stream-json` under the user's own
// Claude sign-in. Tools are limited to the reax command and read-only file tools; the user's MCP
// servers are not loaded. reax never touches Claude Code's credentials.
import { type BenchConfig, DEFAULTS } from "./config.ts";
import { jsonLines, prependPath, runCli, runCliSync, signInNeeded } from "./proc.ts";
import type { Backend, BackendContext, BackendResult } from "./types.ts";

export const CLAUDE_TOOLS = ["Bash(reax:*)", "Read", "Glob", "Grep"];

const detected = new Map<string, string[] | null>();

/** The effort arguments to pass: the configured ones, else `--effort <level>` when this CLI's help lists it. */
export function effortArgsFor(cfg: BenchConfig["claude"]): string[] | null {
  if (cfg.effortArgs) return cfg.effortArgs;
  const key = cfg.cmd.join("\0");
  if (!detected.has(key)) {
    const r = runCliSync([...cfg.cmd, "--help"], { timeoutMs: 30_000 });
    detected.set(key, /--effort\b/.test(r.out) ? ["--effort", cfg.effort] : null);
  }
  return detected.get(key)!;
}

/** The argv; `claude -p` with no prompt argument reads the prompt from stdin. */
export function claudeArgv(cfg: BenchConfig["claude"], tools: string[] = CLAUDE_TOOLS): string[] {
  return [
    ...cfg.cmd,
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    cfg.model,
    "--strict-mcp-config",
    "--allowedTools",
    ...(tools.length ? tools : ["none"]),
    "--disallowedTools",
    "Write",
    "Edit",
    "WebFetch",
    "WebSearch",
    ...(tools.length ? [] : ["Bash", "Read", "Glob", "Grep"]),
    ...(effortArgsFor(cfg) ?? []),
    ...cfg.extraArgs,
  ];
}

export function parseClaude(stdout: string, requested: string, effortArgs: string[] | null) {
  let answer = "";
  let toolCalls = 0;
  let turns = 0;
  let model = requested;
  let cost = 0;
  let isError = false;
  let errorText = "";
  const tokens = { input_uncached: 0, input_cached: 0, output: 0 };
  for (const e of jsonLines(stdout)) {
    if (e.type === "system" && typeof e.model === "string") model = e.model;
    if (e.type === "assistant") {
      const content = ((e.message as { content?: { type: string }[] })?.content ?? []) as { type: string }[];
      toolCalls += content.filter((c) => c.type === "tool_use").length;
    }
    if (e.type === "result") {
      isError = e.is_error === true;
      answer = typeof e.result === "string" && !isError ? e.result : answer;
      if (isError && typeof e.result === "string") errorText = e.result;
      turns = Number(e.num_turns ?? 0);
      cost = Number(e.total_cost_usd ?? 0);
      const u = (e.usage ?? {}) as Record<string, number>;
      tokens.input_cached = (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      tokens.input_uncached = u.input_tokens ?? 0;
      tokens.output = u.output_tokens ?? 0;
      const used = Object.keys((e.modelUsage ?? {}) as object);
      if (used.length) model = used.join(",");
    }
  }
  return {
    answer,
    isError,
    errorText,
    toolCalls,
    turns,
    model,
    cost,
    tokens,
    effort: effortArgs?.length ? effortArgs.join(" ") : "not applied: no effort option configured or found",
  };
}

export function claudeBackend(cfg: BenchConfig["claude"] = DEFAULTS.claude, tools: string[] = CLAUDE_TOOLS): Backend {
  return {
    name: "claude",
    async run(prompt: string, ctx: BackendContext): Promise<BackendResult> {
      const env = prependPath(process.env, ctx.toolsDir);
      const r = await runCli(claudeArgv(cfg, tools), {
        cwd: ctx.workspace,
        env,
        deadline: ctx.deadline,
        input: prompt,
      });
      const p = parseClaude(r.stdout, cfg.model, effortArgsFor(cfg));
      const failed = p.isError || (r.code !== 0 && !p.answer);
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
          cost_usd: p.cost,
          ms: r.ms,
        },
        timed_out: r.timedOut,
        ...(failed
          ? {
              error: signInNeeded(r.stderr + r.stdout)
                ? "sign-in needed: run `claude`, then /login"
                : `claude exited ${r.code}`,
            }
          : {}),
      };
    },
  };
}
