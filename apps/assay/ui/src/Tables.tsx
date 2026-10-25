// Usage and calibration tables, shared by the inspector and the full pages.

import { type ReactNode, useEffect, useState } from "react";
import type { CalibrationView, UsageRow } from "../../src/server/api-types.ts";
import { api, store, type UsageBy, useData } from "./api.ts";
import { num, providerName, usd } from "./util.ts";
import { toastError } from "./view.ts";

const BY_LABEL: Record<UsageBy, string> = {
  account_id: "Account",
  provider: "Provider",
  case_id: "Case",
  worker_id: "Worker",
};

export function UsageTable(props: { by?: UsageBy; selectable?: boolean }): ReactNode {
  const [by, setBy] = useState<UsageBy>(props.by ?? "account_id");
  const pushed = useData((s) => s.usage);
  const accounts = useData((s) => s.app?.accounts);
  const cases = useData((s) => s.app?.cases);
  const [rows, setRows] = useState<UsageRow[] | null>(null);

  useEffect(() => {
    let live = true;
    api
      .usage(by)
      .then((r) => {
        if (!live) return;
        setRows(r);
        if (by === "account_id") store.set((s) => ({ ...s, usage: r }));
      })
      .catch(toastError);
    return () => {
      live = false;
    };
  }, [by]);

  const data = by === "account_id" && pushed ? pushed : rows;
  const label = (key: string) => {
    if (by === "account_id") return accounts?.find((a) => a.id === key)?.label ?? key;
    if (by === "provider") return providerName(key);
    if (by === "case_id") return cases?.find((c) => c.id === key)?.title ?? key;
    return key;
  };
  const total = (data ?? []).reduce(
    (t, r) => ({
      turns: t.turns + r.turns,
      inputTokens: t.inputTokens + r.inputTokens,
      outputTokens: t.outputTokens + r.outputTokens,
      costUsd: t.costUsd + r.costUsd,
      resent: t.resent + r.resent,
    }),
    { turns: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, resent: 0 },
  );
  return (
    <div className="usage">
      {props.selectable ? (
        <label className="field-inline">
          <span>Group by</span>
          <select value={by} onChange={(e) => setBy(e.target.value as UsageBy)}>
            {(Object.keys(BY_LABEL) as UsageBy[]).map((k) => (
              <option key={k} value={k}>
                {BY_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <table className="table num-table">
        <caption className="sr-only">Usage by {BY_LABEL[by].toLowerCase()}</caption>
        <thead>
          <tr>
            <th scope="col">{BY_LABEL[by]}</th>
            <th scope="col">Turns</th>
            <th scope="col">Tokens in</th>
            <th scope="col">Tokens out</th>
            <th scope="col">Cost</th>
            <th scope="col" title="Turns whose context was re-sent after a resume">
              Re-sent
            </th>
          </tr>
        </thead>
        <tbody>
          {data === null ? (
            <tr>
              <td colSpan={6} className="muted">
                Loading…
              </td>
            </tr>
          ) : (
            data.map((r) => (
              <tr key={r.key}>
                <th scope="row">
                  {label(r.key)}
                  {by !== "provider" ? <span className="muted small"> · {providerName(r.provider)}</span> : null}
                </th>
                <td>{num(r.turns)}</td>
                <td>{num(r.inputTokens)}</td>
                <td>{num(r.outputTokens)}</td>
                <td>{usd(r.costUsd, 4)}</td>
                <td>{num(r.resent)}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td>{num(total.turns)}</td>
            <td>{num(total.inputTokens)}</td>
            <td>{num(total.outputTokens)}</td>
            <td>{usd(total.costUsd, 4)}</td>
            <td>{num(total.resent)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

const STATUS_TEXT: Record<CalibrationView["status"], string> = {
  ok: "ok",
  insufficient: "insufficient data",
  demoted: "demoted",
};

export function CalibrationTable(): ReactNode {
  const [rows, setRows] = useState<CalibrationView[] | null>(null);
  useEffect(() => {
    api.calibration().then(setRows).catch(toastError);
  }, []);
  return (
    <table className="table calib-table">
      <caption className="sr-only">Calibration by producer and question class</caption>
      <thead>
        <tr>
          <th scope="col">Producer · class</th>
          <th scope="col">✔ / ✖ / ?</th>
          <th scope="col">Precision</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows === null ? (
          <tr>
            <td colSpan={4} className="muted">
              Loading…
            </td>
          </tr>
        ) : null}
        {(rows ?? []).map((r) => {
          const [lo, hi] = r.interval;
          return (
            <tr key={`${r.producer}|${r.questionClass}`}>
              <th scope="row">
                <div className="mono small">{r.producer}</div>
                <div className="muted small">{r.questionClass}</div>
              </th>
              <td className="mono small">
                <span className="sr-only">{`${r.verified} verified, ${r.refuted} refuted, ${r.unverifiable} unverifiable`}</span>
                <span aria-hidden="true">
                  {r.verified} / {r.refuted} / {r.unverifiable}
                </span>
              </td>
              <td>
                <div className="precision">
                  <span>{r.precision === null ? "n/a" : `${(r.precision * 100).toFixed(0)}%`}</span>
                  <span
                    className="interval"
                    role="img"
                    aria-label={`95% interval ${(lo * 100).toFixed(0)}% to ${(hi * 100).toFixed(0)}%`}
                    title={`95% interval ${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}%`}
                  >
                    <span
                      className="interval-bar"
                      style={{ left: `${lo * 100}%`, width: `${Math.max(1, (hi - lo) * 100)}%` }}
                    />
                    {r.precision !== null ? (
                      <span className="interval-pt" style={{ left: `${r.precision * 100}%` }} />
                    ) : null}
                  </span>
                </div>
              </td>
              <td>
                <span className={`badge badge-cal-${r.status}`}>{STATUS_TEXT[r.status]}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
