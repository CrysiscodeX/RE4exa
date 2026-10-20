// One REA MCP server process over stdio, using the pinned rea-agents package.

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const reaRoot = dirname(createRequire(import.meta.url).resolve("rea-agents/package.json"));

export async function openRea() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(reaRoot, "scripts/rea.mjs"), "mcp"],
    stderr: "ignore",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, REA_LOG_LEVEL: "warn" },
  });
  const client = new Client({ name: "rea-durable-evidence", version: "0.1.0" });
  await client.connect(transport);
  return {
    pid: transport.pid,
    async call(name, args) {
      const reply = await client.callTool({ name, arguments: args }, { timeout: 600_000 });
      if (reply.isError) {
        const text = reply.content?.find((c) => c.type === "text")?.text ?? "";
        throw new Error(`REA ${name} failed: ${text.slice(0, 500)}`);
      }
      return reply.structuredContent;
    },
    close: () => client.close().catch(() => {}),
  };
}
