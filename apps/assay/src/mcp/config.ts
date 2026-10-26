// MCP client configuration for the provider adapters. In enforced mode the client must see ONLY the
// assay server: `claudeMcpArgs` adds `--strict-mcp-config` so the person's other MCP servers are not
// loaded, and `assertOnlyAssay` refuses any config that names another server.

import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AssayError } from "../errors.ts";
import { nodeArgs } from "../runtime.ts";

export const SERVER_NAME = "assay";

export interface HttpServerEntry {
  type: "http";
  url: string;
  headers: { Authorization: string };
}

export interface StdioServerEntry {
  type: "stdio";
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpConfig<E> {
  mcpServers: { assay: E };
}

/** For `claude --mcp-config <json|file>` and the Agent SDK's `mcpServers` option. */
export function claudeMcpConfig(url: string, token: string): McpConfig<HttpServerEntry> {
  return { mcpServers: { assay: { type: "http", url, headers: { Authorization: `Bearer ${token}` } } } };
}

/** For clients that start a stdio server (Codex, ACP agents): run the stdio proxy. */
export function stdioMcpConfig(proxy: {
  program: string;
  args: string[];
  env?: Record<string, string>;
}): McpConfig<StdioServerEntry> {
  const entry: StdioServerEntry = { type: "stdio", command: proxy.program, args: [...proxy.args] };
  if (proxy.env && Object.keys(proxy.env).length) entry.env = { ...proxy.env };
  return { mcpServers: { assay: entry } };
}

// .ts when run from source with type stripping, .js in the built package
export const STDIO_PROXY_PATH = fileURLToPath(
  new URL(import.meta.url.endsWith(".ts") ? "./stdio-proxy.ts" : "./stdio-proxy.js", import.meta.url),
);

/** The stdio proxy command line for a session (fits SessionOptions.mcp.stdioProxy). */
export function stdioProxyCommand(
  url: string,
  token: string,
  opts: { tokenInEnv?: boolean } = {},
): { program: string; args: string[]; env: Record<string, string> } {
  const base = [process.execPath, ...nodeArgs(), STDIO_PROXY_PATH, "--url", url];
  if (opts.tokenInEnv)
    return {
      program: base[0]!,
      args: [...base.slice(1), "--token-env", "ASSAY_MCP_TOKEN"],
      env: { ASSAY_MCP_TOKEN: token },
    };
  return { program: base[0]!, args: [...base.slice(1), "--token", token], env: {} };
}

/** Claude Code CLI arguments. Enforced mode adds --strict-mcp-config (ignore every other MCP source). */
export function claudeMcpArgs(configPathOrJson: string, mode: "enforced" | "open"): string[] {
  return mode === "enforced"
    ? ["--mcp-config", configPathOrJson, "--strict-mcp-config"]
    : ["--mcp-config", configPathOrJson];
}

/** Tool names as Claude Code exposes them (`mcp__assay__<tool>`), for --allowedTools. */
export function claudeToolNames(tools: { name: string }[]): string[] {
  return tools.map((t) => `mcp__${SERVER_NAME}__${t.name}`);
}

/** Codex `-c` overrides that register the stdio proxy as the `assay` MCP server. */
export function codexConfigArgs(proxy: { program: string; args: string[]; env?: Record<string, string> }): string[] {
  const out = [
    "-c",
    `mcp_servers.assay.command=${JSON.stringify(proxy.program)}`,
    "-c",
    `mcp_servers.assay.args=${JSON.stringify(proxy.args)}`,
  ];
  for (const [k, v] of Object.entries(proxy.env ?? {}))
    out.push("-c", `mcp_servers.assay.env.${k}=${JSON.stringify(v)}`);
  return out;
}

/** ACP `session/new` mcpServers entry list. */
export function acpMcpServers(proxy: {
  program: string;
  args: string[];
  env?: Record<string, string>;
}): { name: string; command: string; args: string[]; env: { name: string; value: string }[] }[] {
  return [
    {
      name: SERVER_NAME,
      command: proxy.program,
      args: [...proxy.args],
      env: Object.entries(proxy.env ?? {}).map(([name, value]) => ({ name, value })),
    },
  ];
}

/** Enforced mode: the config must contain the assay server and nothing else. */
export function assertOnlyAssay(config: unknown): void {
  const servers =
    config !== null && typeof config === "object" ? (config as { mcpServers?: unknown }).mcpServers : undefined;
  const names = Array.isArray(servers)
    ? servers.map((s) => (s as { name?: unknown }).name)
    : servers !== null && typeof servers === "object"
      ? Object.keys(servers as object)
      : [];
  if (names.length !== 1 || names[0] !== SERVER_NAME)
    throw new AssayError("bad_request", {
      why: "enforced mode allows only the assay MCP server",
      names: names.map(String),
    });
}

/** Write a config file readable only by the person (keeps the bearer token out of argv). */
export function writeMcpConfigFile(dir: string, config: unknown, name = "assay-mcp.json"): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(config, null, 2), { mode: 0o600 });
  try {
    chmodSync(p, 0o600);
  } catch {
    // best effort on platforms without POSIX modes
  }
  return p;
}
