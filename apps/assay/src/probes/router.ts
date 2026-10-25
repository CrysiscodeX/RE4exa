// The artifact router: which built-in probes and which external tools fit a target.
//
// Credit: the routing table, its traps and its rules are adapted from aicodeking/leanrea
// (https://github.com/aicodeking/leanrea, MIT License, Copyright (c) 2026 AICodeKing), commit
// 09ba4aa, leanrea/SKILL.md lines 38-55. Assay keeps the table as data in router-pack.json; each
// row cites the SKILL.md line it came from.
//
// External tools run only through ProbeContext.exec (argv, no shell, bounded time and output),
// only when the program is on PATH and the platform matches. Otherwise the sweep lists them under
// notExamined with reason "tool missing": a missing tool never produces a silently wrong answer.

import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { Json } from "../evidence/jcs.ts";
import { type AssayProbe, basenameOf, fail } from "./util.ts";

export type Platform = "linux" | "darwin" | "win32";

export interface ExternalTool {
  id: string;
  program: string;
  args: string[];
  platforms: Platform[];
  fallback: string;
  outputCap: number;
}

export interface RouterRow {
  id: string;
  target: string;
  detect: { formats: string[]; names: string[]; markers: string[] };
  probes: string[];
  external: ExternalTool[];
  consent: "none" | "approval";
  traps: string[];
  source: string;
}

export interface RouterPack {
  version: string;
  rows: RouterRow[];
}

let cached: RouterPack | null = null;

export function loadRouterPack(): RouterPack {
  if (!cached) {
    const raw = JSON.parse(readFileSync(new URL("./router-pack.json", import.meta.url), "utf8")) as RouterPack;
    const errors = validatePack(raw);
    if (errors.length) throw new Error(`router-pack.json is invalid: ${errors.join("; ")}`);
    cached = raw;
  }
  return cached;
}

export function validatePack(p: RouterPack, builtinIds?: Set<string>): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  if (!Array.isArray(p.rows)) return ["rows must be an array"];
  for (const r of p.rows) {
    if (typeof r.id !== "string" || ids.has(r.id)) errs.push(`row id ${r.id} missing or duplicated`);
    ids.add(r.id);
    if (!/^leanrea@09ba4aa SKILL\.md:\d+$/.test(r.source))
      errs.push(`${r.id}: source must cite leanrea SKILL.md:<line>`);
    if (r.consent !== "none" && r.consent !== "approval") errs.push(`${r.id}: consent`);
    for (const pr of r.probes) if (builtinIds && !builtinIds.has(pr)) errs.push(`${r.id}: unknown probe ${pr}`);
    for (const e of r.external) {
      if (!e.program || !Array.isArray(e.args) || !Array.isArray(e.platforms)) errs.push(`${r.id}/${e.id}: shape`);
      if (!(e.outputCap > 0)) errs.push(`${r.id}/${e.id}: outputCap`);
      if (typeof e.fallback !== "string" || !e.fallback) errs.push(`${r.id}/${e.id}: fallback required`);
    }
  }
  return errs;
}

function globMatch(glob: string, name: string): boolean {
  const re = new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i");
  return re.test(name);
}

/**
 * Rows whose detect clause matches. A format match is required; markers (from the format probes)
 * must match when the row lists any; names must match when the format is "unknown" or when the
 * row lists only exact names (e.g. libapp.so). Otherwise names are hints.
 */
export function matchRows(
  ident: { format: string; name?: string; markers?: string[] },
  pack = loadRouterPack(),
): RouterRow[] {
  const name = ident.name ? basenameOf(ident.name) : "";
  return pack.rows.filter((r) => {
    const d = r.detect;
    if (!d.formats.includes(ident.format)) return false;
    if (d.markers.length > 0 && !d.markers.some((m) => ident.markers?.includes(m))) return false;
    const exactOnly = d.names.length > 0 && d.names.every((n) => !n.includes("*"));
    if (ident.format === "unknown" || exactOnly) return d.names.some((n) => globMatch(n, name));
    return true;
  });
}

/** Locate a program on PATH (PATHEXT on Windows). */
export function which(
  program: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
): string | null {
  if (program.includes("/") || program.includes("\\")) return null;
  const exts = platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").map((e) => e.toLowerCase()) : [""];
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = join(dir, program + ext);
      try {
        if (!statSync(p).isFile()) continue;
        if (platform !== "win32") accessSync(p, constants.X_OK);
        return p;
      } catch {
        // not here
      }
    }
  }
  return null;
}

export function externalProbeId(row: RouterRow, tool: ExternalTool): string {
  return `ext.${row.id}.${tool.id}`;
}

/** External tools a probe can run on a file: only {path} placeholders. */
export function runnableOnFile(tool: ExternalTool): boolean {
  return tool.args.every((a) => !/\{(?!path\})[a-z]+\}/.test(a));
}

export interface ToolStatus {
  row: RouterRow;
  tool: ExternalTool;
  probeId: string;
  available: boolean;
  reason: string;
}

export function toolStatus(
  row: RouterRow,
  tool: ExternalTool,
  platform: Platform,
  lookup: (p: string) => string | null = (p) => which(p),
): ToolStatus {
  const probeId = externalProbeId(row, tool);
  if (!tool.platforms.includes(platform))
    return {
      row,
      tool,
      probeId,
      available: false,
      reason: `tool missing (${tool.program} runs on ${tool.platforms.join(", ")})`,
    };
  if (!lookup(tool.program)) return { row, tool, probeId, available: false, reason: "tool missing" };
  if (!runnableOnFile(tool))
    return { row, tool, probeId, available: false, reason: "needs an input other than the file (not run by probes)" };
  return { row, tool, probeId, available: true, reason: "available" };
}

/** Probe definitions for every external tool that takes only the file path. */
export function externalProbes(pack = loadRouterPack()): AssayProbe[] {
  const out: AssayProbe[] = [];
  for (const row of pack.rows)
    for (const tool of row.external) {
      if (!runnableOnFile(tool)) continue;
      out.push({
        id: externalProbeId(row, tool),
        version: "1",
        predicate: `ext.${row.id}`,
        summary: `${tool.program} ${tool.args.join(" ")} (${row.target}; consent ${row.consent})`,
        appliesTo: (i) => row.detect.formats.includes(i.format),
        platforms: tool.platforms,
        requires: [tool.program],
        cost: "medium",
        confidence: "observed",
        sweep: [],
        async run(ctx) {
          if (ctx.subject.kind !== "file") fail("external tools run on files");
          const args = tool.args.map((a) => a.replaceAll("{path}", ctx.subject.abs));
          const r = await ctx.exec(tool.program, args, { timeoutMs: 30_000, maxOutputBytes: tool.outputCap });
          const scrub = (s: string) => s.split(ctx.subject.abs).join("{path}");
          const result: Json = {
            program: tool.program,
            args: tool.args,
            code: r.code,
            stdout: scrub(r.stdout),
            stderr: scrub(r.stderr).slice(0, 4096),
            timedOut: r.timedOut,
            truncated: r.truncated,
          };
          return {
            result,
            limitations: [
              `output of ${tool.program} on this host; tool versions differ between hosts`,
              ...(r.truncated ? [`output capped at ${tool.outputCap} bytes`] : []),
              ...(r.timedOut ? ["the tool timed out"] : []),
            ],
          };
        },
      });
    }
  return out;
}

/** Traps worth telling an agent about for this format. */
export function trapsFor(ident: {
  format: string;
  name?: string;
  markers?: string[];
}): { row: string; trap: string }[] {
  return matchRows(ident).flatMap((r) => r.traps.map((trap) => ({ row: r.id, trap })));
}
