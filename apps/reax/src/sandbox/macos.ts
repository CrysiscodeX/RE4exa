// macOS backend: an SBPL profile run by /usr/bin/sandbox-exec (deprecated by Apple, still working,
// no root and no system setting needed). Writes only beneath the scratch directory, no network.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { SandboxBackend } from "./policy.ts";

export const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

/** An SBPL string literal. */
const lit = (s: string) => `"${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

/** The profile for a scratch directory that is already a real path (SBPL matches real paths). */
export function macProfile(scratchReal: string): string {
  return [
    "(version 1)",
    "(deny default)",
    "(allow process-exec)",
    "(allow process-fork)",
    "(allow signal (target self))",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow file-read*)",
    `(allow file-write* (subpath ${lit(scratchReal)}) (literal "/dev/null"))`,
    "(deny network*)",
    "",
  ].join("\n");
}

/** sandbox-exec exists and runs a `true` canary under a minimal deny-default profile. */
export function probeMac(): SandboxBackend {
  if (!existsSync(SANDBOX_EXEC)) return { name: "none", why: `${SANDBOX_EXEC} is missing` };
  const canary = "(version 1)\n(deny default)\n(allow process-exec)\n(allow file-read*)\n(allow sysctl-read)\n";
  const r = spawnSync(SANDBOX_EXEC, ["-p", canary, "--", "/usr/bin/true"], { timeout: 10_000, stdio: "pipe" });
  if (r.status === 0) return { name: "sandbox-exec", why: "sandbox-exec ran the canary" };
  const err = (r.stderr?.toString("utf8") ?? "").slice(0, 300).trim();
  return { name: "none", why: `sandbox-exec failed the canary (exit ${r.status}${err ? `: ${err}` : ""})` };
}

/** The wrapper command for argv under a profile file. */
export function macArgv(profileFile: string, argv: readonly string[]): { program: string; args: string[] } {
  return { program: SANDBOX_EXEC, args: ["-f", profileFile, "--", ...argv] };
}
