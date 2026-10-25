// Composer: message input, provider/account/model, Enforced/Open mode, budget, live cost estimate and
// the case actions (Stop, Sweep, Verify all, Re-assay, Export).

import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { ProviderId } from "../../src/contracts.ts";
import type { CaseDetail, CostEstimate, Mode, SendMessageRequest } from "../../src/server/api-types.ts";
import { api, type ExportFormat, requestFor, setCaseSettings, useData } from "./api.ts";
import { Icon } from "./icons.tsx";
import { cx, download, providerName, rovingIndex, usdRange, useDebounced } from "./util.ts";
import { setDialog, toastError, useView, verifyAll } from "./view.ts";

export const EXPORTS: { format: ExportFormat; label: string }[] = [
  { format: "s2", label: "S-2 claim records (.jsonl)" },
  { format: "sarif", label: "SARIF" },
  { format: "cyclonedx", label: "CycloneDX" },
  { format: "md", label: "Markdown report" },
  { format: "bundle", label: "Case bundle" },
];

export function ExportMenu(props: { caseId: string }): ReactNode {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  useEffect(() => {
    if (open) items.current[0]?.focus();
  }, [open]);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    // Close when focus or a click lands outside the menu.
    const outside = (e: Event) => {
      if (!wrap.current?.contains(e.target as Node | null)) setOpen(false);
    };
    document.addEventListener("focusin", outside);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("focusin", outside);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  };
  return (
    <div className="menu-wrap" ref={wrap}>
      <button
        type="button"
        ref={btn}
        className="btn btn-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Icon name="download" size={12} /> Export <Icon name="chevronDown" size={10} />
      </button>
      {open ? (
        <div className="menu" role="menu" id={menuId} aria-label="Export format">
          {EXPORTS.map((x, i) => (
            <button
              key={x.format}
              type="button"
              role="menuitem"
              tabIndex={-1}
              ref={(el) => {
                items.current[i] = el;
              }}
              className="menu-item"
              onClick={() => {
                download(api.exportUrl(props.caseId, x.format));
                close();
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  close();
                  return;
                }
                const n = rovingIndex(e.key, i, EXPORTS.length, "vertical");
                if (n !== null) {
                  e.preventDefault();
                  items.current[n]?.focus();
                }
              }}
            >
              {x.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Composer(props: { detail: CaseDetail }): ReactNode {
  const { detail } = props;
  const caseId = detail.summary.id;
  const providers = useData((s) => s.app?.providers);
  const accounts = useData((s) => s.app?.accounts);
  const defaultMode = useView((s) => s.defaultMode);
  const defaultBudget = useView((s) => s.defaultBudget);
  const [text, setText] = useState("");
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [sending, setSending] = useState(false);
  const ids = { model: useId(), budget: useId(), hint: useId(), warn: useId(), prov: useId(), acct: useId() };

  const st = detail.settings;
  const provider = st.provider ?? providers?.find((p) => p.installed)?.id ?? "claude";
  const mine = (accounts ?? []).filter((a) => a.provider === provider);
  const account =
    mine.find((a) => a.id === st.accountId) ?? (st.accountId ? undefined : mine.find((a) => a.status === "signed-in"));
  const mode: Mode = st.mode ?? defaultMode;
  const budget = st.budgetUsd ?? defaultBudget;
  const signedOut = account?.status !== "signed-in";
  const activity = detail.summary.activity;
  const running = activity === "working" || activity === "starting" || activity === "blocked";

  const dText = useDebounced(text, 400);
  const dModel = useDebounced(st.model, 400);
  const accountId = account?.id ?? null;
  useEffect(() => {
    if (!dText.trim() || !accountId) {
      setEstimate(null);
      return;
    }
    let live = true;
    const req: SendMessageRequest = { text: dText, provider, accountId, mode };
    if (dModel) req.model = dModel;
    api
      .estimate(caseId, req)
      .then((e) => live && setEstimate(e))
      .catch(() => live && setEstimate(null));
    return () => {
      live = false;
    };
  }, [dText, caseId, provider, accountId, dModel, mode]);

  const send = async () => {
    const t = text.trim();
    if (!t || signedOut || !account) return;
    const req = requestFor(
      { ...detail, settings: { ...st, provider, accountId: account.id, budgetUsd: budget } },
      t,
      mode,
    );
    if (!req) return;
    setSending(true);
    try {
      await api.sendMessage(caseId, req);
      setText("");
      setEstimate(null);
    } catch (e) {
      toastError(e);
    } finally {
      setSending(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <form
      className="composer"
      aria-label="Message composer"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <label className="sr-only" htmlFor={`${caseId}-msg`}>
        Message to the coordinator
      </label>
      <textarea
        id={`${caseId}-msg`}
        className="composer-input"
        rows={3}
        value={text}
        placeholder="Ask the coordinator… (Enter sends, Shift+Enter for a new line)"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        aria-describedby={signedOut ? ids.hint : undefined}
      />
      <div className="composer-row">
        <label className="field-inline">
          <span className="sr-only">Provider</span>
          <select
            id={ids.prov}
            value={provider}
            onChange={(e) => {
              const p = e.target.value as ProviderId;
              const first = (accounts ?? []).find((a) => a.provider === p && a.status === "signed-in");
              setCaseSettings(caseId, { provider: p, accountId: first?.id ?? null });
            }}
          >
            {(providers ?? []).map((p) => (
              <option key={p.id} value={p.id} disabled={!p.installed}>
                {providerName(p.id)}
                {p.installed ? "" : " (not installed)"}
              </option>
            ))}
          </select>
        </label>
        <label className="field-inline">
          <span className="sr-only">Account</span>
          <select
            id={ids.acct}
            value={account?.id ?? ""}
            onChange={(e) => setCaseSettings(caseId, { accountId: e.target.value || null })}
            aria-describedby={signedOut ? ids.hint : undefined}
          >
            {account ? null : <option value="">Choose an account</option>}
            {mine.map((a) => (
              <option key={a.id} value={a.id} disabled={a.status !== "signed-in"}>
                {a.label}
                {a.status !== "signed-in" ? ` (${a.status})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field-inline">
          <span className="sr-only">Model (optional)</span>
          <input
            id={ids.model}
            className="model-input"
            value={st.model ?? ""}
            placeholder="model (default)"
            onChange={(e) => setCaseSettings(caseId, { model: e.target.value || null })}
          />
        </label>
        <fieldset className="seg" aria-describedby={mode === "open" ? ids.warn : undefined}>
          <legend className="sr-only">Mode</legend>
          {(["enforced", "open"] as const).map((m) => (
            <label key={m} className={cx("seg-opt", mode === m && "on")}>
              <input
                type="radio"
                name={`${caseId}-mode`}
                value={m}
                checked={mode === m}
                onChange={() => setCaseSettings(caseId, { mode: m })}
              />
              {m === "enforced" ? "Enforced" : "Open"}
            </label>
          ))}
        </fieldset>
        {mode === "open" ? (
          <span className="badge badge-warn" id={ids.warn}>
            <Icon name="warning" size={11} /> unenforced: client built-in tools bypass Assay's checks
          </span>
        ) : null}
        <label className="field-inline budget">
          <span>Budget $</span>
          <input
            id={ids.budget}
            type="number"
            min={0}
            step={0.05}
            inputMode="decimal"
            value={budget ?? ""}
            placeholder="none"
            onChange={(e) => {
              const v = e.target.value === "" ? null : Number(e.target.value);
              setCaseSettings(caseId, { budgetUsd: v !== null && Number.isFinite(v) ? v : null });
            }}
          />
        </label>
        <output className="estimate" aria-live="polite" title={estimate?.basis}>
          {estimate ? (
            <>
              <span className="sr-only">Estimated cost </span>
              {usdRange(estimate.usdLow, estimate.usdHigh)}
            </>
          ) : null}
        </output>
      </div>
      {signedOut ? (
        <p className="hint" id={ids.hint}>
          {mine.length === 0
            ? `No ${providerName(provider)} account yet. Add one under Accounts in the left rail.`
            : "The selected account is signed out. Sign in from Accounts in the left rail."}
        </p>
      ) : null}
      <div className="composer-actions">
        <button type="submit" className="btn btn-primary" disabled={!text.trim() || signedOut || sending}>
          <Icon name="send" size={12} /> Send
        </button>
        <button
          type="button"
          className="btn"
          disabled={!running}
          onClick={() => api.interrupt(caseId).catch(toastError)}
        >
          <Icon name="stop" size={12} /> Stop
        </button>
        <span className="sep" aria-hidden="true" />
        <button type="button" className="btn btn-sm" onClick={() => setDialog({ kind: "sweep", caseId })}>
          <Icon name="sweep" size={12} /> Sweep path…
        </button>
        <button type="button" className="btn btn-sm" onClick={() => verifyAll(caseId)}>
          <Icon name="verify" size={12} /> Verify all
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setDialog({ kind: "reassay", caseId })}>
          <Icon name="reassay" size={12} /> Re-assay…
        </button>
        <ExportMenu caseId={caseId} />
      </div>
    </form>
  );
}
