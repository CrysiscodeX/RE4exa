// A tiny MCP client over Streamable HTTP (initialize, tools/list, tools/call) with a bearer token.
// The fake provider uses it to behave like a real agent calling Assay's tools.

import type { Json } from "@re4exa/core/evidence/jcs";
import { AssayError } from "../errors.ts";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Json;
}

export interface McpCallResult {
  content: { type: string; text?: string }[];
  structuredContent?: Json;
  isError?: boolean;
}

interface RpcReply {
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class McpHttpClient {
  readonly url: string;
  #token: string;
  #session: string | null = null;
  #version: string | null = null;
  #next = 1;
  #fetch: typeof fetch;

  constructor(url: string, token: string, f: typeof fetch = fetch) {
    this.url = url;
    this.#token = token;
    this.#fetch = f;
  }

  #headers(): Record<string, string> {
    const h: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${this.#token}`,
    };
    if (this.#session) h["mcp-session-id"] = this.#session;
    if (this.#version) h["mcp-protocol-version"] = this.#version;
    return h;
  }

  async #post(body: Record<string, unknown>, signal?: AbortSignal): Promise<RpcReply | null> {
    const res = await this.#fetch(this.url, {
      method: "POST",
      headers: this.#headers(),
      body: JSON.stringify({ jsonrpc: "2.0", ...body }),
      signal,
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.#session = sid;
    if (res.status === 202 || res.status === 204) return null;
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 300);
      try {
        const j = JSON.parse(text) as { error?: { message?: string } };
        if (j.error?.message) msg = j.error.message;
      } catch {
        // not JSON
      }
      throw new AssayError(
        res.status === 401 ? "unauthorized" : "provider_error",
        { status: res.status, url: this.url },
        `MCP HTTP ${res.status}: ${msg}`,
      );
    }
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("text/event-stream")) {
      // Take the JSON-RPC reply carrying our id from the SSE frames.
      let found: RpcReply | null = null;
      for (const frame of text.split(/\r?\n\r?\n/)) {
        const data = frame
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        try {
          const m = JSON.parse(data) as RpcReply;
          if (m.id === body.id) found = m;
        } catch {
          // ignore non-JSON frames
        }
      }
      return found;
    }
    return text ? (JSON.parse(text) as RpcReply) : null;
  }

  async request<T>(method: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const id = this.#next++;
    const r = await this.#post(params ? { id, method, params } : { id, method }, signal);
    if (!r) throw new AssayError("provider_error", { method }, `No MCP reply to ${method}`);
    if (r.error) throw new AssayError("provider_error", { method, code: r.error.code }, r.error.message);
    return r.result as T;
  }

  async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    await this.#post(params ? { method, params } : { method });
  }

  async initialize(clientInfo = { name: "assay-fake-agent", version: "1.0.0" }): Promise<{ protocolVersion: string }> {
    const r = await this.request<{ protocolVersion: string }>("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo,
    });
    this.#version = r.protocolVersion ?? MCP_PROTOCOL_VERSION;
    await this.notify("notifications/initialized");
    return r;
  }

  async listTools(): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 20; i++) {
      const r = await this.request<{ tools: McpTool[]; nextCursor?: string }>("tools/list", cursor ? { cursor } : {});
      tools.push(...(r.tools ?? []));
      cursor = r.nextCursor;
      if (!cursor) break;
    }
    return tools;
  }

  callTool(name: string, args: Record<string, Json>, signal?: AbortSignal): Promise<McpCallResult> {
    return this.request<McpCallResult>("tools/call", { name, arguments: args }, signal);
  }
}

/** Text of a tool result's content blocks. */
export function resultText(r: McpCallResult): string {
  return (r.content ?? []).map((c) => (c.type === "text" ? (c.text ?? "") : `[${c.type}]`)).join("\n");
}
