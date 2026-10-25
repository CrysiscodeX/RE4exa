// First-run wizard: providers, accounts, workspace, recipes.

import { type ReactNode, useRef, useState } from "react";
import { AccountsManager } from "./Accounts.tsx";
import { useData } from "./api.ts";
import { Icon, ProviderIcon } from "./icons.tsx";
import { cx, providerName } from "./util.ts";
import { createCase, dismissWizard } from "./view.ts";

const STEPS = ["Agent clients", "Accounts", "Workspace", "Start a case"] as const;

export function Wizard(): ReactNode {
  const app = useData((s) => s.app);
  const [step, setStep] = useState(0);
  const [path, setPath] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const go = (n: number) => {
    setStep(n);
    // Move focus to the new step's heading so screen readers announce it.
    requestAnimationFrame(() => heading.current?.focus());
  };
  if (!app) return null;

  const start = async (recipeId: string, title: string) => {
    const body: { title: string; recipeId: string; path?: string } = { title, recipeId };
    if (path.trim()) body.path = path.trim();
    await createCase(body);
    dismissWizard();
  };

  return (
    <main className="wizard" aria-labelledby="wizard-title">
      <div className="wizard-card">
        <header className="wizard-head">
          <p className="eyebrow">Welcome to Assay {app.version}</p>
          <h1 id="wizard-title">Set up your workbench</h1>
          <button type="button" className="btn btn-ghost wizard-skip" onClick={dismissWizard}>
            Skip setup
          </button>
        </header>
        <nav aria-label="Setup steps">
          <ol className="steps">
            {STEPS.map((s, i) => (
              <li key={s} className={cx("step", i === step && "current", i < step && "past")}>
                <button
                  type="button"
                  className="step-btn"
                  aria-current={i === step ? "step" : undefined}
                  onClick={() => go(i)}
                >
                  <span className="step-n" aria-hidden="true">
                    {i < step ? "✓" : i + 1}
                  </span>
                  {s}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <section className="wizard-body" aria-labelledby="wizard-step-h">
          <h2 id="wizard-step-h" tabIndex={-1} ref={heading}>
            {STEPS[step]}
          </h2>
          {step === 0 ? (
            <>
              <p className="muted">
                Assay drives the official agent CLIs on your own signed-in accounts. These were found on this machine:
              </p>
              <ul className="provider-grid">
                {app.providers.map((p) => (
                  <li key={p.id} className={cx("card", "provider-card", !p.installed && "dim")}>
                    <div className="row-inline">
                      <ProviderIcon provider={p.id} size={18} />
                      <strong>{providerName(p.id)}</strong>
                      <span className={cx("badge", p.installed ? "badge-ok" : "badge-muted")}>
                        {p.installed ? `installed ${p.version ?? ""}` : "not installed"}
                      </span>
                      <span className={`badge badge-enf-${p.enforcement}`}>{p.enforcement}</span>
                    </div>
                    {p.program ? <div className="mono small muted">{p.program}</div> : null}
                    {p.notes.length ? (
                      <ul className="notes">
                        {p.notes.map((n) => (
                          <li key={n}>{n}</li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="muted small">
                <strong>enforced</strong>: only Assay's checked tools. <strong>partial</strong>: the client keeps some
                built-ins, routed through approval. <strong>unenforced</strong>: built-ins bypass Assay's checks.
              </p>
            </>
          ) : null}
          {step === 1 ? (
            <>
              <p className="muted">
                Add an account per provider. Use your default login, or a separate account home to keep work and
                personal accounts apart. Sign in opens the provider's own login in a terminal.
              </p>
              <AccountsManager compact />
            </>
          ) : null}
          {step === 2 ? (
            <>
              <p>
                Workspace root: <code className="mono">{app.workspaceRoot}</code>
              </p>
              <p className="muted small">Agents and probes can only read inside this folder.</p>
              <label className="field">
                <span>File or folder to investigate (relative to the workspace)</span>
                <input
                  className="mono"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="e.g. dist/libfoo-2.4.1.tar.gz"
                />
              </label>
            </>
          ) : null}
          {step === 3 ? (
            <>
              <p className="muted">Pick a recipe to create your first case{path ? ` for ${path}` : ""}.</p>
              <ul className="recipe-grid">
                {app.recipes.map((r) => {
                  const blocked = r.needsPath && !path.trim();
                  return (
                    <li key={r.id} className="card recipe-card">
                      <h3>{r.title}</h3>
                      <p className="muted small">{r.description}</p>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm recipe-start"
                        disabled={blocked}
                        aria-describedby={blocked ? `need-path-${r.id}` : undefined}
                        onClick={() => start(r.id, r.title)}
                      >
                        Start “{r.title}”
                      </button>
                      {blocked ? (
                        <p id={`need-path-${r.id}`} className="muted small">
                          Needs a path: enter one in step 3.
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </section>
        <footer className="wizard-foot">
          <button type="button" className="btn" disabled={step === 0} onClick={() => go(step - 1)}>
            Back
          </button>
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn btn-primary" onClick={() => go(step + 1)}>
              Next <Icon name="chevronRight" size={12} />
            </button>
          ) : (
            <button type="button" className="btn" onClick={dismissWizard}>
              Finish without a case
            </button>
          )}
        </footer>
      </div>
    </main>
  );
}
