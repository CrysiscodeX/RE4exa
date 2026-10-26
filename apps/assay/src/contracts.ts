// Assay-specific contracts: providers, accounts and agent sessions. The engine-agnostic probe and
// tool contracts live in @re4exa/core/contracts and are re-exported here for existing imports.

import type { Json } from "@re4exa/core/evidence/jcs";

export * from "@re4exa/core/contracts";

// ---------------------------------------------------------------------------------------------
// Providers (src/providers): official agent clients driven on the person's own signed-in account.
// ---------------------------------------------------------------------------------------------

export type ProviderId = "claude" | "codex" | "acp" | "fake";

export interface AccountRef {
  id: string;
  provider: ProviderId;
  label: string;
  /** Separate configuration home for this account (CLAUDE_CONFIG_DIR, CODEX_HOME); null = the person's default. */
  home: string | null;
}

export interface ProviderInfo {
  id: ProviderId;
  installed: boolean;
  version: string | null;
  program: string | null;
  /** "enforced": only Assay's tools; "partial": the client keeps some built-ins; "unenforced". */
  enforcement: "enforced" | "partial" | "unenforced";
  notes: string[];
}

export interface AccountStatus {
  signedIn: boolean;
  method: string | null;
  detail: Record<string, Json>;
}

export type AgentEvent =
  | { type: "status"; state: "starting" | "working" | "idle" | "blocked" | "done" | "error"; detail?: string }
  | { type: "text-delta"; text: string }
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool-call"; id: string; name: string; input: Json }
  | { type: "tool-result"; id: string; name: string; ok: boolean; summary: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; costUsd: number | null; model: string | null }
  | { type: "error"; message: string; code?: string };

export interface SessionOptions {
  account: AccountRef;
  cwd: string;
  model?: string | undefined;
  systemPrompt: string;
  /** Assay's MCP endpoint for this session (bearer token scoped to the caller). */
  mcp: { url: string; token: string; stdioProxy: { program: string; args: string[] } };
  mode: "enforced" | "open";
  /** Provider session id to resume (from an earlier run). */
  resume?: string | undefined;
  onEvent(e: AgentEvent): void;
  /** Built-in tool approval for clients that ask (open mode, Codex, ACP). Resolve true to allow. */
  approve(req: { tool: string; input: Json; reason?: string }): Promise<boolean>;
  maxBudgetUsd?: number | undefined;
}

export interface AgentSession {
  readonly providerSessionId: string | null;
  /** Send one user turn; resolves when the turn ends. */
  send(text: string): Promise<{ text: string; stopReason: string }>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  detect(): Promise<ProviderInfo>;
  status(account: AccountRef): Promise<AccountStatus>;
  /** The official login command for this account's home. Assay runs it; it never reads credentials. */
  loginCommand(account: AccountRef): { program: string; args: string[]; env: Record<string, string> };
  start(opts: SessionOptions): Promise<AgentSession>;
}
