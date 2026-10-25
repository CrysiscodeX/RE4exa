// Pairing: shown when the browser has no session cookie yet.

import type { ReactNode } from "react";
import { Icon } from "./icons.tsx";

export function Pairing(props: {
  state: "pairing" | "unpaired" | "failed";
  error?: string;
  fix?: string | null;
}): ReactNode {
  return (
    <main className="pairing" aria-labelledby="pair-title">
      <div className="pairing-card card">
        <Icon name="cases" size={28} className="brand" />
        <h1 id="pair-title">{props.state === "pairing" ? "Pairing with Assay…" : "Pair this browser with Assay"}</h1>
        {props.state === "pairing" ? (
          <p role="status">Checking the one-time code from your link.</p>
        ) : (
          <>
            {props.state === "failed" ? (
              <p className="error-text" role="alert">
                Pairing failed: {props.error}
                {props.fix ? ` ${props.fix}.` : ""}
              </p>
            ) : null}
            <p>Assay only accepts browsers that you pair from your own terminal. To get a link:</p>
            <ol>
              <li>
                Run <code>assay serve</code> in a terminal.
              </li>
              <li>
                It prints a link like <code>http://127.0.0.1:PORT/#pair=CODE</code>. Open that link in this browser.
              </li>
            </ol>
            <p className="muted small">
              The code works once and expires after 5 minutes. The session cookie then stays valid for 30 days on this
              browser.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
