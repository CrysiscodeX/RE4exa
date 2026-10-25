// Codex adapter over the official `codex app-server` (JSON-RPC 2.0, one JSON object per line on stdio).
//
// Protocol read from openai/codex at commit 970111f6cb62cc02fe36a82ea7d71b37a2889c97 (2026-10-23):
// codex-rs/app-server-protocol/src/protocol/common.rs and schema/typescript/{,v2/}*.ts.
//   client -> server: initialize, initialized (notification), thread/start, thread/resume, turn/start,
//                     turn/interrupt, account/read
//   server -> client notifications: thread/started, turn/started, turn/completed, item/started,
//                     item/completed, item/agentMessage/delta, item/reasoning/textDelta,
//                     item/reasoning/summaryTextDelta, thread/tokenUsage/updated, error
//   server -> client requests: item/commandExecution/requestApproval, item/fileChange/requestApproval,
//                     mcpServer/elicitation/request, (legacy) execCommandApproval, applyPatchApproval
//
// Sessions run with sandbox "read-only" and approvalPolicy "on-request"; every exec or patch approval
// goes to opts.approve. Assay's tools arrive through the stdio MCP proxy (config.mcp_servers.assay).
// Codex keeps its own shell tool, so enforcement is "partial".
// Accounts: CODEX_HOME=account.home (separate home) with ambient API key variables removed; the
// default account passes the environment through. Status: account/read (no token refresh requested).
// Sign-in: the official `codex login` in that home.

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
import { stdioMcpConfig } from "../mcp/config.ts";
import { RpcError, RpcPeer, type RpcPeerOptions } from "./jsonrpc.ts";
import {
  ASSAY_CLIENT_NAME,
  ASSAY_VERSION,
  accountEnv,
  CODEX_KEY_VARS,
  type Deferred,
  deferred,
  programVersion,
  summarize,
  toJson,
  which,
} from "./util.ts";

export const CODEX_PROTOCOL_COMMIT = "970111f6cb62cc02fe36a82ea7d71b37a2889c97";

export interface CodexAdapterOptions {
  /** The `codex` program. Defaults to `codex` on PATH. */
  program?: string;
  /** Arguments placed before `app-server` / `login` (tests run a fake script through node). */
  prefixArgs?: string[];
  env?: NodeJS.ProcessEnv;
  /** Extra arguments for `codex login`, e.g. ["--device-auth"] on a machine without a browser. */
  loginArgs?: string[];
  spawn?: RpcPeerOptions["spawn"];
  requestTimeoutMs?: number;
}

export function codexEnv(account: AccountRef, base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return accountEnv(account.home, "CODEX_HOME", CODEX_KEY_VARS, base);
}

/** Thread configuration (exported for tests). */
export function codexThreadParams(opts: SessionOptions): Record<string, Json> {
  // Codex's mcp_servers entries take command/args/env and no `type` field.
  const { type: _stdio, ...assay } = stdioMcpConfig(opts.mcp.stdioProxy).mcpServers.assay;
  const p: Record<string, Json> = {
    cwd: opts.cwd,
    approvalPolicy: "on-request",
    sandbox: "read-only",
    developerInstructions: opts.systemPrompt,
    config: {
      mcp_servers: {
        assay: { ...assay, default_tools_approval_mode: "approve" },
      },
      web_search: "disabled",
    },
  };
  if (opts.model) p.model = opts.model;
  return p;
}

interface Item {
  type: string;
  id: string;
  text?: string;
  command?: string;
  cwd?: string;
  status?: string;
  exitCode?: number | null;
  aggregatedOutput?: string | null;
  changes?: { path?: string }[];
  server?: string;
  tool?: string;
  arguments?: unknown;
  result?: { content?: unknown; structuredContent?: unknown } | null;
  error?: { message?: string } | null;
  success?: boolean | null;
  query?: string;
}

interface Breakdown {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

interface CodexTurn {
  id: string | null;
  done: Deferred<{ text: string; stopReason: string }>;
  messages: string[];
  delta: string;
  early: { status: string; error: string | null } | null;
}

function itemTool(item: Item): { name: string; input: Json } | null {
  switch (item.type) {
    case "commandExecution":
      return { name: "shell", input: { command: item.command ?? "", cwd: item.cwd ?? "" } };
    case "fileChange":
      return { name: "apply_patch", input: { files: (item.changes ?? []).map((c) => c.path ?? "") } };
    case "mcpToolCall":
      return {
        name: item.server === "assay" ? (item.tool ?? "") : `${item.server ?? "mcp"}.${item.tool ?? ""}`,
        input: toJson(item.arguments),
      };
    case "dynamicToolCall":
      return { name: item.tool ?? "dynamic", input: toJson(item.arguments) };
    case "webSearch":
      return { name: "web_search", input: { query: item.query ?? "" } };
    default:
      return null;
  }
}

function itemResult(item: Item): { ok: boolean; summary: string } {
  switch (item.type) {
    case "commandExecution":
      return {
        ok: item.status === "completed" && (item.exitCode ?? 0) === 0,
        summary:
          `${item.status ?? ""}${item.exitCode !== null && item.exitCode !== undefined ? ` exit ${item.exitCode}` : ""} ${summarize(item.aggregatedOutput ?? "", 240)}`.trim(),
      };
    case "mcpToolCall":
      return item.error
        ? { ok: false, summary: summarize(item.error.message ?? "failed") }
        : { ok: item.status !== "failed", summary: summarize(item.result?.content ?? item.status ?? "") };
    case "dynamicToolCall":
      return { ok: item.success !== false, summary: item.status ?? "" };
    default:
      return { ok: item.status !== "failed" && item.status !== "declined", summary: item.status ?? "" };
  }
}

class CodexSession implements AgentSession {
  providerSessionId: string | null = null;
  #peer: RpcPeer;
  #opts: SessionOptions;
  #turn: CodexTurn | null = null;
  #model: string | null = null;
  #total: Breakdown | null = null;
  #reported = { input: 0, output: 0 };
  #closed = false;
  #timeout: number;

  constructor(peer: RpcPeer, opts: SessionOptions, timeout: number) {
    this.#peer = peer;
    this.#opts = opts;
    this.#timeout = timeout;
  }

  emit(e: AgentEvent): void {
    try {
      this.#opts.onEvent(e);
    } catch {
      // listener failures must not break the session
    }
  }

  async open(): Promise<void> {
    await this.#peer.request(
      "initialize",
      {
        clientInfo: { name: ASSAY_CLIENT_NAME, title: "Assay", version: ASSAY_VERSION },
        capabilities: { experimentalApi: false, requestAttestation: false },
      },
      this.#timeout,
    );
    this.#peer.notify("initialized");
    const params = codexThreadParams(this.#opts);
    const r = this.#opts.resume
      ? await this.#peer.request<{ thread: { id: string }; model?: string }>(
          "thread/resume",
          { threadId: this.#opts.resume, ...params },
          this.#timeout,
        )
      : await this.#peer.request<{ thread: { id: string }; model?: string }>("thread/start", params, this.#timeout);
    this.providerSessionId = r.thread.id;
    this.#model = r.model ?? null;
    this.emit({ type: "status", state: "idle", detail: this.#model ? `model ${this.#model}` : undefined });
  }

  onExit(stderr: string): void {
    const turn = this.#turn;
    this.#turn = null;
    if (this.#closed) return;
    const message = `codex app-server exited${stderr ? `: ${summarize(stderr, 300)}` : ""}`;
    this.emit({ type: "error", message, code: "provider_error" });
    this.emit({ type: "status", state: "error", detail: message });
    turn?.done.reject(new AssayError("provider_error", { provider: "codex" }, message));
  }

  #mine(params: { threadId?: string; turnId?: string }): boolean {
    if (params.threadId && this.providerSessionId && params.threadId !== this.providerSessionId) return false;
    return true;
  }

  onNotification(method: string, raw: unknown): void {
    const p = (raw ?? {}) as Record<string, unknown> & { threadId?: string; turnId?: string };
    if (!this.#mine(p)) return;
    const turn = this.#turn;
    switch (method) {
      case "turn/started":
        if (turn && !turn.id) turn.id = (p.turn as { id?: string } | undefined)?.id ?? null;
        this.emit({ type: "status", state: "working" });
        break;
      case "item/agentMessage/delta":
        if (typeof p.delta === "string" && p.delta) {
          if (turn && !turn.delta && turn.messages.length) this.emit({ type: "text-delta", text: "\n\n" });
          if (turn) turn.delta += p.delta;
          this.emit({ type: "text-delta", text: p.delta });
        }
        break;
      case "item/reasoning/textDelta":
      case "item/reasoning/summaryTextDelta":
        if (typeof p.delta === "string") this.emit({ type: "thinking", text: p.delta });
        break;
      case "item/started": {
        const item = p.item as Item | undefined;
        const tool = item ? itemTool(item) : null;
        if (item && tool) this.emit({ type: "tool-call", id: item.id, name: tool.name, input: tool.input });
        break;
      }
      case "item/completed": {
        const item = p.item as Item | undefined;
        if (!item) break;
        if (item.type === "agentMessage" && typeof item.text === "string") {
          if (turn) {
            // A message that was never streamed as deltas still reaches the timeline.
            if (!turn.delta)
              this.emit({ type: "text-delta", text: turn.messages.length ? `\n\n${item.text}` : item.text });
            turn.messages.push(item.text);
            turn.delta = "";
          }
        } else if (item.type === "reasoning" && turn) {
          // reasoning text already streamed through the delta notifications
        } else {
          const tool = itemTool(item);
          if (tool) {
            const r = itemResult(item);
            this.emit({ type: "tool-result", id: item.id, name: tool.name, ok: r.ok, summary: r.summary });
          }
        }
        break;
      }
      case "thread/tokenUsage/updated": {
        const u = p.tokenUsage as { total?: Breakdown } | undefined;
        if (u?.total) this.#total = u.total;
        break;
      }
      case "error": {
        const e = p.error as { message?: string } | undefined;
        if (p.willRetry === true)
          this.emit({ type: "status", state: "working", detail: `retrying: ${e?.message ?? ""}` });
        else this.emit({ type: "error", message: e?.message ?? "codex error", code: "codex:error" });
        break;
      }
      case "turn/completed": {
        const t = p.turn as { id?: string; status?: string; error?: { message?: string } | null } | undefined;
        this.#endTurn(t?.id ?? null, t?.status ?? "completed", t?.error?.message ?? null);
        break;
      }
      default:
        break;
    }
  }

  #endTurn(turnId: string | null, status: string, error: string | null): void {
    const turn = this.#turn;
    if (!turn) return;
    if (turn.id === null) {
      // turn/completed raced ahead of the turn/start response; settle once the id is known.
      turn.early = { status, error };
      return;
    }
    if (turnId && turn.id !== turnId) return;
    this.#turn = null;
    if (this.#total) {
      const input = this.#total.inputTokens;
      const output = this.#total.outputTokens;
      this.emit({
        type: "usage",
        inputTokens: Math.max(0, input - this.#reported.input),
        outputTokens: Math.max(0, output - this.#reported.output),
        costUsd: null,
        model: this.#model,
      });
      this.#reported = { input, output };
    }
    if (status === "failed")
      this.emit({ type: "error", message: error ?? "the turn failed", code: "codex:turn_failed" });
    this.emit({ type: "status", state: status === "failed" ? "error" : "idle" });
    turn.done.resolve({ text: turn.messages.join("\n\n"), stopReason: status });
  }

  async onRequest(method: string, raw: unknown): Promise<unknown> {
    const p = (raw ?? {}) as Record<string, unknown>;
    switch (method) {
      case "item/commandExecution/requestApproval": {
        const ok = await this.#ask(
          "shell",
          { command: (p.command as string) ?? "", cwd: (p.cwd as string) ?? "" },
          p.reason,
        );
        return { decision: ok ? "accept" : "decline" };
      }
      case "item/fileChange/requestApproval": {
        const ok = await this.#ask(
          "apply_patch",
          { itemId: (p.itemId as string) ?? "", grantRoot: (p.grantRoot as string) ?? null },
          p.reason,
        );
        return { decision: ok ? "accept" : "decline" };
      }
      case "execCommandApproval": {
        const ok = await this.#ask("shell", { command: toJson(p.command), cwd: (p.cwd as string) ?? "" }, p.reason);
        return { decision: ok ? "approved" : { denied: { rejection: "The person denied this in Assay." } } };
      }
      case "applyPatchApproval": {
        const ok = await this.#ask("apply_patch", { files: Object.keys((p.fileChanges as object) ?? {}) }, p.reason);
        return { decision: ok ? "approved" : { denied: { rejection: "The person denied this in Assay." } } };
      }
      case "mcpServer/elicitation/request": {
        const ok = await this.#ask(
          `mcp:${String(p.serverName ?? "")}`,
          { message: (p.message as string) ?? "" },
          p.message,
        );
        return { action: ok ? "accept" : "decline", content: ok ? {} : null, _meta: null };
      }
      default:
        throw new RpcError(-32601, `Assay does not handle ${method}`);
    }
  }

  async #ask(tool: string, input: Json, reason: unknown): Promise<boolean> {
    this.emit({ type: "status", state: "blocked", detail: `approval: ${tool}` });
    try {
      return await this.#opts.approve({ tool, input, reason: typeof reason === "string" ? reason : undefined });
    } catch {
      return false;
    } finally {
      if (this.#turn) this.emit({ type: "status", state: "working" });
    }
  }

  async send(text: string): Promise<{ text: string; stopReason: string }> {
    if (this.#closed || !this.providerSessionId)
      throw new AssayError("provider_error", { provider: "codex" }, "The session is closed");
    if (this.#turn) throw new AssayError("bad_request", { why: "a turn is already running" });
    const turn: CodexTurn = { id: null, done: deferred(), messages: [], delta: "", early: null };
    this.#turn = turn;
    this.emit({ type: "status", state: "working" });
    try {
      const r = await this.#peer.request<{ turn: { id: string } }>(
        "turn/start",
        { threadId: this.providerSessionId, input: [{ type: "text", text, text_elements: [] }] },
        this.#timeout,
      );
      turn.id = r.turn.id;
      if (turn.early) this.#endTurn(turn.id, turn.early.status, turn.early.error);
    } catch (e) {
      if (this.#turn === turn) this.#turn = null;
      throw e;
    }
    return turn.done.promise;
  }

  async interrupt(): Promise<void> {
    const turn = this.#turn;
    if (!turn?.id || !this.providerSessionId) return;
    await this.#peer.request("turn/interrupt", { threadId: this.providerSessionId, turnId: turn.id }, this.#timeout);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    const turn = this.#turn;
    this.#turn = null;
    turn?.done.resolve({ text: turn.messages.join("\n\n"), stopReason: "closed" });
    await this.#peer.close();
  }
}

export function createCodexAdapter(o: CodexAdapterOptions = {}): ProviderAdapter {
  const base = o.env ?? process.env;
  const program = (): string | null => o.program ?? which("codex", base);
  const prefix = o.prefixArgs ?? [];
  const timeout = o.requestTimeoutMs ?? 120_000;

  return {
    id: "codex",

    async detect(): Promise<ProviderInfo> {
      const p = program();
      const version = p ? await programVersion(p, [...prefix, "--version"]) : null;
      return {
        id: "codex",
        installed: p !== null,
        version,
        program: p,
        enforcement: "partial",
        notes: [
          "Driven through the official `codex app-server` protocol on the account's own sign-in.",
          "Partial: Codex keeps its own shell tool. Sessions run in a read-only sandbox with approvals on request, and every command or patch approval goes to the person.",
          ...(p ? [] : ["Install the Codex CLI (`codex`) and sign in to use this provider."]),
        ],
      };
    },

    async status(account: AccountRef): Promise<AccountStatus> {
      const p = program();
      if (!p) throw new AssayError("provider_unavailable", { provider: "codex" });
      const peer = new RpcPeer({
        program: p,
        args: [...prefix, "app-server"],
        env: codexEnv(account, base),
        spawn: o.spawn,
        onNotification: () => {},
        onRequest: async (m) => {
          throw new RpcError(-32601, `Assay does not handle ${m}`);
        },
      });
      try {
        await peer.request(
          "initialize",
          {
            clientInfo: { name: ASSAY_CLIENT_NAME, title: "Assay", version: ASSAY_VERSION },
            capabilities: { experimentalApi: false, requestAttestation: false },
          },
          30_000,
        );
        peer.notify("initialized");
        // refreshToken false: Assay never asks the client to refresh credentials on its behalf.
        const r = await peer.request<{ account: Record<string, unknown> | null; requiresOpenaiAuth: boolean }>(
          "account/read",
          { refreshToken: false },
          30_000,
        );
        return parseCodexAccount(r);
      } catch (e) {
        return { signedIn: false, method: null, detail: { error: summarize((e as Error).message, 300) } };
      } finally {
        await peer.close(500);
      }
    },

    loginCommand(account: AccountRef): { program: string; args: string[]; env: Record<string, string> } {
      return {
        program: program() ?? "codex",
        args: [...prefix, "login", ...(o.loginArgs ?? [])],
        env: codexEnv(account, base),
      };
    },

    async start(opts: SessionOptions): Promise<AgentSession> {
      const p = program();
      if (!p) throw new AssayError("provider_unavailable", { provider: "codex" });
      opts.onEvent({ type: "status", state: "starting" });
      let session: CodexSession | null = null;
      const peer = new RpcPeer({
        program: p,
        args: [...prefix, "app-server"],
        env: codexEnv(opts.account, base),
        cwd: opts.cwd,
        spawn: o.spawn,
        onNotification: (m, params) => session?.onNotification(m, params),
        onRequest: (m, params) => {
          if (!session) return Promise.reject(new RpcError(-32603, "session not ready"));
          return session.onRequest(m, params);
        },
        onExit: (_c, _s, stderr) => session?.onExit(stderr),
      });
      session = new CodexSession(peer, opts, timeout);
      try {
        await session.open();
      } catch (e) {
        await peer.close(500);
        if (e instanceof RpcError && /auth|login|sign/i.test(e.message))
          throw new AssayError("account_signed_out", { provider: "codex", account: opts.account.id }, e.message);
        if (e instanceof RpcError)
          throw new AssayError("provider_error", { provider: "codex", code: e.code }, e.message);
        throw e;
      }
      return session;
    },
  };
}

/** Map an account/read response to AccountStatus (non-secret fields only). */
export function parseCodexAccount(r: {
  account: Record<string, unknown> | null;
  requiresOpenaiAuth: boolean;
}): AccountStatus {
  const a = r.account;
  if (!a) {
    return r.requiresOpenaiAuth
      ? { signedIn: false, method: null, detail: { requiresOpenaiAuth: true } }
      : { signedIn: true, method: "provider", detail: { requiresOpenaiAuth: false } };
  }
  const detail: Record<string, Json> = { type: String(a.type ?? "") };
  if (typeof a.email === "string") detail.email = a.email;
  if (typeof a.planType === "string") detail.planType = a.planType;
  return { signedIn: true, method: String(a.type ?? "unknown"), detail };
}
