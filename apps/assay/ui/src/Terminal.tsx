// xterm.js wrapper. Loaded lazily (React.lazy) so the terminal code is only fetched for the Raw tab
// and the sign-in terminal.

import "@xterm/xterm/css/xterm.css";
import { Terminal } from "@xterm/xterm";
import { type ReactNode, useEffect, useRef } from "react";

export interface XTermProps {
  label: string;
  readOnly?: boolean;
  theme: "dark" | "light";
  onData?: (data: string) => void;
  /** Called once with a writer; returns a cleanup. */
  attach: (write: (s: string) => void, clear: () => void) => () => void;
}

const FONT = 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace';

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function themeFromCss(mode: "dark" | "light") {
  const dark = mode === "dark";
  return {
    background: cssVar("--term-bg", dark ? "#0d0d0d" : "#fbfbfb"),
    foreground: cssVar("--term-fg", dark ? "#e5e5e5" : "#1f1f1f"),
    cursor: cssVar("--term-cursor", dark ? "#e5e5e5" : "#1f1f1f"),
    selectionBackground: cssVar("--term-selection", dark ? "#264f78" : "#add6ff"),
  };
}

function measureCell(fontSize: number): { w: number; h: number } {
  const probe = document.createElement("span");
  probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font-family:${FONT};font-size:${fontSize}px;line-height:normal`;
  probe.textContent = "W".repeat(20);
  document.body.appendChild(probe);
  const r = probe.getBoundingClientRect();
  probe.remove();
  return { w: r.width / 20 || fontSize * 0.6, h: Math.ceil(fontSize * 1.2) };
}

export default function XTerm(props: XTermProps): ReactNode {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const onData = useRef(props.onData);
  onData.current = props.onData;
  const { attach, readOnly, label, theme } = props;
  const initialTheme = useRef(theme);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const fontSize = 12;
    const t = new Terminal({
      fontFamily: FONT,
      fontSize,
      convertEol: false,
      cursorBlink: !readOnly && !matchMedia("(prefers-reduced-motion: reduce)").matches,
      disableStdin: !!readOnly,
      scrollback: 5000,
      theme: themeFromCss(initialTheme.current),
      allowProposedApi: false,
      // Keeps every colour (including dim text and ANSI greens) at 4.5:1 against the background.
      minimumContrastRatio: 4.5,
    });
    term.current = t;
    t.open(el);
    const ta = el.querySelector("textarea");
    if (ta) ta.setAttribute("aria-label", readOnly ? `${label} (read-only)` : `${label} input`);
    const cell = measureCell(fontSize);
    const fit = () => {
      const w = el.clientWidth - 8;
      const h = el.clientHeight - 4;
      const cols = Math.max(20, Math.floor(w / cell.w));
      const rows = Math.max(4, Math.floor(h / cell.h));
      if (cols !== t.cols || rows !== t.rows) t.resize(cols, rows);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    const sub = t.onData((d) => onData.current?.(d));
    const detach = attach(
      (s) => t.write(s),
      () => t.clear(),
    );
    if (!readOnly) t.focus();
    return () => {
      detach();
      sub.dispose();
      ro.disconnect();
      t.dispose();
      term.current = null;
    };
  }, [attach, readOnly, label]);

  useEffect(() => {
    // Re-read the CSS colours whenever the app theme changes.
    if (term.current) term.current.options.theme = themeFromCss(theme);
  }, [theme]);

  return <section className="xterm-host" ref={host} aria-label={props.label} />;
}
