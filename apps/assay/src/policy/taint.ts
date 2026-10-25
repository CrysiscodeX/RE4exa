// Taint tracking and the effect policy. See docs/threat-model.md (TB1, TB2, TB3).
//
// - `envelope` wraps text that came from the target (file contents, tool output, probe results) in a
//   tag whose id is fresh random bytes, so content cannot close the envelope by guessing it. Any
//   closing-tag look-alike inside the text is neutralised, and invisible characters that hide text
//   from a human reviewer (Unicode tag characters, bidi controls, zero-width characters) are removed.
// - `SessionTaint` remembers, per case and caller, whether that caller has read untrusted content.
// - `decide` maps (effect, taint, rules) to allow / approve / deny.

import { randomBytes } from "node:crypto";
import type { Effect } from "../contracts.ts";

export interface EnvelopeResult {
  text: string;
  id: string;
  /** Closing or opening tag look-alikes rewritten inside the content. */
  neutralised: number;
  /** Unicode tag characters (U+E0000..U+E007F) removed. */
  tagChars: number;
  /** Bidi control characters removed. */
  bidi: number;
  /** Zero-width characters removed. */
  zeroWidth: number;
}

// Any spelling of an envelope tag: `<`, fullwidth or small less-than, HTML/JS escapes, optional `/`, any case.
const TAG_LOOKALIKE =
  /(?:[<\uFF1C\uFE64]|&lt;|&#0*60;|&#x0*3c;|\\u003c|\\x3c)\s*\/?\s*untrusted[\s_-]*content\b[^>\uFF1E\uFE65\n]{0,200}(?:[>\uFF1E\uFE65]|&gt;)?/giu;
const TAG_CHARS = /[\u{E0000}-\u{E007F}]/gu;
const BIDI = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/g;
const ZERO_WIDTH = /\u200B|\u200C|\u200D|\u2060|\uFEFF|\u180E/g;

function count(s: string, re: RegExp): number {
  re.lastIndex = 0;
  let n = 0;
  for (const _ of s.matchAll(re)) n++;
  return n;
}

function attr(s: string): string {
  return (
    s
      // biome-ignore lint/suspicious/noControlCharactersInRegex: escaping control characters is the point
      .replace(/[\u0000-\u001f\u007f"<>&]/g, (c) => `&#${c.charCodeAt(0)};`)
      .replace(TAG_CHARS, "")
      .replace(BIDI, "")
      .slice(0, 200)
  );
}

/** Remove hidden characters and neutralise envelope look-alikes, without wrapping. */
export function sanitizeUntrusted(text: string): Omit<EnvelopeResult, "id"> {
  const tagChars = count(text, TAG_CHARS);
  const bidi = count(text, BIDI);
  const zeroWidth = count(text, ZERO_WIDTH);
  let t = text.replace(TAG_CHARS, "").replace(BIDI, "").replace(ZERO_WIDTH, "");
  let neutralised = 0;
  t = t.replace(TAG_LOOKALIKE, (m) => {
    neutralised++;
    return `[neutralised tag: ${m.replace(/[<>\uFF1C\uFE64\uFF1E\uFE65]|&lt;|&gt;|&#0*60;|&#x0*3c;|\\u003c|\\x3c/gi, "")}]`;
  });
  return { text: t, neutralised, tagChars, bidi, zeroWidth };
}

export function newEnvelopeId(): string {
  return `u-${randomBytes(12).toString("hex")}`;
}

/** Wrap target-derived text. Each call uses a new random id. */
export function envelope(text: string, origin: string): EnvelopeResult {
  const id = newEnvelopeId();
  const s = sanitizeUntrusted(text);
  const notes: string[] = [];
  if (s.neutralised) notes.push(`tags-neutralised=${s.neutralised}`);
  if (s.tagChars) notes.push(`unicode-tag-chars-removed=${s.tagChars}`);
  if (s.bidi) notes.push(`bidi-controls-removed=${s.bidi}`);
  if (s.zeroWidth) notes.push(`zero-width-removed=${s.zeroWidth}`);
  const sanitized = notes.length ? ` sanitized="${notes.join(",")}"` : "";
  const wrapped = `<untrusted-content id="${id}" origin="${attr(origin)}"${sanitized}>\n${s.text}\n</untrusted-content id="${id}">`;
  return { ...s, text: wrapped, id };
}

/** Byte overhead of an envelope around empty text (for budgeting result sizes). */
export function envelopeOverhead(origin: string): number {
  return Buffer.byteLength(envelope("", origin).text) + 160;
}

// ---------------------------------------------------------------------------------------------
// Session taint
// ---------------------------------------------------------------------------------------------

export class SessionTaint {
  #sources = new Map<string, string[]>();

  static key(caseId: string, caller: string): string {
    return `${caseId}\u0000${caller}`;
  }

  /** Record that this caller has read untrusted content from `origin`. */
  mark(caseId: string, caller: string, origin: string): void {
    const k = SessionTaint.key(caseId, caller);
    const list = this.#sources.get(k) ?? [];
    if (list.length < 20 && !list.includes(origin)) list.push(origin);
    this.#sources.set(k, list);
  }

  isTainted(caseId: string, caller: string): boolean {
    return this.#sources.has(SessionTaint.key(caseId, caller));
  }

  sources(caseId: string, caller: string): string[] {
    return [...(this.#sources.get(SessionTaint.key(caseId, caller)) ?? [])];
  }

  /** Only for a brand-new provider session; taint is never cleared within one. */
  clear(caseId: string, caller: string): void {
    this.#sources.delete(SessionTaint.key(caseId, caller));
  }
}

// ---------------------------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------------------------

export type Decision = "allow" | "approve" | "deny";

export interface AutoRule {
  /** Tool name the rule covers, e.g. "assay_exec". */
  tool: string;
  /** "approve" (default) skips the approval prompt; "deny" refuses the tool outright. */
  action?: "approve" | "deny";
  /** Keep auto-approving after the caller has read untrusted content. Default false. */
  evenWhenTainted?: boolean;
}

export interface DecideInput {
  effect: Effect;
  /** Tool being called; needed to match auto rules. */
  tool?: string;
  tainted: boolean;
  mode: "enforced" | "open";
  /** Rules the person added for this case. */
  autoRules?: AutoRule[];
}

const EFFECTS: readonly Effect[] = ["none", "read", "write", "exec", "network", "spawn", "publish"];
const GATED: readonly Effect[] = ["write", "exec", "network", "publish"];

/** The decision with a human-readable reason. Both modes apply the same rules to Assay's own tools. */
export function explain(input: DecideInput): { decision: Decision; reason: string } {
  const rules = (input.autoRules ?? []).filter((r) => input.tool !== undefined && r.tool === input.tool);
  if (!EFFECTS.includes(input.effect)) return { decision: "deny", reason: `unknown effect ${String(input.effect)}` };
  if (rules.some((r) => r.action === "deny")) return { decision: "deny", reason: `the person blocked ${input.tool}` };
  if (input.effect === "none" || input.effect === "read")
    return { decision: "allow", reason: `effect ${input.effect}` };
  if (input.effect === "spawn") return { decision: "allow", reason: "effect spawn (the orchestrator enforces limits)" };
  if (!GATED.includes(input.effect)) return { decision: "deny", reason: `unknown effect ${input.effect}` };
  const auto = rules.filter((r) => (r.action ?? "approve") === "approve");
  if (input.tainted) {
    if (auto.some((r) => r.evenWhenTainted === true))
      return { decision: "allow", reason: `auto-approved (even when tainted) for ${input.tool}` };
    return { decision: "approve", reason: `effect ${input.effect}; session read untrusted content` };
  }
  if (auto.length > 0) return { decision: "allow", reason: `auto-approved for ${input.tool}` };
  return { decision: "approve", reason: `effect ${input.effect}` };
}

export function decide(input: DecideInput): Decision {
  return explain(input).decision;
}
