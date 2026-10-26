// ACP adapter: Assay as an Agent Client Protocol client (@agentclientprotocol/sdk 2.0.2, ACP v1)
// driving an ACP agent the person installed, e.g. `gemini --experimental-acp` or `claude-code-acp`.
//
// - initialize advertises no fs read/write and no terminal capability, so the agent reaches the
//   workspace through Assay's MCP tools rather than through the client.
// - session/new carries one MCP server: Assay's stdio proxy. session/load resumes when supported.
// - When the agent answers auth_required, Assay calls `authenticate` with a method the agent itself
//   advertised (the agent runs its own sign-in); Assay never handles the credential.
// - session/update -> AgentEvents; session/request_permission -> opts.approve; cancel -> session/cancel.
// The agent keeps its own built-in tools, so enforcement is "partial".
//
// One ProviderId ("acp") covers every configured agent. The agent for an account is the one whose
// name appears in the account label (case-insensitive), else the configured default.

import { tmpdir } from "node:os";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { Json } from "@re4exa/core/evidence/jcs";
import { spawnProcess } from "@re4exa/core/vendor/orca-process-host/run-process";
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
import { acpMcpServers } from "../mcp/config.ts";
import {
  ASSAY_CLIENT_NAME,
  ASSAY_VERSION,
  accountEnv,
  CLAUDE_KEY_VARS,
  estimateTokens,
  programVersion,
  summarize,
  toJson,
  which,
} from "./util.ts";

export interface AcpAgentSpec {
  program: string;
  args: string[];
  /** Variable that points the agent at a separate config home (e.g. CLAUDE_CONFIG_DIR). */
  homeEnv?: string;
  /** Ambient key variables removed for separate-home accounts. */
  stripEnv?: string[];
  /** Official sign-in command; defaults to running the agent program itself interactively. */
  login?: { program: string; args: string[] };
  /** Preferred advertised auth method id; defaults to the first one the agent advertises. */
  authMethod?: string;
}

export interface AcpAdapterOptions {
  agents?: Record<string, AcpAgentSpec>;
  /** Agent used when no agent name appears in the account label. */
  defaultAgent?: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
}

export const DEFAULT_ACP_AGENTS: Record<string, AcpAgentSpec> = {
  gemini: {
    program: "gemini",
    args: ["--experimental-acp"],
    stripEnv: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    login: { program: "gemini", args: [] },
  },
  "claude-code-acp": {
    program: "claude-code-acp",
    args: [],
    homeEnv: "CLAUDE_CONFIG_DIR",
    stripEnv: [...CLAUDE_KEY_VARS],
    login: { program: "claude", args: ["auth", "login"] },
  },
};

const AUTH_REQUIRED = -32000;

export function pickAcpAgent(
  agents: Record<string, AcpAgentSpec>,
  label: string,
  defaultAgent?: string,
): { name: string; spec: AcpAgentSpec } {
  const names = Object.keys(agents);
  if (!names.length) throw new AssayError("provider_unavailable", { provider: "acp", why: "no ACP agents configured" });
  const l = label.toLowerCase();
  const byLabel = names.filter((n) => l.includes(n.toLowerCase())).sort((a, b) => b.length - a.length)[0];
  const name = byLabel ?? (defaultAgent && agents[defaultAgent] ? defaultAgent : names[0]!);
  return { name, spec: agents[name]! };
}

export function acpEnv(
  spec: AcpAgentSpec,
  account: AccountRef,
  base: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  return accountEnv(account.home, spec.homeEnv ?? null, spec.stripEnv ?? [], base);
}

/** Initialize params: no fs, no terminal (exported for tests). */
export function acpInitializeParams(): acp.InitializeRequest {
  return {
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    clientInfo: { name: ASSAY_CLIENT_NAME, title: "Assay", version: ASSAY_VERSION },
  };
}

export function acpSessionMcpServers(opts: SessionOptions): acp.McpServer[] {
  return acpMcpServers(opts.mcp.stdioProxy);
}

interface Connected {
  conn: acp.ClientConnection;
  init: acp.InitializeResponse;
  kill(): Promise<void>;
  stderr(): string;
  exited: Promise<void>;
}

interface Handlers {
  onUpdate(n: acp.SessionNotification): void;
  onPermission(r: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse>;
}

async function connectAgent(
  spec: AcpAgentSpec,
  env: Record<string, string>,
  cwd: string,
  h: Handlers,
  timeoutMs: number,
): Promise<Connected> {
  const child = spawnProcess({ program: spec.program, args: spec.args, env, cwd, stdio: "pipe" });
  let stderr = "";
  for (const s of [child.stdin, child.stdout, child.stderr]) s.on("error", () => {});
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (d: string) => {
    stderr = (stderr + d).slice(-4000);
  });
  const exited = new Promise<void>((resolve) => {
    child.on("exit", () => resolve());
    child.on("error", (e) => {
      stderr += `\n${e.message}`;
      resolve();
    });
  });
  const app = acp.client({ name: ASSAY_CLIENT_NAME });
  app.onNotification(acp.methods.client.session.update, ({ params }) => h.onUpdate(params));
  app.onRequest(acp.methods.client.session.requestPermission, ({ params }) => h.onPermission(params));
  const stream = acp.ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
  );
  const conn = app.connect(stream);
  const kill = async (): Promise<void> => {
    try {
      conn.close();
    } catch {
      // already closed
    }
    child.stdin.end();
    const t = setTimeout(() => child.kill("SIGTERM"), 500);
    const t2 = setTimeout(() => child.kill("SIGKILL"), 2000);
    await exited;
    clearTimeout(t);
    clearTimeout(t2);
  };
  try {
    const init = await withTimeout(
      Promise.race([
        conn.agent.request(acp.methods.agent.initialize, acpInitializeParams()),
        exited.then(() => {
          throw new AssayError(
            "provider_error",
            { provider: "acp", stderr: stderr.slice(-500) },
            "The ACP agent exited during initialize",
          );
        }),
      ]),
      timeoutMs,
      "initialize",
    );
    return { conn, init, kill, stderr: () => stderr, exited };
  } catch (e) {
    await kill();
    throw e;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new AssayError("provider_error", { provider: "acp", what }, `No reply to ${what} within ${ms} ms`)),
      ms,
    );
    t.unref?.();
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function isAuthRequired(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === AUTH_REQUIRED;
}

function authMethodFor(init: acp.InitializeResponse, preferred?: string): string | null {
  const methods = init.authMethods ?? [];
  if (preferred && methods.some((m) => m.id === preferred)) return preferred;
  // Terminal methods mean "run the agent's login in a terminal": that is the Accounts panel's job.
  const usable = methods.filter((m) => (m as { type?: string }).type !== "terminal");
  return usable[0]?.id ?? null;
}

function contentText(c: acp.ContentBlock | undefined): string {
  if (!c) return "";
  if (c.type === "text") return c.text;
  if (c.type === "resource_link") return c.uri;
  return `[${c.type}]`;
}

function toolContentSummary(u: { content?: acp.ToolCallContent[] | null; rawOutput?: unknown }): string {
  const parts: string[] = [];
  for (const c of u.content ?? []) {
    if (c.type === "content") parts.push(contentText(c.content));
    else if (c.type === "diff") parts.push(`diff ${c.path}`);
    else if (c.type === "terminal") parts.push(`terminal ${c.terminalId}`);
  }
  if (!parts.length && u.rawOutput !== undefined) return summarize(u.rawOutput);
  return summarize(parts.join(" "));
}

class AcpSession implements AgentSession {
  providerSessionId: string | null = null;
  #c!: Connected;
  #opts: SessionOptions;
  #toolNames = new Map<string, string>();
  #turnText: string | null = null;
  #replaying = false;
  #cost: number | null = null;
  #closed = false;
  #busy = false;

  constructor(opts: SessionOptions) {
    this.#opts = opts;
  }

  emit(e: AgentEvent): void {
    try {
      this.#opts.onEvent(e);
    } catch {
      // listener failures must not break the session
    }
  }

  async open(spec: AcpAgentSpec, env: Record<string, string>, timeoutMs: number): Promise<void> {
    this.#c = await connectAgent(
      spec,
      env,
      this.#opts.cwd,
      {
        onUpdate: (n) => this.#update(n),
        onPermission: (r) => this.#permission(r),
      },
      timeoutMs,
    );
    void this.#c.exited.then(() => {
      if (!this.#closed) {
        this.emit({
          type: "error",
          message: `ACP agent exited: ${summarize(this.#c.stderr(), 300)}`,
          code: "provider_error",
        });
        this.emit({ type: "status", state: "error" });
      }
    });
    const agent = this.#c.conn.agent;
    const mcpServers = acpSessionMcpServers(this.#opts);
    const createOrLoad = async (): Promise<string> => {
      if (this.#opts.resume && this.#c.init.agentCapabilities?.loadSession) {
        this.#replaying = true;
        try {
          await agent.request(acp.methods.agent.session.load, {
            sessionId: this.#opts.resume,
            cwd: this.#opts.cwd,
            mcpServers,
          });
        } finally {
          this.#replaying = false;
        }
        return this.#opts.resume;
      }
      const r = await agent.request(acp.methods.agent.session.new, { cwd: this.#opts.cwd, mcpServers });
      return r.sessionId;
    };
    try {
      try {
        this.providerSessionId = await withTimeout(createOrLoad(), timeoutMs, "session/new");
      } catch (e) {
        if (!isAuthRequired(e)) throw e;
        const methodId = authMethodFor(this.#c.init, spec.authMethod);
        if (!methodId) throw new AssayError("account_signed_out", { provider: "acp" }, "The ACP agent needs a sign-in");
        await withTimeout(agent.request(acp.methods.agent.authenticate, { methodId }), timeoutMs, "authenticate");
        this.providerSessionId = await withTimeout(createOrLoad(), timeoutMs, "session/new");
      }
    } catch (e) {
      await this.#c.kill();
      if (isAuthRequired(e)) throw new AssayError("account_signed_out", { provider: "acp" }, (e as Error).message);
      if (e instanceof AssayError) throw e;
      throw new AssayError("provider_error", { provider: "acp" }, (e as Error).message ?? String(e));
    }
    this.emit({ type: "status", state: "idle" });
  }

  #update(n: acp.SessionNotification): void {
    if (this.#replaying || (this.providerSessionId && n.sessionId !== this.providerSessionId)) return;
    const u = n.update;
    switch (u.sessionUpdate) {
      case "agent_message_chunk": {
        const t = contentText(u.content);
        if (this.#turnText !== null) this.#turnText += t;
        if (t) this.emit({ type: "text-delta", text: t });
        break;
      }
      case "agent_thought_chunk": {
        const t = contentText(u.content);
        if (t) this.emit({ type: "thinking", text: t });
        break;
      }
      case "tool_call": {
        const name = u.name ?? u.title;
        this.#toolNames.set(u.toolCallId, name);
        this.emit({
          type: "tool-call",
          id: u.toolCallId,
          name,
          input: toJson(u.rawInput ?? { title: u.title, kind: u.kind ?? "other" }),
        });
        if (u.status === "completed" || u.status === "failed")
          this.emit({
            type: "tool-result",
            id: u.toolCallId,
            name,
            ok: u.status === "completed",
            summary: toolContentSummary(u),
          });
        break;
      }
      case "tool_call_update": {
        if (u.status !== "completed" && u.status !== "failed") break;
        const name = this.#toolNames.get(u.toolCallId) ?? u.name ?? u.title ?? "";
        this.emit({
          type: "tool-result",
          id: u.toolCallId,
          name,
          ok: u.status === "completed",
          summary: toolContentSummary(u),
        });
        break;
      }
      case "usage_update":
        if (u.cost && /usd/i.test(String((u.cost as { currency?: string }).currency ?? ""))) {
          this.#cost = Number((u.cost as { amount?: number }).amount ?? 0);
        }
        break;
      default:
        break;
    }
  }

  async #permission(r: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    const tc = r.toolCall;
    const tool = tc.name ?? tc.title ?? this.#toolNames.get(tc.toolCallId) ?? "tool";
    this.emit({ type: "status", state: "blocked", detail: `approval: ${tool}` });
    let ok = false;
    try {
      ok = await this.#opts.approve({
        tool,
        input: toJson(tc.rawInput ?? { title: tc.title ?? null }),
        reason: tc.kind ? `kind: ${tc.kind}` : undefined,
      });
    } catch {
      ok = false;
    }
    if (this.#busy) this.emit({ type: "status", state: "working" });
    const want = ok ? ["allow_once", "allow_always"] : ["reject_once", "reject_always"];
    const opt = want.map((k) => r.options.find((o) => o.kind === k)).find((o) => o !== undefined);
    return opt ? { outcome: { outcome: "selected", optionId: opt.optionId } } : { outcome: { outcome: "cancelled" } };
  }

  async send(text: string): Promise<{ text: string; stopReason: string }> {
    if (this.#closed || !this.providerSessionId)
      throw new AssayError("provider_error", { provider: "acp" }, "The session is closed");
    if (this.#busy) throw new AssayError("bad_request", { why: "a turn is already running" });
    this.#busy = true;
    this.#turnText = "";
    this.emit({ type: "status", state: "working" });
    const costBefore = this.#cost;
    try {
      const r = await Promise.race([
        this.#c.conn.agent.request(acp.methods.agent.session.prompt, {
          sessionId: this.providerSessionId,
          prompt: [{ type: "text", text }],
        }),
        this.#c.exited.then(() => {
          throw new AssayError("provider_error", { provider: "acp" }, "The ACP agent exited during the turn");
        }),
      ]);
      const out = this.#turnText ?? "";
      // ACP v1 reports no token counts; estimate from text (4 characters per token).
      const cost = this.#cost !== null ? Math.max(0, this.#cost - (costBefore ?? 0)) : null;
      this.emit({
        type: "usage",
        inputTokens: estimateTokens(text),
        outputTokens: estimateTokens(out),
        costUsd: cost,
        model: null,
      });
      this.emit({ type: "status", state: "idle" });
      return { text: out, stopReason: r.stopReason };
    } catch (e) {
      const message = (e as Error).message ?? String(e);
      this.emit({ type: "error", message, code: isAuthRequired(e) ? "account_signed_out" : "provider_error" });
      this.emit({ type: "status", state: "error" });
      throw e instanceof AssayError ? e : new AssayError("provider_error", { provider: "acp" }, message);
    } finally {
      this.#busy = false;
      this.#turnText = null;
    }
  }

  async interrupt(): Promise<void> {
    if (!this.#busy || !this.providerSessionId) return;
    await this.#c.conn.agent.notify(acp.methods.agent.session.cancel, { sessionId: this.providerSessionId });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#c.kill();
  }
}

export function createAcpAdapter(o: AcpAdapterOptions = {}): ProviderAdapter {
  const agents = o.agents ?? DEFAULT_ACP_AGENTS;
  const base = o.env ?? process.env;
  const timeout = o.requestTimeoutMs ?? 60_000;
  const resolve = (account: AccountRef): { name: string; spec: AcpAgentSpec } => {
    const picked = pickAcpAgent(agents, account.label, o.defaultAgent);
    const p = which(picked.spec.program, base);
    if (!p)
      throw new AssayError("provider_unavailable", {
        provider: "acp",
        agent: picked.name,
        program: picked.spec.program,
      });
    return { name: picked.name, spec: { ...picked.spec, program: p } };
  };

  return {
    id: "acp",

    async detect(): Promise<ProviderInfo> {
      const found: { name: string; path: string }[] = [];
      for (const [name, spec] of Object.entries(agents)) {
        const p = which(spec.program, base);
        if (p) found.push({ name, path: p });
      }
      const first = found[0];
      const version = first ? await programVersion(first.path) : null;
      return {
        id: "acp",
        installed: found.length > 0,
        version,
        program: first?.path ?? null,
        enforcement: "partial",
        notes: [
          "Driven through the Agent Client Protocol; the agent keeps its own built-in tools.",
          "Assay advertises no file-system or terminal capability, so file access goes through Assay's MCP tools where the agent honours that.",
          `Configured agents: ${Object.keys(agents).join(", ") || "none"}; found: ${found.map((f) => f.name).join(", ") || "none"}.`,
        ],
      };
    },

    async status(account: AccountRef): Promise<AccountStatus> {
      const { name, spec } = resolve(account);
      let c: Connected | null = null;
      try {
        c = await connectAgent(
          spec,
          acpEnv(spec, account, base),
          tmpdir(),
          {
            onUpdate: () => {},
            onPermission: async () => ({ outcome: { outcome: "cancelled" } }),
          },
          timeout,
        );
        const detail: Record<string, Json> = {
          agent: name,
          agentName: c.init.agentInfo?.name ?? null,
          agentVersion: c.init.agentInfo?.version ?? null,
          authMethods: (c.init.authMethods ?? []).map((m) => m.id),
        };
        try {
          await withTimeout(
            c.conn.agent.request(acp.methods.agent.session.new, { cwd: tmpdir(), mcpServers: [] }),
            timeout,
            "session/new",
          );
          return { signedIn: true, method: "acp", detail };
        } catch (e) {
          if (isAuthRequired(e)) return { signedIn: false, method: null, detail };
          return { signedIn: false, method: null, detail: { ...detail, error: summarize((e as Error).message, 300) } };
        }
      } catch (e) {
        return { signedIn: false, method: null, detail: { agent: name, error: summarize((e as Error).message, 300) } };
      } finally {
        await c?.kill();
      }
    },

    loginCommand(account: AccountRef): { program: string; args: string[]; env: Record<string, string> } {
      const { spec } = pickAcpAgent(agents, account.label, o.defaultAgent);
      const login = spec.login ?? { program: spec.program, args: [] };
      return { program: login.program, args: [...login.args], env: acpEnv(spec, account, base) };
    },

    async start(opts: SessionOptions): Promise<AgentSession> {
      const { spec } = resolve(opts.account);
      opts.onEvent({ type: "status", state: "starting" });
      const s = new AcpSession(opts);
      await s.open(spec, acpEnv(spec, opts.account, base), timeout);
      return s;
    },
  };
}
