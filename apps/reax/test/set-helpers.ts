// Shared by the SET tests (setup, uninstall, doctor). Everything runs against temporary homes: this
// module points this process's own HOME and USERPROFILE at a fresh temporary directory on load, so
// nothing in the test process can reach the real home, and every home it hands out is checked to
// be under the OS's temporary directory before anything is written. Its canonical form is written
// here, independently of src/setup, to compare with the Python key (bench/oracle/set.json).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

export const REAX = join(import.meta.dirname, "..");
export const FIXTURES = join(REAX, "fixtures", "set");
export const CLI = join(REAX, "src", "cli.ts");

const TMP = realpathSync(tmpdir());

/** Throws unless `dir` is strictly inside the OS's temporary directory. */
export function assertTemp(dir: string): void {
  const real = realpathSync(dir);
  assert.ok(real.startsWith(TMP + sep) && real.length > TMP.length + 1, `refusing to run: ${real} is not under ${TMP}`);
}

const MADE: string[] = [];
const OWN_HOME = mkdtempSync(join(TMP, "reax-set-process-"));
assertTemp(OWN_HOME);
MADE.push(OWN_HOME);
// only the directories made here, each checked to be under the temporary directory when made
process.on("exit", () => {
  for (const d of MADE) rmSync(d, { recursive: true, force: true });
});
process.env.HOME = OWN_HOME;
process.env.USERPROFILE = OWN_HOME;
process.env.REAX_HOME = join(OWN_HOME, "reax-home");

export interface TempHome {
  home: string;
  reaxHome: string;
  config: string;
  env: Record<string, string>;
}

/** A fresh temporary home, its reax home inside it, and the environment naming both. */
export function tempHome(): TempHome {
  const home = mkdtempSync(join(TMP, "reax-set-"));
  assertTemp(home);
  MADE.push(home);
  const reaxHome = join(home, "reax-home");
  return {
    home,
    reaxHome,
    config: join(home, ".claude.json"),
    env: { HOME: home, USERPROFILE: home, REAX_HOME: reaxHome },
  };
}

/** The environment for a child process: PATH and the temporary home only. */
export function childEnv(t: TempHome): Record<string, string> {
  return { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", ...t.env };
}

export function sha256(b: Uint8Array): string {
  return createHash("sha256").update(b).digest("hex");
}

export interface KeyRow {
  verdict: string;
  sha256: string;
  after?: string;
}

export const KEY = JSON.parse(readFileSync(join(REAX, "bench", "oracle", "set.json"), "utf8")) as {
  entry: Record<string, unknown>;
  files: Record<string, KeyRow>;
};

/** Python's json.dumps escaping (ensure_ascii): JSON.stringify's, plus every char outside 0x20-0x7e. */
function str(s: string): string {
  return JSON.stringify(s).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** Python's sorted() on str: by code point. */
function byCodePoint(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/** The key's canonical dump: sorted keys, no spaces, ASCII escapes, numbers as JavaScript prints them. */
export function canonical(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (typeof v === "string") return str(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort(byCodePoint)
    .map((k) => `${str(k)}:${canonical(o[k])}`)
    .join(",")}}`;
}

/** Every path under `dir`, relative, sorted: what a run created or removed. */
export function tree(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[]).map((p) => p.replaceAll("\\", "/")).sort();
}
