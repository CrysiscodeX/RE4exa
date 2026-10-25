// Root: pairing → first-run wizard → the workbench layout (rail, sidebar, main, inspector).

import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { ApiError, api, loadCase, loadState, PushSocket, store, useData } from "./api.ts";
import { Dialogs } from "./Dialogs.tsx";
import { Inspector } from "./Inspector.tsx";
import { Icon } from "./icons.tsx";
import { PAGE_TITLES, PageView } from "./Pages.tsx";
import { Pairing } from "./Pairing.tsx";
import { Palette } from "./Palette.tsx";
import { Rail } from "./Rail.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { cx } from "./util.ts";
import { dismissToast, setDialog, setPalette, useView, view } from "./view.ts";
import { Wizard } from "./Wizard.tsx";
import { TopBar, Workspace } from "./Workspace.tsx";

type Boot =
  | { s: "loading" }
  | { s: "pairing" }
  | { s: "unpaired" }
  | { s: "failed"; error: string; fix: string | null }
  | { s: "ready" };

function LiveRegion(): ReactNode {
  const a = useData((s) => s.announce);
  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true">
      {a ? `${a.text}${a.id % 2 ? "" : " "}` : ""}
    </div>
  );
}

function Toasts(): ReactNode {
  const toasts = useView((s) => s.toasts);
  return (
    <section className="toasts" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className={cx("toast", `toast-${t.tone}`)} role={t.tone === "error" ? "alert" : "status"}>
          <div>
            <div>{t.text}</div>
            {t.fix ? <div className="small">Fix: {t.fix}</div> : null}
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Dismiss notification"
            onClick={() => dismissToast(t.id)}
          >
            <Icon name="close" size={11} />
          </button>
        </div>
      ))}
    </section>
  );
}

function EmptyMain(): ReactNode {
  const cases = useData((s) => s.app?.cases.length ?? 0);
  return (
    <div className="empty">
      <Icon name="cases" size={32} />
      <h2>{cases ? "Pick a case from the sidebar" : "No cases yet"}</h2>
      <p className="muted">
        A case is a durable investigation: it survives restarts, can be forked at any step, and every claim in it is
        re-checked against evidence.
      </p>
      <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: "new-case" })}>
        <Icon name="plus" size={12} /> New case
      </button>
    </div>
  );
}

function Layout(): ReactNode {
  const page = useView((s) => s.page);
  const caseId = useView((s) => s.caseId);
  const inspectorOpen = useView((s) => s.inspectorOpen);
  const palette = useView((s) => s.paletteOpen);
  const width = useView((s) => s.sidebarWidth);
  const detail = useData((s) => (caseId ? s.details[caseId] : undefined));
  const showInspector = page === "cases" && inspectorOpen;

  return (
    <div
      className={cx("app", showInspector && "with-inspector")}
      style={{ "--sidebar-w": `${width}px` } as CSSProperties}
    >
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <Rail />
      <Sidebar />
      <main id="main" className="main" tabIndex={-1}>
        {page === "cases" ? (
          caseId ? (
            detail ? (
              <>
                <TopBar detail={detail} />
                <Workspace detail={detail} />
              </>
            ) : (
              <>
                <TopBar detail={undefined} title="Loading case…" />
                <p className="muted pad" role="status">
                  Loading case…
                </p>
              </>
            )
          ) : (
            <>
              <TopBar detail={undefined} title="Assay" />
              <EmptyMain />
            </>
          )
        ) : (
          <>
            <TopBar detail={undefined} title={PAGE_TITLES[page]} />
            <PageView page={page} />
          </>
        )}
      </main>
      {showInspector ? <Inspector detail={detail} /> : null}
      <Dialogs />
      {palette ? <Palette /> : null}
    </div>
  );
}

let bootOnce: Promise<Boot> | null = null;
let socket: PushSocket | null = null;

/** Pairs (when the URL carries a code), loads the state and opens the push socket. Runs once per page. */
function bootApp(): Promise<Boot> {
  bootOnce ??= (async (): Promise<Boot> => {
    const m = location.hash.match(/(?:^#|&)pair=([^&]+)/);
    let pairError: ApiError | null = null;
    if (m) {
      history.replaceState(null, "", location.pathname + location.search);
      try {
        await api.pair(decodeURIComponent(m[1]!));
      } catch (e) {
        pairError = e instanceof ApiError ? e : new ApiError(0, "pair_failed", String(e), null, false);
      }
    }
    try {
      await loadState();
    } catch (e) {
      if (pairError) return { s: "failed", error: pairError.message, fix: pairError.fix };
      if (e instanceof ApiError && e.status === 401) return { s: "unpaired" };
      return { s: "failed", error: (e as Error).message, fix: e instanceof ApiError ? e.fix : null };
    }
    socket = new PushSocket(() => {
      loadState().catch(() => {});
      const id = view.get().caseId;
      if (id) loadCase(id, true).catch(() => {});
      store.set((s) => ({ ...s, streaming: {} }));
    });
    socket.start();
    return { s: "ready" };
  })();
  return bootOnce;
}

export function App(): ReactNode {
  const [boot, setBoot] = useState<Boot>(() => (/[#&]pair=/.test(location.hash) ? { s: "pairing" } : { s: "loading" }));
  const firstRun = useData((s) => s.app?.firstRun ?? false);
  const dismissed = useView((s) => s.wizardDismissed);

  useEffect(() => {
    let live = true;
    bootApp().then((b) => live && setBoot(b));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(!view.get().paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  let body: ReactNode;
  if (boot.s === "loading") body = <p className="boot muted">Loading Assay…</p>;
  else if (boot.s === "pairing") body = <Pairing state="pairing" />;
  else if (boot.s === "unpaired") body = <Pairing state="unpaired" />;
  else if (boot.s === "failed") body = <Pairing state="failed" error={boot.error} fix={boot.fix} />;
  else if (firstRun && !dismissed) body = <Wizard />;
  else body = <Layout />;

  return (
    <>
      {body}
      <LiveRegion />
      <Toasts />
    </>
  );
}
