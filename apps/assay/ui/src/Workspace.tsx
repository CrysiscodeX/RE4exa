// Main area for a case: top bar (editable title, chain indicator, palette), tab strip (coordinator chat,
// one tab per opened worker, Raw stream) and the active panel.

import { lazy, type ReactNode, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent } from "../../src/contracts.ts";
import type { CaseDetail } from "../../src/server/api-types.ts";
import { api, followRaw, type RawLine, store, useData } from "./api.ts";
import { Composer } from "./Composer.tsx";
import { Icon } from "./icons.tsx";
import { STATUS_LABEL, StatusDot } from "./status.tsx";
import { Timeline, WorkerHeader } from "./Timeline.tsx";
import { clock, cx, rovingIndex } from "./util.ts";
import {
  closeWorkerTab,
  effectiveTheme,
  openTab,
  setPalette,
  type TabKey,
  toastError,
  toggleInspector,
  useView,
} from "./view.ts";

const XTerm = lazy(() => import("./Terminal.tsx"));

function TitleEditor(props: { detail: CaseDetail }): ReactNode {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(props.detail.summary.title);
  const input = useRef<HTMLInputElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  const save = () => {
    const t = value.trim();
    setEditing(false);
    requestAnimationFrame(() => btn.current?.focus());
    if (!t || t === props.detail.summary.title) return;
    const id = props.detail.summary.id;
    api
      .patchCase(id, { title: t })
      .then((summary) =>
        store.set((s) => ({
          ...s,
          app: s.app ? { ...s.app, cases: s.app.cases.map((c) => (c.id === id ? summary : c)) } : s.app,
        })),
      )
      .catch(toastError);
  };
  if (editing)
    return (
      <input
        ref={input}
        className="title-input"
        aria-label="Case title"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setValue(props.detail.summary.title);
            setEditing(false);
            requestAnimationFrame(() => btn.current?.focus());
          }
        }}
      />
    );
  return (
    <div className="title-wrap">
      <h1 className="case-title">{props.detail.summary.title}</h1>
      <button
        ref={btn}
        type="button"
        className="icon-btn"
        aria-label="Rename case"
        title="Rename case"
        onClick={() => {
          setValue(props.detail.summary.title);
          setEditing(true);
        }}
      >
        <Icon name="edit" size={12} />
      </button>
    </div>
  );
}

export function TopBar(props: { detail: CaseDetail | undefined; title?: string }): ReactNode {
  const conn = useData((s) => s.conn);
  const inspectorOpen = useView((s) => s.inspectorOpen);
  const onCases = useView((s) => s.page === "cases");
  const d = props.detail;
  return (
    <header className="topbar">
      {d ? (
        <>
          <StatusDot status={d.summary.activity} />
          <TitleEditor key={d.summary.id} detail={d} />
          {d.chainIntact ? (
            <span className="chain chain-ok" title="Every event in this case's log chains to the previous one by hash">
              <Icon name="shieldOk" size={14} /> Chain intact
            </span>
          ) : (
            <span className="chain chain-bad" role="img" aria-label="Chain broken: the event log failed its hash check">
              <Icon name="shieldBad" size={14} /> <span aria-hidden="true">Chain broken</span>
            </span>
          )}
        </>
      ) : (
        <h1 className="case-title">{props.title ?? "Assay"}</h1>
      )}
      <span className="push" />
      <span className={cx("conn", `conn-${conn}`)} role="status">
        {conn === "open"
          ? "Live"
          : conn === "reconnecting"
            ? "Reconnecting…"
            : conn === "connecting"
              ? "Connecting…"
              : "Offline"}
      </span>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => setPalette(true)}
        aria-keyshortcuts="Control+K Meta+K"
      >
        <Icon name="command" size={12} /> Commands <kbd>Ctrl K</kbd>
      </button>
      <button
        type="button"
        id="inspector-toggle"
        className={cx("icon-btn", inspectorOpen && "on")}
        aria-label={inspectorOpen ? "Hide inspector" : "Show inspector"}
        aria-expanded={inspectorOpen}
        aria-controls={inspectorOpen && onCases ? "inspector" : undefined}
        onClick={toggleInspector}
      >
        <Icon name="panel" size={15} />
      </button>
    </header>
  );
}

const C = {
  dim: "\x1b[2m",
  reset: "\x1b[0m",
  blue: "\x1b[34m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function short(v: unknown, max = 160): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  const one = Array.from((s ?? "").replace(/[\r\n]+/g, "⏎"), (ch) => {
    const c = ch.charCodeAt(0);
    return c < 32 || c === 127 ? "·" : ch;
  }).join("");
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

export function formatRaw(l: RawLine, names: Map<string, string>): string {
  const who = l.workerId ? (names.get(l.workerId) ?? l.workerId) : "coordinator";
  const e: AgentEvent = l.event;
  const head = `${C.dim}${clock(l.at)}${C.reset} ${C.cyan}[${who}]${C.reset} `;
  let body: string;
  switch (e.type) {
    case "status":
      body = `${C.yellow}status${C.reset} ${e.state}${e.detail ? ` (${short(e.detail)})` : ""}`;
      break;
    case "text-delta":
      body = `${C.dim}text-delta${C.reset} ${short(e.text)}`;
      break;
    case "text":
      body = `text ${short(e.text, 400)}`;
      break;
    case "thinking":
      body = `${C.magenta}thinking${C.reset} ${short(e.text)}`;
      break;
    case "tool-call":
      body = `${C.blue}tool-call${C.reset} ${e.name} ${short(e.input)}`;
      break;
    case "tool-result":
      body = `${e.ok ? C.green : C.red}tool-result${C.reset} ${e.name} ${e.ok ? "ok" : "error"}: ${short(e.summary)}`;
      break;
    case "usage":
      body = `usage in=${e.inputTokens} out=${e.outputTokens}${e.costUsd !== null ? ` $${e.costUsd.toFixed(4)}` : ""}${e.model ? ` ${e.model}` : ""}`;
      break;
    case "error":
      body = `${C.red}error${C.reset} ${e.code ? `${e.code}: ` : ""}${short(e.message)}`;
      break;
  }
  return `${head}${body}\r\n`;
}

function RawStream(props: { detail: CaseDetail }): ReactNode {
  const theme = useView((s) => effectiveTheme(s.theme));
  const caseId = props.detail.summary.id;
  const names = useRef(new Map<string, string>());
  names.current = new Map(props.detail.workers.map((w) => [w.id, w.title]));
  const attach = useCallback(
    (write: (s: string) => void) => {
      write(`${C.dim}Raw agent events for this case (read-only). New events append below.${C.reset}\r\n`);
      return followRaw(caseId, (l) => write(formatRaw(l, names.current)));
    },
    [caseId],
  );
  return (
    <div className="raw-panel">
      <Suspense fallback={<p className="muted pad">Loading terminal…</p>}>
        <XTerm label="Raw agent event stream" readOnly theme={theme} attach={attach} />
      </Suspense>
    </div>
  );
}

export function Workspace(props: { detail: CaseDetail }): ReactNode {
  const { detail } = props;
  const caseId = detail.summary.id;
  const accounts = useData((s) => s.app?.accounts ?? []);
  const workerTabs = useView((s) => s.workerTabs[caseId]);
  const active = useView((s) => s.activeTab[caseId] ?? "chat");
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const tabs: { key: TabKey; label: string; status?: CaseDetail["summary"]["activity"]; workerId?: string }[] = [
    { key: "chat", label: "Coordinator", status: detail.summary.activity },
    ...(workerTabs ?? []).flatMap((wid) => {
      const w = detail.workers.find((x) => x.id === wid);
      return w ? [{ key: `w:${wid}` as TabKey, label: w.title, status: w.status, workerId: wid }] : [];
    }),
    { key: "raw", label: "Raw" },
  ];
  const current = tabs.find((t) => t.key === active) ?? tabs[0]!;
  const worker = current.workerId ? detail.workers.find((w) => w.id === current.workerId) : undefined;

  return (
    <>
      <div className="tabstrip" role="tablist" aria-label="Case views">
        {tabs.map((t, i) => (
          <div key={t.key} className={cx("tab-wrap", t.key === current.key && "active")}>
            <button
              type="button"
              role="tab"
              id={`tab-${caseId}-${t.key}`}
              aria-selected={t.key === current.key}
              aria-controls={`panel-${caseId}`}
              tabIndex={t.key === current.key ? 0 : -1}
              className="tab"
              ref={(el) => {
                refs.current[i] = el;
              }}
              onClick={() => openTab(caseId, t.key)}
              aria-keyshortcuts={t.workerId ? "Delete" : undefined}
              onKeyDown={(e) => {
                if (e.key === "Delete" && t.workerId) {
                  e.preventDefault();
                  closeWorkerTab(caseId, t.workerId);
                  refs.current[0]?.focus();
                  return;
                }
                const n = rovingIndex(e.key, i, tabs.length, "horizontal");
                if (n === null) return;
                e.preventDefault();
                openTab(caseId, tabs[n]!.key);
                refs.current[n]?.focus();
              }}
            >
              {t.key === "raw" ? (
                <Icon name="terminal" size={12} />
              ) : t.status ? (
                <StatusDot status={t.status} label={STATUS_LABEL[t.status]} />
              ) : null}
              <span className="tab-label">{t.label}</span>
            </button>
            {t.workerId ? (
              <button
                type="button"
                className="tab-close"
                tabIndex={-1}
                aria-hidden="true"
                title={`Close ${t.label} tab (Delete)`}
                onClick={() => closeWorkerTab(caseId, t.workerId!)}
              >
                <Icon name="close" size={10} />
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <div className="tabpanel" role="tabpanel" id={`panel-${caseId}`} aria-labelledby={`tab-${caseId}-${current.key}`}>
        {current.key === "chat" ? (
          <>
            <Timeline key={`${caseId}:chat`} detail={detail} workerId={null} />
            <Composer detail={detail} />
          </>
        ) : current.key === "raw" ? (
          <RawStream detail={detail} />
        ) : worker ? (
          <>
            <WorkerHeader
              worker={worker}
              accountLabel={accounts.find((a) => a.id === worker.accountId)?.label ?? worker.accountId}
            />
            <Timeline key={`${caseId}:${worker.id}`} detail={detail} workerId={worker.id} />
          </>
        ) : null}
      </div>
    </>
  );
}
