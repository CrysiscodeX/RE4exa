// Small helpers shared by the provider adapters: finding programs, building child environments,
// and the MCP configuration shapes each client expects.
//
// Rule for every adapter: Assay drives the person's own agent client through its official CLI, SDK
// or protocol. It never reads a client's credential store, never copies or refreshes tokens and never
// injects credentials. A separate-home account only points the client at its own config directory and
// removes ambient key variables, so that home's own sign-in is the one used.

import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import type { Json } from "@re4exa/core/evidence/jcs";
import { runProcess } from "@re4exa/core/vendor/orca-process-host/run-process";

export const ASSAY_CLIENT_NAME = "assay";
export const ASSAY_VERSION = "0.1.0";

/** Ambient variables that would override a separate home's own sign-in for the Claude client. */
export const CLAUDE_KEY_VARS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_OAUTH_TOKEN",
] as const;

/** Ambient variables that would override a separate home's own sign-in for the Codex client. */
export const CODEX_KEY_VARS = ["OPENAI_API_KEY", "CODEX_API_KEY"] as const;

/** Copy of an environment with undefined values dropped. */
export function plainEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === "string") out[k] = v;
  return out;
}

/**
 * The environment for an account's client process.
 * - home set: `homeVar=home`, and every variable in `strip` removed (the home's own login wins).
 * - home null (the person's default account): the environment passes through unchanged.
 */
export function accountEnv(
  home: string | null,
  homeVar: string | null,
  strip: readonly string[],
  base: NodeJS.ProcessEnv = process.env,
  extra: Record<string, string> = {},
): Record<string, string> {
  const env = plainEnv(base);
  if (home !== null) {
    for (const k of strip) delete env[k];
    if (homeVar) env[homeVar] = home;
  }
  return { ...env, ...extra };
}

/** Find a program on PATH (or check an absolute path). Returns the absolute path or null. */
export function which(program: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const exts = process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  const ok = (p: string): boolean => {
    try {
      if (!statSync(p).isFile()) return false;
      if (process.platform !== "win32") accessSync(p, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  if (isAbsolute(program) || program.includes("/")) return ok(program) ? program : null;
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = join(dir, program + ext);
      if (ok(p)) return p;
    }
  }
  return null;
}

/** Run `<program> --version` (or other args) and return the first version-looking token. */
export async function programVersion(
  program: string,
  args: string[] = ["--version"],
  env?: Record<string, string>,
): Promise<string | null> {
  try {
    const r = await runProcess({ program, args, env, timeoutMs: 15_000, maxOutputBytes: 64 * 1024 });
    const text = `${r.stdout}\n${r.stderr}`;
    const m = /\d+\.\d+\.\d+[\w.+-]*/.exec(text);
    return m ? m[0] : text.trim().split("\n")[0] || null;
  } catch {
    return null;
  }
}

/** Coerce an unknown value into Json (drops functions, undefined, cycles). */
export function toJson(v: unknown, depth = 0): Json {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (depth > 20) return null;
  if (Array.isArray(v)) return v.map((x) => toJson(x, depth + 1));
  if (typeof v === "object") {
    const out: Record<string, Json> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (x === undefined || typeof x === "function") continue;
      out[k] = toJson(x, depth + 1);
    }
    return out;
  }
  return null;
}

/** One-line summary of a tool result for the timeline. */
export function summarize(v: unknown, max = 300): string {
  let s: string;
  if (typeof v === "string") s = v;
  else if (Array.isArray(v))
    s = v
      .map((x) =>
        x && typeof x === "object" && "text" in x ? String((x as { text: unknown }).text) : JSON.stringify(x),
      )
      .join(" ");
  else s = JSON.stringify(v) ?? "";
  s = s.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** A promise with its resolvers exposed. */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve(v: T): void;
  reject(e: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

/** Rough token estimate for clients that do not report usage (4 characters per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
