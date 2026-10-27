// Run a CLI for a benchmark cell: argv only (no shell), a hard deadline that ends the whole
// process tree, every stdout line kept. The child gets the caller's environment; the CLIs read
// their own sign-in from their own config directories, which reax never opens.
//
// Windows: npm installs `codex` and `claude` as `.cmd` shims, which Node cannot spawn without a
// shell. The command is found on PATH with PATHEXT, and core's vendored resolveSpawn turns a
// recognised npm shim into `node <script>` (no cmd.exe, no argument escaping); an unrecognised
// one falls back to a cmd.exe line it builds and escapes itself. Prompts go over stdin, never
// in argv, so no prompt text ever passes through cmd's parser or the 32k command-line limit.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { forceTerminateProcessTree } from "@re4exa/core/vendor/orca-process-host/process-tree-termination";
import { type ResolvedSpawn, resolveSpawn } from "@re4exa/core/vendor/orca-process-host/spawn-resolution";

export interface ProcResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  ms: number;
}

/** The environment's PATH variable name as it is spelled there (`Path` on Windows, usually). */
export function pathKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
}

/** A copy of env with dir first on PATH, keeping the one PATH key the env already has. */
export function prependPath(env: NodeJS.ProcessEnv, dir: string): NodeJS.ProcessEnv {
  const key = pathKey(env);
  const rest = env[key];
  return { ...env, [key]: rest ? `${dir}${delimiter}${rest}` : dir };
}

const isFile = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/**
 * Where `cmd` resolves on PATH. On Windows each PATH entry is tried with every PATHEXT extension
 * (so `codex` finds `codex.cmd`); elsewhere the command is returned unchanged for the OS to find.
 */
export function findCommand(cmd: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32" || isAbsolute(cmd) || /[\\/]/.test(cmd)) return cmd;
  const exts = (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const hasExt = exts.some((e) => cmd.toLowerCase().endsWith(e.toLowerCase()));
  for (const dir of (env[pathKey(env)] ?? "").split(";").filter(Boolean)) {
    if (hasExt && isFile(join(dir, cmd))) return join(dir, cmd);
    for (const e of exts) if (isFile(join(dir, cmd + e.toLowerCase()))) return join(dir, cmd + e.toLowerCase());
  }
  return cmd;
}

/** The exact spawn call for argv on this platform. Exported so the Windows branch is testable. */
export function spawnFor(
  argv: string[],
  env: NodeJS.ProcessEnv,
  cwd?: string,
  platform: NodeJS.Platform = process.platform,
): ResolvedSpawn {
  const [cmd, ...args] = argv;
  return resolveSpawn(
    { program: findCommand(cmd!, env, platform), args, env, ...(cwd ? { cwd } : {}), detached: platform !== "win32" },
    platform,
  );
}

export function runCli(
  argv: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; deadline: number; input?: string },
): Promise<ProcResult> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const s = spawnFor(argv, opts.env, opts.cwd);
    let child: ChildProcess;
    try {
      child = spawn(s.file, [...s.args], { ...s.options, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      resolve({ code: null, stdout: "", stderr: String(e), timedOut: false, ms: Date.now() - t0 });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout!.setEncoding("utf8").on("data", (d: string) => {
      stdout += d;
    });
    child.stderr!.setEncoding("utf8").on("data", (d: string) => {
      if (stderr.length < 1 << 20) stderr += d;
    });
    const timer = setTimeout(
      () => {
        timedOut = true;
        void forceTerminateProcessTree(child).catch(() => child.kill("SIGKILL"));
      },
      Math.max(1, opts.deadline - Date.now()),
    );
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}${String(e)}`, timedOut, ms: Date.now() - t0 });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, ms: Date.now() - t0 });
    });
    child.stdin!.on("error", () => {}); // a CLI that exits without reading stdin
    child.stdin!.end(opts.input ?? "");
  });
}

/** The synchronous form, for short checks (`--version`, `--help`, `login status`). */
export function runCliSync(
  argv: string[],
  opts: { env?: NodeJS.ProcessEnv; input?: string; timeoutMs?: number } = {},
): { ok: boolean; out: string; stdout: string; missing: boolean } {
  const env = opts.env ?? process.env;
  const s = spawnFor(argv, env);
  const { detached: _detached, ...options } = s.options;
  const r = spawnSync(s.file, [...s.args], {
    ...options,
    encoding: "utf8",
    input: opts.input ?? "",
    timeout: opts.timeoutMs ?? 120_000,
  });
  return {
    ok: r.status === 0,
    out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim(),
    stdout: r.stdout ?? "",
    missing: (r.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT",
  };
}

/** Lines of JSON output, skipping anything that is not a JSON object. */
export function jsonLines(s: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of s.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      out.push(JSON.parse(t) as Record<string, unknown>);
    } catch {
      // not a complete JSON line
    }
  }
  return out;
}

/** Recognise a CLI telling us it is not signed in, so the cell says so instead of scoring 0. */
export function signInNeeded(text: string): boolean {
  return /not (logged|signed) in|please (log|sign) in|run .*login|unauthori[sz]ed|authentication required|invalid api key|401/i.test(
    text,
  );
}
