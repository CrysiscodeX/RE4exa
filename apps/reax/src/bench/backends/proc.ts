// Run a CLI for a benchmark cell: argv only (no shell), a hard deadline, every stdout line kept.
// The child gets the caller's environment minus anything it does not need from reax; the CLIs
// read their own sign-in from their own config directories, which reax never opens.
import { spawn } from "node:child_process";

export interface ProcResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  ms: number;
}

export function runCli(
  argv: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; deadline: number; input?: string },
): Promise<ProcResult> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const [cmd, ...args] = argv;
    const child = spawn(cmd!, args, { cwd: opts.cwd, env: opts.env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8").on("data", (d: string) => {
      stdout += d;
    });
    child.stderr.setEncoding("utf8").on("data", (d: string) => {
      if (stderr.length < 1 << 20) stderr += d;
    });
    const ms = Math.max(1, opts.deadline - Date.now());
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, ms);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}${String(e)}`, timedOut, ms: Date.now() - t0 });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, ms: Date.now() - t0 });
    });
    child.stdin.end(opts.input ?? "");
  });
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
