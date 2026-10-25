// stdio <-> HTTP bridge for MCP clients that only speak stdio (ACP agents, Codex):
//
//   node src/mcp/stdio-proxy.ts --url http://127.0.0.1:<port>/mcp --token <t>
//   node src/mcp/stdio-proxy.ts --url ... --token-env ASSAY_MCP_TOKEN   (keeps the token out of argv)
//
// Reads line-delimited JSON-RPC from stdin, POSTs each line to Assay's MCP endpoint and writes each
// response as one line to stdout. Requests are forwarded concurrently (a tool call waiting for
// approval does not block a ping); JSON-RPC ids pair responses with requests.

import { resolve } from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

export interface ProxyOptions {
  url: string;
  token: string;
  input: Readable;
  output: Writable;
  fetch?: typeof fetch;
  /** Diagnostics (never stdout, which carries the protocol). */
  log?: (line: string) => void;
}

function idsOf(line: string): (string | number | null)[] {
  try {
    const m = JSON.parse(line) as unknown;
    const list = Array.isArray(m) ? m : [m];
    return list
      .filter((x) => x !== null && typeof x === "object" && "id" in (x as object))
      .map((x) => (x as { id: string | number | null }).id);
  } catch {
    return [null];
  }
}

/** Run the proxy until stdin closes and every forwarded request has been answered. */
export async function runProxy(opts: ProxyOptions): Promise<void> {
  const doFetch = opts.fetch ?? fetch;
  const inflight = new Set<Promise<void>>();
  const write = (obj: unknown): void => {
    opts.output.write(`${JSON.stringify(obj)}\n`);
  };
  const forward = async (line: string): Promise<void> => {
    try {
      const res = await doFetch(opts.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${opts.token}`,
        },
        body: line,
      });
      const text = await res.text();
      if (res.status === 202 || text.length === 0) return;
      if (res.ok) {
        write(JSON.parse(text));
        return;
      }
      let message = `Assay MCP endpoint answered HTTP ${res.status}`;
      try {
        const body = JSON.parse(text) as { error?: { code?: string; fix?: string } };
        if (body.error?.code) message += ` (${body.error.code}: ${body.error.fix ?? ""})`;
      } catch {
        // not JSON
      }
      for (const id of idsOf(line)) write({ jsonrpc: "2.0", id, error: { code: -32000, message } });
    } catch (e) {
      opts.log?.(`assay stdio proxy: ${String((e as Error).message)}`);
      for (const id of idsOf(line))
        write({ jsonrpc: "2.0", id, error: { code: -32000, message: "Assay MCP endpoint unreachable" } });
    }
  };
  const rl = createInterface({ input: opts.input, crlfDelay: Number.POSITIVE_INFINITY });
  for await (const raw of rl) {
    const line = raw.trim();
    if (!line) continue;
    const p = forward(line).finally(() => inflight.delete(p));
    inflight.add(p);
  }
  await Promise.all([...inflight]);
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv): { url: string; token: string } {
  let url = "";
  let token = "";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url") url = argv[++i] ?? "";
    else if (a === "--token") token = argv[++i] ?? "";
    else if (a === "--token-env") token = env[argv[++i] ?? ""] ?? "";
  }
  if (!token) token = env.ASSAY_MCP_TOKEN ?? "";
  if (!url || !token) throw new Error("usage: stdio-proxy.ts --url <url> (--token <t> | --token-env <VAR>)");
  return { url, token };
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const { url, token } = parseArgs(process.argv.slice(2), process.env);
    await runProxy({
      url,
      token,
      input: process.stdin,
      output: process.stdout,
      log: (l) => process.stderr.write(`${l}\n`),
    });
  } catch (e) {
    process.stderr.write(`${String((e as Error).message)}\n`);
    process.exitCode = 2;
  }
}
