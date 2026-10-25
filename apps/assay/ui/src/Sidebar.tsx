// Sidebar: case search, "New case", the cases tree (forks nested under their parent, workers under the
// selected case) and account chips. The tree follows the ARIA tree pattern with arrow-key navigation.

import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { AccountView, CaseSummary, WorkerView } from "../../src/server/api-types.ts";
import { useData } from "./api.ts";
import { Icon, ProviderIcon } from "./icons.tsx";
import { AccountState, Liveness, StatusDot } from "./status.tsx";
import { cx } from "./util.ts";
import { goPage, openWorker, selectCase, setDialog, setPref, useView } from "./view.ts";

type Row =
  | { key: string; kind: "case"; c: CaseSummary; level: number; parentKey: string | null; hasChildren: boolean }
  | { key: string; kind: "worker"; w: WorkerView; level: number; parentKey: string; account: AccountView | undefined };

function buildRows(
  cases: CaseSummary[],
  query: string,
  selected: string | null,
  workers: WorkerView[],
  accounts: AccountView[],
): Row[] {
  const q = query.trim().toLowerCase();
  const byParent = new Map<string | null, CaseSummary[]>();
  const ids = new Set(cases.map((c) => c.id));
  for (const c of cases) {
    const parent = c.parentCase && ids.has(c.parentCase) && !q ? c.parentCase : null;
    const list = byParent.get(parent) ?? [];
    list.push(c);
    byParent.set(parent, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => b.createdAt - a.createdAt);
  const rows: Row[] = [];
  const walk = (parent: string | null, level: number) => {
    for (const c of byParent.get(parent) ?? []) {
      if (q && !c.title.toLowerCase().includes(q)) continue;
      const kids = byParent.get(c.id) ?? [];
      const showWorkers = c.id === selected ? workers : [];
      rows.push({
        key: `c:${c.id}`,
        kind: "case",
        c,
        level,
        parentKey: parent ? `c:${parent}` : null,
        hasChildren: kids.length > 0 || showWorkers.length > 0,
      });
      for (const w of showWorkers)
        rows.push({
          key: `w:${w.id}`,
          kind: "worker",
          w,
          level: level + 1,
          parentKey: `c:${c.id}`,
          account: accounts.find((a) => a.id === w.accountId),
        });
      walk(c.id, level + 1);
    }
  };
  walk(null, 1);
  return rows;
}

function CaseRowBody(props: { c: CaseSummary; parentTitle: string | null }): ReactNode {
  const { c } = props;
  const k = c.counts;
  return (
    <>
      <StatusDot status={c.activity} />
      {c.parentCase ? (
        <span
          className="fork-glyph"
          title={`Fork of “${props.parentTitle ?? c.parentCase}” at step ${c.forkedAt ?? "?"}`}
        >
          <Icon name="fork" size={12} />
          <span className="sr-only">{`Fork of ${props.parentTitle ?? c.parentCase} at step ${c.forkedAt ?? "?"}:`}</span>
        </span>
      ) : null}
      <span className="tree-title">{c.title}</span>
      <span className="tree-badges">
        {k.claims > 0 ? (
          <span className="count" title={`${k.verified} verified, ${k.refuted} refuted of ${k.claims} claims`}>
            <span className="v-ok" aria-hidden="true">
              ✔{k.verified}
            </span>
            {k.refuted > 0 ? (
              <span className="v-bad" aria-hidden="true">
                ✖{k.refuted}
              </span>
            ) : null}
            <span className="sr-only">{`${k.verified} verified, ${k.refuted} refuted`}</span>
          </span>
        ) : null}
        {k.approvalsPending > 0 ? (
          <span className="count count-attn" title={`${k.approvalsPending} approvals pending`}>
            <span aria-hidden="true">!{k.approvalsPending}</span>
            <span className="sr-only">{`${k.approvalsPending} approvals pending`}</span>
          </span>
        ) : null}
      </span>
    </>
  );
}

export function Sidebar(): ReactNode {
  const cases = useData((s) => s.app?.cases);
  const accounts = useData((s) => s.app?.accounts);
  const selected = useView((s) => s.caseId);
  const width = useView((s) => s.sidebarWidth);
  const workers = useData((s) => (selected ? s.details[selected]?.workers : undefined));
  const [query, setQuery] = useState("");
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(
    () => buildRows(cases ?? [], query, selected, workers ?? [], accounts ?? []),
    [cases, query, selected, workers, accounts],
  );
  const titles = useMemo(() => new Map((cases ?? []).map((c) => [c.id, c.title])), [cases]);
  const current = rows.find((r) => r.key === focusKey) ?? rows.find((r) => r.key === `c:${selected}`) ?? rows[0];

  const focusRow = (key: string) => {
    setFocusKey(key);
    requestAnimationFrame(() =>
      treeRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus(),
    );
  };

  const activate = (r: Row) => {
    if (r.kind === "case") selectCase(r.c.id);
    else openWorker(r.w.caseId, r.w.id);
  };

  const onKey = (e: KeyboardEvent, r: Row) => {
    const i = rows.indexOf(r);
    let next: Row | undefined;
    if (e.key === "ArrowDown") next = rows[i + 1];
    else if (e.key === "ArrowUp") next = rows[i - 1];
    else if (e.key === "Home") next = rows[0];
    else if (e.key === "End") next = rows[rows.length - 1];
    else if (e.key === "ArrowLeft" && r.parentKey) next = rows.find((x) => x.key === r.parentKey);
    else if (e.key === "ArrowRight" && r.kind === "case" && r.hasChildren) {
      if (r.c.id !== selected) selectCase(r.c.id);
      next = rows[i + 1];
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate(r);
      return;
    } else return;
    e.preventDefault();
    if (next) focusRow(next.key);
  };

  useEffect(() => {
    if (focusKey && !rows.some((r) => r.key === focusKey)) setFocusKey(null);
  }, [rows, focusKey]);

  const startDrag = (e: React.PointerEvent) => {
    const startX = e.clientX;
    const startW = width;
    const move = (ev: PointerEvent) =>
      setPref("sidebarWidth", Math.min(480, Math.max(200, startW + ev.clientX - startX)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <aside className="sidebar" aria-label="Cases and workers">
      <div className="sidebar-head">
        <div className="search">
          <Icon name="search" size={13} />
          <input
            type="search"
            aria-label="Search cases"
            placeholder="Search cases"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn btn-sm btn-primary new-case"
          onClick={() => setDialog({ kind: "new-case" })}
        >
          <Icon name="plus" size={12} /> New case
        </button>
      </div>
      <h2 className="sidebar-label" id="cases-h">
        Cases
      </h2>
      <div className="tree" role="tree" aria-labelledby="cases-h" ref={treeRef}>
        {rows.map((r) => {
          const isCurrent = current?.key === r.key;
          if (r.kind === "case") {
            const sel = r.c.id === selected;
            return (
              <div
                key={r.key}
                data-key={r.key}
                role="treeitem"
                aria-level={r.level}
                aria-selected={sel}
                aria-expanded={r.hasChildren ? true : undefined}
                tabIndex={isCurrent ? 0 : -1}
                className={cx("tree-row", "tree-case", sel && "selected")}
                style={{ paddingLeft: 8 + (r.level - 1) * 14 }}
                onClick={() => {
                  setFocusKey(r.key);
                  activate(r);
                }}
                onKeyDown={(e) => onKey(e, r)}
              >
                <CaseRowBody c={r.c} parentTitle={r.c.parentCase ? (titles.get(r.c.parentCase) ?? null) : null} />
              </div>
            );
          }
          const w = r.w;
          return (
            <div
              key={r.key}
              data-key={r.key}
              role="treeitem"
              aria-level={r.level}
              aria-selected={false}
              tabIndex={isCurrent ? 0 : -1}
              className="tree-row tree-worker"
              style={{ paddingLeft: 8 + (r.level - 1) * 14 }}
              onClick={() => {
                setFocusKey(r.key);
                activate(r);
              }}
              onKeyDown={(e) => onKey(e, r)}
            >
              <span className="tree-branch" aria-hidden="true" />
              <StatusDot status={w.status} />
              <ProviderIcon provider={w.provider} size={12} />
              <span className="tree-title">{w.title}</span>
              <span className="tree-sub muted">{r.account?.label ?? w.accountId}</span>
              <Liveness liveness={w.liveness} compact />
            </div>
          );
        })}
        {rows.length === 0 ? (
          <div className="muted pad small">{query ? "No cases match." : "No cases yet."}</div>
        ) : null}
      </div>
      <div className="sidebar-accounts">
        <h2 className="sidebar-label" id="acct-h">
          Accounts
        </h2>
        <ul className="chips" aria-labelledby="acct-h">
          {(accounts ?? []).map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className={cx("chip", "acct-chip", a.status !== "signed-in" && "dim")}
                onClick={() => goPage("accounts")}
                title={`${a.label}: ${a.status}`}
              >
                <ProviderIcon provider={a.provider} size={12} />
                <span className="chip-text">{a.label}</span>
                <AccountState account={a} />
              </button>
            </li>
          ))}
        </ul>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: a focusable splitter needs role=separator; <hr> cannot take focus */}
      <div
        className="resizer"
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={width}
        aria-valuemin={200}
        aria-valuemax={480}
        onPointerDown={startDrag}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            setPref("sidebarWidth", Math.min(480, Math.max(200, width + (e.key === "ArrowRight" ? 16 : -16))));
          }
        }}
      />
    </aside>
  );
}
