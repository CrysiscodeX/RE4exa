// Linux backend: Landlock through landlock.py, run by the system python3 in isolated mode (-I).
// No install, no sysctl, no user namespace. Detection runs the helper's ABI query.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SandboxBackend } from "./policy.ts";

/** Landlock ABI 4 (kernel 6.7) is the first that can refuse TCP connect. */
export const LANDLOCK_NET_ABI = 4;

/** The helper beside this module; from dist/sandbox, the shipped src/sandbox copy. */
export function helperPath(): string | null {
  for (const p of [
    join(import.meta.dirname, "landlock.py"),
    join(import.meta.dirname, "..", "..", "src", "sandbox", "landlock.py"),
  ])
    if (existsSync(p)) return p;
  return null;
}

/** The system python3: /usr/bin/python3 when present, else the first on PATH. */
export const python3 = (): string => (existsSync("/usr/bin/python3") ? "/usr/bin/python3" : "python3");

export function probeLinux(): SandboxBackend {
  const helper = helperPath();
  if (!helper) return { name: "none", why: "the Landlock helper landlock.py is missing" };
  const r = spawnSync(python3(), ["-I", helper, "--abi"], { timeout: 10_000, stdio: "pipe", encoding: "utf8" });
  if (r.error) return { name: "none", why: `python3 cannot run: ${r.error.message}` };
  const abi = r.status === 0 ? Number(r.stdout.trim()) : Number.NaN;
  if (!Number.isInteger(abi)) return { name: "none", why: `the Landlock ABI query failed (exit ${r.status})` };
  if (abi < 1) return { name: "none", why: "the kernel has no Landlock", abi: 0 };
  if (abi < LANDLOCK_NET_ABI)
    return {
      name: "landlock-no-net",
      abi,
      why: `Landlock ABI ${abi} cannot refuse network (needs ${LANDLOCK_NET_ABI})`,
    };
  return { name: "landlock", abi, why: `Landlock ABI ${abi}` };
}

export function linuxArgv(scratchReal: string, argv: readonly string[]): { program: string; args: string[] } {
  return { program: python3(), args: ["-I", helperPath()!, scratchReal, "--", ...argv] };
}
