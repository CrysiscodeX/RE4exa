// The approval queue: every gated effect waits here for the person. Rows live in the kernel's
// `approvals` table, so the UI can list them after a reload, and a restart marks requests left
// pending by a dead process as expired (their callers are gone; approving them would do nothing).

import { EventEmitter } from "node:events";
import { CoreError } from "../errors.ts";
import type { Json } from "../evidence/jcs.ts";
import { newId } from "../kernel/ids.ts";
import type { Kernel } from "../kernel/kernel.ts";
import { redact } from "./redact.ts";
import type { AutoRule } from "./taint.ts";

/** What a person sees when deciding: one pending (or settled) request. */
export interface ApprovalView {
  id: string;
  caseId: string | null;
  workerId: string | null;
  action: string;
  detail: unknown;
  /** Why approval is needed, e.g. "session read untrusted content", "effect: exec". */
  reason: string;
  state: "pending" | "approved" | "denied" | "expired";
  createdAt: number;
}

export interface ApprovalRequest {
  caseId: string | null;
  workerId: string | null;
  action: string;
  detail: Json;
  /** Why approval is needed, e.g. "effect exec; session read untrusted content". */
  reason: string;
  /** Overrides the queue's default timeout. */
  timeoutMs?: number;
  /** Aborting expires the request. */
  signal?: AbortSignal;
}

export interface ApprovalDecisionEvent {
  id: string;
  state: ApprovalView["state"];
  note: string | null;
}

export interface ApprovalQueueOptions {
  /** Default 10 minutes. */
  timeoutMs?: number;
  /** Append an "approval" event to the case log on request and decision. Default true. */
  logEvents?: boolean;
}

interface Waiter {
  resolve: () => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  cleanup: () => void;
}

type Row = Record<string, unknown>;

const RULES_KEY = "approval_rules:";

export class ApprovalQueue extends EventEmitter {
  readonly kernel: Kernel;
  readonly timeoutMs: number;
  readonly logEvents: boolean;
  #waiters = new Map<string, Waiter>();

  constructor(kernel: Kernel, opts: ApprovalQueueOptions = {}) {
    super();
    this.kernel = kernel;
    this.timeoutMs = opts.timeoutMs ?? 10 * 60_000;
    this.logEvents = opts.logEvents ?? true;
    this.#expireOrphans();
  }

  /** Requests left pending by an earlier process can never be delivered: expire them. */
  #expireOrphans(): number {
    const r = this.kernel.run(
      "UPDATE approvals SET state='expired', decided_at=? WHERE state='pending'",
      this.kernel.now(),
    );
    return Number(r.changes);
  }

  /** Resolves on approve; rejects `approval_denied` on deny, `approval_expired` on timeout or abort. */
  request(input: ApprovalRequest): Promise<void> {
    if (input.signal?.aborted) return Promise.reject(new CoreError("approval_expired", { why: "aborted" }));
    const id = newId("apr", this.kernel.now());
    const detail = redact(input.detail ?? null).value;
    this.kernel.run(
      "INSERT INTO approvals(id,case_id,worker_id,action,detail,state,reason,created_at) VALUES(?,?,?,?,?,'pending',?,?)",
      id,
      input.caseId,
      input.workerId,
      input.action,
      JSON.stringify(detail),
      input.reason,
      this.kernel.now(),
    );
    const view = this.get(id)!;
    this.#log(view, null);
    return new Promise<void>((resolve, reject) => {
      const timeoutMs = input.timeoutMs ?? this.timeoutMs;
      const onAbort = (): void => this.#expire(id, "aborted");
      const timer = setTimeout(() => this.#expire(id, "timeout"), timeoutMs);
      input.signal?.addEventListener("abort", onAbort, { once: true });
      this.#waiters.set(id, {
        resolve,
        reject,
        timer,
        cleanup: () => {
          clearTimeout(timer);
          input.signal?.removeEventListener("abort", onAbort);
        },
      });
      this.emit("approval", view);
    });
  }

  #settle(id: string, state: "approved" | "denied" | "expired", note: string | null): ApprovalView | undefined {
    const r = this.kernel.run(
      "UPDATE approvals SET state=?, decided_at=? WHERE id=? AND state='pending'",
      state,
      this.kernel.now(),
      id,
    );
    if (Number(r.changes) === 0) return undefined;
    const view = this.get(id)!;
    this.#log(view, note);
    const w = this.#waiters.get(id);
    this.#waiters.delete(id);
    if (w) {
      w.cleanup();
      if (state === "approved") w.resolve();
      else if (state === "denied")
        w.reject(new CoreError("approval_denied", { approval: id, action: view.action, note }));
      else w.reject(new CoreError("approval_expired", { approval: id, action: view.action, why: note }));
    }
    this.emit("approval", view);
    this.emit("decision", { id, state, note } satisfies ApprovalDecisionEvent);
    return view;
  }

  #expire(id: string, why: string): void {
    this.#settle(id, "expired", why);
  }

  /** The person's decision. Throws `not_found` for an unknown id, `bad_request` when already decided. */
  decide(id: string, decision: "approve" | "deny", note?: string): ApprovalView {
    if (decision !== "approve" && decision !== "deny") throw new CoreError("bad_request", { decision });
    const cur = this.get(id);
    if (!cur) throw new CoreError("not_found", { approval: id });
    if (cur.state !== "pending") throw new CoreError("bad_request", { approval: id, state: cur.state });
    return this.#settle(id, decision === "approve" ? "approved" : "denied", note ?? null) ?? this.get(id)!;
  }

  get(id: string): ApprovalView | undefined {
    const r = this.kernel.get<Row>("SELECT * FROM approvals WHERE id=?", id);
    return r ? toView(r) : undefined;
  }

  pending(caseId?: string): ApprovalView[] {
    const rows =
      caseId === undefined
        ? this.kernel.all<Row>("SELECT * FROM approvals WHERE state='pending' ORDER BY created_at, id")
        : this.kernel.all<Row>(
            "SELECT * FROM approvals WHERE state='pending' AND case_id=? ORDER BY created_at, id",
            caseId,
          );
    return rows.map(toView);
  }

  list(caseId: string, limit = 200): ApprovalView[] {
    return this.kernel
      .all<Row>("SELECT * FROM approvals WHERE case_id=? ORDER BY created_at DESC, id DESC LIMIT ?", caseId, limit)
      .map(toView);
  }

  // ---------- auto rules (persisted in the kernel's meta table) ----------

  rules(caseId: string): AutoRule[] {
    const raw = this.kernel.meta(RULES_KEY + caseId);
    return raw ? (JSON.parse(raw) as AutoRule[]) : [];
  }

  addRule(caseId: string, rule: AutoRule): AutoRule[] {
    if (typeof rule.tool !== "string" || rule.tool.length === 0) throw new CoreError("bad_request", { rule });
    const clean: AutoRule = {
      tool: rule.tool,
      action: rule.action ?? "approve",
      evenWhenTainted: !!rule.evenWhenTainted,
    };
    const next = [...this.rules(caseId).filter((r) => r.tool !== rule.tool), clean];
    this.kernel.setMeta(RULES_KEY + caseId, JSON.stringify(next));
    return next;
  }

  removeRule(caseId: string, tool: string): AutoRule[] {
    const next = this.rules(caseId).filter((r) => r.tool !== tool);
    this.kernel.setMeta(RULES_KEY + caseId, JSON.stringify(next));
    return next;
  }

  /** Expire everything this process is waiting on (server shutdown). */
  close(): void {
    for (const [id, w] of [...this.#waiters]) {
      if (!this.kernel.closed) {
        this.#expire(id, "shutdown");
        continue;
      }
      // The store is gone: the row stays pending and the next start expires it.
      this.#waiters.delete(id);
      w.cleanup();
      w.reject(new CoreError("approval_expired", { approval: id, why: "shutdown" }));
    }
  }

  #log(view: ApprovalView, note: string | null): void {
    if (!this.logEvents || !view.caseId || this.kernel.closed) return;
    this.kernel.appendEvent(view.caseId, "approval", {
      id: view.id,
      workerId: view.workerId,
      action: view.action,
      state: view.state,
      reason: view.reason,
      note,
    });
  }
}

function toView(r: Row): ApprovalView {
  return {
    id: r.id as string,
    caseId: (r.case_id as string | null) ?? null,
    workerId: (r.worker_id as string | null) ?? null,
    action: r.action as string,
    detail: JSON.parse(r.detail as string),
    reason: (r.reason as string | null) ?? "",
    state: r.state as ApprovalView["state"],
    createdAt: Number(r.created_at),
  };
}
