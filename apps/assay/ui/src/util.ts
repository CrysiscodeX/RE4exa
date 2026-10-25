// Small helpers shared by the components.

import { useEffect, useState } from "react";
import type { ProviderId } from "../../src/contracts.ts";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function usd(n: number, digits = 2): string {
  if (n > 0 && n < 0.005 && digits === 2) return "<$0.01";
  return `$${n.toFixed(digits)}`;
}

/** "~$0.01–0.03" for a cost estimate. */
export function usdRange(low: number, high: number): string {
  const lo = Math.floor(low * 100) / 100;
  const hi = Math.max(Math.ceil(high * 100) / 100, 0.01);
  if (lo === hi) return `~$${hi.toFixed(2)}`;
  return `~$${lo.toFixed(2)}–${hi.toFixed(2)}`;
}

export function num(n: number): string {
  return n.toLocaleString("en-US");
}

export function clock(at: number): string {
  return new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function ago(at: number | null): string {
  if (at === null) return "never";
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export const PROVIDER_NAMES: Record<ProviderId, string> = {
  claude: "Claude",
  codex: "Codex",
  acp: "ACP agent",
  fake: "Fake (test)",
};

export function providerName(id: string): string {
  return PROVIDER_NAMES[id as ProviderId] ?? id;
}

export function json(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2) ?? String(v);
  } catch {
    return String(v);
  }
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`assay.${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(`assay.${key}`, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private windows); preferences then last for this page only.
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function download(url: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Moves focus among `items` with arrow keys; returns the new index or null when the key is not handled. */
export function rovingIndex(
  key: string,
  index: number,
  count: number,
  orientation: "horizontal" | "vertical",
): number | null {
  const prev = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
  const next = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
  if (count === 0) return null;
  if (key === prev) return (index - 1 + count) % count;
  if (key === next) return (index + 1) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
