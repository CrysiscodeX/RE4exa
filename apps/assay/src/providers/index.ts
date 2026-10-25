// Provider registry: the adapters by id. It is a Map, so it can be handed to the orchestrator as is.

import type { ProviderAdapter, ProviderId, ProviderInfo } from "../contracts.ts";
import { AssayError } from "../errors.ts";
import { type AcpAdapterOptions, type AcpAgentSpec, createAcpAdapter, DEFAULT_ACP_AGENTS } from "./acp.ts";
import { type ClaudeAdapterOptions, createClaudeAdapter } from "./claude.ts";
import { type CodexAdapterOptions, createCodexAdapter } from "./codex.ts";
import { createFakeAdapter, type FakeAdapterOptions } from "./fake.ts";

export interface ProvidersOptions {
  /** ACP agents by name (merged over the defaults: gemini, claude-code-acp). */
  acpAgents?: Record<string, AcpAgentSpec>;
  acp?: Omit<AcpAdapterOptions, "agents">;
  claude?: ClaudeAdapterOptions;
  codex?: CodexAdapterOptions;
  fake?: FakeAdapterOptions;
  /** Replace or add adapters (tests). */
  overrides?: ProviderAdapter[];
}

export class ProviderRegistry extends Map<ProviderId, ProviderAdapter> {
  /** Detect every provider; a failing detect reports "not installed" instead of throwing. */
  async detectAll(): Promise<ProviderInfo[]> {
    return Promise.all(
      [...this.values()].map(async (a) => {
        try {
          return await a.detect();
        } catch (e) {
          return {
            id: a.id,
            installed: false,
            version: null,
            program: null,
            enforcement: "unenforced" as const,
            notes: [`detect failed: ${(e as Error).message}`],
          };
        }
      }),
    );
  }

  require(id: ProviderId): ProviderAdapter {
    const a = this.get(id);
    if (!a) throw new AssayError("provider_unavailable", { provider: id });
    return a;
  }
}

export function createProviders(o: ProvidersOptions = {}): ProviderRegistry {
  const r = new ProviderRegistry();
  r.set("claude", createClaudeAdapter(o.claude));
  r.set("codex", createCodexAdapter(o.codex));
  r.set("acp", createAcpAdapter({ ...o.acp, agents: { ...DEFAULT_ACP_AGENTS, ...(o.acpAgents ?? {}) } }));
  r.set("fake", createFakeAdapter(o.fake));
  for (const a of o.overrides ?? []) r.set(a.id, a);
  return r;
}

export { createAcpAdapter, createClaudeAdapter, createCodexAdapter, createFakeAdapter };
