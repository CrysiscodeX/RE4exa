// Shared plumbing for command-line engines: finding the binary (no install, no package manager),
// its version and digest, and mapping a sandboxed run's result to an engine result or a typed
// error. Mapping (binding, W1-2):
//   sandbox_unavailable from runSandboxed  -> propagates as is
//   timedOut                               -> engine_timeout (the deadline passed and the run was
//                                             stopped; no claim about escaped descendants, ADR 0006)
//   the caller's signal aborted            -> engine_cancelled (checked before the exit code)
//   exit code not 0                        -> engine_failed, stderr excerpt capped at 2 KiB
//   output that does not parse             -> engine_output_invalid
//   outputTruncated                        -> a partial result with a limitation naming the cap
//   the parser's own limitations           -> a partial result with those limitations (e.g. a
//                                             name that was not valid UTF-8, D-31)
// Order of checks before anything starts: the request (validate: bad_request), then the sandbox
// (sandbox_unavailable when required and not enforced), then the per-run preparation (prepare:
// arguments and this run's parser, e.g. a per-run path that frames the output; released after the
// run whatever its outcome).
// Text taken from the engine's output (stderr, excerpts) is target-derived: it is wrapped in core's
// untrusted-content envelope before it goes into an error.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { CoreError } from "@re4exa/core/errors";
import { envelope } from "@re4exa/core/policy/taint";
import "../errors.ts";
import { requireSandbox, runSandboxed } from "../sandbox/index.ts";
import type { SandboxResult } from "../sandbox/policy.ts";
import type { Availability, EngineProvider, EngineResult, EngineRunOptions } from "./contract.ts";

export const STDERR_EXCERPT_BYTES = 2048;
const EXCERPT_CHARS = 200;
const VERSION_TIMEOUT_MS = 20_000;
const VERSION_MAX_BYTES = 64 * 1024;
const MAX_PATH_DIRS = 1024;

/** Where to look, in order: each entry is a file path that may exist. */
export type Candidates = () => string[];

/** `name` in each directory of PATH (with .exe on Windows), in PATH order. */
export function onPath(name: string, path = process.env.PATH ?? ""): string[] {
  const exe = process.platform === "win32" && !name.toLowerCase().endsWith(".exe") ? `${name}.exe` : name;
  return path
    .split(delimiter)
    .filter(Boolean)
    .slice(0, MAX_PATH_DIRS)
    .map((d) => join(d, exe));
}

/** The first candidate that is a regular file, as given and as its real path. */
export function firstFile(candidates: string[]): { given: string; real: string } | null {
  for (const c of candidates.slice(0, MAX_PATH_DIRS * 4)) {
    try {
      if (!existsSync(c)) continue;
      const real = realpathSync(c);
      if (statSync(real).isFile()) return { given: c, real };
    } catch {
      /* unreadable: keep looking */
    }
  }
  return null;
}

export const sha256File = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** A parser's verdict on one run's stdout. `cut` says the output was cut at the cap (its last line
 * already dropped), so a record that may continue past the cut can be left out. Limitations make
 * the result partial. */
export type ParseResult<Out> =
  | { ok: true; data: Out; limitations?: string[] }
  | { ok: false; line: number; text: string };
export type Parser<Out> = (stdout: string, cut: boolean) => ParseResult<Out>;

/** What one run needs, made after the sandbox check: the engine's arguments (after the launcher's
 * prefix), the parser for this run's output, and what to undo after the run. */
export interface PreparedRun<Out> {
  args: string[];
  parse: Parser<Out>;
  release?: () => void;
}

export interface CommandEngineSpec<Req, Out> {
  id: string;
  operations: readonly string[];
  resourceClass: "light" | "heavy";
  /** Where the binary may be, in order. */
  candidates: Candidates;
  /** Arguments put before every invocation's own (e.g. a script for an interpreter). */
  launcher?: (path: string) => { program: string; prefix: string[] };
  /** The version from `--version` output, or null when it does not say. */
  parseVersion: (out: string) => string | null;
  /** The oldest major version accepted. */
  minMajor: number;
  /** The per-platform install line (never run). */
  remediation: () => string;
  /** Check a request before anything is created or started; throws bad_request. */
  validate?: (req: Req) => void;
  /** Per run, after the request and sandbox checks: arguments and this run's parser. `scratch` is
   * the run's scratch directory (the only place the engine may write). */
  prepare: (req: Req, run: { scratch: string }) => PreparedRun<Out>;
  /** The default cap on stdout and on stderr each. */
  maxOutputBytes: number;
  /** Runs always require the sandbox, whatever the caller's `required` says (engines that read
   * targets; D-22). Only a contract-test engine leaves it off. */
  alwaysRequired: boolean;
}

/** Map a finished sandbox run to an engine result or a typed error. */
export function mapRun<Out>(
  spec: { id: string; parse: Parser<Out> },
  r: SandboxResult,
  signal: AbortSignal | undefined,
  cap: number,
  engine: EngineResult<Out>["engine"],
): EngineResult<Out> {
  const base = { engine: spec.id, enforcement: r.enforcement };
  if (r.timedOut)
    throw new CoreError("engine_timeout", { ...base, why: "the deadline passed and the run was stopped" });
  if (signal?.aborted) throw new CoreError("engine_cancelled", base);
  if (r.code !== 0) {
    const bytes = Buffer.from(r.stderr, "utf8");
    const cut = bytes.length > STDERR_EXCERPT_BYTES;
    throw new CoreError("engine_failed", {
      ...base,
      code: r.code,
      signal: r.signal,
      stderr: envelope(bytes.subarray(0, STDERR_EXCERPT_BYTES).toString("utf8"), `${spec.id} stderr`).text,
      stderrCut: cut,
    });
  }
  const limitations: string[] = [];
  let stdout = r.stdout;
  if (r.outputTruncated) {
    limitations.push(
      `the engine's output was cut at the cap of ${cap} bytes; only the entries before the cut are listed`,
    );
    // the last line may be cut in the middle: drop it
    const nl = stdout.lastIndexOf("\n");
    stdout = nl >= 0 ? stdout.slice(0, nl + 1) : "";
  }
  const p = spec.parse(stdout, r.outputTruncated);
  if (!p.ok)
    throw new CoreError("engine_output_invalid", {
      ...base,
      version: engine.version,
      line: p.line,
      excerpt: envelope(p.text.slice(0, EXCERPT_CHARS), `${spec.id} output`).text,
    });
  limitations.push(...(p.limitations ?? []));
  return {
    data: p.data,
    coverage: limitations.length ? "partial" : "complete",
    limitations,
    enforcement: r.enforcement,
    engine,
  };
}

/** A provider for an engine that is one command-line binary. */
export function commandEngine<Req, Out>(spec: CommandEngineSpec<Req, Out>): EngineProvider<Req, Out> {
  let found: Promise<Availability> | undefined;
  const launch = (path: string) => spec.launcher?.(path) ?? { program: path, prefix: [] };
  const discover = async (): Promise<Availability> => {
    const bin = firstFile(spec.candidates());
    if (!bin) return { available: false, reason: `${spec.id} was not found`, remediation: spec.remediation() };
    // the real path is what is hashed and what runs, so a symlink cannot swap the binary between
    const sha256 = sha256File(bin.real);
    const l = launch(bin.real);
    // reading the version takes no target input: the one place an unenforced run is allowed (D-22)
    const scratch = mkdtempSync(join(tmpdir(), "reax-engine-"));
    let r: SandboxResult;
    try {
      r = await runSandboxed(
        [l.program, ...l.prefix, "--version"],
        { scratch, network: false, required: false },
        { timeoutMs: VERSION_TIMEOUT_MS, maxOutputBytes: VERSION_MAX_BYTES },
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
    const version = r.code === 0 && !r.timedOut ? spec.parseVersion(r.stdout) : null;
    if (!version)
      return {
        available: false,
        reason: `${bin.real} did not report a version (exit ${r.code}${r.timedOut ? ", timed out" : ""})`,
        remediation: spec.remediation(),
      };
    const major = Number(version.split(".")[0]);
    if (!(major >= spec.minMajor))
      return {
        available: false,
        reason: `${bin.real} is version ${version}; ${spec.id} ${spec.minMajor} or later is needed`,
        remediation: spec.remediation(),
      };
    return { available: true, path: bin.real, version, sha256, enforcement: r.enforcement };
  };
  return {
    id: spec.id,
    operations: spec.operations,
    resourceClass: spec.resourceClass,
    discover() {
      // a rejected discovery is not kept: the next call tries again
      found ??= discover().catch((e) => {
        found = undefined;
        throw e;
      });
      return found;
    },
    async run(req: Req, opts: EngineRunOptions): Promise<EngineResult<Out>> {
      const a = await this.discover();
      if (!a.available)
        throw new CoreError("engine_unavailable", { engine: spec.id, reason: a.reason, remediation: a.remediation });
      const cap = opts.maxOutputBytes ?? spec.maxOutputBytes;
      const l = launch(a.path);
      const required = spec.alwaysRequired || (opts.required ?? true);
      spec.validate?.(req);
      // refused before the run's preparation, so a refusal creates nothing in scratch
      requireSandbox(required, opts.forceBackend);
      const prepared = spec.prepare(req, { scratch: opts.scratch });
      try {
        const r = await runSandboxed(
          [l.program, ...l.prefix, ...prepared.args],
          { scratch: opts.scratch, network: false, required },
          {
            maxOutputBytes: cap,
            ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
            ...(opts.signal ? { signal: opts.signal } : {}),
            ...(opts.forceBackend ? { forceBackend: opts.forceBackend } : {}),
          },
        );
        const engine = { id: spec.id, path: a.path, version: a.version, sha256: a.sha256 };
        return mapRun({ id: spec.id, parse: prepared.parse }, r, opts.signal, cap, engine);
      } finally {
        prepared.release?.();
      }
    },
  };
}
