// Full pages reached from the rail: Accounts, Usage, Calibration, Settings, Doctor.

import { type ReactNode, useEffect, useState } from "react";
import type { DoctorCheck, Mode } from "../../src/server/api-types.ts";
import { AccountsManager } from "./Accounts.tsx";
import { api } from "./api.ts";
import { Icon } from "./icons.tsx";
import { CalibrationTable, UsageTable } from "./Tables.tsx";
import { cx } from "./util.ts";
import { type Page, setPref, setTheme, type Theme, toastError, useView } from "./view.ts";

function DoctorPage(): ReactNode {
  const [checks, setChecks] = useState<DoctorCheck[] | null>(null);
  const run = () => {
    setChecks(null);
    api.doctor().then(setChecks).catch(toastError);
  };
  useEffect(run, []);
  const failing = checks?.filter((c) => !c.ok).length ?? 0;
  return (
    <>
      <div className="row-inline">
        <p className="muted">
          {checks === null
            ? "Running checks…"
            : failing
              ? `${failing} of ${checks.length} checks need attention.`
              : "All checks pass."}
        </p>
        <button type="button" className="btn btn-sm push" onClick={run}>
          Run again
        </button>
      </div>
      <ul className="doctor-list">
        {(checks ?? []).map((c) => (
          <li key={c.id} className={cx("card", "doctor-item", !c.ok && "card-error")}>
            <div className="row-inline">
              <span
                className={cx("doctor-mark", c.ok ? "ok" : "bad")}
                role="img"
                aria-label={c.ok ? "Passed" : "Failed"}
              >
                <Icon name={c.ok ? "check" : "cross"} size={12} />
              </span>
              <strong className="mono">{c.id}</strong>
              <span>{c.detail}</span>
            </div>
            {c.fix ? (
              <p className="small">
                <span className="label-sm inline">Fix</span> {c.fix}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

function SettingsPage(): ReactNode {
  const theme = useView((s) => s.theme);
  const mode = useView((s) => s.defaultMode);
  const budget = useView((s) => s.defaultBudget);
  return (
    <form className="settings" onSubmit={(e) => e.preventDefault()}>
      <fieldset className="radio-row">
        <legend>Theme</legend>
        {(["dark", "light", "system"] as Theme[]).map((t) => (
          <label key={t}>
            <input type="radio" name="theme" checked={theme === t} onChange={() => setTheme(t)} /> {t}
          </label>
        ))}
      </fieldset>
      <fieldset className="radio-row">
        <legend>Default mode for new turns</legend>
        {(["enforced", "open"] as Mode[]).map((m) => (
          <label key={m}>
            <input type="radio" name="mode" checked={mode === m} onChange={() => setPref("defaultMode", m)} />{" "}
            {m === "enforced" ? "Enforced (only Assay's checked tools)" : "Open (client built-ins allowed, unenforced)"}
          </label>
        ))}
      </fieldset>
      <label className="field">
        <span>Default budget per turn (USD, empty for none)</span>
        <input
          type="number"
          min={0}
          step={0.05}
          value={budget ?? ""}
          onChange={(e) => {
            const v = e.target.value === "" ? null : Number(e.target.value);
            setPref("defaultBudget", v !== null && Number.isFinite(v) ? v : null);
          }}
        />
      </label>
      <p className="muted small">Settings are kept in this browser only.</p>
    </form>
  );
}

export const PAGE_TITLES: Record<Exclude<Page, "cases">, string> = {
  accounts: "Accounts",
  usage: "Usage",
  calibration: "Calibration",
  settings: "Settings",
  doctor: "Doctor",
};

export function PageView(props: { page: Exclude<Page, "cases"> }): ReactNode {
  return (
    <div className="page">
      {props.page === "accounts" ? <AccountsManager /> : null}
      {props.page === "usage" ? <UsageTable selectable /> : null}
      {props.page === "calibration" ? (
        <>
          <p className="muted">
            How often each producer's claims survive re-checking, per question class. Producers with too little data
            stay “insufficient”; those whose precision interval falls below the bar are demoted and their claims need
            evidence.
          </p>
          <CalibrationTable />
        </>
      ) : null}
      {props.page === "settings" ? <SettingsPage /> : null}
      {props.page === "doctor" ? <DoctorPage /> : null}
    </div>
  );
}
