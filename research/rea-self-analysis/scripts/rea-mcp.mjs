// Minimal stdio MCP client for REA, built on the client package REA itself depends on.
// One ReaSession is one REA process, one connection and one Evidence ledger.

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const reaPackageDir = process.env.REA_PACKAGE_DIR; // .../node_modules/rea-agents
if (!reaPackageDir) throw new Error("set REA_PACKAGE_DIR to the installed rea-agents directory");
const require = createRequire(join(reaPackageDir, "package.json"));
const load = async (spec) => import(pathToFileURL(require.resolve(spec)).href);
const { Client } = await load("@modelcontextprotocol/client");
const { StdioClientTransport } = await load("@modelcontextprotocol/client/stdio");

const MiB = 1 << 20;

export async function openRea({ responseBytes = 64 * MiB, env = {}, log = () => {} } = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(reaPackageDir, "scripts/rea.mjs"), "mcp"],
    stderr: "pipe",
    maxBufferSize: responseBytes + MiB,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      NODE_OPTIONS: process.env.NODE_OPTIONS ?? "",
      REA_LOG_LEVEL: "warn",
      REA_MCP_MAX_RESPONSE_BYTES: String(responseBytes),
      ...env,
    },
  });
  let stderr = "";
  transport.stderr?.on("data", (d) => { stderr += d; if (stderr.length > 1 << 20) stderr = stderr.slice(-(1 << 19)); });
  const client = new Client({ name: "re4exa-rea-self-analysis", version: "1.0.0" });
  await client.connect(transport);
  const calls = [];

  const callRaw = async (name, args, { timeout = 1_800_000 } = {}) => {
    const started = performance.now();
    const reply = await client.callTool({ name, arguments: args }, { timeout });
    const ms = Math.round(performance.now() - started);
    const textBytes = (reply.content ?? []).reduce((a, c) => a + (c.type === "text" ? Buffer.byteLength(c.text) : 0), 0);
    const structuredBytes = reply.structuredContent ? Buffer.byteLength(JSON.stringify(reply.structuredContent)) : 0;
    const entry = { name, ms, isError: Boolean(reply.isError), textBytes, structuredBytes };
    calls.push(entry);
    log(entry);
    return reply;
  };
  const call = async (name, args, opts) => {
    const reply = await callRaw(name, args, opts);
    if (reply.isError) {
      const text = reply.content?.find((c) => c.type === "text")?.text ?? "";
      let parsed; try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 2000) }; }
      const err = new Error(`${name} failed: ${parsed?.error?.code ?? "?"}: ${parsed?.error?.message ?? text.slice(0, 300)}`);
      err.diagnostic = parsed?.error ?? parsed;
      throw err;
    }
    return reply.structuredContent;
  };
  return {
    client, call, callRaw, calls,
    pid: transport.pid,
    stderr: () => stderr,
    close: async () => { await client.close().catch(() => {}); await transport.close().catch(() => {}); },
  };
}
