// The two ledgers that make "complete" a computed fact rather than a claim.
//
// - The limitation register: every known weakness of rea, leanrea, the donor projects whose code
//   or lessons reax inherits, and reax itself. Seeded mechanically from docs/profiles (never typed
//   in by hand) and kept one row per line in docs/ledger/limitations/*.jsonl.
// - The parity ledger: every capability reax must cover — each rea capability family and each of
//   rea's 229 tool names, every leanrea capability and trap, and reax's own infrastructure rows.
//   docs/ledger/parity/*.jsonl.
//
// Neither file holds a status. Status is computed by scripts/parity-check.ts from the JUnit reports
// of every CI lane: a row is covered only when tests tagged with its key passed — at least one
// positive ([+key]) and one negative or limit test ([-key]) — on every platform the row names.

export const CATEGORIES = [
  "context",
  "state",
  "correctness",
  "coverage",
  "scale",
  "security",
  "install",
  "errors",
  "tests",
  "governance",
  "enforcement",
  "question",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const PLATFORMS = ["linux", "darwin", "win32"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const SEVERITIES = ["blocks", "degrades", "cosmetic", "unrated"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Platforms a row defers, by a recorded decision, until a named item lifts the deferral (D-30,
 * D-33). `platforms` keeps the row's whole scope; the deferred ones are a non-empty proper subset of
 * it. A deferred row is never covered (or fixed) until it passes on every platform it lists,
 * deferred ones included; while only a deferred platform is missing it is reported as "tested,
 * partial (missing: ...)". */
export interface Deferral {
  platforms: Platform[];
  /** The decision that allows it, e.g. "D-30". */
  decision: string;
  /** The key of the ledger row whose item would lift it, e.g. "RX-SBX/windows-engines". */
  until: string;
}

/** Where a row came from: a profile section (seeded) or reax itself (written with the code). */
export interface SourceRef {
  /** e.g. "docs/profiles/rea.md" */
  file: string;
  /** The heading the row sits under, e.g. "### 9A." */
  section: string;
  /** The row's own key in that section, e.g. "A1.1", "#723", "P3", "3" */
  key: string;
}

export interface LimitationRow {
  id: string;
  subject: "rea" | "leanrea" | "pi-durable" | "absurd" | "orca" | "t3code" | "reax";
  category: Category;
  title: string;
  evidence: string;
  severity: Severity;
  kind: "design" | "accident" | "question" | "unknown";
  source: SourceRef;
  /** What reax does about it. Null until triaged. */
  fix: string | null;
  /** The phase whose gate requires this row fixed (or a reviewed wont). Null until triaged. */
  phase: number | null;
  platforms: Platform[];
  /** A reviewed decision not to fix, with its reason. */
  wont: { reason: string; reviewer: string } | null;
  /** Set by the seeder when the profile no longer contains the row; never deleted silently. */
  orphaned?: boolean;
  /** A triage caveat: an unconfirmed source, a row that may be a duplicate, a doubt about scope. */
  note?: string;
  /** Platforms deferred by a recorded decision (triage; kept on re-seed). */
  deferred?: Deferral;
}

export interface ParityRow {
  key: string;
  kind: "rea-family" | "rea-tool" | "rea-prompt" | "leanrea-capability" | "leanrea-trap" | "reax-infra";
  title: string;
  /** rea family (REA-Cnn) for tools; the leanrea group for leanrea rows. */
  family: string | null;
  /** Where reax covers it, once designed: a tool and operation name (operation may be null). */
  reax: { tool: string | null; operation: string | null; engine: string | null };
  phase: number | null;
  platforms: Platform[];
  wont: { reason: string; reviewer: string } | null;
  source: SourceRef | null;
  orphaned?: boolean;
  /** Platforms deferred by a recorded decision (triage; kept on re-seed). */
  deferred?: Deferral;
}

export type Status = "planned" | "partial" | "covered" | "regressed" | "wont";

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_.:/#-]{0,95}$/;
const DECISION_RE = /^D-\d{1,4}$/;

function fail(where: string, why: string): never {
  throw new Error(`ledger row ${where}: ${why}`);
}

export function validateLimitation(r: LimitationRow): void {
  const w = r.id ?? "(no id)";
  if (!KEY_RE.test(r.id)) fail(w, "id must be 1-96 characters of A-Z a-z 0-9 _ . : / # -");
  if (!CATEGORIES.includes(r.category)) fail(w, `category must be one of ${CATEGORIES.join("|")}`);
  if (!SEVERITIES.includes(r.severity)) fail(w, `severity must be one of ${SEVERITIES.join("|")}`);
  if (typeof r.title !== "string" || r.title.length < 3) fail(w, "title is required");
  if (r.phase !== null && !(Number.isInteger(r.phase) && r.phase >= 0 && r.phase <= 4)) fail(w, "phase is 0-4 or null");
  for (const p of r.platforms) if (!PLATFORMS.includes(p)) fail(w, `unknown platform ${p}`);
  if (r.wont && (!r.wont.reason || !r.wont.reviewer)) fail(w, "a wont needs a reason and a reviewer");
  validateDeferral(w, r);
}

export function validateParity(r: ParityRow): void {
  const w = r.key ?? "(no key)";
  if (!KEY_RE.test(r.key)) fail(w, "key must be 1-96 characters of A-Z a-z 0-9 _ . : / # -");
  if (typeof r.title !== "string" || r.title.length < 2) fail(w, "title is required");
  if (r.phase !== null && !(Number.isInteger(r.phase) && r.phase >= 0 && r.phase <= 4)) fail(w, "phase is 0-4 or null");
  for (const p of r.platforms) if (!PLATFORMS.includes(p)) fail(w, `unknown platform ${p}`);
  if (r.wont && (!r.wont.reason || !r.wont.reviewer)) fail(w, "a wont needs a reason and a reviewer");
  validateDeferral(w, r);
}

/** The deferral's own shape; that `until` names a row is checked by the loader, which sees every row. */
function validateDeferral(w: string, r: { platforms: Platform[]; wont: unknown; deferred?: Deferral }): void {
  const d = r.deferred;
  if (d === undefined) return;
  if (d === null || typeof d !== "object" || !Array.isArray(d.platforms))
    fail(w, "deferred needs platforms, decision and until");
  if (r.wont) fail(w, "a row with a wont cannot also defer platforms");
  if (!d.platforms.length) fail(w, "deferred.platforms is empty");
  for (const p of d.platforms) {
    if (!PLATFORMS.includes(p)) fail(w, `deferred: unknown platform ${p}`);
    if (!r.platforms.includes(p)) fail(w, `deferred: ${p} is not one of the row's platforms`);
  }
  if (new Set(d.platforms).size !== d.platforms.length) fail(w, "deferred: a platform is listed twice");
  if (r.platforms.every((p) => d.platforms.includes(p))) fail(w, "deferred: every platform is deferred");
  if (typeof d.decision !== "string" || !DECISION_RE.test(d.decision))
    fail(w, "deferred.decision must be a decision id such as D-30");
  if (typeof d.until !== "string" || !KEY_RE.test(d.until)) fail(w, "deferred.until must be a ledger key");
}
