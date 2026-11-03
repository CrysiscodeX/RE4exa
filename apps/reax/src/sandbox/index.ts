// Run a child process under a sandbox policy (ADR 0006): reads allowed, writes only beneath the
// scratch directory, no network. macOS uses sandbox-exec, Linux uses Landlock (ABI 4 or later);
// anywhere else, or when the probe fails, work that requires the sandbox is refused with
// sandbox_unavailable before anything starts, and work that does not runs labelled "none".
// The child runs in its own process group (detached; the wrappers exec the child, so it keeps the
// wrapper's pid). reax owns the tree kill (best effort: see the limits below); on POSIX core's
// termination barrier is off, so core only ever kills the root through its ChildProcess handle.
// At the deadline or an abort, if the root is still unreaped (Node has not seen it exit, so its
// pid cannot have been reused), reax kills every descendant a ps snapshot lists under it by
// parent pid (so one that left the group, by setsid or a detached spawn, is caught too while its
// parent still runs), then the group, then lets go of the child's pipes and stops core. If the
// root was already reaped, nothing is signalled: the pipes are released and the run ends. The
// group is also killed in the same turn as the root's exit event, so a grandchild backgrounded in
// it does not outlive a normal exit. Residual windows: the ps snapshot (a listed descendant could
// be reaped and its pid reused before the kill) and the microseconds between libuv's waitpid and
// the exit event (an empty group's id is free then). Not caught, on macOS and Linux: a descendant
// that left the group once its parent has exited (a double fork with setsid); if it holds the
// child's pipes, a run whose root exited lasts until the deadline (timedOut true, with the root's
// own exit code). Windows has no reax tree kill: core's barrier (a guarded taskkill tree) stays.
// The child's environment is an allowlist (SANDBOX_ENV), not the parent's: HOME and TMPDIR point
// at scratch; more names are passed only through passEnv.
import type { ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CoreError } from "@re4exa/core/errors";
import { runProcess } from "@re4exa/core/vendor/orca-process-host/run-process";
import "../errors.ts";
import { linuxArgv, probeLinux } from "./linux.ts";
import { macArgv, macProfile, probeMac } from "./macos.ts";
import type { Enforcement, SandboxBackend, SandboxPolicy, SandboxResult } from "./policy.ts";
import { TREE } from "./tree.ts";

export type { Enforcement, SandboxBackend, SandboxPolicy, SandboxResult } from "./policy.ts";

export const SANDBOX_DEFAULT_TIMEOUT_MS = 60_000;
export const SANDBOX_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_ARGS = 4096;
const MAX_ARG_BYTES = 1024 * 1024;

export interface SandboxRunOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Cap on captured stdout and stderr each; longer output is cut and outputTruncated is set. */
  maxOutputBytes?: number;
  cwd?: string;
  /** Names of further parent environment variables to pass to the child (absent ones are skipped). */
  passEnv?: readonly string[];
  /** Test seam: act as if no backend were available. It can only weaken, never pick a backend. */
  forceBackend?: "none";
}

/** The parent variables a child gets by default; everything else (tokens, keys) stays out. */
export const SANDBOX_ENV = ["PATH", "LANG", "LC_ALL", "TZ"] as const;
/** Windows needs these to start a process at all. */
const WIN_ENV = ["SystemRoot", "windir", "PATHEXT", "ComSpec"];
const MAX_PASS_ENV = 256;

/** The child's environment: the allowlist, passEnv, and HOME and TMPDIR (TEMP, TMP) set to scratch. */
export function sandboxEnv(scratch: string, passEnv: readonly string[] = []): Record<string, string> {
  if (passEnv.length > MAX_PASS_ENV)
    throw new CoreError("bad_request", { field: "passEnv", why: `at most ${MAX_PASS_ENV} names` });
  const env: Record<string, string> = {};
  const names = [...SANDBOX_ENV, ...(process.platform === "win32" ? WIN_ENV : []), ...passEnv];
  for (const n of names) {
    const v = process.env[n];
    if (v !== undefined) env[n] = v;
  }
  env.HOME = scratch;
  env.TMPDIR = scratch;
  if (process.platform === "win32") {
    env.USERPROFILE = scratch;
    env.TEMP = scratch;
    env.TMP = scratch;
  }
  return env;
}

let probed: SandboxBackend | undefined;

/** The backend this machine offers, probed once per process, never assumed. */
export function sandboxBackend(): SandboxBackend {
  probed ??=
    process.platform === "darwin"
      ? probeMac()
      : process.platform === "linux"
        ? probeLinux()
        : { name: "none", why: `no sandbox on ${process.platform} in W1-1` };
  return probed;
}

/** Whether a backend enforces the whole policy (no network included). */
const enforces = (b: SandboxBackend): b is SandboxBackend & { name: "sandbox-exec" | "landlock" } =>
  b.name === "sandbox-exec" || b.name === "landlock";

/** The backend a run would use; throws sandbox_unavailable when the run requires enforcement and
 * none is available. runSandboxed calls it first; a caller may call it earlier, before it prepares
 * anything for the run (nothing is created or started when it throws). */
export function requireSandbox(required: boolean, forceBackend?: "none"): SandboxBackend {
  const backend: SandboxBackend =
    forceBackend === "none" ? { name: "none", why: "forced to none (test seam)" } : sandboxBackend();
  if (!enforces(backend) && required)
    throw new CoreError("sandbox_unavailable", {
      platform: process.platform,
      backend: backend.name,
      why: backend.why,
    });
  return backend;
}

export async function runSandboxed(
  argv: readonly string[],
  policy: SandboxPolicy,
  opts: SandboxRunOptions = {},
): Promise<SandboxResult> {
  if (argv.length === 0 || argv.length > MAX_ARGS || argv.reduce((n, a) => n + a.length, 0) > MAX_ARG_BYTES)
    throw new CoreError("bad_request", {
      field: "argv",
      why: `1 to ${MAX_ARGS} arguments, ${MAX_ARG_BYTES} bytes at most`,
    });
  if (policy.network !== false)
    throw new CoreError("bad_request", { field: "policy.network", why: "only false (no network) is supported" });
  const backend = requireSandbox(policy.required, opts.forceBackend);
  // SBPL and Landlock both match the real path: /var is /private/var on macOS, and a scratch
  // reached through a symlink must be named by its target
  let scratch: string;
  try {
    scratch = realpathSync(policy.scratch);
    if (!statSync(scratch).isDirectory()) throw new Error("not a directory");
  } catch (e) {
    throw new CoreError("bad_request", {
      field: "policy.scratch",
      why: `an existing directory: ${(e as Error).message}`,
    });
  }
  const enforcement: Enforcement = enforces(backend) ? backend.name : "none";
  let profile: string | null = null;
  let cmd: { program: string; args: string[] };
  if (enforcement === "sandbox-exec") {
    // beside the scratch, not in it, so the child cannot rewrite it
    profile = join(dirname(scratch), `.reax-sbx-${randomBytes(8).toString("hex")}.sb`);
    writeFileSync(profile, macProfile(scratch), { flag: "wx", mode: 0o600 });
    cmd = macArgv(profile, argv);
  } else if (enforcement === "landlock") cmd = linuxArgv(scratch, argv);
  else cmd = { program: argv[0]!, args: argv.slice(1) };
  const timeoutMs = opts.timeoutMs ?? SANDBOX_DEFAULT_TIMEOUT_MS;
  const posix = process.platform !== "win32";
  let pid: number | undefined;
  let spawned: ChildProcess | undefined;
  let timedOut = false;
  // an unreaped root's pid cannot have been reused; once Node has seen the exit, it may have been
  const rootLive = () => spawned !== undefined && spawned.exitCode === null && spawned.signalCode === null;
  // reax owns the deadline, the abort and the tree kill; core only kills the root by its handle
  // (terminationBarrier off, so core sends no pid-addressed signal). While the root is unreaped
  // (its pid cannot have been reused), reax kills its descendants and its group, lets go of the
  // child's pipes (so an escaped holder cannot delay the end) and stops core. Once the root is
  // reaped, its pid may belong to someone else: nothing is signalled, only the pipes are let go,
  // so runProcess sees close and resolves
  const stop = new AbortController();
  let ended = false;
  let closed = false;
  const releasePipes = () => {
    if (closed || !spawned) return;
    for (const s of [spawned.stdin, spawned.stdout, spawned.stderr]) s?.destroy();
  };
  const end = () => {
    if (ended) return;
    ended = true;
    if (posix && spawned && !rootLive()) {
      releasePipes();
      return;
    }
    if (posix && pid && rootLive()) {
      TREE.killDescendants(pid);
      TREE.killGroup(pid);
      releasePipes();
    }
    stop.abort();
  };
  const deadline = setTimeout(() => {
    timedOut = true;
    end();
  }, timeoutMs);
  // a ref'd timer keeps the event loop alive until runProcess settles, even when every other
  // handle is gone (core's last-resort timer is unref'd)
  const hold = setInterval(() => {}, 1000);
  opts.signal?.addEventListener("abort", end, { once: true });
  if (opts.signal?.aborted) end();
  try {
    const r = await runProcess({
      program: cmd.program,
      args: cmd.args,
      cwd: opts.cwd ?? scratch,
      env: sandboxEnv(scratch, opts.passEnv),
      timeoutMs: null,
      maxOutputBytes: opts.maxOutputBytes ?? SANDBOX_MAX_OUTPUT_BYTES,
      detached: posix,
      // off on POSIX: reax owns the tree kill, and core's barrier would signal -pid after the reap;
      // on Windows (no reax tree kill) core's guarded taskkill tree stays
      terminationBarrier: !posix,
      signal: stop.signal,
      onSpawn: (c) => {
        spawned = c;
        pid = c.pid;
        // the same turn as the reap: a group that still has members keeps its id
        const leader = c.pid;
        if (posix && leader) c.once("exit", () => TREE.killGroupAtExit(leader));
        c.once("close", () => {
          closed = true;
        });
      },
    });
    // the helper failed before exec: nothing ran (fail closed)
    if (enforcement === "landlock" && r.code === 125 && r.stderr.startsWith("reax-landlock:"))
      throw new CoreError("sandbox_unavailable", {
        platform: process.platform,
        backend: backend.name,
        why: r.stderr.split("\n")[0]!.slice(0, 300),
      });
    return {
      code: r.code,
      signal: r.signal,
      stdout: r.stdout,
      stderr: r.stderr,
      timedOut,
      outputTruncated: r.outputTruncated === true,
      enforcement,
    };
  } finally {
    clearTimeout(deadline);
    clearInterval(hold);
    opts.signal?.removeEventListener("abort", end);
    // an escaped descendant may still hold the child's pipes; let go of them, or they keep this
    // process alive after the run
    for (const s of [spawned?.stdin, spawned?.stdout, spawned?.stderr]) s?.destroy();
    if (profile) rmSync(profile, { force: true });
  }
}
