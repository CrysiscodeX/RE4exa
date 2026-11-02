// The LLVM provider: llvm-nm (LLVM 18 or later) on a target, inside the sandbox.
// Discovery order (D-22): the directory in REAX_LLVM_BIN, then PATH (llvm-nm-18, then llvm-nm), then
// the fixed directories below. Nothing is installed: a missing LLVM gives engine_unavailable with the
// install line for this platform as its remediation.
// The run: `llvm-nm -P --defined-only [--arch=<a>] <absolute target>`, argv[0] the resolved real path,
// through runSandboxed with required: true. -P is POSIX output, one symbol per line:
// "name type value size". llvm-nm takes no "--", so the target must be an absolute path (it then
// cannot be read as an option).
import { isAbsolute, join } from "node:path";
import { CoreError } from "@re4exa/core/errors";
import "../errors.ts";
import type { EngineProvider } from "./contract.ts";
import { type CommandEngineSpec, commandEngine, onPath } from "./run.ts";

export const LLVM_MIN_MAJOR = 18;
/** 32 MiB per stream: llvm-nm on a large binary lists many symbols. */
export const LLVM_NM_MAX_OUTPUT = 32 * 1024 * 1024;
export const LLVM_DIRS = [
  "/usr/lib/llvm-18/bin",
  "/opt/homebrew/opt/llvm@18/bin",
  "/usr/local/opt/llvm@18/bin",
  "C:\\Program Files\\LLVM\\bin",
];
const MAX_TARGET_CHARS = 4096;

export interface NmRequest {
  /** The target file, as an absolute path. */
  target: string;
  /** For a universal Mach-O: which architecture, in LLVM's spelling (arm64, x86_64). */
  arch?: string;
}

export interface NmSymbol {
  name: string;
  /** llvm-nm's type letter (T, D, B, R, W, ...). */
  type: string;
  addr: string;
  size: number | null;
}

const exe = (name: string) => (process.platform === "win32" ? `${name}.exe` : name);

/** Where llvm-nm may be, in discovery order. */
export function llvmCandidates(env = process.env): string[] {
  const out: string[] = [];
  if (env.REAX_LLVM_BIN) out.push(join(env.REAX_LLVM_BIN, exe("llvm-nm")));
  out.push(...onPath("llvm-nm-18", env.PATH), ...onPath("llvm-nm", env.PATH));
  out.push(...LLVM_DIRS.map((d) => join(d, exe("llvm-nm"))));
  return out;
}

/** The install line for this platform. reax never runs it. */
export function llvmRemediation(platform = process.platform): string {
  const line =
    platform === "darwin"
      ? "brew install llvm@18"
      : platform === "win32"
        ? "winget install LLVM.LLVM"
        : "sudo apt-get install llvm-18 (Debian, Ubuntu)";
  return `Install LLVM ${LLVM_MIN_MAJOR} or later: ${line}. Or set REAX_LLVM_BIN to a directory holding llvm-nm.`;
}

/** "LLVM version 18.1.8" anywhere in --version output (vendors prefix it: Homebrew, Ubuntu). */
export function llvmVersion(out: string): string | null {
  return /\bLLVM version (\d+\.\d+\.\d+)/.exec(out)?.[1] ?? null;
}

const LINE = /^(.+) ([A-Za-z?-]) ([0-9a-f]+)(?: ([0-9a-f]+))?$/;

/** Parse `llvm-nm -P --defined-only` output (one file, one architecture).
 * Known limit (not fixed in W1-2): llvm-nm prints a symbol name as it is, so a target whose symbol
 * name contains a newline (e.g. "a T 1 1\nevil_x") is read as two symbols, the first one forged
 * by the target. test/engines.test.ts documents the current behaviour; it must be mitigated before
 * COD exposes these symbols (docs/engines-known-limits.md). */
export function parseNm(stdout: string): { ok: true; data: NmSymbol[] } | { ok: false; line: number; text: string } {
  const out: NmSymbol[] = [];
  const lines = stdout.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!.replace(/\r$/, "");
    if (!l) continue;
    const m = LINE.exec(l);
    if (!m) return { ok: false, line: i + 1, text: l };
    out.push({
      name: m[1]!,
      type: m[2]!,
      addr: `0x${BigInt(`0x${m[3]}`).toString(16)}`,
      size: m[4] ? Number.parseInt(m[4], 16) : null,
    });
  }
  return { ok: true, data: out };
}

/** The LLVM provider's spec (exported so a test can pin its defaults). */
export function llvmSpec(env = process.env): CommandEngineSpec<NmRequest, NmSymbol[]> {
  return {
    id: "llvm",
    operations: ["symbols"],
    resourceClass: "light",
    candidates: () => llvmCandidates(env),
    parseVersion: llvmVersion,
    minMajor: LLVM_MIN_MAJOR,
    remediation: () => llvmRemediation(),
    maxOutputBytes: LLVM_NM_MAX_OUTPUT,
    // llvm-nm reads the target: never outside the sandbox (D-22)
    alwaysRequired: true,
    args: (req) => {
      if (!isAbsolute(req.target) || req.target.length > MAX_TARGET_CHARS)
        throw new CoreError("bad_request", { field: "target", why: "an absolute path" });
      if (req.arch !== undefined && !/^[A-Za-z0-9_]{1,32}$/.test(req.arch))
        throw new CoreError("bad_request", { field: "arch", why: "an LLVM architecture name such as arm64" });
      return ["-P", "--defined-only", ...(req.arch ? [`--arch=${req.arch}`] : []), req.target];
    },
    parse: parseNm,
  };
}

export function llvmProvider(env = process.env): EngineProvider<NmRequest, NmSymbol[]> {
  return commandEngine(llvmSpec(env));
}
