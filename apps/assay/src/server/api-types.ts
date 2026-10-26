// HTTP and WebSocket API between the Assay server and its UI. docs/api.md describes the routes.
// The UI imports these types only (no runtime code), so this file must stay dependency-free.

import type { AgentEvent, ProviderId, ProviderInfo } from "../contracts.ts";

export type WorkerLiveness = "live" | "exited" | "unverifiable";
export type WorkerStatus = "starting" | "working" | "idle" | "blocked" | "done" | "error";
export type Mode = "enforced" | "open";

export interface AccountView {
  id: string;
  provider: ProviderId;
  label: string;
  home: string | null;
  status: "signed-in" | "signed-out" | "unknown" | "checking";
  method: string | null;
  checkedAt: number | null;
}

export interface CaseSummary {
  id: string;
  title: string;
  workspace: string | null;
  status: string;
  parentCase: string | null;
  forkedAt: number | null;
  createdAt: number;
  /** Aggregate status for the sidebar dot. */
  activity: WorkerStatus;
  counts: {
    claims: number;
    verified: number;
    refuted: number;
    unverifiable: number;
    unknownsOpen: number;
    approvalsPending: number;
    workers: number;
  };
}

export interface WorkerView {
  id: string;
  caseId: string;
  title: string;
  task: string;
  provider: ProviderId;
  accountId: string;
  status: WorkerStatus;
  liveness: WorkerLiveness;
  worktree: string | null;
  startedAt: number;
  endedAt: number | null;
  result: string | null;
  costUsd: number;
}

import type { ApprovalView } from "@re4exa/core/policy/approvals";

export type { ApprovalView };

export interface ClaimView {
  id: string;
  caseId: string;
  author: string;
  text: string;
  label: "seen" | "inferred" | "unknown";
  predicate: string | null;
  verdict: "verified" | "refuted" | "unverifiable" | null;
  reason: string | null;
  observationId: string | null;
  /** Event seq of the assistant message that made the claim. */
  eventSeq: number | null;
}

export interface UnknownView {
  id: string;
  rev: number;
  question: string;
  status: "open" | "resolved" | "dismissed";
  origin: string;
  answer: string | null;
  evidence: string[];
}

export interface EvidenceView {
  observationId: string;
  predicate: string;
  probe: string | null;
  subject: string | null;
  path: string | null;
  confidence: string;
  producer: string;
  summary: string;
  coverage: string | null;
  createdAt: number;
}

/** One entry of the chat timeline, derived from the case event log. */
export interface TimelineEntry {
  seq: number;
  at: number;
  kind:
    | "user"
    | "assistant"
    | "tool-call"
    | "tool-result"
    | "system"
    | "sweep"
    | "verification"
    | "worker"
    | "approval"
    | "error";
  /** Worker id when the entry belongs to a worker's own timeline; null for the coordinator. */
  workerId: string | null;
  text: string;
  data?: unknown;
}

export interface CaseDetail {
  summary: CaseSummary;
  timeline: TimelineEntry[];
  claims: ClaimView[];
  unknowns: UnknownView[];
  evidence: EvidenceView[];
  workers: WorkerView[];
  approvals: ApprovalView[];
  chainIntact: boolean;
  settings: {
    provider: ProviderId | null;
    accountId: string | null;
    model: string | null;
    mode: Mode;
    budgetUsd: number | null;
  };
}

export interface UsageRow {
  key: string;
  provider: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  resent: number;
}

export interface CalibrationView {
  producer: string;
  questionClass: string;
  verified: number;
  refuted: number;
  unverifiable: number;
  precision: number | null;
  interval: [number, number];
  status: "ok" | "insufficient" | "demoted";
}

export interface Recipe {
  id: string;
  title: string;
  description: string;
  prompt: string;
  needsPath: boolean;
}

export interface AppState {
  version: string;
  workspaceRoot: string;
  cases: CaseSummary[];
  accounts: AccountView[];
  providers: ProviderInfo[];
  recipes: Recipe[];
  firstRun: boolean;
}

export interface DoctorCheck {
  id: string;
  ok: boolean;
  detail: string;
  fix: string | null;
}

/** Messages the server pushes over the WebSocket. */
export type ServerPush =
  | { type: "hello"; version: string }
  | { type: "case"; summary: CaseSummary }
  | { type: "timeline"; caseId: string; entry: TimelineEntry }
  | { type: "agent"; caseId: string; workerId: string | null; event: AgentEvent }
  | { type: "worker"; worker: WorkerView }
  | { type: "approval"; approval: ApprovalView }
  | { type: "claim"; claim: ClaimView }
  | { type: "unknown"; caseId: string; unknown: UnknownView }
  | { type: "evidence"; caseId: string; evidence: EvidenceView }
  | { type: "account"; account: AccountView }
  | { type: "usage"; rows: UsageRow[] }
  | { type: "login-output"; accountId: string; chunk: string; done: boolean };

export interface SendMessageRequest {
  text: string;
  provider: ProviderId;
  accountId: string;
  model?: string;
  mode?: Mode;
  budgetUsd?: number;
}

export interface CostEstimate {
  /** Predicted from the prompt size plus recent turns of this account and model. */
  usdLow: number;
  usdHigh: number;
  basis: string;
}
