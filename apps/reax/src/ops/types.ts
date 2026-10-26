// The operation registry's types. Every capability reax exposes is one Operation: the MCP tool
// list, the CLI, docs/operations.md and the ledger mapping are all generated from these records,
// so they cannot drift apart (plan §3.4).

import type { Platform } from "../ledger/schema.ts";

/** The tools an agent sees; each takes an `operation`. Mutating operations live in their own
 * tools, so read tools can honestly be marked read-only. */
export const TOOLS = [
  "identify",
  "inventory",
  "read",
  "extract",
  "analyze",
  "compare",
  "evidence",
  "evidence_admin",
  "unknown",
  "unknown_write",
  "verify",
  "fetch",
  "doctor",
  "session",
  "annotate",
  "observe",
] as const;
export type Tool = (typeof TOOLS)[number];

export type JsonSchema = {
  type?: "object" | "string" | "integer" | "number" | "boolean" | "array";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: false;
  enum?: (string | number)[];
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  default?: unknown;
};

export interface OpContext {
  /** Absolute workspace directory; every path argument is resolved inside it. */
  workspace: string;
}

export interface OpResult {
  /** Structured result. */
  data: unknown;
  /** A compact text rendering for a model; target-derived text is marked untrusted by the caller. */
  text: string;
  /** complete: nothing truncated or unresolved within the stated scope; partial: see limitations. */
  coverage: "complete" | "partial";
  limitations: string[];
}

export interface Example {
  title: string;
  args: Record<string, unknown>;
  /** A fixture-relative workspace (apps/reax/fixtures/bin) the example runs against. */
  workspace: "fixtures";
  /** Values the result's data must contain (a deep subset match); checked as a doctest. */
  expect: Record<string, unknown>;
}

export interface Operation {
  tool: Tool;
  /** Unique across all tools, e.g. "inventory.native". */
  name: string;
  summary: string;
  input: JsonSchema & { type: "object" };
  effect: "read" | "write" | "exec" | "network";
  cost: "cheap" | "medium" | "deep";
  /** The result carries text taken from the target (strings, names), which must reach a model
   * only inside the untrusted-content envelope. */
  untrusted: boolean;
  platforms: Platform[];
  examples: Example[];
  /** Ledger keys (parity rows) this operation is the reax side of. */
  covers: string[];
  run(ctx: OpContext, args: Record<string, unknown>): Promise<OpResult>;
}
