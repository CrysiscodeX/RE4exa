// Coordinator and workers (Orca's model on Assay's kernel).
//
// - A case has one coordinator agent session and any number of worker sessions. Each worker is a
//   kernel task (queue "workers") with its own provider session, MCP token (caller = worker id),
//   optional git worktree, and mailbox messages back to the coordinator.
// - Safety rules: workers cannot start workers (depth 1); 3 consecutive worker failures open the
//   breaker; worker task text has a prompt budget; spawn requests carry a retry id with a receipt.
// - Turn durability: the case log, evidence and claims are durable. A model turn is an unsafe
//   effect: after a crash it is settled as interrupted and the person decides whether to resend
//   (model requests cannot be deduplicated, so Assay never re-spends silently).
// - Liveness: live | exited | unverifiable. Workers found running after a restart are
//   unverifiable, never exited, and are not restarted automatically.

import type { AccountRef, AgentEvent, AgentSession, ProviderAdapter, ProviderId, ToolDef } from "../contracts.ts";
import { AssayError, isAssayError } from "../errors.ts";
import type { Json } from "../evidence/jcs.ts";
import type { AgentClaim } from "../evidence/store.ts";
import { caseClaims, listUnknowns, recordClaim } from "../evidence/store.ts";
import { newId } from "../kernel/ids.ts";
import type { Attempt, Kernel, TaskRow } from "../kernel/kernel.ts";
import type {
  CostEstimate,
  Mode,
  SendMessageRequest,
  ServerPush,
  TimelineEntry,
  WorkerLiveness,
  WorkerStatus,
  WorkerView,
} from "../server/api-types.ts";
import { COORDINATOR_PROMPT, SECOND_OPINION_TASK, workerPrompt } from "./prompts.ts";
import { addWorktree, isGitRepo, removeWorktree, worktreeName, worktreeRoot } from "./worktree.ts";

export const PROMPT_BUDGET_CHARS = 8_000;
export const BREAKER_THRESHOLD = 3;
const TURN_LEASE_MS = 30 * 60_000;

export interface McpHost {
  url: string;
  issue(caseId: string, caller: string): string;
  revoke(token: string): void;
  stdioProxy(token: string): { program: string; args: string[] };
}

export interface VerifierLike {
  verifyCase(caseId: string): Promise<unknown>;
  parseClaimBlocks(text: string): { claims: AgentClaim[] } | AgentClaim[];
}

export interface OrchestratorDeps {
  kernel: Kernel;
  providers: Map<ProviderId, ProviderAdapter>;
  account(id: string): AccountRef | undefined;
  mcp: McpHost;
  approve(input: {
    caseId: string;
    workerId: string | null;
    action: string;
    detail: Json;
    reason: string;
  }): Promise<void>;
  verifier?: VerifierLike | undefined;
  home: string;
  emit(push: ServerPush): void;
  /** Called when a case's aggregate state changes; the server pushes a fresh CaseSummary. */
  caseChanged?(caseId: string): void;
}

interface Runner {
  session: AgentSession;
  token: string;
  provider: ProviderId;
  accountId: string;
  busy: Promise<unknown> | null;
  status: WorkerStatus;
  liveness: WorkerLiveness;
  lastEventAt: number;
  costUsd: number;
  text: string;
}

interface CaseRuntime {
  coordinator: Runner | null;
  workers: Map<string, Runner>;
}

interface WorkerParams {
  title: string;
  task: string;
  provider: ProviderId;
  accountId: string;
  worktree: string | null;
  repo: string | null;
  providerSessionId: string | null;
  result: string | null;
  released: boolean;
  liveness?: WorkerLiveness;
}

export class Orchestrator {
  readonly deps: OrchestratorDeps;
  readonly #cases = new Map<string, CaseRuntime>();

  constructor(deps: OrchestratorDeps) {
    this.deps = deps;
  }

  get k(): Kernel {
    return this.deps.kernel;
  }

  #rt(caseId: string): CaseRuntime {
    let rt = this.#cases.get(caseId);
    if (!rt) {
      rt = { coordinator: null, workers: new Map() };
      this.#cases.set(caseId, rt);
    }
    return rt;
  }

  // ---------- timeline ----------

  log(
    caseId: string,
    kind: TimelineEntry["kind"],
    text: string,
    data?: unknown,
    workerId: string | null = null,
  ): TimelineEntry {
    const e = this.k.appendEvent(caseId, kind, { text, data: data ?? null, workerId });
    const entry: TimelineEntry = { seq: e.seq, at: e.at, kind, workerId, text, data };
    this.deps.emit({ type: "timeline", caseId, entry });
    return entry;
  }

  timeline(caseId: string): TimelineEntry[] {
    return this.k.events(caseId).map((e) => {
      const b = (e.body ?? {}) as { text?: string; data?: unknown; workerId?: string | null };
      return {
        seq: e.seq,
        at: e.at,
        kind: e.kind as TimelineEntry["kind"],
        workerId: b.workerId ?? null,
        text: b.text ?? "",
        data: b.data ?? undefined,
      };
    });
  }

  // ---------- startup recovery ----------

  /** Settle work left by a dead process: interrupted turns, unverifiable workers. */
  recover(): { turnsInterrupted: number; workersUnverifiable: number } {
    this.k.expireOrphanedAttempts();
    let turnsInterrupted = 0;
    for (const t of this.k
      .listTasks({ queue: "turns" })
      .filter((t) => t.state === "running" || t.state === "pending")) {
      const att = this.#claimSpecific("turns", t.id);
      if (!att) continue;
      turnsInterrupted++;
      this.k.failTask(att, new AssayError("effect_interrupted", { turn: t.id }), { final: true });
      if (t.case_id)
        this.log(
          t.case_id,
          "error",
          "The previous model turn was interrupted when Assay stopped. Its partial output is not reused. Send the message again to retry.",
          { code: "effect_interrupted" },
        );
    }
    let workersUnverifiable = 0;
    for (const t of this.k
      .listTasks({ queue: "workers" })
      .filter((t) => t.state === "running" || t.state === "pending")) {
      const p = t.params as WorkerParams;
      if (p.released) continue;
      workersUnverifiable++;
      this.#setWorkerParams(t.id, { liveness: "unverifiable" });
    }
    return { turnsInterrupted, workersUnverifiable };
  }

  #claimSpecific(_queue: string, taskId: string, leaseMs = TURN_LEASE_MS): Attempt | null {
    return this.k.claimTaskById(taskId, "orchestrator", leaseMs);
  }

  // ---------- coordinator turns ----------

  async #ensureCoordinator(caseId: string, req: SendMessageRequest): Promise<Runner> {
    const rt = this.#rt(caseId);
    const mode: Mode = req.mode ?? "enforced";
    if (rt.coordinator && rt.coordinator.provider === req.provider && rt.coordinator.accountId === req.accountId)
      return rt.coordinator;
    if (rt.coordinator) await this.#closeRunner(rt.coordinator);
    const c = this.k.getCase(caseId);
    if (!c) throw new AssayError("not_found", { case: caseId });
    const resume = (c.meta.coordinatorSession as Record<string, string> | undefined)?.[
      `${req.provider}:${req.accountId}`
    ];
    rt.coordinator = await this.#startRunner(caseId, null, req.provider, req.accountId, {
      systemPrompt: COORDINATOR_PROMPT,
      mode,
      model: req.model,
      cwd: c.workspace ?? this.deps.home,
      resume,
      maxBudgetUsd: req.budgetUsd,
    });
    return rt.coordinator;
  }

  /** Accept a user message; the turn runs in the background and streams over emit(). */
  async sendMessage(caseId: string, req: SendMessageRequest): Promise<{ accepted: true; turn: string }> {
    if (typeof req.text !== "string" || !req.text.trim()) throw new AssayError("bad_request", { field: "text" });
    const c = this.k.getCase(caseId);
    if (!c) throw new AssayError("not_found", { case: caseId });
    if (req.budgetUsd !== undefined && req.budgetUsd > 0) this.k.setBudget(`case:${caseId}`, { usd: req.budgetUsd });
    this.k.checkBudget(`case:${caseId}`, { calls: 1 });
    this.k.updateCase(caseId, {
      meta: {
        settings: {
          provider: req.provider,
          accountId: req.accountId,
          model: req.model ?? null,
          mode: req.mode ?? "enforced",
          budgetUsd: req.budgetUsd ?? null,
        },
      },
    });
    const user = this.log(caseId, "user", req.text);
    const { task } = this.k.spawnTask({
      queue: "turns",
      kind: "turn",
      caseId,
      params: { seq: user.seq },
      idempotencyKey: `turn:${caseId}:${user.seq}`,
      maxAttempts: 1,
    });
    const att = this.#claimSpecific("turns", task.id);
    if (!att) throw new AssayError("stale_attempt", { turn: task.id });
    const runner = await this.#ensureCoordinator(caseId, req);
    // one turn at a time per session: a new message waits for the turn in progress
    const prev = runner.busy;
    const p = (async () => {
      if (prev) await prev.catch(() => undefined);
      await this.#runTurn(caseId, null, runner, att, req.text);
    })();
    runner.busy = p;
    p.finally(() => {
      if (runner.busy === p) runner.busy = null;
    });
    return { accepted: true, turn: task.id };
  }

  async #runTurn(caseId: string, workerId: string | null, runner: Runner, att: Attempt, text: string): Promise<void> {
    const heartbeat = setInterval(() => {
      try {
        this.k.extendLease(att, TURN_LEASE_MS);
      } catch {
        // the turn already settled
      }
    }, 60_000);
    heartbeat.unref();
    try {
      runner.text = "";
      this.#status(caseId, workerId, runner, "working");
      const out = await this.k.runEffect(att, { name: "model-turn", replay: "unsafe", args: { text } }, () =>
        runner.session.send(text),
      );
      const finalText = out.text || runner.text;
      const entry = this.log(caseId, "assistant", finalText, { stopReason: out.stopReason }, workerId);
      this.#claimsFromText(caseId, workerId, runner, finalText, entry.seq);
      this.k.completeTask(att, { stopReason: out.stopReason });
      this.#status(caseId, workerId, runner, workerId ? (runner.status === "done" ? "done" : "idle") : "idle");
      this.#rememberSession(caseId, workerId, runner);
      if (!workerId) await this.verify(caseId);
    } catch (e) {
      const err = isAssayError(e)
        ? e.toJSON()
        : { code: "provider_unavailable", message: String((e as Error)?.message ?? e) };
      this.log(caseId, "error", String(err.message), err, workerId);
      try {
        this.k.failTask(att, e, { final: true });
      } catch {
        // lease already settled
      }
      this.#status(caseId, workerId, runner, "error");
      if (workerId) this.#workerFailed(caseId, workerId);
    } finally {
      clearInterval(heartbeat);
    }
  }

  #claimsFromText(caseId: string, workerId: string | null, runner: Runner, text: string, seq: number): void {
    const v = this.deps.verifier;
    if (!v) return;
    const parsed = v.parseClaimBlocks(text);
    const claims = Array.isArray(parsed) ? parsed : parsed.claims;
    const author = `${runner.provider}:${runner.accountId}${workerId ? `:${workerId}` : ""}`;
    for (const c of claims) {
      const stored = recordClaim(this.k, caseId, author, c, seq);
      this.deps.emit({
        type: "claim",
        claim: {
          id: stored.id,
          caseId,
          author,
          text: c.text,
          label: c.label,
          predicate: c.predicate ?? null,
          verdict: null,
          reason: null,
          observationId: null,
          eventSeq: seq,
        },
      });
    }
  }

  async verify(caseId: string): Promise<void> {
    const v = this.deps.verifier;
    if (!v) return;
    const before = new Map(caseClaims(this.k, caseId).map((c) => [c.id, c.verdict]));
    await v.verifyCase(caseId);
    const after = caseClaims(this.k, caseId);
    const changed = after.filter((c) => c.verdict !== before.get(c.id));
    for (const c of changed)
      this.deps.emit({
        type: "claim",
        claim: {
          id: c.id,
          caseId,
          author: c.author,
          text: c.claim.text,
          label: c.claim.label,
          predicate: c.claim.predicate ?? null,
          verdict: c.verdict,
          reason: c.verdict_record?.reason ?? null,
          observationId: c.verdict_record?.observation_id ?? null,
          eventSeq: null,
        },
      });
    if (changed.length) {
      const n = (v: string) => changed.filter((c) => c.verdict === v).length;
      this.log(
        caseId,
        "verification",
        `Checked ${changed.length} claim(s): ${n("verified")} verified, ${n("refuted")} refuted, ${n("unverifiable")} unverifiable.`,
        {
          checked: changed.length,
          verified: n("verified"),
          refuted: n("refuted"),
          unverifiable: n("unverifiable"),
          claimIds: changed.map((c) => c.id),
        },
      );
    }
  }

  async interrupt(caseId: string): Promise<void> {
    const rt = this.#rt(caseId);
    if (rt.coordinator) await rt.coordinator.session.interrupt();
  }

  // ---------- runners ----------

  async #startRunner(
    caseId: string,
    workerId: string | null,
    provider: ProviderId,
    accountId: string,
    o: {
      systemPrompt: string;
      mode: Mode;
      model?: string | undefined;
      cwd: string;
      resume?: string | undefined;
      maxBudgetUsd?: number | undefined;
    },
  ): Promise<Runner> {
    const adapter = this.deps.providers.get(provider);
    if (!adapter) throw new AssayError("provider_unavailable", { provider });
    const account = this.deps.account(accountId);
    if (!account || account.provider !== provider) throw new AssayError("account_signed_out", { accountId, provider });
    const caller = workerId ?? "coordinator";
    const token = this.deps.mcp.issue(caseId, caller);
    const runner: Runner = {
      session: undefined as unknown as AgentSession,
      token,
      provider,
      accountId,
      busy: null,
      status: "starting",
      liveness: "live",
      lastEventAt: Date.now(),
      costUsd: 0,
      text: "",
    };
    runner.session = await adapter.start({
      account,
      cwd: o.cwd,
      model: o.model,
      systemPrompt: o.systemPrompt,
      mcp: { url: this.deps.mcp.url, token, stdioProxy: this.deps.mcp.stdioProxy(token) },
      mode: o.mode,
      resume: o.resume,
      maxBudgetUsd: o.maxBudgetUsd,
      onEvent: (e) => this.#onEvent(caseId, workerId, runner, e),
      approve: async (req) => {
        try {
          await this.deps.approve({
            caseId,
            workerId,
            action: `client:${req.tool}`,
            detail: req.input,
            reason: req.reason ?? "the agent client asked to use a built-in tool",
          });
          return true;
        } catch {
          return false;
        }
      },
    });
    return runner;
  }

  #onEvent(caseId: string, workerId: string | null, runner: Runner, e: AgentEvent): void {
    runner.lastEventAt = Date.now();
    this.deps.emit({ type: "agent", caseId, workerId, event: e });
    switch (e.type) {
      case "text-delta":
        runner.text += e.text;
        break;
      case "text":
        runner.text = e.text;
        break;
      case "tool-call":
        this.log(caseId, "tool-call", e.name, { id: e.id, name: e.name, input: e.input }, workerId);
        break;
      case "tool-result":
        this.log(caseId, "tool-result", e.summary, { id: e.id, name: e.name, ok: e.ok, summary: e.summary }, workerId);
        break;
      case "usage": {
        const cost = e.costUsd ?? 0;
        runner.costUsd += cost;
        this.k.recordUsage({
          caseId,
          accountId: runner.accountId,
          provider: runner.provider,
          model: e.model,
          workerId,
          inputTokens: e.inputTokens,
          outputTokens: e.outputTokens,
          costUsd: e.costUsd,
        });
        this.k.spend(`case:${caseId}`, { usd: cost, tokens: e.inputTokens + e.outputTokens, calls: 1 });
        this.deps.emit({ type: "usage", rows: this.usage("account_id") });
        break;
      }
      case "status":
        if (e.state === "blocked" || e.state === "error") this.#status(caseId, workerId, runner, e.state);
        break;
      case "error":
        this.log(caseId, "error", e.message, { code: e.code ?? null }, workerId);
        break;
      default:
        break;
    }
  }

  #status(caseId: string, workerId: string | null, runner: Runner, status: WorkerStatus): void {
    runner.status = status;
    if (workerId) {
      const view = this.workerView(workerId);
      if (view) this.deps.emit({ type: "worker", worker: view });
    }
    this.deps.caseChanged?.(caseId);
  }

  #rememberSession(caseId: string, workerId: string | null, runner: Runner): void {
    const sid = runner.session.providerSessionId;
    if (!sid) return;
    if (workerId) {
      this.#setWorkerParams(workerId, { providerSessionId: sid });
      return;
    }
    const c = this.k.getCase(caseId)!;
    const map = {
      ...((c.meta.coordinatorSession as Record<string, string> | undefined) ?? {}),
      [`${runner.provider}:${runner.accountId}`]: sid,
    };
    this.k.updateCase(caseId, { meta: { coordinatorSession: map } });
  }

  async #closeRunner(r: Runner): Promise<void> {
    try {
      await r.session.close();
    } finally {
      this.deps.mcp.revoke(r.token);
      r.liveness = "exited";
    }
  }

  caseActivity(caseId: string): WorkerStatus {
    const rt = this.#cases.get(caseId);
    if (!rt) return "idle";
    const all = [rt.coordinator, ...rt.workers.values()].filter(
      (r): r is Runner => r !== null && r.liveness === "live",
    );
    if (all.some((r) => r.status === "blocked")) return "blocked";
    if (all.some((r) => r.status === "working" || r.status === "starting")) return "working";
    if (all.some((r) => r.status === "error")) return "error";
    return "idle";
  }

  // ---------- workers ----------

  #setWorkerParams(workerId: string, patch: Partial<WorkerParams>): void {
    const t = this.k.getTask(workerId);
    if (!t) return;
    this.k.run(
      "UPDATE tasks SET params=? WHERE id=?",
      JSON.stringify({ ...(t.params as WorkerParams), ...patch }),
      workerId,
    );
  }

  #consecutiveFailures(caseId: string): number {
    const tasks = this.k.listTasks({ queue: "workers", caseId }).reverse();
    let n = 0;
    for (const t of tasks) {
      if (t.state === "failed") n++;
      else if (t.state === "completed") break;
    }
    return n;
  }

  #workerFailed(caseId: string, workerId: string): void {
    const t = this.k.getTask(workerId);
    if (t && t.state === "running") {
      const att = this.#currentAttempt(workerId);
      if (att) {
        try {
          this.k.failTask(att, new Error("worker turn failed"), { final: true });
        } catch {
          // already settled
        }
      }
    }
    this.k.send({
      to: `coordinator:${caseId}`,
      from: workerId,
      kind: "escalation",
      body: { reason: "worker turn failed" },
      caseId,
    });
  }

  #currentAttempt(taskId: string): Attempt | null {
    const r = this.k.get<{ id: string; n: number; worker: string; lease_until: number }>(
      "SELECT a.id, a.n, a.worker, a.lease_until FROM attempts a JOIN tasks t ON t.id=a.task_id AND t.attempts=a.n WHERE t.id=? AND a.state='running'",
      taskId,
    );
    return r ? { id: r.id, taskId, n: Number(r.n), worker: r.worker, leaseUntil: Number(r.lease_until) } : null;
  }

  async spawnWorker(
    caseId: string,
    input: {
      title?: string;
      task: string;
      provider?: ProviderId;
      accountId?: string;
      worktree?: boolean;
      retryId?: string;
      mode?: Mode;
    },
    caller = "coordinator",
  ): Promise<WorkerView> {
    if (caller !== "coordinator") throw new AssayError("depth_exceeded", { caller });
    if (typeof input.task !== "string" || !input.task.trim()) throw new AssayError("bad_request", { field: "task" });
    if (input.task.length > PROMPT_BUDGET_CHARS)
      throw new AssayError("prompt_too_large", { chars: input.task.length, limit: PROMPT_BUDGET_CHARS });
    if (this.#consecutiveFailures(caseId) >= BREAKER_THRESHOLD)
      throw new AssayError("breaker_open", { case: caseId, failures: this.#consecutiveFailures(caseId) });
    this.k.checkBudget(`case:${caseId}`, { calls: 1 });
    const c = this.k.getCase(caseId);
    if (!c) throw new AssayError("not_found", { case: caseId });
    const settings = (c.meta.settings ?? {}) as { provider?: ProviderId; accountId?: string; mode?: Mode };
    const provider = input.provider ?? settings.provider ?? "fake";
    const accountId = input.accountId ?? settings.accountId ?? "";
    const retry = input.retryId ?? newId("spawn");
    const { result } = await this.k.withReceipt(
      `spawn:${caseId}:${retry}`,
      { task: input.task, provider, accountId },
      async () => {
        const title = (input.title ?? input.task.split("\n")[0]!).slice(0, 80);
        const { task } = this.k.spawnTask({
          queue: "workers",
          kind: "worker",
          caseId,
          parentId: null,
          maxAttempts: 1,
          params: {
            title,
            task: input.task,
            provider,
            accountId,
            worktree: null,
            repo: null,
            providerSessionId: null,
            result: null,
            released: false,
          } satisfies WorkerParams,
        });
        return task.id;
      },
    );
    const workerId = result;
    const existing = this.#rt(caseId).workers.get(workerId);
    if (existing) return this.workerView(workerId)!;
    const att = this.#claimSpecific("workers", workerId);
    if (!att) return this.workerView(workerId)!;
    const params = this.k.getTask(workerId)!.params as WorkerParams;
    let cwd = c.workspace ?? this.deps.home;
    if (input.worktree && c.workspace && (await isGitRepo(c.workspace))) {
      const path = await addWorktree(c.workspace, worktreeRoot(this.deps.home), worktreeName(caseId, workerId));
      this.#setWorkerParams(workerId, { worktree: path, repo: c.workspace });
      cwd = path;
    }
    const runner = await this.#startRunner(caseId, workerId, params.provider, params.accountId, {
      systemPrompt: workerPrompt({ workerId, title: params.title, caseTitle: c.title }),
      mode: input.mode ?? settings.mode ?? "enforced",
      cwd,
    });
    this.#rt(caseId).workers.set(workerId, runner);
    this.log(caseId, "worker", `Started worker "${params.title}" on ${params.provider}.`, {
      workerId,
      event: "spawned",
      result: null,
    });
    const p = this.#runTurn(caseId, workerId, runner, att, params.task);
    runner.busy = p;
    return this.workerView(workerId)!;
  }

  workerDone(caseId: string, workerId: string, summary: string): void {
    const t = this.k.getTask(workerId);
    if (!t || t.case_id !== caseId) throw new AssayError("not_found", { worker: workerId });
    this.#setWorkerParams(workerId, { result: summary.slice(0, 4000) });
    this.k.send({
      to: `coordinator:${caseId}`,
      from: workerId,
      kind: "worker_done",
      body: { summary: summary.slice(0, 4000) },
      caseId,
    });
    const r = this.#rt(caseId).workers.get(workerId);
    if (r) r.status = "done";
    this.log(caseId, "worker", `Worker "${(t.params as WorkerParams).title}" finished: ${summary.slice(0, 300)}`, {
      workerId,
      event: "done",
      result: summary.slice(0, 4000),
    });
    const view = this.workerView(workerId);
    if (view) this.deps.emit({ type: "worker", worker: view });
  }

  askCoordinator(caseId: string, workerId: string, question: string): void {
    this.k.send({ to: `coordinator:${caseId}`, from: workerId, kind: "question", body: { question }, caseId });
    const r = this.#rt(caseId).workers.get(workerId);
    if (r) this.#status(caseId, workerId, r, "blocked");
  }

  async checkWorkers(
    caseId: string,
    waitSeconds = 0,
  ): Promise<{ workers: WorkerView[]; messages: { id: number; from: string; kind: string; body: unknown }[] }> {
    const box = `coordinator:${caseId}`;
    const deadline = Date.now() + Math.min(Math.max(waitSeconds, 0), 120) * 1000;
    let msgs = this.k.inbox(box);
    while (msgs.length === 0 && Date.now() < deadline) {
      const busy = [...this.#rt(caseId).workers.values()]
        .map((r) => r.busy)
        .filter((p): p is Promise<unknown> => p !== null);
      if (busy.length === 0) break;
      await Promise.race([Promise.race(busy), new Promise((r) => setTimeout(r, 250))]);
      msgs = this.k.inbox(box);
    }
    this.k.ack(
      box,
      msgs.map((m) => m.id),
    );
    for (const w of this.workers(caseId)) {
      const t = this.k.getTask(w.id)!;
      if (t.state === "running" && w.status === "done") {
        const att = this.#currentAttempt(w.id);
        if (att) this.k.completeTask(att, { summary: (t.params as WorkerParams).result });
      }
    }
    return {
      workers: this.workers(caseId),
      messages: msgs.map(({ id, from, kind, body }) => ({ id, from, kind, body })),
    };
  }

  async replyWorker(caseId: string, workerId: string, text: string): Promise<void> {
    const r = this.#rt(caseId).workers.get(workerId);
    if (!r) throw new AssayError("not_found", { worker: workerId });
    const prev = r.busy;
    const { task } = this.k.spawnTask({
      queue: "turns",
      kind: "worker-turn",
      caseId,
      params: { workerId },
      maxAttempts: 1,
    });
    const att = this.#claimSpecific("turns", task.id)!;
    r.busy = (async () => {
      if (prev) await prev.catch(() => undefined);
      await this.#runTurn(caseId, workerId, r, att, text);
    })();
  }

  async releaseWorker(caseId: string, workerId: string): Promise<void> {
    const t = this.k.getTask(workerId);
    if (!t || t.case_id !== caseId) throw new AssayError("not_found", { worker: workerId });
    const r = this.#rt(caseId).workers.get(workerId);
    if (r) await this.#closeRunner(r);
    const p = t.params as WorkerParams;
    if (p.worktree && p.repo) await removeWorktree(p.repo, p.worktree);
    this.#setWorkerParams(workerId, { released: true });
    const att = this.#currentAttempt(workerId);
    if (att) this.k.completeTask(att, { released: true, summary: p.result });
    this.log(caseId, "worker", `Released worker "${p.title}".`, { workerId, event: "released" });
    const view = this.workerView(workerId);
    if (view) this.deps.emit({ type: "worker", worker: view });
  }

  /** Ask a worker on another provider to check a worker's claims. */
  async secondOpinion(
    caseId: string,
    input: { workerId: string; provider: ProviderId; accountId: string },
  ): Promise<WorkerView> {
    const claims = caseClaims(this.k, caseId)
      .filter((c) => c.author.endsWith(`:${input.workerId}`) && c.claim.label === "seen")
      .map((c) => c.claim.text);
    if (claims.length === 0) throw new AssayError("bad_request", { why: "that worker has no seen claims to check" });
    return this.spawnWorker(caseId, {
      title: `Second opinion on ${input.workerId}`,
      task: SECOND_OPINION_TASK(claims),
      provider: input.provider,
      accountId: input.accountId,
    });
  }

  workers(caseId: string): WorkerView[] {
    return this.k
      .listTasks({ queue: "workers", caseId })
      .map((t) => this.workerView(t.id))
      .filter((w): w is WorkerView => w !== undefined);
  }

  workerView(workerId: string): WorkerView | undefined {
    const t: TaskRow | undefined = this.k.getTask(workerId);
    if (!t?.case_id) return undefined;
    const p = t.params as WorkerParams;
    const r = this.#cases.get(t.case_id)?.workers.get(workerId);
    const liveness: WorkerLiveness = p.released
      ? "exited"
      : r
        ? r.liveness
        : (p.liveness ?? (t.state === "running" ? "unverifiable" : "exited"));
    const status: WorkerStatus = r
      ? r.status
      : t.state === "completed"
        ? "done"
        : t.state === "failed"
          ? "error"
          : "idle";
    const cost = Number(
      this.k.get<{ c: number }>("SELECT SUM(COALESCE(cost_usd,0)) AS c FROM usage WHERE worker_id=?", workerId)?.c ?? 0,
    );
    return {
      id: workerId,
      caseId: t.case_id,
      title: p.title,
      task: p.task,
      provider: p.provider,
      accountId: p.accountId,
      status,
      liveness,
      worktree: p.worktree,
      startedAt: t.created_at,
      endedAt: t.state === "completed" || t.state === "failed" ? t.updated_at : null,
      result: p.result,
      costUsd: cost,
    };
  }

  // ---------- tools the coordinator and workers get over MCP ----------

  tools(): ToolDef[] {
    const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
    return [
      {
        name: "assay_spawn_worker",
        description:
          "Start a worker agent on one independent sub-task. Returns its id. Optional: provider, accountId, worktree (git worktree of the workspace), retryId (makes retries safe).",
        effect: "spawn",
        coordinatorOnly: true,
        inputSchema: {
          type: "object",
          properties: {
            task: { type: "string" },
            title: { type: "string" },
            provider: { type: "string" },
            accountId: { type: "string" },
            worktree: { type: "boolean" },
            retryId: { type: "string" },
          },
          required: ["task"],
        },
        handler: async (ctx, a) => {
          const w = await this.spawnWorker(
            ctx.caseId,
            {
              task: str(a.task),
              title: str(a.title) || undefined,
              provider: (str(a.provider) || undefined) as ProviderId | undefined,
              accountId: str(a.accountId) || undefined,
              worktree: a.worktree === true,
              retryId: str(a.retryId) || undefined,
            },
            ctx.caller,
          );
          return { text: `Started worker ${w.id} (${w.title}) on ${w.provider}.`, data: w as unknown as Json };
        },
      },
      {
        name: "assay_check_workers",
        description:
          "List workers and new messages from them (worker_done, question, escalation). wait: seconds to wait for a message (max 120).",
        effect: "none",
        coordinatorOnly: true,
        inputSchema: { type: "object", properties: { wait: { type: "number" } } },
        handler: async (ctx, a) => {
          const r = await this.checkWorkers(ctx.caseId, typeof a.wait === "number" ? a.wait : 0);
          const lines = r.workers.map(
            (w) => `${w.id} ${w.status}/${w.liveness} "${w.title}"${w.result ? `: ${w.result.slice(0, 200)}` : ""}`,
          );
          const msgs = r.messages.map((m) => `${m.kind} from ${m.from}: ${JSON.stringify(m.body).slice(0, 300)}`);
          return {
            text: [...lines, ...(msgs.length ? ["messages:", ...msgs] : ["no new messages"])].join("\n"),
            data: r as unknown as Json,
          };
        },
      },
      {
        name: "assay_reply_worker",
        description: "Send a follow-up message to a worker.",
        effect: "none",
        coordinatorOnly: true,
        inputSchema: {
          type: "object",
          properties: { workerId: { type: "string" }, text: { type: "string" } },
          required: ["workerId", "text"],
        },
        handler: async (ctx, a) => {
          await this.replyWorker(ctx.caseId, str(a.workerId), str(a.text));
          return { text: "sent" };
        },
      },
      {
        name: "assay_release_worker",
        description: "Stop a worker and remove its worktree.",
        effect: "none",
        coordinatorOnly: true,
        inputSchema: { type: "object", properties: { workerId: { type: "string" } }, required: ["workerId"] },
        handler: async (ctx, a) => {
          await this.releaseWorker(ctx.caseId, str(a.workerId));
          return { text: "released" };
        },
      },
      {
        name: "assay_worker_done",
        description: "Workers only: report that your task is done, with a short summary.",
        effect: "none",
        inputSchema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
        handler: async (ctx, a) => {
          if (ctx.caller === "coordinator") throw new AssayError("bad_request", { why: "only workers report done" });
          this.workerDone(ctx.caseId, ctx.caller, str(a.summary));
          return { text: "reported" };
        },
      },
      {
        name: "assay_ask_coordinator",
        description: "Workers only: ask the coordinator a question when blocked.",
        effect: "none",
        inputSchema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] },
        handler: async (ctx, a) => {
          if (ctx.caller === "coordinator")
            throw new AssayError("bad_request", { why: "only workers ask the coordinator" });
          this.askCoordinator(ctx.caseId, ctx.caller, str(a.question));
          return { text: "asked; wait for a reply" };
        },
      },
    ];
  }

  // ---------- usage and estimates ----------

  usage(by: "account_id" | "provider" | "case_id" | "worker_id"): {
    key: string;
    provider: string;
    turns: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    resent: number;
  }[] {
    return this.k.usageSummary(by).map((r) => ({
      key: String(r.key ?? "(none)"),
      provider: String(r.provider),
      turns: Number(r.turns),
      inputTokens: Number(r.input_tokens ?? 0),
      outputTokens: Number(r.output_tokens ?? 0),
      costUsd: Number(r.cost_usd ?? 0),
      resent: Number(r.resent ?? 0),
    }));
  }

  /** Predict the cost of a turn from this account's recent turns; honest when there is no history. */
  estimate(caseId: string, req: SendMessageRequest): CostEstimate {
    const rows = this.k.all<{ cost_usd: number | null; input_tokens: number }>(
      "SELECT cost_usd, input_tokens FROM usage WHERE account_id=? AND cost_usd IS NOT NULL ORDER BY at DESC LIMIT 20",
      req.accountId,
    );
    const history = this.k.events(caseId).reduce((n, e) => n + JSON.stringify(e.body).length, 0);
    const tokens = Math.round((history + req.text.length + COORDINATOR_PROMPT.length) / 4);
    if (rows.length < 3)
      return { usdLow: 0, usdHigh: 0, basis: `no cost history for this account yet; about ${tokens} input tokens` };
    const perToken = rows.map((r) => (r.cost_usd ?? 0) / Math.max(1, r.input_tokens)).sort((a, b) => a - b);
    const q = (p: number) => perToken[Math.min(perToken.length - 1, Math.floor(p * perToken.length))]!;
    return {
      usdLow: +(q(0.25) * tokens).toFixed(4),
      usdHigh: +(q(0.75) * tokens * 1.5).toFixed(4),
      basis: `${rows.length} recent turns of this account; about ${tokens} input tokens`,
    };
  }

  openUnknownsCount(caseId: string): number {
    return listUnknowns(this.k, caseId).filter((u) => u.status === "open").length;
  }

  async shutdown(): Promise<void> {
    for (const rt of this.#cases.values()) {
      for (const r of [rt.coordinator, ...rt.workers.values()])
        if (r) await this.#closeRunner(r).catch(() => undefined);
    }
    this.#cases.clear();
  }
}
