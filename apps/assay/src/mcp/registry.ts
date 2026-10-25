// The tool registry: the one place where agent tool calls meet policy.
//
// call(ctx, name, args):
//   1. the tool must exist and be visible to the caller (workers never see coordinatorOnly tools);
//   2. arguments are checked against the tool's input schema;
//   3. `explain` decides from the effect, the caller's taint and the case's auto rules;
//      "approve" waits on ctx.approve(name, {reason, ...}); "deny" fails with approval_denied;
//   4. the handler runs; untrusted text is redacted, budgeted (bulk goes behind a handle), wrapped
//      in a fresh envelope, and the caller is marked tainted;
//   5. any failure becomes an isError result carrying the AssayError JSON (code, message, fix).

import type { Effect, ProbeEngine, ToolContext, ToolDef, ToolResult } from "../contracts.ts";
import { AssayError, isAssayError } from "../errors.ts";
import type { Json } from "../evidence/jcs.ts";
import type { Kernel } from "../kernel/kernel.ts";
import type { ApprovalQueue } from "../policy/approvals.ts";
import { redact, redactString } from "../policy/redact.ts";
import { type AutoRule, envelope, envelopeOverhead, explain, SessionTaint } from "../policy/taint.ts";
import type { ProcessResult, ProcessSpec } from "../vendor/orca-process-host/process-spec.ts";
import { HandleStore } from "./handles.ts";
import { builtinTools, type HandlerResult, LIMITS, type Verifier } from "./tools.ts";

export interface RegistryServices {
  kernel: Kernel;
  engine: ProbeEngine;
  /** Supplies the case's auto rules; requests themselves go through ctx.approve. */
  approvals: Pick<ApprovalQueue, "rules"> | ApprovalQueue;
  verifier?: Verifier | undefined;
  /** Default workspace root when a ToolContext carries none. */
  workspace: string;
  extraTools?: ToolDef[];
  handles?: HandleStore;
  taint?: SessionTaint;
  mode?: "enforced" | "open";
  runProcess?: (spec: ProcessSpec) => Promise<ProcessResult>;
}

export interface ToolRegistry {
  readonly services: RegistryServices;
  readonly taint: SessionTaint;
  readonly handles: HandleStore;
  /** Every registered tool. */
  readonly tools: readonly ToolDef[];
  get(name: string): ToolDef | undefined;
  /** Tools this caller may see. */
  list(caller: string): ToolDef[];
  /** Whether this caller may call the tool at all. */
  visible(caller: string, name: string): boolean;
  call(ctx: ToolContext, name: string, args: Record<string, Json> | undefined): Promise<ToolResult>;
}

// ---------------------------------------------------------------------------------------------
// Minimal JSON-schema check for tool arguments (the subset the built-in schemas use).
// ---------------------------------------------------------------------------------------------

type Schema = { [k: string]: Json };

function typeOk(t: string, v: Json): boolean {
  switch (t) {
    case "string":
      return typeof v === "string";
    case "integer":
      return typeof v === "number" && Number.isInteger(v);
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "boolean":
      return typeof v === "boolean";
    case "array":
      return Array.isArray(v);
    case "object":
      return v !== null && typeof v === "object" && !Array.isArray(v);
    case "null":
      return v === null;
    default:
      return true;
  }
}

export function checkArgs(schema: Json, v: Json, path = ""): string | null {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) return null;
  const sc = schema as Schema;
  const where = path || "arguments";
  if (typeof sc.type === "string" && !typeOk(sc.type, v)) return `${where} must be ${sc.type}`;
  if (Array.isArray(sc.enum) && !sc.enum.some((e) => e === v)) return `${where} must be one of ${sc.enum.join("|")}`;
  if (typeof v === "string") {
    if (typeof sc.maxLength === "number" && v.length > sc.maxLength) return `${where} is longer than ${sc.maxLength}`;
  }
  if (typeof v === "number") {
    if (typeof sc.minimum === "number" && v < sc.minimum) return `${where} must be >= ${sc.minimum}`;
    if (typeof sc.maximum === "number" && v > sc.maximum) return `${where} must be <= ${sc.maximum}`;
  }
  if (Array.isArray(v)) {
    if (typeof sc.maxItems === "number" && v.length > sc.maxItems) return `${where} has more than ${sc.maxItems} items`;
    if (sc.items) {
      for (let i = 0; i < v.length; i++) {
        const e = checkArgs(sc.items, v[i]!, `${where}[${i}]`);
        if (e) return e;
      }
    }
  }
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    const props = (sc.properties ?? {}) as Schema;
    for (const r of (sc.required as string[] | undefined) ?? [])
      if (!(r in v) || v[r] === undefined) return `${path ? `${path}.` : ""}${r} is required`;
    for (const [key, val] of Object.entries(v)) {
      if (val === undefined) continue;
      const ps = props[key];
      if (ps === undefined) {
        if (sc.additionalProperties === false) return `unknown argument ${path ? `${path}.` : ""}${key}`;
        continue;
      }
      const e = checkArgs(ps, val, path ? `${path}.${key}` : key);
      if (e) return e;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Result shaping
// ---------------------------------------------------------------------------------------------

function cutBytes(s: string, max: number): string {
  if (Buffer.byteLength(s) <= max) return s;
  let lo = 0;
  let hi = Math.min(s.length, max);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (Buffer.byteLength(s.slice(0, mid)) <= max) lo = mid;
    else hi = mid - 1;
  }
  let out = s.slice(0, lo);
  if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);
  return out;
}

export function errorResult(e: unknown): ToolResult {
  const err = isAssayError(e)
    ? e
    : new AssayError("tool_failed", { error: String((e as Error)?.message ?? e) }, undefined);
  const body = redact(err.toJSON() as Json).value;
  return { text: cutBytes(JSON.stringify(body), LIMITS.resultTextBytes), data: body, isError: true };
}

function summarizeArgs(args: Record<string, Json>): Json {
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string" && v.length > 2000) out[k] = `${v.slice(0, 2000)}... (${v.length} chars)`;
    else out[k] = v;
  }
  return redact(out).value;
}

export function createToolRegistry(services: RegistryServices): ToolRegistry {
  const handles = services.handles ?? new HandleStore();
  const taint = services.taint ?? new SessionTaint();
  const all = [
    ...builtinTools({
      kernel: services.kernel,
      engine: services.engine,
      verifier: services.verifier,
      workspace: services.workspace,
      handles,
      runProcess: services.runProcess,
    }),
    ...(services.extraTools ?? []),
  ];
  const byName = new Map<string, ToolDef>();
  for (const t of all) {
    if (byName.has(t.name)) throw new Error(`duplicate tool ${t.name}`);
    byName.set(t.name, t);
  }

  const visible = (caller: string, name: string): boolean => {
    const t = byName.get(name);
    return !!t && (!t.coordinatorOnly || caller === "coordinator");
  };

  function shape(ctx: ToolContext, tool: ToolDef, r: HandlerResult): ToolResult {
    const untrusted = r.untrusted === true;
    const origin = r.origin ?? tool.name;
    let text = r.text ?? "";
    let redactions = 0;
    if (untrusted) {
      const red = redactString(text);
      text = red.text;
      redactions = red.redactions.length;
    }
    const notes: string[] = [];
    if (r.note) notes.push(r.note);
    if (redactions) notes.push(`[assay: ${redactions} secret(s) redacted]`);
    let handle = r.handle;
    const reserve = (untrusted ? envelopeOverhead(origin) : 0) + Buffer.byteLength(notes.join("\n")) + 400;
    const budget = Math.max(512, LIMITS.resultTextBytes - reserve);
    if (Buffer.byteLength(text) > budget) {
      handle = handles.put(ctx.caseId, text, { untrusted, origin });
      const preview = cutBytes(text, budget);
      notes.push(
        `[assay: showing ${preview.length} of ${text.length} chars; the rest is behind a handle: assay_fetch {"handle":"${handle}","offset":${preview.length}}]`,
      );
      text = preview;
    }
    if (untrusted) {
      text = envelope(text, origin).text;
      taint.mark(ctx.caseId, ctx.caller, origin);
    }
    let data = r.data;
    if (data !== undefined) {
      const dj = JSON.stringify(data);
      if (Buffer.byteLength(dj) > LIMITS.dataBytes) {
        const h = handles.put(ctx.caseId, dj, { untrusted, origin: `${origin}:data` });
        data = { truncated: true, dataHandle: h };
      }
    }
    if (handle && data !== null && typeof data === "object" && !Array.isArray(data)) data = { ...data, handle };
    else if (handle && data === undefined) data = { handle };
    const full = cutBytes([text, ...notes].join("\n"), LIMITS.resultTextBytes);
    const out: ToolResult = { text: full };
    if (data !== undefined) out.data = data;
    if (handle) out.handle = handle;
    if (untrusted) out.untrusted = true;
    if (r.isError) out.isError = true;
    return out;
  }

  async function call(ctx: ToolContext, name: string, args: Record<string, Json> | undefined): Promise<ToolResult> {
    try {
      const tool = byName.get(name);
      if (!tool) throw new AssayError("not_found", { tool: name });
      if (!visible(ctx.caller, name)) throw new AssayError("tool_not_permitted", { tool: name, caller: ctx.caller });
      const a = args ?? {};
      const bad = checkArgs(tool.inputSchema, a as Json);
      if (bad) throw new AssayError("bad_request", { tool: name, why: bad });
      const tainted = taint.isTainted(ctx.caseId, ctx.caller);
      let rules: AutoRule[] = [];
      try {
        rules = services.approvals.rules(ctx.caseId);
      } catch {
        rules = [];
      }
      const { decision, reason } = explain({
        effect: tool.effect as Effect,
        tool: name,
        tainted,
        mode: services.mode ?? "enforced",
        autoRules: rules,
      });
      if (decision === "deny") throw new AssayError("approval_denied", { tool: name, reason });
      if (decision === "approve") {
        const sources = taint.sources(ctx.caseId, ctx.caller);
        const why = tainted ? `${reason} (${sources.slice(0, 3).join(", ")})` : reason;
        await ctx.approve(name, {
          tool: name,
          effect: tool.effect,
          reason: why,
          tainted,
          untrustedSources: sources,
          args: summarizeArgs(a),
        });
      }
      if (ctx.signal.aborted) throw new AssayError("approval_expired", { why: "aborted" });
      const r = (await tool.handler(ctx, a)) as HandlerResult;
      return shape(ctx, tool, r);
    } catch (e) {
      return errorResult(e);
    }
  }

  return {
    services,
    taint,
    handles,
    tools: all,
    get: (name) => byName.get(name),
    list: (caller) => all.filter((t) => visible(caller, t.name)),
    visible,
    call,
  };
}
