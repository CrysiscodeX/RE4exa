// UI-only state (selection, tabs, panels, preferences) and the actions that change it.

import { useSyncExternalStore } from "react";
import type { Mode } from "../../src/server/api-types.ts";
import { ApiError, api, loadCase, Store, store } from "./api.ts";
import { readPref, writePref } from "./util.ts";

export type Page = "cases" | "accounts" | "usage" | "calibration" | "settings" | "doctor";
export type InspectorTab = "evidence" | "claims" | "unknowns" | "approvals" | "workers" | "usage" | "calibration";
export type Theme = "dark" | "light" | "system";
export type TabKey = "chat" | "raw" | `w:${string}`;
export type DialogState =
  | { kind: "new-case" }
  | { kind: "sweep"; caseId: string }
  | { kind: "reassay"; caseId: string }
  | null;

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "error" | "ok";
  fix?: string | null;
}

export interface ViewState {
  page: Page;
  caseId: string | null;
  /** Open worker tabs per case. */
  workerTabs: Record<string, string[]>;
  activeTab: Record<string, TabKey>;
  inspectorOpen: boolean;
  inspectorTab: InspectorTab;
  evidenceId: string | null;
  claimId: string | null;
  paletteOpen: boolean;
  dialog: DialogState;
  theme: Theme;
  defaultMode: Mode;
  defaultBudget: number | null;
  sidebarWidth: number;
  wizardDismissed: boolean;
  toasts: Toast[];
}

export const view = new Store<ViewState>({
  page: "cases",
  caseId: null,
  workerTabs: {},
  activeTab: {},
  inspectorOpen: readPref("inspectorOpen", true),
  inspectorTab: "evidence",
  evidenceId: null,
  claimId: null,
  paletteOpen: false,
  dialog: null,
  theme: readPref<Theme>("theme", "dark"),
  defaultMode: readPref<Mode>("defaultMode", "enforced"),
  defaultBudget: readPref<number | null>("defaultBudget", null),
  sidebarWidth: readPref("sidebarWidth", 260),
  wizardDismissed: readPref("wizardDismissed", false),
  toasts: [],
});

export function useView<T>(sel: (s: ViewState) => T): T {
  return useSyncExternalStore(view.subscribe, () => sel(view.get()));
}

function patch(p: Partial<ViewState>): void {
  view.set((s) => ({ ...s, ...p }));
}

export function effectiveTheme(t: Theme): "dark" | "light" {
  if (t !== "system") return t;
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  if (t === "system") delete root.dataset.theme;
  else root.dataset.theme = t;
}

export function setTheme(t: Theme): void {
  writePref("theme", t);
  applyTheme(t);
  patch({ theme: t });
}

export function toggleTheme(): void {
  setTheme(effectiveTheme(view.get().theme) === "dark" ? "light" : "dark");
}

export function setPref(key: "defaultMode" | "defaultBudget" | "sidebarWidth", value: Mode | number | null): void {
  writePref(key, value);
  patch({ [key]: value } as Partial<ViewState>);
}

export function dismissWizard(): void {
  writePref("wizardDismissed", true);
  patch({ wizardDismissed: true });
}

export function goPage(page: Page): void {
  patch({ page });
}

export function selectCase(id: string): void {
  const s = view.get();
  patch({ caseId: id, page: "cases", evidenceId: s.caseId === id ? s.evidenceId : null, claimId: null });
  loadCase(id).catch((e: unknown) => toastError(e));
}

export function openTab(caseId: string, key: TabKey): void {
  view.set((s) => {
    const tabs = s.workerTabs[caseId] ?? [];
    const workerTabs =
      key.startsWith("w:") && !tabs.includes(key.slice(2))
        ? { ...s.workerTabs, [caseId]: [...tabs, key.slice(2)] }
        : s.workerTabs;
    return { ...s, page: "cases", caseId, workerTabs, activeTab: { ...s.activeTab, [caseId]: key } };
  });
}

export function openWorker(caseId: string, workerId: string): void {
  if (view.get().caseId !== caseId) selectCase(caseId);
  openTab(caseId, `w:${workerId}`);
}

export function closeWorkerTab(caseId: string, workerId: string): void {
  view.set((s) => {
    const tabs = (s.workerTabs[caseId] ?? []).filter((w) => w !== workerId);
    const active = s.activeTab[caseId] === `w:${workerId}` ? "chat" : (s.activeTab[caseId] ?? "chat");
    return { ...s, workerTabs: { ...s.workerTabs, [caseId]: tabs }, activeTab: { ...s.activeTab, [caseId]: active } };
  });
}

export function setInspector(open: boolean, tab?: InspectorTab): void {
  writePref("inspectorOpen", open);
  patch(tab ? { inspectorOpen: open, inspectorTab: tab } : { inspectorOpen: open });
}

export function toggleInspector(): void {
  setInspector(!view.get().inspectorOpen);
}

export function openEvidence(observationId: string | null, claimId: string | null = null): void {
  writePref("inspectorOpen", true);
  patch({ inspectorOpen: true, inspectorTab: "evidence", evidenceId: observationId, claimId });
}

export function setPalette(open: boolean): void {
  patch({ paletteOpen: open });
}

export function setDialog(dialog: DialogState): void {
  patch({ dialog });
}

let toastId = 0;
export function toast(text: string, tone: Toast["tone"] = "info", fix: string | null = null): void {
  const id = ++toastId;
  view.set((s) => ({ ...s, toasts: [...s.toasts.slice(-3), { id, text, tone, fix }] }));
  setTimeout(() => dismissToast(id), tone === "error" ? 9000 : 4000);
}

export function dismissToast(id: number): void {
  view.set((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) }));
}

export function toastError(e: unknown): void {
  if (e instanceof ApiError) toast(e.message, "error", e.fix);
  else toast(e instanceof Error ? e.message : String(e), "error");
}

// ---------------------------------------------------------------------------------------------
// Case actions shared by the composer, timeline and palette
// ---------------------------------------------------------------------------------------------

export async function forkAt(caseId: string, atSeq: number): Promise<void> {
  try {
    const summary = await api.fork(caseId, atSeq);
    store.set((s) =>
      s.app && !s.app.cases.some((c) => c.id === summary.id)
        ? { ...s, app: { ...s.app, cases: [...s.app.cases, summary] } }
        : s,
    );
    selectCase(summary.id);
    toast(`Forked at step ${atSeq}: “${summary.title}”`, "ok");
  } catch (e) {
    toastError(e);
  }
}

export async function verifyAll(caseId: string): Promise<void> {
  try {
    const claims = await api.verify(caseId);
    const v = claims.filter((c) => c.verdict === "verified").length;
    const r = claims.filter((c) => c.verdict === "refuted").length;
    toast(`Re-ran ${claims.length} seen claims: ${v} verified, ${r} refuted`, "ok");
    await loadCase(caseId, true);
  } catch (e) {
    toastError(e);
  }
}

export async function createCase(body: { title: string; recipeId?: string; path?: string }): Promise<void> {
  try {
    const summary = await api.createCase(body);
    store.set((s) =>
      s.app && !s.app.cases.some((c) => c.id === summary.id)
        ? { ...s, app: { ...s.app, cases: [...s.app.cases, summary] } }
        : s,
    );
    selectCase(summary.id);
  } catch (e) {
    toastError(e);
  }
}
