// The LLVM provider: llvm-nm (LLVM 18 or later) on a target, inside the sandbox.
// Discovery order (D-22): the directory in REAX_LLVM_BIN, then PATH (llvm-nm-18, then llvm-nm), then
// the fixed directories below. Nothing is installed: a missing LLVM gives engine_unavailable with the
// install line for this platform as its remediation.
// The run: `llvm-nm -A -P --defined-only [--arch=<a>] <per-run path>`, argv[0] the resolved real path,
// through runSandboxed with required: true. -P is POSIX output, "name type value size"; -A starts
// every record with "<path as given>: ". llvm-nm takes no "--", so the target must be an absolute
// path (it then cannot be read as an option).
// Framing (D-31): llvm-nm prints a symbol name as it is stored, so a name may hold a newline, a
// carriage return, spaces that look like fields, or control bytes. The path given to llvm-nm is a
// symlink to the target at <scratch>/<32 random hex>/<name>, made for this run only: the target
// cannot know it, so it cannot forge a record start. A line that starts with that exact prefix
// starts a record; any other line continues the previous record's name (joined with "\n", nothing
// stripped). The record's last three space-separated fields are type, value and size, so spaces
// inside a name are safe. Output that does not frame (a first line without the prefix, the path
// with any other framing such as an archive member's "path[member]: ", a bad tail) gives
// engine_output_invalid. Archives are refused before anything runs (bad_request): their member
// names are target-controlled and llvm-nm's "path[member]: " framing cannot be split
// unambiguously. Names that are not valid UTF-8 arrive with U+FFFD (the sandbox decodes stdout as
// UTF-8): a name with U+FFFD makes the result partial, never complete.
import { randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync, readSync, rmSync, symlinkSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { CoreError } from "@re4exa/core/errors";
import "../errors.ts";
import type { EngineProvider } from "./contract.ts";
import { type CommandEngineSpec, commandEngine, onPath, type ParseResult } from "./run.ts";

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
/** Random bytes in the per-run directory name (128 bits, printed as 32 hex digits). */
export const NM_FRAME_BYTES = 16;
/** A target's own file name is kept in the per-run path (llvm-nm's messages then name it) when it
 * is this plain; otherwise the link is called "target". */
const PLAIN_NAME = /^[A-Za-z0-9._+-]{1,128}$/;
/** The magic numbers of ar archives (regular and thin): refused, see the framing note above. */
const ARCHIVE_MAGIC = ["!<arch>\n", "!<thin>\n"];

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

/** A record's tail: the name (anything, newlines included), then " type value size" at the end. */
const TAIL = /^([\s\S]*) ([A-Za-z?-]) ([0-9a-f]+) ([0-9a-f]+)$/;

/** Parse `llvm-nm -A -P --defined-only` output for one file and one architecture, framed by
 * `prefix` ("<the path given to llvm-nm>: ", D-31). `cut`: the output was cut at the cap, so the
 * last record may be missing continuation lines and is left out. A name with U+FFFD (bytes that
 * were not valid UTF-8, or a real U+FFFD) is kept and flagged in `limitations`. */
export function parseNm(stdout: string, prefix: string, cut = false): ParseResult<NmSymbol[]> {
  if (!prefix.endsWith(": ") || prefix.length < 3 || prefix.includes("\n"))
    throw new Error('parseNm needs the per-run prefix, "<path>: "');
  const path = prefix.slice(0, -2);
  const lines = stdout.split("\n");
  const last = lines.pop();
  if (last !== "") return { ok: false, line: lines.length + 1, text: last ?? "" };
  const records: { line: number; parts: string[] }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.startsWith(prefix)) records.push({ line: i + 1, parts: [l.slice(prefix.length)] });
    // the unguessable path with any other framing (an archive member, an architecture note)
    else if (l.startsWith(path)) return { ok: false, line: i + 1, text: l };
    else if (records.length) records[records.length - 1]!.parts.push(l);
    else if (l !== "") return { ok: false, line: i + 1, text: l };
  }
  if (cut) records.pop();
  const out: NmSymbol[] = [];
  let replaced = 0;
  for (const r of records) {
    const text = r.parts.join("\n");
    const m = TAIL.exec(text);
    if (!m) return { ok: false, line: r.line, text };
    if (m[1]!.includes("\uFFFD")) replaced++;
    out.push({
      name: m[1]!,
      type: m[2]!,
      addr: `0x${BigInt(`0x${m[3]}`).toString(16)}`,
      size: Number.parseInt(m[4]!, 16),
    });
  }
  const limitations = replaced
    ? [
        `${replaced} symbol name${replaced === 1 ? " is" : "s are"} not valid UTF-8 (or hold U+FFFD): shown with U+FFFD in place of the bytes, so not exact`,
      ]
    : [];
  return { ok: true, data: out, limitations };
}

/** Whether a file starts with an ar archive's magic (read in this process; unreadable: false, and
 * llvm-nm then reports the error). */
function isArchive(target: string): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(target, "r");
    const b = Buffer.alloc(8);
    const n = readSync(fd, b, 0, 8, 0);
    return ARCHIVE_MAGIC.includes(b.subarray(0, n).toString("latin1"));
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** The per-run path: a symlink to the target in a fresh directory with a random name (D-31). */
export function nmFrame(target: string, scratch: string): { link: string; prefix: string; release: () => void } {
  const dir = join(scratch, randomBytes(NM_FRAME_BYTES).toString("hex"));
  mkdirSync(dir, { mode: 0o700 });
  const release = () => rmSync(dir, { recursive: true, force: true });
  const base = basename(target);
  const link = join(dir, PLAIN_NAME.test(base) ? base : "target");
  try {
    symlinkSync(target, link);
  } catch (e) {
    release();
    throw new CoreError("engine_failed", { engine: "llvm", why: `the per-run path: ${(e as Error).message}` });
  }
  return { link, prefix: `${link}: `, release };
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
    validate: (req) => {
      if (!isAbsolute(req.target) || req.target.length > MAX_TARGET_CHARS)
        throw new CoreError("bad_request", { field: "target", why: "an absolute path" });
      if (req.arch !== undefined && !/^[A-Za-z0-9_]{1,32}$/.test(req.arch))
        throw new CoreError("bad_request", { field: "arch", why: "an LLVM architecture name such as arm64" });
      if (isArchive(req.target))
        throw new CoreError("bad_request", {
          field: "target",
          why: "an archive: its member names cannot be framed unambiguously, so archives are refused (D-31)",
        });
    },
    prepare: (req, run) => {
      const f = nmFrame(req.target, run.scratch);
      return {
        args: ["-A", "-P", "--defined-only", ...(req.arch ? [`--arch=${req.arch}`] : []), f.link],
        parse: (stdout, cut) => parseNm(stdout, f.prefix, cut),
        release: f.release,
      };
    },
  };
}

export function llvmProvider(env = process.env): EngineProvider<NmRequest, NmSymbol[]> {
  return commandEngine(llvmSpec(env));
}
