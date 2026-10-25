// Command palette (Ctrl/Cmd+K): a combobox over every command, case and worker.

import { type ReactNode, useId, useMemo, useState } from "react";
import { api, useData } from "./api.ts";
import { EXPORTS } from "./Composer.tsx";
import { Modal } from "./Dialogs.tsx";
import { cx, download } from "./util.ts";
import {
  forkAt,
  goPage,
  openWorker,
  selectCase,
  setDialog,
  setPalette,
  toast,
  toggleInspector,
  toggleTheme,
  useView,
  verifyAll,
} from "./view.ts";

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  run: () => void;
}

export function Palette(): ReactNode {
  const cases = useData((s) => s.app?.cases ?? []);
  const caseId = useView((s) => s.caseId);
  const detail = useData((s) => (caseId ? s.details[caseId] : undefined));
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const labelId = useId();

  const commands = useMemo<Command[]>(() => {
    const c: Command[] = [{ id: "new", group: "Case", label: "New case…", run: () => setDialog({ kind: "new-case" }) }];
    if (caseId && detail) {
      const last = [...detail.timeline].reverse().find((e) => e.workerId === null);
      c.push(
        {
          id: "fork",
          group: "Case",
          label: "Fork from the latest step",
          hint: last ? `step ${last.seq}` : undefined,
          run: () => (last ? forkAt(caseId, last.seq) : toast("Nothing to fork yet")),
        },
        { id: "sweep", group: "Case", label: "Sweep path…", run: () => setDialog({ kind: "sweep", caseId }) },
        { id: "verify", group: "Case", label: "Verify all claims", run: () => verifyAll(caseId) },
        { id: "reassay", group: "Case", label: "Re-assay…", run: () => setDialog({ kind: "reassay", caseId }) },
        { id: "interrupt", group: "Case", label: "Stop the current turn", run: () => void api.interrupt(caseId) },
        ...EXPORTS.map((x) => ({
          id: `export-${x.format}`,
          group: "Export",
          label: `Export: ${x.label}`,
          run: () => download(api.exportUrl(caseId, x.format)),
        })),
        ...detail.workers.map((w) => ({
          id: `worker-${w.id}`,
          group: "Open worker",
          label: `Open worker: ${w.title}`,
          hint: w.status,
          run: () => openWorker(caseId, w.id),
        })),
      );
    }
    c.push(
      ...cases.map((k) => ({
        id: `case-${k.id}`,
        group: "Switch case",
        label: `Switch to: ${k.title}`,
        hint: k.activity,
        run: () => selectCase(k.id),
      })),
      { id: "theme", group: "View", label: "Toggle theme (dark / light)", run: toggleTheme },
      { id: "inspector", group: "View", label: "Toggle inspector", run: toggleInspector },
      { id: "doctor", group: "Go to", label: "Doctor", run: () => goPage("doctor") },
      { id: "accounts", group: "Go to", label: "Accounts", run: () => goPage("accounts") },
      { id: "usage", group: "Go to", label: "Usage", run: () => goPage("usage") },
      { id: "calibration", group: "Go to", label: "Calibration", run: () => goPage("calibration") },
      { id: "settings", group: "Go to", label: "Settings", run: () => goPage("settings") },
    );
    return c;
  }, [cases, caseId, detail]);

  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = commands.filter((c) => terms.every((t) => `${c.group} ${c.label}`.toLowerCase().includes(t)));
  const idx = Math.min(active, Math.max(0, shown.length - 1));
  const close = () => setPalette(false);
  const run = (c: Command | undefined) => {
    if (!c) return;
    close();
    // Let the dialog close (and focus return) before the command opens anything else.
    setTimeout(c.run, 0);
  };

  return (
    <Modal title="Command palette" onClose={close} className="palette" labelId={labelId}>
      <h2 id={labelId} className="sr-only">
        Command palette
      </h2>
      <input
        className="palette-input"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={shown[idx] ? `${listId}-${shown[idx].id}` : undefined}
        aria-autocomplete="list"
        aria-label="Type a command"
        placeholder="Type a command or case name…"
        value={q}
        // biome-ignore lint/a11y/noAutofocus: the palette exists to be typed into
        autoFocus
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((idx + 1) % Math.max(1, shown.length));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((idx - 1 + shown.length) % Math.max(1, shown.length));
          } else if (e.key === "Enter") {
            e.preventDefault();
            run(shown[idx]);
          }
        }}
      />
      <div className="palette-list" role="listbox" id={listId} aria-label="Commands">
        {shown.map((c, i) => (
          <div
            key={c.id}
            tabIndex={-1}
            id={`${listId}-${c.id}`}
            role="option"
            aria-selected={i === idx}
            className={cx("palette-item", i === idx && "active")}
            onMouseMove={() => setActive(i)}
            onClick={() => run(c)}
            onKeyDown={() => {}}
          >
            <span className="palette-group">{c.group}</span>
            <span className="palette-label">{c.label}</span>
            {c.hint ? <span className="palette-hint">{c.hint}</span> : null}
          </div>
        ))}
        {shown.length === 0 ? (
          <div role="option" tabIndex={-1} aria-selected={false} aria-disabled="true" className="palette-item muted">
            No matching commands
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
