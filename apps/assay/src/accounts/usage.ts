// Usage accounting: turn `usage` AgentEvents into kernel usage rows per account, worker and case.
//
// Each usage event is one row. Adapters already report per-turn deltas (Claude's cumulative
// total_cost_usd is differenced by the adapter). A turn that is re-sent after a crash is marked
// `resent`, so reports can tell double-billed work from new work.

import type { Kernel } from "@re4exa/core/kernel/kernel";
import type { AgentEvent, ProviderId } from "../contracts.ts";

export interface UsageContext {
  caseId?: string | null;
  accountId?: string | null;
  provider: ProviderId | string;
  workerId?: string | null;
}

/** Record one usage event. Returns false for events that are not usage. */
export function recordUsageEvent(k: Kernel, ctx: UsageContext, e: AgentEvent, resent = false): boolean {
  if (e.type !== "usage") return false;
  k.recordUsage({
    caseId: ctx.caseId ?? null,
    accountId: ctx.accountId ?? null,
    provider: ctx.provider,
    model: e.model,
    workerId: ctx.workerId ?? null,
    inputTokens: Math.max(0, Math.round(e.inputTokens)),
    outputTokens: Math.max(0, Math.round(e.outputTokens)),
    costUsd: e.costUsd,
    resent,
  });
  return true;
}

/**
 * Per-session recorder. Call `beginTurn({resent: true})` before re-sending a turn after a crash; every
 * usage row of that turn carries the flag.
 */
export class UsageRecorder {
  readonly k: Kernel;
  readonly ctx: UsageContext;
  #resent = false;
  #turn = { inputTokens: 0, outputTokens: 0, costUsd: 0, events: 0 };

  constructor(k: Kernel, ctx: UsageContext) {
    this.k = k;
    this.ctx = ctx;
  }

  beginTurn(o: { resent?: boolean } = {}): void {
    this.#resent = o.resent === true;
    this.#turn = { inputTokens: 0, outputTokens: 0, costUsd: 0, events: 0 };
  }

  /** Feed every AgentEvent; usage events are recorded, others ignored. */
  record(e: AgentEvent): void {
    if (!recordUsageEvent(this.k, this.ctx, e, this.#resent) || e.type !== "usage") return;
    this.#turn.inputTokens += e.inputTokens;
    this.#turn.outputTokens += e.outputTokens;
    this.#turn.costUsd += e.costUsd ?? 0;
    this.#turn.events++;
  }

  /** Totals of the current turn so far. */
  turnTotals(): { inputTokens: number; outputTokens: number; costUsd: number; events: number; resent: boolean } {
    return { ...this.#turn, resent: this.#resent };
  }

  /** Wrap an onEvent listener so usage is recorded before the listener runs. */
  wrap(onEvent: (e: AgentEvent) => void): (e: AgentEvent) => void {
    return (e) => {
      this.record(e);
      onEvent(e);
    };
  }
}
