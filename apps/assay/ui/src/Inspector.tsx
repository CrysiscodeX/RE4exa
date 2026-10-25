// Right-hand inspector: Evidence, Claims, Unknowns, Approvals, Workers, Usage, Calibration.

import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ProviderId } from "../../src/contracts.ts";
import type { CaseDetail, WorkerView } from "../../src/server/api-types.ts";
import { api, useData } from "./api.ts";
import { Icon, ProviderIcon } from "./icons.tsx";
import { Liveness, StatusDot, VerdictBadge, verdictName } from "./status.tsx";
import { CalibrationTable, UsageTable } from "./Tables.tsx";
import { ClaimChip } from "./Timeline.tsx";
import { ago, cx, json, providerName, rovingIndex, usd } from "./util.ts";
import { type InspectorTab, openEvidence, openWorker, setInspector, toast, toastError, useView } from "./view.ts";

const TABS: { id: InspectorTab; label: string }[] = [
  { id: "evidence", label: "Evidence" },
  { id: "claims", label: "Claims" },
  { id: "unknowns", label: "Unknowns" },
  { id: "approvals", label: "Approvals" },
  { id: "workers", label: "Workers" },
  { id: "usage", label: "Usage" },
  { id: "calibration", label: "Calibration" },
];

function EvidencePanel(props: { detail: CaseDetail }): ReactNode {
  const { detail } = props;
  const selected = useView((s) => s.evidenceId);
  const claimId = useView((s) => s.claimId);
  const [pred, setPred] = useState("");
  const [conf, setConf] = useState("");
  const [record, setRecord] = useState<{ id: string; data: unknown } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const claim = claimId ? detail.claims.find((c) => c.id === claimId) : undefined;

  const preds = useMemo(() => [...new Set(detail.evidence.map((e) => e.predicate))].sort(), [detail.evidence]);
  const confs = useMemo(() => [...new Set(detail.evidence.map((e) => e.confidence))].sort(), [detail.evidence]);
  const list = detail.evidence.filter((e) => (!pred || e.predicate === pred) && (!conf || e.confidence === conf));
  const ev = selected ? detail.evidence.find((e) => e.observationId === selected) : undefined;

  useEffect(() => {
    setError(null);
    if (!selected) {
      setRecord(null);
      return;
    }
    let live = true;
    api
      .evidence(selected)
      .then((data) => {
        if (!live) return;
        setRecord({ id: selected, data });
        detailRef.current?.scrollIntoView({ block: "nearest" });
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [selected]);

  const cov = (record?.data as { coverage?: unknown } | undefined)?.coverage;
  const subj = (record?.data as { subject?: { digest?: string } | null } | undefined)?.subject;
  return (
    <div className="panel-body">
      {claim ? (
        <div className="card claim-focus">
          <div className="row-inline">
            <VerdictBadge verdict={claim.verdict} />
            <span className="muted small">{claim.label}</span>
            <span className="muted small">by {claim.author}</span>
          </div>
          <p>{claim.text}</p>
          {claim.reason ? <p className="muted small">Verifier: {claim.reason}</p> : null}
          {!claim.observationId ? <p className="muted small">No evidence record backs this claim.</p> : null}
        </div>
      ) : null}
      {selected ? (
        <section className="card evidence-detail" ref={detailRef} aria-label="Evidence record">
          <dl className="kv">
            <dt>Observation</dt>
            <dd className="mono break">{selected}</dd>
            <dt>Probe</dt>
            <dd className="mono">{ev?.probe ?? "none"}</dd>
            <dt>Subject digest</dt>
            <dd className="mono break">{subj?.digest ?? ev?.subject ?? "none"}</dd>
            <dt>Path</dt>
            <dd className="mono">{ev?.path ?? "none"}</dd>
            <dt>Coverage</dt>
            <dd>
              {cov && typeof cov === "object" ? (
                <span className="mono small">
                  {String((cov as { status?: string }).status)} · examined{" "}
                  {String((cov as { examined?: number }).examined)}
                </span>
              ) : (
                (ev?.coverage ?? "none")
              )}
            </dd>
          </dl>
          {error ? <p className="error-text">{error}</p> : null}
          <details open>
            <summary>Full record</summary>
            <pre className="json">{record && record.id === selected ? json(record.data) : "Loading…"}</pre>
          </details>
          <button type="button" className="btn btn-sm" onClick={() => openEvidence(null)}>
            Close record
          </button>
        </section>
      ) : null}
      <div className="filters">
        <label className="field-inline">
          <span>Predicate</span>
          <select value={pred} onChange={(e) => setPred(e.target.value)}>
            <option value="">all</option>
            {preds.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="field-inline">
          <span>Confidence</span>
          <select value={conf} onChange={(e) => setConf(e.target.value)}>
            <option value="">all</option>
            {confs.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      <ul className="ev-list">
        {list.map((e) => (
          <li key={e.observationId}>
            <button
              type="button"
              className={cx("ev-item", e.observationId === selected && "selected")}
              aria-current={e.observationId === selected ? "true" : undefined}
              onClick={() => openEvidence(e.observationId)}
            >
              <span className="row-inline">
                <span className="mono small strong">{e.predicate}</span>
                <span className={`badge badge-conf-${e.confidence}`}>{e.confidence}</span>
                {e.coverage ? <span className="badge badge-muted">{e.coverage}</span> : null}
              </span>
              <span className="ev-summary">{e.summary}</span>
              <span className="mono small muted">
                {e.path ?? "-"} · {e.observationId.slice(0, 14)}…
              </span>
            </button>
          </li>
        ))}
        {list.length === 0 ? <li className="muted">No evidence matches.</li> : null}
      </ul>
    </div>
  );
}

function ClaimsPanel(props: { detail: CaseDetail }): ReactNode {
  const k = props.detail.summary.counts;
  const pending = props.detail.claims.filter((c) => c.verdict === null).length;
  return (
    <div className="panel-body">
      <p className="counts-line">
        <span className="verdict verdict-verified">✔ {k.verified} verified</span>
        <span className="verdict verdict-refuted">✖ {k.refuted} refuted</span>
        <span className="verdict verdict-unverifiable">? {k.unverifiable} unverifiable</span>
        {pending ? <span className="verdict verdict-pending">… {pending} pending</span> : null}
      </p>
      <ul className="claim-list">
        {props.detail.claims.map((c) => (
          <li key={c.id} className={`claim-row verdict-row-${verdictName(c.verdict)}`}>
            <ClaimChip claim={c} />
            <div className="muted small">
              {c.label} · {c.author}
              {c.predicate ? ` · ${c.predicate}` : ""}
              {c.eventSeq !== null ? ` · step ${c.eventSeq}` : ""}
            </div>
            {c.reason ? <div className="small">{c.reason}</div> : null}
          </li>
        ))}
        {props.detail.claims.length === 0 ? <li className="muted">No claims yet.</li> : null}
      </ul>
    </div>
  );
}

function UnknownsPanel(props: { detail: CaseDetail }): ReactNode {
  const [show, setShow] = useState<"open" | "all">("open");
  const list = props.detail.unknowns.filter((u) => show === "all" || u.status === "open");
  return (
    <div className="panel-body">
      <fieldset className="seg">
        <legend className="sr-only">Show unknowns</legend>
        {(["open", "all"] as const).map((v) => (
          <label key={v} className={cx("seg-opt", show === v && "on")}>
            <input type="radio" name="unk-show" checked={show === v} onChange={() => setShow(v)} />
            {v === "open" ? `Open (${props.detail.summary.counts.unknownsOpen})` : "All"}
          </label>
        ))}
      </fieldset>
      <ul className="unk-list">
        {list.map((u) => (
          <li key={u.id} className="card">
            <div className="row-inline">
              <span className={cx("badge", u.status === "open" ? "badge-warn" : "badge-ok")}>{u.status}</span>
              <span className="muted small">
                from {u.origin} · rev {u.rev}
              </span>
            </div>
            <p>{u.question}</p>
            {u.answer ? (
              <p className="small">
                <span className="label-sm inline">Answer</span> {u.answer}
              </p>
            ) : null}
            {u.evidence.length ? (
              <div className="row-inline wrap">
                {u.evidence.map((id) => (
                  <button key={id} type="button" className="link-btn mono small" onClick={() => openEvidence(id)}>
                    {id.slice(0, 14)}…
                  </button>
                ))}
              </div>
            ) : null}
          </li>
        ))}
        {list.length === 0 ? <li className="muted">Nothing open.</li> : null}
      </ul>
    </div>
  );
}

function ApprovalsPanel(props: { detail: CaseDetail }): ReactNode {
  const all = props.detail.approvals;
  const pending = all.filter((a) => a.state === "pending");
  const done = all.filter((a) => a.state !== "pending");
  return (
    <div className="panel-body">
      <h3 className="label-sm">Pending ({pending.length})</h3>
      <ul className="apr-list">
        {pending.map((a) => (
          <li key={a.id} className="card approval-card pending">
            <strong className="mono small">{a.action}</strong>
            <p className="small">{a.reason}</p>
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => api.decide(a.id, "approve").catch(toastError)}
              >
                Approve
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => api.decide(a.id, "deny").catch(toastError)}
              >
                Deny
              </button>
            </div>
          </li>
        ))}
        {pending.length === 0 ? <li className="muted">No approvals waiting.</li> : null}
      </ul>
      {done.length ? (
        <>
          <h3 className="label-sm">History</h3>
          <ul className="plain-list">
            {done.map((a) => (
              <li key={a.id} className="small">
                <span className={cx("badge", a.state === "approved" ? "badge-ok" : "badge-bad")}>{a.state}</span>{" "}
                <span className="mono">{a.action}</span> <span className="muted">{ago(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function SecondOpinion(props: { worker: WorkerView; onDone: () => void }): ReactNode {
  const providers = useData((s) => s.app?.providers ?? []);
  const accounts = useData((s) => s.app?.accounts ?? []);
  const other = providers.find((p) => p.installed && p.id !== props.worker.provider)?.id ?? props.worker.provider;
  const [provider, setProvider] = useState<ProviderId>(other);
  const mine = accounts.filter((a) => a.provider === provider && a.status === "signed-in");
  const [accountId, setAccountId] = useState(mine[0]?.id ?? "");
  const id = useId();
  useEffect(() => {
    if (!mine.some((a) => a.id === accountId)) setAccountId(mine[0]?.id ?? "");
  }, [mine, accountId]);
  return (
    <form
      className="second-opinion"
      aria-labelledby={id}
      onSubmit={(e) => {
        e.preventDefault();
        api
          .secondOpinion(props.worker.caseId, { workerId: props.worker.id, provider, accountId })
          .then((w) => {
            toast(`Second opinion started: ${w.title}`, "ok");
            props.onDone();
          })
          .catch(toastError);
      }}
    >
      <p id={id} className="small">
        Ask another agent to redo “{props.worker.title}” independently.
      </p>
      <label className="field-inline">
        <span>Provider</span>
        <select value={provider} onChange={(e) => setProvider(e.target.value as ProviderId)}>
          {providers.map((p) => (
            <option key={p.id} value={p.id} disabled={!p.installed}>
              {providerName(p.id)}
            </option>
          ))}
        </select>
      </label>
      <label className="field-inline">
        <span>Account</span>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {mine.length === 0 ? <option value="">no signed-in account</option> : null}
          {mine.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <div className="btn-row">
        <button type="submit" className="btn btn-sm btn-primary" disabled={!accountId}>
          Start second opinion
        </button>
        <button type="button" className="btn btn-sm" onClick={props.onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function WorkersPanel(props: { detail: CaseDetail }): ReactNode {
  const accounts = useData((s) => s.app?.accounts ?? []);
  const [opinionFor, setOpinionFor] = useState<string | null>(null);
  const total = props.detail.workers.reduce((t, w) => t + w.costUsd, 0);
  return (
    <div className="panel-body">
      <p className="muted small">
        {props.detail.workers.length} workers · {usd(total, 3)} total
      </p>
      <ul className="worker-list">
        {props.detail.workers.map((w) => (
          <li key={w.id} className="card">
            <div className="row-inline">
              <StatusDot status={w.status} />
              <ProviderIcon provider={w.provider} size={12} />
              <strong>{w.title}</strong>
              <Liveness liveness={w.liveness} />
            </div>
            <dl className="kv small">
              <dt>Account</dt>
              <dd>{accounts.find((a) => a.id === w.accountId)?.label ?? w.accountId}</dd>
              <dt>Task</dt>
              <dd>{w.task}</dd>
              <dt>Worktree</dt>
              <dd className="mono">{w.worktree ?? "shared"}</dd>
              <dt>Cost</dt>
              <dd>{usd(w.costUsd, 3)}</dd>
              <dt>Started</dt>
              <dd>
                {ago(w.startedAt)}
                {w.endedAt ? `, ended ${ago(w.endedAt)}` : ""}
              </dd>
            </dl>
            {w.result ? <p className="worker-result small">{w.result}</p> : null}
            <div className="btn-row">
              <button type="button" className="btn btn-sm" onClick={() => openWorker(w.caseId, w.id)}>
                Open tab
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={w.liveness === "exited"}
                onClick={() => api.releaseWorker(w.id).catch(toastError)}
                aria-label={`Release ${w.title}`}
              >
                Release
              </button>
              <button
                type="button"
                className="btn btn-sm"
                aria-expanded={opinionFor === w.id}
                onClick={() => setOpinionFor(opinionFor === w.id ? null : w.id)}
              >
                Second opinion…
              </button>
            </div>
            {opinionFor === w.id ? <SecondOpinion worker={w} onDone={() => setOpinionFor(null)} /> : null}
          </li>
        ))}
        {props.detail.workers.length === 0 ? <li className="muted">No workers in this case.</li> : null}
      </ul>
    </div>
  );
}

export function Inspector(props: { detail: CaseDetail | undefined }): ReactNode {
  const tab = useView((s) => s.inspectorTab);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = TABS.findIndex((t) => t.id === tab);
  const d = props.detail;
  const count = (id: InspectorTab): number | null => {
    if (!d) return null;
    if (id === "evidence") return d.evidence.length;
    if (id === "claims") return d.claims.length;
    if (id === "unknowns") return d.summary.counts.unknownsOpen;
    if (id === "approvals") return d.summary.counts.approvalsPending;
    if (id === "workers") return d.workers.length;
    return null;
  };
  return (
    <aside
      className="inspector"
      id="inspector"
      aria-label="Inspector"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          setInspector(false);
          document.getElementById("inspector-toggle")?.focus();
        }
      }}
    >
      <div className="inspector-head">
        <div className="tablist tablist-wrap" role="tablist" aria-label="Inspector sections">
          {TABS.map((t, i) => {
            const n = count(t.id);
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`itab-${t.id}`}
                aria-selected={t.id === tab}
                aria-controls="ipanel"
                tabIndex={t.id === tab ? 0 : -1}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                className={cx("tab", "tab-sm", t.id === tab && "active")}
                onClick={() => setInspector(true, t.id)}
                onKeyDown={(e) => {
                  const ni = rovingIndex(e.key, i, TABS.length, "horizontal");
                  if (ni === null) return;
                  e.preventDefault();
                  setInspector(true, TABS[ni]!.id);
                  refs.current[ni]?.focus();
                }}
              >
                {t.label}
                {n ? (
                  <span className={cx("tab-count", t.id === "approvals" && "attn")}>
                    <span className="sr-only"> (</span>
                    {n}
                    <span className="sr-only">)</span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Close inspector"
          onClick={() => {
            setInspector(false);
            document.getElementById("inspector-toggle")?.focus();
          }}
        >
          <Icon name="close" size={13} />
        </button>
      </div>
      <div
        className="inspector-panel"
        role="tabpanel"
        id="ipanel"
        aria-labelledby={`itab-${TABS[idx]?.id ?? "evidence"}`}
      >
        {tab === "usage" ? (
          <div className="panel-body">
            <UsageTable />
          </div>
        ) : tab === "calibration" ? (
          <div className="panel-body">
            <CalibrationTable />
          </div>
        ) : !d ? (
          <p className="muted pad">Open a case to inspect it.</p>
        ) : tab === "evidence" ? (
          <EvidencePanel detail={d} />
        ) : tab === "claims" ? (
          <ClaimsPanel detail={d} />
        ) : tab === "unknowns" ? (
          <UnknownsPanel detail={d} />
        ) : tab === "approvals" ? (
          <ApprovalsPanel detail={d} />
        ) : (
          <WorkersPanel detail={d} />
        )}
      </div>
    </aside>
  );
}
