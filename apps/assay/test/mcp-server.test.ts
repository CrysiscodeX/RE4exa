import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import type { Json } from "../src/evidence/jcs.ts";
import { STDIO_PROXY_PATH, stdioProxyCommand } from "../src/mcp/config.ts";
import { createToolRegistry } from "../src/mcp/registry.ts";
import {
  createMcpHandler,
  type JsonRpcResponse,
  type McpSession,
  mountHttp,
  queueApprover,
  TokenRegistry,
} from "../src/mcp/server.ts";
import { parseArgs, runProxy } from "../src/mcp/stdio-proxy.ts";
import { ApprovalQueue } from "../src/policy/approvals.ts";
import type { ApprovalView } from "../src/server/api-types.ts";
import { stubEngine } from "./fixtures/tripwire/_support/stub-engine.ts";
import { openTemp } from "./helpers.ts";

function setup() {
  const { k, cleanup } = openTemp();
  const ws = mkdtempSync(join(tmpdir(), "assay-ws-"));
  writeFileSync(join(ws, "README.md"), "hello\n");
  const c = k.createCase({ title: "t", workspace: ws });
  const approvals = new ApprovalQueue(k, { timeoutMs: 5_000 });
  const registry = createToolRegistry({ kernel: k, engine: stubEngine(k, ws), approvals, workspace: ws });
  const handler = createMcpHandler({ registry, version: "0.1.0" });
  const session: McpSession = {
    caseId: c.id,
    caller: "coordinator",
    workspace: ws,
    signal: new AbortController().signal,
    approve: async () => {},
  };
  return {
    k,
    c,
    ws,
    approvals,
    registry,
    handler,
    session,
    cleanup: () => {
      approvals.close();
      cleanup();
      rmSync(ws, { recursive: true, force: true });
    },
  };
}

const rpc = (id: number | string | null, method: string, params?: Json) =>
  params === undefined ? { jsonrpc: "2.0", id, method } : { jsonrpc: "2.0", id, method, params };

test("initialize negotiates the protocol version and reports server info", async () => {
  const s = setup();
  try {
    for (const [asked, want] of [
      ["2025-06-18", "2025-06-18"],
      ["2025-03-26", "2025-03-26"],
      ["2024-11-05", "2024-11-05"],
      ["2099-01-01", "2025-06-18"],
      [undefined, "2025-06-18"],
    ] as const) {
      const r = (await s.handler.handle(
        rpc(
          1,
          "initialize",
          asked ? { protocolVersion: asked, capabilities: {}, clientInfo: { name: "t", version: "1" } } : {},
        ),
        s.session,
      )) as JsonRpcResponse;
      const res = r.result as { protocolVersion: string; serverInfo: Json; capabilities: Json };
      assert.equal(res.protocolVersion, want);
      assert.deepEqual(res.serverInfo, { name: "assay", version: "0.1.0" });
      assert.deepEqual(res.capabilities, { tools: {} });
    }
    assert.equal(await s.handler.handle({ jsonrpc: "2.0", method: "notifications/initialized" }, s.session), null);
    assert.deepEqual(await s.handler.handle(rpc("p", "ping"), s.session), { jsonrpc: "2.0", id: "p", result: {} });
  } finally {
    s.cleanup();
  }
});

test("tools/list returns schemas and effect-derived annotations", async () => {
  const s = setup();
  try {
    const r = (await s.handler.handle(rpc(2, "tools/list", {}), s.session)) as JsonRpcResponse;
    const tools = (r.result as { tools: { name: string; inputSchema: Json; annotations: Record<string, boolean> }[] })
      .tools;
    const by = new Map(tools.map((t) => [t.name, t]));
    assert.deepEqual(by.get("assay_read_file")!.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    assert.deepEqual(by.get("assay_exec")!.annotations, {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    });
    assert.deepEqual(by.get("assay_write_file")!.annotations, {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    });
    for (const t of tools) assert.equal((t.inputSchema as { type: string }).type, "object");
    assert.ok(JSON.stringify(tools).length < 12_000, "compact tool listing");
  } finally {
    s.cleanup();
  }
});

test("tools/call returns content, structuredContent and isError", async () => {
  const s = setup();
  try {
    const ok = (await s.handler.handle(
      rpc(3, "tools/call", { name: "assay_list_probes", arguments: {} }),
      s.session,
    )) as JsonRpcResponse;
    const res = ok.result as { content: { type: string; text: string }[]; structuredContent: Json; isError?: boolean };
    assert.equal(res.content[0]!.type, "text");
    assert.match(res.content[0]!.text, /file\.identify/);
    assert.ok(res.structuredContent && typeof res.structuredContent === "object");
    assert.equal(res.isError, undefined);
    const bad = (await s.handler.handle(
      rpc(4, "tools/call", { name: "assay_read_file", arguments: { path: "../etc/passwd" } }),
      s.session,
    )) as JsonRpcResponse;
    const br = bad.result as { content: { text: string }[]; isError: boolean };
    assert.equal(br.isError, true);
    assert.equal((JSON.parse(br.content[0]!.text) as { code: string }).code, "path_outside_workspace");
  } finally {
    s.cleanup();
  }
});

test("JSON-RPC errors: parse, invalid request, unknown method, invalid params; batches", async () => {
  const s = setup();
  try {
    const code = (r: unknown) => (r as JsonRpcResponse).error?.code;
    assert.equal(code(await s.handler.handleText("{not json", s.session)), -32700);
    assert.equal(((await s.handler.handleText("{not json", s.session)) as JsonRpcResponse).id, null);
    assert.equal(code(await s.handler.handle(42, s.session)), -32600);
    assert.equal(code(await s.handler.handle({ jsonrpc: "1.0", id: 1, method: "ping" }, s.session)), -32600);
    assert.equal(code(await s.handler.handle({ jsonrpc: "2.0", id: {}, method: "ping" }, s.session)), -32600);
    assert.equal(code(await s.handler.handle({ jsonrpc: "2.0", id: 1, method: 5 }, s.session)), -32600);
    assert.equal(code(await s.handler.handle([], s.session)), -32600);
    assert.equal(code(await s.handler.handle(rpc(1, "resources/list"), s.session)), -32601);
    assert.equal(await s.handler.handle({ jsonrpc: "2.0", method: "no/such/notification" }, s.session), null);
    assert.equal(code(await s.handler.handle(rpc(1, "tools/call", { arguments: {} }), s.session)), -32602);
    assert.equal(code(await s.handler.handle(rpc(1, "tools/call", { name: "nope" }), s.session)), -32602);
    assert.equal(
      code(await s.handler.handle(rpc(1, "tools/call", { name: "assay_list_probes", arguments: [] }), s.session)),
      -32602,
    );
    const batch = (await s.handler.handle(
      [rpc(1, "ping"), { jsonrpc: "2.0", method: "notifications/initialized" }, rpc(2, "nope"), 7],
      s.session,
    )) as JsonRpcResponse[];
    assert.equal(batch.length, 3);
    assert.deepEqual(
      batch.map((r) => r.id),
      [1, 2, null],
    );
    assert.deepEqual(
      batch.map((r) => r.error?.code ?? 0),
      [0, -32601, -32600],
    );
    assert.equal(await s.handler.handle([{ jsonrpc: "2.0", method: "notifications/initialized" }], s.session), null);
  } finally {
    s.cleanup();
  }
});

async function listen(s: ReturnType<typeof setup>, tokens: TokenRegistry): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    void mountHttp(req, res, {
      tokens,
      handler: s.handler,
      approve: queueApprover(s.approvals),
      workspace: s.ws,
    }).then((handled) => {
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { server, port: (server.address() as AddressInfo).port };
}

test("HTTP: bearer auth, Host/Origin checks, methods, notifications, approvals through the queue", async () => {
  const s = setup();
  const tokens = new TokenRegistry();
  const token = tokens.issue({ caseId: s.c.id, caller: "w1" });
  const { server, port } = await listen(s, tokens);
  const url = `http://127.0.0.1:${port}/mcp`;
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  try {
    const missing = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(missing.status, 401);
    assert.match(missing.headers.get("www-authenticate") ?? "", /Bearer/);
    assert.equal(((await missing.json()) as { error: { code: string } }).error.code, "unauthorized");
    assert.equal((await post(rpc(1, "ping"), { authorization: "Bearer nope" })).status, 401);
    assert.equal((await post(rpc(1, "ping"), { origin: "http://evil.example" })).status, 403);
    assert.equal((await post(rpc(1, "ping"), { origin: `http://localhost:${port}` })).status, 200);
    // DNS rebinding: a foreign Host header is refused (raw request, fetch cannot override Host).
    const { request } = await import("node:http");
    const hostStatus = await new Promise<number>((resolve) => {
      const r = request(
        {
          host: "127.0.0.1",
          port,
          path: "/mcp",
          method: "POST",
          headers: {
            host: `evil.example:${port}`,
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      r.end(JSON.stringify(rpc(1, "ping")));
    });
    assert.equal(hostStatus, 403);
    const get = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(get.status, 405);
    assert.equal(get.headers.get("allow"), "POST");
    assert.equal((await post(rpc(1, "ping"), { "content-type": "text/plain" })).status, 415);
    assert.equal((await post(rpc(1, "ping"), { "mcp-protocol-version": "1999-01-01" })).status, 400);
    const note = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    assert.equal(note.status, 202);
    const ping = await post(rpc(9, "ping"), { "mcp-protocol-version": "2025-06-18" });
    assert.deepEqual(await ping.json(), { jsonrpc: "2.0", id: 9, result: {} });
    assert.equal((await fetch(`http://127.0.0.1:${port}/other`)).status, 404);

    // A gated call waits on the approval queue; the caller identity comes from the token.
    const seen: ApprovalView[] = [];
    s.approvals.on("approval", (v: ApprovalView) => {
      seen.push(v);
      if (v.state === "pending") setImmediate(() => s.approvals.decide(v.id, "deny", "no"));
    });
    const call = await post(
      rpc(10, "tools/call", { name: "assay_write_file", arguments: { path: "x.txt", content: "x" } }),
    );
    const body = (await call.json()) as { result: { isError: boolean; content: { text: string }[] } };
    assert.equal(body.result.isError, true);
    assert.equal((JSON.parse(body.result.content[0]!.text) as { code: string }).code, "approval_denied");
    assert.equal(seen[0]!.workerId, "w1");
    assert.equal(seen[0]!.caseId, s.c.id);
    assert.equal(seen[0]!.action, "assay_write_file");
    assert.equal(seen[0]!.reason, "effect write");
    tokens.revoke(token);
    assert.equal((await post(rpc(1, "ping"))).status, 401);
    assert.equal(tokens.size, 0);
  } finally {
    server.close();
    s.cleanup();
  }
});

test("stdio proxy forwards line-delimited JSON-RPC (in-process and as a CLI)", async () => {
  const s = setup();
  const tokens = new TokenRegistry();
  const token = tokens.issue({ caseId: s.c.id, caller: "coordinator" });
  const { server, port } = await listen(s, tokens);
  const url = `http://127.0.0.1:${port}/mcp`;
  try {
    assert.deepEqual(parseArgs(["--url", url, "--token-env", "T"], { T: "abc" }), { url, token: "abc" });
    assert.throws(() => parseArgs([], {}), /usage/);
    const input = new PassThrough();
    const output = new PassThrough();
    let out = "";
    output.on("data", (d: Buffer) => {
      out += d.toString();
    });
    const done = runProxy({ url, token, input, output });
    input.write(`${JSON.stringify(rpc(1, "initialize", { protocolVersion: "2025-03-26" }))}\n`);
    input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n\n`);
    input.write(`${JSON.stringify([rpc(2, "ping"), rpc(3, "tools/list")])}\n`);
    input.end();
    await done;
    const lines = out
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as JsonRpcResponse | JsonRpcResponse[]);
    assert.equal(lines.length, 2);
    const init = lines.find((l) => !Array.isArray(l)) as JsonRpcResponse;
    assert.equal((init.result as { protocolVersion: string }).protocolVersion, "2025-03-26");
    const batch = lines.find((l) => Array.isArray(l)) as JsonRpcResponse[];
    assert.equal(batch.length, 2);

    // Bad token: the proxy answers each request with a JSON-RPC error instead of hanging.
    const out2 = new PassThrough();
    let text2 = "";
    out2.on("data", (d: Buffer) => {
      text2 += d.toString();
    });
    const in2 = new PassThrough();
    const p2 = runProxy({ url, token: "wrong", input: in2, output: out2 });
    in2.end(`${JSON.stringify(rpc(7, "ping"))}\n`);
    await p2;
    const err = JSON.parse(text2.trim()) as JsonRpcResponse;
    assert.equal(err.id, 7);
    assert.match(err.error!.message, /401.*unauthorized/);

    // As a real child process, the way Codex and ACP agents start it.
    const cmd = stdioProxyCommand(url, token, { tokenInEnv: true });
    assert.ok(cmd.args.includes(STDIO_PROXY_PATH));
    assert.ok(!cmd.args.includes(token));
    const child = spawn(cmd.program, cmd.args, {
      env: { ...process.env, ...cmd.env },
      stdio: ["pipe", "pipe", "inherit"],
    });
    let childOut = "";
    child.stdout.on("data", (d: Buffer) => {
      childOut += d.toString();
    });
    child.stdin.end(`${JSON.stringify(rpc(11, "ping"))}\n`);
    const code = await new Promise<number | null>((r) => child.on("exit", r));
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(childOut.trim()), { jsonrpc: "2.0", id: 11, result: {} });
  } finally {
    server.close();
    s.cleanup();
  }
});
