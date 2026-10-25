// Accounts: list, add (default login or a separate account home), sign in through the provider's own
// login command in an embedded terminal, check status, remove.

import { type FormEvent, lazy, type ReactNode, Suspense, useCallback, useState } from "react";
import type { ProviderId } from "../../src/contracts.ts";
import type { AccountView } from "../../src/server/api-types.ts";
import { api, followLogin, refreshAccounts, resetLogin, useData } from "./api.ts";
import { ProviderIcon } from "./icons.tsx";
import { AccountState } from "./status.tsx";
import { ago, providerName } from "./util.ts";
import { effectiveTheme, toastError, useView } from "./view.ts";

const XTerm = lazy(() => import("./Terminal.tsx"));

function LoginTerminal(props: { account: AccountView; onClose: () => void }): ReactNode {
  const theme = useView((s) => effectiveTheme(s.theme));
  const [done, setDone] = useState(false);
  const id = props.account.id;
  const attach = useCallback(
    (write: (s: string) => void) =>
      followLogin(id, (chunk, isDone) => {
        write(chunk);
        if (isDone) setDone(true);
      }),
    [id],
  );
  const onData = useCallback(
    (d: string) => {
      api.loginInput(id, d).catch(toastError);
    },
    [id],
  );
  return (
    <div className="login-term">
      <div className="login-term-head">
        <span>
          Sign-in terminal for <strong>{props.account.label}</strong>. Assay runs the provider's own login command; it
          never sees your credentials.
        </span>
        <button type="button" className="btn btn-sm" onClick={props.onClose}>
          Close terminal
        </button>
      </div>
      <Suspense fallback={<div className="muted pad">Loading terminal…</div>}>
        <XTerm label={`Sign-in terminal for ${props.account.label}`} theme={theme} attach={attach} onData={onData} />
      </Suspense>
      {done ? (
        <p className="ok-text" role="status">
          Sign-in finished.
        </p>
      ) : null}
    </div>
  );
}

export function AccountsManager(props: { compact?: boolean }): ReactNode {
  const accounts = useData((s) => s.app?.accounts ?? []);
  const providers = useData((s) => s.app?.providers ?? []);
  const [provider, setProvider] = useState<ProviderId>(() => providers.find((p) => p.installed)?.id ?? "claude");
  const [label, setLabel] = useState("");
  const [home, setHome] = useState<"default" | "new">("default");
  const [loginFor, setLoginFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const name = label.trim() || `${providerName(provider)} (${home === "default" ? "default login" : "separate"})`;
      await api.addAccount({ provider, label: name, home });
      await refreshAccounts();
      setLabel("");
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const signIn = async (a: AccountView) => {
    resetLogin(a.id);
    setLoginFor(a.id);
    try {
      await api.login(a.id);
    } catch (err) {
      toastError(err);
    }
  };

  const loginAccount = accounts.find((a) => a.id === loginFor);

  return (
    <div className="accounts">
      <table className="table">
        <caption className="sr-only">Accounts</caption>
        <thead>
          <tr>
            <th scope="col">Account</th>
            <th scope="col">Home</th>
            <th scope="col">Status</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {accounts.length === 0 ? (
            <tr>
              <td colSpan={4} className="muted">
                No accounts yet. Add one below.
              </td>
            </tr>
          ) : null}
          {accounts.map((a) => (
            <tr key={a.id}>
              <td>
                <span className="row-inline">
                  <ProviderIcon provider={a.provider} />
                  <span>
                    <strong>{a.label}</strong>
                    <span className="muted"> · {providerName(a.provider)}</span>
                  </span>
                </span>
              </td>
              <td className="mono small">{a.home ?? "default login"}</td>
              <td>
                <span className="row-inline">
                  <AccountState account={a} />
                  <span>{a.status}</span>
                  {a.method ? <span className="muted small">({a.method})</span> : null}
                </span>
                <div className="muted small">checked {ago(a.checkedAt)}</div>
              </td>
              <td className="actions">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => signIn(a)}
                  aria-label={`Sign in ${a.label}`}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => api.checkAccount(a.id).catch(toastError)}
                  aria-label={`Check status of ${a.label}`}
                >
                  Check status
                </button>
                {props.compact ? null : (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    aria-label={`Remove ${a.label}`}
                    onClick={() => {
                      if (confirm(`Remove “${a.label}” from Assay? The provider's own files are not touched.`))
                        api.deleteAccount(a.id).then(refreshAccounts).catch(toastError);
                    }}
                  >
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {loginAccount ? <LoginTerminal account={loginAccount} onClose={() => setLoginFor(null)} /> : null}
      <form className="card add-account" onSubmit={add} aria-labelledby="add-account-h">
        <h2 id="add-account-h" className="h-sub">
          Add an account
        </h2>
        <div className="form-row">
          <label>
            <span>Provider</span>
            <select value={provider} onChange={(e) => setProvider(e.target.value as ProviderId)}>
              {providers.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.installed}>
                  {providerName(p.id)}
                  {p.installed ? "" : " (not installed)"}
                </option>
              ))}
            </select>
          </label>
          <label className="grow">
            <span>Label</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Claude (work)" />
          </label>
        </div>
        <fieldset className="radio-row">
          <legend>Sign-in home</legend>
          <label>
            <input type="radio" name="home" checked={home === "default"} onChange={() => setHome("default")} /> Use my
            default login
          </label>
          <label>
            <input type="radio" name="home" checked={home === "new"} onChange={() => setHome("new")} /> New separate
            account home
          </label>
        </fieldset>
        <p className="muted small">
          A separate home keeps this account's credentials apart from your everyday login (CLAUDE_CONFIG_DIR or
          CODEX_HOME).
        </p>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Add account
        </button>
      </form>
    </div>
  );
}
