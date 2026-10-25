// Status vocabulary shared by the sidebar, tabs, cards and inspector. Every marker pairs colour with a
// distinct shape and an accessible label, so colour is never the only signal.

import type { ReactNode } from "react";
import type { AccountView, ClaimView, WorkerLiveness, WorkerStatus } from "../../src/server/api-types.ts";
import { Icon } from "./icons.tsx";

export const STATUS_LABEL: Record<WorkerStatus, string> = {
  starting: "Starting",
  working: "Working",
  idle: "Idle",
  blocked: "Blocked, needs you",
  done: "Done",
  error: "Error",
};

/** Dot shapes: starting/working pulse (circle), idle hollow circle, blocked diamond, done check, error square. */
export function StatusDot(props: { status: WorkerStatus; label?: string }): ReactNode {
  const label = props.label ?? STATUS_LABEL[props.status];
  return (
    <span className={`dot dot-${props.status}`} role="img" aria-label={label} title={label}>
      {props.status === "done" ? <Icon name="check" size={10} /> : null}
      {props.status === "error" ? <Icon name="cross" size={9} /> : null}
    </span>
  );
}

export const LIVENESS_LABEL: Record<WorkerLiveness, string> = {
  live: "Process live",
  exited: "Process exited",
  unverifiable: "Liveness unverifiable: Assay cannot confirm whether the process is still running",
};

export function Liveness(props: { liveness: WorkerLiveness; compact?: boolean }): ReactNode {
  const l = props.liveness;
  const text = l === "live" ? "live" : l === "exited" ? "exited" : "unverifiable";
  return (
    <span className={`live live-${l}`} title={LIVENESS_LABEL[l]}>
      <span className="live-glyph" aria-hidden="true">
        {l === "unverifiable" ? "?" : null}
      </span>
      {props.compact ? <span className="sr-only">{LIVENESS_LABEL[l]}</span> : <span>{text}</span>}
      {props.compact ? null : <span className="sr-only">{`: ${LIVENESS_LABEL[l]}`}</span>}
    </span>
  );
}

export type Verdict = ClaimView["verdict"];

export const VERDICT_GLYPH: Record<string, string> = { verified: "✔", refuted: "✖", unverifiable: "?", pending: "…" };

export function verdictName(v: Verdict): string {
  return v ?? "pending";
}

export function VerdictBadge(props: { verdict: Verdict }): ReactNode {
  const v = verdictName(props.verdict);
  return (
    <span className={`verdict verdict-${v}`}>
      <span aria-hidden="true">{VERDICT_GLYPH[v]}</span> {v}
    </span>
  );
}

export function AccountState(props: { account: AccountView }): ReactNode {
  const s = props.account.status;
  const map: Record<AccountView["status"], WorkerStatus> = {
    "signed-in": "done",
    "signed-out": "idle",
    unknown: "blocked",
    checking: "working",
  };
  return (
    <StatusDot
      status={map[s]}
      label={
        s === "signed-in" ? "Signed in" : s === "signed-out" ? "Signed out" : s === "checking" ? "Checking" : "Unknown"
      }
    />
  );
}
