// Where setup, doctor and uninstall look: the home comes only from the environment passed in (HOME,
// or USERPROFILE on Windows), never from the OS's account database, so a test that passes a
// temporary HOME cannot reach the real one (ADR 0012). The reax home is REAX_HOME, else
// <home>/.reax, from the same environment.
import { isAbsolute, join, resolve } from "node:path";
import { CoreError } from "@re4exa/core/errors";
import "../errors.ts";

export type Env = Readonly<Record<string, string | undefined>>;

/** The user's home from `env`; with neither variable set (or set to a relative path), home_unset. */
export function homeFrom(env: Env, platform: NodeJS.Platform = process.platform): string {
  const names = platform === "win32" ? ["USERPROFILE", "HOME"] : ["HOME"];
  for (const n of names) {
    const v = env[n];
    if (v && isAbsolute(v)) return resolve(v);
  }
  throw new CoreError("home_unset", { variables: names });
}

/** The reax home for setup's records: REAX_HOME from `env`, else <home>/.reax. */
export function reaxHomeFrom(env: Env, home: string): string {
  const v = env.REAX_HOME;
  return v && isAbsolute(v) ? resolve(v) : join(home, ".reax");
}
