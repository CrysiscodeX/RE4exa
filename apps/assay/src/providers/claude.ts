// Claude adapter over the official Claude Agent SDK (@anthropic-ai/claude-agent-sdk 0.3.310).
//
// - One SDK `query` per session in streaming-input mode: each `send` pushes a user message and
//   resolves at that turn's `result` message.
// - Enforced mode: `tools: []` removes every built-in tool (t3code ran the CLI with `--tools ""`),
//   `strictMcpConfig` ignores the workspace's own MCP config and `settingSources: ["user"]` skips the
//   workspace's project settings (the workspace is the thing under examination, so it is untrusted).
//   Only `mcp__assay__*` tools exist.
// - Open mode: built-ins stay; anything that is not read-only goes to `opts.approve` via `canUseTool`.
// - Accounts: a separate home sets CLAUDE_CONFIG_DIR and removes ambient key variables so the home's
//   own login is used; the default account (home null) passes the environment through unchanged.
//   Status comes from the official `claude auth status`; sign-in is the official `claude auth login`.

import type { CanUseTool, Options, PermissionResult, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  AccountRef,
  AccountStatus,
  AgentEvent,
  AgentSession,
  ProviderAdapter,
  ProviderInfo,
  SessionOptions,
} from "../contracts.ts";
import { AssayError } from "../errors.ts";
import type { Json } from "../evidence/jcs.ts";
import { claudeMcpConfig } from "../mcp/config.ts";
import { runProcess } from "../vendor/orca-process-host/run-process.ts";
import {
  ASSAY_CLIENT_NAME,
  ASSAY_VERSION,
  accountEnv,
  CLAUDE_KEY_VARS,
  type Deferred,
  deferred,
  programVersion,
  summarize,
  toJson,
  which,
} from "./util.ts";

/** The part of the SDK's `Query` the adapter uses. */
export interface ClaudeQuery extends AsyncIterable<SDKMessage> {
  interrupt(): Promise<unknown>;
  close(): void;
}

export type ClaudeQueryFn = (params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => ClaudeQuery;

export interface ClaudeAdapterOptions {
  /** Injected SDK `query` (tests). Defaults to the real SDK, loaded on first use. */
  query?: ClaudeQueryFn;
  /** The `claude` program for detect/status/login. Defaults to `claude` on PATH. */
  program?: string;
  /** Passed to the SDK as `pathToClaudeCodeExecutable`; omitted means the SDK's bundled CLI. */
  executable?: string;
  /** Base environment (tests). Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Runs the official CLI for status (tests). */
  run?: (spec: {
    program: string;
    args: string[];
    env: Record<string, string>;
    timeoutMs: number;
  }) => Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>;
}

/** Built-in tools that only read; open mode lets them run without asking. */
const READ_ONLY_TOOLS = new Set(["Read", "Glob", "Grep", "LS", "NotebookRead", "TodoWrite", "ToolSearch"]);
const ASSAY_PREFIX = "mcp__assay__";

/** Environment for an account's Claude process (exported for tests). */
export function claudeEnv(account: AccountRef, base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return accountEnv(account.home, "CLAUDE_CONFIG_DIR", CLAUDE_KEY_VARS, base, {
    CLAUDE_AGENT_SDK_CLIENT_APP: `${ASSAY_CLIENT_NAME}/${ASSAY_VERSION}`,
  });
}

/** SDK options for a session (exported for tests). */
export function claudeOptions(
  opts: SessionOptions,
  extra: {
    canUseTool: CanUseTool;
    abortController: AbortController;
    env: Record<string, string>;
    executable?: string;
    stderr?: (d: string) => void;
  },
): Options {
  const enforced = opts.mode === "enforced";
  const o: Options = {
    cwd: opts.cwd,
    systemPrompt: { type: "preset", preset: "claude_code", append: opts.systemPrompt },
    mcpServers: claudeMcpConfig(opts.mcp.url, opts.mcp.token).mcpServers,
    allowedTools: ["mcp__assay"],
    canUseTool: extra.canUseTool,
    permissionMode: "default",
    includePartialMessages: true,
    env: extra.env,
    abortController: extra.abortController,
  };
  if (enforced) {
    o.tools = [];
    o.strictMcpConfig = true;
    o.settingSources = ["user"];
  }
  if (opts.model) o.model = opts.model;
  if (opts.resume) o.resume = opts.resume;
  if (opts.maxBudgetUsd !== undefined) o.maxBudgetUsd = opts.maxBudgetUsd;
  if (extra.executable) o.pathToClaudeCodeExecutable = extra.executable;
  if (extra.stderr) o.stderr = extra.stderr;
  return o;
}

/** Permission callback: Assay tools pass; enforced mode refuses the rest; open mode asks the person. */
export function claudeCanUseTool(opts: Pick<SessionOptions, "mode" | "approve">): CanUseTool {
  return async (toolName, input, o): Promise<PermissionResult> => {
    if (toolName.startsWith(ASSAY_PREFIX)) return { behavior: "allow", updatedInput: input };
    if (opts.mode === "enforced")
      return { behavior: "deny", message: "Only Assay's tools are available in this session (enforced mode)." };
    if (READ_ONLY_TOOLS.has(toolName)) return { behavior: "allow", updatedInput: input };
    const reason = o.title ?? o.decisionReason ?? `the agent client asked to use ${toolName}`;
    const ok = await opts.approve({ tool: toolName, input: toJson(input), reason });
    return ok
      ? { behavior: "allow", updatedInput: input }
      : { behavior: "deny", message: "The person denied this action in Assay." };
  };
}

/** Async queue of user messages fed to the SDK in streaming-input mode. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  #items: SDKUserMessage[] = [];
  #waiters: ((r: IteratorResult<SDKUserMessage>) => void)[] = [];
  #ended = false;

  push(text: string): void {
    const m: SDKUserMessage = { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null };
    const w = this.#waiters.shift();
    if (w) w({ value: m, done: false });
    else this.#items.push(m);
  }

  end(): void {
    this.#ended = true;
    for (const w of this.#waiters.splice(0)) w({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const m = this.#items.shift();
        if (m) return Promise.resolve({ value: m, done: false });
        if (this.#ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((res) => this.#waiters.push(res));
      },
      return: () => {
        this.end();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}

// Loose views of SDK messages: only the fields the mapping reads.
interface Block {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}
interface LooseMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  parent_tool_use_id?: string | null;
  error?: string;
  message?: { id?: string; model?: string; content?: Block[] | string };
  event?: {
    type: string;
    message?: { id?: string };
    content_block?: Block;
    delta?: { type: string; text?: string; thinking?: string };
  };
  result?: string;
  is_error?: boolean;
  errors?: string[];
  stop_reason?: string | null;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  modelUsage?: Record<
    string,
    { inputTokens: number; outputTokens: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number }
  >;
}

interface Turn {
  done: Deferred<{ text: string; stopReason: string }>;
  text: string;
  streamedMessages: Set<string>;
  currentMessage: string | null;
}

class ClaudeSession implements AgentSession {
  providerSessionId: string | null;
  #q: ClaudeQuery;
  #input: InputQueue;
  #opts: SessionOptions;
  #abort: AbortController;
  #turn: Turn | null = null;
  #toolNames = new Map<string, string>();
  #model: string | null = null;
  #cost = 0;
  #tokens = { input: 0, output: 0 };
  #closed = false;
  #ended = false;
  #stderr: string[] = [];
  #loop: Promise<void>;

  constructor(opts: SessionOptions, queryFn: ClaudeQueryFn, env: Record<string, string>, executable?: string) {
    this.#opts = opts;
    this.providerSessionId = opts.resume ?? null;
    this.#input = new InputQueue();
    this.#abort = new AbortController();
    const options = claudeOptions(opts, {
      canUseTool: claudeCanUseTool(opts),
      abortController: this.#abort,
      env,
      executable,
      stderr: (d) => {
        this.#stderr.push(d);
        if (this.#stderr.length > 20) this.#stderr.shift();
      },
    });
    this.#q = queryFn({ prompt: this.#input, options });
    this.#loop = this.#read();
  }

  #emit(e: AgentEvent): void {
    try {
      this.#opts.onEvent(e);
    } catch {
      // a listener's failure must not break the session
    }
  }

  async #read(): Promise<void> {
    try {
      for await (const msg of this.#q) this.#handle(msg as unknown as LooseMessage);
      this.#finish(null);
    } catch (e) {
      this.#finish(e);
    }
  }

  #finish(err: unknown): void {
    this.#ended = true;
    const turn = this.#turn;
    this.#turn = null;
    if (err && !this.#closed) {
      const message = `${(err as Error).message ?? String(err)}${this.#stderr.length ? ` (${summarize(this.#stderr.join(""), 400)})` : ""}`;
      this.#emit({ type: "error", message, code: "provider_error" });
      this.#emit({ type: "status", state: "error", detail: message });
      turn?.done.reject(new AssayError("provider_error", { provider: "claude" }, message));
      return;
    }
    if (!this.#closed) this.#emit({ type: "status", state: "done" });
    turn?.done.reject(
      new AssayError("provider_error", { provider: "claude" }, "The Claude client exited during the turn"),
    );
  }

  #handle(m: LooseMessage): void {
    const top = m.parent_tool_use_id === null || m.parent_tool_use_id === undefined;
    switch (m.type) {
      case "system":
        if (m.subtype === "init") {
          if (m.session_id) this.providerSessionId = m.session_id;
          if (m.model) this.#model = m.model;
          this.#emit({ type: "status", state: "working", detail: m.model ? `model ${m.model}` : undefined });
        }
        break;
      case "stream_event":
        if (top) this.#stream(m);
        break;
      case "assistant":
        if (top) this.#assistant(m);
        break;
      case "user":
        this.#toolResults(m);
        break;
      case "result":
        this.#result(m);
        break;
      default:
        break;
    }
  }

  #stream(m: LooseMessage): void {
    const ev = m.event;
    const turn = this.#turn;
    if (!ev || !turn) return;
    if (ev.type === "message_start") turn.currentMessage = ev.message?.id ?? null;
    else if (ev.type === "content_block_start" && ev.content_block?.type === "text" && turn.text)
      this.#textDelta("\n\n");
    else if (ev.type === "content_block_delta") {
      if (ev.delta?.type === "text_delta" && ev.delta.text) {
        if (turn.currentMessage) turn.streamedMessages.add(turn.currentMessage);
        this.#textDelta(ev.delta.text);
      } else if (ev.delta?.type === "thinking_delta" && ev.delta.thinking) {
        if (turn.currentMessage) turn.streamedMessages.add(`${turn.currentMessage}:thinking`);
        this.#emit({ type: "thinking", text: ev.delta.thinking });
      }
    }
  }

  #textDelta(text: string): void {
    if (this.#turn) this.#turn.text += text;
    this.#emit({ type: "text-delta", text });
  }

  #assistant(m: LooseMessage): void {
    const msg = m.message;
    if (m.model ?? msg?.model) this.#model = (m.model ?? msg?.model) as string;
    if (m.error) {
      const code = m.error === "authentication_failed" ? "account_signed_out" : `claude:${m.error}`;
      this.#emit({ type: "error", message: `Claude reported ${m.error}`, code });
    }
    const blocks = Array.isArray(msg?.content) ? msg.content : [];
    const id = msg?.id ?? "";
    const streamedText = this.#turn?.streamedMessages.has(id) ?? false;
    const streamedThinking = this.#turn?.streamedMessages.has(`${id}:thinking`) ?? false;
    for (const b of blocks) {
      if (b.type === "text" && b.text && !streamedText) this.#textDelta(this.#turn?.text ? `\n\n${b.text}` : b.text);
      else if (b.type === "thinking" && b.thinking && !streamedThinking)
        this.#emit({ type: "thinking", text: b.thinking });
      else if (b.type === "tool_use" && b.id && b.name) {
        this.#toolNames.set(b.id, b.name);
        this.#emit({ type: "tool-call", id: b.id, name: b.name, input: toJson(b.input) });
      }
    }
  }

  #toolResults(m: LooseMessage): void {
    const content = m.message?.content;
    if (!Array.isArray(content)) return;
    for (const b of content) {
      if (b.type !== "tool_result" || !b.tool_use_id) continue;
      this.#emit({
        type: "tool-result",
        id: b.tool_use_id,
        name: this.#toolNames.get(b.tool_use_id) ?? "",
        ok: b.is_error !== true,
        summary: summarize(b.content),
      });
    }
  }

  #result(m: LooseMessage): void {
    // total_cost_usd and modelUsage are cumulative for the query; Assay records per-turn deltas.
    const cost = typeof m.total_cost_usd === "number" ? m.total_cost_usd : null;
    let input = 0;
    let output = 0;
    let model = this.#model;
    if (m.modelUsage && Object.keys(m.modelUsage).length) {
      let i = 0;
      let o = 0;
      for (const [name, u] of Object.entries(m.modelUsage)) {
        i += u.inputTokens + (u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0);
        o += u.outputTokens;
        model ??= name;
      }
      input = Math.max(0, i - this.#tokens.input);
      output = Math.max(0, o - this.#tokens.output);
      this.#tokens = { input: i, output: o };
    } else if (m.usage) {
      const u = m.usage;
      input = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      output = u.output_tokens ?? 0;
    }
    let costDelta: number | null = null;
    if (cost !== null) {
      costDelta = Math.max(0, cost - this.#cost);
      this.#cost = cost;
    }
    this.#emit({ type: "usage", inputTokens: input, outputTokens: output, costUsd: costDelta, model });
    const failed = m.is_error === true || (m.subtype !== undefined && m.subtype !== "success");
    if (failed) {
      const message = m.errors?.length ? m.errors.join("; ") : m.result || m.subtype || "error";
      const code = /auth|log ?in/i.test(message) ? "account_signed_out" : `claude:${m.subtype ?? "error"}`;
      this.#emit({ type: "error", message, code });
    }
    this.#emit({ type: "status", state: failed ? "error" : "idle" });
    const turn = this.#turn;
    this.#turn = null;
    turn?.done.resolve({
      text: m.subtype === "success" && typeof m.result === "string" ? m.result : (turn?.text ?? ""),
      stopReason: m.subtype === "success" ? (m.stop_reason ?? "end_turn") : (m.subtype ?? "error"),
    });
  }

  async send(text: string): Promise<{ text: string; stopReason: string }> {
    if (this.#closed || this.#ended)
      throw new AssayError("provider_error", { provider: "claude" }, "The Claude session has ended");
    if (this.#turn) throw new AssayError("bad_request", { why: "a turn is already running" });
    const turn: Turn = { done: deferred(), text: "", streamedMessages: new Set(), currentMessage: null };
    this.#turn = turn;
    this.#emit({ type: "status", state: "working" });
    this.#input.push(text);
    return turn.done.promise;
  }

  async interrupt(): Promise<void> {
    if (this.#closed || !this.#turn) return;
    await this.#q.interrupt();
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#input.end();
    try {
      this.#q.close();
    } catch {
      // already closed
    }
    this.#abort.abort();
    await Promise.race([this.#loop, new Promise((r) => setTimeout(r, 2000))]);
  }
}

async function defaultQuery(): Promise<ClaudeQueryFn> {
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  return sdk.query as unknown as ClaudeQueryFn;
}

export function createClaudeAdapter(o: ClaudeAdapterOptions = {}): ProviderAdapter {
  const base = o.env ?? process.env;
  const program = (): string | null => o.program ?? which("claude", base);
  const run =
    o.run ??
    ((spec: { program: string; args: string[]; env: Record<string, string>; timeoutMs: number }) =>
      runProcess({ ...spec, maxOutputBytes: 256 * 1024 }));
  let queryFn: ClaudeQueryFn | undefined = o.query;

  return {
    id: "claude",

    async detect(): Promise<ProviderInfo> {
      const p = program();
      const version = p ? await programVersion(p) : null;
      return {
        id: "claude",
        installed: p !== null,
        version,
        program: p,
        enforcement: "enforced",
        notes: [
          "Driven through the official Claude Agent SDK on the account's own sign-in.",
          "Enforced mode removes every built-in tool (tools: []), so only Assay's MCP tools exist.",
          ...(p ? [] : ["Install Claude Code (`claude`) and sign in to use this provider."]),
        ],
      };
    },

    async status(account: AccountRef): Promise<AccountStatus> {
      const p = program();
      if (!p) throw new AssayError("provider_unavailable", { provider: "claude" });
      const r = await run({
        program: p,
        args: ["auth", "status", "--json"],
        env: claudeEnv(account, base),
        timeoutMs: 20_000,
      });
      return parseClaudeAuthStatus(r.stdout, r.stderr, r.code, r.timedOut);
    },

    loginCommand(account: AccountRef): { program: string; args: string[]; env: Record<string, string> } {
      return { program: program() ?? "claude", args: ["auth", "login"], env: claudeEnv(account, base) };
    },

    async start(opts: SessionOptions): Promise<AgentSession> {
      queryFn ??= await defaultQuery();
      const s = new ClaudeSession(opts, queryFn, claudeEnv(opts.account, base), o.executable);
      opts.onEvent({ type: "status", state: "starting" });
      return s;
    },
  };
}

/** Parse `claude auth status --json`. Only non-secret fields are kept. */
export function parseClaudeAuthStatus(
  stdout: string,
  stderr: string,
  code: number | null,
  timedOut: boolean,
): AccountStatus {
  const start = stdout.indexOf("{");
  let parsed: Record<string, unknown> | null = null;
  if (start >= 0) {
    try {
      parsed = JSON.parse(stdout.slice(start, stdout.lastIndexOf("}") + 1)) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
  }
  if (!parsed) {
    const why = timedOut ? "claude auth status timed out" : summarize(stderr || stdout || `exit ${code}`, 200);
    return { signedIn: false, method: null, detail: { error: why, exitCode: code } };
  }
  const detail: Record<string, Json> = {};
  for (const k of ["authMethod", "apiProvider", "subscriptionType", "email", "orgName", "configDirectory"]) {
    const v = parsed[k];
    if (typeof v === "string" || typeof v === "boolean") detail[k] = v;
  }
  const method = typeof parsed.authMethod === "string" && parsed.authMethod !== "none" ? parsed.authMethod : null;
  return { signedIn: parsed.loggedIn === true, method, detail };
}
