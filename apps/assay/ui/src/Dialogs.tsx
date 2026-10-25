// Modal dialogs built on the native <dialog> element (focus containment and Esc come from the browser).

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { api, loadCase, useData } from "./api.ts";
import { createCase, setDialog, toast, toastError, useView } from "./view.ts";

export function Modal(props: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  labelId?: string;
}): ReactNode {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const labelId = props.labelId ?? id;
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const opener = document.activeElement as HTMLElement | null;
    if (!d.open) d.showModal();
    return () => {
      if (d.open) d.close();
      opener?.focus?.();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={props.className ?? "modal"}
      aria-labelledby={labelId}
      onCancel={(e) => {
        e.preventDefault();
        onClose.current();
      }}
    >
      {props.labelId ? null : (
        <h2 id={labelId} className="modal-title">
          {props.title}
        </h2>
      )}
      {props.children}
    </dialog>
  );
}

function NewCaseDialog(): ReactNode {
  const recipes = useData((s) => s.app?.recipes ?? []);
  const root = useData((s) => s.app?.workspaceRoot ?? "");
  const [title, setTitle] = useState("");
  const [recipeId, setRecipeId] = useState("");
  const [path, setPath] = useState("");
  const recipe = recipes.find((r) => r.id === recipeId);
  const close = () => setDialog(null);
  return (
    <Modal title="New case" onClose={close}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const body: { title: string; recipeId?: string; path?: string } = {
            title: title.trim() || recipe?.title || "Untitled case",
          };
          if (recipeId) body.recipeId = recipeId;
          if (path.trim()) body.path = path.trim();
          close();
          await createCase(body);
        }}
      >
        <label className="field">
          <span>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What are you investigating?" />
        </label>
        <label className="field">
          <span>Recipe (optional)</span>
          <select value={recipeId} onChange={(e) => setRecipeId(e.target.value)}>
            <option value="">None</option>
            {recipes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </label>
        {recipe ? <p className="muted small">{recipe.description}</p> : null}
        <label className="field">
          <span>
            Path in {root || "the workspace"}
            {recipe?.needsPath ? " (required by this recipe)" : " (optional)"}
          </span>
          <input
            className="mono"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            required={!!recipe?.needsPath}
          />
        </label>
        <div className="btn-row end">
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Create case
          </button>
        </div>
      </form>
    </Modal>
  );
}

function fmtSet(v: unknown): string {
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return String(v.length);
  return "?";
}

function PathDialog(props: { kind: "sweep" | "reassay"; caseId: string }): ReactNode {
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const close = () => setDialog(null);
  const sweep = props.kind === "sweep";
  return (
    <Modal title={sweep ? "Sweep a path" : "Re-assay against a new version"} onClose={close}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!path.trim()) return;
          setBusy(true);
          try {
            if (sweep) {
              const r = await api.sweep(props.caseId, path.trim());
              toast(`Sweep of ${r.subject}: ${r.findings.length} findings, ${r.notExamined.length} not examined`, "ok");
            } else {
              const r = await api.reassay(props.caseId, path.trim());
              toast(
                `Re-assay: ${fmtSet(r.added)} added, ${fmtSet(r.removed)} removed, ${fmtSet(r.unchanged)} unchanged`,
                "ok",
              );
              await loadCase(props.caseId, true);
            }
            close();
          } catch (err) {
            toastError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="muted small">
          {sweep
            ? "Runs every cheap, model-free probe on the path and records what it could not examine."
            : "Re-runs this case's probes on another version and pairs findings by their stable key."}
        </p>
        <label className="field">
          <span>{sweep ? "Path to sweep" : "Path of the new version"}</span>
          <input
            className="mono"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            required
            placeholder="dist/libfoo-2.4.2.tar.gz"
          />
        </label>
        <div className="btn-row end">
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {sweep ? "Sweep" : "Re-assay"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function Dialogs(): ReactNode {
  const d = useView((s) => s.dialog);
  if (!d) return null;
  if (d.kind === "new-case") return <NewCaseDialog />;
  return <PathDialog key={d.kind} kind={d.kind} caseId={d.caseId} />;
}
