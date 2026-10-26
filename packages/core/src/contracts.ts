// Contracts shared by the subsystems. Changing a type here changes every subsystem; keep it small.

import type { Json } from "./evidence/jcs.ts";
import type { ClaimRecord, Coverage, Finding } from "./evidence/record.ts";

// ---------------------------------------------------------------------------------------------
// Probes (src/probes): model-free, deterministic readers. A probe never changes the world.
// ---------------------------------------------------------------------------------------------

export interface ProbeSubject {
  /** Workspace-relative path; the engine resolves and guards it. */
  path: string;
  /** Absolute path, already checked to be inside the workspace. */
  abs: string;
  /** sha256:<hex> of the file's bytes (for directories: of the sorted listing of child digests). */
  digest: string;
  size: number;
  kind: "file" | "directory";
}

export interface ProbeContext {
  subject: ProbeSubject;
  params: Json;
  /** Read up to `max` bytes from the subject (or a path inside a directory subject). */
  read(relPath?: string, max?: number): Promise<Uint8Array>;
  /** Run an external tool: argv only, no shell, bounded time and output (vendored Orca process-host). */
  exec(
    program: string,
    args: string[],
    opts?: { timeoutMs?: number; maxOutputBytes?: number },
  ): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean; truncated: boolean }>;
  /** Abort when the case is cancelled. */
  signal: AbortSignal;
}

export interface ProbeOutput {
  result: Json;
  coverage?: Coverage | null;
  limitations?: string[];
  findings?: Finding[];
  /** Not hashed: timings, tool versions. */
  volatile?: Json;
  locator?: { offset?: number; symbol?: string };
}

export interface ProbeDef {
  id: string;
  version: string;
  /** The predicate recorded in evidence, e.g. "file.identify", "pkg.manifest", "elf.imports". */
  predicate: string;
  summary: string;
  /** Which subjects it applies to, decided from the cheap identification result. */
  appliesTo(ident: { format: string; kind: "file" | "directory" }): boolean;
  /** Platforms where it runs; the reach table records the rest as not covered. */
  platforms: ("linux" | "darwin" | "win32")[];
  /** External programs it needs; missing ones make it unavailable, never silently wrong. */
  requires?: string[];
  cost: "cheap" | "medium" | "heavy";
  run(ctx: ProbeContext): Promise<ProbeOutput>;
}

export interface ProbeEngine {
  list(): ProbeDef[];
  /** Run one probe on a subject; returns the stored evidence record (reuses it when the ProbeKey already exists). */
  run(input: {
    caseId: string | null;
    probeId: string;
    path: string;
    params?: Json;
    producerId?: string;
  }): Promise<ClaimRecord>;
  /** Identify a subject and run every cheap applicable probe (the model-free first pass). */
  sweep(input: { caseId: string | null; path: string; depth?: number; budgetMs?: number }): Promise<SweepReport>;
}

export interface SweepReport {
  subject: string;
  evidence: string[];
  findings: (Finding & { observation_id: string })[];
  /** Questions the sweep could not close; each becomes an Unknown. */
  questions: string[];
  notExamined: { what: string; reason: string }[];
  elapsedMs: number;
}

// ---------------------------------------------------------------------------------------------
// Tools exposed to agents over MCP (src/mcp). Policy decides by `effect`.
// ---------------------------------------------------------------------------------------------

export type Effect = "none" | "read" | "write" | "exec" | "network" | "spawn" | "publish";

export interface ToolContext {
  caseId: string;
  /** "coordinator" or the worker id that is calling. */
  caller: string;
  workspace: string;
  /** Resolves when the person approves; rejects with approval_denied. Policy calls this, tools need not. */
  approve(action: string, detail: Json): Promise<void>;
  signal: AbortSignal;
}

export interface ToolResult {
  /** Short text for the model. Keep under ~8 KB; put bulk behind a handle. */
  text: string;
  /** Machine-readable payload (also returned as MCP structuredContent). */
  data?: Json;
  /** Handle the model can pass to `assay_fetch` for the full payload. */
  handle?: string;
  /** True when the text came from the target (file contents, tool output): it is wrapped as untrusted. */
  untrusted?: boolean;
  isError?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Json;
  effect: Effect;
  /** Only the coordinator may call it (worker management). */
  coordinatorOnly?: boolean;
  handler(ctx: ToolContext, args: Record<string, Json>): Promise<ToolResult>;
}
