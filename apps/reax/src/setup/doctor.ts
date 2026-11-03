// reax doctor: each client's state and the MCP server's build state. It only reads: no file or
// directory is created, not even the reax home's setup directory.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inspect } from "./claude-code.ts";
import type { Env } from "./home.ts";
import type { JsonObject } from "./jsonedit.ts";

export function reaxVersion(): string {
  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "package.json"), "utf8")) as {
    version: string;
  };
  return pkg.version;
}

export interface DoctorReport {
  reax_version: string;
  /** the `reax mcp` stdio server the entry starts; not built until DMN's MCP slice (D-50) */
  mcp_server: "not_built";
  clients: ReturnType<typeof inspect>[];
}

export function doctor(env: Env, entry?: JsonObject, platform?: NodeJS.Platform): DoctorReport {
  return { reax_version: reaxVersion(), mcp_server: "not_built", clients: [inspect(env, entry, platform)] };
}
