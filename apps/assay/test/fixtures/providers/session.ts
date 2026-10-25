// Shared helpers for provider tests.

import { fileURLToPath } from "node:url";
import type { AccountRef, AgentEvent, SessionOptions } from "../../../src/contracts.ts";
import type { Json } from "../../../src/evidence/jcs.ts";

export const FIXTURES = fileURLToPath(new URL(".", import.meta.url));
export const FAKE_CODEX = fileURLToPath(new URL("./fake-codex-app-server.ts", import.meta.url));
export const FAKE_ACP = fileURLToPath(new URL("./fake-acp-agent.ts", import.meta.url));
export const NODE_ARGS = ["--disable-warning=ExperimentalWarning"];

export interface Recorded {
  opts: SessionOptions;
  events: AgentEvent[];
  approvals: { tool: string; input: Json; reason?: string | undefined }[];
}

export function sessionOpts(
  over: Partial<SessionOptions> & { account?: AccountRef; allow?: boolean | ((tool: string) => boolean) } = {},
): Recorded {
  const events: AgentEvent[] = [];
  const approvals: Recorded["approvals"] = [];
  const allow = over.allow ?? true;
  const opts: SessionOptions = {
    account: over.account ?? { id: "acct_test", provider: "fake", label: "Test", home: null },
    cwd: over.cwd ?? process.cwd(),
    model: over.model,
    systemPrompt: over.systemPrompt ?? "You are Assay's test agent.",
    mcp: over.mcp ?? {
      url: "http://127.0.0.1:9/mcp",
      token: "tok_test",
      stdioProxy: { program: "assay", args: ["mcp-proxy", "--token", "tok_test"] },
    },
    mode: over.mode ?? "enforced",
    resume: over.resume,
    maxBudgetUsd: over.maxBudgetUsd,
    onEvent: (e) => events.push(e),
    approve: async (req) => {
      approvals.push(req);
      return typeof allow === "function" ? allow(req.tool) : allow;
    },
  };
  return { opts, events, approvals };
}

export function textOf(events: AgentEvent[]): string {
  return events.map((e) => (e.type === "text-delta" ? e.text : "")).join("");
}

export function ofType<T extends AgentEvent["type"]>(events: AgentEvent[], t: T): Extract<AgentEvent, { type: T }>[] {
  return events.filter((e): e is Extract<AgentEvent, { type: T }> => e.type === t);
}
