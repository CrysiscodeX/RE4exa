// Typed client for the Assay server (docs/api.md), the push WebSocket, and the store the UI reads from.

import { useSyncExternalStore } from "react";
import type { AgentEvent, ProviderId, SweepReport } from "../../src/contracts.ts";
import type {
  AccountView,
  ApprovalView,
  AppState,
  CalibrationView,
  CaseDetail,
  CaseSummary,
  ClaimView,
  CostEstimate,
  DoctorCheck,
  Mode,
  SendMessageRequest,
  ServerPush,
  TimelineEntry,
  UsageRow,
  WorkerView,
} from "../../src/server/api-types.ts";

// ---------------------------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------------------------

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fix: string | null;
  readonly retryable: boolean;
  constructor(status: number, code: string, message: string, fix: string | null, retryable: boolean) {
    super(message);
    this.status = status;
    this.code = code;
    this.fix = fix;
    this.retryable = retryable;
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", headers: { accept: "application/json" } };
  if (body !== undefined) {
    init.headers = { accept: "application/json", "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (err) {
    throw new ApiError(
      0,
      "network",
      `Cannot reach the Assay server (${(err as Error).message})`,
      "Is `assay serve` still running?",
      true,
    );
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string; fix?: string | null; retryable?: boolean } } | null)
      ?.error;
    throw new ApiError(
      res.status,
      e?.code ?? "http_error",
      e?.message ?? `HTTP ${res.status}`,
      e?.fix ?? null,
      e?.retryable ?? res.status >= 500,
    );
  }
  return data as T;
}

const enc = encodeURIComponent;

export type ExportFormat = "s2" | "sarif" | "cyclonedx" | "md" | "bundle";
export type UsageBy = "account_id" | "provider" | "case_id" | "worker_id";
export interface ReassayResult {
  added: unknown;
  removed: unknown;
  unchanged: unknown;
}

export const api = {
  pair: (code: string) => call<{ ok: boolean }>("POST", "/api/pair", { code }),
  wsTicket: () => call<{ ticket: string }>("POST", "/api/ws-ticket"),
  state: () => call<AppState>("GET", "/api/state"),
  doctor: () => call<DoctorCheck[]>("GET", "/api/doctor"),
  createCase: (body: { title: string; workspace?: string; recipeId?: string; path?: string }) =>
    call<CaseSummary>("POST", "/api/cases", body),
  getCase: (id: string) => call<CaseDetail>("GET", `/api/cases/${enc(id)}`),
  patchCase: (id: string, body: { title?: string; settings?: Partial<CaseDetail["settings"]> }) =>
    call<CaseSummary>("PATCH", `/api/cases/${enc(id)}`, body),
  sendMessage: (id: string, body: SendMessageRequest) =>
    call<{ accepted: boolean }>("POST", `/api/cases/${enc(id)}/messages`, body),
  estimate: (id: string, body: SendMessageRequest) =>
    call<CostEstimate>("POST", `/api/cases/${enc(id)}/estimate`, body),
  interrupt: (id: string) => call<{ ok: boolean }>("POST", `/api/cases/${enc(id)}/interrupt`),
  fork: (id: string, atSeq: number) => call<CaseSummary>("POST", `/api/cases/${enc(id)}/fork`, { atSeq }),
  sweep: (id: string, path: string) => call<SweepReport>("POST", `/api/cases/${enc(id)}/sweep`, { path }),
  verify: (id: string) => call<ClaimView[]>("POST", `/api/cases/${enc(id)}/verify`),
  reassay: (id: string, path: string) => call<ReassayResult>("POST", `/api/cases/${enc(id)}/reassay`, { path }),
  secondOpinion: (id: string, body: { workerId: string; provider: ProviderId; accountId: string }) =>
    call<WorkerView>("POST", `/api/cases/${enc(id)}/second-opinion`, body),
  spawnWorker: (id: string, body: { task: string; provider: ProviderId; accountId: string; worktree?: string }) =>
    call<WorkerView>("POST", `/api/cases/${enc(id)}/workers`, body),
  releaseWorker: (id: string) => call<{ ok: boolean }>("POST", `/api/workers/${enc(id)}/release`),
  decide: (id: string, decision: "approve" | "deny", reason?: string) =>
    call<ApprovalView>("POST", `/api/approvals/${enc(id)}`, reason ? { decision, reason } : { decision }),
  accounts: () => call<AccountView[]>("GET", "/api/accounts"),
  addAccount: (body: { provider: ProviderId; label: string; home: "new" | "default" }) =>
    call<AccountView>("POST", "/api/accounts", body),
  checkAccount: (id: string) => call<AccountView>("POST", `/api/accounts/${enc(id)}/check`),
  login: (id: string) => call<{ started: boolean }>("POST", `/api/accounts/${enc(id)}/login`),
  loginInput: (id: string, data: string) =>
    call<{ ok: boolean }>("POST", `/api/accounts/${enc(id)}/login-input`, { data }),
  deleteAccount: (id: string) => call<{ ok: boolean }>("DELETE", `/api/accounts/${enc(id)}`),
  evidence: (observationId: string) => call<unknown>("GET", `/api/evidence/${enc(observationId)}`),
  exportUrl: (id: string, format: ExportFormat) => `/api/cases/${enc(id)}/export?format=${format}`,
  usage: (by: UsageBy = "account_id") => call<UsageRow[]>("GET", `/api/usage?by=${by}`),
  calibration: () => call<CalibrationView[]>("GET", "/api/calibration"),
  capabilities: () => call<unknown>("GET", "/api/capabilities"),
};

// ---------------------------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------------------------

export interface RawLine {
  at: number;
  workerId: string | null;
  event: AgentEvent;
}

export interface DataState {
  conn: "idle" | "connecting" | "open" | "reconnecting";
  app: AppState | null;
  details: Record<string, CaseDetail>;
  /** Streaming assistant text by `caseId|workerId`. */
  streaming: Record<string, string>;
  usage: UsageRow[] | null;
  /** Approvals that belong to no case. */
  globalApprovals: ApprovalView[];
  announce: { id: number; text: string } | null;
}

type Listener = () => void;

export class Store<S> {
  private state: S;
  private listeners = new Set<Listener>();
  constructor(initial: S) {
    this.state = initial;
  }
  get = (): S => this.state;
  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  set(next: S | ((s: S) => S)): void {
    this.state = typeof next === "function" ? (next as (s: S) => S)(this.state) : next;
    for (const l of this.listeners) l();
  }
}

export const store = new Store<DataState>({
  conn: "idle",
  app: null,
  details: {},
  streaming: {},
  usage: null,
  globalApprovals: [],
  announce: null,
});

export function useData<T>(sel: (s: DataState) => T): T {
  return useSyncExternalStore(store.subscribe, () => sel(store.get()));
}

export const streamKey = (caseId: string, workerId: string | null) => `${caseId}|${workerId ?? ""}`;

function upsert<T>(list: T[], item: T, same: (a: T) => boolean): T[] {
  const i = list.findIndex(same);
  if (i < 0) return [...list, item];
  const next = list.slice();
  next[i] = item;
  return next;
}

let announceId = 0;
function announce(s: DataState, text: string): DataState {
  return { ...s, announce: { id: ++announceId, text } };
}

function withDetail(s: DataState, caseId: string, f: (d: CaseDetail) => CaseDetail): DataState {
  const d = s.details[caseId];
  if (!d) return s;
  return { ...s, details: { ...s.details, [caseId]: f(d) } };
}

const RAW_CAP = 5000;
const rawLogs = new Map<string, RawLine[]>();
const rawListeners = new Map<string, Set<(l: RawLine) => void>>();
const loginLogs = new Map<string, { chunks: string[]; done: boolean }>();
const loginListeners = new Map<string, Set<(chunk: string, done: boolean) => void>>();

/** Replays the case's AgentEvent log, then follows it. */
export function followRaw(caseId: string, cb: (l: RawLine) => void): () => void {
  for (const l of rawLogs.get(caseId) ?? []) cb(l);
  const set = rawListeners.get(caseId) ?? new Set<(l: RawLine) => void>();
  rawListeners.set(caseId, set);
  set.add(cb);
  return () => set.delete(cb);
}

/** Replays the account's login terminal output, then follows it. */
export function followLogin(accountId: string, cb: (chunk: string, done: boolean) => void): () => void {
  const log = loginLogs.get(accountId);
  if (log) for (const c of log.chunks) cb(c, false);
  const set = loginListeners.get(accountId) ?? new Set<(chunk: string, done: boolean) => void>();
  loginListeners.set(accountId, set);
  set.add(cb);
  return () => set.delete(cb);
}

export function resetLogin(accountId: string): void {
  loginLogs.set(accountId, { chunks: [], done: false });
}

export function loginDone(accountId: string): boolean {
  return loginLogs.get(accountId)?.done ?? false;
}

function caseTitle(s: DataState, id: string): string {
  return s.app?.cases.find((c) => c.id === id)?.title ?? "case";
}

export function applyPush(p: ServerPush): void {
  if (p.type === "agent") {
    const line: RawLine = { at: Date.now(), workerId: p.workerId, event: p.event };
    const log = rawLogs.get(p.caseId) ?? [];
    log.push(line);
    if (log.length > RAW_CAP) log.splice(0, log.length - RAW_CAP);
    rawLogs.set(p.caseId, log);
    for (const cb of rawListeners.get(p.caseId) ?? []) cb(line);
  }
  if (p.type === "login-output") {
    const log = loginLogs.get(p.accountId) ?? { chunks: [], done: false };
    log.chunks.push(p.chunk);
    if (p.done) log.done = true;
    loginLogs.set(p.accountId, log);
    for (const cb of loginListeners.get(p.accountId) ?? []) cb(p.chunk, p.done);
    if (!p.done) return;
  }
  store.set((s) => reduce(s, p));
}

export function reduce(s: DataState, p: ServerPush): DataState {
  switch (p.type) {
    case "hello":
      return s;
    case "case": {
      const app = s.app ? { ...s.app, cases: upsert(s.app.cases, p.summary, (c) => c.id === p.summary.id) } : s.app;
      const next = { ...s, app };
      return withDetail(next, p.summary.id, (d) => ({ ...d, summary: p.summary }));
    }
    case "timeline": {
      let next = withDetail(s, p.caseId, (d) =>
        d.timeline.some((e) => e.seq === p.entry.seq) ? d : { ...d, timeline: [...d.timeline, p.entry] },
      );
      if (p.entry.kind === "assistant") {
        const key = streamKey(p.caseId, p.entry.workerId);
        if (key in next.streaming) {
          const streaming = { ...next.streaming };
          delete streaming[key];
          next = { ...next, streaming };
        }
      }
      return next;
    }
    case "agent": {
      const key = streamKey(p.caseId, p.workerId);
      const e = p.event;
      if (e.type === "text-delta")
        return { ...s, streaming: { ...s.streaming, [key]: (s.streaming[key] ?? "") + e.text } };
      if (e.type === "status" && (e.state === "idle" || e.state === "done" || e.state === "error")) {
        const streaming = { ...s.streaming };
        delete streaming[key];
        const who = p.workerId
          ? (s.details[p.caseId]?.workers.find((w) => w.id === p.workerId)?.title ?? "Worker")
          : `Turn in ${caseTitle(s, p.caseId)}`;
        return announce({ ...s, streaming }, `${who} ${e.state === "error" ? "failed" : "finished"}`);
      }
      if (e.type === "error") return announce(s, `Error: ${e.message}`);
      return s;
    }
    case "worker":
      return withDetail(s, p.worker.caseId, (d) => ({
        ...d,
        workers: upsert(d.workers, p.worker, (w) => w.id === p.worker.id),
      }));
    case "approval": {
      const a = p.approval;
      let next = a.caseId
        ? withDetail(s, a.caseId, (d) => ({ ...d, approvals: upsert(d.approvals, a, (x) => x.id === a.id) }))
        : { ...s, globalApprovals: upsert(s.globalApprovals, a, (x) => x.id === a.id) };
      if (a.state === "pending") next = announce(next, `Approval needed: ${a.action}`);
      return next;
    }
    case "claim":
      return withDetail(s, p.claim.caseId, (d) => ({
        ...d,
        claims: upsert(d.claims, p.claim, (c) => c.id === p.claim.id),
      }));
    case "unknown":
      return withDetail(s, p.caseId, (d) => ({
        ...d,
        unknowns: upsert(d.unknowns, p.unknown, (u) => u.id === p.unknown.id),
      }));
    case "evidence":
      return withDetail(s, p.caseId, (d) => ({
        ...d,
        evidence: upsert(d.evidence, p.evidence, (e) => e.observationId === p.evidence.observationId),
      }));
    case "account":
      return s.app
        ? { ...s, app: { ...s.app, accounts: upsert(s.app.accounts, p.account, (a) => a.id === p.account.id) } }
        : s;
    case "usage":
      return { ...s, usage: p.rows };
    case "login-output": {
      const label = s.app?.accounts.find((a) => a.id === p.accountId)?.label ?? "account";
      return p.done ? announce(s, `Sign-in for ${label} finished`) : s;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Loading and WebSocket
// ---------------------------------------------------------------------------------------------

export async function loadState(): Promise<AppState> {
  const app = await api.state();
  store.set((s) => ({ ...s, app }));
  return app;
}

const inflight = new Map<string, Promise<CaseDetail>>();
export function loadCase(id: string, force = false): Promise<CaseDetail> {
  if (!force) {
    const have = store.get().details[id];
    if (have) return Promise.resolve(have);
    const p = inflight.get(id);
    if (p) return p;
  }
  const p = api.getCase(id).then((d) => {
    store.set((s) => ({ ...s, details: { ...s.details, [id]: d } }));
    return d;
  });
  inflight.set(id, p);
  p.finally(() => inflight.delete(id)).catch(() => {});
  return p;
}

export function refreshAccounts(): Promise<void> {
  return api.accounts().then((accounts) => {
    store.set((s) => (s.app ? { ...s, app: { ...s.app, accounts } } : s));
  });
}

export function setCaseSettings(id: string, settings: Partial<CaseDetail["settings"]>): void {
  store.set((s) => withDetail(s, id, (d) => ({ ...d, settings: { ...d.settings, ...settings } })));
  api.patchCase(id, { settings }).catch(() => {});
}

export class PushSocket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private onReconnect: () => void;

  constructor(onReconnect: () => void) {
    this.onReconnect = onReconnect;
  }

  start(): void {
    this.stopped = false;
    void this.open();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.ping) clearInterval(this.ping);
    this.ws?.close();
  }

  private async open(): Promise<void> {
    store.set((s) => ({ ...s, conn: this.attempt === 0 ? "connecting" : "reconnecting" }));
    let ticket: string;
    try {
      ticket = (await api.wsTicket()).ticket;
    } catch {
      this.retry();
      return;
    }
    if (this.stopped) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/api/ws?ticket=${enc(ticket)}`);
    this.ws = ws;
    ws.onopen = () => {
      const wasReconnect = this.attempt > 0;
      this.attempt = 0;
      store.set((s) => ({ ...s, conn: "open" }));
      this.ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('{"type":"ping"}'), 25_000);
      if (wasReconnect) this.onReconnect();
    };
    ws.onmessage = (m) => {
      if (typeof m.data !== "string") return;
      let p: ServerPush;
      try {
        p = JSON.parse(m.data) as ServerPush;
      } catch {
        return;
      }
      applyPush(p);
    };
    ws.onclose = () => {
      if (this.ping) clearInterval(this.ping);
      this.ping = null;
      if (this.ws === ws) this.ws = null;
      this.retry();
    };
  }

  private retry(): void {
    if (this.stopped) return;
    this.attempt += 1;
    store.set((s) => ({ ...s, conn: "reconnecting" }));
    const base = Math.min(15_000, 500 * 2 ** Math.min(this.attempt - 1, 5));
    const delay = base / 2 + Math.random() * (base / 2);
    this.timer = setTimeout(() => void this.open(), delay);
  }
}

/** Default send request for a case from its settings. */
export function requestFor(d: CaseDetail, text: string, mode: Mode): SendMessageRequest | null {
  const { provider, accountId, model, budgetUsd } = d.settings;
  if (!provider || !accountId) return null;
  const r: SendMessageRequest = { text, provider, accountId, mode };
  if (model) r.model = model;
  if (budgetUsd !== null) r.budgetUsd = budgetUsd;
  return r;
}

export type { TimelineEntry };
