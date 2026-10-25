// The chat timeline for the coordinator or one worker: messages, streaming text, tool-call, sweep,
// verification, worker, approval and error cards, claim chips and per-entry Fork/Copy actions.
// Only user and assistant text goes through the Markdown renderer; tool and target text is plain text.

import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SweepReport } from "../../src/contracts.ts";
import type { ApprovalView, CaseDetail, ClaimView, TimelineEntry, WorkerView } from "../../src/server/api-types.ts";
import { api, streamKey, useData } from "./api.ts";
import { Icon, ProviderIcon } from "./icons.tsx";
import { Markdown } from "./markdown.tsx";
import { Liveness, StatusDot, VERDICT_GLYPH, verdictName } from "./status.tsx";
import { clock, copyText, cx, json, providerName, usd } from "./util.ts";
import { forkAt, openEvidence, openWorker, toast, toastError } from "./view.ts";

const WINDOW_THRESHOLD = 500;
const WINDOW_SIZE = 300;

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function strOf(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

export function ClaimChip(props: { claim: ClaimView }): ReactNode {
  const c = props.claim;
  const v = verdictName(c.verdict);
  return (
    <button
      type="button"
      className={`claim-chip verdict-${v}`}
      onClick={() => openEvidence(c.observationId, c.id)}
      aria-label={`Claim ${v}: ${c.text}. Show evidence`}
      title={c.reason ?? c.text}
    >
      <span aria-hidden="true" className="claim-glyph">
        {VERDICT_GLYPH[v]}
      </span>
      <span className="claim-text">{c.text}</span>
    </button>
  );
}

function ToolCard(props: { entry: TimelineEntry; result: TimelineEntry | undefined }): ReactNode {
  const d = rec(props.entry.data);
  const r = props.result ? rec(props.result.data) : null;
  const ok = r ? r.ok !== false : null;
  const name = strOf(d.name) ?? props.entry.text;
  return (
    <details className={cx("card", "tool-card", ok === false && "card-error")}>
      <summary>
        <Icon name="terminal" size={13} />
        <span className="mono">{name}</span>
        {r ? (
          <span className={cx("badge", ok ? "badge-ok" : "badge-bad")}>
            <span aria-hidden="true">{ok ? "✔" : "✖"}</span> {ok ? "ok" : "error"}
          </span>
        ) : (
          <span className="badge badge-muted">running…</span>
        )}
        {r ? <span className="tool-summary">{strOf(r.summary) ?? props.result?.text}</span> : null}
      </summary>
      <div className="tool-body">
        <div className="label-sm">Input</div>
        <pre className="json">{json(d.input)}</pre>
        {r ? (
          <>
            <div className="label-sm">Result</div>
            <pre className="json">{strOf(r.summary) ?? props.result?.text ?? ""}</pre>
          </>
        ) : null}
      </div>
    </details>
  );
}

function SweepCard(props: { entry: TimelineEntry }): ReactNode {
  const s = rec(props.entry.data) as Partial<SweepReport>;
  const findings = Array.isArray(s.findings) ? s.findings : [];
  const notExamined = Array.isArray(s.notExamined) ? s.notExamined : [];
  const questions = Array.isArray(s.questions) ? s.questions : [];
  return (
    <article className="card sweep-card" aria-label={`Sweep of ${s.subject ?? "subject"}`}>
      <header className="card-head">
        <Icon name="sweep" size={14} />
        <strong>Sweep</strong>
        <span className="mono small">{s.subject}</span>
        <span className="muted small">
          {Array.isArray(s.evidence) ? s.evidence.length : 0} evidence records
          {typeof s.elapsedMs === "number" ? ` · ${s.elapsedMs} ms` : ""}
        </span>
      </header>
      <div className="label-sm">Findings ({findings.length})</div>
      <ul className="findings">
        {findings.map((f) => (
          <li key={f.key}>
            <span className="badge badge-muted mono">{f.class}</span> <span>{f.label}</span>{" "}
            <button type="button" className="link-btn" onClick={() => openEvidence(f.observation_id)}>
              evidence
            </button>
          </li>
        ))}
      </ul>
      {questions.length ? (
        <>
          <div className="label-sm">Open questions</div>
          <ul className="plain-list">
            {questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </>
      ) : null}
      <div className="label-sm">Not examined ({notExamined.length})</div>
      <ul className="plain-list not-examined">
        {notExamined.map((n) => (
          <li key={n.what}>
            <span className="mono">{n.what}</span> <span className="muted">: {n.reason}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function VerificationCard(props: { entry: TimelineEntry }): ReactNode {
  const d = rec(props.entry.data);
  const n = (k: string) => (typeof d[k] === "number" ? (d[k] as number) : 0);
  return (
    <article className="card verify-card" aria-label="Verification">
      <header className="card-head">
        <Icon name="verify" size={14} />
        <strong>Verification</strong>
        <span className="muted">{props.entry.text}</span>
      </header>
      <div className="verify-counts">
        <span className="verdict verdict-verified">✔ {n("verified")} verified</span>
        <span className="verdict verdict-refuted">✖ {n("refuted")} refuted</span>
        <span className="verdict verdict-unverifiable">? {n("unverifiable")} unverifiable</span>
      </div>
    </article>
  );
}

function WorkerCard(props: { entry: TimelineEntry; worker: WorkerView | undefined; caseId: string }): ReactNode {
  const d = rec(props.entry.data);
  const w = props.worker;
  const done = d.event === "done";
  return (
    <article className="card worker-card" aria-label={props.entry.text}>
      <header className="card-head">
        <Icon name="worker" size={14} />
        <strong>{done ? "Worker finished" : "Worker started"}</strong>
        {w ? (
          <>
            <ProviderIcon provider={w.provider} size={12} />
            <span>{w.title}</span>
            <StatusDot status={w.status} />
            <Liveness liveness={w.liveness} />
          </>
        ) : (
          <span>{props.entry.text}</span>
        )}
        {w ? (
          <button type="button" className="btn btn-sm push" onClick={() => openWorker(props.caseId, w.id)}>
            Open tab
          </button>
        ) : null}
      </header>
      {w && !done ? <p className="muted small">{w.task}</p> : null}
      {done && strOf(d.result) ? <p className="worker-result">{strOf(d.result)}</p> : null}
    </article>
  );
}

function ApprovalCard(props: { entry: TimelineEntry; approval: ApprovalView | undefined }): ReactNode {
  const a = props.approval;
  const [busy, setBusy] = useState(false);
  if (!a) return <div className="card muted">{props.entry.text}</div>;
  const decide = async (decision: "approve" | "deny") => {
    setBusy(true);
    try {
      await api.decide(a.id, decision);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <article
      className={cx("card", "approval-card", a.state === "pending" && "pending")}
      aria-labelledby={`apr-${a.id}`}
    >
      <header className="card-head">
        <Icon name="warning" size={14} />
        <strong id={`apr-${a.id}`}>
          {a.state === "pending" ? "Approval needed" : `Approval ${a.state}`}: <span className="mono">{a.action}</span>
        </strong>
      </header>
      <p>
        <span className="label-sm inline">Why</span> {a.reason}
      </p>
      <details>
        <summary>Details</summary>
        <pre className="json">{json(a.detail)}</pre>
      </details>
      {a.state === "pending" ? (
        <div className="btn-row">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => decide("approve")}>
            Approve
          </button>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => decide("deny")}>
            Deny
          </button>
        </div>
      ) : (
        <p className={cx("badge", a.state === "approved" ? "badge-ok" : "badge-bad")}>{a.state}</p>
      )}
    </article>
  );
}

function ErrorCard(props: { entry: TimelineEntry }): ReactNode {
  const d = rec(props.entry.data);
  const fix = strOf(d.fix);
  return (
    <article className="card card-error" aria-label="Error">
      <header className="card-head">
        <Icon name="warning" size={14} />
        <strong>{strOf(d.message) ?? props.entry.text}</strong>
        {strOf(d.code) ? <span className="mono small muted">{strOf(d.code)}</span> : null}
      </header>
      {fix ? (
        <p>
          <span className="label-sm inline">Fix</span> {fix}
        </p>
      ) : null}
    </article>
  );
}

function EntryBody(props: {
  entry: TimelineEntry;
  detail: CaseDetail;
  results: Map<string, TimelineEntry>;
  claims: ClaimView[];
}): ReactNode {
  const { entry: e, detail } = props;
  switch (e.kind) {
    case "user":
      return (
        <div className="msg msg-user">
          <Markdown text={e.text} />
        </div>
      );
    case "assistant":
      return (
        <div className="msg msg-assistant">
          <Markdown text={e.text} />
          {props.claims.length ? (
            <ul className="claim-chips" aria-label="Claims in this message">
              {props.claims.map((c) => (
                <li key={c.id}>
                  <ClaimChip claim={c} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      );
    case "tool-call": {
      const id = strOf(rec(e.data).id);
      return <ToolCard entry={e} result={id ? props.results.get(id) : undefined} />;
    }
    case "tool-result":
      return (
        <div className="card tool-card">
          <span className="mono">{strOf(rec(e.data).name) ?? "tool"}</span>{" "}
          <span className="tool-summary">{e.text}</span>
        </div>
      );
    case "sweep":
      return <SweepCard entry={e} />;
    case "verification":
      return <VerificationCard entry={e} />;
    case "worker": {
      const wid = strOf(rec(e.data).workerId);
      return <WorkerCard entry={e} caseId={detail.summary.id} worker={detail.workers.find((w) => w.id === wid)} />;
    }
    case "approval": {
      const aid = strOf(rec(e.data).approvalId);
      return <ApprovalCard entry={e} approval={detail.approvals.find((a) => a.id === aid)} />;
    }
    case "error":
      return <ErrorCard entry={e} />;
    default:
      return <p className="system-line">{e.text}</p>;
  }
}

const KIND_LABEL: Record<TimelineEntry["kind"], string> = {
  user: "You",
  assistant: "Agent",
  "tool-call": "Tool call",
  "tool-result": "Tool result",
  system: "System",
  sweep: "Sweep",
  verification: "Verification",
  worker: "Worker",
  approval: "Approval",
  error: "Error",
};

export function Timeline(props: { detail: CaseDetail; workerId: string | null }): ReactNode {
  const { detail, workerId } = props;
  const caseId = detail.summary.id;
  const streaming = useData((s) => s.streaming[streamKey(caseId, workerId)]);
  const [limit, setLimit] = useState(WINDOW_SIZE);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const entries = useMemo(
    () => detail.timeline.filter((e) => e.workerId === workerId).sort((a, b) => a.seq - b.seq),
    [detail.timeline, workerId],
  );
  const results = useMemo(() => {
    const m = new Map<string, TimelineEntry>();
    for (const e of entries) {
      const id = e.kind === "tool-result" ? strOf(rec(e.data).id) : null;
      if (id) m.set(id, e);
    }
    return m;
  }, [entries]);
  const callIds = useMemo(
    () => new Set(entries.filter((e) => e.kind === "tool-call").map((e) => strOf(rec(e.data).id))),
    [entries],
  );
  const claimsBySeq = useMemo(() => {
    const m = new Map<number, ClaimView[]>();
    for (const c of detail.claims) {
      if (c.eventSeq === null) continue;
      const list = m.get(c.eventSeq) ?? [];
      list.push(c);
      m.set(c.eventSeq, list);
    }
    return m;
  }, [detail.claims]);

  const visible = entries.filter((e) => !(e.kind === "tool-result" && callIds.has(strOf(rec(e.data).id))));
  const windowed = visible.length > WINDOW_THRESHOLD;
  const shown = windowed ? visible.slice(Math.max(0, visible.length - limit)) : visible;
  const hidden = visible.length - shown.length;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });

  return (
    <div
      className="timeline-scroll"
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      }}
    >
      <ol className="timeline" aria-label={workerId ? "Worker timeline" : "Conversation"}>
        {hidden > 0 ? (
          <li className="timeline-more">
            <button type="button" className="btn btn-sm" onClick={() => setLimit(limit + WINDOW_SIZE)}>
              Show {Math.min(WINDOW_SIZE, hidden)} earlier entries ({hidden} hidden)
            </button>
          </li>
        ) : null}
        {shown.map((e) => (
          <li key={e.seq} className={cx("entry", `entry-${e.kind}`)} data-seq={e.seq}>
            <div className="entry-meta">
              <span className="entry-kind">{KIND_LABEL[e.kind]}</span>
              <span className="entry-time">
                <span className="sr-only">step {e.seq}, </span>
                {clock(e.at)}
              </span>
            </div>
            <EntryBody entry={e} detail={detail} results={results} claims={claimsBySeq.get(e.seq) ?? []} />
            <div className="entry-actions">
              <button
                type="button"
                className="icon-btn"
                aria-label={`Fork from step ${e.seq}`}
                title="Fork from here"
                onClick={() => forkAt(caseId, e.seq)}
              >
                <Icon name="fork" size={13} />
                <span className="action-text">Fork from here</span>
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Copy step ${e.seq}`}
                title="Copy"
                onClick={async () =>
                  toast(
                    (await copyText(
                      e.data && e.kind !== "user" && e.kind !== "assistant" ? `${e.text}\n${json(e.data)}` : e.text,
                    ))
                      ? "Copied"
                      : "Copy failed",
                    "ok",
                  )
                }
              >
                <Icon name="copy" size={13} />
                <span className="action-text">Copy</span>
              </button>
            </div>
          </li>
        ))}
        {streaming ? (
          <li className="entry entry-assistant entry-streaming" aria-busy="true">
            <div className="entry-meta">
              <span className="entry-kind">Agent</span>
              <span className="entry-time">streaming</span>
            </div>
            <div className="msg msg-assistant">
              <p className="stream-text">
                {streaming}
                <span className="cursor" aria-hidden="true" />
              </p>
            </div>
          </li>
        ) : null}
        {shown.length === 0 && !streaming ? (
          <li className="timeline-empty muted">
            {workerId ? "This worker has no activity yet." : "No messages yet. Ask something below, or run a sweep."}
          </li>
        ) : null}
      </ol>
    </div>
  );
}

export function WorkerHeader(props: { worker: WorkerView; accountLabel: string }): ReactNode {
  const w = props.worker;
  return (
    <div className="worker-head">
      <div className="row-inline">
        <StatusDot status={w.status} />
        <strong>{w.title}</strong>
        <span className="muted">
          <ProviderIcon provider={w.provider} size={12} /> {providerName(w.provider)} · {props.accountLabel}
        </span>
        <Liveness liveness={w.liveness} />
        <span className="muted small push">{usd(w.costUsd, 3)}</span>
      </div>
      <p className="muted small">{w.task}</p>
      {w.result ? <p className="worker-result">{w.result}</p> : null}
    </div>
  );
}
